# Claude handoff — Amalyar

این فایل منبع تحویل و دفتر ثبت اصلی پروژه است. هیچ secret، password، API key یا connection URL واقعی در آن ثبت نشود.

## قاعده اجباری ثبت تغییرات

از تاریخ 2026-07-21 به درخواست مالک پروژه:

- بعد از هر تغییر کد، تنظیم Coolify، عملیات دیتابیس، deployment، تست یا تصمیم معماری، همین فایل در همان نوبت به‌روزرسانی شود.
- هر Agent بعدی، از جمله Claude یا Codex، باید پیش از شروع این فایل را بخواند و قبل از پایان کار وضعیت جدید، نتیجه تست و کار باقی‌مانده را ثبت کند.
- اطلاعات محرمانه فقط با نام متغیر ثبت شوند و مقدار آن‌ها هرگز وارد Git نشود.
- اگر کار شکست خورد، خطا و راه‌حل یا blocker نیز ثبت شود؛ فقط موفقیت‌ها ثبت نشوند.
- `docs/COOLIFY_STAGING_STATE.md` خلاصه وضعیت استقرار است و در تغییرات Coolify باید هم‌زمان به‌روز شود.

## GitHub

- Repo: `shabhossini-web/Amalyar`
- Main baseline: `808b2f4b677a9c627b0c01054bf1a92771a1c423`
- Working branch: `agent/security-permissions-hardening`
- Draft PR: https://github.com/shabhossini-web/Amalyar/pull/1
- وضعیت هنگام تحویل: 59 commit جلوتر از main و 0 commit عقب‌تر
- آخرین commit کد بک‌اند که CI و Coolify روی آن موفق شد: `02a86d4bf19d7144b11d92b8f9caa0e37305151e`
- commitهای بعدی ممکن است فقط مستندات باشند؛ وضعیت deploy را از Coolify کنترل کن.
- main هنوز merge نشده و نباید تا پایان تست staging و rehearsal مهاجرت merge شود.

## نام‌ها و مسیر دقیق Coolify

- Project: `Amalyar`
- Environments: `production` و `staging`
- Staging Application: `agent/security-permissions-hardening`
- Staging Database resource: `amalyar-control-staging`

تنظیم Application:

- Repo: `shabhossini-web/Amalyar`
- Branch: `agent/security-permissions-hardening`
- Build pack: Dockerfile
- Base directory: `/server`
- Dockerfile: `/Dockerfile`
- Exposed port: `3001`
- Port mapping: خالی
- Watch Paths: `server/**` (در Coolify ذخیره و تأیید شد).
- Healthcheck: `GET http://localhost:3001/api/health`
- Interval 30، timeout 10، retries 5، start period 60
- وضعیت redeploy پس از ثبت متغیرهای SMS در 2026-07-21: Running و پایدار (تأیید مالک پروژه)
- لاگ موفق: `Nest application successfully started`
- لاگ موفق: `amalyar-server ← http://0.0.0.0:3001/api`
- Health عمومی تأییدشده: `https://api-staging.amalyar.com/api/health`

دامنه‌های Backend Application پس از cutover مسیر در 2026-07-22:

- `https://api-staging.amalyar.com`
- `https://alpha-staging.amalyar.com/api`
- `https://beta-staging.amalyar.com/api`

تغییر Domains ذخیره و Backend با موفقیت Redeploy شد. تست مرورگر نشان داد:

- `https://api-staging.amalyar.com/api/health` موفق و `ok:true` بود.
- مسیرهای Alpha/Beta به Backend رسیدند اما با `Cannot GET /auth/setup-status` و 404 برگشتند؛ این خطا ثابت کرد Proxy پیشوند عمومی `/api` را قبل از تحویل به کانتینر حذف می‌کند.
- هیچ داده شخصی نمایش‌داده‌شده در اسکرین‌شات‌ها در Git ثبت نشده است.
- دامنه‌های ریشه Alpha/Beta هنوز به Frontend منتقل نشده‌اند.

اصلاح خودکار روی Branch اعمال شد:

- فایل جدید `server/src/common/api-prefix.ts` پیشوند حذف‌شده را در مرز برنامه بازیابی می‌کند.
- `server/src/main.ts` پیش از route matching، URL بدون `/api` را به قرارداد داخلی Nest برمی‌گرداند؛ URLهایی که از قبل `/api` دارند بدون تغییر می‌مانند.
- CI برای `/auth/setup-status`، query string، URL از قبل prefixed و root test اضافه کرد.
- commitهای کد: `22a2a69cf9693b2860315a0f62ad194c59a2c71c`، `d82114593dcba25370222a281ffad185165fedea` و `343384a9026669d32dd9a1b4af5c97bdf3d4e0ba`.
- GitHub Actions `security-ci` run 179 برای اصلاح مسیر موفق شد؛ Redeploy Backend و smoke test Alpha/Beta هنوز باید تأیید شود.

تنظیم PostgreSQL:

- Image: `postgres:18-alpine`
- Internal port: 5432
- Public access: off
- Initial DB: `amalyar_control_staging`
- Provisioning user: `amalyar_provisioner`
- Persistent storage فعال
- URL و password هرگز در Git/Chat ثبت نشود.

## Environment variables در staging

مقادیر محرمانه حذف شده‌اند:

- `CONTROL_DATABASE_URL`
- `PROVISIONING_DATABASE_URL`
- `TENANT_DATABASE_ENCRYPTION_KEY`
- `JWT_SECRET`
- `NODE_ENV=production`
- `PORT=3001`
- `CORS_ORIGINS=https://alpha-staging.amalyar.com,https://beta-staging.amalyar.com`
- `MELI_API_KEY` (مقدار محرمانه، ثبت‌شده در Coolify)
- `MELI_FROM` (مقدار محرمانه، ثبت‌شده در Coolify)

Secretها: Buildtime خاموش، Runtime روشن، Multiline خاموش، Literal روشن.

اصلاح مهم: کد از `CORS_ORIGINS` استفاده می‌کند؛ `ALLOWED_ORIGINS` اشتباه است.

در 2026-07-21 متغیرهای `MELI_API_KEY` و `MELI_FROM` از Application فعلی عمل‌یار به staging منتقل و تنظیماتشان تأیید شد. مقدارها محرمانه‌اند و در Git ثبت نشده‌اند. redeploy، ارسال واقعی SMS و نبودن OTP/شماره در log همگی تأیید شدند.

## تست SMS در staging

- تاریخ: `2026-07-21`
- Tenant تست‌شده: `alpha-staging`
- Endpoint: `POST /api/auth/signup/request-otp`
- نتیجه API: HTTP `201` با پاسخ `{"ok":true,"ttl":300}`
- هیچ شماره موبایل یا OTP در مستندات ثبت نشده است.
- دریافت پیامک روی موبایل: موفق و توسط مالک پروژه تأیید شد
- بررسی log در 2026-07-22: هیچ `STUB`، متن کد تأیید، شماره موبایل یا OTP مشاهده نشد؛ تأیید مالک پروژه

## اصلاح fail-closed پیامک

در 2026-07-22 روی شاخه `agent/security-permissions-hardening` اعمال شد:

- `server/src/sms/sms.service.ts`: نبود credential یا شکست provider در production اکنون HTTP `503` می‌دهد.
- شماره موبایل، متن پیام، OTP، پاسخ خام provider، exception خام و URL دارای API key دیگر log نمی‌شوند.
- `server/src/auth/auth.service.ts`: API در production برای پیام ارسال‌نشده پاسخ موفق نمی‌دهد.
- OTP ارسال‌نشده پاک می‌شود تا resend window کاربر را بی‌دلیل مسدود نکند.
- `.github/workflows/security-ci.yml`: تست خودکار نبود credential در production باید `503` را تأیید کند.
- commitهای کد: `b8c4b5408537543bd41b345c81f97efa030e85f9` و `02a86d4bf19d7144b11d92b8f9caa0e37305151e`
- CI run `107`: موفق (`success`)
- وضعیت Coolify پس از این تغییر: Running سبز و پایدار؛ تأیید مالک پروژه در 2026-07-22
- تست واقعی پس از اصلاح: `POST /api/auth/signup/request-otp` روی Alpha دوباره HTTP `201` و `{"ok":true,"ttl":300}` داد؛ شماره و OTP ثبت نشده‌اند.

## تصمیم onboarding کاربرپسند

در 2026-07-22 روش ساخت حساب از Terminal رد و لغو شد؛ هیچ حسابی با روش دستی ساخته نشد و Tenantهای Alpha/Beta همچنان `needsSetup=true` دارند.

تصمیم نهایی:

- راه‌اندازی هر شرکت فقط از UI انجام شود؛ کاربر نباید command، signup token یا API payload ببیند.
- UI موجود پروژه در `src/app/Login.jsx` از قبل flow کامل setup-status، OTP، فرم پروفایل، سلفی زنده و ورود خودکار اولین Super Admin را دارد.
- فرانت باید به‌عنوان Application جدا در Coolify deploy شود.
- دامنه‌های Alpha/Beta در ریشه `/` به فرانت و مسیر `/api` همان دامنه به Backend route شوند.
- API frontend به‌صورت same-origin روی `/api` باشد تا Host واقعی شرکت به Backend برسد و tenant از header/body انتخاب نشود.
- Root دامنه Tenant مستقیماً به `/login` هدایت شود؛ اگر دیتابیس خالی باشد UI خودکار تب ثبت‌نام و پیام اولین Super Admin را نشان دهد.
- طبق مستندات رسمی Coolify، path-based routing با دامنه‌هایی مثل `https://domain/api` پشتیبانی می‌شود و مسیر خاص‌تر بر `/` اولویت دارد.

پیاده‌سازی انجام‌شده:

- `src/lib/api.js`: پیش‌فرض API از همان origin و مسیر `/api` استفاده می‌کند؛ `VITE_API_BASE` همچنان override اختیاری است.
- `src/App.jsx`: ریشه دامنه Tenant مستقیماً به `/login` می‌رود؛ marketing hostها Landing را نگه می‌دارند و `VITE_TENANT_UI` override دارد.
- `public/sw.js`: مسیر `/api` صریحاً از Service Worker خارج شد و cache به `v8` افزایش یافت.
- `Dockerfile`: Node 22 و `npm ci` با lockfile برای build تکرارپذیر.
- commitهای فرانت: `a085f8c173d6a85471fca649918e85919cf2a13e`, `4caaf8e8ab7bc96b389a0c11918b87afd0e90adf`, `703ba95524910c07d36c3f2ddd7268dfe9b772df`, `6e4976373184aef9a9f3e708d100be7ac68e573b`.
- CI run `135`: موفق.
- `nginx.conf`: اگر Backend ناسالم باشد و Coolify `/api` را به frontend fallback کند، Nginx با `503` fail-closed می‌شود و SPA HTML تحویل نمی‌دهد.
- commit fail-closed فرانت: `9ca9a9abb0084baf290e41699eb05b8473e39137`؛ CI run `141` موفق.
- Frontend Application در Coolify ساخته و تنظیمات آن در 2026-07-22 ذخیره شد؛ هنوز deploy نشده است.
- نام Frontend resource: `amalyar-frontend-staging`
- Build pack: `Dockerfile`
- Base Directory: `/`
- Dockerfile Location: `/Dockerfile`
- Exposed port: `80`
- Port Mapping و Network Aliases: خالی
- HTTP Basic Authentication: خاموش
- Watch Paths ذخیره‌شده: `src/**`، `public/**`، `index.html`، `package.json`، `package-lock.json`، `vite.config.js`، `Dockerfile` و `nginx.conf`
- دامنه موقت تأییدشده Frontend: `http://qryhv6hfkygfyegwc6qrffn5.62.60.214.40.sslip.io`
- اولین deploy فرانت در 2026-07-22 موفق شد؛ صفحه فارسی ورود/ثبت‌نام عمل‌یار روی دامنه موقت به‌درستی نمایش داده شد و خطای 502/503 یا JSON بک‌اند دیده نشد.
- هشدار مرورگر دامنه موقت ناشی از HTTP بودن آن است؛ دامنه‌های اصلی tenant باید با HTTPS استفاده شوند.
- Healthcheck فرانت در 2026-07-22 ذخیره و فعال شد: `GET http://localhost:80/login`، return code 200، interval 30، timeout 10، retries 5، start period 60 و response text خالی.
- دکمه Coolify اکنون `Disable Healthcheck` را نشان می‌دهد، پس فعال‌سازی تأیید شده است.
- پس از Redeploy، وضعیت Frontend به `Running (healthy)` رسید و مالک پروژه آن را تأیید کرد.
- Git Source پیش از اولین deploy تأیید شد: source=`amalyar-git`، repo=`shabhossini-web/Amalyar` و branch=`agent/security-permissions-hardening`.

## معماری Database-per-Tenant

تصمیم تأییدشده: هر شرکت PostgreSQL database مستقل دارد.

Control DB فقط tenant metadata، hostname و database URL رمزنگاری‌شده را نگه می‌دارد. بیمار، ویزیت، حساب و session در Control DB نیست.

فایل‌های اصلی:

- `server/prisma/control/schema.prisma`
- `server/prisma/control/migrations/**`
- `server/src/tenant/control-prisma.service.ts`
- `server/src/tenant/tenant-context.ts`
- `server/src/tenant/tenant.middleware.ts`
- `server/src/tenant/tenant-registry.service.ts`
- `server/src/tenant/tenant-crypto.ts`
- `server/src/tenant/tenant.module.ts`
- `server/src/prisma/prisma.service.ts`

رفتار:

1. tenant فقط از Host دقیق ثبت‌شده resolve می‌شود.
2. tenant ID/slug/database URL از header یا body کاربر پذیرفته نمی‌شود.
3. tenant باید active باشد.
4. AsyncLocalStorage context درخواست را نگه می‌دارد.
5. Prisma به database همان tenant route می‌شود.
6. JWT شامل `tid` است؛ توکن یک شرکت روی hostname شرکت دیگر رد می‌شود.
7. connection URL با AES-256-GCM و `TENANT_DATABASE_ENCRYPTION_KEY` رمزنگاری می‌شود.

## Provisioning و migration fleet

فایل‌ها:

- `server/src/scripts/provision-tenant.ts`
- `server/src/scripts/migrate-tenants.ts`

دستورات runtime از فایل‌های compiled اجرا می‌شوند:

```bash
npm run tenant:provision -- SLUG "NAME" HOSTNAME
npm run tenants:migrate
npm run tenants:migrate -- --apply
```

Provisioning برای هر شرکت role و database مستقل می‌سازد، migration را اجرا می‌کند، URL را رمزنگاری می‌کند و فقط پس از موفقیت tenant را active می‌کند. rollback فقط منابع ساخته‌شده همان اجرای اعتبارسنجی‌شده را حذف می‌کند.

Fleet migration پیش‌فرض dry-run است، برای اجرا `--apply` لازم دارد، sequential است و با اولین خطا متوقف می‌شود.

ریسک باقی‌مانده: `PROVISIONING_DATABASE_URL` اکنون داخل کانتینر دائمی API است. قبل از production آن را به یک job کوتاه‌عمر Coolify منتقل کن تا API credential دارای CREATEDB/CREATEROLE نداشته باشد.

## Tenantهای staging ساخته‌شده

Alpha:

- Slug: `alpha-staging`
- Host: `alpha-staging.amalyar.com`
- DB: `amalyar_alpha_staging`
- Role: `amalyar_alpha_staging_app`
- Status: active
- `/api/auth/setup-status` پاسخ `{"needsSetup":true}` داده است.

Beta:

- Slug: `beta-staging`
- Host: `beta-staging.amalyar.com`
- DB: `amalyar_beta_staging`
- Role: `amalyar_beta_staging_app`
- Status: active
- `/api/auth/setup-status` پاسخ `{"needsSetup":true}` داده است.

هر دو فرمان provisioning قبلاً موفق اجرا شده‌اند؛ دوباره اجرا نکن.

## امنیت و مجوزهای پیاده‌شده

مجوزهای ریزدانه:

- `patients.read`: level 2
- `patients.read_all`: 4
- `patients.create`: 3
- `patients.update`: 4
- `patients.status`: 4
- `patients.delete`: 6
- `definitions.read`: 2
- `definitions.manage`: 5
- `users.manage`: 6

فایل‌ها: `permission.decorator.ts` و `permission.guard.ts`. Permissionها در DB هر tenant هستند. Superadmin bypass دارد.

Object authorization: کاربر زیر supervisor فقط بیمار/ویزیت منتسب به `techId` خودش را می‌بیند. کنترل روی object انجام می‌شود، نه فقط endpoint.

Auth hardening:

- JWT production حداقل 32 کاراکتر و fail-closed
- JWT متصل به tenant ID
- bcrypt cost 12
- تغییر password همه sessionها را revoke می‌کند
- rate limit برای OTP/login
- dev OTP فقط با `NODE_ENV=test` در response برمی‌گردد
- bootstrap اولین superadmin با PostgreSQL advisory lock سریال شده است.

HTTP:

- CORS صریح و fail-closed
- nosniff، DENY frame، no-referrer، Permissions-Policy، COOP و HSTS production

Rate limiter فعلی in-memory است؛ قبل از چند replica باید Redis-backed شود.

## Data integrity و Audit

Schema tenant اضافه‌شده:

- `Permission`
- `AuditEvent`
- soft delete بیمار: `deletedAt`، `deletedById`، `deleteReason`
- `@@unique([patientId, seq])` برای Visit

رفتار:

- کد موقت مشترک `AM-TMP` با UUID جایگزین شد.
- حذف آخرین ویزیت بیمار را soft-delete می‌کند.
- mutationهای حساس بیمار audit می‌شوند.
- فایل‌ها: `server/src/audit/**`
- migration: `server/prisma/migrations/20260721090000_security_permissions/migration.sql`

Follow-up: برای ساخت هم‌زمان visit، unique constraint مانع duplicate می‌شود اما بهتر است retry محدود یا transaction سریال‌پذیر اضافه شود.

## خطاهای Coolify که حل شدند

1. `Cannot find module '../generated/control'`
   - generated Control Prisma client در Docker runtime کپی شد.
   - CI وجود artifact را بررسی می‌کند.

2. `Tenant context is not available for this request`
   - Nest propertyهایی مثل `then` را probe می‌کرد.
   - Proxy اکنون فقط model/operation واقعی Prisma را route می‌کند.
   - CI startup بدون tenant context را تست می‌کند.

3. `CORS_ORIGINS در production الزامی است`
   - متغیر Coolify از `ALLOWED_ORIGINS` به `CORS_ORIGINS` اصلاح شد.

## CI

`.github/workflows/security-ci.yml` این موارد را کنترل می‌کند:

- frontend install/build
- backend install/build
- validate tenant schema
- validate Control schema
- generated Control client artifact
- Prisma provider startup بدون tenant request

CI سبز است. تست integration واقعی چند DB هنوز باید اضافه شود.

## کارهای مهم باقی‌مانده

1. تست واقعی SMS آلفا کامل پاس شد: HTTP 201، تحویل موفق، و بدون OTP/شماره در log.
2. مسیر fallback پیامک fail-closed شد، CI run 107 سبز است و deployment نهایی Coolify Running تأیید شد.
3. Frontend resource ساخته و تنظیماتش ذخیره شده است؛ branch را کنترل، روی دامنه موقت deploy و سپس مسیرهای دامنه tenant را تنظیم کن.
4. تست قطعی: توکن Alpha روی Beta باید 401 شود؛ بیمار Alpha در Beta نباید دیده شود.
5. deploy/config frontend tenant-aware.
6. انتقال auth از localStorage به HttpOnly Secure cookie + CSRF با تصمیم درباره UX چندحسابی.
7. انتقال provisioning credential به job موقت.
8. Redis rate limit پیش از چند replica.
9. permission management API/UI و seed صریح.
10. audit برای auth، account admin، permission و emergency support.
11. backup جدا برای هر tenant، offsite encryption و restore drill.
12. رفع npm audit findings بدون `--force` کورکورانه.
13. PgBouncer و connection budget؛ cache فعلی tenant client نامحدود است.
14. object storage برای selfie/files.
15. انتقال DB فعلی production به اولین tenant واقعی.
16. rotation `JWT_SECRET` در cutover تا JWTهای قدیمی بدون tenant باطل شوند.
17. rehearsal کامل migration و rollback قبل از merge.

## ترتیب ادامه کار برای Claude

1. این فایل و `docs/COOLIFY_STAGING_STATE.md` را کامل بخوان.
2. Git branch، commit deployشده و Coolify state را دوباره verify کن.
3. production یا main را بدون اجازه تغییر نده.
4. Watch Paths روی `server/**` ذخیره و تأیید شده؛ آن را حفظ کن.
5. redeploy پس از MELI variables Running و پایدار تأیید شده؛ اکنون ارسال SMS آزمایشی و log را بررسی کن.
6. مشکل log شدن OTP و موفقیت جعلی بدون SMS credential اصلاح شد؛ CI و deployment نهایی هر دو تأیید شدند.
7. در Frontend resource ابتدا branch دقیق را verify کن، سپس روی دامنه موقت deploy و حساب‌های Alpha/Beta را فقط از UI بساز.
8. تست cross-tenant token/patient را اجرا و نتیجه را همین‌جا ثبت کن.
9. backup و restore را قبل از production تست کن.
10. PR را Draft نگه دار.

## محدوده فایل‌های تغییرکرده نسبت به main

- `.github/workflows/security-ci.yml`
- `docs/**`
- `server/Dockerfile`
- `server/package.json`
- `server/prisma/control/**`
- `server/prisma/migrations/20260721090000_security_permissions/**`
- `server/prisma/schema.prisma`
- `server/src/audit/**`
- `server/src/auth/**`
- `server/src/common/**`
- `server/src/patients/**`
- `server/src/prisma/**`
- `server/src/scripts/**`
- `server/src/tenant/**`
- `server/src/app.module.ts`
- `server/src/main.ts`

مقایسه authoritative: base=`main`، head=`agent/security-permissions-hardening`.
