import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVisitDto, UpdateVisitDto } from './dto/visit.dto';
import { randomUUID } from 'crypto';
import { LEVEL } from '../common/levels';
import { toEnDigits } from '../common/identity';
import { actorName } from '../common/person';
import { AuditService } from '../audit/audit.service';
import { summarize } from './billing.service';

/**
 * غنی‌سازیِ مراجعه — قانونِ computeVisit: فیلدهای مشتق فقط این‌جا ساخته می‌شوند
 * و کلاینت هیچ فرمولی در render ندارد. همهٔ مبالغ «تومان»اند.
 */
function enrich(v: any) {
  return {
    id: v.id,
    patientId: v.patientId,
    kind: v.kind,
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
    // شرحِ عمل حالا یک ClinicalNote است (نسخه‌دار و تغییرناپذیر)، ولی فرمِ مراجعه
    // همان یک فیلد را می‌بیند — تنها نسخهٔ جاری.
    opReport: v.clinicalNotes?.[0]?.body ?? null,
    opType: v.opType,
    opDate: v.opDate,
    opStatus: v.opStatus,
    // جمع‌های مالی از ردیف‌ها مشتق می‌شوند (قانونِ computeVisit)؛ هیچ render ای
    // اجازهٔ جمع‌زدن ندارد و هیچ ستونِ سرجمعی در DB نیست که از واقعیت عقب بماند.
    ...summarize(v.charges ?? [], v.payments ?? []),
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
  // فقط نسخهٔ جاریِ شرحِ عمل؛ تاریخچه از مسیرِ پروندهٔ بیمار خوانده می‌شود.
  clinicalNotes: {
    where: { kind: 'op', replacedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  // فقط مبلغ لازم است؛ کلِ ردیف‌ها را برای فهرستِ ۵۰۰تایی نمی‌کشیم.
  charges: { select: { amount: true } },
  payments: { select: { amount: true } },
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

  /// لیستِ مراجعات — q روی نام/کد/موبایل/جراح/بیمارستان، status روی opStatus، kind روی نوعِ ملاقات
  async listVisits(q?: string, status?: string, user?: any, kind?: string) {
    const where: any = {};
    if (status && status !== 'all') where.opStatus = status;
    if (kind && kind !== 'all') where.kind = kind;
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
            { phone: { contains: toEnDigits(t) } },
            // کد ملی مطمئن‌ترین راهِ یافتنِ پروندهٔ قبلی است؛ نبودش یعنی کاربر
            // پروندهٔ موجود را پیدا نمی‌کرد و دوباره «بیمار جدید» می‌زد.
            { nationalId: { contains: toEnDigits(t) } },
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
      nationalId: p.nationalId,
      visitCount: p._count.visits,
    }));
  }

  /// نامِ denormalizedِ جراح/بیمارستان + اعتبارسنجیِ وجودِ موجودیت‌ها
  private async resolveRefs(
    tx: any,
    dto: {
      surgeonId?: number | null;
      hospitalId?: number | null;
      techId?: number | null;
      procedureTypeId?: number | null;
      diagnosisId?: number | null;
    },
  ) {
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
    if (dto.procedureTypeId != null) {
      const pt = await tx.procedureType.findUnique({ where: { id: dto.procedureTypeId } });
      if (!pt) throw new NotFoundException('نوعِ عمل یافت نشد');
      out.procedureTypeId = pt.id;
      // opType آینهٔ متنیِ نوعِ عمل است تا گزارش‌های قدیمی نشکنند.
      out.opType = pt.name;
    }
    if (dto.diagnosisId != null) {
      const dg = await tx.diagnosis.findUnique({ where: { id: dto.diagnosisId } });
      if (!dg) throw new NotFoundException('تشخیص یافت نشد');
      out.diagnosisId = dg.id;
    }
    return out;
  }

  /**
   * نوشتنِ شرحِ عمل از فرمِ مراجعه.
   *
   * فرم یک textarea است ولی مقصد یک سندِ نسخه‌دار: متنِ تازه رکوردِ جدید می‌سازد و
   * قبلی `replacedAt` می‌گیرد، هرگز بازنویسی نمی‌شود. خالی‌کردنِ فیلد یعنی
   * «این شرح دیگر جاری نیست»، نه «هیچ‌وقت نوشته نشده بود».
   */
  private async setOpReport(tx: any, visit: { id: number; patientId: number }, body: string | null, user: any) {
    const current = await tx.clinicalNote.findFirst({
      where: { visitId: visit.id, kind: 'op', replacedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const text = body?.trim() || null;
    if (current?.body === text) return;
    if (!text && !current) return;

    if (current) await tx.clinicalNote.update({ where: { id: current.id }, data: { replacedAt: new Date() } });
    if (text) {
      await tx.clinicalNote.create({
        data: {
          patientId: visit.patientId,
          visitId: visit.id,
          kind: 'op',
          body: text,
          authorId: user?.id ?? null,
          authorName: actorName(user),
          replacesId: current?.id ?? null,
        },
      });
    }
  }

  /**
   * پیداکردنِ پروندهٔ بیمار بر اساسِ کدِ ملی — قلبِ قاعدهٔ «هر کد ملی، یک پرونده».
   *
   * سه حالت:
   *  • نبود                → پروندهٔ تازه
   *  • بود و نام‌خانوادگی یکی → همان پرونده، مراجعهٔ بعدی
   *  • بود و نام‌خانوادگی فرق داشت → توقف با ۴۰۹
   *
   * حالتِ سوم عمداً خودکار حل نمی‌شود: یا کدِ ملی اشتباه تایپ شده یا واقعاً دو
   * نفرند؛ هر دو حالت تصمیمِ انسانی می‌خواهد. این همان مرحلهٔ stewardship در MPI
   * است — ادغامِ خودکارِ هویت، خطایی است که بعداً قابلِ برگرداندن نیست.
   */
  private async findByNationalId(tx: any, nationalId: string, lastName: string) {
    const existing = await tx.patient.findUnique({ where: { nationalId } });
    if (!existing) return null;

    const same = existing.lastName.trim() === lastName.trim();
    if (!same) {
      throw new ConflictException(
        `این کد ملی به پروندهٔ «${existing.code} — ${existing.firstName} ${existing.lastName}» تعلق دارد.` +
          ' اگر همان بیمار است، از فهرست انتخابش کنید؛ وگرنه کد ملی را بررسی کنید.',
      );
    }

    // پرونده‌ای که soft-delete شده بود با مراجعهٔ جدید برمی‌گردد؛ ساختنِ پروندهٔ
    // دوم با همان کد ملی هم ممکن نیست (ایندکسِ یکتا) و هم غلط است.
    if (existing.deletedAt) {
      await tx.patient.update({
        where: { id: existing.id },
        data: { deletedAt: null, deletedById: null, deleteReason: null },
      });
      return { patient: existing, restored: true };
    }
    return { patient: existing, restored: false };
  }

  /**
   * ثبتِ مراجعه.
   *
   * سه مسیر دارد و هر سه به یک پرونده ختم می‌شوند:
   *  • patientId داده شده        → مراجعهٔ جدید روی همان پرونده
   *  • کد ملی به پرونده‌ای خورد → همان پرونده (بدونِ ساختنِ پروندهٔ دوم)
   *  • هیچ‌کدام                  → پروندهٔ تازه با کدِ AM-NNNN
   *
   * خروجی `patientStatus` را حمل می‌کند تا کلاینت در toast بگوید «پروندهٔ
   * AM-0012 — مراجعهٔ ۳» و کاربر بفهمد ثبتِ دوباره پروندهٔ تکراری نساخته است.
   */
  async createVisit(dto: CreateVisitDto, user?: any) {
    const userId: number | undefined = user?.id;
    const { visit: v, patientStatus } = await this.prisma.$transaction(async (tx) => {
      let patientId = dto.patientId;
      let patientStatus: 'existing' | 'matched' | 'restored' | 'new' = 'existing';
      if (patientId) {
        const p = await tx.patient.findUnique({ where: { id: patientId } });
        if (!p) throw new NotFoundException('بیمار پیدا نشد');
        // ویرایشِ ضمنیِ پرونده ممنوع است، ولی کدِ ملیِ خالی را کامل می‌کنیم.
        if (dto.nationalId && !p.nationalId) {
          await tx.patient.update({ where: { id: p.id }, data: { nationalId: dto.nationalId } });
        }
      } else {
        const match = dto.nationalId
          ? await this.findByNationalId(tx, dto.nationalId, dto.lastName!)
          : null;

        if (match) {
          patientId = match.patient.id;
          patientStatus = match.restored ? 'restored' : 'matched';
          // شماره و تاریخِ تولدِ تازه فقط جاهای خالی را پر می‌کنند، نه بازنویسی.
          const fill: any = {};
          if (dto.phone && !match.patient.phone) fill.phone = dto.phone;
          if (dto.birthDate && !match.patient.birthDate) fill.birthDate = new Date(dto.birthDate);
          if (Object.keys(fill).length) await tx.patient.update({ where: { id: patientId }, data: fill });
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
          patientStatus = 'new';
        }
      }
      const refs = await this.resolveRefs(tx, dto);
      const max = await tx.visit.aggregate({ where: { patientId }, _max: { seq: true } });
      const seq = (max._max.seq ?? 0) + 1;
      const visit = await tx.visit.create({
        data: {
          patientId,
          seq,
          kind: dto.kind || 'surgery',
          ...refs,
          // اگر نوعِ عمل انتخاب شده باشد، opType را resolveRefs گذاشته است.
          ...(refs.opType === undefined ? { opType: dto.opType?.trim() || null } : {}),
          opDate: dto.opDate ? new Date(dto.opDate) : null,
          notes: dto.notes || null,
          createdById: userId ?? null,
        },
        include: INCLUDE_PATIENT,
      });
      if (dto.opReport?.trim()) {
        await this.setOpReport(tx, visit, dto.opReport, user);
        visit.clinicalNotes = await tx.clinicalNote.findMany({
          where: { visitId: visit.id, kind: 'op', replacedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
        });
      }
      return { visit, patientStatus };
    });
    const result = { ...enrich(v), patientStatus };
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
      if (dto.procedureTypeId === null) { visitPatch.procedureTypeId = null; visitPatch.opType = null; }
      if (dto.diagnosisId === null) visitPatch.diagnosisId = null;
      // متنِ آزاد فقط وقتی خوانده می‌شود که نوعِ عمل انتخاب نشده باشد.
      if (dto.opType !== undefined && visitPatch.opType === undefined) {
        visitPatch.opType = dto.opType?.trim() || null;
      }
      if (dto.opDate !== undefined) visitPatch.opDate = dto.opDate ? new Date(dto.opDate) : null;
      if (dto.kind !== undefined) visitPatch.kind = dto.kind;
      if (dto.notes !== undefined) visitPatch.notes = dto.notes || null;

      if (Object.keys(patientPatch).length) {
        await tx.patient.update({ where: { id: v.patientId }, data: patientPatch });
      }
      if (dto.opReport !== undefined) {
        await this.setOpReport(tx, { id, patientId: v.patientId }, dto.opReport, user);
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
