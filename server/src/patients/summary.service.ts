import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SmsService } from '../sms/sms.service';
import { SettingsService } from '../config/settings.service';
import { TenantContext } from '../tenant/tenant-context';
import { toEnDigits } from '../common/identity';
import { toJalali } from '../common/jalali';
import { renderSms } from '../common/sms-template';
import { currentNotes, noteBody } from './clinical-note';

/**
 * بخش‌های هسته که در **خلاصهٔ بیمار** دیده می‌شوند — کلیدِ فرم → نوعِ سند.
 *
 * ⚠️ فقط همان سه‌تایی که پیش از بستهٔ ۶ (به‌شکلِ فیلدِ دلخواهِ بی‌نقش) به
 * بیمار می‌رسید. شرحِ حال و یافته‌ها تازه‌اند و عمداً این‌جا نیستند: حریمِ
 * خصوصی یعنی چیزی که دیروز داخلی بود، امروز بی‌اعلام بیرونی نشود. قاعدهٔ
 * نقش هم سرِ جایش است — معاینه‌ای که مطب «بخشِ پزشک» کرده، دیده نمی‌شود.
 */
const PATIENT_SECTIONS: Record<string, string> = { exam: 'exam', planNote: 'plan', prescription: 'rx' };

/** ۱۴۰۵/۰۵/۲۶ با ارقامِ فارسی — برای متنِ پیامک و صفحهٔ خلاصه. */
export function faDateStr(d: Date): string {
  const [jy, jm, jd] = toJalali(d);
  const fa = (n: number, w = 2) => String(n).padStart(w, '0').replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[+x]);
  return `${fa(jy, 4)}/${fa(jm)}/${fa(jd)}`;
}

/**
 * خلاصهٔ ویزیت — سندی که به دستِ **بیمار** می‌رسد.
 *
 * یک لینکِ عمومیِ توکنی (`/v/<token>`) که هم ادمین برای چاپ/PDF بازش می‌کند و
 * هم با پیامک برای بیمار می‌رود؛ یک صفحه، یک منبع، دو مصرف.
 *
 * ⚠️ محتوا **projected** است، نه پرونده: هیچ عددِ مالی، هیچ یادداشتِ داخلی
 * (`notes`)، و هیچ فیلدِ بخشِ نقش‌دار (شرحِ معاینهٔ پزشک) بیرون نمی‌رود —
 * همان قاعده‌ای که فرمِ عمومیِ بیمار دارد. آنچه می‌رود همان است که روی کاغذِ
 * خلاصهٔ ویزیت چاپ می‌شد: تشخیص، طرحِ درمان، نسخه، ویزیتِ بعدی.
 */
@Injectable()
export class SummaryService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private sms: SmsService,
    private settings: SettingsService,
    private tenant: TenantContext,
  ) {}

  private async ensureToken(visitId: number) {
    const v = await this.prisma.visit.findUnique({
      where: { id: visitId },
      select: { id: true, summaryToken: true, patient: { select: { phone: true, code: true } }, seq: true },
    });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    if (v.summaryToken) return { visit: v, token: v.summaryToken };
    const token = randomBytes(18).toString('base64url');
    await this.prisma.visit.update({ where: { id: visitId }, data: { summaryToken: token } });
    return { visit: v, token };
  }

  private urlOf(token: string) {
    return `https://${this.tenant.require().hostname}/v/${token}`;
  }

  /** لینکِ خلاصه — تنبل ساخته می‌شود؛ بازکردنِ دوباره همان را برمی‌گرداند. */
  async link(visitId: number) {
    const { token } = await this.ensureToken(visitId);
    return { token, url: this.urlOf(token) };
  }

  /** پیامکِ لینکِ خلاصه به شمارهٔ خودِ پرونده — همان قراردادِ ارسالِ فرم. */
  async sendSms(visitId: number, user: any) {
    const { visit, token } = await this.ensureToken(visitId);
    const to = toEnDigits(String(visit.patient?.phone ?? '')).replace(/[^0-9]/g, '');
    if (!/^09\d{9}$/.test(to)) {
      throw new BadRequestException('شمارهٔ موبایلِ معتبری در پرونده نیست — اول شماره را در پرونده اصلاح کنید');
    }
    const brand = await this.settings.brand();
    const cfg = await this.settings.sms();
    const url = this.urlOf(token);
    const text = `${brand.name ? brand.name + '\n' : ''}${renderSms(cfg.summaryText, { link: url })}`;
    const res = await this.sms.send(to, text);
    /* در دفترِ اطلاع‌رسانی هم ثبت می‌شود — پروندهٔ الکترونیکِ بیمار همهٔ
       پیام‌های ما را یک‌جا نشان می‌دهد. */
    await this.prisma.reminder.create({
      data: {
        patientId: (await this.prisma.visit.findUnique({ where: { id: visitId }, select: { patientId: true } }))?.patientId,
        visitId, kind: 'notice', dueAt: new Date(), phone: to, text,
        status: res.sent || res.stub ? 'sent' : 'failed', sentAt: new Date(),
      },
    }).catch(() => undefined);
    await this.audit.record({
      actorId: user?.id, action: 'visit.summary.sms', entityType: 'visit', entityId: visitId,
      after: { to, sent: res.sent, stub: res.stub },
    });
    return { ...res, to, url };
  }

  /**
   * محتوای عمومیِ خلاصه — با توکن، بدونِ ورود.
   *
   * ⚠️ فیلدهای متنی فقط از فیلدهای **بی‌نقشِ** تعریفِ فرم می‌آیند: بخشِ
   * نقش‌دار (مثلِ شرحِ معاینهٔ پزشک) داخلیِ تیم است. `notes` هم builtin و
   * داخلی است — یادداشتِ منشی جای سندِ بیمار نیست.
   */
  async publicView(token: string) {
    const v = await this.prisma.visit.findUnique({
      where: { summaryToken: token },
      include: {
        patient: { select: { code: true, firstName: true, lastName: true } },
        surgeon: { select: { person: { select: { firstName: true, lastName: true } } } },
        hospital: { select: { name: true } },
        topic: { select: { name: true } },
        diagnosis: { select: { title: true } },
        procedureType: { select: { name: true } },
        /* بخش‌های متنیِ هسته — فقط همان سه‌تایی که پیش از بستهٔ ۶ هم به بیمار
           می‌رسید (پایین). */
        clinicalNotes: currentNotes(Object.values(PATIENT_SECTIONS)),
      },
    });
    if (!v) throw new NotFoundException('این لینک معتبر نیست');

    const def = v.kind
      ? await this.prisma.formDef.findFirst({
          where: { scope: 'visit', visitKind: v.kind },
          select: {
            title: true,
            fields: {
              /* ⚠️ بخش‌های هسته (`PATIENT_SECTIONS`) builtin شدند ولی باید
                 همان‌طور که دیروز به بیمار می‌رسیدند برسند — پس builtinِ آن
                 سه کلید هم پذیرفته می‌شود؛ بقیهٔ builtinها (`notes`ِ منشی)
                 داخلی می‌مانند. */
              where: {
                active: true, role: null, type: 'textarea',
                OR: [{ builtin: false }, { key: { in: Object.keys(PATIENT_SECTIONS) } }],
              },
              orderBy: [{ page: 'asc' }, { sort: 'asc' }, { id: 'asc' }],
              select: { key: true, label: true },
            },
          },
        })
      : null;
    const extra = (v.extra && typeof v.extra === 'object') ? v.extra as Record<string, any> : {};
    const answers = (def?.fields ?? [])
      .map((f) => ({
        label: f.label,
        body: PATIENT_SECTIONS[f.key] ? noteBody(v.clinicalNotes, PATIENT_SECTIONS[f.key]) : extra[f.key],
      }))
      .filter((r) => typeof r.body === 'string' && r.body.trim() !== '')
      .map((r) => ({ label: r.label, body: String(r.body).trim() }));

    const brand = await this.settings.brand();
    const person = v.surgeon?.person;
    return {
      brand: { name: brand.name, phone: brand.phone, address: (brand as any).address ?? null, logo: (brand as any).logo ?? null },
      patient: {
        fullName: `${v.patient.firstName} ${v.patient.lastName}`.trim(),
        code: v.patient.code,
      },
      visit: {
        code: `${v.patient.code}-V${v.seq}`,
        kindTitle: def?.title ?? null,
        opDate: v.opDate,
        opDateFa: v.opDate ? faDateStr(v.opDate) : null,
        doctorName: person ? `${person.firstName} ${person.lastName}`.trim() : v.surgeonName,
        hospitalName: v.hospital?.name ?? v.hospitalName,
        topicName: v.topic?.name ?? null,
        diagnosisTitle: v.diagnosis?.title ?? null,
        procedure: v.procedureType?.name ?? v.opType,
      },
      answers,
      nextVisitDate: v.nextVisitDate,
      nextVisitDateFa: v.nextVisitDate ? faDateStr(v.nextVisitDate) : null,
    };
  }
}
