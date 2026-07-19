import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVisitDto, UpdateVisitDto } from './dto/visit.dto';

/**
 * غنی‌سازیِ مراجعه — قانونِ computeVisit: فیلدهای مشتق فقط این‌جا ساخته می‌شوند
 * و کلاینت هیچ فرمولی در render ندارد. همهٔ مبالغ «تومان»اند.
 */
function enrich(v: any) {
  return {
    id: v.id,
    patientId: v.patientId,
    code: `${v.patient.code}-V${v.seq}`,
    patientCode: v.patient.code,
    firstName: v.patient.firstName,
    lastName: v.patient.lastName,
    fullName: `${v.patient.firstName} ${v.patient.lastName}`.trim(),
    phone: v.patient.phone,
    nationalId: v.patient.nationalId,
    surgeonName: v.surgeonName,
    hospitalName: v.hospitalName,
    opDate: v.opDate,
    opStatus: v.opStatus,
    amount: v.amount, // تومان
    paid: v.paid, // تومان
    due: Math.max(0, v.amount - v.paid), // تومان — مانده
    notes: v.notes,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

const INCLUDE_PATIENT = { patient: true } as const;

@Injectable()
export class PatientsService {
  constructor(private prisma: PrismaService) {}

  /// لیستِ مراجعات — q روی نام/کد/موبایل/جراح/بیمارستان، status روی opStatus
  async listVisits(q?: string, status?: string) {
    const where: any = {};
    if (status && status !== 'all') where.opStatus = status;
    if (q?.trim()) {
      const t = q.trim();
      where.OR = [
        { patient: { firstName: { contains: t, mode: 'insensitive' } } },
        { patient: { lastName: { contains: t, mode: 'insensitive' } } },
        { patient: { code: { contains: t, mode: 'insensitive' } } },
        { patient: { phone: { contains: t } } },
        { surgeonName: { contains: t, mode: 'insensitive' } },
        { hospitalName: { contains: t, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.visit.findMany({
      where,
      include: INCLUDE_PATIENT,
      orderBy: [{ opDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: 500,
    });
    return rows.map(enrich);
  }

  async getVisit(id: number) {
    const v = await this.prisma.visit.findUnique({ where: { id }, include: INCLUDE_PATIENT });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    return enrich(v);
  }

  /// جستجوی بیمارِ موجود (برای فرمِ «مراجعهٔ مجدد»)
  async searchPatients(q?: string) {
    const t = q?.trim();
    const where: any = t
      ? {
          OR: [
            { firstName: { contains: t, mode: 'insensitive' } },
            { lastName: { contains: t, mode: 'insensitive' } },
            { code: { contains: t, mode: 'insensitive' } },
            { phone: { contains: t } },
          ],
        }
      : {};
    const rows = await this.prisma.patient.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 20,
      include: { _count: { select: { visits: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      code: p.code,
      fullName: `${p.firstName} ${p.lastName}`.trim(),
      phone: p.phone,
      visitCount: p._count.visits,
    }));
  }

  /// ثبتِ مراجعه — بیمارِ موجود (patientId) یا بیمارِ جدید (کدِ AM-NNNN از id ساخته می‌شود)
  async createVisit(dto: CreateVisitDto, userId?: number) {
    const v = await this.prisma.$transaction(async (tx) => {
      let patientId = dto.patientId;
      if (patientId) {
        const p = await tx.patient.findUnique({ where: { id: patientId } });
        if (!p) throw new NotFoundException('بیمار پیدا نشد');
      } else {
        const p = await tx.patient.create({
          data: {
            code: 'AM-TMP',
            firstName: dto.firstName!,
            lastName: dto.lastName!,
            phone: dto.phone || null,
            nationalId: dto.nationalId || null,
          },
        });
        await tx.patient.update({
          where: { id: p.id },
          data: { code: `AM-${String(p.id).padStart(4, '0')}` },
        });
        patientId = p.id;
      }
      const seq = (await tx.visit.count({ where: { patientId } })) + 1;
      return tx.visit.create({
        data: {
          patientId,
          seq,
          surgeonName: dto.surgeonName || null,
          hospitalName: dto.hospitalName || null,
          opDate: dto.opDate ? new Date(dto.opDate) : null,
          amount: dto.amount ?? 0, // تومان
          paid: dto.paid ?? 0, // تومان
          notes: dto.notes || null,
          createdById: userId ?? null,
        },
        include: INCLUDE_PATIENT,
      });
    });
    return enrich(v);
  }

  async updateVisit(id: number, dto: UpdateVisitDto) {
    const v = await this.prisma.visit.findUnique({ where: { id }, include: INCLUDE_PATIENT });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');

    const patientPatch: any = {};
    if (dto.firstName !== undefined) patientPatch.firstName = dto.firstName;
    if (dto.lastName !== undefined) patientPatch.lastName = dto.lastName;
    if (dto.phone !== undefined) patientPatch.phone = dto.phone || null;
    if (dto.nationalId !== undefined) patientPatch.nationalId = dto.nationalId || null;

    const visitPatch: any = {};
    if (dto.surgeonName !== undefined) visitPatch.surgeonName = dto.surgeonName || null;
    if (dto.hospitalName !== undefined) visitPatch.hospitalName = dto.hospitalName || null;
    if (dto.opDate !== undefined) visitPatch.opDate = dto.opDate ? new Date(dto.opDate) : null;
    if (dto.amount !== undefined) visitPatch.amount = dto.amount; // تومان
    if (dto.paid !== undefined) visitPatch.paid = dto.paid; // تومان
    if (dto.notes !== undefined) visitPatch.notes = dto.notes || null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (Object.keys(patientPatch).length) {
        await tx.patient.update({ where: { id: v.patientId }, data: patientPatch });
      }
      return tx.visit.update({ where: { id }, data: visitPatch, include: INCLUDE_PATIENT });
    });
    return enrich(updated);
  }

  async setStatus(id: number, opStatus: string) {
    const v = await this.prisma.visit.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    const updated = await this.prisma.visit.update({
      where: { id },
      data: { opStatus },
      include: INCLUDE_PATIENT,
    });
    return enrich(updated);
  }

  /// حذفِ مراجعه؛ اگر آخرین مراجعهٔ بیمار بود، خودِ بیمار هم پاک می‌شود
  async deleteVisit(id: number) {
    const v = await this.prisma.visit.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    await this.prisma.$transaction(async (tx) => {
      await tx.visit.delete({ where: { id } });
      const left = await tx.visit.count({ where: { patientId: v.patientId } });
      if (left === 0) await tx.patient.delete({ where: { id: v.patientId } });
    });
    return { ok: true };
  }
}
