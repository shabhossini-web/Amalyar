import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { jalaliMonthRange, toJalali } from '../common/jalali';
import { balanceByLocation, HOME_FALLBACK } from './stock-math';
import { at, overlaps, windowOf } from '../common/asset-window';

// محاسبهٔ بازه در `common/asset-window` است؛ این‌جا دوباره صادر می‌شود تا
// فراخوان‌های موجود نشکنند.
export { at, overlaps, windowOf };

/** consumable = یک‌بار می‌رود؛ set/device = برمی‌گردد و فردا دوباره می‌رود. */
export const ASSET_KINDS = ['consumable', 'set', 'device'] as const;
export const ASSET_LABELS: Record<string, string> = {
  consumable: 'مصرفی',
  set: 'ست',
  device: 'دستگاه',
};
export const RETURNABLE = ['set', 'device'];

/** وضعیتِ یک دارایی در یک روز. ترتیب = اولویتِ نمایش. */
export const ASSET_STATES = ['service', 'out', 'booked', 'free'] as const;
export const STATE_LABELS: Record<string, string> = {
  service: 'نیازمندِ سرویس',
  out: 'بیرون',
  booked: 'رزرو',
  free: 'آزاد',
};

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * لات‌های یک حواله — از حرکت‌ها، و برای حوالهٔ برنامه‌ریزی‌شده از `plannedLines`.
 *
 * یک تابع برای هر دو حالت، وگرنه هر جای برنامه یکی از دو منبع را جا می‌اندازد
 * و تعهدِ فردا نامرئی می‌شود.
 */
function lotsOf(t: any): number[] {
  if (t.status === 'planned') return ((t.plannedLines as any[] | null) ?? []).map((l) => Number(l.lotId));
  return (t.movements ?? []).map((m: any) => m.lotId);
}

/**
 * تقویمِ داراییِ برگشتی — «فردا کدام دستگاه آزاد است؟»
 *
 * ⚠️ این سؤال از **موجودی** جواب نمی‌گیرد. دستگاهی که امروز در لقمان است هم
 * «موجود» است هم غیرقابلِ استفاده؛ و دستگاهی که در انبار است ولی فردا برای
 * میلاد تعهد شده، امروز آزاد است و فردا نه. پس در دسترس‌بودن یک **بازهٔ زمانی**
 * است روی تعهدها، نه یک عدد روی انبار.
 *
 * منبعِ تعهد همان `StockTransfer` است، نه جدولِ رزروِ جدا: دو جای ثبت یعنی
 * حواله‌ای صادر شود که تقویم از آن خبر ندارد — و همان صبحِ عمل معلوم می‌شود.
 */
@Injectable()
export class AssetsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** روزِ تعهدِ یک حواله: روزِ برنامه‌ریزی‌شده، وگرنه روزِ عملِ مربوطه، وگرنه روزِ ارسال. */
  private static committedOn(t: any): Date {
    return t.plannedFor ?? t.visit?.opDate ?? t.sentAt;
  }

  /**
   * فهرستِ دارایی‌های برگشتی با وضعیتِ یک روزِ مشخص.
   *
   * `date` میلادی است (مرزِ روز از تقویمِ شمسیِ فراخوان می‌آید) — این سرویس
   * تاریخ را تفسیر نمی‌کند تا دو تعریف از «روز» ساخته نشود.
   */
  async assets(on?: Date, itemId?: number) {
    const day = on ?? new Date();
    const lots = await this.prisma.stockLot.findMany({
      where: {
        item: { assetKind: { in: RETURNABLE }, ...(itemId ? { id: itemId } : {}) },
      },
      include: { item: true },
      orderBy: [{ itemId: 'asc' }, { id: 'asc' }],
    });
    if (!lots.length) return [];
    const ids = lots.map((l) => l.id);

    const [moves, transfers] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where: { lotId: { in: ids } },
        select: { lotId: true, location: true, quantity: true },
      }),
      // ⚠️ حوالهٔ `planned` هنوز هیچ حرکتی ندارد، پس شرطِ `movements.some` آن را
      // نمی‌گیرد و تقویم تعهدهای فردا را نمی‌دید. قلم‌هایش در `plannedLines` است.
      this.prisma.stockTransfer.findMany({
        where: {
          status: { not: 'closed' },
          OR: [{ movements: { some: { lotId: { in: ids } } } }, { status: 'planned' }],
        },
        include: {
          hospital: { select: { id: true, name: true } },
          visit: { select: { id: true, seq: true, opDate: true, opStartTime: true, opEndTime: true, cargoDueTime: true, patient: { select: { code: true } } } },
          movements: { where: { lotId: { in: ids }, kind: 'transfer' }, select: { lotId: true } },
        },
      }),
    ]);

    const byLot = new Map<number, { location: string | null; quantity: number }[]>();
    for (const m of moves) {
      const arr = byLot.get(m.lotId) ?? [];
      arr.push({ location: m.location, quantity: m.quantity });
      byLot.set(m.lotId, arr);
    }

    const commitments = new Map<number, any[]>();
    for (const t of transfers) {
      for (const lotId of new Set(lotsOf(t))) {
        const arr = commitments.get(lotId) ?? [];
        arr.push(t);
        commitments.set(lotId, arr);
      }
    }

    return lots.map((l) => {
      const home = l.location ?? HOME_FALLBACK;
      const bal = balanceByLocation(byLot.get(l.id) ?? [], home);
      const away = [...bal.entries()].filter(([loc, q]) => loc !== home && q > 0);
      const mine = (commitments.get(l.id) ?? []).sort(
        (a, b) => +AssetsService.committedOn(a) - +AssetsService.committedOn(b),
      );
      const today = mine.filter((t) => dayKey(AssetsService.committedOn(t)) === dayKey(day));

      // ترتیبِ تصمیم عمدی است: سرویس بر همه‌چیز مقدم است، چون دستگاهِ از
      // کالیبراسیون‌افتاده حتی اگر در انبار و آزاد باشد نباید اعزام شود.
      let state: string = 'free';
      if (l.nextServiceAt && l.nextServiceAt <= day) state = 'service';
      else if (away.length) state = 'out';
      else if (today.length) state = 'booked';

      return {
        lotId: l.id,
        itemId: l.itemId,
        itemName: [l.item.name, l.item.size].filter(Boolean).join(' '),
        assetKind: l.item.assetKind,
        assetLabel: ASSET_LABELS[l.item.assetKind] ?? l.item.assetKind,
        serialNo: l.serialNo,
        lotNo: l.lotNo,
        home,
        at: away.length ? away[0][0] : home,
        nextServiceAt: l.nextServiceAt,
        turnaroundHours: l.item.turnaroundHours,
        state,
        stateLabel: STATE_LABELS[state],
        commitments: mine.map((t) => {
          const w = windowOf(t, l.item.turnaroundHours);
          return {
            transferId: t.id,
            code: t.code,
            on: AssetsService.committedOn(t),
            from: w[0],
            to: w[1],
            released: !!t.releasedAt,
            status: t.status,
            hospital: t.hospital?.name ?? t.toLocation,
            visitCode: t.visit ? `${t.visit.patient.code}-V${t.visit.seq}` : null,
            opStartTime: t.visit?.opStartTime ?? null,
          };
        }),
      };
    });
  }

  /**
   * تعارضِ رزرو — «این دستگاه همان روز جای دیگری تعهد شده است».
   *
   * تابعِ خالص نیست ولی **تنها جای تصمیم** است: هم موقعِ صدورِ حواله صدا زده
   * می‌شود هم در تقویم نشان داده می‌شود. اگر UI جدا برای خودش حساب می‌کرد،
   * اولین اختلاف بینِ هشدارِ صفحه و رفتارِ سرور پیدا می‌شد.
   */
  async conflicts(lotIds: number[], want: [Date, Date], exceptTransferId?: number) {
    if (!lotIds.length) return [];
    // فقط داراییِ برگشتی تعارض دارد: از یک لاتِ مصرفیِ ۱۰۰تایی می‌شود همزمان
    // به دو بیمارستان داد.
    const lots = await this.prisma.stockLot.findMany({
      where: { id: { in: lotIds }, item: { assetKind: { in: RETURNABLE } } },
      include: { item: { select: { name: true, size: true, turnaroundHours: true } } },
    });
    if (!lots.length) return [];
    const byId = new Map(lots.map((l) => [l.id, l]));

    const rows = await this.prisma.stockTransfer.findMany({
      where: {
        status: { not: 'closed' },
        ...(exceptTransferId ? { id: { not: exceptTransferId } } : {}),
        OR: [{ movements: { some: { lotId: { in: [...byId.keys()] }, kind: 'transfer' } } }, { status: 'planned' }],
      },
      include: {
        hospital: { select: { name: true } },
        visit: { select: { seq: true, opDate: true, opStartTime: true, opEndTime: true, cargoDueTime: true, patient: { select: { code: true } } } },
        movements: { where: { lotId: { in: [...byId.keys()] }, kind: 'transfer' }, select: { lotId: true } },
      },
    });

    const out: any[] = [];
    for (const t of rows) {
      for (const lotId of new Set(lotsOf(t))) {
        const lot = byId.get(lotId);
        if (!lot) continue;
        // بازه با ساعتِ آماده‌سازیِ همان کالا حساب می‌شود، نه کلی.
        const have = windowOf(t, lot.item.turnaroundHours);
        if (!overlaps(want, have)) continue;
        out.push({
          lotId,
          serialNo: lot.serialNo,
          itemName: [lot.item.name, lot.item.size].filter(Boolean).join(' '),
          transferCode: t.code,
          hospital: t.hospital?.name ?? t.toLocation,
          visitCode: t.visit ? `${t.visit.patient.code}-V${t.visit.seq}` : null,
          from: have[0],
          to: have[1],
        });
      }
    }
    return out;
  }

  /** نمای ماه: برای هر روز، چند دارایی تعهد شده و چند تعارض هست. */
  async month(jy: number, jm: number) {
    if (!Number.isInteger(jy) || jy < 1300 || jy > 1500) throw new BadRequestException('سالِ نامعتبر');
    if (!Number.isInteger(jm) || jm < 1 || jm > 12) throw new BadRequestException('ماهِ نامعتبر');
    const [from, to] = jalaliMonthRange(jy, jm);

    const transfers = await this.prisma.stockTransfer.findMany({
      where: { status: { not: 'closed' } },
      include: {
        visit: { select: { opDate: true } },
        movements: {
          where: { kind: 'transfer' },
          include: { lot: { include: { item: { select: { assetKind: true } } } } },
        },
      },
    });
    const returnable = new Set(
      (await this.prisma.stockLot.findMany({
        where: { item: { assetKind: { in: RETURNABLE } } }, select: { id: true },
      })).map((l) => l.id),
    );

    const days = new Map<number, { day: number; committed: number; conflicts: number }>();
    const seen = new Map<string, number>(); // (روز، لات) → شمارِ تعهد
    for (const t of transfers) {
      const on = AssetsService.committedOn(t);
      if (on < from || on >= to) continue;
      const [, , jd] = toJalali(on);
      const cell = days.get(jd) ?? { day: jd, committed: 0, conflicts: 0 };
      for (const lotId of new Set(lotsOf(t).filter((id) => returnable.has(id)))) {
        cell.committed += 1;
        const k = `${jd}:${lotId}`;
        const n = (seen.get(k) ?? 0) + 1;
        seen.set(k, n);
        // تعارض از دومین تعهد به بعد شمرده می‌شود، نه از اولی.
        if (n === 2) cell.conflicts += 1;
      }
      days.set(jd, cell);
    }
    return { year: jy, month: jm, days: [...days.values()].sort((a, b) => a.day - b.day) };
  }

  // ── محتویاتِ ست ──────────────────────────────────────────────

  /** فهرستِ اقلامِ داخلِ یک ست. */
  async contents(itemId: number) {
    const rows = await this.prisma.itemComponent.findMany({
      where: { setId: itemId },
      include: { part: { select: { id: true, name: true, size: true } } },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      quantity: r.quantity,
      notes: r.notes,
      partId: r.partId,
      partName: r.part ? [r.part.name, r.part.size].filter(Boolean).join(' ') : null,
    }));
  }

  async addContent(itemId: number, dto: { label?: string; partId?: number; quantity?: number; notes?: string }) {
    const set = await this.prisma.item.findUnique({ where: { id: itemId }, select: { id: true, assetKind: true } });
    if (!set) throw new NotFoundException('کالا یافت نشد');
    if (!RETURNABLE.includes(set.assetKind)) {
      throw new BadRequestException('فقط ست و دستگاه محتویات دارند؛ قلمِ مصرفی جزء ندارد');
    }
    let label = typeof dto.label === 'string' ? dto.label.trim() : '';
    if (dto.partId) {
      const part = await this.prisma.item.findUnique({ where: { id: Number(dto.partId) }, select: { name: true, size: true } });
      if (!part) throw new NotFoundException('قلمِ انتخابی یافت نشد');
      // نامِ کالای تعریف‌شده بر متنِ دستی مقدم است تا فهرست یک‌دست بماند.
      label = [part.name, part.size].filter(Boolean).join(' ');
    }
    if (!label) throw new BadRequestException('عنوانِ قلم را وارد کنید');
    return this.prisma.itemComponent.create({
      data: {
        setId: itemId,
        partId: dto.partId ? Number(dto.partId) : null,
        label,
        quantity: Math.max(1, Math.trunc(Number(dto.quantity ?? 1)) || 1),
        notes: typeof dto.notes === 'string' ? dto.notes.trim() || null : null,
      },
    });
  }

  async removeContent(id: number) {
    const row = await this.prisma.itemComponent.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('قلم یافت نشد');
    await this.prisma.itemComponent.delete({ where: { id } });
    return { ok: true };
  }

  // ── کسریِ ست هنگام برگشت ─────────────────────────────────────

  /**
   * چک‌لیستِ برگشتِ یک حواله: هر لاتِ برگشتی با محتویاتش و کسریِ ثبت‌شده.
   *
   * ⚠️ فقط **کسری** ثبت می‌شود نه کلِ شمارش. ثبتِ ۲۰ ردیفِ «سالم» برای هر
   * برگشت یعنی هیچ‌کس این کار را نمی‌کند — و آن‌وقت کسری هم ثبت نمی‌شود.
   */
  async returnCheck(transferId: number) {
    const t = await this.prisma.stockTransfer.findUnique({
      where: { id: transferId },
      include: {
        movements: {
          where: { kind: 'transfer', quantity: { gt: 0 } },
          include: { lot: { include: { item: { select: { id: true, name: true, size: true, assetKind: true } } } } },
        },
        shortages: true,
      },
    });
    if (!t) throw new NotFoundException('حواله یافت نشد');

    const setIds = [...new Set(t.movements.filter((m) => RETURNABLE.includes(m.lot.item.assetKind)).map((m) => m.lot.itemId))];
    const comps = setIds.length
      ? await this.prisma.itemComponent.findMany({ where: { setId: { in: setIds } }, orderBy: { id: 'asc' } })
      : [];

    return {
      transferId: t.id,
      code: t.code,
      lots: t.movements
        .filter((m) => RETURNABLE.includes(m.lot.item.assetKind))
        .map((m) => ({
          lotId: m.lotId,
          serialNo: m.lot.serialNo || m.lot.lotNo,
          itemName: [m.lot.item.name, m.lot.item.size].filter(Boolean).join(' '),
          contents: comps.filter((c) => c.setId === m.lot.itemId).map((c) => ({ label: c.label, quantity: c.quantity })),
          shortages: t.shortages.filter((sh) => sh.lotId === m.lotId).map((sh) => ({
            id: sh.id, label: sh.label, missing: sh.missing, kind: sh.kind, notes: sh.notes,
          })),
        })),
    };
  }

  async reportShortage(
    transferId: number,
    dto: { lotId: number; label: string; missing?: number; kind?: string; notes?: string },
    user: any,
  ) {
    const t = await this.prisma.stockTransfer.findUnique({ where: { id: transferId }, select: { id: true } });
    if (!t) throw new NotFoundException('حواله یافت نشد');
    const lot = await this.prisma.stockLot.findUnique({ where: { id: Number(dto.lotId) }, select: { id: true } });
    if (!lot) throw new NotFoundException('لات یافت نشد');
    const label = dto.label?.trim();
    if (!label) throw new BadRequestException('عنوانِ قلمِ کسری را وارد کنید');
    if (dto.kind && !['missing', 'damaged'].includes(dto.kind)) throw new BadRequestException('نوعِ کسری نامعتبر است');

    const row = await this.prisma.setShortage.create({
      data: {
        transferId, lotId: lot.id, label,
        missing: Math.max(1, Math.trunc(Number(dto.missing ?? 1)) || 1),
        kind: dto.kind ?? 'missing',
        notes: typeof dto.notes === 'string' ? dto.notes.trim() || null : null,
        reportedById: user?.id ?? null,
      },
    });
    await this.audit.record({
      actorId: user?.id, action: 'stock.shortage.report', entityType: 'stock_transfer', entityId: transferId,
      after: { lotId: lot.id, label, missing: row.missing, kind: row.kind },
    });
    return this.returnCheck(transferId);
  }

  async removeShortage(id: number, user: any) {
    const row = await this.prisma.setShortage.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('کسری یافت نشد');
    await this.prisma.setShortage.delete({ where: { id } });
    await this.audit.record({
      actorId: user?.id, action: 'stock.shortage.remove', entityType: 'stock_transfer', entityId: row.transferId, before: row,
    });
    return this.returnCheck(row.transferId);
  }

  /** گزارشِ کسری — «کدام ست بیشتر قلم گم می‌کند» و «کدام بیمارستان». */
  async shortageReport(from?: Date, to?: Date) {
    const rows = await this.prisma.setShortage.findMany({
      where: { ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}) },
      include: {
        lot: { include: { item: { select: { name: true, size: true } } } },
        transfer: { include: { hospital: { select: { name: true } } } },
      },
      orderBy: { id: 'desc' },
      take: 500,
    });
    const byItem = new Map<string, number>();
    const byHospital = new Map<string, number>();
    for (const r of rows) {
      const item = [r.lot.item.name, r.lot.item.size].filter(Boolean).join(' ');
      const hosp = r.transfer.hospital?.name ?? r.transfer.toLocation;
      byItem.set(item, (byItem.get(item) ?? 0) + r.missing);
      byHospital.set(hosp, (byHospital.get(hosp) ?? 0) + r.missing);
    }
    const rank = (m: Map<string, number>) =>
      [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    return {
      total: rows.reduce((s, r) => s + r.missing, 0),
      byItem: rank(byItem),
      byHospital: rank(byHospital),
      rows: rows.map((r) => ({
        id: r.id,
        label: r.label,
        missing: r.missing,
        kind: r.kind,
        notes: r.notes,
        at: r.createdAt,
        serialNo: r.lot.serialNo || r.lot.lotNo,
        itemName: [r.lot.item.name, r.lot.item.size].filter(Boolean).join(' '),
        transferCode: r.transfer.code,
        hospital: r.transfer.hospital?.name ?? r.transfer.toLocation,
      })),
    };
  }

  // ── نیازِ استانداردِ بیمارستان ─────────────────────────────────

  async needs(hospitalId: number) {
    const rows = await this.prisma.hospitalItem.findMany({
      where: { hospitalId },
      include: { item: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      itemName: [r.item.name, r.item.size].filter(Boolean).join(' '),
      assetKind: r.item.assetKind,
      assetLabel: ASSET_LABELS[r.item.assetKind] ?? r.item.assetKind,
      quantity: r.quantity,
      notes: r.notes,
    }));
  }

  async setNeed(hospitalId: number, dto: { itemId: number; quantity?: number; notes?: string }) {
    const [h, i] = await Promise.all([
      this.prisma.hospital.findUnique({ where: { id: hospitalId }, select: { id: true } }),
      this.prisma.item.findUnique({ where: { id: Number(dto.itemId) }, select: { id: true } }),
    ]);
    if (!h) throw new NotFoundException('بیمارستان یافت نشد');
    if (!i) throw new NotFoundException('کالا یافت نشد');
    const quantity = Math.max(1, Math.trunc(Number(dto.quantity ?? 1)) || 1);
    const notes = typeof dto.notes === 'string' ? dto.notes.trim() || null : null;
    return this.prisma.hospitalItem.upsert({
      where: { hospitalId_itemId: { hospitalId, itemId: i.id } },
      create: { hospitalId, itemId: i.id, quantity, notes },
      update: { quantity, notes },
    });
  }

  async removeNeed(id: number) {
    const row = await this.prisma.hospitalItem.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('ردیف یافت نشد');
    await this.prisma.hospitalItem.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * پیشنهادِ بارِ یک عمل: نیازِ استانداردِ بیمارستان، با یک داراییِ آزادِ پیشنهادی.
   *
   * پیشنهاد است نه الزام — و همین که «کدام سریال آزاد است» را همین‌جا جواب
   * می‌دهد، جلوی حواله‌ای را می‌گیرد که با تعارض صادر شود.
   */
  async suggestFor(visitId: number) {
    const v = await this.prisma.visit.findUnique({
      where: { id: visitId },
      select: { id: true, hospitalId: true, opDate: true },
    });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    if (!v.hospitalId) return { hospitalId: null, lines: [] };

    const needs = await this.needs(v.hospitalId);
    const pool = await this.assets(v.opDate ?? new Date());
    const taken = new Set<number>();

    return {
      hospitalId: v.hospitalId,
      lines: needs.map((n) => {
        // برای داراییِ برگشتی به تعدادِ لازم سریالِ آزاد برمی‌داریم، نه یکی:
        // «۲ ست لازم است» با یک پیشنهاد یعنی نیمِ کار، و کمبودش هم دیده نمی‌شود.
        const want = RETURNABLE.includes(n.assetKind) ? n.quantity : 0;
        const picked: any[] = [];
        for (const a of pool) {
          if (picked.length >= want) break;
          if (a.itemId === n.itemId && a.state === 'free' && !taken.has(a.lotId)) {
            taken.add(a.lotId);
            picked.push(a);
          }
        }
        return {
          itemId: n.itemId,
          itemName: n.itemName,
          quantity: n.quantity,
          assetKind: n.assetKind,
          notes: n.notes,
          suggestedLotIds: picked.map((a) => a.lotId),
          suggestedSerials: picked.map((a) => a.serialNo).filter(Boolean),
          // نبودِ دارایی آزاد باید *دیده* شود، نه اینکه ردیف بی‌صدا خالی بماند.
          shortage: want > 0 && picked.length < want,
          shortBy: Math.max(0, want - picked.length),
        };
      }),
    };
  }
}
