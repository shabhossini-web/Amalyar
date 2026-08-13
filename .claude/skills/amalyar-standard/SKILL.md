---
name: amalyar-standard
description: >
  استانداردهای قفل‌شدهٔ عمل‌یار. هر بار که صفحه/ماژولِ جدیدی به اپ (/app) اضافه می‌شود، تایلِ
  لانچر یا دسترسی/سطح تغییر می‌کند، فرمِ ورود/ثبت‌نام یا پروفایل دست می‌خورد، یا کامپوننتِ
  UI جدیدی ساخته می‌شود این اسکیل را فعال کن. همچنین با واژه‌های «استاندارد»، «لانچر»،
  «سطح دسترسی»، «feature»، «پروفایل»، «OTP»، «اثر انگشت»، «PWA»، «ماژول جدید».
---

# استانداردِ عمل‌یار — مرجعِ اجرا

قوانینِ پایه در `CLAUDE.md` ریپوست؛ این‌جا «چطور»هاست.

## ۱) چک‌لیستِ افزودنِ ماژولِ جدید (مثلاً `reports`)

1. **بک‌اند**
   - `server/src/features/features.service.ts` → به `FEATURE_DEFAULTS` اضافه کن: `reports: { minLevel: 4 }`
   - کلیدهای عملیات به `PERMISSION_DEFAULTS`: `reports.read`, `reports.create`, …
   - ماژولِ Nest با **هر دو** گاردِ داینامیک (سطح از DB، نه هاردکد):
     ```ts
     @Controller('reports')
     @UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
     @Feature('reports')                        // ماژول روشن/خاموش (پلن)
     export class ReportsController {
       @Get() @RequirePermissions('reports.read') list() {}
     }
     ```
     (`LevelGuard + @MinLevel` فقط برای قفل‌های ثابتِ سیستمی مثل accounts.)
   - **object-authz:** کاربرِ زیرِ سوپروایزر فقط دادهٔ منتسب به خودش را ببیند
     (الگوی `scopedVisitWhere` / `assertVisitAccess` در `patients.service.ts`).
   - **آبجکتِ غنی‌شده**: مشتق‌ها (`due`, `code`, …) فقط در `enrich()` سرویسِ سرور؛ render فرمول ندارد.
   - تغییرِ مدلِ داده؟ → schema.prisma → `migrate diff` با shadow-db → پوشهٔ `prisma/migrations/<ts>_<name>/migration.sql` → `migrate deploy` محلی.
2. **فرانت**
   - `src/app/Users.jsx` → `FEATURE_FA.reports = 'گزارش‌ها'`
   - `src/app/Launcher.jsx` → آیتم به `TOOLS`/`DAILY` با `min` (فقط fallback؛ منبع سرور است) + آیکونِ SVGِ خطی + `ready:true, to:'/app/reports'`
   - صفحهٔ `src/app/Reports.jsx` با **اسکلتِ استاندارد** (§۲) + route در `App.jsx` داخلِ `<Protected>`
3. **تست (اجباری قبل از push)** — الگوی §۵؛ حداقل: گیتِ سطح (کاربرِ کم‌سطح نبیند/۴۰۳)، happy-path صفحه.

## ۲) اسکلتِ استانداردِ صفحهٔ /app

```jsx
import { Link } from 'react-router-dom';
import ProfileMenu from './ProfileMenu.jsx';
import './launcher.css'; import './users.css';

export default function Reports() {
  const [toast, setToast] = useState('');
  // useEffect: document.title = 'عمل‌یار — گزارش‌ها' + تایمرِ toast
  return (
    <div className="lx">
      <div className="lx-bg" aria-hidden="true" /><div className="lx-grid" aria-hidden="true" />
      <div className="lx-shell us-shell">
        <header className="us-head">
          <Link to="/app" className="lx-back">… لانچر</Link>
          <h1>گزارش‌ها</h1>
          <div className="us-head-left"><ProfileMenu onToast={setToast} /></div>
        </header>
        {/* محتوا: کارت‌های `glass us-card` */}
      </div>
      <div className={`lx-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}
```

## ۳) کامپوننت‌های قفل‌شده — کی/چطور

| کامپوننت | استفاده |
|---|---|
| `ProfileMenu onToast={setToast}` | بالای **هر** صفحهٔ /app. تغییرِ آیتم‌هایش فقط این‌جا، نه کپیِ محلی |
| `OtpInput value onChange status` | هر کدِ یکبارمصرف. status: idle/busy/success/error (جمع‌شدن→تیک/ضربدر). autofillِ WebOTP از ورودیِ نامرئی |
| `PasswordInput` | هر فیلدِ رمز (چشم دارد) |
| `SelfieCapture value onCapture` | هر عکسِ زنده. ویدیو همیشه mount است (باگِ ref) |
| `Mark gradient/draw` | لوگو. gradient=userSpaceOnUse (میلهٔ افقی گم نشود)؛ draw=خودکشیده |
| `glass` + `<span className="glass-glow"/>` + `onMouseMove={track}` | هر کارتِ تعاملی |
| `MoneyInput` (الگو در Dashboard.jsx) | هر مبلغ: تومان، گروه‌بندی در **blur**، به‌حروفِ زنده (`lib/money.js`) |
| تاریخِ شمسی | ورودی متنِ «۱۴۰۵/۰۴/۲۸» + دکمهٔ «امروز»؛ تبدیل با `lib/jalali.js`؛ DB=ISO |
| مودالِ فرم | الگوی `db-overlay/db-sheet` (bottom-sheet موبایل، وسط‌چین دسکتاپ) |

## ۴) قواعدِ auth که نباید شکست

- توکن فقط از `lib/api.js` (`getToken/setToken(remember)`)؛ عملیات روی حسابِ غیرفعال با `api(path,{token})`.
- هر مسیرِ ورودِ جدید باید از `adopt()`ِ `auth.jsx` رد شود (سوییچر/چندحسابی نشکند).
- سشن سرورساید revoke می‌شود؛ «خروج» یعنی `logoutAccount/logoutAll`، نه فقط پاک‌کردنِ توکن.
- WebAuthn: credId های دستگاه در `amalyar_cred_ids` → allowCredentials (بدونِ پنجرهٔ انتخاب).

## ۵) الگوی تستِ e2e (حلقه تا سبز)

```js
// راه‌اندازی: pg محلی + server:3009 (RP_ID=localhost) + vite:5173 با VITE_API_BASE
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] }); // دوربینِ فیک
// اثر انگشتِ مجازی: cdp.send('WebAuthn.addVirtualAuthenticator', {options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}})
// OTP در حالتِ stub: کد از لاگِ سرور (grep 'شما [0-9]{6}') یا devCode پاسخ
// قانون: خطای تست → اول ریشه‌یابی (باگِ اپ یا باگِ تست؟) → فیکس → راندِ بعد؛ تا ALL PASS ادامه بده
// ایدمپوتنت: اولِ هر ران دادهٔ دامنه را TRUNCATE کن (psql -h /tmp -U amalyar) وگرنه راندِ ۲ می‌شکند
```

## ۶) نبایدها (تجربه‌های واقعیِ همین پروژه)

- ❌ سطح/دسترسیِ هاردکد در UI یا API (فقط features + LevelGuard)
- ❌ ایموجی/گلیفِ متنی به‌جای آیکون
- ❌ `border-inline-*` برای رسمِ شکل در RTL (تیکِ قرینه شد → فیزیکی بنویس)
- ❌ گرادیانِ per-path در SVGِ نشان (میلهٔ افقی نامرئی می‌شود)
- ❌ mountِ شرطیِ `<video>` دوربین (ref نال → پیش‌نمایشِ سیاه)
- ❌ کش‌کردنِ `/api` در SW؛ فراموشیِ bump نسخهٔ `CACHE` بعد از تغییرِ شِل
- ❌ push بدونِ حلقهٔ تستِ سبز
