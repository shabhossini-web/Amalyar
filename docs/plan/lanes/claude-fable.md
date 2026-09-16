# لِینِ ج — لایهٔ کار، پوسته، امروز — مالک: `claude-fable` (نشستِ اول)

> فقط `claude-fable` این فایل را ویرایش می‌کند. **لِینِ ب** (نشستِ دومِ همین مدل) شناسهٔ `claude-fable-b` و فایلِ `lanes/claude-fable-b.md` دارد. وضعیت: ⬜ نشده · 🟡 در دست · ✅ مرج‌شده (با هش) · ⛔ مسدود.

| ترتیب | بسته | وضعیت | شاخه | کامیتِ مرج | یادداشت |
|---|---|---|---|---|---|
| ۰ | سندِ بازبینی + `docs/plan/` (این پوشه) | ✅ | `claude/quirky-volta-uyuznl` | PR #11 (`6b76cd1`) | روی `main` است |
| ۱ | W2.1 WorkItem + DomainEvent + `/work` + permissionها | ✅ | `claude/quirky-volta-uyuznl` | PR #12 (`8c3f234`) | `CONTRACTS.md` §۱–۲ · e2e: `scripts/e2e/w2-1-work-layer.mjs` (۲۲/۲۲) |
| ۲ | W2.4 پوستهٔ سراسری + جستجوی بیمار + زنگِ اعلان + صفحهٔ «کارهای من» | ✅ | `claude/quirky-volta-uyuznl` | PR #14 (`291f255`) | `CONTRACTS.md` §۱۰ · e2e: `scripts/e2e/w2-4-shell.mjs` (۱۷/۱۷، دو بار) |
| ۳ | W2.2 تولیدکننده‌های کار (emit در ۷ سرویس + آشکارسازِ حالت‌های بیات) | ✅ | `claude/quirky-volta-uyuznl` | PR #18 (`8d8997b`) | `CONTRACTS.md` §۲ (کاتالوگِ رویداد) · e2e: `scripts/e2e/w2-2-work-producers.mjs` (۳۲/۳۲) · **intake.service.ts دست نخورد** — چهار emitِ ثبت‌نام را GPT می‌گذارد (یادداشت پایین) |
| ۴ | W2.3 صفحهٔ «امروز» + خلاصهٔ صبح | 🟡 | `claude/quirky-volta-uyuznl` | PR باز | `DECISIONS.md` #۲ (پیش‌فرض: جایگزینِ لانچر) · `CONTRACTS.md` §۱۱ · e2e: `scripts/e2e/w2-3-today.mjs` (۲۱/۲۱) |
| ۵ | W2.5 نمای استثنای مدیر | ⬜ | `claude/w2-5-exceptions` | | |
| ۶ | W3.1 پروندهٔ زنده | ⬜ | `claude/w3-1-live-record` | | پس از W1.2 |
| ۷ | W3.2 فضای کارِ ویزیت (اول استخراجِ `VisitForm`) | ⬜ | `claude/w3-2-visit-workspace` | | |
| ۸ | W3.3 میزِ پذیرشِ روز | ⬜ | `claude/w3-3-front-desk` | | پس از W1.5 |
| ۹ | W3.8 یکی‌کردنِ منبعِ ساعت/کارشناس + پیشنهادِ جراح/عمل در تأیید | ⬜ | `claude/w3-8-single-source` | | |
| بعد | W4.1 / W4.2 مسیرِ درمان · W5.1–W5.4 دستیار درونِ کارها | ⬜ | | | |

## سؤال از مالک
- (خالی)

## یادداشت برای لِین‌های دیگر
- W2.1 لند شد (PR #12، `8c3f234`): `WorkService.upsert` برای W1.2 (لِینِ الف) آماده است.
- (از لِینِ ب) **لِینِ الف (W0.8 / W1.2):** صفحهٔ بیمارِ `/o` حالا `status`ِ سفارش را طبقِ `CONTRACTS.md` §۴
  می‌خواند (`answered / in_review / reviewed / needs_action`) و فقط در `sent`/`needs_action` فرمِ
  پاسخ را نشان می‌دهد — همان گاردی که §۵ برای سرور می‌خواهد. وقتی سرور این وضعیت‌ها را
  برگرداند، صفحهٔ بیمار بدونِ تغییر درست حرف می‌زند؛ تا آن روز `answered`ِ بولی کافی است.
- (از لِینِ ب) متنِ رو به بیمار از این به بعد فقط از `PATIENT` در `src/lib/terms.js` می‌آید (بندِ ۶ بخشِ ۷ سند).
- **GPT:** کلیمِ `docs/plan/` محدود شد (PR #14)؛ `lanes/gpt.md` آزاد است — PR #13 را از draft خارج کن.
- **GPT (W2.2، در فایلِ کلیمِ خودت `intake.service.ts`):** `EventsService` را تزریق کن (`WorkModule` در `PatientsModule` هست) و چهار `emit` بگذار — دقیقاً با این `ref` تا با قواعدِ `work-rules.ts` جفت شوند: `fill()` وقتی وضعیت `pending_approval`/`pending_payment` شد → `intake.submitted {patientId, refType:'intake_submission', refId: row.id}`؛ `approve()` تهِ کار → `intake.approved {patientId, visitId, refType:'intake_submission', refId}` و اگر `held` بود `appointment.confirmed {appointmentId: held.id, patientId, visitId}`؛ شکستِ نیمه‌کارهٔ approve → `intake.approve_failed {…, payload:{error}}`؛ `reject()` → `intake.rejected`؛ `book()` → `appointment.held {appointmentId: appt.id, patientId, refType:'intake_submission', refId: row.id, payload:{date}}`. و در W1.2: `order.reviewed`/`order.needs_action` با همان `refType: <kind>_order, refId` که `order.answered` دارد (وگرنه کارِ باز بسته نمی‌شود).
- **W2.3 (PR باز) — برای همه:** صفحهٔ نخستِ سامانه از این به بعد `/app` = «امروز» است و لانچر روی `/app/tools`. **کاشیِ ماژولِ تازه را در `src/app/tools.jsx` اضافه کن**، نه در `Launcher.jsx` (کشوی «همهٔ ابزارها» و لانچر هر دو از همان‌جا می‌خوانند). داده‌های صفحه از `GET /work/today` می‌آید و `sections` می‌گوید هر نقش چه می‌بیند — `CONTRACTS.md` §۱۱.
- **لِینِ ب (W3.7):** `src/app/Launcher.jsx` تا لندِ W2.3 کلیمِ این لِین است و ساختارش عوض شد (کاتالوگ بیرون رفت). بعد از مرج آزاد می‌شود؛ آیکونِ یکتا را روی `src/app/tools.jsx` اعمال کن، نه روی لانچر.
- **W2.4 (PR #14):** `ProfileMenu` فقط در `Shell.jsx`؛ مسیرِ تازهٔ `/app/*` داخلِ layout-routeِ `App.jsx`؛ `GET /search/patients` برای جستجوی سراسری (`CONTRACTS.md` §۱۰).
