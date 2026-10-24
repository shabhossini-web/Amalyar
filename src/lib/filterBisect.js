/**
 * «کدام کلمه فیلتر شد؟» — جستجوی دوبخشی، بدونِ حدس.
 *
 * ملی‌پیامک نمی‌گوید کدام کلمه فیلتر شده؛ پس متن را تکه‌تکه به موبایلِ **خودِ کاربر** می‌فرستیم و می‌پرسیم
 * هر تکه رد می‌شود یا نه. فیلتر «متنی که فلان کلمه را دارد» است، پس یکنواخت است: هر متنِ بزرگ‌تر که تکه‌ای
 * فیلترشده را داشته باشد خودش فیلتر می‌شود. دو جستجوی دوبخشی کوچک‌ترین تکهٔ پشت‌سرهمِ فیلترشده را می‌دهد:
 *   ۱) کوتاه‌ترین پیشوند که فیلتر می‌شود ← کلمهٔ آخرِ آن بخشی از کلمهٔ بد است؛
 *   ۲) از آن‌جا به عقب، بلندترین پسوندی که هنوز فیلتر می‌شود ← آغازِ تکه.
 * تعدادِ آزمایش ≤ ۱ + ۲·⌈log₂ n⌉ (برای ۱۲۸ کلمه ۱۵ تا).
 *
 * `probe(start, end)` → `Promise<boolean>` (true = فیلتر شد)؛ بدونِ آرگومان = کلِ متن. خطا بالا می‌آید و جستجو
 * همان‌جا می‌ایستد. خالص و بدونِ DOM، تا سنجه‌اش یک `node` باشد.
 */
export const PROBE_STEP_CAP = 16;

export async function findFilteredSpan(n, probe, { onStep } = {}) {
  if (!Number.isInteger(n) || n < 1) throw new Error('متنِ خالی');
  let steps = 0;
  const ask = async (a, b) => {
    if (steps >= PROBE_STEP_CAP) throw new Error('سقفِ آزمایشِ یک جستجو تمام شد');
    steps += 1;
    onStep?.(steps);
    return probe(a, b);
  };
  /* کلِ متن، همان‌طور که واقعاً می‌رود. اگر خودش رد نشد، مشکل از متن نیست. */
  if (!(await ask())) return { status: 'clean', steps };
  let lo = 1; let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (await ask(0, mid)) hi = mid; else lo = mid + 1;
  }
  const end = lo;
  let a = 0; let b = end - 1;
  while (a < b) {
    const mid = (a + b + 1) >> 1;
    if (await ask(mid, end)) a = mid; else b = mid - 1;
  }
  return { status: 'found', start: a, end, steps };
}

/** کلمه‌های یک تکه، بی‌نشانه: «سپری،» ← «سپری». `\p{L}` فقط حرف است؛ نیم‌فاصله داخلِ کلمه می‌ماند. */
export const wordsOf = (text) => String(text ?? '').match(/[\p{L}\p{M}]+(?:‌[\p{L}\p{M}]+)*/gu) ?? [];
