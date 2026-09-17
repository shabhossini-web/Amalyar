<!-- claim:begin -->
agent: gpt
status: active
branch: agent/w1-4-approve-atomic
since: 2026-09-17
paths:
  - server/src/patients/intake.service.ts
  - server/src/patients/intake.controller.ts
  - server/src/patients/patients.service.ts
  - server/src/patients/billing.service.ts
  - server/src/patients/treasury.service.ts
  - server/src/patients/portal.service.ts
  - server/src/patients/reminders.service.ts
  - server/prisma/schema.prisma
  - server/prisma/migrations/20260917140000_intake_approval/
  - scripts/e2e/w1-4-approve-atomic.mjs
  - scripts/e2e/w1-4-approve-local.mjs
  - scripts/e2e/w2-2b-intake-events.mjs
  - scripts/e2e/intake-finance-roles.mjs
  - scripts/e2e/profile-workflows.mjs
  - docs/plan/lanes/gpt.md
note: W1.2/PR38 و تحویل PR39 لند شد؛ W1.4 شروع شد: تراکنش واحد، مصرف forVisitId، idempotency و پیام از outbox. appointments در کلیم ج دست نمی‌خورد.
<!-- claim:end -->

> این فایل را **فقط ChatGPT/Codex** ویرایش می‌کند. ردیف‌های زیر را `claude-opus`
> از روی تاریخچهٔ گیت پر کرده تا فایل از روزِ اول خالی نباشد؛ از این به بعد
> صاحبش خودش می‌نویسد.

## قراردادهایی که شکستم

- W1.2: endpoint جدید review در orders.controller.ts (خارج از فهرست service ولی آزاد). ستون‌های review و refType/refId طبق §۴ به ته مدل‌ها افزوده می‌شوند. برای بستن حلقه ارسال مجدد، تغییر حداقلی work-rules/work-processor و ثبت قرارداد در CONTRACTS لازم است؛ این سه فایل در کلیم ج هستند، استثنای محدود اعلام می‌شود و کلیم دیگری تغییر نمی‌کند. UI پرونده و appointments در این بسته دست نمی‌خورند.
- تصمیم‌های مالک 2026-09-17: W1.7 گیت done نیست؛ done متن عادی، pending با تاریخ گذشته متن شرطی، cancelled بدون مراقبت و با پیام لغو مستقل. confirm_surgery_done حفظ می‌شود. بسته دلیل لغو پس از W3.3: دلیل عمومی از فهرست بسته + یادداشت فقط داخلی، شامل نوبت؛ syncAppointment ابطال یادآوری را دارد. کانال دوم بله سپس تلگرام با multipart از relay از روز اول.

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

- 2026-09-17 · PR #29 · 6edbce1 · W2.2-ب؛ پنج emit باقی‌ماندهٔ intake/confirmed با ref ثابت؛ CI سبز، ۱۸ سناریو + ۱۷ مالی + ۱۶ گردش‌کار سبز.

- 2026-09-17 · PR #26 · 508cb4b · W1.5؛ security-ci سبز، ۲۶ سناریوی نوبت و ۱۷ رگرسیون سبز. کلیم آزاد شد.

- 2026-09-16 · PR #13 · ccaa792 · W1.6؛ security-ci سبز، ۲۴ سناریو و بیلد هر دو سمت سبز. کلیم W1.6 آزاد و کلیم مستقل W1.5 فعال شد.

- `cd812ad` · بازبینیِ ۱۸۱ گروهِ مالکیتِ بیمارستان + اتصال به دسته‌های تعرفه
- `d0d19c7` · دایرکتوریِ بیمارستان‌های تهران + importِ جداشدهٔ هر tenant
- `f48a427` · حساب‌های آزمایشیِ هم‌شماره
- `0eeee1c` · مالیِ جراح، حساب‌های موقت، چینشِ بیمارستان، فاکتورِ اتمیکِ انبار

- یادداشت W1.4: approve فعلی هنوز forVisitId نوبت را مصرف نمی‌کند؛ همراه اتمیک‌سازی باید همان مراجعهٔ هدف را به‌روز کند. جزئیات در lanes/gpt.md ثبت شد؛ تغییرهای مشترک فقط از فایل‌های مخزن اعلام شدند.

## W2.2-ب مرج شد — PR #29 / 6edbce1
- fill: submitted و در تأیید خودکار approved؛ approve: approved و confirmed؛ reject: rejected و cancelled نوبت. هر وضعیت و رویدادش با یک tx نوشته می‌شوند.
- خطای پس از نوشتن در approve: approve_failed با همان intake_submission:id و مراجعهٔ ساخته‌شده. شکستِ اعتبارسنجی پیش از نوشتن، رویداد نیمه‌کاره نمی‌سازد. کل approve هنوز چند commit دارد؛ W1.4 این بدهی را می‌بندد.
- آزمون: ۱۸ سناریوی واقعی API/Prisma/پردازشگر + ۱۷ مالی + ۱۶ گردش‌کار سبز؛ برای دو سناریوی شکست فقط وابستگی پرداخت/outbox عمداً خطا می‌دهد. باقی مسیر واقعی است. بیلد هر دو سمت سبز.

- تحویل لِین ج: PR #28 در بررسی 2026-09-17 dirty بود و نیاز به rebase روی main تازه داشت. ارتباط و یادداشت‌های forVisitId/استثنای record فقط در فایل‌های مخزن ثبت شدند.

## تحویل W1.2 به لِین‌های دیگر
- اولویت جدید مالک اعمال شد: W1.2 پیش از W1.4. سه تصمیم تازه در ابتدای فایل و lanes/gpt ثبت است.
- API بررسی: POST /orders/:kind/:id/review با status و reviewNote. خواندن سفارش documents[] دارد؛ W3.1 بدون تغییر UI وضعیت‌های باز را می‌خواند. کنترل‌های رابطِ تصمیم‌گیری باید همین endpoint را مصرف کنند؛ در این بسته UI در کلیم ج دست نخورده است.
- استثناهای محدود در فایل‌های کلیم ج: CONTRACTS فقط §۹ و شرح W1.2؛ work-rules/processor فقط چرخهٔ پاسخ مجدد و reopen با sourceEventId. appointments و access-registry دست نخورده‌اند.
- publicAnswer برای جلوگیری از بازنویسی از حالا 409 می‌دهد؛ تکمیل append و آپلود عمومی با W0.8 است. اتصال فایل موجود از طریق documentIds فایل/Document دوم نمی‌سازد.
- گیت CI: یک گام فقط در انتهای security-ci.yml برای اجرای W1.2 با Nest/Prisma/PGlite موقت اضافه می‌شود؛ استثنای محدود فایل کلیم ج. runner مستقل در scripts/e2e/w1-2-order-review-local.mjs است.

## تحویل نهایی W1.2 — PR #38 / 3865b60
- CI کامل سبز (run 35210061124) و ۶۷ سناریوی HTTP/Prisma/PGlite. W1.2 روی main است؛ کلیم آزاد شد.
- پاسخ ← Document ارجاع‌دار + audit/outbox اتمیک، بررسی چهار نوع سفارش، بازگشایی همان کار پس از پاسخ جدید. W3.1 در in_review/needs_action باز می‌ماند.
- endpoint و خروجی documents در CONTRACTS ثبت است. UI بررسی برای مصرف endpoint تحویل لِین ج؛ آپلود/append عمومی همچنان W0.8/W0.5 و ترمیم تاریخی W1.10.
- W1.4 شروع نشده. دلیل لغو پس از W3.3؛ مراقبت شرطی و confirm_surgery_done و بله سپس تلگرام/relay multipart بدون تغییر تصمیم حفظ شدند.

## شروع W1.4 — 2026-09-17
- main=30c66d2؛ PR39 مرج و W1.2 بسته شد. PortalService در کلیم idle ب است؛ فقط آماده‌سازی پیامِ صف‌شده اضافه می‌شود، publicView دست نمی‌خورد.
- BillingService.addCharge/addPayment و Treasury.assertOpen پارامتر اختیاری tx می‌گیرند. prepareVisitCreation همان tx را برای به‌روزرسانی مراجعه موجود هم مصرف می‌کند.
- دو استثنای محدود در فایل‌های کلیم ج: شرح قرارداد W1.4 در CONTRACTS و یک گام ته CI. schema ستون‌های انتهای مدل IntakeSubmission طبق قرارداد جدید دارد.

- دو fixture قدیمی مالی/گردش‌کار PortalService واقعی برای صف پیام می‌گیرند؛ سنجه قدیمی W2.2 درباره تأیید نیمه‌کاره به rollback کامل تغییر می‌کند. work-rules (کلیم ج) دو رویداد کوچک برای آشکارکردن همگام‌سازی پس از commit می‌گیرد؛ بدون ادعای ناقص‌بودن پرداخت.
- تأیید هم‌زمان مهلت انتظار ۱۰ ثانیه و سقف تراکنش ۱۵ ثانیه دارد؛ مهلت پیش‌فرض ۲ ثانیهٔ Prisma در آزمون تک‌اتصالی پیش از آزادشدن اتصال تمام می‌شد. همهٔ queryهای مالی همچنان همان tx هستند.
- ویرایش‌های عمومی و returnForFix با نسخهٔ status/updatedAt ثبت می‌شوند؛ ویرایش دیررس نمی‌تواند تأیید موفق را باز کند. حذف/انقضا نیز پیش از تغییر نوبت نسخهٔ ثبت‌نام را کنترل می‌کنند. آزمون مکث عمدی پس از خواندن فیش، تأیید و سپس ادامهٔ ویرایش 409 می‌گیرد.
- halfWhere: اصلاح scope=record روی شاخهٔ ج `claude/quirky-volta-uyuznl` مستقیم در کد تأیید شد؛ main=30c66d2 هنوز آن را ندارد. همان تحویل ج حفظ است و today.service.ts در این بسته ویرایش نمی‌شود.
- محدودیت سنجش: PGlite با یک اتصال است؛ دو درخواست HTTP هم‌زمان سنجیده می‌شوند، نه چند اتصال مستقل PostgreSQL. PGlite-server هنگام نقض عمدی unique در tx اتصال را قطع کرد؛ برخورد کلید موجود اکنون پیش از آماده‌سازی شناسایی می‌شود و قید unique همچنان نگهبان رقابت واقعی است. رقابت دو ثبت‌نام مستقل بر سر یک کلید باید روی PostgreSQL بومی هم سنجیده شود.

- استثنای ضروری CI: دو سنجهٔ قدیمی نام متد createVisit را به prepareVisitCreation مشترک با آن به‌روز می‌کنند؛ منع ساخت مستقیم Visit و الزام عبور مبلغ از همان مسیر حفظ است. گام e2e جدید فقط به ته فایل افزوده شد.
- آمادهٔ PR: ۸۱ سناریو در runner W1.4 (۳۷ جدید، ۱۸ رویداد، ۲۶ نوبت) + ۱۷ مالی + ۱۶ گردش‌کار سبز؛ build هر دو سمت، tenant/claims و سنجه‌های تغییرکردهٔ CI سبز.

- بازبینی پیش از مرج: reminder sync و syncPostOpVisit خطا را می‌بلعیدند؛ پارامتر اختیاری strict فقط برای after-commit تأیید اضافه شد تا کار بازیابی با خطای داخلی زود بسته نشود. callers قبلی همان رفتار پیشین را دارند؛ reminders.service.ts آزاد بود و کلیم شد.
