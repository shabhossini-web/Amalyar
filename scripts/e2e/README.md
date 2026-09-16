# آزمون‌های e2e محلی

آزمون‌های سناریویی که روی **سرورِ زندهٔ محلی** اجرا می‌شوند — نه در CI.

> ⚠️ چرا در CI نیستند: به Postgresِ واقعی، تنانتِ ثبت‌شده در control DB، و یک
> کاربرِ سوپرادمین نیاز دارند. نگهبان‌های CI (در `.github/workflows/`) ایستا و
> بی‌سرورند و همین را می‌خواهیم؛ این‌ها مکملشان‌اند نه جایگزینشان.

## راه‌اندازیِ محیط

```bash
service postgresql start
su postgres -c "createdb -O amalyar amalyar_control; createdb -O amalyar amalyar_t1"

cd server
export DATABASE_URL="postgresql://amalyar:amalyar@localhost:5432/amalyar_t1?schema=public"
export CONTROL_DATABASE_URL="postgresql://amalyar:amalyar@localhost:5432/amalyar_control?schema=public"
export TENANT_DATABASE_ENCRYPTION_KEY="<base64 ۳۲ بایتی>"
export JWT_SECRET="<حداقل ۳۲ کاراکتر>"
export DEFAULT_TENANT_SLUG="t1"          # ← بدونِ این، تنانت از Host حل می‌شود
export CORS_ORIGINS="http://127.0.0.1:5199"
export PORT=3101 NODE_ENV=development

npx prisma migrate deploy --schema prisma/control/schema.prisma
npx prisma migrate deploy --schema prisma/schema.prisma
# ردیفِ تنانت با DSNِ رمزشده (encryptDatabaseUrl در src/tenant/tenant-crypto.ts)
npm run build && node dist/main.js
```

فرانت: `VITE_API_BASE=http://127.0.0.1:3101/api npx vite --port 5199 --host 127.0.0.1`

> ⚠️ **هاستِ API و UI باید یکی باشد** (هر دو `127.0.0.1`، نه یکی `localhost`).
> نشست از کوکیِ HttpOnly با `SameSite=Lax` می‌آید؛ مرورگر کوکیِ `localhost` را
> برای صفحه‌ای روی `127.0.0.1` نمی‌فرستد و همهٔ آزمون‌های مرورگریِ سرورِ زنده به
> `/login` می‌افتند. آزمون‌ها بعد از ورودِ Node، کوکی را با
> `browserLogin(page, login.accessToken)` از `scripts/e2e/lib/browser-login.mjs`
> در مرورگر می‌نشانند — نه توکن در localStorage (که اپ دیگر نمی‌خواند).
> سنجهٔ HTTPِ خودِ کوکی/CSRF/چندحسابی: `node scripts/e2e/cookie-auth.mjs`.

کاربر: از مسیرِ `auth/signup/*` یک سوپرادمین با `admin` / `test1234` بسازید.
کدِ OTP در پاسخ برنمی‌گردد و در `otp_codes` به‌شکلِ sha256 ذخیره می‌شود.

## اجرا

رگرسیونِ نمایش سفارش و دریافت شرح AI (بدون دادهٔ واقعی):

```bash
cd server && npm run build && cd ..
node scripts/e2e/ai-stream-contract.mjs
E2E_CHROME=/path/to/chromium node scripts/e2e/orders-ai-ui.mjs
```

اولی AiService و کلاینت واقعی را به provider مصنوعی روی HTTP محلی وصل می‌کند.
دومی Vite را روی 5199 راه می‌اندازد و UI واقعی را با API fixture در موبایل و
دسکتاپ می‌سنجد. پورت 5199 باید آزاد باشد؛ آزمون‌ها جای تأیید مدل واقعیِ نصب را نمی‌گیرند.

```bash
node scripts/e2e/forms-api.mjs        # رنگ، صفحه، دو نوعِ تازه، مهاجرتِ scope
node scripts/e2e/forms-validate.mjs   # اجباری‌بودن از مسیرِ واقعیِ ثبتِ مراجعه
node scripts/e2e/forms-builder.mjs    # فرم‌ساز در مرورگرِ واقعی
node scripts/e2e/forms-boxes.mjs      # رندرِ باکسِ عکس و پرداخت
node scripts/e2e/link-form.mjs        # مرحلهٔ ۲ — لینک ← فرم و حساب (API)
node scripts/e2e/link-builder.mjs     # مرحلهٔ ۲ — سازندهٔ لینک در مرورگر
node scripts/e2e/public-form.mjs      # مرحلهٔ ۳ — فرمِ ساخته‌شده روی صفحهٔ بیمار
node scripts/e2e/approve-kind.mjs     # مرحلهٔ ۴ — تأیید بر اساسِ kindِ فرم
node scripts/e2e/dashboard-kind.mjs   # مرحلهٔ ۵ — رنگ و تفکیکِ نوعِ مراجعه
node scripts/e2e/record-forms.mjs     # مرحلهٔ ۷ — فرم‌های ضمیمهٔ پرونده
node scripts/e2e/link-actions.mjs     # مرحلهٔ ۸ — ویرایش و ارسالِ پیامکیِ لینک
node scripts/e2e/sheet-overlay.mjs    # شیت واقعاً بسته می‌شود (باگِ overlayِ نامرئی)
node scripts/e2e/card-targets.mjs     # کارت→مراجعه · نام→پرونده
node scripts/e2e/free-form.mjs        # فرمِ بی‌مبلغ فیش نمی‌خواهد
node scripts/e2e/kind-fields.mjs      # فرمِ هر نوع فقط فیلدهای خودش را دارد
node scripts/e2e/record-direct.mjs    # فرمِ زیرپرونده‌ی رایگان بی‌صف در پرونده می‌نشیند
node scripts/e2e/note-kinds.mjs       # «سیرِ بیماری» در پرونده دیده می‌شود، نه لای dropdown
node scripts/e2e/visit-extra.mjs      # ویرایشِ مراجعه فیلدهای فرمِ سفارشی را گم نمی‌کند
node scripts/e2e/visit-topic.mjs      # موضوعِ ویزیت (اولیه/پست‌آپ/زیبایی) — مرحلهٔ ۱ نوبت‌دهی
node scripts/e2e/availability.mjs     # برنامهٔ کاری و روزهای آزاد (API) — مرحلهٔ ۲
node scripts/e2e/schedule-panel.mjs   # پنلِ برنامهٔ کاری در مرورگر — مرحلهٔ ۲
node scripts/e2e/booking-flow.mjs     # نوبت‌گیریِ بیمار تا تأیید — مرحلهٔ ۳
node scripts/e2e/role-fields.mjs      # «هر کس قسمتِ خودش را پر کند» — مرحلهٔ ۴؛ سوپرادمین بیرون از قاعده
node scripts/e2e/intake-guards.mjs    # فرم عمومی: فیشِ اجباری، بی‌نشتیِ کد ملی، بخش‌های داخلی، مدرکِ لینکی
node scripts/e2e/appointments-day.mjs # میزِ پذیرش و «شروعِ ویزیت» — مرحلهٔ ۵
node scripts/e2e/tenant-isolation.mjs # دو تنانتِ واقعی، دو دیتابیس، هیچ نشتی (پیش‌نیاز پایین)
node scripts/e2e/platform-domains.mjs # پنلِ پلتفرم هیچ دامنه‌ای را پنهان نمی‌کند
```

آزمون‌های رابطِ **بدونِ سرور** (Vite + مرورگرِ واقعی + API ساختگی، `lib/mock-ui.mjs`؛ فقط `E2E_CHROME`):

```bash
node scripts/e2e/w0-1-intake-steps.mjs # W0.1 — استپر و پیام‌های فرمِ بیمار از makesVisit/payable
node scripts/e2e/w0-2-labels.mjs       # W0.2 — برچسبِ follow_up + پیامِ پایانِ سفارش از وضعیتِ مسیر
node scripts/e2e/w0-6-a11y.mjs         # W0.6 — Escape/focus-trap/بازگشتِ فوکوس در Overlay، کلیدهای جهت در Tabs
```

### پیش‌نیازِ `tenant-isolation.mjs`

این یکی برخلافِ بقیه به **دو تنانتِ واقعی** نیاز دارد، چون ادعایش دربارهٔ
مرزِ دیتابیس است و با یک دیتابیس بی‌معنی سبز می‌شود:

- تنانتِ دومی مثلِ `uitest2` (دیتابیس و نقشِ جدا) با ردیفی در `tenant_domains`
  برای میزبانِ `127.0.0.2`، و همان `admin/test1234` در آن seed شده باشد.
- API روی `127.0.0.0/8` گوش بدهد (پیش‌فرضِ `0.0.0.0` کافی است).
- **با** `DEFAULT_TENANT_SLUG` بالا بیاید. سوئیت بدونش هم سبز می‌شود، ولی
  بندِ ۶ — «میزبانِ ثبت‌نشده نباید به تنانتِ پیش‌فرض بیفتد» — فقط وقتی چیزی
  را می‌سنجد که آن مسیر زنده باشد.

## قاعده‌ها

- **هر آزمون باید بارِ دوم هم سبز باشد.** آزمونی که فقط یک‌بار اجرا می‌شود،
  دفعهٔ بعد کسی اجرایش نمی‌کند. هر کدام داده‌ی اجرای قبلی را خودش تمیز می‌کند.
- **ادعا روی حالتِ دیده‌شده**، نه روی «درخواست ۲۰۰ داد». جایی که می‌شود،
  اختلافِ قبل و بعد شمرده می‌شود.
- ورودها محدودشده‌اند (۱۲ بار در ۱۵ دقیقه به‌ازای هر IP). اگر ۴۲۹ گرفتید،
  سرور را ری‌استارت کنید — سطل‌ها در حافظه‌اند.


### Paid intake, roles, invoice accounts and narrative assistance

After both builds, run each scenario suite twice locally before publishing:

```sh
node scripts/e2e/intake-finance-roles.mjs
E2E_CHROME=/path/to/chromium node scripts/e2e/intake-assistance-ui.mjs
```

The integration suite uses disposable PGlite PostgreSQL through its wire protocol and the generated Prisma client. It applies every tenant migration and calls the actual services; no production database or SMS is used. Test dependencies are development dependencies. The UI suite starts its own Vite server, uses responsive Chromium, mocked API responses, and fake microphone input. It checks explicit review/apply, stale and empty AI responses, voice append, quick definitions and retained payment state. Continue to run `orders-ai-ui.mjs` and `ai-stream-contract.mjs` for the earlier regressions.
