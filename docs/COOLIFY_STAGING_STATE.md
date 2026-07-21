# Coolify staging state — Amalyar

> منبع ثابت وضعیت استقرار؛ بعد از هر مرحله به‌روزرسانی شود. هیچ secret، password یا connection URL در این فایل ثبت نشود.

## Scope

- Coolify project (confirmed): `Amalyar`
- Environments (confirmed): `production`, `staging`
- Active work environment: `staging`
- Git repository: `shabhossini-web/Amalyar`
- Git branch: `agent/security-permissions-hardening`
- Draft PR: https://github.com/shabhossini-web/Amalyar/pull/1
- Latest verified application commit: `02a86d4bf19d7144b11d92b8f9caa0e37305151e`

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

## Domains

- `api-staging.amalyar.com`
- `alpha-staging.amalyar.com`
- `beta-staging.amalyar.com`

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

## Provisioned tenants

### Alpha

- Slug: `alpha-staging`
- Display name: شرکت آزمایشی الف
- Hostname: `alpha-staging.amalyar.com`
- Database: `amalyar_alpha_staging`
- Runtime role: `amalyar_alpha_staging_app`
- Status: active
- Setup endpoint result: `{"needsSetup":true}`

### Beta

- Slug: `beta-staging`
- Display name: شرکت آزمایشی بتا
- Hostname: `beta-staging.amalyar.com`
- Database: `amalyar_beta_staging`
- Runtime role: `amalyar_beta_staging_app`
- Status: active
- Setup endpoint result: `{"needsSetup":true}`

## Completed fixes discovered during deployment

- Generated Control Prisma client is copied into the runtime image.
- Prisma proxy no longer requires tenant context during NestJS provider startup.
- Control DB migration runs successfully at container startup.
- CORS configuration is fail-closed in production.
- Application healthcheck is stable.

## Next step

1. Alpha SMS smoke test passed end-to-end: HTTP 201, delivery confirmed, and no OTP/phone exposure in logs.
2. SMS production fallback is fail-closed; CI run 107 and the final Coolify deployment both passed.
3. Create separate superadmin accounts in Alpha and Beta.
4. Perform cross-tenant token and patient-isolation tests.
