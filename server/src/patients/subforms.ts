import { BadRequestException } from '@nestjs/common';
import { toEnDigits } from '../common/identity';
import { fieldRoles, jobRoleLabel } from '../common/job-roles';
import { LEVEL } from '../common/levels';

/**
 * **زیرفرم‌های مراجعه** (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳) — هستهٔ خالص، بی‌DI.
 *
 * «هر چیزی که به مراجعه اضافه می‌کنیم در قالبِ فرم‌های زیرِ مراجعه باشد — پیش‌فرض
 * پنهان، و با الصاق نمایش داده شود.» تا دیروز علائمِ حیاتی همیشه وسطِ فرم بود،
 * درخواست‌ها دو بار (چیپِ تصمیم و دکمه‌های سفارش) دیده می‌شدند، و هر فیلدِ تازه
 * یعنی یک کادرِ همیشگیِ دیگر برای **همهٔ** مراجعه‌ها.
 *
 * ⚠️ دو جنس، یک قرارداد:
 * - **داخلی** (`vitals` / `orders`): داده جای خودش است (`vital_signs`، جدول‌های
 *   سفارش) و فقط «الصاق» در `visit_subforms` می‌نشیند. مراجعه‌ای که اندازه‌گیری یا
 *   سفارش دارد بی‌ردیف هم الصاق‌شده دیده می‌شود — دادهٔ پیش از این بسته گم نمی‌شود.
 * - **فرم‌ساز** (`FormDef.scope = 'subform'`): پاسخ‌ها در `visit_subforms.data`.
 *
 * ⚠️ فرمِ عمل علائمِ حیاتی و درخواست‌ها را از قبل در تب‌های قبل/حین/بعد دارد؛ پس
 * زیرفرمِ داخلی فقط روی مراجعهٔ **غیرجراحی** الصاق می‌شود (`builtinAllowed`).
 */

export const BUILTIN_SUBFORMS = {
  vitals: {
    title: 'فرم علائمِ حیاتی', short: 'علائمِ حیاتی',
    hint: 'فشار، نبض، تنفس، دما، اکسیژن، وزن، قد، درد',
  },
  orders: {
    title: 'فرم درخواستِ پاراکلینیک و مشاوره', short: 'درخواستِ پاراکلینیک',
    hint: 'آزمایش، تصویربرداری، مشاوره، نامهٔ ارجاع',
  },
} as const;
export type BuiltinSubformKey = keyof typeof BUILTIN_SUBFORMS;
export const BUILTIN_SUBFORM_KEYS = Object.keys(BUILTIN_SUBFORMS) as BuiltinSubformKey[];

export const isBuiltinSubform = (key: string): key is BuiltinSubformKey =>
  Object.prototype.hasOwnProperty.call(BUILTIN_SUBFORMS, key);

/** گروه‌های پنجرهٔ «الصاقِ فرم» — ترتیبِ همین آرایه ترتیبِ پنجره است. */
export const SUBFORM_GROUPS = [
  { key: 'common', label: 'پرکاربرد' },
  { key: 'assess', label: 'ارزیابی' },
  { key: 'surgery', label: 'جراحی' },
  { key: 'custom', label: 'فرم‌های ساختِ خودتان' },
] as const;

/**
 * گروهِ زیرفرم‌های آماده (`SUBFORM_PRESETS`) — از روی **کلید**، نه عنوان: مدیر عنوان را
 * عوض می‌کند و زیرفرم نباید از گروهش بیرون بپرد. هر زیرفرمِ دیگری «ساختِ خودتان» است.
 */
export const SUBFORM_PRESET_GROUP: Record<string, string> = {
  'subform.growth': 'assess',
  'subform.wound': 'assess',
  'subform.postop': 'surgery',
  'subform.asa': 'surgery',
};

/** سقفِ زیرفرم‌های یک درخواست — سدِ ورودیِ نجومی، نه قاعدهٔ کاری. */
export const MAX_SUBFORMS_PER_REQUEST = 20;

/** عنوانِ کوتاه برای اسلاتِ «فرمِ منتخب» — «فرم زخم» → «زخم». */
export function shortTitle(title: string): string {
  const t = String(title ?? '').replace(/^\s*فرم(?:ِ)?\s+/, '').trim();
  return t || String(title ?? '');
}

/** زیرفرمِ داخلی روی این نوع مراجعه الصاق می‌شود؟ (فرمِ عمل آن‌ها را در تب‌ها دارد.) */
export function builtinAllowed(key: BuiltinSubformKey, kind: string, vertical: string): boolean {
  if (kind === 'surgery') return false;
  return key !== 'vitals' || vertical === 'clinic';
}

/**
 * آیا یک مقدار «خالی» است؟ — همان معنای `validateFields`، با یک تفاوتِ عمدی: `false`
 * این‌جا خالی است. «× فقط وقتی خالی است» باید بعد از برداشتنِ یک تیک هم کار کند؛
 * `false`ی که از خاموش‌کردنِ یک کلید مانده، داده‌ای نیست که برداشتنِ زیرفرم را ببندد.
 */
function emptyValue(v: unknown): boolean {
  if (v === undefined || v === null || v === false) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.every(emptyValue);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('id' in o || 'url' in o) return !o.id && !o.url;
    return Object.values(o).every(emptyValue);
  }
  return false;
}

/** پاسخِ زیرفرم چیزی دارد؟ */
export function subformDataHasValue(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return Object.values(data as Record<string, unknown>).some((v) => !emptyValue(v));
}

const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(toEnDigits(String(v)).replace(/[٫,]/g, '.').trim());
  return Number.isFinite(n) ? n : null;
};

/**
 * **مشتق‌های زیرفرم** — قانونِ ۱۵: فرمول فقط سمتِ سرور.
 *
 * BMI برای هر زیرفرمی که `height` (سانتی‌متر) و `weight` (کیلوگرم) دارد، نه فقط «قد و
 * وزن»ِ آماده: فرمی که مدیر خودش با همین کلیدها بسازد هم همین را می‌گیرد. بازهٔ
 * پذیرش همان بازهٔ علائمِ حیاتی است (`vitals.ts`)؛ عددِ بیرونِ آن غلطِ تایپی است و
 * BMIِ ساخته‌شده از آن دروغ.
 */
export function subformDerived(data: unknown): { bmi?: number } {
  if (!data || typeof data !== 'object') return {};
  const d = data as Record<string, unknown>;
  const h = num(d.height);
  const w = num(d.weight);
  if (h == null || w == null || h < 30 || h > 250 || w < 0.5 || w > 400) return {};
  const m = h / 100;
  return { bmi: Math.round((w / (m * m)) * 10) / 10 };
}

/** یک بندِ ورودی — همان شکلی که کلاینت در `subforms` می‌فرستد. */
export type SubformInput = { key?: unknown; data?: unknown; removed?: unknown };

/** بندِ سنجیده‌شده، آمادهٔ نوشتن. */
export type SubformPlanItem = {
  key: string;
  title: string;
  builtin: boolean;
  formId: number | null;
  /** تعریفِ خاموش: فقط ردیفِ **موجود** نوشته می‌شود، الصاقِ تازه نه. */
  inactive: boolean;
  removed: boolean;
  /** پاسخِ نرمال‌شده (فقط فرم‌ساز)؛ `undefined` = «دست نزن». */
  data?: Record<string, unknown>;
  fields: { key: string; label: string; roles?: string[]; role?: string | null }[];
};

/** تعریفِ زیرفرمی که سنجش لازم دارد — همان شکلِ `FormsService.view`. */
export type SubformDef = {
  id: number; key: string; title: string; active: boolean;
  fields: { key: string; label: string; type: string; required?: boolean; active?: boolean; roles?: string[]; role?: string | null }[];
};

/**
 * ورودیِ `subforms` → برنامهٔ نوشتن. **پیش از تراکنش** اجرا می‌شود (کوئریِ تعریف‌ها بیرونِ
 * tx — همان قاعدهٔ `normalizeExtra`؛ روی PGliteِ CI کوئریِ موازی داخلِ tx قفل می‌کند).
 *
 * `undefined` یعنی «زیرفرم‌ها را دست نزن» — فرمی که زیرفرم‌ها را نخوانده ذخیره‌اش نباید
 * چیزی بردارد. هر بند **فقط همان زیرفرم** را عوض می‌کند (دلتا، نه کلِ فهرست).
 */
export async function planSubforms(
  raw: unknown,
  ctx: {
    kind: string; vertical: string;
    defOf: (key: string) => Promise<SubformDef | null>;
    validate: (fields: SubformDef['fields'], data: Record<string, unknown>) => { ok: boolean; errors: Record<string, string> };
    normalize: (fields: SubformDef['fields'], data: Record<string, unknown>) => Record<string, unknown>;
  },
): Promise<SubformPlanItem[] | undefined> {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new BadRequestException('زیرفرم‌ها نامعتبر است');
  if (raw.length > MAX_SUBFORMS_PER_REQUEST) throw new BadRequestException('زیرفرم‌های این درخواست بیش از اندازه است');
  const seen = new Set<string>();
  const out: SubformPlanItem[] = [];
  for (const item of raw as SubformInput[]) {
    const key = typeof item?.key === 'string' ? item.key.trim() : '';
    if (!key || key.length > 80) throw new BadRequestException('کلیدِ زیرفرم نامعتبر است');
    if (seen.has(key)) throw new BadRequestException('یک زیرفرم دو بار در یک درخواست آمده است');
    seen.add(key);
    const removed = item.removed === true;
    if (isBuiltinSubform(key)) {
      const b = BUILTIN_SUBFORMS[key];
      if (!removed && !builtinAllowed(key, ctx.kind, ctx.vertical)) {
        throw new BadRequestException(`«${b.title}» روی این نوعِ مراجعه الصاق نمی‌شود`);
      }
      out.push({ key, title: b.title, builtin: true, formId: null, inactive: false, removed, fields: [] });
      continue;
    }
    const def = await ctx.defOf(key);
    if (!def) throw new BadRequestException(`زیرفرمِ «${key}» پیدا نشد — شاید در فرم‌ساز حذف شده است`);
    let data: Record<string, unknown> | undefined;
    if (item.data !== undefined) {
      if (!item.data || typeof item.data !== 'object' || Array.isArray(item.data)) {
        throw new BadRequestException(`پاسخِ «${def.title}» نامعتبر است`);
      }
      /* فقط کلیدهای خودِ فرم — کلیدِ بیگانه در JSON دفن می‌شد و هیچ‌جا دیده نمی‌شد. */
      const known = new Set(def.fields.map((f) => f.key));
      const picked = Object.fromEntries(Object.entries(item.data as Record<string, unknown>).filter(([k]) => known.has(k)));
      /* ⚠️ برداشتن همراهِ پاسخ = «همین حالا خالی‌اش کردم و برداشتم» (پاک‌کردن و × در یک ذخیره).
         ستاره این‌جا سنجیده نمی‌شود — زیرفرمی که برداشته می‌شود کادرِ اجباری ندارد؛ فقط
         خالی‌بودنش در `writeSubforms` سنجیده می‌شود. بدونِ این، × بعد از پاک‌کردنِ مقادیر
         با «پاسخ دارد» رد می‌شد چون سرور هنوز پاسخِ ذخیره‌شدهٔ قبلی را می‌دید. */
      if (!removed) {
        const check = ctx.validate(def.fields, picked);
        if (!check.ok) throw new BadRequestException(`${def.title}: ${Object.values(check.errors).join('، ')}`);
      }
      data = ctx.normalize(def.fields, picked);
    }
    out.push({
      key, title: def.title, builtin: false, formId: def.id, inactive: !def.active, removed, data,
      fields: def.fields.map((f) => ({ key: f.key, label: f.label, roles: f.roles, role: f.role ?? null })),
    });
  }
  return out;
}

/**
 * «هر کس بخشِ خودش» روی پاسخِ زیرفرم — همان قاعدهٔ `assertRoleOwnership`ِ فرمِ مراجعه:
 * فقط مقدارِ **تغییرکرده** رد می‌شود، سوپرادمین و حسابِ بی‌نقش بیرونِ قاعده‌اند.
 */
export function assertSubformRoles(item: SubformPlanItem, before: Record<string, unknown>, user: any) {
  if (!item.data || (user?.level ?? 0) >= LEVEL.SUPER_ADMIN) return;
  const myRole: string | null = user?.jobRole ?? null;
  if (!myRole) return;
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  for (const f of item.fields) {
    const roles = fieldRoles(f as any);
    if (!roles.length || roles.includes(myRole)) continue;
    if (same(item.data[f.key], before[f.key])) continue;
    throw new BadRequestException(
      `${item.title}: «${f.label}» بخشِ ${roles.map(jobRoleLabel).join('، ')} است و با حسابِ ${jobRoleLabel(myRole)} ویرایش نمی‌شود`,
    );
  }
}

/**
 * نوشتنِ برنامه — **داخلِ همان تراکنشِ ذخیرهٔ مراجعه**، تا زیرفرم و مراجعه هرگز از هم
 * جدا ذخیره نشوند.
 *
 * ⚠️ «برداشتن» فقط وقتی خالی است: زیرفرمی که پاسخ، اندازه‌گیری یا سفارش دارد با یک ×
 * پاک نمی‌شود — دادهٔ بالینی با یک کلیکِ اشتباه نمی‌رود. رابط هم × را فقط روی خالی
 * نشان می‌دهد؛ این سدِ دوم است، برای کلاینتِ کهنه.
 */
export async function writeSubforms(
  tx: any,
  visit: { id: number },
  plan: SubformPlanItem[] | undefined,
  user: any,
) {
  if (!plan?.length) return;
  const rows: any[] = await tx.visitSubform.findMany({ where: { visitId: visit.id } });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const item of plan) {
    const row = byKey.get(item.key);
    if (item.removed) {
      if (item.builtin) {
        if (item.key === 'vitals' && await tx.vitalSign.count({ where: { visitId: visit.id } })) {
          throw new BadRequestException('علائمِ حیاتیِ ثبت‌شده دارد و برداشته نمی‌شود — اول اندازه‌گیری‌ها را حذف کنید');
        }
        if (item.key === 'orders') {
          /* پشتِ‌سرِهم، نه `Promise.all`: کوئریِ موازی روی یک اتصالِ تراکنشی (PGliteِ CI) قفل می‌کرد. */
          let n = 0;
          for (const model of ['labOrder', 'imagingOrder', 'consultOrder', 'referralOrder']) {
            n += await tx[model].count({ where: { visitId: visit.id } });
          }
          if (n) throw new BadRequestException('درخواستِ ثبت‌شده دارد و برداشته نمی‌شود');
        }
      } else if (row && subformDataHasValue(item.data ?? row.data)) {
        throw new BadRequestException(`«${item.title}» پاسخ دارد و برداشته نمی‌شود — اول مقادیرش را پاک کنید`);
      }
      if (row) await tx.visitSubform.delete({ where: { id: row.id } });
      continue;
    }
    if (!row && item.inactive) throw new BadRequestException(`«${item.title}» در فرم‌ساز خاموش است و الصاق نمی‌شود`);
    assertSubformRoles(item, (row?.data as Record<string, unknown>) ?? {}, user);
    if (row) {
      if (item.data !== undefined) {
        await tx.visitSubform.update({ where: { id: row.id }, data: { data: item.data } });
      }
      continue;
    }
    await tx.visitSubform.create({
      data: {
        visitId: visit.id, key: item.key, formId: item.formId, data: (item.data ?? {}) as any,
        createdById: user?.id ?? null,
      },
    });
  }
}

/**
 * نمای زیرفرم‌های یک مراجعه — فقط در نمای **کامل** (`subforms` و `_count` خوانده شده).
 *
 * ترتیب: داخلی‌ها اول (علائم، درخواست)، بعد فرم‌ساز به ترتیبِ الصاق — همان ترتیبی که
 * مالک در طرحِ مصوب دید. داخلیِ بی‌ردیف ولی داده‌دار هم «الصاق‌شده» است (`implicit`).
 */
export function subformsOf(v: any): any[] | undefined {
  if (!Array.isArray(v?.subforms)) return undefined;
  const c = v._count ?? {};
  const counts: Record<BuiltinSubformKey, number> = {
    vitals: c.vitals ?? 0,
    orders: (c.labOrders ?? 0) + (c.imagingOrders ?? 0) + (c.consultOrders ?? 0) + (c.referralOrders ?? 0),
  };
  const rows = [...v.subforms].sort((a: any, b: any) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const out: any[] = [];
  for (const key of BUILTIN_SUBFORM_KEYS) {
    const row = rows.find((r: any) => r.key === key);
    /* فرمِ عمل این دو را در تب‌ها دارد — الصاقِ جدا نشان داده نمی‌شود. */
    if (v.kind === 'surgery') continue;
    if (!row && !counts[key]) continue;
    out.push({
      key, builtin: true, formId: null, implicit: !row,
      title: BUILTIN_SUBFORMS[key].title, hasData: counts[key] > 0, count: counts[key],
      data: null, derived: {}, attachedAt: row?.createdAt ?? null, updatedAt: row?.updatedAt ?? null,
    });
  }
  for (const row of rows) {
    if (isBuiltinSubform(row.key)) continue;
    out.push({
      key: row.key, builtin: false, formId: row.formId, implicit: false,
      title: row.form?.title ?? row.key,
      hasData: subformDataHasValue(row.data), data: row.data ?? {}, derived: subformDerived(row.data),
      attachedAt: row.createdAt, updatedAt: row.updatedAt,
    });
  }
  return out;
}
