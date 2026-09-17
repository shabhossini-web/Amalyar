# لِینِ الف — صحتِ بک‌اند — مالک: `gpt`

> فقط `gpt` این فایل را ویرایش می‌کند. وضعیت: ⬜ نشده · 🟡 در دست · ✅ مرج‌شده (با هش) · ⛔ مسدود (با دلیل).
> جزئیاتِ هر بسته: `docs/UX_WORKFLOW_AUDIT_2026-09-16.md` بخش ۵. قراردادها: `../CONTRACTS.md`.

| ترتیب | بسته | وضعیت | شاخه | کامیتِ مرج | یادداشت |
|---|---|---|---|---|---|
| ۱ | W1.6 اسنپ‌شاتِ فرم + حذفِ نرمِ فیلد + `formUsage` با submission + منعِ حذفِ فرمِ پاسخ‌دار | ✅ | `agent/w1-6-form-snapshot` | ccaa792 | PR #13؛ security-ci و ۲۴ سناریو سبز |
| ۲ | W1.5 `Appointment.forVisitId` + `startVisit` تراکنشی/قفل‌دار + نوعِ درست | ✅ | `agent/w1-5-appointment-visit-link` | 508cb4b | PR #26؛ security-ci، ۲۶ سناریو و ۱۷ رگرسیون سبز |
| ۳ | W1.4 `approve()` در یک تراکنش + idempotencyKey + پیامک پس از commit + نمای نیمه‌کاره‌ها | ⬜ | `agent/w1-4-approve-atomic` | | D04 |
| ۴ | W1.1 `unfollowed` با `followUpVisitId/followUpDay/reviewedAt`، per-موعد، اعلامِ سقف | ⬜ | `agent/w1-1-unfollowed-match` | | D01 |
| ۵ | W1.7 دو قالب مراقبت برای done/pending و منع مراقبت cancelled + بازتنظیم با تاریخچه | ⬜ | `agent/w1-7-postop-gate` | | D07 · `DECISIONS.md` #۱ |
| ۶ | W1.3 مسیرِ مشترکِ تصویب با `syncLinkDocuments` و attachِ عکس | ⬜ | `agent/w1-3-approve-path` | | D03a |
| ۷ | W1.8 `POST …/draft` (سرور) — نیمهٔ UI با لِینِ ب | ⬜ | `agent/w1-8-intake-draft` | | D09 · `CONTRACTS.md` §۶ |
| ۸ | W1.9 `dedupeKey` همهٔ kindها + retry/backoff + پیامکِ per-tenant | ⬜ | `agent/w1-9-reminder-idempotency` | | N4, A3 · `DECISIONS.md` #۴ |
| ۹ | W0.3 dedupeِ «پیش‌رو» در `portal.service.ts` (سرور) | ⬜ | `agent/w0-3-portal-dedupe` | | لینکی‌کردنِ متن با لِینِ ب |
| ۱۰ | W0.4 رندرِ پاسخِ فرم‌های زیرپرونده با `answersOf.show()` (سرور + خواندن در `PatientRecord.jsx` فقط همان تابع) | ⬜ | `agent/w0-4-answer-render` | | D03b |
| ۱۱ | W0.8 گاردِ وضعیتِ `publicAnswer` + endpointِ آپلودِ فایلِ پاسخ | ⬜ | `agent/w0-8-order-answer-guard` | | `CONTRACTS.md` §۴–۵ |
| ۱۲ | W1.10 اسکریپتِ کشفِ دادهٔ ناقص + صفِ تطبیق | ⬜ | `agent/w1-10-repair-scan` | | |
| ۰ (اولویت جدید) | W1.2 پاسخِ سفارش ← Document + وضعیتِ بررسی + کارِ «بررسیِ نتیجه» | 🟡 | `agent/w1-2-order-review` | | **پس از W2.1** · `CONTRACTS.md` §۱, §۴ |

## سؤال از مالک
- (خالی)

## یادداشت برای لِین‌های دیگر
- W1.6: `submissions` به خروجی حذف فرم افزوده شده؛ `used` مجموع مراجعه/لینک/پاسخ (شامل extraFormIds) است. متن FormBuilder باید «استفادهٔ ثبت‌شده» بگوید، نه فقط «مراجعه». هیچ UI در این بسته ویرایش نشده.
- W2.2: `appointment.held` در W1.5 مرج شد؛ پنج emitِ `intake.submitted/approved/rejected/approve_failed` و `appointment.confirmed` در تکمیل W2.2-ب پیاده و آزموده شد. refها دقیقاً مطابق CONTRACTS §۲ هستند. `order.reviewed/needs_action` همچنان در W1.2 است.
- برای لِین ج: شرط `halfWhere` در `today.service.ts` پاسخ سالمِ فرمِ `scope=record` را هم تأیید نیمه‌کاره می‌شمارد؛ این فرم عمداً visitId ندارد. لطفاً فرم‌های زیرپرونده را از این استثنا کنار بگذارید. W1.4 مسیر مراجعه‌ساز را اتمیک می‌کند.

- W1.5 برای لِین ج: خروجی day/suggest/walkIn اکنون forVisitId دارد. شروع پیگیری همان شناسهٔ فرزند را با made:false می‌دهد؛ مصرف‌کننده نباید از made:false نتیجه بگیرد که نوبت شروع نشده. مرحلهٔ بالینی و پاسخ‌ها حفظ می‌شوند.

- تحویل W1.4: approve فعلی هنوز held.forVisitId را مصرف نمی‌کند و createVisit می‌زند؛ در اتمیک‌سازی، مراجعهٔ هدف باید با دادهٔ پاسخ به‌روز شود تا مسیر «رزرو بیمار ← تأیید» هم مراجعهٔ دوم نسازد. این باگ در مسیر startVisit بسته شده، ولی approve هنوز بستهٔ بعد است.

## تکمیل تولیدکننده‌های W2.2 — درخواست مستقیم مالک
- ✅ `agent/w2-2b-intake-events` · PR #29 · `6edbce1`: پنج emit باقی‌مانده مرج شد؛ تأیید خودکار هم approved می‌فرستد و رد ثبت‌نام cancelled نوبت را صادر می‌کند. ۱۸ سناریوی ref/outbox/processor + ۱۷ رگرسیون مالی + ۱۶ گردش‌کار سبز. W1.4 هنوز اتمیک‌سازی کامل approve و مصرف held.forVisitId را انجام می‌دهد.

- تحویل به لِین ج (2026-09-17): PR #28 هنگام این بررسی mergeable_state=dirty داشت؛ لطفاً پیش از ادامه روی main تازه rebase شود. هیچ تغییری در شاخه یا فایل کلیم لِین ج نداده‌ام.

## اولویت و تصمیم‌های جدید مالک — 2026-09-17
- W1.2 پیش از W1.4؛ W3.1 لند شده و وضعیت‌های in_review/needs_action باز هستند.
- پس از W3.3: بسته دلیل لغو مراجعه و نوبت؛ دلیل عمومی از فهرست بسته + یادداشت صرفاً داخلی؛ فقط پیام لغو تازه، ابطال یادآوری syncAppointment موجود است.
- W1.7 مطابق تصمیم ۱ دوشاخه است، confirm_surgery_done حفظ می‌شود. بله سپس تلگرام، با multipart روی relay از روز اول.
- استثنای scope=record در halfWhere توسط لِین ج بسته و پذیرفته شده است.
