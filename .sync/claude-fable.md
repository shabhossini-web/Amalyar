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
  - src/app/PatientRecord.jsx
  - src/app/record.css
  - scripts/e2e/w3-1-live-record.mjs
  - scripts/e2e/w2-5-exceptions.mjs
  - src/app/Today.jsx
  - src/app/today.css
  - src/app/tools.jsx
  - src/app/Dashboard.jsx
  - src/app/VisitForm.jsx
  - src/app/visit-kinds.js
  - src/lib/time.js
  - server/src/patients/prep.service.ts
  - server/src/patients/live.service.ts
  - server/src/patients/frontdesk.service.ts
  - server/src/patients/appointments.service.ts
  - server/src/patients/appointments.controller.ts
  - server/src/auth/access-registry.ts
  - src/app/FrontDesk.jsx
  - src/app/frontdesk.css
  - src/app/Calendar.jsx
  - scripts/e2e/w3-3-front-desk.mjs
  - scripts/e2e/appointments-day.mjs
  - src/app/visit-defs.js
  - src/lib/terms.js
  - scripts/e2e/booking-flow.mjs
  - server/src/patients/patients.controller.ts
  - src/app/dashboard.css
  - scripts/e2e/w3-2-prep-card.mjs
  - .github/workflows/security-ci.yml
note: لِینِ ج — **W3.3 میزِ پذیرشِ روز ساخته شد** (۲۸ سنجه، CI سبز)؛ آمادهٔ مرج. بستهٔ بعدی: «دلیلِ لغو» (تصمیمِ مالک ۱۴۰۵/۰۶/۲۶) سپس W3.8. شروعِ اولیه (§۴.۵؛ `FrontDesk.jsx` + `frontdesk.service.ts` + سطحِ دسترسیِ منشی). `appointments.*` و `access-registry.ts` کلیمِ کسی نبودند — اگر لِینِ دیگری خواستشان، اعلام کند. **W3.1 با PR #33 (`f09ce54`) لند شد** (۶۳ سنجهٔ e2e). بستهٔ بعدی W3.3 میزِ پذیرش است (W1.5 لند شده، پس آزاد است)؛ کلیمِ تازه‌اش هنگامِ شروع نوشته می‌شود. سه فایلِ بیرونِ کلیم لازم شد و پایین اعلام شده‌اند: `src/index.css` و `src/app/definitions.css` (هر دو در کلیمِ **idle** لِینِ ب) و `src/app/today.css` (خودمان). شروعِ اولیه (`src/app/PatientRecord.jsx` + `record.css`). W3.2 گامِ ۲ در PR #28. لِینِ الف W1.5/W1.6 را لند کرد؛ W1.2 (وضعیت‌های سفارش) هنوز نیامده و W3.1 طوری نوشته می‌شود که بدونِ بازنویسی با آن جفت شود. `record.service.ts` کلیمِ کسی نیست ولی GPT تازه در W1.6 عوضش کرده — اگر لازم شد، اول اعلام. W2.1–W2.5 همه لند شده‌اند. `Launcher.jsx` و `src/ui/icons.jsx` آزادند (W3.7 لِینِ ب). لِینِ الف هنوز شروع نکرده، پس W3.1/W3.3 که به W1.2/W1.5 گره خورده‌اند منتظرند.
<!-- claim:end -->

> ردیف‌های زیر از تاریخچهٔ گیت پر شده‌اند تا فایل خالی نباشد.

## قراردادهایی که شکستم

- ۱۴۰۵/۰۶/۲۶ · **W3.3 فرانت — فرمِ مراجعه را خودِ میز میزبانی می‌کند، نه داشبورد.**
  معیارِ «≤ ۱ کلیک برگشت» را با یک کلیک داد (Escape)، ولی دلیلِ اصلی سلیقه نیست و
  سنجه‌اش را دارد: همان حسابِ منشیِ سطح‌۲ که تخته را می‌گیرد (۲۰۰) روی داشبورد
  **۴۰۳** می‌خورد. پرش به داشبورد یعنی بردنِ منشی به دیوار. `useVisitDefs(!!sheet)`
  تنبل است، پس تخته که هر ۲۰ ثانیه تازه می‌شود شش fetchِ بی‌مصرف نمی‌زند — و
  تازه‌سازی وقتی شیت باز است **متوقف** می‌شود (با فرمِ در حالِ تایپ نباید جنگید).
  آیکونِ `Arrive` آزاد بود و معنیِ خودِ میز را دارد (نگهبانِ قانون ۲۴: ۲۳ ماژول،
  ۲۳ آیکونِ یکتا).

- ۱۴۰۵/۰۶/۲۶ · **رفعِ هشدارِ دروغین در نمای استثنای مدیر (گزارشِ لِینِ الف).**
  `halfWhere` در `today.service.ts` هر ثبت‌نامِ `approved`ِ بدونِ `visitId` را
  «تأییدِ نیمه‌کاره» می‌شمرد — ولی فرمِ **زیرپرونده** (`scope='record'`) عمداً
  مراجعه نمی‌سازد (قاعدهٔ خودِ مخزن در پنج جا: `makesVisit = scope !== 'record'`).
  یعنی هر پاسخِ **سالمِ** نظرسنجی یک هشدار می‌ساخت. نمای استثنا معیارِ تصمیم است:
  کسی که به «۴۰ تأییدِ نیمه‌کاره» اعتماد کند و «درستشان کن» بزند دادهٔ سالم را
  خراب می‌کند — همان درسِ `shares_mismatch` در ملک‌طب.
  ⚠️ `form: null` (فرمِ حذف‌شده) عمداً **می‌ماند**، چون پیش‌فرضِ `makesVisit`
  آن‌جا هم روشن است. سنجهٔ «نباید بیفتد» در `w2-5-exceptions.mjs` (۱۸/۱۸).

- ۱۴۰۵/۰۶/۲۶ · **W3.3 — فیچرِ `frontdesk` در سطحِ ۲ و کنترلرِ جدا، نه پایین‌آوردنِ `calendar`.**
  `AppointmentsController` با `@Feature('calendar')` (سوپروایزر) بسته است و کلِ تقویمِ
  عمل‌ها و قواعدِ برنامهٔ کاری هم پشتِ همان‌اند؛ پایین‌آوردنش برای منشی آن‌ها را هم باز
  می‌کرد. دو کنترلر روی **یک** سرویس = دو سطحِ دسترسی بدونِ کپیِ منطق. چهار مجوزِ
  `frontdesk.*` هم تازه‌اند (مجوزهای `appointments.*` که جایی ادعا شده بود **وجود ندارند**).
- ۱۴۰۵/۰۶/۲۶ · **«شروع» و «بازکردنِ» مراجعه دو چیزند و تا امروز یکی بودند.**
  `startVisit` اگر نوبت از قبل `visitId` داشته باشد در خطِ ۲۸۹ **زودتر برمی‌گردد** و
  هرگز `arrived` نمی‌نویسد — که برای «بازکردن» درست است و برای «شروع» غلط. و
  `intake.service.ts:1736` هنگامِ تأییدِ ثبت‌نام نوبت را `confirmed` **به‌همراهِ** `visitId`
  می‌گذارد، پس هر بیمارِ ثبت‌نامِ آنلاین از ستونِ «نوبت‌دار» تکان نمی‌خورد. میز این دو را
  جدا کرد (`FrontDeskService.start`)؛ `AppointmentsService` **دست نخورد** تا رفتارِ تقویم
  عوض نشود.
- ۱۴۰۵/۰۶/۲۶ · **`APPT_ACTIONS` و `apptLane()` کنارِ `APPT_TRANSITIONS` نشستند، نه در میز.**
  برچسبِ **اقدام** («رسید») با برچسبِ **وضعیت** («در مطب») یکی نیست و دکمه فعل می‌خواهد.
  `view()` حالا `nextOptions` و `lane` هم می‌دهد تا کلاینت ماشینِ وضعیت را کپی نکند.
  ⚠️ `lane` هرگز از `visitId != null` به‌تنهایی مشتق نمی‌شود — `intake` روی نوبتِ
  `confirmed` هم `visitId` می‌نویسد و بیمار هنوز خانه است.
- ۱۴۰۵/۰۶/۲۶ · **دیتابیسِ محلیِ توسعه دریفت دارد — برای نوشتنِ e2e بدانید.**
  `scripts/e2e/booking-flow.mjs` ۲۵/۲ است و **مالِ هیچ تغییرِ تازه‌ای نیست** (با
  برگرداندنِ کاملِ `server/src` هم همان می‌ماند). ریشه: نوعِ مراجعهٔ **`clinic` در
  دیتابیسِ محلی وجود ندارد** و چند نوعِ یتیم از تست‌های قبلی مانده‌اند، پس تأییدِ
  ثبت‌نام به `surgery` می‌افتد که جراح اجباری دارد → «جراح را از تعاریف پایه انتخاب
  کنید». پیامِ خطای آن سنجه حالا بدنهٔ پاسخ را چاپ می‌کند (همین تشخیص را از دقیقه‌ها
  به ثانیه رساند).
  🔴 **پیامدش برای W3.3:** `startVisit` نوعِ `clinic` را می‌خواهد و اگر نباشد اولین
  نوعِ غیرِ `surgery` را برمی‌دارد — یعنی محلی یک نوعِ یتیم. سنجهٔ W3.3 باید نوعِ
  خودش را **بسازد**، نه به حالتِ محیط تکیه کند.

- ۱۴۰۵/۰۶/۲۶ · **W3.3 — شش fetchِ تعریف‌ها به هوکِ مشترکِ `src/app/visit-defs.js` رفت.**
  `VisitForm` بدونِ این شش فهرست کشویی‌های خالی می‌دهد، و تا امروز فقط `Dashboard`
  آن‌ها را بار می‌کرد. میزِ پذیرش همان فرم را باز می‌کند، پس کپیِ دوم یعنی روزی که
  تعریفِ تازه‌ای اضافه شود یکی از دو صفحه آن را ندارد. هوک **تنبل** است (میزِ پذیرش
  تا بازشدنِ فرم هیچ درخواستی نمی‌زند؛ تخته به جراح و تشخیص نیاز ندارد) و با
  `scope=user?.id` بعد از سوییچِ حساب دوباره می‌خواند — نسخهٔ اولِ خودم این یکی را
  جا انداخت و داشبورد فهرستِ حسابِ قبلی را نگه می‌داشت.
- ۱۴۰۵/۰۶/۲۶ · **`scripts/e2e/appointments-day.mjs` از W3.7 بی‌صدا قرمز بود.**
  برچسبِ دکمهٔ تقویم با W3.7 به `useTerms()` رفت و دیگر «بازکردنِ ویزیت» نیست مگر
  در حوزهٔ مطب؛ سنجه رشتهٔ حوزهٔ مطب را هاردکد داشت. حالا از خودِ `TERMS` خوانده
  می‌شود و ادعای واقعی‌اش را می‌سنجد («بازکردن می‌گوید نه شروع»)، نه واژهٔ یک حوزه را.
  ⚠️ **ریشه‌اش ساختاری است و باز می‌ماند:** CI فقط شش سوئیتِ **بدونِ مرورگر** را
  اجرا می‌کند، پس هیچ‌کدام از e2eهای مرورگری (از جمله همهٔ w2-*/w3-* این لِین) در
  CI نیستند و شکستنشان فقط وقتی دیده می‌شود که کسی دستی اجرا کند. سومین بار است
  که این الگو یک تست را بی‌صدا قرمز نگه می‌دارد (قبلی‌ها: `schedule-panel.mjs` در W2.3).

- ۱۴۰۵/۰۶/۲۶ · **W3.1 — سه فایلِ بیرونِ کلیم لمس شد (هر سه اعلام‌شده، AGENTS.md بندِ ۳).**
  ۱) `src/index.css`: توکنِ `--red-text` در هر سه بلوکِ تم اضافه شد — سومینِ همان
  سه‌گانهٔ `--green-text`/`--amber-text`/`--brand-text` که لِینِ ب در W3.6 ساخت.
  بدونش هر هشدارِ قرمز هگزِ روشنِ خام می‌نوشت و در تمِ روشن **نامرئی** بود
  (سنجیده: کنتراستِ هشدارِ حساسیت ۱٫۷۲ بود، حالا ۵٫۰۸). ۲) `src/app/definitions.css`:
  `.df { color: #f4f1ff }` — رنگِ **ارثیِ** کلِ صفحه که با تم نمی‌چرخید، پس در تمِ
  روشن نامِ بیمار و کدِ مراجعه سفیدِ روی سفید می‌شدند؛ شد `var(--text1)`. نگهبانِ تم
  این هگز را در فهرستِ خاکستری‌هایش نداشت و بی‌صدا رد می‌شد. کلیمِ لِینِ ب روی هر دو
  فایل `idle` است و `verify-claims.js` فقط هم‌پوشانیِ `active`ها را می‌سنجد.
  ۳) `src/app/today.css`: همان `#fecaca` به توکن.
- ۱۴۰۵/۰۶/۲۶ · **W3.1 — `GET /patients/:id/live` (`server/src/patients/live.service.ts`).**
  لایهٔ **پاسخ** جدا از بایگانیِ `record.service.ts` (کلیمِ لِینِ الف؛ دست نخورد) —
  همان الگوی `prep.service.ts`. قرارداد و هشت قاعده‌اش در `CONTRACTS.md` §۱۲.
  ⚠️ **یک رخنهٔ دسترسی در خودِ همین بسته بسته شد:** نسخهٔ اولِ این endpoint سفارش‌های
  بالینی (نامِ آزمایش، مودالیته و ناحیه، تخصص و نامِ پزشک) را زیرِ `patients.read`
  می‌داد، در حالی که `@Controller('orders')` با `@MinLevel(TECH_ADMIN)` بسته است.
  حالا `ordersVisible` همان دروازه را دارد. دو دروازه برای یک داده = یکی‌شان بی‌اثر.
- ۱۴۰۵/۰۶/۲۶ · **W3.1 — `WorkService.enrich` حالا `ownerRoleFa` هم می‌دهد**
  (`OWNER_ROLE_FA` در `work-rules.ts`، کنارِ جایی که `ownerRole` ساخته می‌شود).
  هر رابطی که نگاشتِ خودش را داشته باشد روزی که نقشِ تازه صادر شود کلیدِ خامِ
  انگلیسی چاپ می‌کند — نسخهٔ کلاینتیِ اولیه دقیقاً `admin` را نداشت.
- ۱۴۰۵/۰۶/۲۶ · **W3.1 — `Dashboard.jsx` دو چیز گرفت:** دیپ‌لینکِ `location.state.prefill`
  (بیمارِ «مراجعهٔ جدید» از پروندهٔ زنده؛ در `state` نه کوئری، چون نامِ بیمار نباید
  در URL و تاریخچهٔ مرورگر بنشیند)، و **رفعِ یک باگِ نهفته:** افکتِ «سوییچِ حساب →
  شیت را ببند» با پرچمِ بولی کار می‌کرد، ولی `user.id` در اولین رندر `undefined`
  است و یک تیک بعد می‌نشیند — پس بارِ دوم را «سوییچ» می‌فهمید و شیتی را که همان
  لحظه باز شده بود می‌بست. حالا با **شناسهٔ قبلی** سنجیده می‌شود. مسیرِ `?patient=`
  این را نداشت چون `setModal`ِ آن بعد از یک fetch اتفاق می‌افتد — یعنی باگ فقط
  برای مسیرِ همگام دیده می‌شد و تا امروز پنهان مانده بود.
- ۱۴۰۵/۰۶/۲۶ · **W3.1 — کارتِ «کارِ بعدی» از `WorkRow` استفاده می‌کند، نه کارتِ دست‌ساز.**
  نسخهٔ اول کارت را از نو می‌ساخت و در نتیجه نه `TYPE_FA` داشت، نه «دکمهٔ اصلی»ِ
  §۴.۳ بندِ ۳، نه `amalyar:work-changed` می‌زد. قابِ `work.css` داخلِ کارت با CSSِ
  محلی برداشته می‌شود (کارت-در-کارت)، نه با تغییرِ `work.css` — زنگِ اعلان و
  «کارهای من» به همان قاب نیاز دارند.

- ۱۴۰۵/۰۶/۲۵ · **W3.2 گامِ ۲ — `GET /visits/:id/prep`** (`server/src/patients/prep.service.ts`): هویت + هشدارهای بالینی + سابقهٔ کوتاه + نتیجه‌های در انتظار + ماندهٔ مالی، در یک درخواست. دامنهٔ دید همان فهرستِ مراجعات (زیرِ سوپروایزر فقط `techId` خودش) چون دادهٔ بالینیِ حساس دارد. `record.service.ts` (کلیمِ GPT) دست نخورد — سرویسِ تازه جداست.
- ۱۴۰۵/۰۶/۲۵ · **W3.2 — نگهبانِ «برچسبِ پشتیبانِ نوعِ مراجعه» به `visit-kinds.js` منتقل شد** (چون برچسب‌ها آن‌جا رفتند) و یک سنجهٔ تازه گرفت: `KINDS` نباید دوباره در `Dashboard.jsx` یا `VisitForm.jsx` تعریف شود. دنبالِ کد آمد، ضعیف‌تر نشد.
- ۱۴۰۵/۰۶/۲۵ · **W3.2 گامِ ۱ — `VisitForm` از `Dashboard.jsx` بیرون آمد** (`src/app/VisitForm.jsx`، بدونِ تغییرِ رفتار؛ ۲۴۳۶ → ۱۱۱۲ خط). `DefSelect` با آن رفت. دو چیزِ مشترک تک‌منبع شدند: واژگانِ نوعِ مراجعه در `src/app/visit-kinds.js` (`KINDS`/`kindOf`) و `faDuration` در `src/lib/time.js` — هر کس نوعِ تازه یا قالبِ مدت خواست، همان‌جا.
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

- ۱۴۰۵/۰۶/۲۶ · PR #33 · `f09ce54` · **W3.1 پروندهٔ زنده** روی `main` — `GET /patients/:id/live`، نوارِ مرحله، خطِ زمانِ واحد، کارتِ کارِ بعدی؛ e2e ۶۳/۶۳. بازبینیِ متخاصم هشت یافته داد و هر هشت رفع شدند (سه گیتِ ماژول، دو باگِ مالی، سقفِ سفارش، دو نقطهٔ نامرئیِ تمِ روشن).

- ۱۴۰۵/۰۶/۲۶ · PR #28 · `c62b7f4` · **W3.2 گامِ ۲ کارتِ آماده‌سازیِ ویزیت** روی `main` (`GET /visits/:id/prep`).
- ۱۴۰۵/۰۶/۲۵ · PR #23 · `4044c85` · **W3.2 گامِ ۱** روی `main`: `VisitForm` به فایلِ خودش، `Dashboard.jsx` ۲۴۳۶ → ۱۱۱۲ خط، `visit-kinds.js` و `faDuration` تک‌منبع.
- ۱۴۰۵/۰۶/۲۵ · PR #22 · `f8da7bd` · **W2.5 نمای استثنای مدیر** روی `main` — با این، W2.1 تا W2.5 کامل شد.
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
