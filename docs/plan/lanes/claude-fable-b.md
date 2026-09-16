# لِینِ ب — سطوحِ بیمار و اصلاح‌های سریعِ UI — مالک: `claude-fable-b` (نشستِ دومِ Fable)

> فقط `claude-fable-b` این فایل را ویرایش می‌کند. وضعیت: ⬜ نشده · 🟡 در دست · ✅ مرج‌شده (با هش) · ⛔ مسدود.
> لِین در ۱۴۰۵/۰۶/۲۵ به دستورِ مالکِ محصول از `claude-opus` واگذار شد؛ چون نشستِ لِینِ ج هم مدلِ Fable است، این نشست شناسهٔ جدا دارد تا دو نشست یک فایلِ کلیم را ننویسند.

| ترتیب | بسته | وضعیت | شاخه | کامیتِ مرج | یادداشت |
|---|---|---|---|---|---|
| ۱ | W0.1 استپر و پیام‌ها از `makesVisit/payable` | ✅ | `claude/quirky-johnson-ynzr4y` | PR #15 (`afa824b`) | D10a, B4 · e2e: `scripts/e2e/w0-1-intake-steps.mjs` (۲۵/۲۵، دو بار؛ روی صفحهٔ قبلی ۸ قرمز) |
| ۲ | W0.2 برچسبِ `follow_up` + پیامِ پایانِ سفارش | ✅ | `claude/quirky-johnson-ynzr4y` | PR #15 (`afa824b`) | D10b, D10c · e2e: `scripts/e2e/w0-2-labels.mjs` (۲۲/۲۲، دو بار؛ روی صفحهٔ قبلی ۹ قرمز) · یک PR با W0.1 — هر دو متنِ بیمار را از یک واژه‌نامه (`PATIENT` در `terms.js`) می‌گیرند |
| ۳ | W0.5 آپلودِ فایل در `/o` + اندازهٔ دکمه (فرانت) | ⬜ | `claude/w0-5-order-upload-ui` | | endpoint از لِینِ الف (W0.8) |
| ۴ | W0.6 Escape / focus-trap / کلیدهای جهت در `src/ui/` | ⬜ | `claude/w0-6-a11y` | | |
| ۵ | W0.7 اقدامِ per-row یادآوری (فرانت) | ⬜ | `claude/w0-7-reminder-actions-ui` | | سرور از W1.9 |
| ۶ | W3.7 آیکونِ یکتا + نام‌گذاری + واژه‌نامه | ⬜ | `claude/w3-7-icons-naming` | | |
| ۷ | W3.6 تمِ روشنِ بالینی | ⬜ | `claude/w3-6-light-theme` | | `DECISIONS.md` #۳ |
| ۸ | W3.5 فرم‌ساز | ⬜ | `claude/w3-5-formbuilder` | | |
| ۹ | W3.4 لینکِ واحدِ بیمار + نیمهٔ UIِ draft (W1.8) | ⬜ | `claude/w3-4-patient-link` | | `DECISIONS.md` #۵ |
| بعد | W4.3 ویزاردِ راه‌اندازی · W4.4 KPI | ⬜ | | | پس از W2.1 |

## سؤال از مالک
- (خالی)

## یادداشت برای لِین‌های دیگر
- (به `lanes/claude-fable.md` و `.sync/claude-fable-b.md` منتقل شد)
