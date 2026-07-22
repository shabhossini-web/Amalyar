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
- آخرین commit شاخه که در CI کامل تأیید شد: `beca79650d7e9989be829affaacd690e61d252df` (`security-ci` run 274)
- آخرین commit کد بک‌اند که deployment آن در Coolify صریحاً تأیید شد: `02a86d4bf19d7144b11d92b8f9caa0e37305151e`
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
- GitHub Actions `security-ci` run 179 موفق شد؛ Backend سپس Redeploy شد و مالک پروژه تأیید کرد هر دو endpoint Alpha/Beta دوباره `{"needsSetup":true}` می‌دهند.

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

در 2026-07-22 روش ساخت حساب از Terminal رد و لغو شد؛ در همان مقطع هیچ حسابی با روش دستی ساخته نشد و Tenantهای Alpha/Beta هنوز `needsSetup=true` داشتند. این وضعیت تاریخی است؛ هر دو Tenant بعداً فقط از UI راه‌اندازی شدند.

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
- Frontend Application در Coolify ساخته و تنظیمات آن در 2026-07-22 ذخیره شد؛ اولین deploy و deployهای بعدی موفق شدند و وضعیت فعلی `Running (healthy)` است.
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
- در cutover ریشه دامنه‌ها در 2026-07-22، Frontend Domains روی `https://alpha-staging.amalyar.com`، `https://beta-staging.amalyar.com` و دامنه موقت HTTP تنظیم شد.
- Redeploy این تنظیم نیز `Running (healthy)` شد.
- smoke test اولیه Routing موفق بود: ریشه Alpha و Beta هر دو صفحه Login/Signup فرانت را نمایش دادند و `/api/auth/setup-status` در آن مقطع روی هر دو Tenant پاسخ صحیح `{"needsSetup":true}` داد.
- در آن smoke test اولیه هنوز هیچ حساب Super Admin ساخته نشده بود؛ این وضعیت تاریخی است و هر دو Tenant بعداً فقط از UI راه‌اندازی شدند.
- دامنه موقت HTTP از Frontend حذف شد؛ فقط `https://alpha-staging.amalyar.com` و `https://beta-staging.amalyar.com` باقی ماندند.
- Frontend پس از این پاک‌سازی Redeploy و `Running (healthy)` شد؛ تأیید مالک پروژه.
- onboarding اولین Super Admin آلفا از UI آغاز شد: درخواست SMS و تأیید OTP موفق بود و فرم پروفایل/نام کاربری/رمز/سلفی باز شد.
- ثبت نهایی اولین Super Admin آلفا از UI موفق شد؛ ورود خودکار انجام شد و داشبورد `/app` روی Host آلفا به‌درستی نمایش داده شد.
- شماره، OTP، نام، رمز، چهره و سایر اطلاعات شخصی عمداً در Git/مستندات ثبت نشده‌اند.
- `/api/auth/setup-status` آلفا پس از bootstrap به‌صورت مستقل تست شد و `{"needsSetup":false}` تأیید شد.
- اولین Super Admin بتا نیز فقط از UI ساخته شد؛ ورود خودکار موفق بود و داشبورد `/app` روی Host بتا نمایش داده شد.
- هیچ شماره، OTP، نام، رمز، تصویر یا داده شخصی از داشبورد در Git ثبت نشده است.
- smoke بصری نشان داد داشبوردهای Alpha/Beta داده‌های tenant-scoped متفاوت نمایش می‌دهند؛ این جایگزین تست رسمی cross-tenant token نیست.
- `/api/auth/setup-status` بتا پس از bootstrap به‌صورت مستقل تست شد و `{"needsSetup":false}` تأیید شد.
- وضعیت جاری onboarding: Alpha و Beta هر دو فقط از UI راه‌اندازی شده‌اند، هر دو داشبورد `/app` را نمایش می‌دهند و هر دو `needsSetup=false` هستند.
- Git Source پیش از اولین deploy تأیید شد: source=`amalyar-git`، repo=`shabhossini-web/Amalyar` و branch=`agent/security-permissions-hardening`.

## تصمیم Platform Admin و provisioning خودکار

در 2026-07-22 مالک پروژه ورود پیامکی Platform Admin را تأیید کرد.

معماری مصوب:

- Platform Admin از حساب و JWT شرکت‌ها کاملاً جدا است.
- ورود با OTP فقط برای شماره‌های allowlist شده در متغیر Coolify انجام می‌شود؛ هیچ شماره‌ای وارد کد یا Git نمی‌شود.
- session با token تصادفیِ hash‌شده در Control DB، کوکی `HttpOnly` کوتاه‌عمر و CSRF جدا محافظت می‌شود.
- OTP، session و درخواست‌ها rate limit و Audit می‌شوند؛ مقدار OTP، شماره، token و secret log نمی‌شود.
- API اصلی credential دارای `CREATEDB/CREATEROLE` نگه نمی‌دارد.
- UI یک `ProvisioningJob` در Control DB می‌سازد و وضعیت آن را نمایش می‌دهد.
- Worker جداگانه job را claim می‌کند، database/role مستقل می‌سازد، migration را اجرا می‌کند و نتیجه را در job ثبت می‌کند.
- Platform UI روی دامنه مدیریتی جدا deploy می‌شود؛ دامنه و Coolify resource پس از سبزشدن CI تنظیم خواهند شد.

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
- `/api/auth/setup-status` پس از bootstrap پاسخ `{"needsSetup":false}` داده است.

Beta:

- Slug: `beta-staging`
- Host: `beta-staging.amalyar.com`
- DB: `amalyar_beta_staging`
- Role: `amalyar_beta_staging_app`
- Status: active
- `/api/auth/setup-status` پس از bootstrap پاسخ `{"needsSetup":false}` داده است.

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
- مرز JWT: توکن دارای `tid` شرکت دیگر قبل از session lookup با 401 رد می‌شود.
- مرز Prisma: Tenantهای متفاوت client/database route جدا دارند، Tenant یکسان client خودش را reuse می‌کند و بدون context دسترسی fail-closed است.

تست `server/scripts/verify-tenant-isolation.js` در commit `9f27d486e3d1a342d66e05ca056136ce819ec942` اضافه و در workflow با commit `3c915d8b753fccc4894bff9712a238c35652b957` اجباری شد. GitHub Actions `security-ci` run 226 موفق شد. این تست قطعی سطح کد/CI است.
- تست زنده جداسازی داده، مرحله اول، در 2026-07-22 موفق شد: یک رکورد کاملاً ساختگی در Alpha ساخته شد و جست‌وجوی آن در Beta هیچ نتیجه‌ای نداد.
- هیچ مقدار رکورد، نام، شناسه یا داده شخصی در Git ثبت نشده است.
- تست زنده جداسازی داده، مرحله دوم، نیز موفق شد: رکورد کاملاً ساختگی Beta در Alpha پیدا نشد.
- نتیجه نهایی تست داده: جداسازی زنده در هر دو جهت Alpha→Beta و Beta→Alpha پاس شد؛ هیچ مقدار رکورد یا داده شخصی در Git ثبت نشده است.
- پس از تست، هر دو رکورد کاملاً ساختگی از Tenant مربوط به خودشان حذف شدند؛ staging از داده آزمایشی این تست پاک‌سازی شد.
- تست زنده cross-tenant token هنوز باقی مانده و باید به‌صورت خودکار اجرا شود، نه با کپی یا دست‌کاری دستی توکن توسط کاربر.

## پیاده‌سازی Platform Admin و provisioning خودکار — 2026-07-22

معماری تأییدشده اکنون روی شاخه پیاده‌سازی شده و هنوز برای staging در Coolify فعال نشده است:

- مدل‌های Control DB: `PlatformOtp`، `PlatformSession`، `ProvisioningJob` و `PlatformAuditEvent`.
- migration کنترل: `server/prisma/control/migrations/20260722213000_platform_admin_provisioning/migration.sql`.
- API مستقل Platform Admin در `server/src/platform/**` با OTP allowlist، session کوتاه HttpOnly، CSRF جدا، rate limit و audit بدون ثبت شماره/OTP/token.
- endpointهای مدیریتی زیر `/api/platform/**` قرار دارند و وقتی `PLATFORM_ADMIN_ENABLED` فعال نباشد، fail-closed و غیرقابل استفاده‌اند.
- فرانت مدیریتی موبایل‌پسند در `src/app/PlatformAdmin.jsx` و route `/platform-admin` پیاده‌سازی شد.
- UI فقط job می‌سازد و status را poll می‌کند؛ credential ساخت دیتابیس در Backend API نگهداری نمی‌شود.
- Worker در `server/src/scripts/provisioning-worker.ts` job را claim می‌کند، role/database اختصاصی می‌سازد، migration tenant را اجرا می‌کند و ثبت tenant + موفقیت job + audit را در یک transaction کنترل انجام می‌دهد.
- failure معمولی با error code امن ثبت و role/database ساخته‌شده در همان invocation rollback می‌شود.
- image مستقل و بدون پورت عمومی Worker در `server/Dockerfile.worker` اضافه شد؛ command ثابت آن `node dist/scripts/provisioning-worker.js` است.
- script محلی/runtime: `npm run provisioning:worker`.
- فایل خالص تنظیمات امنیتی `server/src/platform/platform.config.ts` از ماژول runtime جدا شد تا fail-closed بودن بدون نیاز به Prisma Client تست شود.
- CI run 266 به‌علت import کل `platform.module` و نبود runtime-generated Control client در آن مرحله شکست خورد؛ این شکست مربوط به harness تست بود، نه منطق امنیتی.
- اصلاح CI با commitهای `78fec7b57332f0a0bf921d3123e36f132627a7f3`، `62827ebcbd490f3f86d416b0022f7cedbf58b055` و `dff8be6d66365159ebfbff0591187efbab78dbd6` انجام شد.
- `security-ci` run 272 بعد از اصلاح تست موفق شد.
- Dockerfile مستقل Worker با commit `beca79650d7e9989be829affaacd690e61d252df` اضافه شد و `security-ci` run 274 کامل موفق شد.
- هیچ secret، شماره تلفن، OTP، token، password یا connection URL در کد و این مستند ثبت نشده است.

تعهدهای اصلی پیاده‌سازی:

- Backend API فقط `CONTROL_DATABASE_URL` را برای صف و metadata نیاز دارد.
- فقط Worker باید `PROVISIONING_DATABASE_URL` را داشته باشد.
- Backend و Worker هر دو برای decrypt/encrypt URLهای tenant به `TENANT_DATABASE_ENCRYPTION_KEY` نیاز دارند.
- Worker نباید domain یا exposed port داشته باشد.
- دامنه مدیریت پیشنهادی staging: `admin-staging.amalyar.com`؛ هنوز در Coolify/DNS پیکربندی نشده است.

## کارهای مهم باقی‌مانده

1. تست واقعی SMS آلفا کامل پاس شد: HTTP 201، تحویل موفق، و بدون OTP/شماره در log.
2. مسیر fallback پیامک fail-closed شد، CI run 107 سبز است و deployment نهایی Coolify Running تأیید شد.
3. Frontend resource، دامنه‌های Alpha/Beta، Healthcheck و onboarding فقط از UI کامل و `Running (healthy)` تأیید شده‌اند.
4. تست خودکار قطعی جداسازی به CI اضافه شد و run 226 سبز شد: JWT با `tid` شرکت دیگر 401 می‌شود و Prisma برای Tenantهای متفاوت client/Database route جدا انتخاب می‌کند.
5. تست زنده داده در هر دو جهت پاس و هر دو رکورد ساختگی پاک‌سازی شدند. Platform Admin، provisioning queue/Worker و UI پیاده‌سازی شدند و CI run 274 سبز است؛ مرحله بعد پیکربندی سه resource/route لازم در Coolify staging است.
6. انتقال auth از localStorage به HttpOnly Secure cookie + CSRF با تصمیم درباره UX چندحسابی.
7. انتقال نهایی `PROVISIONING_DATABASE_URL` از Backend به Worker اختصاصی پس از سبز شدن Worker در Coolify.
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
7. Frontend branch، deploy، دامنه‌ها، Healthcheck و ساخت حساب‌های Alpha/Beta فقط از UI تکمیل و تأیید شده است.
8. تست خودکار CI و تست زنده داده در هر دو جهت پاس شده‌اند؛ Platform Admin و Worker نیز پیاده‌سازی و CI شده‌اند. اکنون Coolify staging را مرحله‌ای پیکربندی کن و بعد یک provisioning آزمایشی فقط از UI انجام بده.
9. backup و restore را قبل از production تست کن.
10. PR را Draft نگه دار.

## محدوده فایل‌های تغییرکرده نسبت به main

- `.github/workflows/security-ci.yml`
- `docs/**`
- `server/Dockerfile`
- `server/Dockerfile.worker`
- `server/package.json`
- `server/prisma/control/**`
- `server/prisma/migrations/20260721090000_security_permissions/**`
- `server/prisma/schema.prisma`
- `server/src/audit/**`
- `server/src/auth/**`
- `server/src/common/**`
- `server/src/patients/**`
- `server/src/platform/**`
- `server/src/prisma/**`
- `server/src/scripts/**`
- `server/scripts/**`
- `server/src/tenant/**`
- `server/src/app.module.ts`
- `server/src/main.ts`

مقایسه authoritative: base=`main`، head=`agent/security-permissions-hardening`.

## Coolify Platform Admin activation log — 2026-07-22

- Backend resource: `agent/security-permissions-hardening` در environment `staging`.
- `PLATFORM_ADMIN_ENABLED=true` در Coolify ثبت شد.
- تنظیم تأییدشده: Buildtime خاموش، Runtime روشن، Multiline خاموش، Literal روشن.
- هنوز deployment انجام نشده است.
- مقدار اولیه ۱۵کاراکتری برای `PLATFORM_ADMIN_SECRET` قبل از deployment به‌دلیل کوتاه‌بودن رد شد؛ هیچ deployment با آن انجام نشد.
- `PLATFORM_ADMIN_SECRET` با یک مقدار تصادفی ۶۴کاراکتری در Coolify ثبت و Lock شد؛ مقدار آن در Git/Chat ثبت نشده است.
- تنظیم secret: Buildtime خاموش، Runtime روشن، Multiline خاموش، Literal روشن.
- `PLATFORM_ADMIN_PHONES` در Coolify ثبت و Lock شد؛ مقدار و شماره موبایل عمداً در Git/Chat ثبت نشده است.
- تنظیم allowlist: Buildtime خاموش، Runtime روشن، Multiline خاموش، Literal روشن.
- هر سه متغیر Platform Admin ذخیره شدند و Backend با این مجموعه redeploy شد؛ مالک پروژه وضعیت پایدار/صحیح را تأیید کرد.
- تلاش برای smoke test read-only از مرورگر ابری Agent به‌دلیل policy مرورگر روی دامنه staging رد شد؛ هیچ دورزدنی انجام نشد و نتیجه endpoint از طرف Agent تأییدشده محسوب نمی‌شود.
- DNS دامنه `admin-staging.amalyar.com` به همان سرور staging ثبت شد؛ IP در Git ثبت نشده است.
- دامنه `https://admin-staging.amalyar.com` به Frontend resource `amalyar-frontend-staging` افزوده و Save شد؛ Alpha/Beta حفظ شدند و هنوز redeploy انجام نشده است.
- route `https://admin-staging.amalyar.com/api` به Backend resource افزوده و Save شد؛ routeهای API/Alpha/Beta حفظ شدند.
- نخستین redeploy پس از افزودن route در Docker build شکست خورد: wrapper با exit code 255 متوقف شد و آخرین مرحله قابل‌مشاهده `RUN apk add --no-cache openssl` بود.
- Debug Logs هیچ خطای `apk`/npm/TypeScript نشان نداد؛ Coolify `DeploymentException` با error code 0 ثبت کرد، فرمان `docker exec ... /artifacts/build.sh` قطع شد و build container سپس gracefully stop شد. تشخیص فعلی: شکست build-helper/orchestrator، نه خطای اثبات‌شده در Dockerfile یا برنامه.
- یک redeploy عادی کنترل‌شده تکرار شد و کامل موفق شد؛ Backend با route مدیریت بالا آمد. نتیجه، گذرا بودن failure قبلی build-helper را تأیید می‌کند و نیاز به تغییر Dockerfile ایجاد نشد.
- Frontend resource `amalyar-frontend-staging` پس از افزودن دامنه مدیریت redeploy شد و مالک پروژه موفقیت deployment را تأیید کرد.
- smoke test عمومی `admin-staging` از مرورگر ابری Agent نیز به‌دلیل browser security policy رد شد؛ هیچ workaround انجام نشد و visual routing باید از مرورگر مالک پروژه تأیید شود.
- مالک پروژه visual smoke test را در مرورگر موبایل انجام داد: صفحه مستقل «مدیریت پلتفرم» روی `https://admin-staging.amalyar.com` با HTTPS باز شد؛ صفحه tenant، JSON، 404، 502 و خطای SSL دیده نشد.
- هیچ شماره، OTP، تصویر شخصی یا داده حساس از smoke test در Git ثبت نشده است.
- نسخه قبلی Backend همچنان سبز و `Running` باقی ماند؛ downtime رخ نداد. تا دریافت Debug Logs redeploy تکرار نشود.
- گام بعدی: route دامنه مدیریت در Frontend و Backend و سپس تست OTP فقط از UI.


## ورود بدون دریافت شماره و WebOTP — 2026-07-23

- به درخواست مالک پروژه، فیلد ورود شماره از رابط مدیریت پلتفرم حذف شد؛ مقدار allowlist همچنان فقط در متغیر `PLATFORM_ADMIN_PHONES` روی سرور می‌ماند.
- endpoint عمومی `GET /api/platform/auth/options` فقط برچسب عمومی و شناسه HMAC غیرقابل‌بازگشت برمی‌گرداند؛ شماره خام در response، UI یا log قرار نمی‌گیرد.
- وقتی یک مدیر مجاز وجود داشته باشد، فرانت همان گزینه را خودکار انتخاب می‌کند؛ در حالت چند مدیر، فقط برچسب‌های عمومی برای انتخاب نمایش داده می‌شوند.
- مسیرهای request/verify اکنون `phoneRef` را می‌پذیرند. ورودی قدیمی `phone` موقتاً فقط برای rollout بدون قطعی نگه داشته شده و UI جدید آن را ارسال نمی‌کند.
- WebOTP به صفحه verify افزوده شد و فیلد همچنان `autocomplete="one-time-code"` دارد؛ در مرورگرهای فاقد پشتیبانی، ورود دستی برقرار است.
- `SmsService` خط پایانی origin-bound پیامک را با host معتبر می‌سازد. متغیر جدید `PLATFORM_ADMIN_WEBOTP_HOST` فقط hostname بدون protocol/path می‌گیرد.
- تست CI برای شناسه غیرقابل‌بازگشت، resolve امن، اعتبارسنجی host و قالب origin-bound پیامک اضافه شد.
- آخرین commit این بسته: `1b07c2868fdd55d5d02a5a8b7260b8afb86a692a`. نتیجه CI هنوز در انتظار است.
- مرحله Coolify هنوز انجام نشده: متغیر `PLATFORM_ADMIN_WEBOTP_HOST` باید روی Backend staging ثبت شود، سپس Backend و Frontend redeploy و OTP واقعی از UI تست شود.
- هیچ شماره، OTP، secret یا مقدار حساس در Git ثبت نشده است.
