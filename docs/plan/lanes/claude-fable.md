# لِینِ ج — لایهٔ کار، پوسته، امروز — مالک: `claude-fable` (نشستِ اول)

> فقط `claude-fable` این فایل را ویرایش می‌کند. **لِینِ ب** (نشستِ دومِ همین مدل) شناسهٔ `claude-fable-b` و فایلِ `lanes/claude-fable-b.md` دارد. وضعیت: ⬜ نشده · 🟡 در دست · ✅ مرج‌شده (با هش) · ⛔ مسدود.

| ترتیب | بسته | وضعیت | شاخه | کامیتِ مرج | یادداشت |
|---|---|---|---|---|---|
| ۰ | سندِ بازبینی + `docs/plan/` (این پوشه) | ✅ | `claude/quirky-volta-uyuznl` | PR #11 (`6b76cd1`) | روی `main` است |
| ۱ | W2.1 WorkItem + DomainEvent + `/work` + permissionها | ✅ | `claude/quirky-volta-uyuznl` | PR #12 (`8c3f234`) | `CONTRACTS.md` §۱–۲ · e2e: `scripts/e2e/w2-1-work-layer.mjs` (۲۲/۲۲) |
| ۲ | W2.4 پوستهٔ سراسری + جستجوی بیمار + زنگِ اعلان + صفحهٔ «کارهای من» | ✅ | `claude/quirky-volta-uyuznl` | PR #14 (`291f255`) | `CONTRACTS.md` §۱۰ · e2e: `scripts/e2e/w2-4-shell.mjs` (۱۷/۱۷، دو بار) |
| ۳ | W2.2 تولیدکننده‌های کار (emit در ۷ سرویس + آشکارسازِ حالت‌های بیات) | ✅ | `claude/quirky-volta-uyuznl` | PR #18 (`8d8997b`) | `CONTRACTS.md` §۲ (کاتالوگِ رویداد) · e2e: `scripts/e2e/w2-2-work-producers.mjs` (۳۲/۳۲) · **intake.service.ts دست نخورد** — چهار emitِ ثبت‌نام را GPT می‌گذارد (یادداشت پایین) |
| ۴ | W2.3 صفحهٔ «امروز» + خلاصهٔ صبح | ✅ | `claude/quirky-volta-uyuznl` | PR #21 (`aec89c3`) | `DECISIONS.md` #۲ (پیش‌فرض: جایگزینِ لانچر) · `CONTRACTS.md` §۱۱ · e2e: `scripts/e2e/w2-3-today.mjs` (۲۱/۲۱) |
| ۵ | W2.5 نمای استثنای مدیر | ✅ | `claude/quirky-volta-uyuznl` | PR #22 (`f8da7bd`) | `CONTRACTS.md` §۱۱ · e2e: `scripts/e2e/w2-5-exceptions.mjs` (۱۷/۱۷) |
| ۶ | W3.1 پروندهٔ زنده | ✅ | `claude/quirky-volta-uyuznl` | PR #33 (`f09ce54`) | `GET /patients/:id/live` · `CONTRACTS.md` §۱۲ · e2e: `scripts/e2e/w3-1-live-record.mjs` (۴۸/۴۸) · جفت‌شدنِ داده‌محور با W1.2 (وضعیت‌های `in_review`/`needs_action` از حالا «باز» شمرده می‌شوند، پس وقتی آن بسته آمد این فایل بازنویسی نمی‌خواهد) |
| ۷ | W3.2 گامِ ۱: استخراجِ `VisitForm` | ✅ | `claude/quirky-volta-uyuznl` | PR #23 (`4044c85`) | `Dashboard.jsx` ۲۴۳۶ → ۱۱۱۲ خط (معیارِ سند: <۱۲۰۰) |
| ۷ب | W3.2 گامِ ۲: کارتِ آماده‌سازیِ ویزیت (§۴.۴ «پیش از ویزیت») | ✅ | `claude/quirky-volta-uyuznl` | PR #28 (`c62b7f4`) | `GET /visits/:id/prep` · e2e: `scripts/e2e/w3-2-prep-card.mjs` (۱۸/۱۸) |
| ۷ج | W3.2 گامِ ۳: مراجعهٔ پیش‌نویس (سفارش پیش از ذخیره) | ⬜ | | | معیارِ پذیرشِ باقی‌ماندهٔ سند. نیاز به تصمیم: سفارشِ بی‌مراجعه روی پرونده بنشیند و هنگامِ ذخیره وصل شود (`PATCH` سفارش الان `visitId` را نمی‌پذیرد) |
| ۸ | W3.3 میزِ پذیرشِ روز | ✅ | `claude/quirky-volta-uyuznl` | PR #40 (`970b040`) | تختهٔ پنج‌ستونی + فیچرِ `frontdesk` سطحِ منشی · e2e ۲۸/۲۸ |
| ۸ب | دلیلِ لغو (تصمیمِ مالک ۱۴۰۵/۰۶/۲۶) | ✅ | `claude/quirky-volta-uyuznl` | PR #43 (`63128c0`) | فهرستِ بسته + یادداشتِ داخلی، هر دو نوعِ لغو · e2e ۶۱/۶۱ |
| ۹ | W3.8 یکی‌کردنِ منبعِ ساعت/کارشناس + پیشنهادِ جراح/عمل در تأیید | ✅ | `claude/quirky-volta-uyuznl` | PR #45 (`c19c281`) | `syncVisitDuty()` تنها نویسندهٔ ساعتِ حضور · `intake-match.ts` برای جراح/عمل · e2e ۴۱/۴۱ |
| ۱۰ | **W4.1** مسیرِ درمان — `Episode` + `PathwayTemplate` نسخه‌دار + چهار الگوی آماده | ✅ | `claude/quirky-volta-uyuznl` | PR #47 | `server/src/pathway/` · نمونه گام‌ها را کپی می‌کند پس نسخهٔ تازه سابقه را بازنویسی نمی‌کند · e2e ۵۶/۵۶ |
| ۱۱ | **W4.2 گامِ ۱** اطلاع‌رسانیِ گام + «عدمِ پاسخ» + آزمونِ الگو با بیمارِ ساختگی | ✅ | `claude/quirky-volta-uyuznl` | PR #50 (`36433c8`) | `notify` از دفترِ موجودِ یادآوری می‌رود · `POST /pathway/preview` چیزی نمی‌نویسد · e2e ۲۹/۲۹ |
| ۱۱ب | **W4.2 گامِ ۲** ویزاردِ ۶ مرحله‌ای + `/app/pathways` + کاشیِ لانچر + کارِ پیگیری از `escalateDays` | ✅ | `claude/quirky-volta-uyuznl` | | `CONTRACTS.md` §۱۳ «ویزارد و عدمِ پاسخ» · آزمون مرحلهٔ **پیش از** اعمال است نه دکمهٔ کناری · e2e ویزارد + دو سنجهٔ تازه (کلیدِ تکراری، کارِ بی‌راهِ خروج) · ⚠️ همین بسته ۷ فراخوانیِ لغو در ۶ سوئیتِ لِین‌های دیگر را هم درست کرد (بدهیِ بستهٔ «دلیلِ لغو») · 🔴 `follow-up` سه قرمزِ **پیشین** دارد (توکنِ موجِ پیگیری) — اثبات در `.sync` |
| ۱۲ | **CI برای همهٔ سوییت‌ها** — جابِ `live` (Postgresِ سرویس + `bootstrap-env` + رانرِ `run-live.mjs`، ۴ شارد) + ۱۴ سوییتِ خودکفا گامِ مستقیم | ✅ | `claude/quirky-volta-uyuznl` | PR #66 (`7a2f2c8`) · ران ۵۲۶ همه سبز | `scripts/e2e/ci-live.txt` فهرستِ سوییت‌های زنده · seedهای تنبل پیش از دستهٔ اول گرم می‌شوند · سطلِ ورود با بالاآوردنِ دوبارهٔ سرور دور زده می‌شود · ۱۰ سوییتِ بیات با محصول هم‌گام شدند (لانچر → `/app/tools`، JSONِ کمینهٔ دستیار، …) · قرمزهای باقی‌مانده در `STATUS.md` با دلیل |
| ۱۳ | **حفرهٔ W1.9** — لغوِ سیستمی کلیدِ یادآوری را آزاد می‌کند + پنج سوییت به `ci-live.txt` برگشتند (به نیابت از لِینِ الف — دستورِ مالک: «تا هفتهٔ بعد نداریمش، خودت انجام بده») | ✅ | `claude/quirky-volta-uyuznl` | PR #70 (`26f39b6`) · ران ۵۲۹ همه سبز | هرسِ `reminders.service.ts` و خاموشیِ `next_visit` در `appointments.service.ts` → `dedupeKey: null`؛ لغوِ دستیِ W0.7 کلید را نگه می‌دارد · `CONTRACTS.md` §۸ · دو سنجهٔ بیات با محصول هم‌گام شد (`postop-visit` §۳ متنِ چندخطی، `summary-reminders` §۴ stub → `simulated`) · manifest ۹۷ → ۱۰۲ · مسابقهٔ بارگذاریِ بی‌کوکی (۴۰۱ در کنسول) در `link-builder`/`forms-boxes`/`forms-builder` هم بسته شد (ران ۵۲۸ لو داد) |
| ۱۴ | **بازخوردِ مالک ۱۴۰۵/۰۶/۲۹ (۱۲ بند)** — بستهٔ ۱: شیتِ سفارش با پاسخِ بیمار + دکمهٔ بررسی، خلاصهٔ AI شمسی، کدِ ملیِ آزمایشی | 🟡 | `claude/quirky-volta-uyuznl` | PR باز | بسته‌های ۲–۵ در راه: پاپ‌آپ‌های پرونده و نامِ نوعِ مراجعه · صفحهٔ امروز (هشدارِ کلیک‌پذیر + عکسِ مشاوره) · تب‌های قبل/حین/بعدِ عمل · مدلِ مطب + پرتالِ جراح · e2e: `order-review-sheet` |
| بعد | W5.1–W5.4 دستیار درونِ کارها | ⬜ | | | |

## سؤال از مالک
- (خالی)

## یادداشت برای لِین‌های دیگر
- **W3.2 گامِ ۱ (PR باز):** فرمِ ثبت/ویرایشِ مراجعه از `Dashboard.jsx` به `src/app/VisitForm.jsx` رفت (بدونِ تغییرِ رفتار). واژگانِ نوعِ مراجعه حالا در `src/app/visit-kinds.js` (`KINDS` / `kindOf`) و `faDuration` در `src/lib/time.js` است — **هر دو تک‌منبع**؛ اگر جایی نوعِ تازه یا قالبِ مدت لازم شد، همان‌جا. `DefSelect` با فرم رفت چون فقط همان استفاده‌اش می‌کند.
- W2.1 لند شد (PR #12، `8c3f234`): `WorkService.upsert` برای W1.2 (لِینِ الف) آماده است.
- (از لِینِ ب) **لِینِ الف (W0.8 / W1.2):** صفحهٔ بیمارِ `/o` حالا `status`ِ سفارش را طبقِ `CONTRACTS.md` §۴
  می‌خواند (`answered / in_review / reviewed / needs_action`) و فقط در `sent`/`needs_action` فرمِ
  پاسخ را نشان می‌دهد — همان گاردی که §۵ برای سرور می‌خواهد. وقتی سرور این وضعیت‌ها را
  برگرداند، صفحهٔ بیمار بدونِ تغییر درست حرف می‌زند؛ تا آن روز `answered`ِ بولی کافی است.
- (از لِینِ ب) متنِ رو به بیمار از این به بعد فقط از `PATIENT` در `src/lib/terms.js` می‌آید (بندِ ۶ بخشِ ۷ سند).
- **GPT:** کلیمِ `docs/plan/` محدود شد (PR #14)؛ `lanes/gpt.md` آزاد است — PR #13 را از draft خارج کن.
- **GPT (W2.2، در فایلِ کلیمِ خودت `intake.service.ts`):** `EventsService` را تزریق کن (`WorkModule` در `PatientsModule` هست) و چهار `emit` بگذار — دقیقاً با این `ref` تا با قواعدِ `work-rules.ts` جفت شوند: `fill()` وقتی وضعیت `pending_approval`/`pending_payment` شد → `intake.submitted {patientId, refType:'intake_submission', refId: row.id}`؛ `approve()` تهِ کار → `intake.approved {patientId, visitId, refType:'intake_submission', refId}` و اگر `held` بود `appointment.confirmed {appointmentId: held.id, patientId, visitId}`؛ شکستِ نیمه‌کارهٔ approve → `intake.approve_failed {…, payload:{error}}`؛ `reject()` → `intake.rejected`؛ `book()` → `appointment.held {appointmentId: appt.id, patientId, refType:'intake_submission', refId: row.id, payload:{date}}`. و در W1.2: `order.reviewed`/`order.needs_action` با همان `refType: <kind>_order, refId` که `order.answered` دارد (وگرنه کارِ باز بسته نمی‌شود).
- **W2.3 (PR باز) — برای همه:** صفحهٔ نخستِ سامانه از این به بعد `/app` = «امروز» است و لانچر روی `/app/tools`. **کاشیِ ماژولِ تازه را در `src/app/tools.jsx` اضافه کن**، نه در `Launcher.jsx` (کشوی «همهٔ ابزارها» و لانچر هر دو از همان‌جا می‌خوانند). داده‌های صفحه از `GET /work/today` می‌آید و `sections` می‌گوید هر نقش چه می‌بیند — `CONTRACTS.md` §۱۱.
- **لِینِ ب (W3.7) — آزاد شد:** `src/app/Launcher.jsx` و `src/ui/icons.jsx` از کلیمِ لِینِ ج درآمدند (W2.3 لند شد، `aec89c3`). ساختارِ لانچر عوض شده: کاتالوگ بیرون رفته، پس **آیکونِ یکتا را روی `src/app/tools.jsx` اعمال کن**. نگهبانِ CI هم جلوی برگشتنِ کاتالوگ به لانچر را می‌گیرد.
- **W2.4 (PR #14):** `ProfileMenu` فقط در `Shell.jsx`؛ مسیرِ تازهٔ `/app/*` داخلِ layout-routeِ `App.jsx`؛ `GET /search/patients` برای جستجوی سراسری (`CONTRACTS.md` §۱۰).
