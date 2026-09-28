import { ORDER_KIND_LABELS, REMINDER_KIND_LABELS, REMINDER_LABELS } from './labels';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { cancelSms, type CancelKind } from '../common/cancel-reasons';
import { SmsService, meliCodeText, meliErrorCodeOf } from '../sms/sms.service';
import { SettingsService } from '../config/settings.service';
import { TenantContext } from '../tenant/tenant-context';
import { toEnDigits } from '../common/identity';
import { faDateStr } from './summary.service';
import { renderSms } from '../common/sms-template';
import { sendReminders } from '../reminders/send-reminders';
import { AuditService } from '../audit/audit.service';
import { diagnosisIds, procedureIds } from './visit-coding';
import { toJalali } from '../common/jalali';

/** ممیزیِ ارسال‌های مستقیمِ پیامک از دکمه‌ها — برای خطِ زمانیِ گزارشِ عیب‌یابی. */
const DIRECT_SMS: Record<string, string> = {
  'intake.link.sms': 'لینکِ ثبت‌نام',
  'intake.send_form': 'ارسالِ فرم',
  'visit.summary.sms': 'خلاصهٔ ویزیت',
  'patient.portal.sms': 'پروندهٔ الکترونیک',
};

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
/** یادآوری‌هایی که `syncNextVisit` برنامه‌ریزی‌شان می‌کند — و فقط همین‌ها را هرس می‌کند. */
const PLANNED_KINDS = ['next_visit', 'surgery', 'pre_op_care', 'post_op_care', 'follow_up'];

/** روزِ موعد به `YYYY-MM-DD`ِ UTC — کلید نباید با ساعتِ ارسال عوض شود. */
const dueDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * کلیدِ یکتای یک یادآوری — W1.9، قراردادِ §۸.
 *
 * `${kind}:${visit|appointment}:${روزِ موعد}:${۸ رقمِ اولِ sha256(متن)}`
 *
 * ⚠️ **چرا متن هم در کلید هست.** بدونِ آن، جابه‌جاییِ متنِ مراقبت یا تاریخِ
 * عمل «همان یادآوری» به‌حساب می‌آمد و پیامِ **تازه** هرگز نمی‌رفت؛ بیمار
 * دستورِ کهنه را داشت. با متن در کلید، پیامِ عوض‌شده کلیدِ تازه می‌گیرد و
 * کاشته می‌شود، و پیامِ دست‌نخورده همان ردیفِ قبلی می‌ماند — چه `pending`
 * باشد چه `sent`. همین دومی جای `sentSame`ِ دستی را می‌گیرد.
 */
export function reminderKey(
  kind: string,
  ref: { visitId?: number | null; appointmentId?: number | null },
  dueAt: Date,
  text: string,
): string {
  const scope = ref.visitId != null ? String(ref.visitId)
    : ref.appointmentId != null ? `a${ref.appointmentId}`
      : 'x';
  return `${kind}:${scope}:${dueDay(dueAt)}:${createHash('sha256').update(text).digest('hex').slice(0, 8)}`;
}

@Injectable()
export class RemindersService {
  private readonly log = new Logger('Reminders');

  constructor(
    private prisma: PrismaService,
    private sms: SmsService,
    private settings: SettingsService,
    private tenant: TenantContext,
    /* ⚠️ اختیاری چون سه سوییتِ e2e این سرویس را **مستقیم** می‌سازند
       (`new RemindersService(db, sms, settings, tenant)`) و پارامترِ اجباریِ
       تازه بی‌صدا `undefined` می‌شد. Nest خودش همیشه پاسش می‌دهد. */
    private audit?: AuditService,
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
    return eventEnd > Date.now() || offsetDays >= 0 ? new Date(Date.now() + 60_000) : null;
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
  async syncNextVisit(visitId: number, strict = false) {
    try {
      const v = await this.prisma.visit.findUnique({
        where: { id: visitId },
        select: {
          id: true, patientId: true, nextVisitDate: true, seq: true, kind: true,
          opDate: true, opStatus: true, procedureTypeId: true, diagnosisId: true,
          /* بستهٔ ۷ — فقط شناسه‌ها، برای بخش‌های فرمِ پیگیری (`followUpUrl`).
             ⚠️ متنِ مراقبت و روزهای پیگیری عمداً از **عملِ اصلی** می‌مانند
             (`procedureType` پایین): پیامکِ دوم برای عملِ همزمان یعنی دو دستورِ
             ناهم‌خوان در یک روز، و متن جزوِ کلیدِ یکتای یادآوری است. */
          otherProcedures: { select: { procedureTypeId: true } },
          otherDiagnoses: { select: { diagnosisId: true } },
          postOpCare: true, followUpDays: true, postOpImmediate: true, preOpCare: true, preOpImmediate: true,
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

      /**
       * W1.9/§۸ — **برنامه‌ریزی، نه لغو-و-ساخت.**
       *
       * تا امروز هر بار که این تابع صدا زده می‌شد (هر ویرایشِ مراجعه، هر
       * تغییرِ وضعیت) همهٔ یادآوری‌های `pending` لغو و از نو ساخته می‌شدند.
       * سه عارضه داشت: شناسهٔ ردیف هر بار عوض می‌شد، دفترِ یادآوری‌ها پر از
       * ردیفِ `cancelled`ِ بی‌معنی می‌شد، و برای اینکه پیامی که **قبلاً رفته**
       * دوباره نرود باید با کوئریِ دستیِ `sentSame` متن را مقایسه می‌کردیم.
       *
       * حالا هر یادآوری کلیدِ یکتای خودش را دارد (`reminderKey`) و مسیر این است:
       * ۱) برنامهٔ تازه ساخته می‌شود؛ ۲) هر موردش **upsert** می‌شود — ردیفِ
       * موجود با همان کلید دست نمی‌خورد، چه `pending` باشد چه `sent`؛
       * ۳) در پایان فقط ردیف‌هایی لغو می‌شوند که کلیدشان **در برنامهٔ تازه
       * نیست**.
       *
       * پس پیامِ دست‌نخورده همان ردیفِ قبلی می‌ماند و پیامِ عوض‌شده (متن یا
       * تاریخ) کلیدِ تازه می‌گیرد و کاشته می‌شود — همان رفتاری که `sentSame`
       * دستی می‌ساخت، این بار از خودِ کلید.
       */
      const planned = new Set<string>();
      const plan = async (
        kind: string,
        dueAt: Date,
        text: string,
        extra: Record<string, unknown> = {},
      ) => {
        const dedupeKey = reminderKey(kind, { visitId }, dueAt, text);
        planned.add(dedupeKey);
        await this.prisma.reminder.upsert({
          where: { dedupeKey },
          /* عمداً خالی: ردیفِ موجود همان است که می‌خواستیم؛ دست‌زدن به موعدش
             یعنی پیامِ رفته را دوباره بفرستیم یا موعدِ در جریان را بلغزانیم. */
          update: {},
          create: { patientId: v.patientId, visitId, kind, dueAt, phone, text, dedupeKey, ...extra },
        });
      };

      /* «ویزیتِ بعدی» */
      if (v.nextVisitDate) {
        /* اگر همان روز نوبتِ فعال دارد (مسیرِ «از همان ثبت، پیشنهادِ نوبت»)،
           یادآوریِ نوبت خودش می‌رود و این یکی دوبله می‌شد — کاشته نمی‌شود. */
        const hasAppt = await this.prisma.appointment.findFirst({
          where: {
            patientId: v.patientId, date: v.nextVisitDate,
            status: { in: ['held', 'confirmed', 'arrived', 'done'] },
          },
          select: { id: true },
        });
        const dueAt = hasAppt ? null : this.dueOn(v.nextVisitDate, -cfg.nextVisitDays, hour);
        if (dueAt) {
          await plan('next_visit', dueAt, `${prefix}${renderSms(cfg.nextVisitText, { date: faDateStr(v.nextVisitDate) })}`);
        }
      }

      /* «عملِ پیشِ‌رو» + مراقبتِ قبل/بعدِ عمل — فقط جراحیِ لغونشدهٔ تاریخ‌دار.
         متنِ مراقبت از قالبِ **نوعِ عمل** می‌آید (تعریف‌های پایه)؛ قالبِ خالی
         یعنی برای این نوع پیامی نمی‌رود. */
      if (v.kind === 'surgery' && v.opDate && v.opStatus !== 'cancelled') {
        /* فرمِ پیگیریِ پس از عمل — روزها از خودِ نوعِ عمل (تعریف‌های پایه).
           لینکِ فرم همین‌جا آماده می‌شود تا متنِ ثبت‌شده در دفتر کامل باشد؛
           پیامکِ مراقبتِ بعد از عمل هم همان لینک را ضمیمه می‌کند. */
        /* اختصاصیِ همین مراجعه مقدم است — جراح بعد از عمل همان‌جا تعیین می‌کند. */
        const followDays = RemindersService.parseDays(v.followUpDays ?? v.procedureType?.followUpDays);
        /* ⚠️ cancel-then-create فقط pendingها را لغو می‌کند؛ موعدی که به
           «همین حالا» فروکش کرده (روزِ ۰، ثبتِ دیرهنگام، ویرایشِ بعد از
           ارسال) اگر قبلاً **همین متن** رفته باشد نباید دوباره برود — وگرنه
           هر ویرایشِ فرم پیامکِ تکراری می‌شد. مقایسه با متن است، نه فقط نوع:
           جراح که متنِ مراقبت را عوض می‌کند یا تاریخِ عمل جابه‌جا می‌شود،
           پیامِ **تازه** باید برود (گزارشِ میدانی: نسخهٔ قبلیِ این گارد
           متنِ اصلاح‌شده را هم بلاک می‌کرد و بیمار پیامِ کهنه را داشت). */
        const collapsed = (d: Date) => d.getTime() <= Date.now() + 90_000;
        /**
         * W1.7/D07 — پیامِ **پس از** عمل وقتی هنوز «انجام شد» ثبت نشده.
         *
         * مراقبتِ بعد از عمل و فرمِ پیگیری برای عملی کاشته می‌شوند که ممکن است
         * اصلاً انجام نشده باشد: `opStatus` تا وقتی کسی دستی ثبتش نکند
         * `pending` می‌ماند، و موعدِ این دو پیام بعد از تاریخِ عمل است. پس
         * بیمارِ موکول‌شده دستورِ «بعد از عمل» می‌گرفت.
         *
         * پیش‌فرضِ سند «نگه‌داشتنِ پیام تا تأیید» بود؛ **مالک آن را رد کرد**
         * (`DECISIONS.md` #۱): پیام برود ولی متنش دوشاخه باشد. بیمارِ واقعی
         * ممکن است عملش انجام شده و فقط کسی وضعیت را ثبت نکرده باشد —
         * نفرستادن او را بی‌دستور می‌گذارد.
         *
         * متن هنگامِ **کاشت** تعیین می‌شود نه هنگامِ ارسال (`sendReminders`
         * فقط `row.text` را می‌فرستد). ولی `setStatus` خودش `syncNextVisit`
         * را صدا می‌زند، پس لحظه‌ای که جراح «انجام شد» می‌زند موعدهای
         * نرفته لغو و با متنِ عادی دوباره کاشته می‌شوند.
         *
         * کادرِ خالی در تنظیمات = همان متنِ عادی (کلینیکی که این هشدار را
         * نمی‌خواهد نباید مجبور باشد).
         */
        const careText = (body: string) => {
          if (v.opStatus === 'done') return body;
          const wrap = (cfg.careUnconfirmedText ?? '').trim();
          return wrap ? renderSms(wrap, { care: body }) : body;
        };
        /* `sentSame` این‌جا بود و با W1.9 برداشته شد: جلوگیری از پیامِ تکراری
           حالا کارِ خودِ `dedupeKey` است — همان متن + همان موعد = همان کلید =
           همان ردیف، چه `pending` باشد چه `sent`. کوئریِ دستی هم یک درخواستِ
           اضافه بود هم فقط `sent` را می‌دید. */
        /* «بلافاصله» یعنی واقعاً همین حالا — نه صبرکردن تا ساعتِ ارسالِ روزانه.
           برای عملِ آینده ولی معنایش «روزِ عمل» است (در ساعتِ ارسال). */
        const opDate = v.opDate as Date;
        const immediateDue = (): Date | null => {
          const opStart = Date.UTC(opDate.getUTCFullYear(), opDate.getUTCMonth(), opDate.getUTCDate());
          return opStart <= Date.now() ? new Date(Date.now() + 60_000) : this.dueOn(opDate, 0, hour);
        };
        /* خطای ساختِ لینک (مثلاً نبودِ tenant context) نباید یادآوریِ عمل و
           مراقبت‌ها را قربانی کند — بدونِ لینک ادامه می‌دهیم و لاگ می‌ماند. */
        let followUrl: string | null = null;
        for (const day of followDays) {
          const url = await this.followUpUrl(v, [day]).catch((e) => {
            this.log.warn(`لینک پیگیری visit ${visitId} ساخته نشد: ${e instanceof Error ? e.message : e}`);
            if (strict) throw e;
            return null;
          });
          if (!url) continue;
          followUrl ??= url;
          const due = day === 0 ? immediateDue() : this.dueOn(v.opDate, day, hour);
          if (!due) continue;
          const fuText = `${prefix}${careText(renderSms(cfg.followUpText, { link: url }))}`;
          await plan('follow_up', due, fuText);
        }
        const dueAt = this.dueOn(v.opDate, -cfg.surgeryDays, hour);
        if (dueAt) {
          /* گزارشِ میدانی: عملِ همان‌روز ثبت‌شده هر بار ویرایش، دوباره
             «یادآوریِ عمل» می‌فرستاد — موعد به «حالا» فرومی‌کاهد و قبلی sent
             است، پس cancel-then-create نمی‌گرفتش. متنِ یکسان = نرفتن؛
             تاریخِ عوض‌شده متنِ تازه دارد و درست است که برود. */
          const sgText = `${prefix}${renderSms(cfg.surgeryText, { date: faDateStr(v.opDate) })}`;
          await plan('surgery', dueAt, sgText);
        }
        /* اختصاصیِ همین مراجعه مقدم است — همان قاعدهٔ مراقبتِ بعد از عمل. */
        const pre = (v.preOpCare ?? v.procedureType?.preOpCare)?.trim();
        if (pre) {
          const preText = `${prefix}${pre}`;
          const preDue = this.dueOn(v.opDate, -cfg.preOpDays, hour);
          /* ⚠️ «به‌محضِ ثبت» در مراقبتِ **قبل** از عمل جایگزینِ موعدِ مقرر
             نیست، مکمّلِ آن است: بیمارِ ثبت‌شده چندروز قبل باید همان لحظه
             دستورها را بگیرد و نزدیکِ عمل هم یادآوری شود. (برعکسِ مراقبتِ
             بعد از عمل که «بلافاصله» جایگزینِ فردای عمل است.) */
          const dues: Date[] = [];
          if (v.preOpImmediate) dues.push(new Date(Date.now() + 60_000));
          /* موعدِ مقرری که خودش به «حالا» فروکش کرده، تکرارِ همان پیامِ فوری
             است — دوباره کاشته نمی‌شود. */
          if (preDue && !(dues.length && collapsed(preDue))) dues.push(preDue);
          for (const due of dues) await plan('pre_op_care', due, preText);
        }
        const post = (v.postOpCare ?? v.procedureType?.postOpCare)?.trim();
        if (post) {
          /* «بلافاصله بعد از ثبت» = روزِ ۰ (اگر روزِ عمل رسیده، dueOn خودش
             به «همین حالا» فرومی‌کاهد)؛ وگرنه فردای عمل (postOpDays). */
          const postDue = v.postOpImmediate ? immediateDue() : this.dueOn(v.opDate, cfg.postOpDays, hour);
          const postText = `${prefix}${careText(`${post}${followUrl ? `\n${followUrl}` : ''}`)}`;
          /* لینکِ فرمِ پیگیری ضمیمهٔ همین پیامِ مراقبت — «پیامِ روزِ بعد =
             متنِ مراقبت + لینکِ فرم» (docs/BOOKING.md). */
          if (postDue) await plan('post_op_care', postDue, postText);
        }
      }

      /**
       * هرس — فقط آنچه در برنامهٔ تازه **نیست**.
       *
       * ⚠️ `dedupeKey: null` صریح لازم است: ردیف‌های پیش از W1.9 کلید ندارند و
       * در SQL شرطِ `NOT (dedupe_key IN (…))` روی `NULL` نتیجه‌اش `NULL` است،
       * یعنی آن ردیف **match نمی‌شود** و برای همیشه `pending` می‌ماند. با
       * `OR` صریح، یادآوریِ کهنه هم درست لغو می‌شود.
       */
      /**
       * ⚠️ لغوِ **سیستمی** کلیدش را آزاد می‌کند (`dedupeKey: null`)، لغوِ **دستی**
       * (W0.7، `cancel()`) نه. چرا: `upsert` بالا با `update: {}` ردیفِ موجودِ
       * هم‌کلید را دست نمی‌زند — درست برای `pending` و `sent`، ولی برای ردیفی
       * که همین هرس لغو کرده بود یعنی «هرگز دوباره کاشته نمی‌شود»: لغوِ عمل و
       * برگشت به `pending`، لغوِ نوبتی که ویزیتِ بعدی را پوشش می‌داد، پاک‌کردنِ
       * overrideِ مراقبت، دوباره‌گذاشتنِ تاریخِ ویزیتِ بعدی — همه بی‌یادآور
       * می‌ماندند چون متن و موعد همان قبلی است و همان کلید به ردیفِ `cancelled`
       * می‌خورد (پنج سوییتِ زنده همین را قرمز می‌کردند). با آزادشدنِ کلید،
       * برنامهٔ تازه ردیفِ تازه می‌کارد و ردیفِ لغوشده به‌عنوانِ سابقه می‌ماند.
       * ردیفی که **آدم** لغو کرده کلیدش را نگه می‌دارد تا هم‌گام‌سازیِ بعدی
       * تصمیمِ او را بی‌صدا برنگرداند؛ پیامِ عوض‌شده (متن/تاریخ) کلیدِ تازه دارد
       * و طبقِ معمول کاشته می‌شود.
       */
      const prune = { visitId, kind: { in: PLANNED_KINDS }, status: 'pending' };
      await this.prisma.reminder.updateMany({
        where: planned.size
          ? { ...prune, OR: [{ dedupeKey: null }, { dedupeKey: { notIn: [...planned] } }] }
          : prune,
        data: { status: 'cancelled', dedupeKey: null },
      });
    } catch (e) {
      this.log.error(`syncNextVisit(${visitId}) شکست خورد: ${e instanceof Error ? e.message : e}`);
      if (strict) throw e;
    }
  }

  /** «۷,۳۰,۹۰» (فارسی یا لاتین، با هر جداکننده) → [7, 30, 90]. */
  static parseDays(raw?: string | null): number[] {
    if (!raw?.trim()) return [];
    const days = toEnDigits(raw).split(/[^0-9]+/)
      .filter((x) => x !== '') // Number('') === 0 — رشتهٔ خالی نباید «بلافاصله» جا بزند
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 365);
    return [...new Set(days)].sort((a, b) => a - b);
  }

  /**
   * لینکِ فرمِ پیگیریِ این جراحی — بخشِ عمومی + بخش‌های اختصاصیِ منطبق با
   * نوعِ عمل و تشخیصِ ثبت‌شده، همه پشتِ **یک** توکن (بخش‌های اختصاصی
   * صفحه‌های بعدیِ همان فرم می‌شوند — `formView`ِ intake).
   *
   * بستهٔ ۷ — بخش‌ها از **همهٔ** عمل‌ها و تشخیص‌های مراجعه می‌آیند، در هر
   * رتبه‌ای: عملِ همزمان یا بیماریِ همراهی که فرمِ پیگیریِ خودش را دارد
   * صفحهٔ بیشتر می‌گیرد، نه پیامکِ بیشتر (یک لینک، یک یادآوری برای هر موج).
   * ⚠️ ترتیب همچنان `id` فرم است نه رتبه: جابه‌جاکردنِ اصلی و سایر نباید
   * صفحه‌های ثبت‌نامِ بازی را که بیمار نیمه‌کاره پر کرده جابه‌جا کند.
   *
   * ثبت‌نامِ بازِ همین فرم برای همین بیمار دوباره استفاده می‌شود (همان قاعدهٔ
   * `sendToPatient`)، پس هم‌گام‌سازی‌های مکرر ردیفِ نیمه‌کاره نمی‌کارند؛
   * اعتبارش تا آخرین موعدِ پیگیری + ۱۴ روز تمدید می‌شود.
   */
  private async followUpUrl(
    v: {
      id: number; patientId: number; opDate: Date | null; procedureTypeId: number | null; diagnosisId: number | null;
      /* اختیاری: فیکسچرِ `intake-finance-roles.mjs` این متد را مستقیم و بدونِ
         سایرین صدا می‌زند؛ نخوانده = فقط اصلی (توابعِ `visit-coding` خودشان
         `?? []` دارند). */
      otherProcedures?: { procedureTypeId: number }[];
      otherDiagnoses?: { diagnosisId: number }[];
      patient: {
        firstName: string; lastName: string; phone: string | null;
        nationalId: string | null; birthDate: Date | null; address: string | null;
      } | null;
    },
    days: number[],
  ): Promise<string | null> {
    const pIds = procedureIds(v);
    const dIds = diagnosisIds(v);
    const forms = await this.prisma.formDef.findMany({
      where: {
        active: true, scope: 'record',
        OR: [
          { followUp: 'general' },
          ...(pIds.length ? [{ followUp: 'procedure', procedureTypeId: { in: pIds } }] : []),
          ...(dIds.length ? [{ followUp: 'diagnosis', diagnosisId: { in: dIds } }] : []),
        ],
      },
      orderBy: { id: 'asc' },
      select: { id: true, followUp: true },
    });
    if (!forms.length) return null;

    const lastDay = days[days.length - 1];
    const opMs = (v.opDate ?? new Date()).getTime();
    const expiresAt = new Date(Math.max(Date.now(), opMs + lastDay * 24 * 3600_000) + 14 * 24 * 3600_000);

    /* ⚠️ ثبت‌نامِ همین موج (مراجعه + روز + تاریخِ عمل) **بی‌قیدِ فرم** جست‌وجو
       می‌شود و پایه‌اش **چسبنده** است (بازبینیِ بستهٔ ۷): با چند عمل/تشخیص،
       مجموعهٔ فرم‌های منطبق با افزودن یا برداشتنِ یک «سایر» عوض می‌شود. نسخهٔ
       قبل پایه را هر بار از نو برمی‌گزید (عمومی، وگرنه کوچک‌ترین id) و فقط
       همان فرم را می‌جست؛ عملِ همزمانی با فرمِ id-کوچک‌تر پایه را عوض می‌کرد،
       ثبت‌نامِ باز پیدا نمی‌شد، توکنِ تازه ساخته می‌شد و — چون لینک در متنِ
       پیامک است — پیامکِ مراقبت و پیگیری **دوباره** می‌رفت و ثبت‌نامِ قبلی
       یتیم در پرتالِ بیمار می‌ماند. حالا فرم‌ها فقط صفحه‌های اضافهٔ همان
       لینک‌اند: یک موج، یک لینک، یک پیامک. */
    const open = await this.prisma.intakeSubmission.findFirst({
      where: { patientId: v.patientId, linkId: null, AND: [
        { data: { path: ['followUpVisitId'], equals: v.id } },
        { data: { path: ['followUpDay'], equals: days[0] } },
        { data: { path: ['followUpOpDate'], equals: v.opDate?.toISOString() ?? '' } },
      ] },
      orderBy: { id: 'desc' },
    });
    /* پایه: فرمِ ثبت‌نامِ همین موج اگر هست؛ وگرنه بخشِ عمومی؛ وگرنه اولین بخشِ اختصاصی. */
    const baseId = open?.formId ?? (forms.find((f) => f.followUp === 'general') ?? forms[0]).id;
    const extraFormIds = forms.filter((f) => f.id !== baseId).map((f) => f.id);
    const row = open
      ? (['pending_fill', 'pending_payment'].includes(open.status) ? await this.prisma.intakeSubmission.update({
        where: { id: open.id },
        data: {
          extraFormIds,
          expiresAt: open.expiresAt && open.expiresAt > expiresAt ? open.expiresAt : expiresAt,
        },
      }) : open)
      : await this.prisma.intakeSubmission.create({
        data: {
          token: randomBytes(18).toString('base64url'),
          linkId: null,
          formId: baseId,
          patientId: v.patientId,
          amount: 0,
          status: 'pending_fill',
          extraFormIds,
          data: {
            followUpVisitId: v.id, followUpDay: days[0], followUpOpDate: v.opDate?.toISOString() ?? '',
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
  async syncAppointment(appointmentId: number, strict = false) {
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
      if (strict) throw e;
    }
  }

  /** فهرست برای ادمین — pendingهای پیشِ‌رو + آخرین ارسال‌شده‌ها. */
  /**
   * **پیامِ لغو به بیمار** (تصمیمِ مالک ۱۴۰۵/۰۶/۲۶).
   *
   * ⚠️ این‌جا می‌نشیند و نه در دو سرویسِ لغو، چون هر دو (`PatientsService` و
   * `AppointmentsService`) از قبل همین سرویس را تزریق کرده‌اند و این تنها
   * جایی است که هم `sms` دارد هم `settings`. دو کپی یعنی روزی متنِ لغوِ نوبت
   * و مراجعه از هم واگرا شوند.
   *
   * ⚠️ **هرگز درخواست را نمی‌شکند.** لغو باید انجام شود حتی اگر پیامک نرود؛
   * نتیجه در همان دفترِ یادآوری‌ها (`kind: 'notice'`) با وضعیتِ `failed`
   * می‌نشیند تا دیده شود، نه اینکه بی‌صدا گم شود.
   *
   * ⚠️ یادداشتِ داخلی **هرگز** به این تابع نمی‌رسد — امضا فقط `reasonKey`
   * می‌گیرد. اگر روزی کسی خواست متنِ آزاد بفرستد، باید امضا را عوض کند و
   * همان‌جا این کامنت را ببیند.
   */
  async notifyCancelled(
    kind: CancelKind,
    patientId: number | null,
    reasonKey: string,
    opts: { when?: string | null } = {},
  ) {
    try {
      if (!patientId) return;
      const p = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { phone: true } });
      const to = String(p?.phone ?? '').replace(/[^0-9]/g, '');
      if (!/^09\d{9}$/.test(to)) return;
      const brand = await this.settings.brand().catch(() => ({ name: null as string | null }));
      const text = cancelSms(kind, reasonKey, { brand: brand?.name ?? null, when: opts.when ?? null });
      const res = await this.sms.send(to, text);
      await this.prisma.reminder.create({
        data: {
          patientId, kind: 'notice', dueAt: new Date(), phone: to, text,
          status: res.sent || res.stub ? 'sent' : 'failed', sentAt: new Date(),
        },
      }).catch(() => undefined);
    } catch { /* لغو نباید به‌خاطرِ پیامک بشکند */ }
  }

  async queueStaffNotice(accountId: number, name: string, text: string, key: string, user: any) {
    for (let attempt = 0; ; attempt++) {
      try { return await this.prisma.$transaction(async tx => {
        const recipient = await tx.account.findFirst({ where: { id: accountId, status: 'active', systemKey: null }, include: { person: { select: { phone: true } } } });
        if (!recipient) throw new Error('حساب کارشناس فعال نیست');
        const sms = await tx.reminder.upsert({ where: { dedupeKey: `${key}:sms` }, update: {}, create: { kind: 'dispatch', channel: 'sms', dedupeKey: `${key}:sms`, recipientAccountId: accountId, recipientName: name, phone: recipient.person.phone, text, dueAt: new Date() } });
        if (!await tx.reminder.findUnique({ where: { dedupeKey: `${key}:chat` } })) {
          const bot = await tx.account.upsert({ where: { systemKey: 'notification-bot' }, update: {}, create: { systemKey: 'notification-bot', status: 'disabled', level: 1, passwordHash: 'non-login-system-account', person: { create: { firstName: 'ربات', lastName: 'اطلاع‌رسانی' } } } });
          const dmKey = `dm:${Math.min(bot.id, accountId)}:${Math.max(bot.id, accountId)}`;
          const channel = await tx.chatChannel.upsert({ where: { dmKey }, update: {}, create: { kind: 'dm', dmKey, createdById: bot.id, members: { create: [{ accountId: bot.id }, { accountId }] } } });
          const message = await tx.chatMessage.create({ data: { channelId: channel.id, authorId: bot.id, authorName: 'ربات اطلاع‌رسانی', body: text } });
          await tx.reminder.create({ data: { kind: 'dispatch', channel: 'chat', dedupeKey: `${key}:chat`, recipientAccountId: accountId, recipientName: name, chatMessageId: message.id, text, dueAt: new Date(), sentAt: new Date(), status: 'sent', deliveryStatus: 'stored' } });
          await tx.auditEvent.create({ data: { actorId: user.id, action: 'dispatch.program.send', entityType: 'account', entityId: String(accountId), afterJson: { reminderId: sms.id, messageId: message.id } } });
        }
        return { smsId: sms.id };
      }); } catch (e: any) { if (attempt < 2 && ['P2002', 'P2034'].includes(e.code)) continue; throw e; }
    }
  }

  /**
   * دفترِ یادآوری‌ها. با `patientId` **همهٔ** ردیف‌های همان پرونده می‌آید — لغوشده‌ها
   * هم — چون پاپ‌آپِ خطِ زمانِ پرونده باید بگوید «چرا نرفت»؛ بدونِ آن، فهرستِ
   * سراسریِ مدیر است که لغوشده‌ها را نشان نمی‌دهد.
   */
  async list(patientId?: number) {
    const rows = await this.prisma.reminder.findMany({
      where: patientId ? { patientId } : { status: { not: 'cancelled' } },
      orderBy: [{ status: 'asc' }, { dueAt: 'desc' }],
      take: 100,
      include: {
        patient: { select: { code: true, firstName: true, lastName: true } },
        visit: { select: { seq: true } },
      },
    });
    const chatIds = rows.flatMap(r => r.chatMessageId ? [r.chatMessageId] : []);
    const chatMessages = chatIds.length ? await this.prisma.chatMessage.findMany({ where: { id: { in: chatIds } }, include: { channel: { include: { members: true } } } }) : [];
    return rows.map((r) => ({
      channel: r.channel, recipientName: r.recipientName, providerId: r.providerId,
      deliveryStatus: r.channel === 'chat' && chatMessages.find(m => m.id === r.chatMessageId)?.channel.members.some(m => m.accountId === r.recipientAccountId && m.lastReadId >= (r.chatMessageId ?? Infinity)) ? 'read' : r.deliveryStatus,
      id: r.id,
      kind: r.kind,
      /**
       * ⚠️ **برچسب همراهِ خودِ ردیف می‌آید، نه فقط در کاتالوگِ `/config`.**
       *
       * نسخهٔ اولِ جمع‌کردنِ نگاشت‌ها، دفترِ یادآوری‌ها را از `/config` تغذیه
       * کرد و یک مسابقه ساخت: صفحه پیش از رسیدنِ `/config` رندر می‌شود، پس
       * هر ردیف یک لحظه (و اگر `/config` نمی‌آمد، برای همیشه) برچسبِ عامِ
       * «یادآوری» می‌گرفت. قاعدهٔ `labels.ts` از اول همین را می‌گفت:
       * کاتالوگ برای **فهرستِ گزینه‌ها** است، برچسبِ یک ردیف از خودِ ردیف.
       */
      kindFa: REMINDER_KIND_LABELS[r.kind] ?? null,
      status: r.status,
      statusFa: REMINDER_LABELS[r.status] ?? null,
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
  async sweep(ids?: number[]) { return sendReminders(this.prisma, this.sms, ids); }

  /**
   * ── اقدامِ تک‌ردیفی روی دفترِ یادآوری‌ها (W0.7/U10) ──────────────────────
   *
   * تا امروز تنها اهرمِ مدیر «sweepِ همه» بود: یک پیامِ شکست‌خورده را نمی‌شد
   * جدا دوباره فرستاد و یک پیامِ اشتباه را نمی‌شد جلویش را گرفت — یا همه، یا هیچ.
   *
   * 🔴 **`sent` نه ارسالِ دوباره می‌گیرد نه لغو.** پیام واقعاً به گوشیِ بیمار
   * رفته: «ارسالِ دوباره» یعنی پیامکِ دومِ سردرگم‌کننده، و «لغو» یعنی دفترِ
   * پیام‌ها دربارهٔ چیزی که رخ داده دروغ بگوید. همان قاعده‌ای که مسیرِ درمان
   * (W4.2) هم دارد: نفرستاده باطل می‌شود، فرستاده هرگز.
   */
  private static RETRYABLE = ['failed', 'uncertain', 'simulated'];
  private static CANCELLABLE = ['pending', 'uncertain', 'failed'];

  private async act(id: number, from: string[], what: string) {
    const row = await this.prisma.reminder.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('یادآوری پیدا نشد');
    if (!from.includes(row.status)) {
      throw new ConflictException(row.status === 'sent'
        ? `این پیام ارسال شده است و ${what} ندارد`
        : `یادآوری در وضعیتِ «${row.status}» ${what} نمی‌شود`);
    }
    return row;
  }

  /** دوباره در صف — شمارندهٔ تلاش صفر می‌شود چون این تصمیمِ یک آدم است، نه backoff. */
  /**
   * عیب‌یابیِ پیامک — گزارشِ متنیِ فارسی از دادهٔ خودِ همین شرکت (۱۴۰۵/۰۷/۰۴).
   *
   * ⚠️ چرا لازم شد: پیامکِ مراقبتِ بعد از عمل هیچ‌وقت نرفته بود و «ارسالِ دوباره» هم رد
   * می‌شد؛ بعد **بی هیچ دیپلویی** همان متن به همان شماره رفت. پس علت بیرون از کد بود
   * (ری‌استارتِ سرور با تنظیماتِ تازه، اعتبارِ پنلِ ملی‌پیامک، ساعتِ ارسال، …) و بدونِ خطِ
   * زمانیِ دقیق فقط می‌شد حدس زد. این گزارش همان خطِ زمانی است: هر تلاشِ ارسال (رویدادهای
   * `sms.*`) با ساعت، نتیجه، طول و تعدادِ بخشِ پیام؛ «ارسالِ دوباره»های دستی (ممیزی)؛ و
   * زمانِ روشن‌شدنِ همین پروسهٔ سرور — تا «بعد از ری‌استارت درست شد» از «بعد از شارژِ پنل
   * درست شد» جدا شود.
   *
   * متنِ پیام و شمارهٔ بیمار در آن **نیست** — فقط طول و کدِ مراجعه.
   */
  async diagnostics(): Promise<string> {
    const DAYS = 14;
    const since = new Date(Date.now() - DAYS * 86_400_000);
    const [events, retries, direct, recent] = await Promise.all([
      this.prisma.domainEvent.findMany({
        where: { type: { in: ['sms.sent', 'sms.failed', 'sms.uncertain'] }, at: { gte: since } },
        orderBy: { at: 'desc' }, take: 80,
      }),
      this.prisma.auditEvent.findMany({
        where: { action: 'reminder.retry', createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' }, take: 40,
      }),
      /* ارسال‌های مستقیم از دکمه‌ها (لینکِ ثبت‌نام، فرم، خلاصه، پرونده، دستورِ پزشک) در دفترِ
         یادآوری رویداد ندارند، فقط ممیزی. بدونِ آن‌ها نمی‌شد گفت «در همان ساعت هیچ پیامکی
         نمی‌رفت» یا «فقط پیامِ بلند نمی‌رفت». `after.to` (شماره) هرگز چاپ نمی‌شود. */
      this.prisma.auditEvent.findMany({
        where: { createdAt: { gte: since }, OR: [
          { action: { in: Object.keys(DIRECT_SMS) } },
          { action: { startsWith: 'order.', endsWith: '.send' } },
        ] },
        orderBy: { createdAt: 'desc' }, take: 60,
      }),
      this.prisma.reminder.findMany({
        where: { channel: 'sms', updatedAt: { gte: since } },
        select: { kind: true, status: true, text: true, providerId: true, error: true },
        take: 2000,
      }),
    ]);
    const ids = [...new Set([
      ...events.flatMap((e) => (e.refType === 'reminder' && e.refId ? [e.refId] : [])),
      ...retries.map((r) => Number(r.entityId)).filter((n) => Number.isInteger(n) && n > 0),
    ])];
    const rows = new Map((ids.length ? await this.prisma.reminder.findMany({
      where: { id: { in: ids } },
      select: { id: true, kind: true, text: true, patient: { select: { code: true } }, visit: { select: { seq: true } } },
    }) : []).map((r) => [r.id, r]));

    const fa = (v: number | string) => String(v).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
    const p2 = (n: number) => String(n).padStart(2, '0');
    /* تهران بی‌ساعتِ تابستانی (همان ۳٫۵ ساعتِ `utcHour`). */
    const at = (d: Date) => {
      const t = new Date(d.getTime() + 3.5 * 3_600_000);
      const [jy, jm, jd] = toJalali(t);
      return fa(`${jy}/${p2(jm)}/${p2(jd)} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`);
    };
    /** اندازهٔ همان چیزی که رفت — با «لغو11»ی که `SmsService` ته پیام می‌گذارد. */
    const size = (text: string) => {
      const n = [...text].length + 6;
      const parts = /^[\x00-\x7f]*$/.test(text)
        ? (n <= 160 ? 1 : Math.ceil(n / 153))
        : (n <= 70 ? 1 : Math.ceil(n / 67));
      return { n, parts };
    };
    const kindFa = (k?: string | null) => (k ? REMINDER_KIND_LABELS[k] ?? k : '—');
    const code = (r?: { patient?: { code: string } | null; visit?: { seq: number } | null }) =>
      (r?.patient && r.visit ? `${r.patient.code}-V${r.visit.seq}` : '—');

    const started = new Date(Date.now() - process.uptime() * 1000);
    const from = process.env.MELI_FROM ?? '';
    const configured = Boolean(process.env.MELI_API_KEY && from);
    const out: string[] = [
      `عیب‌یابیِ پیامک — ${this.tenant.require().hostname}`,
      `اکنون: ${at(new Date())} به وقتِ تهران`,
      `پروسهٔ سرور از ${at(started)} روشن است (هر دیپلوی یا ری‌استارت این زمان را عوض می‌کند)`,
      `کلید و خطِ ملی‌پیامک روی سرور: ${configured ? `تنظیم است (خطِ …${fa(from.slice(-4))})` : 'تنظیم نیست'}`
        + ` · محیط: ${process.env.NODE_ENV ?? '—'}`,
      '',
      `۱) پیامک‌های ${fa(DAYS)} روزِ اخیر به تفکیکِ نوع`,
    ];
    const byKind = new Map<string, { sent: number; fake: number; failed: number; uncertain: number; pending: number; other: number; min: number; max: number; minP: number; maxP: number }>();
    for (const r of recent) {
      const k = byKind.get(r.kind) ?? { sent: 0, fake: 0, failed: 0, uncertain: 0, pending: 0, other: 0, min: Infinity, max: 0, minP: Infinity, maxP: 0 };
      /* «رفت»ی که شناسه‌اش کدِ خطاست، رفته نیست (`meliErrorCodeOf`). */
      if (r.status === 'sent' && meliErrorCodeOf(r.providerId) !== null) k.fake++;
      else if (r.status === 'sent') k.sent++;
      else if (r.status === 'failed') k.failed++;
      else if (r.status === 'uncertain') k.uncertain++;
      else if (r.status === 'pending' || r.status === 'sending') k.pending++;
      else k.other++;
      const { n, parts } = size(r.text);
      k.min = Math.min(k.min, n); k.max = Math.max(k.max, n);
      k.minP = Math.min(k.minP, parts); k.maxP = Math.max(k.maxP, parts);
      byKind.set(r.kind, k);
    }
    if (!byKind.size) out.push('— در این بازه پیامکی نیست');
    for (const [kind, k] of byKind) {
      const range = (a: number, b: number) => (a === b ? fa(a) : `${fa(a)} تا ${fa(b)}`);
      out.push(`• ${kindFa(kind)}: رفته ${fa(k.sent)} · نرفته ${fa(k.failed)} · نامعلوم ${fa(k.uncertain)} · در صف ${fa(k.pending)}`
        + (k.fake ? ` · «رفت»ِ ثبت‌شده که در واقع رد شده ${fa(k.fake)}` : '')
        + (k.other ? ` · دیگر ${fa(k.other)}` : '')
        + ` — ${range(k.min, k.max)} نویسه (${range(k.minP, k.maxP)} بخش)`);
    }

    /* یک خطِ زمانیِ واحد: تلاش‌های دفترِ یادآوری (خودکار یا «ارسالِ دوباره»ی دستی) و
       ارسال‌های مستقیم از دکمه‌ها، کنارِ هم و به ترتیبِ زمان. */
    const OUTCOME: Record<string, string> = { 'sms.sent': 'رفت', 'sms.failed': 'نرفت', 'sms.uncertain': 'نامعلوم' };
    const timeline: { t: number; line: string }[] = [];
    for (const e of events) {
      const row = e.refType === 'reminder' && e.refId ? rows.get(e.refId) : undefined;
      const payload = (e.payload ?? {}) as Record<string, any>;
      const manual = retries.some((r) => Number(r.entityId) === e.refId
        && r.createdAt.getTime() >= e.at.getTime() && r.createdAt.getTime() - e.at.getTime() < 120_000);
      const sz = row ? size(row.text) : null;
      const why = typeof payload.error === 'string' && payload.error.trim() ? ` · ${payload.error.trim().slice(0, 90)}` : '';
      /* پیش از #110 پاسخِ «پیام ارسال نشد (کدِ ۱۱)» هم «رفت» ثبت می‌شد؛ شناسه‌اش همان کد است. */
      const fakeCode = e.type === 'sms.sent' ? meliErrorCodeOf(payload.providerId) : null;
      const outcome = fakeCode !== null
        ? `نرفت (ثبت شده بود «رفت»؛ ملی‌پیامک کدِ ${fa(fakeCode)} داده بود: ${meliCodeText(fakeCode)})`
        : OUTCOME[e.type] ?? e.type;
      /* شمارهٔ ردیف لازم است: «همان پیام بعدتر رفت» (علتِ بیرونی) با «پیامِ تازه‌ای با متنِ
         دیگر رفت» (علت در خودِ متن) فقط از روی آن جدا می‌شود. */
      timeline.push({ t: e.at.getTime(), line: `${at(e.at)} · ${outcome} · ${kindFa(row?.kind ?? payload.kind)} · ${code(row)}`
        + (e.refId ? ` · ردیفِ ${fa(e.refId)}` : '')
        + (sz ? ` · ${fa(sz.n)} نویسه / ${fa(sz.parts)} بخش` : '')
        + ` · ${manual ? '«ارسالِ دوباره»ی دستی' : 'خودکار'}${why}` });
    }
    for (const d of direct) {
      const after = (d.afterJson ?? {}) as Record<string, any>;
      const order = /^order\.(\w+)\.send$/.exec(d.action)?.[1];
      const label = DIRECT_SMS[d.action] ?? (order ? `دستورِ ${ORDER_KIND_LABELS[order] ?? order}` : d.action);
      const result = after.sent ? 'رفت' : after.stub ? 'آزمایشی (نرفت)' : 'نرفت';
      timeline.push({ t: d.createdAt.getTime(), line: `${at(d.createdAt)} · ${result} · ${label} · دکمهٔ ارسالِ مستقیم` });
    }
    timeline.sort((a, b) => b.t - a.t);
    out.push('', `۲) هر تلاشِ ارسال — تازه‌ترین بالا (${fa(timeline.length)} مورد)`);
    out.push('   (ارسالِ مستقیمی که خطا داد پیش از ۱۴۰۵/۰۷/۰۴ جایی ثبت نمی‌شد؛ فقط موفق‌هایش این‌جاست.)');
    out.push('   (پیش از ۱۴۰۵/۰۷/۰۴ ساعتِ ۰۹:۴۳ پاسخی که عددِ کوچکی داشت «رفت» ثبت می‌شد؛ آن عدد کدِ خطای ملی‌پیامک است و این‌جا با همان کد «نرفت» خوانده می‌شود.)');
    if (!timeline.length) out.push('— در این بازه تلاشی ثبت نشده');
    for (const x of timeline.slice(0, 120)) out.push(x.line);

    out.push('', `۳) «ارسالِ دوباره»ی دستی — تازه‌ترین بالا (${fa(retries.length)} مورد)`);
    if (!retries.length) out.push('— در این بازه کسی ارسالِ دوباره نزده');
    for (const r of retries) {
      const row = rows.get(Number(r.entityId));
      const res = (r.afterJson ?? {}) as Record<string, any>;
      const result = res.sent > 0 ? 'رفت' : res.failed > 0 ? 'نرفت' : 'بی‌نتیجه';
      out.push(`${at(r.createdAt)} · ردیفِ ${fa(r.entityId ?? '—')} (${kindFa(row?.kind)}، ${code(row)}) · ${result}`);
    }

    /* **علتِ ردها، شمرده** — جوابِ مستقیمِ «چرا نمی‌رود». هر ردیف یک‌بار با آخرین علتش؛ پیشوندِ
       «تلاشِ n از ۴ …» برداشته می‌شود تا یک علت با شمارهٔ تلاشِ متفاوت دو خط نشود. */
    const causes = new Map<string, number>();
    const bump = (why: string) => causes.set(why, (causes.get(why) ?? 0) + 1);
    for (const r of recent) {
      const fake = r.status === 'sent' ? meliErrorCodeOf(r.providerId) : null;
      if (fake !== null) { bump(`«رفت» ثبت شده بود ولی ملی‌پیامک کدِ ${fa(fake)} داده بود: ${meliCodeText(fake)}`); continue; }
      if (!r.error || !['failed', 'pending', 'uncertain'].includes(r.status)) continue;
      const why = r.error.replace(/^(تلاشِ [۰-۹]+ از [۰-۹]+ نرفت و خودکار دوباره امتحان می‌شود|پس از [۰-۹]+ تلاش نرفت) — /, '').trim();
      bump(why === 'سرویس پیامک موقتاً در دسترس نیست' ? `${why} (علتِ دقیق پیش از ۱۴۰۵/۰۷/۰۴ ثبت نمی‌شد)` : why);
    }
    out.push('', '۴) علتِ ردها — از پاسخِ خودِ ملی‌پیامک (هر ردیف یک‌بار، با آخرین علتش)');
    if (!causes.size) out.push('— در این بازه ردی نیست');
    for (const [why, n] of [...causes].sort((a, b) => b[1] - a[1]).slice(0, 10)) out.push(`• ${fa(n)} ردیف: ${why.slice(0, 200)}`);
    return out.join('\n') + '\n';
  }

  async retry(id: number, user: any) {
    const row = await this.act(id, RemindersService.RETRYABLE, 'ارسالِ دوباره');
    await this.prisma.reminder.update({
      where: { id },
      data: { status: 'pending', attempts: 0, dueAt: new Date(), error: null, sentAt: null },
    });
    const res = await sendReminders(this.prisma, this.sms, [id]);
    await this.audit?.record({ actorId: user?.id ?? null, action: 'reminder.retry',
      entityType: 'reminder', entityId: id, before: { status: row.status }, after: res });
    return this.prisma.reminder.findUnique({ where: { id } });
  }

  async cancel(id: number, user: any, reason?: string) {
    const row = await this.act(id, RemindersService.CANCELLABLE, 'لغو');
    const fresh = await this.prisma.reminder.update({
      where: { id },
      data: { status: 'cancelled', error: (reason ?? '').trim().slice(0, 300) || null },
    });
    await this.audit?.record({ actorId: user?.id ?? null, action: 'reminder.cancel',
      entityType: 'reminder', entityId: id, before: { status: row.status }, after: { status: 'cancelled', reason: reason ?? null } });
    return fresh;
  }
}
