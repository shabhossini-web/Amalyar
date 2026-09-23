import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../work/events.service';
import { LEVEL } from '../common/levels';
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
 * ⚠️ دامنه همیشه **خودِ کاربر** است، حتی برای سوپروایزر. مدیر برای دیدنِ کارِ
 * دیگران تختهٔ چینش را دارد؛ اگر این endpoint هم `techId`ِ دلخواه می‌پذیرفت،
 * یک مسیرِ دوم برای خواندنِ کارِ همه ساخته می‌شد که guardهایش جای دیگری است.
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
    /* ⚠️ سوپرادمین **همه** را می‌بیند (خواستهٔ کاربر — همان الگوی ملک‌طب):
       یک نفر باید کلِ چرخه را با دیدِ کامل ببیند. برای بقیه دامنه همچنان
       خودِ کاربر است؛ نوشتن‌ها (`ownVisit`) هم برای همه شخصی می‌مانند. */
    const allTechs = (user?.level ?? 0) >= LEVEL.SUPER_ADMIN;
    const rows = await this.prisma.visit.findMany({
      where: {
        ...(allTechs ? { techId: { not: null } } : { techId: user?.id ?? -1 }),
        opDate: { gte: from, lt: to },
        // عملِ لغوشده کارِ امروزِ کسی نیست؛ ولی در «گذشته» می‌ماند تا کارشناس
        // بداند چرا آن روز خالی بوده.
        ...(scope === 'past' ? {} : { opStatus: { not: 'cancelled' } }),
      },
      orderBy: [{ opDate: scope === 'past' ? 'desc' : 'asc' }, { opStartTime: 'asc' }, { id: 'asc' }],
      select: {
        id: true, seq: true, kind: true, opDate: true, opStatus: true,
        opStartTime: true, opEndTime: true, techArriveTime: true,
        surgeonName: true, hospitalName: true, opType: true,
        patient: { select: { id: true, code: true, firstName: true, lastName: true } },
        surgeon: { select: { person: { select: { firstName: true, lastName: true } } } },
        tech: { select: { person: { select: { firstName: true, lastName: true } } } },
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
      },
    });
    const duties = scope === 'past' ? [] : await this.prisma.hospitalDuty.findMany({ where: { techId: user?.id ?? -1, date: { gte: from, lt: to }, tech: { status: 'active' } }, include: { hospital: { select: { name: true } } }, orderBy: [{ date: 'asc' }, { arriveTime: 'asc' }] });
    const pool = duties.length ? await this.prisma.visit.findMany({
      where: { techId: null, opStatus: 'pending', patient: { deletedAt: null }, OR: duties.map(d => ({ hospitalId: d.hospitalId, opDate: { gte: d.date, lt: new Date(d.date.getTime() + DAY) } })) },
      select: { id: true, seq: true, opDate: true, opStartTime: true, hospitalId: true, patient: { select: { code: true, firstName: true, lastName: true } }, opType: true, procedureType: { select: { name: true } }, otherProcedures: OTHER_PX },
      orderBy: [{ opDate: 'asc' }, { opStartTime: 'asc' }],
    }) : [];
    return { scope, from, to, visits: rows.map((v) => this.shape(v)), hospitals: duties.map(d => ({ id: d.id, hospitalId: d.hospitalId, name: d.hospital.name, date: d.date, arriveTime: d.arriveTime, openVisits: pool.filter(v => v.hospitalId === d.hospitalId && v.opDate!.toISOString().slice(0, 10) === d.date.toISOString().slice(0, 10)).map(v => ({ id: v.id, name: `${v.patient.firstName} ${v.patient.lastName}`.trim(), code: `${v.patient.code}-V${v.seq}`, opStartTime: v.opStartTime, procedure: procedureLabel(v) })) })) };
  }

  async claim(id: number, user: any) { return this.duties.assign(id, user.id, user, true); }

  /** تنها شکلی که پنلِ کارشناسی می‌شناسد — هیچ عددِ مالی‌ای در آن نیست. */
  private shape(v: any) {
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
      techName: v.tech?.person
        ? [v.tech.person.firstName, v.tech.person.lastName].filter(Boolean).join(' ')
        : null,
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

  private async ownVisit(id: number, user: any) {
    const v = await this.prisma.visit.findFirst({
      where: { id, techId: user?.id ?? -1 },
      select: { id: true, patientId: true },
    });
    if (!v) throw new NotFoundException('این عمل در کارهای شما نیست');
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

  private async one(id: number, user: any) {
    const { visits } = await this.agenda(user, 'today');
    const hit = visits.find((v) => v.id === id);
    if (hit) return hit;
    // عملی که در بازهٔ امروز نیست (مثلاً گزارشِ دیروز) هم باید برگردد.
    for (const scope of ['past', 'upcoming'] as AgendaScope[]) {
      const found = (await this.agenda(user, scope)).visits.find((v) => v.id === id);
      if (found) return found;
    }
    throw new NotFoundException('این عمل در کارهای شما نیست');
  }
}
