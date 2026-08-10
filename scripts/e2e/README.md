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

فرانت: `VITE_API_BASE=http://localhost:3101/api npx vite --port 5199 --host 127.0.0.1`

کاربر: از مسیرِ `auth/signup/*` یک سوپرادمین با `admin` / `test1234` بسازید.
کدِ OTP در پاسخ برنمی‌گردد و در `otp_codes` به‌شکلِ sha256 ذخیره می‌شود.

## اجرا

```bash
node scripts/e2e/forms-api.mjs        # رنگ، صفحه، دو نوعِ تازه، مهاجرتِ scope
node scripts/e2e/forms-validate.mjs   # اجباری‌بودن از مسیرِ واقعیِ ثبتِ مراجعه
node scripts/e2e/forms-builder.mjs    # فرم‌ساز در مرورگرِ واقعی
node scripts/e2e/forms-boxes.mjs      # رندرِ باکسِ عکس و پرداخت
```

## قاعده‌ها

- **هر آزمون باید بارِ دوم هم سبز باشد.** آزمونی که فقط یک‌بار اجرا می‌شود،
  دفعهٔ بعد کسی اجرایش نمی‌کند. هر کدام داده‌ی اجرای قبلی را خودش تمیز می‌کند.
- **ادعا روی حالتِ دیده‌شده**، نه روی «درخواست ۲۰۰ داد». جایی که می‌شود،
  اختلافِ قبل و بعد شمرده می‌شود.
- ورودها محدودشده‌اند (۱۲ بار در ۱۵ دقیقه به‌ازای هر IP). اگر ۴۲۹ گرفتید،
  سرور را ری‌استارت کنید — سطل‌ها در حافظه‌اند.
