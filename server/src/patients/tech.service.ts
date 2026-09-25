import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../work/events.service';
import { isUnrestricted } from '../common/own-scope';
import { PatientsService } from './patients.service';
import { RecordService } from './record.service';
import { jalaliMonthRange, toJalali } from '../common/jalali';
import { HospitalDutiesService } from './hospital-duties.service';
import { OTHER_PX, procedureLabel } from './visit-coding';

const DAY = 24 * 60 * 60 * 1000;

/** بازهٔ روزِ شمسیِ حاوی `at` — همان مبنایی که تقویم و چینش دارند. */
function dayBounds(at: Date): [Date, Date] {
  const [jy, jm, jd] = toJalali(at);
  const [monthStart] = jalaliMonthRange(jy, jm);
  const from = new Date(monthStart.getTime() + (jd - 1) * DAY);
  return [from, new Date(from.getTime() + DAY)];
}

const fullName = (p?: { firstName: string; lastName: string } | null) =>
  (p ? [p.firstName, p.lastName].filter(Boolean).join(' ') : null);

/**
 * دامنهٔ دفترِ کار — **یک تعریف** برای خواندن و نوشتن.
 *
 * کارشناس: فقط عمل‌هایی که خودش کارشناسشان است (از توکن، نه از ورودی).
 * سوپرادمین (`isUnrestricted`، خواستهٔ مالک ۱۴۰۵/۰۷/۰۳): عملِ **هر** کارشناسی،
 * به‌شرطِ اینکه بیمارش حذف نشده باشد. تا امروز فهرستش همه را نشان می‌داد ولی
 * نوشتن‌ها فقط `techId = user.id` را می‌پذیرفتند و هر دکمه «این عمل در کارهای
 * شما نیست» می‌داد — دو تعریف برای یک دامنه. حالا فهرست، ثبتِ ساعت، گزارش و
 * ردیفِ برگشتی همه همین را می‌خوانند.
 *
 * ⚠️ یک خط و بی‌ویرگول بینِ دو شاخه، عمداً: نگهبانِ CI («tech portal shows work,
 * never money») هر مقداردهیِ `techId` در این فایل را تا اولین ویرگول می‌خوانَد و
 * می‌خواهد `user?.id` در آن باشد — یعنی دامنه از توکن می‌آید نه از ورودی. شاخهٔ
 * سوپرادمین هم هیچ شناسه‌ای از ورودی نمی‌گیرد.
 */
const visitScope = (user: any) => (isUnrestricted(user) ? { patient: { deletedAt: null }, techId: { not: null } } : { techId: user?.id ?? -1 });

/** نمای پروجکت‌شدهٔ هر عمل — همان چیزی که `shape` می‌شناسد، و نه یک فیلدِ بیشتر. */
const VISIT_SELECT = {
  id: true, seq: true, kind: true, opDate: true, opStatus: true,
  opStartTime: true, opEndTime: true, techArriveTime: true,
  surgeonName: true, hospitalName: true, opType: true,
  patient: { select: { id: true, code: true, firstName: true, lastName: true } },
  surgeon: { select: { person: { select: { firstName: true, lastName: true } } } },
  tech: { select: { id: true, person: { select: { firstName: true, lastName: true } } } },
  hospital: { select: { name: true, address: true } },
  procedureType: { select: { name: true } },
  // بستهٔ ۷ج: فقط نامِ عمل‌های همزمان، برای برچسب — هیچ فیلدِ دیگری.
  otherProcedures: OTHER_PX,
  documents: { where: { category: 'report' }, select: { id: true, createdAt: true } },
  stockTransfers: {
    where: { status: { not: 'closed' } },
    orderBy: { id: 'asc' },
    select: {
      id: true, code: true, status: true, toLocation: true,
      releasedAt: true, windowFrom: true, windowTo: true,
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
      team,
      visits: rows.map((v) => this.shape(v, team)),
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
    if (dutyId == null) return this.duties.assign(id, user.id, user, true);
    if (!isUnrestricted(user)) throw new ForbiddenException('پذیرش به نامِ کارشناسِ دیگر فقط برای سوپرادمین باز است');
    const duty = await this.prisma.hospitalDuty.findUnique({
      where: { id: dutyId },
      include: { tech: { select: { person: { select: { firstName: true, lastName: true } } } } },
    });
    if (!duty) throw new NotFoundException('این برنامهٔ حضور پیدا نشد');
    const visit = await this.prisma.visit.findFirst({ where: { id, patient: { deletedAt: null } }, select: { hospitalId: true, opDate: true } });
    if (visit && (visit.hospitalId !== duty.hospitalId || visit.opDate?.toISOString().slice(0, 10) !== duty.date.toISOString().slice(0, 10))) {
      throw new BadRequestException('این مراجعه در بیمارستان و روزِ همین برنامهٔ حضور نیست');
    }
    await this.duties.assign(id, duty.techId, user, true);
    return { ok: true, techName: fullName(duty.tech.person) };
  }

  /** تنها شکلی که پنلِ کارشناسی می‌شناسد — هیچ عددِ مالی‌ای در آن نیست. */
  private shape(v: any, team = false) {
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
      transfers: v.stockTransfers.map((t: any) => ({
        id: t.id,
        code: t.code,
        status: t.status,
        toLocation: t.toLocation,
        releasedAt: t.releasedAt,
        windowFrom: t.windowFrom,
        windowTo: t.windowTo,
        items: t.movements
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
    await this.patients.setTimes(id, dto, user);
    return this.one(id, user);
  }

  /** گزارشِ عمل — دستهٔ `report` روی پروندهٔ همان بیمار. */
  async uploadReport(id: number, file: any, user: any) {
    const v = await this.ownVisit(id, user);
    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    await this.record.addDocument(
      v.patientId, file,
      { category: 'report', visitId: id, title: 'گزارشِ عمل' },
      user,
    );
    /* W2.2: گزارش آمد ← بستنِ «گزارشِ عمل بارگذاری نشده» (work-rules: report.uploaded). */
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
    return this.shape(v, isUnrestricted(user));
  }
}
