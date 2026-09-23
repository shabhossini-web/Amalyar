import { JOB_ROLE_KEYS, jobRoleLabel, fieldRoles } from '../common/job-roles';
import { CODING_TWIN_KEYS } from './visit-coding';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { BUILTIN_VISIT_KEYS, CLINIC_CORE, CLINIC_MEDIA_FIELDS, POSTOP_FOLLOWUP, PRESETS, REGISTRATION_PRESETS, REGISTRATION_V2, PresetForm, UNDATED_KEY, VISIT_BUILTIN_CATALOG, VISIT_CATALOG_KEYS, coreFamily, isCoreKey, isUndated } from './form-presets';
import { FORM_TYPES } from './form-types';
import { DOCUMENT_CATEGORIES } from './document-categories';

/**
 * موتورِ فرم — «چه چیزی پرسیده می‌شود» و «چه چیزی اجباری است».
 *
 * ⚠️ **تک‌منبعِ اجباری‌بودن.** ستاره‌ی کنارِ برچسب در مرورگر و خطای ۴۰۰ روی
 * سرور هر دو از یک ستون می‌آیند (`FormField.required`). تا دیروز اجباری‌بودن در
 * دو جای مستقل نوشته می‌شد — `personErrors` در کلاینت و دکوراتورهای
 * class-validator در DTO — و نتیجه‌اش فرم‌هایی بود که ستاره داشتند ولی سرور
 * قبولشان می‌کرد، یا برعکس: بی‌ستاره بودند و ۴۰۰ می‌گرفتند.
 *
 * ⚠️ **اعتبارسنجی این‌جاست، نه در DTO.** class-validator دکوراتورش را در
 * زمانِ کامپایل می‌خواهد، ولی فهرستِ فیلدهای اجباری را کاربر در زمانِ اجرا
 * عوض می‌کند. پس DTO فقط شکلِ خام را می‌پذیرد و قاعده‌ی واقعی این‌جا اعمال
 * می‌شود — جایی که تعریفِ فرم در دسترس است.
 */

/* `links` = فهرستِ لینک‌های MRI/CT/آزمایش با نامِ کاربری/رمزِ اختیاری (`normalizeLinks`).
   ⚠️ داخلِ خودِ آرایه کامنت نگذارید: نگهبانِ CI آرایه را با split(',') می‌خواند. */
export const FIELD_TYPES = [
  'text', 'textarea', 'number', 'money', 'select', 'multiselect',
  'date', 'time', 'bool', 'phone', 'rating', 'image', 'payment', 'links',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * نوع‌هایی که **مقدارشان در `data` نمی‌نشیند** — پس اجباری‌بودن رویشان معنی
 * ندارد.
 *
 * ⚠️ فقط `payment`: شماره‌های حساب از `IntakeLink.bankAccountId` خوانده
 * می‌شوند و فیش و کدِ تخفیف endpointِ خودشان را دارند
 * (`intake.controller.ts:131,136`). بدونِ این استثنا، یک باکسِ پرداختِ
 * ستاره‌دار فرمی می‌ساخت که هیچ‌وقت ذخیره نمی‌شد: `validate()` دنبالِ
 * `values['pay']` می‌گشت و کاربر خطای «پرداخت را کامل کنید» می‌دید که هیچ
 * کادری برای پرکردن نداشت.
 *
 * ⚠️ `image` این‌جا **نیست** و عمدی است: مقدارش یک **ارجاع** است
 * (`{ id, url, name }`)، نه بایت‌های فایل. پس ستاره‌ی رویش معنیِ روشنی دارد —
 * «تا عکسی پیوست نشده، فرم ذخیره نمی‌شود».
 */
const VALUELESS_TYPES = new Set<string>(['payment']);

/**
 * محدودهٔ فرم — یعنی **پرشدنش چه می‌سازد**.
 *
 * ⚠️ `survey` عمداً نیست: به `record` مهاجرت کرد چون «نظرسنجی» یک مصداق است
 * نه یک محدوده. `normScope` مقدارِ قدیمی را می‌پذیرد تا نصبی که هنوز مهاجرت
 * نکرده ۴۰۰ نگیرد.
 */
export const FORM_SCOPES = ['visit', 'record', 'intake'] as const;
export const VISIT_KINDS = ['clinic', 'surgery', 'followup', 'consult'] as const;

/**
 * پالتِ رنگِ کارتِ فرم — **باید با `src/lib/formColor.js` یکی بماند**.
 *
 * ⚠️ توکن ذخیره می‌شود نه هگز: رنگِ برندِ هر نصب و تمِ روشن/تاریک فرق می‌کنند.
 */
export const FORM_COLORS = [
  'violet', 'teal', 'amber', 'rose', 'sky', 'lime', 'fuchsia', 'slate',
] as const;

/** کلیدِ ماشینیِ سالم: حروفِ لاتین، رقم، و `_`. با حرف شروع شود. */
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

/** بیشترین صفحه‌ای که پذیرفته می‌شود — سدِ عددِ نجومی، نه یک قاعدهٔ کاری. */
const MAX_PAGE = 20;

/**
 * `survey`ِ قدیمی → `record`. مقدارِ ناشناخته رد می‌شود.
 *
 * ⚠️ پذیرفتنِ `survey` تا ابد نمی‌ماند ولی حذفش هم امروز نیست: کلاینتِ کهنه‌ای
 * که هنوز از کش بارگذاری شده همان مقدار را می‌فرستد، و ۴۰۰ گرفتن به‌خاطرِ یک
 * تغییرِ نام‌گذاری، کاربری که کارش را می‌کرد متوقف می‌کند.
 */
function normScope(v: any): string | null {
  const s = String(v ?? 'visit').trim();
  if (s === 'survey') return 'record';
  return (FORM_SCOPES as readonly string[]).includes(s) ? s : null;
}

/** توکنِ معتبر یا `null` («خودکار»). هگز و توکنِ ناشناخته → `null`. */
function normColor(v: any): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  return (FORM_COLORS as readonly string[]).includes(s) ? s : null;
}

/** صفحهٔ سالم: عددِ صحیحِ ۱ تا `MAX_PAGE`. هر چیزِ دیگری → صفحهٔ ۱. */
/** نقش ناشناخته رد می‌شود؛ فقط مجموعه خالی به معنی عمومی است. */
function normRoles(dto: any): { role: string | null; roles: string[] } {
  const input = dto.roles !== undefined ? dto.roles : dto.role ? [dto.role] : [];
  if (!Array.isArray(input) || input.some((r) => !JOB_ROLE_KEYS.includes(r))) {
    throw new BadRequestException('نقش نامعتبر است');
  }
  const roles = [...new Set<string>(input)];
  return { roles, role: roles[0] ?? null };
}

function normPage(v: any): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_PAGE);
}

/**
 * رنگِ پشتیبان از روی کلید — **باید با `colorForKey` در `src/lib/formColor.js`
 * یکی باشد**، وگرنه سرور و مرورگر دو رنگِ متفاوت برای یک فرم نشان می‌دهند.
 *
 * ⚠️ hashِ پایدار و نه ایندکسِ فهرست: اگر رنگ از ترتیبِ فرم‌ها می‌آمد، ساختنِ
 * یک فرمِ تازه رنگِ همهٔ کارت‌های قبلی را عوض می‌کرد.
 */
export function colorForKey(key: string): string {
  let h = 0;
  const s = String(key ?? '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return FORM_COLORS[h % FORM_COLORS.length];
}

/**
 * رنگِ **آزاد** برای یک فرم: از رنگِ مشتق شروع می‌کند و در پالت جلو می‌رود تا
 * اولین رنگی که کسی برنداشته.
 *
 * ⚠️ چرا `colorForKey` به‌تنهایی کافی نیست: hash تصادم دارد، و تصادمِ رنگ
 * این‌جا یعنی دو نوعِ مراجعه در داشبورد **دقیقاً یک‌شکل** دیده شوند — همان
 * تفکیکی که کاربر خواسته بود، بی‌سروصدا از بین می‌رفت. با ۸ رنگ و ۵ فرمِ
 * قالبِ مطب، احتمالِ دستِ‌کم یک تصادم از ۷۰٪ می‌گذشت. در آزمونِ مرورگر
 * دیدمش: «فرمِ عمل» و «پیگیری» هر دو کهربایی، بدونِ هیچ خطایی.
 *
 * ⚠️ hash به‌عنوانِ **نقطهٔ شروع** می‌ماند نه ایندکسِ فهرست، و نتیجه در ستون
 * ذخیره می‌شود. پس ساختنِ فرمِ بعدی رنگِ فرم‌های قبلی را عوض نمی‌کند؛ اگر
 * رنگ در زمانِ نمایش حساب می‌شد، هر فرمِ تازه کلِ داشبورد را دوباره
 * رنگ‌آمیزی می‌کرد و کاربر فکر می‌کرد سامانه قاطی کرده.
 *
 * ⚠️ `taken` را فراخوان **به‌ازای هر محدوده** می‌سازد، نه از کلِ جدول. نسخهٔ
 * سراسری را نوشتم و آزمون ردش کرد: فرم‌های `intake` و `record` پالت را تمام
 * کردند و دو فرمِ **مراجعه** به رنگِ تکراری رسیدند — یعنی همان دو کارتی که
 * کنارِ هم در داشبورد دیده می‌شوند. فرمِ ثبت‌نام و فرمِ مراجعه هیچ‌وقت کنارِ
 * هم برچسب نمی‌شوند، پس رقابتِ رنگ بینشان بی‌دلیل بود.
 *
 * وقتی هر ۸ رنگِ یک محدوده گرفته شده باشد تصادم اجتناب‌ناپذیر است و به همان
 * hash برمی‌گردیم — پخشِ یکنواخت بهتر از «همه خاکستری» است.
 */
export function pickColor(fullKey: string, taken: Set<string>): string {
  const start = FORM_COLORS.indexOf(colorForKey(fullKey) as (typeof FORM_COLORS)[number]);
  for (let i = 0; i < FORM_COLORS.length; i++) {
    const c = FORM_COLORS[(start + i) % FORM_COLORS.length];
    if (!taken.has(c)) return c;
  }
  return FORM_COLORS[start];
}

/**
 * ترتیبِ واقعیِ فیلدها: صفحه، بعد ترتیبِ داخلِ صفحه، بعد id برای گره‌گشایی.
 *
 * ⚠️ عمداً بدونِ `as const`: Prisma برای `orderBy` یک آرایهٔ **تغییرپذیر**
 * می‌خواهد و `readonly` را رد می‌کند.
 */
const FIELD_ORDER = {
  fields: { where: { deletedAt: null }, orderBy: [{ page: 'asc' as const }, { sort: 'asc' as const }, { id: 'asc' as const }] },
};

/**
 * پرچم‌های نصب/ارتقای فرمِ ثبت‌نامِ هر خدمت.
 *
 * ⚠️ کلیدها **لفظی** نوشته می‌شوند، نه با قالبِ رشته: نگهبانِ CI («هر تنظیمِ اعلام‌شده
 * باید جایی مصرف شود») دنبالِ همین لفظ می‌گردد، و `registration_${key}_installed`
 * کورش کرد — یک بار قرمز شد. و **بی‌رقم**: همان نگهبان فقط `[a-z_]` را می‌خواند، پس
 * نامِ «…_v2» هرگز «مصرف‌شده» دیده نمی‌شد. مطب ارتقا ندارد (قالبش عوض نشده).
 */
const REGISTRATION_FLAGS: Record<keyof typeof REGISTRATION_PRESETS, { installed: string; v2: string | null }> = {
  ionm: { installed: 'registration_ionm_installed', v2: 'registration_ionm_service_fields' },
  implant: { installed: 'registration_implant_installed', v2: 'registration_implant_service_fields' },
  clinic: { installed: 'registration_clinic_installed', v2: null },
};

@Injectable()
export class FormsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  // ── خواندن ────────────────────────────────────────────────────────────────

  /**
   * همه‌ی فرم‌ها. اگر هنوز چیزی نیست، قالبِ حوزه seed می‌شود.
   *
   * ⚠️ seedِ تنبل است نه در migration: حوزه‌ی کاری یک **تنظیم** است که ممکن
   * است بعد از نصب عوض شود، و migration وقتی اجرا می‌شود که هنوز کسی حوزه را
   * انتخاب نکرده. همان الگوی `ensureImported` در کتابِ خدمات.
   */
  async list() {
    await this.ensureSeeded();
    const rows = await this.prisma.formDef.findMany({
      orderBy: [{ scope: 'asc' }, { id: 'asc' }],
      include: FIELD_ORDER,
    });
    const vertical = await this.config.vertical();
    return rows.map((f) => this.view(f, vertical));
  }

  /** یک فرم با کلیدش — همان چیزی که رندرکننده‌ی فرم صدا می‌زند. */
  async byKey(key: string) {
    await this.ensureSeeded();
    const row = await this.prisma.formDef.findUnique({
      where: { key },
      include: FIELD_ORDER,
    });
    if (!row) throw new NotFoundException('فرم پیدا نشد');
    return this.view(row, await this.config.vertical());
  }

  /**
   * فرمِ یک نوعِ مراجعه.
   *
   * ⚠️ اگر فرمی برای این نوع تعریف نشده باشد `null` برمی‌گردد و **خطا نیست**:
   * نصبِ نورومانیتورینگ فرمِ «پیگیری» ندارد و نداشتنش وضعیتِ درستِ کار است.
   * فراخوان باید به فرمِ هسته‌ای برگردد، نه اینکه صفحه را بشکند.
   */
  async forVisitKind(kind: string) {
    await this.ensureSeeded();
    const row = await this.prisma.formDef.findFirst({
      where: { scope: 'visit', visitKind: kind, active: true },
      include: FIELD_ORDER,
    });
    return row ? this.view(row, await this.config.vertical()) : null;
  }

  /**
   * آیا این نوعِ مراجعه معتبر است؟
   *
   * ⚠️ «معتبر» یعنی **فرم دارد** — نه اینکه در فهرستی در کد باشد. مسیرِ درمان
   * جایگشتِ زیادی دارد و هر فهرستِ ثابتی یکی‌شان را غلط می‌کند.
   *
   * ⚠️ اگر این نصب **هیچ** فرمِ مراجعه‌ای ندارد، همه‌چیز پذیرفته می‌شود. وگرنه
   * نصبی که هنوز فرمی نساخته اصلاً نمی‌توانست مراجعه ثبت کند، و دادهٔ
   * وارد‌شده از سامانهٔ قبلی با نوع‌های قدیمی رد می‌شد.
   */
  async isValidKind(kind: string) {
    const kinds = await this.visitKinds();
    if (kinds.length === 0) return true;
    return kinds.some((k) => k.kind === kind);
  }

  /** نوع‌های مراجعه‌ای که این نصب واقعاً فرم دارد — منبعِ انتخابگرِ نوع. */
  /**
   * کاتالوگِ نوعِ فرم — **تنها منبعِ** «هر نوعِ فرم چه باکسی می‌پذیرد، چه
   * بخش‌هایی دارد، و مرحلهٔ تأییدش چه می‌خواهد».
   *
   * ⚠️ کلاینت این را می‌خوانَد و دوباره نمی‌نویسد (قانونِ ۳ و ۱۵). تا دیروز
   * پالتِ فرم‌ساز یک آرایهٔ ثابت در JSX بود و پنلِ تأیید با `targetKind` و
   * `workflow === 'ionm'` حدس می‌زد — دو نسخه از یک قرارداد، که واگرا شدند.
   */
  formTypes() {
    return Object.values(FORM_TYPES);
  }

  async visitKinds() {
    await this.ensureSeeded();
    const rows = await this.prisma.formDef.findMany({
      where: { scope: 'visit', active: true },
      select: { key: true, visitKind: true, title: true, color: true },
      orderBy: { id: 'asc' },
    });
    return rows
      .filter((r) => r.visitKind)
      .map((r) => ({
        kind: r.visitKind as string,
        title: r.title,
        /* ⚠️ رنگ هم برمی‌گردد و مثلِ `view()` هیچ‌وقت خالی نیست: کارتِ مراجعه
           در داشبورد با همین رنگ از بقیه جدا می‌شود، و اگر مشتق‌کردنش به
           کلاینت می‌افتاد یک نوع در داشبورد و در فرم‌ساز دو رنگ می‌گرفت. */
        color: r.color || colorForKey(r.key),
      }));
  }

  /**
   * همان فهرست، به‌شکلِ نگاشت — برای غنی‌سازیِ مراجعه در `patients.service`.
   *
   * ⚠️ **join سمتِ سرور، نه در render** (قانون ۱۵). وسوسه این بود که کلاینت
   * `/forms/visit-kinds` را بگیرد و خودش وصل کند، ولی آن‌وقت داشبورد و تقویم و
   * پرتالِ پزشک هرکدام نسخهٔ خودشان را می‌داشتند و یک نوع در سه صفحه سه‌جور
   * دیده می‌شد — دقیقاً همان چیزی که `KINDS`ِ هاردکد می‌ساخت.
   */
  async kindMap(): Promise<Map<string, { title: string; color: string }>> {
    const rows = await this.visitKinds();
    return new Map(rows.map((r) => [r.kind, { title: r.title, color: r.color }]));
  }

  /**
   * شکلِ خروجیِ فرم.
   *
   * ⚠️ `color` هیچ‌وقت خالی برنمی‌گردد: اگر کاربر رنگی نگذاشته، **سرور** رنگِ
   * مشتق از کلید را می‌گذارد. قانون ۱۵ همین است — هیچ فرمولی در render. اگر
   * مشتق‌کردن به کلاینت می‌افتاد، داشبورد و فرم‌ساز و پرتالِ پزشک هرکدام
   * می‌توانستند نسخهٔ خودشان را داشته باشند و رنگِ یک فرم در سه صفحه سه‌جور
   * دیده می‌شد.
   *
   * ⚠️ `colorSet` **حذف شد** و برنمی‌گردد. کارش این بود که بگوید رنگ انتخابِ
   * کاربر بوده یا خودکار، ولی حالا هر فرم هنگامِ ساخت رنگِ واقعی می‌گیرد
   * (`freeColor`) پس همیشه `true` می‌شد — یعنی فیلدی که همیشه یک مقدار دارد و
   * هیچ اطلاعاتی حمل نمی‌کند. «خودکار» در فرم‌ساز حالا معنیِ روشن‌تری دارد:
   * «یک رنگِ آزاد به من بده»، و بلافاصله همان رنگ انتخاب‌شده دیده می‌شود.
   *
   * ⚠️ `pages` هم این‌جا حساب می‌شود نه در مرورگر: هر جای دیگری که بخواهد
   * «این فرم چند صفحه است» را بداند، باید همان `Math.max` را تکرار کند.
   */
  private view(f: any, vertical?: string) {
    /* هستهٔ ثابتِ مطب (بستهٔ ۶): فرم‌ساز ردیفِ `core` را قفل می‌کند و فرمِ
       مراجعه بخش‌های هسته را به ترتیبِ `coreRank` می‌چیند — نه به ترتیبِ
       `sort`، چون استانداردِ ثابت یعنی ترتیبِ ثابت. */
    const coreList = f.scope === 'visit' && vertical === 'clinic' ? CLINIC_CORE[coreFamily(f.visitKind)] : [];
    const fields = (f.fields ?? []).filter((x: any) => !x.deletedAt).map((x: any) => ({
      core: x.builtin && coreList.includes(x.key),
      coreRank: x.builtin && coreList.includes(x.key) ? coreList.indexOf(x.key) : null,
      id: x.id, key: x.key, label: x.label, type: x.type,
      required: x.required, options: x.options ?? [],
      /* بخشِ نقش + برچسبِ فارسی‌اش — مشتقِ سرور (قانون ۱۵)، تا کلاینت نگاشتِ
         خودش را نسازد. */
      role: x.role ?? null,
      roles: fieldRoles(x),
      roleLabel: fieldRoles(x).map(jobRoleLabel).join('، ') || null,
      hint: x.hint, placeholder: x.placeholder,
      /* دستهٔ مدرکِ باکسِ عکس/لینک — فرم‌ساز نشانش می‌دهد، DynForm پیلِ نوعِ لینک را با آن پیش‌فرض می‌کند. */
      docCategory: x.docCategory ?? null,
      sort: x.sort, page: x.page ?? 1, builtin: x.builtin, active: x.active,
    }));
    /* ⚠️ **ترتیبِ ثابت یعنی در فهرستِ فرم‌ساز هم ثابت.** نصبِ موجود ردیف‌های
       هسته را با `sort`ِ پراکنده دارد (قالبِ قدیم + backfillی که ته اضافه
       می‌کند): «کارشناس» وسطِ هسته و «تشخیص» بعد از «مبلغ» می‌نشست، و فرم‌ساز
       ترتیبی نشان می‌داد که فرمِ واقعی نداشت. پس هسته اول و به ترتیبِ
       `coreRank`، بقیه با همان ترتیبِ خودشان — مرتب‌سازیِ پایدار. */
    if (coreList.length) {
      const idx = new Map(fields.map((x: any, i: number) => [x.id, i]));
      fields.sort((a: any, b: any) => (a.core === b.core
        ? (a.core ? a.coreRank - b.coreRank : (idx.get(a.id) as number) - (idx.get(b.id) as number))
        : a.core ? -1 : 1));
    }
    return {
      id: f.id, key: f.key, title: f.title, scope: f.scope,
      visitKind: f.visitKind, hint: f.hint, active: f.active,
      color: f.color || colorForKey(f.key),
      /* نقشِ فرم در پیگیریِ پس از عمل — فرم‌ساز از همین می‌خواند. */
      followUp: f.followUp ?? null,
      procedureTypeId: f.procedureTypeId ?? null,
      diagnosisId: f.diagnosisId ?? null,
      pages: fields.reduce((m: number, x: any) => Math.max(m, x.page), 1),
      fields,
    };
  }

  // ── seed ──────────────────────────────────────────────────────────────────

  /**
   * قالبِ حوزه را **فقط وقتی هیچ فرمی نیست** می‌سازد.
   *
   * ⚠️ شرط روی «هیچ فرمی نیست» است نه «این فرمِ خاص نیست»: اگر هر بار فرمِ
   * غایب را دوباره می‌ساختیم، فرمی که کاربر عمداً حذف کرده بود هر بار
   * برمی‌گشت — و کاربر فکر می‌کرد حذف کار نمی‌کند.
   */
  private async ensureSeeded() {
    const n = await this.prisma.formDef.count();
    if (n > 0) {
      await this.ensureRegistrationPreset();
      await this.backfillColors();
      await this.backfillVisitBuiltins();
      await this.activateClinicCore();
      return this.backfillClinicMedia();
    }
    const vertical = await this.config.vertical();
    await this.seedFrom(PRESETS[vertical] ?? []);
    await this.ensureRegistrationPreset();
    /* قالب‌ها عمداً کاتالوگِ کامل ندارند (سندِ خوانا ماندن مهم‌تر است)؛
       تکمیلشان کارِ همین backfill است تا نصبِ تازه و نصبِ قدیمی یک مسیر
       داشته باشند. */
    await this.backfillVisitBuiltins();
    await this.activateClinicCore();
    return this.backfillClinicMedia();
  }

  /**
   * **هستهٔ ثابتِ مطب همیشه روشن است** — نه یک بار، هر بار (idempotent).
   *
   * ⚠️ چرا «هر بار» و نه یک پرچمِ «انجام شد»: قفلِ فرم‌ساز جلوی خاموش‌کردنِ
   * **تازه** را می‌گیرد، ولی ردیفی که پیش از این بسته خاموش شده بود (یا از
   * `backfillVisitBuiltins` خاموش ساخته شد) باید روشن شود. چیزی که کم نیست
   * هیچ نوشتنی ندارد.
   */
  private async activateClinicCore() {
    if ((await this.config.vertical()) !== 'clinic') return;
    /* دو کوئری، نه یکی به‌ازای هر فرم: این در هر خواندنِ فرم می‌دود. */
    await this.prisma.formField.updateMany({
      where: {
        builtin: true, active: false, deletedAt: null,
        form: { scope: 'visit', visitKind: 'surgery' },
        key: { in: CLINIC_CORE.surgery },
      },
      data: { active: true },
    });
    await this.prisma.formField.updateMany({
      where: {
        builtin: true, active: false, deletedAt: null,
        form: { scope: 'visit', OR: [{ visitKind: null }, { visitKind: { not: 'surgery' } }] },
        key: { in: CLINIC_CORE.visit },
      },
      data: { active: true },
    });
  }

  async workflow() { return this.config.vertical(); }

  /** نوعِ نصب + بستهٔ خدمات — `config/tenant-profile.ts`. خوانندهٔ تازه از این بپرسد، نه از `workflow()`. */
  async profile() { return this.config.profile(); }

  async defaultVisitKind() {
    const vertical = await this.config.vertical();
    const kinds = await this.visitKinds();
    const preferred = vertical === 'clinic' ? 'clinic' : 'surgery';
    return kinds.find(k => k.kind === preferred)?.kind ?? kinds[0]?.kind ?? preferred;
  }

  /**
   * فرمِ ثبت‌نامِ هر خدمتِ انتخاب‌شده — یک‌بار، افزایشی. فرمی که مدیر عمداً
   * پاک کرده دوباره ساخته نمی‌شود (پرچمِ `registration_<key>_installed`).
   *
   * ⚠️ شرکتِ دوخدمته **دو** فرم می‌گیرد (نورومانیتورینگ و ایمپلنت) و برای هر
   * خدمت لینکِ جدا می‌سازد (تصمیمِ مالک ۱۴۰۵/۰۷/۰۱). تا دیروز فقط فرمِ حوزهٔ
   * شرکت نصب می‌شد.
   */
  private async ensureRegistrationPreset() {
    const profile = await this.config.profile();
    for (const key of this.registrationKeys(profile)) {
      await this.installRegistration(key);
      await this.upgradeRegistration(key);
    }
  }

  /**
   * **ارتقای یک‌بارهٔ فرمِ ثبت‌نامِ نصب‌شده** به فیلدهای خدمت (مالک، ۱۴۰۵/۰۷/۰۱):
   * کارت ملی، دستور پزشک، «رزرو بدون تاریخ» — با پرچمِ `registration_<خدمت>_service_fields`.
   *
   * ⚠️ فقط کلیدهای `REGISTRATION_V2.added` اضافه می‌شوند و فقط پیش‌فرضِ **دست‌نخورده**
   * جابه‌جا می‌شود (`moved`) — شرحش کنارِ همان ثابت در `form-presets.ts`. فیلدی که مدیر
   * ویرایش، خاموش یا پاک کرده (پیش یا پس از ارتقا) دست نمی‌خورد.
   */
  private async upgradeRegistration(vertical: keyof typeof REGISTRATION_PRESETS) {
    const flag = REGISTRATION_FLAGS[vertical].v2;
    const plan = REGISTRATION_V2[vertical];
    if (!flag || !plan) return;
    if ((await this.prisma.setting.findUnique({ where: { key: flag } }))?.value === 'true') return;
    const preset = REGISTRATION_PRESETS[vertical];
    await this.prisma.$transaction(async tx => {
      const form = await tx.formDef.findUnique({ where: { key: preset.key }, include: { fields: true } });
      if (form) {
        const have = new Set(form.fields.map((f) => f.key));
        let sort = Math.max(0, ...form.fields.map((f) => f.sort));
        for (const f of preset.fields) {
          if (!plan.added.includes(f.key) || have.has(f.key)) continue;
          await tx.formField.create({ data: {
            formId: form.id, key: f.key, label: f.label, type: f.type ?? 'text', required: f.required ?? false,
            builtin: f.builtin ?? false, hint: f.hint ?? null, placeholder: f.placeholder ?? null, options: (f.options ?? []) as any,
            docCategory: normDocCategory(f.docCategory), page: f.page ?? 1, sort: (sort += 10),
          } });
        }
        for (const m of plan.moved) {
          const cur = form.fields.find((f) => f.key === m.key);
          if (cur && cur.label === m.was.label && cur.required === m.was.required) {
            await tx.formField.update({ where: { id: cur.id }, data: { label: m.now.label, required: m.now.required } });
          }
        }
      }
      await tx.setting.upsert({ where: { key: flag }, create: { key: flag, value: 'true' }, update: { value: 'true' } });
    });
  }

  /** کلیدِ پیش‌فرض‌های ثبت‌نامِ یک پروفایل — مطب: `clinic`؛ شرکت: هر خدمت. */
  registrationKeys(profile: { kind: string; services: readonly string[] }): (keyof typeof REGISTRATION_PRESETS)[] {
    return (profile.kind === 'clinic' ? ['clinic'] : profile.services) as (keyof typeof REGISTRATION_PRESETS)[];
  }

  private async installRegistration(vertical: keyof typeof REGISTRATION_PRESETS) {
    const key = REGISTRATION_FLAGS[vertical].installed;
    if ((await this.prisma.setting.findUnique({ where: { key } }))?.value === 'true') return;
    const preset = REGISTRATION_PRESETS[vertical];
    await this.prisma.$transaction(async tx => {
      await tx.formDef.upsert({ where: { key: preset.key }, update: {}, create: {
        key: preset.key, title: preset.title, scope: preset.scope, visitKind: preset.visitKind, hint: preset.hint,
        /* ⚠️ `docCategory`/`placeholder`/`page` هم کپی می‌شوند (مثلِ `seedFrom`): بی‌آن‌ها
           کارتِ ملی با دستهٔ «متفرقه» در پرونده می‌نشست. */
        fields: { create: preset.fields.map((f, i) => ({ key: f.key, label: f.label, type: f.type ?? 'text', required: f.required ?? false, builtin: f.builtin ?? false, hint: f.hint, placeholder: f.placeholder ?? null, docCategory: normDocCategory(f.docCategory), page: f.page ?? 1, options: f.options ?? [], sort: (i + 1) * 10 })) },
      } });
      await tx.setting.upsert({ where: { key }, create: { key, value: 'true' }, update: { value: 'true' } });
    });
  }

  /**
   * رنگ‌دادن به فرم‌هایی که از قبل ساخته شده‌اند و `color` ندارند.
   *
   * ⚠️ چرا این‌جا و نه در یک migrationِ SQL: الگوریتم «اولین رنگِ آزاد» است و
   * دو پیاده‌سازیِ جدا (یکی SQL یکی TS) دو نتیجهٔ متفاوت می‌دهند. اولین
   * نسخه‌ام دقیقاً همین اشتباه را کرد — SQLِ چرخشیِ ساده‌ای نوشتم که رنگ‌های
   * **گرفته‌شده** را نمی‌دید و همان تصادمی را ساخت که قرار بود ببندد. حالا
   * تنها یک `pickColor` هست و همه از آن می‌گذرند.
   *
   * ⚠️ یکی‌یکی و نه دسته‌ای: هر فرم باید رنگِ فرمِ قبلی را **ببیند**، وگرنه
   * همه از یک مجموعهٔ «گرفته‌شده»ی قدیمی می‌خوانند و هم‌رنگ می‌شوند.
   *
   * تنبل است مثلِ `ensureSeeded`: نصبِ موجود بدونِ هیچ کارِ دستی، در اولین
   * خواندنِ فهرستِ فرم‌ها رنگ می‌گیرد و از آن به بعد پرس‌وجو خالی برمی‌گردد.
   */
  private async backfillColors() {
    const blank = await this.prisma.formDef.findMany({
      where: { color: null }, select: { id: true, key: true, scope: true }, orderBy: { id: 'asc' },
    });
    if (!blank.length) return;
    const rows = await this.prisma.formDef.findMany({
      where: { NOT: { color: null } }, select: { color: true, scope: true },
    });
    const taken = new Map<string, Set<string>>();
    const bucket = (s: string) => taken.get(s) ?? taken.set(s, new Set()).get(s)!;
    for (const r of rows) bucket(r.scope).add(r.color as string);
    for (const f of blank) {
      const b = bucket(f.scope);
      const c = pickColor(f.key, b);
      b.add(c);
      await this.prisma.formDef.update({ where: { id: f.id }, data: { color: c } });
    }
  }

  /**
   * تکمیلِ کاتالوگِ فیلدهای هسته‌ای روی فرم‌های مراجعهٔ موجود.
   *
   * ⚠️ این پایانِ قاعدهٔ «تعریف‌نشده = روشن» است. آن قاعده چاره بود نه
   * انتخاب: تا وقتی کاتالوگ ناقص بود، خاموش‌حساب‌کردنِ فیلدِ غایب یعنی
   * ناپدیدشدنِ بی‌صدای فیلدهایی که در هیچ قالبی نبودند (حضورِ کارشناس،
   * شرحِ عمل). عوارضش را کاربر گزارش کرد: نوعِ «ویزیت» با جراح و بیمارستان
   * و ساعتِ عمل رندر می‌شد و هیچ راهی برای برداشتنشان نبود — فیلدی که در
   * تعریف نیست، در فرم‌ساز هم ردیفی ندارد که خاموشش کنی.
   *
   * حالا هر فرمِ مراجعه همهٔ کاتالوگ را به‌شکلِ ردیفِ builtin دارد و کلاینت
   * «غایب = خاموش» می‌خواند. ردیف‌های تازه **خاموش** ساخته می‌شوند تا فرمِ
   * موجود همان تعریفش بماند، با دو استثنا که رفتارِ دیده‌شدهٔ امروز را حفظ
   * می‌کنند:
   * - `techArriveTime` فقط با کارشناسِ فعال معنی دارد → همان‌جا روشن می‌ماند
   *   (فرمِ عملِ نورومانیتورینگ همین است).
   * - `opReport` مالِ فرم‌های عمل‌گونه است → جایی روشن می‌ماند که ساعتِ
   *   شروعِ فعال دارد.
   * - فرمی که فقط `opDate` داشت (نوعِ ساخته‌شده در فرم‌ساز با seedِ قدیمی)
   *   مبلغ و یادداشت هم می‌گیرد — همان پیش‌فرضِ نوعِ تازه، وگرنه فرمش فقط
   *   یک تاریخِ خالی بود.
   *
   * تنبل و idempotent مثلِ `backfillColors`: چیزی که کم نیست، هیچ نوشتنی
   * ندارد.
   */
  private async backfillVisitBuiltins() {
    /* ⚠️ **ارتقای ردیفِ قدیمی، نه فقط افزودنِ ردیفِ نبوده** — و پیش از خواندنِ
       فرم‌ها، چون `bare` پایین روی همین `builtin` حساب می‌شود.
       کلیدی که تازه به کاتالوگ اضافه می‌شود ممکن است در نصبِ موجود از قبل یک
       ردیفِ **دلخواه** داشته باشد (`chiefComplaint` دقیقاً همین بود). اگر
       `builtin` نمی‌شد، کلاینت همچنان در `extra` می‌فرستادش و مقدار دوباره در
       JSON می‌نشست — همان دو-نسخه‌ای که ستون برای حذفش ساخته شد. */
    await this.prisma.formField.updateMany({
      where: {
        form: { scope: 'visit' }, builtin: false,
        key: { in: VISIT_BUILTIN_CATALOG.map((c) => c.key) },
      },
      data: { builtin: true },
    });
    const forms = await this.prisma.formDef.findMany({
      where: { scope: 'visit' },
      select: {
        id: true, visitKind: true,
        fields: { select: { key: true, active: true, builtin: true, sort: true } },
      },
    });
    for (const f of forms) {
      const have = new Set(f.fields.map((x) => x.key));
      const missing = VISIT_BUILTIN_CATALOG.filter((c) => !have.has(c.key));
      if (!missing.length) continue;
      const activeKeys = new Set(f.fields.filter((x) => x.active !== false).map((x) => x.key));
      const bare = f.fields.filter((x) => x.builtin).length <= 1;
      let sort = Math.max(0, ...f.fields.map((x) => x.sort ?? 0));
      await this.prisma.formField.createMany({
        // خواندن هم‌زمان فرم نباید backfill تکراری بسازد.
        skipDuplicates: true,
        data: missing.map((c) => ({
          formId: f.id, key: c.key,
          /* «یافته‌ها»ی فرمِ عمل یافته‌های **حینِ عمل** است، نه پاراکلینیک. */
          label: c.key === 'findings' && f.visitKind === 'surgery' ? 'یافته‌های حینِ عمل' : c.label,
          type: c.type,
          builtin: true, required: false, sort: (sort += 10),
          active:
            /* ⚠️ قاعدهٔ «`techId` روشن → `techArriveTime` هم روشن» با W3.8/U7 رفت:
               ساعتِ حضور دیگر فیلدِ فرم نیست. */
            (c.key === 'opReport' && activeKeys.has('opStartTime')) ||
            (bare && (c.key === 'amount' || c.key === 'notes')),
        })),
      });
    }
  }

  /**
   * باکس‌های مدارکِ پزشکی روی فرمِ ویزیتِ مطبِ نصب‌های **موجود**.
   *
   * ⚠️ قالب فقط هنگامِ seed خوانده می‌شود، پس مطبی که دیروز نصب شده «تصاویرِ
   * پزشکی» و «لینکِ تصاویر و آزمایش‌ها» را نمی‌دید و خودش یک باکسِ عکس و یک متنِ
   * بلند برای لینک می‌ساخت (نصبِ واقعی). idempotent مثلِ `backfillVisitBuiltins`:
   * اگر فیلدی با همان کلید (روشن یا خاموش) یا فیلدی از **همان نوع** در فرم
   * باشد، دست نمی‌زند — باکسِ عکسِ خودساختهٔ مطب دوتا نمی‌شود. پس «نمی‌خواهمش»
   * یعنی خاموشش کنید نه حذف؛ ردیفِ حذف‌شده در بوتِ بعدی برمی‌گردد. فقط فرمِ
   * `visit.clinic` (کلیدِ قالبِ مطب)؛ نورومانیتورینگ/تجهیزات این باکس‌ها را
   * در فرمِ ثبت‌نامِ خودشان دارند.
   */
  private async backfillClinicMedia() {
    const form = await this.prisma.formDef.findUnique({
      where: { key: 'visit.clinic' },
      select: { id: true, fields: { select: { key: true, type: true, sort: true } } },
    });
    if (!form) return;
    const keys = new Set(form.fields.map((f) => f.key));
    const types = new Set(form.fields.map((f) => f.type));
    const missing = CLINIC_MEDIA_FIELDS.filter((c) => !keys.has(c.key) && !types.has(c.type ?? 'text'));
    if (!missing.length) return;
    let sort = Math.max(0, ...form.fields.map((f) => f.sort ?? 0));
    await this.prisma.formField.createMany({
        // خواندن هم‌زمان فرم نباید backfill تکراری بسازد.
        skipDuplicates: true,
      data: missing.map((c) => ({
        formId: form.id, key: c.key, label: c.label, type: c.type ?? 'text',
        required: false, builtin: false, hint: c.hint ?? null, placeholder: c.placeholder ?? null,
        docCategory: normDocCategory(c.docCategory), page: 1, sort: (sort += 10),
      })),
    });
  }

  /**
   * مقدارِ باکس‌های لینکِ فرمِ مراجعه را نرمال می‌کند — پیش از نوشتن در
   * `Visit.extra`: URLِ http(s)ِ معتبر، سقفِ ۱۰، متن‌ها بریده. فیلدهای دیگر دست
   * نمی‌خورند. یک‌بار این‌جا، نه در هر خواننده‌ای که بعداً به `extra` می‌رسد.
   *
   * ⚠️ **بدونِ کوئری** — تعریفِ فرم را صداکننده می‌دهد. نسخهٔ اول خودش
   * `forVisitKind` می‌زد و از داخلِ تراکنشِ تعاملیِ `updateVisit` صدا زده می‌شد؛
   * کوئریِ بیرونِ tx داخلِ tx روی PGliteِ CI (یک اتصال) قفل می‌کرد و تراکنشِ
   * ۵ ثانیه‌ای منقضی می‌شد. تعریف را پیش از تراکنش بگیرید، این را هر جا.
   */
  normalizeExtra(fields: { key: string; type?: string | null; label: string }[], extra: Record<string, any> | undefined) {
    if (!extra || typeof extra !== 'object') return extra;
    const out: Record<string, any> = { ...extra };
    for (const f of fields ?? []) {
      if (f.type === 'links' && out[f.key] !== undefined && out[f.key] !== null) out[f.key] = normalizeLinks(out[f.key], f.label);
    }
    return out;
  }

  /** رنگِ آزادِ **همان محدوده** — دلیلِ محدوده‌ای‌بودن در `pickColor`. */
  private async freeColor(fullKey: string, scope: string): Promise<string> {
    const rows = await this.prisma.formDef.findMany({ where: { scope }, select: { color: true } });
    return pickColor(fullKey, new Set(rows.map((r) => r.color).filter(Boolean) as string[]));
  }

  private async seedFrom(forms: PresetForm[]) {
    for (const f of forms) {
      const exists = await this.prisma.formDef.findUnique({ where: { key: f.key } });
      /* ⚠️ اگر همین فرم از قبل هست ولی خاموش شده (چون مراجعه داشت و
         `resetToPreset` نگهش داشت)، دوباره روشن می‌شود — وگرنه «بازگرداندن به
         قالب» فرمی را که خودش قرار بود بسازد، خاموش تحویل می‌داد. */
      if (exists) {
        if (!exists.active) {
          await this.prisma.formDef.update({ where: { id: exists.id }, data: { active: true } });
        }
        continue;
      }
      await this.prisma.formDef.create({
        data: {
          key: f.key, title: f.title, scope: f.scope,
          visitKind: f.visitKind ?? null, hint: f.hint ?? null,
          /* رنگ در قالب‌ها نوشته نشده و عمداً `null` می‌ماند: «خودکار» یعنی
             `view()` از کلید مشتقش می‌کند و همهٔ نصب‌ها یک رنگ می‌بینند. */
          /* ⚠️ قالب‌ها هم رنگِ **آزاد** می‌گیرند، نه فقط مشتقِ کلید: قالبِ
             مطب/کلینیک پنج فرمِ مراجعه دارد و با ۸ رنگ، hashِ خالی تقریباً
             همیشه دست‌کم یک تصادم می‌ساخت — دو نوعِ هم‌رنگ از همان اولین
             روزِ نصب. چون یکی‌یکی ساخته می‌شوند، هرکدام رنگِ قبلی‌ها را
             می‌بیند. */
          color: normColor(f.color) ?? (await this.freeColor(f.key, f.scope)),
          fields: {
            create: f.fields.map((x, i) => ({
              key: x.key, label: x.label, type: x.type ?? 'text',
              required: x.required ?? false, builtin: x.builtin ?? false,
              options: (x.options ?? []) as any,
              hint: x.hint ?? null, placeholder: x.placeholder ?? null,
              docCategory: normDocCategory(x.docCategory),
              sort: (i + 1) * 10, page: normPage(x.page),
            })),
          },
        },
      });
    }
  }

  /** نصب پیشنهادی پیگیری؛ تعریف موجود حفظ و قالب تازه برای بازبینی خاموش می‌ماند. */
  async installFollowUp() {
    // تعریف عمومی موجود، حتی اگر خاموش باشد، مرجع است و بازنویسی نمی‌شود.
    const existing = await this.prisma.formDef.findFirst({ where: { scope: 'record', followUp: 'general' } });
    if (existing) return this.byKey(existing.key);
    const sameKey = await this.prisma.formDef.findUnique({ where: { key: POSTOP_FOLLOWUP.key } });
    if (sameKey) return this.byKey(sameKey.key);
    await this.prisma.formDef.create({ data: {
      key: POSTOP_FOLLOWUP.key, title: POSTOP_FOLLOWUP.title, scope: 'record',
      hint: POSTOP_FOLLOWUP.hint, followUp: 'general', active: false,
      color: await this.freeColor(POSTOP_FOLLOWUP.key, 'record'),
      fields: { create: POSTOP_FOLLOWUP.fields.map((f, i) => ({
        key: f.key, label: f.label, type: f.type ?? 'text', required: f.required ?? false,
        options: (f.options ?? []) as any, hint: f.hint, sort: (i + 1) * 10,
      })) },
    } });
    return this.byKey(POSTOP_FOLLOWUP.key);
  }

  /**
   * بازگرداندن به قالبِ حوزه — عمداً **صریح و ویرانگر**.
   *
   * تنها راهِ برگشت است وقتی کاربر فرم را خراب کرده. چون همه‌ی فیلدها را
   * می‌ریزد، کنترلر پشتِ سطحِ سوپرادمین نگهش می‌دارد و UI تأییدِ صریح می‌گیرد.
   *
   * ⚠️ پاسخ‌هایی که قبلاً در `Visit.extra` ذخیره شده‌اند **پاک نمی‌شوند** —
   * آن‌ها دادهٔ بیمارند، نه تعریف. ولی فیلدی که تعریفش رفته دیگر در فرم دیده
   * نمی‌شود، پس مقدارِ قدیمی در JSON می‌ماند و فقط از راهِ خروجی خام پیداست.
   * این عمدی است: پاک‌کردنِ دادهٔ بالینی به‌خاطرِ تغییرِ یک تعریف، بدتر است.
   */
  async resetToPreset(vertical?: string) {
    const v = (vertical as any) ?? (await this.config.vertical());
    const forms = PRESETS[v as keyof typeof PRESETS];
    if (!forms) throw new BadRequestException('حوزه‌ی کاری نامعتبر است');

    /* ⚠️ فرمی که **مراجعه دارد** پاک نمی‌شود، فقط خاموش می‌شود — همان قاعده‌ی
       `removeForm` و همان قاعده‌ی کلِ پروژه برای موجودیتِ استفاده‌شده.
       نسخه‌ی اول کورکورانه `deleteMany({})` می‌زد و نتیجه‌اش این بود که
       مراجعاتِ ثبت‌شده با نوعِ دلخواه (مثلاً «درمان») **برچسبشان را از دست
       می‌دادند** و برای همیشه با کلیدِ خامِ `treatment` دیده می‌شدند. داده‌ی
       بالینی سرِ جایش می‌ماند ولی خواندنی نبود، که عملاً یعنی از دست رفته. */
    const all = await this.prisma.formDef.findMany({ select: { id: true, visitKind: true } });
    const keep: number[] = [];
    for (const f of all) {
      /* ⚠️ همان `formUsage`ِ `removeForm` و نه یک شمارشِ دوم: فرمی که یک لینکِ
         زنده می‌فرستدش هم «استفاده‌شده» است. بدونِ این، «بازگرداندن به قالب»
         با FKِ `Restrict` روبه‌رو می‌شد و با یک خطای خامِ دیتابیس می‌ترکید. */
      const { total } = await this.formUsage(f);
      if (total > 0) keep.push(f.id);
    }
    await this.prisma.formDef.deleteMany({ where: { id: { notIn: keep } } });
    await this.prisma.formDef.updateMany({ where: { id: { in: keep } }, data: { active: false } });
    await this.seedFrom(forms);
    return this.list();
  }

  // ── نوشتن روی تعریفِ فرم ──────────────────────────────────────────────────

  /**
   * ویرایشِ خودِ فرم.
   *
   * ⚠️ `scope` این‌جا **عوض نمی‌شود** و عمدی است: محدوده تعیین می‌کند پرشدنِ
   * فرم مراجعه می‌سازد یا به پرونده می‌چسبد. عوض‌کردنش روی فرمی که قبلاً پر
   * شده، ثبت‌های گذشته را در جای اشتباه می‌گذارد — و برگرداندنش دستی است.
   * فرمِ تازه بسازید.
   */
  async patchForm(
    id: number,
    dto: {
      title?: string; hint?: string; active?: boolean; color?: string | null;
      followUp?: string | null; procedureTypeId?: number | null; diagnosisId?: number | null;
    },
  ) {
    const row = await this.prisma.formDef.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('فرم پیدا نشد');

    /* نقشِ پیگیری فقط برای فرمِ زیرپرونده معنا دارد: پیگیری به پرونده می‌چسبد،
       مراجعه نمی‌سازد. بخشِ اختصاصی بدونِ مرجعش (نوعِ عمل/تشخیص) بی‌معناست. */
    let followUpPatch: Record<string, unknown> = {};
    if (dto.followUp !== undefined) {
      const fu = dto.followUp || null;
      if (fu && row.scope !== 'record') {
        throw new BadRequestException('نقشِ پیگیری فقط روی فرمِ زیرپرونده می‌نشیند');
      }
      if (fu === 'procedure' && !dto.procedureTypeId) {
        throw new BadRequestException('بخشِ اختصاصیِ عمل، نوعِ عملش را می‌خواهد');
      }
      if (fu === 'diagnosis' && !dto.diagnosisId) {
        throw new BadRequestException('بخشِ اختصاصیِ تشخیص، تشخیصش را می‌خواهد');
      }
      followUpPatch = {
        followUp: fu,
        procedureTypeId: fu === 'procedure' ? dto.procedureTypeId : null,
        diagnosisId: fu === 'diagnosis' ? dto.diagnosisId : null,
      };
    }

    await this.prisma.formDef.update({
      where: { id },
      data: {
        ...(dto.title ? { title: dto.title.trim() } : {}),
        ...(dto.hint !== undefined ? { hint: dto.hint?.trim() || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        /* رشته‌ی خالی یعنی «برگرد به خودکار» — پس `null` می‌نشیند، نه ''. */
        ...(dto.color !== undefined ? { color: normColor(dto.color) } : {}),
        ...followUpPatch,
      },
    });
    return this.byKey(row.key);
  }

  async addField(formId: number, dto: any) {
    const form = await this.prisma.formDef.findUnique({ where: { id: formId } });
    if (!form) throw new NotFoundException('فرم پیدا نشد');

    const key = String(dto.key ?? '').trim();
    if (!KEY_RE.test(key)) {
      throw new BadRequestException('کلید باید با حرفِ لاتین شروع شود و فقط حرف، رقم و _ داشته باشد');
    }
    /* ⚠️ کلیدِ دلخواه نباید هم‌نامِ ستونِ واقعی باشد: `split()` کلیدهای builtin
       را به ستون می‌فرستد، پس یک فیلدِ دلخواه به‌نامِ `opDate` بی‌صدا تاریخِ
       عمل را بازنویسی می‌کرد. */
    /* ⚠️ فرمِ **زیرپرونده** (`record`) مراجعه نمی‌سازد و پاسخش در
       `IntakeSubmission` می‌ماند — نه ستون می‌شود نه شرحِ بخشی. پس رزروِ
       کلید آن‌جا فقط مانع است: از بستهٔ ۶الف `history` هم کلیدِ هسته شد و
       فرمِ «شرحِ حال»ِ زیرپرونده دیگر نمی‌توانست فیلدِ `history` بگیرد
       (سوییتِ record-texts همین را گرفت). */
    /* بستهٔ ۷: کلیدِ همزادِ «سایرِ تشخیص‌ها/عمل‌ها» هم رزرو است — فیلدِ دلخواهی
       به همین نام مقدارش را از مسیرِ کدگذاری می‌گرفت و در `extra` هم می‌نشست. */
    if (form.scope !== 'record' && (BUILTIN_VISIT_KEYS.has(key) || VISIT_CATALOG_KEYS.has(key) || CODING_TWIN_KEYS.has(key))) {
      throw new BadRequestException('این کلید برای فیلدهای هسته‌ای رزرو است — نامِ دیگری بگذارید');
    }
    const dup = await this.prisma.formField.findUnique({ where: { formId_key: { formId, key } } });
    if (dup) throw new BadRequestException('فیلدی با این کلید در همین فرم هست');

    const type = String(dto.type ?? 'text');
    if (!FIELD_TYPES.includes(type as FieldType)) throw new BadRequestException('نوعِ فیلد نامعتبر است');
    /* ⚠️ **این‌جا عمداً باکسی رد نمی‌شود — و یک‌بار اشتباه رد شد.**

       نسخهٔ اولِ فرم‌سازِ «نیمه‌بسته» باکسِ پرداخت را روی فرمِ مراجعه ۴۰۰ می‌کرد،
       با این استدلال که «پرداخت مالِ ثبت‌نام است و روی مراجعه هیچ کاری نمی‌کند».
       **غلط بود:** `resolveLinkRefs` هر فرمی را — `visit`، `record`، `intake` —
       به یک `IntakeLink` می‌بندد، پس هر کدامشان می‌تواند واقعاً پول بگیرد.
       سه سوییتِ رگرسیون (`forms-api`، `forms-validate`، `forms-boxes`) همان
       لحظه قرمز شدند و همین جلوی رفتنِ یک محدودیتِ نادرست روی سایت را گرفت.

       پس کاتالوگ (`form-types.ts`) **راهنماست نه قفل**: پالتِ فرم‌ساز باکس‌های
       مناسبِ هر نوع را اول نشان می‌دهد و بقیه را زیرِ «سایر» — ولی سرور فقط
       قاعده‌هایی را اجرا می‌کند که بتواند اثباتشان کند (نوعِ معتبر، کلیدِ
       غیررزرو، و «یک باکسِ پرداخت در هر فرم» که پایین‌تر است). */
    const label = String(dto.label ?? '').trim();
    if (label.length < 2) throw new BadRequestException('برچسب کوتاه است');

    /* ⚠️ فقط **یک** باکسِ پرداخت در هر فرم. شماره‌های حساب از
       `IntakeLink.bankAccountId` می‌آیند و لینک یک حساب دارد، پس باکسِ دوم
       همان شماره‌ها را دوباره نشان می‌داد و بیمار فکر می‌کرد باید دو بار
       واریز کند. */
    if (type === 'payment') {
      const has = await this.prisma.formField.count({ where: { formId, type: 'payment', deletedAt: null } });
      if (has > 0) throw new BadRequestException('هر فرم فقط یک باکسِ پرداخت دارد');
    }

    const page = normPage(dto.page);
    /* ⚠️ ترتیب **داخلِ همان صفحه** گرفته می‌شود نه از کلِ فرم: اگر آخرین
       `sort`ِ کلِ فرم را می‌گرفتیم، فیلدِ تازه‌ی صفحهٔ ۱ عددی بزرگ‌تر از
       فیلدهای صفحهٔ ۳ می‌گرفت — بی‌اثر روی نمایش (چون اول با page مرتب
       می‌شود) ولی `reorder` را در صفحه‌های بعدی گیج می‌کرد. */
    const last = await this.prisma.formField.findFirst({
      where: { formId, page }, orderBy: { sort: 'desc' }, select: { sort: true },
    });
    await this.prisma.formField.create({
      data: {
        formId, key, label, type, page,
        required: !!dto.required,
        options: normOptions(dto.options, type),
        hint: dto.hint?.trim() || null,
        placeholder: dto.placeholder?.trim() || null,
        docCategory: normDocCategory(dto.docCategory),
        sort: (last?.sort ?? 0) + 10,
        builtin: false,
        ...normRoles(dto),
      },
    });
    await this.compactPages(formId);
    return this.byKey(form.key);
  }

  /**
   * ویرایشِ فیلد.
   *
   * ⚠️ فیلدِ `builtin` هم ویرایش می‌شود — همین کلِ هدفِ «ستاره‌کردن» است. فقط
   * `key` و `type`اش قفل‌اند، چون مقدارش به ستونِ واقعی می‌نشیند و ستون نوعِ
   * خودش را دارد: عوض‌کردنِ `opDate` از تاریخ به متن یعنی ستونی که دیگر پر
   * نمی‌شود.
   *
   * ⚠️ فرستادنِ **همان نوعِ فعلی** خطا نمی‌دهد. اولین نسخه هر `dto.type`ی را
   * روی builtin رد می‌کرد، و کلاینتی که کلِ فرم را می‌فرستد (شاملِ نوعِ
   * دست‌نخورده) بی‌دلیل ۴۰۰ می‌گرفت.
   */
  async patchField(id: number, dto: any) {
    const row = await this.prisma.formField.findUnique({ where: { id }, include: { form: true } });
    if (!row || row.deletedAt) throw new NotFoundException('فیلد پیدا نشد');

    if (dto.type && !FIELD_TYPES.includes(dto.type)) throw new BadRequestException('نوعِ فیلد نامعتبر است');
    if (row.builtin && dto.type && dto.type !== row.type) {
      throw new BadRequestException('نوعِ فیلدِ هسته‌ای عوض نمی‌شود — این مقدار به ستونِ خودش می‌نشیند');
    }
    /* هستهٔ ثابتِ مطب خاموش نمی‌شود (بستهٔ ۶) — ستاره، برچسب و نقشش آزاد است. */
    if (dto.active === false && row.builtin && row.form.scope === 'visit'
        && isCoreKey(await this.config.vertical(), row.form.visitKind, row.key)) {
      throw new BadRequestException(
        `«${row.label}» جزوِ استانداردِ ثابتِ ${coreFamily(row.form.visitKind) === 'surgery' ? 'عمل' : 'ویزیت'} است و خاموش نمی‌شود — فقط اجباری‌بودن، برچسب و بخشِ نقشش قابلِ تغییر است`,
      );
    }
    /* همان قاعدهٔ `addField`: تبدیلِ یک فیلدِ موجود به پرداخت هم نباید باکسِ
       دومی بسازد. `id: { not: row.id }` تا ذخیرهٔ دوبارهٔ خودش خطا ندهد. */
    if (dto.type === 'payment' && row.type !== 'payment') {
      const has = await this.prisma.formField.count({
        where: { formId: row.formId, type: 'payment', deletedAt: null, id: { not: row.id } },
      });
      if (has > 0) throw new BadRequestException('هر فرم فقط یک باکسِ پرداخت دارد');
    }

    const type = dto.type ?? row.type;
    await this.prisma.formField.update({
      where: { id },
      data: {
        ...(dto.label ? { label: String(dto.label).trim() } : {}),
        ...(dto.type && !row.builtin ? { type: dto.type } : {}),
        ...(dto.required !== undefined ? { required: !!dto.required } : {}),
        ...(dto.active !== undefined ? { active: !!dto.active } : {}),
        ...(dto.options !== undefined ? { options: normOptions(dto.options, type) } : {}),
        ...(dto.hint !== undefined ? { hint: dto.hint?.trim() || null } : {}),
        ...(dto.placeholder !== undefined ? { placeholder: dto.placeholder?.trim() || null } : {}),
        /* دستهٔ مدرکِ باکسِ عکس/لینک — «تصویربرداری» به‌جای «متفرقه». */
        ...(dto.docCategory !== undefined ? { docCategory: normDocCategory(dto.docCategory) } : {}),
        ...(dto.sort !== undefined ? { sort: Number(dto.sort) || 0 } : {}),
        /* ⚠️ صفحه روی فیلدِ هسته‌ای هم عوض می‌شود: چینش کارِ سوپرادمین است و
           قفلِ builtin فقط دربارهٔ `key` و `type` است، نه جای فیلد. */
        ...(dto.page !== undefined ? { page: normPage(dto.page) } : {}),
        /* بخشِ نقش روی فیلدِ هسته‌ای هم می‌نشیند: «تاریخِ عمل مالِ منشی است»
           به‌اندازهٔ «شرحِ معاینه مالِ پزشک است» معنا دارد. */
        ...(dto.role !== undefined || dto.roles !== undefined ? normRoles(dto) : {}),
      },
    });
    if (dto.page !== undefined) await this.compactPages(row.formId);
    return this.byKey(row.form.key);
  }

  /** حذف — فقط فیلدِ دلخواه. هسته‌ای فقط خاموش می‌شود. */
  async removeField(id: number) {
    const row = await this.prisma.formField.findUnique({ where: { id }, include: { form: true } });
    if (!row || row.deletedAt) throw new NotFoundException('فیلد پیدا نشد');
    if (row.builtin) {
      throw new BadRequestException('فیلدِ هسته‌ای حذف نمی‌شود — می‌توانید خاموشش کنید');
    }
    await this.prisma.formField.update({ where: { id }, data: { active: false, deletedAt: new Date() } });
    /* حذفِ تنها فیلدِ یک صفحه، آن صفحه را خالی می‌گذارد — یعنی همان شکافی که
       `compactPages` وجود دارد تا نگذارد بماند. */
    await this.compactPages(row.formId);
    return this.byKey(row.form.key);
  }

  /**
   * جابه‌جایی — کلِ ترتیب یک‌جا، تا دو درخواستِ همزمان ترتیب را قاطی نکنند.
   *
   * ⚠️ `updateMany` با شرطِ `formId` یعنی idهای فرمِ دیگر بی‌صدا نادیده گرفته
   * می‌شوند، نه اینکه به این فرم دزدیده شوند. و idهای جامانده ترتیبِ قبلیشان
   * را نگه می‌دارند — ممکن است با ردیف‌های تازه هم‌عدد شوند، که مرتب‌سازیِ
   * ثانویه روی `id` همان‌جا حلش می‌کند.
   *
   * ⚠️ **شمارنده به‌ازای هر صفحه است، نه یکی برای کلِ فرم.** نسخهٔ قبلی
   * `(i+1)*10` روی ایندکسِ سراسری می‌گذاشت؛ با آمدنِ `page` این بی‌صدا می‌شکست:
   * مرتب‌سازی اول با `page` است، پس فیلدهای صفحهٔ ۲ که عددِ بزرگ‌تر گرفته
   * بودند همچنان بعد از صفحهٔ ۱ می‌آمدند — درست به‌نظر می‌رسید — ولی
   * جابه‌جاییِ **داخلِ** صفحهٔ ۲ نتیجهٔ دلخواه را نمی‌داد چون ارقام از یک
   * دنبالهٔ مشترک می‌آمدند.
   */
  async reorder(formId: number, ids: number[]) {
    const form = await this.prisma.formDef.findUnique({ where: { id: formId } });
    if (!form) throw new NotFoundException('فرم پیدا نشد');

    const rows = await this.prisma.formField.findMany({
      where: { formId, deletedAt: null }, select: { id: true, page: true },
    });
    const pageOf = new Map(rows.map((r) => [r.id, r.page]));
    const nth = new Map<number, number>();
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const id of ids) {
      const page = pageOf.get(id);
      if (page === undefined) continue; // idِ فرمِ دیگر — نادیده، نه دزدیده
      const i = (nth.get(page) ?? 0) + 1;
      nth.set(page, i);
      ops.push(this.prisma.formField.updateMany({ where: { id, formId }, data: { sort: i * 10 } }));
    }
    await this.prisma.$transaction(ops);
    return this.byKey(form.key);
  }

  /**
   * صفحه‌ها همیشه `1..N` و بی‌شکاف می‌مانند.
   *
   * ⚠️ شمارهٔ صفحه یک **جایگاه** است نه یک شناسه. اگر شکاف را تحمل می‌کردیم،
   * کاربری که روی فرمِ تک‌صفحه‌ای عددِ ۵ می‌نویسد فرمی می‌ساخت با سه صفحهٔ
   * خالی — و بیمار روی موبایل سه بار «بعدی» می‌زد بی‌آنکه چیزی ببیند. پس
   * بعد از هر تغییرِ صفحه، شماره‌ها فشرده می‌شوند و ترتیبِ نسبی حفظ می‌شود.
   */
  private async compactPages(formId: number) {
    const rows = await this.prisma.formField.findMany({
      where: { formId, deletedAt: null },
      select: { id: true, page: true },
      orderBy: [{ page: 'asc' }, { sort: 'asc' }, { id: 'asc' }],
    });
    const order: number[] = [];
    for (const r of rows) if (!order.includes(r.page)) order.push(r.page);
    const map = new Map(order.map((p, i) => [p, i + 1]));
    const fix = rows.filter((r) => map.get(r.page) !== r.page);
    if (fix.length === 0) return;
    await this.prisma.$transaction(
      fix.map((r) =>
        this.prisma.formField.update({ where: { id: r.id }, data: { page: map.get(r.page) as number } }),
      ),
    );
  }

  /**
   * ساختِ فرمِ تازه — یعنی **یک نوعِ تازه‌ی مراجعه**.
   *
   * ⚠️ این همان چیزی است که «چینشِ شناور» را ممکن می‌کند: مطبی که مسیرش
   * «ویزیت → درمان → پیگیری» است فرمِ «درمان» را خودش می‌سازد؛ مطبِ داخلی
   * فرمِ «جراحی» را حذف می‌کند. ما ترتیب را تحمیل نمی‌کنیم، فقط جعبه‌ها را
   * می‌دهیم و ترتیب از خودِ مراجعاتِ ثبت‌شده خوانده می‌شود.
   *
   * ⚠️ `visitKind` از `key` مشتق می‌شود و جدا گرفته نمی‌شود: دو شناسه برای یک
   * چیز یعنی روزی که با هم نخوانند، فرم پیدا نمی‌شود و کسی نمی‌فهمد چرا.
   */
  async createForm(dto: { key?: string; title?: string; scope?: string; hint?: string; color?: string }) {
    const key = String(dto.key ?? '').trim();
    if (!KEY_RE.test(key)) {
      throw new BadRequestException('کلید باید با حرفِ لاتین شروع شود و فقط حرف، رقم و _ داشته باشد');
    }
    const title = String(dto.title ?? '').trim();
    if (title.length < 2) throw new BadRequestException('عنوان کوتاه است');

    const scope = normScope(dto.scope);
    if (!scope) throw new BadRequestException('محدودهٔ فرم نامعتبر است');

    const fullKey = scope === 'visit' ? `visit.${key}` : key;
    const dup = await this.prisma.formDef.findUnique({ where: { key: fullKey } });
    if (dup) throw new BadRequestException('فرمی با این کلید هست');

    await this.prisma.formDef.create({
      data: {
        key: fullKey, title, scope,
        visitKind: scope === 'visit' ? key : null,
        hint: dto.hint?.trim() || null,
        /* رنگ همین‌جا **تثبیت** می‌شود، نه در زمانِ نمایش — دلیلش در
           `pickColor`. */
        color: normColor(dto.color) ?? (await this.freeColor(fullKey, scope)),
        /* ⚠️ نوعِ تازه با فرمِ **کمینه** شروع می‌شود، نه با فرمِ عمل:
           تاریخ (اجباری — تقویم و گزارشِ بازه‌ای رویش بنا شده‌اند) + مبلغ +
           یادداشت روشن‌اند و بقیهٔ کاتالوگ خاموش ولی **حاضر**، تا سوپرادمین
           هرکدام را با یک کلیک روشن کند. باگی که این را ساخت: نوعِ «ویزیت»
           فقط opDate می‌گرفت و کلاینت غایب‌ها را روشن حساب می‌کرد — فرمِ
           ویزیت با جراح و ساعتِ عمل رندر می‌شد و راهی برای برداشتنشان نبود. */
        ...(scope === 'visit'
          ? {
              fields: {
                create: VISIT_BUILTIN_CATALOG.map((c, i) => ({
                  key: c.key, label: c.label, type: c.type, builtin: true,
                  sort: (i + 1) * 10,
                  required: c.key === 'opDate',
                  active: ['opDate', 'amount', 'notes'].includes(c.key),
                })),
              },
            }
          : {}),
      },
    });
    return this.byKey(fullKey);
  }

  /**
   * حذفِ فرم.
   *
   * ⚠️ همان قاعدهٔ کلِ پروژه: موجودیتِ استفاده‌شده حذفِ سخت نمی‌شود. اگر
   * مراجعه‌ای با این نوع ثبت شده، فرم فقط **خاموش** می‌شود — وگرنه آن
   * مراجعات نوعی می‌گرفتند که هیچ تعریفی ندارد و در هر فهرستی بی‌نام
   * می‌ماندند. شکلِ خروجی `{ok, deactivated}` است چون کلاینتِ این پروژه
   * مستقیم به همان فیلد نگاه می‌کند تا پیام را انتخاب کند.
   */
  /**
   * «آیا این فرم استفاده می‌شود؟» — دو جور استفاده، و هر دو باید شمرده شوند.
   *
   * ⚠️ **تا دیروز فقط مراجعه شمرده می‌شد و این یک حفرهٔ بی‌صدا بود.** شمارش
   * `visit.count({ kind: row.visitKind })` است و فرمِ `scope: 'intake'`
   * اصلاً `visitKind` ندارد — پس همیشه صفر می‌داد و شاخهٔ **حذفِ سخت** اجرا
   * می‌شد. با آمدنِ `IntakeLink.formId`، حذفِ چنین فرمی یعنی لینکِ زنده به
   * مسیرِ هاردکدِ قدیمی برمی‌گشت: بدونِ خطا، بدونِ ردِ audit، بدونِ هیچ تغییری
   * در فهرستِ ادمین. حالا FKِ `Restrict` هم آخرین سد است، ولی سدِ اول همین‌جاست
   * چون فقط این‌جا می‌شود پیامِ فارسیِ درست داد.
   */
  /** تعریفِ تاریخی؛ فرم‌های اختصاصی هم با اولویت فرم اصلی و کلید یکتا. */
  async schemaSnapshot(formId: number | null, extraFormIds: number[] = []) {
    const ids = [...new Set([formId, ...extraFormIds].filter((id): id is number => id != null))];
    if (!ids.length) return [];
    const rows = await this.prisma.formDef.findMany({
      where: { id: { in: ids } },
      include: { fields: { where: { builtin: false }, orderBy: [{ page: 'asc' }, { sort: 'asc' }, { id: 'asc' }] } },
    });
    const seen = new Set<string>();
    const fields: any[] = [];
    for (const id of ids) {
      for (const f of rows.find((row) => row.id === id)?.fields ?? []) {
        if (seen.has(f.key)) continue;
        seen.add(f.key);
        fields.push({ key: f.key, label: f.label, type: f.type, options: f.options,
          page: f.page, roles: f.roles, docCategory: f.docCategory });
      }
    }
    return fields;
  }

  private async formUsage(row: { id: number; visitKind: string | null }, db: Prisma.TransactionClient = this.prisma) {
    const [visits, links, submissions] = await Promise.all([
      row.visitKind ? db.visit.count({ where: { kind: row.visitKind } }) : Promise.resolve(0),
      db.intakeLink.count({ where: { formId: row.id } }),
      db.intakeSubmission.count({ where: { OR: [{ formId: row.id }, { extraFormIds: { has: row.id } }] } }),
    ]);
    return { visits, links, submissions, total: visits + links + submissions };
  }

  async removeForm(id: number) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.formDef.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('فرم پیدا نشد');
      const { visits, links, submissions, total } = await this.formUsage(row, tx);
      if (total > 0) {
        await tx.formDef.update({ where: { id }, data: { active: false } });
        /* `used` برای سازگاری با کلاینتِ فعلی می‌ماند؛ `visits`/`links` تازه‌اند
           تا پیام بتواند بگوید **چرا** حذف نشد. */
        return { ok: true, deactivated: true, used: total, visits, links, submissions };
      }
      await tx.formDef.delete({ where: { id } });
      return { ok: true, deactivated: false, used: 0, visits: 0, links: 0, submissions: 0 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  // ── اعتبارسنجی و تفکیکِ مقادیر ────────────────────────────────────────────

  /**
   * قاعده‌ی اجباری‌بودن را روی مقادیرِ ارسالی اعمال می‌کند.
   *
   * ⚠️ رشته‌ی خالی «خالی» است. کلاینتِ این پروژه برای هر کلیدِ فرم
   * `value ?? ''` می‌فرستد، پس اگر فقط `undefined` را خالی می‌شمردیم، هر فیلدِ
   * اجباری‌ای با یک کادرِ خالی از اعتبارسنجی رد می‌شد.
   *
   * ⚠️ `false` و `0` عمداً **پر** حساب می‌شوند — «نه» و «صفر» جوابند. استثنا
   * `rating` است: صفر یعنی «امتیازی نداده»، نه «امتیازِ صفر».
   */
  async validate(formKey: string, values: Record<string, any>) {
    const form = await this.byKey(formKey).catch(() => null);
    if (!form) return { ok: true as const, errors: {} as Record<string, string> };
    return this.validateFields(form.fields, values);
  }

  /**
   * همان قاعده، روی یک **زیرمجموعهٔ** فیلدها.
   *
   * ⚠️ چرا لازم شد: فرمِ عمومیِ بیمار فقط فیلدهای **دلخواه** را نشان می‌دهد؛
   * فیلدهای builtin (تاریخِ عمل، جراح، …) را ادمین هنگامِ تأیید پر می‌کند. اگر
   * فرمِ عمومی کلِ فرم را اعتبارسنجی می‌کرد، `opDate`ِ اجباری — که `createForm`
   * روی هر فرمِ مراجعه می‌سازد — ذخیرهٔ بیمار را ۴۰۰ می‌کرد برای کادری که
   * اصلاً روی صفحه‌اش نیست.
   *
   * ⚠️ و چرا کپیِ قاعده نه: «خالی یعنی چه» یک تصمیم است، نه یک شرط. دو نسخه‌اش
   * یعنی روزی ستارهٔ فرم‌ساز در یک صفحه اثر کند و در صفحهٔ دیگر نه.
   */
  validateFields(fields: any[], values: Record<string, any>) {
    const errors: Record<string, string> = {};
    for (const f of fields ?? []) {
      /* ⚠️ `active !== false` و نه `!active`: فراخوانی که فیلدها را از قبل با
         `active` فیلتر کرده (مثلِ نمای عمومیِ فرم) اصلاً این کلید را نمی‌فرستد،
         و `!undefined` یعنی **همه‌چیز رد شود** — اعتبارسنجی‌ای که بی‌صدا هیچ
         چیزی را نمی‌سنجد. همان قراردادِ `DynForm`. */
      if (f.active === false) continue;
      /* باکسِ لینک: نشانیِ خراب حتی وقتی فیلد اختیاری است رد می‌شود — لینکِ
         `javascript:` یا بدونِ https روی صفحهٔ پرونده کلیک‌شدنی می‌شود. */
      if (f.type === 'links' && values?.[f.key] !== undefined && values?.[f.key] !== null) {
        const problem = linksProblem(values[f.key], f.label);
        if (problem) { errors[f.key] = problem; continue; }
      }
      if (!f.required) continue;
      /* رزرو بدون تاریخ (`form-presets.ts` → `SERVICE_INFO`): تاریخِ عمل وقتی بیمار
         صریحاً «هنوز معلوم نیست» زده اجباری نیست — ستاره همان ستاره است، فقط این
         یک شرط کنارش. */
      if (f.key === 'opDate' && isUndated(values?.[UNDATED_KEY])) continue;
      /* ⚠️ عکس و پرداخت مقدارشان در `values` نمی‌نشیند — فایل به `Document`
         می‌رود و شماره‌های حساب از لینک خوانده می‌شوند. ستاره‌ی رویشان اگر
         این‌جا سنجیده می‌شد، فرمی می‌ساخت که هیچ‌وقت ذخیره نمی‌شود. */
      if (VALUELESS_TYPES.has(f.type)) continue;
      const v = values?.[f.key];
      const empty =
        v === undefined || v === null ||
        (typeof v === 'string' && v.trim() === '') ||
        (Array.isArray(v) && v.length === 0) ||
        (f.type === 'rating' && !Number(v)) ||
        /* ⚠️ عکس یک **ارجاع** است، نه رشته. آبجکتِ خالی «پر» حساب می‌شد اگر
           فقط `null` را می‌سنجیدیم — و فرمی که آپلودش نیمه‌کاره مانده بی‌صدا
           ذخیره می‌شد. */
        (f.type === 'image' && !isImageRef(v)) ||
        (f.type === 'links' && !hasLinkRef(v));
      if (empty) errors[f.key] = `«${f.label}» را کامل کنید`;
    }
    return { ok: Object.keys(errors).length === 0, errors };
  }

  /** همان، ولی به‌جای گزارش، ۴۰۰ می‌اندازد — برای مسیرهای نوشتن. */
  async assertValid(formKey: string, values: Record<string, any>) {
    const r = await this.validate(formKey, values);
    if (!r.ok) throw new BadRequestException(Object.values(r.errors).join('، '));
  }

  /**
   * مقادیر را دو تکه می‌کند: آنچه به **ستون** می‌رود و آنچه به `Visit.extra`.
   *
   * ⚠️ تنها مرجعِ این تقسیم `BUILTIN_VISIT_KEYS` است. کلیدی که آن‌جا نباشد به
   * JSON می‌رود — بی‌صدا و بدونِ خطا. برای همین `addField` کلیدهای رزروشده را
   * رد می‌کند و نگهبانِ CI هم‌خوانیِ فهرست با قالب‌ها را می‌سنجد.
   */
  split(values: Record<string, any>) {
    const columns: Record<string, any> = {};
    const extra: Record<string, any> = {};
    for (const [k, v] of Object.entries(values ?? {})) {
      if (BUILTIN_VISIT_KEYS.has(k)) columns[k] = v;
      else extra[k] = v;
    }
    return { columns, extra };
  }
}

/**
 * آیا مقدارِ فیلدِ عکس واقعاً به فایلی اشاره می‌کند؟
 *
 * ⚠️ رشته هم پذیرفته می‌شود چون مسیرِ عمومیِ فرم فعلاً فقط یک URL برمی‌گرداند
 * و مسیرِ داشبورد آبجکتِ کامل — تحمیلِ یک شکل یعنی یکی از دو مسیر بی‌صدا
 * «خالی» خوانده می‌شود.
 */
/** یک لینک هست؟ — همان معنایِ «پر بودن» برای ستارهٔ باکسِ لینک. */
function hasLinkRef(v: any): boolean {
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.some((x) => hasLinkRef(x));
  return !!(v && typeof v === 'object' && typeof v.url === 'string' && v.url.trim() !== '');
}

/** سقفِ لینک‌های یک باکس — همان ۱۰ِ باکسِ عکس. */
export const MAX_FIELD_LINKS = 10;

export type LinkItem = {
  url: string; title: string | null; user: string | null; pass: string | null; kind: string | null;
  /** توضیحِ صوتیِ همین لینک — ارجاع به مدرکِ WAVِ آپلودشده (بستهٔ ۶د). */
  voice?: { id: number; name: string | null; seconds: number | null } | null;
};

/**
 * مقدارِ باکسِ لینک را نرمال می‌کند یا با ۴۰۰ (پیامِ فارسی) رد می‌کند.
 *
 * شکلِ ذخیره: `[{ url, title, user, pass, kind }]`. `kind` دستهٔ مدرکِ همان
 * لینک در پرونده است (تصویربرداری/آزمایش/…) و اگر نیامده باشد از دستهٔ فیلد
 * می‌آید. ردیفِ بدونِ نشانی بی‌صدا حذف می‌شود (ردیفِ خالیِ نیمه‌کاره خطا نیست).
 *
 * ⚠️ فقط `http(s)`: `javascript:`/`file:`/`data:` روی صفحهٔ پرونده کلیک‌شدنی
 * می‌شود — همان قاعدهٔ `addDocumentLink`.
 */
export function normalizeLinks(v: any, label = 'لینک'): LinkItem[] {
  const list = Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v];
  const out: LinkItem[] = [];
  const clip = (x: any, n: number) => { const t = typeof x === 'string' ? x.trim() : ''; return t ? t.slice(0, n) : null; };
  for (const item of list) {
    const raw = typeof item === 'string' ? item : item && typeof item === 'object' ? item.url : '';
    const urlText = typeof raw === 'string' ? raw.trim() : '';
    if (!urlText) continue;
    let url: URL;
    try { url = new URL(urlText); } catch { throw new BadRequestException(`«${label}»: نشانی معتبر نیست — کاملش را با https بگذارید`); }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BadRequestException(`«${label}»: فقط لینکِ http/https پذیرفته می‌شود`);
    const o = item && typeof item === 'object' ? item : {};
    const kind = typeof o.kind === 'string' && (DOCUMENT_CATEGORIES as readonly string[]).includes(o.kind) ? o.kind : null;
    /* ارجاعِ صدا فقط شناسه و برچسب است؛ اینکه آن مدرک واقعاً صدای **همین**
       بیمار باشد را `syncLinkDocuments` هنگامِ وصل‌کردن می‌سنجد. */
    const v = o.voice && typeof o.voice === 'object' ? o.voice : null;
    const vid = v && Number.isInteger(Number(v.id)) && Number(v.id) > 0 ? Number(v.id) : null;
    const voice = vid
      ? { id: vid, name: clip(v.name, 120), seconds: Number.isFinite(Number(v.seconds)) ? Math.round(Number(v.seconds)) : null }
      : null;
    out.push({ url: url.toString().slice(0, 2000), title: clip(o.title, 120), user: clip(o.user, 120), pass: clip(o.pass, 120), kind, ...(voice ? { voice } : {}) });
    if (out.length > MAX_FIELD_LINKS) throw new BadRequestException(`«${label}»: حداکثر ${MAX_FIELD_LINKS} لینک`);
  }
  return out;
}

/** همان `normalizeLinks`، ولی به‌جای پرتاب، پیامِ خطا (یا null) — برای گزارشِ اعتبارسنجی. */
function linksProblem(v: any, label: string): string | null {
  try { normalizeLinks(v, label); return null; } catch (e: any) { return e?.message ?? 'نشانی معتبر نیست'; }
}

/** دستهٔ مدرکِ باکسِ عکس/لینک — از فهرستِ بسته، وگرنه `null` (متفرقه). */
function normDocCategory(x: any): string | null {
  if (x === undefined || x === null || x === '') return null;
  const s = String(x).trim();
  if (!(DOCUMENT_CATEGORIES as readonly string[]).includes(s)) throw new BadRequestException('دستهٔ مدرک نامعتبر است');
  return s;
}

function isImageRef(v: any): boolean {
  if (typeof v === 'string') return v.trim() !== '';
  /* از #66 کادرِ عکس **چندتایی** است: آرایهٔ خالی یعنی هیچ عکسی نگذاشته. */
  if (Array.isArray(v)) return v.some((x) => isImageRef(x));
  return !!(v && typeof v === 'object' && (v.id || v.url));
}

/**
 * گزینه‌ها را به آرایه‌ی `{v,l}` نرمال می‌کند.
 *
 * ⚠️ ورودی می‌تواند متنِ چندخطی باشد (کاربر در textarea تایپ می‌کند) یا آرایه‌ی
 * آماده (کلاینتِ تازه). هر دو را می‌پذیرد چون فرمِ ویرایش ساده‌ترین راه را
 * برای کاربر می‌خواهد و API ساختارِ درست را.
 *
 * ⚠️ «a=b=c» به `{v:'a', l:'b=c'}` تبدیل می‌شود — اولین `=` جداکننده است. عمدی
 * است: برچسبِ فارسی ممکن است `=` داشته باشد، ولی کلیدِ ماشینی نه.
 */
function normOptions(input: any, type: string): any {
  if (type !== 'select' && type !== 'multiselect') return [];
  const raw = Array.isArray(input)
    ? input
    : String(input ?? '').split(/\r?\n/).filter((x) => x.trim());
  return raw
    .map((o: any) => {
      if (o && typeof o === 'object') {
        const v = String(o.v ?? o.value ?? '').trim();
        const l = String(o.l ?? o.label ?? v).trim();
        return v ? { v, l: l || v } : null;
      }
      const s = String(o ?? '').trim();
      if (!s) return null;
      const i = s.indexOf('=');
      return i > 0
        ? { v: s.slice(0, i).trim(), l: s.slice(i + 1).trim() || s.slice(0, i).trim() }
        : { v: s, l: s };
    })
    .filter(Boolean);
}
