import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import type { Account } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const SESSION_TTL_DAYS = 30;
const MAX_SESSIONS = 10;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    if (!dto.username && !dto.phone) {
      throw new BadRequestException('نام کاربری یا شمارهٔ موبایل لازم است');
    }
    const clauses: any[] = [];
    if (dto.username) clauses.push({ username: dto.username });
    if (dto.phone) clauses.push({ phone: dto.phone });
    const existing = await this.prisma.account.findFirst({ where: { OR: clauses } });
    if (existing) throw new BadRequestException('این حساب قبلاً ثبت شده است');

    // اولین حسابِ سیستم = super_admin (بوت‌استرپ)
    const isFirst = (await this.prisma.account.count()) === 0;
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const account = await this.prisma.account.create({
      data: {
        username: dto.username ?? null,
        phone: dto.phone ?? null,
        displayName: dto.displayName ?? dto.username ?? dto.phone ?? null,
        passwordHash,
        role: isFirst ? 'super_admin' : 'viewer',
      },
    });
    return this.publicUser(account);
  }

  async login(dto: LoginDto, meta: { ua?: string; ip?: string }) {
    const id = dto.identifier.trim();
    const account = await this.prisma.account.findFirst({
      where: { OR: [{ username: id }, { phone: id }] },
    });
    if (!account) throw new UnauthorizedException('نام کاربری یا رمز عبور اشتباه است');
    if (account.status !== 'active') throw new UnauthorizedException('این حساب غیرفعال است');
    const ok = await bcrypt.compare(dto.password, account.passwordHash);
    if (!ok) throw new UnauthorizedException('نام کاربری یا رمز عبور اشتباه است');
    return this.issue(account, meta);
  }

  private async issue(account: Account, meta: { ua?: string; ip?: string }) {
    // سقفِ ۱۰ سشنِ فعال — قدیمی‌ترین‌ها باطل می‌شوند
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
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
    const session = await this.prisma.session.create({
      data: {
        accountId: account.id,
        tokenHash,
        userAgent: meta.ua?.slice(0, 255) ?? null,
        ip: meta.ip ?? null,
        expiresAt,
      },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: account.id, sid: session.id, role: account.role },
      { expiresIn: `${SESSION_TTL_DAYS}d` },
    );
    return { accessToken, user: this.publicUser(account) };
  }

  /// اعتبارسنجیِ سشن در هر درخواست (تا logout واقعاً کار کند)
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
    await this.prisma.session.updateMany({
      where: { id: sid, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  publicUser(a: Account) {
    return {
      id: a.id,
      username: a.username,
      phone: a.phone,
      displayName: a.displayName,
      role: a.role,
      status: a.status,
      avatar: a.avatar,
    };
  }
}
