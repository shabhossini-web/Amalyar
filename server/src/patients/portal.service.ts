import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SmsService } from '../sms/sms.service';
import { SettingsService } from '../config/settings.service';
import { TenantContext } from '../tenant/tenant-context';
import { toEnDigits } from '../common/identity';
import { faDateStr } from './summary.service';
import { renderSms } from '../common/sms-template';
import { AvailabilityService } from './availability.service';
import { OP_LABELS } from './labels';
import { OTHER_PX, procedureLabel } from './visit-coding';

/**
 * پروندهٔ الکترونیکِ بیمار — لینکِ **دائمیِ** `/p/<token>`.
 *
 * راهِ ارتباطیِ ثابتِ ما با بیمار: تاریخچهٔ مراجعات، مراجعاتِ آتی، عمل‌ها، و
 * فیدِ همهٔ اطلاع‌رسانی‌ها (دفترِ reminders — هر پیامکی که فرستاده‌ایم یا
 * قرار است برود). بیمار هر چه یادش رفت، این‌جا پیدا می‌کند.
 *
 * ⚠️ projection مثلِ خلاصهٔ ویزیت: هیچ عددِ مالی، هیچ یادداشتِ داخلی، هیچ
 * فیلدِ بخشِ نقش‌داری بیرون نمی‌رود. لینکِ خلاصهٔ هر مراجعه تنبل ساخته
 * می‌شود تا بیمار جزئیاتِ هر ویزیت را هم از همین‌جا باز کند.
 */
@Injectable()
export class PortalService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private sms: SmsService,
    private settings: SettingsService,
    private tenant: TenantContext,
  ) {}

  private async ensureToken(patientId: number) {
    const p = await this.prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { id: true, portalToken: true, phone: true, code: true },
    });
    if (!p) throw new NotFoundException('پرونده پیدا نشد');
    if (p.portalToken) return { patient: p, token: p.portalToken };
    const token = randomBytes(18).toString('base64url');
    await this.prisma.patient.update({ where: { id: patientId }, data: { portalToken: token } });
    return { patient: p, token };
  }

  private urlOf(token: string) {
    return `https://${this.tenant.require().hostname}/p/${token}`;
  }

  async link(patientId: number) {
    const { token } = await this.ensureToken(patientId);
    return { token, url: this.urlOf(token) };
  }

  /**
   * پیامکِ لینکِ پرونده به بیمار — و ثبتش در همان دفترِ اطلاع‌رسانی، چون
   * «هر چه به بیمار می‌فرستیم باید در پرونده‌اش جمع شود» شاملِ خودِ این
   * پیام هم هست.
   */
  async sendSms(patientId: number, user: any) {
    const { patient, token } = await this.ensureToken(patientId);
    const to = toEnDigits(String(patient.phone ?? '')).replace(/[^0-9]/g, '');
    if (!/^09\d{9}$/.test(to)) {
      throw new BadRequestException('شمارهٔ موبایلِ معتبری در پرونده نیست — اول شماره را در پرونده اصلاح کنید');
    }
    const brand = await this.settings.brand();
    const cfg = await this.settings.sms();
    const url = this.urlOf(token);
    const text = `${brand.name ? brand.name + '\n' : ''}${renderSms(cfg.portalText, { link: url })}`;
    const res = await this.sms.send(to, text);
    await this.prisma.reminder.create({
      data: { patientId, kind: 'notice', dueAt: new Date(), phone: to, text, status: res.sent || res.stub ? 'sent' : 'failed', sentAt: new Date() },
    }).catch(() => undefined);
    await this.audit.record({
      actorId: user?.id, action: 'patient.portal.sms', entityType: 'patient', entityId: patientId,
      after: { to, sent: res.sent, stub: res.stub },
    });
    return { ...res, to, url };
  }

  /** Prepare settings before the transaction; persist one SMS in the existing durable sender queue. */
  async prepareApprovalNotice() {
    const brand = await this.settings.brand();
    const cfg = await this.settings.sms();
    const hostname = this.tenant.require().hostname;
    return async (tx: any, patientId: number, visitId: number, submissionId: number, actorId: number | null) => {
      await tx.$queryRaw`SELECT id FROM patients WHERE id = ${patientId} FOR UPDATE`;
      const patient = await tx.patient.findFirst({ where: { id: patientId, deletedAt: null } });
      if (!patient) throw new NotFoundException('پرونده پیدا نشد');
      const phone = toEnDigits(String(patient.phone ?? '')).replace(/[^0-9]/g, '');
      if (!/^09\d{9}$/.test(phone)) return null;
      const token = patient.portalToken || randomBytes(18).toString('base64url');
      if (!patient.portalToken) await tx.patient.update({ where: { id: patientId }, data: { portalToken: token } });
      const link = `https://${hostname}/p/${token}`;
      const text = `${brand.name ? brand.name + '\n' : ''}${renderSms(cfg.portalText, { link })}`;
      const dedupeKey = `intake_approved:${submissionId}`;
      const reminder = await tx.reminder.upsert({ where: { dedupeKey }, update: {}, create: {
        patientId, visitId, kind: 'notice', dueAt: new Date(), phone, text, status: 'pending', dedupeKey,
      } });
      await this.audit.record({ actorId, action: 'patient.portal.sms_queued', entityType: 'patient', entityId: patientId,
        after: { reminderId: reminder.id, submissionId } }, tx);
      return reminder.id;
    };
  }

  async publicView(token: string) {
    const p = await this.prisma.patient.findFirst({
      where: { portalToken: token, deletedAt: null },
      select: { id: true, code: true, firstName: true, lastName: true },
    });
    if (!p) throw new NotFoundException('این لینک معتبر نیست');

    /* ⚠️ چهار مدلِ سفارش **شکلِ یکسان ندارند**: آزمایش `tests[]` دارد،
       تصویربرداری `modalities[]/region`، و مشاوره/ارجاع `specialty`. فقط
       `token/status/createdAt` مشترک‌اند؛ برچسبِ خوانا را `orderTask()` پایین
       از فیلدهای خودِ هر مدل می‌سازد. (اولین نسخهٔ این کد یک `title`ِ مشترک
       فرض کرد که در هیچ‌کدام وجود ندارد.) */
    const common = { token: true, status: true, createdAt: true } as const;
    const openOrderWhere = { patientId: p.id, status: { in: ['sent', 'needs_action'] } };

    const [visits, kindDefs, appointments, notices, brand, intakes, surveys, labs, imaging, consults, referrals] =
      await Promise.all([
      this.prisma.visit.findMany({
        where: { patientId: p.id },
        orderBy: [{ opDate: { sort: 'desc', nulls: 'last' } }, { seq: 'desc' }],
        select: {
          id: true, seq: true, kind: true, opDate: true, opStatus: true,
          nextVisitDate: true, summaryToken: true,
          surgeon: { select: { person: { select: { firstName: true, lastName: true } } } },
          surgeonName: true, opType: true,
          procedureType: { select: { name: true } },
          otherProcedures: OTHER_PX,
          topic: { select: { name: true } },
        },
      }),
      this.prisma.formDef.findMany({ where: { scope: 'visit' }, select: { visitKind: true, title: true } }),
      this.prisma.appointment.findMany({
        where: { patientId: p.id, status: { in: ['held', 'confirmed'] }, date: { gte: new Date(Date.now() - 24 * 3600_000) } },
        orderBy: { date: 'asc' },
        /* `forVisitId` (از W1.5) تنها چیزی است که می‌گوید این نوبت **برای کدام
           مراجعه** گرفته شده — بدونِ آن ادغامِ «تاریخِ توصیه‌شده + نوبتِ قطعی»
           حدس می‌شد و دو نوبتِ مستقل را هم روی هم می‌انداخت. */
        select: { date: true, startMin: true, status: true, forVisitId: true, topic: { select: { name: true } } },
      }),
      this.prisma.reminder.findMany({
        where: { patientId: p.id, status: { in: ['sent', 'pending'] } },
        orderBy: [{ sentAt: { sort: 'desc', nulls: 'first' } }, { dueAt: 'desc' }],
        take: 50,
        select: { kind: true, status: true, dueAt: true, sentAt: true, text: true },
      }),
      this.settings.brand(),
      /* ثبت‌نامِ نیمه‌تمام — بیمار فرم را باز کرده ولی تمام نکرده یا فیش نداده. */
      this.prisma.intakeSubmission.findMany({
        where: { patientId: p.id, status: { in: ['pending_fill', 'pending_payment'] } },
        orderBy: { id: 'desc' },
        /* `data` فقط برای دو کلیدِ فرمِ پیگیری (`followUpVisitId`/`followUpDay`) —
           پایین ↓ تصمیم می‌گیرد کدام فرمِ پیگیری **امروز** کارِ بیمار است. */
        select: { token: true, status: true, amount: true, data: true },
      }),
      this.prisma.surveyInvite.findMany({
        where: { patientId: p.id, status: 'pending' },
        orderBy: { id: 'desc' },
        select: { token: true },
      }),
      this.prisma.labOrder.findMany({ where: openOrderWhere, orderBy: { id: 'desc' }, select: { ...common, tests: true } }),
      this.prisma.imagingOrder.findMany({ where: openOrderWhere, orderBy: { id: 'desc' }, select: { ...common, modalities: true, region: true } }),
      this.prisma.consultOrder.findMany({ where: openOrderWhere, orderBy: { id: 'desc' }, select: { ...common, specialty: true } }),
      this.prisma.referralOrder.findMany({ where: openOrderWhere, orderBy: { id: 'desc' }, select: { ...common, specialty: true } }),
    ]);

    /* لینکِ خلاصهٔ هر مراجعه — تنبل، همین‌جا: بیمار صاحبِ سند است. */
    for (const v of visits) {
      if (!v.summaryToken) {
        const t = randomBytes(18).toString('base64url');
        await this.prisma.visit.update({ where: { id: v.id }, data: { summaryToken: t } });
        (v as any).summaryToken = t;
      }
    }

    const titles = new Map(kindDefs.filter((d) => d.visitKind).map((d) => [d.visitKind!, d.title] as const));
    const shape = (v: (typeof visits)[number]) => ({
      code: `${p.code}-V${v.seq}`,
      kind: v.kind,
      kindTitle: v.kind ? titles.get(v.kind) ?? null : null,
      dateFa: v.opDate ? faDateStr(v.opDate) : null,
      status: v.opStatus,
      /* ⚠️ برچسب از سرور می‌آید و نه از نگاشتِ خودِ پرتال: پرتالِ بیمار
         احراز ندارد و `/config` را نمی‌خواند، پس تنها راهِ «یک وضعیت، یک
         برچسب» همین است. نسخهٔ قبلیِ کلاینت `cancelled` را «لغو شد»
         می‌نوشت و کارکنان «لغو» می‌دیدند. */
      statusFa: OP_LABELS[v.opStatus] ?? v.opStatus,
      doctorName: v.surgeon?.person
        ? `${v.surgeon.person.firstName} ${v.surgeon.person.lastName}`.trim()
        : v.surgeonName,
      /* بستهٔ ۷ج: سندِ بیمار عملِ دوم را جا نمی‌اندازد — برچسبِ همه، اصلی اول. */
      procedure: procedureLabel(v),
      topicName: v.topic?.name ?? null,
      summaryUrl: `/v/${v.summaryToken}`,
    });

    const now = Date.now();

    /* ── کارهای باز (W3.4 §۴.۶) ──────────────────────────────────────────
       «لینکِ واحدِ بیمار» یعنی بیمار برای **یک نتیجه** بینِ لینک‌ها جابه‌جا
       نشود: هر کاری که از او خواسته شده این‌جا یک ردیف است و `url` همان
       deep-linkِ `/f /o /s` است. ترتیب عمدی است — کارِ پولی و کارِ عقب‌افتاده
       بالاتر از نظرسنجی. */
    const orderTask = (
      o: { token: string; status: string; createdAt: Date },
      what: string,
    ) => ({
      kind: 'order' as const,
      /* `needs_action` یعنی پاسخِ قبلی ناقص بود — این فوری‌تر از یک سفارشِ
         تازه‌فرستاده است، پس جدا برچسب می‌خورد (CONTRACTS §۴). */
      label: o.status === 'needs_action' ? 'ارسالِ دوبارهٔ نتیجه' : 'نتیجهٔ درخواستی',
      detail: what || null,
      url: `/o/${o.token}`,
      urgent: o.status === 'needs_action',
    });
    const listOf = (xs: string[] | null | undefined) => (xs ?? []).filter(Boolean).join('، ');

    /**
     * فرمِ پیگیریِ پس از عمل فقط وقتی «کار» است که موعدش رسیده باشد.
     *
     * قراردادِ لِینِ الف (W1.1/D01): به‌ازای هر موعدِ پیگیری (روزِ ۱، ۷، ۳۰) یک
     * ردیفِ `intakeSubmission` با کلیدِ `followUpVisitId`/`followUpDay` **از همان
     * لحظهٔ ثبتِ مراجعه** ساخته می‌شود، چون متنِ پیامکِ هر موج لینکش را همان موقع
     * لازم دارد. ولی این‌جا همهٔ `pending_fill`ها «تکمیلِ فرم» نشان داده می‌شدند —
     * یعنی بیمارِ با پیگیریِ «۱،۷،۳۰» پیش از خودِ عمل سه کارِ باز می‌دید و برای
     * موجی که هنوز نیامده فرم پر می‌کرد. مالک قرارداد را نگه داشت و این صافی را
     * خواست (۱۴۰۵/۰۶/۲۹).
     *
     * قاعده: فرمِ پیگیری فقط از **روزِ موعدش** (تاریخِ عمل + روز) کار است، و فرمِ
     * عملِ **لغوشده** هیچ‌وقت. هر چیزِ دیگری — ثبت‌نامِ عادی، فرمی که مراجعه‌اش
     * پیدا نشد یا تاریخِ عمل ندارد — مثلِ قبل نشان داده می‌شود: صافی فقط چیزی را
     * پنهان می‌کند که **قطعاً** هنوز کارِ بیمار نیست، نه چیزی که نمی‌شناسد.
     */
    const dueToday = (i: { data: unknown }) => {
      const d = i.data as { followUpVisitId?: unknown; followUpDay?: unknown } | null;
      if (typeof d?.followUpVisitId !== 'number' || typeof d?.followUpDay !== 'number') return true;
      const v = visits.find((x) => x.id === d.followUpVisitId);
      if (!v?.opDate) return true;
      if (v.opStatus === 'cancelled') return false;
      return v.opDate.getTime() + d.followUpDay * 864e5 <= Date.now();
    };

    const tasks = [
      ...intakes.filter(dueToday).map((i) => ({
        kind: 'intake' as const,
        label: i.status === 'pending_payment' ? 'بارگذاریِ فیشِ واریزی' : 'تکمیلِ فرم',
        detail: i.status === 'pending_payment' && i.amount > 0
          ? `مبلغِ ${i.amount.toLocaleString('fa-IR')} تومان`
          : null,
        url: `/f/${i.token}`,
        urgent: i.status === 'pending_payment',
      })),
      ...labs.map((o) => orderTask(o, listOf(o.tests) || 'آزمایش')),
      ...imaging.map((o) => orderTask(o, [listOf(o.modalities), o.region].filter(Boolean).join(' — ') || 'تصویربرداری')),
      ...consults.map((o) => orderTask(o, o.specialty ? `مشاورهٔ ${o.specialty}` : 'مشاوره')),
      ...referrals.map((o) => orderTask(o, o.specialty ? `ارجاع به ${o.specialty}` : 'ارجاع')),
      ...surveys.map((v) => ({
        kind: 'survey' as const, label: 'پاسخ به نظرسنجی', detail: null,
        url: `/s/${v.token}`, urgent: false,
      })),
    ].sort((a, b) => Number(b.urgent) - Number(a.urgent));

    /* ── پیشِ‌رو: یک مرحله = یک کارت (DECISIONS.md #۵) ────────────────────
       «تاریخِ توصیه‌شده» (`nextVisitDate` که پزشک نوشته) و «نوبتِ قطعی» که
       بیمار بعداً گرفته، وقتی به **یک مراجعه** تعلق دارند یک چیزند و دو ردیف
       نشان‌دادنشان بیمار را گیج می‌کند («بالاخره کِی بیایم؟»).
       ⚠️ ملاکِ «یک مرحله» `forVisitId` است نه نزدیکیِ تاریخ: دو نوبتِ واقعیِ
       مستقل هرگز ادغام نمی‌شوند، حتی اگر یک روز باشند. */
    const bookedFor = new Map<number, (typeof appointments)[number]>();
    for (const a of appointments) if (a.forVisitId != null && !bookedFor.has(a.forVisitId)) bookedFor.set(a.forVisitId, a);

    const apptDetail = (a: (typeof appointments)[number]) => [
      a.topic?.name,
      a.startMin != null ? `ساعتِ ${AvailabilityService.minToHHMM(a.startMin)}` : null,
    ].filter(Boolean).join(' — ') || null;

    const upcoming = [
      ...visits
        .filter((v) => v.nextVisitDate && v.nextVisitDate.getTime() >= now - 24 * 3600_000)
        .map((v) => {
          const a = bookedFor.get(v.id);
          if (!a) {
            return {
              kind: 'next_visit', dateFa: faDateStr(v.nextVisitDate!), label: 'ویزیتِ بعدی',
              detail: `پیروِ مراجعهٔ ${p.code}-V${v.seq}`, booked: false,
            };
          }
          /* ادغام‌شده: تاریخِ **قطعی** حرفِ آخر است و توصیه زیرش توضیح می‌شود. */
          return {
            kind: 'next_visit_booked',
            dateFa: faDateStr(a.date),
            label: a.status === 'confirmed' ? 'نوبتِ قطعیِ ویزیتِ بعدی' : 'نوبتِ رزروشدهٔ ویزیتِ بعدی',
            detail: [apptDetail(a), `توصیهٔ پزشک: ${faDateStr(v.nextVisitDate!)}`].filter(Boolean).join(' · '),
            booked: true,
          };
        }),
      ...appointments
        .filter((a) => a.forVisitId == null || !visits.some((v) => v.id === a.forVisitId && v.nextVisitDate))
        .map((a) => ({
          kind: 'appointment',
          dateFa: faDateStr(a.date),
          label: a.status === 'confirmed' ? 'نوبتِ قطعی' : 'نوبتِ رزروشده',
          detail: apptDetail(a),
          booked: true,
        })),
    ];

    return {
      brand: { name: brand.name, phone: brand.phone, address: brand.address },
      patient: { fullName: `${p.firstName} ${p.lastName}`.trim(), code: p.code },
      tasks,
      upcoming,
      visits: visits.map(shape),
      surgeries: visits.filter((v) => v.kind === 'surgery').map(shape),
      notices: notices.map((n) => ({
        kind: n.kind,
        status: n.status,
        dateFa: faDateStr(n.sentAt ?? n.dueAt),
        upcoming: n.status === 'pending',
        text: n.text,
      })),
    };
  }
}
