import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from './inventory.service';
import { normalizeTime, RoutesService } from './routes.service';
import { OTHER_PX, procedureLabel } from './visit-coding';
import { RETURNABLE } from './assets.service';
import { balanceByLocation } from './stock-math';

const DAY = 24 * 60 * 60 * 1000;
const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const fullName = (p?: { firstName: string; lastName: string } | null) => (p ? `${p.firstName} ${p.lastName}`.trim() : '');

export type PlanDeliveryDto = {
  on: string;
  hospitalId: number;
  /** خالی = فقط ساعت/تحویل‌گیرنده/راننده عوض می‌شود.
   *  `move`: دستگاه/ستی که همان روز در بیمارستانِ دیگری است از آن‌جا جمع و به این‌جا آورده شود. */
  lines?: { lotId: number; quantity: number; move?: boolean }[];
  plannedAt?: string;
  handedTo?: string;
  /** راننده؛ خالی = هنوز راننده ندارد. */
  staffId?: number | null;
  /** ویرایشِ یک تحویلِ موجود؛ خالی = تحویلِ همان بیمارستان در همان روز (یا تازه). */
  stopId?: number;
  force?: boolean;
};

/**
 * **چرا یک قلم آزاد نیست** — هر رزرو یا هر عددی که بیرونِ انبار است، با حواله‌اش.
 *
 * گزارشِ مالک (۱۴۰۵/۰۷/۰۹، رهام): «دستگاه و دو ست هنوز گیرند و هیچ‌جا حواله‌ای نشان نمی‌دهد که
 * حذفش کنم.» تخته فقط «آزاد نیست» می‌گفت؛ رزروِ حواله‌ای که توقفش رفته بود یا مالِ روزِ دیگری
 * بود هیچ‌جا دیده نمی‌شد. حالا هر عددِ کم‌شده یک ردیف دارد: `planned` = رزروِ حوالهٔ
 * ارسال‌نشده (بی‌توقف = جامانده، قابلِ لغو)، `out` = موجودیِ بیرون از انبار طبقِ دفتر.
 */
export type Hold = {
  kind: 'planned' | 'out';
  transferId: number | null;
  code: string | null;
  status: string | null;
  quantity: number;
  place: string | null;
  plannedFor: Date | null;
  plannedAt: string | null;
  stopId: number | null;
};

/**
 * تختهٔ روزِ حمل‌ونقل — «بیمارستان‌های آن روز» به‌جای فرمِ خالی.
 *
 * هر بیمارستانِ روز یک کارت است با عمل‌ها، کارشناسِ حاضر و تحویل‌هایش. «ثبتِ
 * تحویل» یک‌جا سه چیز را می‌سازد که تا دیروز سه فرمِ جدا بود: **حواله** (تعهدِ
 * انبار، با تاریخِ همان روز و وصل به عمل)، **مسیرِ راننده** در همان روز (اگر
 * نبود ساخته می‌شود) و **توقفِ تحویل** با ساعت و تحویل‌گیرنده.
 *
 * ⚠️ هیچ جدول یا قاعدهٔ تازه‌ای نیست؛ همان `TransportRun/Stop/StockTransfer` است.
 * این سرویس فقط ترکیب‌کننده است، پس پرتالِ راننده و ابلاغ دست‌نخورده می‌مانند.
 */
@Injectable()
export class TransportBoardService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private inventory: InventoryService,
    private routes: RoutesService,
  ) {}

  private bounds(on: Date | string): [Date, Date] {
    const d = typeof on === 'string' ? new Date(on) : on;
    if (Number.isNaN(+d)) throw new BadRequestException('تاریخ نامعتبر است');
    const from = dayOf(d);
    return [from, new Date(from.getTime() + DAY)];
  }

  async board(on: Date | string) {
    const [from, to] = this.bounds(on);

    const [visits, duties, day, staff, pickups, looseStops] = await Promise.all([
      this.prisma.visit.findMany({
        where: { opDate: { gte: from, lt: to }, opStatus: { not: 'cancelled' }, patient: { deletedAt: null } },
        orderBy: [{ opStartTime: 'asc' }, { id: 'asc' }],
        select: {
          id: true, seq: true, opStartTime: true, techArriveTime: true, hospitalId: true, hospitalName: true, hospital: { select: { name: true } },
          patient: { select: { code: true, firstName: true, lastName: true } },
          tech: { select: { id: true, person: { select: { firstName: true, lastName: true, phone: true } } } },
          procedureType: { select: { name: true, active: true } },
          otherProcedures: OTHER_PX,
          stockTransfers: { where: { status: { not: 'closed' } }, select: { id: true } },
        },
      }),
      this.prisma.hospitalDuty.findMany({
        where: { date: { gte: from, lt: to }, tech: { status: 'active' } },
        include: {
          hospital: { select: { id: true, name: true } },
          tech: { select: { id: true, person: { select: { firstName: true, lastName: true, phone: true } } } },
        },
        orderBy: [{ arriveTime: 'asc' }, { id: 'asc' }],
      }),
      this.routes.day(from),
      this.prisma.transportStaff.findMany({
        where: { active: true },
        include: { person: { select: { firstName: true, lastName: true, phone: true } } },
        orderBy: { id: 'asc' },
      }),
      this.routes.pickupQueue(),
      // تحویلِ بی‌راننده: رکوردِ روز از حوالهٔ همان روز می‌آید (توقفِ بی‌مسیر تاریخ ندارد).
      this.prisma.transportStop.findMany({
        where: { runId: null, doneAt: null, kind: 'deliver', transfers: { some: { plannedFor: { gte: from, lt: to } } } },
        include: RoutesService.STOP_INCLUDE,
        orderBy: { id: 'asc' },
      }),
    ]);
    await this.routes.withPlannedLots(looseStops.flatMap((s: any) => s.transfers));

    type Row = {
      key: string; hospitalId: number | null; name: string;
      visits: any[]; techs: Map<string, any>; deliveries: any[]; pickups: any[]; hasCargo: boolean; firstTime: string | null;
    };
    const rows = new Map<string, Row>();
    const rowOf = (hospitalId: number | null, name: string | null): Row => {
      const key = hospitalId ? `h${hospitalId}` : `n${name ?? '—'}`;
      let r = rows.get(key);
      if (!r) {
        r = { key, hospitalId, name: name || '—', visits: [], techs: new Map(), deliveries: [], pickups: [], hasCargo: false, firstTime: null };
        rows.set(key, r);
      }
      return r;
    };

    for (const v of visits) {
      const r = rowOf(v.hospitalId, v.hospital?.name ?? v.hospitalName ?? null);
      r.visits.push({
        id: v.id, code: `${v.patient.code}-V${v.seq}`, opStartTime: v.opStartTime,
        procedure: procedureLabel(v),
      });
      if (v.stockTransfers.length) r.hasCargo = true;
      if (v.tech) r.techs.set(`t${v.tech.id}`, { id: v.tech.id, name: fullName(v.tech.person), phone: v.tech.person.phone ?? null, arriveTime: v.techArriveTime ?? null });
      if (v.opStartTime && (!r.firstTime || v.opStartTime < r.firstTime)) r.firstTime = v.opStartTime;
    }
    for (const d of duties) {
      const r = rowOf(d.hospitalId, d.hospital.name);
      r.techs.set(`t${d.tech.id}`, { id: d.tech.id, name: fullName(d.tech.person), phone: d.tech.person.phone ?? null, arriveTime: d.arriveTime });
    }

    const attach = (stop: any, run: any | null) => {
      const r = rowOf(stop.hospital?.id ?? null, stop.hospital?.name ?? stop.locationName ?? null);
      const shaped = {
        id: stop.id, kind: stop.kind, plannedAt: stop.plannedAt, doneAt: stop.doneAt, handedTo: stop.handedTo, notes: stop.notes,
        runId: run?.id ?? null, staffId: run?.staff.id ?? null, staffName: run?.staff.name ?? null,
        transfers: stop.transfers.map((t: any) => ({ id: t.id, code: t.code, status: t.status, lines: t.lines ?? this.routes.linesOf(t) })),
      };
      if (stop.kind === 'pickup') r.pickups.push(shaped); else { r.deliveries.push(shaped); if (shaped.transfers.length) r.hasCargo = true; }
    };
    for (const run of day.runs) for (const s of run.stops) attach(s, run);
    for (const s of looseStops as any[]) {
      attach({ ...s, transfers: s.transfers.map((t: any) => ({ ...t, lines: this.routes.linesOf(t) })) }, null);
    }
    // بارِ آزادشده‌ای که هنوز روی هیچ توقفِ جمع‌آوری نیست — همان کارِ «برگرداندنِ ست».
    const queued: Record<string, any[]> = {};
    for (const q of pickups as any[]) {
      const key = q.hospitalId ? `h${q.hospitalId}` : `n${q.hospitalName}`;
      (queued[key] ??= []).push({ id: q.id, code: q.code, releasedAt: q.releasedAt, releaseNote: q.releaseNote, lines: q.lines });
    }

    const hospitals = [...rows.values()]
      .map((r) => ({
        key: r.key, hospitalId: r.hospitalId, name: r.name,
        visits: r.visits, techs: [...r.techs.values()],
        deliveries: r.deliveries, pickupStops: r.pickups, pickupQueue: queued[r.key] ?? [],
        hasCargo: r.hasCargo, firstTime: r.firstTime,
      }))
      .sort((a, b) => (a.firstTime ?? '99:99').localeCompare(b.firstTime ?? '99:99') || a.name.localeCompare(b.name, 'fa'));

    return {
      on: from,
      drivers: staff.map((s) => ({ id: s.id, name: fullName(s.person), phone: s.person.phone ?? null, vehicle: s.vehicle ?? null, role: s.role })),
      hospitals,
      /// مسیرهای همان روز — برای ابلاغِ یک‌جا و ساختِ توقفِ جمع‌آوری.
      runs: day.runs.map((r: any) => ({ id: r.id, staffId: r.staff.id, staffName: r.staff.name, stops: r.stops.length })),
      summary: {
        hospitals: hospitals.length,
        noCargo: hospitals.filter((h) => h.visits.length && !h.hasCargo).length,
        noDriver: hospitals.filter((h) => h.deliveries.some((d) => !d.staffId && !d.doneAt)).length,
      },
    };
  }

  /**
   * موجودیِ **آزادِ** هر لات برای یک روز — همان عددی که «ثبتِ تحویل» با آن سنجیده می‌شود.
   *
   * - `available`: آنچه همین حالا در انبارِ خودِ لات است (از دفترِ حرکت‌ها).
   * - رزرو: حواله‌های **برنامه‌ریزی‌شده**ای که از همان انبار بیرون می‌روند و هنوز ارسال نشده‌اند.
   *   هر تحویلِ ثبت‌شده همین‌جا از موجودیِ آزاد کم می‌شود؛ حرکتِ واقعیِ انبار هنگامِ ارسال است.
   *   ⚠️ ست و دستگاه برمی‌گردند، پس فقط رزروِ **همان روز** حساب می‌شود (دستگاهی که سه‌شنبه
   *   جای دیگری است دوشنبه آزاد است)؛ مصرفی برنمی‌گردد و هر رزروِ ارسال‌نشده‌اش کم می‌شود.
   * - `inUse`: ست/دستگاهی که همان روز به بیمارستانِ دیگری می‌رود یا رفته — پایهٔ «جابجایی».
   */
  async availability(lotIds: number[], on: Date | string, forHospitalId?: number | null) {
    const [from, to] = this.bounds(on);
    const ids = [...new Set(lotIds.map(Number).filter((x) => Number.isInteger(x) && x > 0))];
    const out = new Map<number, { lotId: number; name: string; returnable: boolean; available: number; reserved: number; free: number; inUse: any[]; holds: Hold[] }>();
    if (!ids.length) return out;
    const [lots, sums, home, transfers, outside] = await Promise.all([
      this.prisma.stockLot.findMany({ where: { id: { in: ids } }, include: { item: { select: { name: true, size: true, assetKind: true } } } }),
      this.prisma.stockMovement.groupBy({ by: ['lotId', 'location'], where: { lotId: { in: ids } }, _sum: { quantity: true } }),
      this.inventory.home(),
      this.prisma.stockTransfer.findMany({
        where: { status: { in: ['planned', 'sent'] } },
        select: {
          id: true, code: true, status: true, plannedFor: true, fromLocation: true, toLocation: true, hospitalId: true, plannedLines: true,
          hospital: { select: { name: true } }, stop: { select: { id: true, plannedAt: true } },
          movements: { where: { kind: 'transfer', quantity: { gt: 0 } }, select: { lotId: true, quantity: true, location: true } },
        },
      }),
      // حواله‌های بازی که لات را از انبار بیرون برده‌اند — فقط برای اینکه «بیرون» بگوید با کدام حواله.
      this.prisma.stockTransfer.findMany({
        where: { status: { in: ['sent', 'received'] }, movements: { some: { lotId: { in: ids }, kind: 'transfer', quantity: { gt: 0 } } } },
        select: { id: true, code: true, status: true, movements: { where: { lotId: { in: ids }, kind: 'transfer', quantity: { gt: 0 } }, select: { lotId: true, location: true } } },
        orderBy: { id: 'desc' },
      }),
    ]);
    for (const lot of lots) {
      const rows = sums.filter((x) => x.lotId === lot.id).map((x) => ({ quantity: x._sum.quantity ?? 0, location: x.location }));
      const homeOf = lot.location ?? home;
      const byPlace = balanceByLocation(rows, homeOf);
      /* «بیرون»: هرچه در محلی جز انبارِ خودِ لات مانده — از همان دفتر، نه حدس. */
      const away: Hold[] = [...byPlace.entries()].filter(([place, q]) => place !== homeOf && q > 0).map(([place, q]) => {
        const t = outside.find((x) => x.movements.some((m) => m.lotId === lot.id && m.location === place));
        return { kind: 'out', transferId: t?.id ?? null, code: t?.code ?? null, status: t?.status ?? null, quantity: q, place, plannedFor: null, plannedAt: null, stopId: null };
      });
      out.set(lot.id, {
        lotId: lot.id,
        name: [lot.item.name, lot.item.size].filter(Boolean).join(' ') + (lot.serialNo ? ` (${lot.serialNo})` : ''),
        returnable: RETURNABLE.includes(lot.item.assetKind ?? 'consumable'),
        available: byPlace.get(homeOf) ?? 0,
        reserved: 0, free: 0, inUse: [], holds: away,
      });
    }
    for (const t of transfers) {
      const sameDay = !!t.plannedFor && t.plannedFor >= from && t.plannedFor < to;
      const lines: { lotId: number; quantity: number }[] = t.status === 'planned'
        ? ((t.plannedLines as any[] | null) ?? []).map((l) => ({ lotId: Number(l.lotId), quantity: Number(l.quantity) }))
        : t.movements.filter((m) => m.location === t.toLocation).map((m) => ({ lotId: m.lotId, quantity: m.quantity }));
      for (const l of lines) {
        const a = out.get(l.lotId);
        if (!a) continue;
        const lot = lots.find((x) => x.id === l.lotId)!;
        const fromHome = t.fromLocation === (lot.location ?? home);
        if (t.status === 'planned' && fromHome && (!a.returnable || sameDay)) {
          a.reserved += l.quantity;
          a.holds.push({
            kind: 'planned', transferId: t.id, code: t.code, status: t.status, quantity: l.quantity,
            place: t.hospital?.name ?? t.toLocation, plannedFor: t.plannedFor, plannedAt: t.stop?.plannedAt ?? null, stopId: t.stop?.id ?? null,
          });
        }
        if (a.returnable && sameDay && t.hospitalId && t.hospitalId !== forHospitalId) {
          a.inUse.push({ transferId: t.id, code: t.code, hospitalId: t.hospitalId, hospitalName: t.hospital?.name ?? t.toLocation, location: t.toLocation, plannedAt: t.stop?.plannedAt ?? null, quantity: l.quantity, status: t.status });
        }
      }
    }
    for (const a of out.values()) a.free = Math.max(0, a.available - a.reserved);
    return out;
  }

  /** لات‌های قابلِ انتخاب برای تحویلِ یک روز، با موجودیِ آزاد و «کجاست». */
  async lots(on: Date | string, q?: string, hospitalId?: number | null) {
    const rows = (await this.inventory.listLots({ q })).filter((r: any) => !r.expired && (r.quantity > 0 || r.available > 0));
    const av = await this.availability(rows.map((r: any) => r.id), on, hospitalId ?? null);
    return rows.slice(0, 60).map((r: any) => {
      const a = av.get(r.id);
      return {
        id: r.id, itemName: r.itemName, itemSize: r.itemSize, serialNo: r.serialNo, lotNo: r.lotNo, unit: r.unit,
        available: a?.available ?? r.available, free: a?.free ?? 0, returnable: !!a?.returnable, inUse: a?.inUse ?? [],
        holds: a?.holds ?? [],
      };
    });
  }

  /**
   * ثبتِ (یا ویرایشِ) تحویلِ یک بیمارستان در یک روز — همهٔ سه ساختار با هم.
   *
   * حواله **اول** ساخته می‌شود: تعارضِ دستگاه (همان دستگاه همان بازه جای دیگر) همین‌جا
   * خطا می‌دهد و هیچ مسیر یا توقفِ نیمه‌کاره‌ای جا نمی‌ماند.
   */
  async planDelivery(dto: PlanDeliveryDto, user: any) {
    const [from] = this.bounds(dto.on);
    const hospital = await this.prisma.hospital.findUnique({ where: { id: Number(dto.hospitalId) }, select: { id: true, name: true } });
    if (!hospital) throw new NotFoundException('بیمارستان پیدا نشد');
    normalizeTime(dto.plannedAt); // ساعتِ نامعتبر پیش از هر نوشتن رد شود
    const staffId = dto.staffId ? Number(dto.staffId) : null;
    const lines = (dto.lines ?? []).filter((l) => l && l.lotId);

    let stop = dto.stopId
      ? await this.prisma.transportStop.findUnique({ where: { id: Number(dto.stopId) }, include: { run: { select: { staffId: true, runDate: true } } } })
      : null;
    if (dto.stopId && (!stop || stop.kind !== 'deliver')) throw new NotFoundException('این تحویل پیدا نشد');
    if (stop?.doneAt) throw new BadRequestException('این تحویل انجام شده و ویرایش نمی‌شود');
    if (!stop && !staffId && !lines.length) throw new BadRequestException('برای ثبتِ تحویل دست‌کم یک قلم یا یک راننده لازم است');

    for (const l of lines) {
      if (!Number.isInteger(Number(l.quantity)) || Number(l.quantity) < 1) throw new BadRequestException('تعدادِ هر قلم باید عددِ صحیحِ مثبت باشد');
    }
    // ۰) سقفِ موجودی — پیش از هر نوشتن. هر قلم یا از انبار می‌آید (تا سقفِ آزاد) یا با
    //    «جابجایی» از بیمارستانِ دیگری که همان روز آن را دارد.
    const av = await this.availability(lines.map((l) => l.lotId), from, hospital.id);
    const home: typeof lines = [];
    const moves: { line: (typeof lines)[number]; src: any }[] = [];
    for (const l of lines) {
      const a = av.get(Number(l.lotId));
      if (!a) throw new NotFoundException('یکی از اقلام در انبار پیدا نشد');
      const q = Number(l.quantity);
      if (q <= a.free) { home.push(l); continue; }
      const where = a.inUse.map((u) => `${u.hospitalName}${u.plannedAt ? ` (${u.plannedAt})` : ''}`).join('، ');
      if (a.returnable && a.inUse.length && l.move) {
        const src = a.inUse.find((u) => u.quantity >= q) ?? a.inUse[0];
        if (q > src.quantity) throw new BadRequestException(`در «${src.hospitalName}» فقط ${src.quantity} عدد از «${a.name}» هست`);
        moves.push({ line: l, src });
        continue;
      }
      if (a.inUse.length) {
        throw new BadRequestException(`«${a.name}» در این روز در ${where} است و در انبار آزاد نیست؛ برای آوردنش «جابجایی بین بیمارستان‌ها» را بزنید`);
      }
      throw new BadRequestException(`موجودیِ «${a.name}» کافی نیست — آزاد: ${a.free}، درخواست: ${q}`);
    }
    if (moves.length && !staffId) throw new BadRequestException('برای جابجایی بین بیمارستان‌ها راننده را مشخص کنید');

    // ۱) حواله — با تاریخِ همان روز و وصل به اولین عملِ همان بیمارستان (فقط لنگرِ فنیِ بازهٔ تعهد).
    //    ⚠️ `shared: true` (تصمیمِ مالک ۱۴۰۵/۰۸/۰۴): این ست مالِ «بیمارستان + روز» است، نه همان یک بیمار —
    //    هر کارشناسِ آن بیمارستان در آن روز می‌بیندش و مصرفیِ هر بیمار روی پرونده‌اش از آن کم می‌شود (`shared-transfers`).
    const anchor = lines.length ? await this.prisma.visit.findFirst({
      where: { opDate: { gte: from, lt: new Date(from.getTime() + DAY) }, opStatus: { not: 'cancelled' }, hospitalId: hospital.id, patient: { deletedAt: null } },
      orderBy: [{ opStartTime: 'asc' }, { id: 'asc' }], select: { id: true },
    }) : null;
    const transferIds: number[] = [];
    if (home.length) {
      const t: any = await this.inventory.sendTransfer({
        hospitalId: hospital.id, toLocation: hospital.name, plannedFor: from.toISOString(), planOnly: true,
        ...(anchor ? { visitId: anchor.id } : {}), shared: true, lines: home.map((l) => ({ lotId: Number(l.lotId), quantity: Number(l.quantity) })), force: dto.force === true,
      }, user);
      transferIds.push(t.id);
    }
    // جابجایی: حوالهٔ «بیمارستانِ مبدأ ← این بیمارستان»؛ تعارضِ زمانی عمدی است (همان دستگاه، دو جا).
    for (const m of moves) {
      const t: any = await this.inventory.sendTransfer({
        hospitalId: hospital.id, toLocation: hospital.name, fromLocation: m.src.location, plannedFor: from.toISOString(), planOnly: true,
        ...(anchor ? { visitId: anchor.id } : {}), shared: true, lines: [{ lotId: Number(m.line.lotId), quantity: Number(m.line.quantity) }], force: true,
        notes: `جابجایی از ${m.src.hospitalName} (${m.src.code})`,
      }, user);
      transferIds.push(t.id);
    }

    // ۲) مسیرِ راننده در همان روز.
    let runId: number | null = null;
    if (staffId) {
      const run = await this.prisma.transportRun.findFirst({ where: { staffId, runDate: from }, select: { id: true } });
      runId = run?.id ?? (await this.routes.createRun({ staffId, runDate: from.toISOString() }, user)).id;
    }

    // ۳) توقفِ تحویل.
    const wantsHanded = dto.handedTo !== undefined;
    if (!stop) {
      if (runId) {
        const res = await this.routes.addStop(runId, { hospitalId: hospital.id, kind: 'deliver', plannedAt: dto.plannedAt, handedTo: dto.handedTo }, user);
        const made = res.stops.filter((s: any) => s.kind === 'deliver' && s.hospital?.id === hospital.id).sort((a: any, b: any) => b.seq - a.seq)[0];
        stop = { id: made.id } as any;
      } else {
        const made = await this.routes.createUnassignedStop({ hospitalId: hospital.id, kind: 'deliver', plannedAt: dto.plannedAt }, user);
        if (wantsHanded) await this.routes.updateStop(made.id, { handedTo: dto.handedTo }, user);
        stop = { id: made.id } as any;
      }
    } else {
      if (dto.plannedAt !== undefined || wantsHanded) {
        await this.routes.updateStop(stop.id, { ...(dto.plannedAt !== undefined ? { plannedAt: dto.plannedAt } : {}), ...(wantsHanded ? { handedTo: dto.handedTo } : {}) }, user);
      }
      // تغییرِ راننده: توقف به انتهای مسیرِ راننده‌ی تازه می‌رود.
      if (dto.staffId !== undefined && runId && runId !== stop.runId) await this.routes.assignStop(stop.id, runId, user);
    }
    if (transferIds.length) await this.routes.attach(stop!.id, transferIds, user);

    // ۴) جمع‌آوری از بیمارستانِ مبدأ در همان مسیر، **پیش از** توقفِ تحویل.
    for (const m of moves) {
      const a = av.get(Number(m.line.lotId))!;
      await this.routes.addStop(runId!, {
        hospitalId: m.src.hospitalId, kind: 'pickup', plannedAt: dto.plannedAt,
        notes: `جمع‌آوریِ «${a.name}» × ${m.line.quantity} برای تحویل به ${hospital.name}`,
      }, user);
      const run = await this.prisma.transportRun.findUnique({ where: { id: runId! }, include: { stops: { orderBy: { seq: 'asc' }, select: { id: true } } } });
      const ids = run!.stops.map((x) => x.id);
      const pick = ids[ids.length - 1];
      const order = ids.filter((x) => x !== pick);
      order.splice(Math.max(0, order.indexOf(stop!.id)), 0, pick);
      await this.routes.reorder(runId!, order, user);
    }

    await this.audit.record({
      actorId: user?.id, action: 'transport.delivery.plan', entityType: 'transport_stop', entityId: stop!.id,
      after: { hospitalId: hospital.id, on: from, staffId, lines: lines.length, moves: moves.map((m) => ({ lotId: m.line.lotId, from: m.src.hospitalId })) },
    });
    return this.board(from);
  }

  /**
   * برداشتنِ یک حوالهٔ **برنامه‌ریزی‌شده** از تحویل. حوالهٔ ارسال‌شده حرکتِ انبار دارد و
   * حذف‌شدنی نیست (باید برگردانده شود).
   */
  async removeTransfer(transferId: number, user: any) {
    const t = await this.prisma.stockTransfer.findUnique({ where: { id: transferId }, select: { id: true, status: true, plannedFor: true, code: true, stopId: true } });
    if (!t) throw new NotFoundException('حواله پیدا نشد');
    if (t.status !== 'planned') throw new BadRequestException('این حواله ارسال شده و حذف نمی‌شود؛ برگشتِ انبار بزنید');
    await this.prisma.stockTransfer.delete({ where: { id: t.id } });
    /* ⚠️ توقفِ بی‌راننده روزش را فقط از حواله‌اش دارد؛ با برداشتنِ آخرین قلم بی‌روز و
       نامرئی می‌ماند. توقفِ خالیِ بی‌راننده بی‌معناست، پس همراهِ آخرین قلم می‌رود. */
    if (t.stopId) {
      const stop = await this.prisma.transportStop.findUnique({ where: { id: t.stopId }, select: { runId: true, _count: { select: { transfers: true } } } });
      if (stop && !stop.runId && stop._count.transfers === 0) await this.prisma.transportStop.delete({ where: { id: t.stopId } });
    }
    await this.audit.record({ actorId: user?.id, action: 'transport.delivery.transfer.remove', entityType: 'stock_transfer', entityId: t.id, before: t });
    return this.board(t.plannedFor ?? new Date());
  }

  /** حذفِ یک تحویل و حواله‌های برنامه‌ریزی‌شده‌اش؛ اگر بارِ ارسال‌شده دارد رد می‌شود. */
  async removeDelivery(stopId: number, user: any) {
    const stop = await this.prisma.transportStop.findUnique({
      where: { id: stopId },
      include: { run: { select: { runDate: true } }, transfers: { select: { id: true, status: true, plannedFor: true } } },
    });
    if (!stop || stop.kind !== 'deliver') throw new NotFoundException('این تحویل پیدا نشد');
    if (stop.transfers.some((t) => t.status !== 'planned')) throw new BadRequestException('بارِ این تحویل ارسال شده؛ اول برگشتِ انبار را ثبت کنید');
    const day = stop.run?.runDate ?? stop.transfers[0]?.plannedFor ?? new Date();
    await this.prisma.$transaction([
      this.prisma.stockTransfer.deleteMany({ where: { stopId } }),
      this.prisma.transportStop.delete({ where: { id: stopId } }),
    ]);
    await this.audit.record({ actorId: user?.id, action: 'transport.delivery.remove', entityType: 'transport_stop', entityId: stopId });
    return this.board(day);
  }
}
