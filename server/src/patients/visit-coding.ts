import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RETURNABLE } from './assets.service';
import { SIDE_LABELS } from './labels';
import { toEnDigits } from '../common/identity';

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

/** نیازِ اقلامِ یک نوعِ عمل — همان فیلترِ «کالای فعال» که میزِ اتاقِ عمل و پرتالِ جراح داشتند. */
export const NEEDS_SELECT = {
  where: { item: { active: true } },
  orderBy: { id: 'asc' },
  select: {
    itemId: true, quantity: true, notes: true,
    item: { select: { name: true, size: true, assetKind: true } },
  },
} as const;
export const OTHER_PX_KIT = {
  orderBy: { rank: 'asc' },
  select: { procedureTypeId: true, rank: true, procedureType: { select: { name: true, needs: NEEDS_SELECT } } },
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

// ── سمت و سطحِ هر عمل (بستهٔ ۸) ────────────────────────────────────────────

/** ستون‌هایی که خواننده‌ها از `visit_procedure_details` لازم دارند. */
export const PROC_DETAIL_SELECT = { procedureTypeId: true, side: true, level: true } as const;
export type ProcedureDetailIn = { procedureTypeId: number; side: string | null; level: string | null };
const PROC_LEVEL_MAX = 60;

/**
 * ورودیِ `procedureDetails` → فهرستِ نرمال‌شده (یا `undefined` = دست نزن).
 *
 * هر ردیف `{procedureTypeId, side?, level?}`؛ `side` از `SIDE_LABELS`، سطح متنِ
 * آزادِ کوتاه («L4–L5»، «زانو»). ردیفی که هر دو خالی است یعنی «سمت را پاک کن».
 * این‌جا فقط شکل سنجیده می‌شود؛ «عمل روی همین مراجعه هست» در `writeProcedureDetails`
 * و زیرِ قفل — چون فهرستِ عمل‌ها ممکن است همین حالا در همان درخواست عوض شود.
 */
export function procedureDetailsInput(raw: unknown): ProcedureDetailIn[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new BadRequestException('سمتِ عمل‌ها باید فهرست باشد');
  if (raw.length > MAX_OTHERS + 1) throw new BadRequestException('حداکثر ۱۰ عمل برای یک مراجعه');
  const out: ProcedureDetailIn[] = [];
  const seen = new Set<number>();
  for (const r of raw as any[]) {
    const id = Number(r?.procedureTypeId);
    if (!Number.isInteger(id) || id < 1) throw new BadRequestException('شناسهٔ نوعِ عمل نامعتبر است');
    if (seen.has(id)) throw new BadRequestException('یک عمل دو بار آمده است — برای دو طرف «دوطرفه» را بزنید');
    seen.add(id);
    const side = r?.side === undefined || r?.side === null || r?.side === '' ? null : String(r.side);
    if (side !== null && !Object.prototype.hasOwnProperty.call(SIDE_LABELS, side)) throw new BadRequestException('سمتِ عمل نامعتبر است');
    const lv = r?.level === undefined || r?.level === null ? '' : toEnDigits(String(r.level)).trim();
    if (lv.length > PROC_LEVEL_MAX) throw new BadRequestException(`سطح/ناحیهٔ عمل حداکثر ${PROC_LEVEL_MAX} نویسه است`);
    out.push({ procedureTypeId: id, side, level: lv || null });
  }
  return out;
}

/**
 * **فهرستِ نهاییِ عمل‌ها پس از این درخواست** — از برنامهٔ کدگذاری (`planCoding`
 * پیش‌تر `dto` را بازنویسی کرده)، نه با خواندنِ دوباره از پایگاه‌داده وسطِ تراکنش:
 * اصلیِ تازه با `visit.update`ِ آخر نوشته می‌شود، پس خواندنِ میانه اصلیِ قبلی را
 * می‌دید و سمتِ اصلیِ تازه ۴۰۰ می‌گرفت (بازبینیِ طراحیِ بستهٔ ۸).
 */
export function finalProcedureIds(dto: any, cur: Coding): number[] {
  const primary = hasKey(dto, 'procedureTypeId') ? (dto.procedureTypeId ?? null) : cur.primary;
  const others = hasKey(dto, AXES.procedure.twinKey) ? twinOf(dto, 'procedure') : cur.others;
  return dedupe([primary, ...others]);
}

/**
 * نوشتنِ سمت/سطح — **تنها نویسندهٔ** `visit_procedure_details`.
 *
 * - قفلِ همان ردیفِ مراجعه که `writeOthers` می‌گیرد: فرم و میزِ اتاق نمی‌توانند
 *   هم‌زمان یکی فهرست را عوض کند و دیگری سمتِ عملِ رفته را بنویسد.
 * - ردیفِ عملی که دیگر در `finalIds` نیست **همیشه** پاک می‌شود (حتی بی‌`details`)
 *   — سمتِ کهنه نباید با برگشتنِ همان عمل بی‌صدا زنده شود (خطرِ محلِ اشتباه).
 * - `details` فقط عمل‌های حاضر را می‌پذیرد؛ ردیفِ «هر دو خالی» حذف می‌شود.
 */
/** آیا این درخواست محورِ عمل (اصلی یا همزمان‌ها) را دست می‌زند؟ */
export function touchesProcedureAxis(dto: any): boolean {
  return hasKey(dto, 'procedureTypeId') || hasKey(dto, AXES.procedure.twinKey);
}

/** فهرستِ عمل‌های ذخیره‌شدهٔ مراجعه — خوانده‌شده زیرِ همان قفل، پس با ردیف یکی است. */
async function persistedProcedureIds(tx: any, visitId: number): Promise<number[]> {
  const v = await tx.visit.findUnique({
    where: { id: visitId }, select: { procedureTypeId: true, otherProcedures: { select: { procedureTypeId: true } } },
  });
  return dedupe([v?.procedureTypeId ?? null, ...(v?.otherProcedures ?? []).map((o: any) => o.procedureTypeId)]);
}

export async function writeProcedureDetails(tx: any, visitId: number, finalIds: number[] | null, details?: ProcedureDetailIn[]) {
  await tx.$queryRaw`SELECT id FROM visits WHERE id = ${visitId} FOR UPDATE`;
  /* ⚠️ `null` = مرجع فهرستِ ذخیره‌شده است. فهرستِ حساب‌شده از dto فقط وقتی مجاز است که
     محورِ عمل در همین درخواست عوض می‌شود و `visit.update` هنوز نیامده؛ وگرنه با ردیفِ
     واقعی ناسازگار می‌شود — سمتِ زنده پاک یا سمتِ عملِ رفته زنده می‌ماند (بازبینی). */
  const ids = finalIds ?? await persistedProcedureIds(tx, visitId);
  await tx.visitProcedureDetail.deleteMany({ where: { visitId, procedureTypeId: { notIn: ids.length ? ids : [-1] } } });
  for (const d of details ?? []) {
    if (!ids.includes(d.procedureTypeId)) {
      throw new BadRequestException('سمت برای عملی آمده که روی این مراجعه نیست');
    }
    if (d.side === null && d.level === null) {
      await tx.visitProcedureDetail.deleteMany({ where: { visitId, procedureTypeId: d.procedureTypeId } });
      continue;
    }
    await tx.visitProcedureDetail.upsert({
      where: { visitId_procedureTypeId: { visitId, procedureTypeId: d.procedureTypeId } },
      create: { visitId, procedureTypeId: d.procedureTypeId, side: d.side, level: d.level },
      update: { side: d.side, level: d.level },
    });
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

export type ProcedureEntry = {
  id: number | null; name: string; rank: number; primary: boolean;
  /** فقط وقتی `procedureDetails` خوانده شده (نمای کامل، میزِ اتاق) — وگرنه کلید نیست. */
  side?: string | null; sideFa?: string | null; level?: string | null;
};
export type DiagnosisEntry = { id: number; title: string; icdCode: string | null; rank: number; primary: boolean };

/** فهرستِ چیپ‌ها — `id: null` فقط برای متنِ قدیمیِ بی‌تعریف (`opType`). */
export function procedureList(v: any): ProcedureEntry[] {
  const out: ProcedureEntry[] = [];
  const p = principalProcedureName(v);
  if (p) out.push({ id: v?.procedureTypeId ?? null, name: p, rank: 1, primary: true });
  for (const o of v?.otherProcedures ?? []) {
    if (o.procedureType?.name) out.push({ id: o.procedureTypeId, name: o.procedureType.name, rank: o.rank, primary: false });
  }
  /* ⚠️ سمت کلیدِ جداست و هرگز داخلِ `name`/`procedureLabel` نمی‌رود: اثرِ انگشتِ
     فاکتور، گروه‌بندیِ گزارش و برابریِ بایت‌به‌بایتِ پرامپتِ AI روی همان نام‌اند. */
  if (Array.isArray(v?.procedureDetails)) {
    const by = new Map<number, any>(v.procedureDetails.map((d: any) => [d.procedureTypeId, d]));
    for (const e of out) {
      const d = e.id != null ? by.get(e.id) : undefined;
      e.side = d?.side ?? null;
      e.sideFa = d?.side ? SIDE_LABELS[d.side] ?? d.side : null;
      e.level = d?.level ?? null;
    }
  }
  return out;
}

/** «چپ · L4–L5» برای ردیفِ کوتاه (تابلوی اتاقِ عمل) — تهی وقتی هیچ سمتی ثبت نشده. */
export function procedureSidesText(v: any): string | null {
  const parts = procedureList(v)
    .filter((e) => e.sideFa || e.level)
    .map((e) => [e.sideFa, e.level].filter(Boolean).join(' · '));
  return parts.length ? parts.join('، ') : null;
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

// ── کیت (نیازِ اقلام) ──────────────────────────────────────────────────────

export type Need = {
  itemId: number; quantity: number; notes?: string | null;
  item?: { name?: string; size?: string | null; assetKind?: string };
};

/**
 * **اجتماعِ نیازها** — دو عمل در یک جلسه یعنی اقلامِ هر دو.
 *
 * - مصرفی (یا بی‌نوع) → **جمع**: دو عمل دو برابر گاز/پیچ می‌خواهد.
 * - ست/دستگاه (`RETURNABLE`) → **بیشینه**: یک ست برای دو عمل در همان
 *   جلسه کافی است؛ جمع یعنی بردنِ دو دستگاهِ بی‌مصرف.
 * - یادداشت‌ها بی‌تکرار با « · ».
 *
 * ⚠️ ادغام **پیش از** `resolveRequirements` لازم است: آن تابع کالای تکراری را
 * ۴۰۰ می‌کند، پس الحاقِ سادهٔ دو قالب تأییدِ پذیرش را می‌شکست.
 * ترتیب: اولین ظهور — اصلی اول.
 */
export function mergeNeeds(lists: Need[][]): Need[] {
  const nonEmpty = lists.filter((l) => l?.length);
  if (nonEmpty.length <= 1) return nonEmpty[0] ?? [];
  const by = new Map<number, Need & { _notes: string[] }>();
  for (const list of nonEmpty) {
    for (const n of list) {
      const prev = by.get(n.itemId);
      const note = n.notes?.trim();
      if (!prev) {
        by.set(n.itemId, { ...n, _notes: note ? [note] : [] });
        continue;
      }
      const returnable = RETURNABLE.includes(prev.item?.assetKind ?? n.item?.assetKind ?? 'consumable');
      prev.quantity = returnable ? Math.max(prev.quantity, n.quantity) : prev.quantity + n.quantity;
      if (note && !prev._notes.includes(note)) prev._notes.push(note);
    }
  }
  return [...by.values()].map(({ _notes, ...n }) => ({ ...n, notes: _notes.length ? _notes.join(' · ') : null }));
}

/**
 * قالبِ کیتِ مراجعه از **همهٔ** عمل‌ها — فقط fallbackِ الگو؛ هر خواننده قاعدهٔ
 * override خودش را روی `requiredItems` نگه می‌دارد (یکی‌کردنِ آن سه قاعده
 * تغییرِ رفتارِ جداگانه‌ای است). بدونِ سایرین همان فهرستِ دیروز، دست‌نخورده.
 */
export function kitTemplate(v: any): Need[] {
  const primary: Need[] = v?.procedureType?.needs ?? [];
  if (!v?.otherProcedures?.length) return primary;
  return mergeNeeds([primary, ...v.otherProcedures.map((o: any) => o.procedureType?.needs ?? [])]);
}
