/**
 * **ارسالِ عمومی = مالِ «بیمارستان + روز»** (تصمیمِ مالک ۱۴۰۵/۰۸/۰۴).
 *
 * تحویلِ تختهٔ حمل (`planDelivery`) حواله را به **اولین** بیمارِ آن بیمارستان در آن روز می‌چسباند (لنگرِ بازهٔ
 * تعهدِ انبار)؛ پس ستِ عمومی فقط روی کارتِ یک بیمارِ دلخواه دیده می‌شد و مصرفیِ بقیه از آن ثبت نمی‌شد. حالا
 * چنین حواله‌ای `shared = true` است و هر خواننده‌ای که «ست‌های این عمل» را می‌خواهد، ست‌های عمومیِ همان
 * بیمارستان و روز را هم با همین تابع می‌گیرد — هر کارشناسِ آن بیمارستان در آن روز می‌بیندشان و مصرفیِ هر بیمار
 * روی پرونده‌اش از همان ست کم می‌شود. (حوالهٔ بی‌مراجعهٔ قدیمی هم همین حکم را دارد.)
 */
const DAY = 24 * 3600_000;
const dayOf = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);

export function sharedTransfersWhere(hospitalId: number | null | undefined, opDate: Date | null | undefined) {
  if (!hospitalId || !opDate) return null;
  const d = dayOf(opDate);
  return { OR: [{ shared: true }, { visitId: null }], hospitalId, plannedFor: { gte: d, lt: new Date(d.getTime() + DAY) } };
}

/**
 * `visits[i].stockTransfers` را با حواله‌های عمومیِ همان بیمارستان و روز کامل می‌کند (برچسبِ `shared: true`).
 * `shape` همان `select`/`include`ی است که خواننده برای حواله‌های خودِ مراجعه داده؛ `hospitalId` و `plannedFor`
 * برای جورکردن اضافه می‌شوند.
 */
export async function withSharedTransfers(prisma: any, visits: any[], shape: { select?: any; include?: any; where?: any; orderBy?: any }) {
  const pairs = new Map<string, any>();
  for (const v of visits) {
    const w = sharedTransfersWhere(v.hospitalId, v.opDate);
    if (w) pairs.set(`${v.hospitalId}:${w.plannedFor.gte.toISOString()}`, w);
  }
  if (!pairs.size) return;
  const query: any = { where: { AND: [shape.where ?? {}, { OR: [...pairs.values()] }] }, orderBy: shape.orderBy ?? { id: 'asc' } };
  if (shape.select) query.select = { ...shape.select, hospitalId: true, plannedFor: true };
  else if (shape.include) query.include = shape.include;
  const rows = await prisma.stockTransfer.findMany(query);
  if (!rows.length) return;
  for (const v of visits) {
    const w = sharedTransfersWhere(v.hospitalId, v.opDate);
    if (!w) continue;
    const have = new Set((v.stockTransfers ?? []).map((t: any) => t.id));
    const mine = rows.filter((t: any) => t.hospitalId === v.hospitalId && t.plannedFor >= w.plannedFor.gte && t.plannedFor < w.plannedFor.lt && !have.has(t.id));
    /* حوالهٔ لنگرِ همین مراجعه هم «عمومی» برچسب می‌خورد — کارشناس بداند مالِ همه است. */
    v.stockTransfers = [...(v.stockTransfers ?? []).map((t: any) => (rows.some((r: any) => r.id === t.id) ? { ...t, shared: true } : t)),
      ...mine.map((t: any) => ({ ...t, shared: true }))];
  }
}

/**
 * **جابه‌جاییِ مراجعه ← حملِ هنوز نرفته هم جابه‌جا می‌شود** (۱۴۰۵/۰۸/۰۴). تا امروز تغییرِ تاریخ یا بیمارستانِ
 * عمل فقط روی خودِ مراجعه می‌نشست و حوالهٔ برنامه‌ریزی‌شده‌اش همان روز و همان بیمارستانِ قبلی را نگه می‌داشت —
 * دستگاه به جای اشتباه می‌رفت و تقویمِ انبار روزِ اشتباه را رزرو می‌دید.
 *
 * فقط حوالهٔ `planned` (هنوز بار نخورده): تاریخ/بیمارستان/مقصد عوض می‌شود و از مسیرِ رانندهٔ روزِ قبل جدا
 * می‌شود (`stopId = null`) تا در تختهٔ روزِ تازه «بی‌راننده» دیده شود، نه بی‌صدا با رانندهٔ دیروز. حوالهٔ
 * رفته دست نمی‌خورد — شمارش‌شان برگردانده می‌شود تا نویسنده بگوید.
 */
export async function followVisitMove(tx: any, visitId: number): Promise<{ moved: number; gone: number }> {
  const v = await tx.visit.findUnique({ where: { id: visitId }, select: { opDate: true, hospitalId: true, hospital: { select: { name: true } } } });
  if (!v) return { moved: 0, gone: 0 };
  /* ستِ عمومیِ «بیمارستان + روز» با جابه‌جاییِ لنگرش جابه‌جا نمی‌شود — مالِ بقیهٔ بیمارانِ همان‌جاست. */
  const rows = await tx.stockTransfer.findMany({ where: { visitId, shared: false, status: { not: 'closed' } }, select: { id: true, status: true, plannedFor: true, hospitalId: true, stopId: true } });
  let moved = 0, gone = 0;
  for (const t of rows) {
    const sameDay = !!v.opDate && !!t.plannedFor && t.plannedFor.toISOString().slice(0, 10) === v.opDate.toISOString().slice(0, 10);
    const sameHospital = !v.hospitalId || t.hospitalId === v.hospitalId;
    if (sameDay && sameHospital) continue;
    if (t.status !== 'planned') { gone++; continue; }
    await tx.stockTransfer.update({ where: { id: t.id }, data: {
      ...(v.opDate ? { plannedFor: dayOf(v.opDate) } : {}),
      ...(v.hospitalId ? { hospitalId: v.hospitalId, toLocation: v.hospital?.name ?? undefined } : {}),
      stopId: null, windowFrom: null, windowTo: null,
    } });
    moved++;
  }
  return { moved, gone };
}
