/**
 * الگوهای آمادهٔ مسیرِ درمان — **خالص**، بدونِ Prisma و Nest.
 *
 * همان قاعدهٔ `site.registry.ts` و `access-registry.ts`: **کلید و متنِ
 * پیش‌فرض از کد می‌آید، مقدار از کاربر.** اگر این چهار الگو ردیفِ seed در
 * دیتابیس بودند، شرکتِ تازه تا وقتی کسی دستی مرحله‌ها را ننویسد هیچ مسیری
 * نداشت — و همان چیزی می‌شد که یافتهٔ A4 از آن شکایت دارد.
 *
 * ⚠️ **الگو نسخه‌دار است و نمونه گام‌ها را کپی می‌کند.** این‌جا فقط «نسخهٔ ۱ِ
 * کارخانه» است؛ هر ویرایشِ بعدی نسخهٔ تازه می‌سازد و دوره‌های در جریان را
 * دست نمی‌زند.
 *
 * ⚠️ و هیچ‌کدام خودبه‌خود روشن نمی‌شوند: الگو ساخته می‌شود ولی تا کسی دوره‌ای
 * را **شروع** نکند هیچ رفتاری عوض نمی‌شود. نصبی که امروز کار می‌کند نباید
 * یک‌شبه مسیرِ تازه بگیرد (همان قاعدهٔ ۱۹ برای سایتِ عمومی).
 */

/** مسئولِ گام — کلید از `JOB_ROLES`؛ خالی یعنی «هرکس برداشت». */
export type StepOwnerRole = 'doctor' | 'secretary' | 'nurse' | 'assistant' | 'technician';

export interface PathwayStepDef {
  /** کلیدِ پایدارِ گام در همین الگو. */
  key: string;
  title: string;
  /**
   * موعد به **روزِ نسبی** از شروعِ دوره — نه تاریخِ مطلق.
   *
   * ⚠️ منفی مجاز است و معنی‌دار: «۷ روز **پیش از** عمل». دوره‌ای که مبدأش
   * تاریخِ عمل است، گام‌های آماده‌سازی را با عددِ منفی می‌گیرد.
   */
  offsetDays: number;
  ownerRole?: StepOwnerRole;
  hint?: string;
  /**
   * متنِ پیامکِ بیمار در موعدِ همین گام. خالی = پیامی نمی‌رود.
   *
   * ⚠️ این متن **واقعاً فرستاده می‌شود** — هنگامِ شروعِ دوره یک ردیفِ
   * `Reminder` با همان موعد ساخته می‌شود و sweepِ موجود می‌فرستدش. پس فیلدِ
   * تزئینی نیست و همان دقتی را می‌خواهد که هر متنِ رو به بیمار.
   */
  notify?: string;
  /**
   * «عدمِ پاسخ» — اگر گام این‌قدر روز بعد از موعد هنوز باز باشد، کارِ پیگیری
   * ساخته می‌شود. صفر/خالی = بی‌خیال.
   */
  escalateDays?: number;
}

export interface PathwayTemplateDef {
  key: string;
  title: string;
  /** حوزهٔ کاریِ پیشنهادی — فقط برای مرتب‌کردنِ فهرست، نه محدودیت. */
  vertical?: 'clinic' | 'ionm' | 'implant';
  notes?: string;
  steps: PathwayStepDef[];
}

/**
 * چهار الگوی آماده (سند، W4.1).
 *
 * ⚠️ «نورومانیتورینگ» و «ایمپلنت» عمداً همان رفتارِ امروزیِ کد را بازتولید
 * می‌کنند (مراقبتِ پیش از عمل، روزِ عمل، پیگیریِ پس از آن) — تا وقتی شرکتی
 * از `syncPostOpVisit` به مسیرِ صریح مهاجرت می‌کند، چیزی از دست ندهد.
 */
export const PATHWAY_TEMPLATES: PathwayTemplateDef[] = [
  {
    key: 'clinic-visit',
    title: 'ویزیتِ مطب',
    vertical: 'clinic',
    notes: 'مسیرِ سادهٔ ویزیت‌محور: ویزیت، نتیجه، پیگیری.',
    steps: [
      { key: 'visit', title: 'ویزیتِ اولیه', offsetDays: 0, ownerRole: 'doctor' },
      { key: 'results', title: 'پیگیریِ نتیجهٔ آزمایش/تصویربرداری', offsetDays: 3, ownerRole: 'nurse', hint: 'اگر سفارشی ثبت شده، نتیجه‌اش باید برسد.' },
      { key: 'followup', title: 'ویزیتِ پیگیری', offsetDays: 14, ownerRole: 'doctor' },
    ],
  },
  {
    key: 'ionm-surgery',
    title: 'عملِ نورومانیتورینگ',
    vertical: 'ionm',
    notes: 'مبدأ = تاریخِ عمل. گام‌های آماده‌سازی عددِ منفی دارند.',
    steps: [
      { key: 'consent', title: 'هماهنگی و رضایتِ بیمار', offsetDays: -7, ownerRole: 'secretary' },
      {
        key: 'pre_op', title: 'مراقبتِ پیش از عمل', offsetDays: -1, ownerRole: 'nurse',
        notify: 'فردا روزِ عملِ شماست. از نیمه‌شب چیزی نخورید و ننوشید و داروهای همیشگی را طبقِ دستورِ پزشک مصرف کنید.',
      },
      { key: 'op', title: 'روزِ عمل — حضورِ کارشناس', offsetDays: 0, ownerRole: 'technician' },
      { key: 'report', title: 'گزارشِ حینِ عمل', offsetDays: 1, ownerRole: 'technician' },
      { key: 'post_op', title: 'مراقبتِ پس از عمل', offsetDays: 2, ownerRole: 'nurse' },
      { key: 'followup', title: 'ویزیتِ پیگیری', offsetDays: 30, ownerRole: 'doctor', escalateDays: 7 },
    ],
  },
  {
    key: 'implant-case',
    title: 'کیسِ تجهیزات/ایمپلنت',
    vertical: 'implant',
    notes: 'مبدأ = تاریخِ عمل. تمرکز روی تجهیزات و تسویه.',
    steps: [
      { key: 'items', title: 'تأییدِ اقلامِ موردِ نیاز', offsetDays: -3, ownerRole: 'technician' },
      { key: 'transport', title: 'ارسالِ بار به بیمارستان', offsetDays: -1, ownerRole: 'assistant' },
      { key: 'op', title: 'روزِ عمل — حضورِ نمایندهٔ فنی', offsetDays: 0, ownerRole: 'technician' },
      { key: 'return', title: 'برگشتِ اقلامِ مصرف‌نشده', offsetDays: 1, ownerRole: 'assistant' },
      { key: 'invoice', title: 'صدورِ فاکتور', offsetDays: 3, ownerRole: 'secretary' },
    ],
  },
  {
    key: 'followup-course',
    title: 'دورهٔ پیگیری',
    notes: 'دورهٔ چندجلسه‌ایِ مستقل از عمل — فیزیوتراپی، درمانِ دوره‌ای، IVF.',
    steps: [
      { key: 'session-1', title: 'جلسهٔ ۱', offsetDays: 0, ownerRole: 'doctor' },
      { key: 'session-2', title: 'جلسهٔ ۲', offsetDays: 7, ownerRole: 'doctor' },
      { key: 'session-3', title: 'جلسهٔ ۳', offsetDays: 14, ownerRole: 'doctor' },
      { key: 'review', title: 'ارزیابیِ پایانِ دوره', offsetDays: 21, ownerRole: 'doctor' },
    ],
  },
];

export const PATHWAY_BY_KEY = new Map(PATHWAY_TEMPLATES.map((t) => [t.key, t]));

/**
 * اعتبارسنجیِ آرایهٔ گام‌ها — **همان تابع** برای الگوی کد و الگوی ساختِ کاربر.
 *
 * ⚠️ دو مسیرِ اعتبارسنجی یعنی روزی که یکی سخت‌گیرتر از دیگری شود و الگویی که
 * از فرم‌ساز رد شده از راهِ دیگری بنشیند. W4.2 (ویزاردِ ساختِ الگو) هم از
 * همین رد می‌شود.
 */
export function validateSteps(raw: unknown): { ok: true; steps: PathwayStepDef[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || !raw.length) return { ok: false, error: 'مسیر باید دستِ‌کم یک مرحله داشته باشد' };
  if (raw.length > 60) return { ok: false, error: 'مسیر نمی‌تواند بیش از ۶۰ مرحله داشته باشد' };
  const seen = new Set<string>();
  const steps: PathwayStepDef[] = [];
  for (const [i, s] of raw.entries()) {
    const at = `مرحلهٔ ${i + 1}`;
    if (!s || typeof s !== 'object') return { ok: false, error: `${at} معتبر نیست` };
    const key = String((s as any).key ?? '').trim();
    const title = String((s as any).title ?? '').trim();
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(key)) return { ok: false, error: `${at}: کلید باید حروفِ لاتین/عدد/خط‌تیره باشد` };
    if (seen.has(key)) return { ok: false, error: `${at}: کلیدِ «${key}» تکراری است` };
    seen.add(key);
    if (!title || title.length > 120) return { ok: false, error: `${at}: عنوان لازم است (حداکثر ۱۲۰ نویسه)` };
    const offset = Number((s as any).offsetDays);
    /* ⚠️ کران **دوطرفه** است: منفی معنی‌دار است («۷ روز پیش از عمل») ولی
       بی‌کران نه — یک تایپِ اشتباه نباید موعدی در سالِ ۲۰۵۰ بسازد. */
    if (!Number.isInteger(offset) || offset < -365 || offset > 3650) {
      return { ok: false, error: `${at}: روزِ نسبی باید عددِ صحیح بینِ −۳۶۵ و ۳۶۵۰ باشد` };
    }
    const ownerRole = (s as any).ownerRole ? String((s as any).ownerRole) : undefined;
    const hint = (s as any).hint ? String((s as any).hint).slice(0, 300) : undefined;
    /* ⚠️ متنِ پیامک **به دستِ بیمار می‌رسد**، پس کرانِ طولش سخت‌گیر است و
       خالی یعنی «پیامی نمی‌رود» — نه رشتهٔ تهی که بعداً پیامکِ خالی بفرستد. */
    const notifyRaw = String((s as any).notify ?? '').trim();
    if (notifyRaw.length > 400) return { ok: false, error: `${at}: متنِ پیامک از ۴۰۰ نویسه بیشتر است` };
    const escalateRaw = (s as any).escalateDays;
    const escalate = escalateRaw === undefined || escalateRaw === null || escalateRaw === '' ? 0 : Number(escalateRaw);
    if (!Number.isInteger(escalate) || escalate < 0 || escalate > 365) {
      return { ok: false, error: `${at}: «عدمِ پاسخ» باید عددِ صحیحِ ۰ تا ۳۶۵ روز باشد` };
    }
    steps.push({
      key, title, offsetDays: offset, ownerRole: ownerRole as StepOwnerRole | undefined, hint,
      ...(notifyRaw ? { notify: notifyRaw } : {}),
      ...(escalate ? { escalateDays: escalate } : {}),
    });
  }
  return { ok: true, steps };
}
