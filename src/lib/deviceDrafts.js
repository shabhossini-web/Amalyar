/**
 * **پیش‌نویس‌های بالینیِ روی دستگاه** — «شرحِ عمل» و «یافته‌ها»ی ذخیره‌نشدهٔ میزِ اتاقِ عمل
 * (بازبینیِ UX ۱۴۰۵/۰۷ — surgery-07): با زدنِ «فهرستِ روز»، برگشتِ گوشی یا تازه‌کردنِ صفحه پاک
 * نمی‌شوند و با بازکردنِ دوبارهٔ کارت برمی‌گردند.
 *
 * ⚠️ **پایه همراهِ متن ذخیره می‌شود** (بازبینیِ خصمانهٔ بستهٔ F، FF1): `base` همان متنِ پرونده است که
 * نوشته رویش ساخته شد. بی‌آن، پیش‌نویسِ کهنهٔ یک تبلت شرحِ تازه‌تری را که کسِ دیگری (فرمِ عمل،
 * دستگاهِ دیگر) در پرونده گذاشته بود «ذخیره‌نشده» می‌خواند و با یک «ذخیره» جایش را می‌گرفت.
 * پیش‌نویسی که پایه‌اش با پرونده نمی‌خواند بی‌صدا برنمی‌گردد — میز می‌پرسد کدام بماند.
 *
 * کلید شناسهٔ کاربر را دارد (دستگاهِ مشترکِ اتاقِ عمل) و پس از یک روز کهنه حساب می‌شود.
 * هر دسترسی به `localStorage` در try/catch است: حالتِ ناشناس یا ذخیره‌سازیِ بسته فقط یعنی
 * پیش‌نویس روی همین صفحه می‌ماند، نه خطا.
 */
export const DRAFT_PREFIX = 'amalyar_draft:';
export const DRAFT_TTL = 24 * 3600e3;

export const draftKey = (uid, visitId, field) => `${DRAFT_PREFIX}${uid ?? 0}:${visitId}:${field}`;

const store = () => {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
};

/** معتبر و تازه؟ — ساعتِ دستگاهی که عقب/جلو کشیده شده هم پیش‌نویسِ «ابدی» نمی‌سازد. */
const fresh = (v, now) => !!v && typeof v.text === 'string' && Math.abs(now - (Number(v.at) || 0)) <= DRAFT_TTL;

/**
 * `{ text, base }` یا `null`. `base: null` یعنی پایه نامعلوم است (پیش‌نویسِ نسخهٔ پیشین) — مصرف‌کننده
 * باید آن را «پایه عوض شده» حساب کند، نه «همان پرونده».
 */
export function readDraft(k, now = Date.now()) {
  const ls = store();
  if (!ls) return null;
  try {
    const v = JSON.parse(ls.getItem(k) ?? 'null');
    if (!fresh(v, now)) { ls.removeItem(k); return null; }
    return { text: v.text, base: typeof v.base === 'string' ? v.base : null };
  } catch {
    try { ls.removeItem(k); } catch { /* ذخیره‌سازیِ بسته */ }
    return null;
  }
}

export function writeDraft(k, text, base) {
  try { store()?.setItem(k, JSON.stringify({ text, base: base ?? '', at: Date.now() })); } catch { /* حالتِ ناشناس — فقط همین صفحه */ }
}

export function dropDraft(k) {
  try { store()?.removeItem(k); } catch { /* همان */ }
}

/**
 * **جارو** (بازبینیِ خصمانهٔ بستهٔ F، FF2): پیش‌نویسِ کهنه یا خراب تا دیروز فقط وقتی پاک می‌شد که
 * همان کارت دوباره باز شود — یعنی متنِ بالینیِ عملی که کسی دیگر بازش نکرد روی تبلتِ مشترکِ اتاقِ عمل
 * برای همیشه می‌ماند. حالا هر بارِ بارگذاریِ برنامه همه‌شان سنجیده می‌شوند (پایینِ همین فایل).
 */
export function sweepDrafts(now = Date.now()) {
  const ls = store();
  if (!ls) return 0;
  try {
    const dead = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || !k.startsWith(DRAFT_PREFIX)) continue;
      let v = null;
      try { v = JSON.parse(ls.getItem(k) ?? 'null'); } catch { /* خراب — همان کهنه */ }
      if (!fresh(v, now)) dead.push(k);
    }
    dead.forEach((k) => ls.removeItem(k));
    return dead.length;
  } catch { return 0; }
}

/**
 * پیش‌نویس‌های یک کاربر — یا بی‌شناسه، همهٔ کاربرانِ این دستگاه. با خروج یا تعویضِ حساب صدا زده
 * می‌شود (`auth.jsx`): روی تبلتِ مشترک، نفرِ بعدی نباید شرحِ عملِ ذخیره‌نشدهٔ نفرِ قبل را در
 * ذخیره‌سازیِ مرورگر پیدا کند.
 */
export function clearUserDrafts(uid) {
  const ls = store();
  if (!ls) return;
  const pre = uid == null ? DRAFT_PREFIX : `${DRAFT_PREFIX}${uid}:`;
  try {
    const keys = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(pre)) keys.push(k);
    }
    keys.forEach((k) => ls.removeItem(k));
  } catch { /* ذخیره‌سازیِ بسته */ }
}

sweepDrafts();
