import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { SettingsService } from '../config/settings.service';
import { TenantContext } from '../tenant/tenant-context';
import { toEnDigits } from '../common/identity';
import { faDateStr } from './summary.service';
import { renderSms } from '../common/sms-template';

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
    private tenant: TenantContext,
  ) {}

  /**
   * موعدِ ارسال نسبت به یک تاریخ: `offsetDays` روز جلو/عقب، در ساعتِ ثابتِ
   * UTC. اگر موعدِ محاسبه‌شده گذشته ولی خودِ رویداد هنوز نیامده (ویزیتِ
   * فردا که امروز عصر ثبت شد) → اولین sweep؛ رویدادِ گذشته → یادآوری ندارد.
   */
  private dueOn(event: Date, offsetDays: number, hourUtc: number): Date | null {
    const base = Date.UTC(event.getUTCFullYear(), event.getUTCMonth(), event.getUTCDate());
    const due = new Date(base + offsetDays * 24 * 3600_000 + hourUtc * 3600_000);
    if (due.getTime() > Date.now()) return due;
    const eventEnd = base + 24 * 3600_000; // تا پایانِ روزِ رویداد
    return eventEnd > Date.now() || offsetDays > 0 ? new Date(Date.now() + 60_000) : null;
  }

  /** ساعتِ تهران → ساعتِ UTC برای dueOn. */
  private static utcHour(tehranHour: number) {
    return tehranHour - 3.5;
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
          id: true, patientId: true, nextVisitDate: true, seq: true, kind: true,
          opDate: true, opStatus: true, procedureTypeId: true, diagnosisId: true,
          procedureType: { select: { preOpCare: true, postOpCare: true, followUpDays: true } },
          patient: {
            select: {
              phone: true, firstName: true, lastName: true, code: true,
              nationalId: true, birthDate: true, address: true,
            },
          },
        },
      });
      if (!v) return;
      const phone = String(v.patient?.phone ?? '').trim() || null;
      const brand = await this.settings.brand().catch(() => ({ name: null as string | null }));
      const prefix = brand.name ? brand.name + '\n' : '';
      /* متن و زمان‌بندی از تنظیماتِ شرکت — «مرکزِ پیامک‌ها»؛ متنِ ویراسته و
         روز/ساعتِ انتخابیِ خودِ مطب. */
      const cfg = await this.settings.sms();
      const hour = RemindersService.utcHour(cfg.reminderHour);

      /* «ویزیتِ بعدی» */
      await this.prisma.reminder.updateMany({
        where: { visitId, kind: 'next_visit', status: 'pending' },
        data: { status: 'cancelled' },
      });
      if (v.nextVisitDate) {
        const dueAt = this.dueOn(v.nextVisitDate, -cfg.nextVisitDays, hour);
        if (dueAt) {
          await this.prisma.reminder.create({
            data: {
              patientId: v.patientId, visitId, kind: 'next_visit', dueAt, phone,
              text: `${prefix}${renderSms(cfg.nextVisitText, { date: faDateStr(v.nextVisitDate) })}`,
            },
          });
        }
      }

      /* «عملِ پیشِ‌رو» + مراقبتِ قبل/بعدِ عمل — فقط جراحیِ لغونشدهٔ تاریخ‌دار.
         متنِ مراقبت از قالبِ **نوعِ عمل** می‌آید (تعریف‌های پایه)؛ قالبِ خالی
         یعنی برای این نوع پیامی نمی‌رود. */
      await this.prisma.reminder.updateMany({
        where: { visitId, kind: { in: ['surgery', 'pre_op_care', 'post_op_care', 'follow_up'] }, status: 'pending' },
        data: { status: 'cancelled' },
      });
      if (v.kind === 'surgery' && v.opDate && v.opStatus !== 'cancelled') {
        /* فرمِ پیگیریِ پس از عمل — روزها از خودِ نوعِ عمل (تعریف‌های پایه).
           لینکِ فرم همین‌جا آماده می‌شود تا متنِ ثبت‌شده در دفتر کامل باشد؛
           پیامکِ مراقبتِ بعد از عمل هم همان لینک را ضمیمه می‌کند. */
        const followDays = RemindersService.parseDays(v.procedureType?.followUpDays);
        /* خطای ساختِ لینک (مثلاً نبودِ tenant context) نباید یادآوریِ عمل و
           مراقبت‌ها را قربانی کند — بدونِ لینک ادامه می‌دهیم و لاگ می‌ماند. */
        const followUrl = followDays.length
          ? await this.followUpUrl(v, followDays).catch((e) => {
            this.log.warn(`لینکِ پیگیریِ visit ${visitId} ساخته نشد: ${e instanceof Error ? e.message : e}`);
            return null;
          })
          : null;
        if (followUrl) {
          for (const day of followDays) {
            const due = this.dueOn(v.opDate, day, hour);
            if (!due) continue;
            await this.prisma.reminder.create({
              data: {
                patientId: v.patientId, visitId, kind: 'follow_up', dueAt: due, phone,
                text: `${prefix}${renderSms(cfg.followUpText, { link: followUrl })}`,
              },
            });
          }
        }
        const dueAt = this.dueOn(v.opDate, -cfg.surgeryDays, hour);
        if (dueAt) {
          await this.prisma.reminder.create({
            data: {
              patientId: v.patientId, visitId, kind: 'surgery', dueAt, phone,
              text: `${prefix}${renderSms(cfg.surgeryText, { date: faDateStr(v.opDate) })}`,
            },
          });
        }
        const pre = v.procedureType?.preOpCare?.trim();
        if (pre) {
          const preDue = this.dueOn(v.opDate, -cfg.preOpDays, hour);
          if (preDue) {
            await this.prisma.reminder.create({
              data: { patientId: v.patientId, visitId, kind: 'pre_op_care', dueAt: preDue, phone, text: `${prefix}${pre}` },
            });
          }
        }
        const post = v.procedureType?.postOpCare?.trim();
        if (post) {
          const postDue = this.dueOn(v.opDate, cfg.postOpDays, hour);
          if (postDue) {
            await this.prisma.reminder.create({
              data: {
                patientId: v.patientId, visitId, kind: 'post_op_care', dueAt: postDue, phone,
                /* لینکِ فرمِ پیگیری ضمیمهٔ همین پیامِ مراقبت — «پیامِ روزِ بعد =
                   متنِ مراقبت + لینکِ فرم» (docs/BOOKING.md). */
                text: `${prefix}${post}${followUrl ? `\n${followUrl}` : ''}`,
              },
            });
          }
        }
      }
    } catch (e) {
      this.log.error(`syncNextVisit(${visitId}) شکست خورد: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** «۷,۳۰,۹۰» (فارسی یا لاتین، با هر جداکننده) → [7, 30, 90]. */
  static parseDays(raw?: string | null): number[] {
    if (!raw?.trim()) return [];
    const days = toEnDigits(raw).split(/[^0-9]+/)
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 365);
    return [...new Set(days)].sort((a, b) => a - b);
  }

  /**
   * لینکِ فرمِ پیگیریِ این جراحی — بخشِ عمومی + بخش‌های اختصاصیِ منطبق با
   * نوعِ عمل و تشخیصِ ثبت‌شده، همه پشتِ **یک** توکن (بخش‌های اختصاصی
   * صفحه‌های بعدیِ همان فرم می‌شوند — `formView`ِ intake).
   *
   * ثبت‌نامِ بازِ همین فرم برای همین بیمار دوباره استفاده می‌شود (همان قاعدهٔ
   * `sendToPatient`)، پس هم‌گام‌سازی‌های مکرر ردیفِ نیمه‌کاره نمی‌کارند؛
   * اعتبارش تا آخرین موعدِ پیگیری + ۱۴ روز تمدید می‌شود.
   */
  private async followUpUrl(
    v: {
      patientId: number; opDate: Date | null; procedureTypeId: number | null; diagnosisId: number | null;
      patient: {
        firstName: string; lastName: string; phone: string | null;
        nationalId: string | null; birthDate: Date | null; address: string | null;
      } | null;
    },
    days: number[],
  ): Promise<string | null> {
    const forms = await this.prisma.formDef.findMany({
      where: {
        active: true, scope: 'record',
        OR: [
          { followUp: 'general' },
          ...(v.procedureTypeId ? [{ followUp: 'procedure', procedureTypeId: v.procedureTypeId }] : []),
          ...(v.diagnosisId ? [{ followUp: 'diagnosis', diagnosisId: v.diagnosisId }] : []),
        ],
      },
      orderBy: { id: 'asc' },
      select: { id: true, followUp: true },
    });
    if (!forms.length) return null;
    /* پایه، بخشِ عمومی است؛ اگر تعریف نشده، اولین بخشِ اختصاصی پایه می‌شود. */
    const base = forms.find((f) => f.followUp === 'general') ?? forms[0];
    const extraFormIds = forms.filter((f) => f.id !== base.id).map((f) => f.id);

    const lastDay = days[days.length - 1];
    const opMs = (v.opDate ?? new Date()).getTime();
    const expiresAt = new Date(Math.max(Date.now(), opMs + lastDay * 24 * 3600_000) + 14 * 24 * 3600_000);

    const open = await this.prisma.intakeSubmission.findFirst({
      where: { patientId: v.patientId, formId: base.id, linkId: null, status: { in: ['pending_fill', 'pending_payment'] } },
      orderBy: { id: 'desc' },
    });
    const row = open
      ? await this.prisma.intakeSubmission.update({
        where: { id: open.id },
        data: {
          extraFormIds,
          expiresAt: open.expiresAt && open.expiresAt > expiresAt ? open.expiresAt : expiresAt,
        },
      })
      : await this.prisma.intakeSubmission.create({
        data: {
          token: randomBytes(18).toString('base64url'),
          linkId: null,
          formId: base.id,
          patientId: v.patientId,
          amount: 0,
          status: 'pending_fill',
          extraFormIds,
          data: {
            firstName: v.patient?.firstName, lastName: v.patient?.lastName,
            nationalId: v.patient?.nationalId ?? null, phone: v.patient?.phone ?? null,
            address: v.patient?.address ?? null,
            birthDate: v.patient?.birthDate ? v.patient.birthDate.toISOString() : null,
          },
          expiresAt,
        },
      });
    return `https://${this.tenant.require().hostname}/f/${row.token}`;
  }

  /**
   * هم‌گام‌سازیِ یادآوریِ یک **نوبت** — گرفتن/جابه‌جایی/لغو.
   * موعد: عصرِ روزِ قبل (~۱۷:۰۰ تهران) تا بیمار برای فردایش برنامه بریزد.
   */
  async syncAppointment(appointmentId: number) {
    try {
      const a = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          id: true, patientId: true, date: true, startMin: true, status: true,
          topic: { select: { name: true } },
          patient: { select: { phone: true } },
        },
      });
      if (!a) return;
      await this.prisma.reminder.updateMany({
        where: { appointmentId, kind: 'appointment', status: 'pending' },
        data: { status: 'cancelled' },
      });
      if (!['held', 'confirmed'].includes(a.status)) return;
      const cfg = await this.settings.sms();
      const dueAt = this.dueOn(a.date, -1, RemindersService.utcHour(cfg.appointmentHour));
      if (!dueAt) return;
      const brand = await this.settings.brand().catch(() => ({ name: null as string | null }));
      const time = a.startMin != null
        ? `، ساعتِ ${String(Math.floor(a.startMin / 60)).padStart(2, '0')}:${String(a.startMin % 60).padStart(2, '0')}`
        : '';
      const topic = a.topic?.name ? ` (${a.topic.name})` : '';
      await this.prisma.reminder.create({
        data: {
          patientId: a.patientId, appointmentId, kind: 'appointment', dueAt,
          phone: String(a.patient?.phone ?? '').trim() || null,
          text: `${brand.name ? brand.name + '\n' : ''}${renderSms(cfg.appointmentText, { date: faDateStr(a.date), time, topic })}`,
        },
      });
    } catch (e) {
      this.log.error(`syncAppointment(${appointmentId}) شکست خورد: ${e instanceof Error ? e.message : e}`);
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
