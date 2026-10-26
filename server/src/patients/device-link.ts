/**
 * **دستگاهِ پرونده = همان دستگاهی که چینش/حمل به آن بیمارستان برده** (تصمیمِ مالک ۱۴۰۵/۰۸/۰۴).
 *
 * تا امروز دو دنیای جدا بودند: حواله‌ها (`StockTransfer`) دستگاه را به بیمارستان می‌بردند و فرمِ خدمت
 * `Visit.deviceLotId` را جدا انتخاب می‌کرد — دستگاهِ فرستاده‌شده در پرونده نمی‌نشست و دستگاهِ انتخاب‌شده
 * در انبار «آزاد» می‌ماند. این‌جا فقط «دستگاه‌های حملِ همین پرونده» پیدا می‌شوند؛ تصمیمِ وضعیتِ انبار
 * همچنان فقط در `AssetsService` است (که حالا `deviceLotId` را هم می‌خوانَد).
 */
const DAY = 24 * 3600_000;

export type TransportDevice = { lotId: number; name: string; serialNo: string | null };

/**
 * دستگاه‌های حواله‌های بازِ این پرونده: حوالهٔ خودِ همین مراجعه، یا حوالهٔ عمومیِ «همان بیمارستان، همان روز».
 */
export async function transportDevices(tx: any, visit: { id: number; hospitalId: number | null; opDate: Date | null }): Promise<TransportDevice[]> {
  const day = visit.opDate ? new Date(`${visit.opDate.toISOString().slice(0, 10)}T00:00:00.000Z`) : null;
  const transfers = await tx.stockTransfer.findMany({
    where: {
      status: { not: 'closed' },
      OR: [
        { visitId: visit.id },
        ...(visit.hospitalId && day ? [{ OR: [{ shared: true }, { visitId: null }], hospitalId: visit.hospitalId, plannedFor: { gte: day, lt: new Date(day.getTime() + DAY) } }] : []),
      ],
    },
    select: { status: true, toLocation: true, plannedLines: true, movements: { where: { kind: 'transfer', quantity: { gt: 0 } }, select: { lotId: true, location: true } } },
  });
  const ids = new Set<number>();
  for (const t of transfers) {
    if (t.status === 'planned') for (const l of ((t.plannedLines as any[] | null) ?? [])) { if (Number(l?.lotId) > 0) ids.add(Number(l.lotId)); }
    else for (const m of t.movements) if (m.location === t.toLocation) ids.add(m.lotId);
  }
  if (!ids.size) return [];
  const lots = await tx.stockLot.findMany({
    where: { id: { in: [...ids] }, item: { assetKind: 'device' } },
    select: { id: true, serialNo: true, lotNo: true, item: { select: { name: true, size: true } } },
    orderBy: { id: 'asc' },
  });
  return lots.map((l: any) => ({ lotId: l.id, name: [l.item.name, l.item.size].filter(Boolean).join(' '), serialNo: l.serialNo ?? l.lotNo ?? null }));
}

/**
 * پرونده‌ای که هنوز دستگاه ندارد، دستگاهِ حملِ خودش را می‌گیرد — فقط وقتی **یک** دستگاه رفته است
 * (دو دستگاه = انتخاب با کارشناس، نه حدس). دستگاهِ انتخاب‌شده هرگز بازنویسی نمی‌شود.
 * @returns lotId نشسته یا null
 */
export async function autoDevice(tx: any, visitId: number): Promise<number | null> {
  const v = await tx.visit.findUnique({ where: { id: visitId }, select: { id: true, hospitalId: true, opDate: true, deviceLotId: true } });
  if (!v || v.deviceLotId) return null;
  const devices = await transportDevices(tx, v);
  if (devices.length !== 1) return null;
  const r = await tx.visit.updateMany({ where: { id: visitId, deviceLotId: null }, data: { deviceLotId: devices[0].lotId } });
  return r.count ? devices[0].lotId : null;
}
