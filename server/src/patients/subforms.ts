import { BadRequestException } from '@nestjs/common';
import { toEnDigits } from '../common/identity';
import { fieldRoles, jobRoleLabel } from '../common/job-roles';
import { LEVEL } from '../common/levels';
import { DOCUMENT_PHASES } from './document-categories';

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
 * ⚠️ **مرحله در فرمِ عمل** (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳، دور دوم): «در عمل، فرمی که الصاق
 * می‌شود باید معلوم باشد مالِ قبل، حین یا بعد از عمل است.» پس هر بند در عمل مرحلهٔ خودش را
 * دارد (`phase`، همان واژگانِ مدارک) و یک زیرفرم در چند مرحله الصاق می‌شود — علائمِ حیاتیِ
 * قبل و بعد از عمل که تا دیروز دو کادرِ ثابت در تب‌ها بودند. مراجعهٔ غیرجراحی مرحله ندارد.
 * درخواست‌ها هنوز در تبِ «قبل از عمل»ِ فرمِ عمل‌اند، پس `orders` فقط غیرجراحی است.
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

/** زیرفرمِ داخلی روی این نوع مراجعه الصاق می‌شود؟ درخواست‌ها در تبِ «قبل از عمل»ِ فرمِ عمل‌اند. */
export function builtinAllowed(key: BuiltinSubformKey, kind: string, vertical: string): boolean {
  if (key === 'orders') return kind !== 'surgery';
  return vertical === 'clinic';
}

/** مرحله‌های فرمِ عمل — همان واژگانِ مدارک و علائمِ حیاتی، نه فهرستِ دوم. */
export const SUBFORM_PHASES = DOCUMENT_PHASES;

/**
 * مرحلهٔ یک بند: در **عمل** یکی از سه مرحله و اجباری؛ در غیرجراحی خالی.
 *
 * ⚠️ پیش‌فرضِ بی‌صدا («قبل از عمل») عمداً نیست: بندی که مرحله ندارد از کلاینتِ کهنه آمده و
 * نشاندنش در مرحلهٔ اشتباه یعنی پاسخی که کسی در تبِ درست پیدایش نمی‌کند.
 */
export function subformPhase(raw: unknown, kind: string): string {
  const p = raw === undefined || raw === null ? '' : typeof raw === 'string' ? raw.trim() : null;
  if (p === null) throw new BadRequestException('مرحلهٔ زیرفرم نامعتبر است');
  if (kind === 'surgery') {
    if (!(SUBFORM_PHASES as readonly string[]).includes(p)) {
      throw new BadRequestException('در فرمِ عمل، مرحلهٔ زیرفرم را مشخص کنید — قبل، حین یا بعد از عمل');
    }
    return p;
  }
  if (p) throw new BadRequestException('مرحلهٔ زیرفرم فقط در فرمِ عمل معنا دارد');
  return '';
}

/**
 * مرحلهٔ پیش‌فرضِ یک زیرفرم وقتی خودِ کاربر مرحله را نگفته — مهاجرتِ ردیف‌های قدیمی و تغییرِ
 * «ویزیت → عمل». «فرم پیگیریِ پس از عمل» مالِ «بعد» است؛ بقیه (ارزیابی‌ها) «قبل».
 * ⚠️ همین قاعده در migrationِ `20260929000000_subform_phase` هم هست.
 */
export const defaultSurgeryPhase = (key: string): string => (key === 'subform.postop' ? 'post' : 'pre');

/** شناسهٔ یک الصاق در یک مراجعه — کلید + مرحله (همان یکتاییِ جدول). */
export const subformSlot = (key: string, phase: string) => `${key}@${phase}`;

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
export type SubformInput = { key?: unknown; phase?: unknown; data?: unknown; removed?: unknown };

/** بندِ سنجیده‌شده، آمادهٔ نوشتن. */
export type SubformPlanItem = {
  key: string;
  /** مرحلهٔ فرمِ عمل (`pre`/`intra`/`post`)؛ خالی در غیرجراحی. */
  phase: string;
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
    const phase = subformPhase(item?.phase, ctx.kind);
    const slot = subformSlot(key, phase);
    if (seen.has(slot)) throw new BadRequestException('یک زیرفرم دو بار در یک درخواست آمده است');
    seen.add(slot);
    const removed = item.removed === true;
    if (isBuiltinSubform(key)) {
      const b = BUILTIN_SUBFORMS[key];
      if (!removed && !builtinAllowed(key, ctx.kind, ctx.vertical)) {
        throw new BadRequestException(`«${b.title}» روی این نوعِ مراجعه الصاق نمی‌شود`);
      }
      out.push({ key, phase, title: b.title, builtin: true, formId: null, inactive: false, removed, fields: [] });
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
      key, phase, title: def.title, builtin: false, formId: def.id, inactive: !def.active, removed, data,
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
  const bySlot = new Map(rows.map((r) => [subformSlot(r.key, r.phase ?? ''), r]));
  for (const item of plan) {
    const row = bySlot.get(subformSlot(item.key, item.phase));
    if (item.removed) {
      if (item.builtin) {
        /* عمل: فقط اندازه‌گیری‌های **همان مرحله** برداشتن را می‌بندند؛ غیرجراحی: همه. */
        const inPhase = item.phase ? { phase: item.phase } : {};
        if (item.key === 'vitals' && await tx.vitalSign.count({ where: { visitId: visit.id, ...inPhase } })) {
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
        visitId: visit.id, key: item.key, phase: item.phase, formId: item.formId, data: (item.data ?? {}) as any,
        createdById: user?.id ?? null,
      },
    });
  }
}

/**
 * نمای زیرفرم‌های یک مراجعه — فقط در نمای **کامل** (`subforms`، `_count` و مرحلهٔ
 * اندازه‌گیری‌ها خوانده شده).
 *
 * ترتیب: به‌ازای هر مرحله (غیرجراحی: یکی)، داخلی‌ها اول (علائم، درخواست)، بعد فرم‌ساز به
 * ترتیبِ الصاق — همان ترتیبی که مالک در طرحِ مصوب دید. داخلیِ بی‌ردیف ولی داده‌دار هم
 * «الصاق‌شده» است (`implicit`): عملی که پیش از این بسته علائمِ قبل/بعد از عمل داشت، کارتش را
 * در همان تب می‌بیند.
 */
export function subformsOf(v: any): any[] | undefined {
  if (!Array.isArray(v?.subforms)) return undefined;
  const c = v._count ?? {};
  const surgery = v.kind === 'surgery';
  const phases: string[] = surgery ? [...SUBFORM_PHASES] : [''];
  const vitalRows: { phase: string | null }[] = Array.isArray(v.vitals) ? v.vitals : [];
  const countOf = (key: BuiltinSubformKey, phase: string): number => {
    if (key === 'orders') {
      return (c.labOrders ?? 0) + (c.imagingOrders ?? 0) + (c.consultOrders ?? 0) + (c.referralOrders ?? 0);
    }
    /* غیرجراحی همهٔ اندازه‌ها را یک‌جا دارد؛ عمل هر مرحله را جدا. */
    return phase ? vitalRows.filter((r) => (r.phase ?? '') === phase).length : (c.vitals ?? vitalRows.length);
  };
  const rows = [...v.subforms].sort((a: any, b: any) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const out: any[] = [];
  for (const phase of phases) {
    const here = rows.filter((r: any) => (r.phase ?? '') === phase);
    for (const key of BUILTIN_SUBFORM_KEYS) {
      /* فرمِ عمل درخواست‌ها را در تبِ «قبل از عمل» دارد — الصاقِ جدا نشان داده نمی‌شود. */
      if (surgery && key === 'orders') continue;
      const row = here.find((r: any) => r.key === key);
      const n = countOf(key, phase);
      if (!row && !n) continue;
      out.push({
        key, phase, builtin: true, formId: null, implicit: !row,
        title: BUILTIN_SUBFORMS[key].title, hasData: n > 0, count: n,
        data: null, derived: {}, attachedAt: row?.createdAt ?? null, updatedAt: row?.updatedAt ?? null,
      });
    }
    for (const row of here) {
      if (isBuiltinSubform(row.key)) continue;
      out.push({
        key: row.key, phase, builtin: false, formId: row.formId, implicit: false,
        title: row.form?.title ?? row.key,
        hasData: subformDataHasValue(row.data), data: row.data ?? {}, derived: subformDerived(row.data),
        attachedAt: row.createdAt, updatedAt: row.updatedAt,
      });
    }
  }
  return out;
}

/**
 * **تغییرِ نوعِ مراجعه ↔ مرحلهٔ زیرفرم‌ها** — خالص؛ خروجی را `PatientsService.update` داخلِ
 * همان تراکنش اجرا می‌کند.
 *
 * - غیرجراحی → عمل: هر الصاق مرحلهٔ پیش‌فرضِ خودش را می‌گیرد (`defaultSurgeryPhase`: ارزیابی‌ها
 *   «قبل از عمل» — ارزیابیِ ویزیت همان ارزیابیِ پیش از عمل است — و پیگیریِ پس از عمل «بعد»).
 * - عمل → غیرجراحی: مرحله‌ها یکی می‌شوند. داخلیِ چندمرحله‌ای (علائمِ قبل و بعد) یک الصاق
 *   می‌ماند — داده‌اش جای خودش است. فرم‌سازیِ چندمرحله‌ای فقط وقتی یکی می‌شود که حداکثر یکی
 *   پاسخ داشته باشد؛ دو پاسخ یعنی دو سند و یکی‌کردنشان یعنی دورریختنِ یکی — پس رد.
 */
export function planKindPhases(
  rows: { id: number; key: string; phase: string; data: unknown; title?: string | null }[],
  toSurgery: boolean,
): { moves: { id: number; phase: string }[]; drops: number[]; conflict: string | null } {
  const moves: { id: number; phase: string }[] = [];
  const drops: number[] = [];
  if (toSurgery) {
    for (const r of rows) if (!r.phase) moves.push({ id: r.id, phase: defaultSurgeryPhase(r.key) });
    return { moves, drops, conflict: null };
  }
  const byKey = new Map<string, typeof rows>();
  for (const r of rows) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);
  for (const [key, list] of byKey) {
    const answered = isBuiltinSubform(key) ? [] : list.filter((r) => subformDataHasValue(r.data));
    if (answered.length > 1) return { moves: [], drops: [], conflict: list[0].title ?? key };
    const keep = answered[0] ?? list[0];
    if (keep.phase) moves.push({ id: keep.id, phase: '' });
    for (const r of list) if (r.id !== keep.id) drops.push(r.id);
  }
  return { moves, drops, conflict: null };
}
