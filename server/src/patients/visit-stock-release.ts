import { balanceByLocation, HOME_FALLBACK } from './stock-math';
import { sharedTransfersWhere } from './shared-transfers';

/**
 * **حذفِ مراجعه ← ست و دستگاهش آزاد می‌شود** (گزارشِ مالک، ۱۴۰۵/۰۸/۱۷).
 *
 * تا امروز `deleteVisit` فقط ردیفِ مراجعه را پاک می‌کرد و FKها `visitId` حواله و حرکت‌ها را NULL می‌کردند:
 * حوالهٔ «رفته» باز می‌ماند و موجودی در محلِ بیمارستان («بیمارستانِ بقیه‌الله: ۱») می‌ماند — ست و دستگاه برای
 * همیشه «بیرون» دیده می‌شدند. بدتر، حوالهٔ بی‌مراجعه حکمِ «ستِ عمومیِ بیمارستان + روز» را می‌گرفت
 * (`sharedTransfersWhere`) و روی کارتِ بیمارانِ دیگرِ همان روز هم پیدا می‌شد.
 *
 * داخلِ همان تراکنشِ حذف، به این ترتیب:
 *  ۱. مصرفِ ثبت‌شده برای این مراجعه برمی‌گردد (حرکتِ `return` به همان محل و همان حواله) — مراجعه‌ای که
 *     دیگر نیست مصرفی هم ندارد. (مراجعهٔ فاکتورشده اصلاً حذف نمی‌شود؛ مراجعهٔ واقعی «لغو» می‌شود.)
 *  ۲. حوالهٔ خودِ مراجعه بسته می‌شود: «برنامه‌ریزی‌شده» بی‌حرکت بسته می‌شود و «رفته/رسیده» مانده‌اش به مبدأ
 *     برمی‌گردد (همان کارِ `returnTransfer`).
 *  ۳. ستِ عمومیِ «بیمارستان + روز» که لنگرش همین مراجعه بود: اگر بیمارِ دیگری آن روز آن‌جا هست، لنگر به او
 *     منتقل می‌شود (ست مالِ اوست)؛ اگر نه، مثلِ حوالهٔ خودِ مراجعه بسته می‌شود.
 */
export type VisitStockRelease = { returned: { lotId: number; quantity: number; location: string }[]; closed: number[]; reanchored: number[] };

export async function releaseVisitStock(tx: any, visitId: number, actorId: number | null): Promise<VisitStockRelease> {
  const out: VisitStockRelease = { returned: [], closed: [], reanchored: [] };
  const reason = 'حذفِ مراجعه';

  /* ۱) برگشتِ مصرف — خالصِ out/return به‌ازای (لات، محل، حواله). */
  const moves = await tx.stockMovement.findMany({
    where: { visitId, kind: { in: ['out', 'return'] } },
    select: { lotId: true, location: true, transferId: true, quantity: true },
  });
  const net = new Map<string, { lotId: number; location: string | null; transferId: number | null; q: number }>();
  for (const m of moves) {
    const k = `${m.lotId}|${m.location ?? ''}|${m.transferId ?? ''}`;
    const r = net.get(k) ?? { lotId: m.lotId, location: m.location, transferId: m.transferId, q: 0 };
    r.q -= m.quantity;
    net.set(k, r);
  }
  for (const r of net.values()) {
    if (r.q <= 0) continue;
    await tx.stockMovement.create({ data: {
      lotId: r.lotId, kind: 'return', quantity: r.q, location: r.location, visitId, transferId: r.transferId,
      reason: `برگشتِ مصرف — ${reason}`, createdById: actorId,
    } });
    out.returned.push({ lotId: r.lotId, quantity: r.q, location: r.location ?? '' });
  }

  /* ۲ و ۳) حواله‌های بازِ این مراجعه. */
  const v = await tx.visit.findUnique({ where: { id: visitId }, select: { hospitalId: true, opDate: true } });
  const transfers = await tx.stockTransfer.findMany({
    where: { visitId, status: { not: 'closed' } },
    select: { id: true, status: true, shared: true, fromLocation: true, toLocation: true },
  });
  const homeName = (await tx.setting.findUnique({ where: { key: 'home_location' } }))?.value?.trim() || HOME_FALLBACK;

  for (const t of transfers) {
    if (t.shared) {
      const w = sharedTransfersWhere(v?.hospitalId, v?.opDate);
      const heir = w ? await tx.visit.findFirst({
        where: { id: { not: visitId }, hospitalId: v!.hospitalId, opDate: w.plannedFor, opStatus: { not: 'cancelled' }, patient: { deletedAt: null } },
        orderBy: { id: 'asc' }, select: { id: true },
      }) : null;
      if (heir) {
        await tx.stockTransfer.update({ where: { id: t.id }, data: { visitId: heir.id } });
        out.reanchored.push(t.id);
        continue;
      }
    }
    if (t.status !== 'planned') {
      const lotIds: number[] = [...new Set<number>((await tx.stockMovement.findMany({ where: { transferId: t.id }, select: { lotId: true } })).map((m: any) => m.lotId))];
      for (const lotId of lotIds) {
        const rows = await tx.stockMovement.findMany({ where: { lotId }, select: { quantity: true, location: true } });
        const lot = await tx.stockLot.findUnique({ where: { id: lotId }, select: { location: true } });
        const atDest = balanceByLocation(rows, lot?.location ?? homeName).get(t.toLocation) ?? 0;
        if (atDest <= 0) continue;
        const base = { lotId, kind: 'transfer', transferId: t.id, visitId, reason: `برگشتِ حواله — ${reason}`, createdById: actorId };
        await tx.stockMovement.create({ data: { ...base, quantity: -atDest, location: t.toLocation } });
        await tx.stockMovement.create({ data: { ...base, quantity: atDest, location: t.fromLocation } });
      }
    }
    await tx.stockTransfer.update({ where: { id: t.id }, data: { status: 'closed' } });
    out.closed.push(t.id);
  }
  return out;
}
