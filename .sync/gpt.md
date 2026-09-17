<!-- claim:begin -->
agent: gpt
status: active
branch: agent/w2-2b-intake-events
since: 2026-09-17
paths:
  - server/src/patients/intake.service.ts
  - scripts/e2e/w2-2b-intake-events.mjs
  - scripts/e2e/intake-finance-roles.mjs
  - scripts/e2e/profile-workflows.mjs
  - docs/plan/lanes/gpt.md
  - STATUS.md
note: تکمیل پنج emit درخواستی intake/confirmed با ref ثابت؛ W1.4 بعداً اتمیک‌سازی کامل را انجام می‌دهد.
<!-- claim:end -->

> این فایل را **فقط ChatGPT/Codex** ویرایش می‌کند. ردیف‌های زیر را `claude-opus`
> از روی تاریخچهٔ گیت پر کرده تا فایل از روزِ اول خالی نباشد؛ از این به بعد
> صاحبش خودش می‌نویسد.

## قراردادهایی که شکستم

- W2.2-ب: پنج رویداد باقی‌مانده intake/confirmed همین نشست در PR مستقل متصل می‌شوند (تکمیل درخواست مالک). وضعیت‌ها و refهای CONTRACTS §۲ عوض نمی‌شوند. دو fixture قدیمی که IntakeService را دستی می‌سازند EventsService واقعی می‌گیرند؛ شکست نیمه‌کاره رویداد بازیابی می‌سازد، اتمیک‌سازی کامل همچنان W1.4 است.

- W1.5 / آزمون هم‌زمان: خواندن فرم در startVisit دو backfill موازی می‌سازد. forms.service.ts برای skipDuplicates در دو backfill کاتالوگ کلیم شد؛ تعریف موجود بازنویسی نمی‌شود.

- W1.5: فیلد forVisitId و رابطهٔ معکوس طبق CONTRACTS §۳ در انتهای مدل‌ها اضافه می‌شود. AuditService.record پارامتر اختیاری tx می‌گیرد (استثنای محدود خارج از لِین، مسیر آزاد) تا audit و داده اتمیک باشند. prepareVisitCreation در PatientsService مسیر مشترک ساخت را برای تراکنش نوبت آماده می‌کند؛ قرارداد HTTP ساخت مراجعه عوض نمی‌شود. EventsService آخرین وابستگی IntakeService می‌شود؛ book آن را با tx صدا می‌زند.

- 2026-09-16 · W1.6: طبق CONTRACTS §۷، schemaSnapshot و deletedAt به انتهای مدل‌های موجود افزوده می‌شوند (استثنای لازم نسبت به فقط انتهای فایل). used شامل submission اصلی و extraFormIds خواهد شد؛ کلید حذف‌شده قابل استفاده مجدد نیست. نسخهٔ کاری از GitHub API با تطبیق دقیق هش tree/commit همگام شد؛ git fetch مستقیم در این محیط احراز ندارد.

## یادداشت برای لِین‌های دیگر

- محدودشدن کلیم Fable و آزادشدن lanes/gpt.md روی f8da7bd تأیید شد؛ مانع قبلی رفع شده است.
- W2.2-ب: رویدادهای intake.submitted/approved/rejected/approve_failed و appointment.confirmed همین نشست متصل شدند؛ appointment.held در W1.5 مرج شده بود. refها ثابت‌اند. order.reviewed/needs_action برای W1.2 است.

- **نشست از `localStorage` به کوکیِ HttpOnly + CSRF رفت** (`56e7646`، قانونِ ۶
  در `CLAUDE.md`). هر e2eِ مرورگری باید از `scripts/e2e/lib/browser-login.mjs`
  استفاده کند؛ `localStorage.setItem('amalyar_token', …)` دیگر کار نمی‌کند.
  (`tenant-site.mjs` بی‌صدا شکست و فقط با اجرا معلوم شد.)
- **`vite.config.js` حالا `version.json` تولید می‌کند** و `VersionNotice` در
  `main.jsx` سوار است؛ `sw.js` هم `CACHE` را به `v9` برد و دیگر صفحهٔ باز را
  خودکار ناوبری نمی‌کند.

## وضعیت پایان نشست — W1.6 و W1.5 مرج شدند

- W1.5: PR #26 / `508cb4b`؛ security-ci کامل سبز و مرج خودکار انجام شد. W1.6: PR #13 / `ccaa792`.
- پیاده شد: `forVisitId` در walkIn/book، اتصال همان فرزند در startVisit با حفظ وضعیت/پاسخ‌ها، قفل ردیف نوبت، ساخت مشترک مراجعه و audit/outbox در همان تراکنش، اولویت clinic و منع fallback جراحی، رد پیگیری مبهم و مراجعهٔ بیمار دیگر، پاک‌کردن ارجاع قدیمی هنگام جابه‌جایی رزرو.
- `appointment.held` در book و `appointment.started` در startVisit با همان appointmentIdِ CONTRACTS §۲ ثبت می‌شوند. آزمون پردازشگر ثابت کرد کار تأیید باز و سپس با همان ref بسته می‌شود.
- آزمون: ۲۶ سناریوی W1.5 (HTTP واقعی Nest/Prisma، PGlite)، شامل دو درخواست هم‌زمان، rollback و retry؛ ۱۷ سناریوی موجود intake-finance-roles نیز سبز. build هر دو سمت سبز.
- محدودیت آزمون: پایگاه محلی PGlite با یک اتصال Prisma است؛ رقابت چند اتصال مستقل PostgreSQL آزموده نشده. فقط برای سناریوی rollback، خطای outbox از طریق وابستگی EventsService تزریق شد؛ تمام queryها، قفل و تراکنش واقعی بودند. seed نامرتبط دایرکتوری بیمارستان در harness غیرفعال است.
- قدم بعد: W1.4 (تأیید اتمیک و مصرف forVisitId). emitهای intake در W2.2-ب تکمیل شدند؛ order.reviewed/needs_action در W1.2 می‌مانند.

## اخیراً لند شد

- 2026-09-17 · PR #26 · 508cb4b · W1.5؛ security-ci سبز، ۲۶ سناریوی نوبت و ۱۷ رگرسیون سبز. کلیم آزاد شد.

- 2026-09-16 · PR #13 · ccaa792 · W1.6؛ security-ci سبز، ۲۴ سناریو و بیلد هر دو سمت سبز. کلیم W1.6 آزاد و کلیم مستقل W1.5 فعال شد.

- `cd812ad` · بازبینیِ ۱۸۱ گروهِ مالکیتِ بیمارستان + اتصال به دسته‌های تعرفه
- `d0d19c7` · دایرکتوریِ بیمارستان‌های تهران + importِ جداشدهٔ هر tenant
- `f48a427` · حساب‌های آزمایشیِ هم‌شماره
- `0eeee1c` · مالیِ جراح، حساب‌های موقت، چینشِ بیمارستان، فاکتورِ اتمیکِ انبار

- یادداشت W1.4: approve فعلی هنوز forVisitId نوبت را مصرف نمی‌کند؛ همراه اتمیک‌سازی باید همان مراجعهٔ هدف را به‌روز کند. جزئیات در lanes/gpt.md ثبت شد؛ تغییرهای مشترک فقط از فایل‌های مخزن اعلام شدند.

## تحویل W2.2-ب — تکمیل درخواست رویدادها
- fill: submitted و در تأیید خودکار approved؛ approve: approved و confirmed؛ reject: rejected و cancelled نوبت. هر وضعیت و رویدادش با یک tx نوشته می‌شوند.
- خطای پس از نوشتن در approve: approve_failed با همان intake_submission:id و مراجعهٔ ساخته‌شده. شکستِ اعتبارسنجی پیش از نوشتن، رویداد نیمه‌کاره نمی‌سازد. کل approve هنوز چند commit دارد؛ W1.4 این بدهی را می‌بندد.
- آزمون: ۱۸ سناریوی واقعی API/Prisma/پردازشگر + ۱۷ مالی + ۱۶ گردش‌کار سبز؛ برای دو سناریوی شکست فقط وابستگی پرداخت/outbox عمداً خطا می‌دهد. باقی مسیر واقعی است. بیلد هر دو سمت سبز.
