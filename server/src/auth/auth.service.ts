import { BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt } from 'crypto';
import type { Account, Person } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { LoginDto } from './dto/login.dto';
import { CompleteSignupDto } from './dto/complete-signup.dto';
import { jobRoleLabel } from '../common/job-roles';
import { LEVEL, levelName } from '../common/levels';
import { RateLimitService } from '../common/rate-limit.service';
import { TenantContext } from '../tenant/tenant-context';
import type { Request, Response } from 'express';
import { expireProvisional, expireProvisionalInTransaction, isProvisional } from '../accounts/provisional';
import { isTestAccount, testAccountsEnabled } from '../accounts/test-accounts';
import { MAX_SET, SESSION_SET_COOKIE, SESSION_TTL_DAYS, SetEntry, cookieBase, readCookie } from './session-cookie';

const MAX_SESSIONS = 10;
const OTP_TTL_MS = 5 * 60_000;
const OTP_RESEND_MS = 60_000;
const OTP_MAX_ATTEMPTS = 5;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** هویت در Person است و اعتبارنامه در Account؛ هر جا کاربر برگردانده می‌شود هر دو لازم‌اند. */
type AccountWithPerson = Account & { person: Person };
const WITH_PERSON = { person: true } as const;

/**
 * حسابی که مدیر برای شخصِ دیگری ساخته و آن شخص هنوز مالکش نشده.
 *
 * ⚠️ **این تنها تعریفِ «تصاحب‌نشده» در سامانه است.** نگهبانِ ورود، نگهبانِ
 * درخواستِ کد، و مسیرِ تصاحب هر سه از همین می‌خوانند؛ سه شرطِ جدا یعنی روزی
 * یکی‌شان عقب بماند و همان یکی درِ باز شود.
 *
 * سنجه `passwordHash`ِ خالی است: مدیر رمزی نمی‌داند تا به کارشناس بدهد، پس
 * حساب تا وقتی صاحبش با کدِ پیامکی آن را برندارد رمزِ قابلِ‌استفاده ندارد.
 * (نسخهٔ قبلی یک هشِ **تصادفی** می‌گذاشت — حسابی که نه کسی می‌توانست واردش
 * شود و نه ثبت‌نامِ دوباره قبولش می‌کرد: شماره برای همیشه قفل می‌شد.)
 */
export const isUnclaimedAccount = (a: { passwordHash?: string | null } | null | undefined): boolean =>
  !!a && !a.passwordHash;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private sms: SmsService,
    private rateLimit: RateLimitService,
    private tenantContext: TenantContext,
  ) {}

  async setupStatus() {
    const count = await this.prisma.account.count();
    return { needsSetup: count === 0 };
  }

  // ── ثبت‌نام: مرحلهٔ ۱ — ارسالِ کدِ یکبارمصرف ────────────────
  async requestSignupOtp(phone: string, ip = 'unknown') {
    this.rateLimit.hit(`otp:ip:${ip}`, 10, 15 * 60_000);
    this.rateLimit.hit(`otp:phone:${phone}`, 3, 15 * 60_000);
    /**
     * ⚠️ «شماره تکراری است» فقط وقتی درست است که آن شخص **حساب** داشته باشد.
     *
     * راننده، پیک و جراح در تعاریفِ پایه یک `Person` می‌شوند بدونِ حساب. اگر
     * صرفِ وجودِ Person ثبت‌نام را رد کند، همان راننده هیچ‌وقت نمی‌تواند وارد
     * پرتالش شود — شماره‌اش «قبلاً ثبت شده» است، آن هم توسطِ خودش. پس شرط
     * روی داشتنِ حساب است، نه روی وجودِ شخص.
     */
    const exists = await this.prisma.person.findUnique({
      where: { phone_phoneScope: { phone, phoneScope: 'primary' } },
      include: { account: { select: { id: true, passwordHash: true, verificationDueAt: true, phoneVerifiedAt: true } } },
    });
    /* ⚠️ «تکراری» فقط حسابِ **تصاحب‌شده** است. حسابی که مدیر برای این شماره
       ساخته و هنوز رمز ندارد باید بتواند کد بگیرد — وگرنه همان کارشناسی که
       مدیر برایش حساب ساخته، هرگز نمی‌تواند وارد شود. */
    if (exists?.account && !isUnclaimedAccount(exists.account) && !isProvisional(exists.account)) {
      throw new BadRequestException('این شماره قبلاً ثبت شده است');
    }

    return this.sendPhoneOtp(phone, 'signup');
  }

  private async sendPhoneOtp(phone: string, purpose: string) {
    const recent = await this.prisma.otpCode.findFirst({
      where: { phone, purpose, createdAt: { gt: new Date(Date.now() - OTP_RESEND_MS) } },
    });
    if (recent) throw new BadRequestException('کمی صبر کنید و دوباره تلاش کنید');

    const code = String(randomInt(100000, 1000000)); // ۶ رقمی
    const otp = await this.prisma.otpCode.create({
      data: { phone, codeHash: sha256(code), purpose, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });
    try {
      // هاستِ WebOTP باید میزبانِ همان شرکت باشد، وگرنه مرورگر کد را اتوفیل نمی‌کند
      // (WebOTP به origin گره خورده است).
      const res = await this.sms.sendOtp(phone, code, this.tenantContext.current()?.hostname);
      if (!res.sent && process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException('سرویس پیامک موقتاً در دسترس نیست');
      }
      // devCode فقط در محیط test و برای stub امن برگردانده می‌شود.
      return {
        ok: true,
        ttl: OTP_TTL_MS / 1000,
        ...(res.stub && process.env.NODE_ENV === 'test' ? { devCode: code } : {}),
      };
    } catch (error) {
      // کدی که ارسال نشده نباید کاربر را تا پایان resend window مسدود کند.
      await this.prisma.otpCode.deleteMany({ where: { id: otp.id, consumedAt: null } }).catch(() => undefined);
      throw error;
    }
  }

  // ── ثبت‌نام: مرحلهٔ ۲ — تأییدِ کد → توکنِ کوتاه‌عمرِ ثبت‌نام ──
  async verifySignupOtp(dto: { phone: string; code: string }, ip = 'unknown') {
    await this.consumePhoneOtp(dto, 'signup', ip);
    const signupToken = await this.jwt.signAsync({ phone: dto.phone, purpose: 'signup' }, { expiresIn: '15m' });
    return { ok: true, signupToken };
  }

  private async consumePhoneOtp(dto: { phone: string; code: string }, purpose: string, ip: string) {
    this.rateLimit.hit(`otp-verify:ip:${ip}`, 20, 15 * 60_000);
    this.rateLimit.hit(`otp-verify:phone:${dto.phone}`, 8, 15 * 60_000);
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone: dto.phone, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('برای این شماره کدی صادر نشده است');
    if (otp.expiresAt < new Date()) throw new BadRequestException('کد منقضی شده؛ دوباره درخواست دهید');
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new BadRequestException('تعداد تلاش زیاد است؛ کد جدید بگیرید');

    if (sha256(dto.code) !== otp.codeHash) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException('کد تأیید اشتباه است');
    }
    const consumed = await this.prisma.otpCode.updateMany({ where: { id: otp.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (!consumed.count) throw new BadRequestException('کد قبلاً استفاده شده یا منقضی است');

  }

  async requestPhoneVerification(user: any, ip: string) {
    if (!isProvisional(user)) throw new BadRequestException('حساب نیازی به تأیید موقت ندارد');
    if (isTestAccount(user)) {
      this.rateLimit.hit(`otp:ip:${ip}`, 10, 15 * 60_000);
      this.rateLimit.hit(`otp:phone:${user.person.phone}`, 3, 15 * 60_000);
      return this.sendPhoneOtp(user.person.phone, `test-account:${user.id}`);
    }
    return this.requestSignupOtp(user.person.phone, ip);
  }

  async verifyPhone(user: any, dto: { phone: string; code: string }, ip: string) {
    if (!isProvisional(user) || dto.phone !== user.person.phone) throw new BadRequestException('شماره باید با شماره حساب شما یکسان باشد');
    if (isTestAccount(user)) await this.consumePhoneOtp(dto, `test-account:${user.id}`, ip);
    else await this.verifySignupOtp(dto, ip);
    const changed = await this.prisma.account.updateMany({ where: { id: user.id, status: 'active', phoneVerifiedAt: null, verificationDueAt: { gt: new Date() }, person: { phone: dto.phone } }, data: { phoneVerifiedAt: new Date() } });
    if (!changed.count) { await expireProvisional(this.prisma, user.id); throw new BadRequestException('مهلت تأیید تمام شده یا مشخصات حساب تغییر کرده است'); }
    return this.publicUser(await this.prisma.account.findUniqueOrThrow({ where: { id: user.id }, include: WITH_PERSON }));
  }

  // ── ثبت‌نام: مرحلهٔ ۳ — تکمیلِ پروفایل و ساختِ حساب ─────────
  async completeSignup(dto: CompleteSignupDto, meta: { ua?: string; ip?: string }) {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(dto.signupToken);
    } catch {
      throw new BadRequestException('مهلتِ تکمیلِ ثبت‌نام تمام شده؛ دوباره کد بگیرید');
    }
    if (payload?.purpose !== 'signup' || !payload?.phone) {
      throw new BadRequestException('توکنِ ثبت‌نام نامعتبر است');
    }
    const phone: string = payload.phone;

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const result = await this.prisma.$transaction(async (tx) => {
      // یک قفل سراسری کوتاه، ثبت‌نام هم‌زمان را از ساخت دو سوپرادمین بازمی‌دارد.
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(73190521)');

      const usernameOwner = await tx.account.findUnique({ where: { username: dto.username }, include: { person: true } });
      if (usernameOwner && !(isProvisional(usernameOwner) && !isTestAccount(usernameOwner) && usernameOwner.person.phone === phone)) {
        throw new BadRequestException('این نام کاربری قبلاً گرفته شده است');
      }
      // شخصی که از قبل هست ولی حساب ندارد (راننده/پیکِ تعریف‌شده) به همان
      // هویت وصل می‌شود، نه یک Personِ دومِ هم‌شماره.
      const known = await tx.person.findUnique({
        where: { phone_phoneScope: { phone, phoneScope: 'primary' } },
        include: { account: { select: { id: true, passwordHash: true, verificationDueAt: true, phoneVerifiedAt: true } } },
      });
      if (known?.account && !isUnclaimedAccount(known.account) && !isProvisional(known.account)) {
        throw new BadRequestException('این شماره قبلاً ثبت شده است');
      }

      /**
       * **تصاحبِ حسابی که مدیر از قبل ساخته** (کارشناسِ افزوده‌شده در تأییدِ
       * ثبت‌نام). کدِ پیامکی ثابت کرده این شماره مالِ همین شخص است و حساب هم
       * برای همین شماره ساخته شده بود؛ پس مالکِ درست همین است.
       *
       * ⚠️ **سطح و وضعیت دست‌نخورده می‌مانند.** آن‌ها را مدیر تعیین کرده؛
       * اگر تصاحب سطح می‌داد یا bootstrap را روشن می‌کرد، هر کس با یک شمارهٔ
       * از پیش ثبت‌شده می‌توانست سطحِ خودش را بالا ببرد. تصاحب فقط سه چیز
       * اضافه می‌کند: نامِ کاربری، رمز، و سلفی.
       */
      if (known?.account) {
        await expireProvisionalInTransaction(tx, known.account.id);
        const claimed = await tx.account.update({
          where: { id: known.account.id },
          data: {
            username: dto.username.trim(),
            passwordHash,
            phoneVerifiedAt: new Date(),
            person: { update: { photo: dto.selfie } },
          },
          include: WITH_PERSON,
        });
        await tx.auditEvent.create({
          data: {
            actorId: claimed.id, action: 'account.claim', entityType: 'account',
            entityId: String(claimed.id),
            afterJson: { username: claimed.username, level: claimed.level },
          },
        });
        return { account: claimed, bootstrap: false, claimed: true };
      }

      const bootstrap =
        (await tx.account.count({ where: { level: LEVEL.SUPER_ADMIN, status: 'active' } })) === 0;
      // هویت و نقش با هم ساخته می‌شوند؛ nested create یعنی اگر یکی شکست بخورد
      // دیگری هم ثبت نمی‌شود و Personِ بی‌نقش جا نمی‌مانَد.
      const account = await tx.account.create({
        data: {
          username: dto.username.trim(),
          passwordHash,
          phoneVerifiedAt: new Date(),
          level: bootstrap ? LEVEL.SUPER_ADMIN : LEVEL.VIEWER,
          ...(bootstrap && (await tx.setting.findUnique({ where: { key: 'vertical' } }))?.value === 'clinic' ? { jobRole: 'doctor' } : {}),
          status: bootstrap ? 'active' : 'pending',
          person: known
            ? {
                // هویتِ موجود می‌ماند و فقط عکسِ سلفی به آن اضافه می‌شود؛
                // نامِ ثبت‌شده در تعاریف را ثبت‌نام بازنویسی نمی‌کند.
                connect: { id: known.id },
              }
            : {
                create: {
                  firstName: dto.firstName.trim(),
                  lastName: dto.lastName.trim(),
                  phone,
                  photo: dto.selfie,
                },
              },
        },
        include: WITH_PERSON,
      });
      return { account, bootstrap, claimed: false };
    });

    /**
     * ⚠️ سنجه **وضعیتِ خودِ حساب** است، نه `bootstrap`.
     *
     * حسابِ تصاحب‌شده را مدیر از قبل تأیید کرده و `active` است؛ اگر مثلِ
     * ثبت‌نامِ معمولی `pending` برمی‌گشت، کارشناس صفحهٔ «در انتظارِ تأییدِ
     * مدیر» را می‌دید و برای تأییدی منتظر می‌ماند که قبلاً انجام شده.
     */
    if (result.account.status === 'active') {
      return {
        pending: false,
        bootstrap: result.bootstrap,
        claimed: result.claimed,
        ...(await this.issue(result.account, meta)),
      };
    }
    return { pending: true, user: this.publicUser(result.account) };
  }

  // ── ورود ───────────────────────────────────────────────────
  async login(dto: LoginDto, meta: { ua?: string; ip?: string }) {
    this.rateLimit.hit(`login:ip:${meta.ip ?? 'unknown'}`, 12, 15 * 60_000);
    this.rateLimit.hit(`login:id:${dto.identifier.trim().toLowerCase()}`, 8, 15 * 60_000);
    const id = dto.identifier.trim();
    // ورود با نام کاربری (روی Account) یا موبایل (روی Person).
    const account = await this.prisma.account.findFirst({
      where: { OR: [{ username: id }, { person: { phone: id, phoneScope: 'primary' } }] },
      include: WITH_PERSON,
    });
    if (!account) throw new UnauthorizedException('نام کاربری یا رمز عبور اشتباه است');
    if (isTestAccount(account) && !await testAccountsEnabled(this.prisma)) throw new UnauthorizedException('حالت آزمایشی خاموش است');
    if (isProvisional(account) && account.verificationDueAt! <= new Date()) { await expireProvisional(this.prisma, account.id); throw new UnauthorizedException('مهلت هفت‌روزه تأیید شماره تمام شده؛ حساب غیرفعال است'); }
    /* ⚠️ حسابِ تصاحب‌نشده رمزِ معتبر ندارد و نباید داشته باشد. `bcrypt.compare`
       با هشِ خالی هم false می‌دهد، ولی شرطِ صریح این را از یک جزئیاتِ
       کتابخانه به یک **قاعدهٔ اعلام‌شده** تبدیل می‌کند. */
    if (isUnclaimedAccount(account)) {
      throw new UnauthorizedException('این حساب هنوز فعال نشده؛ با ثبت‌نام و کدِ پیامکی آن را تحویل بگیرید');
    }
    const ok = await bcrypt.compare(dto.password, account.passwordHash);
    if (!ok) throw new UnauthorizedException('نام کاربری یا رمز عبور اشتباه است');

    if (account.status === 'pending') throw new UnauthorizedException('حساب شما در انتظار تأیید مدیر است');
    if (account.status === 'rejected') throw new UnauthorizedException('درخواستِ عضویتِ شما رد شده است');
    if (account.status !== 'active') throw new UnauthorizedException('حساب شما غیرفعال است');

    return this.issue(account, meta);
  }

  async issue(account: AccountWithPerson, meta: { ua?: string; ip?: string }) {
    if (isTestAccount(account) && !await testAccountsEnabled(this.prisma)) throw new UnauthorizedException('حالت آزمایشی خاموش است');
    if (isProvisional(account) && account.verificationDueAt! <= new Date()) { await expireProvisional(this.prisma, account.id); throw new UnauthorizedException('مهلت تأیید شماره تمام شده؛ حساب غیرفعال است'); }
    const active = await this.prisma.session.findMany({
      where: { accountId: account.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
    });
    if (active.length >= MAX_SESSIONS) {
      const over = active.slice(0, active.length - MAX_SESSIONS + 1);
      await this.prisma.session.updateMany({
        where: { id: { in: over.map((s) => s.id) } },
        data: { revokedAt: new Date() },
      });
    }
    const raw = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
    const session = await this.prisma.session.create({
      data: {
        accountId: account.id,
        tokenHash: sha256(raw),
        userAgent: meta.ua?.slice(0, 255) ?? null,
        ip: meta.ip ?? null,
        expiresAt,
      },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: account.id, sid: session.id, level: account.level, tid: this.tenantContext.require().tenantId },
      { expiresIn: `${SESSION_TTL_DAYS}d` },
    );
    // `sid` هم برمی‌گردد تا کنترلر بتواند نشستِ تازه را به مجموعهٔ چندحسابیِ کوکی اضافه کند.
    return { accessToken, sid: session.id, user: this.publicUser(account) };
  }

  async validateSession(sid: string, sub: number) {
    const session = await this.prisma.session.findUnique({
      where: { id: sid },
      include: { account: { include: WITH_PERSON } },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
    if (isTestAccount(session.account) && !await testAccountsEnabled(this.prisma)) return null;
    if (session.accountId !== sub || session.account.status !== 'active') return null;
    if (isProvisional(session.account) && session.account.verificationDueAt! <= new Date()) { await expireProvisional(this.prisma, sub); return null; }
    return session.account;
  }

  /// پروفایل روی Person نوشته می‌شود — همان رکوردی که نقشِ جراحِ همین آدم هم از آن می‌خوانَد.
  async updateProfile(id: number, dto: { firstName?: string; lastName?: string; selfie?: string }) {
    const account = await this.prisma.account.update({
      where: { id },
      data: {
        person: {
          update: {
            ...(dto.firstName !== undefined ? { firstName: dto.firstName.trim() } : {}),
            ...(dto.lastName !== undefined ? { lastName: dto.lastName.trim() } : {}),
            ...(dto.selfie !== undefined ? { photo: dto.selfie } : {}),
          },
        },
      },
      include: WITH_PERSON,
    });
    return this.publicUser(account);
  }

  async changePassword(id: number, current: string, next: string) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new UnauthorizedException();
    const ok = await bcrypt.compare(current, account.passwordHash);
    if (!ok) throw new BadRequestException('رمزِ فعلی اشتباه است');
    await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id },
        data: { passwordHash: await bcrypt.hash(next, 12) },
      }),
      this.prisma.session.updateMany({
        where: { accountId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { ok: true, sessionsRevoked: true };
  }

  async logout(sid: string) {
    await this.prisma.session.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  async revokeMany(sids: string[]) {
    if (!sids.length) return;
    await this.prisma.session.updateMany({ where: { id: { in: sids }, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  // ── چندحسابی با کوکی (قانون ۶) ─────────────────────────────
  //
  // مجموعهٔ نشست‌های «مرا به خاطر بسپار»ِ این مرورگر، به‌شکلِ JWTِ امضاشده در یک
  // کوکیِ HttpOnly. کلاینت فقط شناسهٔ حساب را می‌فرستد؛ توکنِ هیچ حسابی را ندارد.

  /** خواندنِ مجموعه — کوکیِ نامعتبر/منقضی/از tenantِ دیگر = مجموعهٔ خالی، نه خطا. */
  async readSessionSet(req: Request): Promise<SetEntry[]> {
    const raw = readCookie(req, SESSION_SET_COOKIE);
    if (!raw) return [];
    try {
      const p: any = await this.jwt.verifyAsync(raw);
      if (p?.tid !== this.tenantContext.require().tenantId || !Array.isArray(p.s)) return [];
      return p.s
        .filter((e: any) => e && typeof e.sid === 'string' && Number.isInteger(e.sub))
        .map((e: any) => ({ sid: e.sid, sub: e.sub }))
        .slice(0, MAX_SET);
    } catch {
      return [];
    }
  }

  async writeSessionSet(res: Response, entries: SetEntry[]) {
    if (!entries.length) {
      res.clearCookie(SESSION_SET_COOKIE, { path: '/' });
      return;
    }
    const token = await this.jwt.signAsync(
      { s: entries.slice(0, MAX_SET), tid: this.tenantContext.require().tenantId },
      { expiresIn: `${SESSION_TTL_DAYS}d` },
    );
    res.cookie(SESSION_SET_COOKIE, token, { httpOnly: true, ...cookieBase(true) });
  }

  /** فقط نشست‌های زنده — مرده‌ها (باطل/منقضی/حسابِ غیرفعال) کنار می‌روند. */
  async liveSet(entries: SetEntry[]) {
    const out: { entry: SetEntry; account: AccountWithPerson }[] = [];
    for (const entry of entries) {
      const account = await this.validateSession(entry.sid, entry.sub);
      if (account) out.push({ entry, account });
    }
    return out;
  }

  /** توکنِ تازه برای نشستِ موجود — سوییچ؛ نشست همان است، فقط کوکیِ فعال عوض می‌شود. */
  tokenFor(sid: string, account: AccountWithPerson) {
    return this.jwt.signAsync(
      { sub: account.id, sid, level: account.level, tid: this.tenantContext.require().tenantId },
      { expiresIn: `${SESSION_TTL_DAYS}d` },
    );
  }

  /// شکلِ عمومیِ کاربر برای کلاینت. قرارداد بیرونی عمداً همان قبلی نگه داشته شد
  /// (firstName/lastName/phone/selfie) تا جابه‌جاییِ داخلیِ فیلدها به فرانت نشت نکند.
  publicUser(a: AccountWithPerson) {
    const p = a.person;
    const displayName =
      [p?.firstName, p?.lastName].filter(Boolean).join(' ').trim() || a.username || p?.phone || 'کاربر';
    return {
      id: a.id,
      isTestAccount: isTestAccount(a),
      phoneVerifiedAt: a.phoneVerifiedAt,
      verificationDueAt: a.verificationDueAt,
      personId: a.personId,
      firstName: p?.firstName ?? null,
      lastName: p?.lastName ?? null,
      displayName,
      username: a.username,
      phone: p?.phone ?? null,
      level: a.level,
      levelName: levelName(a.level),
      jobRole: a.jobRole ?? null,
      jobRoleLabel: jobRoleLabel(a.jobRole),
      status: a.status,
      selfie: p?.photo ?? null,
    };
  }
}
