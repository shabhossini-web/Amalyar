import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { jalaliMonthRange, toJalali } from '../common/jalali';

/** نقشِ شغلی — جدا از سطحِ دسترسی. */
export const JOB_ROLES = ['tech', 'driver', 'courier', 'office'] as const;
export const JOB_LABELS: Record<string, string> = {
  tech: 'کارشناس',
  driver: 'راننده',
  courier: 'پیک',
  office: 'دفتر',
};

/// نقش‌هایی که در چینش تخصیص داده می‌شوند (کارشناس روی خودِ Visit است).
export const ASSIGN_ROLES = ['driver', 'courier'] as const;

/**
 * چینشِ روزانه — کارشناس، راننده و پیک.
 *
 * ⚠️ **قاعدهٔ حریمِ خصوصی که کلِ متنِ ابلاغ را شکل می‌دهد:** راننده و پیک هیچ
 * اطلاعاتِ بیمار نمی‌گیرند. کارِ آن‌ها رساندنِ ست به بیمارستان در ساعتِ مقرر
 * است؛ نامِ بیمار، تشخیص و نوعِ عمل به کارشان نمی‌آید و دادنش نشتِ بی‌دلیلِ
 * دادهٔ درمانی است. کارشناس که در اتاقِ عمل حاضر است اطلاعاتِ کامل می‌گیرد.
 *
 * متنِ ابلاغ **الان** ساخته می‌شود گرچه پیام‌رسان (فازِ ۶) هنوز نیامده: بدنهٔ
 * پیام همین است و امروز قابلِ کپی‌کردن؛ فردا فقط ترابرش اضافه می‌شود، نه متنش.
 */
@Injectable()
export class DispatchService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** نیروهای قابلِ تخصیص، گروه‌بندی‌شده بر نقشِ شغلی. */
  async staff() {
    const rows = await this.prisma.account.findMany({
      where: { status: 'active' },
      include: { person: { select: { firstName: true, lastName: true, phone: true } } },
      orderBy: { id: 'asc' },
    });
    return rows.map((a) => ({
      id: a.id,
      name: `${a.person.firstName} ${a.person.lastName}`.trim(),
      phone: a.person.phone,
      level: a.level,
      jobRole: a.jobRole,
      jobLabel: a.jobRole ? JOB_LABELS[a.jobRole] ?? a.jobRole : null,
    }));
  }

  async setJobRole(accountId: number, jobRole: string | null, user: any) {
    if (jobRole && !JOB_ROLES.includes(jobRole as any)) throw new BadRequestException('نقشِ شغلی نامعتبر است');
    const row = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!row) throw new NotFoundException('کاربر یافت نشد');
    await this.prisma.account.update({ where: { id: accountId }, data: { jobRole } });
    await this.audit.record({
      actorId: user?.id, action: 'account.jobrole', entityType: 'account', entityId: accountId,
      before: { jobRole: row.jobRole }, after: { jobRole },
    });
    return { ok: true };
  }

  /**
   * نمای ماه — برای هر روز شمارِ عمل‌ها و **کمبودِ نیرو**.
   *
   * تقویمِ عمل‌ها همین ماه را دارد ولی سؤالش فرق می‌کند: آن‌جا «چند عمل داریم»،
   * این‌جا «کدام روز هنوز کسی برایش گذاشته نشده». همین `gaps` تنها دلیلِ وجودِ
   * این endpoint است؛ بدونش چینش‌کننده باید تک‌تکِ روزها را باز کند تا بفهمد
   * کدام عمل بی‌راننده مانده.
   */
  async month(jy: number, jm: number) {
    const [from, to] = this.monthBounds(jy, jm);
    const rows = await this.prisma.visit.findMany({
      where: { opDate: { gte: from, lt: to }, opStatus: { not: 'cancelled' } },
      select: {
        opDate: true, techId: true,
        assignments: { select: { role: true } },
        stockTransfers: { where: { status: { not: 'closed' } }, select: { id: true } },
      },
    });

    const days = new Map<number, { day: number; total: number; noTech: number; noDriver: number }>();
    for (const v of rows) {
      const [, , jd] = toJalali(v.opDate!);
      const cell = days.get(jd) ?? { day: jd, total: 0, noTech: 0, noDriver: 0 };
      cell.total += 1;
      if (!v.techId) cell.noTech += 1;
      // «بی‌راننده» فقط وقتی کمبود است که باری برای بردن باشد؛ عملِ بی‌حواله
      // راننده نمی‌خواهد و علامت‌زدنش یعنی هشدارِ دروغ در تمامِ ماه.
      if (v.stockTransfers.length > 0 && !v.assignments.some((a) => a.role === 'driver')) cell.noDriver += 1;
      days.set(jd, cell);
    }
    return { year: jy, month: jm, days: [...days.values()].sort((a, b) => a.day - b.day), total: rows.length };
  }

  private monthBounds(jy: number, jm: number): [Date, Date] {
    if (!Number.isInteger(jy) || jy < 1300 || jy > 1500) throw new BadRequestException('سالِ نامعتبر');
    if (!Number.isInteger(jm) || jm < 1 || jm > 12) throw new BadRequestException('ماهِ نامعتبر');
    return jalaliMonthRange(jy, jm);
  }

  /**
   * تختهٔ یک روز — عمل‌ها با نیروهای تخصیص‌یافته و ستِ ارسالی.
   *
   * ستِ هر عمل از حواله‌های همان مراجعه می‌آید، نه از فیلدی جدا: «چه ستی
   * می‌رود» را انبار می‌داند و تکرارش این‌جا یعنی دو جواب برای یک سؤال.
   */
  async day(jy: number, jm: number, jd: number) {
    const [monthStart] = this.monthBounds(jy, jm);
    const from = new Date(monthStart);
    from.setUTCDate(from.getUTCDate() + (jd - 1));
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 1);
    if (toJalali(from)[2] !== jd) throw new BadRequestException('روزِ نامعتبر برای این ماه');

    const visits = await this.prisma.visit.findMany({
      where: { opDate: { gte: from, lt: to }, opStatus: { not: 'cancelled' } },
      orderBy: [{ opStartTime: 'asc' }, { id: 'asc' }],
      include: {
        patient: { select: { code: true, firstName: true, lastName: true } },
        surgeon: { include: { person: { select: { firstName: true, lastName: true } } } },
        hospital: true,
        tech: { include: { person: { select: { firstName: true, lastName: true, phone: true } } } },
        procedureType: { select: { name: true } },
        assignments: { include: { account: { include: { person: { select: { firstName: true, lastName: true, phone: true } } } } } },
        stockTransfers: {
          where: { status: { not: 'closed' } },
          include: { movements: { where: { quantity: { gt: 0 }, kind: 'transfer' }, include: { lot: { include: { item: { select: { name: true, size: true } } } } } } },
        },
      },
    });

    return {
      year: jy, month: jm, day: jd,
      visits: visits.map((v) => this.shape(v)),
    };
  }

  private shape(v: any) {
    const cargo = v.stockTransfers.flatMap((t: any) =>
      t.movements
        .filter((m: any) => m.location === t.toLocation)
        .map((m: any) => ({
          transferCode: t.code,
          toLocation: t.toLocation,
          itemName: [m.lot.item.name, m.lot.item.size].filter(Boolean).join(' '),
          lotNo: m.lot.serialNo || m.lot.lotNo,
          quantity: m.quantity,
        })),
    );
    return {
      id: v.id,
      code: `${v.patient.code}-V${v.seq}`,
      fullName: `${v.patient.firstName} ${v.patient.lastName}`.trim(),
      opStatus: v.opStatus,
      opStartTime: v.opStartTime,
      opEndTime: v.opEndTime,
      techArriveTime: v.techArriveTime,
      surgeonName: v.surgeon ? `${v.surgeon.person.firstName} ${v.surgeon.person.lastName}`.trim() : v.surgeonName,
      procedureName: v.procedureType?.name ?? v.opType,
      hospital: v.hospital
        ? { id: v.hospital.id, name: v.hospital.name, address: v.hospital.address, phone: v.hospital.phone, contactName: v.hospital.contactName, contactPhone: v.hospital.contactPhone }
        : (v.hospitalName ? { id: null, name: v.hospitalName, address: null, phone: null, contactName: null, contactPhone: null } : null),
      tech: v.tech
        ? { id: v.tech.id, name: `${v.tech.person.firstName} ${v.tech.person.lastName}`.trim(), phone: v.tech.person.phone }
        : null,
      assignments: v.assignments.map((a: any) => ({
        id: a.id, role: a.role, roleLabel: JOB_LABELS[a.role] ?? a.role,
        accountId: a.accountId,
        name: `${a.account.person.firstName} ${a.account.person.lastName}`.trim(),
        phone: a.account.person.phone,
        note: a.note,
      })),
      cargo,
    };
  }

  async assign(visitId: number, dto: { accountId: number; role: string; note?: string }, user: any) {
    if (!ASSIGN_ROLES.includes(dto.role as any)) {
      throw new BadRequestException('نقشِ تخصیص فقط راننده یا پیک است؛ کارشناس از فرمِ خودِ مراجعه انتخاب می‌شود');
    }
    const [visit, account] = await Promise.all([
      this.prisma.visit.findUnique({ where: { id: visitId }, select: { id: true } }),
      this.prisma.account.findUnique({ where: { id: Number(dto.accountId) }, select: { id: true, status: true } }),
    ]);
    if (!visit) throw new NotFoundException('مراجعه پیدا نشد');
    if (!account || account.status !== 'active') throw new NotFoundException('کاربرِ فعال یافت نشد');

    const row = await this.prisma.visitAssignment.upsert({
      where: { visitId_accountId_role: { visitId, accountId: account.id, role: dto.role } },
      create: { visitId, accountId: account.id, role: dto.role, note: text(dto.note), createdById: user?.id ?? null },
      update: { note: text(dto.note) },
    });
    await this.audit.record({
      actorId: user?.id, action: 'dispatch.assign', entityType: 'visit_assignment', entityId: row.id,
      after: { visitId, accountId: account.id, role: dto.role },
    });
    return row;
  }

  async unassign(id: number, user: any) {
    const row = await this.prisma.visitAssignment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('تخصیص یافت نشد');
    await this.prisma.visitAssignment.delete({ where: { id } });
    await this.audit.record({ actorId: user?.id, action: 'dispatch.unassign', entityType: 'visit_assignment', entityId: id, before: row });
    return { ok: true };
  }

  /**
   * متنِ ابلاغِ یک نفر برای یک عمل.
   *
   * یک تولیدکننده برای همهٔ نقش‌ها و همهٔ کانال‌ها: چاپ، کپی، و بعداً بله/روبیکا.
   * دو متنِ جدا برای دو کانال یعنی دو روز بعد یکی‌شان تاریخ را جا می‌اندازد.
   */
  async briefing(visitId: number, role: string) {
    if (!JOB_ROLES.includes(role as any)) throw new BadRequestException('نقش نامعتبر است');
    const v = await this.prisma.visit.findUnique({
      where: { id: visitId },
      include: {
        patient: { select: { code: true, firstName: true, lastName: true } },
        surgeon: { include: { person: { select: { firstName: true, lastName: true } } } },
        hospital: true,
        tech: { include: { person: { select: { firstName: true, lastName: true, phone: true } } } },
        procedureType: { select: { name: true } },
        assignments: { include: { account: { include: { person: { select: { firstName: true, lastName: true, phone: true } } } } } },
        stockTransfers: {
          where: { status: { not: 'closed' } },
          include: { movements: { where: { quantity: { gt: 0 }, kind: 'transfer' }, include: { lot: { include: { item: { select: { name: true, size: true } } } } } } },
        },
      },
    });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    return { role, roleLabel: JOB_LABELS[role] ?? role, text: briefingText(this.shape(v), v.opDate, role) };
  }
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() || null : null);
const faNum = (n: number) => Number(n).toLocaleString('fa-IR');

function faDate(d: Date | null): string {
  if (!d) return '—';
  const [jy, jm, jd] = toJalali(d);
  const months = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  return `${faNum(jd)} ${months[jm - 1]} ${String(jy).replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[Number(x)])}`;
}

/**
 * بدنهٔ پیام — **خالص**، تا هم API بتواند بدهد هم آزمون مستقیم صدایش بزند.
 *
 * ⚠️ تفاوتِ نقش‌ها این‌جا اعمال می‌شود، نه در UI: اگر فیلترِ حریمِ خصوصی در
 * صفحه باشد، اولین کانالِ دیگری که اضافه شود (پیامک، بله) آن را دور می‌زند.
 */
export function briefingText(v: any, opDate: Date | null, role: string): string {
  const L: string[] = [];
  const h = v.hospital;
  const when = `${faDate(opDate)}${v.opStartTime ? ` — ساعتِ ${v.opStartTime}` : ''}`;

  if (role === 'tech') {
    L.push('📋 ابلاغِ مأموریت — کارشناس');
    L.push(`بیمار: ${v.fullName} (${v.code})`);
    if (v.procedureName) L.push(`نوعِ عمل: ${v.procedureName}`);
    if (v.surgeonName) L.push(`جراح: ${v.surgeonName}`);
  } else {
    // راننده و پیک: بدونِ هیچ اطلاعاتِ بیمار.
    L.push(`🚚 ابلاغِ مأموریت — ${JOB_LABELS[role] ?? role}`);
  }

  L.push(`بیمارستان: ${h?.name ?? '—'}`);
  if (h?.address) L.push(`آدرس: ${h.address}`);
  if (h?.contactName || h?.contactPhone) {
    L.push(`رابطِ بیمارستان: ${[h.contactName, h.contactPhone].filter(Boolean).join(' — ')}`);
  } else if (h?.phone) {
    L.push(`تلفنِ بیمارستان: ${h.phone}`);
  }

  L.push(`زمان: ${when}`);
  if (role === 'tech' && v.techArriveTime) L.push(`ساعتِ حضورِ شما: ${v.techArriveTime}`);

  if (v.cargo?.length) {
    L.push('');
    L.push(role === 'tech' ? '📦 ستِ ارسالی:' : '📦 بارِ ارسالی:');
    for (const c of v.cargo) {
      L.push(`• ${c.itemName}${c.lotNo ? ` (${c.lotNo})` : ''} — ${faNum(c.quantity)} عدد${c.transferCode ? ` · حوالهٔ ${c.transferCode}` : ''}`);
    }
    const dest = v.cargo[0]?.toLocation;
    if (dest && dest !== h?.name) L.push(`محلِ تحویل: ${dest}`);
  } else if (role !== 'tech') {
    L.push('');
    L.push('📦 هنوز حواله‌ای برای این عمل صادر نشده است.');
  }

  const mine = (v.assignments ?? []).filter((a: any) => a.role === role);
  for (const a of mine) if (a.note) { L.push(''); L.push(`یادداشت: ${a.note}`); }

  return L.join('\n');
}
