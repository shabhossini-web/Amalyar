# قراردادهای مشترک — شکلِ داده و APIهایی که بیش از یک لِین به آن دست می‌زند

> هر تغییر در این فایل باید در همان PRِ کد باشد + یک خط در `.sync/<شناسه>.md` زیرِ «قراردادهایی که شکستم».
> مصرف‌کننده‌ها با `git diff origin/main -- docs/plan/CONTRACTS.md` می‌فهمند. نام‌ها و کلیدها **دقیقاً** همین‌ها.
> سبکِ Prisma مثل بقیهٔ schema: `Int @id @default(autoincrement())`، ستون‌ها `@map("snake_case")`، جدول `@@map`.

## §۱ `WorkItem` — واحدِ کار (W2.1 می‌سازد؛ W1.2، W2.2، W3.x مصرف می‌کنند)

```prisma
model WorkItem {
  id             Int       @id @default(autoincrement())
  /// review_result · approve_intake · call_patient · confirm_appointment · confirm_surgery_done ·
  /// collect_payment · complete_report · confirm_usage · issue_invoice · resend_sms ·
  /// fill_form · upload_result · pick_slot · follow_up_unanswered
  type           String
  /// open · blocked · done · cancelled · expired
  state          String    @default("open")
  /// human · assistant_suggests · assistant_auto_approve · assistant_auto
  performer      String    @default("human")
  priority       Int       @default(0)
  dueAt          DateTime? @map("due_at")
  /// jobRole (doctor/secretary/nurse/assistant/technician/driver/courier) یا 'patient' یا 'system'
  ownerRole      String?   @map("owner_role")
  ownerAccountId Int?      @map("owner_account_id")
  patientId      Int?      @map("patient_id")
  visitId        Int?      @map("visit_id")
  appointmentId  Int?      @map("appointment_id")
  /// ارجاعِ آزاد: refType ∈ lab_order|imaging_order|consult_order|referral_order|intake_submission|invoice|reminder
  refType        String?   @map("ref_type")
  refId          Int?      @map("ref_id")
  title          String
  outcome        Json?
  blockedReason  String?   @map("blocked_reason")
  sourceEventId  Int?      @map("source_event_id")
  idempotencyKey String    @unique @map("idempotency_key")
  createdById    Int?      @map("created_by_id")
  completedById  Int?      @map("completed_by_id")
  completedAt    DateTime? @map("completed_at")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  @@index([state, ownerRole, dueAt])
  @@index([patientId])
  @@index([refType, refId])
  @@map("work_items")
}
```

- **`idempotencyKey` = `${type}:${refType}:${refId}`** (مثلاً `review_result:imaging_order:42`، `approve_intake:intake_submission:20`، `follow_up_unanswered:intake_submission:77`). وقتی رویداد دوباره رخ داد، همان کار **باز می‌ماند** نه اینکه دومی ساخته شود.
- ارجاعِ صریح اجباری است: دستِ‌کم یکی از `patientId/visitId/appointmentId/refId` پر باشد. **هرگز** تطبیقِ نام/تاریخ.
- سرویس (`server/src/work/work.service.ts`):
  - `upsert(input, tx?)` — idempotent روی `idempotencyKey`؛ اگر `done` بود و `reopen:true` نداده‌اند، دست نمی‌خورد.
  - `complete(id, actorId, outcome?)`, `block(id, reason)`, `assign(id, accountId)`, `snooze(id, until)`, `cancel(id, reason)` — هرکدام `AuditEvent` می‌نویسند (`work.complete` …).
  - `closeByRef(refType, refId, type?)` — وقتی منبع حل شد (مثلاً سفارش reviewed شد) کارِ بازش بسته می‌شود.
- HTTP (`server/src/work/work.controller.ts`):
  - `GET /work?scope=mine|role|patient|all&patientId=&state=&type=&due=today|overdue|week` — object-authz: زیرِ سوپروایزر فقط کارِ خودش/نقشش و بیمارانِ منتسبش.
  - `PATCH /work/:id` body `{action:'done'|'block'|'assign'|'snooze'|'cancel', outcome?, reason?, accountId?, until?}`.
  - `GET /work/counts` → `{mine, role, overdue}` برای زنگِ اعلان.
- دسترسی: Feature `work` (پیش‌فرض سطح ۲، در هر سه حوزه) + Permission `work.read` (۲)، `work.write` (۲)، `work.assign` (۴ — واگذاری به دیگران و `scope=all`)، `work.process` (۶ — اجرای دستیِ پردازشگر).
- **پیاده‌شده در W2.1** (`server/src/work/`): `GET /work?scope=inbox|mine|role|patient|all` (پیش‌فرض `inbox` = من ∪ صفِ نقشِ من؛ کارِ `ownerRole='patient'` در صفِ کارکنان نمی‌آید)، `GET /work/counts` → `{mine, role, overdue, total}`، `POST /work` (کارِ دستی؛ کلیدش یکتا به‌ازای هر ساخت)، `PATCH /work/:id` با `action ∈ done|block|assign|snooze|cancel|reopen`، `POST /work/process` (آزمون/عیب‌یابی). خروجیِ فهرست با `patient {id,code,fullName,phone}` و `overdue` سمتِ سرور enrich می‌شود.
- **قواعدِ رویداد ← کار** در `server/src/work/work-rules.ts` (خالص). W2.2 فقط `emit` را در سرویس‌ها می‌گذارد؛ قاعدهٔ تازه = یک ردیف در `RULES` + سنجه در e2e.

## §۲ `DomainEvent` — outbox (W2.1 می‌سازد؛ همه `emit` می‌کنند)

```prisma
model DomainEvent {
  id            Int       @id @default(autoincrement())
  /// order.answered · order.reviewed · intake.submitted · intake.approved · intake.approve_failed ·
  /// appointment.noshow · appointment.confirmed · visit.done · visit.postponed · sms.failed · sms.uncertain ·
  /// form.answered · report.missing · usage.unconfirmed · invoice.ready
  type          String
  patientId     Int?      @map("patient_id")
  visitId       Int?      @map("visit_id")
  appointmentId Int?      @map("appointment_id")
  refType       String?   @map("ref_type")
  refId         Int?      @map("ref_id")
  payload       Json?
  actorId       Int?      @map("actor_id")
  at            DateTime  @default(now())
  processedAt   DateTime? @map("processed_at")

  @@index([processedAt])
  @@index([type, at])
  @@map("domain_events")
}
```

- `EventsService.emit(event, tx)` — **داخلِ همان تراکنشِ** نوشتنِ اصلی. تا W2.1 لند نشده، لِینِ الف در نقطه‌های زیر فقط کامنتِ `// W2.1: emit <type>` می‌گذارد و W2.2 آن‌ها را به `emit` تبدیل می‌کند.
- **کاتالوگِ رویدادها و تولیدکننده‌ها (W2.2).** `ref` یعنی کلیدی که کارِ باز با آن بسته می‌شود؛ **رویدادِ بازکننده و بستنده باید همان `ref` را داشته باشند.**

| رویداد | کجا emit می‌شود | ref |
|---|---|---|
| `order.answered` | `orders.service.publicAnswer` | `refType = <kind>_order, refId` (lab/imaging/consult) |
| `order.reviewed` · `order.needs_action` | W1.2 (لِینِ الف) | همان `ref`ِ بالا |
| `form.answered` | `survey.service.submit` | `survey_invite:id` |
| `form.unanswered` | آشکارساز (۳ روز بی‌پاسخ، منقضی‌نشده) | `survey_invite:id` |
| `intake.submitted` · `intake.approved` · `intake.rejected` · `intake.approve_failed` | `intake.service` (لِینِ الف، W2.2-ب) | `intake_submission:id` |
| `appointment.held` | `intake.service.book` (لِینِ الف) | `appointmentId` |
| `appointment.confirmed/arrived/noshow/cancelled/done` | `appointments.service.setStatus` (هر گذار) + `intake.approve` (confirmed) | `appointmentId` |
| `appointment.started` | `appointments.service.startVisit` | `appointmentId` (+`visitId` تازه) |
| `visit.done` · `visit.cancelled` · `visit.pending` | `patients.service.setStatus` (فقط وقتی وضعیت عوض شود) | `visitId` |
| `visit.unconfirmed` · `report.missing` · `usage.unconfirmed` | آشکارساز (`work-detectors.ts`؛ فقط `surgery`، کفِ ۶۰ روز، هفته‌ای یک‌بار) — `payload.techId` کار را به نامِ کارشناس می‌کند | `visitId` |
| `report.uploaded` | `tech.service.uploadReport` + آشکارسازِ بستن (سندِ `report` از هر مسیر) | `visitId` |
| `usage.confirmed` | `inventory.service.recordUsage` (وقتی حواله مراجعه دارد) | `visitId` |
| `invoice.issued` | `invoices.service.issue` (داخلِ همان تراکنش) | `visitId` |
| `sms.sent` · `sms.failed` · `sms.uncertain` | `send-reminders.ts` (+ `orders.service.send` برای ارسالِ مستقیم) | `reminder:id` |

- آشکارساز در `POST /work/process` و در sweepِ worker **قبل از** پردازشگر اجرا می‌شود.
- پردازشگر `processDomainEvents(client)` (`work-processor.ts`) در همان sweepِ workerِ یادآوری‌ها اجرا می‌شود (کادنس = `REMINDERS_INTERVAL_MS`، پیش‌فرض ۵ دقیقه، کفِ ۶۰ ثانیه): رویدادهای `processedAt IS NULL` → `work-rules.ts` → `upsertWork`/`closeWork` → `processedAt`. رویداد پاک نمی‌شود (منبعِ analytics، W4.4). برای پاسخِ فوری، سرویسِ صادرکننده می‌تواند پس از commit خودش `WorkService.upsert` را هم صدا بزند؛ پردازشگر به‌خاطرِ idempotency دومی نمی‌سازد.

## §۳ `Appointment.forVisitId` — نوبتی که برای یک مراجعهٔ مشخص گرفته شده (W1.5 می‌سازد؛ W3.3، W3.4 مصرف می‌کنند)

```prisma
  /// مراجعهٔ هدف: وقتی نوبت از روی nextVisitDate یا از برنامهٔ مراقبت گرفته می‌شود، همان مراجعهٔ فرزند (followOfVisitId) این‌جاست.
  forVisit   Visit? @relation("AppointmentForVisit", fields: [forVisitId], references: [id], onDelete: SetNull)
  forVisitId Int?   @map("for_visit_id")
```
(روی `Visit` هم `appointmentsFor Appointment[] @relation("AppointmentForVisit")` — تهِ مدل.)

- `walkIn`/`book` وقتی `patientId + date` با `nextVisitDate` یک مراجعهٔ والد یکی است، فرزندِ `followOfVisitId` را پیدا و `forVisitId` را ست می‌کند.
- `startVisit`: اگر `visitId` هست → همان؛ وگرنه اگر `forVisitId` هست → **همان مراجعه** (`opDate` به امروز، `opStatus` دست‌نخورده) و `visitId = forVisitId`؛ وگرنه مراجعهٔ تازه با `kind` = `'clinic'` اگر وجود دارد، وگرنه اولین kindِ غیرِ `surgery`. کلِ مسیر در یک `$transaction` با `SELECT … FOR UPDATE` روی ردیفِ نوبت.
- پرتال (`upcoming`) و پروندهٔ زنده: کارتِ یک مرحله = (فرزند، نوبتِ `forVisitId` آن، یادآوریِ همان تاریخ) با هم.

## §۴ وضعیتِ سفارش‌های بالینی (W1.2 می‌سازد؛ W0.8، W3.1، W3.4 مصرف می‌کنند)

`status` روی هر چهار مدلِ `LabOrder/ImagingOrder/ConsultOrder/ReferralOrder`:
`draft → sent → answered → in_review → reviewed | needs_action`
- `answered` = بیمار/مرکز پاسخ داده (همان معنای امروز؛ سازگاری حفظ می‌شود).
- `in_review` = مسئول باز کرده؛ `reviewed` = تصمیم ثبت شد (`reviewNote`, `reviewedById`, `reviewedAt` — سه ستونِ تازه، تهِ هر مدل)؛ `needs_action` = نتیجه ناقص/نامعتبر، بیمار باید دوباره بفرستد.
- هر پاسخ (متن/لینک/فایل) یک `Document` می‌سازد با `category` بر پایهٔ نوع (imaging→`imaging`، lab→`lab`، بقیه→`report`) و `refType/refId` به سفارش؛ فایل **یک‌بار** ذخیره می‌شود و سفارش فقط به آن ارجاع می‌دهد.
- پس از `answered`: `emit('order.answered')` ← W2.2 کارِ `review_result` برای `ownerRole='doctor'` (یا پزشکِ مراجعه اگر مشخص است).

## §۵ آپلودِ فایلِ پاسخِ سفارش (W0.8 سرور؛ W0.5 فرانت)

- `POST /public/orders/:token/files` — multipart، فیلدِ `file`، jpg/png/pdf، سقف ۱۰ MB، حداکثر ۵ فایل به‌ازای هر سفارش؛ پاسخ `{id, name, size}`.
- `POST /public/orders/:token/answer` (موجود) فقط وقتی `status ∈ {sent, needs_action}` پاسخِ تازه می‌پذیرد؛ در `answered/in_review/reviewed` → `409` با پیامِ فارسی، مگر `{append:true}` که فقط فایل/متنِ **اضافه** می‌کند.

## §۶ پیش‌نویسِ فرمِ عمومی (W1.8 سرور؛ W3.4/لِینِ ب فرانت)

- `POST /public/intake/form/:token/draft` body `{values}` → `data = {...data, ...values}`، **بدونِ** تغییرِ `status`؛ پاسخ `{savedAt}`. rate-limit مثل `fill`.
- `GET /public/intake/form/:token` (موجود) همان `data` را برمی‌گرداند؛ فرانت `page` را از `data._page` (عددِ آخرین صفحهٔ ذخیره‌شده) می‌خواند و همان‌جا ادامه می‌دهد.
- فرانت: ذخیرهٔ خودکار در `nextPage` و روی `blur` با debounce ۱٫۵ ثانیه؛ نشانگرِ «ذخیره شد / در حالِ ذخیره / اتصال قطع است»؛ هیچ مقداری در `localStorage`.

## §۷ اسنپ‌شاتِ فرم روی پاسخ (W1.6 می‌سازد؛ `record.service`، `Dashboard` مصرف می‌کنند)

```prisma
  /// [{key,label,type,options?,page,roles,docCategory?}] در لحظهٔ ثبتِ پاسخ — خواننده‌ها اول این را می‌خوانند، بعد فرمِ زنده.
  schemaSnapshot Json? @map("schema_snapshot")
```
روی `IntakeSubmission` (تهِ مدل). `fill()` و `approve()` هنگامِ اولین نوشتنِ پاسخ پرش می‌کنند. `FormField.deletedAt DateTime?` جایگزینِ حذفِ سخت؛ `formUsage` = `visit.count + intakeLink.count + intakeSubmission.count`؛ فرمِ با submission فقط `active:false` می‌شود.

## §۸ کلیدِ یکتای یادآوری (W1.9)

`Reminder.dedupeKey = ${kind}:${visitId ?? 'a' + appointmentId}:${dueDate(YYYY-MM-DD)}:${sha256(text).slice(0,8)}` برای همهٔ kindها (تا امروز فقط `dispatch`). `syncNextVisit` به‌جای cancel-then-create، `upsert` روی همین کلید می‌کند و فقط ردیف‌هایی را لغو می‌کند که کلیدشان در برنامهٔ تازه نیست.
retry: `uncertain` تا ۳ بار با backoff ۵/۱۵/۴۵ دقیقه، بعد `failed` + `emit('sms.failed')`.

## §۹ گیتِ مراقبتِ پس از عمل (W1.7) — پیش‌فرضِ `DECISIONS.md` #۱

`post_op_care` و `follow_up` فقط وقتی `opStatus === 'done'` کاشته می‌شوند. اگر `opDate + 1d` گذشت و هنوز `pending` است: `emit('visit.unconfirmed')` ← کارِ `confirm_surgery_done` برای کارشناسِ مراجعه (fallback: `ownerRole='technician'`). `surgery` و `pre_op_care` مثلِ امروز (`!== 'cancelled'`).

## §۱۰ پوستهٔ سراسری (W2.4 — پیاده‌شده)

- همهٔ مسیرهای `/app/*` در `src/App.jsx` زیرِ یک layout-route هستند: `<Route element={<Protected><Shell /></Protected>}>`. **مسیرِ تازه را داخلِ همین بلوک اضافه کن**، نه بیرونش؛ وگرنه نوارِ بالا، جستجو و زنگ را ندارد.
- `ProfileMenu` فقط در `Shell.jsx` رندر می‌شود (روی صفحهٔ «همهٔ ابزارها» = لانچر، خودِ لانچر دارد و پوسته تکرار نمی‌کند). صفحه‌ها `ProfileMenu` نمی‌گذارند.
- جستجوی سراسری: `GET /search/patients?q=` (Feature `work` + `patients.read`؛ همان `searchPatients` با object-authz). میان‌برها: `Ctrl/⌘+K` و `/` بیرونِ فیلد. نتیجه به `/app/patients/:id` می‌رود.
- زنگِ کارها: `GET /work/counts` هر ۶۰ ثانیه + با برگشتِ تب + با رویدادِ `window` به نامِ `amalyar:work-changed` (`WORK_CHANGED` در `WorkBell.jsx`). **هر جایی که کاری را عوض می‌کند** این رویداد را dispatch کند تا شمارنده تازه شود. ۴۰۳ = ماژول خاموش → زنگ رندر نمی‌شود.
- ردیفِ کار یک کامپوننت است (`WorkRow.jsx`) و برچسبِ فارسیِ نوعِ کار (`TYPE_FA`) همان‌جاست؛ نوعِ تازه در `work-rules.ts` = یک ردیفِ برچسب این‌جا.
- صفحهٔ `/app/work` («کارهای من») فهرستِ کامل + کارِ دستی است؛ صفحهٔ «امروز» (W2.3) روی همین می‌نشیند.
- e2eِ مرورگری با `scripts/e2e/lib/browser-login.mjs`: کوکی‌ها روی **ریشهٔ** مبدأِ API (`path=/`) می‌نشینند (اصلاح‌شده در W2.4؛ قبلاً `/api/` بود و هر درخواستِ تغییردهندهٔ مرورگری ۴۰۳ می‌گرفت).

## §۱۱ صفحهٔ «امروز» (W2.3 — پیاده‌شده) — پیش‌فرضِ `DECISIONS.md` #۲

- **`/app` = «امروز»** (`src/app/Today.jsx`). لانچر به **`/app/tools`** رفت و «همهٔ ابزارها» نام گرفت؛ همان کاشی‌ها در **کشوی** صفحهٔ امروز هم هستند.
- **کاتالوگِ کاشی‌ها تک‌منبع شد:** `src/app/tools.jsx` (`HERO` / `DAILY` / `TOOLS` + هوکِ `useAllowedTools()` + `track`). ماژولِ تازه = **یک ردیف در همین فایل**، نه دو جا. `min` فقط fallbackِ پیش از رسیدنِ `/features` است؛ تصمیم از `allowed`ِ سرور می‌آید (قانونِ ۳).
- **`GET /work/today`** (Feature `work` + `work.read`) همه‌چیزِ صفحه را در یک درخواست می‌دهد:

```jsonc
{
  "brief": { "work": 3, "overdue": 1, "visits": 3, "appointments": 2, "intakePending": 0, "nextAt": "08:00" },
  "work":  [ /* همان شکلِ GET /work?scope=inbox، هشت‌تای اول */ ],
  "visits": [ { "id", "patientId", "code", "fullName", "kind", "opStartTime", "opStatus", "hospitalName", "surgeonName" } ],
  "appointments": [ { "id", "time", "seq", "status", "visitId", "patientId", "fullName", "topic" } ],
  "sections": { "visits": true, "appointments": true, "intake": false }
}
```

- **هر بخش جدا گیت می‌شود** و `sections` می‌گوید کدام را اصلاً رندر کنیم — نه ۴۰۳ برای کلِ صفحه. گیت از `FeaturesService.forUser` می‌آید (همان چیزی که لانچر می‌خواند): `visits` ← `dashboard` یا `tech`، `appointments` ← `calendar`، `intake` ← `formgen`. دامنهٔ دیدِ عمل‌ها مثلِ فهرستِ مراجعات است: زیرِ سوپروایزر فقط `techId` خودش.
- **هیچ عددی سمتِ کلاینت حساب نمی‌شود** (قانونِ ۱۵): `brief` آماده می‌آید. تنها چیزی که کلاینت می‌سازد سلامِ صبح/شب است، از ساعتِ **دستگاه**.
- **نمای استثنای مدیر (W2.5 — پیاده‌شده)** روی همین پاسخ نشست: `sections.exceptions` (فقط سوپروایزر و بالاتر؛ برای بقیه `exceptions: null`) و `exceptions = { unowned, stuckEvents, unreviewed, halfApproved }`، هرکدام `{count, items[≤۵]}`.

| ردیف | یعنی چه | آستانه |
|---|---|---|
| `unowned` | کارِ بازِ بدونِ `ownerAccountId` | ساخته‌شده پیش از ۲۴ ساعت |
| `stuckEvents` | `DomainEvent` با `processedAt IS NULL` | قدیمی‌تر از ۱ ساعت — یعنی pipelineِ رویداد←کار ایستاده |
| `unreviewed` | سفارشِ `status='answered'` که تصمیمی نگرفته | `updatedAt` قدیمی‌تر از ۴۸ ساعت |
| `halfApproved` | `IntakeSubmission` با `status='approved'` و `visitId IS NULL` | بدونِ آستانه |

`unreviewed` عمداً روی **خودِ سفارش** حساب می‌شود نه روی کارِ باز: اگر کارِ `review_result` ساخته نشده باشد (همان `stuckEvents`)، دقیقاً همان موردی است که باید دیده شود. نمایی که فقط کارها را بشمارد، شکافِ خودش را نمی‌بیند. وقتی هر چهار صفرند، بخش در رابط اصلاً رندر نمی‌شود.
