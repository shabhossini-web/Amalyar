import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { jalaliMonthRange, toJalali } from '../common/jalali';

export const STOP_KINDS = ['deliver', 'pickup'] as const;
export const STOP_LABELS: Record<string, string> = { deliver: 'تحویل', pickup: 'جمع‌آوری' };
export const RUN_STATUSES = ['planned', 'active', 'done'] as const;
export const RUN_LABELS: Record<string, string> = {
  planned: 'برنامه‌ریزی‌شده',
  active: 'در مسیر',
  done: 'تمام‌شده',
};

const text = (v: unknown) => (typeof v === 'string' ? v.trim() || null : null);
const faNum = (n: number) => Number(n).toLocaleString('fa-IR');
const FA_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

function faDate(d: Date | null): string {
  if (!d) return '—';
  const [jy, jm, jd] = toJalali(d);
  return `${faNum(jd)} ${FA_MONTHS[jm - 1]} ${String(jy).replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[Number(x)])}`;
}

/** روزِ UTC بدونِ ساعت — کلیدِ «مسیرهای امروز». */
const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * مسیرِ حملِ روزانه.
 *
 * ⚠️ **دانهٔ درست «مسیر» است نه «عمل».** راننده یک ست را به یک بیمارستان
 * نمی‌برد: چند ست را به ترتیب به چند بیمارستان می‌برد و عصر جمع می‌کند. با
 * تخصیصِ per-visit، «مسیرِ امروزِ مرتضی» جواب نداشت و ابلاغ N پیامِ جدا می‌شد
 * که راننده باید خودش مرتبشان می‌کرد.
 *
 * «رانندهٔ این عمل» حالا **مشتق** است: عمل ← حواله ← توقف ← مسیر ← نیرو.
 */
@Injectable()
export class RoutesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private static readonly STOP_INCLUDE = {
    hospital: { select: { id: true, name: true, address: true, phone: true, contactName: true, contactPhone: true } },
    transfers: {
      include: {
        // ⚠️ کارشناس دادهٔ بیمار نیست، همکار است: راننده باید بداند سرِ عمل
        // با چه کسی هماهنگ کند و ست را به دستِ چه کسی برساند.
        visit: {
          select: {
            id: true, seq: true, opStartTime: true, opEndTime: true, cargoDueTime: true,
            patient: { select: { code: true } },
            tech: { include: { person: { select: { firstName: true, lastName: true, phone: true } } } },
          },
        },
        movements: {
          where: { kind: 'transfer', quantity: { gt: 0 } },
          include: { lot: { include: { item: { select: { name: true, size: true, assetKind: true } } } } },
        },
      },
    },
  } as const;

  /** روزهای ماه با شمارِ مسیر و توقف — نمای بالادستیِ چینش. */
  async month(jy: number, jm: number) {
    if (!Number.isInteger(jy) || jy < 1300 || jy > 1500) throw new BadRequestException('سالِ نامعتبر');
    if (!Number.isInteger(jm) || jm < 1 || jm > 12) throw new BadRequestException('ماهِ نامعتبر');
    const [from, to] = jalaliMonthRange(jy, jm);
    const runs = await this.prisma.transportRun.findMany({
      where: { runDate: { gte: from, lt: to } },
      select: { runDate: true, _count: { select: { stops: true } } },
    });
    const days = new Map<number, { day: number; runs: number; stops: number }>();
    for (const r of runs) {
      const [, , jd] = toJalali(r.runDate);
      const cell = days.get(jd) ?? { day: jd, runs: 0, stops: 0 };
      cell.runs += 1;
      cell.stops += r._count.stops;
      days.set(jd, cell);
    }
    return { year: jy, month: jm, days: [...days.values()].sort((a, b) => a.day - b.day) };
  }

  /** مسیرهای یک روز، با توقف‌ها و بارِ هر توقف. */
  async day(on: Date) {
    const from = dayOf(on);
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 1);
    const runs = await this.prisma.transportRun.findMany({
      where: { runDate: { gte: from, lt: to } },
      orderBy: { id: 'asc' },
      include: {
        staff: { include: { person: { select: { firstName: true, lastName: true, phone: true } } } },
        stops: { orderBy: { seq: 'asc' }, include: RoutesService.STOP_INCLUDE },
      },
    });
    await this.withPlannedLots(runs.flatMap((r) => r.stops.flatMap((s: any) => s.transfers)));
    return { on: from, runs: runs.map((r) => this.shape(r)) };
  }

  async run(id: number) {
    const r = await this.prisma.transportRun.findUnique({
      where: { id },
      include: {
        staff: { include: { person: { select: { firstName: true, lastName: true, phone: true } } } },
        stops: { orderBy: { seq: 'asc' }, include: RoutesService.STOP_INCLUDE },
      },
    });
    if (!r) throw new NotFoundException('مسیر یافت نشد');
    // نامِ کالای حوالهٔ برنامه‌ریزی‌شده در `plannedLines` فقط شناسهٔ لات است؛
    // بدونِ این، بارِ مسیرِ فردا روی صفحه بی‌نام دیده می‌شد.
    await this.withPlannedLots(r.stops.flatMap((s: any) => s.transfers));
    return this.shape(r);
  }

  private shape(r: any) {
    return {
      id: r.id,
      runDate: r.runDate,
      status: r.status,
      statusLabel: RUN_LABELS[r.status] ?? r.status,
      notes: r.notes,
      staff: {
        id: r.staff.id,
        name: `${r.staff.person.firstName} ${r.staff.person.lastName}`.trim(),
        phone: r.staff.person.phone,
        role: r.staff.role,
      },
      // خودروی مسیر بر خودروی همیشگیِ نیرو مقدم است.
      vehicle: r.vehicle ?? r.staff.vehicle,
      stops: r.stops.map((s: any) => ({
        id: s.id,
        seq: s.seq,
        kind: s.kind,
        kindLabel: STOP_LABELS[s.kind] ?? s.kind,
        plannedAt: s.plannedAt,
        doneAt: s.doneAt,
        handedTo: s.handedTo,
        notes: s.notes,
        hospital: s.hospital,
        locationName: s.locationName ?? s.hospital?.name ?? null,
        transfers: s.transfers.map((t: any) => ({
          id: t.id,
          code: t.code,
          status: t.status,
          visitCode: t.visit ? `${t.visit.patient.code}-V${t.visit.seq}` : null,
          opStartTime: t.visit?.opStartTime ?? null,
          cargoDueTime: t.visit?.cargoDueTime ?? null,
          releasedAt: t.releasedAt,
          tech: t.visit?.tech
            ? {
              name: `${t.visit.tech.person.firstName} ${t.visit.tech.person.lastName}`.trim(),
              phone: t.visit.tech.person.phone,
            }
            : null,
          lines: this.linesOf(t),
        })),
      })),
    };
  }

  /**
   * قلم‌های یک حواله — از حرکت‌ها، و برای حوالهٔ برنامه‌ریزی‌شده از `plannedLines`.
   *
   * حوالهٔ فردا هنوز حرکتی ندارد؛ بدونِ این شاخه، بارِ مسیرِ فردا خالی دیده
   * می‌شد — یعنی دقیقاً همان مسیری که باید چیده شود.
   */
  private linesOf(t: any) {
    if (t.status !== 'planned') {
      return t.movements
        .filter((m: any) => m.location === t.toLocation)
        .map((m: any) => ({
          itemName: [m.lot.item.name, m.lot.item.size].filter(Boolean).join(' '),
          assetKind: m.lot.item.assetKind,
          serialNo: m.lot.serialNo || m.lot.lotNo,
          quantity: m.quantity,
        }));
    }
    return ((t.plannedLines as any[] | null) ?? []).map((l) => ({
      itemName: t.__lots?.[l.lotId]?.name ?? '—',
      assetKind: t.__lots?.[l.lotId]?.assetKind ?? 'consumable',
      serialNo: t.__lots?.[l.lotId]?.serialNo ?? null,
      quantity: Number(l.quantity),
    }));
  }

  // ── ساخت و ویرایش ────────────────────────────────────────────

  async createRun(dto: { staffId: number; runDate: string; vehicle?: string; notes?: string }, user: any) {
    const staff = await this.prisma.transportStaff.findUnique({ where: { id: Number(dto.staffId) } });
    if (!staff || !staff.active) throw new NotFoundException('نیروی فعال یافت نشد');
    const runDate = dayOf(new Date(dto.runDate));
    if (Number.isNaN(+runDate)) throw new BadRequestException('تاریخِ مسیر نامعتبر است');

    // یک نیرو در یک روز یک مسیر دارد؛ دو مسیر یعنی دو «برنامهٔ امروز» که با هم
    // نمی‌خوانند و ابلاغ نمی‌داند کدام را بفرستد.
    const dup = await this.prisma.transportRun.findFirst({ where: { staffId: staff.id, runDate } });
    if (dup) throw new BadRequestException('این نیرو برای همین روز مسیر دارد؛ توقف را به همان اضافه کنید');

    const row = await this.prisma.transportRun.create({
      data: {
        staffId: staff.id, runDate,
        vehicle: text(dto.vehicle), notes: text(dto.notes),
        createdById: user?.id ?? null,
      },
    });
    await this.audit.record({
      actorId: user?.id, action: 'transport.run.create', entityType: 'transport_run', entityId: row.id,
      after: { staffId: staff.id, runDate },
    });
    return this.run(row.id);
  }

  async updateRun(id: number, dto: { vehicle?: string; notes?: string; status?: string }, user: any) {
    const r = await this.prisma.transportRun.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('مسیر یافت نشد');
    if (dto.status && !RUN_STATUSES.includes(dto.status as any)) throw new BadRequestException('وضعیتِ مسیر نامعتبر است');
    await this.prisma.transportRun.update({
      where: { id },
      data: {
        ...(dto.vehicle !== undefined ? { vehicle: text(dto.vehicle) } : {}),
        ...(dto.notes !== undefined ? { notes: text(dto.notes) } : {}),
        ...(dto.status ? { status: dto.status } : {}),
      },
    });
    await this.audit.record({
      actorId: user?.id, action: 'transport.run.update', entityType: 'transport_run', entityId: id,
      before: { status: r.status }, after: dto,
    });
    return this.run(id);
  }

  async deleteRun(id: number, user: any) {
    const r = await this.prisma.transportRun.findUnique({ where: { id }, include: { stops: true } });
    if (!r) throw new NotFoundException('مسیر یافت نشد');
    // حواله‌ها به توقف گره خورده‌اند؛ حذفِ مسیر نباید حواله را ببرد.
    await this.prisma.stockTransfer.updateMany({
      where: { stopId: { in: r.stops.map((s) => s.id) } }, data: { stopId: null },
    });
    await this.prisma.transportRun.delete({ where: { id } });
    await this.audit.record({ actorId: user?.id, action: 'transport.run.delete', entityType: 'transport_run', entityId: id, before: r });
    return { ok: true };
  }

  async addStop(
    runId: number,
    dto: { hospitalId?: number; locationName?: string; kind: string; plannedAt?: string; notes?: string; transferIds?: number[] },
    user: any,
  ) {
    const run = await this.prisma.transportRun.findUnique({ where: { id: runId }, include: { stops: true } });
    if (!run) throw new NotFoundException('مسیر یافت نشد');
    if (!STOP_KINDS.includes(dto.kind as any)) throw new BadRequestException('نوعِ توقف باید تحویل یا جمع‌آوری باشد');
    if (!dto.hospitalId && !text(dto.locationName)) throw new BadRequestException('مقصدِ توقف را وارد کنید');

    const seq = Math.max(0, ...run.stops.map((s) => s.seq)) + 1;
    const stop = await this.prisma.transportStop.create({
      data: {
        runId, seq, kind: dto.kind,
        hospitalId: dto.hospitalId ?? null,
        locationName: text(dto.locationName),
        plannedAt: normalizeTime(dto.plannedAt),
        notes: text(dto.notes),
      },
    });
    if (dto.transferIds?.length) await this.attach(stop.id, dto.transferIds, user);
    await this.audit.record({
      actorId: user?.id, action: 'transport.stop.add', entityType: 'transport_stop', entityId: stop.id,
      after: { runId, seq, kind: dto.kind },
    });
    return this.run(runId);
  }

  async updateStop(id: number, dto: { plannedAt?: string; notes?: string; handedTo?: string; done?: boolean }, user: any) {
    const s = await this.prisma.transportStop.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('توقف یافت نشد');
    await this.prisma.transportStop.update({
      where: { id },
      data: {
        ...(dto.plannedAt !== undefined ? { plannedAt: normalizeTime(dto.plannedAt) } : {}),
        ...(dto.notes !== undefined ? { notes: text(dto.notes) } : {}),
        ...(dto.handedTo !== undefined ? { handedTo: text(dto.handedTo) } : {}),
        ...(dto.done !== undefined ? { doneAt: dto.done ? new Date() : null } : {}),
      },
    });
    await this.audit.record({
      actorId: user?.id, action: 'transport.stop.update', entityType: 'transport_stop', entityId: id,
      before: s, after: dto,
    });
    return this.run(s.runId);
  }

  async removeStop(id: number, user: any) {
    const s = await this.prisma.transportStop.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('توقف یافت نشد');
    await this.prisma.stockTransfer.updateMany({ where: { stopId: id }, data: { stopId: null } });
    await this.prisma.transportStop.delete({ where: { id } });
    await this.audit.record({ actorId: user?.id, action: 'transport.stop.remove', entityType: 'transport_stop', entityId: id, before: s });
    return this.run(s.runId);
  }

  /**
   * ترتیبِ توقف‌ها.
   *
   * ⚠️ در دو مرحله نوشته می‌شود چون `(runId, seq)` یکتاست: نوشتنِ مستقیم وسطِ
   * جابه‌جایی به تصادمِ کلید می‌خورد. اول همه به شماره‌های منفیِ موقت می‌روند.
   */
  async reorder(runId: number, stopIds: number[], user: any) {
    const run = await this.prisma.transportRun.findUnique({ where: { id: runId }, include: { stops: true } });
    if (!run) throw new NotFoundException('مسیر یافت نشد');
    const have = new Set(run.stops.map((s) => s.id));
    if (stopIds.length !== have.size || stopIds.some((id) => !have.has(id))) {
      throw new BadRequestException('فهرستِ توقف‌ها با خودِ مسیر نمی‌خواند');
    }
    await this.prisma.$transaction(async (tx) => {
      for (const [i, id] of stopIds.entries()) {
        await tx.transportStop.update({ where: { id }, data: { seq: -(i + 1) } });
      }
      for (const [i, id] of stopIds.entries()) {
        await tx.transportStop.update({ where: { id }, data: { seq: i + 1 } });
      }
    });
    await this.audit.record({ actorId: user?.id, action: 'transport.run.reorder', entityType: 'transport_run', entityId: runId, after: { stopIds } });
    return this.run(runId);
  }

  /** بستنِ حواله‌ها به یک توقف — «این بار با این توقف می‌رود». */
  async attach(stopId: number, transferIds: number[], user: any) {
    const stop = await this.prisma.transportStop.findUnique({ where: { id: stopId } });
    if (!stop) throw new NotFoundException('توقف یافت نشد');
    const ids = transferIds.map(Number).filter(Boolean);
    if (!ids.length) throw new BadRequestException('حواله‌ای انتخاب نشده است');
    await this.prisma.stockTransfer.updateMany({ where: { id: { in: ids } }, data: { stopId } });
    await this.audit.record({
      actorId: user?.id, action: 'transport.stop.attach', entityType: 'transport_stop', entityId: stopId,
      after: { transferIds: ids },
    });
    return this.run(stop.runId);
  }

  async detach(stopId: number, transferId: number, user: any) {
    const stop = await this.prisma.transportStop.findUnique({ where: { id: stopId } });
    if (!stop) throw new NotFoundException('توقف یافت نشد');
    await this.prisma.stockTransfer.updateMany({ where: { id: transferId, stopId }, data: { stopId: null } });
    await this.audit.record({
      actorId: user?.id, action: 'transport.stop.detach', entityType: 'transport_stop', entityId: stopId,
      after: { transferId },
    });
    return this.run(stop.runId);
  }

  /**
   * حواله‌هایی که کارشناس آزاد اعلام کرده و هنوز جمع نشده‌اند.
   *
   * ⚠️ عمداً به روز مقید نیست: ستی که دیروز آزاد شد و کسی جمعش نکرد، باید
   * امروز هم دیده شود. صفی که با گذشتنِ روز خالی می‌شود، ست را گم می‌کند.
   */
  async pickupQueue() {
    const rows = await this.prisma.stockTransfer.findMany({
      where: { status: { not: 'closed' }, NOT: { releasedAt: null } },
      orderBy: { releasedAt: 'asc' },
      include: {
        hospital: { select: { id: true, name: true } },
        visit: { select: { seq: true, patient: { select: { code: true } } } },
        stop: { select: { id: true, kind: true, runId: true } },
        movements: {
          where: { kind: 'transfer', quantity: { gt: 0 } },
          include: { lot: { include: { item: { select: { name: true, size: true, assetKind: true } } } } },
        },
      },
    });
    return rows
      // حواله‌ای که همین حالا روی توقفِ جمع‌آوری نشسته دیگر «در صف» نیست.
      .filter((t) => t.stop?.kind !== 'pickup')
      .map((t) => ({
        id: t.id,
        code: t.code,
        hospitalId: t.hospitalId,
        hospitalName: t.hospital?.name ?? t.toLocation,
        toLocation: t.toLocation,
        releasedAt: t.releasedAt,
        releaseNote: t.releaseNote,
        visitCode: t.visit ? `${t.visit.patient.code}-V${t.visit.seq}` : null,
        lines: this.linesOf(t),
      }));
  }

  /** حواله‌های یک روز که هنوز به هیچ مسیری وصل نشده‌اند — کارِ باقی‌ماندهٔ چینش. */
  async unassigned(on: Date) {
    const from = dayOf(on);
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 1);
    const rows = await this.prisma.stockTransfer.findMany({
      where: { stopId: null, status: { not: 'closed' }, plannedFor: { gte: from, lt: to } },
      include: {
        hospital: { select: { id: true, name: true } },
        visit: { select: { seq: true, opStartTime: true, patient: { select: { code: true } } } },
        movements: {
          where: { kind: 'transfer', quantity: { gt: 0 } },
          include: { lot: { include: { item: { select: { name: true, size: true, assetKind: true } } } } },
        },
      },
      orderBy: { id: 'asc' },
    });
    const withLots = await this.withPlannedLots(rows);
    return withLots.map((t: any) => ({
      id: t.id,
      code: t.code,
      status: t.status,
      hospitalId: t.hospitalId,
      hospitalName: t.hospital?.name ?? t.toLocation,
      toLocation: t.toLocation,
      visitCode: t.visit ? `${t.visit.patient.code}-V${t.visit.seq}` : null,
      opStartTime: t.visit?.opStartTime ?? null,
      lines: this.linesOf(t),
    }));
  }

  /** لاتِ حواله‌های برنامه‌ریزی‌شده را یک‌جا می‌خواند تا `linesOf` نامِ کالا داشته باشد. */
  private async withPlannedLots(rows: any[]) {
    const ids = rows
      .filter((t) => t.status === 'planned')
      .flatMap((t) => ((t.plannedLines as any[] | null) ?? []).map((l) => Number(l.lotId)));
    if (!ids.length) return rows;
    const lots = await this.prisma.stockLot.findMany({
      where: { id: { in: [...new Set(ids)] } },
      include: { item: { select: { name: true, size: true, assetKind: true } } },
    });
    const map: Record<number, any> = {};
    for (const l of lots) {
      map[l.id] = {
        name: [l.item.name, l.item.size].filter(Boolean).join(' '),
        assetKind: l.item.assetKind,
        serialNo: l.serialNo || l.lotNo,
      };
    }
    for (const t of rows) if (t.status === 'planned') t.__lots = map;
    return rows;
  }

  /**
   * ابلاغِ کلِ مسیر به نیرو — یک پیام، نه N پیام.
   *
   * ⚠️ همان قاعدهٔ حریمِ خصوصی: نامِ بیمار، جراح و نوعِ عمل نمی‌آید. راننده باید
   * بداند چه چیزی، کجا، ساعتِ چند — نه اینکه برای کیست. قاعده در **سرویس**
   * اعمال می‌شود نه در UI، تا کانالِ بعدی (بله/پیامک) دورش نزند.
   */
  async briefing(runId: number) {
    const r = await this.prisma.transportRun.findUnique({
      where: { id: runId },
      include: {
        staff: { include: { person: { select: { firstName: true, lastName: true } } } },
        stops: { orderBy: { seq: 'asc' }, include: RoutesService.STOP_INCLUDE },
      },
    });
    if (!r) throw new NotFoundException('مسیر یافت نشد');
    await this.withPlannedLots(r.stops.flatMap((s: any) => s.transfers));
    return { runId, text: runBriefing(this.shape(r)) };
  }
}

function normalizeTime(v: unknown): string | null {
  const t = text(v);
  if (!t) return null;
  const en = t.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(en)) throw new BadRequestException('ساعت باید به شکلِ ۰۸:۳۰ باشد');
  return en;
}

/**
 * متنِ ابلاغِ مسیر — **خالص**، تا هم API بدهد هم آزمون مستقیم صدایش بزند.
 *
 * ترتیبِ توقف‌ها همان چیزی است که راننده لازم دارد؛ فهرستِ نامرتبِ عمل‌ها
 * همان است که او مجبور می‌شود خودش روی کاغذ مرتب کند.
 */
export function runBriefing(r: any): string {
  const L: string[] = [];
  L.push(`🚚 مسیرِ ${faDate(r.runDate)} — ${r.staff.name}`);
  if (r.vehicle) L.push(`خودرو: ${r.vehicle}`);
  if (r.notes) L.push(`یادداشتِ مسیر: ${r.notes}`);

  if (!r.stops.length) {
    L.push('');
    L.push('هنوز توقفی برای این مسیر ثبت نشده است.');
    return L.join('\n');
  }

  for (const s of r.stops) {
    L.push('');
    const h = s.hospital;
    L.push(`${faNum(s.seq)}) ${s.plannedAt ? `${s.plannedAt} — ` : ''}${s.locationName ?? '—'} · ${s.kindLabel}`);
    if (h?.address) L.push(`   آدرس: ${h.address}`);
    if (h?.contactName || h?.contactPhone) {
      L.push(`   رابط: ${[h.contactName, h.contactPhone].filter(Boolean).join(' — ')}`);
    } else if (h?.phone) {
      L.push(`   تلفن: ${h.phone}`);
    }
    for (const t of s.transfers) {
      for (const l of t.lines) {
        L.push(`   • ${l.itemName}${l.serialNo ? ` (${l.serialNo})` : ''} — ${faNum(l.quantity)} عدد · حوالهٔ ${t.code}`);
      }
      if (!t.lines.length) L.push(`   • حوالهٔ ${t.code} — بدونِ قلم`);
      // ساعتِ تحویل و نامِ کارشناس — همان دو چیزی که راننده سرِ بیمارستان
      // لازم دارد. کارشناس همکار است نه بیمار، پس نامش نشتِ دادهٔ درمانی نیست.
      if (s.kind === 'deliver' && t.cargoDueTime) L.push(`   ساعتِ تحویل: تا ${t.cargoDueTime}`);
      if (t.tech) L.push(`   کارشناسِ حاضر: ${t.tech.name}${t.tech.phone ? ` — ${t.tech.phone}` : ''}`);
    }
    if (!s.transfers.length) L.push('   • بدونِ بار');
    if (s.notes) L.push(`   یادداشت: ${s.notes}`);
  }
  return L.join('\n');
}
