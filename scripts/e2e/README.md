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
کدِ OTP در پاسخ برنمی‌گردد (جز `devCode`ِ محیطِ `NODE_ENV=test`) و در `otp_codes` به‌شکلِ HMAC-SHA256 با `JWT_SECRET`
ذخیره می‌شود (`server/src/common/otp-hash.ts`؛ پیامِ `هدف:شماره:کد`) — نه sha256ِ خامِ کد.

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
node scripts/e2e/w3-5-formbuilder.mjs  # W3.5 — ردیفِ فشرده، ماتریسِ نقش، پنلِ کناری، پیش‌نمایش (ارتفاعِ موبایل)
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

---

## راه‌اندازیِ خودکارِ محیط — `bootstrap-env.mjs`

همان مراحلِ بالا (دو مهاجرت + ردیفِ تنانت با DSNِ رمزشده + کاربرِ سوپرادمین) در
یک دستور و **idempotent**. جای «ردیفِ تنانت را دستی بساز» و «از مسیرِ signup یک
سوپرادمین بساز» را می‌گیرد:

```bash
CONTROL_DATABASE_URL=postgresql://amalyar:amalyar@localhost:5432/e2e_ctl \
DATABASE_URL=postgresql://amalyar:amalyar@localhost:5432/e2e_t1 \
TENANT_DATABASE_ENCRYPTION_KEY="<base64 ۳۲ بایتی>" \
node scripts/e2e/bootstrap-env.mjs
```

رمزنگاریِ DSN از **همان** `encryptDatabaseUrl`ِ سرور خوانده می‌شود، نه یک
پیاده‌سازیِ دوم که می‌تواند واگرا شود.

### ⚠️ از دیتابیسِ **تازه** شروع کن — نه از دیتابیسِ همیشگیِ توسعه

> **درسِ واقعی (۱۴۰۵/۰۶/۲۷):** سه سنجهٔ `follow-up` و یکی از `portal` روی
> دیتابیسِ درازعمرِ توسعه قرمز بودند و مدتی به‌جای «باگِ محصول» تشخیص داده
> شدند — حتی یک بار به‌اشتباه در `reminders.service.ts` «رفع» شد و بازپخشِ
> محلیِ CI جلویش را گرفت. روی دیتابیسِ **تازه** هر دو سبزِ کامل‌اند:
> `follow-up` **۲۱/۰** (سه بار پشتِ هم) و `portal` **۱۸/۰**.
>
> ریشه‌اش این است که این خانواده یک دیتابیسِ **مشترک** را می‌گیرد و اجرای
> ناتمامِ قبلی ردیف جا می‌گذارد. مثلاً `followUpUrl` با `orderBy: id asc`
> قدیمی‌ترین فرمِ `followUp='general'` را برمی‌دارد، پس اجرای تازه به فرمِ
> بیاتِ اجرای قبلی می‌چسبد و شمارشِ سوییت صفر می‌شود.

### ⚠️ وقتی CI نمی‌دود — `scripts/local-ci.mjs`

از ۱۴۰۵/۰۶/۳۱ سهمیهٔ Actionsِ حساب تمام شد و گیت‌هاب به هیچ جابی رانر نداد
(ران ساخته می‌شد و در ۳ ثانیه با `runner_id: 0` می‌مرد). تا برگشتنِ سهمیه،
تأییدِ هر تغییر با این اسکریپت انجام می‌شود و **مرج دستی** است.

```bash
export DATABASE_URL=…  CONTROL_DATABASE_URL=…  E2E_TENANT2_DATABASE_URL=…
export TENANT_DATABASE_ENCRYPTION_KEY=…  JWT_SECRET=…  DEFAULT_TENANT_SLUG=t1
export E2E_CHROME=/opt/pw-browsers/chromium     # اگر مرورگر جای دیگری است

node scripts/local-ci.mjs                # همه: ۱۰۱ گامِ build + کلِ ci-live.txt
node scripts/local-ci.mjs --part build   # فقط گام‌های جابِ build
node scripts/local-ci.mjs --part live    # فقط سوییت‌های زنده
node scripts/local-ci.mjs --from 40      # ادامه از گامِ ۴۰
```

🔴 **گام‌ها از خودِ `security-ci.yml` خوانده می‌شوند، نه از یک کپیِ دستی.** با
کپی، اولین گامی که به CI اضافه می‌شد این‌جا جا می‌افتاد و اسکریپت بی‌صدا کمتر
از CI می‌سنجید — همان تله‌ای که `--shard i/n` با مخرجِ ثابت داشت. چیزهایی که
عمداً رد می‌شوند (`uses:`، نصبِ chromium، ساختِ دیتابیسِ CI، شاردبندی) با
**نام** رد می‌شوند نه با شماره، چون شماره با هر گامِ تازه جابه‌جا می‌شود.

لاگِ کاملِ هر گامِ افتاده در `.e2e-logs/local-ci/` می‌مانَد — خروجیِ ترمینال
معمولاً همان خطی را می‌بُرد که علت در آن است.

> ⚠️ این اسکریپت جای CI را **نمی‌گیرد**، فقط تا برگشتنِ سهمیه جانشینش است:
> روی یک ماشین می‌دود (کندتر)، و شرایطِ رانرِ تمیزِ گیت‌هاب را بازتولید نمی‌کند.

### در CI — جابِ `live` در `security-ci.yml` (`run-live.mjs` + `ci-live.txt`)

این خانواده حالا در CI می‌دود: جابِ **`live`** (دو شاردِ موازی) یک Postgresِ
سرویس بالا می‌آورد، با `bootstrap-env.mjs` محیطِ تازه می‌سازد و رانرِ
`scripts/e2e/run-live.mjs` سوییت‌های `scripts/e2e/ci-live.txt` را می‌دواند.

> ⚠️ **تعدادِ شاردها را فقط در `matrix.shard` عوض کنید.** مخرجِ `--shard i/n`
> از `strategy.job-total` می‌آید، پس خودش دنبالِ ماتریس می‌آید؛ اگر روزی عددِ
> ثابت شد و کسی ماتریس را عوض کرد، بخشی از سوییت‌ها **بی‌صدا اجرا نمی‌شوند**
> و CI همچنان سبز می‌مانَد. چهار شارد به دو رسید چون زمانِ دیواریِ ران را
> `build` تعیین می‌کند نه شاردها، و هر شاردِ اضافه فقط ستاپِ خودش را
> (کانتینرِ postgres + دو `npm ci` + بیلد + chromium ≈ ۱٫۵ دقیقه) دوباره
> می‌پردازد.
**سوییتِ تازه = یک خط در `ci-live.txt`** (خودکفاهای مرورگری با APIِ ساختگی
گامِ مستقیمِ جابِ `build`اند، نه این فهرست). `automerge` کلِ workflow را
می‌سنجد، پس قرمزِ این جاب مرج را نگه می‌دارد.

```bash
# همان چیزی که CI می‌زند — محلی، با دیتابیسِ تازه:
DATABASE_URL=… CONTROL_DATABASE_URL=… [E2E_TENANT2_DATABASE_URL=…] \
TENANT_DATABASE_ENCRYPTION_KEY=… JWT_SECRET=… node scripts/e2e/bootstrap-env.mjs
node scripts/e2e/run-live.mjs --manifest scripts/e2e/ci-live.txt      # یا: --all · follow-up portal · --resume
```

چهار چیزی که رانر به‌خاطرِ باگ‌های واقعی انجام می‌دهد — و اگر کسی «ساده‌ترش»
کند برمی‌گردند:

- **سرور هر `--batch` سوییت از نو بالا می‌آید.** سطلِ ورود (۱۲ به‌ازای IP،
  ۸ به‌ازای نامِ کاربری در ۱۵ دقیقه) در حافظهٔ پروسه است؛ بیش از ۸ ورود روی
  یک پروسه = `ورود نشد`. سوییتی که با همین نشانه افتاد، یک بار روی سرورِ تازه
  دوباره اجرا می‌شود.
- **پورت‌ها ثابت‌اند: API روی `127.0.0.1:3101`، Vite روی `127.0.0.1:5199`.**
  ۱۸ سوییت این دو نشانی را هاردکد کرده‌اند، و کوکیِ `SameSite=Lax` هم‌هاست‌بودنِ
  UI و API را می‌خواهد. Vite بین سوییت‌ها نمی‌میرد؛ فقط API. Vite با
  `VITE_TENANT_UI=true` بالا می‌آید تا ریشه مثلِ هاستِ یک شرکت رفتار کند
  (سایتِ شرکت یا `/login`)، نه لندینگِ بازاریابی.
- **پیش از دستهٔ اول، seedهای تنبل گرم می‌شوند** (ورود + `GET /forms`،
  `/forms/visit-kinds`، `/features` روی هر دو میزبان). قالب‌های فرم فقط وقتی
  «هیچ فرمی نیست» و با اولین **خواندن** seed می‌شوند (`ensureSeeded`)؛ در
  اولین اجرای CI، اولین تماسِ دیتابیسِ بکر یک POST بود و **~۲۰ سوییت** با
  «فرمِ جراحی نیست» / `survey` نیست / نوعِ پیش‌فرضِ عوض‌شده قرمز شدند.
- **سوییتِ افتاده بقیه را قرمز نمی‌کند.** پیش از هر سوییت زنده‌بودنِ سرور
  سنجیده می‌شود و stderrِ هر نسلِ سرور در `api-<n>.log` می‌ماند. (نسخهٔ اولِ
  رانر تایمرِ `SIGKILL`ِ توقف را پاک نمی‌کرد و سرورِ دستهٔ **بعدی** را ۵ ثانیه
  بعد از شروع می‌کشت — اولین سوییتِ درازِ هر دسته با «other side closed»
  می‌افتاد و لاگی هم نمی‌ماند.)

روی رانرِ گیت‌هاب `/opt/pw-browsers/chromium` وجود ندارد؛ گامِ «Expose chromium»
همان مسیرها را به chromiumِ نصب‌شدهٔ playwright سیم‌لینک می‌کند و `E2E_CHROME`
را ست می‌کند — به‌جای دست‌زدن به ۵۸ فایلِ سه لِین. `tenant-isolation.mjs` تنانتِ
دومش را از `E2E_TENANT2_DATABASE_URL`ِ bootstrap می‌گیرد (`uitest2` روی
`127.0.0.2`، با ردیفِ `tenant_domains`)؛ تنانتِ اول هم دامنهٔ `clinic.localhost`
را دارد تا `tenant-seo` مسیرِ nginx (Host + X-Forwarded-Proto) را بسنجد.

**حفرهٔ W1.9 که پنج سوییت را بیرونِ manifest نگه داشته بود بسته شد** (لِینِ ج به
نیابت از لِینِ الف، به دستورِ مالک): لغوِ **سیستمی** (هرسِ `syncNextVisit`،
خاموشیِ `next_visit` هنگامِ رزروِ نوبت) کلیدِ ردیف را آزاد می‌کند (`dedupeKey = null`)
تا برنامهٔ بعدی با همان متن و موعد ردیفِ تازه بکارد؛ لغوِ **دستی** (W0.7) کلید را
نگه می‌دارد. `next-visit-booking` · `portal` · `postop-flow` · `postop-visit` ·
`summary-reminders` به manifest برگشتند. دو سنجهٔ دیگر در همان سوییت‌ها بیات
بودند و با محصول هم‌گام شدند، نه برعکس: متنِ مراقبت چندخطی است (پوششِ D07 پیش از
آن می‌آید) و `sql()`ِ سوییت فقط خطِ اول را می‌دهد → شرطِ متن در خودِ SQL؛ و بدونِ
credentialِ پیامک sweep «stub را ارسال نمی‌شمارد» → ردیف `simulated`/`skipped`
است نه `sent`.

**در سوییتِ مرورگری، کوکیِ نشست را پیش از اولین ناوبری بنشان** (`browserLogin`
قبل از هر `page.goto`). `AuthProvider` روی هر بارگذاری همان لحظه `/auth/me` و
`/config` را می‌زند؛ بی‌کوکی ۴۰۱ می‌گیرد و مرورگر «Failed to load resource: 401»
را در کنسول می‌نویسد — اگر شنوندهٔ کنسول از اول وصل باشد، سنجهٔ «بدونِ خطای
جاوااسکریپت» بسته به سرعتِ Vite گاهی قرمز می‌شود (شاردِ ۳ در اولین رانِ #70،
`link-builder`). ناوبریِ بی‌کوکیِ «/» یادگارِ توکن در localStorage است و لازم نیست.

**سنجه‌ای که در CI بیات شد را با محصول هم‌گام کن، نه برعکس** — و اگر محصول
عمداً عوض شده، دلیل را در همان سوییت بنویس. نمونه‌های این بسته: لانچر به
`/app/tools` رفت (W3.7) و شش سوییت هنوز `/app` را می‌گشتند؛ وضعیتِ لحظه‌ایِ
دستیارِ مدیریت JSONِ کمینه شد (نام بیمار نمی‌رود) و `ai-admin-assistant`
هنوز نام می‌خواست؛ ماتریسِ نقشِ W3.5؛ دکمهٔ واحدِ «صدور و چاپ فاکتور»؛ کاتالوگِ
فیلدهای `kind-fields` که حالا از `server/dist` خوانده می‌شود نه یک نسخهٔ دوم.
