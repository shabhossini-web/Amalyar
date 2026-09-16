# لِینِ الف — صحتِ بک‌اند — مالک: `gpt`

> فقط `gpt` این فایل را ویرایش می‌کند. وضعیت: ⬜ نشده · 🟡 در دست · ✅ مرج‌شده (با هش) · ⛔ مسدود (با دلیل).
> جزئیاتِ هر بسته: `docs/UX_WORKFLOW_AUDIT_2026-09-16.md` بخش ۵. قراردادها: `../CONTRACTS.md`.

| ترتیب | بسته | وضعیت | شاخه | کامیتِ مرج | یادداشت |
|---|---|---|---|---|---|
| ۱ | W1.6 اسنپ‌شاتِ فرم + حذفِ نرمِ فیلد + `formUsage` با submission + منعِ حذفِ فرمِ پاسخ‌دار | ⬜ | `agent/w1-6-form-snapshot` | | N1 — اول از همه |
| ۲ | W1.5 `Appointment.forVisitId` + `startVisit` تراکنشی/قفل‌دار + نوعِ درست | ⬜ | `agent/w1-5-appointment-visit-link` | | D05, N2, N3 |
| ۳ | W1.4 `approve()` در یک تراکنش + idempotencyKey + پیامک پس از commit + نمای نیمه‌کاره‌ها | ⬜ | `agent/w1-4-approve-atomic` | | D04 |
| ۴ | W1.1 `unfollowed` با `followUpVisitId/followUpDay/reviewedAt`، per-موعد، اعلامِ سقف | ⬜ | `agent/w1-1-unfollowed-match` | | D01 |
| ۵ | W1.7 گیتِ `done` برای `post_op_care/follow_up` + بازتنظیم با تاریخچه | ⬜ | `agent/w1-7-postop-gate` | | D07 · `DECISIONS.md` #۱ |
| ۶ | W1.3 مسیرِ مشترکِ تصویب با `syncLinkDocuments` و attachِ عکس | ⬜ | `agent/w1-3-approve-path` | | D03a |
| ۷ | W1.8 `POST …/draft` (سرور) — نیمهٔ UI با لِینِ ب | ⬜ | `agent/w1-8-intake-draft` | | D09 · `CONTRACTS.md` §۶ |
| ۸ | W1.9 `dedupeKey` همهٔ kindها + retry/backoff + پیامکِ per-tenant | ⬜ | `agent/w1-9-reminder-idempotency` | | N4, A3 · `DECISIONS.md` #۴ |
| ۹ | W0.3 dedupeِ «پیش‌رو» در `portal.service.ts` (سرور) | ⬜ | `agent/w0-3-portal-dedupe` | | لینکی‌کردنِ متن با لِینِ ب |
| ۱۰ | W0.4 رندرِ پاسخِ فرم‌های زیرپرونده با `answersOf.show()` (سرور + خواندن در `PatientRecord.jsx` فقط همان تابع) | ⬜ | `agent/w0-4-answer-render` | | D03b |
| ۱۱ | W0.8 گاردِ وضعیتِ `publicAnswer` + endpointِ آپلودِ فایلِ پاسخ | ⬜ | `agent/w0-8-order-answer-guard` | | `CONTRACTS.md` §۴–۵ |
| ۱۲ | W1.10 اسکریپتِ کشفِ دادهٔ ناقص + صفِ تطبیق | ⬜ | `agent/w1-10-repair-scan` | | |
| ۱۳ | W1.2 پاسخِ سفارش ← Document + وضعیتِ بررسی + کارِ «بررسیِ نتیجه» | ⬜ | `agent/w1-2-order-review` | | **پس از W2.1** · `CONTRACTS.md` §۱, §۴ |

## سؤال از مالک
- (خالی)

## یادداشت برای لِین‌های دیگر
- (خالی)
