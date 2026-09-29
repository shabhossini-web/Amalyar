import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LEVEL } from '../common/levels';
import { ownPatientWhere } from '../common/own-scope';
import { WorkService } from '../work/work.service';
import { summarize } from './billing.service';
import { colorForKey } from './forms.service';
import { APPT_LABELS } from './appointments.service';
import { ORDER_LABELS, REMINDER_LABELS, OP_LABELS } from './labels';
import { canAccess } from '../auth/access-check';
import { todayRangeUtc } from '../common/clinic-day';
import { visitTitleOf } from './visit-title';

/**
 * سفارشِ باز = نتیجه‌ای که یا نیامده یا آمده و هنوز بسته نشده.
 *
 * ⚠️ `in_review` و `needs_action` امروز در هیچ ردیفی نیستند — W1.2 (لِینِ الف)
 * آن‌ها را اضافه می‌کند. عمداً از همین حالا این‌جا هستند تا وقتی آن بسته لند شد،
 * «نتیجهٔ بازِ» این صفحه بی‌سروصدا غلط نشود و کسی مجبور به بازنویسی نباشد.
 */
const OPEN_ORDER = ['sent', 'answered', 'in_review', 'needs_action'];

/**
 * سقفِ هر منبع **پیش از** ادغام. یکی بیشتر خوانده می‌شود تا سرریز *دیده* شود:
 * بدونِ آن، بیمارِ ۶۰ مدرکی ۴۰ تا می‌گرفت و چون جمعِ ادغام‌شده زیرِ سقفِ کل بود
 * `truncated:false` می‌شد — یعنی صفحه می‌گفت «همین بود» در حالی که نبود.
 */
const CAP = { appointments: 40, documents: 40, notes: 30, reminders: 20, orders: 20 };
const TIMELINE_MAX = 80;

const ORDER_KINDS = [
  { key: 'lab', fa: 'آزمایش' },
  { key: 'imaging', fa: 'تصویربرداری' },
  { key: 'consult', fa: 'مشاوره' },
  { key: 'referral', fa: 'ارجاع' },
];

/* ⚠️ چهار نگاشت این‌جا بودند و هر چهار کپیِ دوم بودند — یکی‌شان
   (`OP_STATUS_FA.cancelled = 'لغو شد'`) حتی با `OP_LABELS.cancelled = 'لغو'`ِ
   خودِ سرور نمی‌خواند، یعنی یک عمل در `/visits/:id` «لغو» بود و در
   `/patients/:id/live` «لغو شد». نگهبانِ «یک وضعیت، یک برچسب» فقط کلاینت را
   می‌گشت، پس این یکی را ندید. خانه‌شان `labels.ts` است. */
const ORDER_STATUS_FA = ORDER_LABELS;
const REMINDER_STATUS_FA = REMINDER_LABELS;
const OP_STATUS_FA = OP_LABELS;

const DOC_CATEGORY_FA: Record<string, string> = {
  lab: 'آزمایش', imaging: 'تصویربرداری', report: 'گزارش', consent: 'رضایت‌نامه',
  identity: 'مدرکِ هویتی', receipt: 'رسید', other: 'سایر',
};

/** یک گامِ نوارِ «الان کجاییم». `skipped` یعنی این دوره اصلاً این گام را ندارد. */
type Step = {
  key: string;
  title: string;
  state: 'done' | 'current' | 'todo' | 'skipped';
  detail: string | null;
  at: Date | null;
  /** فقط گامِ «مراجعه»: نوعِ آخرین دوره (surgery/clinic/…) تا کلاینت «عمل جراحی»
      و «ویزیت» را از هم جدا بنویسد — نه واژهٔ حوزه برای هر دو (گزارشِ مالک). */
  kind?: string | null;
  /** نامِ همان نوع، **به زبانِ خودِ شرکت** (عنوانِ فرمش). */
  kindFa?: string | null;
};

type TimelineItem = {
  id: string;
  at: Date;
  type: 'visit' | 'appointment' | 'order' | 'document' | 'note' | 'form' | 'reminder';
  title: string;
  detail: string | null;
  state: string | null;
  stateFa: string | null;
  /* مقصدِ کلیک را **کلاینت** می‌سازد؛ سرور فقط می‌گوید این ردیف به چه چیزی
     اشاره دارد. مسیرهای React نباید در بک‌اند هاردکد شوند. */
  visitId: number | null;
  refType: string | null;
  refId: number | null;
  color: string | null;
  /** فقط ردیفِ مراجعه: نوع، **نامِ فارسیِ نوع** و کد جدا می‌آیند تا کلاینت کد را
      `dir="ltr"` بگذارد و نامِ نوع را از سرور بگیرد، نه از نگاشتِ هاردکدِ خودش.
      `title` (نامِ نوع + کد) برای سازگاری می‌ماند. */
  kind?: string | null;
  kindFa?: string | null;
  code?: string | null;
};

/**
 * ⚠️ **واژهٔ حوزه‌ای هاردکد نمی‌شود** (قانون ۲۴): «مراجعه» در نصبِ تجهیزات «عمل»
 * و در مطب «ویزیت» است. سرور منطق را می‌سازد و واژه را **جای خالی** می‌گذارد؛
 * کلاینت با `useTerms()` پُرش می‌کند. دو نسخه از واژه‌نامه (یکی این‌جا، یکی
 * `src/lib/terms.js`) یعنی همان forkِ هر حوزه که قانون ۲۴ جلویش را گرفته.
 */
const V = '{visit}';

/**
 * **پروندهٔ زنده** (W3.1، §۴.۳ سند) — لایه‌ای که به چهار پرسش جواب می‌دهد:
 * الان کجاییم · چه شده · چه مانده · نوبتِ کیست.
 *
 * چرا سرویسِ جدا و نه افزودن به `record.service.ts`: آن یکی **بایگانیِ** پرونده
 * است (پروفایل، مراجعات، مدارک، شرح‌ها، فرم‌ها) و تب‌ها از آن می‌خورند. این یکی
 * **پاسخ** است و از هفت جدول می‌خواند که هیچ‌کدام در بایگانی نیستند: نوبت‌ها،
 * سفارش‌های بالینی، یادآوری‌ها، کارهای باز و صورت‌حساب. قاطی‌کردنشان یعنی هر
 * بارگذاریِ تب هم ۷ کوئریِ اضافه بزند.
 *
 * ⚠️ همه‌چیز مشتق و خواندنی است (قانون ۱۵): مرحله، ماندهٔ مالی، و ترتیبِ خطِ
 * زمان همین‌جا حساب می‌شوند. هیچ render ای حق ندارد دوباره حسابشان کند، وگرنه
 * نوارِ مرحله در پرونده و کارتِ آماده‌سازی دو حرفِ متفاوت می‌زنند.
 */
@Injectable()
export class LiveService {
  constructor(private prisma: PrismaService, private work: WorkService) {}

  /**
   * ⚠️ همان دامنهٔ دیدِ `RecordService.assertAccess` — عمداً کپی و نه import:
   * این سرویس نباید از طریقِ سرویسِ دیگری در گاردِ پرونده سوراخ باز کند، و
   * تفاوتِ این دو تابع یعنی درِ پشتی. اگر قاعده عوض شد، **هر دو** عوض می‌شوند.
   * نبودن → ۴۰۴ (نه ۴۰۳) تا وجودِ پرونده هم لو نرود.
   */
  private async assertAccess(patientId: number, user: any) {
    const scoped = (user?.level ?? 0) < LEVEL.SUPERVISOR;
    const patient = await this.prisma.patient.findFirst({
      where: {
        id: patientId, deletedAt: null,
        ...(scoped ? ownPatientWhere(user) : {}),
      },
      select: { id: true, code: true, firstName: true, lastName: true, createdAt: true },
    });
    if (!patient) throw new NotFoundException('پرونده پیدا نشد');
    return patient;
  }

  async forPatient(patientId: number, user: any) {
    const patient = await this.assertAccess(patientId, user);
    /* شرحِ بالینی از سطحِ کارشناس‌ادمین به بالا — همان دروازهٔ `record.service`. */
    const clinical = (user?.level ?? 0) >= LEVEL.TECH_ADMIN;
    /* ⚠️ **سفارش‌های بالینی دروازهٔ خودشان را دارند و این‌جا هم باید داشته باشند.**
       `@Controller('orders')` با `@MinLevel(TECH_ADMIN)` بسته است و کامنتش صریح
       می‌گوید منشی نباید نامِ آزمایش و ناحیهٔ تصویربرداری را ببیند. این endpoint
       با `patients.read` باز است، پس بدونِ این گیت یک **درِ پشتی** می‌شد: کارشناسِ
       سطح‌۲ که یک مراجعهٔ این بیمار را دارد از `assertAccess` رد می‌شود و همان
       چیزی را می‌دید که `/orders` به او نمی‌دهد. دو دروازه برای یک داده = یکی‌شان
       بی‌اثر. */
    const ordersVisible = clinical;
    /* ⚠️ **هر بخشی که از ماژولِ دیگری می‌خواند، گیتِ همان ماژول را می‌خواهد**
       (قانون ۳). نوبت‌ها پشتِ `@Feature('calendar')` و کارها پشتِ
       `@Feature('work')` + `work.read` هستند؛ این‌جا کنترلرِ آن‌ها در کار نیست،
       پس گیت باید صریح زده شود — دقیقاً همان کاری که `today.service.ts` با
       `FeaturesService.forUser` و `billing.service.ts` با `canAccess` می‌کنند.
       بدونش نصبی که پلنش تقویم/کار ندارد، همان داده را از این در می‌گرفت. */
    const [apptVisible, workVisible] = await Promise.all([
      canAccess(this.prisma, user, 'calendar', []),
      canAccess(this.prisma, user, 'work', ['work.read']),
    ]);
    const now = new Date();
    const [today] = todayRangeUtc(now);

    const [visits, appointments, orders, documents, notes, reminders, kindDefs] = await Promise.all([
      this.prisma.visit.findMany({
        where: { patientId },
        orderBy: [{ opDate: { sort: 'desc', nulls: 'last' } }, { seq: 'desc' }],
        select: {
          id: true, seq: true, kind: true, service: true, opDate: true, opStatus: true, createdAt: true,
          nextVisitDate: true, followOfVisitId: true, surgeonName: true, hospitalName: true,
          pricingModel: true, globalAmount: true,
          charges: { select: { amount: true } },
          payments: { select: { amount: true } },
        },
      }),
      apptVisible ? this.prisma.appointment.findMany({
        where: { patientId },
        orderBy: [{ date: 'desc' }, { startMin: 'desc' }],
        take: CAP.appointments + 1,
        select: {
          id: true, date: true, startMin: true, status: true, note: true,
          visitId: true, forVisitId: true,
          topic: { select: { name: true, color: true } },
          doctor: { select: { person: { select: { firstName: true, lastName: true } } } },
        },
      }) : Promise.resolve([] as any[]),
      ordersVisible ? this.orders(patientId) : Promise.resolve([] as any[]),
      this.prisma.document.findMany({
        where: { patientId, deletedAt: null },
        orderBy: { createdAt: 'desc' }, take: CAP.documents + 1,
        select: { id: true, title: true, fileName: true, category: true, visitId: true, createdAt: true, takenAt: true },
      }),
      clinical
        ? this.prisma.clinicalNote.findMany({
          where: { patientId, replacedAt: null },
          orderBy: { createdAt: 'desc' }, take: CAP.notes + 1,
          select: { id: true, kind: true, body: true, authorName: true, visitId: true, createdAt: true },
        })
        : Promise.resolve([] as any[]),
      this.prisma.reminder.findMany({
        where: { patientId },
        orderBy: { dueAt: 'desc' }, take: CAP.reminders + 1,
        select: { id: true, kind: true, status: true, dueAt: true, sentAt: true, text: true, visitId: true },
      }),
      this.prisma.formDef.findMany({
        where: { scope: 'visit' },
        select: { visitKind: true, title: true, key: true, color: true },
      }),
    ]);

    /* سرریزِ هر منبع همین‌جا ثبت و ردیفِ اضافی دور ریخته می‌شود. */
    let capped = false;
    const trim = (rows: any[], cap: number) => {
      if (rows.length > cap) { capped = true; return rows.slice(0, cap); }
      return rows;
    };
    const appointmentsC = trim(appointments, CAP.appointments);
    const documentsC = trim(documents, CAP.documents);
    const notesC = trim(notes, CAP.notes);
    const remindersC = trim(reminders, CAP.reminders);
    /* سفارش‌ها سقفشان را **داخلِ** `orders()` می‌خورند (بازها هرگز حذف نمی‌شوند)،
       پس این‌جا فقط سرریز اعلام می‌شود و دوباره بریده نمی‌شود. */
    const ordersC = orders;
    if (orders.length >= CAP.orders) capped = true;

    const kindTitle: Record<string, string> = {};
    const kindColor: Record<string, string> = {};
    for (const d of kindDefs) {
      if (!d.visitKind) continue;
      kindTitle[d.visitKind] = d.title;
      kindColor[d.visitKind] = d.color || colorForKey(d.key);
    }
    const vLabel = (v: { kind: string | null; seq: number; service?: string | null }) =>
      `${visitTitleOf(v, kindTitle[v.kind ?? '']) ?? V} ${patient.code}-V${v.seq}`;

    /* کارهای باز از همان لایهٔ کار می‌آید، نه کوئریِ محلی: مالک، موعد، و
       «عقب‌افتاده» آن‌جا حساب می‌شوند و دو نسخه‌شان یعنی دو حقیقت. */
    /* `settle`: کاری که رویدادِ واقعی‌اش همین حالا رخ داد (وضعیتِ عمل، گزارشِ آمده) همین حالا
       از کارتِ «کارِ بعدی» برود — همان قاعدهٔ «امروز» و «کارهای من». */
    if (workVisible) await this.work.settle();
    const work = workVisible ? await this.work.list(user, { scope: 'patient', patientId, limit: 20 }) : [];

    const billing = this.billing(visits);
    const cycle = visits[0] ?? null;
    const upcoming = appointmentsC
      .filter((a) => a.date >= today && ['held', 'confirmed', 'arrived'].includes(a.status))
      .sort((a, b) => a.date.getTime() - b.date.getTime() || (a.startMin ?? 0) - (b.startMin ?? 0));
    const openOrders = ordersC.filter((o) => OPEN_ORDER.includes(o.status));

    return {
      now,
      patient: { id: patient.id, code: patient.code, fullName: `${patient.firstName} ${patient.lastName}`.trim() },
      clinicalVisible: clinical,
      /* «خالی» را از «اجازه نداری» جدا می‌کند — وگرنه منشی فکر می‌کند سفارشی نیست. */
      ordersVisible, apptVisible, workVisible,
      stage: this.stage({ patient, visits, cycle, appointments: appointmentsC, upcoming, orders: ordersC, openOrders, billing, kindTitle, today, ordersVisible, apptVisible }),
      /* «کارِ بعدی» = بالاترین کارِ باز. بقیه هم می‌آیند تا کارت بتواند بگوید
         «۳ کارِ دیگر» بی‌آنکه درخواستِ دوم بزند. */
      nextWork: work[0] ?? null,
      work,
      upcoming: upcoming.slice(0, 5).map((a) => this.appt(a)),
      openOrders: openOrders.map((o) => this.order(o, patient.code, visits)),
      billing,
      timeline: this.timeline({
        patient, visits, kindTitle, kindColor, vLabel, capped,
        appointments: appointmentsC, orders: ordersC, documents: documentsC, notes: notesC, reminders: remindersC,
      }),
      counts: {
        visits: visits.length,
        appointments: appointmentsC.length,
        openOrders: openOrders.length,
        work: work.length,
        documents: documentsC.length,
      },
    };
  }

  /* ───────────────────────── مرحله ───────────────────────── */

  /**
   * نوارِ «الان کجاییم» — شش گام که از خودِ داده مشتق می‌شوند، نه یک مسیرِ
   * بالینیِ هاردکد. هر شرکت مسیرِ خودش را دارد؛ چیزی که همه‌جا یکی است این است
   * که «نوبت گرفت → آمد → نتیجه‌اش برگشت → پیگیری → تسویه».
   *
   * ⚠️ **دقیقاً یک گام `current` است** و بقیه `todo`. وسوسه این بود که هر گامِ
   * ناتمام `current` شود (هم نتیجهٔ باز، هم بدهی)، ولی آن‌وقت نوار سه جای
   * روشن دارد و دیگر به «الان کجاییم» جواب نمی‌دهد. کارهای بازِ دیگر جای
   * خودشان را در کارتِ «کارِ بعدی» دارند.
   */
  private stage(x: any): { key: string | null; title: string; detail: string | null; steps: Step[] } {
    const { patient, visits, cycle, appointments, upcoming, orders, openOrders, billing, kindTitle, today, ordersVisible, apptVisible } = x;
    const steps: Step[] = [];
    /* ⚠️ `kindFa` هم می‌رود، نه فقط `kind`. تا دیروز کلاینت از روی `kind` و یک
       نگاشتِ **هاردکد** (`visit-kinds.js`) برچسب می‌ساخت — یعنی شرکتی که فرمش
       را «فرمِ عمل» نامیده بود، در نوارِ مرحله «عمل جراحی» می‌دید و در خطِ زمانِ
       همان صفحه «فرمِ عمل». نامی که مشتری گذاشته باید برنده باشد (قانونِ ۱۵). */
    /* نامِ گامِ مراجعه همان نامِ کارتِ مراجعه است (`visit-title.ts`) — نوار و کارت یک چیز بگویند. */
    const cycleTitle = cycle ? visitTitleOf(cycle, kindTitle[cycle.kind ?? '']) : null;
    const add = (key: string, title: string, state: Step['state'], detail: string | null, at: Date | null = null, kind: string | null = null) =>
      steps.push({
        key, title, state, detail, at,
        ...(kind ? { kind, kindFa: (key === 'visit' ? cycleTitle : null) ?? kindTitle[kind] ?? null } : {}),
      });

    add('intake', 'ثبت‌نام', 'done', 'پرونده ساخته شد', patient.createdAt);

    /* نوبت: «رد شد» وقتی بیمار اصلاً نوبت نگرفته ولی مراجعه دارد — مراجعهٔ
       حضوری حالتِ عادی است، نه گامِ ناتمام. */
    const pastAppt = appointments.find((a: any) => a.status === 'done' || a.status === 'arrived' || a.visitId);
    if (!apptVisible) {
      add('appointment', 'نوبت', 'skipped', 'ماژولِ نوبت‌دهی برای این حساب باز نیست', null);
    } else if (upcoming.length) {
      add('appointment', 'نوبت', cycle && cycle.opStatus === 'pending' ? 'done' : 'current',
        `${upcoming.length} نوبتِ پیشِ رو`, upcoming[0].date);
    } else if (pastAppt) {
      add('appointment', 'نوبت', 'done', 'نوبت گرفته شد', pastAppt.date);
    } else if (visits.length) {
      add('appointment', 'نوبت', 'skipped', 'بدونِ نوبت (حضوری)', null);
    } else {
      add('appointment', 'نوبت', 'current', 'هنوز نوبتی گرفته نشده', null);
    }

    /* ⚠️ عنوانِ گام واژهٔ حوزه است ولی **نوعِ** دوره هم می‌رود: در مطب «عملِ
       جراحی» و «ویزیت» هر دو Visit اند و نوار تا دیروز برای هر دو «ویزیت»
       می‌نوشت (اسکرین‌شاتِ مالک). کلاینت با `kind` برچسبِ درست را می‌گذارد. */
    if (!cycle) {
      add('visit', V, 'todo', `هنوز ${V}ای ثبت نشده`, null);
    } else if (cycle.opStatus === 'done') {
      add('visit', V, 'done', cycleTitle ?? 'انجام شد', cycle.opDate ?? cycle.createdAt, cycle.kind ?? null);
    } else if (cycle.opStatus === 'cancelled') {
      add('visit', V, 'skipped', `آخرین ${V} لغو شد`, cycle.opDate ?? cycle.createdAt, cycle.kind ?? null);
    } else {
      add('visit', V, 'current',
        `${cycleTitle ?? V} در انتظار`, cycle.opDate ?? cycle.createdAt, cycle.kind ?? null);
    }

    /* بی‌دسترسی ≠ بی‌سفارش: گام رد می‌شود ولی متنش دروغ نمی‌گوید. */
    if (!ordersVisible) {
      add('results', 'نتیجه‌ها', 'skipped', 'سفارش‌های بالینی برای این سطحِ دسترسی نیست', null);
    } else if (!orders.length) {
      add('results', 'نتیجه‌ها', 'skipped', 'سفارشی ثبت نشده', null);
    } else if (openOrders.length) {
      const answered = openOrders.filter((o: any) => o.status !== 'sent').length;
      add('results', 'نتیجه‌ها', 'current',
        answered ? `${answered} نتیجه آمده و بررسی نشده` : `${openOrders.length} نتیجه در انتظار`, null);
    } else {
      add('results', 'نتیجه‌ها', 'done', `${orders.length} سفارش بسته شد`, null);
    }

    /* پیگیری فقط وقتی گام است که پزشک تاریخی گذاشته باشد. */
    const nextDate: Date | null = cycle?.nextVisitDate ?? null;
    const followDone = cycle ? visits.some((v: any) => v.followOfVisitId === cycle.id) : false;
    if (!nextDate) add('followUp', 'پیگیری', 'skipped', 'تاریخِ پیگیری ثبت نشده', null);
    else if (followDone) add('followUp', 'پیگیری', 'done', `${V}ِ پیگیری ثبت شد`, nextDate);
    else if (nextDate < today) add('followUp', 'پیگیری', 'current', 'موعدِ پیگیری گذشته است', nextDate);
    else add('followUp', 'پیگیری', 'todo', 'پیگیریِ پیشِ رو', nextDate);

    if (!billing.total) add('billing', 'تسویه', 'skipped', 'صورت‌حسابی ثبت نشده', null);
    else if (billing.due <= 0) add('billing', 'تسویه', 'done', 'تسویه شد', null);
    /* ⚠️ عدد این‌جا **متن نمی‌شود**: قالبِ پول (ارقامِ فارسی، سه‌رقمی) قانونِ ۱۳
       است و یک جا دارد — `src/lib/money.js`. رشتهٔ آماده از سرور یعنی نسخهٔ
       دومِ همان قالب که با آن یکی واگرا می‌شود. کارت مبلغ را از `billing.due`
       می‌خواند. */
    else add('billing', 'تسویه', 'todo', 'صورت‌حساب تسویه نشده', null);

    /* اولین گامی که نه انجام شده و نه رد — همان‌جا ایستاده‌ایم. */
    const firstOpen = steps.find((s) => s.state === 'current')
      ?? steps.find((s) => s.state === 'todo');
    if (firstOpen && firstOpen.state === 'todo') firstOpen.state = 'current';
    for (const s of steps) if (s !== firstOpen && s.state === 'current') s.state = 'todo';

    return {
      key: firstOpen?.key ?? null,
      title: firstOpen ? firstOpen.title : 'همه‌چیزِ این دوره بسته شده',
      detail: firstOpen?.detail ?? null,
      steps,
    };
  }

  /* ───────────────────────── خطِ زمان ───────────────────────── */

  /**
   * یک خطِ زمانِ واحد از شش منبع. تا امروز هر کدام تبِ خودش را داشت و
   * «چه اتفاقی برای این بیمار افتاد» را هیچ صفحه‌ای جواب نمی‌داد.
   *
   * ⚠️ سقفِ ۸۰ ردیف **اعلام‌شده** است (`truncated`): بریدنِ بی‌صدا یعنی صفحه
   * می‌گوید «همین بود» در حالی که نبود.
   */
  private timeline(x: any): { items: TimelineItem[]; truncated: boolean; total: number } {
    const { patient, visits, appointments, orders, documents, notes, reminders, kindTitle, kindColor, vLabel, capped } = x;
    const items: TimelineItem[] = [];

    for (const v of visits) {
      items.push({
        id: `visit:${v.id}`, at: v.opDate ?? v.createdAt, type: 'visit',
        title: vLabel(v),
        detail: [v.surgeonName, v.hospitalName].filter(Boolean).join(' · ') || null,
        state: v.opStatus, stateFa: OP_STATUS_FA[v.opStatus] ?? v.opStatus,
        visitId: v.id, refType: 'visit', refId: v.id, color: kindColor[v.kind ?? ''] ?? null,
        /* `title` خودش `«نامِ نوع» + کد` است؛ `kindFa` همان را **جدا** می‌دهد تا
           کلاینت بتواند کد را `dir="ltr"` بگذارد (قانونِ ۹) بی‌آنکه مجبور شود
           نامِ نوع را از نگاشتِ هاردکدِ خودش بسازد. */
        kind: v.kind ?? null, kindFa: visitTitleOf(v, kindTitle?.[v.kind ?? '']), code: `${patient.code}-V${v.seq}`,
      });
    }
    for (const a of appointments) {
      const doc = a.doctor?.person;
      items.push({
        id: `appointment:${a.id}`, at: a.date, type: 'appointment',
        title: a.topic?.name ? `نوبتِ ${a.topic.name}` : 'نوبت',
        detail: [doc ? `${doc.firstName} ${doc.lastName}`.trim() : null, a.startMin != null ? LiveService.hhmm(a.startMin) : null]
          .filter(Boolean).join(' · ') || null,
        state: a.status, stateFa: APPT_LABELS[a.status] ?? a.status,
        visitId: a.visitId ?? a.forVisitId ?? null, refType: 'appointment', refId: a.id,
        color: a.topic?.color ?? null,
      });
    }
    for (const o of orders) {
      items.push({
        id: `${o.kind}:${o.id}`, at: o.sentAt ?? o.createdAt, type: 'order',
        title: `${o.kindFa}${o.summary ? ` — ${o.summary}` : ''}`,
        detail: o.note || null,
        state: o.status, stateFa: ORDER_STATUS_FA[o.status] ?? o.status,
        visitId: o.visitId ?? null, refType: `${o.kind}Order`, refId: o.id, color: null,
      });
    }
    for (const d of documents) {
      items.push({
        id: `document:${d.id}`, at: d.takenAt ?? d.createdAt, type: 'document',
        title: d.title || d.fileName,
        detail: DOC_CATEGORY_FA[d.category] ?? d.category,
        state: null, stateFa: null,
        visitId: d.visitId ?? null, refType: 'document', refId: d.id, color: null,
      });
    }
    for (const n of notes) {
      items.push({
        id: `note:${n.id}`, at: n.createdAt, type: 'note',
        title: n.kind || 'شرح',
        /* متن این‌جا کوتاه می‌شود نه با CSS — خطِ زمان مرورِ سریع است و شرحِ
           کامل یک کلیک آن‌طرف‌تر در تبِ شرح‌ها می‌ماند. */
        detail: LiveService.excerpt(n.body),
        state: null, stateFa: n.authorName ?? null,
        visitId: n.visitId ?? null, refType: 'note', refId: n.id, color: null,
      });
    }
    for (const r of reminders) {
      items.push({
        id: `reminder:${r.id}`, at: r.sentAt ?? r.dueAt, type: 'reminder',
        title: 'یادآوری', detail: LiveService.excerpt(r.text, 90),
        state: r.status, stateFa: REMINDER_STATUS_FA[r.status] ?? r.status,
        visitId: r.visitId ?? null, refType: 'reminder', refId: r.id, color: null,
      });
    }

    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const total = items.length;
    /* ⚠️ `truncated` باید **هر دو** بریدن را بگوید: سقفِ کل، و سقفِ هر منبع که
       پیش از ادغام خورده است. اولی از مقایسهٔ طول درمی‌آید، دومی فقط از
       `capped` — و بدونِ آن، بریدنِ منبع بی‌صدا می‌ماند. */
    return { items: items.slice(0, TIMELINE_MAX), truncated: capped || total > TIMELINE_MAX, total };
  }

  /* ───────────────────────── کمکی‌ها ───────────────────────── */

  /**
   * ⚠️ جمعِ مالی **به‌ازای هر مراجعه** حساب و بعد جمع می‌شود، نه یک‌کاسه:
   * مدلِ «گلوبال» مبلغِ توافقیِ همان مراجعه را مبنا می‌گیرد، پس ریختنِ همهٔ
   * اقلامِ همهٔ مراجعات در یک `summarize` مبلغِ توافقی را نادیده می‌گرفت.
   */
  private billing(visits: any[]) {
    let total = 0, itemsTotal = 0, paid = 0, due = 0;
    for (const v of visits) {
      /* ⚠️ مراجعهٔ **لغوشده** پول نمی‌خواهد. `setStatus` فقط `opStatus` را عوض
         می‌کند و قلم‌ها سرِ جایشان می‌مانند؛ حذفِ مراجعهٔ فاکتوردار هم عمداً
         ممنوع است و کاربر را به «لغو» می‌فرستد. پس بدونِ این شرط، هر لغوِ
         فاکتوردار یک ماندهٔ **ابدی** روی پرونده می‌گذاشت که داشبورد نشان
         نمی‌دهد (`visitStats` همان `opStatus: { not: 'cancelled' }` را دارد). */
      if (v.opStatus === 'cancelled') continue;
      const s = summarize(v.charges, v.payments, v);
      total += s.total; itemsTotal += s.itemsTotal; paid += s.paid;
      /* ⚠️ مانده **به‌ازای هر مراجعه** کف می‌خورد و بعد جمع می‌شود، نه
         `total - paid`. همان تلهٔ مستندِ `visitStats`: اضافه‌پرداختِ یک مراجعه
         بدهیِ مراجعهٔ دیگر را می‌پوشاند و گامِ «تسویه» دروغِ «تسویه شد» می‌گفت. */
      due += Math.max(0, s.due);
    }
    /* ⚠️ درصد از **همان مانده** مشتق می‌شود، نه از `paid / total`.
       با کفِ per-visit، اضافه‌پرداختِ یک مراجعه `paid` را از `total` بالاتر
       می‌برد و درصد روی ۱۰۰ می‌چسبید در حالی که مانده‌ای باقی بود — کارت
       می‌گفت «۵۰۰٬۰۰۰ مانده — ۱۰۰٪ پرداخت شده». (این با `summarize().paidPct`
       که تک‌مراجعه است فرق دارد و عمداً؛ آن‌جا چنین تناقضی ممکن نیست.) */
    const paidPct = total > 0 ? Math.min(100, Math.max(0, Math.round(((total - due) / total) * 100))) : 0;
    return { total, itemsTotal, paid, due, paidPct };
  }

  /**
   * ⚠️ چهار کوئریِ جدا در **یک آرایه** می‌ریزند، پس ترتیبِ خام «همهٔ آزمایش‌ها،
   * بعد همهٔ تصویربرداری‌ها…» است نه زمانی. بدونِ مرتب‌سازی، `trim(…, ۲۰)`
   * بیمارِ ۲۱-آزمایشی را طوری می‌برید که **هر** سفارشِ تصویربرداری/مشاوره/ارجاع
   * دور ریخته شود — یعنی «۱ نتیجه آمده و بررسی نشده» بی‌صدا ناپدید می‌شد.
   *
   * ⚠️ و سقف هم نباید سفارشِ **باز** را پنهان کند: بازها کم‌اند و کارِ همین
   * حالا؛ بسته‌ها تاریخچه‌اند. پس بازها کامل می‌مانند و سقف فقط دنبالهٔ بسته‌ها
   * را می‌برد.
   */
  private async orders(patientId: number) {
    const out: any[] = [];
    for (const k of ORDER_KINDS) {
      const table = (this.prisma as any)[`${k.key}Order`];
      const rows = await table.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' }, take: CAP.orders + 1,
      });
      out.push(...rows.map((r: any) => ({
        ...r, kind: k.key, kindFa: k.fa, summary: LiveService.orderSummary(k.key, r),
      })));
    }
    const when = (o: any) => new Date(o.sentAt ?? o.createdAt).getTime();
    out.sort((a, b) => when(b) - when(a));
    const open = out.filter((o) => OPEN_ORDER.includes(o.status));
    const closed = out.filter((o) => !OPEN_ORDER.includes(o.status));
    return [...open, ...closed.slice(0, Math.max(0, CAP.orders - open.length))]
      .sort((a, b) => when(b) - when(a));
  }

  private order(o: any, code: string, visits: any[]) {
    const v = o.visitId ? visits.find((x) => x.id === o.visitId) : null;
    return {
      id: o.id, kind: o.kind, kindFa: o.kindFa, summary: o.summary,
      status: o.status, statusFa: ORDER_STATUS_FA[o.status] ?? o.status,
      dueDate: o.dueDate ?? null, sentAt: o.sentAt ?? null, updatedAt: o.updatedAt,
      visitId: o.visitId ?? null, visitCode: v ? `${code}-V${v.seq}` : null,
      /* «نتیجه آمده ولی بررسی نشده» کاری است که همین حالا می‌شود کرد؛
         «فرستاده شده» یعنی منتظریم. تفکیکشان در UI لازم است. */
      awaitingReview: o.status !== 'sent',
    };
  }

  private appt(a: any) {
    const doc = a.doctor?.person;
    return {
      id: a.id, date: a.date, startMin: a.startMin ?? null,
      time: a.startMin != null ? LiveService.hhmm(a.startMin) : null,
      status: a.status, statusFa: APPT_LABELS[a.status] ?? a.status,
      topic: a.topic?.name ?? null, doctorName: doc ? `${doc.firstName} ${doc.lastName}`.trim() : null,
      visitId: a.visitId ?? a.forVisitId ?? null, note: a.note ?? null,
    };
  }

  private static orderSummary(kind: string, r: any): string | null {
    if (kind === 'lab') return (r.tests ?? []).join('، ') || null;
    if (kind === 'imaging') return [(r.modalities ?? []).join('، '), r.region].filter(Boolean).join(' — ') || null;
    /* مشاوره و ارجاع هر دو «تخصص + پزشک» دارند. */
    return [r.specialty, r.doctorName].filter(Boolean).join(' — ') || null;
  }

  private static hhmm(min: number) {
    const h = Math.floor(min / 60), m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  private static excerpt(body: string | null, max = 120) {
    const t = (body ?? '').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    return t.length > max ? `${t.slice(0, max)}…` : t;
  }
}
