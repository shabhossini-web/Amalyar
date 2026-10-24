/**
 * «کدام کلمه فیلتر شد؟» — حدسِ **بی‌پیامک**، از روی دادهٔ خودِ همان شرکت.
 *
 * زمینه (dr-gorji، ۱۴۰۵/۰۷/۲۸): ملی‌پیامک پیامِ مراقبتِ بعد از عمل را با «متن حاوی کلمه فیلتر شده است» رد
 * می‌کرد، ولی **نمی‌گوید کدام کلمه** و فهرستِ اپراتور هم منتشر نمی‌شود (درسِ ملک‌طب: یک‌بار «دستگاه» بود). همان
 * شرکت ده‌ها پیامِ رفته دارد؛ کلمه‌ای که در پیامِ ردشده هست ولی در **هیچ** پیامِ رفته‌ای نیست، نامزدِ فیلتر است —
 * هر کلمهٔ پیامِ رفته از فیلتر گذشته است. حدس است نه حکم، و رابط همین را می‌گوید.
 *
 * خالص و بی‌Prisma، تا سنجه‌اش یک `node` باشد.
 */

/** اعراب، تنوین، همزهٔ روی «ه» (ـٔ) و الفِ کوچک — اپراتور روی حرف‌ها فیلتر می‌کند، نه روی این‌ها. */
const MARKS = /[ً-ٰٟۖ-ۭ]/g;
const ZWNJ = /‌/g;
/**
 * کلمه = حرف (هر زبانی) + اعراب، با نیم‌فاصلهٔ داخلی. رقم و نشانه جداکننده‌اند.
 * ⚠️ بازهٔ `؀-ۿ` کافی نبود: «،» و «؛» و «؟»ی عربی/فارسی همان‌جا هستند و کلمه را «عزیز،» می‌کردند
 * (اسکرین‌شاتِ dr-gorji، ۱۴۰۵/۰۸/۰۲). `\p{L}` فقط حرف را می‌گیرد.
 */
const WORD = /[\p{L}\p{M}]+(?:\u200c[\p{L}\p{M}]+)*/gu;

/** کلیدِ مقایسه: «ي/ك» عربی ← فارسی، بی‌اعراب، بی‌نیم‌فاصله، لاتینِ کوچک. */
export function wordKey(w: string): string {
  return w.replace(MARKS, '').replace(ZWNJ, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه').toLowerCase();
}

/** کلمه‌های متن، بی‌لینک و بی‌«لغو11» (هر دو در هر پیامی هستند و بخشی از متنِ نویسنده نیستند). */
export function smsWords(text: string): { word: string; key: string }[] {
  const clean = String(text ?? '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\S+\.(?:com|ir|net|org)\S*/gi, ' ')
    .replace(/لغو\s*[0-9۰-۹]+/g, ' ');
  const out: { word: string; key: string }[] = [];
  for (const m of clean.matchAll(WORD)) {
    const key = wordKey(m[0]);
    if (key.length >= 2) out.push({ word: m[0].replace(MARKS, ''), key });
  }
  return out;
}

/** مجموعهٔ کلیدِ همهٔ کلمه‌های پیام‌های رفته — «از فیلتر گذشته‌ها». */
export function passedWords(sentTexts: Iterable<string>): Set<string> {
  const keys = new Set<string>();
  for (const t of sentTexts) for (const w of smsWords(t)) keys.add(w.key);
  return keys;
}

/**
 * نامزدهای فیلتر برای یک پیامِ ردشده: کلمه‌هایی که در هیچ پیامِ رفته‌ای نبوده‌اند، بی‌نامِ خودِ گیرنده (نامِ هر
 * بیمار فقط در پیام‌های خودش است و همیشه «تازه» دیده می‌شود). ترتیب: کلمه‌ای که در ردشده‌های بیشتری تکرار شده
 * اول (فیلترِ واقعی در همهٔ آن‌ها مشترک است)، بعد به ترتیبِ آمدن در متن.
 *
 * @param rejectedTexts همهٔ پیام‌های ردشده با همین علت — فقط برای شمردنِ تکرار
 */
export function filterSuspects(
  text: string,
  passed: Set<string>,
  opts: { exclude?: Iterable<string>; rejectedTexts?: Iterable<string>; max?: number } = {},
): string[] {
  const exclude = new Set([...(opts.exclude ?? [])].flatMap((x) => smsWords(x).map((w) => w.key)));
  const seenIn = new Map<string, number>();
  for (const t of opts.rejectedTexts ?? []) {
    for (const key of new Set(smsWords(t).map((w) => w.key))) seenIn.set(key, (seenIn.get(key) ?? 0) + 1);
  }
  const picked = new Map<string, { word: string; order: number }>();
  smsWords(text).forEach((w, order) => {
    if (passed.has(w.key) || exclude.has(w.key) || picked.has(w.key)) return;
    picked.set(w.key, { word: w.word, order });
  });
  return [...picked.entries()]
    .sort((a, b) => (seenIn.get(b[0]) ?? 0) - (seenIn.get(a[0]) ?? 0) || a[1].order - b[1].order)
    .slice(0, opts.max ?? 5)
    .map(([, v]) => v.word);
}

/** ردِ «کلمهٔ فیلترشده» از روی متنِ علتِ ثبت‌شده در دفتر. */
export const isFilteredError = (error: string | null | undefined) => /فیلتر/.test(String(error ?? ''));
