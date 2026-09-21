import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { jalaliMonthRange, toJalali } from '../common/jalali';
import { scopedVisitWhere } from '../common/own-scope';
import { APPT_LABELS, APPT_TRANSITIONS } from './appointments.service';

/**
 * تقویمِ ماهانهٔ عمل‌ها.
 *
 * ⚠️ بازهٔ ماه روی **تقویمِ شمسی** بریده می‌شود نه میلادی: کاربر «مردادِ ۱۴۰۵»
 * را می‌خواهد، و مردادِ شمسی وسطِ دو ماهِ میلادی می‌افتد. بریدنِ میلادی یعنی
 * چند روزِ ابتدا و انتهای ماه از تقویم بیفتند بی‌آنکه کسی متوجه شود.
 *
 * ⚠️ گروه‌بندی هم سمتِ سرور انجام می‌شود نه در UI: با دو نمای متفاوت (تقویم و
 * چینش) روی همین داده، دو گروه‌بندیِ جدا یعنی دو تعریفِ متفاوت از «عمل‌های
 * امروز» — همان اشتباهی که در آمارِ داشبورد یک‌بار کردیم.
 */
@Injectable()
export class CalendarService {
  constructor(private prisma: PrismaService) {}

  async month(jy: number, jm: number, user?: any) {
    if (!Number.isInteger(jy) || jy < 1300 || jy > 1500) throw new BadRequestException('سالِ نامعتبر');
    if (!Number.isInteger(jm) || jm < 1 || jm > 12) throw new BadRequestException('ماهِ نامعتبر');
    const [from, to] = jalaliMonthRange(jy, jm);

    // کارشناس فقط عمل‌های خودش را می‌بیند — همان قاعدهٔ فهرستِ مراجعات.
    const scoped = scopedVisitWhere(user);

    const rows = await this.prisma.visit.findMany({
      where: { ...scoped, opDate: { gte: from, lt: to } },
      orderBy: [{ opDate: 'asc' }, { opStartTime: 'asc' }, { id: 'asc' }],
      include: {
        patient: { select: { code: true, firstName: true, lastName: true } },
        surgeon: { include: { person: { select: { firstName: true, lastName: true } } } },
        hospital: { select: { name: true } },
        tech: { include: { person: { select: { firstName: true, lastName: true } } } },
        procedureType: { select: { name: true } },
      },
    });

    const days = new Map<number, any[]>();
    for (const v of rows) {
      const [, , jd] = toJalali(v.opDate!);
      if (!days.has(jd)) days.set(jd, []);
      days.get(jd)!.push({
        id: v.id,
        code: `${v.patient.code}-V${v.seq}`,
        fullName: `${v.patient.firstName} ${v.patient.lastName}`.trim(),
        kind: v.kind,
        opStatus: v.opStatus,
        opStartTime: v.opStartTime,
        opEndTime: v.opEndTime,
        techArriveTime: v.techArriveTime,
        surgeonName: v.surgeon ? `${v.surgeon.person.firstName} ${v.surgeon.person.lastName}`.trim() : v.surgeonName,
        hospitalName: v.hospital?.name ?? v.hospitalName,
        techName: v.tech ? `${v.tech.person.firstName} ${v.tech.person.lastName}`.trim() : null,
        procedureName: v.procedureType?.name ?? v.opType,
      });
    }

    /* ⚠️ نوبت‌ها هم در همین پاسخ می‌آیند، نه یک endpoint دوم: تقویم یک صفحه
       است و دو fetch یعنی روزی یکی‌شان شکست بخورد و صفحه نصفه باشد. نوبتِ
       لغوشده نمی‌آید — تقویم برنامهٔ روز است، نه بایگانی. */
    const appts = await this.prisma.appointment.findMany({
      where: { date: { gte: from, lt: to }, status: { not: 'cancelled' } },
      orderBy: [{ startMin: { sort: 'asc', nulls: 'last' } }, { seq: { sort: 'asc', nulls: 'last' } }],
      include: {
        patient: { select: { code: true, firstName: true, lastName: true, phone: true } },
        topic: { select: { name: true, color: true } },
      },
    });
    const apptDays = new Map<number, any[]>();
    for (const a of appts) {
      const [, , jd] = toJalali(a.date);
      if (!apptDays.has(jd)) apptDays.set(jd, []);
      apptDays.get(jd)!.push({
        id: a.id,
        time: a.startMin == null ? null : `${String(Math.floor(a.startMin / 60)).padStart(2, '0')}:${String(a.startMin % 60).padStart(2, '0')}`,
        seq: a.seq,
        status: a.status,
        statusLabel: APPT_LABELS[a.status] ?? a.status,
        fullName: a.patient ? `${a.patient.firstName} ${a.patient.lastName}`.trim() : 'بدونِ پرونده',
        patientCode: a.patient?.code ?? null,
        phone: a.patient?.phone ?? null,
        topicName: a.topic?.name ?? null,
        visitId: a.visitId,
        next: APPT_TRANSITIONS[a.status] ?? [],
      });
    }
    const allDays = new Set([...days.keys(), ...apptDays.keys()]);

    return {
      year: jy,
      month: jm,
      days: [...allDays]
        .sort((a, b) => a - b)
        .map((day) => ({ day, visits: days.get(day) ?? [], appointments: apptDays.get(day) ?? [] }))
        .map(({ day, visits, appointments }) => ({ day, visits, appointments }))
        .sort((a, b) => a[0] - b[0])
        // شمارشِ وضعیت روی خودِ سلول دیده می‌شود؛ بدونش کاربر باید هر روز را
        // باز کند تا بفهمد کدام عمل هنوز بی‌وضعیت مانده.
        .map(({ day, visits, appointments }) => ({
          day,
          visits,
          appointments,
          counts: {
            total: visits.length,
            pending: visits.filter((v: any) => v.opStatus === 'pending').length,
            done: visits.filter((v: any) => v.opStatus === 'done').length,
            cancelled: visits.filter((v: any) => v.opStatus === 'cancelled').length,
            appointments: appointments.length,
          },
        })),
      total: rows.length,
    };
  }
}
