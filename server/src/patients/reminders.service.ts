import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { SettingsService } from '../config/settings.service';
import { faDateStr } from './summary.service';

/**
 * یادآوری‌ها — نسخهٔ ۱: «ویزیتِ بعدی» (docs/BOOKING.md، فازِ یادآوری‌ها).
 *
 * دفترِ `reminders` تنها منبعِ حقیقت است: هر تغییرِ `nextVisitDate` همین‌جا
 * به یک ردیفِ pending ترجمه می‌شود (و قبلی‌ها cancelled)، و sweep — چه
 * workerِ سراسری چه دکمهٔ دستی — فقط pendingهای سررسیده را می‌فرستد.
 *
 * ⚠️ زمان‌بندی: یک روز قبل از ویزیت، ساعتِ ~۱۰ صبحِ تهران (۰۶:۳۰ UTC).
 * ثابت است نه تنظیم؛ تنظیم‌شدنی‌کردنش وقتی ارزش دارد که اولین مشتری
 * واقعاً چیزِ دیگری بخواهد — تا آن روز، یک knob کمتر.
 */
@Injectable()
export class RemindersService {
  private readonly log = new Logger('Reminders');

  constructor(
    private prisma: PrismaService,
    private sms: SmsService,
    private settings: SettingsService,
  ) {}

  /** موعدِ ارسال از تاریخِ ویزیت: روزِ قبل، ۰۶:۳۰ UTC (~۱۰:۰۰ تهران). */
  private dueFor(nextVisit: Date): Date | null {
    const base = Date.UTC(nextVisit.getUTCFullYear(), nextVisit.getUTCMonth(), nextVisit.getUTCDate());
    const due = new Date(base - 24 * 3600_000 + 6.5 * 3600_000);
    if (due.getTime() > Date.now()) return due;
    /* موعدِ محاسبه‌شده گذشته ولی خودِ ویزیت هنوز نیامده (ویزیتِ فردا که
       امروز عصر ثبت شد) → در اولین sweep برود. ویزیتِ گذشته → یادآوری ندارد. */
    return nextVisit.getTime() > Date.now() ? new Date(Date.now() + 60_000) : null;
  }

  /**
   * هم‌گام‌سازیِ یادآوریِ یک مراجعه با `nextVisitDate` فعلی‌اش.
   * cancel-then-create و نه ویرایش: تاریخچهٔ «قرار بود کی بفرستیم» می‌ماند.
   * خطا بلعیده می‌شود ولی لاگ می‌شود — ثبتِ مراجعه نباید قربانیِ یادآوری شود.
   */
  async syncNextVisit(visitId: number) {
    try {
      const v = await this.prisma.visit.findUnique({
        where: { id: visitId },
        select: {
          id: true, patientId: true, nextVisitDate: true, seq: true,
          patient: { select: { phone: true, firstName: true, lastName: true, code: true } },
        },
      });
      if (!v) return;
      await this.prisma.reminder.updateMany({
        where: { visitId, kind: 'next_visit', status: 'pending' },
        data: { status: 'cancelled' },
      });
      if (!v.nextVisitDate) return;
      const dueAt = this.dueFor(v.nextVisitDate);
      if (!dueAt) return;
      const phone = String(v.patient?.phone ?? '').trim() || null;
      const brand = await this.settings.brand().catch(() => ({ name: null as string | null }));
      const text = `${brand.name ? brand.name + '\n' : ''}یادآوری: ویزیتِ بعدیِ شما ${faDateStr(v.nextVisitDate)} است.`;
      await this.prisma.reminder.create({
        data: { patientId: v.patientId, visitId, kind: 'next_visit', dueAt, phone, text },
      });
    } catch (e) {
      this.log.error(`syncNextVisit(${visitId}) شکست خورد: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** فهرست برای ادمین — pendingهای پیشِ‌رو + آخرین ارسال‌شده‌ها. */
  async list() {
    const rows = await this.prisma.reminder.findMany({
      where: { status: { in: ['pending', 'sent', 'failed'] } },
      orderBy: [{ status: 'asc' }, { dueAt: 'desc' }],
      take: 100,
      include: {
        patient: { select: { code: true, firstName: true, lastName: true } },
        visit: { select: { seq: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      dueAt: r.dueAt,
      sentAt: r.sentAt,
      phone: r.phone,
      text: r.text,
      error: r.error,
      patientName: r.patient ? `${r.patient.firstName} ${r.patient.lastName}`.trim() : null,
      visitCode: r.patient && r.visit ? `${r.patient.code}-V${r.visit.seq}` : null,
    }));
  }

  /**
   * ارسالِ pendingهای سررسیدهٔ **همین شرکت** — هستهٔ مشترکِ worker و دکمهٔ
   * دستی. ادعا اتمی است (updateMany با شرطِ status) تا دو sweep هم‌زمان یک
   * پیام را دوبار نفرستند.
   */
  async sweep() {
    const due = await this.prisma.reminder.findMany({
      where: { status: 'pending', dueAt: { lte: new Date() } },
      orderBy: { dueAt: 'asc' },
      take: 25,
    });
    let sent = 0, failed = 0, skipped = 0;
    for (const r of due) {
      const claimed = await this.prisma.reminder.updateMany({
        where: { id: r.id, status: 'pending' },
        data: { status: 'sent', sentAt: new Date() },
      });
      if (!claimed.count) { skipped += 1; continue; }
      try {
        if (!r.phone) throw new Error('شماره‌ای ثبت نشده');
        const res = await this.sms.send(r.phone, r.text);
        if (!res.sent && !res.stub) throw new Error('سرویسِ پیامک نپذیرفت');
        sent += 1;
      } catch (e) {
        failed += 1;
        await this.prisma.reminder.update({
          where: { id: r.id },
          data: { status: 'failed', error: String(e instanceof Error ? e.message : e).slice(0, 300) },
        }).catch(() => undefined);
      }
    }
    return { due: due.length, sent, failed, skipped };
  }
}
