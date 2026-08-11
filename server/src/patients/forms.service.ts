import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { BUILTIN_VISIT_KEYS, PRESETS, PresetForm } from './form-presets';

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

export const FIELD_TYPES = [
  'text', 'textarea', 'number', 'money', 'select', 'multiselect',
  'date', 'time', 'bool', 'phone', 'rating', 'image', 'payment',
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
 * ترتیبِ واقعیِ فیلدها: صفحه، بعد ترتیبِ داخلِ صفحه، بعد id برای گره‌گشایی.
 *
 * ⚠️ عمداً بدونِ `as const`: Prisma برای `orderBy` یک آرایهٔ **تغییرپذیر**
 * می‌خواهد و `readonly` را رد می‌کند.
 */
const FIELD_ORDER = {
  fields: { orderBy: [{ page: 'asc' as const }, { sort: 'asc' as const }, { id: 'asc' as const }] },
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
    return rows.map((f) => this.view(f));
  }

  /** یک فرم با کلیدش — همان چیزی که رندرکننده‌ی فرم صدا می‌زند. */
  async byKey(key: string) {
    await this.ensureSeeded();
    const row = await this.prisma.formDef.findUnique({
      where: { key },
      include: FIELD_ORDER,
    });
    if (!row) throw new NotFoundException('فرم پیدا نشد');
    return this.view(row);
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
    return row ? this.view(row) : null;
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
  async visitKinds() {
    await this.ensureSeeded();
    const rows = await this.prisma.formDef.findMany({
      where: { scope: 'visit', active: true },
      select: { visitKind: true, title: true },
      orderBy: { id: 'asc' },
    });
    return rows
      .filter((r) => r.visitKind)
      .map((r) => ({ kind: r.visitKind as string, title: r.title }));
  }

  /**
   * شکلِ خروجیِ فرم.
   *
   * ⚠️ `color` هیچ‌وقت خالی برنمی‌گردد: اگر کاربر رنگی نگذاشته، **سرور** رنگِ
   * مشتق از کلید را می‌گذارد. قانون ۱۵ همین است — هیچ فرمولی در render. اگر
   * مشتق‌کردن به کلاینت می‌افتاد، داشبورد و فرم‌ساز و پرتالِ پزشک هرکدام
   * می‌توانستند نسخهٔ خودشان را داشته باشند و رنگِ یک فرم در سه صفحه سه‌جور
   * دیده می‌شد. `colorSet` می‌گوید انتخابِ کاربر بوده یا خودکار، تا فرم‌ساز
   * بتواند «خودکار» را به‌شکلِ خودکار نشان دهد.
   *
   * ⚠️ `pages` هم این‌جا حساب می‌شود نه در مرورگر: هر جای دیگری که بخواهد
   * «این فرم چند صفحه است» را بداند، باید همان `Math.max` را تکرار کند.
   */
  private view(f: any) {
    const fields = (f.fields ?? []).map((x: any) => ({
      id: x.id, key: x.key, label: x.label, type: x.type,
      required: x.required, options: x.options ?? [],
      hint: x.hint, placeholder: x.placeholder,
      sort: x.sort, page: x.page ?? 1, builtin: x.builtin, active: x.active,
    }));
    return {
      id: f.id, key: f.key, title: f.title, scope: f.scope,
      visitKind: f.visitKind, hint: f.hint, active: f.active,
      color: f.color || colorForKey(f.key),
      colorSet: !!f.color,
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
    if (n > 0) return;
    const vertical = await this.config.vertical();
    await this.seedFrom(PRESETS[vertical] ?? []);
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
          color: normColor(f.color),
          fields: {
            create: f.fields.map((x, i) => ({
              key: x.key, label: x.label, type: x.type ?? 'text',
              required: x.required ?? false, builtin: x.builtin ?? false,
              options: (x.options ?? []) as any,
              hint: x.hint ?? null, placeholder: x.placeholder ?? null,
              sort: (i + 1) * 10, page: normPage(x.page),
            })),
          },
        },
      });
    }
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
  async patchForm(id: number, dto: { title?: string; hint?: string; active?: boolean; color?: string | null }) {
    const row = await this.prisma.formDef.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('فرم پیدا نشد');
    await this.prisma.formDef.update({
      where: { id },
      data: {
        ...(dto.title ? { title: dto.title.trim() } : {}),
        ...(dto.hint !== undefined ? { hint: dto.hint?.trim() || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        /* رشته‌ی خالی یعنی «برگرد به خودکار» — پس `null` می‌نشیند، نه ''. */
        ...(dto.color !== undefined ? { color: normColor(dto.color) } : {}),
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
    if (BUILTIN_VISIT_KEYS.has(key)) {
      throw new BadRequestException('این کلید برای فیلدهای هسته‌ای رزرو است — نامِ دیگری بگذارید');
    }
    const dup = await this.prisma.formField.findUnique({ where: { formId_key: { formId, key } } });
    if (dup) throw new BadRequestException('فیلدی با این کلید در همین فرم هست');

    const type = String(dto.type ?? 'text');
    if (!FIELD_TYPES.includes(type as FieldType)) throw new BadRequestException('نوعِ فیلد نامعتبر است');
    const label = String(dto.label ?? '').trim();
    if (label.length < 2) throw new BadRequestException('برچسب کوتاه است');

    /* ⚠️ فقط **یک** باکسِ پرداخت در هر فرم. شماره‌های حساب از
       `IntakeLink.bankAccountId` می‌آیند و لینک یک حساب دارد، پس باکسِ دوم
       همان شماره‌ها را دوباره نشان می‌داد و بیمار فکر می‌کرد باید دو بار
       واریز کند. */
    if (type === 'payment') {
      const has = await this.prisma.formField.count({ where: { formId, type: 'payment' } });
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
        sort: (last?.sort ?? 0) + 10,
        builtin: false,
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
    if (!row) throw new NotFoundException('فیلد پیدا نشد');

    if (dto.type && !FIELD_TYPES.includes(dto.type)) throw new BadRequestException('نوعِ فیلد نامعتبر است');
    if (row.builtin && dto.type && dto.type !== row.type) {
      throw new BadRequestException('نوعِ فیلدِ هسته‌ای عوض نمی‌شود — این مقدار به ستونِ خودش می‌نشیند');
    }
    /* همان قاعدهٔ `addField`: تبدیلِ یک فیلدِ موجود به پرداخت هم نباید باکسِ
       دومی بسازد. `id: { not: row.id }` تا ذخیرهٔ دوبارهٔ خودش خطا ندهد. */
    if (dto.type === 'payment' && row.type !== 'payment') {
      const has = await this.prisma.formField.count({
        where: { formId: row.formId, type: 'payment', id: { not: row.id } },
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
        ...(dto.sort !== undefined ? { sort: Number(dto.sort) || 0 } : {}),
        /* ⚠️ صفحه روی فیلدِ هسته‌ای هم عوض می‌شود: چینش کارِ سوپرادمین است و
           قفلِ builtin فقط دربارهٔ `key` و `type` است، نه جای فیلد. */
        ...(dto.page !== undefined ? { page: normPage(dto.page) } : {}),
      },
    });
    if (dto.page !== undefined) await this.compactPages(row.formId);
    return this.byKey(row.form.key);
  }

  /** حذف — فقط فیلدِ دلخواه. هسته‌ای فقط خاموش می‌شود. */
  async removeField(id: number) {
    const row = await this.prisma.formField.findUnique({ where: { id }, include: { form: true } });
    if (!row) throw new NotFoundException('فیلد پیدا نشد');
    if (row.builtin) {
      throw new BadRequestException('فیلدِ هسته‌ای حذف نمی‌شود — می‌توانید خاموشش کنید');
    }
    await this.prisma.formField.delete({ where: { id } });
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
      where: { formId }, select: { id: true, page: true },
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
      where: { formId },
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
        color: normColor(dto.color),
        /* ⚠️ فرمِ مراجعه بدونِ تاریخ بی‌معنی است — تقویم، گزارشِ بازه‌ای و
           ترتیبِ خطِ درمان همه رویش بنا شده‌اند. پس یک فیلدِ تاریخ از همان
           اول ساخته می‌شود تا کاربر با فرمِ خالیِ بی‌مصرف روبه‌رو نشود. */
        ...(scope === 'visit'
          ? { fields: { create: [{ key: 'opDate', label: 'تاریخ', type: 'date', required: true, builtin: true, sort: 10 }] } }
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
  private async formUsage(row: { id: number; visitKind: string | null }) {
    const [visits, links] = await Promise.all([
      row.visitKind ? this.prisma.visit.count({ where: { kind: row.visitKind } }) : Promise.resolve(0),
      this.prisma.intakeLink.count({ where: { formId: row.id } }),
    ]);
    return { visits, links, total: visits + links };
  }

  async removeForm(id: number) {
    const row = await this.prisma.formDef.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('فرم پیدا نشد');
    const { visits, links, total } = await this.formUsage(row);
    if (total > 0) {
      await this.prisma.formDef.update({ where: { id }, data: { active: false } });
      /* `used` برای سازگاری با کلاینتِ فعلی می‌ماند؛ `visits`/`links` تازه‌اند
         تا پیام بتواند بگوید **چرا** حذف نشد. */
      return { ok: true, deactivated: true, used: total, visits, links };
    }
    await this.prisma.formDef.delete({ where: { id } });
    return { ok: true, deactivated: false, used: 0, visits: 0, links: 0 };
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

    const errors: Record<string, string> = {};
    for (const f of form.fields) {
      if (!f.active || !f.required) continue;
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
        (f.type === 'image' && !isImageRef(v));
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
function isImageRef(v: any): boolean {
  if (typeof v === 'string') return v.trim() !== '';
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
