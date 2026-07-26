import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVisitDto, UpdateVisitDto } from './dto/visit.dto';
import { randomUUID } from 'crypto';
import { LEVEL } from '../common/levels';
import { AuditService } from '../audit/audit.service';

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
    birthDate: v.patient.birthDate,
    surgeonId: v.surgeonId,
    hospitalId: v.hospitalId,
    techId: v.techId,
    // نامِ رابطه اگر بود، وگرنه denormalized (رکوردهای قدیمی/موجودیتِ حذف‌شده)
    surgeonName: v.surgeon ? `${v.surgeon.person.firstName} ${v.surgeon.person.lastName}`.trim() : v.surgeonName,
    hospitalName: v.hospital?.name ?? v.hospitalName,
    techName: v.tech ? `${v.tech.person.firstName} ${v.tech.person.lastName}`.trim() : null,
    procedureTypeId: v.procedureTypeId,
    procedureTypeName: v.procedureType?.name ?? v.opType,
    diagnosisId: v.diagnosisId,
    diagnosisTitle: v.diagnosis?.title ?? null,
    opReport: v.opReport,
    opType: v.opType,
    opDate: v.opDate,
    opStatus: v.opStatus,
    notes: v.notes,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

// جراح و کارشناس هویتشان در Person است، پس همیشه با آن خوانده می‌شوند.
const INCLUDE_PATIENT = {
  patient: true,
  hospital: true,
  procedureType: true,
  diagnosis: true,
  surgeon: { include: { person: true } },
  tech: { include: { person: true } },
} as const;

@Injectable()
export class PatientsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private scopedVisitWhere(user: any, where: any = {}) {
    if ((user?.level ?? 0) >= LEVEL.SUPERVISOR) return { ...where };
    return { ...where, techId: user?.id ?? -1 };
  }

  private async assertVisitAccess(id: number, user: any) {
    const v = await this.prisma.visit.findFirst({ where: this.scopedVisitWhere(user, { id }) });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    return v;
  }

  /// لیستِ مراجعات — q روی نام/کد/موبایل/جراح/بیمارستان، status روی opStatus
  async listVisits(q?: string, status?: string, user?: any) {
    const where: any = {};
    if (status && status !== 'all') where.opStatus = status;
    if (q?.trim()) {
      const t = q.trim();
      where.OR = [
        { patient: { firstName: { contains: t, mode: 'insensitive' } } },
        { patient: { lastName: { contains: t, mode: 'insensitive' } } },
        { patient: { code: { contains: t, mode: 'insensitive' } } },
        { patient: { phone: { contains: t } } },
        { patient: { nationalId: { contains: t } } },
        { surgeonName: { contains: t, mode: 'insensitive' } },
        { hospitalName: { contains: t, mode: 'insensitive' } },
        { surgeon: { person: { OR: [
          { firstName: { contains: t, mode: 'insensitive' } },
          { lastName: { contains: t, mode: 'insensitive' } },
        ] } } },
        { procedureType: { name: { contains: t, mode: 'insensitive' } } },
        { diagnosis: { title: { contains: t, mode: 'insensitive' } } },
        { hospital: { name: { contains: t, mode: 'insensitive' } } },
        { opType: { contains: t, mode: 'insensitive' } },
        { tech: { person: { OR: [
          { firstName: { contains: t, mode: 'insensitive' } },
          { lastName: { contains: t, mode: 'insensitive' } },
        ] } } },
      ];
    }
    const rows = await this.prisma.visit.findMany({
      where: this.scopedVisitWhere(user, { ...where, patient: { ...(where.patient ?? {}), deletedAt: null } }),
      include: INCLUDE_PATIENT,
      orderBy: [{ opDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: 500,
    });
    return rows.map(enrich);
  }

  async getVisit(id: number, user?: any) {
    await this.assertVisitAccess(id, user);
    const v = await this.prisma.visit.findUnique({ where: { id }, include: INCLUDE_PATIENT });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    return enrich(v);
  }

  /// جستجوی بیمارِ موجود (برای فرمِ «مراجعهٔ مجدد»)
  async searchPatients(q?: string, user?: any) {
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
      where: {
        ...where,
        deletedAt: null,
        ...((user?.level ?? 0) < LEVEL.SUPERVISOR ? { visits: { some: { techId: user?.id ?? -1 } } } : {}),
      },
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

  /// نامِ denormalizedِ جراح/بیمارستان + اعتبارسنجیِ وجودِ موجودیت‌ها
  private async resolveRefs(tx: any, dto: { surgeonId?: number | null; hospitalId?: number | null; techId?: number | null }) {
    const out: any = {};
    if (dto.surgeonId != null) {
      const s = await tx.surgeon.findUnique({ where: { id: dto.surgeonId }, include: { person: true } });
      if (!s) throw new NotFoundException('جراح یافت نشد');
      out.surgeonId = s.id;
      // عکسِ لحظهٔ ثبت — فقط اگر روزی جراح حذف شود خوانده می‌شود.
      out.surgeonName = `${s.person.firstName} ${s.person.lastName}`.trim();
    }
    if (dto.hospitalId != null) {
      const h = await tx.hospital.findUnique({ where: { id: dto.hospitalId } });
      if (!h) throw new NotFoundException('بیمارستان یافت نشد');
      out.hospitalId = h.id;
      out.hospitalName = h.name;
    }
    if (dto.techId != null) {
      const a = await tx.account.findUnique({ where: { id: dto.techId } });
      if (!a || a.status !== 'active') throw new NotFoundException('کارشناس یافت نشد');
      out.techId = a.id;
    }
    return out;
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
            code: `AM-PENDING-${randomUUID()}`,
            firstName: dto.firstName!,
            lastName: dto.lastName!,
            phone: dto.phone || null,
            nationalId: dto.nationalId || null,
            birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
          },
        });
        await tx.patient.update({
          where: { id: p.id },
          data: { code: `AM-${String(p.id).padStart(4, '0')}` },
        });
        patientId = p.id;
      }
      const refs = await this.resolveRefs(tx, dto);
      const max = await tx.visit.aggregate({ where: { patientId }, _max: { seq: true } });
      const seq = (max._max.seq ?? 0) + 1;
      return tx.visit.create({
        data: {
          patientId,
          seq,
          ...refs,
          opType: dto.opType?.trim() || null,
          opDate: dto.opDate ? new Date(dto.opDate) : null,
          notes: dto.notes || null,
          createdById: userId ?? null,
        },
        include: INCLUDE_PATIENT,
      });
    });
    const result = enrich(v);
    await this.audit.record({ actorId: userId, action: 'visit.create', entityType: 'visit', entityId: v.id, after: result });
    return result;
  }

  async updateVisit(id: number, dto: UpdateVisitDto, user?: any) {
    await this.assertVisitAccess(id, user);
    const v = await this.prisma.visit.findUnique({ where: { id }, include: INCLUDE_PATIENT });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');

    const patientPatch: any = {};
    if (dto.firstName !== undefined) patientPatch.firstName = dto.firstName;
    if (dto.lastName !== undefined) patientPatch.lastName = dto.lastName;
    if (dto.phone !== undefined) patientPatch.phone = dto.phone || null;
    if (dto.nationalId !== undefined) patientPatch.nationalId = dto.nationalId || null;
    if (dto.birthDate !== undefined) patientPatch.birthDate = dto.birthDate ? new Date(dto.birthDate) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const visitPatch: any = await this.resolveRefs(tx, dto);
      // null صریح یعنی «پاک کن» (SetNull + پاک‌شدنِ نامِ denormalized)
      if (dto.surgeonId === null) { visitPatch.surgeonId = null; visitPatch.surgeonName = null; }
      if (dto.hospitalId === null) { visitPatch.hospitalId = null; visitPatch.hospitalName = null; }
      if (dto.techId === null) visitPatch.techId = null;
      if (dto.opType !== undefined) visitPatch.opType = dto.opType?.trim() || null;
      if (dto.opDate !== undefined) visitPatch.opDate = dto.opDate ? new Date(dto.opDate) : null;
      if (dto.notes !== undefined) visitPatch.notes = dto.notes || null;

      if (Object.keys(patientPatch).length) {
        await tx.patient.update({ where: { id: v.patientId }, data: patientPatch });
      }
      return tx.visit.update({ where: { id }, data: visitPatch, include: INCLUDE_PATIENT });
    });
    const result = enrich(updated);
    await this.audit.record({ actorId: user?.id, action: 'visit.update', entityType: 'visit', entityId: id, before: enrich(v), after: result });
    return result;
  }

  async setStatus(id: number, opStatus: string, user?: any) {
    await this.assertVisitAccess(id, user);
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
  async deleteVisit(id: number, user?: any) {
    await this.assertVisitAccess(id, user);
    const v = await this.prisma.visit.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    await this.prisma.$transaction(async (tx) => {
      await tx.visit.delete({ where: { id } });
      const left = await tx.visit.count({ where: { patientId: v.patientId } });
      if (left === 0) {
        await tx.patient.update({
          where: { id: v.patientId },
          data: { deletedAt: new Date(), deletedById: user?.id ?? null, deleteReason: 'آخرین مراجعه حذف شد' },
        });
      }
    });
    await this.audit.record({ actorId: user?.id, action: 'visit.delete', entityType: 'visit', entityId: id, before: v });
    return { ok: true };
  }
}
