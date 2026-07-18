import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt } from 'crypto';
import type { Account } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { LoginDto } from './dto/login.dto';
import { VerifySignupDto } from './dto/verify-signup.dto';
import { LEVEL, levelName } from '../common/levels';

const SESSION_TTL_DAYS = 30;
const MAX_SESSIONS = 10;
const OTP_TTL_MS = 5 * 60_000;
const OTP_RESEND_MS = 60_000;
const OTP_MAX_ATTEMPTS = 5;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private sms: SmsService,
  ) {}

  async setupStatus() {
    const count = await this.prisma.account.count();
    return { needsSetup: count === 0 };
  }

  // ── ثبت‌نام: مرحلهٔ ۱ — ارسالِ کدِ یکبارمصرف ────────────────
  async requestSignupOtp(phone: string) {
    const exists = await this.prisma.account.findUnique({ where: { phone } });
    if (exists) throw new BadRequestException('این شماره قبلاً ثبت شده است');

    const recent = await this.prisma.otpCode.findFirst({
      where: { phone, purpose: 'signup', createdAt: { gt: new Date(Date.now() - OTP_RESEND_MS) } },
    });
    if (recent) throw new BadRequestException('کمی صبر کنید و دوباره تلاش کنید');

    const code = String(randomInt(100000, 1000000)); // ۶ رقمی
    await this.prisma.otpCode.create({
      data: { phone, codeHash: sha256(code), purpose: 'signup', expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });
    const res = await this.sms.send(phone, `عمل‌یار: کد تأیید شما ${code}`);
    // تا وقتی پنلِ پیامک وصل نشده، کد را برمی‌گردانیم تا تست ممکن باشد
    return { ok: true, ttl: OTP_TTL_MS / 1000, ...(res.stub ? { devCode: code } : {}) };
  }

  // ── ثبت‌نام: مرحلهٔ ۲ — تأییدِ کد و ساختِ حساب ──────────────
  async verifySignup(dto: VerifySignupDto, meta: { ua?: string; ip?: string }) {
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone: dto.phone, purpose: 'signup', consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('برای این شماره کدی صادر نشده است');
    if (otp.expiresAt < new Date()) throw new BadRequestException('کد منقضی شده؛ دوباره درخواست دهید');
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new BadRequestException('تعداد تلاش زیاد است؛ کد جدید بگیرید');

    if (sha256(dto.code) !== otp.codeHash) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException('کد تأیید اشتباه است');
    }
    await this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

    if (await this.prisma.account.findUnique({ where: { username: dto.username } })) {
      throw new BadRequestException('این نام کاربری قبلاً گرفته شده است');
    }
    if (await this.prisma.account.findUnique({ where: { phone: dto.phone } })) {
      throw new BadRequestException('این شماره قبلاً ثبت شده است');
    }

    // بوت‌استرپ: اگر هیچ سوپرادمینِ فعالی نیست، این حساب سوپرادمینِ فعال می‌شود
    const noSuperAdmin =
      (await this.prisma.account.count({ where: { level: LEVEL.SUPER_ADMIN, status: 'active' } })) === 0;

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const account = await this.prisma.account.create({
      data: {
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        username: dto.username.trim(),
        phone: dto.phone,
        passwordHash,
        selfie: dto.selfie,
        level: noSuperAdmin ? LEVEL.SUPER_ADMIN : LEVEL.VIEWER,
        status: noSuperAdmin ? 'active' : 'pending',
      },
    });

    if (noSuperAdmin) {
      return { pending: false, bootstrap: true, ...(await this.issue(account, meta)) };
    }
    return { pending: true, user: this.publicUser(account) };
  }

  // ── ورود ───────────────────────────────────────────────────
  async login(dto: LoginDto, meta: { ua?: string; ip?: string }) {
    const id = dto.identifier.trim();
    const account = await this.prisma.account.findFirst({
      where: { OR: [{ username: id }, { phone: id }] },
    });
    if (!account) throw new UnauthorizedException('نام کاربری یا رمز عبور اشتباه است');
    const ok = await bcrypt.compare(dto.password, account.passwordHash);
    if (!ok) throw new UnauthorizedException('نام کاربری یا رمز عبور اشتباه است');

    if (account.status === 'pending') throw new UnauthorizedException('حساب شما در انتظار تأیید مدیر است');
    if (account.status === 'rejected') throw new UnauthorizedException('درخواستِ عضویتِ شما رد شده است');
    if (account.status !== 'active') throw new UnauthorizedException('حساب شما غیرفعال است');

    return this.issue(account, meta);
  }

  private async issue(account: Account, meta: { ua?: string; ip?: string }) {
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
      { sub: account.id, sid: session.id, level: account.level },
      { expiresIn: `${SESSION_TTL_DAYS}d` },
    );
    return { accessToken, user: this.publicUser(account) };
  }

  async validateSession(sid: string, sub: number) {
    const session = await this.prisma.session.findUnique({
      where: { id: sid },
      include: { account: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
    if (session.accountId !== sub || session.account.status !== 'active') return null;
    return session.account;
  }

  async logout(sid: string) {
    await this.prisma.session.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  publicUser(a: Account) {
    const displayName =
      [a.firstName, a.lastName].filter(Boolean).join(' ').trim() || a.username || a.phone || 'کاربر';
    return {
      id: a.id,
      firstName: a.firstName,
      lastName: a.lastName,
      displayName,
      username: a.username,
      phone: a.phone,
      level: a.level,
      levelName: levelName(a.level),
      status: a.status,
      selfie: a.selfie ?? null,
    };
  }
}
