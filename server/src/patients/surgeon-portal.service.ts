import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { AuditService } from '../audit/audit.service';
import { verificationDeadline } from '../accounts/provisional';
import { LEVEL } from '../common/levels';
import { isUnrestricted } from '../common/own-scope';
import { toEnDigits } from '../common/identity';
import { RequiredItemInput, resolveRequirements } from './visit-requirements';
import { kitTemplate, NEEDS_SELECT, OTHER_PX_KIT, procedureLabel } from './visit-coding';
import { visitIsImplant } from './intake-service-of';
import { summarize } from './billing.service';
import { APPT_LABELS, OP_LABELS } from './labels';
import { clinicTodayIso, dayRangeUtc } from '../common/clinic-day';
import { monthDayCounts } from './month-summary';
import { ORDER_LABELS } from './labels';

/**
 * مدارکی که جراح روی مراجعهٔ خودش می‌بیند — گزارش‌ها، «متفرقه»، و **دستورِ خودِ جراح** که بیمار در
 * ثبت‌نام فرستاده. ⚠️ تا ۱۴۰۵/۰۷/۰۱ دستورِ پزشک «متفرقه» ذخیره می‌شد و از همان راه این‌جا دیده می‌شد؛
 * با دستهٔ تازه‌اش (`document-categories.ts`) اگر این‌جا نمی‌آمد، بی‌صدا از پرتالِ جراح می‌افتاد.
 * مدرکِ هویتی و فیش عمداً نیستند.
 */
const SURGEON_DOC_CATEGORIES = ['report', 'op-report', 'other', 'prescription'];

type NamedPerson = { firstName: string | null; lastName: string | null } | null | undefined;
const personName = (p: NamedPerson) => (p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || null : null);
/** نامِ پزشکِ یک مراجعه: تعریفِ جراح، وگرنه نامِ denormalizeشده روی خودِ مراجعه. */
const visitDoctor = (v: { surgeon?: { person: NamedPerson } | null; surgeonName?: string | null } | null | undefined) =>
  (v ? personName(v.surgeon?.person) ?? (v.surgeonName?.trim() || null) : null);
const DOCTOR_SELECT = { surgeonName: true, surgeon: { select: { person: { select: { firstName: true, lastName: true } } } } } as const;
/* ردیفِ بی‌پزشک در نمای ادغامی هم باید بگوید مالِ کیست — «هیچ‌کس» هم یک پاسخ است. */
const NO_DOCTOR = 'پزشک تعیین نشده';

/**
 * دامنهٔ یک درخواستِ میز — «کدام پزشک، و چه کسی می‌پرسد».
 *
 * - `team`: نمای ادغامیِ همهٔ پزشکان (فقط سوپرادمینِ بی‌انتخاب) — هر ردیف نامِ پزشکش را می‌گیرد.
 * - `doctor`: پزشکی که سوپرادمین انتخاب کرده؛ `accountId` حسابِ فعالِ همان شخص است تا
 *   رابط صفِ کارِ او را بخواهد (`/work?owner=`) بی‌آنکه خودش شخص را به حساب نگاشت کند.
 */
type DeskScope = {
  where: { surgeonId?: number };
  unrestricted: boolean;
  team: boolean;
  doctor: { id: number; name: string; accountId: number | null } | null;
};



@Injectable()
export class SurgeonPortalService {
  constructor(private prisma: PrismaService, private config: ConfigService, private audit: AuditService) {}

  /**
   * دامنهٔ پرتال: مراجعه‌های جراحِ متصل به همین حساب؛ سوپرادمین همه.
   *
   * ⚠️ تا بستهٔ ۵ (بازخوردِ مالک ۱۴۰۵/۰۶/۲۹) مطب صریحاً رد می‌شد («پزشک از داشبورد
   * استفاده می‌کند»). حالا در هر سه حوزه یکی است: در مطب همین پرتال «میزِ پزشک» است
   * و همهٔ نوع‌های مراجعه (ویزیت/عمل/پیگیری) را می‌آورد، نه فقط عمل. جراح از
   * `user.surgeonId` می‌آید (یک‌بار در `validateSession`)، با fallback به جستجو.
   */
  private async scope(user: any): Promise<{ surgeonId?: number }> {
    if (isUnrestricted(user)) return {};
    if (Number.isInteger(user?.surgeonId) && user.surgeonId > 0) return { surgeonId: user.surgeonId as number };
    const account = await this.prisma.account.findUnique({ where: { id: user?.id ?? -1 }, select: { personId: true, status: true } });
    const surgeon = account?.status === 'active' ? await this.prisma.surgeon.findFirst({ where: { personId: account.personId, active: true }, select: { id: true } }) : null;
    if (!surgeon) throw new ForbiddenException('حساب شما به جراح فعال در تعاریف پایه متصل نیست');
    return { surgeonId: surgeon.id };
  }

  /**
   * **سوپرادمین بی‌محدودیت است** (قانونِ ۲۹، خواستهٔ مالک ۱۴۰۵/۰۷/۰۳): میزِ پزشک برای او
   * «میزِ همهٔ پزشکان» است، یا میزِ **یک** پزشک که خودش انتخاب کرده — بی‌آنکه برای دیدن
   * یا انجامِ کارِ آن پزشک پروفایل عوض کند.
   *
   * ⚠️ `picked` شناسهٔ **پزشکِ دیگر** است و فقط سوپرادمین می‌تواند بدهدش. بقیه (پزشک،
   * ادمینِ سطح ۵) اگر شناسهٔ خودشان را بدهند همان دامنهٔ همیشگی را می‌گیرند و اگر شناسهٔ
   * دیگری بدهند ۴۰۳ — نه نادیده‌گرفتنِ بی‌صدا، که درخواستِ دست‌ساز را پنهان کند.
   */
  private async deskScope(user: any, picked?: number): Promise<DeskScope> {
    const unrestricted = isUnrestricted(user);
    if (picked === undefined) return { where: await this.scope(user), unrestricted, team: unrestricted, doctor: null };
    if (!unrestricted) {
      const own = await this.scope(user);
      if (own.surgeonId !== picked) throw new ForbiddenException('دیدنِ میزِ پزشکِ دیگر فقط برای مدیرِ سامانه مجاز است');
      return { where: own, unrestricted, team: false, doctor: null };
    }
    const surgeon = await this.prisma.surgeon.findUnique({
      where: { id: picked },
      select: { id: true, person: { select: { firstName: true, lastName: true, account: { select: { id: true, status: true } } } } },
    });
    if (!surgeon) throw new NotFoundException('پزشک پیدا نشد');
    const account = surgeon.person.account;
    return {
      where: { surgeonId: surgeon.id }, unrestricted, team: false,
      doctor: { id: surgeon.id, name: personName(surgeon.person) ?? 'پزشک', accountId: account?.status === 'active' ? account.id : null },
    };
  }

  /**
   * «من کیستم روی این میز» — رابط از این‌جا می‌فهمد نمای ناظر است یا نه و فهرستِ پزشکان
   * را برای انتخابگر می‌گیرد (قانونِ ۳: رابط سطح را حساب نمی‌کند).
   *
   * ⚠️ برای هیچ‌کس ۴۰۳ نمی‌دهد: پزشکِ سطح ۲ هم این را می‌خوانَد و جوابش «ناظر نیستی» است.
   * ۴۰۳ این‌جا یعنی خطای کنسول روی میزِ هر پزشک (سنجهٔ «هیچ ۴۰۳ی» در `clinic-doctor-portal`).
   */
  async desk(user: any) {
    const selfSurgeonId = Number.isInteger(user?.surgeonId) && user.surgeonId > 0 ? (user.surgeonId as number) : null;
    if (!isUnrestricted(user)) return { unrestricted: false, selfSurgeonId, doctors: [] };
    const rows = await this.prisma.surgeon.findMany({
      where: { active: true }, orderBy: [{ person: { lastName: 'asc' } }, { id: 'asc' }],
      select: { id: true, specialty: true, person: { select: { firstName: true, lastName: true, account: { select: { id: true, status: true } } } } },
    });
    /* صاحبِ مطبی که خودش پزشک است میزِ **خودش** را از همین فهرست برمی‌دارد: `me` و
       برچسبِ «(خودم)» از سرور (قانونِ ۱۵، همان قراردادِ `assignees`ِ صفِ کار)، و اولِ
       فهرست — نه گم‌شده میانِ نام‌های الفبایی. */
    const doctors = rows.map((s) => {
      const name = personName(s.person) ?? `پزشکِ ${s.id}`;
      const me = s.id === selfSurgeonId;
      return {
        id: s.id, name, label: me ? `${name} (خودم)` : name, me, specialty: s.specialty,
        accountId: s.person.account?.status === 'active' ? s.person.account.id : null,
      };
    });
    return { unrestricted: true, selfSurgeonId, doctors: [...doctors.filter((d) => d.me), ...doctors.filter((d) => !d.me)] };
  }

  /**
   * نوبتِ «بیمارِ این پزشک» — یک تعریف برای `today()` و `month()`.
   * نمای ادغامی بی‌قید است؛ پزشکِ انتخاب‌شده با حسابِ خودش (اگر دارد) و بیمارانش.
   */
  private apptScope(desk: DeskScope, user: any) {
    if (desk.team) return {};
    const doctorAccount = desk.doctor ? desk.doctor.accountId ?? -1 : user?.id ?? -1;
    return { OR: [{ doctorId: doctorAccount }, { patient: { visits: { some: desk.where } } }] };
  }

  /**
   * «امروزِ من» — همان projectionِ صفحهٔ «امروز» ولی با دامنهٔ پزشک (قانونِ ۱۵: عددها
   * سمتِ سرور): نوبت‌های امروزِ او، مراجعه‌های امروزش، و هر نتیجه‌ای که برای بیمارانِ
   * او آمده و بررسی نشده (همهٔ روزها — نتیجهٔ نخوانده تاریخ نمی‌شناسد). کارهای بازِ
   * او را رابط از `GET /work?scope=inbox` می‌گیرد که خودش به نامِ کاربر است.
   */
  /**
   * شمارشِ روزهای یک ماهِ شمسی — نشانهٔ تقویمِ انتخابِ تاریخِ همین میز.
   *
   * ⚠️ دامنه **همان `scope`ِ خودِ پزشک** است، نه کلِ شرکت: نشانهٔ روز نباید
   * بگوید «فردا شلوغ است» وقتی هیچ‌کدام از آن مراجعه‌ها مالِ این پزشک نیست.
   * و نوبت‌ها با همان قاعدهٔ `today()` دامنه می‌خورند (بیمارِ من)، وگرنه دو
   * تعریفِ متفاوت از «نوبتِ من» می‌ساختیم.
   */
  async month(user: any, jy: number, jm: number, picked?: number) {
    const desk = await this.deskScope(user, picked);
    return monthDayCounts(this.prisma, jy, jm, {
      visitWhere: { ...desk.where, opStatus: { not: 'cancelled' }, patient: { deletedAt: null } },
      apptWhere: { status: { not: 'cancelled' }, ...this.apptScope(desk, user) },
    });
  }

  /**
   * میزِ پزشک — **یک روز**، پیش‌فرض امروز.
   *
   * ⚠️ `date` اختیاری اضافه شد چون میزِ پزشک تنها میزی بود که **هیچ
   * انتخابگرِ تاریخی نداشت**: پزشک نمی‌توانست برنامهٔ فردا را ببیند و
   * دیروز را هم نه. بازخوردِ مالک ۱۴۰۵/۰۶/۳۱ صریحاً «تقویم‌ها … تو میزِ
   * پزشک» را نام برد.
   */
  async today(user: any, dateIso?: string, picked?: number) {
    const desk = await this.deskScope(user, picked);
    const scope = desk.where;
    /* نامِ پزشکِ هر ردیف فقط در نمای ادغامی — روی میزِ یک پزشک تکرارِ بی‌فایده است. */
    const docLabel = (name: string | null) => (desk.team ? name ?? NO_DOCTOR : null);
    /* ⚠️ سقفِ ۴۰/۶۰/۲۰ برای میزِ **یک** پزشک است. نمای ادغامی روزِ کلِ مطب است و با
       همان سقف ردیف‌های آخر (بی‌ساعت‌ها و تازه‌ترین نتیجه‌ها) بی‌صدا می‌افتادند — «همه را
       ببیند» یعنی همه، نه چهل‌تای اول. */
    const cap = desk.team ? { visits: 200, appts: 300, orders: 60 } : { visits: 40, appts: 60, orders: 20 };
    const now = new Date();
    /* «امروز» به وقتِ مطب (`common/clinic-day.ts`) — نه ساعتِ کانتینر. */
    const iso = dateIso && /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? dateIso : clinicTodayIso(now);
    const [start, end] = dayRangeUtc(iso);
    /* ستونِ `Appointment.date` از نوعِ `DATE` است و قراردادِ کلِ ماژول این است که
       نیمه‌شبِ UTCِ همان روز ساخته شود (`appointments.service`).
       ⚠️ حالا `start` خودش **همان** نیمه‌شبِ UTC است (`todayRangeUtc`)، پس
       بازسازیِ دستیِ روز از اجزای محلی لازم نیست. نسخهٔ قبلی این کار را
       می‌کرد تا از تلهٔ «نیمه‌شبِ محلی → روزِ UTCِ قبل» فرار کند؛ آن تله با
       یکی‌شدنِ تعریفِ «امروز» از ریشه رفت. */
    const day = start;
    const person = (p: any) => (p ? { id: p.id, code: p.code, fullName: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() } : null);
    const patientSel = { select: { id: true, code: true, firstName: true, lastName: true } };
    const [visits, appointments] = await Promise.all([
      this.prisma.visit.findMany({
        where: { ...scope, opDate: { gte: start, lte: end }, opStatus: { not: 'cancelled' }, patient: { deletedAt: null } },
        orderBy: [{ opStartTime: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }], take: cap.visits,
        select: {
          id: true, seq: true, kind: true, opStartTime: true, opStatus: true, hospitalName: true, patient: patientSel, topic: { select: { name: true } },
          ...DOCTOR_SELECT,
          /* پول هم لازم است: میزِ پزشکِ مطب باید بداند بیمارِ امروزش تسویه کرده
             یا نه (قانونِ ۱۷ — خلاصهٔ مالیِ پایه، فقط‌خواندنی و تک‌منبع). */
          pricingModel: true, globalAmount: true,
          charges: { select: { amount: true } }, payments: { select: { amount: true } },
        },
      }),
      this.prisma.appointment.findMany({
        /**
         * ⚠️ **نوبت را با `doctorId` دامنه نده.** آن ستون در `Appointment` هست ولی
         * هیچ مسیرِ واقعی‌ای پرش نمی‌کند: نه `appointments.service.walkIn` و نه
         * `intake.service` (نوبتِ فرمِ بیمار) آن را می‌نویسند. نسخهٔ اولِ همین متد
         * رویش فیلتر می‌کرد و نتیجه‌اش این بود که «نوبت‌های امروز» برای هر پزشکِ
         * غیرِ سوپرادمین **همیشه خالی** بماند — و سوییتِ e2e هم نمی‌گرفتش چون
         * خودش ردیف را با `doctor_id` دستی درج می‌کرد (سنجهٔ توتولوژیک).
         *
         * دامنهٔ درست همان قاعدهٔ بقیهٔ میز است: نوبتِ **بیمارِ من** — بیماری که
         * دستِ‌کم یک مراجعه به نامِ این جراح دارد. `doctorId` هم اگر روزی نوشته
         * شد سرِ جایش می‌ماند (شاخهٔ اول).
         */
        where: { date: day, status: { not: 'cancelled' }, ...this.apptScope(desk, user) },
        orderBy: [{ startMin: { sort: 'asc', nulls: 'last' } }, { seq: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }], take: cap.appts,
        select: {
          id: true, startMin: true, seq: true, status: true, visitId: true, date: true, patient: patientSel, topic: { select: { name: true } },
          /* پزشکِ نوبت برای برچسبِ نمای ادغامی: حسابِ پزشکِ نوبت، وگرنه پزشکِ مراجعه‌اش. */
          doctor: { select: { person: { select: { firstName: true, lastName: true } } } },
          visit: { select: DOCTOR_SELECT }, forVisit: { select: DOCTOR_SELECT },
        },
      }),
    ]);
    const kinds: { key: string; table: any; fa: string }[] = [
      { key: 'lab', table: this.prisma.labOrder, fa: 'آزمایش' },
      { key: 'imaging', table: this.prisma.imagingOrder, fa: 'تصویربرداری' },
      { key: 'consult', table: this.prisma.consultOrder, fa: 'مشاوره' },
    ];
    const unreviewed: any[] = [];
    for (const k of kinds) {
      const rows = await k.table.findMany({
        where: { status: { in: ['answered', 'in_review'] }, visit: { ...scope, patient: { deletedAt: null } } },
        orderBy: { updatedAt: 'asc' }, take: cap.orders,
        select: { id: true, patientId: true, visitId: true, status: true, updatedAt: true, patient: patientSel, visit: { select: DOCTOR_SELECT } },
      });
      unreviewed.push(...rows.map((r: any) => ({ id: r.id, kind: k.key, kindFa: k.fa, status: r.status, statusFa: ORDER_LABELS[r.status] ?? r.status, visitId: r.visitId, updatedAt: r.updatedAt, patientId: r.patientId, patient: person(r.patient), doctor: docLabel(visitDoctor(r.visit)) })));
    }
    unreviewed.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
    /* سقفِ ۲۰ در هر نوع یعنی ممکن است چیزی از قلم بیفتد؛ شمارشِ واقعی برمی‌گردد
       تا رابط بتواند «و N تای دیگر» بگوید، نه اینکه بی‌صدا کمتر نشان بدهد. */
    const unreviewedTotal = (await Promise.all(kinds.map((k) => k.table.count({
      where: { status: { in: ['answered', 'in_review'] }, visit: { ...scope, patient: { deletedAt: null } } },
    })))).reduce((a: number, b: number) => a + b, 0);
    const hhmm = (m: number | null) => (m == null ? null : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    const visitViews = visits.map((v) => ({
      id: v.id, code: `${v.patient.code}-V${v.seq}`, kind: v.kind, opStartTime: v.opStartTime,
      opStatus: v.opStatus, opStatusFa: OP_LABELS[v.opStatus] ?? v.opStatus,
      hospital: v.hospitalName, topic: v.topic?.name ?? null, patientId: v.patient.id, patient: person(v.patient),
      doctor: docLabel(visitDoctor(v)),
      billing: summarize(v.charges, v.payments, v),
    }));
    const apptViews = appointments.map((a) => ({
      id: a.id, time: hhmm(a.startMin), seq: a.seq, status: a.status, statusFa: APPT_LABELS[a.status] ?? a.status,
      visitId: a.visitId, date: a.date,
      topic: a.topic?.name ?? null, patientId: a.patient?.id ?? null, patient: person(a.patient),
      doctor: docLabel(personName(a.doctor?.person) ?? visitDoctor(a.visit) ?? visitDoctor(a.forVisit)),
    }));
    return {
      now: now.toISOString(),
      /* نمای ناظر (قانونِ ۲۹) — رابط برچسب‌ها و راهنما را از همین‌ها می‌چیند، نه از سطح. */
      unrestricted: desk.unrestricted,
      team: desk.team,
      doctor: desk.doctor ? { id: desk.doctor.id, name: desk.doctor.name } : null,
      /* حسابِ پزشکِ انتخاب‌شده — برای `GET /work?owner=`؛ پزشکِ بی‌حساب کاری به نامش ندارد. */
      doctorAccountId: desk.doctor?.accountId ?? null,
      /* روزِ نمایش‌داده‌شده و اینکه امروز است یا نه — تا سربرگ بتواند «امروز»
         را از «۳ مهر» تفکیک کند بی‌آنکه خودش تاریخ را دوباره حساب کند. */
      date: iso,
      isToday: iso === clinicTodayIso(now),
      visits: visitViews,
      appointments: apptViews,
      day: SurgeonPortalService.mergeDay(visitViews, apptViews),
      summary: {
        appointments: apptViews.length,
        present: apptViews.filter((a) => a.status === 'arrived').length,
        doneAppointments: apptViews.filter((a) => a.status === 'done').length,
        visits: visitViews.length,
        openVisits: visitViews.filter((v) => v.opStatus === 'pending').length,
        unreviewed: unreviewedTotal,
        /* قانونِ ۱۳: همه تومان، عددِ صحیح. عنوانِ رابط «صورت‌حسابِ امروز» است،
           نه «درآمدِ امروز» — این جمعِ مراجعه‌های همین روز است، نه گردشِ صندوق. */
        money: visitViews.reduce(
          (acc, v) => ({ total: acc.total + v.billing.total, paid: acc.paid + v.billing.paid, due: acc.due + v.billing.due }),
          { total: 0, paid: 0, due: 0 },
        ),
      },
      unreviewed,
      unreviewedTotal,
    };
  }

  /**
   * **یک بیمار، یک ردیف** — نوبت و مراجعهٔ یک نفر در یک روز یک رویدادند.
   *
   * 🔴 چرا این تابع نوشته شد: میز دو فهرستِ جدا نشان می‌داد («نوبت‌های امروز» و
   * «مراجعه‌های امروز») که در مطبِ تک‌پزشک **همان آدم‌ها** بودند — هفت بیمار،
   * چهارده ردیف. روی موبایل یعنی دو برابر اسکرول برای همان اطلاعات، و پزشک
   * باید خودش دو فهرست را با چشم روی هم می‌گذاشت تا بفهمد «رضا کریمی رسید و
   * مراجعه‌اش هم باز است».
   *
   * ⚠️ ادغام با `patientId` فقط وقتی مجاز است که برای آن بیمار **دقیقاً یک**
   * نوبتِ بی‌مراجعه و **دقیقاً یک** مراجعهٔ بی‌نوبت مانده باشد. بیماری که صبح
   * ویزیت شده و عصر دوباره نوبت دارد دو رویدادِ واقعی دارد؛ چسباندنشان یعنی
   * دروغ‌گفتن دربارهٔ برنامهٔ روز. `visitId` (وقتی هست) همیشه مقدم است.
   */
  private static mergeDay(visits: any[], appts: any[]) {
    const rows = visits.map((v) => ({
      key: `v${v.id}`, visitId: v.id as number | null, patientId: v.patientId, patient: v.patient,
      code: v.code as string | null, kind: v.kind as string | null,
      topic: v.topic as string | null, hospital: v.hospital as string | null,
      opStatus: v.opStatus as string | null, opStatusFa: (OP_LABELS[v.opStatus] ?? v.opStatus) as string | null,
      doctor: (v.doctor ?? null) as string | null,
      billing: v.billing as { total: number; itemsTotal: number; paid: number; due: number; paidPct: number } | null,
      time: v.opStartTime ?? null, seq: null as number | null,
      apptId: null as number | null, apptStatus: null as string | null, apptStatusFa: null as string | null,
    }));
    const byVisit = new Map<number, any>(rows.map((r) => [r.visitId as number, r]));
    const attach = (row: any, a: any) => {
      row.apptId = a.id; row.apptStatus = a.status; row.apptStatusFa = APPT_LABELS[a.status] ?? a.status;
      row.time = a.time ?? row.time; row.seq = a.seq ?? row.seq; row.topic = row.topic ?? a.topic;
      /* پزشکِ مراجعه مقدم است؛ نوبت فقط وقتی که مراجعه پزشک نداشت. */
      if (row.doctor == null || row.doctor === NO_DOCTOR) row.doctor = a.doctor ?? row.doctor;
    };
    /* شمارشِ نامزدها **قبل از** هر چسباندنی — وگرنه ترتیبِ حلقه تصمیم می‌گیرد. */
    const loose = appts.filter((a) => !(a.visitId && byVisit.has(a.visitId)));
    const freeVisits = rows.filter((r) => !appts.some((a) => a.visitId === r.visitId));
    const count = (list: any[], pid: number | null) => list.filter((x) => x.patientId === pid).length;
    for (const a of appts) {
      if (a.visitId && byVisit.has(a.visitId)) { attach(byVisit.get(a.visitId), a); continue; }
      const one = count(loose, a.patientId) === 1 && count(freeVisits, a.patientId) === 1
        ? freeVisits.find((r) => r.patientId === a.patientId)
        : null;
      if (one && !one.apptId) { attach(one, a); continue; }
      rows.push({
        key: `a${a.id}`, visitId: null, patientId: a.patientId, patient: a.patient,
        code: null, kind: null, topic: a.topic, hospital: null,
        opStatus: null, opStatusFa: null, doctor: a.doctor ?? null, billing: null,
        time: a.time, seq: a.seq,
        apptId: a.id, apptStatus: a.status, apptStatusFa: APPT_LABELS[a.status] ?? a.status,
      });
    }
    /* بی‌ساعت‌ها ته فهرست — نه اولِ آن (مرتب‌سازیِ خام `null` را اول می‌گذارد). */
    return rows.sort((x, y) => (x.time ?? '99:99').localeCompare(y.time ?? '99:99') || (x.seq ?? 1e9) - (y.seq ?? 1e9) || x.key.localeCompare(y.key));
  }

  private async visit(id: number, user: any) {
    const scope = await this.scope(user);
    const row = await this.prisma.visit.findFirst({ where: { id, ...scope, patient: { deletedAt: null } } });
    if (!row) throw new NotFoundException('مراجعه پیدا نشد');
    return row;
  }

  async list(user: any, query = '', page = 1, picked?: number) {
    const desk = await this.deskScope(user, picked);
    const scope = desk.where;
    const q = query.trim().slice(0, 80), current = Number.isFinite(page) ? Math.min(100000, Math.max(1, Math.floor(page) || 1)) : 1;
    const where = { ...scope, patient: { deletedAt: null, ...(q ? { OR: [{ firstName: { contains: toEnDigits(q) } }, { lastName: { contains: toEnDigits(q) } }, { code: { contains: toEnDigits(q) } }] } : {}) } };
    const profile = await this.config.profile();
    const [rows, total] = await Promise.all([
      this.prisma.visit.findMany({ where, orderBy: [{ opDate: 'desc' }, { id: 'desc' }], take: 25, skip: (current - 1) * 25,
        select: { id: true, seq: true, kind: true, opDate: true, opStartTime: true, opEndTime: true, opStatus: true, opType: true, hospitalName: true, surgeonName: true, requiredItems: true, surgeonInstructions: true, service: true,
          patient: { select: { id: true, code: true, firstName: true, lastName: true } }, hospital: { select: { name: true } }, topic: { select: { name: true } }, procedureType: { select: { name: true, needs: NEEDS_SELECT } },
          /* بستهٔ ۷ج: عمل‌های همزمانِ جلسه — برای برچسب و اجتماعِ کیت (`kitTemplate`). */
          otherProcedures: OTHER_PX_KIT,
          surgeon: { select: { person: { select: { firstName: true, lastName: true } } } },
          clinicalNotes: { where: { kind: 'op', replacedAt: null }, select: { body: true, createdAt: true }, orderBy: { id: 'desc' }, take: 1 },
          documents: { where: { deletedAt: null, category: { in: SURGEON_DOC_CATEGORIES } }, select: { id: true, title: true, fileName: true }, orderBy: { id: 'desc' } },
        } }),
      this.prisma.visit.count({ where }),
    ]);
    return { rows: rows.map(v => ({ id: v.id, patientId: v.patient.id, code: `${v.patient.code}-V${v.seq}`, fullName: `${v.patient.firstName} ${v.patient.lastName}`.trim(),
      kind: v.kind, topic: v.topic?.name ?? null,
      opDate: v.opDate, opStartTime: v.opStartTime, opEndTime: v.opEndTime,
      opStatus: v.opStatus, opStatusFa: OP_LABELS[v.opStatus] ?? v.opStatus,
      procedure: procedureLabel(v),
      hospital: v.hospital?.name ?? v.hospitalName, surgeon: v.surgeon ? `${v.surgeon.person.firstName} ${v.surgeon.person.lastName}` : v.surgeonName,
      /* برچسبِ «مالِ کدام پزشک» فقط در نمای ادغامیِ سوپرادمین (قانونِ ۲۹) — روی میزِ یک پزشک تکرار است. */
      doctor: desk.team ? visitDoctor(v) ?? NO_DOCTOR : null,
      /* ⚠️ مشتقِ سرور (قانون ۱۵) و **per-مراجعه**: در شرکتِ دوخدمته ویرایشگرِ اقلام
         فقط روی مراجعهٔ ایمپلنتی — نه روی همه، نه روی هیچ‌کدام (`visitIsImplant`). */
      implant: visitIsImplant(v.requiredItems, profile, v.service),
      /* ⚠️ قاعدهٔ override همان دیروز: `requiredItems`ِ ذخیره‌شده (غیرِ null) برنده
         است. فقط الگو حالا اجتماعِ نیازِ همهٔ عمل‌های جلسه است. */
      requiredItems: v.requiredItems ?? kitTemplate(v).map(n => ({ itemId: n.itemId, quantity: n.quantity, notes: n.notes ?? '', name: [n.item?.name, n.item?.size].filter(Boolean).join(' ') })), instructions: v.surgeonInstructions ?? '', report: v.clinicalNotes[0]?.body ?? null, documents: v.documents,
    })), total, page: current, pages: Math.max(1, Math.ceil(total / 25)), workflow: await this.config.vertical(), services: profile.services,
      unrestricted: desk.unrestricted, team: desk.team, doctor: desk.doctor ? { id: desk.doctor.id, name: desk.doctor.name } : null };
  }

  async finances(user: any, selectedId?: number, page = 1) {
    const scope = await this.scope(user);
    const surgeonId = scope.surgeonId ?? selectedId;
    if (!Number.isInteger(surgeonId) || !surgeonId || surgeonId < 1) return { selectionRequired: true, rows: [], total: 0 };
    const surgeon = await this.prisma.surgeon.findFirst({ where: { id: surgeonId, active: true }, select: { person: { select: { firstName: true, lastName: true } } } });
    if (!surgeon) throw new NotFoundException('جراح فعال پیدا نشد');
    const current = Number.isFinite(page) ? Math.max(1, Math.min(100000, Math.floor(page))) : 1;
    const visitScope = { surgeonId, patient: { deletedAt: null } };
    const shares = { party: 'surgeon', partyId: surgeonId, settlement: { status: 'final', supersededAt: null, visit: visitScope } };
    const payouts = { party: 'surgeon', partyId: surgeonId, visit: visitScope };
    return this.prisma.$transaction(async tx => {
      const [earned, paid, total, visits] = await Promise.all([
        tx.shareEntry.aggregate({ where: shares, _sum: { amount: true } }),
        tx.payout.aggregate({ where: payouts, _sum: { amount: true } }),
        tx.visit.count({ where: visitScope }),
        tx.visit.findMany({ where: visitScope, orderBy: [{ opDate: 'desc' }, { id: 'desc' }], take: 25, skip: (current - 1) * 25,
          select: { id: true, seq: true, opDate: true, hospitalName: true, hospital: { select: { name: true } }, patient: { select: { code: true, firstName: true, lastName: true } },
            settlements: { where: { status: 'final', supersededAt: null }, select: { entries: { where: { party: 'surgeon', partyId: surgeonId }, select: { amount: true } } } },
            payouts: { where: { party: 'surgeon', partyId: surgeonId }, select: { id: true, amount: true, paidAt: true, reference: true }, orderBy: { paidAt: 'desc' } },
          } }),
      ]);
      return { surgeon: `${surgeon.person.firstName} ${surgeon.person.lastName}`, currency: 'تومان', earned: earned._sum.amount ?? 0, paid: paid._sum.amount ?? 0,
        balance: (earned._sum.amount ?? 0) - (paid._sum.amount ?? 0), total, page: current, pages: Math.max(1, Math.ceil(total / 25)),
        rows: visits.map(v => { const due = v.settlements.flatMap(s => s.entries).reduce((n, e) => n + e.amount, 0), paid = v.payouts.reduce((n, p) => n + p.amount, 0);
          return { id: v.id, code: `${v.patient.code}-V${v.seq}`, patient: `${v.patient.firstName} ${v.patient.lastName}`, date: v.opDate, hospital: v.hospital?.name ?? v.hospitalName, finalized: v.settlements.length > 0, earned: due, paid, balance: due - paid, payments: v.payouts };
        }) };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async saveInstructions(id: number, dto: { instructions: string; requiredItems?: RequiredItemInput[] }, user: any) {
    const before = await this.visit(id, user);
    const scope = await this.scope(user);
    /* «طبقِ نسخه» از ردیف‌های فعلی حمل می‌شود — ویرایشِ جراح فقط برنامه را عوض می‌کند. */
    const requiredItems = dto.requiredItems === undefined ? undefined : await resolveRequirements(this.prisma, dto.requiredItems, { previous: before.requiredItems });
    const after = { surgeonInstructions: dto.instructions.trim(), ...(requiredItems !== undefined ? { requiredItems } : {}) };
    await this.prisma.$transaction(async tx => {
      const result = await tx.visit.updateMany({ where: { id, ...scope, patient: { deletedAt: null } }, data: after });
      if (!result.count) throw new NotFoundException('مراجعه پیدا نشد');
      await tx.auditEvent.create({ data: { actorId: user.id, action: 'surgeon.instructions', entityType: 'visit', entityId: String(id), beforeJson: { surgeonInstructions: before.surgeonInstructions, requiredItems: before.requiredItems }, afterJson: after } });
    });
    return { ok: true };
  }

  async document(id: number, documentId: number, user: any) {
    await this.visit(id, user);
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, visitId: id, deletedAt: null, category: { in: SURGEON_DOC_CATEGORIES } } });
    if (!doc) throw new NotFoundException('مدرک پیدا نشد');
    return doc;
  }

  async items(user: any, query = '') {
    await this.scope(user);
    return this.prisma.item.findMany({ where: { active: true, name: { contains: toEnDigits(query.trim().slice(0, 80)), mode: 'insensitive' } }, take: 100, orderBy: { name: 'asc' }, select: { id: true, name: true, size: true, unit: true } });
  }

  async grantAccount(surgeonId: number, user: any) {
    if ((user?.level ?? 0) < LEVEL.SUPER_ADMIN) throw new ForbiddenException('ایجاد حساب جراح فقط برای مدیر سامانه مجاز است');
    await this.scope(user);
    const surgeon = await this.prisma.surgeon.findFirst({ where: { id: surgeonId, active: true }, include: { person: { include: { account: true } } } });
    if (!surgeon) throw new NotFoundException('جراح پیدا نشد');
    if (!/^09\d{9}$/.test(surgeon.person.phone ?? '')) throw new BadRequestException('شماره موبایل جراح را در تعاریف پایه کامل کنید');
    if (surgeon.person.account) return { id: surgeon.person.account.id, existing: true, level: surgeon.person.account.level, status: surgeon.person.account.status };
    const account = await this.prisma.account.create({ data: { personId: surgeon.personId, passwordHash: '', level: LEVEL.TECH, status: 'active', verificationDueAt: verificationDeadline(), jobRole: 'doctor', approvedById: user.id, approvedAt: new Date() } });
    await this.audit.record({ actorId: user.id, action: 'surgeon.account.create', entityType: 'account', entityId: account.id, after: { surgeonId, personId: surgeon.personId } });
    return { id: account.id, existing: false, level: account.level, status: account.status };
  }
}
