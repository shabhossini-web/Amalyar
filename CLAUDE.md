# عمل‌یار — راهنمای پروژه

SaaSِ مدیریتِ شرکت‌های خدمات/تجهیزاتِ جراحی. **بازنویسیِ تمیزِ** ملک‌طب — کدِ ملک‌طب فقط مرجعِ منطقِ کسب‌وکار است، نه کپی.

## معماری و دیپلوی

| بخش | استک | آدرس |
|---|---|---|
| لندینگ + اپ (SPA) | React 18 + Vite + framer-motion | `amalyar.com` (روت=لندینگ، `/app`=سامانه) |
| بک‌اند | NestJS 10 + Prisma + PostgreSQL 16 | `api.amalyar.com/api` |
| پنل | Coolify روی VPS `62.60.214.40` | `panel.amalyar.com` |

- **push به `main` = دیپلویِ خودکارِ هر دو اپ** (GitHub App → Coolify). بک‌اند هنگامِ اجرا `prisma migrate deploy` می‌زند.
- سرور Docker Hub را از **آینهٔ آروان** می‌کشد (daemon.json روی هاست). شبکهٔ سرور کند است → npm در Dockerfile با retry/timeoutِ بالا.
- env بک‌اند در Coolify: `DATABASE_URL` (Internal URL دیتابیس), `JWT_SECRET`, `PORT=3001`, `CORS_ORIGINS`, `MELI_API_KEY`, `MELI_FROM`, `RP_ID`, `WEBAUTHN_ORIGINS`.

## ⚠️ قوانینِ قفل‌شده (استانداردِ سراسری)

1. **احرازِ واحد:** فقط یک صفحهٔ لاگین/ثبت‌نامِ تب‌دار (`/login`). ثبت‌نام = موبایل → OTP (مرحلهٔ جدا، `OtpInput` انیمیشنی + WebOTP) → پروفایل + **سلفیِ زندهٔ اجباری**. حسابِ جدید `pending` است تا سوپرادمین تأیید و سطح بدهد؛ **اولین حسابِ سیستم** خودکار سوپرادمینِ فعال می‌شود.
2. **سطوحِ عددی ۱..۶**: ۱ بازدید · ۲ کارشناس · ۳ کارشناس‌ادمین · ۴ سوپروایزر · ۵ ادمین · ۶ سوپرادمین (`server/src/common/levels.ts`).
3. **دسترسی هرگز هاردکد نشود.** منبعِ حقیقت جدولِ `features` است (`minLevel`, `enabled`)؛ کد فقط seedِ پیش‌فرض (`FEATURE_DEFAULTS`). لانچر از `GET /features` گیت می‌شود. ماژولِ `users` قفلِ سطح ۶ است. `enabled` بعداً اهرمِ لایسنس/پلن است.
4. **ماژولِ جدید = برشِ عمودی + این چک‌لیست:** کلید در `FEATURE_DEFAULTS` (بک‌اند) + `FEATURE_FA` (Users.jsx) + آیتمِ لانچر با `min` fallback → صفحهٔ `/app/<key>` با هدرِ استاندارد → گاردِ `JwtAuthGuard + LevelGuard + @MinLevel` روی API → تستِ e2e.
5. **`ProfileMenu` بالای هر صفحهٔ /app** (چیپِ سلفی+نام+سطح؛ دراپ‌داونِ چندحسابی). حسابِ خودت→`/app/profile`، بقیه→سوییچ.
6. **چندحسابی:** `src/lib/accountsStore.js`. فقط ورودِ «مرا به خاطر بسپار» ماندگار می‌شود (localStorage)؛ بدونِ تیک → sessionStorage و خارج از لیست.
7. **آیکون فقط SVGِ خطی** (stroke=currentColor, strokeWidth≈1.9). ایموجی/گلیفِ متنی (↩ ← ؟ …) ممنوع.
8. **زبانِ خطاها فارسی** — پیامِ validation در DTOها و Exceptionها فارسی باشد.
9. **RTL:** برای اشکالِ CSS (تیک/فلش) **بوردرِ فیزیکی** نه منطقی (باگِ واقعی: تیکِ قرینه). اعداد/کد/یوزرنیم با `dir="ltr"`.
10. **طراحیِ شیشه‌ای:** primitive کلاسِ `glass` + `glass-glow` (اسپاتلایتِ `--mx/--my` با `track`) روی توکن‌های `src/index.css`. رعایتِ `prefers-reduced-motion` و focus-visible در هر کامپوننتِ جدید.
11. **PWA:** `public/sw.js` شِل+asset ها را در نصب precache می‌کند (پارسِ HTML). تغییرِ ساختارِ شِل → `CACHE` bump. `/api` هرگز کش نمی‌شود.
12. **حلقهٔ توسعه:** هیچ push ای بدونِ build سبزِ هر دو سمت + تستِ e2e محلیِ سناریوهای تغییر (الگوی playwright در اسکیل). تا سبزِ کامل، حلقهٔ دیباگ ادامه دارد.

## ساختارِ کلیدی

| مسیر | نقش |
|---|---|
| `src/pages/Landing.jsx` + `src/components/*` | لندینگ (Hero لاک‌آپ + نشانِ خودکشیده) |
| `src/app/Login.jsx` | احرازِ استاندارد (تب‌ها/OTP/سلفی/پس‌کی/remember) |
| `src/app/Launcher.jsx` | لانچرِ گیت‌شده از `/features` + بنرِ نصبِ PWA |
| `src/app/Users.jsx` | تأیید/سطح‌دهی + تبِ «دسترسی‌ها» (سوپرادمین) |
| `src/app/Profile.jsx` | پروفایلِ من (نام/سلفی/رمز) |
| `src/app/ProfileMenu.jsx` · `OtpInput.jsx` · `PasswordInput.jsx` · `SelfieCapture.jsx` | کامپوننت‌های استانداردِ قفل‌شده |
| `src/app/auth.jsx` + `src/lib/api.js` + `src/lib/accountsStore.js` | AuthProvider/چندحسابی/کلاینتِ API |
| `src/components/Mark.jsx` + `brand/` | هویتِ برند (گرادیانِ userSpaceOnUse؛ بازطراحی ممنوع) |
| `server/src/{auth,accounts,features,sms}` | بک‌اند (JWT+سشنِ قابل‌ابطال، WebAuthn، ملی‌پیامک، features) |
| `server/prisma/` | schema + migrations (تغییرِ مدل → `migrate diff` با shadow-db → پوشهٔ migration) |

## توسعهٔ محلی (سندباکس)

```bash
# Postgres محلی (بدون docker)
PGBIN=/usr/lib/postgresql/16/bin; PGDATA=/tmp/amalyar-pg
sudo -u postgres $PGBIN/pg_ctl -D $PGDATA -o "-p 5432 -k /tmp" -l /tmp/amalyar-pg.log start
# (اولین بار: initdb -U amalyar --auth=trust و createdb amalyar + amalyar_shadow)

cd server && npx prisma migrate deploy && npm run build
JWT_SECRET=testsecret PORT=3009 RP_ID=localhost WEBAUTHN_ORIGINS=http://localhost:5173 node dist/main.js &
cd .. && VITE_API_BASE=http://127.0.0.1:3009/api npm run dev   # فرانت روی 5173
# e2e: playwright-core + /opt/pw-browsers/chromium (اثر انگشت: CDP WebAuthn.addVirtualAuthenticator)
```

> جزئیاتِ کامپوننت‌ها، الگوهای تست و چک‌لیستِ ماژولِ جدید: اسکیلِ `amalyar-standard`.
