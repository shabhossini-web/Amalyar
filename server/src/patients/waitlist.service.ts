import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { AuditService } from '../audit/audit.service';
import { canAccess } from '../auth/access-check';
import { isScoped, scopedVisitWhere } from '../common/own-scope';
import { CANCEL_REASONS } from '../common/cancel-reasons';
import { clinicDateIso, clinicTodayIso, dayUtc } from '../common/clinic-day';
import { DECISION_CLOSE_LABELS, WAITLIST_LABELS } from './labels';
import { OTHER_DX, OTHER_PX, PROC_DETAIL_SELECT, diagnosisLabel, procedureLabel, procedureSidesText } from './visit-coding';

const DAY = 864e5;
const CAP = 300;
const person = { select: { person: { select: { firstName: true, lastName: true } } } } as const;
const nameOf = (r: any) => `${r?.person?.firstName ?? ''} ${r?.person?.lastName ?? ''}`.trim() || null;
/** روزِ مطب از یک لحظه — «امروز» همان تعریفِ واحدِ `clinic-day` است (بستهٔ ۵د). */
/* ستونِ تاریخ (opDate/plannedDate) خودش روزِ تقویمی است و نباید با منطقهٔ زمانیِ مطب
   یک روز عقب برود؛ فقط مهرِ زمانیِ واقعی (createdAt) به روزِ مطب برمی‌گردد (بازبینی). */
const dayOfDate = (d: Date) => dayUtc(d.toISOString().slice(0, 10));
const dayOfStamp = (d: Date) => dayUtc(clinicDateIso(d));
/** روزِ شروعِ انتظارِ یک ویزیتِ تصمیم: روزِ ویزیت، وگرنه روزِ ثبتش. */
const startDayOf = (d: { opDate: Date | null; createdAt: Date }) => (d.opDate ? dayOfDate(d.opDate) : dayOfStamp(d.createdAt));
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * **فهرستِ انتظارِ عمل** (بستهٔ ۹ج — بندِ «ه» گزارشِ HIS).
 *
 * سه وضعیت، همه **مشتق** (هیچ ستونِ وضعیتی ساخته نشد):
 *  - `awaiting`: ویزیتی «کاندیدای جراحی» زده و هنوز هیچ عملِ لغونشده‌ای برایش نیست —
 *    نه عملِ گره‌خورده (`decidedInVisitId`) و نه عملِ همان بیمار که بعد از تصمیم ساخته
 *    یا تاریخ خورده. عملِ فقط-لغوشده ردیف را برمی‌گرداند (بیمار هنوز برنامه می‌خواهد)
 *    با دلیلِ آخرین لغو. هر بیمار یک ردیف: تازه‌ترین تصمیمِ باز.
 *  - `planned`: عملِ ساخته‌شدهٔ `pending` بی‌`opDate` (حالتِ «هنوز تاریخ ندارد»).
 *  - `booked`: عملِ `pending` با تاریخِ امروز یا بعد.
 *
 * ⚠️ scope همان قاعدهٔ همه‌جا (`scopedVisitWhere`): زیرِ سوپروایزر فقط مراجعه‌ای که
 * جراح یا کارشناسش خودِ کاربر است — با `AND`، نه spread (جستجو صاحبِ `OR` است).
 */
@Injectable()
export class WaitlistService {
  constructor(private prisma: PrismaService, private config: ConfigService, private audit: AuditService) {}

  private async assertClinic() {
    if ((await this.config.profile()).kind !== 'clinic') throw new NotFoundException('فهرستِ انتظارِ عمل فقط در مطب است');
  }

  async list(user: any) {
    await this.assertClinic();
    const scope = scopedVisitWhere(user);
    const live = { patient: { deletedAt: null } };
    const todayIso = clinicTodayIso();
    const today = dayUtc(todayIso);
    const patientSel = { select: { id: true, code: true, firstName: true, lastName: true, phone: true } };
    const decisionSel = {
      id: true, seq: true, opDate: true, createdAt: true, patientId: true,
      surgeryDecisionClosedAt: true, surgeryDecisionCloseReason: true,
      diagnosis: { select: { title: true } }, otherDiagnoses: OTHER_DX,
    };

    /* ── ۱) تصمیم‌های باز ── */
    const decisions = await this.prisma.visit.findMany({
      where: {
        AND: [scope, live, {
          decisions: { has: 'surgery' }, kind: { not: 'surgery' },
          opStatus: { not: 'cancelled' },
          /* تصمیمی که عملِ زنده‌اش ثبت شده همین‌جا کنار می‌رود تا سقف روی تصمیم‌های
             واقعاً باز بنشیند — وگرنه طولانی‌ترین انتظارها از انتهای فهرست می‌افتادند (بازبینی).
             تصمیمِ بسته‌شده می‌ماند: تازه‌ترین تصمیمِ هر بیمار حکم می‌کند و تبِ «بسته‌شده» می‌سازد. */
          decided: { none: { opStatus: { not: 'cancelled' } } },
        }],
      },
      select: {
        ...decisionSel, surgeonId: true, surgeonName: true, surgeon: person,
        patient: patientSel,
        decided: { select: { id: true, opStatus: true, cancelReason: true, updatedAt: true } },
      },
      orderBy: [{ opDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: CAP + 1,
    });
    const decisionsTruncated = decisions.length > CAP;
    if (decisionsTruncated) decisions.length = CAP;
    /* عملِ لغونشدهٔ همان بیمار که بعد از تصمیم ساخته/تاریخ خورده — حتی بی‌پیوند
       (عملی که دستی از داشبورد ثبت شد). */
    const pids = [...new Set(decisions.map((d) => d.patientId))];
    const later = pids.length ? await this.prisma.visit.findMany({
      where: { patientId: { in: pids }, kind: 'surgery', opStatus: { not: 'cancelled' } },
      select: { patientId: true, opDate: true, createdAt: true },
    }) : [];
    const seenPatient = new Set<number>();
    const awaiting: any[] = [];
    for (const d of decisions) {
      if (seenPatient.has(d.patientId)) continue; // یک ردیف به‌ازای بیمار: تازه‌ترین تصمیم (باز یا بسته) حکم می‌کند
      const at = d.opDate ?? d.createdAt;
      const atDay = startDayOf(d);
      const linkedLive = d.decided.some((s) => s.opStatus !== 'cancelled');
      /* عملِ بی‌تاریخِ همان بیمار همیشه پوشش می‌دهد؛ عملِ تاریخ‌دار فقط اگر روی/بعد از روزِ
         تصمیم باشد — عملِ قدیمی‌ترِ بیمار «انجامِ این تصمیم» نیست (بازبینی). */
      const unlinkedLive = later.some((s) => s.patientId === d.patientId && (!s.opDate || dayOfDate(s.opDate) >= atDay));
      seenPatient.add(d.patientId);
      if (linkedLive || unlinkedLive) continue;
      const lastCancel = d.decided.filter((s) => s.opStatus === 'cancelled').sort((a, b) => +b.updatedAt - +a.updatedAt)[0];
      awaiting.push({
        key: `${d.surgeryDecisionClosedAt ? 'closed' : 'awaiting'}:${d.id}`, state: d.surgeryDecisionClosedAt ? 'closed' : 'awaiting',
        closedAt: d.surgeryDecisionClosedAt ?? null,
        closeReasonFa: d.surgeryDecisionCloseReason ? DECISION_CLOSE_LABELS[d.surgeryDecisionCloseReason] ?? null : null,
        patient: this.patientOf(d.patient),
        decision: { visitId: d.id, code: `${d.patient.code}-V${d.seq}`, date: at, diagnosis: diagnosisLabel(d) },
        surgery: null,
        surgeon: nameOf(d.surgeon) ?? d.surgeonName ?? null,
        /* برای «برنامهٔ عمل»: همان پزشکِ ویزیتِ تصمیم در فرمِ عمل. */
        surgeonId: d.surgeonId ?? null,
        waitStart: at, waitStartApprox: !d.opDate,
        lastCancelReasonFa: lastCancel?.cancelReason ? CANCEL_REASONS[lastCancel.cancelReason]?.label ?? null : null,
      });
    }

    /* ── ۲) عمل‌های ساخته‌شده و هنوز انجام‌نشده: بی‌تاریخ یا رزروشده ── */
    const surgeries = await this.prisma.visit.findMany({
      where: {
        AND: [scope, live, {
          kind: 'surgery', opStatus: 'pending',
          OR: [{ opDate: null }, { opDate: { gte: today } }],
        }],
      },
      select: {
        id: true, seq: true, opDate: true, plannedDate: true, createdAt: true, opType: true,
        procedureTypeId: true, procedureType: { select: { name: true } }, otherProcedures: OTHER_PX,
        procedureDetails: { select: PROC_DETAIL_SELECT },
        hospitalName: true, hospital: { select: { name: true } },
        surgeonName: true, surgeon: person,
        patient: patientSel,
        decidedIn: { select: decisionSel },
      },
      orderBy: [{ opDate: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: CAP + 1,
    });
    const surgeriesTruncated = surgeries.length > CAP;
    if (surgeriesTruncated) surgeries.length = CAP;
    const rowsS = surgeries.map((s) => {
      const d = s.decidedIn;
      const start = d ? (d.opDate ?? d.createdAt) : s.createdAt;
      const state = s.opDate ? 'booked' : 'planned';
      return {
        key: `surgery:${s.id}`, state,
        patient: this.patientOf(s.patient),
        decision: d ? { visitId: d.id, code: `${s.patient.code}-V${d.seq}`, date: d.opDate ?? d.createdAt, diagnosis: diagnosisLabel(d) } : null,
        surgery: {
          id: s.id, code: `${s.patient.code}-V${s.seq}`,
          procedure: procedureLabel(s), sides: procedureSidesText(s),
          hospital: s.hospital?.name ?? s.hospitalName ?? null,
          plannedDate: s.plannedDate ?? null, opDate: s.opDate ?? null,
        },
        surgeon: nameOf(s.surgeon) ?? s.surgeonName ?? null,
        waitStart: start,
        /* بی‌تصمیمِ پیوندخورده، شروعِ انتظار تاریخِ ثبتِ خودِ عمل است — تقریبی. */
        waitStartApprox: !d || !d.opDate,
        lastCancelReasonFa: null,
      };
    });

    const rows = [...awaiting, ...rowsS].map((r) => ({
      ...r,
      stateFa: WAITLIST_LABELS[r.state],
      waitingDays: Math.max(0, Math.round((+today - +(r.waitStartApprox ? dayOfStamp : dayOfDate)(new Date(r.waitStart))) / DAY)),
    })).sort((a, b) => b.waitingDays - a.waitingDays || a.key.localeCompare(b.key));

    const [plan, edit, manage] = await Promise.all([
      canAccess(this.prisma, user, 'dashboard', ['patients.create']).catch(() => false),
      canAccess(this.prisma, user, 'dashboard', ['patients.update']).catch(() => false),
      canAccess(this.prisma, user, 'waitlist', ['waitlist.manage']).catch(() => false),
    ]);
    return {
      rows,
      stats: await this.stats(rows, scope, live, today),
      can: { plan, edit, manage },
      scoped: isScoped(user),
      truncated: decisionsTruncated || surgeriesTruncated,
      cap: CAP,
    };
  }

  /**
   * آمار با **همان scope**ِ ردیف‌ها: شمارِ هر وضعیت، میانهٔ انتظارِ فعلی، و فاصلهٔ
   * تصمیم تا عمل روی عمل‌های انجام‌شدهٔ ۱۸۰ روزِ اخیر که به تصمیمشان گره خورده‌اند
   * (`n` کنارش — میانهٔ سه عمل با میانهٔ سیصد عمل یک وزن ندارد).
   */
  private async stats(rows: any[], scope: any, live: any, today: Date) {
    const count = (st: string) => rows.filter((r) => r.state === st).length;
    const done = await this.prisma.visit.findMany({
      where: {
        AND: [scope, live, {
          kind: 'surgery', opStatus: 'done', decidedInVisitId: { not: null },
          opDate: { gte: new Date(+today - 180 * DAY), lte: today },
        }],
      },
      select: { opDate: true, decidedIn: { select: { opDate: true, createdAt: true } } },
      take: 2000,
    });
    const gaps = done
      .filter((s) => s.opDate && s.decidedIn)
      .map((s) => Math.max(0, Math.round((+dayOfDate(s.opDate!) - +startDayOf(s.decidedIn!)) / DAY)));
    return {
      awaiting: count('awaiting'), closed: count('closed'), planned: count('planned'), booked: count('booked'),
      medianWaitDays: median(rows.map((r) => r.waitingDays)),
      decisionToSurgery: { medianDays: median(gaps), n: gaps.length },
    };
  }

  private patientOf(p: any) {
    return { id: p.id, code: p.code, fullName: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim(), phone: p.phone ?? null };
  }

  /** بستنِ تصمیمِ جراحیِ بی‌عمل — بیمار نخواست، جای دیگر عمل کرد، … (برگشت‌پذیر). */
  async closeDecision(visitId: number, reason: string, user: any) {
    await this.assertClinic();
    if (!DECISION_CLOSE_LABELS[reason]) throw new BadRequestException('دلیلِ بستن را انتخاب کنید');
    const v = await this.decisionVisit(visitId, user);
    if (v.surgeryDecisionClosedAt) throw new BadRequestException('این تصمیم قبلاً بسته شده است');
    await this.prisma.visit.update({
      where: { id: visitId }, data: { surgeryDecisionClosedAt: new Date(), surgeryDecisionCloseReason: reason },
    });
    await this.audit.record({ actorId: user?.id, action: 'visit.decision_close', entityType: 'visit', entityId: visitId, after: { reason } });
    return { ok: true, reason, reasonFa: DECISION_CLOSE_LABELS[reason] };
  }

  async reopenDecision(visitId: number, user: any) {
    await this.assertClinic();
    const v = await this.decisionVisit(visitId, user);
    if (!v.surgeryDecisionClosedAt) return { ok: true };
    await this.prisma.visit.update({ where: { id: visitId }, data: { surgeryDecisionClosedAt: null, surgeryDecisionCloseReason: null } });
    await this.audit.record({
      actorId: user?.id, action: 'visit.decision_reopen', entityType: 'visit', entityId: visitId,
      before: { reason: v.surgeryDecisionCloseReason },
    });
    return { ok: true };
  }

  private async decisionVisit(visitId: number, user: any) {
    const v = await this.prisma.visit.findFirst({
      where: { AND: [scopedVisitWhere(user), { id: visitId, patient: { deletedAt: null } }] },
      select: { id: true, decisions: true, surgeryDecisionClosedAt: true, surgeryDecisionCloseReason: true },
    });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    if (!v.decisions.includes('surgery')) throw new BadRequestException('در این مراجعه تصمیمِ جراحی ثبت نشده است');
    return v;
  }
}
