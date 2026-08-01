import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { jalaliMonthRange, toJalali } from '../common/jalali';
import { LEVEL } from '../common/levels';

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
    const scoped = (user?.level ?? 0) < LEVEL.SUPERVISOR ? { techId: user?.id ?? -1 } : {};

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

    return {
      year: jy,
      month: jm,
      days: [...days.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([day, visits]) => ({
          day,
          visits,
          // شمارشِ وضعیت روی خودِ سلول دیده می‌شود؛ بدونش کاربر باید هر روز را
          // باز کند تا بفهمد کدام عمل هنوز بی‌وضعیت مانده.
          counts: {
            total: visits.length,
            pending: visits.filter((v: any) => v.opStatus === 'pending').length,
            done: visits.filter((v: any) => v.opStatus === 'done').length,
            cancelled: visits.filter((v: any) => v.opStatus === 'cancelled').length,
          },
        })),
      total: rows.length,
    };
  }
}
