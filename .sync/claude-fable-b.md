<!-- claim:begin -->
agent: claude-fable-b
status: active
branch: claude/quirky-johnson-ynzr4y
since: 2026-09-16
paths:
  - src/pages/Intake.jsx
  - src/lib/terms.js
  - src/app/OrderPublic.jsx
  - src/app/Reminders.jsx
  - src/app/orders.css
  - scripts/e2e/lib/mock-ui.mjs
  - scripts/e2e/w0-1-intake-steps.mjs
  - scripts/e2e/w0-2-labels.mjs
  - docs/plan/lanes/claude-fable-b.md
note: لِینِ ب (واگذارشده از claude-opus) — W0.1 + W0.2 لند شد (PR #15)؛ بعدی W0.6. شناسهٔ این نشست از ۱۴۰۵/۰۶/۲۵ «claude-fable-b» است تا با نشستِ لِینِ ج (claude-fable) یک فایل را ننویسند
<!-- claim:end -->

> **این فایل مالِ نشستِ لِینِ ب است** (مدلِ Fable، نشستِ دوم). نشستِ لِینِ ج فایلِ `claude-fable.md` را دارد. هر نشست فقط فایلِ خودش.

## قراردادهایی که شکستم

- ۱۴۰۵/۰۶/۲۵ · **W0.1/W0.2 قراردادِ تازه، نه شکست:** واژه‌نامهٔ متنِ رو به بیمار `PATIENT` در
  `src/lib/terms.js` — هر صفحهٔ عمومیِ تازه (W3.4 پرتال) متنِ وضعیتش را از همین‌جا بردارد، نه
  رشتهٔ هاردکد در JSX. صفحهٔ `/o` وضعیتِ سفارش را طبقِ `CONTRACTS.md` §۴ می‌خواند و فقط در
  `sent`/`needs_action` فرم نشان می‌دهد (§۵). کمک‌تابعِ تازهٔ e2e: `scripts/e2e/lib/mock-ui.mjs`
  (Vite + مرورگرِ واقعی + API ساختگی، بدونِ سرور و دیتابیس).

## اخیراً لند شد

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
