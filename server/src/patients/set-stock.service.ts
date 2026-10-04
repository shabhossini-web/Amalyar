import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../config/settings.service';
import { InventoryService } from './inventory.service';
import { balanceByLocation, DAMAGED_LOCATION, HOME_FALLBACK, setLocationOf } from './stock-math';
import { digitVariants } from '../common/search';

/**
 * ست به‌عنوانِ **بستهٔ موجودی** (مالک، ۱۴۰۵/۰۷/۱۱؛ بستهٔ ب).
 *
 * «۱۰۰ تا الکترود SDN دارم و ۲ تا ست، ۲۰ تا SDN تو هر بسته؛ ست A رفت سرِ عمل، ۲ تاش خراب شد،
 * جایگزین می‌کنیم: انبار ۹۸، ست A ۱۸ → بعد از جایگزینی ست A ۲۰ و انبار ۵۸.» پس:
 *
 * - هر **ستِ سریالی** یک محل در دفترِ انبار است («ست SE-07»، `setLocationOf`). محتویاتش حرکت‌هایی
 *   با همین محل‌اند؛ الکترودِ داخلِ ست در انبار «در دسترس» نیست ولی مالِ ماست.
 * - **استاندارد** از قالبِ محتویات (`ItemComponent`) می‌آید، **داخلِ ست** از دفتر، و **کسری**
 *   حساب می‌شود — هرگز تایپ (قانونِ ۱۵).
 * - تکمیل = انتقال از انبار به ست (FEFO)؛ خرابی = انتقال به «خرابی‌ها»؛ برداشت = انتقال به انبار.
 *   هیچ‌کدام عدد را بازنویسی نمی‌کند — همه حرکتِ دفتری‌اند و ردیابی می‌شوند.
 * - فقط قلمی که به یک **کالای تعریف‌شده** وصل است (`partId`) ردیابی می‌شود؛ قلمِ فقط‌نام
 *   (`tracked: false`) در شمارش می‌آید ولی موجودی ندارد.
 */
@Injectable()
export class SetStockService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private settings: SettingsService,
    private inventory: InventoryService,
  ) {}

  private home(): Promise<string> {
    return this.settings.textOr('home_location', HOME_FALLBACK);
  }

  /** ست‌های سریالی با محتویاتِ قالب، موجودیِ داخل، و کسری. */
  async sets(opts: { q?: string; lotId?: number } = {}) {
    const term = opts.q?.trim();
    const lots = await this.prisma.stockLot.findMany({
      where: {
        serialNo: { not: null },
        item: { assetKind: 'set' },
        ...(opts.lotId ? { id: opts.lotId } : {}),
        // هشدار: سریالِ ست را کاربر با کیبوردِ فارسی هم تایپ می‌کند و هم وارد
        //        کرده است؛ پس هر دو صورتِ رقمی جست‌وجو می‌شود (`common/search.ts`).
        ...(term
          ? {
              OR: digitVariants(term).flatMap((v) => [
                { serialNo: { contains: v, mode: 'insensitive' } },
                { item: { name: { contains: v, mode: 'insensitive' } } },
              ]),
            }
          : {}),
      },
      include: { item: { select: { id: true, name: true, size: true } }, consignedTo: { select: { name: true } } },
      orderBy: [{ itemId: 'asc' }, { serialNo: 'asc' }],
    });
    if (!lots.length) return [];
    const homeName = await this.home();
    const locations = lots.map((l) => setLocationOf(l));

    const [comps, inside, setMoves] = await Promise.all([
      this.prisma.itemComponent.findMany({
        where: { setId: { in: [...new Set(lots.map((l) => l.itemId))] } },
        include: { part: { select: { id: true, name: true, size: true, unit: true } } },
        orderBy: { id: 'asc' },
      }),
      this.prisma.stockMovement.groupBy({ by: ['lotId', 'location'], where: { location: { in: locations } }, _sum: { quantity: true } }),
      this.prisma.stockMovement.findMany({ where: { lotId: { in: lots.map((l) => l.id) } }, select: { lotId: true, quantity: true, location: true } }),
    ]);
    const partLotIds = [...new Set(inside.map((r) => r.lotId))];
    const partLots = partLotIds.length
      ? await this.prisma.stockLot.findMany({
          where: { id: { in: partLotIds } },
          select: { id: true, itemId: true, lotNo: true, serialNo: true, expiresAt: true, item: { select: { name: true, size: true, unit: true } } },
        })
      : [];
    const partLotById = new Map(partLots.map((p) => [p.id, p]));

    return lots.map((lot) => {
      const location = setLocationOf(lot);
      const home = lot.location ?? homeName;
      const bal = balanceByLocation(setMoves.filter((m) => m.lotId === lot.id), home);
      const at = [...bal.entries()].find(([, q]) => q > 0)?.[0] ?? null;

      /* موجودیِ داخلِ ست، به تفکیکِ کالا و لات. */
      const byItem = new Map<number, { quantity: number; name: string; unit: string; lots: { lotId: number; lotNo: string | null; serialNo: string | null; expiresAt: Date | null; quantity: number }[] }>();
      for (const r of inside) {
        if (r.location !== location) continue;
        const pl = partLotById.get(r.lotId);
        const q = r._sum.quantity ?? 0;
        if (!pl || q <= 0) continue;
        const cur = byItem.get(pl.itemId) ?? { quantity: 0, name: [pl.item.name, pl.item.size].filter(Boolean).join(' '), unit: pl.item.unit ?? 'عدد', lots: [] };
        cur.quantity += q;
        cur.lots.push({ lotId: pl.id, lotNo: pl.lotNo, serialNo: pl.serialNo, expiresAt: pl.expiresAt, quantity: q });
        byItem.set(pl.itemId, cur);
      }
      const template = comps.filter((c) => c.setId === lot.itemId);
      const contents = template.map((c) => {
        const got = c.partId ? byItem.get(c.partId) : undefined;
        const insideQ = c.partId ? (got?.quantity ?? 0) : null;
        return {
          componentId: c.id,
          partId: c.partId,
          label: c.label,
          unit: c.part?.unit ?? 'عدد',
          standard: c.quantity,
          tracked: !!c.partId,
          inside: insideQ,
          shortage: insideQ == null ? null : Math.max(0, c.quantity - insideQ),
          extra: insideQ == null ? 0 : Math.max(0, insideQ - c.quantity),
          lots: (got?.lots ?? []).sort((a, b) => (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity)),
        };
      });
      const templatePartIds = new Set(template.map((c) => c.partId).filter(Boolean));
      /* قلمی که داخلِ ست است ولی در قالب نیست — دیده شود، نه گم. */
      const extras = [...byItem.entries()]
        .filter(([itemId]) => !templatePartIds.has(itemId))
        .map(([itemId, v]) => ({ partId: itemId, label: v.name, unit: v.unit, inside: v.quantity, lots: v.lots }));
      const tracked = contents.filter((c) => c.tracked);
      return {
        lotId: lot.id,
        itemId: lot.itemId,
        itemName: [lot.item.name, lot.item.size].filter(Boolean).join(' '),
        serialNo: lot.serialNo,
        location,
        home,
        /* کجاست: انبار، بیمارستان (نامِ محلِ دفتر)، یا امانی. */
        at,
        atHome: at === home,
        consignedTo: lot.consignedTo?.name ?? null,
        contents,
        extras,
        totals: {
          lines: contents.length,
          standard: contents.reduce((s, c) => s + c.standard, 0),
          inside: tracked.reduce((s, c) => s + (c.inside ?? 0), 0),
          shortage: tracked.reduce((s, c) => s + (c.shortage ?? 0), 0),
          untracked: contents.length - tracked.length,
          complete: tracked.length > 0 && tracked.every((c) => (c.shortage ?? 0) === 0),
        },
      };
    });
  }

  private async setOrThrow(lotId: number) {
    const [set] = await this.sets({ lotId });
    if (!set) throw new NotFoundException('ستِ سریالی پیدا نشد — فقط ستی که سریال دارد محتویاتِ ردیابی‌شده دارد');
    return set;
  }

  /**
   * تکمیل از انبار — بی‌ردیف یعنی «همهٔ کسری‌ها»؛ با ردیف یعنی همان قلم‌ها.
   *
   * از لات‌های همان کالا در انبار به ترتیبِ انقضا (FEFO) برداشته می‌شود؛ منقضی کنار می‌ماند. اگر
   * انبار کم بیاورد، هرچه هست می‌رود و باقی‌مانده در `short` گفته می‌شود — نه خطا، نه سکوت.
   */
  async fill(lotId: number, dto: { lines?: { partId: number; quantity: number }[] }, user: any) {
    const set = await this.setOrThrow(lotId);
    const homeName = await this.home();
    const wanted = dto.lines?.length
      ? dto.lines.map((l) => ({ partId: Number(l.partId), quantity: Math.trunc(Number(l.quantity)) }))
      : set.contents.filter((c) => c.tracked && (c.shortage ?? 0) > 0).map((c) => ({ partId: c.partId as number, quantity: c.shortage as number }));
    for (const w of wanted) {
      if (!Number.isInteger(w.partId) || w.partId <= 0) throw new BadRequestException('کالای قلم نامعتبر است');
      if (!Number.isInteger(w.quantity) || w.quantity <= 0) throw new BadRequestException('تعداد باید عددِ صحیحِ مثبت باشد');
    }
    const filled: { partId: number; lotId: number; quantity: number }[] = [];
    const short: { partId: number; label: string; missing: number }[] = [];
    const now = Date.now();
    for (const w of wanted) {
      const lots = await this.prisma.stockLot.findMany({
        where: { itemId: w.partId },
        select: { id: true, location: true, expiresAt: true, lotNo: true, serialNo: true },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      });
      let need = w.quantity;
      for (const pl of lots) {
        if (need <= 0) break;
        if (pl.expiresAt && pl.expiresAt.getTime() < now) continue;
        const rows = await this.prisma.stockMovement.findMany({ where: { lotId: pl.id }, select: { quantity: true, location: true } });
        const home = pl.location ?? homeName;
        const avail = balanceByLocation(rows, home).get(home) ?? 0;
        if (avail <= 0) continue;
        const take = Math.min(avail, need);
        await this.inventory.relocate(pl.id, take, home, set.location, { reason: `تکمیلِ ${set.location}` }, user);
        filled.push({ partId: w.partId, lotId: pl.id, quantity: take });
        need -= take;
      }
      if (need > 0) {
        const label = set.contents.find((c) => c.partId === w.partId)?.label ?? `کالای ${w.partId}`;
        short.push({ partId: w.partId, label, missing: need });
      }
    }
    await this.audit.record({
      actorId: user?.id, action: 'stock.set.fill', entityType: 'stock_lot', entityId: lotId, after: { filled, short },
    });
    return { set: await this.setOrThrow(lotId), filled, short };
  }

  /** یک قلمِ داخلِ ست خراب شد → «خرابی‌ها» (چندبارمصرفِ خراب از موجودی کم می‌شود، همین‌جا). */
  async damage(lotId: number, dto: { partLotId: number; quantity: number; note?: string }, user: any) {
    const set = await this.setOrThrow(lotId);
    const qty = Math.trunc(Number(dto.quantity));
    await this.inventory.relocate(Number(dto.partLotId), qty, set.location, DAMAGED_LOCATION, { reason: text(dto.note) ?? `خرابی در ${set.location}` }, user);
    await this.audit.record({ actorId: user?.id, action: 'stock.set.damage', entityType: 'stock_lot', entityId: lotId, after: { partLotId: dto.partLotId, quantity: qty, note: dto.note ?? null } });
    return this.setOrThrow(lotId);
  }

  /** برداشتِ یک قلم از ست به انبار — ستی که کم‌تر از استاندارد می‌رود یا باز می‌شود. */
  async withdraw(lotId: number, dto: { partLotId: number; quantity: number; note?: string }, user: any) {
    const set = await this.setOrThrow(lotId);
    const qty = Math.trunc(Number(dto.quantity));
    await this.inventory.relocate(Number(dto.partLotId), qty, set.location, set.home, { reason: text(dto.note) ?? `برداشت از ${set.location}` }, user);
    await this.audit.record({ actorId: user?.id, action: 'stock.set.withdraw', entityType: 'stock_lot', entityId: lotId, after: { partLotId: dto.partLotId, quantity: qty } });
    return this.setOrThrow(lotId);
  }

  /** خرابیِ قلمی در خودِ انبار (نه داخلِ ست) → «خرابی‌ها». */
  async lotDamage(lotId: number, dto: { quantity: number; note?: string }, user: any) {
    const lot = await this.prisma.stockLot.findUnique({ where: { id: lotId }, select: { id: true, location: true } });
    if (!lot) throw new NotFoundException('لات یافت نشد');
    const home = lot.location ?? (await this.home());
    const qty = Math.trunc(Number(dto.quantity));
    const row = await this.inventory.relocate(lotId, qty, home, DAMAGED_LOCATION, { reason: text(dto.note) ?? 'خرابی' }, user);
    await this.audit.record({ actorId: user?.id, action: 'stock.lot.damage', entityType: 'stock_lot', entityId: lotId, after: { quantity: qty, note: dto.note ?? null } });
    return row;
  }

  // ───────────────────────── خرابی‌ها ─────────────────────────

  /** آنچه در «خرابی‌ها» منتظرِ تصمیم است — اسقاط یا تعمیر. */
  async damaged() {
    const sums = await this.prisma.stockMovement.groupBy({ by: ['lotId'], where: { location: DAMAGED_LOCATION }, _sum: { quantity: true } });
    const rows = sums.filter((s) => (s._sum.quantity ?? 0) > 0);
    if (!rows.length) return [];
    const lots = await this.prisma.stockLot.findMany({
      where: { id: { in: rows.map((r) => r.lotId) } },
      include: { item: { select: { id: true, name: true, size: true, unit: true, assetKind: true, usageMode: true } } },
    });
    const last = await this.prisma.stockMovement.findMany({
      where: { location: DAMAGED_LOCATION, quantity: { gt: 0 }, lotId: { in: rows.map((r) => r.lotId) } },
      orderBy: { id: 'desc' }, distinct: ['lotId'], select: { lotId: true, reason: true, createdAt: true },
    });
    const lastOf = new Map(last.map((m) => [m.lotId, m]));
    return rows.map((r) => {
      const lot = lots.find((l) => l.id === r.lotId)!;
      return {
        lotId: lot.id,
        itemId: lot.itemId,
        itemName: [lot.item.name, lot.item.size].filter(Boolean).join(' '),
        unit: lot.item.unit ?? 'عدد',
        assetKind: lot.item.assetKind,
        usageMode: lot.item.usageMode,
        serialNo: lot.serialNo,
        lotNo: lot.lotNo,
        quantity: r._sum.quantity ?? 0,
        reason: lastOf.get(lot.id)?.reason ?? null,
        since: lastOf.get(lot.id)?.createdAt ?? null,
      };
    }).sort((a, b) => (b.since?.getTime() ?? 0) - (a.since?.getTime() ?? 0));
  }

  /** اسقاط — خروجِ قطعی از «خرابی‌ها». */
  async scrap(lotId: number, dto: { quantity: number; note?: string }, user: any) {
    const qty = Math.trunc(Number(dto.quantity));
    await this.inventory.writeOff(lotId, qty, DAMAGED_LOCATION, { reason: text(dto.note) ? `اسقاط — ${text(dto.note)}` : 'اسقاط' }, user);
    await this.audit.record({ actorId: user?.id, action: 'stock.damaged.scrap', entityType: 'stock_lot', entityId: lotId, after: { quantity: qty, note: dto.note ?? null } });
    return this.damaged();
  }

  /** تعمیر شد — از «خرابی‌ها» به انبار برمی‌گردد و دوباره در دسترس است. */
  async repair(lotId: number, dto: { quantity: number; note?: string }, user: any) {
    const lot = await this.prisma.stockLot.findUnique({ where: { id: lotId }, select: { id: true, location: true } });
    if (!lot) throw new NotFoundException('لات یافت نشد');
    const qty = Math.trunc(Number(dto.quantity));
    await this.inventory.relocate(lotId, qty, DAMAGED_LOCATION, lot.location ?? (await this.home()), { reason: text(dto.note) ? `تعمیر و برگشت به چرخه — ${text(dto.note)}` : 'تعمیر و برگشت به چرخه' }, user);
    await this.audit.record({ actorId: user?.id, action: 'stock.damaged.repair', entityType: 'stock_lot', entityId: lotId, after: { quantity: qty, note: dto.note ?? null } });
    return this.damaged();
  }

  // ───────────────────────── برگشت و تکمیل ─────────────────────────

  /**
   * شمارشِ برگشتِ ستِ یک حواله — دفتر هنگامِ تحویل‌گرفتنِ ست از راننده.
   *
   * ستون‌ها: استاندارد، داخلِ ست (دفتر)، **شمردم**، **خرابی**. اختلافِ دفتر با شمارش «گم‌شده»
   * است نه مصرف (مالک): مصرف را کارشناس سرِ عمل ثبت می‌کند و جایش این‌جا نیست. خرابی به
   * «خرابی‌ها» می‌رود، گم‌شده خروجِ قطعی می‌گیرد، و هر دو در `SetShortage` با `stage = return`
   * می‌نشینند تا گزارشِ کسری «کدام ست، کدام بیمارستان» را بگوید.
   */
  async returnCount(
    transferId: number,
    dto: { note?: string; lines: { lotId: number; partId: number; counted: number; damaged?: number }[] },
    user: any,
  ) {
    const t = await this.prisma.stockTransfer.findUnique({ where: { id: transferId }, select: { id: true, code: true, status: true, visitId: true, movements: { where: { kind: 'transfer', quantity: { gt: 0 } }, select: { lotId: true } } } });
    if (!t) throw new NotFoundException('حواله یافت نشد');
    if (t.status === 'planned') throw new BadRequestException('این حواله هنوز ارسال نشده است');
    if (t.status === 'closed') throw new BadRequestException('این حواله بسته شده است');
    const inTransfer = new Set(t.movements.map((m) => m.lotId));
    const lines = (dto.lines ?? []).map((l) => ({
      lotId: Number(l.lotId), partId: Number(l.partId),
      counted: Math.trunc(Number(l.counted)), damaged: Math.max(0, Math.trunc(Number(l.damaged ?? 0))),
    }));
    if (!lines.length) throw new BadRequestException('ردیفِ شمارش خالی است');
    const note = text(dto.note);
    const result: { lotId: number; partId: number; label: string; inside: number; counted: number; damaged: number; lost: number }[] = [];

    for (const l of lines) {
      if (!inTransfer.has(l.lotId)) throw new BadRequestException('این ست در حواله نیست');
      if (l.counted < 0) throw new BadRequestException('تعدادِ شمرده‌شده نمی‌تواند منفی باشد');
      const set = await this.setOrThrow(l.lotId);
      const c = set.contents.find((x) => x.partId === l.partId) ?? set.extras.find((x) => x.partId === l.partId);
      if (!c) throw new BadRequestException('این قلم در محتویاتِ ست نیست');
      const inside = c.inside ?? 0;
      const lost = inside - l.counted - l.damaged;
      if (lost < 0) throw new BadRequestException(`«${c.label}»: بیشتر از آنچه در ست است شمرده شد (داخلِ ست ${inside})`);
      /* برداشتن از لات‌های داخلِ ست، از قدیمی‌ترین انقضا. */
      const take = async (qty: number, to: string | null, reason: string) => {
        let need = qty;
        for (const pl of c.lots) {
          if (need <= 0) break;
          const q = Math.min(pl.quantity, need);
          if (to) await this.inventory.relocate(pl.lotId, q, set.location, to, { reason, transferId }, user);
          else await this.inventory.writeOff(pl.lotId, q, set.location, { reason, transferId, visitId: t.visitId }, user);
          pl.quantity -= q;
          need -= q;
        }
      };
      if (l.damaged > 0) await take(l.damaged, DAMAGED_LOCATION, `خرابی هنگامِ برگشتِ ${t.code}`);
      if (lost > 0) await take(lost, null, `گم‌شده هنگامِ برگشتِ ${t.code}`);
      const shortages = [
        ...(lost > 0 ? [{ kind: 'missing', missing: lost }] : []),
        ...(l.damaged > 0 ? [{ kind: 'damaged', missing: l.damaged }] : []),
      ];
      if (shortages.length) {
        await this.prisma.setShortage.createMany({
          data: shortages.map((s) => ({ transferId, lotId: l.lotId, label: c.label, missing: s.missing, kind: s.kind, stage: 'return', notes: note, reportedById: user?.id ?? null })),
        });
      }
      result.push({ lotId: l.lotId, partId: l.partId, label: c.label, inside, counted: l.counted, damaged: l.damaged, lost });
    }
    await this.audit.record({ actorId: user?.id, action: 'stock.transfer.return_count', entityType: 'stock_transfer', entityId: transferId, after: { lines: result, note } });
    const setIds = [...new Set(lines.map((l) => l.lotId))];
    const sets = await Promise.all(setIds.map((id) => this.setOrThrow(id)));
    return { transferId, code: t.code, lines: result, sets };
  }
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() || null : null);
