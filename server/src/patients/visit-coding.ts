import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * **کدگذاریِ بالینیِ مراجعه — تشخیص‌ها و عمل‌ها** (بستهٔ ۷ب/۷ج).
 *
 * خواستهٔ مالک: «تشخیص با امکانِ چند تشخیص» و «چند عمل همزمان تو یک مراجعه».
 *
 * ⚠️ **مدل:** اصلی (رتبهٔ ۱) همان ستونِ `Visit.diagnosisId`/`procedureTypeId`
 * است و سایرین (رتبهٔ ۲ به بعد) در `visit_other_diagnoses`/`visit_other_procedures`.
 * «دقیقاً یک اصلی» را ساختار تضمین می‌کند، و بیست‌وچند خواننده‌ای که فقط اصلی
 * را لازم دارند (سهم، فاکتور، پیامکِ مراقبت، …) و نویسنده‌هایی که مستقیم ستون
 * را می‌نویسند (import، فیکسچرهای Prisma) دست‌نخورده درست می‌مانند. نسخهٔ
 * «همه در جدول + ستونِ آینه» دو منبع برای یک واقعیت می‌ساخت — همان اشتباهِ
 * `opType` که کامنتِ schema دربارهٔ‌اش هشدار می‌دهد.
 *
 * ⚠️ **این فایل تنها صاحبِ این دو محور است** — هم نوشتن (`planCoding` →
 * `writeOthers`) و هم هر مشتقی (برچسب، فهرست، فیلتر، کیت). نگهبانِ CI بیرون
 * از این فایل `.diagnosis?.title` / `.procedureType?.name` / نوشتن در جدول‌های
 * `visitOther*` را رد می‌کند؛ پانزده کپیِ `procedureType?.name ?? opType` با
 * fallbackهای کمی متفاوت همین‌جا یکی شدند.
 *
 * **قراردادِ کلیدهای خروجی (همهٔ endpointها):**
 * - `procedureTypeName`، `diagnosisTitle`، `procedureTypeId`، `diagnosisId` →
 *   **همیشه اصلی**.
 * - `procedureLabel`، `diagnosisLabel` → **برچسبِ ترکیبی** (اصلی اول).
 * - کلیدهای فقط‌نمایشیِ بی‌همزادِ id (`procedure`، `procedureName`، `diagnosis`ِ
 *   میزِ اتاقِ عمل) → مقدارشان برچسب می‌شود؛ برای تک‌مورد همان مقدارِ دیروز.
 * - `procedures[]` / `diagnoses[]` → فقط جایی که صفحه چیپ می‌کشد.
 */

export type Axis = 'diagnosis' | 'procedure';
export type Coding = { primary: number | null; others: number[] };

/** سقف: یک اصلی + ۹ دیگر در هر محور. */
export const MAX_OTHERS = 9;

/**
 * کلیدِ «سایرین» در کنارِ کلیدِ اصلیِ فرم.
 *
 * ⚠️ کلیدِ فرم (`diagnosisId`) معنایش عوض **نشد**: ستاره، اعتبارسنجیِ ویرایش و
 * مالکیتِ نقش همه روی همین کلیدِ فرم‌ساز سوارند (ردیف‌های `form_fields`ِ هر
 * نصب با همین نام ذخیره شده‌اند). فهرستِ سایرین کلیدِ همزاد دارد و مالکیتش
 * همان مالکیتِ فیلدِ اصلی است (`assertRoleOwnership`، و `CODING_TWIN_OWNER` در
 * VisitForm.jsx که نگهبانِ CI هم‌خوانی‌شان را می‌سنجد).
 */
export const CODING_TWIN = { diagnosisId: 'otherDiagnosisIds', procedureTypeId: 'otherProcedureTypeIds' } as const;
export const CODING_TWIN_KEYS: ReadonlySet<string> = new Set(Object.values(CODING_TWIN));

const AXES = {
  diagnosis: {
    primaryKey: 'diagnosisId', twinKey: 'otherDiagnosisIds', relation: 'otherDiagnoses',
    model: 'visitOtherDiagnosis', refKey: 'diagnosisId', dict: 'diagnosis', nameField: 'title',
    notFound: 'تشخیص یافت نشد',
    cap: 'حداکثر ۱۰ تشخیص برای یک مراجعه (یک اصلی و ۹ دیگر)',
  },
  procedure: {
    primaryKey: 'procedureTypeId', twinKey: 'otherProcedureTypeIds', relation: 'otherProcedures',
    model: 'visitOtherProcedure', refKey: 'procedureTypeId', dict: 'procedureType', nameField: 'name',
    notFound: 'نوعِ عمل یافت نشد',
    cap: 'حداکثر ۱۰ عمل برای یک مراجعه (یک اصلی و ۹ دیگر)',
  },
} as const;
const ALL_AXES: Axis[] = ['diagnosis', 'procedure'];

// ── includeها ──────────────────────────────────────────────────────────────

/* ⚠️ `orderBy: rank` همه‌جا: ترتیب دادهٔ بالینی است، و برچسبِ ترکیبی در
   اثرانگشتِ فاکتور و متنِ پرامپت می‌نشیند — ترتیبِ نامعین یعنی شمارهٔ رسمیِ
   تازه یا کشِ AIِ بی‌اثر. */
export const OTHER_DX = {
  orderBy: { rank: 'asc' },
  select: { diagnosisId: true, rank: true, diagnosis: { select: { title: true, icdCode: true, active: true } } },
} as const;
export const OTHER_PX = {
  orderBy: { rank: 'asc' },
  select: { procedureTypeId: true, rank: true, procedureType: { select: { name: true, active: true } } },
} as const;

// ── سمتِ نوشتن ─────────────────────────────────────────────────────────────

const hasKey = (o: any, k: string) => o != null && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

/** کپیِ خامِ چهار کلید، پیش از اینکه `planCoding` رویشان بنویسد (مسیرِ «مراجعهٔ هدف»ِ پذیرش). */
export function pickCodingKeys(dto: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of ALL_AXES) {
    const { primaryKey, twinKey } = AXES[a];
    if (hasKey(dto, primaryKey)) out[primaryKey] = dto[primaryKey];
    if (hasKey(dto, twinKey)) out[twinKey] = Array.isArray(dto[twinKey]) ? [...dto[twinKey]] : dto[twinKey];
  }
  return out;
}

/** وضعیتِ فعلی از ردیفِ مراجعه (ستون + رابطه). رابطهٔ نخوانده = بدونِ سایرین. */
export function currentCoding(v: any): Record<Axis, Coding> {
  return {
    diagnosis: {
      primary: v?.diagnosisId ?? null,
      others: (v?.otherDiagnoses ?? []).map((o: any) => o.diagnosisId),
    },
    procedure: {
      primary: v?.procedureTypeId ?? null,
      others: (v?.otherProcedures ?? []).map((o: any) => o.procedureTypeId),
    },
  };
}
export const EMPTY_CODING: Record<Axis, Coding> = {
  diagnosis: { primary: null, others: [] },
  procedure: { primary: null, others: [] },
};

const dedupe = (ids: number[]) => [...new Set(ids.filter((x) => x != null))];

/**
 * **برنامهٔ نوشتن** — خالص؛ مقادیرِ نهایی را روی خودِ `dto` می‌نویسد تا بقیهٔ
 * مسیر (ستارهٔ فرم، مالکیتِ نقش، `resolveRefs`) همان چیزی را ببیند که ذخیره
 * می‌شود.
 *
 * | درخواست | نتیجه، با وضعیتِ فعلیِ (P, [O…]) |
 * |---|---|
 * | هیچ‌کدام از دو کلید | دست نمی‌خورد |
 * | فقط `other*Ids: [a,b]` | سایرین = [a,b] به همین ترتیب، بی‌تکرار، منهای P |
 * | `other*Ids: []` یا `null` | سایرین پاک؛ P می‌ماند |
 * | فقط کلیدِ اصلی `X` (کلاینتِ کهنه، تأییدِ پذیرش، API) | P = X؛ اگر X از سایرین بود از آن‌جا برمی‌خیزد؛ P قبلی می‌رود؛ بقیه می‌مانند |
 * | فقط کلیدِ اصلی `null` | اگر سایرین هست، اولی اصلی می‌شود؛ وگرنه P = null |
 * | هر دو | همان‌طور که آمده؛ اگر P خالی و فهرست پُر، اولیِ فهرست اصلی می‌شود |
 *
 * ⚠️ «کلیدِ اصلیِ null + سایرینِ حاضر» عمداً ۴۰۰ نمی‌دهد: کلاینتِ کهنهٔ PWA که
 * فقط یک انتخابگر دارد با پاک‌کردنش سایرینِ نادیده را نباید بی‌صدا ببرد، و
 * ۴۰۰ یعنی هیچ ویرایشِ دیگرِ همان ذخیره هم نمی‌نشست.
 */
export function planCoding(dto: any, cur: Record<Axis, Coding>, axes: Axis[] = ALL_AXES): Partial<Record<Axis, Coding>> {
  const out: Partial<Record<Axis, Coding>> = {};
  for (const axis of axes) {
    const { primaryKey, twinKey, cap } = AXES[axis];
    const sentP = hasKey(dto, primaryKey);
    const sentO = hasKey(dto, twinKey);
    if (!sentP && !sentO) continue;
    const c = cur[axis];
    let p: number | null = sentP ? (dto[primaryKey] ?? null) : c.primary;
    let o = dedupe(sentO ? (dto[twinKey] ?? []) : c.others).filter((x) => x !== p);
    if (p == null && o.length) p = o.shift()!;
    if (o.length > MAX_OTHERS) throw new BadRequestException(cap);
    dto[twinKey] = o;
    if (sentP || p !== c.primary) dto[primaryKey] = p;
    out[axis] = { primary: p, others: o };
  }
  return out;
}

/** محورهایی که این درخواست به آن‌ها دست زده (پس از `planCoding`). */
export const touchedAxes = (dto: any): Axis[] => ALL_AXES.filter((a) => hasKey(dto, AXES[a].twinKey));
export const twinOf = (dto: any, axis: Axis): number[] => dto?.[AXES[axis].twinKey] ?? [];

/**
 * وجود و فعال‌بودنِ «سایرین».
 *
 * ⚠️ غیرفعال فقط برای **افزودنِ تازه** رد می‌شود؛ تعریفی که همین حالا روی
 * این مراجعه است (اصلی یا سایر) باید بتواند بماند، جابه‌جا شود یا اصلی
 * شود — وگرنه غیرفعال‌کردنِ یک تشخیص در تعاریف، ویرایشِ هر مراجعه‌ای را که
 * آن را دارد قفل می‌کرد. اصلی همان قاعدهٔ امروزِ `resolveRefs` را دارد.
 */
export async function assertCodingRefs(tx: any, axis: Axis, others: number[], alreadyAttached: (number | null)[]) {
  if (!others.length) return;
  const { dict, nameField, notFound } = AXES[axis];
  const rows: any[] = await tx[dict].findMany({
    where: { id: { in: others } },
    select: { id: true, active: true, [nameField]: true },
  });
  if (rows.length !== new Set(others).size) throw new NotFoundException(notFound);
  const kept = new Set(alreadyAttached.filter((x) => x != null));
  const bad = rows.find((r) => !r.active && !kept.has(r.id));
  if (bad) {
    throw new BadRequestException(`«${bad[nameField]}» غیرفعال است و افزوده نمی‌شود — از تعاریفِ پایه فعالش کنید`);
  }
}

/** ساختِ تو‌در‌تو برای `visit.create` — یک عبارت، پس پاسخ همان لحظه سایرین را دارد. */
export function othersCreate(axis: Axis, others: number[]) {
  const { refKey } = AXES[axis];
  return { create: others.map((id, i) => ({ [refKey]: id, rank: i + 2 })) };
}
export function othersCreateData(plan: Partial<Record<Axis, Coding>>) {
  const data: Record<string, unknown> = {};
  for (const axis of ALL_AXES) {
    const o = plan[axis]?.others ?? [];
    if (o.length) data[AXES[axis].relation] = othersCreate(axis, o);
  }
  return data;
}

/**
 * نوشتنِ «سایرین» — جایگزینیِ کامل، تنها نویسندهٔ این دو جدول.
 *
 * ⚠️ ذخیرهٔ بی‌تغییر **هیچ ردیفی** نمی‌نویسد (id‌ها ثابت می‌مانند)؛ و قفلِ
 * ردیفِ مراجعه جلوی P2002ِ دو جایگزینیِ هم‌زمان را می‌گیرد. «آخرین نوشتن
 * برنده است» — مثلِ هر فیلدِ دیگرِ مراجعه.
 */
export async function writeOthers(tx: any, visitId: number, axis: Axis, others: number[]) {
  const { model, refKey } = AXES[axis];
  await tx.$queryRaw`SELECT id FROM visits WHERE id = ${visitId} FOR UPDATE`;
  const now: any[] = await tx[model].findMany({ where: { visitId }, orderBy: { rank: 'asc' }, select: { [refKey]: true } });
  if (now.length === others.length && now.every((r, i) => r[refKey] === others[i])) return;
  await tx[model].deleteMany({ where: { visitId } });
  if (others.length) {
    await tx[model].createMany({ data: others.map((id, i) => ({ visitId, [refKey]: id, rank: i + 2 })) });
  }
}

// ── سمتِ خواندن ────────────────────────────────────────────────────────────

/** نامِ عملِ اصلی — رابطه اگر بود، وگرنه عکسِ لحظه‌ای (`opType`؛ رکوردِ قدیمی/تعریفِ حذف‌شده). */
export function principalProcedureName(v: any): string | null {
  return v?.procedureType?.name ?? v?.opType ?? null;
}
export function principalDiagnosisTitle(v: any): string | null {
  return v?.diagnosis?.title ?? null;
}

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x && !!x.trim()))];

/** نامِ همهٔ عمل‌ها، اصلی اول، به ترتیبِ رتبه. */
export function procedureNames(v: any): string[] {
  return uniq([principalProcedureName(v), ...(v?.otherProcedures ?? []).map((o: any) => o.procedureType?.name)]);
}
export function diagnosisTitles(v: any): string[] {
  return uniq([principalDiagnosisTitle(v), ...(v?.otherDiagnoses ?? []).map((o: any) => o.diagnosis?.title)]);
}
export function procedureLabel(v: any): string | null {
  return procedureNames(v).join(' + ') || null;
}
export function diagnosisLabel(v: any): string | null {
  return diagnosisTitles(v).join('، ') || null;
}
export function procedureIds(v: any): number[] {
  return dedupe([v?.procedureTypeId ?? null, ...(v?.otherProcedures ?? []).map((o: any) => o.procedureTypeId)]);
}
export function diagnosisIds(v: any): number[] {
  return dedupe([v?.diagnosisId ?? null, ...(v?.otherDiagnoses ?? []).map((o: any) => o.diagnosisId)]);
}
/** شناسه‌های سایرین برای فرم — `undefined` وقتی رابطه خوانده نشده (نخوانده ≠ خالی). */
export function otherIds(v: any, axis: Axis): number[] | undefined {
  const rel = v?.[AXES[axis].relation];
  if (!Array.isArray(rel)) return undefined;
  return rel.map((o: any) => o[AXES[axis].refKey]);
}

export type ProcedureEntry = { id: number | null; name: string; rank: number; primary: boolean };
export type DiagnosisEntry = { id: number; title: string; icdCode: string | null; rank: number; primary: boolean };

/** فهرستِ چیپ‌ها — `id: null` فقط برای متنِ قدیمیِ بی‌تعریف (`opType`). */
export function procedureList(v: any): ProcedureEntry[] {
  const out: ProcedureEntry[] = [];
  const p = principalProcedureName(v);
  if (p) out.push({ id: v?.procedureTypeId ?? null, name: p, rank: 1, primary: true });
  for (const o of v?.otherProcedures ?? []) {
    if (o.procedureType?.name) out.push({ id: o.procedureTypeId, name: o.procedureType.name, rank: o.rank, primary: false });
  }
  return out;
}
export function diagnosisList(v: any): DiagnosisEntry[] {
  const out: DiagnosisEntry[] = [];
  if (v?.diagnosis?.title) {
    out.push({ id: v.diagnosisId, title: v.diagnosis.title, icdCode: v.diagnosis.icdCode ?? null, rank: 1, primary: true });
  }
  for (const o of v?.otherDiagnoses ?? []) {
    if (o.diagnosis?.title) out.push({ id: o.diagnosisId, title: o.diagnosis.title, icdCode: o.diagnosis.icdCode ?? null, rank: o.rank, primary: false });
  }
  return out;
}

/**
 * **«مراجعه‌ای که X دارد»** — در هر رتبه‌ای. فیلترِ فهرست، خروجی، آمار،
 * جستجوی شرح‌ها و زمینهٔ AI همه از همین می‌خوانند تا «بیمارانِ دیابتی» همراهِ
 * بیماری‌های همراه هم باشد و فهرست و خروجی هرگز دو عددِ متفاوت ندهند.
 */
export function visitHasProcedure(id: number) {
  return { OR: [{ procedureTypeId: id }, { otherProcedures: { some: { procedureTypeId: id } } }] };
}
export function visitHasDiagnosis(id: number) {
  return { OR: [{ diagnosisId: id }, { otherDiagnoses: { some: { diagnosisId: id } } }] };
}
/** جستجوی آزاد روی نامِ سایرین — کنارِ بندهای اصلی و `opType`. */
export function codingSearchOr(v: string): any[] {
  return [
    { otherProcedures: { some: { procedureType: { name: { contains: v, mode: 'insensitive' } } } } },
    { otherDiagnoses: { some: { diagnosis: { title: { contains: v, mode: 'insensitive' } } } } },
  ];
}

/**
 * فهرست برای پرامپتِ AI. تک‌مورد **بایت‌به‌بایت** همان دیروز است (کشِ
 * پاسخ‌ها و نمونه‌های تست دست نمی‌خورند)؛ چندمورد اصلی را صریح می‌گوید.
 */
export function promptList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names[0]} (اصلی)، ${names.slice(1).join('، ')}`;
}
