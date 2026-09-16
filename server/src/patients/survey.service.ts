import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { FormsService } from './forms.service';
import { EventsService } from '../work/events.service';

/**
 * نظرسنجیِ پس از مراجعه و کانالِ آشناییِ بیمار.
 *
 * ⚠️ این دو عمداً در یک سرویس‌اند: هر دو «صدای بیمار»اند و یک چیز را جواب
 * می‌دهند — کدام کار جواب داد. اولی می‌گوید بیمار از کجا آمد، دومی می‌گوید
 * راضی رفت یا نه.
 *
 * ⚠️ **سؤال‌های نظرسنجی از همان موتورِ فرم می‌آیند** (`FormDef` با کلیدِ
 * `survey`). پس سوپرادمین سؤال اضافه یا کم می‌کند بی‌آنکه کسی کد را دست بزند
 * — همان قراری که برای فرمِ مراجعه گذاشتیم.
 */

/** پنجره‌ی پاسخ‌دهی. بعد از این، لینک می‌سوزد. */
const TTL_DAYS = 30;

const text = (v: unknown, max: number) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

@Injectable()
export class SurveyService {
  constructor(
    private prisma: PrismaService,
    private forms: FormsService,
    private events: EventsService,
  ) {}

  /** توکنِ لینک — همان طولِ توکنِ ثبت‌نام، تا حدس‌زدنی نباشد. */
  private token() {
    return randomBytes(9).toString('base64url');
  }

  // ── کانالِ آشنایی ─────────────────────────────────────────────────────────

  /**
   * فهرستِ کانال‌ها.
   *
   * ⚠️ `all` برای صفحه‌ی مدیریت است و پیش‌فرض فقط فعال‌ها — فرمِ عمومیِ بیمار
   * نباید کانالی را پیشنهاد بدهد که شرکت دیگر رویش کار نمی‌کند.
   */
  async listSources(all = false) {
    const rows = await this.prisma.referralSource.findMany({
      where: all ? {} : { active: true },
      orderBy: [{ active: 'desc' }, { sort: 'asc' }, { id: 'asc' }],
      include: { _count: { select: { patients: true } } },
    });
    return rows.map((r) => ({
      id: r.id, name: r.name, asksWho: r.asksWho, active: r.active, sort: r.sort,
      /// شمارنده‌ی استفاده — همان الگوی تعاریفِ پایه، تا کاربر پیش از حذف بداند.
      patientCount: r._count.patients,
    }));
  }

  async createSource(dto: { name?: string; asksWho?: boolean; sort?: number }) {
    const name = String(dto.name ?? '').trim();
    if (name.length < 2) throw new BadRequestException('نام کوتاه است');
    const dup = await this.prisma.referralSource.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (dup) throw new BadRequestException('این نام قبلاً ثبت شده است');
    await this.prisma.referralSource.create({
      data: { name, asksWho: !!dto.asksWho, sort: Number(dto.sort) || 0 },
    });
    return this.listSources(true);
  }

  async patchSource(id: number, dto: { name?: string; asksWho?: boolean; active?: boolean; sort?: number }) {
    const row = await this.prisma.referralSource.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('کانال پیدا نشد');
    if (dto.name) {
      const dup = await this.prisma.referralSource.findFirst({
        where: { name: { equals: dto.name.trim(), mode: 'insensitive' }, id: { not: id } },
      });
      if (dup) throw new BadRequestException('این نام قبلاً ثبت شده است');
    }
    await this.prisma.referralSource.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.asksWho !== undefined ? { asksWho: !!dto.asksWho } : {}),
        ...(dto.active !== undefined ? { active: !!dto.active } : {}),
        ...(dto.sort !== undefined ? { sort: Number(dto.sort) || 0 } : {}),
      },
    });
    return this.listSources(true);
  }

  /** حذف — همان قاعده‌ی همیشگی: استفاده‌شده فقط خاموش می‌شود. */
  async removeSource(id: number) {
    const row = await this.prisma.referralSource.findUnique({
      where: { id }, include: { _count: { select: { patients: true } } },
    });
    if (!row) throw new NotFoundException('کانال پیدا نشد');
    if (row._count.patients > 0) {
      await this.prisma.referralSource.update({ where: { id }, data: { active: false } });
      return { ok: true, deactivated: true, used: row._count.patients };
    }
    await this.prisma.referralSource.delete({ where: { id } });
    return { ok: true, deactivated: false, used: 0 };
  }

  /**
   * کانال را روی پرونده می‌نشاند — **فقط اگر هنوز خالی باشد**.
   *
   * ⚠️ بیمارِ قدیمی یک‌بار با ما آشنا شده؛ پاسخِ امروزش نباید پاسخِ آن روز را
   * بازنویسی کند، وگرنه گزارشِ کانال با هر مراجعهٔ مجدد جابه‌جا می‌شود و
   * «اینستاگرام» بی‌سروصدا به «معرفیِ پزشک» تبدیل می‌شود.
   */
  async attachSource(patientId: number, sourceId?: number, note?: string) {
    if (!sourceId) return;
    const src = await this.prisma.referralSource.findFirst({ where: { id: sourceId, active: true } });
    if (!src) return;
    await this.prisma.patient.updateMany({
      where: { id: patientId, referralSourceId: null },
      data: { referralSourceId: src.id, referralNote: src.asksWho ? text(note, 120) : null },
    });
  }

  /**
   * گزارشِ کانال — «کدام کانال بیمار می‌آورد».
   *
   * ⚠️ بیمارانِ بدونِ کانال هم شمرده می‌شوند، با نامِ «نامشخص». حذفشان از
   * گزارش درصدها را دروغ می‌کند: اگر نیمی از بیماران کانال نداشته باشند و
   * نشماریمشان، «اینستاگرام ۶۰٪» گفته می‌شود در حالی که واقعیت ۳۰٪ است.
   */
  async sourceReport(opts: { from?: Date; to?: Date } = {}) {
    const where: any = { deletedAt: null };
    if (opts.from || opts.to) {
      where.createdAt = { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) };
    }
    const [rows, sources] = await Promise.all([
      this.prisma.patient.groupBy({ by: ['referralSourceId'], where, _count: { _all: true } }),
      this.prisma.referralSource.findMany({ select: { id: true, name: true } }),
    ]);
    const nameOf = new Map(sources.map((s) => [s.id, s.name]));
    const total = rows.reduce((s, r) => s + r._count._all, 0);
    return {
      total,
      rows: rows
        .map((r) => ({
          id: r.referralSourceId,
          label: r.referralSourceId ? (nameOf.get(r.referralSourceId) ?? '—') : 'نامشخص',
          patients: r._count._all,
          /// درصد این‌جا حساب می‌شود نه در کلاینت: دو جای محاسبه یعنی روزی دو عدد.
          percent: total ? Math.round((r._count._all * 1000) / total) / 10 : 0,
        }))
        .sort((a, b) => b.patients - a.patients),
    };
  }

  // ── نظرسنجی ───────────────────────────────────────────────────────────────

  /**
   * ساختِ دعوت‌نامه برای یک مراجعه.
   *
   * ⚠️ اگر دعوت‌نامهٔ بی‌جوابِ قبلی هست، **همان** برگردانده می‌شود نه یکی تازه:
   * وگرنه هر بار که ادمین دکمه را بزند یک لینکِ دیگر ساخته می‌شود و بیمار سه
   * پیامک با سه لینکِ متفاوت می‌گیرد.
   */
  async invite(visitId: number) {
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId }, select: { id: true, patientId: true },
    });
    if (!visit) throw new NotFoundException('مراجعه پیدا نشد');

    const open = await this.prisma.surveyInvite.findFirst({
      where: { visitId, status: 'pending', expiresAt: { gt: new Date() } },
    });
    if (open) return this.inviteView(open);

    const created = await this.prisma.surveyInvite.create({
      data: {
        token: this.token(),
        patientId: visit.patientId,
        visitId,
        expiresAt: new Date(Date.now() + TTL_DAYS * 86400000),
      },
    });
    return this.inviteView(created);
  }

  private inviteView(r: any) {
    return {
      id: r.id, token: r.token, status: r.status,
      visitId: r.visitId, patientId: r.patientId,
      overall: r.overall, answers: r.answers,
      sentAt: r.sentAt, answeredAt: r.answeredAt, expiresAt: r.expiresAt,
    };
  }

  /** دعوت‌نامه‌های یک مراجعه — تا ادمین بداند فرستاده یا نه، و جواب آمده یا نه. */
  async forVisit(visitId: number) {
    const rows = await this.prisma.surveyInvite.findMany({ where: { visitId }, orderBy: { id: 'desc' } });
    return rows.map((r) => this.inviteView(r));
  }

  /**
   * صفحهٔ عمومیِ نظرسنجی — بدونِ ورود.
   *
   * ⚠️ **هیچ اطلاعاتی از بیمار برنمی‌گردد**، حتی نامش. کسی که لینک را دارد
   * لزوماً خودِ بیمار نیست (پیامک فوروارد می‌شود) و لینکِ نظرسنجی نباید به
   * ابزارِ خواندنِ پرونده تبدیل شود. فقط سؤال‌ها و اینکه قبلاً جواب داده یا نه.
   */
  async publicView(token: string) {
    const inv = await this.prisma.surveyInvite.findUnique({ where: { token } });
    if (!inv) throw new NotFoundException('این لینک معتبر نیست');

    let status = inv.status;
    if (status === 'pending' && inv.expiresAt < new Date()) {
      await this.prisma.surveyInvite.update({ where: { id: inv.id }, data: { status: 'expired' } });
      status = 'expired';
    }
    const form = await this.forms.byKey('survey').catch(() => null);
    return {
      status,
      title: form?.title ?? 'نظرسنجی',
      hint: form?.hint ?? null,
      fields: (form?.fields ?? []).filter((f: any) => f.active),
      answeredAt: inv.answeredAt,
    };
  }

  /**
   * ثبتِ پاسخ.
   *
   * ⚠️ یک‌بار مصرف: پاسخِ دوباره رد می‌شود. اگر اجازه می‌دادیم، هر کسی که لینک
   * را داشت می‌توانست نظرِ بیمار را بازنویسی کند — و «نظرسنجی» که قابلِ
   * بازنویسی باشد، داده نیست.
   */
  async submit(token: string, answers: Record<string, any>) {
    const inv = await this.prisma.surveyInvite.findUnique({ where: { token } });
    if (!inv) throw new NotFoundException('این لینک معتبر نیست');
    if (inv.status === 'answered') throw new BadRequestException('پاسخِ شما قبلاً ثبت شده است — سپاس‌گزاریم');
    if (inv.expiresAt < new Date()) throw new BadRequestException('مهلتِ این نظرسنجی تمام شده است');

    /* همان قاعدهٔ اجباری‌بودنِ فرم‌ساز — سؤالی که ستاره خورده باید جواب بگیرد. */
    await this.forms.assertValid('survey', answers ?? {});

    const overall = Number(answers?.overall);
    await this.prisma.surveyInvite.update({
      where: { id: inv.id },
      data: {
        answers: (answers ?? {}) as any,
        /* ⚠️ فقط عددِ ۱ تا ۵ در ستون می‌نشیند. اگر سوپرادمین `overall` را به
           نوعِ دیگری عوض کرده باشد، ستون خالی می‌ماند و گزارشِ میانگین آن
           پاسخ را نمی‌شمارد — بهتر از میانگینی که روی متن حساب شده باشد. */
        overall: Number.isFinite(overall) && overall >= 1 && overall <= 5 ? overall : null,
        status: 'answered',
        answeredAt: new Date(),
      },
    });
    /* W2.2: پاسخِ فرمِ پیگیری ← کارِ «بررسیِ پاسخ» برای پزشک و بستنِ «پیگیریِ بی‌پاسخ». */
    await this.events.emit({
      type: 'form.answered', patientId: inv.patientId, visitId: inv.visitId ?? null,
      refType: 'survey_invite', refId: inv.id, payload: { overall: Number.isFinite(overall) ? overall : null },
    });
    return { ok: true };
  }

  /**
   * گزارشِ رضایت.
   *
   * ⚠️ میانگین فقط روی پاسخ‌های واقعی است، ولی **نرخِ پاسخ** هم برمی‌گردد:
   * میانگینِ ۴.۸ از سه نفر از صد دعوت خبرِ خوبی نیست، و بدونِ نرخِ پاسخ دقیقاً
   * همان‌طور دیده می‌شود که میانگینِ ۴.۸ از نود نفر.
   */
  async report(opts: { from?: Date; to?: Date } = {}) {
    const where: any = {};
    if (opts.from || opts.to) {
      where.sentAt = { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) };
    }
    const [sent, answered, agg, buckets] = await Promise.all([
      this.prisma.surveyInvite.count({ where }),
      this.prisma.surveyInvite.count({ where: { ...where, status: 'answered' } }),
      this.prisma.surveyInvite.aggregate({ where: { ...where, overall: { not: null } }, _avg: { overall: true } }),
      this.prisma.surveyInvite.groupBy({
        by: ['overall'], where: { ...where, overall: { not: null } }, _count: { _all: true },
      }),
    ]);
    return {
      sent,
      answered,
      responseRate: sent ? Math.round((answered * 1000) / sent) / 10 : 0,
      avgOverall: agg._avg.overall != null ? Math.round(agg._avg.overall * 10) / 10 : null,
      /// توزیع، نه فقط میانگین: دو نمرهٔ ۱ و دو نمرهٔ ۵ میانگینِ ۳ می‌دهند و
      /// «متوسط» به‌نظر می‌رسند، در حالی که نصفِ بیماران ناراضی‌اند.
      distribution: [1, 2, 3, 4, 5].map((n) => ({
        score: n,
        count: buckets.find((b) => b.overall === n)?._count._all ?? 0,
      })),
    };
  }
}
