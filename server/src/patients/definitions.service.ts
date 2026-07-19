import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LEVEL } from '../common/levels';

/**
 * تعریف‌های عملیاتیِ ماژولِ بیماران: جراحان و بیمارستان‌ها (+ فهرستِ کارشناسان).
 * موجودیتِ استفاده‌شده در مراجعه‌ها حذفِ سخت نمی‌شود — غیرفعال (active=false) می‌شود
 * تا دادهٔ تاریخی سالم بماند.
 */
@Injectable()
export class DefinitionsService {
  constructor(private prisma: PrismaService) {}

  private async dupCheck(model: 'surgeon' | 'hospital', name: string, exceptId?: number) {
    const row = await (this.prisma[model] as any).findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (row) throw new BadRequestException('این نام قبلاً ثبت شده است');
  }

  async listSurgeons() {
    const rows = await this.prisma.surgeon.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { visits: true } } },
    });
    return rows.map((s) => ({ id: s.id, name: s.name, phone: s.phone, active: s.active, visitCount: s._count.visits }));
  }

  async createSurgeon(dto: { name: string; phone?: string }) {
    await this.dupCheck('surgeon', dto.name);
    return this.prisma.surgeon.create({ data: { name: dto.name.trim(), phone: dto.phone || null } });
  }

  async updateSurgeon(id: number, dto: { name?: string; phone?: string; active?: boolean }) {
    const s = await this.prisma.surgeon.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('جراح یافت نشد');
    if (dto.name) await this.dupCheck('surgeon', dto.name, id);
    const updated = await this.prisma.surgeon.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    // نامِ denormalized مراجعه‌های متصل هم تازه شود
    if (dto.name) {
      await this.prisma.visit.updateMany({ where: { surgeonId: id }, data: { surgeonName: updated.name } });
    }
    return updated;
  }

  async deleteSurgeon(id: number) {
    const s = await this.prisma.surgeon.findUnique({
      where: { id },
      include: { _count: { select: { visits: true } } },
    });
    if (!s) throw new NotFoundException('جراح یافت نشد');
    if (s._count.visits > 0) {
      await this.prisma.surgeon.update({ where: { id }, data: { active: false } });
      return { ok: true, deactivated: true };
    }
    await this.prisma.surgeon.delete({ where: { id } });
    return { ok: true, deactivated: false };
  }

  async listHospitals() {
    const rows = await this.prisma.hospital.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { visits: true } } },
    });
    return rows.map((h) => ({ id: h.id, name: h.name, active: h.active, visitCount: h._count.visits }));
  }

  async createHospital(name: string) {
    await this.dupCheck('hospital', name);
    return this.prisma.hospital.create({ data: { name: name.trim() } });
  }

  async updateHospital(id: number, dto: { name?: string; active?: boolean }) {
    const h = await this.prisma.hospital.findUnique({ where: { id } });
    if (!h) throw new NotFoundException('بیمارستان یافت نشد');
    if (dto.name) await this.dupCheck('hospital', dto.name, id);
    const updated = await this.prisma.hospital.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    if (dto.name) {
      await this.prisma.visit.updateMany({ where: { hospitalId: id }, data: { hospitalName: updated.name } });
    }
    return updated;
  }

  async deleteHospital(id: number) {
    const h = await this.prisma.hospital.findUnique({
      where: { id },
      include: { _count: { select: { visits: true } } },
    });
    if (!h) throw new NotFoundException('بیمارستان یافت نشد');
    if (h._count.visits > 0) {
      await this.prisma.hospital.update({ where: { id }, data: { active: false } });
      return { ok: true, deactivated: true };
    }
    await this.prisma.hospital.delete({ where: { id } });
    return { ok: true, deactivated: false };
  }

  async listTechs() {
    const rows = await this.prisma.account.findMany({
      where: { status: 'active', level: { gte: LEVEL.TECH, lte: LEVEL.SUPERVISOR } },
      orderBy: { firstName: 'asc' },
    });
    return rows.map((a) => ({
      id: a.id,
      displayName: `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || a.username || a.phone,
    }));
  }
}
