/**
 * ریاضیِ داراییِ امانی — **خالص**، بدونِ Prisma و Nest.
 *
 * جدا شده به همان دلیلِ `stock-math` و `asset-window`: هم سرویس از آن می‌خواند
 * هم آزمون مستقیم صدایش می‌زند، و CI می‌تواند بدونِ دیتابیس bundle‌اش کند.
 */
const DAY = 86400_000;

/**
 * موعدِ صورت‌برداریِ بعدی.
 *
 * مبنا **آخرین شمارش** است، و اگر هرگز شمرده نشده، **روزِ سپردن**. اگر مبنا را
 * فقط «آخرین شمارش» بگیریم، امانی‌ای که یک‌بار هم شمرده نشده هیچ‌وقت سررسید
 * نمی‌گیرد — یعنی دقیقاً همان که بیشتر از همه باید شمرده شود از فهرست می‌افتد.
 *
 * دورهٔ خالی یعنی «دوره‌ای نیست» → `null`، نه صفر: صفر همه را همیشه عقب‌افتاده
 * نشان می‌دهد و هشدار بی‌معنا می‌شود.
 */
export function countDueAt(
  lastCountedAt: Date | null | undefined,
  consignedAt: Date | null | undefined,
  everyDays: number | null | undefined,
): Date | null {
  const n = Number(everyDays);
  if (!Number.isFinite(n) || n <= 0) return null;
  const base = lastCountedAt ?? consignedAt;
  if (!base) return null;
  return new Date(+base + n * DAY);
}

/** `overdue` | `due_soon` (تا ۷ روز) | `ok` | `none` (دوره تعریف نشده). */
export function countStatus(dueAt: Date | null, now: Date): 'overdue' | 'due_soon' | 'ok' | 'none' {
  if (!dueAt) return 'none';
  const diff = +dueAt - +now;
  if (diff < 0) return 'overdue';
  if (diff <= 7 * DAY) return 'due_soon';
  return 'ok';
}

export const COUNT_STATUS_LABELS: Record<string, string> = {
  overdue: 'عقب‌افتاده',
  due_soon: 'نزدیک',
  ok: 'به‌روز',
  none: 'بدونِ دوره',
};

export type CountLine = { label: string; expected: number; counted: number; used: number };

/**
 * تطبیقِ یک صورت‌برداری.
 *
 * `shortfall = expected − counted` است و بعد به دو تکه می‌شکند: `used` که
 * کاربر اعلام کرده مصرف شده (قابلِ فاکتور)، و `missing` که باقی‌مانده است
 * (زیانِ شرکت). `used` بیشتر از کسری به کسریِ واقعی سنجاق می‌شود تا جمعِ
 * دو تکه هرگز از کل بیشتر نشود.
 *
 * `counted > expected` هم ممکن است (قلمِ اضافه از ستِ دیگر) → `extra`.
 */
export function reconcileCount(lines: CountLine[]) {
  const rows = lines.map((l) => {
    const expected = Math.max(0, Math.trunc(Number(l.expected) || 0));
    const counted = Math.max(0, Math.trunc(Number(l.counted) || 0));
    const shortfall = Math.max(0, expected - counted);
    const used = Math.min(Math.max(0, Math.trunc(Number(l.used) || 0)), shortfall);
    return {
      label: l.label,
      expected,
      counted,
      shortfall,
      used,
      missing: shortfall - used,
      extra: Math.max(0, counted - expected),
    };
  });
  return {
    lines: rows,
    totals: {
      expected: rows.reduce((s, r) => s + r.expected, 0),
      counted: rows.reduce((s, r) => s + r.counted, 0),
      used: rows.reduce((s, r) => s + r.used, 0),
      missing: rows.reduce((s, r) => s + r.missing, 0),
      extra: rows.reduce((s, r) => s + r.extra, 0),
    },
  };
}
