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

## §۹ مراقبتِ پس از عمل (W1.7) — تصمیمِ مالک در `DECISIONS.md` #۱

`post_op_care` و `follow_up` گیتِ `done` ندارند: done متن عادی؛ pending با تاریخ گذشته متن دوشاخهٔ «اگر عمل انجام شده مراقبت‌ها…؛ اگر انجام نشده یا موکول شده با پزشک در ارتباط باشید». cancelled مراقبت نمی‌گیرد؛ پیام لغو بستهٔ مستقل پس از W3.3 است. اگر `opDate + 1d` گذشت و هنوز `pending` است: `emit('visit.unconfirmed')` ← کارِ `confirm_surgery_done` همچنان ساخته می‌شود. پیام جایگزین ثبت وضعیت نیست. `surgery` و `pre_op_care` مثلِ امروز (`!== 'cancelled'`).

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

## §۱۲ پروندهٔ زنده (W3.1 — پیاده‌شده) — §۴.۳ سند

`GET /patients/:id/live` — **لایهٔ پاسخ**، جدا از `GET /patients/:id/record` که
بایگانیِ تب‌هاست. صفحه هر دو را موازی می‌گیرد و `live` **اضافه** است نه شرط: اگر
نیامد، تب‌ها سرِ جایشان کار می‌کنند. همان الگوی `prep.service.ts` در W3.2 — یعنی
`record.service.ts` (که لِینِ الف در W1.6 عوضش کرد) دست نخورد.

گارد: `JwtAuthGuard + FeatureGuard + PermissionGuard`، `@Feature('dashboard')`،
`@RequirePermissions('patients.read')`. دامنهٔ دید کپیِ عمدیِ
`RecordService.assertAccess` (زیرِ سوپروایزر فقط بیماری که خودش `techId` یک
مراجعه‌اش است؛ نبودن = **۴۰۴ نه ۴۰۳**).

```jsonc
{
  "now": "…", "patient": { "id": 41, "code": "AM-0041", "fullName": "…" },
  "clinicalVisible": true,   // سطح ≥ TECH_ADMIN — شرح‌ها
  "ordersVisible": true,     // همان سطح — سفارش‌های بالینی (پایین ↓)
  "stage": {                 // نوارِ «الان کجاییم»
    "key": "results", "title": "نتیجه‌ها", "detail": "۲ نتیجه آمده و بررسی نشده",
    "steps": [ /* همیشه ۶ ردیف، همیشه **دقیقاً یک** current */
      { "key": "intake|appointment|visit|results|followUp|billing",
        "title": "…", "state": "done|current|todo|skipped", "detail": "…", "at": "…|null" }
    ]
  },
  "nextWork": { /* == work[0] */ }, "work": [ /* GET /work?scope=patient */ ],
  "upcoming": [ { "id": 9, "date": "…", "time": "10:00", "statusFa": "قطعی", … } ],
  "openOrders": [ { "kind": "imaging", "kindFa": "تصویربرداری", "summary": "MRI",
                    "statusFa": "…", "awaitingReview": true, … } ],
  "billing": { "total": 0, "itemsTotal": 0, "paid": 0, "due": 0, "paidPct": 0 },
  "timeline": { "items": [ /* شش منبع، نزولی */ ], "truncated": false, "total": 48 },
  "counts": { … }
}
```

**قواعدی که این قرارداد را نگه می‌دارند** (هر کدام یک سنجهٔ «نباید بیفتد» در
`scripts/e2e/w3-1-live-record.mjs` دارد — ۴۸ سنجه):

1. **دقیقاً یک گامِ `current`.** اگر هر گامِ ناتمام روشن شود، نوار سه جای روشن
   دارد و دیگر به «الان کجاییم» جواب نمی‌دهد. کارهای بازِ دیگر جایشان کارتِ
   «کارِ بعدی» است.
2. **گامِ بی‌ربط `skipped` می‌شود، حذف نمی‌شود** — شکلِ نوار باید برای همهٔ
   بیماران یکی بماند وگرنه مقایسه با یک نگاه ممکن نیست.
3. **سفارش‌های بالینی همان دروازهٔ `/orders` را دارند** (`@MinLevel(TECH_ADMIN)`).
   بدونِ این، پروندهٔ زنده یک **درِ پشتی** بود: کارشناسِ سطح‌۲ که یک مراجعهٔ این
   بیمار را دارد نامِ آزمایش و ناحیهٔ تصویربرداری را می‌دید، که `/orders` به او
   نمی‌دهد. `ordersVisible` «خالی» را از «اجازه نداری» جدا می‌کند.
4. **هر بریدنی اعلام می‌شود.** سقفِ هر منبع (۴۰/۴۰/۳۰/۲۰/۲۰) **پیش از** ادغام
   اعمال می‌شود، پس `truncated` فقط از مقایسهٔ جمع با سقفِ کل (۸۰) درنمی‌آید؛
   هر منبع `cap+1` می‌خواند تا سرریزش دیده شود. وگرنه بیمارِ ۶۰ مدرکی
   `truncated:false` می‌گرفت در حالی که ۲۰ مدرکش بی‌صدا افتاده بود.
5. **سرور مسیرِ React را نمی‌داند.** هر ردیفِ خطِ زمان `type`/`refType`/`refId`/
   `visitId` دارد و کلاینت مقصد را می‌سازد؛ ردیفِ بی‌مقصد **کلیک‌ناپذیر** رندر
   می‌شود (در به دیوار ممنوع).
6. **جمعِ مالی به‌ازای هر مراجعه حساب و بعد جمع می‌شود** — مدلِ «گلوبال» مبلغِ
   توافقیِ همان مراجعه را مبنا می‌گیرد، پس یک `summarize`ِ یک‌کاسه مبلغِ توافقی
   را نادیده می‌گرفت.
7. **برچسبِ مالکِ کار سمتِ سرور است** (`ownerRoleFa` در `WorkService.enrich`،
   از `OWNER_ROLE_FA` در `work-rules.ts`). نسخهٔ کلاینتی `admin` را نداشت — که
   همان فایل صادرش می‌کند — و کلیدِ خامِ انگلیسی در رابطِ فارسی چاپ می‌شد.
8. **هر بخشی که از ماژولِ دیگری می‌خواند، گیتِ همان ماژول را می‌زند** (قانون ۳):
   نوبت‌ها `Feature('calendar')`، کارها `Feature('work')` + `work.read`،
   سفارش‌ها سطحِ `TECH_ADMIN`. سه پرچمِ `apptVisible`/`workVisible`/`ordersVisible`
   «خالی» را از «اجازه نداری» جدا می‌کنند. کنترلرِ آن ماژول‌ها در این مسیر نیست،
   پس گیتِ ضمنی وجود ندارد و باید صریح زده شود — همان کاری که `today.service.ts`
   با `FeaturesService.forUser` و `billing.service.ts` با `canAccess` می‌کنند.
   ⚠️ سنجهٔ گیت را با حسابِ **سوپرادمین** نزن: قانون ۳ می‌گوید او همیشه عبور
   می‌کند، پس تست سبز می‌شود بی‌آنکه چیزی را اثبات کند.
9. **سقف هرگز یک سفارشِ باز را پنهان نمی‌کند.** چهار کوئریِ سفارش در یک آرایه
   می‌ریزند، پس ترتیبِ خام «اول همهٔ آزمایش‌ها» است نه زمانی؛ بدونِ مرتب‌سازی،
   بیمارِ ۲۱-آزمایشی هر سفارشِ تصویربرداری/مشاوره را از دست می‌داد. بازها کامل
   می‌مانند و سقف فقط دنبالهٔ بسته‌ها را می‌برد.
10. **مراجعهٔ لغوشده پول نمی‌خواهد، و مانده به‌ازای هر مراجعه کف می‌خورد.**
   `setStatus` فقط `opStatus` را عوض می‌کند و قلم‌ها می‌مانند؛ حذفِ مراجعهٔ
   فاکتوردار هم عمداً ممنوع است و کاربر را به «لغو» می‌فرستد — پس بدونِ این شرط
   هر لغوِ فاکتوردار یک **ماندهٔ ابدی** می‌ساخت که داشبورد نشان نمی‌دهد. و
   `due` جمعِ `max(0, dueِ هر مراجعه)` است نه `total - paid`: همان تلهٔ مستندِ
   `visitStats` که اضافه‌پرداختِ یک مراجعه بدهیِ مراجعهٔ دیگر را می‌پوشاند و
   گامِ «تسویه» دروغِ «تسویه شد» می‌گفت.
11. **قالبِ پول از سرور نمی‌آید.** هیچ مبلغی در متنِ سرور رشته نمی‌شود؛ کلاینت
   `fmtMoney` می‌زند (قانون ۱۳). در عوض متنِ سرور در رابط از `faNum` رد می‌شود
   تا شمارش‌ها («۲ نتیجه…») عددِ لاتین نمانند.

## W1.2 — قرارداد اجرایی پاسخ و بررسی (2026-09-17)

- `POST /orders/:kind/:id/review` با `{status: 'in_review'|'reviewed'|'needs_action', reviewNote?}`؛ تصمیم نهایی یادداشت می‌خواهد. فقط از answered/in_review؛ تکرار همان تصمیم بی‌اثر است. `reviewNote/reviewedById/reviewedAt` روی هر چهار مدل ثبت می‌شوند.
- فهرست و نتیجهٔ نوشتن سفارش `documents[]` می‌دهد؛ هر Document با `refType=<kind>_order/refId` به همان سفارش متصل است. متن در `contentText` و از مسیر دانلود فعلی خواندنی است؛ لینک همان externalUrl است. متن/لینک قبلی بازنویسی نمی‌شود.
- ایجاد/ویرایش کارکنان می‌تواند `documentIds` بدهد (حداکثر ۵ شناسهٔ یکتا): فقط مدرک همان بیمار و همان مراجعه که به سفارش دیگری متصل نیست. ردیف/فایل کپی نمی‌شود. آپلود عمومی جدید همچنان W0.8/W0.5 است؛ این بسته endpoint عمومی آپلود اضافه نمی‌کند.
- پاسخ، مدارک، audit و رویداد outbox در همان تراکنش و زیر قفل سفارش هستند. publicAnswer در sent/needs_action می‌پذیرد؛ تکرار بدون append اکنون 409 است. مسیر append/آپلود عمومی §۵ در W0.8 تکمیل می‌شود.
- order.answered کار review_result را برای حساب فعال جراح مراجعه (Person مشترک) یا صف doctor می‌سازد و upload_result را می‌بندد. تصمیم needs_action کار بیمار را باز می‌کند؛ پاسخ بعدی همان review_result را باز می‌کند. `WorkUpsert.reopen` فقط با sourceEventId تازه بازگشایی می‌کند؛ replay همان رویداد کار انجام‌شده را باز نمی‌کند.
- خواندن/نوشتن سفارش علاوه بر کف بالینی قبلی، از Feature dashboard و مجوزهای patients.read/patients.update عبور می‌کند؛ دامنهٔ بیمار برای زیر سوپروایزر همان انتساب techId است. تنظیم نقش/سطح این مجوزها در DB شرکت معتبر است.
- ارسال مجدد لینک وضعیت reviewed/in_review/needs_action را به sent برنمی‌گرداند؛ سفارش پاسخ‌دار حذف نمی‌شود. بازیابی سفارش‌های قدیمیِ فاقد Document در W1.10 باقی است.

## §۱۳ مسیرِ درمان (W4.1 — پیاده‌شده) — یافتهٔ A4

امروز کلِ «اتوماسیونِ مسیر» `syncPostOpVisit()` + کاشتِ یادآوری است و **هر دو
قفلِ `kind === 'surgery'`**اند. یعنی مطب (ویزیت‌محور)، IVF (چرخه‌ای) و
فیزیوتراپی (دوره‌ای) بدونِ تغییرِ کد هیچ مسیری ندارند. این بسته همان مفهوم را
**داده** می‌کند نه کد.

### چهار موجودیت

| مدل | نقش |
|---|---|
| `PathwayTemplate` | هویتِ ثابتِ الگو. متنِ گام‌ها این‌جا نیست. |
| `PathwayVersion` | یک نسخهٔ منتشرشده. `steps` این‌جا **ثابت** می‌ماند. |
| `Episode` | دورهٔ خدمتِ یک بیمار — نمونه‌ای از یک نسخه. |
| `EpisodeStep` | گامِ **کپی‌شده** — و همان «برنامهٔ اختصاصیِ بیمار». |

### هفت قاعده

1. **نمونه گام‌ها را کپی می‌کند، نه ارجاع.** انتشارِ نسخهٔ تازه دوره‌های در
   جریان را دست نمی‌زند (معیارِ پذیرشِ سند). اگر گام‌ها هنگامِ نمایش از الگو
   خوانده می‌شدند، هر ویرایشِ الگو تاریخچهٔ همهٔ بیمارانِ گذشته را بازنویسی
   می‌کرد.
2. **نسخهٔ قبلی بازنشسته می‌شود، نه حذف** — تا «این بیمار با کدام نسخه شروع
   شد؟» همیشه جواب داشته باشد.
3. **`offsetDays` روزِ نسبی است و منفی مجاز.** «۷ روز پیش از عمل» فقط وقتی
   معنا دارد که مبدأ تاریخِ عمل باشد: دوره‌ای که از مراجعهٔ تاریخ‌دار شروع شود
   مبدأش همان تاریخ است، وگرنه امروز. کران دوطرفه است (−۳۶۵ تا ۳۶۵۰).
4. **جدولِ سومِ `PatientPlan` ساخته نشد.** `EpisodeStep` خودش overrideِ بیمار
   است (عنوان، موعد، مسئول، وضعیت). جدولِ جدا دو منبعِ حقیقت برای یک چیز بود.
5. **هیچ‌چیز خودکار شروع نمی‌شود** و `syncPostOpVisit` دست‌نخورده است. نصبی که
   امروز کار می‌کند بعد از این بسته دقیقاً همان رفتار را دارد. مهاجرتِ جراحی
   به مسیرِ صریح، بستهٔ جداست.
6. **بستنِ دوره گام‌های باز را انجام‌شده نمی‌کند.** دوره‌ای که نیمه‌کاره بسته
   شده باید همان‌طور در سابقه بماند، وگرنه گزارشِ «چند درصد کامل شد» دروغ
   می‌گوید.
7. **یک اعتبارسنجی برای هر دو مسیر** (`validateSteps`): الگوی کارخانه و الگوی
   ساختِ کاربر از یک تابع رد می‌شوند. دو مسیر یعنی روزی که یکی سخت‌گیرتر شود
   و الگویی که از ویزارد رد شده از راهِ دیگری بنشیند.

### API

```
GET   /pathway/templates                → الگوها + نسخهٔ منتشرشده   (pathway.read)
POST  /pathway/templates/:id/publish    → نسخهٔ تازه                 (pathway.manage)
GET   /pathway/episodes?patientId=      → دوره‌های بیمار             (pathway.read)
GET   /pathway/episodes/:id             → یک دوره                   (pathway.read)
POST  /pathway/episodes                 → شروعِ دوره                 (pathway.start)
PATCH /pathway/steps/:id                → وضعیت/موعد/مسئول/عنوان    (pathway.step)
POST  /pathway/episodes/:id/close       → بستنِ دوره                 (pathway.start)
```

دامنهٔ دید همان `LiveService.assertAccess` است (زیرِ سوپروایزر فقط بیمارانِ
`techId` خودش) و نبودن ۴۰۴ می‌دهد نه ۴۰۳.

### اطلاع‌رسانی و «عدمِ پاسخ» (W4.2 گامِ ۱)

گام می‌تواند دو چیزِ دیگر هم داشته باشد: `notify` (متنِ پیامکِ بیمار در موعدِ
همان گام) و `escalateDays` (چند روز بعد از موعد، اگر هنوز باز بود، پیگیری).

1. **`notify` واقعاً می‌فرستد.** هنگامِ شروعِ دوره یک ردیفِ `Reminder` با همان
   موعد ساخته می‌شود و **sweepِ موجود** می‌فرستدش. ماشینِ ارسالِ دوم ساخته نشد:
   دو جا برای «چرا این پیامک رفت؟» یعنی هیچ‌جا.
2. **موعدِ گذشته پیام نمی‌سازد.** دوره‌ای که با تاریخِ عقب‌افتاده شروع شود وگرنه
   همان لحظه رگباری از پیام‌های کهنه می‌فرستاد — همان تله‌ای که `collapsed()`
   در `reminders.service.ts` برای عملِ گذشته گرفته است.
3. **گامِ بسته و دورهٔ بسته یادآوریِ نفرستادهٔ خود را باطل می‌کنند** — ولی
   یادآوریِ **فرستاده‌شده** هرگز: آن سندِ چیزی است که واقعاً رفته.
4. **بیمارِ بی‌شماره خطا نیست** — دوره ساخته می‌شود، فقط پیامش نمی‌رود.
5. **`POST /pathway/preview` هیچ‌چیز نمی‌نویسد** — «بیازماید» در معیارِ پذیرشِ
   W4.2: مدیر تاریخ‌ها و متنِ پیام‌ها را پیش از اعمال می‌بیند، بدونِ اینکه
   بیمارِ واقعی چیزی بگیرد. خروجی صریح می‌گوید کدام پیام **نمی‌رود**.

### ویزارد و «عدمِ پاسخ» (W4.2 گامِ ۲ — پیاده‌شده)

معیارِ پذیرشِ سند: «مدیرِ مجاز **بدونِ کد** یک الگوی محدود بسازد، بیازماید،
اعمال کند». صفحهٔ `/app/pathways` (کاشیِ «مسیرِ درمان»، `Feature('pathway')`)
همین است — شش مرحله، هر مرحله **یک** تصمیم:
انتخاب · مرحله‌ها · زمان · اطلاع‌رسانی · **آزمون** · اعمال.

1. **«آزمون» مرحلهٔ جداست، نه دکمه‌ای کنارِ «ذخیره».** تاریخِ نسبی و متنِ پیامک
   چیزی نیست که در ذهن حساب شود، و اشتباهشان پیامکِ غلط به بیمارِ **واقعی**
   است. همان `POST /pathway/preview` گامِ ۱ را صدا می‌زند، پس چیزی نوشته
   نمی‌شود و خروجی صریح می‌گوید کدام پیام نمی‌رود.
2. **پیش‌نمایش و انتشار از یک ورودی می‌خوانند** (`payload`ِ مشترک). دو مسیرِ
   جدا یعنی روزی که آزمون چیزی را نشان دهد و اعمال چیزِ دیگری بنشاند.
3. **`escalateDays` حالا کار می‌کند، پس حالا در ویزارد دیده می‌شود.** ترتیب
   عمدی بود: فیلدی که پر شود و کاری نکند بدترین نوعِ فیلد است.

**«عدمِ پاسخ» → کارِ پیگیری.** آشکارسازِ `pathwayOverdue` در
`work-detectors.ts` گامِ `pending` ای را که `escalateDays` روز از موعدش گذشته
`pathway.step_overdue` می‌کند، و قاعدهٔ هم‌نام در `work-rules.ts` از رویش کار
می‌سازد. چهار قاعده:

- **مسئولِ کار = نقشِ خودِ گام**، نه یک نقشِ ثابت. «مراقبتِ پس از عمل» مالِ
  پرستار است و «ویزیتِ پیگیری» مالِ پزشک؛ یک صفِ مشترک یعنی یکی‌شان همیشه در
  صفِ اشتباه بماند.
- **کفِ ۶۰ روزه** مثلِ بقیهٔ آشکارسازها: نصبی که دوره‌های نیمه‌کارهٔ قدیمی
  دارد نباید در اولین sweep صدها کار بسازد.
- **فقط دورهٔ `active`.** گامِ بازِ دوره‌ای که بسته شده عمداً باز مانده
  (قاعدهٔ ۶) و کارِ پیگیری ندارد.
- **گامی که بسته شد کارش را هم می‌بندد** — `pathway.step_closed` از
  `patchStep()`. وگرنه کسی دنبالِ گامی می‌گردد که انجام شده.

## §۱۰ تأیید اتمیک ثبت‌نام — W1.4

- `POST /intake/submissions/:id/approve` یک `idempotencyKey` اختیاری تا ۱۲۰ نویسه می‌گیرد؛ پیش‌فرض `intake_approval:<id>`. پاسخ موفق در `approvalResult` و کلید یکتا در `approvalKey` می‌ماند. تکرار بدون کلید یا با همان کلید همان پاسخ را می‌دهد؛ کلید صریح متفاوت یا استفاده از یک کلید برای ثبت‌نام دیگر 409 است. پاسخ HTTP موجود تغییر نمی‌کند.
- مراجعه/به‌روزرسانی همان `appointment.visitId ?? forVisitId`، هزینه و تخفیف و پرداخت، اتصال مدارک، وضعیت ثبت‌نام/نوبت، audit و outbox همگی در یک تراکنش‌اند. خطای پرداخت یا outbox همه را rollback می‌کند؛ ثبت‌نام قدیمی approved بدون approvalResult خودکار ترمیم یا دوباره تأیید نمی‌شود.
- `PatientsService.prepareVisitCreation` تابع `(tx, targetVisitId?)` برمی‌گرداند؛ هدف باید متعلق به همان بیمار و لغونشده باشد. وضعیت بالینی، نوع مراجعه و پاسخ‌های قبلی حفظ و پاسخ‌های تازه ادغام می‌شوند. هزینهٔ خدمت موجود اگر هم‌مبلغ باشد تکرار نمی‌شود؛ مغایرت مبلغ نیاز به بررسی دارد. `BillingService.addCharge/addPayment` پارامتر آخر اختیاری tx دارند؛ مصرف انبار با tx در addCharge پشتیبانی نمی‌شود.
- پیام پورتال `Reminder(kind=notice, status=pending, dedupeKey=intake_approved:<id>)` داخل همان تراکنش ثبت می‌شود. فرستندهٔ موجود فقط پس از commit آن را می‌بیند؛ approve هیچ SMS مستقیم نمی‌فرستد. فرم record همچنان مراجعه و پیام پورتال تازه ندارد.
- `intake.approval_sync_pending` با ref=`intake_submission:id` در tx و `intake.approval_synced` پس از همگام‌سازی یادآوری/برنامهٔ مراجعه صادر می‌شود. اولی کار موجود `repair_intake` با شرح «تأیید و پرداخت ثبت شده؛ همگام‌سازی باقی است» باز می‌کند و دومی آن را می‌بندد. قطع پردازش پس از commit پنهان نمی‌ماند؛ retry تأیید پرداخت را تکرار نمی‌کند. این کار از تأیید نیمه‌کارهٔ تاریخی متمایز است.
- ویرایش عمومی پاسخ/فیش/عکس و بازگرداندن برای اصلاح، status/updatedAt خوانده‌شده را شرط نوشتن می‌کنند؛ درخواست دیررس پس از تأیید 409 می‌گیرد. حذف و انقضا نیز تغییر ثبت‌نام و نوبت را در همان tx محافظت می‌کنند.
- همگام‌سازیِ پس از تأیید، `afterVisitCreation(visitId, true)` و `syncAppointment(id, true)` را صدا می‌زند. این حالت strict خطای داخلیِ یادآوری/لینک پیگیری/فرزند را به فراخواننده می‌رساند تا رویداد synced کاذب نوشته نشود؛ callers قبلی با پیش‌فرض false همچنان fail-soft هستند.
