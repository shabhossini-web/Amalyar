import {
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
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { IsString, Length, Matches } from 'class-validator';
import { RateLimitService } from '../common/rate-limit.service';
import { SmsService } from '../sms/sms.service';
import { ControlPrismaService } from '../tenant/control-prisma.service';

const OTP_TTL_MS = 5 * 60_000;
const OTP_RESEND_MS = 60_000;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 30 * 60_000;
const SESSION_COOKIE = 'amalyar_platform_session';
const CSRF_COOKIE = 'amalyar_platform_csrf';

type PlatformConfig = {
  enabled: boolean;
  secret: string;
  phones: Set<string>;
};

export function normalizePlatformPhone(value: string): string | null {
  let phone = (value || '').replace(/[^0-9]/g, '');
  if (phone.startsWith('98')) phone = '0' + phone.slice(2);
  if (!phone.startsWith('0')) phone = '0' + phone;
  return /^09[0-9]{9}$/.test(phone) ? phone : null;
}

export function platformAdminConfig(): PlatformConfig {
  const enabled = process.env.PLATFORM_ADMIN_ENABLED === 'true';
  if (!enabled) return { enabled: false, secret: '', phones: new Set() };

  const secret = process.env.PLATFORM_ADMIN_SECRET ?? '';
  if (secret.length < 32) {
    throw new Error('PLATFORM_ADMIN_SECRET with at least 32 characters is required when Platform Admin is enabled');
  }

  const phones = new Set(
    (process.env.PLATFORM_ADMIN_PHONES ?? '')
      .split(',')
      .map((value) => normalizePlatformPhone(value.trim()))
      .filter((value): value is string => Boolean(value)),
  );
  if (phones.size === 0) {
    throw new Error('PLATFORM_ADMIN_PHONES must contain at least one valid allowlisted phone');
  }
  return { enabled, secret, phones };
}

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

function requestIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (first || req.ip || 'unknown').trim().slice(0, 128);
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
  @IsString()
  @Length(10, 16)
  phone!: string;
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

  async requestOtp(phoneInput: string, ip: string) {
    const config = this.config();
    const phone = normalizePlatformPhone(phoneInput);
    const phoneHash = this.hash('phone', phone ?? phoneInput.trim());
    const ipHash = this.ipHash(ip);
    this.rateLimit.hit(`platform:otp:ip:${ipHash}`, 10, 15 * 60_000);
    this.rateLimit.hit(`platform:otp:phone:${phoneHash}`, 3, 15 * 60_000);

    const response = { ok: true, ttl: OTP_TTL_MS / 1000 };
    if (!phone || !config.phones.has(phone)) return response;

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
      const sent = await this.sms.sendOtp(phone, code);
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

  async verifyOtp(phoneInput: string, code: string, ip: string) {
    const config = this.config();
    const phone = normalizePlatformPhone(phoneInput);
    if (!phone || !config.phones.has(phone)) throw new UnauthorizedException('کد تأیید نامعتبر است');

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

    const actual = this.hash('otp', `${phoneHash}:${code}`);
    if (!equalText(actual, otp.codeHash)) {
      await this.control.platformOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
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
    const [tenants, jobs] = await Promise.all([
      this.control.tenant.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          createdAt: true,
          domains: {
            where: { primary: true },
            take: 1,
            select: { hostname: true },
          },
        },
      }),
      this.control.provisioningJob.findMany({
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
        hostname: tenant.domains[0]?.hostname ?? null,
        createdAt: tenant.createdAt,
      })),
      jobs,
    };
  }

  async job(id: string) {
    const job = await this.control.provisioningJob.findUnique({ where: { id }, select: this.jobSelect });
    if (!job) throw new NotFoundException();
    return job;
  }

  async create(dto: CreateProvisioningJobDto, actorHash: string, ipHash: string) {
    const slug = dto.slug.trim().toLowerCase();
    const name = dto.name.trim();
    const hostname = dto.hostname.trim().toLowerCase();

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

@Controller('platform')
export class PlatformController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly provisioning: PlatformProvisioningService,
  ) {}

  @Post('auth/request-otp')
  @HttpCode(200)
  requestOtp(@Body() dto: PlatformPhoneDto, @Req() req: Request) {
    return this.auth.requestOtp(dto.phone, requestIp(req));
  }

  @Post('auth/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body() dto: PlatformVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyOtp(dto.phone, dto.code, requestIp(req));
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

  @Get('provisioning-jobs/:id')
  @UseGuards(PlatformSessionGuard)
  job(@Param('id') id: string) {
    return this.provisioning.job(id);
  }

  @Post('provisioning-jobs')
  @UseGuards(PlatformSessionGuard, PlatformCsrfGuard)
  createJob(@Body() dto: CreateProvisioningJobDto, @Req() req: Request) {
    const session = (req as any).platformSession;
    return this.provisioning.create(dto, session.phoneHash, this.auth.ipHash(requestIp(req)));
  }

  @Post('provisioning-jobs/:id/retry')
  @UseGuards(PlatformSessionGuard, PlatformCsrfGuard)
  retryJob(@Param('id') id: string, @Req() req: Request) {
    const session = (req as any).platformSession;
    return this.provisioning.retry(id, session.phoneHash, this.auth.ipHash(requestIp(req)));
  }
}

@Module({
  controllers: [PlatformController],
  providers: [
    RateLimitService,
    PlatformAuthService,
    PlatformSessionGuard,
    PlatformCsrfGuard,
    PlatformProvisioningService,
  ],
})
export class PlatformModule {}
