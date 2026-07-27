import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { LEVEL } from '../common/levels';
import { buildPersonPatch, PersonInput } from '../common/person';

@Injectable()
export class AccountsService {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
  ) {}

  async list(status?: string) {
    const rows = await this.prisma.account.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      include: { person: true },
    });
    return rows.map((a) => ({ ...this.auth.publicUser(a), createdAt: a.createdAt }));
  }

  async approve(id: number, level: number, approverId: number) {
    if (level < LEVEL.VIEWER || level > LEVEL.SUPER_ADMIN) {
      throw new BadRequestException('سطح نامعتبر است');
    }
    const acc = await this.prisma.account.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('حساب یافت نشد');
    const updated = await this.prisma.account.update({
      where: { id },
      data: { status: 'active', level, approvedById: approverId, approvedAt: new Date() },
      include: { person: true },
    });
    return this.auth.publicUser(updated);
  }

  async reject(id: number) {
    const acc = await this.prisma.account.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('حساب یافت نشد');
    const updated = await this.prisma.account.update({
      where: { id },
      data: { status: 'rejected' },
      include: { person: true },
    });
    return this.auth.publicUser(updated);
  }

  async setLevel(id: number, level: number, actorId?: number) {
    if (level < LEVEL.VIEWER || level > LEVEL.SUPER_ADMIN) {
      throw new BadRequestException('سطح نامعتبر است');
    }
    if (actorId !== undefined && actorId === id) {
      throw new BadRequestException('نمی‌توانید سطحِ حسابِ خودتان را تغییر دهید');
    }
    const acc = await this.prisma.account.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('حساب یافت نشد');
    // سیستم هرگز نباید بدونِ سوپرادمینِ فعال بماند
    if (acc.level === LEVEL.SUPER_ADMIN && level < LEVEL.SUPER_ADMIN && acc.status === 'active') {
      const others = await this.prisma.account.count({
        where: { level: LEVEL.SUPER_ADMIN, status: 'active', id: { not: id } },
      });
      if (others === 0) {
        throw new BadRequestException('این آخرین سوپرادمینِ فعال است؛ ابتدا سوپرادمینِ دیگری تعیین کنید');
      }
    }
    const updated = await this.prisma.account.update({
      where: { id },
      data: { level },
      include: { person: true },
    });
    return this.auth.publicUser(updated);
  }

  /// پروفایلِ کاملِ یک حساب — برای صفحهٔ ویرایشِ سوپرادمین.
  async get(id: number) {
    const acc = await this.prisma.account.findUnique({ where: { id }, include: { person: true } });
    if (!acc) throw new NotFoundException('حساب یافت نشد');
    const p = acc.person;
    return {
      ...this.auth.publicUser(acc),
      fee: acc.fee,
      createdAt: acc.createdAt,
      nationalId: p.nationalId,
      email: p.email,
      birthDate: p.birthDate,
      city: p.city,
      address: p.address,
      iban: p.iban,
      notes: p.notes,
    };
  }

  /**
   * تکمیلِ پروفایل توسط سوپرادمین.
   *
   * ثبت‌نام فقط نام، موبایل و عکس را پر می‌کند؛ کدِ ملی، شبا و دستمزد این‌جا
   * تکمیل می‌شوند. عمداً از مسیرِ خودِ کاربر (`/auth/profile`) جدا است: شبا
   * مقصدِ پرداخت است و دستمزد رقمِ قرارداد — هیچ‌کدام نباید با حسابِ لو رفتهٔ
   * خودِ کاربر قابلِ تغییر باشند.
   */
  async updateProfile(id: number, dto: PersonInput & { fee?: number | null }) {
    const acc = await this.prisma.account.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('حساب یافت نشد');

    const personPatch = buildPersonPatch(dto, false);
    await this.prisma.account.update({
      where: { id },
      data: {
        ...(dto.fee !== undefined ? { fee: dto.fee === null ? null : Math.max(0, Math.trunc(dto.fee)) } : {}),
        ...(Object.keys(personPatch).length ? { person: { update: personPatch } } : {}),
      },
    });
    return this.get(id);
  }
}
