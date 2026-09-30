import { jalaliMonthRange, toJalali } from '../common/jalali';
import { clinicDateIso, clinicTodayIso, dayUtc } from '../common/clinic-day';

/** شمارِ ماه‌های پنجره — نیم‌سال: روند دیده شود و «این ماه» با ماه‌های قبل مقایسه شود. */
export const REFERRER_MONTHS = 6;

type Row = { key: string; name: string; byMonth: number[]; total: number; upcoming: number; lastAt: Date | null };

/**
 * **ارجاع‌دهنده‌ها** — آمارِ «تحلیلِ مشتریان» برای نصبِ شرکتی (بازبینیِ UX، company-25).
 *
 * مشتریِ واقعیِ شرکتِ خدمات جراح و بیمارستانِ ارجاع‌دهنده است، نه بیمار: مدیر می‌خواهد ببیند کدام جراح
 * و کدام بیمارستان چند کار فرستاده و روندش چیست — عددهایی که تا امروز فقط در حسابداری، به‌شکلِ درآمد،
 * بود. همه‌چیز همین‌جا مشتق می‌شود (قانونِ ۱۵)؛ صفحه فقط رسم می‌کند.
 *
 * - واحد «مراجعهٔ خدمت» است (`kind = surgery`)، لغوشده و پروندهٔ حذف‌شده بیرون؛ ماهِ هر کار ماهِ **عمل**
 *   است (`opDate`) و اگر تاریخ ندارد ماهِ ثبتش — ورودِ یک‌بارهٔ داده از سامانهٔ قبلی همه را در ماهِ ورود
 *   جمع نکند.
 * - هشدار: «این ماه کاری نفرستاده» (`quiet`) فقط وقتی است که در ماه‌های قبلِ پنجره کار داشته، این ماه
 *   هیچ، و عملِ برنامه‌ریزی‌شدهٔ آینده هم ندارد — جراحی که کارش را برای ماهِ بعد فرستاده ساکت نیست.
 * - جراح/بیمارستانِ تعریف‌نشده با نامِ متنیِ روی مراجعه شمرده می‌شود، نه دور ریخته — وگرنه همان کسی که
 *   هنوز در تعاریفِ پایه نیامده از آمار غیب می‌شد.
 */
export async function referrerStats(prisma: any, now = new Date()) {
  /* «این ماه» ماهِ **روزِ تهران** است، نه روزِ UTCِ کانتینر (DF12؛ `common/clinic-day.ts`): بی‌این، از ۰۰:۰۰ تا
     ۰۳:۳۰ِ روزِ اولِ هر ماه «این ماه» هنوز ماهِ قبل بود و جراحی که همان روز کار فرستاده بود «ساکت» دیده می‌شد. */
  const [cy, cm] = toJalali(dayUtc(clinicTodayIso(now)));
  const months: { jy: number; jm: number }[] = [];
  for (let i = REFERRER_MONTHS - 1; i >= 0; i -= 1) {
    let jy = cy;
    let jm = cm - i;
    while (jm < 1) { jm += 12; jy -= 1; }
    months.push({ jy, jm });
  }
  const from = jalaliMonthRange(months[0].jy, months[0].jm)[0];
  const end = jalaliMonthRange(cy, cm)[1];
  const visits: any[] = await prisma.visit.findMany({
    where: {
      kind: 'surgery', opStatus: { not: 'cancelled' }, patient: { deletedAt: null },
      /* `createdAt` لحظه است نه روز؛ یک روز پیش از مرز هم خوانده می‌شود و ماهش پایین‌تر با روزِ تهران تعیین می‌شود. */
      OR: [{ opDate: { gte: from } }, { opDate: null, createdAt: { gte: new Date(from.getTime() - 86_400_000), lt: end } }],
    },
    select: {
      opDate: true, createdAt: true, surgeonId: true, surgeonName: true, hospitalId: true, hospitalName: true,
      surgeon: { select: { person: { select: { firstName: true, lastName: true } } } },
      hospital: { select: { name: true } },
    },
  });
  const idx = new Map<string, number>(months.map((m, i) => [`${m.jy}/${m.jm}`, i]));
  const last = months.length - 1;

  const tally = (keyOf: (v: any) => string | null, nameOf: (v: any) => string) => {
    const rows = new Map<string, Row>();
    for (const v of visits) {
      const key = keyOf(v);
      if (!key) continue;
      const row = rows.get(key) ?? { key, name: nameOf(v), byMonth: months.map(() => 0), total: 0, upcoming: 0, lastAt: null };
      rows.set(key, row);
      /* مراجعهٔ بی‌تاریخ با **روزِ تهرانِ** ثبتش — همان قراردادِ `opDate` (نیمه‌شبِ UTCِ روزِ تقویمی؛ DF12). */
      const at: Date = v.opDate ?? dayUtc(clinicDateIso(v.createdAt));
      if (at >= end) { row.upcoming += 1; continue; }
      const i = idx.get(toJalali(at).slice(0, 2).join('/'));
      if (i === undefined) continue;
      row.byMonth[i] += 1;
      row.total += 1;
      if (!row.lastAt || at > row.lastAt) row.lastAt = at;
    }
    return [...rows.values()]
      .map((r) => ({
        ...r,
        thisMonth: r.byMonth[last],
        quiet: r.byMonth[last] === 0 && r.upcoming === 0 && r.total > 0,
      }))
      .sort((a, b) => b.total - a.total || b.upcoming - a.upcoming || a.name.localeCompare(b.name, 'fa'));
  };

  const surgeonName = (v: any) => (v.surgeon ? `${v.surgeon.person.firstName} ${v.surgeon.person.lastName}`.trim() : String(v.surgeonName ?? '').trim());
  const surgeons = tally((v) => (v.surgeonId ? `s${v.surgeonId}` : surgeonName(v) ? `t:${surgeonName(v)}` : null), surgeonName);
  const hospitalName = (v: any) => String(v.hospital?.name ?? v.hospitalName ?? '').trim();
  const hospitals = tally((v) => (v.hospitalId ? `h${v.hospitalId}` : hospitalName(v) ? `t:${hospitalName(v)}` : null), hospitalName);
  return {
    months,
    surgeons,
    hospitals,
    quietSurgeons: surgeons.filter((s) => s.quiet).map((s) => ({ key: s.key, name: s.name, lastAt: s.lastAt })),
  };
}
