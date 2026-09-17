import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LEVEL } from '../common/levels';
import { jobRoleLabel } from '../common/job-roles';
import { PATHWAY_TEMPLATES, validateSteps, type PathwayStepDef } from './pathway.registry';

const DAY = 86_400_000;

/** برچسب‌های فارسیِ وضعیت — مشتقِ سرور (قانون ۱۵)، نه نگاشتِ کلاینتی. */
const EPISODE_FA: Record<string, string> = { active: 'در جریان', done: 'تمام‌شده', cancelled: 'لغوشده' };
const STEP_FA: Record<string, string> = { pending: 'در انتظار', done: 'انجام شد', skipped: 'رد شد' };

/**
 * مسیرِ درمان (W4.1) — یافتهٔ A4.
 *
 * امروز کلِ «اتوماسیونِ مسیر» `syncPostOpVisit()` + کاشتِ یادآوری است و هر دو
 * قفلِ `kind === 'surgery'`اند؛ یعنی مطب، IVF و فیزیوتراپی هیچ مسیری ندارند.
 * این سرویس همان مفهوم را **داده** می‌کند نه کد: الگو → نسخه → دوره → گام.
 *
 * ⚠️ **هیچ‌چیز خودکار شروع نمی‌شود.** الگوها ساخته می‌شوند ولی تا کسی دوره‌ای
 * را صریحاً شروع نکند، رفتارِ نصب ذره‌ای عوض نمی‌شود — و `syncPostOpVisit`
 * دست‌نخورده سرِ جایش است. نصبی که امروز کار می‌کند نباید یک‌شبه مسیرِ تازه
 * بگیرد. (مهاجرتِ جراحی به مسیرِ صریح، بستهٔ جداست.)
 */
@Injectable()
export class PathwayService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /**
   * الگوهای آمادهٔ کد را یک‌بار روی این نصب می‌نشاند.
   *
   * ⚠️ lazy و idempotent — مثلِ خودسیدکردنِ کاتالوگ. نه مهاجرتِ جدا لازم دارد
   * نه نصبِ تازه را وابسته به اجرای دستیِ یک اسکریپت می‌کند.
   * ⚠️ الگوی موجود **بازنویسی نمی‌شود**: اگر شرکتی نسخهٔ خودش را منتشر کرده،
   * بالاآمدنِ سرور نباید رویش بریزد.
   */
  private async ensureBuiltins() {
    const have = new Set((await this.prisma.pathwayTemplate.findMany({ select: { key: true } })).map((t) => t.key));
    for (const def of PATHWAY_TEMPLATES) {
      if (have.has(def.key)) continue;
      await this.prisma.pathwayTemplate.create({
        data: {
          key: def.key, title: def.title, notes: def.notes ?? null,
          vertical: def.vertical ?? null, builtin: true,
          versions: {
            create: { version: 1, status: 'published', steps: def.steps as any, publishedAt: new Date() },
          },
        },
      }).catch(() => undefined);   // رقابتِ دو درخواستِ هم‌زمان: unique کلید کافی است
    }
  }

  /** فهرستِ الگوها با نسخهٔ منتشرشده‌شان. */
  async templates() {
    await this.ensureBuiltins();
    const rows = await this.prisma.pathwayTemplate.findMany({
      where: { active: true },
      include: { versions: { orderBy: { version: 'desc' } }, _count: { select: { episodes: true } } },
      orderBy: [{ builtin: 'desc' }, { title: 'asc' }],
    });
    return rows.map((t) => {
      const published = t.versions.find((v) => v.status === 'published') ?? null;
      return {
        id: t.id, key: t.key, title: t.title, notes: t.notes, vertical: t.vertical, builtin: t.builtin,
        episodes: t._count.episodes,
        publishedVersion: published ? { id: published.id, version: published.version, steps: published.steps } : null,
        /* شمارهٔ نسخهٔ بعدی — ویزاردِ W4.2 همین را نشان می‌دهد. */
        nextVersion: (t.versions[0]?.version ?? 0) + 1,
      };
    });
  }

  /**
   * انتشارِ نسخهٔ تازه.
   *
   * ⚠️ نسخهٔ قبلی **بازنشسته** می‌شود، نه حذف: دوره‌های در جریان به همان نسخه
   * اشاره دارند و باید بشود پرسید «این بیمار با کدام نسخه شروع شد؟».
   */
  async publish(templateId: number, rawSteps: unknown, user: any) {
    const template = await this.prisma.pathwayTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new NotFoundException('الگو پیدا نشد');
    const parsed = validateSteps(rawSteps);
    if (!parsed.ok) throw new BadRequestException(parsed.error);

    const version = await this.prisma.$transaction(async (tx) => {
      const last = await tx.pathwayVersion.aggregate({ where: { templateId }, _max: { version: true } });
      await tx.pathwayVersion.updateMany({ where: { templateId, status: 'published' }, data: { status: 'retired' } });
      return tx.pathwayVersion.create({
        data: {
          templateId, version: (last._max.version ?? 0) + 1, status: 'published',
          steps: parsed.steps as any, publishedAt: new Date(),
        },
      });
    });
    await this.audit.record({
      actorId: user?.id, action: 'pathway.publish', entityType: 'pathway_template', entityId: templateId,
      after: { version: version.version, steps: parsed.steps.length },
    });
    return { id: version.id, version: version.version, steps: version.steps };
  }

  /**
   * ⚠️ همان دامنهٔ دیدِ `LiveService.assertAccess` — عمداً کپی و نه import، تا
   * این سرویس از راهِ سرویسِ دیگری در گاردِ پرونده سوراخ باز نکند. نبودن →
   * ۴۰۴ (نه ۴۰۳) تا وجودِ پرونده هم لو نرود.
   */
  private async assertPatient(patientId: number, user: any) {
    const scoped = (user?.level ?? 0) < LEVEL.SUPERVISOR;
    const patient = await this.prisma.patient.findFirst({
      where: {
        id: patientId, deletedAt: null,
        ...(scoped ? { visits: { some: { techId: user?.id ?? -1 } } } : {}),
      },
      select: { id: true, code: true, firstName: true, lastName: true },
    });
    if (!patient) throw new NotFoundException('پرونده پیدا نشد');
    return patient;
  }

  /**
   * شروعِ دوره — گام‌ها از نسخهٔ منتشرشده **کپی** می‌شوند.
   *
   * ⚠️ کپی‌کردن کلِ طرح است: انتشارِ نسخهٔ بعدی نباید دوره‌های در جریان را عوض
   * کند (معیارِ پذیرشِ سند). اگر گام‌ها هنگامِ نمایش از الگو خوانده می‌شدند،
   * هر ویرایشِ الگو تاریخچهٔ همهٔ بیمارانِ گذشته را هم بازنویسی می‌کرد.
   *
   * ⚠️ **مبدأ**: اگر دوره از مراجعه‌ای شروع شود که تاریخِ عمل دارد، مبدأ همان
   * تاریخ است — تنها حالتی که `offsetDays` منفی («۷ روز پیش از عمل») معنا
   * دارد. وگرنه مبدأ امروز است.
   */
  async start(dto: { patientId: number; templateId: number; visitId?: number; anchor?: string }, user: any) {
    const patient = await this.assertPatient(dto.patientId, user);
    const template = await this.prisma.pathwayTemplate.findUnique({
      where: { id: dto.templateId },
      include: { versions: { where: { status: 'published' }, take: 1 } },
    });
    if (!template) throw new NotFoundException('الگو پیدا نشد');
    const version = template.versions[0];
    if (!version) throw new BadRequestException('این الگو نسخهٔ منتشرشده ندارد');

    let anchorAt = dto.anchor ? new Date(dto.anchor) : null;
    let visitId: number | null = null;
    if (dto.visitId) {
      const visit = await this.prisma.visit.findFirst({
        where: { id: dto.visitId, patientId: patient.id }, select: { id: true, opDate: true },
      });
      if (!visit) throw new BadRequestException('مراجعه به این پرونده تعلق ندارد');
      visitId = visit.id;
      if (!anchorAt && visit.opDate) anchorAt = visit.opDate;
    }
    if (!anchorAt || !Number.isFinite(anchorAt.getTime())) anchorAt = new Date();
    /* مبدأ نیمه‌شبِ همان روز — موعدِ گام تاریخ است نه لحظه، و ساعتِ ثبت نباید
       دو دورهٔ هم‌روز را به دو موعدِ متفاوت ببرد. */
    anchorAt = new Date(`${anchorAt.toISOString().slice(0, 10)}T00:00:00.000Z`);

    const steps = version.steps as unknown as PathwayStepDef[];
    const episode = await this.prisma.episode.create({
      data: {
        patientId: patient.id, templateId: template.id, versionId: version.id,
        title: template.title, visitId, startedAt: anchorAt, createdById: user?.id ?? null,
        steps: {
          create: steps.map((s, i) => ({
            key: s.key, title: s.title, seq: (i + 1) * 10,
            ownerRole: s.ownerRole ?? null, notes: s.hint ?? null,
            notify: s.notify ?? null, escalateDays: s.escalateDays ?? null,
            dueAt: new Date(anchorAt!.getTime() + s.offsetDays * DAY),
          })),
        },
      },
      include: { steps: true },
    });
    await this.seedNotices(episode.id, patient.id);
    await this.audit.record({
      actorId: user?.id, action: 'pathway.start', entityType: 'episode', entityId: episode.id,
      after: { patientId: patient.id, template: template.key, version: version.version, steps: steps.length },
    });
    return this.view(episode.id, user);
  }

  /**
   * یادآوریِ بیمار برای گام‌هایی که متنِ پیامک دارند.
   *
   * ⚠️ از دفترِ **موجودِ** `reminders` استفاده می‌کند، نه زمان‌بندِ تازه: sweepِ
   * فعلی هر ردیفِ `pending` که موعدش رسیده را می‌فرستد. یک ماشینِ ارسالِ دوم
   * یعنی دو جا برای «چرا این پیامک رفت؟».
   *
   * ⚠️ **موعدِ گذشته پیام نمی‌سازد.** دوره‌ای که با تاریخِ عقب‌افتاده شروع شود
   * (ثبتِ دیرهنگام، مبدأِ عملِ هفتهٔ پیش) وگرنه همان لحظه رگباری از پیام‌های
   * کهنه برای بیمار می‌فرستاد — همان تله‌ای که `collapsed()` در
   * `reminders.service.ts` برای عملِ گذشته گرفته است.
   *
   * ⚠️ شماره‌ای که نیست، پیامی ندارد — و این خطا نیست: دوره برای بیمارِ
   * بی‌شماره هم معنا دارد، فقط پیامش نمی‌رود.
   */
  private async seedNotices(episodeId: number, patientId: number) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { phone: true } });
    const phone = String(patient?.phone ?? '').replace(/[^0-9]/g, '');
    if (!/^09\d{9}$/.test(phone)) return;
    const steps = await this.prisma.episodeStep.findMany({
      where: { episodeId, notify: { not: null }, status: 'pending' },
      select: { id: true, notify: true, dueAt: true },
    });
    for (const st of steps) {
      if (!st.dueAt || st.dueAt.getTime() <= Date.now()) continue;
      try {
        const r = await this.prisma.reminder.create({
          data: { patientId, kind: 'notice', dueAt: st.dueAt, phone, text: st.notify!, status: 'pending' },
        });
        await this.prisma.episodeStep.update({ where: { id: st.id }, data: { reminderId: r.id } });
      } catch { /* یک گامِ بی‌یادآوری نباید کلِ شروعِ دوره را بشکند */ }
    }
  }

  /**
   * گامی که بسته شد (انجام/رد) یا دوره‌ای که بسته شد، یادآوریِ **نفرستادهٔ**
   * خودش را باطل می‌کند.
   *
   * ⚠️ فقط `pending`: یادآوریِ **فرستاده‌شده** دست نمی‌خورد — سندِ چیزی است که
   * واقعاً رفته، و «باطل» کردنش یعنی دفترِ پیام‌ها دروغ بگوید.
   */
  private async cancelNotices(where: { episodeId?: number; stepId?: number }) {
    const steps = await this.prisma.episodeStep.findMany({
      where: {
        ...(where.stepId ? { id: where.stepId } : {}),
        ...(where.episodeId ? { episodeId: where.episodeId } : {}),
        reminderId: { not: null },
      },
      select: { reminderId: true },
    });
    const ids = steps.map((s) => s.reminderId!).filter(Boolean);
    if (!ids.length) return;
    await this.prisma.reminder.updateMany({
      where: { id: { in: ids }, status: 'pending' }, data: { status: 'cancelled' },
    }).catch(() => undefined);
  }

  /**
   * **آزمونِ الگو با بیمارِ ساختگی** (معیارِ پذیرشِ W4.2: «بیازماید»).
   *
   * ⚠️ هیچ‌چیز نمی‌نویسد — نه دوره، نه یادآوری. مدیر باید بتواند پیش از
   * اعمال ببیند چه تاریخ‌هایی درمی‌آید و چه پیامی به دستِ بیمار می‌رسد،
   * بدونِ اینکه یک بیمارِ واقعی پیام بگیرد.
   */
  preview(rawSteps: unknown, anchor?: string) {
    const parsed = validateSteps(rawSteps);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    let at = anchor ? new Date(anchor) : new Date();
    if (!Number.isFinite(at.getTime())) at = new Date();
    at = new Date(`${at.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const now = Date.now();
    return {
      anchor: at,
      steps: parsed.steps.map((s, i) => {
        const dueAt = new Date(at.getTime() + s.offsetDays * DAY);
        return {
          seq: (i + 1) * 10, key: s.key, title: s.title, dueAt,
          ownerRole: s.ownerRole ?? null, ownerRoleFa: jobRoleLabel(s.ownerRole ?? null),
          notify: s.notify ?? null,
          /* صریح می‌گوید کدام پیام **نمی‌رود** — همان قاعدهٔ موعدِ گذشته. */
          notifySends: !!s.notify && dueAt.getTime() > now,
          escalateDays: s.escalateDays ?? null,
        };
      }),
    };
  }

  /** آبجکتِ غنی‌شده — برچسب و شمارش سمتِ سرور (قانون ۱۵). */
  private shape(e: any) {
    const steps = (e.steps ?? []).map((s: any) => ({
      id: s.id, key: s.key, title: s.title, seq: s.seq,
      ownerRole: s.ownerRole, ownerRoleFa: jobRoleLabel(s.ownerRole),
      ownerId: s.ownerId,
      ownerName: s.owner ? `${s.owner.person.firstName} ${s.owner.person.lastName}`.trim() : null,
      dueAt: s.dueAt, status: s.status, statusFa: STEP_FA[s.status] ?? s.status,
      doneAt: s.doneAt, notes: s.notes, notify: s.notify, escalateDays: s.escalateDays,
    }));
    const done = steps.filter((s: any) => s.status === 'done').length;
    const open = steps.filter((s: any) => s.status === 'pending');
    /* «گامِ بعدی» = نزدیک‌ترین موعدِ باز. کارتِ پرونده همین یکی را برجسته می‌کند. */
    const next = open.slice().sort((a: any, b: any) =>
      (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity))[0] ?? null;
    return {
      id: e.id, patientId: e.patientId, visitId: e.visitId, title: e.title,
      status: e.status, statusFa: EPISODE_FA[e.status] ?? e.status,
      startedAt: e.startedAt, closedAt: e.closedAt,
      template: e.template ? { id: e.template.id, key: e.template.key, title: e.template.title } : null,
      version: e.version ? e.version.version : null,
      counts: { total: steps.length, done, open: open.length },
      /* درصد از **شمارش** می‌آید نه فرمولِ رابط — قانون ۱۵. */
      percent: steps.length ? Math.round((done / steps.length) * 100) : 0,
      nextStep: next,
      steps,
    };
  }

  private static readonly INCLUDE = {
    template: { select: { id: true, key: true, title: true } },
    version: { select: { version: true } },
    steps: {
      orderBy: [{ seq: 'asc' as const }, { id: 'asc' as const }],
      include: { owner: { select: { id: true, person: { select: { firstName: true, lastName: true } } } } },
    },
  };

  async view(episodeId: number, user: any) {
    const e = await this.prisma.episode.findUnique({ where: { id: episodeId }, include: PathwayService.INCLUDE });
    if (!e) throw new NotFoundException('دوره پیدا نشد');
    await this.assertPatient(e.patientId, user);
    return this.shape(e);
  }

  /** دوره‌های یک بیمار — تازه‌ترین اول. */
  async forPatient(patientId: number, user: any) {
    await this.assertPatient(patientId, user);
    const rows = await this.prisma.episode.findMany({
      where: { patientId }, include: PathwayService.INCLUDE, orderBy: { id: 'desc' }, take: 20,
    });
    return rows.map((e) => this.shape(e));
  }

  /**
   * ویرایشِ گام — **همین است «برنامهٔ اختصاصیِ بیمار»**.
   *
   * ⚠️ روی گامِ دورهٔ بسته‌شده نوشتن ممنوع است: دورهٔ تمام‌شده سندِ چیزی است که
   * اتفاق افتاده، نه فرمی که هنوز باز باشد.
   */
  async patchStep(stepId: number, dto: { status?: string; dueAt?: string | null; ownerId?: number | null; title?: string; notes?: string | null }, user: any) {
    const step = await this.prisma.episodeStep.findUnique({ where: { id: stepId }, include: { episode: true } });
    if (!step) throw new NotFoundException('مرحله پیدا نشد');
    await this.assertPatient(step.episode.patientId, user);
    if (step.episode.status !== 'active') throw new ForbiddenException('این دوره بسته شده است');

    const data: any = {};
    if (dto.status !== undefined) {
      if (!STEP_FA[dto.status]) throw new BadRequestException('وضعیتِ مرحله نامعتبر است');
      data.status = dto.status;
      data.doneAt = dto.status === 'pending' ? null : new Date();
    }
    if (dto.dueAt !== undefined) {
      const d = dto.dueAt ? new Date(dto.dueAt) : null;
      if (dto.dueAt && !Number.isFinite(d!.getTime())) throw new BadRequestException('تاریخ نامعتبر است');
      data.dueAt = d;
    }
    if (dto.ownerId !== undefined) data.ownerId = dto.ownerId ?? null;
    if (dto.title !== undefined) {
      const t = dto.title.trim();
      if (!t || t.length > 120) throw new BadRequestException('عنوانِ مرحله لازم است (حداکثر ۱۲۰ نویسه)');
      data.title = t;
    }
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
    if (!Object.keys(data).length) throw new BadRequestException('چیزی برای ثبت نیامده است');

    await this.prisma.episodeStep.update({ where: { id: stepId }, data });
    /* گامی که بسته شد دیگر پیامِ یادآوری‌اش موضوعیت ندارد. */
    if (data.status && data.status !== 'pending') await this.cancelNotices({ stepId });
    await this.audit.record({
      actorId: user?.id, action: 'pathway.step', entityType: 'episode_step', entityId: stepId,
      before: { status: step.status, dueAt: step.dueAt, ownerId: step.ownerId }, after: data,
    });
    return this.view(step.episodeId, user);
  }

  /**
   * بستنِ دوره.
   *
   * ⚠️ گام‌های باز **خودکار انجام‌شده نمی‌شوند** — دوره‌ای که نیمه‌کاره بسته شده
   * باید همان‌طور در سابقه بماند. علامت‌زدنشان یعنی گزارشِ «چند درصدِ دوره‌ها
   * کامل شدند» برای همیشه دروغ بگوید.
   */
  async close(episodeId: number, status: string, user: any) {
    if (status !== 'done' && status !== 'cancelled') throw new BadRequestException('وضعیتِ دوره نامعتبر است');
    const e = await this.prisma.episode.findUnique({ where: { id: episodeId } });
    if (!e) throw new NotFoundException('دوره پیدا نشد');
    await this.assertPatient(e.patientId, user);
    await this.prisma.episode.update({ where: { id: episodeId }, data: { status, closedAt: new Date() } });
    /* ⚠️ دورهٔ بسته نباید فردا به بیمار پیام بدهد — چه تمام شده باشد چه لغو. */
    await this.cancelNotices({ episodeId });
    await this.audit.record({
      actorId: user?.id, action: 'pathway.close', entityType: 'episode', entityId: episodeId,
      before: { status: e.status }, after: { status },
    });
    return this.view(episodeId, user);
  }
}
