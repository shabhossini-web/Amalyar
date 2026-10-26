import { syncVisitDuty } from './hospital-duties.service';
import { autoDevice } from './device-link';

/**
 * **تیمِ پرونده تنها منبعِ «چه کسی سرِ این بیمار است»** (تصمیمِ مالک ۱۴۰۵/۰۸/۰۴: «مشخصاتِ پروندهٔ یک
 * بیمار واحد است؛ از هر جا خوانده یا عوض شود همه‌جا اثر دارد»).
 *
 * تا امروز سه جا این را می‌نوشتند و هم را نمی‌دیدند: چینش و «پذیرش»ِ کارشناس فقط `Visit.techId` را
 * عوض می‌کردند، فرمِ خدمت فقط `VisitCrew` را، و ذخیرهٔ بعدیِ فرم کارشناسِ قبلی را بی‌صدا برمی‌گرداند؛
 * عضوِ دوم و سومِ تیم هم در چینش و حمل و پیامک هیچ‌جا نبود.
 *
 * حالا هر نویسنده‌ای (چینش، پذیرش، تحویل، فرمِ مراجعه، فرمِ خدمت، ثبتِ ساعت، موکول‌کردن) کارِ خودش را
 * می‌کند و بعد **همین تابع** را داخلِ همان تراکنش صدا می‌زند تا بقیه از تیم مشتق شوند:
 * - `Visit.techId` = «مسئولِ فعلی» — اولین عضوی که هنوز خارج نشده (و اگر همه خارج شده‌اند، آخری).
 *   چینش، حمل، مسیرها و پیامک همچنان از `techId` می‌خوانند، پس بی‌تغییر درست می‌مانند.
 * - هر عضوِ تیم ردیفِ حضورِ همان روز و بیمارستان را دارد (`HospitalDuty`) — پس در چینش و پیامک دیده می‌شود.
 * - ساعتِ شروع/پایانِ مانیتورینگ (`opStartTime`/`opEndTime`) = ورودِ اولین عضو / خروجِ آخرین عضو.
 */
export type CrewSyncOpts = {
  /** `techId` تازه از نویسنده‌ای بیرون از تیم آمده (چینش، پذیرش، فرمِ مراجعه) و باید روی تیم بنشیند. */
  tech?: { source: 'dispatch' | 'claim' | 'form' | 'legacy' };
  /**
   * کدام طرفِ ساعت تازه نوشته شده:
   * - `actual` — «شروع/پایان»ِ واقعی از پنلِ کارشناس یا میزِ اتاقِ عمل: ورودِ اولین / خروجِ آخرین عضو **همین** می‌شود؛
   * - `op` — ساعتِ برنامه از فرم/داشبورد: فقط ساعت‌هایی از تیم که از قبل ثبت شده‌اند هم‌گام می‌شوند (ساعتِ
   *   برنامه‌ریزیِ عمل «ورودِ کارشناس» نیست — وگرنه برداشتنِ کارشناسِ برنامه‌ریزی‌شده «شروع‌کرده» دیده می‌شد)؛
   * - `crew` — فرمِ خدمت یا تحویل: ساعتِ پرونده از تیم.
   */
  times?: 'op' | 'actual' | 'crew';
};

type Row = { id: number; accountId: number; fromTime: string | null; toTime: string | null; sort: number };

/** «مسئولِ فعلی» — اولین عضوی که خارج نشده؛ اگر همه خارج شده‌اند، آخری. */
export function currentMember<T extends { toTime: string | null }>(rows: T[]): T | null {
  return rows.find((r) => !r.toTime) ?? rows[rows.length - 1] ?? null;
}

const started = (r: Row | null) => !!r && (!!r.fromTime || !!r.toTime);

export async function syncCrew(tx: any, visitId: number, opts: CrewSyncOpts = {}) {
  const v = await tx.visit.findUnique({
    where: { id: visitId },
    select: { id: true, techId: true, hospitalId: true, opDate: true, opStartTime: true, opEndTime: true, techArriveTime: true },
  });
  if (!v) return;
  const load = (): Promise<Row[]> => tx.visitCrew.findMany({ where: { visitId }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
  let rows = await load();

  /* ۱) کارشناسی که بیرون از تیم انتخاب شد → روی تیم. */
  if (opts.tech || (!rows.length && v.techId)) {
    const source = opts.tech?.source ?? 'legacy';
    const cur = currentMember(rows);
    const next = v.techId;
    if (next === null) {
      /* برداشتنِ کارشناس فقط وقتی که هنوز کارش را شروع نکرده؛ شروع‌کرده بخشی از سابقهٔ همین عمل است. */
      if (cur && !started(cur)) await tx.visitCrew.delete({ where: { id: cur.id } });
    } else if (!rows.some((r) => r.accountId === next)) {
      if (!cur) await tx.visitCrew.create({ data: { visitId, accountId: next, sort: 0, source } });
      else if (!started(cur)) await tx.visitCrew.update({ where: { id: cur.id }, data: { accountId: next, source } });
      else {
        /* مسئولِ فعلی کارش را شروع کرده: نفرِ تازه «بعدی» می‌شود، نه جایگزین — تحویل با دکمهٔ «تحویل». */
        await tx.visitCrew.updateMany({ where: { visitId, sort: { gt: cur.sort } }, data: { sort: { increment: 1 } } });
        await tx.visitCrew.create({ data: { visitId, accountId: next, sort: cur.sort + 1, source } });
      }
    } else if (cur && cur.accountId !== next && !started(cur)) {
      /* کارشناسِ برنامه‌ریزی‌شدهٔ بعدی جای مسئولِ شروع‌نکرده را گرفت. */
      await tx.visitCrew.delete({ where: { id: cur.id } });
    }
    rows = await load();
  }

  /* ۲) ساعت‌ها: ورودِ اولین عضو = شروعِ مانیتورینگ، خروجِ آخرین عضو = پایانِ آن. */
  const patch: Record<string, any> = {};
  if (rows.length) {
    const first = rows[0], last = rows[rows.length - 1];
    if (opts.times === 'actual' || opts.times === 'op') {
      const actual = opts.times === 'actual';
      if (v.opStartTime && first.fromTime !== v.opStartTime && (actual || first.fromTime)) {
        await tx.visitCrew.update({ where: { id: first.id }, data: { fromTime: v.opStartTime } });
      }
      /* پایان فقط روی آخرین عضو می‌نشیند — عضوِ میانی را تحویل بسته است. */
      if (v.opEndTime !== last.toTime && (actual ? (v.opEndTime || last.toTime) : (v.opEndTime && last.toTime))) {
        await tx.visitCrew.update({ where: { id: last.id }, data: { toTime: v.opEndTime } });
      }
      rows = await load();
    } else {
      if (first.fromTime && first.fromTime !== v.opStartTime) patch.opStartTime = first.fromTime;
      /* آخرین عضو هنوز خارج نشده = مانیتورینگ تمام نشده. */
      const end = last.toTime ?? null;
      if (opts.times === 'crew' ? end !== v.opEndTime : (end && end !== v.opEndTime)) patch.opEndTime = end;
    }
  }

  /* ۳) مسئولِ فعلی + حضورِ هر عضو در برنامهٔ همان روز و بیمارستان. */
  const cur = currentMember(rows);
  const techId = cur?.accountId ?? null;
  let arrive: string | null = null;
  for (const r of rows) {
    const a = await syncVisitDuty(tx, {
      id: visitId, techId: r.accountId, hospitalId: v.hospitalId, opDate: v.opDate,
      opStartTime: r.fromTime ?? patch.opStartTime ?? v.opStartTime,
    });
    if (r.accountId === techId) arrive = a;
  }
  if (!rows.length && v.techId === null) arrive = null;
  if (techId !== v.techId) patch.techId = techId;
  if (arrive !== v.techArriveTime) patch.techArriveTime = arrive;
  if (Object.keys(patch).length) await tx.visit.update({ where: { id: visitId }, data: patch });
  /* شروعِ مانیتورینگ = دستگاه سرِ کار است: اگر حمل فقط یک دستگاه برده، همان دستگاهِ پرونده می‌شود. */
  if (opts.times === 'actual' && (patch.opStartTime ?? v.opStartTime)) await autoDevice(tx, visitId);
}
