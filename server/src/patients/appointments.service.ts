import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../work/events.service';
import { PatientsService } from './patients.service';
import { FormsService } from './forms.service';
import { AvailabilityService } from './availability.service';
import { RemindersService } from './reminders.service';

/** برچسب‌های فارسیِ وضعیتِ نوبت — مشتقِ سرور (قانون ۱۵). */
export const APPT_LABELS: Record<string, string> = {
  held: 'در انتظارِ پرداخت',
  confirmed: 'قطعی',
  arrived: 'در مطب',
  done: 'انجام شد',
  noshow: 'نیامد',
  cancelled: 'لغو شد',
};

/**
 * گذارهای مجازِ وضعیت — ماشینِ وضعیتِ صریح، نه «هر چیزی به هر چیزی».
 *
 * ⚠️ بدونِ این، یک کلیکِ اشتباه `done` را به `held` برمی‌گرداند و نوبتی که
 * انجام شده دوباره در صفِ پذیرش سبز می‌شد. برگشتِ عمدی (`arrived` → `confirmed`)
 * مجاز است چون منشی گاهی اشتباهی «رسید» می‌زند.
 */
/**
 * برچسبِ **اقدام** — با `APPT_LABELS` یکی نیست و نباید یکی شود.
 * `APPT_LABELS` می‌گوید «الان کجاست» («در مطب»)، این می‌گوید «اگر بزنی چه می‌شود»
 * («رسید»). میزِ پذیرش دکمه است، پس فعل می‌خواهد نه صفت.
 */
export const APPT_ACTIONS: Record<string, string> = {
  held: 'برگشت به انتظار',
  confirmed: 'قطعی شد',
  arrived: 'رسید',
  done: 'تمام شد',
  noshow: 'نیامد',
  cancelled: 'لغو',
};

/**
 * ستونِ میزِ پذیرش — مشتقِ سرور (قانون ۱۵) و تک‌منبع.
 *
 * ⚠️ **«در جریان» هرگز از `visitId != null` به‌تنهایی مشتق نمی‌شود.**
 * `intake.service.ts:1736` هنگامِ تأییدِ ثبت‌نام روی نوبتِ **`confirmed`** هم
 * `visitId` می‌نویسد — بیمار هنوز خانه است. ملاک، وضعیتِ نوبت است و `visitId`
 * فقط داخلِ `arrived` تفکیک می‌کند.
 */
export function apptLane(status: string, visitId: number | null): string {
  if (status === 'arrived') return visitId ? 'inVisit' : 'present';
  if (status === 'done') return 'finished';
  if (status === 'noshow') return 'absent';
  if (status === 'cancelled') return 'cancelled';
  return 'booked';   // held | confirmed
}

export const APPT_TRANSITIONS: Record<string, string[]> = {
  held: ['confirmed', 'cancelled'],
  confirmed: ['arrived', 'noshow', 'cancelled'],
  arrived: ['done', 'confirmed', 'cancelled'],
  done: [],
  noshow: ['confirmed'], // «نیامد» اشتباه بود — برگشتش باید ممکن باشد
  cancelled: [],
};

/**
 * **میزِ پذیرش** — نوبت‌های یک روز و چرخهٔ حضورِ بیمار در مطب.
 * `docs/BOOKING.md` مرحلهٔ ۵: در انتظار ← در مطب ← ویزیت ← تمام.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private patients: PatientsService,
    private forms: FormsService,
    private availability: AvailabilityService,
    private reminders: RemindersService,
    private events: EventsService,
  ) {}

  view(a: any) {
    return {
      id: a.id,
      date: a.date.toISOString().slice(0, 10),
      startMin: a.startMin,
      time: a.startMin == null ? null : AvailabilityService.minToHHMM(a.startMin),
      seq: a.seq,
      status: a.status,
      statusLabel: APPT_LABELS[a.status] ?? a.status,
      note: a.note,
      patientId: a.patientId,
      patientCode: a.patient?.code ?? null,
      fullName: a.patient ? `${a.patient.firstName} ${a.patient.lastName}`.trim() : null,
      phone: a.patient?.phone ?? null,
      topicId: a.topicId,
      topicName: a.topic?.name ?? null,
      topicColor: a.topic?.color ?? null,
      visitId: a.visitId,
      forVisitId: a.forVisitId,
      /* گذارهای مجاز هم مشتقِ سرورند: دکمه‌های میزِ پذیرش از همین ساخته
         می‌شوند، نه از یک کپیِ کلاینتیِ ماشینِ وضعیت. */
      next: APPT_TRANSITIONS[a.status] ?? [],
      /* دکمه‌های میز: هر گذارِ مجاز با فعلِ خودش. برچسب این‌جا ساخته می‌شود تا
         نگاشتِ کلاینتیِ دوم (مثلِ آنکه در `Calendar.jsx` بود) لازم نشود. */
      nextOptions: (APPT_TRANSITIONS[a.status] ?? []).map((st) => ({
        status: st, label: APPT_ACTIONS[st] ?? st,
      })),
      lane: apptLane(a.status, a.visitId ?? null),
    };
  }

  private static readonly INCLUDE = {
    patient: { select: { id: true, code: true, firstName: true, lastName: true, phone: true } },
    topic: { select: { id: true, name: true, color: true } },
  } as const;

  /** نوبت‌های یک روز — مرتب به ساعت، بعد شمارهٔ صف. */
  async day(date: string) {
    const d = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخ نامعتبر است');
    const rows = await this.prisma.appointment.findMany({
      where: { date: d },
      orderBy: [{ startMin: { sort: 'asc', nulls: 'last' } }, { seq: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      include: AppointmentsService.INCLUDE,
    });
    return rows.map((r) => this.view(r));
  }

  /**
   * «از همان ثبت، پیشنهادِ نوبت» — وضعیتِ یک روز برای نوبت‌گرفتنِ یک بیمار:
   * باز/بسته، حالت (اسلات/ظرفیت)، جاهای آزاد، و نوبتِ **فعالِ خودِ بیمار**
   * در همان روز (یعنی «دوباره نگیر»). خوراکِ پرامپتی که بعد از ذخیرهٔ
   * ویزیتِ دارای «ویزیتِ بعدی» باز می‌شود.
   *
   * `mode: 'none'` یعنی برای آن روز اصلاً قاعده‌ای نیست — نصبی که از
   * برنامهٔ کاری استفاده نمی‌کند همین را می‌گیرد و کلاینت پرامپت را
   * نشان نمی‌دهد (همان fail-softِ نوبت‌دهی).
   */
  async suggest(patientId: number, date: string, topicId?: number) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('پرونده پیدا نشد');
    const d = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخ نامعتبر است');

    const existing = await this.prisma.appointment.findFirst({
      where: { patientId, date: d, status: { in: ['held', 'confirmed', 'arrived', 'done'] } },
      orderBy: { id: 'asc' },
      include: AppointmentsService.INCLUDE,
    });
    const [jy, jm] = AppointmentsService.jalaliYm(d);
    const cal = await this.availability.month(jy, jm, { topicId });
    const day = cal.days.find((x: any) => x.date === date) ?? null;
    /* همان قاعدهٔ walkIn: وجودِ حتی یک پنجرهٔ اسلاتی یعنی انتخابِ ساعت لازم است. */
    const slots = (day?.windows ?? []).filter((w: any) => w.mode === 'slot').flatMap((w: any) => w.slots);
    /* نصبی که اصلاً برنامهٔ کاری ندارد باید ساکت بماند (fail-soft)؛ نصبی که
       دارد ولی این روزش باز نیست باید **بگوید** — این دو بدونِ scheduled از
       بیرون یکسان دیده می‌شدند. */
    const scheduled = (await this.prisma.availabilityRule.count({ where: { active: true } })) > 0;
    return {
      date,
      scheduled,
      open: !!day?.open,
      past: !!day?.past,
      closed: !!day?.closed,
      free: day?.free ?? 0,
      mode: slots.length ? 'slot' : ((day?.windows ?? []).length ? 'capacity' : 'none'),
      slots,
      existing: existing ? this.view(existing) : null,
    };
  }

  /**
   * نوبتِ حضوری — منشی برای بیمارِ موجود می‌گیرد.
   *
   * ⚠️ از همان مسیرِ ظرفیتِ بیمار عبور می‌کند: روزِ بسته یا پر برای منشی هم
   * بسته است، وگرنه «حضوری» می‌شد راهِ دورزدنِ ظرفیت و تقویم دروغ می‌گفت.
   * (اگر روزی «فشردنِ عمدی» لازم شد، باید صریح و جدا باشد، نه پیش‌فرض.)
   */
  async walkIn(dto: { patientId: number; date: string; startMin?: number; topicId?: number; note?: string }, user: any) {
    const patient = await this.prisma.patient.findUnique({ where: { id: dto.patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('پرونده پیدا نشد');
    const d = new Date(`${dto.date}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخ نامعتبر است');

    const [jy, jm] = AppointmentsService.jalaliYm(d);
    const cal = await this.availability.month(jy, jm, { topicId: dto.topicId });
    const day = cal.days.find((x: any) => x.date === dto.date);
    if (!day || !day.open) throw new BadRequestException('این روز باز نیست یا جای آزاد ندارد');
    const slotMode = day.windows.some((w: any) => w.mode === 'slot');
    if (slotMode) {
      const free = day.windows.filter((w: any) => w.mode === 'slot').flatMap((w: any) => w.slots)
        .find((sl: any) => sl.startMin === dto.startMin && !sl.taken);
      if (!free) throw new BadRequestException('این ساعت آزاد نیست');
    }

    try {
      const seq = slotMode ? null : await this.nextSeq(d);
      const appt = await this.prisma.$transaction(async (tx) => {
        const appt = await tx.appointment.create({
          data: {
            patientId: dto.patientId,
            forVisitId: await this.patients.appointmentTarget(tx, dto.patientId, d),
            topicId: dto.topicId ?? null,
            date: d,
            startMin: slotMode ? dto.startMin ?? null : null,
            seq: slotMode ? null : seq,
            /* حضوری از قبل پولش را نداده که منتظرِ تأیید بماند — مستقیم قطعی. */
            status: 'confirmed',
            note: dto.note?.trim() || null,
          },
          include: AppointmentsService.INCLUDE,
        });
        await this.audit.record({
          actorId: user?.id, action: 'appointment.walkin', entityType: 'appointment', entityId: appt.id,
          after: { patientId: dto.patientId, date: dto.date, startMin: appt.startMin, forVisitId: appt.forVisitId },
        }, tx);
        return appt;
      });
      /* یادآوریِ «نوبتِ فردا» — عصرِ روزِ قبل. */
      await this.reminders.syncAppointment(appt.id);
      /* اگر این نوبت همان «ویزیتِ بعدیِ» ثبت‌شده روی یک مراجعه است، یادآوریِ
         next_visit دوبله می‌شد (هم «ویزیتِ بعدی نزدیک است» هم «نوبتِ فردا») —
         نسخهٔ نوبت‌دار دقیق‌تر است (ساعت دارد)، آن یکی خاموش می‌شود. */
      await this.prisma.reminder.updateMany({
        where: { patientId: dto.patientId, kind: 'next_visit', status: 'pending', visit: { nextVisitDate: d } },
        data: { status: 'cancelled' },
      });
      return this.view(appt);
    } catch (e: any) {
      if (e?.code === 'P2002') throw new BadRequestException('همین حالا کسی این نوبت را گرفت');
      throw e;
    }
  }

  /**
   * شمارهٔ صفِ حالتِ ظرفیتی — «نوبتِ شما ۱۴ اُم».
   * ⚠️ تحتِ دو درخواستِ کاملاً همزمان ممکن است دو نفر یک شماره بگیرند؛ صف
   * را پذیرش به‌هرحال مرتب می‌کند و شماره راهنماست نه قفل — قفلِ واقعی
   * ظرفیتِ روز است که جدا شمرده می‌شود.
   */
  private async nextSeq(d: Date): Promise<number> {
    const max = await this.prisma.appointment.aggregate({
      where: { date: d, status: { in: ['held', 'confirmed', 'arrived', 'done'] } },
      _max: { seq: true },
    });
    return (max._max.seq ?? 0) + 1;
  }

  private static jalaliYm(d: Date): [number, number] {
    const parts = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: 'numeric', timeZone: 'UTC' })
      .formatToParts(d);
    return [
      Number(parts.find((x) => x.type === 'year')!.value.replace(/[^\d]/g, '')),
      Number(parts.find((x) => x.type === 'month')!.value),
    ];
  }

  /** گذارِ وضعیت — فقط گذارهای اعلام‌شده. */
  async setStatus(id: number, status: string, user: any) {
    const row = await this.prisma.appointment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('نوبت پیدا نشد');
    const allowed = APPT_TRANSITIONS[row.status] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `از «${APPT_LABELS[row.status] ?? row.status}» نمی‌شود به «${APPT_LABELS[status] ?? status}» رفت`,
      );
    }
    const updated = await this.prisma.appointment.update({
      where: { id }, data: { status }, include: AppointmentsService.INCLUDE,
    });
    await this.audit.record({
      actorId: user?.id, action: 'appointment.status', entityType: 'appointment', entityId: id,
      before: { status: row.status }, after: { status },
    });
    /* W2.2: noshow ← «تماس با غایب»؛ confirmed/cancelled ← بستنِ «تأییدِ نوبت» (work-rules). */
    await this.events.emit({
      type: `appointment.${status}`, appointmentId: id, patientId: row.patientId ?? null, visitId: row.visitId ?? null,
      actorId: user?.id ?? null, payload: { from: row.status, date: row.date },
    });
    /* لغو/نیامد → یادآوری باطل؛ برگشت به قطعی → دوباره کاشته می‌شود. */
    await this.reminders.syncAppointment(id);
    /* قرینهٔ خاموشیِ walkIn: نوبتی که «ویزیتِ بعدی» را پوشش می‌داد اگر لغو یا
       نیامد شود، بیمار نباید بی‌یادآور بماند — next_visit همان مراجعه‌ها
       دوباره هم‌گام می‌شود (خودش می‌سنجد نوبتِ فعالِ دیگری هست یا نه). */
    if ((status === 'cancelled' || status === 'noshow') && row.patientId !== null) {
      const covered = await this.prisma.visit.findMany({
        where: { patientId: row.patientId, nextVisitDate: row.date },
        select: { id: true },
      });
      for (const v of covered) await this.reminders.syncNextVisit(v.id);
    }
    return this.view(updated);
  }

  /**
   * **شروعِ ویزیت** — کلیک روی نوبت، فرمِ همان مراجعه.
   *
   * اگر مراجعه از قبل هست (مسیرِ تأییدِ ثبت‌نام ساخته بودش) همان برمی‌گردد؛
   * وگرنه از خودِ نوبت ساخته می‌شود: تاریخ و ساعت و موضوع از نوبت. دوبار
   * کلیک مراجعهٔ دوم نمی‌سازد — `visitId` یک‌به‌یک است.
   */
  async startVisit(id: number, user: any) {
    // تعریف و اعتبارسنجیِ فرم بیرون از tx؛ داخل قفل هیچ queryِ اتصال دیگری نداریم.
    const source = await this.prisma.appointment.findUnique({ where: { id } });
    if (!source) throw new NotFoundException('نوبت پیدا نشد');
    let create: Awaited<ReturnType<PatientsService['prepareVisitCreation']>> | undefined;
    if (!source.visitId && !source.forVisitId && source.patientId && source.status !== 'cancelled') {
      const kinds = await this.forms.visitKinds();
      const kind = kinds.find((k) => k.kind === 'clinic')?.kind ?? kinds.find((k) => k.kind !== 'surgery')?.kind;
      if (!kind) throw new BadRequestException('فرمِ ویزیتِ غیرجراحی تعریف نشده است؛ ابتدا در فرم‌ساز یک فرمِ ویزیت فعال کنید');
      create = await this.patients.prepareVisitCreation({
        patientId: source.patientId, kind, topicId: source.topicId ?? undefined,
        opDate: source.date.toISOString(),
        opStartTime: source.startMin != null ? AvailabilityService.minToHHMM(source.startMin) : undefined,
      } as any, user, { skipFormValidation: true });
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${id} FOR UPDATE`;
        const row = await tx.appointment.findUnique({ where: { id } });
        if (!row) throw new NotFoundException('نوبت پیدا نشد');
        if (row.status === 'cancelled') throw new BadRequestException('نوبتِ لغوشده ویزیت نمی‌شود');
        if (row.visitId) return { visitId: row.visitId, made: false };
        if (!row.patientId) throw new BadRequestException('این نوبت هنوز به پرونده‌ای وصل نیست — اول ثبت‌نامش تأیید شود');
        if (row.patientId !== source.patientId || row.forVisitId !== source.forVisitId
          || row.topicId !== source.topicId || row.startMin !== source.startMin || +row.date !== +source.date) {
          throw new ConflictException('نوبت هم‌زمان تغییر کرده است؛ صفحه را تازه کنید و دوباره شروع کنید');
        }
        let visitId: number;
        if (row.forVisitId) {
          const target = await tx.visit.findUnique({ where: { id: row.forVisitId } });
          if (!target || target.patientId !== row.patientId) throw new BadRequestException('مراجعهٔ هدف به پروندهٔ این بیمار تعلق ندارد');
          const linked = await tx.appointment.findUnique({ where: { visitId: target.id }, select: { id: true } });
          if (linked) throw new BadRequestException('این مراجعه از نوبتِ دیگری شروع شده است؛ همان نوبت را باز کنید');
          // تاریخِ حضور واقعی؛ وضعیتِ بالینی و تمام پاسخ‌های پیگیری حفظ می‌شوند.
          const today = new Date(); today.setUTCHours(0, 0, 0, 0);
          await tx.visit.update({ where: { id: target.id }, data: { opDate: today } });
          visitId = target.id;
        } else {
          if (!create) throw new ConflictException('اطلاعاتِ نوبت تغییر کرده است؛ دوباره تلاش کنید');
          visitId = (await create(tx)).id;
        }
        await tx.appointment.update({
          where: { id }, data: { visitId, ...(row.status === 'confirmed' ? { status: 'arrived' } : {}) },
        });
        await this.audit.record({
          actorId: user?.id, action: 'appointment.start_visit', entityType: 'appointment', entityId: id,
          after: { visitId, forVisitId: row.forVisitId },
        }, tx);
        await this.events.emit({
          type: 'appointment.started', appointmentId: id, patientId: row.patientId, visitId, actorId: user?.id ?? null,
        }, tx);
        return { visitId, made: !row.forVisitId };
      });
      if (result.made) await this.patients.afterVisitCreation(result.visitId);
      return result;
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('این مراجعه هم‌زمان به نوبتِ دیگری وصل شد؛ صفحه را تازه کنید');
      throw e;
    }
  }
}
