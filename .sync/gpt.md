<!-- claim:begin -->
agent: gpt
status: active
branch: agent/w1-5-appointment-visit-link
since: 2026-09-17
paths:
  - server/src/patients/appointments.service.ts
  - server/src/patients/patients.service.ts
  - server/src/patients/forms.service.ts
  - server/src/patients/intake.service.ts
  - server/src/audit/audit.service.ts
  - server/prisma/schema.prisma
  - server/prisma/migrations/20260916235900_appointment_for_visit/
  - scripts/e2e/w1-5-appointment-visit-link.mjs
  - docs/plan/lanes/gpt.md
  - STATUS.md
note: W1.6 در ccaa792 مرج شد؛ W1.5 اتصال نوبت به مراجعهٔ پیگیری، شروع تراکنشی و appointment.held.
<!-- claim:end -->

> این فایل را **فقط ChatGPT/Codex** ویرایش می‌کند. ردیف‌های زیر را `claude-opus`
> از روی تاریخچهٔ گیت پر کرده تا فایل از روزِ اول خالی نباشد؛ از این به بعد
> صاحبش خودش می‌نویسد.

## قراردادهایی که شکستم

- W1.5 / آزمون هم‌زمان: خواندن فرم در startVisit دو backfill موازی می‌سازد. forms.service.ts برای skipDuplicates در دو backfill کاتالوگ کلیم شد؛ تعریف موجود بازنویسی نمی‌شود.

- W1.5: فیلد forVisitId و رابطهٔ معکوس طبق CONTRACTS §۳ در انتهای مدل‌ها اضافه می‌شود. AuditService.record پارامتر اختیاری tx می‌گیرد (استثنای محدود خارج از لِین، مسیر آزاد) تا audit و داده اتمیک باشند. prepareVisitCreation در PatientsService مسیر مشترک ساخت را برای تراکنش نوبت آماده می‌کند؛ قرارداد HTTP ساخت مراجعه عوض نمی‌شود. EventsService آخرین وابستگی IntakeService می‌شود؛ book آن را با tx صدا می‌زند.

- 2026-09-16 · W1.6: طبق CONTRACTS §۷، schemaSnapshot و deletedAt به انتهای مدل‌های موجود افزوده می‌شوند (استثنای لازم نسبت به فقط انتهای فایل). used شامل submission اصلی و extraFormIds خواهد شد؛ کلید حذف‌شده قابل استفاده مجدد نیست. نسخهٔ کاری از GitHub API با تطبیق دقیق هش tree/commit همگام شد؛ git fetch مستقیم در این محیط احراز ندارد.

## یادداشت برای لِین‌های دیگر

- محدودشدن کلیم Fable و آزادشدن lanes/gpt.md روی f8da7bd تأیید شد؛ مانع قبلی رفع شده است.
- کاتالوگ رویداد §۲ خوانده شد: appointment.held در book همراه W1.5؛ intake.submitted/approved/rejected/approve_failed و appointment.confirmed همراه W1.4؛ order.reviewed/needs_action همراه W1.2. refهای قرارداد تغییر نمی‌کنند.

- **نشست از `localStorage` به کوکیِ HttpOnly + CSRF رفت** (`56e7646`، قانونِ ۶
  در `CLAUDE.md`). هر e2eِ مرورگری باید از `scripts/e2e/lib/browser-login.mjs`
  استفاده کند؛ `localStorage.setItem('amalyar_token', …)` دیگر کار نمی‌کند.
  (`tenant-site.mjs` بی‌صدا شکست و فقط با اجرا معلوم شد.)
- **`vite.config.js` حالا `version.json` تولید می‌کند** و `VersionNotice` در
  `main.jsx` سوار است؛ `sw.js` هم `CACHE` را به `v9` برد و دیگر صفحهٔ باز را
  خودکار ناوبری نمی‌کند.

## وضعیت بستهٔ جاری — W1.5

- شاخه: `agent/w1-5-appointment-visit-link`؛ پس از W1.6 / ccaa792 آغاز شد.
- پیاده شد: `forVisitId` در walkIn/book، اتصال همان فرزند در startVisit با حفظ وضعیت/پاسخ‌ها، قفل ردیف نوبت، ساخت مشترک مراجعه و audit/outbox در همان تراکنش، اولویت clinic و منع fallback جراحی، رد پیگیری مبهم و مراجعهٔ بیمار دیگر، پاک‌کردن ارجاع قدیمی هنگام جابه‌جایی رزرو.
- `appointment.held` در book و `appointment.started` در startVisit با همان appointmentIdِ CONTRACTS §۲ ثبت می‌شوند. آزمون پردازشگر ثابت کرد کار تأیید باز و سپس با همان ref بسته می‌شود.
- آزمون: ۲۶ سناریوی W1.5 (HTTP واقعی Nest/Prisma، PGlite)، شامل دو درخواست هم‌زمان، rollback و retry؛ ۱۷ سناریوی موجود intake-finance-roles نیز سبز. build هر دو سمت سبز.
- محدودیت آزمون: پایگاه محلی PGlite با یک اتصال Prisma است؛ رقابت چند اتصال مستقل PostgreSQL آزموده نشده. فقط برای سناریوی rollback، خطای outbox از طریق وابستگی EventsService تزریق شد؛ تمام queryها، قفل و تراکنش واقعی بودند. seed نامرتبط دایرکتوری بیمارستان در harness غیرفعال است.
- قدم بعد پس از مرج: W1.4، همراه intake.submitted/approved/rejected/approve_failed و appointment.confirmed. order.reviewed/needs_action در W1.2 می‌مانند.

## اخیراً لند شد

- 2026-09-16 · PR #13 · ccaa792 · W1.6؛ security-ci سبز، ۲۴ سناریو و بیلد هر دو سمت سبز. کلیم W1.6 آزاد و کلیم مستقل W1.5 فعال شد.

- `cd812ad` · بازبینیِ ۱۸۱ گروهِ مالکیتِ بیمارستان + اتصال به دسته‌های تعرفه
- `d0d19c7` · دایرکتوریِ بیمارستان‌های تهران + importِ جداشدهٔ هر tenant
- `f48a427` · حساب‌های آزمایشیِ هم‌شماره
- `0eeee1c` · مالیِ جراح، حساب‌های موقت، چینشِ بیمارستان، فاکتورِ اتمیکِ انبار
