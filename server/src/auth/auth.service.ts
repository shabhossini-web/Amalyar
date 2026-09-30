import { BadRequestException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
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
import { AuditService } from '../audit/audit.service';
import { toEnDigits } from '../common/identity';
import { otpHash } from '../common/otp-hash';
import { takePublicSms } from '../common/public-sms';
import type { Request, Response } from 'express';
import { expireProvisional, expireProvisionalInTransaction, isProvisional, isSoleActiveSuperAdmin, isVerificationOverdue, provisionalLapsed } from '../accounts/provisional';
import { isTestAccount, testAccountsEnabled } from '../accounts/test-accounts';
import { MAX_SET, SESSION_SET_COOKIE, SESSION_TTL_DAYS, SetEntry, cookieBase, readCookie } from './session-cookie';

const MAX_SESSIONS = 10;
const OTP_TTL_MS = 5 * 60_000;
const OTP_RESEND_MS = 60_000;
const OTP_MAX_ATTEMPTS = 5;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** هدفِ کدهای بازیابیِ رمز در `otpCode` — جدا از ثبت‌نام، تا کدِ یکی در دیگری مصرف نشود. */
const RESET_PURPOSE = 'password-reset';
/** یک پیام برای **همهٔ** شکست‌های تأییدِ کدِ بازیابی — تفکیکش می‌گفت این شماره حساب دارد یا نه. */
const RESET_BAD = 'کدِ تأیید درست نیست یا منقضی شده است؛ دوباره کد بگیرید';

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

/**
 * «سامانه هنوز هیچ حسابی ندارد» — **تنها** شرطِ «اولین حساب = سوپرادمین» (بستهٔ PS، PS2).
 *
 * هشدار: `completeSignup` تا دیروز «سوپرادمینِ فعالی نیست» را می‌سنجید، نه «حسابی نیست» (که `setupStatus`
 * درست می‌شمرد). سوپرادمینِ تنها که شماره‌اش را عوض می‌کرد و هفت روز تأیید نمی‌کرد غیرفعال می‌شد و اولین
 * ثبت‌نامِ عمومی **سوپرادمینِ فعال** می‌شد. حالا هر دو از همین می‌خوانند؛ حسابِ سیستمی (ربات) شمرده نمی‌شود.
 */
const hasNoAccounts = async (db: any): Promise<boolean> => (await db.account.count({ where: { systemKey: null } })) === 0;

/**
 * نامِ کاربریِ **تازه** دست‌کم یک حرفِ لاتین دارد (بستهٔ PS، PS9) — نامِ کاربریِ تمام‌رقم («۰۹۱۲…») با شمارهٔ موبایلِ
 * کسِ دیگری اشتباه می‌شد. حساب‌های موجود دست نمی‌خورند؛ شناسهٔ موبایل‌شکل اول با شماره پیدا می‌شود.
 */
export const USERNAME_NEEDS_LETTER = 'نام کاربری باید دست‌کم یک حرفِ لاتین داشته باشد — نامِ کاربریِ تمام‌رقم با شمارهٔ موبایل اشتباه می‌شود';
export const usernameHasLetter = (u: string) => /[a-zA-Z]/.test(u);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private sms: SmsService,
    private rateLimit: RateLimitService,
    private tenantContext: TenantContext,
    // ⚠️ آخرین پارامتر: `scripts/e2e/test-accounts.mjs` سرویس را با پنج پارامترِ اول می‌سازد.
    private audit?: AuditService,
  ) {}

  /**
   * شرکتِ همین درخواست در کلیدِ سطلِ سقفِ نرخ (بستهٔ PF، PF2). `RateLimitService` یک نمونه برای **همهٔ**
   * شرکت‌هاست؛ بی‌این پیشوند هشت ورودِ غلط با «admin» در شرکتِ الف، «admin»ِ همهٔ شرکت‌ها را قفل می‌کرد.
   */
  private get tid() {
    /* `current?.()`: آزمون‌های درونِ فرایند (company-operations، test-accounts) زمینهٔ شرکتِ نیمه‌ساختگی می‌دهند. */
    return this.tenantContext.current?.()?.tenantId ?? '-';
  }

  async setupStatus() {
    return { needsSetup: await hasNoAccounts(this.prisma) };
  }

  // ── ثبت‌نام: مرحلهٔ ۱ — ارسالِ کدِ یکبارمصرف ────────────────
  async requestSignupOtp(phone: string, ip = 'unknown') {
    this.rateLimit.hit(`otp:${this.tid}:ip:${ip}`, 10, 15 * 60_000);
    this.rateLimit.hit(`otp:${this.tid}:phone:${phone}`, 3, 15 * 60_000);
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

    return this.sendPhoneOtp(phone, 'signup', { publicBucket: true });
  }

  private async sendPhoneOtp(phone: string, purpose: string, opts: { publicBucket?: boolean } = {}) {
    const recent = await this.prisma.otpCode.findFirst({
      where: { phone, purpose, createdAt: { gt: new Date(Date.now() - OTP_RESEND_MS) } },
    });
    if (recent) throw new BadRequestException('کمی صبر کنید و دوباره تلاش کنید');
    /* سطلِ مشترکِ پیامکِ عمومی به این شماره (بستهٔ PS، PS7) — بی‌صدا: همان پاسخ، بی‌پیامک و بی‌کد. */
    if (opts.publicBucket && !takePublicSms(this.rateLimit, this.tid, phone)) return { ok: true, ttl: OTP_TTL_MS / 1000 };

    const code = String(randomInt(100000, 1000000)); // ۶ رقمی
    const otp = await this.prisma.otpCode.create({
      data: { phone, codeHash: otpHash(purpose, phone, code), purpose, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });
    try {
      // هاستِ WebOTP باید میزبانِ همان شرکت باشد، وگرنه مرورگر کد را اتوفیل نمی‌کند
      // (WebOTP به origin گره خورده است).
      const res = await this.sms.sendOtp(phone, code, this.tenantContext.current()?.hostname, purpose);
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
    this.rateLimit.hit(`otp-verify:${this.tid}:ip:${ip}`, 20, 15 * 60_000);
    this.rateLimit.hit(`otp-verify:${this.tid}:phone:${dto.phone}`, 8, 15 * 60_000);
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone: dto.phone, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('برای این شماره کدی صادر نشده است');
    if (otp.expiresAt < new Date()) throw new BadRequestException('کد منقضی شده؛ دوباره درخواست دهید');
    /* شمارشِ تلاش پیش از مقایسه و اتمی — همان قاعدهٔ بازیابیِ رمز (بستهٔ PF، PF4): سنجش و افزایشِ جدا یعنی
       حدس‌های هم‌زمان همه «۰ تلاش» را می‌خواندند و سقفِ پنج‌تایی دور زده می‌شد. */
    const slot = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } },
    });
    if (!slot.count) throw new BadRequestException('تعداد تلاش زیاد است؛ کد جدید بگیرید');

    if (otpHash(purpose, dto.phone, dto.code) !== otp.codeHash) throw new BadRequestException('کد تأیید اشتباه است');
    const consumed = await this.prisma.otpCode.updateMany({ where: { id: otp.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (!consumed.count) throw new BadRequestException('کد قبلاً استفاده شده یا منقضی است');

  }

  async requestPhoneVerification(user: any, ip: string) {
    if (!isProvisional(user)) throw new BadRequestException('حساب نیازی به تأیید موقت ندارد');
    if (isTestAccount(user)) {
      this.rateLimit.hit(`otp:${this.tid}:ip:${ip}`, 10, 15 * 60_000);
      this.rateLimit.hit(`otp:${this.tid}:phone:${user.person.phone}`, 3, 15 * 60_000);
      return this.sendPhoneOtp(user.person.phone, `test-account:${user.id}`);
    }
    return this.requestSignupOtp(user.person.phone, ip);
  }

  async verifyPhone(user: any, dto: { phone: string; code: string }, ip: string) {
    if (!isProvisional(user) || dto.phone !== user.person.phone) throw new BadRequestException('شماره باید با شماره حساب شما یکسان باشد');
    if (isTestAccount(user)) await this.consumePhoneOtp(dto, `test-account:${user.id}`, ip);
    else await this.verifySignupOtp(dto, ip);
    /* آخرین سوپرادمینِ فعال پس از مهلت هم بسته نمی‌شود (PS2) — پس باید بتواند همان موقع شماره را تأیید کند. */
    const late = isVerificationOverdue(user) && await isSoleActiveSuperAdmin(this.prisma, user.id);
    const changed = await this.prisma.account.updateMany({ where: { id: user.id, status: 'active', phoneVerifiedAt: null, ...(late ? {} : { verificationDueAt: { gt: new Date() } }), person: { phone: dto.phone } }, data: { phoneVerifiedAt: new Date() } });
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
    if (!usernameHasLetter(dto.username ?? '')) throw new BadRequestException(USERNAME_NEEDS_LETTER);

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
        include: { account: { select: { id: true, passwordHash: true, verificationDueAt: true, phoneVerifiedAt: true, level: true } } },
      });
      if (known?.account && !isUnclaimedAccount(known.account) && !isProvisional(known.account)) {
        throw new BadRequestException('این شماره قبلاً ثبت شده است');
      }
      /* هشدار — **حسابِ سوپرادمین با کدِ پیامکی تحویل داده نمی‌شود** (بستهٔ PS، PS2؛ همان قاعدهٔ بازیابیِ PF1).
         سوپرادمینی که شماره‌اش را عوض کرده «موقت» است و این مسیر رمز و نامِ کاربری‌اش را به صاحبِ آن شماره
         می‌داد — شماره‌ای که شاید اشتباه تایپ شده. حالا که آخرین سوپرادمین پس از مهلت هم فعال می‌ماند، این در
         بی‌این قفل برای همیشه باز می‌ماند. پیام فقط به دارندهٔ همان شماره می‌رسد (کدِ پیامکی را داده است). */
      if (known?.account && known.account.level >= LEVEL.SUPER_ADMIN) {
        throw new BadRequestException('این شماره قبلاً ثبت شده است؛ حسابِ مدیرِ کل با کدِ پیامکی تحویل داده نمی‌شود — با رمزِ همان حساب وارد شوید.');
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
        /* هشدار — تصاحب یعنی **اعتبارنامهٔ تازه** (بستهٔ PS، PS3): رمز عوض شد، پس نشست‌های رمزِ موقت و
           پس‌کی‌هایی که با آن ثبت شده بودند هم می‌روند — کسی که رمزِ موقت را داشت (مثلاً از پیامی که به جای
           دیگری رفت) نباید پس از تحویلِ حساب به صاحبِ شماره داخل بماند. نشستِ خودِ تصاحب پس از تراکنش ساخته می‌شود. */
        await tx.session.updateMany({ where: { accountId: claimed.id, revokedAt: null }, data: { revokedAt: new Date() } });
        const passkeysRemoved = (await tx.webauthnCredential.deleteMany({ where: { accountId: claimed.id } })).count;
        await tx.auditEvent.create({
          data: {
            actorId: claimed.id, action: 'account.claim', entityType: 'account',
            entityId: String(claimed.id),
            afterJson: { username: claimed.username, level: claimed.level, passkeysRemoved },
          },
        });
        return { account: claimed, bootstrap: false, claimed: true };
      }

      /* فقط وقتی **هیچ** حسابی نیست (PS2) — نه «سوپرادمینِ فعالی نیست». سامانه‌ای که همهٔ سوپرادمین‌هایش غیرفعال
         شده‌اند با پشتیبانی بازیابی می‌شود، نه با اولین کسی که فرمِ ثبت‌نام را پر کند. */
      const bootstrap = await hasNoAccounts(tx);
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

  /**
   * «نامِ کاربری یا موبایل» ← حساب، **با ترتیبِ روشن** (بستهٔ PS، PS9). تا دیروز یک `findFirst` روی `OR` بود که
   * ترتیب نداشت: حسابی با نامِ کاربریِ تمام‌رقمِ «۰۹۱۲…» می‌توانست ورود و بازیابیِ صاحبِ آن شماره را بگیرد.
   * موبایل‌شکل ← اول شماره، بعد نامِ کاربری (حسابِ قدیمیِ تمام‌رقم هنوز با نامش وارد می‌شود)؛ بقیه برعکس.
   */
  private async accountByIdentifier(id: string) {
    const byPhone = () => this.prisma.account.findFirst({ where: { person: { phone: id, phoneScope: 'primary' } }, include: WITH_PERSON });
    const byUsername = () => this.prisma.account.findFirst({ where: { username: id }, include: WITH_PERSON });
    return /^09\d{9}$/.test(id) ? (await byPhone()) ?? (await byUsername()) : (await byUsername()) ?? (await byPhone());
  }

  // ── ورود ───────────────────────────────────────────────────
  async login(dto: LoginDto, meta: { ua?: string; ip?: string }) {
    this.rateLimit.hit(`login:${this.tid}:ip:${meta.ip ?? 'unknown'}`, 12, 15 * 60_000);
    this.rateLimit.hit(`login:${this.tid}:id:${dto.identifier.trim().toLowerCase()}`, 8, 15 * 60_000);
    const id = toEnDigits(dto.identifier).trim();
    // ورود با نام کاربری (روی Account) یا موبایل (روی Person) — موبایل‌شکل اول با شماره (PS9).
    const account = await this.accountByIdentifier(id);
    if (!account) throw new UnauthorizedException('نام کاربری یا رمز عبور اشتباه است');
    if (isTestAccount(account) && !await testAccountsEnabled(this.prisma)) throw new UnauthorizedException('حالت آزمایشی خاموش است');
    if (await provisionalLapsed(this.prisma, account)) throw new UnauthorizedException('مهلت هفت‌روزه تأیید شماره تمام شده؛ حساب غیرفعال است');
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
    if (await provisionalLapsed(this.prisma, account)) throw new UnauthorizedException('مهلت تأیید شماره تمام شده؛ حساب غیرفعال است');
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
    if (await provisionalLapsed(this.prisma, session.account)) return null;
    /* جراحِ فعالِ متصل به شخصِ همین حساب — یک‌بار این‌جا، تا object-authz (`ownVisitWhere`)
       پزشکِ مطب را «خودش» بشمارد بی‌آنکه هر سرویس دوباره بپرسد. */
    const surgeon = session.account.personId
      ? await this.prisma.surgeon.findFirst({ where: { personId: session.account.personId, active: true }, select: { id: true } })
      : null;
    return { ...session.account, surgeonId: surgeon?.id ?? null };
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

  /**
   * **منتخب‌های شخصی** (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳) — سه «فرمِ منتخب» بالای فرمِ مراجعه و سه
   * «ابزارکِ منتخب» بالای صفحهٔ امروز، به‌ازای هر حساب.
   *
   * ⚠️ سمتِ سرور و نه `localStorage`: پزشک بینِ رایانهٔ مطب و گوشی جابه‌جا می‌شود. کلیدها
   * فقط از نظرِ **شکل** سنجیده می‌شوند نه وجود: فرم یا ابزاری که بعداً حذف یا بسته شود،
   * خانه‌اش را رابط خالی نشان می‌دهد — اجازهٔ واقعیِ هر ابزار سرِ جای خودش سنجیده می‌شود.
   */
  async prefs(id: number) {
    const a = await this.prisma.account.findUnique({ where: { id }, select: { prefs: true } });
    return AuthService.normPrefs(a?.prefs);
  }

  async setPrefs(id: number, dto: { subformPins?: unknown; todayPins?: unknown }) {
    const cur = await this.prefs(id);
    const next = {
      ...cur,
      ...(dto.subformPins !== undefined ? { subformPins: AuthService.pins(dto.subformPins, 'فرمِ منتخب') } : {}),
      ...(dto.todayPins !== undefined ? { todayPins: AuthService.pins(dto.todayPins, 'ابزارکِ منتخب') } : {}),
    };
    await this.prisma.account.update({ where: { id }, data: { prefs: next } });
    return next;
  }

  private static readonly PIN_RE = /^[a-zA-Z][a-zA-Z0-9._-]{0,79}$/;

  /** سه خانه — کلیدِ سالم یا `null`؛ تکراری‌ها یک‌بار. */
  private static pins(v: unknown, label: string): (string | null)[] {
    if (!Array.isArray(v) || v.length > 3) throw new BadRequestException(`${label}: حداکثر سه خانه`);
    const out: (string | null)[] = [];
    for (const x of v) {
      if (x === null || x === '') { out.push(null); continue; }
      if (typeof x !== 'string' || !AuthService.PIN_RE.test(x)) throw new BadRequestException(`${label}: کلیدِ نامعتبر`);
      out.push(out.includes(x) ? null : x);
    }
    while (out.length < 3) out.push(null);
    return out;
  }

  private static normPrefs(raw: unknown) {
    const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const three = (v: unknown) => {
      const a = Array.isArray(v) ? v.slice(0, 3).map((x) => (typeof x === 'string' && AuthService.PIN_RE.test(x) ? x : null)) : [];
      while (a.length < 3) a.push(null);
      return a;
    };
    return { subformPins: three(o.subformPins), todayPins: three(o.todayPins) };
  }

  // ── بازیابیِ رمز با کدِ پیامکی (بازبینیِ UX، بندِ ۱۹) ─────────
  //
  // تا دیروز کارکنی که رمزش را فراموش می‌کرد هیچ راهی جز سوپرادمین نداشت و مالک هیچ راهی جز
  // پایگاه‌داده. همان کدِ ۶رقمیِ ثبت‌نام به موبایلِ **خودِ حساب** می‌رود.
  //
  // ⚠️ **شمارش‌ناپذیر:** پاسخِ درخواست برای حسابِ موجود و ناموجود یکی است (بی‌خطای «ثبت نشده»،
  // بی‌خطای «کمی صبر کنید» که فقط برای حسابِ موجود پیش می‌آمد)، ارسالِ پیامک منتظرِ درگاه نمی‌ماند
  // (زمانِ پاسخ نشان ندهد پیامکی رفته یا نه)، و همهٔ شکست‌های تأیید یک پیام دارند. سقفِ نرخ روی IP و
  // شناسه برای هر دو حالت یکسان می‌خورد.

  /** حسابی که بازیابی برایش مجاز است: فعال، تصاحب‌شده، نه موقت یا آزمایشی، با موبایلِ اصلی. */
  private async resetTarget(identifier: string) {
    const id = toEnDigits(identifier).trim();
    if (!id) return null;
    const account = await this.accountByIdentifier(id);
    /* تصاحب‌نشده راهِ خودش را دارد (ثبت‌نام + کد)؛ حسابِ موقت شماره‌اش هنوز تأیید نشده — کدِ بازیابی
       به شماره‌ای که مالکیتش ثابت نشده یعنی تحویلِ حساب به هر کسی که آن شماره دستش است. */
    if (!account || account.status !== 'active' || isUnclaimedAccount(account) || isProvisional(account) || isTestAccount(account)) return null;
    /* **سوپرادمین بازیابیِ فقط‌پیامکی ندارد** (بازبینیِ امنیتیِ بستهٔ P، PF1) — همان پاسخِ بی‌صدا.
       کدِ پیامکی فقط ثابت می‌کند «این سیم‌کارت دستِ من است»، و شمارهٔ `Person` را کسانی جز خودِ صاحبِ حساب
       هم نوشته‌اند: تا دیروز `definitions.manage` (سطح ۵) تلفنِ جراحِ متصل به بنیان‌گذارِ مطب را عوض می‌کرد.
       آن در بسته شد (`definitions.service.ts`، `refuseAccountIdentity`)، ولی مدلِ داده «شمارهٔ تأییدشده» را
       جدا از «شمارهٔ فعلی» نگه نمی‌دارد: `phoneVerifiedAt` زمانِ تأیید است نه خودِ شماره، و حساب‌های پیش از
       migrationِ `provisional_accounts` اصلاً مقدار ندارند. پس نمی‌شود ثابت کرد شمارهٔ امروزِ Person همانی است
       که صاحبِ حساب تأیید کرده بود. برای پرارزش‌ترین حساب — کسی که بقیه را می‌سازد و سطح می‌دهد — ریسکِ
       همین شکاف پذیرفته نیست؛ مدیرِ کل از راهِ پشتیبانی بازیابی می‌کند (صفحهٔ ورود همین را می‌گوید). بقیهٔ
       سطح‌ها بازیابی را دارند: بدترین حالتشان تصاحبِ حسابی است که سوپرادمین می‌تواند ببندد. */
    if (account.level >= LEVEL.SUPER_ADMIN) return null;
    const phone = account.person?.phoneScope === 'primary' ? account.person.phone : null;
    return phone ? { account, phone } : null;
  }

  async requestPasswordReset(identifier: string, ip = 'unknown') {
    const key = toEnDigits(identifier).trim().toLowerCase();
    this.rateLimit.hit(`pwreset:${this.tid}:ip:${ip}`, 10, 15 * 60_000);
    this.rateLimit.hit(`pwreset:${this.tid}:id:${key}`, 3, 15 * 60_000);
    const same = { ok: true, ttl: OTP_TTL_MS / 1000 };
    /* فقط محیطِ آزمون با پیامکِ ساختگی کد را برمی‌گرداند (همان قراردادِ ثبت‌نام، برای e2e) — آن‌جا منتظرِ کار می‌مانیم. */
    if (process.env.NODE_ENV === 'test') {
      const devCode = await this.issueResetCode(identifier);
      return devCode ? { ...same, devCode } : same;
    }
    /* هشدار — **پاسخ منتظرِ هیچ‌چیز نمی‌ماند** (بستهٔ PF، PF5). پیامک از قبل بی‌انتظار بود، ولی برای حسابِ
       موجود هنوز یک SELECT و یک INSERTِ اضافه پیش از پاسخ می‌رفت؛ همین چند میلی‌ثانیه، با تکرار، می‌گفت این
       شناسه حساب دارد. یافتنِ حساب، ساختنِ کد و پیامک همه پس از پاسخ‌اند (زمینهٔ شرکت با AsyncLocalStorage
       همراهِ کار می‌رود). */
    setImmediate(() => {
      /* فقط نامِ خطا: پیامِ خطای Prisma آرگومان‌ها (شماره) را هم چاپ می‌کند — قاعدهٔ لاگ (PF10). */
      this.issueResetCode(identifier).catch((e) => this.logger.warn(`password reset code could not be issued (${e?.name ?? 'Error'})`));
    });
    return same;
  }

  /**
   * کدِ بازیابی برای حسابی که `resetTarget` مجاز می‌داند. خروجی خودِ کد است فقط وقتی درگاه stub بود (محیطِ
   * آزمون)؛ وگرنه `null`. کدِ همین دقیقه هنوز معتبر است — بی‌صدا، نه «کمی صبر کنید» (آن پیام فقط برای حسابِ
   * موجود بود). پیامکِ نرفته کدش را پاک می‌کند تا کدِ بعدی پشتِ پنجرهٔ ارسالِ دوباره گیر نکند.
   */
  private async issueResetCode(identifier: string): Promise<string | null> {
    const target = await this.resetTarget(identifier);
    if (!target) return null;
    const recent = await this.prisma.otpCode.findFirst({
      where: { phone: target.phone, purpose: RESET_PURPOSE, createdAt: { gt: new Date(Date.now() - OTP_RESEND_MS) } },
    });
    if (recent) return null;
    /* سطلِ مشترکِ پیامکِ عمومی به این شماره (PS7) — بی‌صدا، مثلِ بقیهٔ این مسیر. */
    if (!takePublicSms(this.rateLimit, this.tid, target.phone)) return null;
    const code = String(randomInt(100000, 1000000));
    const otp = await this.prisma.otpCode.create({
      data: { phone: target.phone, codeHash: otpHash(RESET_PURPOSE, target.phone, code), purpose: RESET_PURPOSE, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });
    const res = await this.sms.sendOtp(target.phone, code, this.tenantContext.current()?.hostname, RESET_PURPOSE).catch((e) => {
      /* فقط نامِ خطا (بستهٔ PS، PS11؛ قاعدهٔ لاگِ PF10): پیامِ خطا ممکن است شماره یا متنِ پیامک را داشته باشد. */
      this.logger.warn(`password reset sms failed for account ${target.account.id} (${e?.name ?? 'Error'})`);
      return null;
    });
    if (!res || (!res.sent && !res.stub)) {
      await this.prisma.otpCode.deleteMany({ where: { id: otp.id, consumedAt: null } }).catch(() => undefined);
      return null;
    }
    return res.stub ? code : null;
  }

  async resetPassword(dto: { identifier: string; code: string; password: string }, meta: { ua?: string; ip?: string }) {
    const key = toEnDigits(dto.identifier).trim().toLowerCase();
    this.rateLimit.hit(`pwreset-verify:${this.tid}:ip:${meta.ip ?? 'unknown'}`, 20, 15 * 60_000);
    this.rateLimit.hit(`pwreset-verify:${this.tid}:id:${key}`, 8, 15 * 60_000);
    const target = await this.resetTarget(dto.identifier);
    if (!target) throw new BadRequestException(RESET_BAD);
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone: target.phone, purpose: RESET_PURPOSE, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.expiresAt < new Date()) throw new BadRequestException(RESET_BAD);
    /* **بودجهٔ حدس مالِ حساب است، نه متنِ تایپ‌شده** (بستهٔ PF، PF4): نامِ کاربری و موبایلِ یک حساب تا دیروز
       دو سطلِ جدا بودند (۸ + ۸ حدس)، و سقفِ روزانه هم نبود. سرریزِ این دو سطل همان خطای عام است نه ۴۲۹ —
       ۴۲۹ می‌گفت «این نامِ کاربری و این موبایل مالِ یک حساب‌اند».
       هشدار — و **فقط وقتی کدِ زنده‌ای هست** می‌سوزد (بستهٔ PS، PS4): پیش از یافتنِ کد، بیست حدس روی حسابی که
       اصلاً کدی نداشت صاحبش را بی‌آنکه پیامکی دیده باشد ۲۴ ساعت از بازیابی بیرون می‌کرد. کدِ زنده یعنی پیامکی
       که صاحبِ حساب دیده؛ بی‌کد، حدس چیزی را باز نمی‌کند و سطل‌های IP و شناسه (بالا) برای جلوی سیل بس‌اند. */
    try {
      this.rateLimit.hit(`pwreset-verify:${this.tid}:acct:${target.account.id}`, 8, 15 * 60_000);
      this.rateLimit.hit(`pwreset-verify:${this.tid}:acct-day:${target.account.id}`, 20, 24 * 3600_000);
    } catch {
      throw new BadRequestException(RESET_BAD);
    }
    /* هشدار — **شمارشِ تلاش پیش از مقایسه و اتمی** (PF4): سنجش و افزایش جدا بودند، پس حدس‌های هم‌زمان همه
       «۰ تلاش» را می‌خواندند و هر کدام مقایسه می‌شد — کدِ پنج‌تلاشی با ده درخواستِ هم‌زمان ده حدس می‌خورد.
       حالا هر حدس اول یک خانه از پنج خانه را می‌گیرد؛ خانه نماند ← همان خطای عام. */
    const slot = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } },
    });
    if (!slot.count) throw new BadRequestException(RESET_BAD);
    if (otpHash(RESET_PURPOSE, target.phone, toEnDigits(dto.code).trim()) !== otp.codeHash) throw new BadRequestException(RESET_BAD);
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const passkeysRemoved = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.otpCode.updateMany({
        where: { id: otp.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() },
      });
      if (!consumed.count) throw new BadRequestException(RESET_BAD);
      await tx.account.update({ where: { id: target.account.id }, data: { passwordHash } });
      /* مثلِ تغییرِ رمز: همهٔ نشست‌ها باطل — کسی که رمز را داشت (شاید همان که باعثِ بازیابی شد) بیرون می‌افتد. */
      await tx.session.updateMany({ where: { accountId: target.account.id, revokedAt: null }, data: { revokedAt: new Date() } });
      /* **پس‌کی‌ها هم** (بستهٔ PF، PF6): کسی که رمز را داشت می‌توانست اثر انگشتِ دستگاهِ خودش را ثبت کند؛ با
         ماندنش، بازیابیِ رمز او را بیرون نمی‌کرد — فردا با همان پس‌کی برمی‌گشت. صاحبِ حساب پس از ورود دوباره
         ثبتش می‌کند (صفحهٔ ورود همین را می‌گوید). */
      const passkeys = await tx.webauthnCredential.deleteMany({ where: { accountId: target.account.id } });
      await this.audit?.record({
        actorId: target.account.id, action: 'auth.password.reset', entityType: 'account', entityId: target.account.id,
        ip: meta.ip, userAgent: meta.ua?.slice(0, 255), after: { passkeysRemoved: passkeys.count },
      }, tx);
      return passkeys.count;
    });
    return { ok: true, sessionsRevoked: true, passkeysRemoved };
  }

  async changePassword(id: number, current: string, next: string) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new UnauthorizedException();
    const ok = await bcrypt.compare(current, account.passwordHash);
    if (!ok) throw new BadRequestException('رمزِ فعلی اشتباه است');
    const passwordHash = await bcrypt.hash(next, 12);
    /* هشدار — پس‌کی‌ها هم در همان تراکنش (بستهٔ PS، PS3؛ همان قاعدهٔ بازیابیِ PF6): کسی که رمز را دزدیده بود
       ممکن است اثر انگشتِ خودش را هم ثبت کرده باشد؛ بی‌این، عوض‌کردنِ رمز او را بیرون نمی‌کرد. */
    const passkeysRemoved = await this.prisma.$transaction(async (tx) => {
      await tx.account.update({ where: { id }, data: { passwordHash } });
      await tx.session.updateMany({ where: { accountId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      return (await tx.webauthnCredential.deleteMany({ where: { accountId: id } })).count;
    });
    return { ok: true, sessionsRevoked: true, passkeysRemoved };
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
      /* مهلتِ تأییدِ شماره گذشته ولی حساب باز است — فقط آخرین سوپرادمینِ فعال (PS2)؛ کلاینت هشدارِ جدا می‌دهد. */
      verificationOverdue: isVerificationOverdue(a),
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
