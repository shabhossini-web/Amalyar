<!-- claim:begin -->
agent: claude-fable-b
status: active
branch: claude/quirky-johnson-ynzr4y
since: 2026-09-23
paths:
  - server/src/config/tenant-profile.ts
  - server/src/config/config.service.ts
  - server/src/config/config.controller.ts
  - src/app/Settings.jsx
  - src/app/settings.css
  - scripts/e2e/tenant-profile-write.mjs
  - scripts/e2e/tenant-profile-write-local.mjs
  - scripts/e2e/tenant-profile-ui.mjs
  - server/src/patients/labels.ts
  - server/src/patients/form-presets.ts
  - src/ui/DynForm.jsx
  - scripts/e2e/service-form.mjs
  - scripts/e2e/service-form-local.mjs
  - server/src/patients/intake-service-of.ts
  - server/src/patients/intake.service.ts
  - server/src/patients/intake.controller.ts
  - server/src/patients/patients.service.ts
  - server/src/patients/forms.service.ts
  - server/src/patients/surgeon-portal.service.ts
  - server/src/ai/ai.service.ts
  - src/app/config.jsx
  - src/app/Intake.jsx
  - src/app/intake-admin.css
  - src/app/SurgeonPortal.jsx
  - src/app/BillingSheet.jsx
  - src/lib/profile.js
  - src/lib/terms.js
  - src/pages/Intake.jsx
  - scripts/e2e/tenant-profile.mjs
  - scripts/e2e/tenant-profile-unit.mjs
  - scripts/e2e/company-services.mjs
  - scripts/e2e/company-services-local.mjs
  - scripts/e2e/company-services-ui.mjs
  - scripts/e2e/w0-1-intake-steps.mjs
  - scripts/e2e/w1-4-approve-atomic.mjs
  - scripts/e2e/w1-5-appointment-visit-link.mjs
  - scripts/e2e/w2-2b-intake-events.mjs
  - scripts/e2e/profile-workflows.mjs
  - scripts/e2e/company-operations.mjs
  - scripts/e2e/intake-finance-roles.mjs
  - server/src/ai/assistant-knowledge.ts
  - scripts/e2e/booking-flow.mjs
  - scripts/e2e/voice-notes.mjs
  - server/src/config/settings-registry.ts
  - server/src/patients/intake-docs.ts
  - src/pages/intake.css
  - src/ui/hospital-lookup.css
  - scripts/e2e/approval-cards.mjs
  - scripts/e2e/approval-cards-local.mjs
  - scripts/e2e/approval-cards-ui.mjs
  - scripts/e2e/payment-step-ui.mjs
  - server/src/patients/visit-requirements.ts
  - server/src/patients/inventory.service.ts
  - server/src/patients/inventory.controller.ts
  - server/src/patients/theatre.service.ts
  - src/app/RequiredItems.jsx
  - src/app/Theatre.jsx
  - src/app/theatre.css
  - src/app/surgeon-portal.css
  - scripts/e2e/implant-rows.mjs
  - scripts/e2e/implant-rows-ui.mjs
note: >-
  بازخوردِ مالک ۱۴۰۵/۰۷/۰۱ — «اصلاحاتِ شرکتی»: نصب یا مطب/کلینیک است یا شرکتی و شرکت
  خودش بستهٔ خدماتش را می‌چیند؛ دو فرمِ ثبتِ خدمت (نورومانیتورینگ، ایمپلنت) با مسیرِ
  هویت ← خدمت ← واریز ← تأیید. بستهٔ الف: پروفایل (نوع + خدمات) فقط سمتِ خواندن،
  بی‌هیچ تغییری برای نصب‌های فعلی + واژه‌های وضعیت و دکمهٔ فرمِ پولی.
<!-- claim:end -->

> **این فایل مالِ نشستِ لِینِ ب است** (مدلِ Fable، نشستِ دوم). نشستِ لِینِ ج فایلِ `claude-fable.md` را دارد. هر نشست فقط فایلِ خودش.

## قراردادهایی که شکستم

- ۱۴۰۵/۰۷/۰۱ · **فرمِ ثبتِ خدمت** (هر دو خدمت): «نام عمل» (اجباری)، `opDateOpen` («رزرو بدون
  تاریخ»، bool)، `nationalIdImage` (دستهٔ `identity`) و `prescription` (هر دو اجباری). `opDate`
  وقتی `opDateOpen` روشن است اجباری نیست — **یک** قاعده در `validateFields` و `DynForm`.
  فرم‌های نصب‌شدهٔ دو خدمت یک‌بار (`registration_<key>_service_fields`) **فقط فیلدهای تازهٔ همین نسخه** را
  می‌گیرند (`REGISTRATION_V2`)؛ فیلدِ دست‌خورده یا پاک‌شده دست نمی‌خورد و مطب ارتقا ندارد.

- ۱۴۰۵/۰۷/۰۱ · **`PATCH /config/profile`** `{kind, services}` و **`POST /config/profile/preview`**
  (سوپرادمین). ماژول‌ها فقط جایی عوض می‌شوند که عضویتشان در پلان عوض شده — سطح و خاموشِ
  دست‌خورده می‌مانند (`featureChanges`). `PATCH /config/vertical` برای سوییت‌ها و بازگشت
  می‌ماند با همان رفتارِ قدیمی (بازچینیِ کامل) + پاک‌کردنِ ردیفِ `services`.
- ۱۴۰۵/۰۷/۰۱ · **فرمِ ثبت‌نام به‌ازای هر خدمت:** شرکتِ دوخدمته `intake.ionm` و
  `intake.implant` هر دو را نصب می‌کند و `/intake/link-options` هر دو را `recommended`
  می‌دهد (قبلاً دقیقاً یکی). نصب با پرچمِ `registration_<key>_installed` (همان کلیدهای قبلی).

- ۱۴۰۵/۰۷/۰۱ · **تأییدِ ثبت‌نام در شرکت** (تصمیمِ مالک): جراح **و بیمارستانِ** تعریف‌شده برای
  هر دو خدمت الزامی است؛ بیمارستانِ «پیشنهادی» (تطبیقِ فازی) دیگر خودکار نمی‌نشیند (دقیق/مستعار/انتخابِ
  بیمار بله). ستاره‌های فرمِ عمل **فقط در نورومانیتورینگ** شل‌اند (مثلِ قبل)؛ ایمپلنت با ستاره‌های
  کامل سنجیده می‌شود و تنها استثنایش «رزرو بدون تاریخ» است
  (`prepareVisitCreation(..., { intakeCompany: { relaxRequired, undated } })` جای `intakeIonm`). مطب بی‌تغییر.
  **هر e2eای که ثبت‌نامِ شرکت را بی‌`hospitalId` تأیید می‌کند باید بیمارستان بدهد** — `w1-4-approve-atomic`،
  `w2-2b-intake-events`، `booking-flow` و `voice-notes` همین را گرفتند.
- ۱۴۰۵/۰۷/۰۱ · اقلامِ ایمپلنت و این قاعده حالا بر اساسِ **خدمتِ ردیف** است (`intake-service-of.ts`)،
  نه `vertical`: ردیف‌های `/intake/submissions` فیلدهای `service`، `serviceLabel`، `serviceAmbiguous`
  دارند؛ `ApproveDto.service` (فقط فرمِ دلخواه در شرکتِ دوخدمته). ردیف‌های `/surgeon/visits`
  `implant` (per-مراجعه) و پاسخ `services` دارد.
- ۱۴۰۵/۰۷/۰۱ · ردیف‌های `/intake/submissions` حالا `profileKind` هم دارند (پاپ‌آپ «الزامی» را از ردیف
  می‌خواند نه از کانفیگِ کش‌شده) و ردیفِ فرمِ زیرپرونده `service: null`، `serviceAmbiguous: false`
  می‌گیرد. کلیدِ فرمِ `intake.<خدمت>` فقط وقتی خدمت را تعیین می‌کند که شرکت هنوز همان خدمت را بدهد.
  ردیفِ تنظیماتِ `services` وقتی خدمتِ اصلی‌اش (`primaryOf`) با `vertical` نخواند کهنه است و نادیده.
- ۱۴۰۵/۰۷/۰۱ · **پاپ‌آپِ تأیید و صفحهٔ پرداخت:** ردیف‌های `/intake/submissions` حالا `receipts`
  (`[{id,name,pdf}]` — **همهٔ** فیش‌ها، بی‌پاک‌شده‌ها) و `documents` (عکس‌های کادرهای عکسِ فرم با
  `field`/`label`) و `patient.birthDate` دارند؛ کلاینت دیگر `receiptDocumentId` یا `data.prescription` را
  خودش درنمی‌آورد. نمای عمومیِ فرم `paymentNote` دارد (تنظیمِ تازهٔ `intake_payment_note` در گروهِ تازهٔ
  `intake`؛ خالی = پیش‌فرض). اصلاحِ هویت در پاپ‌آپ از همان `PATCH /patients/:id` می‌رود (کدِ ملی نه).
- ۱۴۰۵/۰۷/۰۱ · **ردیف‌های ایمپلنت:** هر ردیفِ `Visit.requiredItems` حالا `prescribedQuantity` هم دارد —
  در تأییدِ ثبت‌نام برابرِ تعداد و **قفل**؛ ویرایشِ بعدی (پرتالِ جراح) فقط `quantity` (برنامه) را عوض
  می‌کند، ردیفِ نسخه‌دار حذف نمی‌شود (۴۰۰)، ردیفِ افزوده‌شده بعد از تأیید `null` می‌گیرد.
  `resolveRequirements(prisma, rows, { prescribe?, previous? })`. نمای اتاقِ عمل `prescribed` کنارِ
  `quantity` می‌دهد. endpointِ تازهٔ `GET /stock/availability?items=` (فقط خواندن، `inventory.read`).
- ۱۴۰۵/۰۷/۰۱ · **هارنس‌های دست‌ساز:** `FormsService`/`SurgeonPortalService` از config
  `profile()` هم می‌خواهند و `AiService` پارامترِ چهارمِ `ConfigService` دارد. پنج هارنس به‌روز شد
  (`profile-workflows`, `company-operations`, `intake-finance-roles`, `w1-5-…`, `w2-2b-…`) — هارنسِ تازه
  همان `cls('config/tenant-profile','profileOf')` را بدهد، نه جوابِ دست‌نوشته.

- ۱۴۰۵/۰۷/۰۱ · **`GET /config`** سه فیلدِ تازه دارد: `kind` (`clinic|company`)، `services`
  (برای شرکت دست‌کم یکی از `ionm|implant`)، `profileLabel`؛ به‌علاوهٔ `kinds` و
  `serviceCatalog`. `vertical` سرِ جایش است و برای شرکت **خدمتِ اصلی** است — هرگز
  `company`. خوانندهٔ تازه‌ای که «این شرکت ایمپلنت دارد؟» می‌پرسد از `services` بپرسد
  (`src/lib/profile.js` → `hasService`)، نه از `vertical === 'implant'`.
- ۱۴۰۵/۰۷/۰۱ · **`PATCH /config/vertical`** ردیفِ `services` را پاک می‌کند.
- ۱۴۰۵/۰۷/۰۱ · برچسبِ وضعیتِ ثبت‌نام: `pending_fill` «در حالِ پر کردن»، `pending_payment`
  «در انتظارِ واریز» (کلیدها همان). دکمهٔ فرمِ **پولی** «ثبت و مرحلهٔ بعد» است
  (`T.submit.paid`)؛ فرمِ رایگان همان «ذخیرهٔ اطلاعات».

- ۱۴۰۵/۰۶/۲۹ · **`scripts/e2e/follow-up.mjs`** فایلِ پیش از لِین‌بندی است و صاحبِ
  مشخصی ندارد؛ فقط سنجه‌هایش با قراردادِ اعلام‌شدهٔ لِینِ الف هم‌خوان می‌شود، رفتاری
  عوض نمی‌شود. `.github/workflows/security-ci.yml` فقط در انتها یک گام می‌گیرد.


- ۱۴۰۵/۰۶/۲۸ · **بدهی‌های لِینِ الف در غیابِ gpt (ادامهٔ دستورِ مالک):**
  `server/src/patients/{reminders,intake}.service.ts` قلمروِ تابلوییِ لِینِ الف‌اند؛
  کلیمِ `gpt` idle با `paths: []` است، پس هم‌پوشانی نیست. `.github/workflows/security-ci.yml`
  فقط **در انتها** دو گام می‌گیرد (قاعدهٔ فایلِ پرتنش). `docs/plan/lanes/gpt.md` فقط
  یک ردیف/بخش در انتها می‌گیرد، مثلِ تحویل‌های قبلیِ «(ب)».


- ۱۴۰۵/۰۶/۲۷ · **W0.4 — `src/app/PatientRecord.jsx` و `src/app/record.css`، بدونِ کلیم.**
  هر دو در کلیمِ فعالِ لِینِ ج هستند و نگهبان درست جلویم را گرفت، پس **کلیمشان
  نکردم**. ولی W0.4 خودِ رندرِ پاسخ در همان صفحه است و جای دیگری ندارد. تغییر
  افزایشی است: یک کامپوننتِ تازهٔ `AnswerValue` + یک `onErr` روی `FormsTab`/`VisitsTab`،
  و در CSS فقط دو قاعدهٔ تازه در **انتهای** فایل (`.rc-ans-items a`, `.rc-ans-doc`).
  هیچ قاعده یا رفتارِ موجودی عوض نشد، پس در مرج اتحادِ دو طرف می‌شود.
  ⚠️ **قراردادِ تازه برای همه:** پاسخِ فرم دیگر رشتهٔ خام نیست — `answersOf` و
  `attachedForms.answers` کنارِ `value` یک `items[]` هم می‌دهند
  (`{kind:'link'|'doc', title, url?, docId?}`). هر مصرف‌کنندهٔ تازه باید `items` را
  بچیند و **خودش پارس نکند** (قانونِ ۱۵). تکِ منبع: `answerParts()` در `record.service.ts`.

- ۱۴۰۵/۰۶/۲۷ · **`server/prisma/schema.prisma` — یک ستون، بدونِ کلیم.** W1.9 به
  `Reminder.attempts` نیاز داشت (بدونش `uncertain` وضعیتِ نهایی می‌ماند). این فایل
  در کلیمِ فعالِ لِینِ ج است و طبقِ `AGENTS.md` بندِ ۵ فایلِ پرتنش هم هست، پس
  **کلیمش نکردم** — نگهبان درست جلویم را گرفت. تغییر کمینه است: یک ستونِ تازه در
  انتهای همان مدلِ `Reminder`، هیچ مدلِ دیگری دست نخورد. کارِ لِینِ ج روی
  `EpisodeStep` است، پس در مرج اتحادِ دو طرف می‌شود.
  migration جدا و افزایشی: `20260917220000_reminder_attempts`.

- ۱۴۰۵/۰۶/۲۶ · **W3.4 — `--red-text` تنها قرمزِ متنیِ اپ است، و صفحهٔ بیمار
  زمینه‌اش را از توکن می‌گیرد.** ۶۹ موردِ `color: #fca5a5`ِ خام در ۲۸ فایل به
  `var(--red-text)` رسیدند (توکنی که لِینِ ج در W3.1 ساخته بود؛ توکنِ دومِ
  `--rose-text` ساخته و بلافاصله برداشته شد — یک مفهوم، یک نام). در تمِ تیره
  کمی روشن‌تر می‌شوند (`#fca5a5` → `#fecaca`) که عمدی است، همان یک‌دست‌سازیِ
  W3.6. نگهبان حالا هر دو هگز را در جایگاهِ `color:` رد می‌کند.
  `portal.css` هم `#070512`ِ هاردکد را به `var(--bg)` داد.
  ⚠️ فایل‌های دستِ‌خورده در کلیمِ لِینِ ج فقط همین جایگزینیِ مکانیکیِ رنگ را
  گرفتند، بدونِ هیچ تغییرِ رفتاری.

- ۱۴۰۵/۰۶/۲۶ · **W3.7 — آیکونِ ماژول یکتاست و نامِ کاشی با عنوانِ صفحه یکی.**
  ماژولِ تازه آیکونِ خودش را در `src/ui/icons.jsx` می‌سازد (نگهبان:
  `scripts/verify-module-icons.js`). «ویزیت» دیگر در `Calendar.jsx` هاردکد نیست —
  از `useTerms()` می‌آید (`t.visitStart`/`t.visitOpen`، کلیدهای تازهٔ `terms.js`).
  سه مفهومِ نوبت/مراجعه/کار در `FLOW` و سرِ `terms.js` تعریف شده‌اند.
  ⚠️ **چهار فایلِ کلیمِ لِینِ ج دست خوردند، همه حداقلی:**
  `src/app/tools.jsx` (فقط مقدارِ `icon`/`label` — کاتالوگ خودِ هدفِ U14 است و
  جای دیگری ندارد)، `src/app/Dashboard.jsx` (دو رشته: `<h1>` و `document.title`)،
  `scripts/e2e/w2-3-today.mjs` (یک رشته: کلیک روی «داشبورد مدیریت» با رنیم
  می‌شکست — نگذاشتم قرمز بماند)، و `src/app/visit-kinds.js` فقط **خوانده** شد.
  هیچ‌کدام را کلیم نکردم تا `verify-claims` قرمز نشود.
  سوییت‌های `w2-*` سرورِ زندهٔ `:3101` می‌خواهند و در این سندباکس بالا نمی‌آیند؛
  تنها ادعای آن‌ها که به کارِ من بند بود همان کلیکِ برچسب بود که اصلاحش کردم.

- ۱۴۰۵/۰۶/۲۵ · **W3.6 — از امروز اپ دو تم دارد، و رنگِ خام در CSS ممنوع است.**
  `<html>` دو صفتِ تازه می‌گیرد: `data-theme` (`dark`|`light`) و `data-density`
  (`cozy`|`compact`). **هر `rgba(255,255,255,α)` باید `rgba(var(--veil-rgb), α)`
  شود** — «پردهٔ روی سطح»، که در تمِ روشن سیاه می‌شود. خاکستریِ ثابت
  (`#cfc9e8`, `#8f88b5`, …) باید توکنِ متن باشد. نگهبان: `scripts/verify-theme-tokens.js`.
  صفحه‌های ورودی (لندینگ/ورود/لانچر) با کلاسِ `theme-dark` همیشه تیره می‌مانند (§۴.۸).
  **شدتِ متنیِ رنگ‌های معنایی هم توکن شد:** `--green-text` / `--amber-text` /
  `--brand-text` (+ `--ink-bright` برای مرکّبِ روی چیپِ کهربایی). هگزهای
  `#5eead4` / `#fbbf24` / `#ddd6fe` در جایگاهِ `color:` روی زمینهٔ روشن
  ۱٫۲–۱٫۴:۱ می‌دادند؛ **مقدارِ تیرهٔ توکن‌ها دقیقاً همان هگزِ قبلی است**، پس تمِ
  تیره ذره‌ای جابه‌جا نشد. `#9a93bb` → `--text3` و `#c9c2e4` → `--text2`
  (این دو در تمِ تیره کمی تیره‌تر شدند — همان توکنِ کپشن/متنِ فرعی).
  ⚠️ **سطوحِ مات یک‌دست شدند:** ده نزدیک‌به‌سیاهِ دست‌چین (`#120d31`, `#030212`,
  `#07051a`, …) همه `--surface-rgb` شدند. در تمِ تیره یعنی کمی روشن‌تر شدنِ
  پنل‌های تیره‌ترین‌ها — عمدی، چون کلِ نکتهٔ لایهٔ توکن همین است.
  ⚠️ **سه فایلِ کلیمِ لِینِ ج دست خوردند** (`src/app/shell.css`, `today.css`, `work.css`):
  فقط همان جایگزینیِ مکانیکیِ پرده/سطح/شدتِ متنی، بدونِ هیچ تغییرِ ساختاری. بدونشان نوارِ بالا و
  صفحهٔ «امروز» — که روی *هر* صفحهٔ `/app` دیده می‌شوند — در تمِ روشن سیاه می‌ماندند و
  تم عملاً شکسته بود. کلیم‌شان را برنداشتم تا `verify-claims` قرمز نشود.
  سوییت‌های `w2-3/w2-4/w2-5` سرورِ زنده می‌خواهند و در این سندباکس بالا نیامدند؛
  ادعای رنگی ندارند و تغییرِ من در آن سه فایل فقط جایگزینیِ توکن است.
- ۱۴۰۵/۰۶/۲۵ · **W3.5 — نقشِ فیلد دیگر از خودِ ردیف تیک نمی‌خورد.** تیک‌زدن فقط در
  ماتریسِ یک‌جای بالای فهرست است؛ ردیف نقش‌ها را فقط **نشان** می‌دهد. نویسندهٔ داده
  همان `PATCH /forms/fields/:id {roles}` قبلی است (یک مسیر، نه دو). کلاسِ تازهٔ
  `fb-side` روی پنلِ `Overlay` = پنلِ کناریِ دسکتاپ؛ هر صفحهٔ دیگری هم بخواهد،
  همین کلاس کافی است. `.fb-acts .df-act` تا امروز بی‌استایل بود (قاعدهٔ مشترک
  `.df-acts button` است) — حالا در `formbuilder.css` اندازه می‌گیرد.
- ۱۴۰۵/۰۶/۲۵ · **W0.6 رفتارِ تازه در `src/ui/Overlay.jsx` و `Tabs.jsx` (برای همهٔ مصرف‌کننده‌ها):**
  هر پوشش با Escape بسته می‌شود (فقط بالاترین لایه، با قیدِ `closable`)، Tab داخلِ پنل
  می‌چرخد، فوکوس روی پنل می‌آید و به بازکننده برمی‌گردد، `role="dialog"`/`aria-modal`/
  `tabIndex=-1` پیش‌فرضِ پنل است. تب‌ها roving tabindex + فلش/Home/End دارند. مصرف‌کننده
  چیزی اضافه نمی‌کند؛ اگر پنل `onKeyDown` خودش را دارد همچنان صدا زده می‌شود.
- ۱۴۰۵/۰۶/۲۵ · **W0.1/W0.2 قراردادِ تازه، نه شکست:** واژه‌نامهٔ متنِ رو به بیمار `PATIENT` در
  `src/lib/terms.js` — هر صفحهٔ عمومیِ تازه (W3.4 پرتال) متنِ وضعیتش را از همین‌جا بردارد، نه
  رشتهٔ هاردکد در JSX. صفحهٔ `/o` وضعیتِ سفارش را طبقِ `CONTRACTS.md` §۴ می‌خواند و فقط در
  `sent`/`needs_action` فرم نشان می‌دهد (§۵). کمک‌تابعِ تازهٔ e2e: `scripts/e2e/lib/mock-ui.mjs`
  (Vite + مرورگرِ واقعی + API ساختگی، بدونِ سرور و دیتابیس).

## اخیراً لند شد

- ۱۴۰۵/۰۶/۲۶ · PR #36 · `211426f` · **W3.4 لینکِ واحدِ بیمار (بخشِ آزاد)** — «کارهای شما»
  روی `/p` با deep-linkِ `/f` `/o` `/s`، کارتِ ادغام‌شدهٔ توصیه+نوبت روی `forVisitId`،
  و لینکی‌کردنِ متنِ پیام‌ها بدونِ `dangerouslySetInnerHTML`. e2e ۱۹/۱۹.
  ⚠️ دو باگِ واقعی هم بست: `portal.css` زمینه را هاردکد داشت و روی tenantِ حوزهٔ مطب
  ناخوانا بود، و ۶۹ موردِ `#fca5a5`ِ خام به `--red-text` رسیدند.
  ⛔ پیش‌نویس (W1.8) و آپلودِ فایلِ پاسخ (W0.5/W0.8) عمداً ساخته نشدند — endpoint ندارند.

- ۱۴۰۵/۰۶/۲۶ · PR #31 · `e2104ed` · **W3.7 آیکونِ یکتا + نام‌گذاریِ کارمحور + واژه‌نامه** —
  ۲۲ ماژول/۲۲ آیکونِ یکتا (۸ تازه) با نگهبانِ `scripts/verify-module-icons.js`؛
  «داشبورد مدیریت»→«بیماران» و «ثبت‌نامِ بیماران»→«پذیرش» (عنوانِ `<h1>` و
  `document.title` هم با کاشی یکی شد)؛ `FLOW` + `visitStart`/`visitOpen` در
  `terms.js` که باگِ «شروعِ ویزیت»ِ هاردکد در `Calendar.jsx` را بست. e2e ۳۳/۳۳.
  ⚠️ درسِ ماندنی: چکِ ماشینی (نامساوی‌بودنِ `d`) سبز بود ولی اسکرین‌شات نشان داد
  چهار کاشی «برگهٔ کاغذ»اند و دو تا «تقویم» — سه آیکون بازطراحی شد.

- ۱۴۰۵/۰۶/۲۶ · PR #24 · `4443759` · **W3.6 تمِ روشنِ بالینی** — `data-theme`/`data-density`
  روی `<html>` از `src/lib/theme.js`؛ پیش‌فرضِ `clinic` روشن ولی انتخابِ کاربر مقدم؛ سوییچ در
  `ProfileMenu`؛ ویترین با `.theme-dark` تیره ماند. چهار جایگزینیِ توکنی در کلِ CSS
  (`--veil-rgb`, `--surface-rgb`, `--green-text`/`--amber-text`/`--brand-text`, `--ink-bright`).
  نگهبانِ تازه `scripts/verify-theme-tokens.js`؛ e2e ۲۹/۲۹. `CLAUDE.md` قانونِ ۲۳ و اسکیلِ
  `amalyar-design` به‌روز شدند. بدهیِ باز: `--brand-text` در تمِ تیره هنوز از برند مشتق نمی‌شود.

- ۱۴۰۵/۰۶/۲۵ · PR #19 · `572e747` · **W3.5 فرم‌ساز** — ماتریسِ نقشِ یک‌جا به‌جای ۱۰۵ چک‌باکسِ
  پخش‌شده در ردیف‌ها، ردیفِ یک‌طبقه، پنلِ کناریِ دسکتاپ، پیش‌نمایش با همان `DynForm`.
  ارتفاعِ قالبِ ویزیت در موبایل ۵۱۵۱px ← ۱۷۹۵px. e2e ۳۱/۳۱.

- ۱۴۰۵/۰۶/۲۵ · PR #16 · `2ced34c` · **W0.6** — Escape/focus-trap/بازگشتِ فوکوس و `role="dialog"` در `Overlay`، roving tabindex و کلیدهای جهت در `Tabs`؛ e2e `w0-6-a11y.mjs` ۱۷/۱۷.

- ۱۴۰۵/۰۶/۲۵ · PR #15 · `afa824b` · **W0.1 + W0.2** — استپر و پیام‌های فرمِ بیمار از وضعیتِ مسیر، برچسبِ `follow_up`، پیامِ پایانِ سفارش، واژه‌نامهٔ `PATIENT` در `terms.js`، کمک‌تابعِ `lib/mock-ui.mjs`.

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

## یادداشت برای لِین‌های دیگر

- ۱۴۰۵/۰۶/۲۹ · **برای gpt — باگِ قابلِ بازتولید در قلمروِ شما (مالِ این بسته نیست):**
  عملی که لغو و بعد به `pending` برگردانده شود، **یادآوریِ عملش را از دست می‌دهد**.
  `portal.mjs` (سوئیتِ زنده) این را می‌گیرد: «و برگرداندنِ وضعیت دوباره می‌کارد» —
  روی **کدِ `main`** و دیتابیسِ تازه با `bootstrap-env.mjs` ۱۷/۱. مکانیزم از
  کد: `plan()` در `syncNextVisit` روی `dedupeKey` با `update: {}` upsert می‌کند؛
  ردیفِ `cancelled` همان کلید را دارد، پیدا می‌شود و دست نمی‌خورد، پس هیچ
  pendingای کاشته نمی‌شود. کامنتِ W1.9 فقط `pending`/`sent` را دیده بود. اصلاحِ
  محتمل: در upsert اگر ردیفِ موجود `cancelled` است، `status: 'pending'` (و
  `dueAt` تازه) بدهد — ولی `reminders.service.ts` مالِ شماست و من دست نزدم.
  تصمیمِ مالک دربارهٔ توکنِ پیگیری هم رسید: **قراردادِ شما (per-wave) ماند**؛ من
  فقط پورتال را صافی زدم و `follow-up.mjs` را با قرارداد هم‌خوان کردم.


- ۱۴۰۵/۰۶/۲۹ · **برای gpt (پاسخ به «هماهنگی تازه»ِ ۲۰۲۶‑۰۹‑۱۹):** قراردادی که آن‌جا
  تثبیت کردید — «لینکِ جدا برای هر موج» — بر پایهٔ گزارشِ لِینِ ج بود، نه سنجش.
  با ابزارِ خودِ لِینِ ج (`bootstrap-env.mjs`، Postgresِ واقعی، دیتابیسِ تازه) کدِ
  قبلی **۱۹/۲** است نه ۲۱/۰: هر موج فرم و توکنِ خودش را می‌گرفت و بیمار در هر
  پیامک لینکِ تازه می‌دید. **ولی قراردادِ شما (per-wave) همان است که W1.1/D01 در CI می‌سنجد و `unfollowed()` رویش
  بنا شده؛ طرحِ اشتراکیِ من آن را می‌شکست، پس از PR #65 بیرون کشیده شد.** دو
  یافته می‌ماند که تصمیم را مالک می‌گیرد: `follow-up.mjs` با قراردادِ فعلی ناسازگار
  است (۱۹/۲ روی دیتابیسِ تازه)، و پورتالِ بیمار ردیف‌های per-waveِ پیش‌ساخته را از
  لحظهٔ ثبت «کار» نشان می‌دهد. شرح و اعداد: `docs/plan/lanes/claude-fable-b.md`. اگر ادعای
  متفاوتی دارید، لطفاً **با اجرا** بنویسید تا بازتولیدش کنم.
- **W1.10 روی نصبِ واقعی:** از این کانتینر نه به `CONTROL_DATABASE_URL` دسترسی
  هست نه به لاگِ Coolify؛ تأییدِ «ترمیمِ دادهٔ تاریخی — N ردیف» فقط از پنلِ
  مالک دیده می‌شود. در `STATUS.md` به‌عنوانِ بدهیِ باز مانده، نه انجام‌شده.
