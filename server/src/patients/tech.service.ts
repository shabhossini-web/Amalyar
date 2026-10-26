import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../work/events.service';
import { isUnrestricted } from '../common/own-scope';
import { PatientsService } from './patients.service';
import { RecordService } from './record.service';
import { clinicDateIso, dayUtc } from '../common/clinic-day';
import { HospitalDutiesService } from './hospital-duties.service';
import { RoutesService } from './routes.service';
import { deliveryState, handoverOf, receiptOf } from './handover';
import { OTHER_PX, procedureLabel } from './visit-coding';
import { ServiceCrewService, crewView } from './service-crew.service';
import { currentMember } from './crew-sync';
import { transportDevices } from './device-link';
import { withSharedTransfers } from './shared-transfers';

const DAY = 24 * 60 * 60 * 1000;

/**
 * بازهٔ «روزِ مطب»ِ حاوی `at` — همان تعریفِ `common/clinic-day.ts` که پذیرش (`assign`)،
 * «امروز» و میزِ پذیرش دارند.
 *
 * ⚠️ نسخهٔ قبلی روز را از **تاریخِ UTC** می‌ساخت. بینِ نیمه‌شب تا ۳:۳۰ صبحِ تهران
 * «امروز»ِ این پنل روزِ **قبل** بود، در حالی که پذیرشِ همان ردیف روزِ گذشته را رد
 * می‌کرد — کارشناسِ شب‌کار عملِ امروزش را نمی‌دید و عملِ دیروز را نمی‌توانست بپذیرد.
 */
function dayBounds(at: Date): [Date, Date] {
  const from = dayUtc(clinicDateIso(at));
  return [from, new Date(from.getTime() + DAY)];
}

const fullName = (p?: { firstName: string; lastName: string } | null) =>
  (p ? [p.firstName, p.lastName].filter(Boolean).join(' ') : null);

import { reportTitle, workLabel } from './report-title';
export { reportTitle };

/**
 * دامنهٔ دفترِ کار — **یک تعریف** برای خواندن و نوشتن.
 *
 * کارشناس: فقط عمل‌هایی که خودش کارشناسشان است (از توکن، نه از ورودی).
 * سوپرادمین (`isUnrestricted`، خواستهٔ مالک ۱۴۰۵/۰۷/۰۳): عملِ **هر** کارشناسی،
 * به‌شرطِ اینکه بیمارش حذف نشده باشد — **حتی اگر هنوز کارشناسی نداشته باشد**
 * (مراجعهٔ بی‌کارشناس در «مالِ همه» می‌آید و کارت «بدون کارشناس» می‌گوید). تا امروز فهرستش همه را نشان می‌داد ولی
 * نوشتن‌ها فقط `techId = user.id` را می‌پذیرفتند و هر دکمه «این عمل در کارهای
 * شما نیست» می‌داد — دو تعریف برای یک دامنه. حالا فهرست، ثبتِ ساعت، گزارش و
 * ردیفِ برگشتی همه همین را می‌خوانند.
 *
 * ⚠️ یک خط و بی‌ویرگول بینِ دو شاخه، عمداً: نگهبانِ CI («tech portal shows work,
 * never money») هر مقداردهیِ `techId` در این فایل را تا اولین ویرگول می‌خوانَد و
 * می‌خواهد `user?.id` در آن باشد — یعنی دامنه از توکن می‌آید نه از ورودی. شاخهٔ
 * سوپرادمین هم هیچ شناسه‌ای از ورودی نمی‌گیرد.
 */
/* عضوِ تیمِ کارشناسیِ فرمِ خدمت هم این عمل را در پنلش می‌بیند (نه فقط کارشناسِ اول). */
const visitScope = (user: any) => (isUnrestricted(user) ? { patient: { deletedAt: null } }
  : { OR: [{ techId: user?.id ?? -1 }, { crew: { some: { accountId: user?.id ?? -1 } } }] });

/** نمای پروجکت‌شدهٔ هر عمل — همان چیزی که `shape` می‌شناسد، و نه یک فیلدِ بیشتر. */
const VISIT_SELECT = {
  id: true, seq: true, kind: true, service: true, opDate: true, opStatus: true,
  opStartTime: true, opEndTime: true, techArriveTime: true,
  surgeonName: true, hospitalName: true, opType: true,
  patient: { select: { id: true, code: true, firstName: true, lastName: true } },
  surgeon: { select: { person: { select: { firstName: true, lastName: true } } } },
  tech: { select: { id: true, person: { select: { firstName: true, lastName: true } } } },
  hospital: { select: { name: true, address: true } },
  procedureType: { select: { name: true } },
  // بستهٔ ۷ج: فقط نامِ عمل‌های همزمان، برای برچسب — هیچ فیلدِ دیگری.
  otherProcedures: OTHER_PX,
  /* گزارشِ حذف‌شده «ثبت شده» نیست — همان فیلترِ فرمِ خدمت. */
  documents: { where: { category: 'report', deletedAt: null }, select: { id: true, createdAt: true } },
  /* تیم و دستگاهِ پرونده — همان داده‌ای که فرمِ خدمت و چینش می‌خوانند (`crew-sync`). */
  hospitalId: true,
  crew: { orderBy: { sort: 'asc' }, select: { accountId: true, fromTime: true, toTime: true, sort: true, source: true, handedFromId: true, account: { select: { status: true, person: { select: { firstName: true, lastName: true } } } } } },
  deviceLot: { select: { id: true, serialNo: true, lotNo: true, item: { select: { name: true, size: true } } } },
  // بستهٔ ج: مصرفیِ ثبت‌شدهٔ همین عمل — فقط برای خلاصهٔ روی کارت.
  usages: { where: { quantity: { gt: 0 } }, select: { mode: true, quantity: true, updatedAt: true, item: { select: { name: true, size: true, unit: true } } } },
  stockTransfers: {
    where: { status: { not: 'closed' } },
    orderBy: { id: 'asc' },
    select: {
      id: true, code: true, status: true, toLocation: true,
      releasedAt: true, windowFrom: true, windowTo: true,
      // تحویلِ دوطرفه: دستِ اول (توقفِ راننده) و دستِ دوم (رسیدِ خودِ کارشناس).
      techReceivedAt: true, techReceiptIssue: true, techReceiptNote: true,
      stop: {
        select: {
          kind: true, doneAt: true, handedTo: true, handedActual: true,
          run: { select: { staff: { select: { role: true, person: { select: { firstName: true, lastName: true } } } } } },
        },
      },
      // حوالهٔ برنامه‌ریزی‌شده (تختهٔ روز) هنوز حرکتی ندارد؛ قلم‌هایش این‌جاست.
      plannedLines: true,
      movements: {
        where: { kind: 'transfer', quantity: { gt: 0 } },
        select: {
          quantity: true,
          lot: { select: { serialNo: true, lotNo: true, item: { select: { name: true, size: true, assetKind: true } } } },
        },
      },
    },
  },
} as const;

export type AgendaScope = 'today' | 'upcoming' | 'past';

/**
 * دفترِ کارِ کارشناس.
 *
 * ⚠️ **این سرویس عمداً آبجکتِ مراجعه را برنمی‌گرداند.** فهرستِ داشبورد مبلغ،
 * پرداختی، مانده و سهم‌ها را با خود می‌آورد؛ اگر همان را با یک فیلترِ `techId`
 * به پنلِ کارشناسی می‌دادیم، رقمِ قراردادِ جراح از اولین صفحه‌ای که کسی رندر
 * می‌کند بیرون می‌زد. پس این‌جا یک **نمای پروجکت‌شده** ساخته می‌شود: هرچه
 * کارشناسِ سرِ عمل لازم دارد، و نه یک فیلدِ بیشتر. همان قاعده‌ای که ابلاغِ
 * راننده را بی‌اطلاعاتِ بیمار کرد.
 *
 * ⚠️ دامنه خودِ کاربر است، حتی برای سوپروایزر و ادمین: مدیر برای دیدنِ کارِ
 * دیگران تختهٔ چینش را دارد، و این endpoint هیچ‌وقت `techId`ِ دلخواه از ورودی
 * نمی‌پذیرد. **تنها استثنا سوپرادمین است** (`visitScope`): او بی‌محدودیت است و
 * همهٔ کارشناسان را با نامِ هر کدام می‌بیند و هر کاری را از طرفِ صاحبِ همان
 * ردیف انجام می‌دهد — بی‌آنکه پروفایل عوض کند. پاسخ این را با `team: true`
 * می‌گوید و رابط سطح را خودش حساب نمی‌کند (قانونِ ۳).
 */
@Injectable()
export class TechService {
  constructor(
    private prisma: PrismaService,
    private patients: PatientsService,
    private record: RecordService,
    private duties: HospitalDutiesService,
    private events: EventsService,
    /* اختیاری: بی‌آن حوالهٔ برنامه‌ریزی‌شده بی‌نامِ کالا می‌ماند (رفتارِ پیش از ۱۴۰۵/۰۷/۰۹). */
    private routes?: RoutesService,
    /* آخر، چون سوییت‌های e2e این سرویس را با آرگومانِ جایگاهی می‌سازند (`delivery-handshake`). */
    private crew?: ServiceCrewService,
  ) {}

  private range(scope: AgendaScope): [Date, Date] {
    const [start, end] = dayBounds(new Date());
    if (scope === 'upcoming') return [end, new Date(end.getTime() + 21 * DAY)];
    if (scope === 'past') return [new Date(start.getTime() - 30 * DAY), start];
    return [start, end];
  }

  async agenda(user: any, scope: AgendaScope = 'today') {
    const [from, to] = this.range(scope);
    const team = isUnrestricted(user);
    const rows = await this.prisma.visit.findMany({
      where: {
        ...visitScope(user),
        opDate: { gte: from, lt: to },
        // عملِ لغوشده کارِ امروزِ کسی نیست؛ ولی در «گذشته» می‌ماند تا کارشناس
        // بداند چرا آن روز خالی بوده.
        ...(scope === 'past' ? {} : { opStatus: { not: 'cancelled' } }),
      },
      orderBy: [{ opDate: scope === 'past' ? 'desc' : 'asc' }, { opStartTime: 'asc' }, { id: 'asc' }],
      select: VISIT_SELECT,
    });
    /* ستِ عمومیِ «بیمارستان + روز» روی کارتِ همهٔ بیمارانِ همان‌جا (`shared-transfers`). */
    await withSharedTransfers(this.prisma, rows, { select: VISIT_SELECT.stockTransfers.select, where: VISIT_SELECT.stockTransfers.where });
    await this.routes?.withPlannedLots(rows.flatMap((v: any) => v.stockTransfers));
    /* برنامهٔ حضور: کارشناس فقط ردیفِ خودش، سوپرادمین ردیفِ همه — هر کدام با
       نامِ صاحبش، تا «پذیرش» به نامِ همان کارشناس بنشیند نه به نامِ ناظر. */
    const duties = scope === 'past' ? [] : await this.prisma.hospitalDuty.findMany({
      where: { ...(team ? {} : { techId: user?.id ?? -1 }), date: { gte: from, lt: to }, tech: { status: 'active' } },
      include: { hospital: { select: { name: true } }, tech: { select: { person: { select: { firstName: true, lastName: true } } } } },
      orderBy: [{ date: 'asc' }, { arriveTime: 'asc' }, { id: 'asc' }],
    });
    const pool = duties.length ? await this.prisma.visit.findMany({
      where: { techId: null, opStatus: 'pending', patient: { deletedAt: null }, OR: duties.map(d => ({ hospitalId: d.hospitalId, opDate: { gte: d.date, lt: new Date(d.date.getTime() + DAY) } })) },
      select: { id: true, seq: true, opDate: true, opStartTime: true, hospitalId: true, patient: { select: { code: true, firstName: true, lastName: true } }, opType: true, procedureType: { select: { name: true } }, otherProcedures: OTHER_PX },
      orderBy: [{ opDate: 'asc' }, { opStartTime: 'asc' }],
    }) : [];
    return {
      scope, from, to,
      /* «امروز»ِ مطب — رابط «شروع شد» و «عملِ آینده» را با همین می‌سنجد، نه با ساعتِ گوشی. */
      today: clinicDateIso(),
      team,
      visits: rows.map((v) => this.shape(v, team, user?.id ?? null, user?.level ?? 0)),
      hospitals: duties.map(d => ({
        id: d.id, hospitalId: d.hospitalId, name: d.hospital.name, date: d.date, arriveTime: d.arriveTime,
        // نمای سرپرستی: «حضورِ کیست» — کلیدِ فیلتر و نامِ روی کارت.
        ...(team ? { ownerId: d.techId, techName: fullName(d.tech.person) } : {}),
        openVisits: pool.filter(v => v.hospitalId === d.hospitalId && v.opDate!.toISOString().slice(0, 10) === d.date.toISOString().slice(0, 10)).map(v => ({ id: v.id, name: `${v.patient.firstName} ${v.patient.lastName}`.trim(), code: `${v.patient.code}-V${v.seq}`, opStartTime: v.opStartTime, procedure: procedureLabel(v) })),
      })),
    };
  }

  /**
   * پذیرشِ مراجعهٔ آزادِ بیمارستانِ محلِ حضور.
   *
   * کارشناس: به نامِ خودش — همان رفتارِ همیشه.
   * سوپرادمین: به نامِ **صاحبِ همان برنامهٔ حضوری** که مراجعه زیرِ کارتش آمده.
   * رابط `dutyId` را از کارتِ حضور می‌فرستد و کارشناس از **ردیفِ همان برنامه**
   * خوانده می‌شود، نه از ورودی؛ پس نه ناظر به‌جای کارشناس می‌نشیند و نه
   * شناسهٔ دلخواهی راهِ دومی برای انتساب می‌سازد. `assign` همان قیدهای همیشه
   * (آزاد، امروز یا بعد، کارشناسِ فعال در برنامهٔ همان بیمارستان و روز) و همان
   * ردِ ممیزی (بازیگر = سوپرادمین) را دارد.
   */
  async claim(id: number, dutyId: number | undefined, user: any) {
    const team = isUnrestricted(user);
    /* سوپرادمین خودش کارشناسِ برنامه نیست؛ «به نامِ خودم» برای او یعنی خطای
       گنگِ «این کارشناس در برنامه نیست» — پس صریح گفته می‌شود چه بفرستد. */
    if (dutyId == null && team) throw new BadRequestException('برای پذیرش، کارتِ حضورِ کارشناسی را که مراجعه به نامش ثبت شود انتخاب کنید');
    if (dutyId == null) return this.duties.assign(id, user.id, user, true);
    if (!team) throw new ForbiddenException('پذیرش به نامِ کارشناسِ دیگر فقط برای سوپرادمین باز است');
    const duty = await this.prisma.hospitalDuty.findUnique({
      where: { id: dutyId },
      include: { tech: { select: { person: { select: { firstName: true, lastName: true } } } } },
    });
    if (!duty) throw new NotFoundException('این برنامهٔ حضور پیدا نشد');
    const visit = await this.prisma.visit.findFirst({ where: { id, patient: { deletedAt: null } }, select: { hospitalId: true, opDate: true } });
    // مراجعهٔ ناموجود یا حذف‌شده «پیدا نشد» است، نه «بیمارستان و تاریخ را مشخص کنید»ِ `assign`.
    if (!visit) throw new NotFoundException('این مراجعه پیدا نشد');
    if (visit.hospitalId !== duty.hospitalId || visit.opDate?.toISOString().slice(0, 10) !== duty.date.toISOString().slice(0, 10)) {
      throw new BadRequestException('این مراجعه در بیمارستان و روزِ همین برنامهٔ حضور نیست');
    }
    await this.duties.assign(id, duty.techId, user, true);
    return { ok: true, techName: fullName(duty.tech.person) };
  }

  /** تنها شکلی که پنلِ کارشناسی می‌شناسد — هیچ عددِ مالی‌ای در آن نیست. */
  private shape(v: any, team = false, viewerId: number | null = null, viewerLevel = 0) {
    const person = v.surgeon?.person;
    return {
      id: v.id,
      code: `${v.patient.code}-V${v.seq}`,
      kind: v.kind,
      status: v.opStatus,
      opDate: v.opDate,
      opStartTime: v.opStartTime,
      opEndTime: v.opEndTime,
      techArriveTime: v.techArriveTime,
      // نامِ بیمار می‌ماند: کارشناس سرِ عملِ همین بیمار حاضر است و بدونِ نام
      // نمی‌داند سراغِ کدام اتاق برود. سابقهٔ بالینی‌اش اما این‌جا نیست.
      patientName: [v.patient.firstName, v.patient.lastName].filter(Boolean).join(' '),
      /* برای نمای سرپرستی — کارشناسِ خودش نامِ خودش را لازم ندارد ولی
         سوپرادمین باید بداند هر ردیف مالِ کیست. */
      techName: fullName(v.tech?.person),
      // کلیدِ «مالِ کیست» برای فیلترِ نفر — فقط در نمای سرپرستی.
      ...(team ? { ownerId: v.tech?.id ?? null } : {}),
      surgeonName: person ? [person.firstName, person.lastName].filter(Boolean).join(' ') : v.surgeonName,
      hospitalName: v.hospital?.name ?? v.hospitalName,
      hospitalAddress: v.hospital?.address ?? null,
      /* برچسبِ همهٔ عمل‌های جلسه (اصلی اول) — کارشناس باید بداند برای چه عمل‌هایی می‌رود. */
      procedure: procedureLabel(v),
      reportAt: v.documents[0]?.createdAt ?? null,
      /* تیمِ این بیمار — زنجیرهٔ پذیرش و تحویل؛ `mine` = مسئولِ فعلی خودِ همین کاربر است. */
      crew: crewView(v.crew).map((c) => ({ ...c, mine: c.accountId === viewerId })),
      canHandover: (() => { const cur = currentMember(v.crew as any[]); return !!cur && !cur.toTime && (team || cur.accountId === viewerId || viewerLevel >= 3); })(),
      device: v.deviceLot ? { lotId: v.deviceLot.id, name: [v.deviceLot.item.name, v.deviceLot.item.size].filter(Boolean).join(' '), serialNo: v.deviceLot.serialNo ?? v.deviceLot.lotNo ?? null } : null,
      /* نامِ گزارشِ همین خدمت از سرور (قانونِ ۱۵) — «گزارشِ نورومانیتورینگ»، نه «گزارشِ عمل». */
      reportLabel: reportTitle(v.service),
      /* «شروعِ نورومانیتورینگ» / «شروعِ عمل» — ساعت‌های شروع/پایان در شرکتی یعنی همان خدمت. */
      workLabel: workLabel(v.service),
      isService: workLabel(v.service) !== 'عمل',
      /* بستهٔ ج: خلاصهٔ مصرفیِ ثبت‌شده + «می‌شود شروع کرد؟» — تا ستی منتظرِ تأییدِ کارشناس است، نه
         (ستی که نگرفته‌ای مصرف ندارد). متن را رابط می‌سازد، عدد و حالت از این‌جا (قانونِ ۱۵). */
      usage: {
        recordedAt: v.usages.reduce((m: Date | null, u: any) => (!m || u.updatedAt > m ? u.updatedAt : m), null),
        lines: v.usages.map((u: any) => ({ name: [u.item.name, u.item.size].filter(Boolean).join(' '), unit: u.item.unit, mode: u.mode, quantity: u.quantity })),
        canRecord: !v.stockTransfers.some((t: any) => deliveryState(t, t.stop) === 'awaiting'),
      },
      transfers: v.stockTransfers.map((t: any) => ({
        id: t.id,
        /* ستِ عمومیِ بیمارستان در این روز — مالِ همهٔ بیمارانِ همان‌جا، نه فقط این یکی. */
        shared: !!t.shared,
        code: t.code,
        status: t.status,
        toLocation: t.toLocation,
        releasedAt: t.releasedAt,
        windowFrom: t.windowFrom,
        windowTo: t.windowTo,
        /* تحویلِ دوطرفه (مالک، ۱۴۰۵/۰۷/۱۱): «راننده … تحویل داد» و «تحویل گرفتم»ِ خودِ کارشناس —
           وضعیت را سرور می‌سازد (`handover.ts`)، رابط فقط برچسب می‌زند. */
        delivery: deliveryState(t, t.stop),
        handover: handoverOf(t.stop),
        receipt: receiptOf(t),
        /* ⚠️ حوالهٔ planned (تختهٔ روز) حرکتی ندارد — بی‌این شاخه کارشناس فقط «HV-…، هنوز ارسال
           نشده» می‌دید و نمی‌دانست چه ستی برایش می‌آید (۱۴۰۵/۰۷/۰۹). */
        items: t.status === 'planned' && this.routes
          ? this.routes.linesOf(t).map((l: any) => ({ quantity: l.quantity, name: l.itemName, assetKind: l.assetKind, serialNo: l.serialNo ?? null }))
          : t.movements
            .filter((m: any) => m.lot)
            .map((m: any) => ({
              quantity: m.quantity,
              name: [m.lot.item.name, m.lot.item.size].filter(Boolean).join(' '),
              assetKind: m.lot.item.assetKind,
              serialNo: m.lot.serialNo ?? m.lot.lotNo ?? null,
            })),
      })),
    };
  }

  /** «این عمل مالِ دفترِ شما نیست» — برای سوپرادمین بی‌«شما»، چون دفترِ همه را دارد. */
  private notInScope(user: any) {
    return new NotFoundException(isUnrestricted(user) ? 'این عمل پیدا نشد یا هنوز کارشناس ندارد' : 'این عمل در کارهای شما نیست');
  }

  private async ownVisit(id: number, user: any) {
    const v = await this.prisma.visit.findFirst({
      where: { id, ...visitScope(user) },
      select: { id: true, patientId: true },
    });
    if (!v) throw this.notInScope(user);
    return v;
  }

  /**
   * ساعتِ واقعیِ عمل.
   *
   * منطق و audit از `PatientsService.setTimes` می‌آید — یک قاعده برای نرمال‌سازیِ
   * ساعت، نه دو. ⚠️ ولی **خروجی‌اش دور ریخته می‌شود**: آن تابع آبجکتِ کاملِ
   * مراجعه را برمی‌گرداند و همان مبلغ و سهمی را دارد که این پنل نباید ببیند.
   */
  async setTimes(id: number, dto: any, user: any) {
    await this.ownVisit(id, user);
    await this.patients.setTimes(id, dto, user, true);
    return this.one(id, user);
  }

  /**
   * **وضعیتِ عمل از پنلِ کارشناسی** — انجام شد / موکول شد / لغو شد (مالک، ۱۴۰۵/۰۷/۰۵).
   *
   * کارِ «وضعیتِ عمل ثبت نشده — انجام شد یا موکول؟» از قبل به نامِ خودِ کارشناس ساخته می‌شد
   * (`work-rules`) ولی پنلش هیچ دکمه‌ای برای انجامش نداشت؛ فقط سوپروایزر به بالا از داشبورد
   * می‌توانست. منطق همان است که داشبورد دارد — `setStatus` (رویداد، دلیلِ لغو و پیامکش،
   * یادآوری‌ها) و `postpone` — و این‌جا فقط دامنه و قیدِ «از در انتظار» اضافه می‌شود.
   *
   * ⚠️ فقط از `pending`: برگرداندنِ «انجام شد» یا «لغو» کارِ مدیر است، نه دکمه‌ای که روی
   * گوشیِ کارشناس با یک لمسِ اشتباه عملِ انجام‌شده را دوباره باز کند.
   * ⚠️ خروجیِ `PatientsService` دور ریخته می‌شود (همان دلیلِ `setTimes`): مبلغ و سهم دارد.
   */
  async setStatus(id: number, dto: { status: string; opDate?: string | null; cancelReason?: string; cancelNote?: string }, user: any) {
    await this.ownVisit(id, user);
    const cur = await this.prisma.visit.findUnique({ where: { id }, select: { opStatus: true } });
    if (cur?.opStatus !== 'pending') {
      throw new BadRequestException('وضعیتِ این عمل قبلاً ثبت شده است؛ برای تغییرش با مدیر هماهنگ کنید');
    }
    if (dto.status === 'postponed') await this.patients.postpone(id, dto.opDate ?? null, user);
    else if (dto.status === 'done') await this.patients.setStatus(id, 'done', user);
    else if (dto.status === 'cancelled') {
      await this.patients.setStatus(id, 'cancelled', user, { reason: dto.cancelReason, note: dto.cancelNote });
    } else throw new BadRequestException('وضعیت نامعتبر است');
    return this.one(id, user);
  }

  /**
   * گزارش — دستهٔ `report` روی پروندهٔ همان بیمار.
   *
   * ⚠️ نامش «گزارشِ خدمت» است نه «گزارشِ عمل» (مالک، ۱۴۰۵/۰۷/۰۵): شرکت عمل انجام نمی‌دهد،
   * **خدمتی حینِ عمل** ارائه می‌کند و این گزارشِ همان خدمت است — برای بیمه و پرونده. «شرحِ
   * عمل» سندِ جراح در مطب است و هرگز با این یکی قاطی نمی‌شود.
   */
  async uploadReport(id: number, file: any, user: any) {
    const v = await this.ownVisit(id, user);
    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    const svc = await this.prisma.visit.findUnique({ where: { id }, select: { service: true } });
    await this.record.addDocument(
      v.patientId, file,
      { category: 'report', visitId: id, title: reportTitle(svc?.service) },
      user,
    );
    /* W2.2: گزارش آمد ← بستنِ «گزارشِ خدمت هنوز بارگذاری نشده» (work-rules: report.uploaded). */
    await this.events.emit({ type: 'report.uploaded', visitId: id, patientId: v.patientId, actorId: user?.id ?? null });
    return this.one(id, user);
  }

  /**
   * ردیفِ همین عمل، به همان شکلِ فهرست — پس از هر نوشتن.
   *
   * ⚠️ مستقیم از همان دامنه و همان پروجکشن، نه با گشتنِ سه بازهٔ دفترِ کار: آن
   * راه برای سوپرادمین سه بار کلِ دفترِ همهٔ کارشناسان را می‌ساخت، و عملی که
   * بیرونِ بازه‌ها بود (گزارشِ عملِ دو ماه پیش) پس از نوشتنِ موفق ۴۰۴ می‌گرفت.
   */
  private async one(id: number, user: any) {
    const v = await this.prisma.visit.findFirst({ where: { id, ...visitScope(user) }, select: VISIT_SELECT });
    if (!v) throw this.notInScope(user);
    await withSharedTransfers(this.prisma, [v], { select: VISIT_SELECT.stockTransfers.select, where: VISIT_SELECT.stockTransfers.where });
    await this.routes?.withPlannedLots(v.stockTransfers);
    return this.shape(v, isUnrestricted(user), user?.id ?? null, user?.level ?? 0);
  }

  /** «تحویل به کارشناسِ بعدی» — منطق در `ServiceCrewService.handover` (همان تیمِ فرمِ خدمت). */
  async handover(id: number, dto: { toAccountId: number; at?: string | null }, user: any) {
    await this.ownVisit(id, user);
    await this.crew!.handover(id, dto, user);
    return this.one(id, user);
  }

  async handoverCandidates(id: number, user: any) {
    await this.ownVisit(id, user);
    return this.crew!.handoverCandidates(id);
  }

  /** دستگاه‌های انبار برای روزِ همین عمل + آنچه حمل به همین بیمارستان برده (پیشنهاد). */
  async devices(id: number, user: any) {
    await this.ownVisit(id, user);
    const v = await this.prisma.visit.findUnique({ where: { id }, select: { id: true, hospitalId: true, opDate: true } });
    const [options, sent] = await Promise.all([this.crew!.deviceOptions(id), transportDevices(this.prisma, v!)]);
    const sentIds = new Set(sent.map((d) => d.lotId));
    return options.map((o: any) => ({ ...o, fromTransport: sentIds.has(o.lotId) }))
      .sort((a: any, b: any) => Number(b.fromTransport) - Number(a.fromTransport));
  }

  async setDevice(id: number, lotId: number | null, user: any) {
    await this.ownVisit(id, user);
    await this.crew!.setDevice(id, lotId, user);
    return this.one(id, user);
  }
}
