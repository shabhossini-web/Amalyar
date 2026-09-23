import { receiptIdsOf } from './intake-docs';

/**
 * **برگشت برای اصلاح — به کدام مرحله** (مالک، ۱۴۰۵/۰۷/۰۱: «مرحله باید انتخاب شود و پیام به بیمار برود»).
 * خالص، بی‌Prisma؛ `intake.service.ts → returnForFix()` و نمای عمومی از همین می‌خوانند.
 *
 * تا دیروز «بازگرداندن» یک یادداشت بود و همیشه به «در انتظارِ واریز» می‌برد: بیمار نمی‌دانست
 * کجای فرم را باید درست کند، فیشِ غلط سرِ جایش می‌ماند، و اگر ایراد در اطلاعاتِ خدمت بود
 * راهی برای ویرایشش نبود مگر دوباره فیش فرستادن.
 *
 * ⚠️ هویت مرحلهٔ برگشت نیست: غلطِ هویتی را تأییدکننده خودش در کارتِ هویتِ پاپ‌آپ درست می‌کند.
 *
 * ⚠️ **فایل‌های مرحلهٔ برگشت‌خورده کنار گذاشته می‌شوند، پاک نه** (پیش‌فرضِ مالک): فیشِ
 * جایگزین‌شده هم سند است. مدرک در پرونده می‌ماند؛ فقط ارجاعش از پاسخِ فرم به `_returns`
 * می‌رود تا نه در صفِ تأیید دیده شود نه به مراجعه بچسبد.
 */
export const RETURN_STAGES = {
  service: {
    label: 'اطلاعاتِ خدمت', status: 'pending_fill',
    hint: 'اطلاعاتِ خدمت را اصلاح و دوباره ثبت کنید؛ فیش و مدارکِ قبلی سرِ جایشان هستند.',
  },
  documents: {
    label: 'مدارک', status: 'pending_fill',
    hint: 'مدارک را دوباره بارگذاری و فرم را ثبت کنید؛ فیشِ قبلی سرِ جایش است.',
  },
  receipt: {
    label: 'فیشِ واریزی', status: 'pending_payment',
    hint: 'فیشِ تازه بارگذاری کنید؛ اطلاعات و مدارکِ قبلی سرِ جایشان هستند.',
  },
  all: {
    label: 'همه', status: 'pending_fill',
    hint: 'اطلاعات و مدارک را دوباره ثبت و فیشِ تازه بارگذاری کنید.',
  },
} as const;
export type ReturnStage = keyof typeof RETURN_STAGES;
export const isReturnStage = (v: unknown): v is ReturnStage =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(RETURN_STAGES, v);

/** کلیدِ تاریخچهٔ برگشت‌ها در `data` — با `_` شروع می‌شود، پس هیچ فیلدِ فرمی (`KEY_RE`) نیست و بیمار نمی‌نویسدش. */
export const RETURNS_KEY = '_returns';

export interface ReturnEntry {
  stage: ReturnStage;
  note: string;
  at: string;
  by: number | null;
  /** ارجاعِ عکس‌های کنارگذاشته، به تفکیکِ کادر. */
  images?: Record<string, unknown[]>;
  /** شناسهٔ فیش‌های کنارگذاشته. */
  receipts?: number[];
}

/**
 * دادهٔ ثبت‌نام بعد از برگشت + وضعیتِ تازه.
 *
 * @param imageKeys کادرهای عکسِ فرم — فقط همین‌ها «مدرک»‌اند (نه هر شیءِ `{id}`ی در داده).
 */
export function applyReturn(
  data: unknown,
  stage: ReturnStage,
  imageKeys: readonly string[],
  meta: { note: string; at: string; by: number | null },
): { data: Record<string, unknown>; status: string } {
  const next: Record<string, any> = { ...((data ?? {}) as Record<string, unknown>) };
  const entry: ReturnEntry = { stage, note: meta.note, at: meta.at, by: meta.by };
  if (stage === 'documents' || stage === 'all') {
    const images: Record<string, unknown[]> = {};
    for (const k of imageKeys) {
      const v = next[k];
      const list = Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : [];
      if (list.length) images[k] = list;
      delete next[k];
    }
    entry.images = images;
  }
  if (stage === 'receipt' || stage === 'all') {
    entry.receipts = receiptIdsOf(next);
    delete next.receiptDocumentId;
    delete next.receiptDocumentIds;
  }
  const history = Array.isArray(next[RETURNS_KEY]) ? next[RETURNS_KEY] : [];
  next[RETURNS_KEY] = [...history, entry];
  return { data: next, status: RETURN_STAGES[stage].status };
}

/**
 * دادهٔ فرم برای **بیمار** — بی‌تاریخچهٔ برگشت. بیمار برگشتِ جاری را از `currentReturn` می‌بیند؛
 * تاریخچه شناسهٔ تأییدکننده و ارجاعِ فایل‌های کنارگذاشته را دارد که مالِ پنل است نه صفحهٔ عمومی.
 */
export function withoutReturns<T>(data: T): T {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const { [RETURNS_KEY]: _omit, ...rest } = data as Record<string, unknown>;
  return rest as T;
}

/** تاریخچه برای پاپ‌آپِ تأیید — بی‌ارجاعِ فایل‌ها. */
export function returnsOf(data: unknown) {
  const list = (data as any)?.[RETURNS_KEY];
  return (Array.isArray(list) ? list : [])
    .filter((r: any) => isReturnStage(r?.stage))
    .map((r: ReturnEntry) => ({ stage: r.stage, stageLabel: RETURN_STAGES[r.stage].label, note: r.note, at: r.at }));
}

/** برگشتِ **جاری** برای صفحهٔ بیمار — فقط تا وقتی بیمار هنوز اصلاح را نفرستاده. */
export function currentReturn(data: unknown, status: string) {
  if (status !== 'pending_fill' && status !== 'pending_payment') return null;
  const last = returnsOf(data).at(-1);
  return last ? { ...last, hint: RETURN_STAGES[last.stage].hint } : null;
}
