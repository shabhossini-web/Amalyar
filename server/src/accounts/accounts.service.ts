import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { LEVEL } from '../common/levels';

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
    });
    return this.auth.publicUser(updated);
  }

  async reject(id: number) {
    const acc = await this.prisma.account.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('حساب یافت نشد');
    const updated = await this.prisma.account.update({
      where: { id },
      data: { status: 'rejected' },
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
    const updated = await this.prisma.account.update({ where: { id }, data: { level } });
    return this.auth.publicUser(updated);
  }
}
