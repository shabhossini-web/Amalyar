---
name: amalyar-design
description: >
  سیستم طراحی عمل‌یار. هر بار که کامپوننت/صفحهٔ جدیدی در `src/` ساخته می‌شود یا صفحه‌ای
  (Landing.jsx، Launcher.jsx، Dashboard.jsx، Login.jsx، Users.jsx، Profile.jsx) ویرایش
  می‌شود این اسکیل را فعال کن تا رنگ‌ها، شیشه، تایپوگرافی و انیمیشن دقیقاً با توکن‌های
  `src/index.css` هماهنگ بمانند. همچنین وقتی از «تم»، «استایل»، «رنگ»، «گلس‌مورفیسم»،
  «شیشه‌ای»، «گلو»، «اسپاتلایت»، «آیکون»، «RTL» یا «UI» صحبت می‌شود.
---

# سیستم طراحی عمل‌یار

عمل‌یار **دو تم** دارد: تیره (پیش‌فرض) و روشنِ بالینی (W3.6، §۱ پایین).
هر دو از **یک مجموعه توکن** ساخته می‌شوند — پس کامپوننتِ درست خودبه‌خود در هر
دو کار می‌کند و کامپوننتِ غلط در یکی می‌شکند.
منبع حقیقتِ توکن‌ها `src/index.css` است؛ این فایل فقط توضیح می‌دهد از کدام
توکن کجا استفاده شود. **هیچ رنگ خامی (hex/rgb) در کامپوننت جدید ننویس** مگر
همان مقداری باشد که این‌جا مستند شده.

---

## ۱. توکن‌ها (`src/index.css` — `:root`)

```css
--bg: #07051a;        /* زمینهٔ اصلی — بنفشِ سیاه */
--bg2: #0d0a26;       /* سطح بالاتر */
--bg3: #141033;       /* سطح سوم (گرادیانِ mock) */
--card: rgba(124, 58, 237, 0.06);
--card-border: rgba(124, 58, 237, 0.22);
--text1: #f2f0fc;     /* متنِ اصلی */
--text2: #b8b3d6;     /* متنِ فرعی */
--text3: #7d77a3;     /* کپشن/غیرفعال */
--brand: #7c3aed;     /* بنفشِ برند — از تنظیماتِ tenant می‌آید */
--brand-2: #a855f7;   /* بنفشِ روشن — hover/بوردر */
--brand-soft: …  --brand-mid: …  --brand-dark: #5b21b6;
--cyan: #00e5ff;      /* لهجهٔ دوم — آیکون، فوکوس، بج */
--green: #34d399;     /* موفقیت / رشد */
--amber: #fbbf24;     /* هشدار */
/* پالتِ دسته‌بندی — فقط برای تفکیکِ نوع، نه تزئین */
--kind-violet  --kind-teal  --kind-amber  --kind-rose
--kind-sky     --kind-lime  --kind-fuchsia  --kind-slate
--radius: 18px; --radius-sm: 12px;
--shadow-glow: 0 0 40px rgba(124, 58, 237, 0.25);
--maxw: 1140px;
```

> ۳۳ توکن‌اند و `src/index.css` منبعِ حقیقت است. اگر توکنی این‌جا مستند نشده،
> اول فایل را بخوان — این فهرست ممکن است از کد عقب بیفتد.

**جفتِ `--x` و `--x-rgb`:** هر رنگِ برند دو شکل دارد — `--brand: #7c3aed` برای
مقدارِ مستقیم، و `--brand-rgb: 124, 58, 237` برای جایی که شفافیت لازم است:

```css
border-color: rgba(var(--brand-rgb), 0.22);   /* ✅ */
border-color: rgba(124, 58, 237, 0.22);       /* ❌ عددِ خام */
```

اگر رنگِ برند از تنظیماتِ tenant عوض شود، فقط توکن‌ها به‌روز می‌شوند و هر
`rgba(var(--…-rgb), α)` خودش می‌چرخد؛ عددِ خام جا می‌ماند.

**قواعد رنگ:**
- بنفش = برند و کنش. سایان = لهجه و فوکوس. سبز/کهربا = **فقط معنایی** (وضعیت)، هرگز تزئینی.
- گرادیانِ استانداردِ دکمه: `linear-gradient(135deg, var(--brand), var(--brand-dark))`.
- گرادیانِ متن: کلاس `.grad-text` (`115deg` از سایان به بنفش) — دست‌نویس نکن.
- نارنجی `#fb923c` فقط در `em` داخلِ تگ‌لاین برند (`.hero-lockup-tag em`, `.lx-tag em`).

### دو تم — تیره (پیش‌فرض) و روشنِ بالینی

تم روی `<html>` می‌نشیند (`data-theme="dark|light"`) و `src/lib/theme.js` تنها
جایی است که آن را می‌نویسد. بلوکِ روشن در `src/index.css` **همان نام‌ها** را
دوباره تعریف می‌کند — هیچ کامپوننتی `[data-theme]` را خودش نمی‌خواند:

```css
:root                   { --bg:#07051a; --text1:#f2f0fc; --veil-rgb:255,255,255; … }
:root[data-theme=light] { --bg:#f4f4f9; --text1:#16132b; --veil-rgb:0,0,0;       … }
```

- **پیش‌فرض از حوزهٔ شرکت می‌آید** (`clinic` → روشن، بقیه → تیره) ولی انتخابِ
  کاربر (منوی پروفایل → «نمایش») همیشه بر آن مقدم است و در `localStorage` می‌ماند.
- **`--veil-rgb` به‌جای سفیدِ خام.** هر لایهٔ کم‌آلفا که روی زمینه می‌نشیند باید
  `rgba(var(--veil-rgb), α)` باشد؛ `rgba(255,255,255,.06)` در تمِ روشن **نامرئی**
  است. برای سطحِ کارت هم `rgba(var(--surface-rgb), α)`.
- **استثنا:** `rgba(0,0,0,α)` برای اسکریم و سایه در هر دو تم سیاه می‌ماند، و
  `--sheen-rgb` (براقیِ لبهٔ شیشه) در هر دو تم سفید است — نور از بالا می‌تابد.
- **چگالی** جداست: `data-density="cozy|compact"` فقط `--gap`/`--pad-card` را عوض
  می‌کند، نه اندازهٔ قلم (خواناییِ فارسی به `line-height: 1.85` گره خورده است).
- **سطوحِ ورودی عمداً همیشه تیره‌اند** — لندینگ، `/login` و لانچر کلاسِ
  `.theme-dark` دارند که توکن‌ها را محلی برمی‌گرداند. برندِ نئونی روی زمینهٔ
  روشن کار نمی‌کند و این صفحه‌ها ویترین‌اند، نه ابزارِ کار.
- **نگهبانِ ماشینی:** `node scripts/verify-theme-tokens.js` — سفیدِ خام، خاکستریِ
  ثابت بیرون از `index.css`، توکنِ جاافتاده در یکی از بلوک‌ها، و **توکنی که به
  خودش ارجاع دهد** (`--x: var(--x)`؛ CSS بی‌صدا دورش می‌اندازد و متن سیاه
  می‌شود — دوبار همین‌جا اتفاق افتاد).

---

## ۲. شیشه — primitive قفل‌شده

تعریفِ کانونی در `src/app/launcher.css`. **کپی نکن، استفاده کن:**

```jsx
<div className="glass" onMouseMove={track}>
  <span className="glass-glow" aria-hidden="true" />
  …محتوا…
</div>
```

- `.glass` — `backdrop-filter: blur(18px) saturate(150%)` + بوردرِ سفیدِ کم‌آلفا +
  دو `inset` (بالا روشن، پایین تیره) که حسِ لبهٔ شیشه می‌دهد.
- `.glass-glow` — اسپاتلایتِ دنبال‌کنندهٔ مکان‌نما با `--mx/--my`؛ روی `:hover` روشن می‌شود.
  `z-index:-1` دارد پس والد باید `isolation:isolate` داشته باشد (در `.glass` هست).
- تابعِ `track` مختصات را روی همان المان ست می‌کند:
  ```js
  const track = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  ```

> اگر کارتی تعاملی است ولی `glass-glow` ندارد، ناقص است. اگر کارتی ایستاست
> (فقط نمایش عدد) `glass` بدونِ glow هم قابل قبول است.

---

## ۳. آیکون‌های لانچر — استانداردِ مصوب (قانون ۱۶)

گرادیانِ **کم‌آلفا (۰٫۲–۰٫۴)** + بوردرِ رنگی + `backdrop-blur` + گلو.
نه پرِ مات، نه near-outlineِ تاریک. نسخهٔ مرجع در `launcher.css`.

```css
.lx-ic {
  background: linear-gradient(135deg, rgba(124,58,237,.28), rgba(0,229,255,.14));
  border: 1px solid rgba(124,58,237,.34);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  box-shadow: 0 0 22px rgba(124,58,237,.22);
  color: var(--cyan);
}
```

---

## ۴. اسکلتِ صفحهٔ /app

هر صفحهٔ جدید همین پوسته را دارد (جزئیات در اسکیلِ `amalyar-standard` §۲):

```jsx
<div className="lx">
  <div className="lx-bg" aria-hidden="true" />
  <div className="lx-grid" aria-hidden="true" />
  <div className="lx-shell us-shell">
    <header className="us-head">
      <Link to="/app" className="lx-back"><Back width="15" height="15" /> لانچر</Link>
      <h1>عنوان</h1>
      <div className="us-head-left"><ProfileMenu onToast={setToast} /></div>
    </header>
    {/* کارت‌های `glass us-card` */}
  </div>
  <div className={`lx-toast${toast ? ' on' : ''}`}>{toast}</div>
</div>
```

| کلاس | نقش |
|---|---|
| `.lx-bg` / `.lx-grid` | آئورا + گریدِ بنفش (همیشه `aria-hidden`) |
| `.lx-shell` | ستونِ مرکزی با عرضِ محدود |
| `.us-head` | هدرِ سه‌بخشی: بازگشت / عنوان / ProfileMenu |
| `.us-card` · `.db-stat` · `.us-list` | کارت، کاشیِ آمار، لیست |
| `.lx-toast` | توستِ پایین‌چین؛ با کلاسِ `on` ظاهر می‌شود |

---

## ۵. کامپوننت‌های موجود (`src/ui/`) — از نو نساز

لایهٔ primitive پروژه. قبل از ساختنِ هر چیزی این‌جا را بگرد؛ نسخهٔ موازی یعنی
دو رفتارِ متفاوت در یک اپ:

| نیاز | کامپوننت |
|---|---|
| مودال / شیت / بک‌دراپ | `Overlay` |
| تب | `Tabs` |
| دراپ‌داون / انتخابگر | `Pick` |
| آپلودِ فایل و چندعکسی | `FileDrop` — تک‌منبعِ بارگذاریِ کلِ سامانه |
| انتخابِ ساعت | `TimePick` |
| فرمِ داینامیک + اعتبارسنجی | `DynForm` + `dynErrors` |
| متنِ کمک‌شده با AI | `AssistedTextarea` |
| ورودیِ صوتی | `VoiceInput` |
| تیک/ضربدرِ انیمیشنی | `icons-motion.jsx` → `DrawCheck`, `DrawCross` |

هر کدام CSS جفتِ خودش را دارد (`pick.css`, `dynform.css`, `filedrop.css`،
`timepick.css`, `ui.css`, `press.css`). استایلِ محلیِ موازی ننویس — همان فایل را
ویرایش کن.

---

## ۶. آیکون

**فقط SVGِ خطی.** ایموجی و گلیفِ متنی (`↩ ← ✓ ؟ …`) ممنوع است.

**اول `src/ui/icons.jsx` را بگرد** — حدودِ ۵۰ آیکون آماده دارد (`Back`, `Plus`,
`Search`, `Trash`, `Pencil`, `Doctor`, `Hospital`, `Scalpel`, `Diagnosis`,
`Calendar`, `Money`, `Chart`, `Mic`…). نبود، آیکونِ تازه را **همان‌جا** اضافه کن،
نه inline در صفحه.

```jsx
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9,
            strokeLinecap: 'round', strokeLinejoin: 'round' };
const Search = (p) => (
  <svg viewBox="0 0 24 24" {...S} {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>
);
```

`stroke=currentColor` یعنی رنگ از والد می‌آید — هرگز رنگِ ثابت روی آیکون نگذار.

---

## ۷. تایپوگرافی

- فونت: `'Vazirmatn', -apple-system, 'Segoe UI', Tahoma, sans-serif` (در `body`).
- عنوانِ بخش: `.section-title` — `clamp(27px, 4.4vw, 42px)`، وزن ۹۰۰، `letter-spacing: -0.5px`.
- `line-height` بدنه `1.85` است و فارسی به آن نیاز دارد — کمترش نکن.
- هر جا عدد در ستون می‌نشیند: `font-variant-numeric: tabular-nums`.
- اعداد، کد، شمارهٔ موبایل و یوزرنیم: `dir="ltr"`.

---

## ۸. RTL — تلهٔ واقعی

برای **رسمِ شکل** با CSS (تیک، فلش، مثلث) از بوردرِ **فیزیکی** استفاده کن،
نه منطقی:

```css
/* ❌ در RTL قرینه می‌شود — باگِ واقعیِ این پروژه */
.check { border-inline-end: 2px solid; border-block-end: 2px solid; }

/* ✅ */
.check { border-right: 2px solid; border-bottom: 2px solid; }
```

برای **چیدمان** (padding/margin/gap) برعکس: منطقی درست است
(`margin-inline-start` و…) چون باید با جهت بچرخد.

---

## ۹. انیمیشن و دسترس‌پذیری

هر کامپوننتِ جدید **هر دو** را دارد:

```css
@media (prefers-reduced-motion: reduce) {
  .my-thing { animation: none; transition: none; }
}
.my-thing:focus-visible { outline: 2px solid var(--cyan); outline-offset: 3px; }
```

- ترنزیشنِ استاندارد: `.2s cubic-bezier(.2,.7,.2,1)` برای transform، `.25s` برای رنگ/سایه.
- نشانِ برند (`Mark.jsx`) خودکشیده است (`.mk-draw`) و در reduced-motion کامل نمایش داده می‌شود.
- گرادیانِ SVGِ نشان **باید** `userSpaceOnUse` باشد وگرنه میلهٔ افقی نامرئی می‌شود — بازطراحی ممنوع.

---

## ۱۰. نبایدها

- ❌ `rgba(255,255,255,α)`/خاکستریِ ثابت به‌جای `--veil-rgb`/توکن — در تمِ روشن محو می‌شود.
- ❌ خواندنِ `[data-theme]` در CSSِ کامپوننت — تم فقط در `index.css` تعریف می‌شود.
- ❌ hex خام در کامپوننت به‌جای توکن.
- ❌ ایموجی به‌جای آیکون.
- ❌ `border-inline-*` برای رسمِ شکل.
- ❌ کارتِ تعاملی بدونِ `glass-glow` یا بدونِ `focus-visible`.
- ❌ آیکونِ لانچرِ پرِ مات یا outlineِ تاریک (نقضِ قانون ۱۶).
- ❌ سایه/گلوی دست‌ساز به‌جای `--shadow-glow`.

---

## ۱۱. چک‌لیستِ کامپوننتِ جدید

- [ ] همهٔ رنگ‌ها از توکن‌های `index.css` می‌آیند
- [ ] اگر تعاملی است: `glass` + `glass-glow` + `onMouseMove={track}`
- [ ] `focus-visible` تعریف شده
- [ ] بلوکِ `prefers-reduced-motion` دارد
- [ ] آیکون SVGِ خطی با `currentColor`
- [ ] اعداد/کد `dir="ltr"` + `tabular-nums`
- [ ] شکل‌های CSS با بوردرِ فیزیکی
- [ ] در موبایل (≤620px) تست شده
- [ ] در **هر دو تم** دیده شده (`node scripts/verify-theme-tokens.js` سبز)
