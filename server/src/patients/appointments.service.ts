import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PatientsService } from './patients.service';
import { FormsService } from './forms.service';
import { AvailabilityService } from './availability.service';

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
  ) {}

  private view(a: any) {
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
      /* گذارهای مجاز هم مشتقِ سرورند: دکمه‌های میزِ پذیرش از همین ساخته
         می‌شوند، نه از یک کپیِ کلاینتیِ ماشینِ وضعیت. */
      next: APPT_TRANSITIONS[a.status] ?? [],
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
      const appt = await this.prisma.appointment.create({
        data: {
          patientId: dto.patientId,
          topicId: dto.topicId ?? null,
          date: d,
          startMin: slotMode ? dto.startMin ?? null : null,
          seq: slotMode ? null : await this.nextSeq(d),
          /* حضوری از قبل پولش را نداده که منتظرِ تأیید بماند — مستقیم قطعی. */
          status: 'confirmed',
          note: dto.note?.trim() || null,
        },
        include: AppointmentsService.INCLUDE,
      });
      await this.audit.record({
        actorId: user?.id, action: 'appointment.walkin', entityType: 'appointment', entityId: appt.id,
        after: { patientId: dto.patientId, date: dto.date, startMin: appt.startMin },
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
    const row = await this.prisma.appointment.findUnique({
      where: { id },
      include: { visit: { select: { id: true } } },
    });
    if (!row) throw new NotFoundException('نوبت پیدا نشد');
    if (row.status === 'cancelled') throw new BadRequestException('نوبتِ لغوشده ویزیت نمی‌شود');
    if (row.visitId) return { visitId: row.visitId, made: false };
    if (!row.patientId) {
      throw new BadRequestException('این نوبت هنوز به پرونده‌ای وصل نیست — اول ثبت‌نامش تأیید شود');
    }

    /* نوعِ فرم: اولین نوعِ فعالِ فرمِ مراجعه. عمداً حدسِ «جراحی» نمی‌زنیم —
       نصبِ مطب اصلاً جراحی ندارد. */
    const kinds = await this.forms.visitKinds();
    const kind = kinds[0]?.kind;
    if (!kind) throw new BadRequestException('هیچ فرمِ مراجعه‌ای تعریف نشده است');

    const visit = await this.patients.createVisit({
      patientId: row.patientId,
      kind,
      topicId: row.topicId ?? undefined,
      opDate: row.date.toISOString(),
      opStartTime: row.startMin != null ? AvailabilityService.minToHHMM(row.startMin) : undefined,
    } as any, user, { skipFormValidation: true });

    await this.prisma.appointment.update({
      where: { id },
      data: { visitId: visit.id, ...(row.status === 'confirmed' ? { status: 'arrived' } : {}) },
    });
    await this.audit.record({
      actorId: user?.id, action: 'appointment.start_visit', entityType: 'appointment', entityId: id,
      after: { visitId: visit.id },
    });
    return { visitId: visit.id, made: true };
  }
}
