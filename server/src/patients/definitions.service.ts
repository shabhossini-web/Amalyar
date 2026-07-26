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

  private async hospitalDupCheck(name: string, exceptId?: number) {
    const row = await this.prisma.hospital.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (row) throw new BadRequestException('این نام قبلاً ثبت شده است');
  }

  /// جراح = نقش روی Person؛ نام و تلفن از همان‌جا می‌آیند، نه از خودِ رکوردِ جراح.
  private surgeonView(s: { id: number; active: boolean; specialty: string | null; licenseNo: string | null; person: { firstName: string; lastName: string; phone: string | null }; _count: { visits: number } }) {
    return {
      id: s.id,
      name: `${s.person.firstName} ${s.person.lastName}`.trim(),
      firstName: s.person.firstName,
      lastName: s.person.lastName,
      phone: s.person.phone,
      specialty: s.specialty,
      licenseNo: s.licenseNo,
      active: s.active,
      visitCount: s._count.visits,
    };
  }

  private static readonly SURGEON_INCLUDE = {
    person: true,
    _count: { select: { visits: true } },
  } as const;

  async listSurgeons() {
    const rows = await this.prisma.surgeon.findMany({
      orderBy: [{ active: 'desc' }, { person: { lastName: 'asc' } }],
      include: DefinitionsService.SURGEON_INCLUDE,
    });
    return rows.map((s) => this.surgeonView(s));
  }

  async createSurgeon(dto: { firstName: string; lastName: string; phone?: string; specialty?: string; licenseNo?: string }) {
    const row = await this.prisma.surgeon.create({
      data: {
        specialty: dto.specialty?.trim() || null,
        licenseNo: dto.licenseNo?.trim() || null,
        person: {
          create: {
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            phone: dto.phone?.trim() || null,
          },
        },
      },
      include: DefinitionsService.SURGEON_INCLUDE,
    });
    return this.surgeonView(row);
  }

  async updateSurgeon(
    id: number,
    dto: { firstName?: string; lastName?: string; phone?: string; specialty?: string; licenseNo?: string; active?: boolean },
  ) {
    const s = await this.prisma.surgeon.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('جراح یافت نشد');
    const personPatch = {
      ...(dto.firstName !== undefined ? { firstName: dto.firstName.trim() } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName.trim() } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
    };
    const updated = await this.prisma.surgeon.update({
      where: { id },
      data: {
        ...(dto.specialty !== undefined ? { specialty: dto.specialty?.trim() || null } : {}),
        ...(dto.licenseNo !== undefined ? { licenseNo: dto.licenseNo?.trim() || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(Object.keys(personPatch).length ? { person: { update: personPatch } } : {}),
      },
      include: DefinitionsService.SURGEON_INCLUDE,
    });
    // ⚠️ عمداً visit.surgeonName را به‌روز نمی‌کنیم: آن فیلد «عکسِ لحظهٔ ثبت» است و
    // فقط وقتی خوانده می‌شود که رابطه از بین رفته باشد. خواندن همیشه رابطه را
    // ترجیح می‌دهد، پس تغییرِ نام بلافاصله همه‌جا دیده می‌شود بدونِ هیچ همگام‌سازی.
    return this.surgeonView(updated);
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
    return rows.map((h) => ({
      id: h.id, name: h.name, city: h.city, address: h.address, phone: h.phone,
      contactName: h.contactName, contactPhone: h.contactPhone, notes: h.notes,
      active: h.active, visitCount: h._count.visits,
    }));
  }

  async createHospital(dto: { name: string; city?: string; address?: string; phone?: string; contactName?: string; contactPhone?: string; notes?: string }) {
    await this.hospitalDupCheck(dto.name);
    return this.prisma.hospital.create({
      data: {
        name: dto.name.trim(),
        city: dto.city?.trim() || null,
        address: dto.address?.trim() || null,
        phone: dto.phone?.trim() || null,
        contactName: dto.contactName?.trim() || null,
        contactPhone: dto.contactPhone?.trim() || null,
        notes: dto.notes?.trim() || null,
      },
    });
  }

  async updateHospital(
    id: number,
    dto: { name?: string; city?: string; address?: string; phone?: string; contactName?: string; contactPhone?: string; notes?: string; active?: boolean },
  ) {
    const h = await this.prisma.hospital.findUnique({ where: { id } });
    if (!h) throw new NotFoundException('بیمارستان یافت نشد');
    if (dto.name) await this.hospitalDupCheck(dto.name, id);
    const updated = await this.prisma.hospital.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.city !== undefined ? { city: dto.city?.trim() || null } : {}),
        ...(dto.address !== undefined ? { address: dto.address?.trim() || null } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
        ...(dto.contactName !== undefined ? { contactName: dto.contactName?.trim() || null } : {}),
        ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone?.trim() || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    // همان استدلالِ جراح: hospitalName عکسِ لحظه‌ای است و بازنویسی نمی‌شود.
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
      orderBy: { person: { lastName: 'asc' } },
      include: { person: true },
    });
    return rows.map((a) => ({
      id: a.id,
      displayName: `${a.person.firstName} ${a.person.lastName}`.trim() || a.username || a.person.phone,
    }));
  }
}
