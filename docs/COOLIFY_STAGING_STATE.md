# Coolify staging state — Amalyar

> منبع ثابت وضعیت استقرار؛ بعد از هر مرحله به‌روزرسانی شود. هیچ secret، password یا connection URL در این فایل ثبت نشود.

## Scope

- Coolify project (confirmed): `Amalyar`
- Environments (confirmed): `production`, `staging`
- Active work environment: `staging`
- Git repository: `shabhossini-web/Amalyar`
- Git branch: `agent/security-permissions-hardening`
- Draft PR: https://github.com/shabhossini-web/Amalyar/pull/1
- Latest explicitly Coolify-verified application commit: `02a86d4bf19d7144b11d92b8f9caa0e37305151e`
- Latest branch commit fully verified by CI: `beca79650d7e9989be829affaacd690e61d252df` (`security-ci` run 274)

## Coolify resources

### Backend application

- Coolify application resource name (confirmed): `agent/security-permissions-hardening`
- Never refer to this resource as `amalyar-api-staging` unless the user explicitly renames it.
- Build pack: Dockerfile
- Base directory: `/server`
- Dockerfile location: `/Dockerfile`
- Exposed port: `3001`
- Watch Paths: `server/**` (saved and confirmed)
- Healthcheck: `GET http://localhost:3001/api/health`
- Post-SMS-variable redeploy state (confirmed 2026-07-21): running and stable
- Verified public health URL: `https://api-staging.amalyar.com/api/health`

### PostgreSQL resource

- Coolify database resource name (confirmed): `amalyar-control-staging`
- Image: `postgres:18-alpine`
- Internal port: `5432`
- Public access: disabled
- Initial database: `amalyar_control_staging`
- Provisioning username: `amalyar_provisioner`
- Connection URL and password: never record here

## Domains and path routing

Backend routing saved and successfully redeployed on 2026-07-22:

- `https://api-staging.amalyar.com`
- `https://alpha-staging.amalyar.com/api`
- `https://beta-staging.amalyar.com/api`

Browser verification on 2026-07-22:

- Main API health passed with `ok:true`.
- Alpha/Beta requests reached the Backend but returned 404 `Cannot GET /auth/setup-status`; the proxy stripped the public `/api` prefix.
- No personal data visible in submitted screenshots was copied into Git.
- Alpha/Beta root domains are still not assigned to the Frontend Application.

Automatic fix added on the working branch:

- `server/src/common/api-prefix.ts` restores a missing public API prefix.
- `server/src/main.ts` applies the restoration before Nest route matching while leaving already-prefixed URLs unchanged.
- Security CI now tests stripped paths, query strings, already-prefixed paths, and root.
- Code commits: `22a2a69cf9693b2860315a0f62ad194c59a2c71c`, `d82114593dcba25370222a281ffad185165fedea`, `343384a9026669d32dd9a1b4af5c97bdf3d4e0ba`.
- GitHub Actions `security-ci` run 179 passed. Backend redeploy completed, and the owner confirmed both Alpha and Beta setup endpoints return `{"needsSetup":true}`.

## Runtime environment variables

Configured variable names only:

- `CONTROL_DATABASE_URL`
- `PROVISIONING_DATABASE_URL`
- `TENANT_DATABASE_ENCRYPTION_KEY`
- `JWT_SECRET`
- `NODE_ENV=production`
- `PORT=3001`
- `CORS_ORIGINS=https://alpha-staging.amalyar.com,https://beta-staging.amalyar.com`
- `MELI_API_KEY` (secret value configured in Coolify)
- `MELI_FROM` (secret value configured in Coolify)

Secret settings confirmed for `MELI_API_KEY` and `MELI_FROM`: Buildtime off, Runtime on, Multiline off, Literal on. Values are intentionally not recorded.

Correction: the application expects `CORS_ORIGINS`; `ALLOWED_ORIGINS` is not used.

`MELI_API_KEY` and `MELI_FROM` were copied securely from the existing Amalyar application to staging on 2026-07-21. Redeploy, real SMS delivery, and the no-OTP/no-phone log check all passed.

## SMS smoke test

- Date: `2026-07-21`
- Tenant: `alpha-staging`
- Request: `POST /api/auth/signup/request-otp`
- API result: HTTP `201`, body `{"ok":true,"ttl":300}`
- Phone number and OTP are intentionally not recorded.
- Mobile delivery confirmation: successful and confirmed by the project owner
- Application-log exposure check (2026-07-22): passed; no `STUB`, phone number, OTP, or verification-code text was observed

## SMS fail-closed hardening

- Date: `2026-07-22`
- Production now returns HTTP `503` when SMS credentials are absent or provider delivery fails.
- Undelivered OTP requests no longer return a false success response.
- Undelivered OTP rows are removed so the resend window does not block the user.
- Phone number, OTP, message text, raw provider response, raw exception, and API-key URL are not logged.
- Backend code head: `02a86d4bf19d7144b11d92b8f9caa0e37305151e`
- GitHub Actions `security-ci` run 107: completed successfully
- Coolify deployment after this change: running, green, and confirmed stable on 2026-07-22
- Post-hardening real Alpha request: HTTP `201`, body `{"ok":true,"ttl":300}`; phone and OTP are not recorded

## UI-only onboarding decision

- Date: `2026-07-22`
- Manual Terminal-based account creation was rejected; no account was created that way.
- At this decision point, Alpha and Beta were still in `needsSetup=true`; this is historical and both tenants were later bootstrapped only through the UI.
- Existing React UI already supports setup-status, OTP, profile fields, live selfie, and automatic bootstrap Super Admin login.
- A separate frontend Application will serve `/` on tenant domains.
- The Backend Application will serve the more-specific `/api` path on the same tenant domains.
- Frontend API default will be same-origin `/api`, preserving the real tenant Host.
- Coolify officially supports path-based routing and gives a more-specific path priority over `/`.
- Frontend code now defaults to same-origin `/api`, redirects tenant root to `/login`, bypasses `/api` in the Service Worker, and builds reproducibly with Node 22 + `npm ci`.
- Frontend implementation head: `6e4976373184aef9a9f3e708d100be7ac68e573b`
- GitHub Actions `security-ci` run 135: completed successfully
- Frontend Nginx returns `503` for `/api` fallback if the Backend route is unhealthy; implementation head `9ca9a9abb0084baf290e41699eb05b8473e39137`, CI run 141 passed
### Frontend application

- Coolify application resource name (confirmed saved 2026-07-22): `amalyar-frontend-staging`
- Deployment state: first deployment successful; UI smoke test passed
- Build pack: Dockerfile
- Base directory: `/`
- Dockerfile location: `/Dockerfile`
- Exposed port: `80`
- Port mapping: empty
- Network aliases: empty
- HTTP Basic Authentication: disabled
- Watch Paths: `src/**`, `public/**`, `index.html`, `package.json`, `package-lock.json`, `vite.config.js`, `Dockerfile`, `nginx.conf`
- Confirmed temporary frontend domain: `http://qryhv6hfkygfyegwc6qrffn5.62.60.214.40.sslip.io`
- First frontend deployment and page smoke test passed on 2026-07-22: the Persian Amalyar login/signup UI rendered correctly; no 502/503 or backend JSON was shown.
- The temporary URL is HTTP and showed the expected browser warning; tenant custom domains must use HTTPS.
- Frontend healthcheck saved and enabled 2026-07-22: `GET http://localhost:80/login`, expected 200, blank response-text match, interval 30s, timeout 10s, retries 5, start period 60s.
- Coolify shows `Disable Healthcheck`, confirming it is enabled.
- Redeploy completed and the Frontend reports `Running (healthy)`; confirmed by the project owner.
- Tenant root domains were then assigned to the Frontend: `https://alpha-staging.amalyar.com` and `https://beta-staging.amalyar.com`; the temporary HTTP domain remains during smoke testing.
- The domain-cutover redeploy also reached `Running (healthy)`.
- Initial routing smoke test passed: Alpha and Beta roots rendered the frontend login/signup UI, while each tenant's `/api/auth/setup-status` returned `{"needsSetup":true}` at that time.
- No Super Admin account had been created at that initial smoke-test point; this is historical and both tenants were later bootstrapped only through the UI.
- Temporary HTTP domain removed; Frontend now has only `https://alpha-staging.amalyar.com` and `https://beta-staging.amalyar.com`.
- Cleanup redeploy completed and Frontend is `Running (healthy)`; confirmed by the project owner.
- Alpha first-Super-Admin onboarding started through the UI: SMS request and OTP verification passed, and the profile/username/password/selfie form opened.
- Alpha first Super Admin creation completed successfully through the UI; automatic login worked and the Alpha `/app` dashboard rendered.
- Phone, OTP, name, password, face, and all personal data are intentionally not recorded.
- Alpha `/api/auth/setup-status` was explicitly checked after bootstrap and returned `{"needsSetup":false}`.
- Beta first Super Admin was also created through the UI; automatic login succeeded and the Beta `/app` dashboard rendered.
- No phone, OTP, name, password, image, or dashboard personal data is recorded.
- Visual smoke showed distinct tenant-scoped dashboard data between Alpha and Beta; formal cross-tenant token testing is still required.
- Beta `/api/auth/setup-status` was explicitly checked after bootstrap and returned `{"needsSetup":false}`.
- Current onboarding state: Alpha and Beta were both bootstrapped only through the UI, both `/app` dashboards render, and both tenants report `needsSetup=false`.
- Git Source verified 2026-07-22: source `amalyar-git`, repository `shabhossini-web/Amalyar`, branch `agent/security-permissions-hardening`, Commit SHA setting `HEAD`.

## Provisioned tenants

### Alpha

- Slug: `alpha-staging`
- Display name: شرکت آزمایشی الف
- Hostname: `alpha-staging.amalyar.com`
- Database: `amalyar_alpha_staging`
- Runtime role: `amalyar_alpha_staging_app`
- Status: active
- Setup endpoint result after UI bootstrap: `{"needsSetup":false}`

### Beta

- Slug: `beta-staging`
- Display name: شرکت آزمایشی بتا
- Hostname: `beta-staging.amalyar.com`
- Database: `amalyar_beta_staging`
- Runtime role: `amalyar_beta_staging_app`
- Status: active
- Setup endpoint result after UI bootstrap: `{"needsSetup":false}`

## Approved Platform Admin and automated provisioning architecture

- Approved by the project owner on 2026-07-22.
- Platform Admin authentication is separate from tenant accounts and tenant JWTs.
- OTP is sent only to phone numbers allowlisted in Coolify environment variables; no phone number is committed to Git.
- Platform sessions use random tokens stored only as hashes in Control DB, short-lived HttpOnly cookies, and separate CSRF protection.
- OTP/session actions are rate-limited and audited without logging phone, OTP, token, or secrets.
- The API must not retain a PostgreSQL credential with CREATEDB/CREATEROLE.
- The UI creates a ProvisioningJob in Control DB and polls its status.
- A separate Worker claims queued jobs, creates the isolated role/database, runs migrations, and records a safe status/result.
- A dedicated management domain and Coolify Worker resource will be configured only after CI passes.

## Platform Admin implementation ready for Coolify

Code and CI status on 2026-07-22:

- Control DB schema/migration for OTP, sessions, provisioning jobs, and platform audit is committed.
- Backend endpoints are available under `/api/platform/**` but remain fail-closed until explicitly enabled.
- Mobile Platform Admin UI is available at `/platform-admin`.
- The default management host recognized by the frontend is `admin-staging.amalyar.com`.
- Dedicated Worker image: Base directory `/server`, Dockerfile location `/Dockerfile.worker`.
- The Worker image exposes no port and must have no public domain.
- `security-ci` run 272 passed after isolating the pure fail-closed configuration test from runtime Prisma imports.
- `security-ci` run 274 passed after adding the dedicated Worker Dockerfile.
- CI-verified code head: `beca79650d7e9989be829affaacd690e61d252df`.
- Coolify resources and DNS for Platform Admin/Worker have not yet been configured.

Backend variables to add in the next Coolify step (values must remain only in Coolify):

- `PLATFORM_ADMIN_ENABLED=true`
- `PLATFORM_ADMIN_SECRET`
- `PLATFORM_ADMIN_PHONES`
- Existing `CONTROL_DATABASE_URL`
- Existing `TENANT_DATABASE_ENCRYPTION_KEY`
- Keep `PROVISIONING_DATABASE_URL` temporarily until the Worker is running; then remove it from Backend.

Worker variables required:

- `NODE_ENV=production`
- `CONTROL_DATABASE_URL`
- `PROVISIONING_DATABASE_URL`
- `TENANT_DATABASE_ENCRYPTION_KEY`
- optional `PROVISIONING_POLL_MS`

The Worker must not receive tenant JWT, SMS credentials, a public domain, or an exposed port.

## Completed fixes discovered during deployment

- Deterministic tenant-isolation verifier added at `server/scripts/verify-tenant-isolation.js` in commit `9f27d486e3d1a342d66e05ca056136ce819ec942` and enforced by workflow commit `3c915d8b753fccc4894bff9712a238c35652b957`.
- GitHub Actions `security-ci` run 226 passed.
- The verifier proves a JWT with another tenant's `tid` is rejected with 401 before session lookup, Prisma uses distinct clients/database routes for distinct tenant IDs, reuses only the same tenant's client, and fails closed without tenant context.
- This is the deterministic code/CI boundary test.
- Live data-isolation stage 1 passed on 2026-07-22: a fully synthetic record created in Alpha was not found when searched from Beta.
- No record value, name, identifier, credential, or personal data is stored in Git.
- Reverse Beta-to-Alpha live data isolation also passed: a fully synthetic Beta record was not found from Alpha.
- Final live data result: bidirectional Alpha-to-Beta and Beta-to-Alpha separation passed; no record value or personal data is stored in Git.
- Both fully synthetic test records were then removed from their own tenant; staging was cleaned after the test.
- A live cross-tenant token test remains and must be automated rather than requiring the user to copy or manipulate tokens manually.
- Generated Control Prisma client is copied into the runtime image.
- Prisma proxy no longer requires tenant context during NestJS provider startup.
- Control DB migration runs successfully at container startup.
- CORS configuration is fail-closed in production.
- Application healthcheck is stable.

## Next step

1. Alpha SMS smoke test passed end-to-end: HTTP 201, delivery confirmed, and no OTP/phone exposure in logs.
2. SMS production fallback is fail-closed; CI run 107 and the final Coolify deployment both passed.
3. Frontend branch, tenant domains, healthcheck, and UI-only Alpha/Beta bootstrap are complete and verified.
4. Deterministic automated tenant-isolation checks are complete and `security-ci` run 226 passed.
5. Bidirectional live data isolation passed and both synthetic records were removed. Platform Admin, queue/Worker, mobile UI, and the dedicated Worker image are implemented; CI run 274 passed. Next configure the management domain, Backend variables, and non-public Worker resource in Coolify staging.

## Platform Admin Coolify activation progress — 2026-07-22

- Backend resource `agent/security-permissions-hardening`: `PLATFORM_ADMIN_ENABLED=true` saved.
- Settings: Buildtime off, Runtime on, Multiline off, Literal on.
- A 15-character candidate for `PLATFORM_ADMIN_SECRET` was rejected before deployment because it was too short.
- `PLATFORM_ADMIN_SECRET` is now saved and locked with a randomly generated 64-character value; the value is intentionally not recorded.
- Secret flags: Buildtime off, Runtime on, Multiline off, Literal on.
- `PLATFORM_ADMIN_PHONES` is saved and locked; its value is intentionally not recorded.
- Allowlist flags: Buildtime off, Runtime on, Multiline off, Literal on.
- All three Platform Admin variables are saved and locked where applicable.
- Backend was redeployed with the Platform Admin configuration; the project owner confirmed the deployment is stable/correct.
- A read-only cloud-browser smoke test was blocked by browser security policy; no workaround was attempted and the endpoint is not marked Agent-verified.
- DNS for `admin-staging.amalyar.com` now points to the staging server; the server IP is intentionally not recorded.
- `https://admin-staging.amalyar.com` was appended to Frontend resource `amalyar-frontend-staging`; Alpha/Beta domains were preserved. Saved, not yet redeployed.
- `https://admin-staging.amalyar.com/api` was appended to the Backend resource; the existing API/Alpha/Beta routes were preserved.
- The first Backend redeploy after the route change failed during Docker build. The normal log shows wrapper exit code 255 and the last visible build step `RUN apk add --no-cache openssl`.
- Debug Logs contain no `apk`, npm, or TypeScript failure. Coolify recorded `DeploymentException` error code 0, the `docker exec ... /artifacts/build.sh` helper command stopped, and the build container was then gracefully stopped. Current diagnosis is a build-helper/orchestrator failure, not a proven application/Dockerfile error.
- One controlled normal redeploy retry completed successfully. Backend is now deployed with the management API route, confirming the prior build-helper failure was transient; no Dockerfile change was needed.
- Frontend resource `amalyar-frontend-staging` was redeployed after adding the management domain; the project owner confirmed deployment success.
- Agent cloud-browser access to `admin-staging` was blocked by browser security policy. No workaround was attempted; visual routing remains for owner-browser confirmation.
- Owner-browser visual smoke test passed: `https://admin-staging.amalyar.com` rendered the dedicated Platform Admin login page over HTTPS, with no tenant UI, JSON, 404, 502, or SSL error.
- No phone, OTP, image, or sensitive value from the smoke test is recorded.
- The previous Backend container remains green and Running, so there was no service downtime. Do not retry until Debug Logs are inspected.
- Next: configure the dedicated management-domain routes, then test OTP through the management UI.


## Platform Admin phone-less login / WebOTP — 2026-07-23

- Code head: `1b07c2868fdd55d5d02a5a8b7260b8afb86a692a`; CI pending.
- Frontend no longer asks for or submits a raw phone number.
- Backend returns only an opaque HMAC phone reference and a generic label; allowlisted phone values remain server-only.
- Request/verify use `phoneRef`; the legacy raw-phone field is temporarily accepted only for a zero-downtime rollout.
- WebOTP listening is enabled in supported browsers with manual-code fallback.
- New Backend runtime variable required before the next staging redeploy: `PLATFORM_ADMIN_WEBOTP_HOST` (hostname only; no scheme/path).
- Pending sequence: wait for CI, save the new runtime variable, redeploy Backend, redeploy Frontend, then owner-browser OTP smoke test.
- No phone, OTP, secret, credential, connection URL, or personal value is recorded here.


### CI failure observed

- `security-ci` run 340 failed only in step `Verify Platform Admin SMS uses origin-bound WebOTP`.
- Frontend build, Backend build, Prisma validation, tenant isolation, fail-closed config and opaque reference checks all passed.
- Root cause: the inline YAML `run: node -e ...` contained a WebOTP fragment marker; YAML treated the unprotected marker as a comment and the generated shell command ended with an unmatched quote.
- This is a workflow quoting error, not a failure in application/WebOTP behavior.
- Focused fix pending owner approval: convert only this CI command to a YAML block scalar while preserving the same assertion, then rerun CI.


### CI quoting fix applied

- مالک پروژه اجرای اصلاح محدود را تأیید کرد.
- فقط step تست WebOTP از scalar تک‌خطی به YAML block scalar تبدیل شد تا fragment marker پیامک توسط YAML به‌عنوان comment تفسیر نشود.
- منطق برنامه، قالب پیامک و assertion تست تغییر نکرد.
- fix commit: `0334c3831fd45b6450684e36c5edf0500cb2f4d8`; rerun CI در انتظار نتیجه است.


### CI verification complete

- `security-ci` run 350 completed successfully on commit `078235f784b747c624c03f4577353c144cd7452d`.
- Frontend build, Backend build, both Prisma schema validations, tenant isolation, fail-closed Platform Admin config, opaque phone reference and origin-bound WebOTP SMS tests all passed.
- Code is ready for the Coolify staging variable and controlled Backend/Frontend redeploy.


### Coolify WebOTP variable saved

- مالک پروژه تأیید کرد `PLATFORM_ADMIN_WEBOTP_HOST` روی Backend resource در staging اضافه و ذخیره شده است.
- مقدار، hostname دامنه مدیریت staging است و هیچ secret یا شماره‌ای ثبت نشده است.
- Backend هنوز بعد از این تغییر redeploy نشده؛ مرحله بعد redeploy کنترل‌شده Backend و بررسی Running/Healthy و log است.


### Backend WebOTP deployment confirmed

- مالک پروژه تأیید کرد Backend staging پس از افزودن `PLATFORM_ADMIN_WEBOTP_HOST` با redeploy معمولی بالا آمد و وضعیت `Running` دارد.
- مرحله بعد: redeploy فرانت `amalyar-frontend-staging` برای فعال‌شدن رابط بدون فیلد شماره و listener خودکار WebOTP.
- تست واقعی OTP مدیریت هنوز بعد از این deployment انجام نشده است.


### Frontend phone-less login deployment confirmed

- مالک پروژه تأیید کرد `amalyar-frontend-staging` با نسخه جدید با موفقیت deploy شده است.
- Backend و Frontend این بسته اکنون هر دو روی staging مستقر هستند.
- بررسی بعدی قبل از ارسال OTP: صفحه مدیریت باید بدون فیلد شماره نمایش داده شود و فقط کنترل «ارسال کد ورود» برای مدیر ثبت‌شده در سرور داشته باشد.
- تست دریافت و autofill واقعی OTP هنوز انجام نشده است.


### Owner visual verification: phone field removed

- مالک پروژه صفحه مدیریت staging را بعد از deploy باز کرد و تأیید تصویری انجام شد.
- فیلد ورود شماره حذف شده و UI توضیح می‌دهد که شماره مجاز از تنظیم امن سرور انتخاب می‌شود.
- هیچ شماره یا شناسه خام در صفحه نمایش داده نمی‌شود.
- در تصویر، دکمه ارسال کم‌رنگ/احتمالاً disabled دیده می‌شود؛ قبل از OTP smoke test باید امکان کلیک آن از مرورگر مالک تأیید شود.
- تلاش read-only Agent برای endpoint گزینه‌ها دوباره توسط browser safety policy رد شد؛ نتیجه endpoint از سمت Agent تأیید نشده است.


### Phone-less Platform Admin login passed

- مالک پروژه از UI بدون شماره عبور کرد و داشبورد احرازشده مدیریت پلتفرم با موفقیت باز شد.
- این نتیجه تأیید می‌کند گزینه opaque مدیر، درخواست OTP، verify/session cookie و بارگذاری داشبورد عملیاتی هستند.
- هیچ شماره، OTP، نام، تصویر شخصی یا جزئیات رکوردهای نمایش‌داده‌شده در Git ثبت نشده است.
- هنوز باید مشخص شود WebOTP کد را خودکار در فیلد گذاشته یا ورود کد به‌صورت دستی انجام شده است.


### WebOTP end-to-end verified

- مالک پروژه تأیید کرد کد پیامک روی مرورگر موبایل به‌صورت خودکار داخل جریان ورود قرار گرفت؛ ورود دستی شماره و کد لازم نبود.
- تست staging کامل پاس شد: server allowlist → opaque reference → SMS origin binding → browser WebOTP autofill → secure verify/session → authenticated dashboard.
- قابلیت ورود بدون شماره و autofill کد اکنون در staging کامل و عملیاتی است.


## Provisioning Worker activation started — 2026-07-23

- مالک پروژه شروع راه‌اندازی Worker اختصاصی در Coolify staging را تأیید کرد.
- کد جاری دوباره بررسی شد: image در `server/Dockerfile.worker` هیچ portی expose نمی‌کند و command ثابت `node dist/scripts/provisioning-worker.js` دارد.
- Worker در startup وجود `CONTROL_DATABASE_URL`، `PROVISIONING_DATABASE_URL` و `TENANT_DATABASE_ENCRYPTION_KEY` را fail-closed بررسی می‌کند.
- Worker نباید Domain، Exposed Port، Healthcheck HTTP، JWT secret یا SMS credentials دریافت کند.
- نام پیشنهادی resource جدید: `amalyar-provisioning-worker-staging`.
- هنوز resource جدید ساخته نشده و هیچ متغیر یا credential جابه‌جا نشده است.


### Worker creation form reached

- در Coolify project `Amalyar` و environment `staging`، فرم Create a new Application برای repo `Amalyar` باز شد.
- هنوز Continue زده نشده و resource ساخته نشده است.
- تنظیم بعدی: branch کاری، Dockerfile build pack، base directory `/server` و Port خالی.


### Worker application resource created, not deployed

- Coolify application resource از repo و branch کاری در staging ساخته شد.
- Build Pack و Base Directory به‌ترتیب `Dockerfile` و `/server` هستند.
- Coolify به‌صورت پیش‌فرض یک دامنه موقت، Traefik labels و exposed port ایجاد کرده است؛ این‌ها برای Worker باید قبل از نخستین deployment کامل حذف شوند.
- Dockerfile هنوز default `/Dockerfile` است و باید به `/Dockerfile.worker` تغییر کند.
- resource هنوز deploy نشده و هیچ Worker process اجرا نشده است.

### Worker non-public configuration saved

- Coolify resource name: `amalyar-provisioning-worker-staging`.
- Build configuration: Base Directory `/server`, Dockerfile Location `/Dockerfile.worker`, Watch Paths `server/**`.
- Non-public Worker configuration verified: Domains, Ports Exposes, Port Mappings, Network Aliases, and container/Traefik labels are empty.
- HTTP Basic Authentication is disabled; pre-deployment and post-deployment commands are empty.
- No manual deployment was started during this configuration step.
- Coolify UI showed `2 deployments`; before adding environment variables, inspect the resource status and deployment history to detect any webhook-triggered incomplete run.
- No secrets or temporary generated domain/IP values are recorded here.

### Worker runtime variables saved and automatic deployment paused

- Coolify resource: `amalyar-provisioning-worker-staging` in the `staging` environment.
- Configured variable names only: `CONTROL_DATABASE_URL`, `PROVISIONING_DATABASE_URL`, `TENANT_DATABASE_ENCRYPTION_KEY`, and `PROVISIONING_POLL_MS=5000`.
- Secret values remain only in Coolify and are not recorded in Git.
- Variable flags confirmed by the owner: Buildtime off, Runtime on, Multiline off, Literal on.
- Before the variables were configured, documentation commits triggered two Webhook deployments: one was cancelled; one completed the deployment but the Worker entered a restart loop because runtime configuration had not yet been applied. A successful deployment badge was not treated as runtime-health proof.
- Coolify `Auto Deploy` is now disabled for this Worker so documentation commits cannot trigger additional deployments during setup.
- The Worker remains non-public: no domain, exposed port, port mapping, network alias, Traefik/container label, HTTP Basic Authentication, or pre/post deployment command.
- Next verification step: perform one manual deployment, then confirm stable runtime and inspect logs without exposing connection URLs or secrets.

### Worker manual deployment stable

- After configuring the Worker runtime variables and disabling Auto Deploy, one manual deployment was performed.
- Coolify reports `Running (unknown)`, which is expected for this non-HTTP background process.
- No restart counter is shown after the manual deployment.
- The log view shows `No logs yet`; this is expected while no provisioning job is queued because the Worker is intentionally silent while idle.
- No secret values, connection URLs, tenant test data, or container identifiers are recorded.
- Next functional verification: submit one controlled staging provisioning job through the Platform Admin UI and confirm the Worker records a safe success/failure result.

### First UI-driven Worker provisioning test

- A controlled third staging tenant was submitted only through the Platform Admin UI.
- The provisioning queue moved from running to ready/succeeded, and the tenant appeared active in the platform list.
- This verifies the UI → Control DB job → dedicated Worker → isolated PostgreSQL database/role path without exposing credentials in the UI or API.
- The tenant name, slug, hostname, database name, role name, and all other test-record values are intentionally not recorded.
- Opening the generated hostname returned `DNS_PROBE_FINISHED_NXDOMAIN`.
- The NXDOMAIN result is a DNS/ingress gap, not a Worker or database-provisioning failure: no wildcard DNS record and catch-all HTTPS routing have yet been configured for arbitrary tenant hostnames.
- Next infrastructure step: configure a one-time wildcard DNS record, a wildcard TLS certificate through DNS challenge, and catch-all SaaS routing for the shared Frontend and the more-specific Backend `/api` route. Per-tenant manual DNS entries are rejected because onboarding must remain UI-driven and automatable.

### Authoritative DNS provider confirmed

- The authoritative DNS zone for `amalyar.com` is managed through HostIran Cloud DNS.
- No DNS account credential, API token, server IP, or record value is stored in Git.
- The next one-time step is to add a wildcard `A` record whose target matches the existing staging application records, then verify propagation before changing Coolify catch-all routing or TLS.
- Wildcard TLS automation remains unresolved until HostIran DNS API/DNS-challenge compatibility is confirmed; no unsafe proxy change has been applied.

### Wildcard DNS A record saved

- در HostIran Cloud DNS یک رکورد wildcard از نوع `A` برای `*.amalyar.com` ذخیره شد.
- مقدار مقصد همان مقصد رکوردهای موجود staging است و عمداً در Git ثبت نشده است.
- TTL رکورد `14400` ثانیه است.
- رکوردهای صریح فعلی مانند دامنه‌های staging بر wildcard اولویت دارند.
- انتشار DNS هنوز از بیرون تأیید نشده است؛ بررسی resolver محلی Agent به‌علت محدودیت شبکه/DNS محیط قابل اتکا نبود و بررسی مرورگر مالک پس از propagation لازم است.
- هنوز هیچ catch-all label در Coolify و هیچ تغییر wildcard TLS اعمال نشده است.
- مرحله بعد، تعیین سازگاری HostIran DNS با ACME DNS challenge است؛ تا روشن‌شدن این مورد تنظیمات proxy تغییر نمی‌کند.

