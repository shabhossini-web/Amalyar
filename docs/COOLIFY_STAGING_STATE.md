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

## Completed fixes discovered during deployment

- Deterministic tenant-isolation verifier added at `server/scripts/verify-tenant-isolation.js` in commit `9f27d486e3d1a342d66e05ca056136ce819ec942` and enforced by workflow commit `3c915d8b753fccc4894bff9712a238c35652b957`.
- GitHub Actions `security-ci` run 226 passed.
- The verifier proves a JWT with another tenant's `tid` is rejected with 401 before session lookup, Prisma uses distinct clients/database routes for distinct tenant IDs, reuses only the same tenant's client, and fails closed without tenant context.
- This is the deterministic code/CI boundary test; a live staging cross-token and synthetic-patient test remains pending.
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
5. Next: perform a live cross-tenant token and synthetic-patient isolation test without recording personal data.
