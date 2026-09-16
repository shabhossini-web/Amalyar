import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeaturesService } from '../features/features.service';
import { LEVEL } from '../common/levels';
import { AvailabilityService } from '../patients/availability.service';
import { WorkService } from './work.service';

/**
 * صفحهٔ «امروز» (W2.3) — یک پاسخ برای «الان چه کار کنم؟».
 *
 * هر بخش **جدا گیت می‌شود** و اگر کاربر اجازه‌اش را نداشته باشد خالی برمی‌گردد،
 * نه اینکه کلِ صفحه ۴۰۳ شود: کارشناسِ سطح ۲ باید کارها و عمل‌های خودش را ببیند
 * بی‌آنکه تقویم یا ثبت‌نام‌ها برایش باز باشد. گیت از همان `FeaturesService.forUser`
 * می‌آید که لانچر می‌خواند — نه محاسبهٔ دوبارهٔ `level >= min` (قانونِ ۳).
 *
 * ⚠️ **همهٔ عددها این‌جا حساب می‌شوند** (قانونِ ۱۵): کلاینت هیچ شمارشی نمی‌کند،
 * فقط عددِ آماده را کنارِ برچسبش می‌گذارد.
 *
 * ⚠️ چرا نوبت‌ها را از `AppointmentsService` نمی‌گیرد: `PatientsModule` خودش
 * `WorkModule` را import می‌کند (برای `EventsService`)، و وارونه‌اش حلقهٔ
 * ماژولی می‌سازد. پس این‌جا فقط یک projectionِ کوچکِ خواندنی است، نه منطقِ
 * تازه — قاعدهٔ نوبت‌ها همچنان مالِ همان سرویس است.
 */
@Injectable()
export class TodayService {
  constructor(
    private prisma: PrismaService,
    private work: WorkService,
    private features: FeaturesService,
  ) {}

  private static dayBounds(now: Date): [Date, Date] {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setHours(23, 59, 59, 999);
    return [start, end];
  }

  async today(user: any) {
    const now = new Date();
    const [start, end] = TodayService.dayBounds(now);
    const level = user?.level ?? 0;

    /* گیتِ بخش‌ها. اگر خواندنِ فیچرها شکست بخورد، صفحه نباید بیفتد: فقط کارها می‌ماند. */
    let can = (_key: string) => false;
    try {
      const rows = await this.features.forUser(user);
      const map = new Map(rows.map((r: any) => [r.key, !!r.allowed]));
      can = (key: string) => map.get(key) === true;
    } catch { /* fail-soft: بخش‌های دیگر خالی می‌مانند */ }

    const seesVisits = can('dashboard') || can('tech');
    const [counts, items, visits, appointments, intakePending] = await Promise.all([
      this.work.counts(user),
      this.work.list(user, { scope: 'inbox', limit: 8 }),
      seesVisits ? this.visitsToday(user, level, start, end) : Promise.resolve([]),
      can('calendar') ? this.appointmentsToday(start) : Promise.resolve([]),
      can('formgen')
        ? this.prisma.intakeSubmission.count({ where: { status: 'pending_approval' } })
        : Promise.resolve(0),
    ]);

    /* «کارِ بعدی» = نزدیک‌ترین چیزی که ساعت دارد — عمل یا نوبت، هرکدام زودتر. */
    const nextAt = [
      ...visits.filter((v) => v.opStartTime).map((v) => v.opStartTime as string),
      ...appointments.filter((a) => a.time && a.status !== 'cancelled').map((a) => a.time as string),
    ].sort()[0] ?? null;

    return {
      now: now.toISOString(),
      user: { jobRole: user?.jobRole ?? null, level },
      brief: {
        work: counts.total,
        overdue: counts.overdue,
        visits: visits.length,
        appointments: appointments.filter((a) => a.status !== 'cancelled').length,
        intakePending,
        nextAt,
      },
      work: items,
      visits,
      appointments,
      sections: { visits: seesVisits, appointments: can('calendar'), intake: can('formgen') },
    };
  }

  /** عمل‌های امروز — دامنهٔ دید مثلِ خودِ فهرستِ مراجعات: زیرِ سوپروایزر فقط مالِ خودش. */
  private async visitsToday(user: any, level: number, start: Date, end: Date) {
    const rows = await this.prisma.visit.findMany({
      where: {
        opDate: { gte: start, lte: end },
        opStatus: { not: 'cancelled' },
        patient: { deletedAt: null },
        ...(level >= LEVEL.SUPERVISOR ? {} : { techId: user?.id ?? -1 }),
      },
      orderBy: [{ opStartTime: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      take: 40,
      select: {
        id: true, seq: true, kind: true, opStartTime: true, opStatus: true,
        hospitalName: true, surgeonName: true,
        patient: { select: { id: true, code: true, firstName: true, lastName: true } },
      },
    });
    return rows.map((v) => ({
      id: v.id,
      patientId: v.patient.id,
      code: `${v.patient.code}-V${v.seq}`,
      fullName: `${v.patient.firstName} ${v.patient.lastName}`.trim(),
      kind: v.kind,
      opStartTime: v.opStartTime,
      opStatus: v.opStatus,
      hospitalName: v.hospitalName,
      surgeonName: v.surgeonName,
    }));
  }

  /** نوبت‌های امروز — نامِ بیمار فقط برای نوبتی که به پرونده وصل شده. */
  private async appointmentsToday(start: Date) {
    const d = new Date(`${start.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const rows = await this.prisma.appointment.findMany({
      where: { date: d },
      orderBy: [{ startMin: { sort: 'asc', nulls: 'last' } }, { seq: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      take: 60,
      select: {
        id: true, startMin: true, seq: true, status: true, visitId: true,
        patient: { select: { id: true, firstName: true, lastName: true } },
        topic: { select: { name: true } },
      },
    });
    return rows.map((a) => ({
      id: a.id,
      time: a.startMin != null ? AvailabilityService.minToHHMM(a.startMin) : null,
      seq: a.seq,
      status: a.status,
      visitId: a.visitId,
      patientId: a.patient?.id ?? null,
      /* نوبتی که هنوز به پرونده وصل نشده اسمی ندارد که این‌جا نشان داده شود؛
         نامِ داخلِ پاسخِ ثبت‌نام هنوز تأیید نشده و نباید مثلِ پرونده دیده شود. */
      fullName: a.patient ? `${a.patient.firstName} ${a.patient.lastName}`.trim() : null,
      topic: a.topic?.name ?? null,
    }));
  }

}
