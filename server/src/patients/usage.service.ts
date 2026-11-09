import { withSharedTransfers } from './shared-transfers';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../work/events.service';
import { InventoryService } from './inventory.service';
import { SetStockService } from './set-stock.service';
import { isUnrestricted } from '../common/own-scope';
import { LEVEL } from '../common/levels';
import { SettingsService } from '../config/settings.service';
import { balanceByLocation } from './stock-math';
import { deliveryState } from './handover';

/**
 * **ثبتِ مصرفیِ کارشناس** (مالک، ۱۴۰۵/۰۷/۱۱، بندِ ۶ — بستهٔ ج).
 *
 * یک برگه برای هر عمل، سه گروه:
 *  - **از ست** — محتویاتِ ردیابی‌شدهٔ ستِ همراهِ همین عمل (محلِ «ست SE-07»): مصرف از خودِ ست کم می‌شود
 *    (حرکتِ `out` در همان محل، به نامِ همین عمل و همین حواله)؛ تکمیلِ بعدی در انبار کسری را می‌بندد.
 *  - **ارسالیِ حواله** — قلمِ غیرِ ستی که با حواله رفته (ده الکترودِ آزاد): حرکتِ `out` به نامِ **همین بیمار**
 *    (`consumeFromTransfer`)؛ سقف = ارسالی منهای مصرفِ بیمارانِ دیگر از همان حواله (ستِ عمومیِ بیمارستان).
 *    برگهٔ حواله دیگر مصرف نمی‌گیرد، فقط همین‌ها را به تفکیکِ بیمار نشان می‌دهد (۱۴۰۵/۰۸/۰۴).
 *  - **از کیف/انبار** — کالاهای تیک‌خوردهٔ «نمایش در پنلِ کارشناسی» که در ست نیستند: از موجودیِ انبار
 *    (محلِ خانه) کم می‌شود؛ انبار که کم بیاورد، عدد و نامِ کالا گفته می‌شود نه «خطا».
 *
 * **چندبارمصرف فقط شمرده می‌شود** (`mode = use`)، از موجودی کم نمی‌شود — تنها خرابی کمش می‌کند
 * (بستهٔ ب). **عدد «جمعِ این عمل» است، نه «چقدر کم کن»** — همان قراردادِ برگهٔ مصرف: کارشناسِ
 * وسطِ عمل حسابِ ثبتِ قبلی را نگه نمی‌دارد؛ سرور تفاوت را می‌زند و برمی‌گرداند.
 *
 * دو قفل: تا ستی «منتظرِ تأییدِ» کارشناس است برگه ثبت نمی‌شود (ستی که نگرفته‌ای مصرف ندارد)، و
 * پس از بسته‌شدنِ حواله‌ها دیگر قابلِ اصلاح نیست — ست به انبار برگشته و شمارشِ برگشت خورده است.
 */
export type UsageSource = 'set' | 'warehouse' | 'transfer';
export type UsageMode = 'consume' | 'use';

export interface UsageLine {
  key: string;
  source: UsageSource;
  mode: UsageMode;
  itemId: number;
  name: string;
  unit: string;
  usageMode: string;
  setLotId: number | null;
  transferId: number | null;
  lotId: number | null;
  /** سقفِ قابلِ مصرف: داخلِ ست / ارسالیِ حواله / موجودِ انبار. چندبارمصرف سقف ندارد. */
  limit: number | null;
  /** جمعِ ثبت‌شدهٔ همین عمل. */
  quantity: number;
  /** چندبارمصرف: «تا امروز N بار» — جمعِ همهٔ عمل‌ها. */
  usesTotal: number;
  /** پیش‌فرضِ شرکت برای این قلم (ب-۳) — فقط وقتی هنوز چیزی برای این بیمار ثبت نشده؛ پیشنهاد است، نه ثبت. */
  suggested?: number;
}

/** کاربرِ شرکت (سوپروایزر به بالا) مصرفیِ هر بیمار را می‌بیند، اصلاح و تأیید می‌کند (ب-۲، مالک ۱۴۰۵/۰۸/۱۸). */
const isCompanyStaff = (user: any) => (user?.level ?? 0) >= LEVEL.SUPERVISOR;

/** کلیدِ یکتای ردیف — منبع:لنگر:کالا (لنگر = لاتِ ست یا لاتِ ارسالی؛ انبار لنگر ندارد). */
export const usageKey = (source: UsageSource, anchor: number | null | undefined, itemId: number) => `${source}:${anchor ?? 0}:${itemId}`;

const labelOf = (item: { name: string; size?: string | null }) => [item.name, item.size].filter(Boolean).join(' ');

/* حوالهٔ خودِ مراجعه و ستِ عمومیِ همان بیمارستان و روز — یک شکل (`shared-transfers`). */
const USAGE_TRANSFER_SELECT = {
  id: true, code: true, status: true, toLocation: true, techReceivedAt: true, techReceiptIssue: true,
  stop: { select: { kind: true, doneAt: true } },
  movements: {
    where: { kind: 'transfer', quantity: { gt: 0 } },
    select: {
      lotId: true, quantity: true, location: true,
      lot: { select: { id: true, serialNo: true, lotNo: true, item: { select: { id: true, name: true, size: true, unit: true, assetKind: true, usageMode: true } } } },
    },
  },
} as const;

@Injectable()
export class VisitUsageService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private events: EventsService,
    private inventory: InventoryService,
    private sets: SetStockService,
    private settings: SettingsService,
  ) {}

  /** «مصرفیِ پیش‌فرضِ هر بیمار» از تنظیماتِ شرکت — همان فهرستِ پیش‌فرضِ فاکتورِ نورو، فقط ردیف‌های وصل به کالا. */
  private async companyDefaults(): Promise<Map<number, number>> {
    const raw = (await this.settings.text('invoice_neuro_consumables')).trim();
    const out = new Map<number, number>();
    if (!raw.startsWith('[')) return out; // قالبِ قدیمیِ متنی به کالای انبار وصل نیست
    try {
      for (const r of JSON.parse(raw)) {
        const id = Number(r?.itemId), q = Math.trunc(Number(r?.qty));
        if (Number.isInteger(id) && id > 0 && Number.isInteger(q) && q > 0) out.set(id, (out.get(id) ?? 0) + q);
      }
    } catch { /* تنظیمِ خراب = بی‌پیش‌فرض */ }
    return out;
  }

  /** همان دامنهٔ پنلِ کارشناسی: عملِ خودِ کارشناس؛ سوپرادمین همه (قانونِ ۲۹). */
  private scope(user: any) {
    /* عضوِ تیمِ پرونده (نه فقط مسئولِ فعلی) هم مصرفی ثبت می‌کند — همان دامنهٔ پنل (`crew-sync`). */
    return isUnrestricted(user) || isCompanyStaff(user) ? { patient: { deletedAt: null } }
      : { OR: [{ techId: user?.id ?? -1 }, { crew: { some: { accountId: user?.id ?? -1 } } }] };
  }

  private async visitOrThrow(visitId: number, user: any) {
    const v = await this.prisma.visit.findFirst({
      where: { id: visitId, ...this.scope(user) },
      select: {
        id: true, seq: true, opStatus: true, hospitalId: true, opDate: true, usageConfirmedAt: true, usageConfirmedById: true,
        invoices: { where: { supersededAt: null }, select: { number: true }, take: 1 },
        patient: { select: { code: true, firstName: true, lastName: true } },
        stockTransfers: {
          orderBy: { id: 'asc' },
          select: USAGE_TRANSFER_SELECT,
        },
        usages: { select: { key: true, quantity: true, mode: true, updatedAt: true } },
      },
    });
    if (!v) throw new NotFoundException(isUnrestricted(user) || isCompanyStaff(user) ? 'مراجعه یافت نشد' : 'این عمل در کارهای شما نیست');
    /* ستِ عمومیِ همان بیمارستان و روز هم منبعِ مصرفِ همین بیمار است. */
    await withSharedTransfers(this.prisma, [v], { select: USAGE_TRANSFER_SELECT, orderBy: { id: 'asc' } });
    return v;
  }

  async sheet(visitId: number, user: any) {
    const v = await this.visitOrThrow(visitId, user);
    const recorded = new Map(v.usages.map((u) => [u.key, u]));
    const transfers = v.stockTransfers.filter((t) => t.status !== 'planned');
    const open = transfers.filter((t) => t.status !== 'closed');
    const awaiting = open.some((t) => deliveryState(t as any, t.stop as any) === 'awaiting');
    const editable = v.opStatus !== 'cancelled' && (transfers.length === 0 || open.length > 0);
    const home = await this.inventory.home();

    const seen = new Set<number>();
    const setBlocks: { transferId: number; code: string; setLotId: number; serialNo: string | null; name: string; location: string; lines: UsageLine[] }[] = [];
    const transferBlocks: { transferId: number; code: string; lines: UsageLine[] }[] = [];
    for (const t of open) {
      const sent = t.movements.filter((m) => m.location === t.toLocation && m.lot);
      const loose: UsageLine[] = [];
      let usedOf: Map<number, number> | null = null;
      let allOf: Map<number, number> | null = null;
      for (const m of sent) {
        const item = m.lot!.item;
        if (item.assetKind === 'set' && m.lot!.serialNo) {
          const [set] = await this.sets.sets({ lotId: m.lot!.id });
          if (!set) continue;
          const partIds = set.contents.filter((c: any) => c.tracked && c.partId).map((c: any) => Number(c.partId));
          const parts = partIds.length
            ? await this.prisma.item.findMany({ where: { id: { in: partIds } }, select: { id: true, unit: true, usageMode: true } })
            : [];
          const partOf = new Map(parts.map((p) => [p.id, p]));
          const lines: UsageLine[] = set.contents
            .filter((c: any) => c.tracked && c.partId)
            .map((c: any) => {
              const p = partOf.get(Number(c.partId));
              const multi = p?.usageMode === 'multi';
              const key = usageKey('set', set.lotId, Number(c.partId));
              seen.add(Number(c.partId));
              return {
                key, source: 'set' as const, mode: (multi ? 'use' : 'consume') as UsageMode,
                itemId: Number(c.partId), name: c.label, unit: c.unit ?? p?.unit ?? 'عدد', usageMode: p?.usageMode ?? 'single',
                setLotId: set.lotId, transferId: t.id, lotId: null,
                limit: multi ? null : (c.inside ?? 0),
                quantity: recorded.get(key)?.quantity ?? 0,
                usesTotal: 0,
              };
            });
          setBlocks.push({ transferId: t.id, code: t.code, setLotId: set.lotId, serialNo: set.serialNo ?? null, name: set.itemName, location: set.location, lines });
        } else {
          /* دستگاه و ستِ بی‌سریال «مصرفی» نیستند — شمارندهٔ «چندبارمصرف» برایشان فقط گیج می‌کرد (نقدِ پنلِ
             کارشناسی، ۱۴۰۵/۰۸/۱۷). جای دستگاه بلوکِ «دستگاه» است. */
          if (item.assetKind === 'device' || item.assetKind === 'set') continue;
          if (!usedOf) {
            /* مصرفِ همین بیمار و مصرفِ همه از همین حواله — ستِ عمومیِ بیمارستان بینِ چند بیمار است. */
            const agg = await this.prisma.stockMovement.groupBy({
              by: ['lotId', 'visitId'], where: { transferId: t.id, kind: { in: ['out', 'return'] } }, _sum: { quantity: true },
            });
            usedOf = new Map();
            allOf = new Map();
            for (const a of agg) {
              const q = -(a._sum.quantity ?? 0);
              allOf.set(a.lotId, (allOf.get(a.lotId) ?? 0) + q);
              if (a.visitId === v.id) usedOf.set(a.lotId, (usedOf.get(a.lotId) ?? 0) + q);
            }
          }
          const multi = item.usageMode === 'multi';
          const key = usageKey('transfer', m.lotId, item.id);
          seen.add(item.id);
          loose.push({
            key, source: 'transfer', mode: multi ? 'use' : 'consume',
            itemId: item.id, name: labelOf(item), unit: item.unit ?? 'عدد', usageMode: item.usageMode,
            setLotId: null, transferId: t.id, lotId: m.lotId,
            /* سقف = ارسالی منهای مصرفِ بیمارانِ دیگر از همین حواله. */
            limit: multi ? null : m.quantity - ((allOf!.get(m.lotId) ?? 0) - (usedOf.get(m.lotId) ?? 0)),
            // یک‌بارمصرفِ ارسالی: عدد از خودِ دفتر (برگهٔ مصرفِ قدیم هم همین را می‌نویسد)، نه از ردیفِ ما.
            quantity: multi ? (recorded.get(key)?.quantity ?? 0) : (usedOf.get(m.lotId) ?? 0),
            usesTotal: 0,
          });
        }
      }
      if (loose.length) transferBlocks.push({ transferId: t.id, code: t.code, lines: loose });
    }

    /* کالاهای تیک‌خوردهٔ «نمایش در پنلِ کارشناسی» که در ست/حوالهٔ همین عمل نیستند — از کیف/انبار. */
    const defaults = v.usages.length ? new Map<number, number>() : await this.companyDefaults();
    const flagged = await this.prisma.item.findMany({
      where: { active: true, id: { notIn: [...seen] }, OR: [{ showInTechPanel: true }, { id: { in: [...defaults.keys()] } }], assetKind: 'consumable' },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, size: true, unit: true, usageMode: true,
        lots: { select: { location: true, expiresAt: true, movements: { select: { quantity: true, location: true } } } },
      },
    });
    const now = Date.now();
    const warehouse: UsageLine[] = flagged.map((it) => {
      const multi = it.usageMode === 'multi';
      const key = usageKey('warehouse', null, it.id);
      const available = multi ? null : it.lots.reduce((sum, lot) => {
        if (lot.expiresAt && lot.expiresAt.getTime() < now) return sum;
        const h = lot.location ?? home;
        return sum + (balanceByLocation(lot.movements, h).get(h) ?? 0);
      }, 0);
      return {
        key, source: 'warehouse', mode: multi ? 'use' : 'consume',
        itemId: it.id, name: labelOf(it), unit: it.unit ?? 'عدد', usageMode: it.usageMode,
        setLotId: null, transferId: null, lotId: null,
        limit: available, quantity: recorded.get(key)?.quantity ?? 0, usesTotal: 0,
      };
    });

    /* «تا امروز N بار» برای چندبارمصرف‌ها — جمعِ همهٔ عمل‌ها، یک کوئری. */
    const all = [...setBlocks.flatMap((b) => b.lines), ...transferBlocks.flatMap((b) => b.lines), ...warehouse];
    const multiIds = [...new Set(all.filter((l) => l.mode === 'use').map((l) => l.itemId))];
    if (multiIds.length) {
      const uses = await this.prisma.visitUsage.groupBy({ by: ['itemId'], where: { mode: 'use', itemId: { in: multiIds } }, _sum: { quantity: true } });
      const of = new Map(uses.map((u) => [u.itemId, u._sum.quantity ?? 0]));
      for (const l of all) if (l.mode === 'use') l.usesTotal = of.get(l.itemId) ?? 0;
    }

    /* ب-۳: پیش‌فرضِ شرکت فقط برای بیمارِ بی‌ثبت؛ ستِ همراه اول، بعد کیف/انبار — هر قلم یک‌بار. */
    if (defaults.size) {
      const placed = new Set<number>();
      for (const l of all) {
        const q = defaults.get(l.itemId);
        if (!q || placed.has(l.itemId)) continue;
        l.suggested = l.limit !== null ? Math.min(l.limit, q) : q;
        placed.add(l.itemId);
      }
    }

    const recordedAt = v.usages.reduce<Date | null>((m, u) => (!m || u.updatedAt > m ? u.updatedAt : m), null);
    /* ب-۲: تأییدِ نهایی و فاکتور. فاکتورِ صادرشده = قفل برای همه (فاکتور نباید با فهرستِ بعدی فرق کند). */
    const invoiced = v.invoices[0]?.number ?? null;
    const confirmedBy = v.usageConfirmedById
      ? await this.prisma.account.findUnique({ where: { id: v.usageConfirmedById }, select: { person: { select: { firstName: true, lastName: true } } } })
      : null;
    const staff = isCompanyStaff(user);
    const history = await this.history(v.id);
    return {
      visitId: v.id,
      code: `${v.patient.code}-V${v.seq}`,
      patientName: [v.patient.firstName, v.patient.lastName].filter(Boolean).join(' '),
      editable: editable && !invoiced && (staff || !v.usageConfirmedAt),
      awaiting,
      canRecord: !awaiting,
      invoiced,
      confirmed: v.usageConfirmedAt ? { at: v.usageConfirmedAt, by: confirmedBy ? [confirmedBy.person?.firstName, confirmedBy.person?.lastName].filter(Boolean).join(' ') : null } : null,
      canConfirm: staff && editable && !invoiced,
      suggested: defaults.size > 0 && all.some((l) => l.suggested),
      history,
      recordedAt,
      home,
      sets: setBlocks,
      transfers: transferBlocks,
      warehouse,
    };
  }

  async save(visitId: number, dto: { lines: { source: UsageSource; itemId: number; setLotId?: number; lotId?: number; quantity: number }[] }, user: any) {
    const sheet = await this.sheet(visitId, user);
    if (sheet.invoiced) throw new BadRequestException(`برای این بیمار فاکتورِ ${sheet.invoiced} صادر شده؛ مصرفی دیگر قابلِ تغییر نیست`);
    if (sheet.confirmed && !isCompanyStaff(user)) throw new ForbiddenException('مصرفیِ این بیمار تأییدِ نهایی شده؛ برای اصلاح به شرکت خبر دهید');
    if (!sheet.editable) throw new BadRequestException('حوالهٔ این عمل بسته شده و مصرفش دیگر قابلِ تغییر نیست');
    if (sheet.awaiting) throw new BadRequestException('اول تحویلِ ست را تأیید کنید («تحویل گرفتم» یا «با مغایرت»)، بعد مصرفی ثبت کنید');
    const all = [...sheet.sets.flatMap((b) => b.lines), ...sheet.transfers.flatMap((b) => b.lines), ...sheet.warehouse];
    const byKey = new Map(all.map((l) => [l.key, l]));
    const changes: { key: string; name: string; from: number; to: number }[] = [];

    for (const raw of dto.lines ?? []) {
      const anchor = raw.source === 'set' ? raw.setLotId : raw.source === 'transfer' ? raw.lotId : null;
      const key = usageKey(raw.source, anchor, Number(raw.itemId));
      const line = byKey.get(key);
      if (!line) throw new BadRequestException('این قلم در برگهٔ مصرفیِ این عمل نیست');
      const target = Math.trunc(Number(raw.quantity));
      if (!Number.isInteger(target) || target < 0) throw new BadRequestException(`«${line.name}»: تعداد نمی‌تواند منفی باشد`);
      const delta = target - line.quantity;
      if (delta === 0) continue;
      if (line.mode === 'consume') {
        if (line.limit !== null && target > line.limit) {
          const where = line.source === 'set' ? 'در ست' : line.source === 'transfer' ? 'ارسال شده' : 'در انبار';
          throw new BadRequestException(`«${line.name}»: فقط ${line.limit} عدد ${where} است`);
        }
        if (line.source === 'set') await this.consumeFromSet(visitId, sheet.code, line, delta, user);
        else if (line.source === 'warehouse') await this.consumeFromHome(visitId, sheet.code, sheet.home, line, delta, user);
        else await this.inventory.consumeFromTransfer(line.transferId!, line.lotId!, visitId, target, user);
      }
      if (target === 0) {
        await this.prisma.visitUsage.deleteMany({ where: { visitId, key } });
      } else {
        await this.prisma.visitUsage.upsert({
          where: { visitId_key: { visitId, key } },
          create: {
            visitId, key, itemId: line.itemId, source: line.source, setLotId: line.setLotId, transferId: line.transferId,
            mode: line.mode, quantity: target, recordedById: user?.id ?? null,
          },
          update: { quantity: target, recordedById: user?.id ?? null },
        });
      }
      changes.push({ key, name: line.name, from: line.quantity, to: target });
    }

    if (changes.length) {
      await this.audit.record({ actorId: user?.id, action: 'stock.visit.usage', entityType: 'visit', entityId: visitId, after: { changes } });
      /* همان رویدادِ برگهٔ مصرف: کارِ «تأییدِ مصرفِ سرِ عمل» بسته می‌شود (work-rules: usage.confirmed). */
      await this.events.emit({ type: 'usage.confirmed', visitId, actorId: user?.id ?? null, payload: { changes } });
    }
    return this.sheet(visitId, user);
  }

  /** مصرف از داخلِ ست — از لات‌های داخلِ ست، نزدیک‌ترین انقضا اول؛ اصلاح به همان لات‌ها برمی‌گردد. */
  private async consumeFromSet(visitId: number, code: string, line: UsageLine, delta: number, user: any) {
    const [set] = await this.sets.sets({ lotId: line.setLotId! });
    const c = set?.contents.find((x: any) => Number(x.partId) === line.itemId);
    if (!set || !c) throw new NotFoundException('قلمِ ست پیدا نشد');
    if (delta > 0) {
      let need = delta;
      for (const pl of c.lots as { lotId: number; quantity: number }[]) {
        if (need <= 0) break;
        const q = Math.min(pl.quantity, need);
        if (q <= 0) continue;
        await this.inventory.consume({ lotId: pl.lotId, quantity: q, visitId, reason: `مصرفِ سرِ عمل — ${code}`, location: set.location, transferId: line.transferId }, user);
        need -= q;
      }
      if (need > 0) throw new BadRequestException(`«${c.label}»: فقط ${c.inside ?? 0} عدد در ${set.location} است`);
    } else {
      await this.giveBack(visitId, code, line.itemId, set.location, -delta, line.transferId, user);
    }
  }

  /** مصرف از انبار (کیفِ کارشناس) — لات‌های همان کالا در محلِ خانه، نزدیک‌ترین انقضا اول. */
  private async consumeFromHome(visitId: number, code: string, home: string, line: UsageLine, delta: number, user: any) {
    if (delta > 0) {
      const lots = await this.prisma.stockLot.findMany({
        where: { itemId: line.itemId },
        select: { id: true, location: true, expiresAt: true, movements: { select: { quantity: true, location: true } } },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      });
      const now = Date.now();
      let need = delta;
      for (const lot of lots) {
        if (need <= 0) break;
        if (lot.expiresAt && lot.expiresAt.getTime() < now) continue;
        const h = lot.location ?? home;
        const avail = balanceByLocation(lot.movements, h).get(h) ?? 0;
        if (avail <= 0) continue;
        const q = Math.min(avail, need);
        await this.inventory.consume({ lotId: lot.id, quantity: q, visitId, reason: `مصرفِ سرِ عمل از انبار — ${code}`, location: h }, user);
        need -= q;
      }
      if (need > 0) throw new BadRequestException(`«${line.name}»: در انبار فقط ${line.limit ?? 0} عدد است`);
    } else {
      await this.giveBack(visitId, code, line.itemId, home, -delta, null, user);
    }
  }

  /**
   * «مصرفیِ پیش‌فرضِ هر بیمار» (ب-۳، مالک ۱۴۰۵/۰۸/۱۸): **یک** فهرست برای کلِ خدمت (نه برای MEP/SEP جدا)، در
   * تعاریفِ پایه. همان تنظیمِ `invoice_neuro_consumables` است تا فاکتورِ نورو تا ج-۲ همان را بخواند؛ ردیف‌های
   * قدیمیِ بی‌کالا (فقط نام) دست نمی‌خورند.
   */
  async defaults() {
    const raw = (await this.settings.text('invoice_neuro_consumables')).trim();
    let rows: any[] = [];
    if (raw.startsWith('[')) { try { rows = JSON.parse(raw); } catch { rows = []; } }
    const ids = rows.map((r) => Number(r?.itemId)).filter((n) => Number.isInteger(n) && n > 0);
    const items = ids.length ? await this.prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, size: true, unit: true, active: true } }) : [];
    const byId = new Map(items.map((i) => [i.id, i]));
    return {
      lines: rows.filter((r) => byId.has(Number(r?.itemId))).map((r) => {
        const it = byId.get(Number(r.itemId))!;
        return { itemId: it.id, name: labelOf(it), unit: it.unit ?? 'عدد', quantity: Number(r.qty) || 1, active: it.active };
      }),
      legacy: rows.filter((r) => !byId.has(Number(r?.itemId))).map((r) => String(r?.name ?? '')).filter(Boolean),
    };
  }

  async saveDefaults(lines: { itemId: number; quantity: number }[], user: any) {
    const ids = [...new Set(lines.map((l) => Number(l.itemId)))];
    const items = ids.length ? await this.prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, size: true, irc: true, assetKind: true } }) : [];
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const l of lines) {
      const it = byId.get(Number(l.itemId));
      if (!it) throw new BadRequestException('یکی از اقلام در کاتالوگ نیست');
      if (it.assetKind !== 'consumable') throw new BadRequestException(`«${it.name}» مصرفی نیست`);
      if (!Number.isInteger(Number(l.quantity)) || l.quantity < 1 || l.quantity > 999) throw new BadRequestException(`تعدادِ «${it.name}» باید ۱ تا ۹۹۹ باشد`);
    }
    const raw = (await this.settings.text('invoice_neuro_consumables')).trim();
    let old: any[] = [];
    if (raw.startsWith('[')) { try { old = JSON.parse(raw); } catch { old = []; } }
    const prevOf = new Map(old.filter((r) => r?.itemId).map((r) => [Number(r.itemId), r]));
    const legacy = old.filter((r) => !r?.itemId);
    const next = [
      ...lines.map((l) => {
        const it = byId.get(Number(l.itemId))!;
        const prev = prevOf.get(it.id);
        return { name: labelOf(it), irc: (it.irc ?? prev?.irc ?? '').replace(/\D/g, ''), qty: Number(l.quantity), itemId: it.id, stockEffect: prev?.stockEffect ?? 'virtual' };
      }),
      ...legacy,
    ];
    await this.settings.update({ invoice_neuro_consumables: JSON.stringify(next) }, user);
    return this.defaults();
  }

  /** «تأییدِ نهایی» / برداشتنِ آن — فقط کاربرِ شرکت (سوپروایزر+). */
  async confirm(visitId: number, confirmed: boolean, user: any) {
    if (!isCompanyStaff(user)) throw new ForbiddenException('تأییدِ مصرفی با کاربرِ شرکت (سوپروایزر به بالا) است');
    const sheet = await this.sheet(visitId, user);
    if (sheet.invoiced) throw new BadRequestException(`برای این بیمار فاکتورِ ${sheet.invoiced} صادر شده`);
    await this.prisma.visit.update({ where: { id: visitId }, data: confirmed ? { usageConfirmedAt: new Date(), usageConfirmedById: user?.id ?? null } : { usageConfirmedAt: null, usageConfirmedById: null } });
    await this.audit.record({ actorId: user?.id, action: confirmed ? 'stock.visit.usage_confirm' : 'stock.visit.usage_unconfirm', entityType: 'visit', entityId: visitId });
    return this.sheet(visitId, user);
  }

  /**
   * «خراب شد»ِ قلمِ چندبارمصرفِ داخلِ ست از پنلِ کارشناس (ب-۱) — همان قاعدهٔ الف-۳: چندبارمصرف به «خرابی‌ها»،
   * یک‌بارمصرف از کل. دامنه همان دامنهٔ برگه است، پس کارشناس فقط ستِ همراهِ عملِ خودش را.
   */
  async damage(visitId: number, dto: { setLotId: number; itemId: number; quantity: number; note?: string }, user: any) {
    const sheet = await this.sheet(visitId, user);
    if (!sheet.editable) throw new BadRequestException('مصرفیِ این بیمار دیگر قابلِ تغییر نیست');
    const block = sheet.sets.find((b) => b.setLotId === Number(dto.setLotId));
    if (!block || !block.lines.some((l) => l.itemId === Number(dto.itemId))) throw new BadRequestException('این قلم در ستِ همراهِ این عمل نیست');
    const [set] = await this.sets.sets({ lotId: block.setLotId });
    const c = set?.contents.find((x: any) => Number(x.partId) === Number(dto.itemId));
    const lot = (c?.lots as { lotId: number; quantity: number }[] | undefined)?.find((l) => l.quantity > 0);
    if (!lot) throw new BadRequestException('این قلم الان داخلِ ست نیست');
    const qty = Math.trunc(Number(dto.quantity));
    if (!Number.isInteger(qty) || qty <= 0 || qty > lot.quantity) throw new BadRequestException(`تعداد باید بینِ ۱ و ${lot.quantity} باشد`);
    const r = await this.sets.damage(block.setLotId, { partLotId: lot.lotId, quantity: qty, note: dto.note || `خرابی سرِ عمل — ${sheet.code}` }, user);
    return { ...(await this.sheet(visitId, user)), writtenOff: (r as any).writtenOff };
  }

  /** سابقهٔ ثبت و اصلاحِ مصرفیِ همین بیمار — چه کسی، کِی، چه چیزی (ب-۲). */
  private async history(visitId: number) {
    const rows = await this.prisma.auditEvent.findMany({
      where: { entityType: 'visit', entityId: String(visitId), action: { in: ['stock.visit.usage', 'stock.visit.usage_confirm', 'stock.visit.usage_unconfirm'] } },
      orderBy: { id: 'desc' }, take: 12, select: { action: true, actorId: true, afterJson: true, createdAt: true },
    });
    const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is number => !!x))];
    const people = ids.length ? await this.prisma.account.findMany({ where: { id: { in: ids } }, select: { id: true, person: { select: { firstName: true, lastName: true } } } }) : [];
    const nameOf = new Map(people.map((a) => [a.id, [a.person?.firstName, a.person?.lastName].filter(Boolean).join(' ')]));
    return rows.map((r) => ({
      at: r.createdAt,
      by: r.actorId ? nameOf.get(r.actorId) ?? null : null,
      kind: r.action === 'stock.visit.usage' ? 'edit' : r.action.endsWith('_confirm') ? 'confirm' : 'unconfirm',
      changes: ((r.afterJson as any)?.changes ?? []).map((c: any) => ({ name: c.name, from: c.from, to: c.to })),
    }));
  }

  /** اصلاحِ رو به پایین: به همان لات‌هایی برمی‌گردد که همین عمل از آن‌ها مصرف کرده بود (تازه‌ترین اول). */
  private async giveBack(visitId: number, code: string, itemId: number, location: string, give: number, transferId: number | null, user: any) {
    const moves = await this.prisma.stockMovement.findMany({
      where: { visitId, kind: { in: ['out', 'return'] }, lot: { itemId }, location, transferId: transferId ?? null },
      select: { lotId: true, quantity: true }, orderBy: { id: 'desc' },
    });
    const net = new Map<number, number>();
    for (const m of moves) net.set(m.lotId, (net.get(m.lotId) ?? 0) - m.quantity);
    let left = give;
    for (const [lotId, consumed] of net) {
      if (left <= 0) break;
      const q = Math.min(consumed, left);
      if (q <= 0) continue;
      await this.inventory.returnToStock({ lotId, quantity: q, visitId, reason: `اصلاحِ مصرفِ سرِ عمل — ${code}`, location, transferId }, user);
      left -= q;
    }
    if (left > 0) throw new BadRequestException('بیش از آنچه این عمل مصرف کرده برنمی‌گردد');
  }
}
