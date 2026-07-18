# بک‌اندِ عمل‌یار — `server/`

بازنویسیِ **افزایشیِ** بک‌اند با **NestJS + Prisma + PostgreSQL**. هر قابلیت به‌صورتِ یک برشِ عمودی (DB → API) ساخته و دیباگ می‌شود.

## استک
- **NestJS 10** (TypeScript) — همهٔ مسیرها زیرِ `/api`
- **Prisma 5** + **PostgreSQL 16**
- احرازِ هویت: **JWT** (Bearer) + جدولِ `account_sessions` برای سشنِ چندتاییِ قابلِ‌ابطال (سقف ۱۰)

## راه‌اندازیِ محلی
```bash
cd server
cp .env.example .env            # DATABASE_URL / JWT_SECRET / PORT / CORS_ORIGINS
npm install

# دیتابیس: یا با داکر
docker compose up -d db
# یا با Postgresِ محلی (بدون داکر)؛ سپس:
npx prisma migrate dev          # ساختِ جدول‌ها
npm run start:dev               # http://localhost:3001/api
```

## API فعلی (برشِ ۱ — auth)
| متد | مسیر | توضیح |
|-----|------|-------|
| GET  | `/api/health` | سلامتِ سرویس |
| POST | `/api/auth/register` | `{username?|phone?, password, displayName?}` — اولین حساب = super_admin |
| POST | `/api/auth/login` | `{identifier, password}` → `{accessToken, user}` |
| GET  | `/api/auth/me` | نیاز به `Authorization: Bearer <token>` |
| POST | `/api/auth/logout` | ابطالِ سشنِ جاری |

## دیپلوی (بعداً)
`Dockerfile` آماده است (build → `prisma migrate deploy` → اجرا). روی VPS با Coolify:
یک اپِ Node از همین پوشه + یک سرویسِ PostgreSQL + متغیرهای محیطی.

## نقشهٔ برش‌های بعدی
auth ✅ → بیماران/مراجعات → مالی/دفتر کل → پیام‌رسان → کارشناسان/چک‌این → ...
منطقِ حساس (GL، لایسنس) با دقت و تست‌محور پورت می‌شود.
