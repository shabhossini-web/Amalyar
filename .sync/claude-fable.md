<!-- claim:begin -->
agent: claude-fable
status: active
branch: claude/quirky-volta-uyuznl
since: 2026-09-16
paths:
  - docs/plan/
  - docs/UX_WORKFLOW_AUDIT_2026-09-16.md
  - server/src/work/
  - server/src/app.module.ts
  - server/src/reminders/reminders-worker.service.ts
  - server/src/auth/access-registry.ts
  - server/src/config/verticals.ts
  - scripts/e2e/w2-1-work-layer.mjs
note: لِینِ ج — سندِ بازبینی + تابلوی کار لند می‌شود، بعد W2.1 (WorkItem/DomainEvent) روی claude/w2-1-work-layer
<!-- claim:end -->

> ردیف‌های زیر از تاریخچهٔ گیت پر شده‌اند تا فایل خالی نباشد.

## قراردادهایی که شکستم

- ۱۴۰۵/۰۶/۲۵ · **W2.1 قراردادِ تازه ساخت، نه شکست:** مدل‌های `WorkItem`/`DomainEvent` (تهِ schema)، feature `work` + مجوزهای `work.*` (تهِ رجیستری)، `work: 2` در هر سه پلنِ حوزه، و یک فراخوانیِ `processDomainEvents` در `sweepTenant`ِ worker. جزئیات در `docs/plan/CONTRACTS.md` §۱–۲.

## اخیراً لند شد

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
