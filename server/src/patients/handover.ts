/**
 * تحویلِ دوطرفه — توابعِ **خالص** (بی‌Prisma و Nest) تا پنلِ کارشناسی، حمل‌ونقل و انبار یک
 * حرف بزنند (قانونِ ۱۵: فیلدِ مشتق فقط سمتِ سرور).
 *
 * خواستهٔ مالک (۱۴۰۵/۰۷/۱۱): «وقتی یه ست و فرستادیم راننده تحویل و میزنه، کارشناس باید
 * تحویل گرفته شد رو هم بزنه». دستِ اول توقفِ تحویلِ راننده است (`TransportStop.doneAt`)
 * که همان لحظه حواله را ارسال می‌کند؛ دستِ دوم `StockTransfer.techReceivedAt`.
 */

export type DeliveryState = 'not_sent' | 'awaiting' | 'received' | 'received_issue' | 'none';

type TransferLike = {
  status: string;
  techReceivedAt?: Date | string | null;
  techReceiptIssue?: boolean | null;
  techReceiptNote?: string | null;
};
type StopLike = {
  kind?: string | null;
  doneAt?: Date | string | null;
  handedActual?: string | null;
  handedTo?: string | null;
  run?: { staff?: { role?: string | null; person?: { firstName?: string | null; lastName?: string | null } | null } | null } | null;
} | null | undefined;

/** رسیدِ کارشناس — `null` تا وقتی «تحویل گرفتم» نزده. */
export function receiptOf(t: TransferLike) {
  if (!t.techReceivedAt) return null;
  return { at: t.techReceivedAt, issue: !!t.techReceiptIssue, note: t.techReceiptNote ?? null };
}

/** دستِ اولِ تحویل — راننده کِی و به چه کسی داد؛ `null` تا توقفِ تحویل انجام نشده. */
/**
 * **شمارشِ راننده هنگامِ جمع‌آوری** (بستهٔ ج) — امضای رانندهٔ جمع‌آور: کِی شمرد، مغایرت داشت، پلمب سالم بود.
 * مثلِ `receiptOf`، موجودی را جابه‌جا نمی‌کند؛ شمارشِ داخلِ ست کارِ انبار است (شمارشِ برگشت).
 */
export function pickupOf(t: { driverCountedAt?: Date | null; driverCountIssue?: boolean | null; driverSealIntact?: boolean | null; driverCountNote?: string | null }) {
  if (!t.driverCountedAt) return null;
  return { at: t.driverCountedAt, issue: !!t.driverCountIssue, sealIntact: t.driverSealIntact ?? null, note: t.driverCountNote ?? null };
}

export function handoverOf(stop: StopLike) {
  if (!stop || stop.kind !== 'deliver' || !stop.doneAt) return null;
  const p = stop.run?.staff?.person;
  return {
    at: stop.doneAt,
    to: stop.handedActual ?? stop.handedTo ?? null,
    by: p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || null : null,
    role: stop.run?.staff?.role ?? null,
  };
}

/**
 * وضعیتِ تحویل از نگاهِ کارشناس و راننده.
 *
 * - `not_sent`: حوالهٔ برنامه‌ریزی‌شده که راننده هنوز نبرده.
 * - `awaiting`: راننده تحویل داده، کارشناس هنوز تأیید نکرده — کهربایی در هر دو پنل.
 * - `received` / `received_issue`: کارشناس گرفت (سالم / با مغایرت).
 * - `none`: حوالهٔ بی‌توقفِ راننده (ارسالِ مستقیمِ دفتر) یا بسته‌شده — دستِ دومی در کار نیست.
 */
export function deliveryState(t: TransferLike, stop: StopLike): DeliveryState {
  if (t.status === 'planned') return 'not_sent';
  if (t.techReceivedAt) return t.techReceiptIssue ? 'received_issue' : 'received';
  if (t.status === 'closed') return 'none';
  return handoverOf(stop) ? 'awaiting' : 'none';
}
