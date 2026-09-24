import { BadRequestException } from '@nestjs/common';
import { LEVEL } from '../common/levels';
import { fieldRoles, jobRoleLabel } from '../common/job-roles';
import { answerParts } from './record.service';

/**
 * **فرمِ تکمیلیِ موضوعِ ویزیت** (بستهٔ ۹ — بندِ «ه» گزارشِ HIS).
 *
 * مدیر در تعریف‌ها به هر موضوع (مثلاً «ویزیتِ زیبایی») یک فرمِ زیرپرونده وصل
 * می‌کند؛ با انتخابِ همان موضوع، فرمش داخلِ فرمِ مراجعه پر می‌شود و پاسخ‌ها در
 * `visit_supplements` (یک ردیف به‌ازای مراجعه و فرم) می‌نشینند.
 *
 * ⚠️ **تنها نویسنده** `writeSupplement` است — ساخت و ویرایشِ مراجعه هر دو از
 * همین رد می‌شوند. قاعده‌ها (فیلدِ ناشناخته، ستاره، نقشِ هر فیلد) زیرِ قفلِ ردیفِ
 * مراجعه و روی **حاصلِ ادغام** با ردیفِ فعلی سنجیده می‌شوند، نه روی ردیفِ کهنه.
 */

/**
 * فیلدهایی که داخلِ فرمِ مراجعه پر **نمی‌شوند**: عکس آپلودِ جدا می‌خواهد (سندِ
 * پرونده، نه مقدار) و پرداخت مالِ بیمار است. همان مجموعه‌ای که کلاینت رندر نمی‌کند.
 */
export const SUPPLEMENT_SKIP_TYPES = new Set(['image', 'payment']);

export type SupplementIn = { formId: number; values: Record<string, unknown> };
export type SupplementForm = { id: number; title: string; fields: any[] };

/** ورودیِ `supplement` → شکلِ سنجیده، یا `undefined` (دست نزن). */
export function supplementInput(raw: unknown): SupplementIn | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('فرمِ تکمیلی نامعتبر است');
  const formId = Number((raw as any).formId);
  if (!Number.isInteger(formId) || formId < 1) throw new BadRequestException('فرمِ تکمیلی نامعتبر است');
  const values = (raw as any).values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new BadRequestException('پاسخ‌های فرمِ تکمیلی نامعتبر است');
  return { formId, values };
}

/**
 * تعریفِ فرم — **پیش از** تراکنش (تلهٔ PGliteِ تک‌اتصال: کوئریِ بیرونِ tx داخلِ
 * callbackِ tx قفل می‌کند). فقط فیلدهای فعال و رندرشدنی.
 */
export async function loadSupplementForm(prisma: any, formId: number): Promise<SupplementForm> {
  const f = await prisma.formDef.findUnique({
    where: { id: formId },
    select: {
      id: true, title: true, scope: true, active: true, followUp: true,
      fields: {
        where: { deletedAt: null, active: true },
        orderBy: [{ page: 'asc' }, { sort: 'asc' }, { id: 'asc' }],
        select: { key: true, label: true, type: true, required: true, role: true, roles: true, active: true, options: true },
      },
    },
  });
  if (!f || f.scope !== 'record' || f.followUp) throw new BadRequestException('فرمِ تکمیلی پیدا نشد');
  if (!f.active) throw new BadRequestException('این فرمِ تکمیلی غیرفعال شده است');
  return { id: f.id, title: f.title, fields: f.fields.filter((x: any) => !SUPPLEMENT_SKIP_TYPES.has(x.type)) };
}

/* مقایسهٔ بی‌اعتنا به ترتیبِ کلیدها: مقدارِ لینکِ ذخیره‌شده با همان مقدارِ دوباره‌فرستاده‌شده
   نباید «تغییر» شمرده شود، وگرنه قفلِ نقش روی فیلدِ دست‌نخورده می‌افتد (بازبینی). */
const canon = (v: unknown): string => JSON.stringify(v ?? null, (_k, x) =>
  (x && typeof x === 'object' && !Array.isArray(x)) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as any)[k]])) : x);
const same = (a: unknown, b: unknown) => canon(a) === canon(b);

/**
 * نوشتنِ پاسخ‌ها — داخلِ تراکنشِ ساخت/ویرایشِ مراجعه.
 *
 * - فرم باید فرمِ **موضوعِ نهاییِ** همین مراجعه باشد، یا از قبل ردیفی برای همین
 *   مراجعه داشته باشد (موضوع بعداً عوض شد؛ پاسخِ قبلی همچنان اصلاح‌پذیر است).
 * - کلیدِ ناشناخته ۴۰۰ — نه دور ریختنِ بی‌صدا («ذخیره شد ✓» روی پاسخی که ننشست).
 * - ستاره‌ها روی حاصلِ ادغام، با همان تعریفِ «خالی»ِ موتورِ فرم (`validate`).
 * - نقشِ هر فیلد: فقط مقدارِ **تغییرکرده** سنجیده می‌شود (echoِ بی‌تغییر آزاد) —
 *   همان قاعدهٔ `assertRoleOwnership`؛ سوپرادمین و حسابِ بی‌نقش آزاد.
 */
export async function writeSupplement(
  tx: any,
  args: {
    visitId: number; topicId: number | null; form: SupplementForm; values: Record<string, unknown>; user: any;
    validate: (fields: any[], values: Record<string, any>) => { ok: boolean; errors: Record<string, string> };
    normalize: (fields: any[], values: Record<string, any>) => Record<string, any> | undefined;
  },
) {
  const { visitId, form } = args;
  await tx.$queryRaw`SELECT id FROM visits WHERE id = ${visitId} FOR UPDATE`;
  const row = await tx.visitSupplement.findUnique({ where: { visitId_formId: { visitId, formId: form.id } } });
  if (!row) {
    const topic = args.topicId ? await tx.visitTopic.findUnique({ where: { id: args.topicId }, select: { formId: true } }) : null;
    if (topic?.formId !== form.id) throw new BadRequestException('این فرمِ تکمیلی مالِ موضوعِ این مراجعه نیست');
  }
  const byKey = new Map(form.fields.map((f: any) => [f.key, f]));
  for (const k of Object.keys(args.values)) {
    if (!byKey.has(k)) throw new BadRequestException('فیلدی از فرمِ تکمیلی دیگر در فرم نیست — فرم را دوباره باز کنید');
  }
  const current: Record<string, any> = (row?.data as any) ?? {};
  const merged: Record<string, any> = { ...current, ...(args.normalize(form.fields, args.values as any) ?? {}) };
  const changedKeys = form.fields.map((f: any) => f.key).filter((k: string) => k in (args.values as any) && !same(current[k], merged[k]));

  /* نقش — فقط وقتی کاربر نقشِ شغلی دارد و سوپرادمین نیست. */
  const myRole: string | null = (args.user?.level ?? 0) >= LEVEL.SUPER_ADMIN ? null : (args.user?.jobRole ?? null);
  if (myRole) {
    for (const k of changedKeys) {
      const roles = fieldRoles(byKey.get(k));
      if (roles.length && !roles.includes(myRole)) {
        const f: any = byKey.get(k);
        throw new BadRequestException(`«${f.label}» بخشِ ${roles.map(jobRoleLabel).join('، ')} است و با حسابِ ${jobRoleLabel(myRole)} ویرایش نمی‌شود`);
      }
    }
  }
  /* ستاره‌ها فقط روی فیلدهایی که همین نقش می‌تواند بنویسد — فرمِ چندنقشی وگرنه هیچ‌وقت ذخیره نمی‌شد (بازبینی). */
  const mine = myRole ? form.fields.filter((f: any) => { const r = fieldRoles(f); return !r.length || r.includes(myRole); }) : form.fields;
  const check = args.validate(mine, merged);
  if (!check.ok) throw new BadRequestException(Object.values(check.errors).join('، '));
  if (row && !changedKeys.length) return { changed: false, changedKeys: [] as string[] };
  const blank = (x: unknown) => x == null || (typeof x === 'string' && !x.trim()) || (Array.isArray(x) && !x.length);
  if (!row && Object.values(merged).every(blank)) {
    /* فرمِ کاملاً خالی ردیف نمی‌سازد — «باز شد و بسته شد» پاسخ نیست. */
    return { changed: false, changedKeys: [] as string[] };
  }
  await tx.visitSupplement.upsert({
    where: { visitId_formId: { visitId, formId: form.id } },
    create: { visitId, formId: form.id, data: merged },
    update: { data: merged },
  });
  return { changed: true, changedKeys };
}

/**
 * نمای خواندنی — برچسب از خودِ فرم، شکل‌دهیِ پاسخ از `answerParts` (همان تابعِ
 * پاسخ‌های پرونده). `values` خام هم می‌آید تا فرمِ ویرایش پرشده باز شود.
 */
export function supplementsView(rows: any[] | undefined) {
  if (rows === undefined) return undefined;
  return rows.map((r) => {
    const data: Record<string, any> = r.data ?? {};
    const fields: any[] = r.form?.fields ?? [];
    const known = new Set(fields.map((f) => f.key));
    const answers = fields
      .filter((f) => !SUPPLEMENT_SKIP_TYPES.has(f.type) && data[f.key] !== undefined)
      .map((f) => ({ key: f.key, label: f.label, type: f.type, ...answerParts(data[f.key] ?? '') }))
      /* کلیدِ فیلدِ حذف‌شده هم دیده شود — پاسخ دور ریخته نمی‌شود. */
      .concat(Object.keys(data).filter((k) => !known.has(k)).map((k) => ({ key: k, label: k, type: 'text', ...answerParts(data[k] ?? '') })))
      .filter((a) => a.text.trim() !== '');
    return { formId: r.formId, formTitle: r.form?.title ?? null, values: data, answers, updatedAt: r.updatedAt ?? null };
  });
}

/** شکلِ `include`ِ نمای کامل — یک جا، تا مراجعه و پرونده یک چیز بخوانند. */
export const SUPPLEMENT_INCLUDE = {
  orderBy: { id: 'asc' as const },
  select: {
    formId: true, data: true, updatedAt: true,
    form: {
      select: {
        id: true, title: true,
        fields: {
          where: { deletedAt: null },
          orderBy: [{ page: 'asc' as const }, { sort: 'asc' as const }, { id: 'asc' as const }],
          select: { key: true, label: true, type: true },
        },
      },
    },
  },
};
