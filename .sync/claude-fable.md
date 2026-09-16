<!-- claim:begin -->
agent: claude-fable
status: active
branch: claude/quirky-volta-uyuznl
since: 2026-09-16
paths:
  - docs/plan/CONTRACTS.md
  - docs/plan/lanes/claude-fable.md
  - server/src/work/
  - server/src/search/
  - server/src/app.module.ts
  - server/src/patients/patients.module.ts
  - src/App.jsx
  - src/app/Shell.jsx
  - src/app/shell.css
  - src/app/GlobalSearch.jsx
  - src/app/WorkBell.jsx
  - src/app/WorkRow.jsx
  - src/app/WorkList.jsx
  - src/app/work.css
  - public/sw.js
  - scripts/e2e/w2-4-shell.mjs
  - scripts/e2e/w2-2-work-producers.mjs
  - scripts/e2e/w2-3-today.mjs
  - scripts/e2e/w2-5-exceptions.mjs
  - src/app/Today.jsx
  - src/app/today.css
  - src/app/tools.jsx
note: لِینِ ج — W2.5 نمای استثنای مدیر روی صفحهٔ «امروز». W2.1/W2.2/W2.3/W2.4 لند شده‌اند. **`src/app/Launcher.jsx` و `src/ui/icons.jsx` آزاد شدند — لِینِ ب می‌تواند W3.7 را بردارد** (آیکون را روی `src/app/tools.jsx` اعمال کند، نه لانچر).
<!-- claim:end -->

> ردیف‌های زیر از تاریخچهٔ گیت پر شده‌اند تا فایل خالی نباشد.

## قراردادهایی که شکستم

- ۱۴۰۵/۰۶/۲۵ · **W2.5 — نمای استثنا روی همان `GET /work/today` نشست**، نه endpointِ تازه: یک درخواست برای کلِ صفحهٔ «امروز». `sections.exceptions` فقط از سوپروایزر به بالا و برای بقیه `exceptions: null`. چهار ردیف در `CONTRACTS.md` §۱۱.
- ۱۴۰۵/۰۶/۲۵ · **W2.3 — `/app` دیگر لانچر نیست، «امروز» است؛ لانچر روی `/app/tools`.** کاتالوگِ کاشی‌ها از `Launcher.jsx` به `src/app/tools.jsx` رفت و **تنها منبع** است: ماژولِ تازه = یک ردیف آن‌جا، وگرنه در کشوی «همهٔ ابزارها» هست و در لانچر نیست (یا برعکس). `Shell.jsx` دیگر `/app` را استثنا نمی‌کند، `/app/tools` را. قرارداد: `CONTRACTS.md` §۱۱ (`GET /work/today` + `sections`).
- ۱۴۰۵/۰۶/۲۵ · **W2.3 — واژهٔ «لانچر» از دکمه‌های بازگشت برداشته شد.** شش صفحه (`Dashboard`، `FormBuilder`، `Profile`، `Users`، `Settings`، `ProfileMenu`) به `/app` لینک می‌دادند با برچسبِ «لانچر»؛ حالا `/app` صفحهٔ «امروز» است، پس برچسب «سامانه» / «صفحهٔ امروز» شد. `FormBuilder.jsx` (W3.5 لِینِ ب) فقط همین یک برچسب عوض شد.
- ۱۴۰۵/۰۶/۲۵ · **W2.3 — `scripts/e2e/schedule-panel.mjs` مسیرش عوض شد:** از `/app` اول کشوی «همهٔ ابزارها» باز می‌شود و بعد کاشی. هر e2eای که از صفحهٔ نخست به یک ماژول می‌رسد همین مسیر را دارد (این تست در فهرستِ CI نیست، پس با دست پیدا شد).
- ۱۴۰۵/۰۶/۲۵ · **W2.3 — نگهبانِ CI «لانچر باید `allowed` را بخواند» به `src/app/tools.jsx` منتقل شد** (چون منطق آن‌جا رفت)؛ سنجهٔ منفی روی **هر دو** فایل ماند و یک سنجهٔ تازه اضافه شد: کاتالوگ نباید دوباره در `Launcher.jsx` تعریف شود. نگهبان دنبالِ کد آمد، ضعیف‌تر نشد.
- ۱۴۰۵/۰۶/۲۵ · **W2.2 — `EventsService` به سازندهٔ ۷ سرویس اضافه شد (همیشه آخرین پارامتر):** `OrdersService`، `SurveyService`، `AppointmentsService`، `PatientsService`، `InvoicesService`، `InventoryService` (قبل از `routes`)، `TechService`. `PatientsModule` حالا `WorkModule` را import می‌کند. **تستی که سرویس را دستی می‌سازد باید `new EventsService(prisma)` را بدهد** — چهار تستِ CI (`company-operations`، `intake-finance-roles`، `profile-workflows`، `neuromonitoring-invoice`) به‌روز شدند؛ stubِ `{}` کافی نیست چون `issue()`/`setStatus()` واقعاً `emit` می‌زنند. `send-reminders.ts` بدونِ DI است و مستقیم `client.domainEvent.create` می‌زند (داخلِ try). فهرستِ کاملِ رویدادها و شکلِ `ref` در `CONTRACTS.md` §۲.
- ۱۴۰۵/۰۶/۲۵ · **W2.2 — `POST /work/process` و sweepِ worker اول `detectStaleWork` را می‌زنند** (`server/src/work/work-detectors.ts`): چهار کارِ زمان‌محور (`visit.unconfirmed`، `report.missing`، `usage.unconfirmed`، `form.unanswered`) و بستنِ `complete_report` از هر مسیرِ آپلود. فقط `kind='surgery'`، کفِ ۶۰ روز، هر ref هفته‌ای یک رویداد.
- ۱۴۰۵/۰۶/۲۵ · **دو نشستِ هم‌زمانِ یک مدل = دو شناسه.** نشستِ لِینِ ب از این به بعد `claude-fable-b` است (`.sync/claude-fable-b.md` + `docs/plan/lanes/claude-fable-b.md`)؛ این فایل و `lanes/claude-fable.md` فقط لِینِ ج (این نشست). دلیل: کلیمِ مشترک در همان روزِ اول کانفلیکت خورد (PR #14 ↔ #15).
- ۱۴۰۵/۰۶/۲۵ · **W2.4 — آیکونِ `Bell` به تهِ `src/ui/icons.jsx` اضافه شد** (نگهبانِ CI هیچ `<svg>` بیرونِ `src/ui/` را نمی‌پذیرد؛ لِینِ ب: فقط همان چند خطِ آخر).
- ۱۴۰۵/۰۶/۲۵ · **W2.4 — `ProfileMenu` از این به بعد فقط در `Shell.jsx` رندر می‌شود** (روی همهٔ صفحاتِ `/app`، جز لانچر که فعلاً خودش دارد). صفحهٔ تازه نباید `ProfileMenu` بگذارد؛ از پنج صفحه برداشته شد. مسیرهای `/app/*` در `App.jsx` زیرِ یک layout-route (`<Route element={<Protected><Shell/></Protected>}>`) هستند — مسیرِ تازه را **داخلِ همان بلوک** اضافه کن، نه بیرونش. `GET /search/patients?q=` (Feature `work`) جایگزینِ جستجوی سراسری است.
- ۱۴۰۵/۰۶/۲۵ · **W2.1 قراردادِ تازه ساخت، نه شکست:** مدل‌های `WorkItem`/`DomainEvent` (تهِ schema)، feature `work` + مجوزهای `work.*` (تهِ رجیستری)، `work: 2` در هر سه پلنِ حوزه، و یک فراخوانیِ `processDomainEvents` در `sweepTenant`ِ worker. جزئیات در `docs/plan/CONTRACTS.md` §۱–۲.

## اخیراً لند شد

- ۱۴۰۵/۰۶/۲۵ · PR #14 · `291f255` · **W2.4 پوستهٔ سراسری** روی `main`: `Shell.jsx` (layout-route)، جستجوی بیمار Ctrl+K، زنگِ کارها، `/app/work`، `GET /search/patients`؛ e2e ۱۷/۱۷.
- (در PR) **W2.3 صفحهٔ «امروز»** — `/app` = امروز، لانچر به `/app/tools`؛ e2e `scripts/e2e/w2-3-today.mjs` ۲۱/۲۱ (دو بار) + اسکرین‌شاتِ دسکتاپ/موبایل/کشو.
- ۱۴۰۵/۰۶/۲۵ · PR #18 · `8d8997b` · **W2.2 تولیدکننده‌های کار** روی `main` — emit در ۷ سرویس + `work-detectors.ts`؛ e2e ۳۲/۳۲ + سنجهٔ `invoice.issued`.
- ۱۴۰۵/۰۶/۲۵ · PR #12 · `8c3f234` · **W2.1 لایهٔ کار** روی `main`: `WorkItem`/`DomainEvent`، `/work`، ۲۶ قاعدهٔ رویداد←کار، پردازشگر در workerِ یادآوری، feature `work` + مجوزها؛ e2e ۲۲/۲۲.
- ۱۴۰۵/۰۶/۲۵ · PR #11 · `6b76cd1` · **پوشهٔ `docs/plan/` + سندِ بازبینی روی `main`.** از این‌جا به بعد هر ایجنت لِینِ خودش را از `docs/plan/lanes/<خودش>.md` می‌گیرد.

- ۱۴۰۵/۰۶/۲۵ · `b548faa` · **بازبینیِ تکمیلیِ مسیرها و UX + نقشهٔ اصلاح** (`docs/UX_WORKFLOW_AUDIT_2026-09-16.md`) و پوشهٔ هماهنگیِ `docs/plan/` (BOARD، CONTRACTS، DECISIONS، lanes، BRIEF_GPT). سه لِین: الف=`gpt` (صحتِ بک‌اند)، ب=`claude-opus` (سطوحِ بیمار/UI)، ج=`claude-fable` (لایهٔ کار/پوسته/امروز).

- ۱۴۰۵/۰۶/۲۴ · **باکسِ لینکِ MRI/CT/آزمایش + مدارکِ پزشکیِ فرم در پرونده.** نوعِ
  فیلدِ `links` (DynForm + FIELD_TYPES)، `FormField.docCategory`،
  `Document.externalUser/externalPass`، `link-documents.ts` (لینکِ فرم → مدرکِ
  لینکیِ مراجعه)، دو باکسِ پیش‌فرض روی فرمِ ویزیتِ مطب + backfill برای نصب‌های
  موجود. e2e: `links-box.mjs`.
  ⚠️ قراردادِ تازه: نوعِ فیلدِ جدید = `FIELD_TYPES` + `case` در DynForm + DTOِ
  `FieldCreateDto/FieldPatchDto` (whitelist) + `view()`ِ forms.service.

- ۱۴۰۵/۰۶/۲۴ · **رگرسیونِ CSS بعد از lazy‌شدنِ مسیرها.** فرمِ عمومیِ بیمار
  (`/f/:token`) بی‌استایل شده بود: `.pf-field` فقط در `definitions.css` بود که
  صفحهٔ عمومی ایمپورتش نمی‌کند. پوستهٔ فیلد (`.pf-*`, `.db-field`) به
  `src/index.css` رفت، کنترل‌های DynForm به `dynform.css`، و ۶ صفحهٔ دیگر که
  بی‌صدا از CSSِ صفحهٔ دیگری ارث می‌بردند ایمپورتِ صریح گرفتند. نگهبانِ تازه:
  `scripts/verify-css-chunks.js` (۳۶ چانک، صفر یتیم).

- `43a197b` · پاپ‌آپِ یک‌جای فاکتورِ نورومانیتورینگ
- `a849b5e` · `npm audit fix` بدونِ major
- `f08c0ef` · پرداختِ نقدی روی مراجعهٔ با فاکتورِ متصل دیگر ۴۰۰ نمی‌گیرد
