/**
 * نرمال‌سازی و تطبیقِ نامِ فارسی — **خالص**، بدونِ Prisma و Nest.
 *
 * چرا لازم است: «لقمان»، «لقمان حکیم»، «بیمارستان لقمان» و «بیمارستان لقمان
 * حکیم» یک جا هستند ولی چهار رشتهٔ متفاوت. تا وقتی این چهار تا یکی نشوند،
 * گزارشِ «درآمد به تفکیکِ بیمارستان» چهار ردیف می‌دهد و هیچ‌کدام درست نیست.
 *
 * ⚠️ **تطبیقِ خودکار هرگز ادغام نمی‌کند.** فقط پیشنهاد می‌دهد؛ تصمیم با آدم
 * است و نتیجه‌اش به‌شکلِ «نامِ مستعار» ذخیره می‌شود تا دفعهٔ بعد نپرسد.
 * ادغامِ خودکارِ اشتباه، دو بیمارستانِ واقعاً متفاوت را برای همیشه یکی می‌کند
 * و گزارشِ مالی را بی‌سروصدا خراب.
 */

/** واژه‌هایی که در نامِ مرکزِ درمانی معنا اضافه نمی‌کنند. */
const NOISE = [
  'بیمارستان', 'بیمارستانِ', 'مرکز', 'مرکزِ', 'درمانی', 'درمانگاه', 'کلینیک',
  'پلی', 'پلی‌کلینیک', 'فوق', 'تخصصی', 'آموزشی', 'پژوهشی', 'عمومی', 'خصوصی',
  'دکتر', 'دکترِ', 'شهید', 'شهیدِ', 'حضرت', 'حضرتِ', 'امام', 'امامِ',
];

const AR_TO_FA: Record<string, string> = { 'ي': 'ی', 'ك': 'ک', 'ة': 'ه', 'ۀ': 'ه', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ؤ': 'و', 'ئ': 'ی' };
const DIGITS: Record<string, string> = {};
for (let i = 0; i < 10; i += 1) { DIGITS['۰۱۲۳۴۵۶۷۸۹'[i]] = String(i); DIGITS['٠١٢٣٤٥٦٧٨٩'[i]] = String(i); }

/**
 * شکلِ کانونیِ یک نام — کلیدِ تطبیق.
 *
 * ⚠️ «شهید» و «امام» عمداً حذف می‌شوند: «بیمارستان شهید رجایی» و «رجایی» یکی‌اند.
 * ولی این‌ها را از **کلید** حذف می‌کنیم نه از نامِ نمایشی؛ نامِ رسمی دست‌نخورده
 * می‌ماند.
 */
export function normalizeName(raw: string | null | undefined): string {
  const all = foldText(raw).split(' ').filter(Boolean);
  const words = all.filter((w) => !NOISE.includes(w));
  // اگر کلِ نام از واژه‌های بی‌معنا ساخته شده بود، خودِ نام را نگه دار — وگرنه
  // «بیمارستان امام» به کلیدِ خالی می‌رسید و با هر نامِ خالیِ دیگری یکی می‌شد.
  return (words.length ? words : all).join(' ');
}

/**
 * همان یکسان‌سازیِ حروفِ `normalizeName` (ی/ک عربی، رقمِ فارسی، نیم‌فاصله، علائم)، **بی**
 * حذفِ واژه‌های بی‌معنا — برای جست‌وجوی هم‌زمان با تایپ، که «امام» و «بیمارستان» همان
 * چیزی‌اند که کاربر تایپ می‌کند.
 */
export function foldText(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = String(raw);
  s = s.replace(/[يكةۀأإآؤئ]/g, (c) => AR_TO_FA[c] ?? c);
  s = s.replace(/[۰-۹٠-٩]/g, (c) => DIGITS[c] ?? c);
  // نیم‌فاصله، اعرابِ عربی، کشیده و علائم → فاصله
  s = s.replace(/[‌‏‎ً-ْـ]/g, ' ');
  s = s.replace(/[()\[\]{}«»"'’,،.\-_/\\|+*#]/g, ' ');
  return s.toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

/** فاصلهٔ ویرایشیِ دو رشته (Levenshtein) — برای «لقمان» در برابر «لغمان». */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * شباهتِ دو نام: ۰ تا ۱.
 *
 * ترکیبی است چون هیچ‌کدام تنها کافی نیست: هم‌پوشانیِ واژه «لقمان» را با
 * «لقمان حکیم» می‌گیرد ولی «لقمان» و «لغمان» را نه؛ فاصلهٔ ویرایشی برعکس.
 * زیرمجموعه‌بودن (یکی کاملاً داخلِ دیگری) امتیازِ کامل می‌گیرد، چون همان
 * الگوی «نامِ کوتاه‌شده» است که در فرم‌ها رخ می‌دهد.
 */
export function similarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;

  const wx = x.split(' ');
  const wy = y.split(' ');
  const setY = new Set(wy);
  const common = wx.filter((w) => setY.has(w)).length;
  if (common && (common === wx.length || common === wy.length)) return 0.95;

  const overlap = common / Math.max(wx.length, wy.length);
  const dist = editDistance(x, y);
  const near = 1 - dist / Math.max(x.length, y.length);
  return Math.max(overlap, near);
}

/** آستانهٔ پیشنهاد. پایین‌تر از این اصلاً پیشنهاد نمی‌شود. */
export const SUGGEST_MIN = 0.6;
/** بالاتر از این، پیشنهاد «قوی» علامت می‌خورد — ولی باز هم خودکار ادغام نمی‌شود. */
export const SUGGEST_STRONG = 0.9;

/** بهترین گزینه‌های تطبیق برای یک نامِ آزاد، مرتب‌شده بر امتیاز. */
export function bestMatches<T extends { id: number; name: string }>(
  raw: string,
  pool: T[],
  limit = 3,
): { id: number; name: string; score: number; strong: boolean }[] {
  return pool
    .map((p) => ({ id: p.id, name: p.name, score: similarity(raw, p.name) }))
    .filter((m) => m.score >= SUGGEST_MIN)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((m) => ({ ...m, strong: m.score >= SUGGEST_STRONG }));
}
