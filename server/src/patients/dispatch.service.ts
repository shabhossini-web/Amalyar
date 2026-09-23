import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { jalaliMonthRange, toJalali } from '../common/jalali';
import { kitTemplate, OTHER_PX_KIT, procedureLabel } from './visit-coding';

/**
 * نقش‌هایی که ابلاغِ **per-visit** می‌گیرند.
 *
 * ⚠️ فقط کارشناس. راننده و پیک ابلاغِ **مسیر** می‌گیرند نه ابلاغِ عمل: یک نفر
 * چند بیمارستان را به ترتیب می‌رود، و N پیامِ جدا یعنی خودش باید مرتبشان کند.
 * متنِ مسیر در `routes.service` است.
 */
export const BRIEF_ROLES = ['tech'] as const;
export const JOB_LABELS: Record<string, string> = {
  tech: 'کارشناس',
  driver: 'راننده',
  courier: 'پیک',
};

/// نقش‌هایی که مسیرِ حمل می‌گیرند.
/// کارشناس این‌جا نیست چون روی خودِ `Visit.techId` نوشته می‌شود، نه چون
/// انتخاب نمی‌شود — تبِ کارشناسِ همین پنل همان ستون را می‌نویسد.
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

  /** نیروهای حمل‌ونقلِ فعال — همان‌هایی که در تعاریفِ پایه تعریف شده‌اند. */
  async staff() {
    const rows = await this.prisma.transportStaff.findMany({
      where: { active: true },
      include: { person: { select: { firstName: true, lastName: true, phone: true } } },
      orderBy: [{ role: 'asc' }, { id: 'asc' }],
    });
    return rows.map((s) => ({
      id: s.id,
      name: `${s.person.firstName} ${s.person.lastName}`.trim(),
      phone: s.person.phone,
      role: s.role,
      roleLabel: JOB_LABELS[s.role] ?? s.role,
      vehicle: s.vehicle,
    }));
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
        stockTransfers: { where: { status: { not: 'closed' } }, select: { id: true, stopId: true } },
      },
    });

    const days = new Map<number, { day: number; total: number; noTech: number; noDriver: number }>();
    for (const v of rows) {
      const [, , jd] = toJalali(v.opDate!);
      const cell = days.get(jd) ?? { day: jd, total: 0, noTech: 0, noDriver: 0 };
      cell.total += 1;
      if (!v.techId) cell.noTech += 1;
      // «بی‌راننده» یعنی حواله‌ای دارد که هنوز روی هیچ مسیری ننشسته. عملِ
      // بی‌حواله راننده نمی‌خواهد و علامت‌زدنش هشدارِ دروغ در تمامِ ماه است.
      if (v.stockTransfers.some((t: any) => !t.stopId)) cell.noDriver += 1;
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
        // الگوی اقلام: «این نوعِ عمل چه می‌خواهد» — برای هشدارِ عملِ بی‌بار.
        procedureType: { select: { name: true, needs: { include: { item: { select: { id: true, name: true, size: true, assetKind: true } } } } } },
        // بستهٔ ۷ج: عمل‌های همزمانِ همان جلسه — نامشان برای برچسب و نیازشان برای
        // اجتماعِ کیت (`kitTemplate`). هیچ تشخیصی این‌جا خوانده نمی‌شود.
        otherProcedures: OTHER_PX_KIT,
        // «رانندهٔ این عمل» ذخیره نمی‌شود: از مسیرِ حمل مشتق است — عمل ← حواله
        // ← توقف ← مسیر ← نیرو. ستونِ جدا یعنی دو جواب برای یک سؤال.
        stockTransfers: {
          where: { status: { not: 'closed' } },
          include: {
            movements: { where: { quantity: { gt: 0 }, kind: 'transfer' }, include: { lot: { include: { item: { select: { name: true, size: true, category: true } } } } } },
            stop: { include: { run: { include: { staff: { include: { person: { select: { firstName: true, lastName: true, phone: true } } } } } } } },
          },
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
          category: m.lot.item.category,
          lotNo: m.lot.serialNo || m.lot.lotNo,
          quantity: m.quantity,
        })),
    );
    /**
     * ⚠️ «عملِ بی‌بار» — عملی که هیچ ستی به اسمش نیست.
     *
     * بیمارستانی که عمل دارد بدونِ دستگاه یا ست نمی‌شود؛ نورومانیتورینگ
     * دستگاه می‌خواهد و پیچ‌گذاری ست و مصرفی. تا امروز این را فقط چینش‌کننده
     * از حافظه‌اش می‌دانست و صبحِ عمل معلوم می‌شد. حالا خودِ تخته می‌گوید.
     *
     * دو سطح: **بی‌بار** (اصلاً حواله‌ای ندارد) و **کسری** (الگوی نوعِ عمل
     * چیزی می‌خواهد که در بار نیست). کسری فقط وقتی معنا دارد که الگو تعریف
     * شده باشد — نبودِ الگو یعنی «نمی‌دانیم»، نه «چیزی لازم نیست».
     */
    /* ⚠️ قاعدهٔ override همان دیروز است: هر آرایه‌ای در `requiredItems` (حتی
       خالی) برنده است. فقط fallbackِ الگو حالا اجتماعِ نیازِ **همهٔ** عمل‌های
       جلسه است — دو عمل یعنی اقلامِ هر دو، وگرنه کسریِ عملِ دوم دیده نمی‌شد. */
    const needs = Array.isArray(v.requiredItems) ? v.requiredItems : kitTemplate(v);
    const loaded = new Map<number, number>();
    for (const transfer of v.stockTransfers) for (const move of transfer.movements) {
      if (move.location === transfer.toLocation && move.lot?.itemId) loaded.set(move.lot.itemId, (loaded.get(move.lot.itemId) ?? 0) + move.quantity);
    }
    const missing = needs
      .filter((n: any) => (loaded.get(n.itemId) ?? 0) < n.quantity)
      .map((n: any) => ({ itemId: n.itemId, name: n.name ?? [n.item.name, n.item.size].filter(Boolean).join(' '), quantity: n.quantity - (loaded.get(n.itemId) ?? 0) }));

    return {
      id: v.id,
      code: `${v.patient.code}-V${v.seq}`,
      /// هیچ حواله‌ای ندارد — قرمزِ درجه‌یک.
      noCargo: v.stockTransfers.length === 0,
      /// الگو چیزی می‌خواهد که در بار نیست.
      missingNeeds: missing,
      requiredItems: needs.map((n: any) => ({ itemId: n.itemId, name: n.name ?? [n.item?.name, n.item?.size].filter(Boolean).join(' '), quantity: n.quantity, notes: n.notes ?? '' })),
      surgeonInstructions: v.surgeonInstructions ?? '',
      fullName: `${v.patient.firstName} ${v.patient.lastName}`.trim(),
      opStatus: v.opStatus,
      opStartTime: v.opStartTime,
      opEndTime: v.opEndTime,
      techArriveTime: v.techArriveTime,
      cargoDueTime: v.cargoDueTime,
      surgeonName: v.surgeon ? `${v.surgeon.person.firstName} ${v.surgeon.person.lastName}`.trim() : v.surgeonName,
      /* برچسبِ همهٔ عمل‌ها (اصلی اول، «A + B») — همان کلید. فقط شاخهٔ کارشناسِ
         `briefingText` آن را می‌خواند؛ راننده و پیک هرگز. تشخیص هیچ‌وقت. */
      procedureName: procedureLabel(v),
      hospital: v.hospital
        ? { id: v.hospital.id, name: v.hospital.name, address: v.hospital.address, phone: v.hospital.phone, contactName: v.hospital.contactName, contactPhone: v.hospital.contactPhone }
        : (v.hospitalName ? { id: null, name: v.hospitalName, address: null, phone: null, contactName: null, contactPhone: null } : null),
      tech: v.tech
        ? { id: v.tech.id, name: `${v.tech.person.firstName} ${v.tech.person.lastName}`.trim(), phone: v.tech.person.phone }
        : null,
      // مشتق از مسیر: هر حوالهٔ این عمل یک توقف دارد و هر توقف یک نیرو.
      carriers: carriersOf(v),
      cargo,
    };
  }


  /**
   * متنِ ابلاغِ یک نفر برای یک عمل.
   *
   * یک تولیدکننده برای همهٔ نقش‌ها و همهٔ کانال‌ها: چاپ، کپی، و بعداً بله/روبیکا.
   * دو متنِ جدا برای دو کانال یعنی دو روز بعد یکی‌شان تاریخ را جا می‌اندازد.
   */
  async briefing(visitId: number, role: string) {
    if (!BRIEF_ROLES.includes(role as any)) throw new BadRequestException('نقش نامعتبر است');
    const v = await this.prisma.visit.findUnique({
      where: { id: visitId },
      include: {
        patient: { select: { code: true, firstName: true, lastName: true } },
        surgeon: { include: { person: { select: { firstName: true, lastName: true } } } },
        hospital: true,
        tech: { include: { person: { select: { firstName: true, lastName: true, phone: true } } } },
        // الگوی اقلام: «این نوعِ عمل چه می‌خواهد» — برای هشدارِ عملِ بی‌بار.
        procedureType: { select: { name: true, needs: { include: { item: { select: { id: true, name: true, size: true, assetKind: true } } } } } },
        // بستهٔ ۷ج: عمل‌های همزمانِ همان جلسه — نامشان برای برچسب و نیازشان برای
        // اجتماعِ کیت (`kitTemplate`). هیچ تشخیصی این‌جا خوانده نمی‌شود.
        otherProcedures: OTHER_PX_KIT,
        // «رانندهٔ این عمل» ذخیره نمی‌شود: از مسیرِ حمل مشتق است — عمل ← حواله
        // ← توقف ← مسیر ← نیرو. ستونِ جدا یعنی دو جواب برای یک سؤال.
        stockTransfers: {
          where: { status: { not: 'closed' } },
          include: {
            movements: { where: { quantity: { gt: 0 }, kind: 'transfer' }, include: { lot: { include: { item: { select: { name: true, size: true, category: true } } } } } },
            stop: { include: { run: { include: { staff: { include: { person: { select: { firstName: true, lastName: true, phone: true } } } } } } } },
          },
        },
      },
    });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    return { role, roleLabel: JOB_LABELS[role] ?? role, text: briefingText(this.shape(v), v.opDate, role) };
  }
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() || null : null);

/**
 * حمل‌کننده‌های یک عمل — **مشتق** از مسیر، نه ستونِ ذخیره‌شده.
 *
 * عمل ← حواله ← توقف ← مسیر ← نیرو. همان قاعدهٔ `computeVisit`: عددِ ذخیره‌شده
 * در کنارِ منبع، دیر یا زود از منبع جدا می‌افتد. اگر رانندهٔ مسیر عوض شود،
 * این‌جا بی‌هیچ همگام‌سازی درست می‌ماند.
 */
function carriersOf(v: any) {
  const out = new Map<number, any>();
  for (const t of v.stockTransfers ?? []) {
    const run = t.stop?.run;
    if (!run) continue;
    const key = run.staff.id;
    const row = out.get(key) ?? {
      staffId: run.staff.id,
      runId: run.id,
      stopId: t.stop.id,
      seq: t.stop.seq,
      kind: t.stop.kind,
      plannedAt: t.stop.plannedAt,
      role: run.staff.role,
      roleLabel: JOB_LABELS[run.staff.role] ?? run.staff.role,
      name: `${run.staff.person.firstName} ${run.staff.person.lastName}`.trim(),
      phone: run.staff.person.phone,
      vehicle: run.vehicle ?? run.staff.vehicle,
      transferCodes: [] as string[],
    };
    row.transferCodes.push(t.code);
    out.set(key, row);
  }
  return [...out.values()];
}
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
  // هر نقش ساعتِ خودش را می‌گیرد: کارشناس ساعتِ حضور، راننده و پیک ساعتی که
  // بار باید تحویلِ CSR شده باشد. دادنِ هر دو به هر دو یعنی یکی‌شان را اشتباه
  // می‌گیرند.
  if (role === 'tech') {
    if (v.techArriveTime) L.push(`ساعتِ حضورِ شما: ${v.techArriveTime}`);
  } else if (v.cargoDueTime) {
    L.push(`بار باید تا ساعتِ ${v.cargoDueTime} تحویل شده باشد`);
  }

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

  return L.join('\n');
}
