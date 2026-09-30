/**
 * آیکون‌های عمل‌یار — **تک‌منبع**.
 *
 * ⚠️ **هیچ `<svg>` دیگری بیرونِ این پوشه نوشته نمی‌شود، و هیچ نویسهٔ متنی
 * (`✕`, `▲`, `✉`, `⚠`, …) به‌جای آیکون رندر نمی‌شود.**
 *
 * دلیلِ اول: تا قبل از این، ۸۰ تعریفِ آیکون در ۱۸ فایل پخش بود و پنج‌تایشان
 * دو نسخهٔ متفاوت داشتند — یعنی «مداد» در دو صفحه دو شکل بود و هیچ‌کس نمی‌دید.
 *
 * دلیلِ دوم: نویسهٔ متنی نه اندازه‌اش کنترل‌پذیر است نه ضخامتش، روی اندروید و
 * سافاری و ویندوز سه شکلِ متفاوت دارد، و **متحرک نمی‌شود**. کلِ فازِ حرکت
 * (نشانگرِ تبِ لغزان، آیکونِ زندهٔ تبِ فعال) روی همین SVGها سوار می‌شود.
 *
 * قرارداد: شبکهٔ ۲۴×۲۴، `stroke="currentColor"`، ضخامتِ یکسان، سرِ گرد. رنگ از
 * `color`ِ والد می‌آید، پس آیکون هرگز رنگِ ثابت ندارد و با تم عوض می‌شود.
 */

/**
 * پوستهٔ مشترک.
 *
 * `aria-hidden` پیش‌فرض است چون آیکون تزئینی است؛ اگر دکمه‌ای **فقط** آیکون
 * دارد، خودِ دکمه باید `aria-label` داشته باشد نه آیکون.
 *
 * `size` یک عدد است و به هر دو بُعد می‌خورد؛ ولی `width`/`height`ِ صریح بعد از
 * آن spread می‌شوند و برنده‌اند — تا فراخوان‌های موجود نشکنند.
 */
function Svg({ size = 18, strokeWidth = 1.9, children, ...rest }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

// ── جهت و پیمایش ─────────────────────────────────────────────
/** بازگشت — فلشِ قلاب‌دار. با «شِوران» فرق دارد و عمداً یکی نشدند. */
export const Back = (p) => (
  <Svg {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5v6" /></Svg>
);
/** شِوران رو به انتهای خط (در RTL: چپ). برای «بعدی» و بازکردنِ آکاردئون. */
export const ChevronEnd = (p) => <Svg {...p}><path d="m9 6 6 6-6 6" /></Svg>;
export const Caret = (p) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const ArrowStart = (p) => <Svg {...p}><path d="M19 12H5M11 18l-6-6 6-6" /></Svg>;
export const ArrowEnd = (p) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const ArrowUp = (p) => <Svg {...p}><path d="M12 19V5M5 12l7-7 7 7" /></Svg>;
export const ArrowDown = (p) => <Svg {...p}><path d="M12 5v14M5 12l7 7 7-7" /></Svg>;

// ── کنش‌ها ───────────────────────────────────────────────────
export const Plus = (p) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
/** بستن. جایگزینِ نویسهٔ `✕`. */
export const Close = (p) => <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>;
export const Trash = (p) => (
  <Svg {...p}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </Svg>
);
export const Pencil = (p) => <Svg {...p}><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></Svg>;
export const Check = (p) => <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>;
/** تیکِ داخلِ دایره — برای «انجام شد»ِ یک ردیف، جایگزینِ `✔`. */
export const CheckCircle = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></Svg>
);
/**
 * ستاره‌ی امتیاز — جایگزینِ نویسه‌ی `★`.
 *
 * ⚠️ `fill="currentColor"` می‌گیرد نه `stroke`: ستاره‌ی توخالی و ستاره‌ی پر
 * باید در یک نگاه فرق کنند، و با خطِ دور این تفاوت به ضخامتِ خط تقلیل پیدا
 * می‌کرد. رنگ را CSS تعیین می‌کند (`.dyn-star-btn.on`).
 */
export const Star = (p) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5-5.8-3.05-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z" />
  </Svg>
);
/** ستارهٔ **خالی** — «به منتخب‌ها اضافه کن». جفتِ پرِ آن `Star` است («منتخب است»). */
export const StarLine = (p) => (
  <Svg {...p}><path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5-5.8-3.05-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z" /></Svg>
);
export const Copy = (p) => (
  <Svg {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></Svg>
);
export const Search = (p) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></Svg>;
export const Filter = (p) => <Svg {...p}><path d="M3 5h18l-7 8v6l-4 2v-8z" /></Svg>;
export const Download = (p) => (
  <Svg {...p}><path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M4 21h16" /></Svg>
);
export const Upload = (p) => (
  <Svg {...p}>
    <path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Svg>
);
export const Print = (p) => (
  <Svg {...p}><path d="M7 9V3h10v6" /><rect x="4" y="9" width="16" height="7" rx="2" /><path d="M7 16h10v5H7z" /></Svg>
);
/** ارسالِ پیام/ابلاغ — هواپیمای کاغذی. جایگزینِ `✉` که «نامه» معنا می‌داد. */
export const Send = (p) => (
  <Svg {...p}><path d="M21 3 10.5 13.5" /><path d="M21 3l-6.5 18-4-8-8-4z" /></Svg>
);

// ── وضعیت ────────────────────────────────────────────────────
/** هشدار. جایگزینِ `⚠️` که روی هر سیستم‌عامل شکل و رنگِ خودش را داشت. */
export const Alert = (p) => (
  <Svg {...p}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </Svg>
);
export const Clock = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
/** «دوباره» — پرسشِ امنیتیِ تازه و مانندِ آن. */
export const Refresh = (p) => (
  <Svg {...p}><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" /><path d="M20 20v-4h-4" /></Svg>
);
/** «توجه» — دایرهٔ اطلاع. لحنش نرم‌تر از `Alert` است و برای پیامِ راهنما. */
export const Info = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16h.01" /></Svg>
);
export const Lock = (p) => (
  <Svg {...p}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Svg>
);

// ── اشخاص ────────────────────────────────────────────────────
export const User = (p) => (
  <Svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6.5 8-6.5s8 2.5 8 6.5" /></Svg>
);
export const Users = (p) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.7-3.4 3.4-5.5 6.5-5.5s5.8 2.1 6.5 5.5" />
    <circle cx="17.5" cy="9" r="2.6" /><path d="M15.6 14.9c2.6.3 4.9 2 5.6 4.6" />
  </Svg>
);
export const Doctor = (p) => (
  <Svg {...p}>
    <path d="M9 3v5a3 3 0 0 0 6 0V3" /><path d="M12 11v3a4 4 0 0 1-8 0v-1" />
    <circle cx="4" cy="11" r="2" /><circle cx="19" cy="16" r="3" /><path d="M19 19v2" />
  </Svg>
);
export const Fingerprint = (p) => (
  <Svg {...p}>
    <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" /><path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
    <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" /><path d="M2 12a10 10 0 0 1 18-6" />
    <path d="M2 16h.01" /><path d="M21.8 16c.2-2 .131-5.354 0-6" />
    <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" /><path d="M8.65 22c.21-.66.45-1.32.57-2" />
    <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
  </Svg>
);
export const Camera = (p) => (
  <Svg {...p}>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </Svg>
);
export const Eye = (p) => (
  <Svg {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></Svg>
);
export const EyeOff = (p) => (
  <Svg {...p}>
    <path d="M17.94 17.94A10.5 10.5 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.4 9.4 0 0 1 12 5c6.5 0 10 7 10 7a18.6 18.6 0 0 1-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><path d="M2 2l20 20" />
  </Svg>
);
export const LogOut = (p) => (
  <Svg {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></Svg>
);

// ── حوزهٔ کار ────────────────────────────────────────────────
export const Hospital = (p) => (
  <Svg {...p}><path d="M3 21V8l9-5 9 5v13" /><path d="M3 21h18" /><path d="M12 9v6M9 12h6" /></Svg>
);
export const Scalpel = (p) => (
  <Svg {...p}><path d="M3 21l7-2 11-11a2.5 2.5 0 0 0-4-4L6 15z" /><path d="M14 6l4 4" /></Svg>
);
/**
 * «عمل» (جراحی) — تیغِ جراحیِ **افقی** با شکمِ خمیده و دستهٔ گرد، زیرِ یک خطِ میز.
 * `Scalpel`ِ مورب درست همان شکلِ `Pencil`ِ «ویرایش» بود و سربرگِ «عمل‌های امروز» مداد
 * خوانده می‌شد (بازبینیِ UX ۱۴۰۵/۰۷).
 */
export const Surgery = (p) => (
  <Svg {...p}>
    <path d="M10 9.5H4.2a1.7 1.7 0 0 0 0 3.4H10" />
    <path d="M10 9.5h3.4c3.4 0 6.3.9 8.1 2.2-2 2.3-5 3.6-8.4 3.6H10z" />
    <path d="M13 12.2h4" />
    <path d="M3 19.5h18" />
  </Svg>
);
export const Diagnosis = (p) => (
  <Svg {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" />
  </Svg>
);
export const Calendar = (p) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></Svg>
);
/** ساعتِ حضورِ کارشناس — ورود به اتاق. */
export const Arrive = (p) => (
  <Svg {...p}><path d="M3 12h11" /><path d="m10 8 4 4-4 4" /><path d="M17 4h4v16h-4" /></Svg>
);
export const Box = (p) => (
  <Svg {...p}><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3 8 9 5 9-5M12 13v8" /></Svg>
);
export const Book = (p) => (
  <Svg {...p}><path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z" /><path d="M9 7h7M9 11h7" /></Svg>
);
export const Route = (p) => (
  <Svg {...p}>
    <circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" />
    <path d="M8.5 19h5a4 4 0 0 0 0-8h-3a4 4 0 0 1 0-8h5" />
  </Svg>
);
export const Wave = (p) => <Svg {...p}><path d="M2 12h3l3-8 4 16 3-11 2 3h5" /></Svg>;
export const Truck = (p) => (
  <Svg {...p}>
    <path d="M2 7h11v9H2zM13 10h4l3 3v3h-7z" />
    <circle cx="6.5" cy="18.5" r="1.8" /><circle cx="17" cy="18.5" r="1.8" />
  </Svg>
);
export const Phone = (p) => (
  <Svg {...p}>
    <path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5L16 12l4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 6.2 2 2 0 0 1 6 4z" />
  </Svg>
);

// ── مالی ─────────────────────────────────────────────────────
export const Money = (p) => (
  <Svg {...p}>
    <rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" />
    <path d="M6 12h.01M18 12h.01" />
  </Svg>
);
export const Bank = (p) => (
  <Svg {...p}><path d="M3 10l9-6 9 6" /><path d="M5 10v9M19 10v9M9 10v9M15 10v9M3 21h18" /></Svg>
);
export const Chart = (p) => <Svg {...p}><path d="M3 3v18h18" /><path d="M7 15l3-4 3 2 4-6" /></Svg>;

// ── ماژول‌ها (کاشی‌های لانچر) ─────────────────────────────────
export const Form = (p) => (
  <Svg {...p}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></Svg>
);
export const Chat = (p) => (
  <Svg {...p}><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Svg>
);
export const Mail = (p) => (
  <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></Svg>
);
export const Dispatch = (p) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="3" /><circle cx="17" cy="16" r="3" />
    <path d="M11 8h4a2 2 0 0 1 2 2v3M8 11v3a2 2 0 0 0 2 2h3" />
  </Svg>
);
export const Grid = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Svg>
);
export const Gear = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
  </Svg>
);
/** «بیشتر» — منوی کارهای کم‌تکرارِ یک ردیف (سه نقطهٔ افقی). */
export const More = (p) => (
  <Svg {...p}><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></Svg>
);
/** بازشدن در برگهٔ تازه — «مدیریتِ فهرست ↗». */
export const External = (p) => (
  <Svg {...p}><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Svg>
);
export const LinkIcon = (p) => (
  <Svg {...p}>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </Svg>
);

/** میکروفون — دستیارِ صوتی (ضبط با MediaRecorder). */
export const Mic = (p) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </Svg>
);

/** مربعِ توقف — پایانِ ضبطِ صدا. */
export const StopRec = (p) => (
  <Svg {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></Svg>
);

/** زنگِ کارها — پوستهٔ سراسری (W2.4). */
export const Bell = (p) => (
  <Svg {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></Svg>
);

/** خورشید — تمِ روشن (W3.6). */
export const Sun = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
  </Svg>
);

/** ماه — تمِ تیره (W3.6). */
export const Moon = (p) => (
  <Svg {...p}><path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z" /></Svg>
);

// ── آیکونِ یکتا به‌ازای هر ماژول (W3.7) ───────────────────────
// تا دیروز `Wave` سه ماژول را می‌پوشاند (پرتالِ جراح، دستیار، پنلِ کارشناسی)،
// `Book` سه‌تا، و `Chart`/`Clock` دوتا. آیکونِ مشترک یعنی بازشناسیِ بصری صفر:
// کاربر هر بار باید **بخواند**. این پنج‌تا همان تکرارها را برمی‌دارند.
// نگهبان: `scripts/verify-module-icons.js`.

/** بیماران — داشبوردِ مدیریت (فهرستِ مراجعات). */
export const Patients = (p) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="17" rx="2.5" />
    <circle cx="9" cy="10" r="2.2" /><path d="M5.8 17a3.4 3.4 0 0 1 6.4 0" />
    <path d="M15 10h3.5M15 14h3.5" />
  </Svg>
);

/**
 * بازه‌های در دسترس — برنامهٔ کاری.
 *
 * ⚠️ عمداً **قابِ تقویم ندارد**: نسخهٔ اول یک تقویمِ خانه‌دار بود و در اندازهٔ
 * کاشی از `Calendar` جدا نمی‌شد. اسکرین‌شات این را نشان داد، نه چکِ ماشینی —
 * چون `d`ها فرق داشتند و چک سبز بود. حالا نوارهای زمانی روی یک محورِ ساعت.
 */
export const Slots = (p) => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="3" /><path d="M6 4.6V6l1 .8" />
    <path d="M12 6h9" />
    <rect x="3" y="11.5" width="13" height="3.4" rx="1.7" />
    <rect x="3" y="17.5" width="8" height="3.4" rx="1.7" />
    <path d="M19 11.5v9" />
  </Svg>
);

/** درخششِ هوشِ مصنوعی — دستیارِ هوشمند. */
export const Sparkle = (p) => (
  <Svg {...p}>
    <path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
    <path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
  </Svg>
);

/** فرم در حالِ ویرایش — فرم‌ساز (جدا از `Form` که خودِ پذیرش است). */
export const FormEdit = (p) => (
  <Svg {...p}>
    <path d="M20 12V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
    <path d="M8 8h8M8 12h5" />
    <path d="M20.2 15.3a1.6 1.6 0 0 0-2.3-2.3L14 17v2.3h2.3z" />
  </Svg>
);

/** کرهٔ زمین — سایتِ معرفیِ عمومیِ شرکت. */
export const Globe = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3.5 9h17M3.5 15h17" />
    <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
  </Svg>
);

/**
 * سند زیرِ ذره‌بین — جستجوی بالینی.
 *
 * ⚠️ چرا `Diagnosis` کافی نبود: هر دو «برگهٔ متن» بودند و کنارِ کاشیِ «پذیرش»
 * (که آن هم برگه است) تشخیص‌ناپذیر. ذره‌بین همان چیزی است که این ماژول **انجام
 * می‌دهد**؛ برگه فقط می‌گوید موضوعش چیست.
 */
export const NoteSearch = (p) => (
  <Svg {...p}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
    <path d="M8 8h7M8 12h4" />
    <circle cx="16.5" cy="16.5" r="3.5" /><path d="m19.2 19.2 2.3 2.3" />
  </Svg>
);

/** برچسب — تعاریف پایه (جراح، بیمارستان، نوعِ عمل: موجودیتِ نام‌دار). */
export const Tag = (p) => (
  <Svg {...p}>
    <path d="M3 12.5V5a2 2 0 0 1 2-2h7.5a2 2 0 0 1 1.4.6l6.5 6.5a2 2 0 0 1 0 2.8l-7.5 7.5a2 2 0 0 1-2.8 0L3.6 13.9A2 2 0 0 1 3 12.5Z" />
    <circle cx="7.5" cy="7.5" r="1.4" />
  </Svg>
);

/**
 * مسیرِ درمان — **نقشهٔ گام‌به‌گام**: سه ایستگاه روی یک خط.
 *
 * ⚠️ نه ساعت، نه تقویم، نه برگه — هر سه از قبل مالِ ماژولِ دیگری‌اند و
 * قرضشان یعنی کاربر باید **بخواند** تا کاشی را بشناسد. چیزی که این ماژول
 * انجام می‌دهد «مرحله پشتِ مرحله» است، پس همان کشیده شد.
 */
export const Pathway = (p) => (
  <Svg {...p}>
    <circle cx="5" cy="6" r="2.2" /><circle cx="12" cy="12" r="2.2" /><circle cx="19" cy="18" r="2.2" />
    <path d="M7 7.5 10 10.5M14 13.5 17 16.5" />
  </Svg>
);

/**
 * اتاقِ عمل — **چراغِ سیالتیک**: گنبدِ چراغ روی بازو، با سه پرتو به پایین.
 *
 * ⚠️ عمداً نه اسکالپل و نه صلیب: اسکالپل با `Tag`/نشانگرها قاطی می‌شود و صلیب
 * را `Hospital` برداشته. چراغِ بالای تخت تنها چیزی است که هر کسی با یک نگاه
 * «اتاقِ عمل» می‌خواندش و شکلش با هیچ کاشیِ دیگری یکی نیست (قانونِ ۲۴).
 */
/** فهرستِ انتظارِ عمل — ساعتِ شنی: «منتظرِ نوبتِ عمل»، نه ساعتِ یادآوری‌ها. */
export const Waitlist = (p) => (
  <Svg {...p}>
    <path d="M7 3h10M7 21h10" />
    <path d="M8 3c0 5 4 6 4 9s-4 4-4 9M16 3c0 5-4 6-4 9s4 4 4 9" />
  </Svg>
);
export const Theatre = (p) => (
  <Svg {...p}>
    <path d="M4.5 9.5a7.5 7.5 0 0 1 15 0Z" />
    <path d="M12 9.5v2.5" />
    <path d="M8.5 15.5 7 19M12 15.5V19M15.5 15.5 17 19" />
  </Svg>
);
