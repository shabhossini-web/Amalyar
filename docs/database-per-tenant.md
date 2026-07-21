# معماری دیتابیس مستقل برای هر شرکت

## مرزهای اعتماد

- `CONTROL_DATABASE_URL` فقط شامل فهرست شرکت‌ها، دامنه‌ها و آدرس رمزنگاری‌شده دیتابیس است.
- هر شرکت PostgreSQL database مستقل دارد و همه حساب‌ها، نشست‌ها، بیماران، ویزیت‌ها، مجوزها و auditهای آن داخل همان دیتابیس هستند.
- شرکت فقط با hostname ثبت‌شده در Control DB شناسایی می‌شود. هدر tenant، tenant id و database URL ورودی پذیرفته نمی‌شوند.
- JWT شامل `tid` است و روی دامنه شرکت دیگری رد می‌شود.
- کلید `TENANT_DATABASE_ENCRYPTION_KEY` باید ۳۲ بایت تصادفی base64 و در Secret Manager نگهداری شود.

## متغیرهای ضروری

- `CONTROL_DATABASE_URL`: دیتابیس مرکزی
- `TENANT_DATABASE_ENCRYPTION_KEY`: کلید AES-256-GCM
- `JWT_SECRET`: راز JWT حداقل ۳۲ کاراکتر
- `PROVISIONING_DATABASE_URL`: اتصال مدیریتی PostgreSQL؛ فقط هنگام ساخت شرکت
- `DEFAULT_TENANT_SLUG`: فقط توسعه محلی و هرگز production

## ساخت شرکت

ابتدا Control DB را migrate کنید:

```sh
npm run control:migrate
```

سپس با دسترسی مدیریتی موقت:

```sh
npm run tenant:provision -- company-a "شرکت الف" company-a.example.com
```

فرایند، نام‌ها را اعتبارسنجی می‌کند، دیتابیس را می‌سازد، migrationها را اجرا می‌کند و تنها پس از موفقیت شرکت را active می‌کند. شکست باعث حذف دیتابیس نیمه‌ساخته می‌شود.

## انتشار نسخه

1. backup مستقل Control DB و تمام tenantها
2. اجرای `npm run tenants:migrate` به‌عنوان job یک‌باره
3. توقف rollout در صورت شکست حتی یک tenant
4. deploy برنامه فقط بعد از موفقیت همه migrationها
5. smoke test ورود و خواندن بیمار روی حداقل دو دامنه

برنامه هنگام startup فقط Control DB را migrate می‌کند و عمداً tenantها را خودکار migrate نمی‌کند تا چند replica هم‌زمان migration اجرا نکنند.

## انتقال دیتابیس فعلی

دیتابیس production فعلی باید به‌عنوان اولین tenant ثبت شود؛ داده‌ها نباید به دیتابیس مشترک جدید کپی شوند. پس از backup:

1. Control DB جدید ایجاد شود.
2. URL دیتابیس فعلی با CLI migration/import امن به tenant اول متصل شود.
3. دامنه شرکت ثبت شود.
4. همه JWTهای قدیمی با چرخاندن `JWT_SECRET` باطل شوند، چون claim شرکت ندارند.
5. تست عدم دسترسی همان توکن روی دامنه دوم انجام شود.

## قواعد عملیاتی

- کاربر دیتابیس هر tenant فقط به همان database مجوز داشته باشد.
- از PostgreSQL role مشترک با دسترسی همه databaseها برای runtime استفاده نشود.
- backup، retention و restore drill برای هر tenant جدا باشد.
- دسترسی اضطراری پشتیبانی زمان‌دار و auditشده باشد.
- سقف connection pool متناسب با تعداد tenantها تنظیم شود؛ برای مقیاس بالا PgBouncer لازم است.
