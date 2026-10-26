import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeTime } from './patients.service';
import { faDateStr } from './summary.service';
import { RemindersService } from './reminders.service';
import { clinicTodayIso } from '../common/clinic-day';
import { syncCrew } from './crew-sync';

export function scheduleDate(raw: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new BadRequestException('تاریخ برنامه نامعتبر است');
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw) throw new BadRequestException('تاریخ برنامه نامعتبر است');
  return date;
}
const range = (date: Date) => ({ gte: date, lt: new Date(date.getTime() + 86400000) });
const fullName = (p: any) => `${p.firstName} ${p.lastName}`.trim();

/**
 * **تنها نویسندهٔ `visit.techArriveTime`** (W3.8 / U7، تصمیمِ مالک ۱۴۰۵/۰۶/۲۶).
 *
 * ساعتِ حضور مالِ «آن کارشناس، در آن بیمارستان، در آن روز» است — نه مالِ یک
 * بیمار. پس یک‌بار در `hospital_duties` ثبت می‌شود و از همان‌جا روی مراجعه
 * می‌نشیند. تا امروز سه جا مستقل می‌نوشتندش (فرمِ مراجعه، شیتِ ساعتِ کارشناس،
 * برنامهٔ چینش) و واگرا می‌شدند؛ نشانه‌اش همان گزینهٔ «— هنوز در برنامه حضور
 * نیست» در تابلوی چینش بود: مراجعه کارشناس داشت، برنامه نداشت.
 *
 * ⚠️ این تابع **داخلِ همان تراکنشی** صدا زده می‌شود که خودِ مراجعه را می‌نویسد
 * (`tx`)، نه بعدش: انتسابِ کارشناس و ردیفِ حضورش یا هر دو می‌نشینند یا هیچ‌کدام.
 *
 * ⚠️ و ردیفِ **موجود** را بازنویسی نمی‌کند: اگر ادمین در تابلوی چینش ساعتِ
 * حضور را ۰۷:۰۰ گذاشته، ثبتِ یک بیمارِ ۰۹:۰۰ نباید آن را عقب ببرد. برنامه
 * حرفِ آخر را می‌زند، مراجعه فقط از آن می‌خواند.
 *
 * ⚠️ وقتی هیچ ساعتی برای ساختنِ ردیف نیست (مراجعهٔ بدونِ ساعتِ عمل)، انتساب
 * **رد نمی‌شود**: کارشناس می‌نشیند و ردیفِ حضور ساخته نمی‌شود. فرم هرگز
 * به‌خاطرِ این قاعده شکست نمی‌خورد؛ همان گزینهٔ «هنوز در برنامه حضور نیست»
 * تابلو این شکافِ باقی‌مانده را نشان می‌دهد تا کسی پُرش کند.
 */
export async function syncVisitDuty(
  tx: any,
  visit: { id: number; techId: number | null; hospitalId: number | null; opDate: Date | null; opStartTime: string | null },
): Promise<string | null> {
  if (!visit.techId || !visit.hospitalId || !visit.opDate) return null;
  const date = new Date(`${visit.opDate.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const key = { date_hospitalId_techId: { date, hospitalId: visit.hospitalId, techId: visit.techId } };
  const existing = await tx.hospitalDuty.findUnique({ where: key });
  if (existing) return existing.arriveTime;
  if (!visit.opStartTime) return null;
  const duty = await tx.hospitalDuty.create({
    data: { date, hospitalId: visit.hospitalId, techId: visit.techId, arriveTime: visit.opStartTime },
  });
  return duty.arriveTime;
}

@Injectable()
export class HospitalDutiesService {
  constructor(private prisma: PrismaService, private reminders: RemindersService) {}

  async day(raw: string) {
    const date = scheduleDate(raw);
    const [visits, duties] = await Promise.all([
      this.prisma.visit.findMany({ where: { opDate: range(date), opStatus: { not: 'cancelled' }, patient: { deletedAt: null } }, include: { patient: { select: { code: true, firstName: true, lastName: true } }, hospital: { select: { id: true, name: true } }, tech: { select: { id: true, person: { select: { firstName: true, lastName: true } } } }, crew: { orderBy: [{ sort: 'asc' }, { id: 'asc' }], select: { accountId: true, fromTime: true, toTime: true, account: { select: { person: { select: { firstName: true, lastName: true } } } } } } }, orderBy: [{ opStartTime: 'asc' }, { id: 'asc' }] }),
      this.prisma.hospitalDuty.findMany({ where: { date }, include: { hospital: { select: { id: true, name: true } }, tech: { select: { id: true, status: true, person: { select: { firstName: true, lastName: true, phone: true } } } } }, orderBy: [{ arriveTime: 'asc' }, { id: 'asc' }] }),
    ]);
    const groups = new Map<number, any>();
    const group = (hospital: any) => { const id = hospital?.id ?? 0; if (!groups.has(id)) groups.set(id, { hospitalId: id || null, name: hospital?.name ?? 'بیمارستان تعیین نشده', duties: [], visits: [] }); return groups.get(id); };
    for (const duty of duties) group(duty.hospital).duties.push({ id: duty.id, techId: duty.techId, name: fullName(duty.tech.person), arriveTime: duty.arriveTime, active: duty.tech.status === 'active' });
    for (const v of visits) group(v.hospital).visits.push({ id: v.id, code: `${v.patient.code}-V${v.seq}`, name: fullName(v.patient), hospitalText: v.hospitalName, requiredItems: v.requiredItems, instructions: v.surgeonInstructions, techId: v.techId, techName: v.tech ? fullName(v.tech.person) : null, crew: v.crew.map((c: any) => ({ accountId: c.accountId, name: fullName(c.account.person), fromTime: c.fromTime, toTime: c.toTime })), opStartTime: v.opStartTime, opStatus: v.opStatus });
    return { date: raw, hospitals: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'fa')) };
  }

  async save(dto: { date: string; hospitalId: number; techId: number; arriveTime: string }, user: any) {
    const date = scheduleDate(dto.date), arriveTime = normalizeTime(dto.arriveTime, 'ساعت حضور');
    if (!arriveTime) throw new BadRequestException('ساعت حضور را کامل کنید');
    const [hospital, tech] = await Promise.all([this.prisma.hospital.findFirst({ where: { id: dto.hospitalId, active: true } }), this.prisma.account.findFirst({ where: { id: dto.techId, status: 'active', systemKey: null, level: { gte: 2, lte: 4 } } })]);
    if (!hospital || !tech) throw new BadRequestException('بیمارستان و کارشناس فعال را انتخاب کنید');
    return this.prisma.$transaction(async tx => {
      const duty = await tx.hospitalDuty.upsert({ where: { date_hospitalId_techId: { date, hospitalId: dto.hospitalId, techId: dto.techId } }, create: { date, hospitalId: dto.hospitalId, techId: dto.techId, arriveTime }, update: { arriveTime } });
      await tx.visit.updateMany({ where: { hospitalId: dto.hospitalId, techId: dto.techId, opDate: range(date) }, data: { techArriveTime: arriveTime } });
      await tx.auditEvent.create({ data: { actorId: user.id, action: 'dispatch.duty.save', entityType: 'hospital_duty', entityId: String(duty.id), afterJson: dto } });
      return duty;
    });
  }

  async remove(id: number, user: any) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM hospital_duties WHERE id = ${id} FOR UPDATE`;
      const duty = await tx.hospitalDuty.findUnique({ where: { id } });
      if (!duty) throw new NotFoundException('حضور پیدا نشد');
      if (await tx.visit.count({ where: { hospitalId: duty.hospitalId, opDate: range(duty.date), OR: [{ techId: duty.techId }, { crew: { some: { accountId: duty.techId } } }] } })) throw new BadRequestException('ابتدا بیماران این کارشناس را آزاد یا به کارشناس دیگر منتقل کنید');
      await tx.hospitalDuty.delete({ where: { id } });
      await tx.auditEvent.create({ data: { actorId: user.id, action: 'dispatch.duty.remove', entityType: 'hospital_duty', entityId: String(id) } });
      return { ok: true };
    });
  }

  async assign(id: number, techId: number | null, user: any, claim = false) {
    return this.prisma.$transaction(async tx => {
      const before = await tx.visit.findFirst({ where: { id, patient: { deletedAt: null } } });
      if (!before?.hospitalId || !before.opDate) throw new BadRequestException('ابتدا بیمارستان و تاریخ مراجعه را مشخص کنید');
      if (claim && before.opStatus !== 'pending') throw new BadRequestException('این مراجعه قابل پذیرش نیست');
      /* تنها جایی که از اول درست بود؛ حالا از همان تعریفِ مشترک می‌آید تا
         عوض‌کردنِ منطقهٔ زمانی یک جا باشد نه هشت جا. */
      const today = clinicTodayIso();
      if (claim && before.opDate.toISOString().slice(0, 10) < today) throw new BadRequestException('مراجعه روزهای گذشته قابل پذیرش نیست');
      if (claim && before.techId !== null) throw new ConflictException('این مراجعه قبلاً به کارشناس دیگری تخصیص داده شده است');
      let arriveTime: string | null = null;
      if (techId !== null) {
        const date = scheduleDate(before.opDate.toISOString().slice(0, 10));
        const duty = await tx.hospitalDuty.findUnique({ where: { date_hospitalId_techId: { date, hospitalId: before.hospitalId, techId } }, include: { tech: { select: { status: true } } } });
        if (!duty || duty.tech.status !== 'active') throw new BadRequestException('این کارشناس در برنامه همین بیمارستان و روز نیست');
        await tx.$queryRaw`SELECT id FROM hospital_duties WHERE id = ${duty.id} FOR UPDATE`;
        const current = await tx.hospitalDuty.findUnique({ where: { id: duty.id } });
        if (!current) throw new ConflictException('برنامه حضور تغییر کرده است');
        arriveTime = current.arriveTime;
      }
      const result = await tx.visit.updateMany({ where: { id, techId: before.techId, hospitalId: before.hospitalId, opDate: before.opDate, patient: { deletedAt: null }, ...(claim ? { opStatus: 'pending' } : {}) }, data: { techId, techArriveTime: arriveTime } });
      if (!result.count) throw new ConflictException('مراجعه هم‌زمان تغییر کرد؛ دوباره بارگذاری کنید');
      /* چینش و پذیرش روی **تیمِ پرونده** می‌نشینند — همان چیزی که فرمِ خدمت و پنلِ کارشناس می‌خوانند. */
      await syncCrew(tx, id, { tech: { source: claim ? 'claim' : 'dispatch' } });
      await tx.auditEvent.create({ data: { actorId: user.id, action: claim ? 'dispatch.visit.claim' : 'dispatch.visit.assign', entityType: 'visit', entityId: String(id), beforeJson: { techId: before.techId }, afterJson: { techId } } });
      return { ok: true };
    });
  }

  async preview(raw: string) {
    const board = await this.day(raw), programs = new Map<number, { techId: number; name: string; text: string }>();
    for (const hospital of board.hospitals) for (const duty of hospital.duties.filter((d: any) => d.active)) {
      const mine = hospital.visits.filter((v: any) => v.techId === duty.techId || v.crew.some((c: any) => c.accountId === duty.techId)), open = hospital.visits.filter((v: any) => !v.techId && v.opStatus === 'pending');
      if (!programs.has(duty.techId)) programs.set(duty.techId, { techId: duty.techId, name: duty.name, text: `${duty.name}\nبرنامه ${faDateStr(scheduleDate(raw))}` });
      const lines = (rows: any[]) => rows.map(v => `${v.name}${v.opStartTime ? ` — ساعت عمل ${v.opStartTime}` : ''}`).join('\n') || 'ندارد';
      programs.get(duty.techId)!.text += `\n\n${hospital.name} — حضور ${duty.arriveTime}\nبیماران قطعی شما:\n${lines(mine)}\nبیماران احتمالی (هنوز بدون کارشناس):\n${lines(open)}`;
    }
    return { date: raw, programs: [...programs.values()] };
  }

  async sendDay(raw: string, user: any) {
    const preview = await this.preview(raw);
    if (!preview.programs.length) throw new BadRequestException('ابتدا کارشناس و ساعت حضور بیمارستان‌ها را ثبت کنید');
    const ids: number[] = [];
    for (const program of preview.programs) {
      const key = `dispatch:${raw}:${program.techId}:${createHash('sha256').update(program.text).digest('hex')}`;
      const result = await this.reminders.queueStaffNotice(program.techId, program.name, program.text, key, user);
      ids.push(result.smsId);
    }
    const result = await this.reminders.sweep(ids);
    return { ...result, recipients: preview.programs.length };
  }
}
