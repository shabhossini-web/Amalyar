import { HospitalDirectoryModule } from '../catalog/hospital-directory.module';
import { clientIp } from '../common/client-ip';
import { HospitalDirectoryService } from '../catalog/hospital-directory.service';
import { TenantMigratorService } from '../tenant/tenant-migrator.service';
import {
  BadRequestException,
  Body,
  CanActivate,
  ConflictException,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, MaxLength, Min } from 'class-validator';
import { SECTORS, SECTOR_LABELS } from '../patients/service-codes.service';
import { RateLimitService } from '../common/rate-limit.service';
import { sanitizeWebOtpHost } from '../common/webotp';
import { SmsService } from '../sms/sms.service';
import { ControlPrismaService } from '../tenant/control-prisma.service';
import {
  normalizePlatformPhone,
  platformAdminConfig,
  platformOtpScopeHash,
  platformPhoneRef,
  resolvePlatformPhoneRef,
} from './platform.config';

const OTP_TTL_MS = 5 * 60_000;
const OTP_RESEND_MS = 60_000;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 30 * 60_000;
const SESSION_COOKIE = 'amalyar_platform_session';
const CSRF_COOKIE = 'amalyar_platform_csrf';

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie ?? '';
  for (const item of raw.split(';')) {
    const [key, ...rest] = item.trim().split('=');
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join('='));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * نشانیِ بازدیدکننده برای سطل‌های سقفِ نرخ و ممیزیِ پنل — **همان `clientIp`** (بستهٔ PS، PS10): تهِ
 * `X-Forwarded-For` که Traefik می‌افزاید، نه خانهٔ اول که خودِ فرستنده می‌نویسد و با هر درخواست سطلِ تازه می‌گرفت.
 */
function requestIp(req: Request): string {
  return clientIp(req);
}

/** Hostِ همین درخواستِ پنل — تا نشانیِ خودِ پنل هرگز به شرکتی داده نشود. */
function requestHost(req: Request): string | null {
  const host = String(req.headers.host ?? '').split(':')[0].trim().toLowerCase();
  return host || null;
}

function equalText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieSecure() {
  return process.env.NODE_ENV === 'production';
}

class PlatformPhoneDto {
  // phone موقتاً برای سازگاری rollout نسخه قبلی نگه داشته شده و UI جدید آن را ارسال نمی‌کند.
  @IsOptional()
  @IsString()
  @Length(10, 16)
  phone?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  phoneRef?: string;
}

class PlatformVerifyDto extends PlatformPhoneDto {
  @IsString()
  @Matches(/^[0-9]{6}$/)
  code!: string;
}

class CreateProvisioningJobDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/)
  slug!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsString()
  @Matches(/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)
  hostname!: string;
}

class DeleteTenantDto {
  @IsString()
  @Matches(/^[0-9]{6}$/)
  code!: string;

  @IsString()
  @Length(3, 40)
  confirmSlug!: string;
}

/** همان قالبِ دامنه‌ای که ساختِ شرکت می‌پذیرد — یک قاعده برای ساخت و تغییرِ نشانی. */
const HOSTNAME_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * نشانیِ واردشده در پنل → دامنهٔ خام. مدیر ممکن است نشانی را از نوارِ مرورگر کپی کند
 * (`https://…/`، حروفِ بزرگ، نقطهٔ آخر)؛ همه این‌جا یکی می‌شوند، نه در هر مصرف‌کننده.
 */
export function normalizeTenantHostname(raw: string): string {
  const host = String(raw ?? '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (!HOSTNAME_RE.test(host)) {
    throw new BadRequestException('نشانی معتبر نیست — فقط حروفِ انگلیسی، عدد، خط‌تیره و نقطه؛ مثلِ name.amalyar.com');
  }
  return host;
}

/**
 * نشانی‌هایی که مالِ خودِ پلتفرم‌اند و هرگز به شرکتی نمی‌رسند.
 *
 * ⚠️ `TenantMiddleware` هر Hostی را که در `tenant_domains` باشد به همان شرکت می‌برد. اگر
 * `api.amalyar.com` یا نشانیِ همین پنل روزی دامنهٔ یک شرکت ثبت شود، درخواست‌های آن نشانی
 * دیتابیسِ آن شرکت را می‌گیرند. پس ریشهٔ دامنه، برچسب‌های زیرساختی (`api`، `admin`،
 * `www`، …، و نسخه‌های `api-staging` و مانندش) و نشانیِ خودِ پنل رد می‌شوند.
 */
const RESERVED_LABELS = new Set(['www', 'api', 'admin', 'panel', 'platform', 'app', 'mail', 'status']);
export function reservedTenantHostname(hostname: string, platformHost?: string | null): boolean {
  let adminHost = '';
  try { adminHost = platformAdminConfig().webOtpHost; } catch { /* پیکربندیِ ناقص خودش جای دیگر خطا می‌دهد */ }
  const own = [platformHost, adminHost]
    .map((h) => String(h ?? '').trim().toLowerCase().replace(/:\d+$/, ''))
    .filter(Boolean);
  if (own.includes(hostname)) return true;
  const apexes = new Set(['amalyar.com', ...own.map((h) => h.split('.').slice(-2).join('.'))]);
  if (apexes.has(hostname)) return true;
  const [label, ...rest] = hostname.split('.');
  if (!apexes.has(rest.join('.'))) return false;
  const base = label.replace(/-(staging|stage|dev|test)$/, '');
  return RESERVED_LABELS.has(base);
}

/**
 * زیردامنهٔ یک‌سطحی زیرِ این دامنه بی هیچ کارِ دستی سرو می‌شود: گواهیِ wildcard (DNS-01 آروان) و
 * routerِ wildcardِ Traefik در `/data/coolify/proxy/dynamic/wildcard.yaml` (`docs/CLAUDE_HANDOFF.md`،
 * ۲۰۲۶-۰۷-۲۶). گواهیِ `*.amalyar.com` فقط **یک** سطح را می‌پوشاند؛ `a.b.amalyar.com` و دامنهٔ
 * خودِ مشتری (مثلاً `clinic.ir`) رکوردِ DNS و افزودنِ دستی در Coolify می‌خواهند.
 */
const WILDCARD_APEX = 'amalyar.com';
export const servedAutomatically = (hostname: string) =>
  hostname.endsWith(`.${WILDCARD_APEX}`) && hostname.split('.').length === WILDCARD_APEX.split('.').length + 1;

class TenantDomainDto {
  @IsString()
  @Length(4, 260, { message: 'نشانی را کامل بنویسید' })
  hostname!: string;

  /// پیش‌فرض: نشانیِ تازه همان لحظه اصلی می‌شود — «تغییرِ نشانی» یعنی همین.
  @IsOptional()
  @IsBoolean()
  primary?: boolean;
}

class CentralTariffDto {
  @IsString()
  @Matches(/^\d{4}$/, { message: 'سال باید چهار رقمِ شمسی باشد' })
  year!: string;

  @IsIn(SECTORS as unknown as string[], { message: 'بخشِ تعرفه نامعتبر است' })
  sector!: string;

  @IsInt({ message: 'ضریبِ حرفه‌ای باید عددِ صحیح باشد' })
  @Min(0)
  professional!: number;

  @IsInt({ message: 'ضریبِ فنی باید عددِ صحیح باشد' })
  @Min(0)
  technical!: number;

  @IsInt({ message: 'ضریبِ بیهوشی باید عددِ صحیح باشد' })
  @Min(0)
  anesthesia!: number;
}

class CentralAiDto {
  @IsIn(['avalai', 'gapgpt', 'custom'], { message: 'ارائه‌دهنده نامعتبر است' })
  provider!: string;

  @IsString() @MaxLength(200)
  baseUrl!: string;

  @IsString() @MaxLength(300)
  apiKey!: string;

  @IsString() @MaxLength(80) modelChat!: string;
  @IsOptional() @IsString() @MaxLength(80) modelVision?: string;
  @IsOptional() @IsString() @MaxLength(80) modelStt?: string;
  @IsOptional() @IsString() @MaxLength(80) modelTts?: string;
  @IsOptional() @IsString() @MaxLength(80) modelImage?: string;

  @IsBoolean()
  enabled!: boolean;
}

/** دامنهٔ کدِ حذف به شناسهٔ همان شرکت گره می‌خورد. */
const deletionScope = (tenantId: string) => `tenant-delete:${tenantId}`;

/**
 * کارهای **باز** (هر وضعیتی جز `succeeded`: در صف، در حال اجرا، ناموفق) همیشه در
 * `snapshot` می‌آیند — هر قدر هم قدیمی — و از تمام‌شده‌ها فقط تازه‌ترین‌ها.
 *
 * ⚠️ تا ۱۴۰۵/۰۷/۰۴ این یک `take: 30`ِ ساده به ترتیبِ ساخت بود و پنل همهٔ آن سی‌تا را
 * زیرِ «صف عملیات» نشان می‌داد؛ مالک پرسید چرا شرکتی که در «شرکت‌های فعال» است هنوز
 * در صف است. پنل حالا تمام‌شده‌ها را جدا و تاشو نشان می‌دهد و می‌گوید «کاری در صف
 * نیست» — پس کارِ باز نباید فقط چون سی کارِ تازه‌تر آمده از پاسخ بیفتد، وگرنه یک ساختِ
 * ناموفقِ قدیمی بی‌صدا ناپدید می‌شد و پنل دروغ می‌گفت. این سقف فقط ترمزِ اضطراری است.
 */
const OPEN_JOBS_CAP = 200;

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly control: ControlPrismaService,
    private readonly sms: SmsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private config() {
    const config = platformAdminConfig();
    if (!config.enabled) throw new NotFoundException();
    return config;
  }

  private hash(purpose: string, value: string): string {
    return createHmac('sha256', this.config().secret).update(`${purpose}:${value}`).digest('hex');
  }

  ipHash(ip: string): string {
    return this.hash('ip', ip);
  }

  phoneOptions() {
    const config = this.config();
    const multiple = config.phones.size > 1;
    return {
      options: Array.from(config.phones).map((phone, index) => ({
        ref: platformPhoneRef(config.secret, phone),
        label: multiple ? `مدیر مجاز ${index + 1}` : 'مدیر مجاز',
      })),
    };
  }

  private resolvePhone(
    config: ReturnType<typeof platformAdminConfig>,
    phoneInput?: string,
    phoneRef?: string,
  ): string | null {
    if (phoneRef) return resolvePlatformPhoneRef(config, phoneRef);
    const phone = normalizePlatformPhone(phoneInput ?? '');
    return phone && config.phones.has(phone) ? phone : null;
  }

  /** یک خانه از پنج خانهٔ تلاشِ یک کد — اتمی؛ خانه نماند ← همان خطای عام (PS10). */
  private async takeAttempt(id: string) {
    const slot = await this.control.platformOtp.updateMany({
      where: { id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (!slot.count) throw new UnauthorizedException('کد تأیید نامعتبر یا منقضی است');
  }

  /** دامنهٔ کدِ یکبارمصرف — پیاده‌سازیِ خالص در platform.config است. */
  private scopeHash(phone: string, scope: string): string {
    return platformOtpScopeHash(this.config().secret, phone, scope);
  }

  /** ارسالِ کدِ تأییدِ عملیاتِ حساس (مثلِ حذفِ شرکت) به همان مدیرِ واردشده. */
  async requestActionOtp(
    session: { phoneHash: string },
    scope: string,
    ip: string,
    requestHost?: string | null,
  ) {
    const config = this.config();
    const phone = Array.from(config.phones).find(
      (candidate) => this.scopeHash(candidate, 'login') === session.phoneHash,
    );
    const ipHash = this.ipHash(ip);
    this.rateLimit.hit(`platform:action-otp:ip:${ipHash}`, 10, 15 * 60_000);
    const response = { ok: true, ttl: OTP_TTL_MS / 1000 };
    if (!phone) return response;

    const scopedHash = this.scopeHash(phone, scope);
    this.rateLimit.hit(`platform:action-otp:${scopedHash}`, 5, 15 * 60_000);

    const recent = await this.control.platformOtp.findFirst({
      where: { phoneHash: scopedHash, consumedAt: null, createdAt: { gt: new Date(Date.now() - OTP_RESEND_MS) } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) return response;

    const code = String(randomInt(100000, 1000000));
    const otp = await this.control.platformOtp.create({
      data: {
        phoneHash: scopedHash,
        codeHash: this.hash('otp', `${scopedHash}:${code}`),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    try {
      const otpHost = sanitizeWebOtpHost(requestHost) ?? config.webOtpHost;
      const sent = await this.sms.sendOtp(phone, code, otpHost);
      if (!sent.sent && process.env.NODE_ENV === 'production') throw new Error('SMS delivery failed');
      await this.control.platformAuditEvent.create({
        data: { actorHash: session.phoneHash, action: 'platform.action.otp_requested', ipHash, metadata: { scope } },
      });
      return response;
    } catch (error) {
      await this.control.platformOtp.deleteMany({ where: { id: otp.id, consumedAt: null } }).catch(() => undefined);
      throw error;
    }
  }

  /** مصرفِ یکبارهٔ کدِ عملیات؛ کد پس از موفقیت باطل می‌شود (ضدِّ تکرار). */
  async consumeActionOtp(session: { phoneHash: string }, scope: string, code: string, ip: string) {
    const config = this.config();
    const phone = Array.from(config.phones).find(
      (candidate) => this.scopeHash(candidate, 'login') === session.phoneHash,
    );
    if (!phone) throw new UnauthorizedException('کد تأیید نامعتبر است');

    const scopedHash = this.scopeHash(phone, scope);
    this.rateLimit.hit(`platform:action-verify:${scopedHash}`, 8, 15 * 60_000);
    this.rateLimit.hit(`platform:action-verify:ip:${this.ipHash(ip)}`, 20, 15 * 60_000);

    const otp = await this.control.platformOtp.findFirst({
      where: { phoneHash: scopedHash, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.expiresAt <= new Date() || otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException('کد تأیید نامعتبر یا منقضی است');
    }
    /* هشدار — شمارشِ تلاش **پیش از** مقایسه و اتمی (بستهٔ PS، PS10؛ الگوی PF4): سنجش و افزایش جدا بودند، پس
       حدس‌های هم‌زمان همه «۴ تلاش» را می‌خواندند و هر کدام مقایسه می‌شد. */
    await this.takeAttempt(otp.id);
    if (!equalText(this.hash('otp', `${scopedHash}:${code}`), otp.codeHash)) {
      throw new UnauthorizedException('کد تأیید نامعتبر یا منقضی است');
    }
    const consumed = await this.control.platformOtp.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new UnauthorizedException('کد تأیید قبلاً استفاده شده است');
  }

  async requestOtp(
    phoneInput: string | undefined,
    phoneRef: string | undefined,
    ip: string,
    requestHost?: string | null,
  ) {
    const config = this.config();
    const phone = this.resolvePhone(config, phoneInput, phoneRef);
    const phoneHash = this.hash('phone', phone ?? phoneRef ?? phoneInput?.trim() ?? 'missing');
    const ipHash = this.ipHash(ip);
    this.rateLimit.hit(`platform:otp:ip:${ipHash}`, 10, 15 * 60_000);
    this.rateLimit.hit(`platform:otp:phone:${phoneHash}`, 3, 15 * 60_000);

    const response = { ok: true, ttl: OTP_TTL_MS / 1000 };
    if (!phone) return response;

    const recent = await this.control.platformOtp.findFirst({
      where: { phoneHash, consumedAt: null, createdAt: { gt: new Date(Date.now() - OTP_RESEND_MS) } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) return response;

    const code = String(randomInt(100000, 1000000));
    const otp = await this.control.platformOtp.create({
      data: {
        phoneHash,
        codeHash: this.hash('otp', `${phoneHash}:${code}`),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    try {
      // میزبانِ واقعیِ همین درخواست مقدم است — تنها چیزی که مرورگر برای اتوفیل
      // می‌پذیرد. env فقط fallbackِ استقرارهای پشتِ پراکسیِ غیرشفاف است.
      const otpHost = sanitizeWebOtpHost(requestHost) ?? config.webOtpHost;
      const sent = await this.sms.sendOtp(phone, code, otpHost);
      if (!sent.sent && process.env.NODE_ENV === 'production') throw new Error('SMS delivery failed');
      await this.control.platformAuditEvent.create({
        data: { actorHash: phoneHash, action: 'platform.auth.otp_requested', ipHash },
      });
      return response;
    } catch (error) {
      await this.control.platformOtp.deleteMany({ where: { id: otp.id, consumedAt: null } }).catch(() => undefined);
      throw error;
    }
  }

  async verifyOtp(
    phoneInput: string | undefined,
    phoneRef: string | undefined,
    code: string,
    ip: string,
  ) {
    const config = this.config();
    const phone = this.resolvePhone(config, phoneInput, phoneRef);
    if (!phone) throw new UnauthorizedException('کد تأیید نامعتبر است');

    const phoneHash = this.hash('phone', phone);
    const ipHash = this.ipHash(ip);
    this.rateLimit.hit(`platform:verify:ip:${ipHash}`, 20, 15 * 60_000);
    this.rateLimit.hit(`platform:verify:phone:${phoneHash}`, 8, 15 * 60_000);

    const otp = await this.control.platformOtp.findFirst({
      where: { phoneHash, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.expiresAt <= new Date() || otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException('کد تأیید نامعتبر یا منقضی است');
    }

    /* شمارشِ تلاش پیش از مقایسه و اتمی (PS10) — همان `consumeActionOtp`. */
    await this.takeAttempt(otp.id);
    const actual = this.hash('otp', `${phoneHash}:${code}`);
    if (!equalText(actual, otp.codeHash)) {
      throw new UnauthorizedException('کد تأیید نامعتبر یا منقضی است');
    }

    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    const session = await this.control.$transaction(async (tx) => {
      const consumed = await tx.platformOtp.updateMany({
        where: { id: otp.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) throw new UnauthorizedException('کد تأیید قبلاً استفاده شده است');

      await tx.platformSession.updateMany({
        where: { phoneHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const created = await tx.platformSession.create({
        data: {
          tokenHash: this.hash('session', token),
          phoneHash,
          csrfHash: this.hash('csrf', csrf),
          expiresAt,
        },
      });
      await tx.platformAuditEvent.create({
        data: {
          actorHash: phoneHash,
          action: 'platform.auth.login',
          targetType: 'platform_session',
          targetId: created.id,
          ipHash,
        },
      });
      return created;
    });

    return { token, csrf, session, expiresIn: SESSION_TTL_MS / 1000 };
  }

  async authenticate(token: string | null) {
    this.config();
    if (!token) throw new UnauthorizedException();
    const session = await this.control.platformSession.findUnique({
      where: { tokenHash: this.hash('session', token) },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException();
    }
    return session;
  }

  verifyCsrf(session: { csrfHash: string }, csrfCookie: string | null, csrfHeader: string | null) {
    if (!csrfCookie || !csrfHeader || !equalText(csrfCookie, csrfHeader)) {
      throw new UnauthorizedException('درخواست امنیتی نامعتبر است');
    }
    if (!equalText(this.hash('csrf', csrfCookie), session.csrfHash)) {
      throw new UnauthorizedException('درخواست امنیتی نامعتبر است');
    }
  }

  async revoke(sessionId: string, ip: string) {
    const session = await this.control.platformSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    await this.control.platformAuditEvent.create({
      data: {
        actorHash: session.phoneHash,
        action: 'platform.auth.logout',
        targetType: 'platform_session',
        targetId: session.id,
        ipHash: this.ipHash(ip),
      },
    });
  }
}

@Injectable()
export class PlatformSessionGuard implements CanActivate {
  constructor(private readonly auth: PlatformAuthService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const session = await this.auth.authenticate(readCookie(req, SESSION_COOKIE));
    (req as any).platformSession = session;
    return true;
  }
}

@Injectable()
export class PlatformCsrfGuard implements CanActivate {
  constructor(private readonly auth: PlatformAuthService) {}

  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const session = (req as any).platformSession;
    if (!session) throw new UnauthorizedException();
    const header = req.headers['x-csrf-token'];
    const csrfHeader = Array.isArray(header) ? header[0] : header ?? null;
    this.auth.verifyCsrf(session, readCookie(req, CSRF_COOKIE), csrfHeader);
    return true;
  }
}

@Injectable()
export class PlatformProvisioningService {
  constructor(private readonly control: ControlPrismaService) {}

  private jobSelect = {
    id: true,
    slug: true,
    name: true,
    hostname: true,
    status: true,
    tenantId: true,
    errorCode: true,
    attempts: true,
    createdAt: true,
    updatedAt: true,
    startedAt: true,
    finishedAt: true,
  } as const;

  async snapshot() {
    const [tenants, openJobs, doneJobs] = await Promise.all([
      this.control.tenant.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          createdAt: true,
          /**
           * **همهٔ** دامنه‌ها، نه فقط primary.
           *
           * ⚠️ تا دیروز این `where: { primary: true }, take: 1` بود و نتیجه‌اش
           * یک نقطهٔ کورِ خطرناک بود: اگر دو دامنه به یک شرکت نگاشت شده باشند
           * — یعنی دو نشانی که کاربر «دو شرکتِ جدا» می‌پنداردشان روی یک
           * دیتابیس — دامنهٔ دوم در پنل اصلاً دیده نمی‌شد. گزارشِ «تنانت‌ها
           * از دیتابیسِ هم می‌خوانند» از بیرون دقیقاً همین شکلی است، و تنها
           * راهِ پاسخ‌دادنش باز کردنِ psql روی دیتابیسِ کنترل بود.
           *
           * عکسش شدنی نیست: `TenantDomain.hostname` یکتاست، پس یک دامنه
           * هرگز به دو شرکت نمی‌رود.
           */
          domains: {
            orderBy: [{ primary: 'desc' }, { hostname: 'asc' }],
            select: { hostname: true, primary: true },
          },
        },
      }),
      this.control.provisioningJob.findMany({
        where: { status: { not: 'succeeded' } },
        orderBy: { createdAt: 'desc' },
        take: OPEN_JOBS_CAP,
        select: this.jobSelect,
      }),
      this.control.provisioningJob.findMany({
        where: { status: 'succeeded' },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: this.jobSelect,
      }),
    ]);
    return {
      tenants: tenants.map((tenant) => ({
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        hostname: tenant.domains.find((d) => d.primary)?.hostname ?? tenant.domains[0]?.hostname ?? null,
        /* آرایهٔ کامل — کلاینت نباید دوباره چیزی را استنتاج کند (قانون ۱۵). */
        domains: tenant.domains.map((d) => ({ hostname: d.hostname, primary: d.primary })),
        /* «این شرکت از بیش از یک نشانی سرو می‌شود» — پرچمِ مشتق، سمتِ سرور. */
        shared: tenant.domains.length > 1,
        createdAt: tenant.createdAt,
      })),
      jobs: [...openJobs, ...doneJobs],
      deletions: await this.deletionJobs(),
    };
  }

  async job(id: string) {
    const job = await this.control.provisioningJob.findUnique({ where: { id }, select: this.jobSelect });
    if (!job) throw new NotFoundException();
    return job;
  }

  async create(dto: CreateProvisioningJobDto, actorHash: string, ipHash: string, platformHost: string | null = null) {
    const slug = dto.slug.trim().toLowerCase();
    const name = dto.name.trim();
    const hostname = dto.hostname.trim().toLowerCase();
    /* همان نگهبانِ تغییرِ نشانی: شرکتِ تازه هم نشانیِ خودِ پلتفرم را نمی‌گیرد. */
    if (reservedTenantHostname(hostname, platformHost)) {
      throw new BadRequestException('این نشانی مالِ خودِ پلتفرم است و به شرکتی داده نمی‌شود');
    }

    const tenant = await this.control.tenant.findFirst({
      where: { OR: [{ slug }, { domains: { some: { hostname } } }] },
      select: { id: true },
    });
    if (tenant) throw new ConflictException('شرکت یا دامنه قبلاً ثبت شده است');

    const existing = await this.control.provisioningJob.findFirst({
      where: { OR: [{ slug }, { hostname }] },
      select: { id: true, status: true },
    });
    if (existing) {
      throw new ConflictException(
        existing.status === 'failed'
          ? 'درخواست قبلی ناموفق است؛ از دکمه تلاش مجدد استفاده کنید'
          : 'برای این شرکت یا دامنه قبلاً درخواست ساخته شده است',
      );
    }

    const job = await this.control.provisioningJob.create({
      data: { slug, name, hostname, requestedByHash: actorHash },
      select: this.jobSelect,
    });
    await this.control.platformAuditEvent.create({
      data: {
        actorHash,
        action: 'platform.provisioning.queued',
        targetType: 'provisioning_job',
        targetId: job.id,
        ipHash,
        metadata: { slug, hostname },
      },
    });
    return job;
  }

  private deletionSelect = {
    id: true,
    tenantId: true,
    slug: true,
    name: true,
    hostname: true,
    status: true,
    errorCode: true,
    attempts: true,
    createdAt: true,
    updatedAt: true,
    finishedAt: true,
  } as const;

  /**
   * ثبتِ درخواستِ حذف. اینجا هیچ دیتابیسی حذف نمی‌شود — فقط شرکت به وضعیتِ
   * `deleting` می‌رود (پس بلافاصله برای هیچ دامنه‌ای resolve نمی‌شود) و کار به
   * صفِ Worker می‌رود. تأییدِ نامِ شناسه، دومین لایهٔ محافظت در برابرِ خطای انسانی است.
   */
  /**
   * اعتبارسنجیِ حذف بدونِ هیچ تغییری. جدا نگه داشته شده تا کدِ یکبارمصرف پیش از
   * تأییدِ شناسه مصرف نشود؛ وگرنه یک تایپِ اشتباه کدِ کاربر را می‌سوزاند.
   */
  async assertDeletable(tenantId: string, confirmSlug: string) {
    const tenant = await this.control.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, name: true, status: true, domains: { where: { primary: true }, take: 1, select: { hostname: true } } },
    });
    if (!tenant) throw new NotFoundException('شرکت یافت نشد');
    if (confirmSlug.trim().toLowerCase() !== tenant.slug) {
      throw new ConflictException('شناسهٔ تأیید با شناسهٔ شرکت یکی نیست');
    }
    const open = await this.control.tenantDeletionJob.findFirst({
      where: { tenantId, status: { in: ['queued', 'running'] } },
      select: { id: true },
    });
    if (open) throw new ConflictException('درخواستِ حذفِ این شرکت از قبل در صف است');
    return tenant;
  }

  async requestDeletion(tenantId: string, confirmSlug: string, actorHash: string, ipHash: string) {
    const tenant = await this.assertDeletable(tenantId, confirmSlug);

    const job = await this.control.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id: tenantId }, data: { status: 'deleting' } });
      const created = await tx.tenantDeletionJob.create({
        data: {
          tenantId,
          slug: tenant.slug,
          name: tenant.name,
          hostname: tenant.domains[0]?.hostname ?? null,
          requestedByHash: actorHash,
        },
        select: this.deletionSelect,
      });
      await tx.platformAuditEvent.create({
        data: {
          actorHash,
          action: 'platform.tenant.deletion_requested',
          targetType: 'tenant',
          targetId: tenantId,
          ipHash,
          metadata: { slug: tenant.slug, jobId: created.id },
        },
      });
      return created;
    });
    return job;
  }

  /** همان قاعدهٔ `snapshot()`: حذفِ باز یا ناموفق هرگز از پاسخ نمی‌افتد. */
  async deletionJobs() {
    const [open, done] = await Promise.all([
      this.control.tenantDeletionJob.findMany({
        where: { status: { not: 'succeeded' } },
        orderBy: { createdAt: 'desc' },
        take: OPEN_JOBS_CAP,
        select: this.deletionSelect,
      }),
      this.control.tenantDeletionJob.findMany({
        where: { status: 'succeeded' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: this.deletionSelect,
      }),
    ]);
    return [...open, ...done];
  }

  /**
   * تغییرِ نشانیِ سایتِ یک شرکت (۱۴۰۵/۰۷/۰۴ — درخواستِ مشتری).
   *
   * «تغییر» یعنی **افزودن + اصلی‌کردن**، نه جایگزینی: نشانیِ قبلی هم به همان شرکت
   * می‌رسد تا لینک‌هایی که برای بیماران پیامک شده (ثبت‌نام، پیگیری، پرونده) نشکنند.
   * `resolveHostname` هر دامنه‌ای در `tenant_domains` را به شرکتش می‌برد؛ `primary` فقط
   * نشانیِ نمایشیِ پنل است. دیتابیس، شناسهٔ شرکت (`slug`) و داده دست نمی‌خورند.
   */
  async addDomain(tenantId: string, raw: string, makePrimary: boolean, platformHost: string | null, actorHash: string, ipHash: string) {
    const hostname = normalizeTenantHostname(raw);
    if (reservedTenantHostname(hostname, platformHost)) {
      throw new BadRequestException('این نشانی مالِ خودِ پلتفرم است و به شرکتی داده نمی‌شود');
    }
    const tenant = await this.activeTenant(tenantId);
    const mine = tenant.domains.find((d) => d.hostname === hostname);
    if (mine) {
      if (mine.primary) throw new ConflictException('این نشانی همین حالا نشانیِ اصلیِ همین شرکت است');
      if (!makePrimary) throw new ConflictException('این نشانی از قبل مالِ همین شرکت است');
      return this.setPrimaryDomain(tenantId, hostname, actorHash, ipHash);
    }
    const taken = await this.control.tenantDomain.findUnique({ where: { hostname }, select: { tenantId: true } });
    if (taken) throw new ConflictException('این نشانی مالِ شرکتِ دیگری است');
    const queued = await this.control.provisioningJob.findFirst({
      where: { hostname, status: { in: ['queued', 'running'] } },
      select: { id: true },
    });
    if (queued) throw new ConflictException('این نشانی برای ساختِ شرکتِ دیگری در صف است');

    const previous = tenant.domains.find((d) => d.primary)?.hostname ?? null;
    await this.control.$transaction(async (tx) => {
      if (makePrimary) await tx.tenantDomain.updateMany({ where: { tenantId, primary: true }, data: { primary: false } });
      await tx.tenantDomain.create({ data: { tenantId, hostname, primary: makePrimary } });
      await tx.platformAuditEvent.create({
        data: {
          actorHash, action: 'platform.tenant.domain_added', targetType: 'tenant', targetId: tenantId, ipHash,
          metadata: { hostname, primary: makePrimary, previous },
        },
      });
    });
    /* کلاینت نباید حدس بزند نشانی همین حالا باز می‌شود یا کارِ DNS/Coolify می‌خواهد (قانونِ ۱۵). */
    return { ...(await this.tenantDomains(tenantId)), added: { hostname, automatic: servedAutomatically(hostname) } };
  }

  /** نشانیِ موجودِ همین شرکت اصلی می‌شود — برگشت به نشانیِ قبلی هم همین است. */
  async setPrimaryDomain(tenantId: string, raw: string, actorHash: string, ipHash: string) {
    const hostname = normalizeTenantHostname(raw);
    const tenant = await this.activeTenant(tenantId);
    const mine = tenant.domains.find((d) => d.hostname === hostname);
    if (!mine) throw new NotFoundException('این نشانی مالِ این شرکت نیست');
    if (!mine.primary) {
      const previous = tenant.domains.find((d) => d.primary)?.hostname ?? null;
      await this.control.$transaction(async (tx) => {
        await tx.tenantDomain.updateMany({ where: { tenantId, primary: true }, data: { primary: false } });
        await tx.tenantDomain.update({ where: { hostname }, data: { primary: true } });
        await tx.platformAuditEvent.create({
          data: {
            actorHash, action: 'platform.tenant.domain_primary', targetType: 'tenant', targetId: tenantId, ipHash,
            metadata: { hostname, previous },
          },
        });
      });
    }
    return this.tenantDomains(tenantId);
  }

  /**
   * حذفِ یک نشانیِ فرعی. نشانیِ اصلی حذف نمی‌شود — شرکت نباید بی‌نشانی بماند، و
   * «نشانیِ اصلیِ تازه» باید آگاهانه انتخاب شود نه خودکار.
   */
  async removeDomain(tenantId: string, raw: string, actorHash: string, ipHash: string) {
    const hostname = normalizeTenantHostname(raw);
    const tenant = await this.activeTenant(tenantId);
    const mine = tenant.domains.find((d) => d.hostname === hostname);
    if (!mine) throw new NotFoundException('این نشانی مالِ این شرکت نیست');
    if (mine.primary || tenant.domains.length < 2) {
      throw new ConflictException('نشانیِ اصلی حذف نمی‌شود — اول نشانیِ دیگری را اصلی کنید');
    }
    await this.control.$transaction(async (tx) => {
      await tx.tenantDomain.delete({ where: { hostname } });
      await tx.platformAuditEvent.create({
        data: {
          actorHash, action: 'platform.tenant.domain_removed', targetType: 'tenant', targetId: tenantId, ipHash,
          metadata: { hostname },
        },
      });
    });
    return this.tenantDomains(tenantId);
  }

  private async activeTenant(tenantId: string) {
    const tenant = await this.control.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true, domains: { select: { hostname: true, primary: true } } },
    });
    if (!tenant) throw new NotFoundException('شرکت یافت نشد');
    if (tenant.status !== 'active') throw new ConflictException('نشانیِ شرکتی که فعال نیست عوض نمی‌شود');
    return tenant;
  }

  /** دامنه‌ها به همان شکلِ `snapshot` — کلاینت کارتِ همان شرکت را بی‌بارگذاریِ دوباره تازه می‌کند. */
  private async tenantDomains(tenantId: string) {
    const domains = await this.control.tenantDomain.findMany({
      where: { tenantId },
      orderBy: [{ primary: 'desc' }, { hostname: 'asc' }],
      select: { hostname: true, primary: true },
    });
    return {
      id: tenantId,
      hostname: domains.find((d) => d.primary)?.hostname ?? domains[0]?.hostname ?? null,
      domains,
      shared: domains.length > 1,
    };
  }

  async retry(id: string, actorHash: string, ipHash: string) {
    const changed = await this.control.provisioningJob.updateMany({
      where: { id, status: 'failed' },
      data: {
        status: 'queued',
        errorCode: null,
        startedAt: null,
        finishedAt: null,
      },
    });
    if (changed.count !== 1) throw new ConflictException('فقط درخواست ناموفق قابل تلاش مجدد است');
    await this.control.platformAuditEvent.create({
      data: {
        actorHash,
        action: 'platform.provisioning.retried',
        targetType: 'provisioning_job',
        targetId: id,
        ipHash,
      },
    });
    return this.job(id);
  }
}

/**
 * تعرفه‌های سراسری — سالی یک‌بار، برای همهٔ شرکت‌ها.
 *
 * این‌جا (پنلِ پلتفرم) ویرایش می‌شوند چون حقیقتِ مشترک‌اند؛ هر شرکت فقط
 * می‌خواندشان (`service-codes/tariffs`) و اگر قراردادِ خاصی دارد ضریبِ
 * محلیِ خودش را روی همان صفحهٔ تنظیماتش می‌گذارد که مقدم است.
 */
@Injectable()
class PlatformTariffsService {
  constructor(private readonly control: ControlPrismaService) {}

  async list() {
    const rows = await this.control.centralTariff.findMany({
      orderBy: [{ year: 'desc' }, { sector: 'asc' }],
    });
    return rows.map((t) => ({ ...t, sectorLabel: SECTOR_LABELS[t.sector] ?? t.sector }));
  }

  async set(dto: CentralTariffDto, actorHash: string, ipHash: string) {
    const row = await this.control.centralTariff.upsert({
      where: { year_sector: { year: dto.year, sector: dto.sector } },
      create: { ...dto },
      update: { professional: dto.professional, technical: dto.technical, anesthesia: dto.anesthesia, active: true },
    });
    await this.control.platformAuditEvent.create({
      data: {
        actorHash,
        action: 'platform.tariff.set',
        targetType: 'central_tariff',
        targetId: String(row.id),
        ipHash,
        metadata: { year: dto.year, sector: dto.sector, professional: dto.professional, technical: dto.technical, anesthesia: dto.anesthesia },
      },
    });
    return { ...row, sectorLabel: SECTOR_LABELS[row.sector] ?? row.sector };
  }
}

/**
 * پیکربندیِ مرکزیِ هوشِ مصنوعی — «مادر»: یک ردیفِ singleton در کنترل.
 * همهٔ شرکت‌ها پیش‌فرض اعتبار و مدلِ هر قابلیت را از همین می‌خوانند
 * (`settings.ai()` هر شرکت fallback به این دارد)؛ شرکتِ دارای تنظیمِ خودش
 * مقدم است. کلید فقط این‌جا نگه داشته می‌شود و **هرگز** به شرکت‌ها
 * برنمی‌گردد — سرورِ هر شرکت خودش با آن تماس می‌گیرد.
 */
@Injectable()
class PlatformAiService {
  constructor(private readonly control: ControlPrismaService) {}

  private view(row: any) {
    return {
      provider: row?.provider ?? 'custom',
      baseUrl: row?.baseUrl ?? '',
      /* کلید ماسکه برمی‌گردد — پنل فقط باید بداند «هست یا نه». */
      apiKeySet: !!row?.apiKey,
      modelChat: row?.modelChat ?? '',
      modelVision: row?.modelVision ?? '',
      modelStt: row?.modelStt ?? '',
      modelTts: row?.modelTts ?? '',
      modelImage: row?.modelImage ?? '',
      enabled: row?.enabled ?? false,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async get() {
    const row = await this.control.centralAiConfig.findUnique({ where: { id: 1 } }).catch(() => null);
    return this.view(row);
  }

  async set(dto: CentralAiDto, actorHash: string, ipHash: string) {
    const data = {
      provider: dto.provider,
      baseUrl: dto.baseUrl.trim().replace(/\/+$/, ''),
      modelChat: dto.modelChat.trim(),
      modelVision: (dto.modelVision ?? '').trim(),
      modelStt: (dto.modelStt ?? '').trim(),
      modelTts: (dto.modelTts ?? '').trim(),
      modelImage: (dto.modelImage ?? '').trim(),
      enabled: dto.enabled,
      /* کلیدِ خالی یعنی «دست نزن» — پنل کلید را نمی‌بیند که echo کند. */
      ...(dto.apiKey.trim() ? { apiKey: dto.apiKey.trim() } : {}),
    };
    const row = await this.control.centralAiConfig.upsert({
      where: { id: 1 },
      create: { id: 1, apiKey: dto.apiKey.trim(), ...data },
      update: data,
    });
    await this.control.platformAuditEvent.create({
      data: {
        actorHash,
        action: 'platform.ai.set',
        targetType: 'central_ai_config',
        targetId: '1',
        ipHash,
        /* عمداً بدونِ کلید — کلید در audit هم نمی‌نشیند. */
        metadata: { provider: dto.provider, baseUrl: data.baseUrl, modelChat: data.modelChat, enabled: dto.enabled },
      },
    });
    return this.view(row);
  }
}

@Controller('platform')
export class PlatformController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly provisioning: PlatformProvisioningService,
    private readonly migrator: TenantMigratorService,
    private readonly tariffs: PlatformTariffsService,
    private readonly centralAi: PlatformAiService,
    private readonly hospitals: HospitalDirectoryService,
  ) {}

  @Get('auth/options')
  authOptions() {
    return this.auth.phoneOptions();
  }

  @Post('auth/request-otp')
  @HttpCode(200)
  requestOtp(@Body() dto: PlatformPhoneDto, @Req() req: Request) {
    return this.auth.requestOtp(dto.phone, dto.phoneRef, requestIp(req), req.headers.host);
  }

  @Post('auth/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body() dto: PlatformVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyOtp(dto.phone, dto.phoneRef, dto.code, requestIp(req));
    const secure = cookieSecure();
    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/api/platform',
      maxAge: SESSION_TTL_MS,
    });
    res.cookie(CSRF_COOKIE, result.csrf, {
      httpOnly: false,
      secure,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_TTL_MS,
    });
    return { ok: true, csrfToken: result.csrf, expiresIn: result.expiresIn };
  }

  @Get('auth/me')
  @UseGuards(PlatformSessionGuard)
  me() {
    return { ok: true };
  }

  @Post('auth/logout')
  @HttpCode(200)
  @UseGuards(PlatformSessionGuard, PlatformCsrfGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = (req as any).platformSession;
    await this.auth.revoke(session.id, requestIp(req));
    const secure = cookieSecure();
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure, sameSite: 'strict', path: '/api/platform' });
    res.clearCookie(CSRF_COOKIE, { httpOnly: false, secure, sameSite: 'strict', path: '/' });
    return { ok: true };
  }

  @Get('snapshot')
  @UseGuards(PlatformSessionGuard)
  snapshot() {
    return this.provisioning.snapshot();
  }

  /// وضعیتِ هم‌گامیِ دیتابیسِ هر شرکت — با نام، پس فقط پشتِ نشستِ پلتفرم.
  /// `/health` همین را بی‌نام و بی‌احراز هویت می‌دهد.
  @Get('migrations')
  @UseGuards(PlatformSessionGuard)
  migrations() {
    return { ...this.migrator.summary(), tenants: this.migrator.details() };
  }

  @Get('provisioning-jobs/:id')
  @UseGuards(PlatformSessionGuard)
  job(@Param('id') id: string) {
    return this.provisioning.job(id);
  }

  @Post('provisioning-jobs')
  @UseGuards(PlatformSessionGuard, PlatformCsrfGuard)
  createJob(@Body() dto: CreateProvisioningJobDto, @Req() req: Request) {
    const session = (req as any).platformSession;
    return this.provisioning.create(dto, session.phoneHash, this.auth.ipHash(requestIp(req)), requestHost(req));
  }

  @Post('provisioning-jobs/:id/retry')
  @UseGuards(PlatformSessionGuard, PlatformCsrfGuard)
  retryJob(@Param('id') id: string, @Req() req: Request) {
    const session = (req as any).platformSession;
    return this.provisioning.retry(id, session.phoneHash, this.auth.ipHash(requestIp(req)));
  }

  @Get('hospitals')
  @UseGuards(PlatformSessionGuard)
  listHospitals(@Query() query: any) { return this.hospitals.list(query, true); }

  @Post('hospitals')
  @UseGuards(PlatformSessionGuard, PlatformCsrfGuard)
  saveHospital(@Body() dto: Record<string, unknown>, @Req() req: Request) {
    const session = (req as any).platformSession;
    return this.hospitals.save(dto, session.phoneHash, this.auth.ipHash(requestIp(req)));
  }

  /** تعرفه‌های سراسریِ سالانه — همهٔ شرکت‌ها از همین می‌خوانند. */
  @Get('tariffs')
  @UseGuards(PlatformSessionGuard)
  listTariffs() {
    return this.tariffs.list();
  }

  @Post('tariffs')
  @UseGuards(PlatformSessionGuard, PlatformCsrfGuard)
  setTariff(@Body() dto: CentralTariffDto, @Req() req: Request) {
    const session = (req as any).platformSession;
    return this.tariffs.set(dto, session.phoneHash, this.auth.ipHash(requestIp(req)));
  }

  /** هوشِ مصنوعیِ مرکزی — شرکت‌ها پیش‌فرض از همین می‌خوانند. */
  @Get('ai')
  @UseGuards(PlatformSessionGuard)
  getAi() {
    return this.centralAi.get();
  }

  @Post('ai')
  @UseGuards(PlatformSessionGuard, PlatformCsrfGuard)
  setAi(@Body() dto: CentralAiDto, @Req() req: Request) {
    const session = (req as any).platformSession;
    return this.centralAi.set(dto, session.phoneHash, this.auth.ipHash(requestIp(req)));
  }

  /** مرحلهٔ ۱ حذف: ارسالِ کدِ تأیید به مدیرِ واردشده (کدِ ورود نیست). */
  @Post('tenants/:id/deletion-otp')
  @HttpCode(200)
  @UseGuards(PlatformSessionGuard, PlatformCsrfGuard)
  async requestDeletionOtp(@Param('id') id: string, @Req() req: Request) {
    const session = (req as any).platformSession;
    return this.auth.requestActionOtp(session, deletionScope(id), requestIp(req), req.headers.host);
  }

  /** مرحلهٔ ۲ حذف: کدِ یکبارمصرف + تایپِ شناسهٔ شرکت → ثبت در صفِ Worker. */
  @Post('tenants/:id/delete')
  @HttpCode(200)
  @UseGuards(PlatformSessionGuard, PlatformCsrfGuard)
  async deleteTenant(@Param('id') id: string, @Body() dto: DeleteTenantDto, @Req() req: Request) {
    const session = (req as any).platformSession;
    const ip = requestIp(req);
    // اول شناسه تأیید شود، بعد کد مصرف — تایپِ اشتباه نباید کدِ کاربر را بسوزاند.
    await this.provisioning.assertDeletable(id, dto.confirmSlug);
    await this.auth.consumeActionOtp(session, deletionScope(id), dto.code, ip);
    return this.provisioning.requestDeletion(
      id,
      dto.confirmSlug,
      session.phoneHash,
      this.auth.ipHash(ip),
    );
  }

  /**
   * نشانی‌های سایتِ یک شرکت — افزودن (و اصلی‌کردن)، اصلی‌کردنِ نشانیِ موجود، حذفِ نشانیِ
   * فرعی. هیچ‌کدام داده را جابه‌جا نمی‌کند؛ فقط این‌که کدام Host به این شرکت برسد.
   */
  @Post('tenants/:id/domains')
  @HttpCode(200)
  @UseGuards(PlatformSessionGuard, PlatformCsrfGuard)
  addDomain(@Param('id') id: string, @Body() dto: TenantDomainDto, @Req() req: Request) {
    const session = (req as any).platformSession;
    return this.provisioning.addDomain(
      id, dto.hostname, dto.primary !== false, requestHost(req), session.phoneHash, this.auth.ipHash(requestIp(req)),
    );
  }

  @Post('tenants/:id/domains/primary')
  @HttpCode(200)
  @UseGuards(PlatformSessionGuard, PlatformCsrfGuard)
  primaryDomain(@Param('id') id: string, @Body() dto: TenantDomainDto, @Req() req: Request) {
    const session = (req as any).platformSession;
    return this.provisioning.setPrimaryDomain(id, dto.hostname, session.phoneHash, this.auth.ipHash(requestIp(req)));
  }

  @Post('tenants/:id/domains/remove')
  @HttpCode(200)
  @UseGuards(PlatformSessionGuard, PlatformCsrfGuard)
  removeDomain(@Param('id') id: string, @Body() dto: TenantDomainDto, @Req() req: Request) {
    const session = (req as any).platformSession;
    return this.provisioning.removeDomain(id, dto.hostname, session.phoneHash, this.auth.ipHash(requestIp(req)));
  }
}

@Module({
  imports: [HospitalDirectoryModule],
  controllers: [PlatformController],
  providers: [
    RateLimitService,
    PlatformAuthService,
    PlatformSessionGuard,
    PlatformCsrfGuard,
    PlatformProvisioningService,
    PlatformTariffsService, PlatformAiService,
  ],
})
export class PlatformModule {}
