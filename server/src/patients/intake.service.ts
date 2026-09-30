import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../work/events.service';
import { PatientsService } from './patients.service';
import { StorageService } from '../storage/storage.service';
import { BillingService } from './billing.service';
import { SurveyService } from './survey.service';
import { FormsService, FORM_SCOPES } from './forms.service';
import { BUILTIN_VISIT_KEYS, REGISTRATION_HINTS, REGISTRATION_PRESETS, UNDATED_KEY, isUndated } from './form-presets';
import { normalizeLinks } from './forms.service';
import { toDateValue } from '../common/jalali';
import { syncLinkDocuments } from './link-documents';
import { hospitalTypeahead, matchIntakeHospital, matchIntakeRefs } from './intake-match';
import { serviceLabel, serviceOf } from './intake-service-of';
import { imageRefsOf, receiptIdsOf } from './intake-docs';
import { UsedChallenges, issueChallenge, openChallenge, verifyChallenge } from './intake-captcha';
import { faClock, faDayLong } from './fa-when';
import { RETURN_STAGES, applyReturn, currentReturn, isReturnStage, returnsOf, withoutReturns } from './intake-return';
import { procedureRequirements, RequiredItemInput, resolveRequirements } from './visit-requirements';
import { OTHER_PX, procedureLabel } from './visit-coding';
import { PortalService } from './portal.service';
import { renderSms } from '../common/sms-template';
import { RemindersService } from './reminders.service';
import { isValidNationalId, toEnDigits } from '../common/identity';
import { SmsService } from '../sms/sms.service';
import { SettingsService } from '../config/settings.service';
import { SETTING_BY_KEY } from '../config/settings-registry';
import { TenantContext } from '../tenant/tenant-context';
import { AvailabilityService } from './availability.service';
import { jalaliMonthRange, toJalali } from '../common/jalali';
import { referrerStats } from './crm-referrers';
import { sniffMime } from '../common/file-type';
import { RateLimitService } from '../common/rate-limit.service';

/** سال و ماهِ شمسیِ یک تاریخ — برای گرفتنِ تقویمِ همان ماه (قانون ۱۴). */
function jalaliYm(d: Date): [number, number] {
  const parts = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: 'numeric', timeZone: 'UTC' })
    .formatToParts(d);
  return [
    Number(parts.find((x) => x.type === 'year')!.value.replace(/[^\d]/g, '')),
    Number(parts.find((x) => x.type === 'month')!.value),
  ];
}

/** سقفِ فیشِ واریزی — عکسِ گوشی، نه اسکنِ آرشیوی. */
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
/** سقفِ تعدادِ فایل در هر کادرِ عکس (و فیش) — نه بی‌نهایت، نه یکی. */
const MAX_FIELD_IMAGES = 10;
const RECEIPT_MIME = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

/**
 * نوعی که برای فایلِ آپلودیِ یک نشانیِ **عمومی** ذخیره می‌شود — از بایت‌ها،
 * نه از هدرِ کلاینت.
 *
 * ⚠️ کامنتِ قبلیِ همین دو مسیر می‌گفت «نوعِ فایل روی سرور سنجیده می‌شود»،
 * ولی چیزی که سنجیده می‌شد `file.mimetype` بود — همان رشته‌ای که **فرستنده**
 * در `multipart` نوشته. مقدارش هم ذخیره می‌شد و `record.controller`
 * عیناً در `Content-Type` می‌گذارد و برای `image/*` هم `inline` می‌دهد؛ یعنی
 * حرفِ یک آپلودکنندهٔ بی‌احراز مستقیم به مرورگرِ کارکنان می‌رسید. همان قاعده‌ای
 * که W0.8 برای آپلودِ پاسخِ سفارش نوشت این‌جا جا افتاده بود.
 *
 * ⚠️ **عمداً سخت‌گیرتر از W0.8 نیست.** آن‌جا امضای ناشناس رد می‌شود؛ این‌جا
 * فایل پذیرفته و نوعش `application/octet-stream` ذخیره می‌شود. دلیلش دامنهٔ
 * خرابی است، نه سلیقه: مسیرِ W0.8 تازه‌ساز بود، ولی این دو مسیر فیش و مدرکِ
 * **هر بیمارِ امروز** را می‌گیرند و یک HEICِ با برندِ ناشناس نباید ثبت‌نامِ
 * کسی را قفل کند. ثابتِ اصلی سرِ جایش می‌ماند: هیچ‌وقت ادعای کلاینت ذخیره
 * نمی‌شود. بهایش فقط این است که چنان فایلی به‌جای پیش‌نمایش، دانلود می‌شود.
 */
function storedMime(file: { mimetype?: string; buffer: Buffer }): string {
  return sniffMime(file.buffer) ?? 'application/octet-stream';
}

/** روزهای اعتبارِ یک ثبت‌نامِ نیمه‌کاره. */
const TTL_DAYS = 14;
/** کدِ «ادامه با موبایل» — همان قراردادِ کدِ ورود (`auth.service.ts`): ۵ دقیقه، ۵ تلاش. */
const RESUME_OTP_TTL_MS = 5 * 60_000;
const RESUME_OTP_MAX_ATTEMPTS = 5;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** سقفِ فهرستِ «پیگیری‌نشده» — فهرستِ کارِ امروزِ منشی است، نه آرشیو.
    خروجی `capped` و `total` را هم می‌دهد تا بریدگی **دیده شود** (W1.1). */
const UNFOLLOWED_LIMIT = 300;

export const INTAKE_STATUSES = [
  'pending_fill', 'pending_payment', 'pending_approval', 'approved', 'rejected', 'expired',
] as const;

/* ⚠️ خانه‌اش `labels.ts` است؛ این‌جا فقط دوباره export می‌شود تا ایمپورت‌های
   موجود نشکنند و کسی وسوسه نشود نسخهٔ دوم بنویسد. تا دیروز نسخهٔ سوم در
   `Crm.jsx` بود و «رها‌شده» را «منقضی» می‌گفت. */
export { INTAKE_LABELS } from './labels';
import { INTAKE_LABELS } from './labels';

/** نشان‌های پرسشِ امنیتیِ مصرف‌شده — یکی برای کلِ پروسه (`intake-captcha.ts`). */
const USED_CHALLENGES = new UsedChallenges();
/** کلیدِ نشانِ پرسش از همان رازِ سرور (`JWT_SECRET`) مشتق می‌شود؛ بی‌راز پرسشی ساخته نمی‌شود. */
function captchaSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new ServiceUnavailableException('ثبت‌نام موقتاً در دسترس نیست');
  return secret;
}

const text = (v: unknown, max = 200) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/**
 * برچسبِ خواندنیِ یک حسابِ بانکی — «شهاب حسینی — بانکِ ملت».
 *
 * ⚠️ سمتِ سرور و نه در render (قانون ۱۵): همین رشته امروز در سه فایلِ کلاینت
 * جدا ساخته می‌شود و روزی یکی‌شان جداکننده یا ترتیب را عوض می‌کند.
 */
const bankLabel = (b: { ownerName: string; bankName?: string | null }) =>
  [b.ownerName, b.bankName].filter(Boolean).join(' — ');

/**
 * فرمِ ثبت‌نامِ بیمار.
 *
 * ⚠️ **آنچه بیمار پر می‌کند مراجعه نیست.** تا وقتی ادمین تأیید نکرده، هیچ
 * `Visit`ی ساخته نمی‌شود: اگر فرمِ خودپرشده مستقیم وارد دفترِ عملیاتی می‌شد،
 * تختهٔ چینشِ فردا پر می‌شد از ثبت‌نام‌هایی که هیچ‌وقت پول ندادند.
 *
 * ⚠️ **پروندهٔ بیمار ولی همان لحظهٔ ثبت‌نام ساخته می‌شود** — چون فیشِ واریزی
 * باید جایی بنشیند و `Document` بیمار می‌خواهد، و چون همین‌جاست که می‌فهمیم
 * این آدم بیمارِ قدیمی است یا تازه. پروندهٔ بی‌مراجعه بی‌ضرر است: آدمی که با
 * ما تماس گرفته، حتی اگر عملش نشد.
 */
/**
 * نسخهٔ ذخیرهٔ بیمار (`data._saveRev`) — عددِ صعودی که مرورگر روی هر پیش‌نویس و ثبتِ
 * نهایی می‌فرستد.
 *
 * ⚠️ از وقتی ذخیرهٔ بیمار بعد از برخوردِ نسخه دوباره روی ردیفِ تازه اجرا می‌شود
 * (`onFreshRow`)، پیش‌نویسِ دیررس دیگر خودبه‌خود رد نمی‌شود. این عدد نمی‌گذارد
 * پیش‌نویسی که **پیش از** ذخیرهٔ دیگری ساخته شده بعد از آن بنشیند و پاسخی را که
 * بیمار بعداً نوشته (یا ثبتِ نهایی) برگرداند.
 */
const SAVE_REV = '_saveRev';
const saveRev = (v: unknown): number | null => (Number.isSafeInteger(v) && (v as number) > 0 ? (v as number) : null);
const staleSave = (data: unknown, rev: number) => Number((data as any)?.[SAVE_REV]) > rev;

/**
 * برخوردِ نسخه **بی‌تغییرِ وضعیت** — دو نوشتنِ هم‌زمانِ خودِ بیمار (پیش‌نویس + آپلود). فقط همین
 * را `onFreshRow` دوباره روی ردیفِ تازه اجرا می‌کند.
 *
 * ⚠️ برخوردی که وضعیت را عوض کرده (تأیید، رد، برگشت، انقضا) همان ۴۰۹ِ همیشگی می‌ماند و تکرار
 * نمی‌شود: ویرایشی که پیش از تأیید خوانده شده باید بفهمد «ثبت‌نام تغییر کرده»، نه اینکه در
 * تلاشِ دوم «دیگر قابلِ ویرایش نیست» بگیرد — نگهبانِ W1.4 در CI همین ۴۰۹ را می‌سنجد.
 */
class StaleSubmissionVersion extends ConflictException {}

@Injectable()
export class IntakeService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private patients: PatientsService,
    private storage: StorageService,
    private billing: BillingService,
    private survey: SurveyService,
    /* ⚠️ اعتبارسنجیِ فرم از **همان** سرویسی می‌آید که فرم‌ساز و ثبتِ مراجعه
       استفاده می‌کنند. کپیِ دومِ قاعدهٔ «اجباری» یعنی روزی ستاره‌ای که ادمین
       روشن کرده روی فرمِ عمومی اثر نداشته باشد، بی‌هیچ خطایی. */
    private forms: FormsService,
    private sms: SmsService,
    /* ⚠️ نشانیِ عمومیِ لینک از **میزبانِ همین درخواست** ساخته می‌شود، نه از یک
       متغیرِ محیطی: هر شرکت دامنهٔ خودش را دارد و یک `BASE_URL`ِ سراسری،
       لینکِ شرکتِ الف را با دامنهٔ شرکتِ ب می‌فرستاد. در production این میزبان
       **تأییدشده** است — تنانت فقط وقتی حل می‌شود که هاست در `tenant_domains`
       باشد — پس جای تزریقِ Host نیست. همان مبنایی که rpIDِ پس‌کی و هاستِ
       WebOTP از آن می‌آیند. */
    private tenant: TenantContext,
    /* نوبت‌دهی (`docs/BOOKING.md` مرحلهٔ ۳). محاسبهٔ روزهای آزاد **همان**
       سرویسی است که پنلِ ادمین از آن می‌خواند؛ نسخهٔ دومِ این محاسبه یعنی
       بیمار جای آزادی ببیند که ادمین نمی‌بیند. */
    private availability: AvailabilityService,
    private portal: PortalService,
    private reminders: RemindersService,
    private settings: SettingsService,
    private events: EventsService,
    private rateLimit: RateLimitService,
  ) {}

  private token() {
    return randomBytes(18).toString('base64url');
  }

  // ── لینکِ دائمی (ادمین) ────────────────────────────────────────────

  /**
   * فهرستِ لینک‌ها — با **برچسبِ** فرم و حساب، نه فقط شناسه‌شان.
   *
   * ⚠️ قانون ۱۵: هیچ فرمولی در render. اگر کلاینت `formId` می‌گرفت و خودش به
   * عنوان وصلش می‌کرد، همان join در فهرستِ ادمین و در رندرِ عمومی دو جا نوشته
   * می‌شد و روزی دو جواب می‌داد. برچسبِ حساب هم همان
   * `[ownerName, bankName]`ی است که سه فایلِ دیگر جدا می‌سازند.
   *
   * `formHasPayment` هم این‌جا حساب می‌شود: «آیا این فرم باکسِ پرداخت دارد؟»
   * پرسشی دربارهٔ تعریفِ فرم است، نه دربارهٔ صفحه.
   */
  async listLinks() {
    const rows = await this.prisma.intakeLink.findMany({
      orderBy: { id: 'desc' },
      include: {
        _count: { select: { submissions: true } },
        form: { select: { title: true, color: true, fields: { where: { type: 'payment' }, select: { id: true } } } },
        bankAccount: { select: { ownerName: true, bankName: true, showOnIntake: true, active: true } },
      },
    });
    return rows.map((r) => ({
      ...r,
      submissionCount: r._count.submissions,
      formTitle: r.form?.title ?? null,
      formColor: r.form?.color ?? null,
      formHasPayment: (r.form?.fields.length ?? 0) > 0,
      bankLabel: r.bankAccount ? bankLabel(r.bankAccount) : null,
      /* ⚠️ حسابی که بعد از ساختِ لینک از فرمِ عمومی برداشته شده هنوز به لینک
         وصل است ولی به بیمار نشان داده **نمی‌شود**. بدونِ این پرچم، ادمین یک
         نامِ حساب روی ردیف می‌دید و فکر می‌کرد کار می‌کند. */
      bankHidden: !!r.bankAccount && !(r.bankAccount.showOnIntake && r.bankAccount.active),
      _count: undefined,
      form: undefined,
      bankAccount: undefined,
    }));
  }

  /**
   * فرم‌هایی که می‌شود پشتِ یک لینک گذاشت — **هر سه محدوده**.
   *
   * ⚠️ تا مرحلهٔ ۳ فقط `intake` برمی‌گشت، چون هیچ‌چیز به `scope` احترام
   * نمی‌گذاشت و پیشنهادِ فرمِ مراجعه یعنی وعدهٔ رفتاری که وجود نداشت. حالا
   * `approve` هر سه را می‌شناسد، پس انتخابگر هم می‌تواند نشانشان بدهد.
   *
   * `scope` برمی‌گردد تا رابط بتواند بگوید پرشدنِ این فرم **چه می‌سازد** —
   * انتخابی که پیامدش پیدا نباشد، انتخابِ آگاهانه نیست.
   *
   * ⚠️ چرا endpointِ جدا و نه همان `GET /forms`: آن پشتِ مجوزِ `forms.read`
   * است و این صفحه مجوزِ `intake.*` دارد.
   */
  async formsForLinks() {
    await this.forms.list();
    /* ⚠️ یک فرمِ پیشنهادی **به‌ازای هر خدمتِ انتخاب‌شده** (شرکتِ دوخدمته دو تا)؛
       پیش‌فرضِ خدمتی که شرکت ندارد پنهان می‌ماند. لینک‌های زنده‌ای که از قبل به
       آن اشاره می‌کنند دست نمی‌خورند — فقط در فهرستِ «لینکِ تازه» پیشنهاد نمی‌شود. */
    const recommended = new Set(this.forms.registrationKeys(await this.forms.profile()).map((k) => REGISTRATION_PRESETS[k].key));
    const rows = await this.prisma.formDef.findMany({
      where: { active: true, key: { notIn: Object.values(REGISTRATION_PRESETS).map(f => f.key).filter(k => !recommended.has(k)) } },
      orderBy: [{ scope: 'asc' }, { id: 'asc' }],
      select: {
        id: true, key: true, title: true, color: true, scope: true, visitKind: true,
        fields: { where: { type: 'payment', active: true }, select: { id: true } },
      },
    });
    return rows.map((f) => ({
      recommended: recommended.has(f.key),
      id: f.id, title: f.title, color: f.color, scope: f.scope, visitKind: f.visitKind,
      hasPayment: f.fields.length > 0,
      /* پرشدنش مراجعه می‌سازد؟ `record` نمی‌سازد و همین تفاوتِ اصلی است. */
      makesVisit: f.scope !== 'record',
    })).sort((a, b) => Number(b.recommended) - Number(a.recommended));
  }

  /**
   * حساب‌هایی که می‌شود به یک لینک بست — **فقط نام**، بدونِ هیچ شماره‌ای.
   *
   * ⚠️ چرا از `GET /bank-accounts` استفاده نمی‌کنیم: آن پشتِ
   * `@Feature('accounting')` است و نصبی که پلنِ حسابداری ندارد ۴۰۳ می‌گیرد —
   * انتخابگر برای همیشه خالی می‌ماند بی‌آنکه کسی بفهمد چرا. (`ApproveSheet`
   * همین حالا با `.catch(() => [])` همین خطا را می‌بلعد.)
   *
   * ⚠️ شماره‌ها عمداً برنمی‌گردند: برای انتخابِ حساب فقط نام لازم است، و
   * برگرداندنِ شماره یعنی گستردنِ سطحِ افشا به یک مجوزِ دیگر.
   */
  async banksForLinks() {
    const rows = await this.prisma.bankAccount.findMany({
      where: { active: true, showOnIntake: true },
      orderBy: { id: 'asc' },
      select: { id: true, ownerName: true, bankName: true },
    });
    return rows.map((b) => ({ id: b.id, label: bankLabel(b) }));
  }

  /**
   * فرم و حسابِ انتخاب‌شده را می‌سنجد و شناسه‌های تمیز برمی‌گرداند.
   *
   * ⚠️ **اعتبارسنجی روی سرور، نه فیلترِ کلاینت.** انتخابگر فقط حساب‌های
   * `showOnIntake` را نشان می‌دهد، ولی هر کسی با مجوزِ `intake.manage`
   * می‌تواند یک id دلخواه POST کند — و `intake.manage` به‌معنیِ
   * `accounting.manage` نیست. `showOnIntake` تنها دروازهٔ opt-inِ ممیزی‌شده‌ای
   * است که شمارهٔ حساب را از یک نشانیِ بی‌احراز دور نگه می‌دارد؛ دورزدنش با یک
   * POST یعنی دروازه‌ای که نیست.
   */
  private async resolveLinkRefs(dto: { formId?: number | null; bankAccountId?: number | null }) {
    const out: { formId?: number | null; bankAccountId?: number | null; formScope?: string } = {};

    if (dto.formId !== undefined) {
      if (dto.formId === null || Number(dto.formId) === 0) out.formId = null;
      else {
        const form = await this.prisma.formDef.findUnique({ where: { id: Number(dto.formId) } });
        if (!form) throw new BadRequestException('فرمِ انتخاب‌شده پیدا نشد');
        if (!form.active) throw new BadRequestException('این فرم خاموش است — اول در فرم‌ساز روشنش کنید');
        /* هر سه محدوده مجازند و هرکدام مسیرِ تأییدِ خودش را دارد
           (`approve`): `intake`/`visit` مراجعه می‌سازند، `record` به پرونده
           می‌چسبد. تا مرحلهٔ ۳ فقط `intake` پذیرفته می‌شد، چون هیچ‌چیز به
           `scope` احترام نمی‌گذاشت و پذیرشِ بقیه یعنی وعدهٔ رفتاری که نبود. */
        if (!(FORM_SCOPES as readonly string[]).includes(form.scope)) {
          throw new BadRequestException('محدودهٔ این فرم پشتیبانی نمی‌شود');
        }
        out.formId = form.id;
        out.formScope = form.scope;
      }
    }

    if (dto.bankAccountId !== undefined) {
      if (dto.bankAccountId === null || Number(dto.bankAccountId) === 0) out.bankAccountId = null;
      else {
        const acc = await this.prisma.bankAccount.findUnique({ where: { id: Number(dto.bankAccountId) } });
        if (!acc) throw new BadRequestException('حسابِ انتخاب‌شده پیدا نشد');
        if (!acc.active) throw new BadRequestException('این حساب غیرفعال است');
        if (!acc.showOnIntake) {
          throw new BadRequestException('این حساب برای نمایش در فرمِ بیمار علامت نخورده — اول در حسابداری علامتش بزنید');
        }
        out.bankAccountId = acc.id;
      }
    }

    return out;
  }

  /**
   * فرمِ **زیرپرونده** نمی‌تواند مبلغ داشته باشد.
   *
   * ⚠️ چرا این‌جا و نه هنگامِ تأیید: پرشدنِ فرمِ `record` مراجعه‌ای نمی‌سازد، و
   * دفترِ مالی همه‌چیزش به `visitId` گره خورده — نه Charge دارد نه Payment.
   * پس مبلغی که روی چنین لینکی گذاشته شود، **هیچ‌وقت وارد دفتر نمی‌شود**:
   * بیمار پول می‌فرستد، ادمین فیش را می‌بیند و تأیید می‌کند، و آن عدد در هیچ
   * گزارشی پیدا نمی‌شود. جلوگیری موقعِ ساختِ لینک بلند است؛ کشفش سرِ گزارشِ
   * آخرِ ماه بی‌صدا.
   */
  private async assertRecordFormHasNoAmount(scope: string | null | undefined, amount: number) {
    if (scope === 'record' && amount > 0) {
      throw new BadRequestException(
        'فرمِ «زیرپرونده» مراجعه‌ای نمی‌سازد، پس مبلغش جایی در دفترِ مالی ثبت نمی‌شود — مبلغ را صفر بگذارید یا فرمِ «مراجعه» انتخاب کنید',
      );
    }
  }

  async createLink(
    dto: { title: string; amount?: number; notes?: string; formId?: number | null; bankAccountId?: number | null },
    user: any,
  ) {
    const title = text(dto.title, 120);
    if (!title) throw new BadRequestException('عنوانِ لینک را وارد کنید');
    const refs = await this.resolveLinkRefs(dto);
    const amount = Math.max(0, Number(dto.amount) || 0);
    await this.assertRecordFormHasNoAmount(refs.formScope, amount);
    const row = await this.prisma.intakeLink.create({
      data: {
        token: this.token(),
        title,
        amount,
        notes: text(dto.notes, 300),
        formId: refs.formId ?? null,
        bankAccountId: refs.bankAccountId ?? null,
      },
    });
    await this.audit.record({ actorId: user?.id, action: 'intake.link.create', entityType: 'intake_link', entityId: row.id, after: row });
    return row;
  }

  /**
   * ویرایشِ لینک.
   *
   * ⚠️ عوض‌کردنِ `formId` روی ثبت‌نام‌های **در جریان** اثر ندارد و نباید داشته
   * باشد: هر ثبت‌نام فرمش را هنگامِ شروع عکس می‌گیرد
   * (`IntakeSubmission.formId`). بدونِ آن، پاسخ‌هایی که بیمار زیرِ فرمِ A داده
   * با کلیدهای فرمِ B خوانده می‌شدند — هر جواب زیرِ برچسبِ اشتباه، بی‌هیچ خطایی.
   */
  async patchLink(
    id: number,
    dto: { title?: string; amount?: number; active?: boolean; notes?: string; formId?: number | null; bankAccountId?: number | null },
    user: any,
  ) {
    const row = await this.prisma.intakeLink.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('لینک پیدا نشد');
    const refs = await this.resolveLinkRefs(dto);

    /* ⚠️ **حالتِ نهایی** سنجیده می‌شود، نه فقط چیزی که در این درخواست آمده:
       گذاشتنِ مبلغ روی لینکی که از قبل فرمِ زیرپرونده دارد، و گذاشتنِ فرمِ
       زیرپرونده روی لینکی که از قبل مبلغ دارد، هر دو یک وضعیتِ نامعتبرند. */
    const nextAmount = dto.amount !== undefined ? Math.max(0, Number(dto.amount) || 0) : row.amount;
    let nextScope = refs.formScope;
    if (refs.formId === undefined && row.formId) {
      nextScope = (await this.prisma.formDef.findUnique({ where: { id: row.formId }, select: { scope: true } }))?.scope;
    }
    await this.assertRecordFormHasNoAmount(nextScope, nextAmount);

    const data: any = {};
    if (dto.title !== undefined) data.title = text(dto.title, 120) ?? row.title;
    if (dto.amount !== undefined) data.amount = nextAmount;
    if (dto.active !== undefined) data.active = !!dto.active;
    if (dto.notes !== undefined) data.notes = text(dto.notes, 300);
    if (refs.formId !== undefined) data.formId = refs.formId;
    if (refs.bankAccountId !== undefined) data.bankAccountId = refs.bankAccountId;
    const next = await this.prisma.intakeLink.update({ where: { id }, data });
    await this.audit.record({ actorId: user?.id, action: 'intake.link.update', entityType: 'intake_link', entityId: id, before: row, after: next });
    return next;
  }

  /**
   * نشانیِ عمومیِ یک لینک — **تک‌منبع**.
   *
   * ⚠️ تا امروز فقط مرورگر این رشته را می‌ساخت (`${origin}/r/${token}` در
   * `Intake.jsx`). حالا سرور هم باید همان را در پیامک بگذارد، و دو جا که یک
   * نشانی می‌سازند یعنی روزی که مسیر عوض شود، یکی‌شان عقب می‌ماند و بیمار
   * لینکِ ۴۰۴ می‌گیرد.
   */
  private publicUrl(token: string) {
    const host = this.tenant.require().hostname;
    return `https://${host}/r/${token}`;
  }

  /**
   * فرستادنِ لینک با پیامک — همان کاری که ادمین امروز دستی می‌کند: کپی، رفتن
   * به پیام‌رسان، چسباندن.
   *
   * ⚠️ لینکِ **غیرفعال** فرستاده نمی‌شود. بدونِ این سد، ادمین لینکی می‌فرستاد
   * که بیمار با بازکردنش «این لینک غیرفعال شده است» می‌دید — و تماسِ
   * پشتیبانی می‌گرفت. خطا این‌جا ارزان است، آن‌جا گران.
   *
   * ⚠️ شماره **سمتِ سرور** هم سنجیده می‌شود: `SmsService` شمارهٔ نامعتبر را
   * بی‌صدا رد می‌کند (`sent:false`) و ادمین فکر می‌کرد فرستاده شده. پس
   * پیش از رسیدن به آن، ۴۰۰ می‌دهیم با دلیل.
   */
  async sendLinkSms(id: number, phone: string, user: any) {
    const link = await this.prisma.intakeLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('لینک پیدا نشد');
    if (!link.active) throw new BadRequestException('این لینک غیرفعال است — اول فعالش کنید');

    const to = toEnDigits(String(phone ?? '')).replace(/[^0-9]/g, '');
    if (!/^09\d{9}$/.test(to)) throw new BadRequestException('شمارهٔ موبایل نامعتبر است (مثال: ۰۹۱۲۱۲۳۴۵۶۷)');

    /* ⚠️ عنوانِ لینک داخلِ متن می‌آید تا بیمار بداند این پیامک برای چیست.
       «لغو11» را خودِ `send` می‌چسباند — این‌جا تکرارش نکن، وگرنه دوبار
       می‌آید (خودِ `appendLagho` نسخهٔ قبلی را پاک می‌کند، ولی به آن تکیه
       نکن). */
    const text = `${link.title}\n${this.publicUrl(link.token)}`;
    const res = await this.sms.sendForStaff(to, text);

    /* ⚠️ متنِ پیامک در audit **نوشته نمی‌شود** ولی مقصد بله: باید بتوان
       پاسخ داد «این لینک برای چه شماره‌ای رفت»، بی‌آنکه دفترِ ممیزی به
       آرشیوِ محتوای پیام‌ها تبدیل شود. */
    await this.audit.record({
      actorId: user?.id, action: 'intake.link.sms', entityType: 'intake_link', entityId: id,
      after: { to, sent: res.sent, stub: res.stub },
    });
    /* `stub` یعنی سرویسِ پیامک پیکربندی نشده (محیطِ توسعه). کلاینت باید
       تفاوتش را با «فرستاده شد» بداند، وگرنه در dev همه‌چیز موفق به‌نظر
       می‌رسد و کسی نمی‌فهمد هیچ پیامکی نرفته. */
    return { ...res, to, url: this.publicUrl(link.token) };
  }

  // ── مسیرِ عمومیِ بیمار ─────────────────────────────────────────────
  /** اطلاعاتِ لینک برای صفحهٔ ثبت‌نام — بدونِ هیچ دادهٔ بیمار. */
  async publicLink(token: string) {
    const link = await this.prisma.intakeLink.findUnique({ where: { token } });
    if (!link) throw new NotFoundException('این لینک معتبر نیست');
    if (!link.active) throw new ForbiddenException('این لینک غیرفعال شده است');
    /* نام و تلفنِ مطب/شرکت (بازبینیِ UX، بندِ ۹۲): بیمار از لینکِ «مطب دکتر رحیمی» می‌آید و
       تا دیروز بالای فرم «عمل‌یار» می‌دید که کدِ ملی و ۴۰ میلیون می‌خواهد — شبیهِ کلاه‌برداری. */
    /* «چه پیش رو دارید» (بازبینیِ UX، بندِ ۱۰۷): صفحهٔ اولِ ثبت‌نام باید مسیرِ **همین** لینک را بگوید —
       مراجعه می‌سازد؟ نوبت دارد؟ واریز دارد؟ — با همان قاعده‌های `publicView` و `fill` (مشتقِ سرور،
       قانونِ ۱۵)، نه حدسِ مرورگر از مبلغ. */
    const scope = await this.formScope(link.formId);
    const makesVisit = scope !== 'record';
    const hasPaymentBox = !!(await this.formView(link.formId))?.fields.some((x: any) => x.type === 'payment');
    const payment = link.amount > 0 || hasPaymentBox;
    return {
      title: link.title, amount: link.amount,
      flow: { makesVisit, booking: makesVisit && (await this.bookingOn()), payment, review: makesVisit || payment },
      ...(await this.portal.publicFace()),
    };
  }

  /**
   * هویتِ شرکت برای صفحه‌ای که **دادهٔ خودش نیامد** — لینکِ ناقص‌کپی‌شده، منقضی یا خطای
   * اتصال. صفحهٔ خطا بی‌این نه نامِ مطب را داشت نه تلفنش را (بازبینیِ UX، بندِ ۱۱۰).
   */
  publicFace() {
    return this.portal.publicFace();
  }

  /**
   * پرسشِ امنیتیِ تازه برای صفحهٔ ثبت‌نامِ همین لینک (`intake-captcha.ts`).
   *
   * فقط برای لینکِ معتبر و فعال — وگرنه هر کسی بی‌لینک هم تصویر و نشان می‌گرفت — و با سقفِ
   * نرخ، چون رسمِ هر تصویر چند ده میلی‌ثانیه CPU است.
   */
  async captcha(linkToken: string, ip: string) {
    this.rateLimit.hit(`intake-captcha:${ip}`, 60, 10 * 60_000);
    const link = await this.prisma.intakeLink.findUnique({ where: { token: linkToken }, select: { active: true } });
    if (!link) throw new NotFoundException('این لینک معتبر نیست');
    if (!link.active) throw new ForbiddenException('این لینک غیرفعال شده است');
    return issueChallenge(captchaSecret(), linkToken);
  }

  /**
   * شروعِ ثبت‌نام.
   *
   * ⚠️ پرسشِ امنیتی را **سرور** می‌سازد و می‌سنجد (`intake-captcha.ts`)؛ تا دیروز مرورگر خودش
   * دو عدد را انتخاب می‌کرد و یک اسکریپت با `1 + 1 = 2` رد می‌شد. ترتیب عمدی است: سقفِ نرخ
   * (هر تلاش، حتی غلط، شمرده می‌شود) → لینک → فیلدها → پرسش → نوشتن. فیلدها **پیش از** پرسش
   * سنجیده می‌شوند تا غلطِ کدِ ملی نشان را نسوزاند و بیمار مجبور نشود دوباره پرسش را جواب دهد.
   *
   * ⚠️ اگر همین بیمار ثبت‌نامِ ناتمامی دارد، **همان** برگردانده می‌شود نه یک
   * ردیفِ تازه — وگرنه هر بار که بیمار لینک را دوباره باز کند یک ثبت‌نامِ
   * نیمه‌کارهٔ دیگر می‌سازد و صفِ تأیید پر می‌شود از تکراری.
   */
  async register(
    linkToken: string,
    dto: { firstName: string; lastName: string; nationalId: string; phone: string; birthDate?: string; address?: string; referralSourceId?: number; referralNote?: string; captchaToken: string; captchaAnswer: number },
    ip = 'unknown',
  ) {
    this.rateLimit.hit(`intake-register:${ip}`, 30, 10 * 60_000);
    const link = await this.prisma.intakeLink.findUnique({ where: { token: linkToken } });
    if (!link) throw new NotFoundException('این لینک معتبر نیست');
    if (!link.active) throw new ForbiddenException('این لینک غیرفعال شده است');

    const firstName = text(dto.firstName, 80);
    const lastName = text(dto.lastName, 80);
    const nationalId = toEnDigits(text(dto.nationalId, 15) ?? '');
    const phone = toEnDigits(text(dto.phone, 20) ?? '');
    if (!firstName || !lastName) throw new BadRequestException('نام و نامِ خانوادگی را وارد کنید');
    /* ⚠️ همان اعتبارسنجیِ مسیرِ ادمین، نه یک «۱۰ رقم» ساده‌تر. نسخهٔ اول فقط
       طول را می‌سنجید، پس کدِ ملیِ بی‌اعتبار از **درِ عمومی** وارد می‌شد و
       هنگامِ تأیید هم دوباره سنجیده نمی‌شد (چون آن‌جا با `patientId` می‌رویم).
       نتیجه: پرونده‌ای با کدِ ملیِ غلط که ادمین هرگز نمی‌توانست بسازد. */
    /* راهِ بیمارِ اتباع را هم بگوید (بازبینیِ UX، بندِ ۱۰۹) — «معتبر نیست» تنها القا می‌کرد اشتباه تایپ کرده. */
    if (!isValidNationalId(nationalId)) throw new BadRequestException('کدِ ملی معتبر نیست؛ اگر کدِ ملیِ ایرانی ندارید، برای ثبت‌نام با ما تماس بگیرید');
    if (!/^09\d{9}$/.test(phone)) throw new BadRequestException('شمارهٔ موبایل نامعتبر است');
    /* ⚠️ ۴۲۲ و نه ۴۰۰: صفحه از روی همین کد می‌فهمد که باید **پرسشِ تازه** بگیرد — نشان همین حالا
       مصرف شد (درست یا غلط)، پس ارسالِ دوباره با همان نشان بی‌فایده است. */
    const verdict = verifyChallenge(captchaSecret(), USED_CHALLENGES, linkToken, dto.captchaToken, dto.captchaAnswer);
    if (verdict !== 'ok') {
      /* «کهنه» دو علت دارد و بیمار باید بداند کدام (بازبینیِ UX، بندِ ۹۸): پرسشی که یک‌بار فرستاده شده
         (مثلاً پیش از خطای کدِ ملی) یا بیش از ۱۰ دقیقه پیش آمده. صفحه در هر دو حالت پرسشِ تازه می‌گیرد. */
      const opened = verdict === 'stale' ? openChallenge(captchaSecret(), dto.captchaToken) : null;
      const expired = !!opened && opened.s === linkToken && opened.e <= Date.now();
      throw new UnprocessableEntityException(verdict === 'wrong'
        ? 'پاسخِ پرسشِ امنیتی درست نیست — پرسشِ تازه را جواب دهید'
        : expired
          ? 'پرسشِ امنیتی منقضی شده (بیش از ۱۰ دقیقه گذشته) — پرسشِ تازه را جواب دهید'
          : 'این پرسش یک‌بار مصرف شد؛ پرسشِ تازه را جواب دهید');
    }

    const { patientId } = await this.prisma.$transaction((tx) =>
      /* ⚠️ `public: true` پیامِ برخوردِ کد ملی را بی‌نام می‌کند — این نشانی
         بی‌احراز است و نامِ صاحبِ پرونده نباید به تایپ‌کنندهٔ کد ملی برسد. */
      this.patients.resolveOrCreatePatient(tx, { firstName, lastName, phone, nationalId, birthDate: dto.birthDate }, { public: true }),
    );

    /* **کانالِ آشنایی** روی خودِ پرونده می‌نشیند نه در JSONِ ثبت‌نام، چون
       رویش گزارش می‌گیریم. منطقش — از جمله «فقط اگر پرونده هنوز خالی است» —
       در `SurveyService.attachSource` است تا یک جا بماند. */
    await this.survey.attachSource(patientId, dto.referralSourceId, dto.referralNote);

    /* ⚠️ ثبت‌نامِ نیمه‌کاره فقط **روی همین لینک** ادامه پیدا می‌کند.
       نسخهٔ قبلی فقط `patientId` را می‌سنجید: بیماری که فرمِ لینکِ A را نیمه‌کاره
       رها کرده بود و بعد روی لینکِ B می‌زد، ثبت‌نامِ A را تحویل می‌گرفت — با
       مبلغِ A. تا دیروز فقط قیمت غلط می‌شد؛ حالا که لینک فرم دارد، **پرسش‌نامهٔ
       اشتباه** هم به بیمار داده می‌شود، باز هم بی‌هیچ خطایی. */
    const open = await this.prisma.intakeSubmission.findFirst({
      where: { patientId, linkId: link.id, status: { in: ['pending_fill', 'pending_payment', 'pending_approval'] } },
      orderBy: { id: 'desc' },
    });
    /* بیمارِ برگشته احتمالاً لینکش را گم کرده — همان لینک دوباره پیامک می‌شود (با سقفِ ۱۰دقیقه‌ای). */
    if (open) return { ...(await this.publicView(open.token)), linkSmsTo: await this.sendContinueLink(patientId, open.token, link.title) };

    const row = await this.prisma.intakeSubmission.create({
      data: {
        token: this.token(),
        linkId: link.id,
        patientId,
        amount: link.amount,
        /* عکسِ لحظه‌ای از فرمِ لینک — به همان دلیلی که `amount` کپی می‌شود. */
        formId: link.formId,
        status: 'pending_fill',
        data: { firstName, lastName, nationalId, phone, address: text(dto.address, 300), birthDate: dto.birthDate ?? null },
        expiresAt: new Date(Date.now() + TTL_DAYS * 24 * 3600 * 1000),
      },
    });
    return { ...(await this.publicView(row.token)), linkSmsTo: await this.sendContinueLink(patientId, row.token, link.title) };
  }

  /**
   * **پیامکِ «لینکِ ادامهٔ همین فرم»** — بلافاصله پس از ثبت‌نام (بازبینیِ UX، بندِ ۱۰۳).
   *
   * ⚠️ چرا: بیمار معمولاً از مرورگرِ داخلیِ اینستاگرام/تلگرام آمده و وسطِ کار برای واریز به اپِ بانک
   * می‌رود؛ بسته‌شدنِ آن مرورگر تا دیروز یعنی پرکردنِ دوبارهٔ همهٔ فیلدها + کپچا.
   *
   * ⚠️ منتظرِ درگاهِ پیامک نمی‌ماند — ثبت‌نام روی اینترنتِ کند نباید پشتِ درگاه گیر کند؛ ارسال در
   * پس‌زمینه است و نتیجه‌اش (فرستاده/ناموفق) مثلِ «ارسالِ فرم» در دفترِ پیام‌های بیمار می‌نشیند.
   * ⚠️ برای هر ثبت‌نام حداکثر یک پیامک در ۱۰ دقیقه — تکرارِ ثبت‌نام بمبارانِ پیامک نمی‌سازد.
   * خروجی: شمارهٔ **پوشیده** برای جملهٔ «لینک به … پیامک شد»، یا `null` (شمارهٔ نامعتبر).
   */
  private async sendContinueLink(patientId: number, token: string, title: string): Promise<string | null> {
    const patient = await this.prisma.patient.findFirst({ where: { id: patientId, deletedAt: null }, select: { phone: true } });
    const to = toEnDigits(String(patient?.phone ?? '')).replace(/[^0-9]/g, '');
    if (!/^09\d{9}$/.test(to)) return null;
    const masked = `${to.slice(0, 4)}…${to.slice(-3)}`;
    try {
      this.rateLimit.hit(`intake-link-sms:${token}`, 1, 10 * 60_000);
    } catch {
      return masked; // همین چند دقیقه پیش رفته است
    }
    const smsCfg = await this.settings.sms();
    const text = renderSms(smsCfg.formSendText, { title, link: this.publicFormLink(token) });
    void (async () => {
      const res = await this.sms.send(to, text).catch(() => ({ sent: false, stub: false }));
      await this.prisma.reminder.create({
        data: { patientId, kind: 'notice', dueAt: new Date(), phone: to, text, status: res.sent || res.stub ? 'sent' : 'failed', sentAt: new Date() },
      }).catch(() => undefined);
    })().catch(() => undefined);
    return masked;
  }

  /* ── ادامه با موبایل + کد (بازبینیِ UX، بندِ ۱۰۳) ─────────────────────────
     بیماری که لینکِ فرمش را گم کرده، روی همان لینکِ ثبت‌نام شماره‌اش را می‌دهد و با کدِ پیامکی به
     ثبت‌نامِ بازِ خودش برمی‌گردد — بی‌پرکردنِ دوبارهٔ فرم و کپچا.
     ⚠️ **بی‌شمارش**: پاسخِ درخواست همیشه یکی است («اگر ثبت‌نامِ بازی باشد کد پیامک می‌شود»)؛ وجود یا
     نبودِ ثبت‌نام از بیرون خوانده نمی‌شود. کد در همان جدولِ `otpCode`ِ ورود با هدفِ جدا (`intake-resume`)،
     هش‌شده، ۵ دقیقه، ۵ تلاش، یک‌بارمصرف. */

  private async openByPhone(linkId: number, phone: string) {
    return this.prisma.intakeSubmission.findFirst({
      where: { linkId, status: { in: ['pending_fill', 'pending_payment', 'pending_approval'] }, patient: { phone, deletedAt: null } },
      orderBy: { id: 'desc' },
      select: { id: true, token: true },
    });
  }

  private async resumeLink(linkToken: string) {
    const link = await this.prisma.intakeLink.findUnique({ where: { token: linkToken } });
    if (!link) throw new NotFoundException('این لینک معتبر نیست');
    if (!link.active) throw new ForbiddenException('این لینک غیرفعال شده است');
    return link;
  }

  private static resumePhone(raw: unknown) {
    const phone = toEnDigits(String(raw ?? '')).replace(/[^0-9]/g, '');
    if (!/^09\d{9}$/.test(phone)) throw new BadRequestException('شمارهٔ موبایل را کامل بنویسید (مثلاً ۰۹۱۲۳۴۵۶۷۸۹)');
    return phone;
  }

  async resumeRequest(linkToken: string, rawPhone: string, ip = 'unknown') {
    this.rateLimit.hit(`intake-resume:ip:${ip}`, 10, 15 * 60_000);
    const phone = IntakeService.resumePhone(rawPhone);
    this.rateLimit.hit(`intake-resume:phone:${phone}`, 3, 15 * 60_000);
    const link = await this.resumeLink(linkToken);
    const purpose = `intake-resume:${link.id}`;
    const answer = { ok: true, ttl: RESUME_OTP_TTL_MS / 1000 };
    const open = await this.openByPhone(link.id, phone);
    if (!open) return answer;
    const recent = await this.prisma.otpCode.findFirst({
      where: { phone, purpose, createdAt: { gt: new Date(Date.now() - 60_000) } },
    });
    if (recent) return answer; // کدِ همین دقیقه هنوز معتبر است — پیامکِ دوم نه
    const code = String(randomInt(100000, 1000000));
    await this.prisma.otpCode.create({
      data: { phone, codeHash: sha256(code), purpose, expiresAt: new Date(Date.now() + RESUME_OTP_TTL_MS) },
    });
    const res = await this.sms.sendOtp(phone, code, this.tenant.current()?.hostname).catch(() => ({ sent: false, stub: false }));
    /* همان قراردادِ ورود: کدِ آزمون فقط در محیطِ test و با درگاهِ stub. */
    return { ...answer, ...(res.stub && process.env.NODE_ENV === 'test' ? { devCode: code } : {}) };
  }

  async resumeVerify(linkToken: string, rawPhone: string, rawCode: string, ip = 'unknown') {
    this.rateLimit.hit(`intake-resume-verify:ip:${ip}`, 20, 15 * 60_000);
    const phone = IntakeService.resumePhone(rawPhone);
    this.rateLimit.hit(`intake-resume-verify:phone:${phone}`, 8, 15 * 60_000);
    const code = toEnDigits(String(rawCode ?? '')).replace(/[^0-9]/g, '');
    const link = await this.resumeLink(linkToken);
    const purpose = `intake-resume:${link.id}`;
    const wrong = () => new BadRequestException('کدِ تأیید درست نیست یا منقضی شده — کدِ تازه بگیرید');
    const otp = await this.prisma.otpCode.findFirst({ where: { phone, purpose, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!otp || otp.expiresAt < new Date() || otp.attempts >= RESUME_OTP_MAX_ATTEMPTS) throw wrong();
    if (sha256(code) !== otp.codeHash) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw wrong();
    }
    const consumed = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() },
    });
    if (!consumed.count) throw wrong();
    const open = await this.openByPhone(link.id, phone);
    if (!open) throw wrong();
    return { token: open.token };
  }

  /**
   * نمای عمومیِ یک ثبت‌نام.
   *
   * ⚠️ فقط دادهٔ **خودِ همین فرم** برمی‌گردد. هرچه از پروندهٔ بیمار این‌جا
   * اضافه شود، با داشتنِ توکن قابلِ خواندن است — و توکن در پیامک می‌رود.
   */
  /* ══════════ نوبت‌دهی — `docs/BOOKING.md` مرحلهٔ ۳ ══════════ */

  /**
   * آیا این نصب اصلاً نوبت‌دهی دارد؟
   *
   * ⚠️ **fail-soft عمدی**: نصبی که هیچ برنامهٔ کاری تعریف نکرده باید دقیقاً
   * مثلِ دیروز کار کند. اگر گامِ نوبت را بی‌قید اضافه می‌کردیم، هر مشتریِ
   * موجود فردا صبح به فرمی می‌رسید که هیچ روزی برای انتخاب ندارد و ثبت‌نام
   * از همان‌جا می‌مُرد.
   */
  private async bookingOn() {
    return (await this.prisma.availabilityRule.count({ where: { active: true } })) > 0;
  }

  /** تقویمِ آزادِ ماه برای صفحهٔ بیمار — بدونِ نیاز به لاگین، فقط با توکن. */
  async publicSlots(token: string, jy: number, jm: number, topicId?: number) {
    await this.expireIfDue(token); // توکنِ نامعتبر همین‌جا رد می‌شود
    return this.availability.month(jy, jm, { topicId, patient: true });
  }

  /** موضوع‌های قابلِ انتخاب — فقط آن‌هایی که واقعاً روزی دارند. */
  async publicTopics(token: string) {
    await this.expireIfDue(token);
    const rules = await this.prisma.availabilityRule.findMany({
      where: { active: true },
      include: { topics: { include: { topic: { select: { id: true, name: true, active: true } } } } },
    });
    /* ⚠️ قاعده‌ای که هیچ موضوعی ندارد یعنی «همهٔ موضوع‌ها» — پس اگر چنین
       قاعده‌ای هست، فهرست باید کاملِ موضوع‌های فعال باشد، نه تهی. */
    if (rules.some((r) => r.topics.length === 0)) {
      const all = await this.prisma.visitTopic.findMany({
        where: { active: true }, orderBy: [{ sort: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true },
      });
      return all;
    }
    const seen = new Map<number, { id: number; name: string }>();
    for (const r of rules) {
      for (const t of r.topics) if (t.topic.active) seen.set(t.topic.id, { id: t.topic.id, name: t.topic.name });
    }
    return [...seen.values()];
  }

  /**
   * رزروِ نوبت توسطِ بیمار — وضعیتِ `held` تا وقتی پرداخت تأیید شود.
   *
   * ⚠️ `held` عمداً از `confirmed` جداست: وضعیتِ **نوبت** نباید با وضعیتِ
   * **پرداخت** یکی شود. افزودنِ درگاهِ آنلاین در آینده فقط باید یک منبعِ
   * تأیید اضافه کند، نه ماشینِ وضعیت را بازنویسی.
   *
   * ⚠️ برخوردِ همزمانی با **قیدِ یکتای دیتابیس** گرفته می‌شود، نه با
   * «اول بخوان بعد بنویس»: دو بیمار که همان لحظه روی یک اسلات بزنند، در
   * حالتِ خواندنِ قبل از نوشتن هر دو موفق می‌شوند.
   */
  async book(token: string, dto: { date?: string; startMin?: number; topicId?: number }) {
    const row = await this.expireIfDue(token);
    if (!['pending_fill', 'pending_payment'].includes(row.status)) {
      throw new BadRequestException('این فرم دیگر قابلِ ویرایش نیست');
    }
    if (!dto.date) throw new BadRequestException('روزِ نوبت را انتخاب کنید');
    const date = new Date(`${dto.date}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('روزِ نوبت نامعتبر است');

    /* ⚠️ ادعای بیمار دربارهٔ «آزاد بودن» بازخوانی می‌شود. صفحه ممکن است چند
       دقیقه باز مانده باشد و آن جا از دست رفته باشد؛ اعتمادِ به کلاینت یعنی
       رزروِ روی روزِ تعطیل یا ظرفیتِ پرشده. */
    const [jy, jm] = jalaliYm(date);
    /* ⚠️ همان نمای بیمار (`patient: true`) که صفحه نشان داده: ساعتِ گذشتهٔ امروز این‌جا هم رد
       می‌شود، نه فقط در تقویم (بازبینیِ UX، بندِ ۹۷). */
    const cal = await this.availability.month(jy, jm, { topicId: dto.topicId, patient: true });
    const day = cal.days.find((d: any) => d.date === dto.date);
    if (!day || !day.open) {
      /* امروزی که ساعت‌هایش گذشته با «پر شد» یکی نیست — بیمار باید بداند چرا. */
      const late = !!day && !day.past && day.windows.some((w: any) => w.past || (w.slots ?? []).some((x: any) => x.past));
      throw new BadRequestException(day?.past ? 'این روز گذشته است — روزِ دیگری انتخاب کنید'
        : late ? 'وقتِ نوبت‌دهیِ امروز تمام شده — روزِ دیگری انتخاب کنید'
          : 'این روز دیگر آزاد نیست — روزِ دیگری انتخاب کنید');
    }

    const slotMode = day.windows.some((w: any) => w.mode === 'slot');
    if (slotMode) {
      const sl = day.windows
        .filter((w: any) => w.mode === 'slot')
        .flatMap((w: any) => w.slots)
        .find((x: any) => x.startMin === dto.startMin);
      if (!sl || sl.taken) {
        throw new BadRequestException(sl?.past
          ? 'این ساعت گذشته یا خیلی نزدیک است — ساعتِ دیگری انتخاب کنید'
          : 'این ساعت دیگر آزاد نیست — ساعتِ دیگری انتخاب کنید');
      }
    }

    try {
      const appt = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM intake_submissions WHERE id = ${row.id} FOR UPDATE`;
        const current = await tx.intakeSubmission.findUnique({ where: { id: row.id } });
        if (!current || !['pending_fill', 'pending_payment'].includes(current.status)) {
          throw new BadRequestException('این فرم دیگر قابلِ ویرایش نیست');
        }
        const prev = await tx.appointment.findUnique({ where: { submissionId: row.id } });
        if (prev?.visitId) throw new BadRequestException('ویزیتِ این نوبت شروع شده و زمانِ آن از فرمِ بیمار قابل تغییر نیست');
        const data = {
          patientId: current.patientId ?? null,
          // جابه‌جاییِ روز، ارجاعِ هدف را هم دوباره تعیین می‌کند؛ ارجاعِ قبلی باقی نمی‌ماند.
          forVisitId: await this.patients.appointmentTarget(tx, current.patientId, date),
          topicId: dto.topicId ?? prev?.topicId ?? null,
          date, startMin: slotMode ? dto.startMin ?? null : null,
          status: 'held', submissionId: row.id,
        };
        const held = prev
          ? await tx.appointment.update({ where: { id: prev.id }, data })
          : await tx.appointment.create({ data });
        await this.audit.record({
          actorId: null, action: 'appointment.hold', entityType: 'appointment', entityId: held.id,
          after: { date: dto.date, startMin: data.startMin, submissionId: row.id, forVisitId: held.forVisitId },
        }, tx);
        await this.events.emit({ type: 'appointment.held', appointmentId: held.id,
          patientId: held.patientId, visitId: held.forVisitId, payload: { date } }, tx);
        return held;
      });
      /* یادآوریِ «نوبتِ فردا» — همین‌جا که نوبت گرفته/جابه‌جا شد. */
      await this.reminders.syncAppointment(appt.id);
      return this.publicView(token);
    } catch (e: any) {
      if (e?.code === 'P2002') throw new BadRequestException('همین حالا کسی این نوبت را گرفت — لطفاً ساعتِ دیگری بزنید');
      throw e;
    }
  }

  async publicView(token: string) {
    const row = await this.expireIfDue(token);
    const face = await this.portal.publicFace();
    /* یک‌بار برای دو مصرف: هم `makesVisit` هم خاموش‌کردنِ نوبت‌دهی. */
    const scope = await this.formScope(row.formId);
    /* ⚠️ حساب از **لینکِ همین ثبت‌نام** خوانده می‌شود، نه از خودِ ثبت‌نام.
       عمداً snapshot نشد (برخلافِ `amount` و `formId`): اگر حسابی بسته شود،
       فیشِ بیمار باید به حسابِ تازه برود — نه به حسابی که موقعِ شروعِ فرم
       انتخاب شده بود و حالا دیگر پول نمی‌گیرد. */
    /* ثبت‌نامِ مستقیم (ارسال از کارتِ مراجعه) لینک ندارد → حسابِ سراسری. */
    const link = row.linkId === null ? null : await this.prisma.intakeLink.findUnique({
      where: { id: row.linkId },
      select: { bankAccountId: true, token: true, active: true },
    });
    return {
      // ⚠️ بدونِ این، بیمار مبلغ را می‌بیند ولی نمی‌داند **به کجا** بریزد —
      //    و فیشی که آپلود می‌کرد به حسابِ ما نبود. فقط حساب‌هایی که ادمین
      //    صریحاً برای فرمِ عمومی علامت زده، و فقط فیلدهای لازمِ واریز.
      payTo: await this.payTo(link?.bankAccountId ?? null),
      /* توضیحِ بالای کارتِ بانکی — یک متن برای کلِ شرکت (تنظیمات → پذیرشِ آنلاین).
         ⚠️ «خالی = متنِ پیش‌فرض» (راهنمای همان تنظیم): متنِ خالیِ ذخیره‌شده یعنی مدیر پاکش
         کرده، نه اینکه بیمار صفحهٔ پرداختِ بی‌توضیح ببیند. */
      paymentNote: await this.settings.textOr('intake_payment_note', String(SETTING_BY_KEY.get('intake_payment_note')?.default ?? '')),
      /* ⚠️ تعریفِ فرم از **عکسِ لحظه‌ایِ خودِ ثبت‌نام** می‌آید نه از لینک: اگر
         ادمین وسطِ کار فرمِ لینک را عوض کند، بیمارِ در جریان باید همان فرمی را
         ببیند که شروع کرده. `null` یعنی «فرمی ندارد» و صفحه به فیلدهای
         هاردکدِ امروز برمی‌گردد. */
      form: await this.formView(row.formId, row.extraFormIds ?? []),
      token: row.token,
      status: row.status,
      /* بیمار از صفحهٔ ثبت‌نام آمده (نه فرمِ مستقیمِ کارکنان) — مرحله‌نمای فرم «مشخصات»ِ انجام‌شده را
         اولِ کار نشان می‌دهد تا شماره‌ها با «چه پیش رو دارید»ِ همان صفحه یکی باشند (بندِ ۱۰۷). */
      registered: row.linkId !== null,
      /* «شروعِ دوباره» / «ثبتِ درخواستِ تازه» برای فرمِ منقضی یا ردشده (بازبینیِ UX، بندِ ۱۱۰): همان لینکِ
         ثبت‌نامی که بیمار از آن آمده — فقط اگر هنوز فعال است؛ وگرنه صفحه فقط «تماس» می‌گذارد. لینکِ
         ثبت‌نام خودش عمومی است (بیو، پیامک)، پس دادنش به دارندهٔ همین فرم چیزی را باز نمی‌کند. */
      restartToken: (row.status === 'expired' || row.status === 'rejected') && link?.active ? link.token : null,
      /* ⚠️ نوبت‌دهی فقط وقتی در صفحهٔ بیمار ظاهر می‌شود که نصب برنامهٔ کاری
         داشته باشد. نصبی که ندارد باید دقیقاً مثلِ دیروز کار کند — نه اینکه
         به گامی برسد که هیچ روزی برای انتخاب ندارد.
         ⚠️ فرمِ زیرپرونده (نظرسنجی/پرسش‌نامه) هم **هرگز** نوبت ندارد: مراجعه
         نمی‌سازد، پس «روزِ نوبت را انتخاب کنید» رویش یک وعدهٔ دروغ بود —
         همان قاعده‌ای که `fill` (خطِ bookingOnِ پایین‌تر) از روزِ اول داشت
         ولی نما نداشت. */
      booking: scope !== 'record' && (await this.bookingOn())
        ? {
          required: true,
          appointment: await this.prisma.appointment
            .findUnique({
              where: { submissionId: row.id },
              select: { date: true, startMin: true, status: true, topic: { select: { id: true, name: true } } },
            })
            .then((a) => (a
              ? {
                date: a.date.toISOString().slice(0, 10),
                startMin: a.startMin,
                time: a.startMin == null ? null : AvailabilityService.minToHHMM(a.startMin),
                /* «چهارشنبه ۸ مهر ۱۴۰۵» و «۱۶:۰۰» — کارتِ پایانیِ فرم نوبت را به زبانِ بیمار می‌گوید
                   (بازبینیِ UX، بندِ ۱۰۲). */
                whenFa: faDayLong(a.date),
                timeFa: a.startMin == null ? null : faClock(AvailabilityService.minToHHMM(a.startMin)),
                status: a.status,
                topicId: a.topic?.id ?? null,
                topicName: a.topic?.name ?? null,
              }
              : null)),
        }
        : { required: false, appointment: null },
      statusLabel: INTAKE_LABELS[row.status] ?? row.status,
      /* مشتقِ سرور (قانون ۱۵): پیامِ پایانیِ صفحهٔ بیمار به «این فرم چه
         می‌سازد» وابسته است. نظرسنجیِ تأییدشده نباید بخواند «ثبت‌نامِ شما
         تأیید شد، تماس می‌گیریم» — کسی قرار نیست تماس بگیرد. */
      makesVisit: scope !== 'record',
      // ⚠️ هر سه عدد برمی‌گردند نه فقط «قابلِ پرداخت»: بیمار باید ببیند
      //    تخفیفش واقعاً خورده، وگرنه عددِ کمتر شبیهِ اشتباه به‌نظر می‌رسد.
      amount: row.amount,
      discountCode: row.discountCode,
      discountAmount: row.discountAmount,
      payable: Math.max(0, row.amount - row.discountAmount),
      data: withoutReturns(row.data),
      reviewNote: row.reviewNote,
      /* برگشتِ جاری (مرحله، دلیل، راهنما) — تا وقتی بیمار اصلاح را نفرستاده. */
      returned: currentReturn(row.data, row.status),
      expiresAt: row.expiresAt,
      /* مهلتِ فرم به زبانِ بیمار («دوشنبه ۲۱ مهر ۱۴۰۵») — تا دیروز هیچ‌جا گفته نمی‌شد (بندِ ۱۰۳). */
      expiresFa: row.expiresAt ? faDayLong(row.expiresAt) : null,
      /* نام/تلفنِ مطب و حوزه (تم) — همان `publicLink`. */
      ...face,
    };
  }

  /**
   * حساب‌هایی که بیمار باید به آن‌ها واریز کند.
   *
   * ⚠️ تنها نقطه‌ای است که شمارهٔ حساب از یک نشانیِ **بی‌احراز** خوانده
   * می‌شود، پس فهرست از `showOnIntake` می‌آید نه از «همهٔ حساب‌های فعال»:
   * حسابِ شخصیِ شریک نباید روی اینترنت برود. `partnerId` و یادداشت هم
   * برنمی‌گردند — بیمار فقط به نام و شماره احتیاج دارد.
   *
   * ⚠️ **`showOnIntake` دوباره این‌جا سنجیده می‌شود، حتی وقتی لینک حساب دارد.**
   * `resolveLinkRefs` هنگامِ ساختِ لینک سنجیده بود، ولی ادمین می‌تواند فردا
   * حساب را از فرمِ عمومی بردارد؛ اگر این‌جا دوباره نمی‌سنجیدیم، آن «برداشتن»
   * روی لینک‌های ساخته‌شده هیچ اثری نداشت — یک دروازهٔ امنیتی که فقط یک بار
   * قفل می‌شود، قفل نیست.
   *
   * ⚠️ **fallback به فهرستِ سراسری اجباری است.** همهٔ لینک‌های موجود
   * `bankAccountId = null` دارند؛ بدونِ این، همین یک تغییر شمارهٔ حساب را از
   * روی **تمام** فرم‌های امروز برمی‌داشت و بیمار به‌جای شماره، هشدارِ «شمارهٔ
   * حسابی تنظیم نشده» می‌دید — بدونِ خطا، بدونِ لاگ، فقط ثبت‌نامِ صفر.
   */
  private async payTo(bankAccountId: number | null) {
    const where = bankAccountId
      ? { id: bankAccountId, active: true, showOnIntake: true }
      : { active: true, showOnIntake: true };
    const select = {
      id: true, ownerName: true, bankName: true,
      accountNumber: true, cardNumber: true, iban: true,
    };
    const rows = await this.prisma.bankAccount.findMany({ where, orderBy: { id: 'asc' }, select });
    /* حسابِ انتخاب‌شده بسته یا از فرمِ عمومی برداشته شده → به فهرستِ سراسری
       برگرد، وگرنه بیمار با فرمی روبه‌رو می‌شود که هیچ راهِ پرداختی ندارد. */
    if (bankAccountId && rows.length === 0) {
      return this.prisma.bankAccount.findMany({
        where: { active: true, showOnIntake: true },
        orderBy: { id: 'asc' },
        select,
      });
    }
    return rows;
  }

  /**
   * تعریفِ فرمی که بیمار باید پر کند — فقط فیلدهای **دلخواه**.
   *
   * ⚠️ فیلدهای `builtin`ِ فرمِ ثبت‌نام (نام، کدِ ملی، موبایل، …) ستونِ `Patient`
   * هستند و در گامِ **اول** (`register`) گرفته می‌شوند، نه این‌جا. اگر این‌جا
   * هم می‌آمدند، بیمار همان چهار فیلد را دو بار پر می‌کرد و نسخهٔ دوم روی
   * پرونده نمی‌نشست.
   *
   * ⚠️ فرمِ **خاموش‌شده** مثلِ فرمِ نبوده رفتار می‌کند (`null`): ادمین فرم را
   * خاموش کرده و صفحه باید به مسیرِ هاردکدِ قدیمی برگردد، نه اینکه فرمِ خالی
   * نشان بدهد.
   */
  /** محدودهٔ فرمِ یک ثبت‌نام — null یعنی فرمِ هاردکدِ قدیمی (intake). */
  private async formScope(formId: number | null): Promise<string | null> {
    if (!formId) return null;
    const f = await this.prisma.formDef.findUnique({ where: { id: formId }, select: { scope: true } });
    return f?.scope ?? null;
  }

  private async formView(formId: number | null, extraFormIds: number[] = []) {
    if (!formId) return null;
    const f = await this.prisma.formDef.findUnique({
      where: { id: formId },
      include: { fields: { orderBy: [{ page: 'asc' }, { sort: 'asc' }, { id: 'asc' }] } },
    });
    if (!f || !f.active) return null;
    const publicFields = (rows: any[]) => rows
      /* ⚠️ فیلدِ **بخش‌دار** (نقشِ پزشک/منشی/…) کارِ داخلیِ مطب است و روی فرمِ
         عمومی جایی ندارد: «شرحِ معاینه» را پزشک بعد از دیدنِ بیمار می‌نویسد،
         نه خودِ بیمار پیش از آمدن. همین فیلتر سدِ نوشتن هم هست — `fill` فقط
         کلیدهای همین نما را می‌پذیرد، پس بیمار نمی‌تواند مقداری در بخشِ
         پزشک جا بگذارد. روی نصبِ واقعی دیده شد. */
      .filter((x) => !x.builtin && x.active && !x.deletedAt && !x.role)
      .map((x) => ({
        key: x.key, label: x.label, type: x.type, required: x.required,
        options: x.options ?? [], hint: x.hint, placeholder: x.placeholder, page: x.page, roles: x.roles ?? [],
        /* دستهٔ پیش‌فرضِ مدرکِ باکسِ عکس/لینک — کلاینت پیلِ نوعِ لینک را با آن پیش‌فرض می‌کند. */
        docCategory: x.docCategory ?? null,
      }));
    const fields = publicFields(f.fields);

    /* بخش‌های اختصاصیِ فرمِ پیگیری (extra_form_ids روی خودِ ثبت‌نام): فیلدهای
       هر بخش، صفحه(های) **بعدیِ** همان فرم می‌شوند — بیمار یک لینک می‌بیند،
       دو بخش: عمومی و اختصاصیِ عمل/تشخیصِ خودش. کلیدِ تکراری از بخشِ اختصاصی
       حذف می‌شود تا پاسخِ عمومی بازنویسی نشود. */
    if (extraFormIds.length) {
      const extras = await this.prisma.formDef.findMany({
        where: { id: { in: extraFormIds }, active: true },
        include: { fields: { orderBy: [{ page: 'asc' }, { sort: 'asc' }, { id: 'asc' }] } },
        orderBy: { id: 'asc' },
      });
      const seen = new Set(fields.map((x) => x.key));
      let offset = fields.reduce((m, x) => Math.max(m, x.page), 1);
      for (const ex of extras) {
        const exFields = publicFields(ex.fields).filter((x) => !seen.has(x.key));
        if (!exFields.length) continue;
        const minPage = Math.min(...exFields.map((x) => x.page));
        const maxPage = Math.max(...exFields.map((x) => x.page));
        for (const x of exFields) {
          fields.push({ ...x, page: offset + (x.page - minPage) + 1 });
          seen.add(x.key);
        }
        offset += maxPage - minPage + 1;
      }
    }

    return {
      key: f.key,
      title: f.title,
      /* راهنمای پیش‌فرضِ قدیمی زبانِ کارکنان بود («فرم عمل از مسیر جداگانهٔ مطب…») — متنِ دست‌نخورده‌اش
         برای بیمار به متنِ تازه برمی‌گردد (بندِ ۱۱۳)؛ راهنمای نوشتهٔ مدیر همان می‌ماند. */
      hint: Object.values(REGISTRATION_HINTS).find((h) => h.was === f.hint)?.now ?? f.hint,
      /* صفحه‌شمار سمتِ سرور (قانون ۱۵) — و از روی همین فیلدهای دیده‌شده، نه
         از کلِ فرم: اگر تنها فیلدِ صفحهٔ ۲ خاموش باشد، صفحهٔ ۲ وجود ندارد. */
      pages: fields.reduce((m, x) => Math.max(m, x.page), 1),
      fields,
    };
  }

  /**
   * پرکردنِ اطلاعاتِ عمل.
   *
   * ⚠️ **ادغام، نه بازنویسی.** نسخهٔ قبلی هر پنج کلید را بی‌قید از `text(...)`
   * رد می‌کرد و `text` برای مقدارِ نیامده `null` برمی‌گرداند — یعنی یک ذخیرهٔ
   * جزئی مقادیرِ قبلی را **پاک می‌کرد**. با آمدنِ فیلدهای دلخواه و فرمِ
   * چندصفحه‌ای این دیگر یک خطرِ نظری نیست: ذخیرهٔ صفحهٔ ۲ صفحهٔ ۱ را می‌ریخت.
   */
  async fill(
    token: string,
    dto: {
      procedure?: string; surgeonName?: string; hospitalName?: string; opDate?: string; notes?: string;
      values?: Record<string, any>; hospitalId?: number; rev?: number;
    },
  ) {
    /* ثبتِ نهایی هم با پیش‌نویسِ در راه برخورد می‌کرد — همان «صفحه را تازه کنید» روی دکمهٔ
       ثبت. همه‌چیزِ `fillOnce` از ردیفِ تازه ساخته می‌شود و نوشتن و رویدادها در یک
       تراکنش‌اند، پس تکرارش بعد از برخورد بی‌عارضه است (`onFreshRow`). */
    return this.onFreshRow(() => this.fillOnce(token, dto, saveRev(dto.rev)));
  }

  /** یک تلاشِ `fill` — همه‌چیز از ردیفی که همین‌جا خوانده می‌شود. */
  private async fillOnce(
    token: string,
    dto: {
      procedure?: string; surgeonName?: string; hospitalName?: string; opDate?: string; notes?: string;
      values?: Record<string, any>; hospitalId?: number;
    },
    rev: number | null,
  ) {
    const row = await this.expireIfDue(token);
    if (!['pending_fill', 'pending_payment'].includes(row.status)) {
      throw new BadRequestException('این فرم دیگر قابلِ ویرایش نیست');
    }

    const data: Record<string, any> = { ...(row.data as any) };
    if (dto.hospitalId !== undefined) {
      const selected = dto.hospitalId > 0 ? await this.prisma.hospital.findFirst({ where: { id: dto.hospitalId, active: true } }) : null;
      if (dto.hospitalId > 0 && !selected) throw new BadRequestException('بیمارستان انتخاب‌شده فعال نیست');
      data.hospitalId = selected?.id ?? null;
    }
    const fixed: [keyof typeof dto, string, number][] = [
      ['procedure', 'procedure', 200],
      ['surgeonName', 'surgeonName', 100],
      ['hospitalName', 'hospitalName', 150],
      ['opDate', 'opDate', 12],
      ['notes', 'patientNotes', 500],
    ];
    for (const [from, to, max] of fixed) {
      if (dto[from] !== undefined) data[to] = text(dto[from], max);
    }

    const form = await this.formView(row.formId, row.extraFormIds ?? []);
    if (form && dto.values) {
      /* ⚠️ فقط کلیدهای **همین فرم** پذیرفته می‌شوند: بدونِ این، یک POSTِ
         دست‌ساز می‌توانست هر کلیدی را در `data` بنشاند — از جمله کلیدهایی که
         هنگامِ تأیید به ستونِ واقعیِ پرونده می‌روند.
         ⚠️ `payment` بیرون می‌ماند چون مقدار ندارد، و `image` هم بیرون می‌ماند
         چون ارجاعش را فقط مسیرِ آپلود می‌نویسد — وگرنه بیمار می‌توانست id یک
         مدرکِ دیگر را جا بزند. */
      const writable = new Set(
        form.fields.filter((x) => x.type !== 'payment' && x.type !== 'image').map((x) => x.key),
      );
      for (const [k, v] of Object.entries(dto.values)) {
        if (writable.has(k)) data[k] = typeof v === 'string' ? text(v, 2000) : v;
      }
      /* ⚠️ **کلیدِ رزروشده مالِ سیستم است، از هر مسیری که پر شود.**

         `DynForm` برای فیلدِ `date` رشتهٔ **شمسی** می‌دهد (`JDate`)، ولی
         `data.opDate` همه‌جا ISO خوانده می‌شود — `Intake.jsx` با `faDate` و
         `isoToJStr` — و `split()` همان مقدار را به **ستونِ واقعیِ** مراجعه
         می‌فرستد. حلقهٔ `values` بالا بعد از حلقهٔ `fixed` اجرا می‌شود، پس
         مقدارِ خامِ شمسی مقدارِ تبدیل‌شدهٔ ISO را بازنویسی می‌کرد.

         باگِ واقعی (۱۴۰۵/۰۶/۳۰): کارتِ ثبت‌نام «۸ تیر ۷۸۴» نشان می‌داد و کادرِ
         تاریخِ پنلِ تأیید با `784/04/08` پیش‌پر می‌شد — چون `1405/06/28`
         به‌عنوانِ تاریخِ **میلادی** خوانده شده بود (۱۴۰۵ − ۶۲۱ ≈ ۷۸۴). گاردِ
         `addField` جلوی ساختنِ دستیِ فیلدی به‌نامِ `opDate` را می‌گیرد، ولی
         خودِ پریستِ ثبت‌نام یکی دارد و گارد هیچ‌وقت به پریست‌ها نرسید.

         `toDateValue` همان تشخیصِ بی‌ابهامِ «سالِ < ۱۷۰۰ یعنی شمسی» را دارد، پس
         مقدارِ از قبل ISO دست‌نخورده می‌مانَد. کلیدِ **دلخواه** عمداً عوض
         نمی‌شود: مقدارش در JSON می‌مانَد و `answerText` خام چاپش می‌کند، پس
         تبدیلش نمایشِ همهٔ پاسخ‌های قبلی را خراب می‌کرد. */
      for (const fl of form.fields) {
        if (fl.type !== 'date' || !BUILTIN_VISIT_KEYS.has(fl.key)) continue;
        const when = toDateValue(data[fl.key]);
        if (when) data[fl.key] = when.toISOString().slice(0, 10);
      }
      /* «رزرو بدون تاریخ» (مالک، ۱۴۰۵/۰۷/۰۱): تاریخِ نیمه‌پرِ قبلی نباید کنارِ
         اعلامِ «هنوز معلوم نیست» بماند — دو ادعای متناقض که تأییدکننده باید حدس
         بزند کدام درست است. */
      if (isUndated(data[UNDATED_KEY])) delete data.opDate;
      /* باکسِ لینک: URLِ http(s)ِ معتبر، سقفِ ۱۰، متن‌ها بریده — همان قاعدهٔ
         `Visit.extra`. لینکِ `javascript:` روی صفحهٔ پرونده کلیک‌شدنی می‌شود. */
      for (const fl of form.fields) {
        if (fl.type === 'links' && data[fl.key] !== undefined && data[fl.key] !== null) data[fl.key] = normalizeLinks(data[fl.key], fl.label);
      }
      /* ⚠️ همان قاعدهٔ ستارهٔ فرم‌ساز، ولی فقط روی فیلدهایی که بیمار **می‌بیند**.
         نسخهٔ اول کلِ فرم را می‌سنجید و روی فرمِ مراجعه شکست: `createForm` یک
         `opDate`ِ اجباریِ builtin روی هر فرمِ مراجعه می‌سازد، و آن را ادمین
         هنگامِ تأیید پر می‌کند نه بیمار — پس ذخیرهٔ بیمار ۴۰۰ می‌گرفت برای
         کادری که اصلاً روی صفحه‌اش نبود. */
      const r = this.forms.validateFields(form.fields, data);
      if (!r.ok) throw new BadRequestException(Object.values(r.errors).join('، '));
    }

    /* ⚠️ **فرمِ رایگان به مرحلهٔ فیش نمی‌رود.**
       تا دیروز این‌جا بی‌قید `pending_payment` می‌نشست، چون اولین مصرف‌کننده
       ثبت‌نامِ نورومانیتورینگ بود و آن همیشه پول داشت. ولی همین لینک‌ساز
       «پیگیری» و «نظرسنجی» هم می‌سازد که مبلغشان صفر است — و بیمار پشتِ
       «در انتظارِ فیش» گیر می‌کرد و باید عکسِ فیشی می‌فرستاد که اصلاً وجود
       نداشت. قالبِ یک محصول روی همهٔ فرم‌ها هاردکد شده بود.

       «رایگان» یعنی هم مبلغِ قابلِ پرداخت صفر باشد و هم فرم کادرِ پرداخت
       نداشته باشد. فرمی که کادرِ پرداخت **دارد** ولی مبلغش صفر است عمداً
       همچنان فیش می‌خواهد: آن یک خطای پیکربندی است، نه یک فرمِ رایگان، و
       بی‌صدا ردکردنش یعنی پولِ نگرفته «تأییدشده» به‌نظر برسد. */
    /* ⚠️ **snapshotِ کهنهٔ مبلغ همین‌جا تازه می‌شود.** مبلغ هنگامِ ثبت‌نام از
       لینک عکس‌برداری می‌شود؛ ولی ثبت‌نامی که **قبل از قیمت‌گذاریِ لینک**
       ساخته شده بود، صفر می‌ماند و از مرحلهٔ فیش می‌پرید — روی نصبِ واقعی
       دیده شد: لینکِ ویزیت ۱٬۲۰۰٬۰۰۰ نشان می‌داد و بیمار بدونِ هیچ فیشی به
       «بررسیِ ما» می‌رسید. تا وقتی بیمار به مرحلهٔ پرداخت نرسیده، قیمتِ
       معتبر همان است که **الان روی لینک است** — همان عددی که صفحهٔ ثبت‌نام
       به خودش نشان می‌دهد. تخفیفِ اعمال‌شده روی مبلغِ قبلی محاسبه شده، پس
       با تخفیفِ خورده دست نمی‌زنیم تا عددِ پذیرفته‌شدهٔ بیمار عوض نشود. */
    if (row.linkId && row.discountAmount === 0) {
      const lk = await this.prisma.intakeLink.findUnique({ where: { id: row.linkId }, select: { amount: true } });
      if (lk && lk.amount !== row.amount) {
        row.amount = lk.amount;
      }
    }
    const payable = Math.max(0, row.amount - row.discountAmount);
    const hasPaymentBox = !!form?.fields.some((x) => x.type === 'payment');

    /* ⚠️ **فرمِ زیرپرونده‌ی رایگان صفِ تأیید هم ندارد.** صفِ تأیید برای دو
       چیز است: پول (فیش باید با چشمِ ادمین بخواند) و ساختِ مراجعه (جراح و
       تاریخ را ادمین گره می‌زند). نظرسنجی و فرمِ زیرپرونده هیچ‌کدام را
       ندارند — مبلغشان از ریشه بسته است (`assertRecordFormHasNoAmount`) و
       مراجعه هم نمی‌سازند؛ تا دیروز ادمین برای تک‌تکشان یک مُهرِ خالی
       می‌کوبید.

       `reviewedById` عمداً خالی می‌ماند: هیچ آدمی این را ندیده و دفترِ
       رسیدگی نباید امضا جعل کند. audit با کنشِ جدا ثبت می‌شود تا «خودکار»
       از «دستی» قابلِ تفکیک بماند. جبرانش هم هست: `reject` رکوردِ
       خودکارتأییدشده را می‌پذیرد.

       ⚠️ `form !== null` شرطِ سوم است و تزئینی نیست: `formView` برای فرمِ
       **خاموش‌شده** null برمی‌گرداند، پس اعتبارسنجی و نوشتنِ پاسخ‌ها بالاتر
       کلاً رد شده‌اند. اگر بی‌قید خودکار تأیید می‌کردیم (بازبینیِ خصمانه
       گرفتش)، فرمی که ادمین قصدِ توقفش را داشت یک رکوردِ بالینیِ approvedِ
       **تهی** در پرونده می‌کاشت. فرمِ خاموش به صفِ تأیید می‌افتد تا چشمِ
       انسان ببیندش. فرمِ record با کادرِ پرداخت (خطای پیکربندی) هم عمداً در
       مسیرِ فیش می‌ماند. */
    const meta = row.formId
      ? await this.prisma.formDef.findUnique({ where: { id: row.formId }, select: { scope: true, key: true } })
      : null;

    /* ⚠️ اگر نصب نوبت‌دهی دارد و این فرم مراجعه می‌سازد، بدونِ نوبت نمی‌شود
       تمام کرد. وگرنه ثبت‌نامی به صفِ تأیید می‌رسید که هیچ روزی ندارد و
       ادمین باید تلفنی می‌پرسید «کِی می‌آیی؟» — یعنی همان کاری که این
       مرحله برای حذفش آمده. فرمِ زیرپرونده (نظرسنجی) مستثناست. */
    /* ⚠️ «رزرو بدون تاریخ» همین قاعده را کنار می‌زند: بیمار صریحاً گفته روزِ عمل
       هنوز معلوم نیست، پس خواستنِ روزِ نوبت یعنی مجبورش کنیم روزی را حدس بزند. */
    if (meta?.scope !== 'record' && !isUndated(data[UNDATED_KEY]) && (await this.bookingOn())) {
      const appt = await this.prisma.appointment.findUnique({ where: { submissionId: row.id } });
      if (!appt || appt.status === 'cancelled') {
        throw new BadRequestException('روزِ نوبت را انتخاب کنید');
      }
    }
    const free = payable === 0 && !hasPaymentBox;
    const direct = free && meta?.scope === 'record' && form !== null;
    /* ⚠️ فیشِ معتبرِ قبلی = ثبت‌نامی که برای اصلاحِ **خدمت یا مدارک** برگشته بود
       (`intake-return.ts`): فیشش سرِ جایش است و بیمار نباید دوباره واریز یا آپلود کند —
       با ثبتِ فرم مستقیم به صفِ تأیید برمی‌گردد. برگشتِ «فیش» یا «همه» فیش را کنار
       گذاشته، پس این‌جا خالی است و مسیرِ عادیِ واریز می‌ماند. */
    const hasReceipt = receiptIdsOf(data).length > 0;
    const nextStatus = direct ? 'approved' : free || hasReceipt ? 'pending_approval' : 'pending_payment';

    /* پیش‌نویسی که پیش از این ثبت ساخته شده و دیرتر برسد، روی آن نمی‌نشیند (`SAVE_REV`). */
    if (rev !== null) data[SAVE_REV] = Math.max(rev, Number(data[SAVE_REV]) || 0);
    const schemaSnapshot = row.schemaSnapshot ?? form?.fields ?? await this.forms.schemaSnapshot(row.formId, row.extraFormIds);
    await this.prisma.$transaction(async (tx) => {
      const saved = await this.updateSubmissionVersion(row, {
        data, amount: row.amount, schemaSnapshot, status: nextStatus,
        ...(direct ? { reviewedAt: new Date() } : {}),
      }, tx);
      /* ⚠️ کارِ «بررسی و تأییدِ ثبت‌نام» فقط وقتی باز می‌شود که **چیزی برای تأیید** هست:
         فرمِ پولی تا فیش نیامده در صفِ منشی نمی‌نشیند (رویدادش را آپلودِ فیش می‌زند). تا
         دیروز همین‌جا بی‌قید باز می‌شد و کار روزها برای ثبت‌نامی باز می‌ماند که بیمارش
         هنوز واریز نکرده بود. */
      if (nextStatus !== 'pending_payment') {
        await this.events.emit({ type: 'intake.submitted', refType: 'intake_submission', refId: row.id,
          patientId: saved.patientId, visitId: saved.visitId }, tx);
      }
      if (direct) {
        /* W1.3: همان گامی که `approve()` دستی اجرا می‌کند — وگرنه لینکِ فرم
           هرگز مدرکِ پرونده نمی‌شود و چون این ردیف دیگر `pending_approval`
           نیست، از مسیرِ دستی هم قابلِ جبران نبود. */
        await this.commitAnswers(tx, {
          patientId: saved.patientId, visitId: saved.visitId,
          fields: form?.fields, data, actorId: null,
        });
        // تأیید خودکار هم باید کارِ بازشده با submitted را با همان ref ببندد.
        await this.events.emit({ type: 'intake.approved', refType: 'intake_submission', refId: row.id,
          patientId: saved.patientId, visitId: saved.visitId }, tx);
        await this.audit.record({
          actorId: null, action: 'intake.approve.auto', entityType: 'intake_submission', entityId: row.id,
          after: { patientId: row.patientId, formKey: meta?.key ?? null },
        }, tx);
      }
    });
    return this.publicView(token);
  }

  /**
   * پیش‌نویسِ فرمِ چندصفحه‌ای — W1.8/D09، قراردادِ §۶.
   *
   * ⚠️ **چرا `fill` نمی‌توانست این کار را بکند.** تنها راهِ ذخیرهٔ پاسخِ بیمار
   * `fill()` بود و آن `status` را جلو می‌برد (`pending_approval` یا
   * `pending_payment`). یعنی «ذخیرهٔ موقتِ صفحهٔ ۲» ممکن نبود: یا همه‌چیز
   * ثبتِ نهایی می‌شد یا هیچ. نتیجه‌اش این بود که رفرشِ وسطِ فرم — یا فقط
   * قطعِ لحظه‌ایِ اینترنت روی موبایل — همهٔ متنِ تایپ‌شده را می‌برد.
   *
   * پس این endpoint فقط `data` را merge می‌کند و `status` را **دست نمی‌زند**.
   *
   * سه تفاوتِ عمدی با `fill`:
   *
   * 1. **اعتبارسنجیِ فیلدهای اجباری اجرا نمی‌شود.** پیش‌نویس طبقِ تعریف ناقص
   *    است؛ سنجشِ «این کادر خالی است» سرِ ثبتِ نهایی معنی دارد، نه وسطِ تایپ.
   * 2. **لینک نرمال‌سازی نمی‌شود.** `normalizeLinks` روی نشانیِ ناقص **پرتاب**
   *    می‌کند، و بیمار وسطِ تایپِ یک آدرس فوکوس را رها می‌کند — یعنی هر
   *    ذخیرهٔ خودکار ۴۰۰ می‌گرفت. `fill` سرِ ثبتِ نهایی نرمال می‌کند و تنها
   *    راهِ رسیدن به تأیید هم همان است، پس مقدارِ خامِ پیش‌نویس به پرونده نمی‌رسد.
   * 3. **`_page` از `values` نمی‌آید، فیلدِ جداست.** لیستِ سفیدِ کلیدها فقط
   *    فیلدهای خودِ فرم را می‌پذیرد (و باید هم بپذیرد — وگرنه یک POSTِ دست‌ساز
   *    هر کلیدی را در `data` می‌نشاند). پس شمارهٔ صفحه ورودیِ typed خودش را
   *    دارد و سرور `data._page` را می‌نویسد؛ همان چیزی که فرانت می‌خواند.
   *
   * ⚠️ **بدهی:** قرارداد می‌گوید «rate-limit مثلِ `fill`» و `fill` هیچ ندارد —
   * پروژه اصلاً throttler ندارد. ولی این endpoint روی هر blur صدا زده می‌شود،
   * پس ترافیکش از `fill` خیلی بیشتر است. افزودنِ throttlerِ سراسری بیرونِ این
   * بسته است و در `STATUS.md` ثبت شد.
   */
  async draft(token: string, dto: { values?: Record<string, any>; page?: number; rev?: number }) {
    /**
     * ⚠️ نشانیِ **عمومی و بی‌احراز** که در هر فراخوانی در دیتابیس می‌نویسد —
     * پس نرخ‌گیر دارد. (یادداشتِ W1.8 نوشته بود «پروژه throttler ندارد»؛
     * غلط بود و خودِ همان لِین بعداً تصحیحش کرد: `RateLimitService` هست و
     * `auth`، `platform` و آپلودِ پاسخِ سفارش استفاده‌اش می‌کنند.)
     *
     * سقف از **مصرفِ واقعی** آمده نه از حدس: `src/pages/Intake.jsx` ذخیره را
     * با debounceِ ۱٫۵ ثانیه و روی `blur` می‌زند، و پرکردنِ یک فرمِ کامل چند
     * ده ذخیره است. ۳۰۰ در ربع‌ساعت (~۲۰ در دقیقه) با فاصلهٔ زیاد بالاتر از
     * آن می‌ماند و در عمل فقط جلوی توکنِ لورفته را می‌گیرد.
     *
     * کلید خودِ توکن است (نه IP): توکن مالِ یک بیمار است و بیمارِ پشتِ
     * NATِ موبایل نباید بابتِ دیگری جریمه شود.
     */
    this.rateLimit.hit(`intake-draft:${token}`, 300, 15 * 60_000);
    const rev = saveRev(dto.rev);
    const save = async () => {
      const row = await this.expireIfDue(token);
      if (!['pending_fill', 'pending_payment'].includes(row.status)) {
        throw new BadRequestException('این فرم دیگر قابلِ ویرایش نیست');
      }
      /* پیش‌نویسِ دیررس روی ذخیرهٔ تازه‌تر (پیش‌نویسِ بعدی یا ثبتِ نهایی) نمی‌نشیند. */
      if (rev !== null && staleSave(row.data, rev)) return { savedAt: row.updatedAt };
      const data: Record<string, any> = { ...(row.data as any) };
      const form = await this.formView(row.formId, row.extraFormIds ?? []);
      if (form && dto.values) {
        /* همان لیستِ سفیدِ `fill`: `payment` مقدار ندارد و ارجاعِ `image` را فقط
           مسیرِ آپلود می‌نویسد — وگرنه بیمار می‌توانست id مدرکِ دیگری را جا بزند. */
        const writable = new Set(
          form.fields.filter((x) => x.type !== 'payment' && x.type !== 'image').map((x) => x.key),
        );
        for (const [k, v] of Object.entries(dto.values)) {
          if (writable.has(k)) data[k] = typeof v === 'string' ? text(v, 2000) : v;
        }
      }
      if (typeof dto.page === 'number' && dto.page >= 1) data._page = dto.page;
      if (rev !== null) data[SAVE_REV] = rev;
      const saved = await this.updateSubmissionVersion(row, { data });
      return { savedAt: saved.updatedAt };
    };
    /* کلاینتِ قدیمیِ کش‌شده `rev` نمی‌فرستد: ترتیبِ دو پیش‌نویسش را نمی‌شود سنجید، پس
       همان یک تلاشِ قبلی — برخوردش همان ۴۰۹ِ همیشگی است، نه بازنویسیِ پاسخِ تازه‌تر. */
    return rev === null ? save() : this.onFreshRow(save);
  }

  /**
   * گامِ مشترکِ «تصویبِ پاسخ» — W1.3/D03a.
   *
   * ⚠️ **چرا این تابع وجود دارد، با اینکه یک خط است.** فرمِ زیرپرونده دو مسیرِ
   * تأیید دارد که سال‌ها از هم دور شدند:
   *
   * | مسیر | کِی |
   * |---|---|
   * | `approve()` | ادمین دستی تأیید می‌کند |
   * | شاخهٔ `direct` در `submit()` | فرمِ **رایگانِ** زیرپرونده، همان لحظهٔ ارسال |
   *
   * مسیرِ دوم ردیف را مستقیم `approved` می‌کرد و `syncLinkDocuments` را صدا
   * نمی‌زد. نتیجه: لینکی که بیمار در باکسِ `links` گذاشته بود (MRI، جوابِ
   * آزمایش) هرگز **مدرکِ پرونده** نمی‌شد و در تبِ مدارک دیده نمی‌شد.
   *
   * و برگشت‌پذیر هم نبود: `approve()` فقط ردیفِ `pending_approval` را می‌پذیرد،
   * پس ردیفِ خودکارتأییدشده دیگر هیچ‌وقت از آن مسیر رد نمی‌شد. لینک برای همیشه
   * فقط در `data` می‌ماند.
   *
   * پس هر عارضهٔ جانبیِ «پاسخ تصویب شد» از این‌جا می‌گذرد. اگر فردا چیزِ
   * تازه‌ای اضافه شد (دسته‌بندیِ عکس، اعلان، …) همین‌جا اضافه شود تا دو مسیر
   * دوباره از هم دور نیفتند.
   *
   * عکس‌ها عمداً این‌جا نیستند: `attachImage` همان لحظهٔ آپلود `Document` را
   * با دستهٔ درست می‌سازد، و فرمِ زیرپرونده مراجعه‌ای ندارد که بخواهند به آن
   * وصل شوند. چیزی برای attach کردن نمانده.
   */
  private async commitAnswers(
    tx: any,
    opts: {
      patientId: number | null;
      visitId: number | null;
      fields: { key: string; type?: string | null; label: string; docCategory?: string | null }[] | undefined;
      data: Record<string, any>;
      actorId: number | null;
    },
  ) {
    if (!opts.patientId) return;
    await syncLinkDocuments(tx, {
      patientId: opts.patientId,
      visitId: opts.visitId,
      fields: (opts.fields ?? []).filter((f) => f.type === 'links'),
      values: opts.data ?? {},
      actorId: opts.actorId,
    });
  }

  /**
   * عکسی که بیمار روی یک **باکسِ عکسِ** فرم پیوست می‌کند.
   *
   * ⚠️ جدا از `attachReceipt` است و عمداً وضعیت را جلو نمی‌برد: فیش یعنی
   * «پول فرستادم» و ثبت‌نام را کامل می‌کند؛ عکسِ رادیولوژی یک پاسخِ معمولیِ
   * فرم است.
   *
   * ⚠️ در `data` فقط **ارجاع** می‌نشیند و هیچ نشانیِ عمومی برنمی‌گردد: مدرکِ
   * پزشکی پشتِ همان guardهای پرونده می‌ماند. بیمار نامِ فایلِ خودش را می‌بیند،
   * نه راهی برای دوباره‌خواندنش.
   */
  async attachImage(
    token: string,
    fieldKey: string,
    file: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  ) {
    const row = await this.expireIfDue(token);
    if (!['pending_fill', 'pending_payment'].includes(row.status)) {
      throw new BadRequestException('این فرم دیگر قابلِ ویرایش نیست');
    }
    if (!row.patientId) throw new BadRequestException('این فرم پرونده‌ای ندارد');

    /* کلید باید واقعاً یک باکسِ عکسِ **همین** فرم باشد — وگرنه این نشانیِ
       عمومی یک آپلودرِ آزاد است. */
    const form = await this.formView(row.formId, row.extraFormIds ?? []);
    const fld = form?.fields.find((x) => x.key === fieldKey && x.type === 'image');
    if (!fld) throw new BadRequestException('این کادر عکس نمی‌گیرد');

    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    if (file.size > MAX_RECEIPT_BYTES) throw new BadRequestException('حجمِ فایل بیش از ۸ مگابایت است');
    /* مثلِ `attachReceipt`: این تست روی **ادعای** کلاینت است و فقط صافیِ
       اول؛ نوعِ ذخیره‌شده را `storedMime` از بایت‌ها می‌سازد. */
    if (!RECEIPT_MIME.test(file.mimetype || '')) throw new BadRequestException('فقط عکس یا PDF بفرستید');

    const { sha256, size } = await this.storage.save(file.buffer);
    const doc = await this.prisma.document.create({
      data: {
        patientId: row.patientId,
        /* دستهٔ فیلد (تصویربرداری/آزمایش…) — تا MRIِ فرم زیرِ «متفرقه» دفن نشود. */
        category: (fld as any).docCategory ?? 'other',
        title: fld.label,
        fileName: file.originalname?.slice(0, 200) || 'image',
        mimeType: storedMime(file),
        sha256,
        size,
      },
    });

    /* ⚠️ مقدارِ فیلدِ عکس **آرایه** است، نه یک شیء: بیمار معمولاً چند صفحه
       دارد (پشت و روی کارت، دو صفحهٔ جواب). رکوردهای قدیمی شیءِ تکی‌اند و
       همان‌جا به آرایهٔ یک‌عضوی تبدیل می‌شوند — بی‌مهاجرتِ جدا و بی‌شکستنِ
       فرم‌های پرشدهٔ موجود. */
    /* ارجاع روی **تازه‌ترین** نسخه افزوده می‌شود: ذخیرهٔ خودکارِ هم‌زمان (بازگشت از
       پنجرهٔ انتخابِ عکس روی اندروید) دیگر آپلود را رد نمی‌کند — `onFreshRow`. */
    await this.onFreshRow(async () => {
      const cur = await this.expireIfDue(token);
      if (!['pending_fill', 'pending_payment'].includes(cur.status)) {
        throw new BadRequestException('این فرم دیگر قابلِ ویرایش نیست');
      }
      const prev = (cur.data as any)?.[fieldKey];
      const list = Array.isArray(prev) ? [...prev] : (prev && typeof prev === 'object' && prev.id ? [prev] : []);
      if (list.length >= MAX_FIELD_IMAGES) {
        throw new BadRequestException(`برای این کادر حداکثر ${MAX_FIELD_IMAGES} فایل می‌شود گذاشت`);
      }
      list.push({ id: doc.id, name: doc.fileName });
      await this.updateSubmissionVersion(cur, { data: { ...(cur.data as any), [fieldKey]: list } });
    });
    return this.publicView(token);
  }

  /**
   * **توضیحِ صوتیِ یک لینک** در فرمِ عمومی (بستهٔ ۶د) — بیمار زیرِ لینکِ MRI
   * می‌گوید «رادیولوژیست گفت …».
   *
   * ⚠️ همان سه گاردِ `attachImage`: فرم هنوز بازِ ویرایش، کلید واقعاً یک
   * باکسِ **لینکِ** همین فرم، و نوع از **بایت‌ها** (فقط WAVِ ضبط‌کنندهٔ خودمان).
   * بدونِ اینها این نشانیِ عمومی یک آپلودرِ آزاد بود.
   *
   * ⚠️ مقدارِ فرم این‌جا عوض نمی‌شود: ارجاعِ صدا داخلِ **همان ردیفِ لینک**
   * می‌نشیند و ردیف را خودِ فرم ذخیره می‌کند؛ هنگامِ تأیید، `syncLinkDocuments`
   * صدا را زیرِ مدرکِ همان لینک وصل می‌کند.
   */
  async attachVoice(
    token: string,
    fieldKey: string,
    file: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  ) {
    const row = await this.expireIfDue(token);
    if (!['pending_fill', 'pending_payment'].includes(row.status)) {
      throw new BadRequestException('این فرم دیگر قابلِ ویرایش نیست');
    }
    if (!row.patientId) throw new BadRequestException('این فرم پرونده‌ای ندارد');
    const form = await this.formView(row.formId, row.extraFormIds ?? []);
    const fld = form?.fields.find((x) => x.key === fieldKey && x.type === 'links');
    if (!fld) throw new BadRequestException('این کادر صدا نمی‌گیرد');
    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    if (file.size > MAX_RECEIPT_BYTES) throw new BadRequestException('حجمِ صدا بیش از ۸ مگابایت است — کوتاه‌تر ضبط کنید');
    if (storedMime(file) !== 'audio/wav') throw new BadRequestException('فقط صدای ضبط‌شده در همین صفحه پذیرفته می‌شود');

    const { sha256, size } = await this.storage.save(file.buffer);
    const doc = await this.prisma.document.create({
      data: {
        patientId: row.patientId,
        category: (fld as any).docCategory ?? 'other',
        title: `توضیحِ صوتی — ${fld.label}`.slice(0, 120),
        fileName: file.originalname?.slice(0, 200) || 'voice.wav',
        mimeType: 'audio/wav',
        sha256,
        size,
      },
    });
    return { id: doc.id, name: doc.fileName };
  }

  /**
   * برداشتنِ یک عکس از کادر — بیمار عکسِ اشتباه را باید بتواند بردارد،
   * وگرنه تنها راهش «همه را از نو» بود.
   *
   * ⚠️ خودِ `Document` پاک نمی‌شود، فقط ارجاعش از فرم برداشته می‌شود:
   * فایلِ آپلودشده سندِ پرونده است و حذفش کارِ ادمین است نه لینکِ عمومی.
   */
  async detachImage(token: string, fieldKey: string, docId: number) {
    await this.onFreshRow(async () => {
      const row = await this.expireIfDue(token);
      if (!['pending_fill', 'pending_payment'].includes(row.status)) {
        throw new BadRequestException('این فرم دیگر قابلِ ویرایش نیست');
      }
      const prev = (row.data as any)?.[fieldKey];
      const list = Array.isArray(prev) ? prev : (prev && typeof prev === 'object' && prev.id ? [prev] : []);
      const next = list.filter((x: any) => Number(x?.id) !== Number(docId));
      await this.updateSubmissionVersion(row, { data: { ...(row.data as any), [fieldKey]: next } });
    });
    return this.publicView(token);
  }

  /**
   * فیشِ واریزی — با آپلودِ فایل که کنترلر انجام داده و این‌جا فقط ثبت می‌شود.
   *
   * ⚠️ همین‌جا «ثبت‌نامِ کامل» می‌شود: تعریفِ محصول این است که فرم وقتی کامل
   * است که فیش رسیده باشد، نه وقتی فیلدها پر شده‌اند.
   */
  async attachReceipt(token: string, file: { originalname: string; mimetype: string; buffer: Buffer; size: number }) {
    const row = await this.expireIfDue(token);
    /* ⚠️ `pending_approval` هم پذیرفته می‌شود: بیمار که فیشِ اول را فرستاده،
       باید بتواند فیشِ دوم (قسطِ دوم، یا جایگزینِ عکسِ ناخوانا) را هم بگذارد.
       تا دیروز همان‌جا رد می‌شد با پیامِ بی‌ربطِ «اطلاعاتِ عمل را کامل کنید». */
    if (!['pending_payment', 'pending_approval'].includes(row.status)) {
      throw new BadRequestException('ابتدا اطلاعاتِ عمل را کامل کنید');
    }
    if (!row.patientId) throw new BadRequestException('این فرم پرونده‌ای ندارد');
    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    if (file.size > MAX_RECEIPT_BYTES) throw new BadRequestException('حجمِ فایل بیش از ۸ مگابایت است');
    /* ادعای کلاینت فقط **صافیِ اول** است — پیامِ خطای زودهنگام و مهربان
       می‌دهد؛ چیزی که ذخیره می‌شود از `storedMime` می‌آید، نه از این‌جا. */
    if (!RECEIPT_MIME.test(file.mimetype || '')) throw new BadRequestException('فقط عکس یا PDF بفرستید');

    const { sha256, size } = await this.storage.save(file.buffer);
    const doc = await this.prisma.document.create({
      data: {
        patientId: row.patientId,
        category: 'receipt',
        title: 'فیشِ واریزیِ ثبت‌نام',
        fileName: (file.originalname || 'receipt').slice(0, 200),
        mimeType: storedMime(file),
        size,
        sha256,
        // ⚠️ `uploadedById` خالی است و درست هم همین است: بیمار کاربرِ سامانه
        //    نیست. جعلِ یک شناسهٔ ادمین این‌جا یعنی دفترِ رسیدگی دروغ بگوید.
        uploadedById: null,
      },
    });
    /* ⚠️ `receiptDocumentId` (تکی) عمداً می‌ماند و **اولین** فیش است: همهٔ
       خواننده‌های موجود (تأیید، ساختِ مراجعه، پرونده) رویش بنا شده‌اند.
       فیش‌های بعدی در `receiptDocumentIds` جمع می‌شوند — بیمار که دو قسط
       واریز کرده یا عکسش ناخوانا بوده، باید بتواند دومی را هم بگذارد. */
    /* روی تازه‌ترین نسخه — همان دلیلِ `attachImage` (`onFreshRow`). */
    await this.onFreshRow(async () => {
      const cur = await this.expireIfDue(token);
      if (!['pending_payment', 'pending_approval'].includes(cur.status)) {
        throw new BadRequestException('ابتدا اطلاعاتِ عمل را کامل کنید');
      }
      const prevIds: number[] = Array.isArray((cur.data as any)?.receiptDocumentIds)
        ? (cur.data as any).receiptDocumentIds.map(Number).filter(Boolean)
        : ((cur.data as any)?.receiptDocumentId ? [Number((cur.data as any).receiptDocumentId)] : []);
      if (prevIds.length >= MAX_FIELD_IMAGES) {
        throw new BadRequestException(`حداکثر ${MAX_FIELD_IMAGES} فیش می‌شود گذاشت`);
      }
      const ids = [...prevIds, doc.id];
      const data = { ...(cur.data as any), receiptDocumentId: ids[0], receiptDocumentIds: ids };
      await this.prisma.$transaction(async (tx) => {
        const saved = await this.updateSubmissionVersion(cur, { data, status: 'pending_approval' }, tx);
        /* اولین فیش = حالا چیزی برای تأیید هست (همان رویدادی که `fill` برای فرمِ رایگان می‌زند). */
        if (cur.status !== 'pending_approval') {
          await this.events.emit({ type: 'intake.submitted', refType: 'intake_submission', refId: cur.id,
            patientId: saved.patientId, visitId: saved.visitId }, tx);
        }
      });
    });
    return this.publicView(token);
  }

  /** برداشتنِ یکی از فیش‌ها — تا وقتی فرم تأیید نشده. */
  async detachReceipt(token: string, docId: number) {
    await this.onFreshRow(async () => {
      const row = await this.expireIfDue(token);
      if (!['pending_payment', 'pending_approval'].includes(row.status)) {
        throw new BadRequestException('این فرم دیگر قابلِ ویرایش نیست');
      }
      const prevIds: number[] = Array.isArray((row.data as any)?.receiptDocumentIds)
        ? (row.data as any).receiptDocumentIds.map(Number).filter(Boolean)
        : ((row.data as any)?.receiptDocumentId ? [Number((row.data as any).receiptDocumentId)] : []);
      const ids = prevIds.filter((x) => x !== Number(docId));
      const data = { ...(row.data as any), receiptDocumentId: ids[0] ?? null, receiptDocumentIds: ids };
      /* آخرین فیش که برداشته شد، فرم به «در انتظارِ فیش» برمی‌گردد — وگرنه در
         صفِ تأیید می‌ماند بی‌آنکه چیزی برای تأیید باشد. */
      await this.updateSubmissionVersion(row, { data, status: ids.length ? row.status : 'pending_payment' });
    });
    return this.publicView(token);
  }

  /** A late public edit must never reopen an approval or overwrite a newer answer. */
  private async updateSubmissionVersion(row: { id: number; status: string; updatedAt: Date }, data: any, db: any = this.prisma) {
    try {
      return await db.intakeSubmission.update({ where: { id: row.id, status: row.status, updatedAt: row.updatedAt }, data });
    } catch (error: any) {
      if (error?.code !== 'P2025') throw error;
      /* ⚠️ با همان `db` خوانده می‌شود نه `this.prisma`: داخلِ تراکنشِ تعاملی، اتصالِ دوم روی
         استخرِ یک‌اتصالی (سنجهٔ W1.4 روی PGlite) تا پایانِ مهلت منتظر می‌ماند. P2025 خطای
         موتورِ Prisma است نه پایگاه، پس تراکنش هنوز قابلِ خواندن است؛ اگر نبود، ۴۰۹ِ عادی. */
      const now = await db.intakeSubmission.findUnique({ where: { id: row.id }, select: { status: true } }).catch(() => null);
      const Conflict = now?.status === row.status ? StaleSubmissionVersion : ConflictException;
      throw new Conflict('ثبت‌نام تغییر کرده است؛ صفحه را تازه کنید');
    }
  }

  /**
   * نوشتنِ خودِ بیمار روی ثبت‌نامش — از **تازه‌ترین** نسخه، با چند تلاش.
   *
   * ⚠️ باگِ میدانی (۱۴۰۵/۰۷/۰۴، فرمِ نورومانیتورینگ روی گوشی): آپلودِ کارتِ ملی و
   * دستورِ پزشک «ثبت‌نام تغییر کرده است؛ صفحه را تازه کنید» می‌گرفت. دکمهٔ «انتخابِ
   * عکس» فوکوس را از کادرِ قبلی می‌گیرد و ذخیرهٔ خودکار ۱٫۵ ثانیه بعد زمان‌بندی
   * می‌شود؛ اندروید تا پنجرهٔ انتخابِ عکس باز است صفحه را متوقف می‌کند، پس همان
   * ذخیره درست لحظهٔ برگشت — هم‌زمان با آپلود — می‌رود. هر دو یک نسخه را خوانده
   * بودند و قفلِ نسخه دومی را رد می‌کرد، در حالی که هیچ‌کدام به کلیدِ دیگری دست
   * نمی‌زد (پیش‌نویس کادرِ عکس را نمی‌نویسد). روی سرورِ محلی ۸ جفت از ۹ جفتِ
   * هم‌زمانِ «پیش‌نویس + آپلود» همین ۴۰۹ را می‌گرفتند (`intake-concurrency`).
   *
   * `run` باید همه‌چیز را از ردیفی بسازد که **خودش** می‌خواند (ادغامِ پیش‌نویس، افزودن
   * یا برداشتنِ یک ارجاع) تا تکرارش درست باشد. فقط برخوردِ بی‌تغییرِ وضعیت
   * (`StaleSubmissionVersion`) تکرار می‌شود؛ برخوردِ واقعی — تأیید، رد، برگشت، انقضا —
   * همان ۴۰۹ِ قبلی است، پس قفل همچنان نمی‌گذارد نوشتنِ دیرِ بیمار تأییدی را باز کند.
   */
  private async onFreshRow<T>(run: () => Promise<T>, tries = 6): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await run();
      } catch (error) {
        if (!(error instanceof StaleSubmissionVersion) || attempt >= tries) throw error;
        /* مکثِ کوتاه و نامنظم: بی‌آن نویسنده‌های هم‌زمان دوباره هم‌قدم می‌خوانند و دوباره برخورد
           می‌کنند (سنجه با پنج نویسندهٔ هم‌زمان گاهی چهار تلاش را تمام می‌کرد). */
        await new Promise((resolve) => setTimeout(resolve, attempt * 15 + Math.random() * 25));
      }
    }
  }

  /**
   * ارسالِ مستقیمِ فرم به بیمارِ مشخص — از روی کارتِ مراجعه.
   *
   * ⚠️ صفحهٔ اولِ ثبت‌نام (مشخصات + کپچا) عمداً حذف است: هویت از پرونده
   * می‌آید، پس دوباره پرسیدنش هم اصطکاک بود هم منبعِ مغایرت. `linkId` هم
   * ندارد — این ثبت‌نام از لینکِ عمومی نیامده.
   *
   * فقط فرمِ **زیرپرونده** (record): فرمِ مراجعه‌ساز جراح/تاریخ/مبلغ می‌خواهد
   * و مسیرِ درستش همان لینکِ عمومی است؛ این میان‌بر برای نظرسنجی و
   * پرسش‌نامه‌های پیگیری است.
   *
   * «ارسال» یعنی **پیامک به خودِ بیمار** — نه کپیِ لینک برای ادمین؛ شماره از
   * پرونده می‌آید و اگر نامعتبر باشد پیش از هر ساختی ۴۰۰ می‌گیرد، وگرنه
   * ثبت‌نامی کاشته می‌شد که هیچ‌کس خبرش را نداشت. کلیکِ دوباره روی همان فرم
   * = پیامکِ دوباره با همان توکنِ باز (یادآوری)، نه ردیفِ تازه.
   */
  async sendToPatient(patientId: number, formId: number, user: any) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, nationalId: true, phone: true, birthDate: true, address: true },
    });
    if (!patient) throw new NotFoundException('پرونده پیدا نشد');
    const form = await this.prisma.formDef.findFirst({ where: { id: formId, active: true } });
    if (!form) throw new NotFoundException('فرم پیدا نشد یا خاموش است');
    if (form.scope !== 'record') {
      throw new BadRequestException('فقط فرمِ زیرپرونده از این‌جا فرستاده می‌شود — فرمِ مراجعه‌ساز از لینکِ عمومی');
    }
    const to = toEnDigits(String(patient.phone ?? '')).replace(/[^0-9]/g, '');
    if (!/^09\d{9}$/.test(to)) {
      throw new BadRequestException('شمارهٔ موبایلِ معتبری در پرونده نیست — اول شماره را در پرونده اصلاح کنید');
    }

    /* ثبت‌نامِ بازِ همین فرم برای همین بیمار → همان ادامه پیدا کند، نه نسخهٔ
       دوم؛ وگرنه هر بار «ارسال» یک ردیفِ نیمه‌کارهٔ تازه می‌کاشت. */
    const open = await this.prisma.intakeSubmission.findFirst({
      where: { patientId, formId, linkId: null, status: { in: ['pending_fill', 'pending_payment'] } },
      orderBy: { id: 'desc' },
    });
    const row = open ?? await this.prisma.intakeSubmission.create({
      data: {
        token: this.token(),
        linkId: null,
        formId,
        patientId,
        amount: 0,
        status: 'pending_fill',
        data: {
          firstName: patient.firstName, lastName: patient.lastName,
          nationalId: patient.nationalId, phone: patient.phone,
          address: patient.address ?? null,
          birthDate: patient.birthDate ? patient.birthDate.toISOString() : null,
        },
        expiresAt: new Date(Date.now() + TTL_DAYS * 24 * 3600 * 1000),
      },
    });

    /* همان قالبِ `sendLinkSms`: عنوان + نشانی؛ ولی مستقیم به صفحهٔ فرم
       (`/f/`) چون صفحهٔ مشخصات (`/r/`) این‌جا وجود ندارد. */
    const host = this.tenant.require().hostname;
    const url = `https://${host}/f/${row.token}`;
    const smsCfg = await this.settings.sms();
    const noticeText = renderSms(smsCfg.formSendText, { title: form.title, link: url });
    const res = await this.sms.sendForStaff(to, noticeText);
    /* دفترِ اطلاع‌رسانیِ بیمار — پروندهٔ الکترونیک همهٔ پیام‌ها را نشان می‌دهد. */
    await this.prisma.reminder.create({
      data: {
        patientId, kind: 'notice', dueAt: new Date(), phone: to, text: noticeText,
        status: res.sent || res.stub ? 'sent' : 'failed', sentAt: new Date(),
      },
    }).catch(() => undefined);

    /* مثلِ `intake.link.sms`: مقصد در audit هست، متن نه. */
    await this.audit.record({
      actorId: user?.id, action: 'intake.send_form', entityType: 'intake_submission', entityId: row.id,
      after: { patientId, formId, formKey: form.key, to, sent: res.sent, stub: res.stub, reused: !!open },
    });
    return { token: row.token, reused: !!open, to, url, sent: res.sent, stub: res.stub };
  }

  /**
   * حذفِ لینکِ ثبت‌نام. ثبت‌نام‌های موجود می‌مانند (SetNull) — سابقهٔ پرشده
   * مالِ پرونده است، نه مالِ لینک؛ فقط دیگر ثبت‌نامِ تازه‌ای از این نشانی
   * ساخته نمی‌شود.
   */
  async deleteLink(id: number, user: any) {
    const row = await this.prisma.intakeLink.findUnique({
      where: { id },
      include: { _count: { select: { submissions: true } } },
    });
    if (!row) throw new NotFoundException('لینک پیدا نشد');
    await this.prisma.intakeLink.delete({ where: { id } });
    await this.audit.record({
      actorId: user?.id, action: 'intake.link.delete', entityType: 'intake_link', entityId: id,
      before: { title: row.title, token: row.token, submissions: row._count.submissions },
    });
    return { ok: true };
  }

  /**
   * حذفِ یک ثبت‌نام.
   *
   * ⚠️ تأییدشده‌ای که مراجعه ساخته حذف نمی‌شود — مراجعه و دفترِ مالی رویش
   * بنا شده‌اند؛ اول باید خودِ مراجعه تعیین‌تکلیف شود. نوبتِ نگه‌داشته آزاد
   * می‌شود، مثلِ reject.
   */
  async deleteSubmission(id: number, user: any) {
    const row = await this.prisma.intakeSubmission.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('ثبت‌نام پیدا نشد');
    if (row.status === 'approved' && row.visitId !== null) {
      throw new BadRequestException('این ثبت‌نام مراجعه ساخته — اول مراجعه را تعیین‌تکلیف کنید');
    }
    const heldAppts = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM intake_submissions WHERE id = ${id} FOR UPDATE`;
      const current = await tx.intakeSubmission.findUnique({ where: { id } });
      if (!current || current.status !== row.status || current.updatedAt.getTime() !== row.updatedAt.getTime()) {
        throw new ConflictException('ثبت‌نام تغییر کرده است؛ صفحه را تازه کنید');
      }
      const appointments = await tx.appointment.findMany({
        where: { submissionId: id, status: { in: ['held', 'confirmed'] } }, select: { id: true },
      });
      await tx.appointment.updateMany({ where: { submissionId: id, status: { in: ['held', 'confirmed'] } }, data: { status: 'cancelled' } });
      await tx.intakeSubmission.delete({ where: { id } });
      await this.audit.record({ actorId: user?.id, action: 'intake.submission.delete', entityType: 'intake_submission', entityId: id,
        before: { status: row.status, patientId: row.patientId, formId: row.formId } }, tx);
      return appointments;
    });
    for (const a of heldAppts) await this.reminders.syncAppointment(a.id);
    return { ok: true };
  }

  /**
   * تحلیلِ فرم‌های زیرپرونده (نظرسنجی/پرسش‌نامه) + کانالِ آشناییِ بیماران —
   * خوراکِ صفحهٔ CRM.
   *
   * همهٔ استخراج‌ها **سمتِ سرور** انجام می‌شود (قاعدهٔ ۱۵): کلاینت فقط
   * رسم می‌کند. توزیعِ گزینه‌ها از پاسخ‌های واقعیِ `data` درمی‌آید و برچسبِ
   * هر گزینه از `options`ِ خودِ فیلد — نه از حدسِ کلاینت.
   *
   * ⚠️ فقط ثبت‌نام‌های **پرشده** (pending_approval | approved) در توزیع‌ها
   * می‌نشینند: ردیفِ pending_fill هنوز پاسخی ندارد و شمردنش یعنی توزیعِ
   * آلوده به صفرهای ساختگی. ولی در شمارشِ کلی (total/statuses) همه هستند،
   * چون «چند نفر اصلاً باز نکردند» خودش یکی از پرسش‌های CRM است.
   */
  async analytics() {
    const forms = await this.prisma.formDef.findMany({
      where: { scope: 'record' },
      orderBy: { id: 'asc' },
      select: {
        id: true, title: true, color: true, active: true,
        fields: {
          where: { active: true, type: { in: ['select', 'multiselect', 'rating', 'bool', 'number', 'text', 'textarea'] } },
          orderBy: [{ page: 'asc' }, { sort: 'asc' }, { id: 'asc' }],
          select: { key: true, label: true, type: true, options: true },
        },
      },
    });

    const subs = forms.length
      ? await this.prisma.intakeSubmission.findMany({
          where: { formId: { in: forms.map((f) => f.id) } },
          orderBy: { id: 'desc' },
          select: {
            formId: true, status: true, data: true, createdAt: true, linkId: true,
            patient: { select: { code: true, firstName: true, lastName: true } },
          },
        })
      : [];
    const byForm = new Map<number, typeof subs>();
    for (const s of subs) {
      if (s.formId === null) continue;
      const list = byForm.get(s.formId) ?? [];
      if (!list.length) byForm.set(s.formId, list);
      list.push(s);
    }

    const formStats = forms.map((f) => {
      const rows = byForm.get(f.id) ?? [];
      const filled = rows.filter((r) => r.status === 'pending_approval' || r.status === 'approved');
      const statuses: Record<string, number> = {};
      for (const r of rows) statuses[r.status] = (statuses[r.status] ?? 0) + 1;

      const fields = f.fields.map((fd) => {
        const vals = filled
          .map((r) => (r.data as any)?.[fd.key])
          .filter((v) => v !== undefined && v !== null && v !== '');

        if (fd.type === 'select' || fd.type === 'multiselect' || fd.type === 'bool') {
          const counts: Record<string, number> = {};
          for (const v of vals) {
            for (const one of Array.isArray(v) ? v : [v]) {
              const k = String(one);
              counts[k] = (counts[k] ?? 0) + 1;
            }
          }
          const opts = Array.isArray(fd.options) ? (fd.options as any[]) : [];
          const labelOf = (v: string) =>
            fd.type === 'bool'
              ? (v === 'true' || v === '1' ? 'بله' : 'خیر')
              : (opts.find((o) => String(o?.v) === v)?.l ?? v);
          const dist = Object.entries(counts)
            .map(([value, count]) => ({ value, label: labelOf(value), count }))
            .sort((a, b) => b.count - a.count);
          return { key: fd.key, label: fd.label, type: fd.type, answered: vals.length, dist };
        }

        if (fd.type === 'rating' || fd.type === 'number') {
          const nums = vals.map(Number).filter((n) => Number.isFinite(n));
          const counts: Record<string, number> = {};
          for (const n of nums) counts[String(n)] = (counts[String(n)] ?? 0) + 1;
          const dist = Object.entries(counts)
            .map(([value, count]) => ({ value, label: value, count }))
            .sort((a, b) => Number(a.value) - Number(b.value));
          const avg = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null;
          return { key: fd.key, label: fd.label, type: fd.type, answered: nums.length, avg, dist };
        }

        /* text/textarea — خودِ متن‌ها، تازه‌ترین اول (rows از قبل نزولی است).
           سقفِ ۳۰: صفحهٔ تحلیل مرورِ کیفی است نه آرشیو؛ آرشیوِ کامل در صفِ
           ثبت‌نام‌ها هست. */
        const texts = filled
          .map((r) => ({ v: (r.data as any)?.[fd.key], r }))
          .filter((x) => typeof x.v === 'string' && x.v.trim() !== '');
        const answers = texts.slice(0, 30).map((x) => ({
          text: String(x.v).slice(0, 500),
          patient: x.r.patient ? `${x.r.patient.firstName} ${x.r.patient.lastName}` : null,
          code: x.r.patient?.code ?? null,
          at: x.r.createdAt,
        }));
        return { key: fd.key, label: fd.label, type: fd.type, answered: texts.length, answers };
      });

      return {
        id: f.id, title: f.title, color: f.color, active: f.active,
        total: rows.length,
        filled: filled.length,
        direct: rows.filter((r) => r.linkId === null).length,
        statuses,
        lastAt: rows[0]?.createdAt ?? null,
        fields,
      };
    });

    /* کانالِ آشنایی — روی **بیماران** نه ثبت‌نام‌ها: پرسشِ CRM «بیمارها از
       کجا می‌آیند» است و هر بیمار یک‌بار شمرده می‌شود، هرچند ده فرم پر کند. */
    const refRows = await this.prisma.patient.groupBy({
      by: ['referralSourceId'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    const refDefs = await this.prisma.referralSource.findMany({ select: { id: true, name: true } });
    const refName = new Map(refDefs.map((r) => [r.id, r.name] as const));
    const referrals = refRows
      .map((r) => ({
        id: r.referralSourceId,
        name: r.referralSourceId === null ? 'نامشخص' : (refName.get(r.referralSourceId) ?? '—'),
        count: r._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    /* روندِ ماه‌به‌ماهِ شمسی — ۱۲ ماهِ اخیر: حجمِ ثبت‌نام (همهٔ ارسال‌ها، هر
       فرمی) و میانگینِ رضایت (فیلدهای rating فرم‌های زیرپرونده، فقط پرشده‌ها).
       بازه‌بندی با هستهٔ کانونیِ `toJalali` است نه یک تقویمِ موازیِ دیگر. */
    const [cy, cm] = toJalali(new Date());
    const months: { jy: number; jm: number }[] = [];
    for (let i = 11; i >= 0; i -= 1) {
      let jy = cy;
      let jm = cm - i;
      while (jm < 1) { jm += 12; jy -= 1; }
      months.push({ jy, jm });
    }
    const rangeStart = jalaliMonthRange(months[0].jy, months[0].jm)[0];
    const rangeEnd = jalaliMonthRange(months[11].jy, months[11].jm)[1];
    const ratingKeys = new Map<number, string[]>();
    for (const f of forms) {
      const keys = f.fields.filter((fd) => fd.type === 'rating').map((fd) => fd.key);
      if (keys.length) ratingKeys.set(f.id, keys);
    }
    const trendSubs = await this.prisma.intakeSubmission.findMany({
      where: { createdAt: { gte: rangeStart, lt: rangeEnd } },
      select: { formId: true, status: true, createdAt: true, data: true },
    });
    const idxOf = new Map(months.map((m, i) => [`${m.jy}/${m.jm}`, i] as const));
    const buckets = months.map((m) => ({ jy: m.jy, jm: m.jm, total: 0, filled: 0, ratingSum: 0, ratingCount: 0 }));
    for (const s of trendSubs) {
      const [jy, jm] = toJalali(s.createdAt);
      const i = idxOf.get(`${jy}/${jm}`);
      if (i === undefined) continue;
      const b = buckets[i];
      b.total += 1;
      const isFilled = s.status === 'pending_approval' || s.status === 'approved';
      if (isFilled) b.filled += 1;
      const keys = s.formId !== null && isFilled ? ratingKeys.get(s.formId) : undefined;
      for (const k of keys ?? []) {
        const n = Number((s.data as any)?.[k]);
        if (Number.isFinite(n) && n > 0) { b.ratingSum += n; b.ratingCount += 1; }
      }
    }
    const trend = buckets.map(({ ratingSum, ratingCount, ...b }) => ({
      ...b,
      ratingCount,
      ratingAvg: ratingCount ? Math.round((ratingSum / ratingCount) * 100) / 100 : null,
    }));

    return {
      forms: formStats,
      referrals,
      patientsTotal: refRows.reduce((a, r) => a + r._count._all, 0),
      trend,
    };
  }

  /** ارجاع‌دهنده‌ها (جراح/بیمارستان) — آمارِ «تحلیلِ مشتریان» برای شرکت؛ منطق در `crm-referrers.ts` (company-25). */
  referrers() {
    return referrerStats(this.prisma);
  }

  /**
   * بیمارانِ «پیگیری‌نشده» — عملِ انجام‌شده‌ای که **موعدِ پیگیری‌اش رسیده** و
   * فرمِ همان موعد هنوز پر نشده.
   *
   * این فهرست کارِ امروزِ منشی است، نه آرشیو: فقط عمل‌های یک سالِ اخیر و با
   * سقفِ صریح. «پرشده» یعنی pending_approval | approved — فرمِ باز (pending_fill)
   * پیگیری نیست، فقط لینکی است که هنوز جواب نگرفته؛ جدا گزارش می‌شود تا منشی
   * بداند تماسِ یادآوری لازم است نه ارسالِ دوباره.
   *
   * ### W1.1 — چرا تطبیق با تاریخ غلط بود (D01)
   *
   * نسخهٔ قبلی پاسخ را با `patientId` و `createdAt >= opDate` به عمل می‌چسباند.
   * ولی ردیفِ فرمِ پیگیری هنگامِ **ثبتِ مراجعه** ساخته می‌شود
   * (`patients.service` → `reminders.syncVisit` → `followUpUrl`)، که برای هر
   * عملِ از‌پیش‌برنامه‌ریزی‌شده **پیش از** تاریخِ عمل است. پس پاسخِ کاملِ بیمار
   * هم `createdAt < opDate` داشت و عمل «پیگیری‌نشده» شمرده می‌شد — نه استثنا،
   * بلکه **حالتِ عادیِ** هر عملِ برنامه‌ریزی‌شده.
   *
   * کلیدِ دقیق از اول در همان JSON بود و فقط خوانده نمی‌شد:
   * `data.followUpVisitId` (کدام عمل) و `data.followUpDay` (کدام موعد).
   * چون `followUpUrl` به‌ازای **هر روزِ پیگیری یک ردیف** می‌سازد، گزارش حالا
   * می‌گوید کدام موعد جواب گرفته و کدام نه.
   *
   * سه چیزِ دیگر که از همین تغییر می‌آیند:
   *
   * - **موعدِ نرسیده «پیگیری‌نشده» نیست.** عملِ دیروز با پیگیریِ روزِ هفتم
   *   امروز کاری ندارد؛ قبلاً در همین فهرست می‌نشست و تماسِ بی‌مورد می‌ساخت.
   *   جدا شمرده می‌شود (`waiting`) تا از قلم هم نیفتد.
   * - **یک پاسخ، دو عمل.** تطبیق با `patientId` تنها یعنی پاسخِ عملِ الف،
   *   عملِ ب را هم «پیگیری‌شده» نشان می‌داد. حالا کلید دقیق است.
   * - **سقف دیده می‌شود.** `take` بی‌صدا بود و `checked` مثلِ «کلِ عمل‌ها»
   *   خوانده می‌شد؛ حالا `total` و `capped` هم می‌آیند.
   */
  async unfollowed() {
    const fuForms = await this.prisma.formDef.findMany({
      where: { scope: 'record', followUp: { in: ['general', 'procedure', 'diagnosis'] } },
      select: { id: true },
    });
    /* fail-soft (همان قرارِ نوبت‌دهی): نصبی که فرمِ پیگیری تعریف نکرده،
       فهرستِ «همه پیگیری‌نشده» نمی‌گیرد — می‌گوید قابلیت روشن نیست. */
    if (!fuForms.length) {
      return { enabled: false, checked: 0, total: 0, capped: false, limit: UNFOLLOWED_LIMIT, followed: 0, waiting: 0, rows: [] };
    }
    const fids = fuForms.map((f) => f.id);

    const now = new Date();
    const yearAgo = new Date(now.getTime() - 365 * 864e5);
    const scope = {
      kind: 'surgery',
      opStatus: 'done',
      opDate: { lt: now, gte: yearAgo },
      patient: { deletedAt: null },
    };
    const total = await this.prisma.visit.count({ where: scope });
    const visits = await this.prisma.visit.findMany({
      where: scope,
      orderBy: { opDate: 'desc' },
      take: UNFOLLOWED_LIMIT,
      select: {
        id: true, opDate: true, opType: true,
        procedureType: { select: { name: true } },
        /* بستهٔ ۷ج: «نوعِ عمل»ِ فهرست برچسبِ همهٔ عمل‌های جلسه است (اصلی اول)؛
           منشی باید بداند دربارهٔ کدام عمل‌ها تماس می‌گیرد. */
        otherProcedures: OTHER_PX,
        patient: { select: { id: true, code: true, firstName: true, lastName: true, phone: true } },
      },
    });
    const pids = [...new Set(visits.map((v) => v.patient.id))];
    const vids = visits.map((v) => v.id);
    const inWindow = new Set(vids);
    /* `data` لازم است چون کلیدِ تطبیق داخلِ همان JSON است و Prisma نمی‌تواند
       یک مسیرِ JSON را با فهرستی از شناسه‌ها فیلتر کند. دامنه بسته است
       (فرم‌های پیگیریِ حداکثر ۳۰۰ بیمار)، پس فیلترِ نهایی این‌جا انجام می‌شود. */
    const subs = pids.length
      ? await this.prisma.intakeSubmission.findMany({
          where: { patientId: { in: pids }, formId: { in: fids } },
          select: { patientId: true, status: true, createdAt: true, updatedAt: true, reviewedAt: true, data: true },
        })
      : [];
    const rems = vids.length
      ? await this.prisma.reminder.findMany({
          where: { visitId: { in: vids }, kind: 'follow_up' },
          select: { visitId: true, status: true },
        })
      : [];
    const remByVisit = new Map<number, string[]>();
    for (const r of rems) {
      const list = remByVisit.get(r.visitId!) ?? [];
      if (!list.length) remByVisit.set(r.visitId!, list);
      list.push(r.status);
    }

    type FollowSub = {
      patientId: number | null; status: string; day: number | null;
      createdAt: Date; answeredAt: Date | null;
    };
    const ANSWERED = new Set(['pending_approval', 'approved']);
    const byVisit = new Map<number, FollowSub[]>();
    const put = (vid: number, sub: FollowSub) => {
      const list = byVisit.get(vid);
      if (list) list.push(sub); else byVisit.set(vid, [sub]);
    };
    /* فرمی که ادمین دستی فرستاده کلیدِ مراجعه ندارد؛ پایین‌تر به نزدیک‌ترین
       عملِ پیش از خودش نسبت داده می‌شود. */
    const loose: FollowSub[] = [];
    for (const s of subs) {
      const d = (s.data ?? {}) as Record<string, unknown>;
      const vid = typeof d.followUpVisitId === 'number' ? d.followUpVisitId : null;
      const sub: FollowSub = {
        patientId: s.patientId,
        status: s.status,
        day: typeof d.followUpDay === 'number' ? d.followUpDay : null,
        createdAt: s.createdAt,
        /* «کِی جواب داد» — نه `createdAt`، چون آن لحظهٔ **ساختِ لینک** است و
           برای عملِ برنامه‌ریزی‌شده پیش از خودِ عمل می‌افتد. مسیرِ تأییدِ
           خودکارِ فرمِ زیرپرونده `reviewedAt` می‌گذارد؛ اگر هنوز تأیید نشده،
           آخرین نوشتن روی ردیف همان لحظهٔ پرکردن است. */
        answeredAt: ANSWERED.has(s.status) ? (s.reviewedAt ?? s.updatedAt) : null,
      };
      if (vid === null) loose.push(sub);
      else if (inWindow.has(vid)) put(vid, sub);
      /* vid که در پنجره نیست مالِ عملِ دیگری است — عمداً دور ریخته می‌شود. */
    }

    /* دور ریختنِ فرمِ دستی یعنی پیگیریِ واقعی دیده نشود، و چسباندنش به همهٔ
       عمل‌های بیمار همان باگِ «یک پاسخ، دو عمل» است. پس به **نزدیک‌ترین عملِ
       پیش از خودش** نسبت داده می‌شود — تنها عملی که آن پاسخ می‌تواند دربارهٔ
       آن باشد. `visits` بر پایهٔ `opDate` نزولی است، پس اولین تطبیق نزدیک‌ترین است. */
    if (loose.length) {
      const byPatient = new Map<number, typeof visits>();
      for (const v of visits) {
        const list = byPatient.get(v.patient.id);
        if (list) list.push(v); else byPatient.set(v.patient.id, [v]);
      }
      for (const sub of loose) {
        if (sub.patientId === null) continue;
        const host = (byPatient.get(sub.patientId) ?? []).find((v) => v.opDate! <= sub.createdAt);
        if (host) put(host.id, sub);
      }
    }

    let followed = 0;
    let waiting = 0;
    const rows: any[] = [];
    for (const v of visits) {
      const op = v.opDate!;
      const mine = (byVisit.get(v.id) ?? []).slice().sort((a, b) => (a.day ?? -1) - (b.day ?? -1));
      const days = mine.map((s) => ({
        day: s.day,
        answered: ANSWERED.has(s.status),
        answeredAt: s.answeredAt,
        /* فرمِ دستی موعد ندارد؛ «رسیده» فرض می‌شود چون همین حالا فرستاده شده. */
        due: s.day === null ? true : op.getTime() + s.day * 864e5 <= now.getTime(),
        open: s.status === 'pending_fill',
      }));
      const pending = days.filter((d) => d.due && !d.answered);

      /* هیچ ردیفی نیست: فرمِ پیگیری بعد از عمل تعریف شده، یا ساختِ لینک شکسته.
         این واقعاً «پیگیری‌نشده» است و باید دیده شود. */
      if (days.length && !pending.length) {
        if (days.some((d) => d.answered)) followed += 1;
        else waiting += 1;   // همهٔ موعدها هنوز نرسیده‌اند — امروز کاری ندارد
        continue;
      }

      const rs = remByVisit.get(v.id) ?? [];
      rows.push({
        visitId: v.id,
        patientId: v.patient.id,
        code: v.patient.code,
        name: `${v.patient.firstName} ${v.patient.lastName}`,
        phone: v.patient.phone,
        opDate: op,
        procedure: procedureLabel(v),
        daysSince: Math.floor((now.getTime() - op.getTime()) / 864e5),
        sms: rs.includes('sent') ? 'sent' : rs.includes('pending') ? 'pending' : 'none',
        openForm: days.some((d) => d.open),
        days,
        pendingDays: pending.map((d) => d.day).filter((d): d is number => d !== null),
        answeredDays: days.filter((d) => d.answered).map((d) => d.day).filter((d): d is number => d !== null),
      });
    }
    return {
      enabled: true,
      checked: visits.length,
      total,
      capped: total > visits.length,
      limit: UNFOLLOWED_LIMIT,
      followed,
      waiting,
      rows,
    };
  }

  // ── خروجیِ CSV ─────────────────────────────────────────────────────

  /** یک خانهٔ CSV — نقل‌قول‌گذاریِ امن. */
  private csvCell(v: unknown): string {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  /* BOM تا اکسل UTF-8 را فارسی بخواند — بدونش هر ستون «Ø¨ÛŒ» می‌شود. */
  private csvOf(rows: unknown[][]): string {
    return '\uFEFF' + rows.map((r) => r.map((c) => this.csvCell(c)).join(',')).join('\r\n') + '\r\n';
  }

  private jalaliStr(d: Date | null | undefined): string {
    if (!d) return '';
    const [jy, jm, jd] = toJalali(d);
    return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
  }

  /**
   * CSVِ پاسخ‌های پرشدهٔ یک فرمِ زیرپرونده — همان داده‌ای که صفحهٔ CRM
   * تحلیل می‌کند، سطربه‌سطر برای اکسل. برچسبِ گزینه‌ها از خودِ فیلد می‌آید
   * (نه مقدارِ خام) تا CSV همان چیزی باشد که ادمین در صفحه می‌بیند.
   */
  async analyticsCsv(formId: number) {
    const form = await this.prisma.formDef.findUnique({
      where: { id: formId },
      select: {
        id: true, key: true, scope: true,
        fields: {
          where: { active: true },
          orderBy: [{ page: 'asc' }, { sort: 'asc' }, { id: 'asc' }],
          select: { key: true, label: true, type: true, options: true },
        },
      },
    });
    if (!form || form.scope !== 'record') throw new NotFoundException('فرمِ زیرپرونده پیدا نشد');
    const subs = await this.prisma.intakeSubmission.findMany({
      where: { formId, status: { in: ['pending_approval', 'approved'] } },
      orderBy: { id: 'desc' },
      take: 2000,
      select: {
        status: true, createdAt: true, data: true,
        patient: { select: { code: true, firstName: true, lastName: true, phone: true } },
      },
    });
    const valOf = (fd: { type: string; options: unknown }, v: unknown): string => {
      if (v === undefined || v === null || v === '') return '';
      if (fd.type === 'bool') return v === true || v === 'true' || v === '1' ? 'بله' : 'خیر';
      const opts = Array.isArray(fd.options) ? (fd.options as any[]) : [];
      const label = (one: unknown) => opts.find((o) => String(o?.v) === String(one))?.l ?? String(one);
      if (Array.isArray(v)) return v.map(label).join('؛ ');
      if (fd.type === 'select' || fd.type === 'multiselect') return label(v);
      return String(v);
    };
    const head = ['کدِ پرونده', 'بیمار', 'تلفن', 'تاریخ', 'وضعیت', ...form.fields.map((f) => f.label)];
    const rows = subs.map((s) => [
      s.patient?.code ?? '',
      s.patient ? `${s.patient.firstName} ${s.patient.lastName}` : '',
      s.patient?.phone ?? '',
      this.jalaliStr(s.createdAt),
      s.status === 'approved' ? 'تأییدشده' : 'در انتظارِ تأیید',
      ...form.fields.map((fd) => valOf(fd, (s.data as any)?.[fd.key])),
    ]);
    return { filename: `crm-${form.key}.csv`, csv: this.csvOf([head, ...rows]) };
  }

  /** CSVِ فهرستِ پیگیری‌نشده‌ها — همان unfollowed()، برای اکسل. */
  async unfollowedCsv() {
    const u = await this.unfollowed();
    const smsFa: Record<string, string> = { sent: 'فرستاده‌شده', pending: 'در صف', none: 'نرفته' };
    /* W1.1: موعد هم می‌آید — «پیگیری‌نشده» بدونِ اینکه بگوید کدام موعد،
       به منشی نمی‌گوید دربارهٔ چه تماس بگیرد. «—» یعنی اصلاً ردیفی ساخته نشده. */
    const dayList = (v: number[]) => (v.length ? v.map((d) => `روزِ ${d}`).join(' · ') : '—');
    const head = ['کدِ پرونده', 'بیمار', 'تلفن', 'تاریخِ عمل', 'روزِ گذشته', 'نوعِ عمل',
      'موعدِ بی‌پاسخ', 'موعدِ پاسخ‌گرفته', 'پیامکِ پیگیری', 'فرمِ باز'];
    const rows = u.rows.map((r: any) => [
      r.code ?? '', r.name, r.phone ?? '', this.jalaliStr(r.opDate), r.daysSince,
      r.procedure ?? '', dayList(r.pendingDays ?? []), dayList(r.answeredDays ?? []),
      smsFa[r.sms] ?? r.sms, r.openForm ? 'بله' : 'خیر',
    ]);
    return { filename: 'crm-unfollowed.csv', csv: this.csvOf([head, ...rows]) };
  }

  // ── صفِ تأیید (ادمین) ─────────────────────────────────────────────
  async publicHospitals(token: string, q = '') {
    await this.expireIfDue(token);
    /* کادرِ جست‌وجوی بیمار: پیشوندِ واژه‌ها، نه شباهتِ نامِ کامل — شرحش در `hospitalTypeahead`. */
    return hospitalTypeahead(this.prisma, q);
  }

  /**
   * ارجاع‌های پیشنهادیِ یک ثبت‌نام: بیمارستان، **جراح**، **نوعِ عمل** (W3.8/U3).
   *
   * ⚠️ یک endpoint برای هر سه، نه سه تا: رابط هر سه را در یک لحظه می‌خواهد و
   * سه مسیرِ هم‌شکل یعنی سه جایی که آستانه‌شان می‌تواند واگرا شود.
   *
   * ⚠️ این فقط **پیشنهاد** است. اعمالش با کاربر است که مقدارِ پرشده را در فرم
   * می‌بیند — سرور جراح و نوعِ عمل را خودکار نمی‌چسباند (شرحش در `intake-match.ts`).
   */
  async approvalRefs(id: number) {
    const row = await this.prisma.intakeSubmission.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('ثبت‌نام پیدا نشد');
    return matchIntakeRefs(this.prisma, row.data);
  }

  /** شمارِ هر وضعیت (و `all`) برای زبانه‌های صف — یک `groupBy`، نه خواندنِ ردیف‌ها (company-19). */
  async counts() {
    const rows = await this.prisma.intakeSubmission.groupBy({ by: ['status'], _count: { _all: true } });
    const out: Record<string, number> = { all: 0 };
    for (const r of rows) { out[r.status] = r._count._all; out.all += r._count._all; }
    return out;
  }

  async list(status?: string) {
    const workflow = await this.forms.workflow();
    const profile = await this.forms.profile();
    const defaultKind = await this.forms.defaultVisitKind();
    const where = status && status !== 'all' ? { status } : {};
    const rows = await this.prisma.intakeSubmission.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 200,
      include: {
        link: { select: { title: true, bankAccountId: true } },
        patient: { select: { id: true, code: true, firstName: true, lastName: true, phone: true, nationalId: true, birthDate: true } },
        visit: { select: { id: true, seq: true } },
        /* فرمِ **همین ثبت‌نام** (عکسِ لحظه‌ای)، نه فرمِ فعلیِ لینک: پنلِ تأیید
           باید بگوید این ثبت‌نام چه می‌سازد، و آن از روی همان فرمی معلوم
           می‌شود که بیمار پر کرده. */
        form: { select: {
          title: true, scope: true, color: true, visitKind: true, key: true, service: true,
          /* کادرهای عکسِ فرم (کارت ملی، دستور پزشک…) — تا پاپ‌آپ بداند کدام مقدار مدرک است. */
          fields: { where: { type: 'image' }, orderBy: [{ page: 'asc' }, { sort: 'asc' }, { id: 'asc' }], select: { key: true, label: true } },
        } },
      },
    });
    /* ⚠️ مدارکِ همهٔ ردیف‌ها با **یک** کوئری: نام و نوعِ فایل لازم است (PDF با
       `<img>` باز نمی‌شود) و کوئری به‌ازای هر ردیف یعنی صفِ ۲۰۰تایی = ۲۰۰ رفت‌وبرگشت.
       مدرکِ پاک‌شده (`deletedAt`) — فیشی که بیمار خودش برداشته — نشان داده نمی‌شود. */
    const docRefs = rows.map((r) => ({ receipts: receiptIdsOf(r.data), images: imageRefsOf(r.data, r.form?.fields ?? []) }));
    const docIds = [...new Set(docRefs.flatMap((x) => [...x.receipts, ...x.images.map((i) => i.id)]))];
    const docs = docIds.length
      ? await this.prisma.document.findMany({ where: { id: { in: docIds }, deletedAt: null }, select: { id: true, fileName: true, mimeType: true } })
      : [];
    const docById = new Map(docs.map((x) => [x.id, x]));
    /* حسابی که بیمار روی فرم دید — پیش‌فرضِ «به کدام حساب واریز شده؟» در پاپ‌آپِ تأیید (company-19).
       همان قاعدهٔ `payTo`: حسابِ لینک اگر هنوز روی فرم است، وگرنه اگر فرم فقط یک حساب نشان می‌داد همان. */
    const onForm = (await this.prisma.bankAccount.findMany({ where: { active: true, showOnIntake: true }, select: { id: true } })).map((a) => a.id);
    const payToOf = (linkBank: number | null | undefined) => (linkBank && onForm.includes(linkBank) ? linkBank : onForm.length === 1 ? onForm[0] : null);
    const docView = (id: number) => {
      const x = docById.get(id)!;
      return { id, name: x.fileName, pdf: x.mimeType === 'application/pdf' };
    };
    return rows.map((r, i) => {
      /* ⚠️ **مشتق سمتِ سرور** (قانون ۱۵): «آیا تأییدِ این ثبت‌نام مراجعه
         می‌سازد؟» یک قاعدهٔ سرور است و اگر کلاینت خودش از `scope` استنتاجش
         می‌کرد، روزی رفتارِ واقعی و آنچه پنل وعده می‌دهد از هم جدا می‌شدند. */
      const makesVisit = (r.form?.scope ?? 'intake') !== 'record';
      /* ⚠️ خدمتِ **همین ردیف** (`intake-service-of.ts`) — شرکتِ دوخدمته هر دو
         نوع ثبت‌نام را در یک صف دارد و پاپ‌آپ باید بداند این یکی کدام است.
         فرمِ زیرپرونده مراجعه نمی‌سازد، پس خدمتی هم ندارد — وگرنه پاپ‌آپِ
         نظرسنجی انتخابگرِ خدمت و ستارهٔ جراح/بیمارستان می‌گرفت، در حالی که
         `approve()` هیچ‌کدام را برایش نمی‌خواهد.
         `workflow` فقط برای کلاینتِ کش‌شدهٔ قدیمی می‌ماند. */
      const svc = makesVisit ? serviceOf(r.form, profile) : null;
      return {
      workflow, approvalKind: r.form?.visitKind || defaultKind,
      /* نوعِ نصب از **همان پاسخی** که ردیف را آورده، نه از کانفیگِ کشِ رابط:
         پاپ‌آپ با همین تصمیم می‌گیرد جراح/بیمارستان را «الزامی» بنویسد، و اگر
         کانفیگِ کش‌شده عقب باشد، وعدهٔ پاپ‌آپ با قاعدهٔ `approve()` نمی‌خواند. */
      profileKind: profile.kind,
      service: svc?.service ?? null,
      serviceLabel: serviceLabel(svc?.service ?? null),
      serviceAmbiguous: svc?.ambiguous ?? false,
      id: r.id,
      token: r.token,
      status: r.status,
      statusLabel: INTAKE_LABELS[r.status] ?? r.status,
      // ⚠️ هر سه عدد، مثلِ نمای بیمار: بدونِ تخفیف، «قابلِ پرداخت»ِ صفحهٔ
      //    ادمین برابرِ مبلغِ کامل می‌شد و ادمین رقمی را تأیید می‌کرد که با
      //    فیشِ جلوی چشمش نمی‌خواند.
      amount: r.amount,
      discountCode: r.discountCode,
      discountAmount: r.discountAmount,
      payable: Math.max(0, r.amount - r.discountAmount),
      data: r.data,
      /* لینک nullable شد: ثبت‌نامِ مستقیم (از کارتِ مراجعه) لینک ندارد و
         لینکِ حذف‌شده هم SetNull می‌شود. */
      linkTitle: r.link?.title ?? null,
      payToAccountId: payToOf(r.link?.bankAccountId),
      direct: r.linkId === null,
      formTitle: r.form?.title ?? null,
      formColor: r.form?.color ?? null,
      makesVisit,
      /* مشتقِ سرور (قانون ۱۵): «این را ماشین تأیید کرده یا آدم؟» — UI با
         همین تصمیم می‌گیرد دکمهٔ «حذف از پرونده» را نشان بدهد و آزمون هم
         چیزی برای سنجیدنِ ادعای «امضا جعل نشد» دارد. */
      autoApproved: r.status === 'approved' && r.reviewedById === null && r.visitId === null,
      /* مدارکِ پاپ‌آپ (قانون ۱۵) — **همهٔ** فیش‌ها نه فقط اولی، و عکس‌های فرم با برچسبِ کادرشان. */
      receipts: docRefs[i].receipts.filter((id) => docById.has(id)).map(docView),
      documents: docRefs[i].images.filter((x) => docById.has(x.id)).map((x) => ({ ...docView(x.id), field: x.field, label: x.label })),
      patient: r.patient,
      visitId: r.visitId,
      visitCode: r.patient && r.visit ? `${r.patient.code}-V${r.visit.seq}` : null,
      reviewNote: r.reviewNote,
      /* برگشت‌های قبلی (مرحله و دلیل) — تأییدکننده ببیند این ثبت‌نام چند بار و چرا برگشته. */
      returns: returnsOf(r.data),
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      };
    });
  }

  /**
   * تأیید → مراجعه.
   *
   * ⚠️ مراجعه از **همان `createVisit`ِ موجود** ساخته می‌شود، نه با یک insertِ
   * جداگانه: تولیدِ `seq`، تطبیقِ پرونده و ثبتِ audit همه آن‌جا هستند و
   * مسیرِ دومِ ساختِ مراجعه یعنی روزی یکی‌شان یکی از این‌ها را جا می‌اندازد.
   *
   * ادمین می‌تواند فیلدها را هنگامِ تأیید اصلاح کند — چیزی که بیمار نوشته
   * **ادعا** است: «دکتر رضایی» باید به جراحِ تعریف‌شده گره بخورد.
   */
  async approve(
    id: number,
    dto: {
      idempotencyKey?: string;
      /// خدمتِ فرمِ دلخواه در شرکتِ دوخدمته (`intake-service-of.ts`).
      service?: string;
      surgeonId?: number; hospitalId?: number; techId?: number; procedureTypeId?: number;
      opDate?: string; opStartTime?: string; note?: string;
      /// ثبتِ پرداختِ همان فیش — پیش‌فرض روشن، ولی حسابِ مقصد را ادمین می‌گوید.
      registerPayment?: boolean; bankAccountId?: number; paidAmount?: number;
      requiredItems?: RequiredItemInput[];
      extra?: Record<string, any>;
    },
    user: any,
  ) {
    const row = await this.prisma.intakeSubmission.findUnique({ where: { id }, include: { patient: true } });
    if (!row) throw new NotFoundException('ثبت‌نام پیدا نشد');
    const key = dto.idempotencyKey?.trim() || `intake_approval:${id}`;
    if (key.length > 120) throw new BadRequestException('کلید تکرار درخواست بیش از حد طولانی است');
    const replay = (r: any) => {
      if (r.status !== 'approved' || !r.approvalResult) return null;
      if (dto.idempotencyKey && r.approvalKey !== key) throw new ConflictException('ثبت‌نام با درخواست دیگری تأیید شده است');
      return r.approvalResult;
    };
    const previous = replay(row);
    if (previous) return previous;
    if (row.status !== 'pending_approval') throw new BadRequestException('این ثبت‌نام در وضعیتِ انتظارِ تأیید نیست');
    if (!row.patientId) throw new BadRequestException('این ثبت‌نام پرونده‌ای ندارد');
    // Fail before costly preparation; the unique constraint still protects concurrent claims.
    const keyOwner = await this.prisma.intakeSubmission.findUnique({ where: { approvalKey: key }, select: { id: true } });
    if (keyOwner && keyOwner.id !== id) throw new ConflictException('این کلید برای ثبت‌نام دیگری استفاده شده است');

    const d = (row.data ?? {}) as any;

    /* ⚠️ **این‌جاست که `scope`ِ فرم بالاخره معنی پیدا می‌کند.**
       تا دیروز `approve` اصلاً فرم را نمی‌خواند و `kind` را هم نمی‌فرستاد، پس
       `createVisit` روی پیش‌فرضِ `'surgery'` می‌افتاد: **هر** ثبت‌نامِ
       تأییدشده یک «جراحی» می‌شد و با `visit.surgery` اعتبارسنجی می‌گشت — حتی
       وقتی لینک فرمِ «ویزیت» یا «پیگیری» داشت. بی‌هیچ خطایی؛ فقط نوعِ غلط در
       تقویم و گزارش. */
    const form = row.formId
      ? await this.prisma.formDef.findUnique({ where: { id: row.formId }, select: { scope: true, visitKind: true, key: true, service: true } })
      : null;
    const profile = await this.forms.profile();
    if (dto.service && !(profile.services as string[]).includes(dto.service)) {
      throw new BadRequestException('این شرکت چنین خدمتی ارائه نمی‌کند');
    }
    const svc = serviceOf(form, profile, dto.service);

    /* پاسخِ فیلدهای دلخواه باید به `Visit.extra` برسد، وگرنه چیزی که بیمار پر
       کرده در JSONِ ثبت‌نام دفن می‌شود و در پروندهٔ او پیدا نیست. کلیدهای
       ثابتِ خودِ ثبت‌نام کنار گذاشته می‌شوند: آن‌ها ستونِ واقعی دارند. */
    const RESERVED = new Set([
      'firstName', 'lastName', 'nationalId', 'phone', 'address', 'birthDate',
      'procedure', 'surgeonName', 'hospitalName', 'opDate', 'patientNotes', 'receiptDocumentId',
      /* نشانِ «رزرو بدون تاریخ» دادهٔ بالینی نیست — نبودنِ `opDate` روی مراجعه همان را می‌گوید. */
      UNDATED_KEY,
      /* ⚠️ «علت مراجعه»ی فرمِ ثبت‌نام حالا ستونِ `Visit.chiefComplaint` است و
         پایین به `createVisit` پاس می‌شود. اگر این‌جا نمی‌آمد، هم در `extra`
         می‌ماند هم در ستون می‌نشست — دو نسخه از یک داده. */
      'chiefComplaint',
    ]);
    const extra: Record<string, any> = {};
    /* کلیدِ `_`دار مالِ سیستم است نه پاسخِ بیمار (`_page`، تاریخچهٔ برگشت‌ها `_returns`) —
       هیچ فیلدِ فرمی با `_` شروع نمی‌شود (`KEY_RE`)، پس به `Visit.extra` هم نمی‌رود. */
    for (const [k, v] of Object.entries(d ?? {})) if (!RESERVED.has(k) && !k.startsWith('_')) extra[k] = v;

    /* فرمِ **زیرپرونده** مراجعه نمی‌سازد — به پروندهٔ بیمار می‌چسبد و همان‌جا
       می‌ماند. `visitId` خالی می‌ماند و دفترِ مالی هم دست نمی‌خورد (لینکِ چنین
       فرمی اصلاً نمی‌تواند مبلغ داشته باشد؛ `assertRecordFormHasNoAmount`). */
    const makesVisit = form?.scope !== 'record';
    if (!makesVisit && (row.amount > 0 || row.discountAmount > 0)) throw new BadRequestException('فرم زیرپرونده مبلغ ندارد');
    /* ⚠️ **تصمیمِ مالک (۱۴۰۵/۰۷/۰۱): در شرکت، جراح و بیمارستانِ تعریف‌شده برای هر
       دو خدمت الزامی است** (با افزودنِ سریع در پاپ‌آپ). تا دیروز فقط
       نورومانیتورینگ جراحِ تعریف‌شده می‌خواست و در ایمپلنت نامِ جراح و
       بیمارستانِ بیمار بی‌صدا از مراجعه می‌افتاد.
       و بیمارستانِ «پیشنهادی» (تطبیقِ فازی) دیگر خودکار چسبانده نمی‌شود: فقط
       انتخابِ خودِ بیمار از فهرست، تطبیقِ دقیق یا نامِ مستعار — «پیشنهاد، نه
       ادغام» (`name-match.ts`). در مطب رفتار همان است که بود. */
    const company = profile.kind === 'company';
    const service = makesVisit ? svc.service : null;
    const matchedHospital = dto.hospitalId ? null : await matchIntakeHospital(this.prisma, d);
    const autoHospital = matchedHospital && (!company || matchedHospital.source !== 'suggested') ? matchedHospital.id : undefined;
    const hospitalId = dto.hospitalId ?? autoHospital;
    if (makesVisit && company) {
      if (!hospitalId || !await this.prisma.hospital.findFirst({ where: { id: hospitalId, active: true }, select: { id: true } })) {
        throw new BadRequestException('بیمارستان را از تعاریفِ پایه انتخاب کنید یا همین‌جا اضافه کنید');
      }
    }
    const approvalKind = form?.visitKind || await this.forms.defaultVisitKind();
    if (makesVisit && dto.extra) {
      const target = await this.forms.forVisitKind(approvalKind);
      for (const field of target?.fields ?? []) {
        if (!field.builtin && field.active && Object.prototype.hasOwnProperty.call(dto.extra, field.key)) extra[field.key] = dto.extra[field.key];
      }
    }
    /* بستهٔ ۷ج: API تأیید تک‌عمل ماند — همین یک عمل اصلیِ مراجعه می‌شود.
       `procedureRequirements` آرایه هم می‌گیرد تا اجتماعِ کیتِ چندعملی (`mergeNeeds`)
       فقط یک پیاده‌سازی داشته باشد. */
    const requirements = service === 'implant'
      /* ⚠️ لحظهٔ تأیید لحظهٔ **نسخه** است: همین تعدادها «طبقِ نسخه» قفل می‌شوند (`visit-requirements.ts`). */
      ? dto.requiredItems !== undefined
        ? await resolveRequirements(this.prisma, dto.requiredItems, { prescribe: true })
        : await procedureRequirements(this.prisma, [dto.procedureTypeId], { prescribe: true })
      : undefined;
    if (service === 'implant' && !requirements?.length) throw new BadRequestException('اقلام و تعداد موردنیاز بیمار را بر اساس دستور جراح مشخص کنید');

    /* نوبتِ رزروشدهٔ همین ثبت‌نام — تاریخ و ساعتِ مراجعه از این‌جا می‌آید. */
    const held = await this.prisma.appointment.findUnique({ where: { submissionId: id } });

    const payable = Math.max(0, row.amount - row.discountAmount);
    const pay = dto.registerPayment !== false && payable > 0;
    const paidAmount = dto.paidAmount ?? payable;
    // خطای حساب یا دوره مالی باید پیش از ساخت مراجعه و تأیید رخ دهد.
    if (makesVisit && pay) await this.billing.assertIntakePayment({ amount: paidAmount, bankAccountId: dto.bankAccountId });

    const create = makesVisit
        ? await this.patients.prepareVisitCreation({
          patientId: row.patientId,
          amount: row.amount,
          /* ⚠️ نوبتِ بیمار **منبعِ تاریخ** است، نه یک یادداشتِ جانبی. اگر
             `opDate` از نوبت نمی‌آمد، مراجعه‌ای ساخته می‌شد که تاریخش با
             نوبتِ گرفته‌شده فرق دارد — و آن‌وقت تقویمِ مطب و برگهٔ بیمار دو
             چیزِ متفاوت می‌گفتند. اولویت با انتخابِ صریحِ ادمین است. */
          ...(held ? { topicId: held.topicId ?? undefined } : {}),
          // نوع صریح فرم مقدم است؛ لینک‌های قدیمی از پیش‌فرض حوزه استفاده می‌کنند.
          kind: approvalKind,
          surgeonId: dto.surgeonId,
          hospitalId,
          hospitalName: d.hospitalName ?? undefined,
          techId: dto.techId,
          procedureTypeId: dto.procedureTypeId,
          opType: dto.procedureTypeId ? undefined : (d.procedure ?? undefined),
          opDate: dto.opDate ?? held?.date?.toISOString() ?? (isUndated(d[UNDATED_KEY]) ? undefined : d.opDate) ?? undefined,
          /* «چرا آمده» را خودِ بیمار در ثبت‌نام نوشته — همان‌جا به ستون برود،
             وگرنه منشی باید دوباره بپرسدش. */
          chiefComplaint: typeof d.chiefComplaint === 'string' ? d.chiefComplaint : undefined,
          opStartTime: dto.opStartTime ?? (held?.startMin != null ? AvailabilityService.minToHHMM(held.startMin) : undefined),
          notes: d.patientNotes ?? undefined,
          /* خدمتِ همین ثبت‌نام روی خودِ مراجعه — تا پرتالِ جراح و گزارش‌ها دیگر از «ردیف دارد» حدس نزنند. */
          ...(service ? { service } : {}),
          ...(Object.keys(extra).length ? { extra } : {}),
        } as any, user, {
          requirements,
          intakeCompany: makesVisit && company
            ? { relaxRequired: service === 'ionm', undated: isUndated(d[UNDATED_KEY]) }
            : undefined,
        })
        : null;

    const snapshot = row.schemaSnapshot ?? await this.forms.schemaSnapshot(row.formId, row.extraFormIds);
    const fields = row.formId ? await this.prisma.formField.findMany({ where: { formId: row.formId } }) : [];
    const queueNotice = makesVisit ? await this.portal.prepareApprovalNotice() : null;
    let fresh = false;
    let committedVisitId: number | null = null;
    let appointmentId: number | null = null;
    let result: any;
    try {
      result = await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM intake_submissions WHERE id = ${id} FOR UPDATE`;
        const current = await tx.intakeSubmission.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('ثبت‌نام پیدا نشد');
        const cached = replay(current);
        if (cached) return cached;
        if (current.status !== 'pending_approval' || current.updatedAt.getTime() !== row.updatedAt.getTime()) {
          throw new ConflictException('اطلاعات ثبت‌نام تغییر کرده است؛ صفحه را تازه کنید');
        }
        const patient = await tx.patient.findFirst({ where: { id: row.patientId!, deletedAt: null }, select: { id: true } });
        if (!patient) throw new BadRequestException('پرونده فعال نیست');
        await tx.$queryRaw`SELECT id FROM appointments WHERE submission_id = ${id} FOR UPDATE`;
        const appointment = await tx.appointment.findUnique({ where: { submissionId: id } });
        if (!!appointment !== !!held || (appointment && held && (
          appointment.date.getTime() !== held.date.getTime() || appointment.startMin !== held.startMin || appointment.topicId !== held.topicId
        ))) throw new ConflictException('نوبت تغییر کرده است؛ صفحه را تازه کنید');
        if (appointment && (!['held', 'confirmed', 'arrived', 'done'].includes(appointment.status)
          || (appointment.patientId && appointment.patientId !== row.patientId))) throw new ConflictException('نوبت معتبر نیست یا لغو شده است');
        const targetId = appointment?.visitId ?? appointment?.forVisitId ?? current.visitId;
        const visit = create ? await create(tx, targetId ?? undefined) : null;
        if (visit && row.discountAmount > 0) await this.billing.addCharge(visit.id, {
          kind: 'discount', title: `کد تخفیف ${row.discountCode ?? ''}`.trim(), unitPrice: row.discountAmount,
        }, user, undefined, tx);
        if (visit) {
          const receipts = Array.isArray(d.receiptDocumentIds) ? d.receiptDocumentIds : [d.receiptDocumentId];
          const imageKeys = fields.filter(f => f.type === 'image').map(f => f.key);
          const images = [...new Set([...imageKeys, 'prescription'])].flatMap(k => Array.isArray(d[k]) ? d[k] : [d[k]]);
          const ids = [...receipts, ...images.map((p: any) => p?.id)].map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
          if (ids.length) await tx.document.updateMany({ where: { id: { in: ids }, patientId: row.patientId!, visitId: null }, data: { visitId: visit.id } });
          if (pay) await this.billing.addPayment(visit.id, { amount: paidAmount, method: 'transfer',
            bankAccountId: dto.bankAccountId, reference: `ثبت‌نام ${row.token.slice(0, 8)}` }, user, tx);
        } else {
          await this.commitAnswers(tx, { patientId: row.patientId, visitId: null, fields, data: d, actorId: user?.id ?? null });
        }
        if (appointment) {
          const status = appointment.status === 'held' ? 'confirmed' : appointment.status;
          await tx.appointment.update({ where: { id: appointment.id }, data: { status, patientId: row.patientId, visitId: visit?.id ?? null } });
          if (appointment.status === 'held') await this.events.emit({ type: 'appointment.confirmed', appointmentId: appointment.id,
            patientId: row.patientId, visitId: visit?.id ?? null, actorId: user?.id ?? null }, tx);
        }
        const response = visit ? { ok: true, visitId: visit.id, visitCode: visit.code }
          : { ok: true, madeVisit: false, patientId: row.patientId, patientCode: row.patient?.code ?? null };
        await tx.intakeSubmission.update({ where: { id }, data: { status: 'approved', schemaSnapshot: snapshot,
          visitId: visit?.id ?? null, reviewNote: text(dto.note, 300), reviewedById: user?.id ?? null,
          reviewedAt: new Date(), approvalKey: key, approvalResult: response } });
        await this.audit.record({ actorId: user?.id, action: visit ? 'intake.approve' : 'intake.approve.record',
          entityType: 'intake_submission', entityId: id,
          after: { visitId: visit?.id ?? null, charged: visit ? row.amount : 0, discount: row.discountAmount, paid: visit && pay ? paidAmount : 0 } }, tx);
        await this.events.emit({ type: 'intake.approved', refType: 'intake_submission', refId: id,
          patientId: row.patientId, visitId: visit?.id ?? null, actorId: user?.id ?? null }, tx);
        if (queueNotice && visit) await queueNotice(tx, row.patientId!, visit.id, id, user?.id ?? null);
        // Recovery is durable even if the process dies just after the approval commit.
        if (visit || appointment) await this.events.emit({ type: 'intake.approval_sync_pending', refType: 'intake_submission', refId: id,
          patientId: row.patientId, visitId: visit?.id ?? null, appointmentId: appointment?.id ?? null, actorId: user?.id ?? null }, tx);
        fresh = true; committedVisitId = visit?.id ?? null; appointmentId = appointment?.id ?? null;
        return response;
      }, { maxWait: 10000, timeout: 15000 });
    } catch (error: any) {
      if (error?.code === 'P2002') throw new ConflictException('این درخواست یا مراجعه قبلاً به یک ثبت‌نام دیگر متصل شده است');
      throw error;
    }
    if (fresh && (committedVisitId || appointmentId)) {
      try {
        if (committedVisitId) await this.patients.afterVisitCreation(committedVisitId, true);
        if (appointmentId) await this.reminders.syncAppointment(appointmentId, true);
        await this.events.emit({ type: 'intake.approval_synced', refType: 'intake_submission', refId: id,
          patientId: row.patientId, visitId: committedVisitId, actorId: user?.id ?? null });
      } catch {
        // Approval is complete; its pending outbox event exposes the remaining synchronization task.
      }
    }
    return result;
  }

  /** رد — با دلیل، چون بیمار همان را می‌بیند. */
  async reject(id: number, dto: { note?: string }, user: any) {
    const row = await this.prisma.intakeSubmission.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('ثبت‌نام پیدا نشد');
    /* ⚠️ تأییدشدهٔ **دستی** رد نمی‌شود — مراجعه/پرداخت رویش بنا شده و
       برگرداندنش یعنی دفترِ مالی و تقویم دروغ بگویند. ولی رکوردِ
       **خودکارتأییدشده** (فرمِ زیرپرونده‌ی رایگان: بدونِ امضای ادمین و بدونِ
       مراجعه) باید ردشدنی بماند، وگرنه auto-approve یعنی حذفِ دروازهٔ
       انسانی بدونِ هیچ ابزارِ جبرانی — نشانیِ عمومی است و یک ثبتِ آشغال
       برای همیشه در پروندهٔ بالینی می‌ماند (بازبینیِ خصمانه گرفتش). رد یعنی
       خروج از `attachedForms`؛ آن فهرست فقط approved را می‌خواند. */
    const autoApproved = row.status === 'approved' && row.reviewedById === null && row.visitId === null;
    if (row.status === 'approved' && !autoApproved) {
      throw new BadRequestException('ثبت‌نامِ تأییدشدهٔ دستی رد نمی‌شود');
    }
    const note = text(dto.note, 300);
    if (!note) throw new BadRequestException('دلیلِ رد را بنویسید — بیمار همین را می‌بیند');
    /* پیامکِ رد (مالک: «برگشت و رد هر دو پیامک دارند»، رد بی‌لینک) — ولی نه برای حذفِ یک
       پاسخِ خودکارتأییدشده از پرونده: آن تصمیمِ داخلیِ نگه‌داریِ پرونده است، نه پاسخ به بیمار. */
    const notice = autoApproved ? null : await this.preparePatientNotice();
    const rejectTemplate = autoApproved ? '' : await this.settings.textOr('sms_intake_reject_text', String(SETTING_BY_KEY.get('sms_intake_reject_text')?.default ?? ''));
    let sms: number | null = null;
    const rejAppts = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM intake_submissions WHERE id = ${id} FOR UPDATE`;
      const current = await tx.intakeSubmission.findUnique({ where: { id } });
      if (!current || (current.status === 'approved' && (current.reviewedById !== null || current.visitId !== null))) {
        throw new ConflictException('ثبت‌نام تأییدشده رد نمی‌شود');
      }
      const rejected = await tx.intakeSubmission.update({
        where: { id }, data: { status: 'rejected', reviewNote: note, reviewedById: user?.id ?? null, reviewedAt: new Date() },
      });
      await this.events.emit({ type: 'intake.rejected', refType: 'intake_submission', refId: id,
        patientId: rejected.patientId, visitId: rejected.visitId, actorId: user?.id ?? null }, tx);
      const appointments = await tx.appointment.findMany({
        where: { submissionId: id, status: { in: ['held', 'confirmed'] } },
      });
      await tx.appointment.updateMany({
        where: { submissionId: id, status: { in: ['held', 'confirmed'] } }, data: { status: 'cancelled' },
      });
      for (const a of appointments) await this.events.emit({ type: 'appointment.cancelled', appointmentId: a.id,
        patientId: a.patientId, visitId: a.visitId, actorId: user?.id ?? null }, tx);
      await this.audit.record({ actorId: user?.id, action: 'intake.reject', entityType: 'intake_submission', entityId: id, after: { note } }, tx);
      if (notice) {
        sms = await notice(tx, { patientId: current.patientId, dedupeKey: `intake_rejected:${id}`, actorId: user?.id ?? null, submissionId: id,
          template: rejectTemplate, vars: { reason: note } });
      }
      return appointments;
    });
    for (const a of rejAppts) await this.reminders.syncAppointment(a.id);
    return { ok: true, sms: notice ? (sms ? 'queued' : 'no_phone') : 'skipped' };
  }

  /**
   * برگرداندن برای اصلاح — **به یک مرحلهٔ مشخص**، با پیامک به بیمار (مالک، ۱۴۰۵/۰۷/۰۱).
   *
   * مرحله‌ها و اثرشان در `intake-return.ts`: «خدمت» و «مدارک» به فرم برمی‌گردند و فیش
   * سرِ جایش می‌ماند (با ثبتِ فرم مستقیم به صف برمی‌گردد)، «فیش» به واریز، «همه» به فرم با
   * فیشِ کنارگذاشته. فایلِ مرحلهٔ برگشت‌خورده کنار گذاشته می‌شود، پاک نه.
   *
   * ⚠️ نوبتِ نگه‌داشته **لغو نمی‌شود**: اصلاحِ یک عکس دلیلِ ازدست‌دادنِ روزِ عمل نیست.
   * ⚠️ پیامک در **همان تراکنش** در صفِ پیام‌ها می‌نشیند (مثلِ پیامکِ تأیید) تا دفترِ
   * پیام‌ها ببیندش و ارسالِ ناموفق دوباره تلاش شود؛ نبودِ شمارهٔ معتبر برگشت را نمی‌بندد.
   */
  async returnForFix(id: number, dto: { note?: string; stage?: string }, user: any) {
    const row = await this.prisma.intakeSubmission.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('ثبت‌نام پیدا نشد');
    if (row.status !== 'pending_approval') throw new BadRequestException('فقط ثبت‌نامِ در انتظارِ تأیید برمی‌گردد');
    if (!isReturnStage(dto.stage)) throw new BadRequestException('مرحله‌ای را که بیمار باید اصلاح کند انتخاب کنید');
    const note = text(dto.note, 300);
    if (!note) throw new BadRequestException('بنویسید چه چیزی باید اصلاح شود — بیمار همین را می‌بیند');
    const stage = dto.stage;
    const formIds = [row.formId, ...(row.extraFormIds ?? [])].filter((x): x is number => !!x);
    const imageKeys = formIds.length
      ? (await this.prisma.formField.findMany({ where: { formId: { in: formIds }, type: 'image' }, select: { key: true } })).map((f) => f.key)
      : [];
    const { data, status } = applyReturn(row.data, stage, imageKeys, { note, at: new Date().toISOString(), by: user?.id ?? null });
    const n = returnsOf(data).length;
    const notice = await this.preparePatientNotice();
    const sms = await this.prisma.$transaction(async (tx) => {
      const saved = await this.updateSubmissionVersion(row, {
        status, data, reviewNote: note, reviewedById: user?.id ?? null, reviewedAt: new Date(),
      }, tx);
      /* کارِ «بررسی و تأیید» بسته می‌شود — حالا منتظرِ بیمار است؛ ارسالِ دوباره بازش می‌کند. */
      await this.events.emit({ type: 'intake.returned', refType: 'intake_submission', refId: id,
        patientId: saved.patientId, visitId: saved.visitId, actorId: user?.id ?? null, payload: { stage } }, tx);
      await this.audit.record({ actorId: user?.id, action: 'intake.return', entityType: 'intake_submission', entityId: id, after: { note, stage } }, tx);
      return notice(tx, {
        patientId: row.patientId, dedupeKey: `intake_returned:${id}:${n}`, actorId: user?.id ?? null, submissionId: id,
        template: await this.settings.textOr('sms_intake_return_text', String(SETTING_BY_KEY.get('sms_intake_return_text')?.default ?? '')),
        vars: { reason: note, stage: RETURN_STAGES[stage].label, link: this.publicFormLink(row.token) },
      });
    });
    return { ok: true, status, stage, sms: sms ? 'queued' : 'no_phone' };
  }

  /** نشانیِ فرمِ بیمار روی دامنهٔ **همین** شرکت (همان مبنای لینکِ ثبت‌نام). */
  private publicFormLink(token: string) {
    return `https://${this.tenant.require().hostname}/f/${token}`;
  }

  /**
   * پیامکِ بیمار در **صفِ پیام‌ها** (`reminder`، نوعِ `notice`) — داخلِ تراکنشِ فراخوان.
   *
   * همان الگوی پیامکِ تأیید (`portal.prepareApprovalNotice`): برند و قالب پیش از تراکنش
   * خوانده می‌شوند، ردیف با `dedupeKey` یکتاست (تکرارِ درخواست پیامکِ دوم نمی‌سازد)، و
   * شمارهٔ نامعتبر یعنی «پیامکی نرفت» نه خطا — برگشت و رد نباید به‌خاطرِ شماره گیر کنند.
   */
  private async preparePatientNotice() {
    const brand = await this.settings.brand();
    return async (tx: any, o: {
      patientId: number | null; dedupeKey: string; template: string; vars: Record<string, string>;
      actorId: number | null; submissionId: number;
    }) => {
      if (!o.patientId) return null;
      const patient = await tx.patient.findFirst({ where: { id: o.patientId, deletedAt: null }, select: { phone: true } });
      const phone = toEnDigits(String(patient?.phone ?? '')).replace(/[^0-9]/g, '');
      if (!/^09\d{9}$/.test(phone)) return null;
      const body = `${brand.name ? brand.name + '\n' : ''}${renderSms(o.template, o.vars)}`;
      const reminder = await tx.reminder.upsert({ where: { dedupeKey: o.dedupeKey }, update: {}, create: {
        patientId: o.patientId, kind: 'notice', dueAt: new Date(), phone, text: body, status: 'pending', dedupeKey: o.dedupeKey,
      } });
      await this.audit.record({ actorId: o.actorId, action: 'intake.sms_queued', entityType: 'intake_submission', entityId: o.submissionId,
        after: { reminderId: reminder.id, dedupeKey: o.dedupeKey } }, tx);
      return reminder.id as number;
    };
  }

  // ── کدِ تخفیف ─────────────────────────────────────────────────────
  /**
   * اعمالِ کدِ تخفیف روی یک ثبت‌نام.
   *
   * ⚠️ **مبلغ روی سرور حساب می‌شود و مبلغِ کسرشده ذخیره می‌شود، نه دوباره
   * محاسبه.** اگر فردا درصدِ کد عوض شود، تخفیفِ این بیمار نباید عوض شود —
   * و اگر کلاینت مبلغ را می‌فرستاد، هر کسی می‌توانست صفر بپردازد.
   *
   * ⚠️ شمارندهٔ مصرف فقط وقتی بالا می‌رود که کد **تازه** روی این فرم بنشیند؛
   * زدنِ دوبارهٔ همان کد سهمِ استفاده را نمی‌سوزاند.
   */
  async applyDiscount(token: string, rawCode: string) {
    /* همان برخوردِ `onFreshRow`؛ این‌جا بدترش بود: `update`ِ خام بی‌پوشش بود و برخورد
       به‌جای ۴۰۹ یک ۵۰۰ می‌ساخت. شمارندهٔ کد در همان تراکنش است، پس تکرار دوبار نمی‌شمرد. */
    return this.onFreshRow(() => this.applyDiscountOnce(token, rawCode));
  }

  private async applyDiscountOnce(token: string, rawCode: string) {
    const row = await this.expireIfDue(token);
    if (!['pending_fill', 'pending_payment'].includes(row.status)) {
      throw new BadRequestException('این فرم دیگر قابلِ ویرایش نیست');
    }
    const code = (text(rawCode, 40) ?? '').toUpperCase();
    if (!code) throw new BadRequestException('کد را وارد کنید');
    if (row.discountCode === code) return this.publicView(token);

    const dc = await this.prisma.discountCode.findFirst({
      where: { code: { equals: code, mode: 'insensitive' } },
    });
    if (!dc || !dc.active) throw new BadRequestException('این کد معتبر نیست');
    if (dc.expiresAt && dc.expiresAt.getTime() < Date.now()) throw new BadRequestException('این کد منقضی شده است');
    if (dc.maxUses > 0 && dc.usedCount >= dc.maxUses) throw new BadRequestException('ظرفیتِ این کد تمام شده است');
    if (dc.minAmount > 0 && row.amount < dc.minAmount) {
      throw new BadRequestException(`این کد برای مبلغ‌های بالای ${dc.minAmount.toLocaleString('fa-IR')} تومان است`);
    }

    let off = dc.kind === 'percent'
      ? Math.round((row.amount * Math.max(1, Math.min(100, dc.value))) / 100)
      : dc.value;
    if (dc.kind === 'percent' && dc.maxAmount > 0) off = Math.min(off, dc.maxAmount);
    // تخفیف هرگز از خودِ مبلغ بیشتر نمی‌شود — مبلغِ منفی یعنی ما بدهکار شویم.
    off = Math.max(0, Math.min(off, row.amount));

    await this.prisma.$transaction(async (tx) => {
      await this.updateSubmissionVersion(row, { discountCode: dc.code, discountAmount: off }, tx);
      await tx.discountCode.update({ where: { id: dc.id }, data: { usedCount: { increment: 1 } } });
    });
    return this.publicView(token);
  }

  async listCodes() {
    const rows = await this.prisma.discountCode.findMany({ orderBy: { id: 'desc' } });
    return rows.map((r) => ({
      ...r,
      kindLabel: r.kind === 'percent' ? 'درصدی' : 'مبلغِ ثابت',
      remaining: r.maxUses > 0 ? Math.max(0, r.maxUses - r.usedCount) : null,
    }));
  }

  async createCode(dto: { code: string; kind?: string; value: number; maxAmount?: number; minAmount?: number; maxUses?: number; expiresAt?: string; note?: string }, user: any) {
    const code = (text(dto.code, 40) ?? '').toUpperCase();
    if (code.length < 3) throw new BadRequestException('کد را کامل وارد کنید');
    const kind = dto.kind === 'fixed' ? 'fixed' : 'percent';
    const value = Number(dto.value) || 0;
    if (kind === 'percent' && (value < 1 || value > 100)) throw new BadRequestException('درصد باید بینِ ۱ تا ۱۰۰ باشد');
    if (kind === 'fixed' && value < 1) throw new BadRequestException('مبلغِ تخفیف را وارد کنید');
    const dup = await this.prisma.discountCode.findFirst({ where: { code: { equals: code, mode: 'insensitive' } } });
    if (dup) throw new BadRequestException('این کد قبلاً ساخته شده است');

    const row = await this.prisma.discountCode.create({
      data: {
        code, kind, value,
        maxAmount: Math.max(0, Number(dto.maxAmount) || 0),
        minAmount: Math.max(0, Number(dto.minAmount) || 0),
        maxUses: Math.max(0, Number(dto.maxUses) || 0),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        note: text(dto.note, 200),
      },
    });
    await this.audit.record({ actorId: user?.id, action: 'discount.create', entityType: 'discount_code', entityId: row.id, after: row });
    return row;
  }

  async patchCode(id: number, dto: { active?: boolean; note?: string }, user: any) {
    const row = await this.prisma.discountCode.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('کد پیدا نشد');
    const next = await this.prisma.discountCode.update({
      where: { id },
      data: {
        ...(dto.active !== undefined ? { active: !!dto.active } : {}),
        ...(dto.note !== undefined ? { note: text(dto.note, 200) } : {}),
      },
    });
    await this.audit.record({ actorId: user?.id, action: 'discount.update', entityType: 'discount_code', entityId: id, before: row, after: next });
    return next;
  }

  /**
   * انقضا در لحظهٔ خواندن.
   *
   * ⚠️ کارِ زمان‌بندی‌شده لازم نیست و **نداشتنش عمدی است**: تنها جایی که
   * «منقضی» اهمیت دارد همان لحظه‌ای است که کسی سراغش می‌آید. cronِ جدا یعنی
   * یک مسیرِ دومِ تغییرِ وضعیت که در محیطِ بدونِ cron بی‌صدا کار نمی‌کند.
   */
  private async expireIfDue(token: string) {
    const row = await this.prisma.intakeSubmission.findUnique({ where: { token } });
    if (!row) throw new NotFoundException('این فرم معتبر نیست');
    const open = ['pending_fill', 'pending_payment'].includes(row.status);
    if (open && row.expiresAt.getTime() < Date.now()) {
      /* ثبت‌نامِ منقضی نوبتش را هم پس می‌دهد — همان دلیلِ ردکردن: جای سوخته
         در تقویم که کسی نمی‌تواند بگیرد و کسی هم نمی‌داند چرا. */
      const expired = await this.prisma.$transaction(async tx => {
        const saved = await this.updateSubmissionVersion(row, { status: 'expired' }, tx);
        const appointments = await tx.appointment.findMany({ where: { submissionId: row.id, status: 'held' }, select: { id: true } });
        await tx.appointment.updateMany({ where: { submissionId: row.id, status: 'held' }, data: { status: 'cancelled' } });
        return { saved, appointments };
      });
      for (const a of expired.appointments) await this.reminders.syncAppointment(a.id);
      return expired.saved;
    }
    return row;
  }
}
