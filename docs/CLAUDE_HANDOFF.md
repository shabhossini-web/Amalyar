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
- آخرین commit کد بک‌اند که CI و Coolify روی آن موفق شد: `3746f25a60a0d414b634e984af15a0fb48c29531`
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
- آخرین وضعیت تأییدشده پیش از تغییر متغیرهای SMS: Running و پایدار
- وضعیت redeploy پس از ثبت متغیرهای SMS: هنوز باید با healthcheck و لاگ Coolify دوباره تأیید شود
- لاگ موفق: `Nest application successfully started`
- لاگ موفق: `amalyar-server ← http://0.0.0.0:3001/api`
- Health عمومی تأییدشده: `https://api-staging.amalyar.com/api/health`

دامنه‌های Application:

- `https://api-staging.amalyar.com`
- `https://alpha-staging.amalyar.com`
- `https://beta-staging.amalyar.com`

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

در 2026-07-21 متغیرهای `MELI_API_KEY` و `MELI_FROM` از Application فعلی عمل‌یار به staging منتقل و تنظیماتشان تأیید شد. مقدارها محرمانه‌اند و در Git ثبت نشده‌اند. بعد از redeploy باید ارسال واقعی SMS و نبودن OTP در log بررسی شود.

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

1. redeploy پس از تنظیم متغیرهای SMS را با healthcheck، لاگ پایدار و یک ارسال واقعی آزمایشی تأیید کن.
2. SMS stub هنگام نبود credential متن OTP را log می‌کند؛ production باید fail-closed شود و OTP هرگز log نشود.
3. ساخت superadmin جدا در Alpha و Beta.
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
5. redeploy پس از MELI variables را با healthcheck، لاگ و ارسال SMS آزمایشی تأیید کن.
6. مشکل log شدن OTP بدون SMS credential را اصلاح کن.
7. حساب‌های Alpha/Beta را بساز.
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
