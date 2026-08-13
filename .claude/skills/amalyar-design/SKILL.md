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

عمل‌یار **تک‌تم و تاریک** است — هیچ حالت روشنی ندارد و ساخته نمی‌شود.
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
--brand: #7c3aed;     /* بنفشِ برند */
--brand-2: #a855f7;   /* بنفشِ روشن — hover/بوردر */
--brand-dark: #5b21b6;/* انتهای گرادیانِ دکمه */
--cyan: #00e5ff;      /* لهجهٔ دوم — آیکون، فوکوس، بج */
--green: #34d399;     /* موفقیت / رشد */
--amber: #fbbf24;     /* هشدار */
--radius: 18px; --radius-sm: 12px;
--shadow-glow: 0 0 40px rgba(124, 58, 237, 0.25);
--maxw: 1140px;
```

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

## ۵. آیکون

**فقط SVGِ خطی.** ایموجی و گلیفِ متنی (`↩ ← ✓ ؟ …`) ممنوع است.

```jsx
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9,
            strokeLinecap: 'round', strokeLinejoin: 'round' };
const Search = (p) => (
  <svg viewBox="0 0 24 24" {...S} {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>
);
```

`stroke=currentColor` یعنی رنگ از والد می‌آید — هرگز رنگِ ثابت روی آیکون نگذار.

---

## ۶. تایپوگرافی

- فونت: `'Vazirmatn', -apple-system, 'Segoe UI', Tahoma, sans-serif` (در `body`).
- عنوانِ بخش: `.section-title` — `clamp(27px, 4.4vw, 42px)`، وزن ۹۰۰، `letter-spacing: -0.5px`.
- `line-height` بدنه `1.85` است و فارسی به آن نیاز دارد — کمترش نکن.
- هر جا عدد در ستون می‌نشیند: `font-variant-numeric: tabular-nums`.
- اعداد، کد، شمارهٔ موبایل و یوزرنیم: `dir="ltr"`.

---

## ۷. RTL — تلهٔ واقعی

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

## ۸. انیمیشن و دسترس‌پذیری

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

## ۹. نبایدها

- ❌ حالتِ روشن یا `body.light` — عمل‌یار تک‌تم است.
- ❌ hex خام در کامپوننت به‌جای توکن.
- ❌ ایموجی به‌جای آیکون.
- ❌ `border-inline-*` برای رسمِ شکل.
- ❌ کارتِ تعاملی بدونِ `glass-glow` یا بدونِ `focus-visible`.
- ❌ آیکونِ لانچرِ پرِ مات یا outlineِ تاریک (نقضِ قانون ۱۶).
- ❌ سایه/گلوی دست‌ساز به‌جای `--shadow-glow`.

---

## ۱۰. چک‌لیستِ کامپوننتِ جدید

- [ ] همهٔ رنگ‌ها از توکن‌های `index.css` می‌آیند
- [ ] اگر تعاملی است: `glass` + `glass-glow` + `onMouseMove={track}`
- [ ] `focus-visible` تعریف شده
- [ ] بلوکِ `prefers-reduced-motion` دارد
- [ ] آیکون SVGِ خطی با `currentColor`
- [ ] اعداد/کد `dir="ltr"` + `tabular-nums`
- [ ] شکل‌های CSS با بوردرِ فیزیکی
- [ ] در موبایل (≤620px) تست شده
