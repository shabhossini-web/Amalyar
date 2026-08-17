import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SmsService } from '../sms/sms.service';
import { SettingsService } from '../config/settings.service';
import { TenantContext } from '../tenant/tenant-context';
import { toEnDigits } from '../common/identity';
import { faDateStr } from './summary.service';
import { AvailabilityService } from './availability.service';

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
    const url = this.urlOf(token);
    const text = `${brand.name ? brand.name + '\n' : ''}پروندهٔ الکترونیکِ شما — مراجعات، نوبت‌ها و پیام‌ها:\n${url}`;
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

  async publicView(token: string) {
    const p = await this.prisma.patient.findFirst({
      where: { portalToken: token, deletedAt: null },
      select: { id: true, code: true, firstName: true, lastName: true },
    });
    if (!p) throw new NotFoundException('این لینک معتبر نیست');

    const [visits, kindDefs, appointments, notices, brand] = await Promise.all([
      this.prisma.visit.findMany({
        where: { patientId: p.id },
        orderBy: [{ opDate: { sort: 'desc', nulls: 'last' } }, { seq: 'desc' }],
        select: {
          id: true, seq: true, kind: true, opDate: true, opStatus: true,
          nextVisitDate: true, summaryToken: true,
          surgeon: { select: { person: { select: { firstName: true, lastName: true } } } },
          surgeonName: true, opType: true,
          procedureType: { select: { name: true } },
          topic: { select: { name: true } },
        },
      }),
      this.prisma.formDef.findMany({ where: { scope: 'visit' }, select: { visitKind: true, title: true } }),
      this.prisma.appointment.findMany({
        where: { patientId: p.id, status: { in: ['held', 'confirmed'] }, date: { gte: new Date(Date.now() - 24 * 3600_000) } },
        orderBy: { date: 'asc' },
        select: { date: true, startMin: true, status: true, topic: { select: { name: true } } },
      }),
      this.prisma.reminder.findMany({
        where: { patientId: p.id, status: { in: ['sent', 'pending'] } },
        orderBy: [{ sentAt: { sort: 'desc', nulls: 'first' } }, { dueAt: 'desc' }],
        take: 50,
        select: { kind: true, status: true, dueAt: true, sentAt: true, text: true },
      }),
      this.settings.brand(),
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
      doctorName: v.surgeon?.person
        ? `${v.surgeon.person.firstName} ${v.surgeon.person.lastName}`.trim()
        : v.surgeonName,
      procedure: v.procedureType?.name ?? v.opType,
      topicName: v.topic?.name ?? null,
      summaryUrl: `/v/${v.summaryToken}`,
    });

    const now = Date.now();
    return {
      brand: { name: brand.name, phone: brand.phone, address: brand.address },
      patient: { fullName: `${p.firstName} ${p.lastName}`.trim(), code: p.code },
      /* مراجعاتِ آتی: «ویزیتِ بعدیِ» ثبت‌شده توسطِ پزشک + نوبت‌های گرفته‌شده. */
      upcoming: [
        ...visits
          .filter((v) => v.nextVisitDate && v.nextVisitDate.getTime() >= now - 24 * 3600_000)
          .map((v) => ({
            kind: 'next_visit',
            dateFa: faDateStr(v.nextVisitDate!),
            label: 'ویزیتِ بعدی',
            detail: `پیروِ مراجعهٔ ${p.code}-V${v.seq}`,
          })),
        ...appointments.map((a) => ({
          kind: 'appointment',
          dateFa: faDateStr(a.date),
          label: a.status === 'confirmed' ? 'نوبتِ قطعی' : 'نوبتِ رزروشده',
          detail: [
            a.topic?.name,
            a.startMin != null ? `ساعتِ ${AvailabilityService.minToHHMM(a.startMin)}` : null,
          ].filter(Boolean).join(' — ') || null,
        })),
      ],
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
