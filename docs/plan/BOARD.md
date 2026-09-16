# تابلوی کار — سه لِین، چهل بسته

منبعِ جزئیاتِ هر بسته (فایل‌ها، معیارِ پذیرش، اندازه): `docs/UX_WORKFLOW_AUDIT_2026-09-16.md` بخش ۵.
**وضعیتِ زنده** در `lanes/<agent>.md` است، نه این‌جا. این فایل فقط **تقسیم و ترتیب** را می‌گوید.

## لِین‌ها و مالکِ هرکدام

| لِین | ایجنت | مسیرهایی که می‌نویسد | چرا این تقسیم |
|---|---|---|---|
| **الف — صحتِ بک‌اند** | `gpt` | `server/src/patients/{intake,orders,appointments,patients,forms,record,reminders,portal}.service.ts` · `server/src/reminders/` · `server/src/sms/` · `server/src/scripts/` · `server/src/config/settings-registry.ts` · `schema.prisma` (ته فایل) · `scripts/e2e/` (فایل‌های خودش) | یافته‌ها با `file:line` مشخص‌اند و e2e‌پذیرند؛ به رابط دست نمی‌زند، پس با دو لِینِ دیگر برخورد ندارد |
| **ب — سطوحِ بیمار و اصلاح‌های سریعِ UI** | `claude-fable` (واگذارشده از `claude-opus`، ۱۴۰۵/۰۶/۲۵ — وضعیت در `lanes/claude-fable.md`) | `src/pages/` · `src/app/{OrderPublic,Reminders,FormBuilder,Launcher}.jsx` · `src/ui/` · `src/index.css` · `src/lib/terms.js` · `src/app/*.css` مربوطه | فرانتِ عمومی و کامپوننت‌های مشترک؛ به `Dashboard.jsx`/`PatientRecord.jsx` دست نمی‌زند |
| **ج — لایهٔ کار، پوسته، امروز** | `claude-fable` | `server/src/work/` · `src/app/{Shell,Today,FrontDesk,PatientRecord,VisitWorkspace}.jsx` · `Dashboard.jsx` (فقط استخراجِ `VisitForm`) · `App.jsx` · `docs/plan/CONTRACTS.md` | قراردادِ WorkItem را همین لِین طراحی کرده و باید یک‌دست بماند |

## ترتیبِ بسته‌ها در هر لِین

### الف (`gpt`) — به همین ترتیب
| ترتیب | بسته | وابستگی | نکته |
|---|---|---|---|
| ۱ | **W1.6** اسنپ‌شاتِ فرم + حذفِ نرم + `formUsage` + منعِ حذفِ فرمِ پاسخ‌دار | — | **اول از همه**: تنها بسته‌ای که دادهٔ موجود را تهدید می‌کند (N1) |
| ۲ | **W1.5** `Appointment.forVisitId` + قفلِ `startVisit` + نوعِ درست | `CONTRACTS.md` §۳ | D05, N2, N3 |
| ۳ | **W1.4** `approve()` تراکنشی + idempotency + پیامک پس از commit | — | D04 |
| ۴ | **W1.1** تطبیقِ پیگیری با `followUpVisitId/Day` + گزارش per-موعد | — | D01 |
| ۵ | **W1.7** گیتِ `done` برای `post_op_care/follow_up` | `DECISIONS.md` #۱ | D07 |
| ۶ | **W1.3** مسیرِ مشترکِ تصویب (خودکار/دستی) با `syncLinkDocuments` | — | D03a |
| ۷ | **W1.8** endpointِ `draft` + ادامه از آخرین صفحه | `CONTRACTS.md` §۶ | D09؛ نیمهٔ UI با لِینِ ب هماهنگ (فقط `src/pages/Intake.jsx`) |
| ۸ | **W1.9** `dedupeKey` همهٔ kindها + retry/backoff + پیامکِ per-tenant | `DECISIONS.md` #۴ | N4, A3 |
| ۹ | **W0.3 / W0.4 / W0.8** لینکی‌کردن + dedupeِ پرتال · رندرِ پاسخ با `answersOf.show()` · گاردِ `publicAnswer` | — | سه بستهٔ کوچک، هر وقت بینِ دو بستهٔ بزرگ جا شد |
| ۱۰ | **W1.10** اسکریپتِ کشفِ دادهٔ ناقص + صفِ تطبیق | همهٔ بالا | |
| ۱۱ | **W1.2** پاسخِ سفارش ← Document + وضعیتِ بررسی + کارِ «بررسیِ نتیجه» | **W2.1 لند شده باشد** (`WorkService.upsert`) | تا W2.1 نیامده: Document و وضعیتِ سفارش را بساز و جای ساختِ کار `// W2.1: emit review_result` بگذار |

### ب (`claude-fable` — واگذارشده از `claude-opus`، ۱۴۰۵/۰۶/۲۵)
| ترتیب | بسته | وابستگی |
|---|---|---|
| ۱ | **W0.1** استپر از `makesVisit/payable` | — |
| ۲ | **W0.2** برچسبِ `follow_up` + پیامِ پایانِ سفارش | — |
| ۳ | **W0.5** آپلودِ فایل در `/o` + اندازهٔ دکمه | W0.8 (گاردِ API) — یا هم‌زمان با هماهنگی |
| ۴ | **W0.6** Escape / focus-trap / کلیدهای جهت | — |
| ۵ | **W0.7** اقدامِ per-row یادآوری (UI) | W1.9 برای retry سرور |
| ۶ | **W3.7** آیکونِ یکتا + نام‌گذاری + واژه‌نامه | — |
| ۷ | **W3.6** تمِ روشنِ بالینی | `DECISIONS.md` #۳ |
| ۸ | **W3.5** فرم‌ساز | — |
| ۹ | **W3.4** لینکِ واحدِ بیمار | W1.8, W0.3, `DECISIONS.md` #۵ |
| بعد | **W4.3** ویزاردِ راه‌اندازی · **W4.4** KPI | W2.1 (DomainEvent) |

### ج (`claude-fable`)
| ترتیب | بسته | وابستگی |
|---|---|---|
| ۱ | **W2.1** WorkItem + DomainEvent + `/work` | `CONTRACTS.md` §۱–۲ (همین لِین می‌نویسد) |
| ۲ | **W2.4** پوستهٔ سراسری + جستجو + زنگ | W2.1 |
| ۳ | **W2.2** تولیدکننده‌های کار | W2.1؛ برای رویدادهای لِینِ الف فقط `emit` اضافه می‌کند (یک خط در هر سرویس، با اعلام در `.sync`) |
| ۴ | **W2.3** صفحهٔ «امروز» | W2.1, W2.4, `DECISIONS.md` #۲ |
| ۵ | **W2.5** نمای استثنا | W2.2 |
| ۶ | **W3.1** پروندهٔ زنده | W2.1, W1.2 |
| ۷ | **W3.2** فضای کارِ ویزیت (اول استخراجِ `VisitForm`) | W2.1 |
| ۸ | **W3.3** میزِ پذیرشِ روز | W1.5, W2.1 |
| ۹ | **W3.8** یکی‌کردنِ منبعِ ساعت/کارشناس + پیشنهادِ خودکارِ جراح/عمل | W1.x |
| بعد | **W4.1 / W4.2** مسیرِ درمان · **W5.x** دستیار درونِ کارها | W2, W3 |

## قواعدِ برخورد

- دو لِین هم‌زمان یک فایل را نمی‌نویسند. استثناهای شناخته‌شده و راهِ حلشان:
  - `src/pages/Intake.jsx`: W0.1 (ب) و W1.8 (الف، نیمهٔ UI) — **الف فقط سرور را می‌نویسد** و در `.sync` خبر می‌دهد؛ ب نیمهٔ UI را می‌گیرد.
  - `orders.service.ts`: W0.8/W1.2 (الف) و W0.5 (ب، آپلود) — **ب فقط فرانت** (`OrderPublic.jsx`)؛ endpointِ آپلود را الف در W0.8 اضافه می‌کند (`CONTRACTS.md` §۵).
  - `schema.prisma`: همه فقط تهِ فایل؛ نامِ مدل‌ها از `CONTRACTS.md`.
- `scripts/verify-claims.js` در CI هم‌پوشانیِ کلیم‌ها را رد می‌کند؛ اگر قرمز شد، کلیمِ خودت را کوچک کن، نه فایلِ دیگری را.
