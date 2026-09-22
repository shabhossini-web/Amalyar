import { BadRequestException } from '@nestjs/common';
import { jalaliMonthRange, toJalali } from '../common/jalali';

/**
 * **شمارشِ روزهای یک ماهِ شمسی — خوراکِ نشانهٔ تقویمِ انتخابِ تاریخ.**
 *
 * بازخوردِ مالک ۱۴۰۵/۰۶/۳۱: «تقویم‌ها که تو میز پزشک و منشی و پذیرش و اتاق
 * عمل تاریخ انتخاب می‌کنیم باید روی تاریخ‌ها یه علامتی مثل تقویمِ عمل باشه که
 * کاربر موقعِ انتخابِ تاریخ بتونه ویوِ کلی رو درست ببینه.»
 *
 * تا امروز انتخابگرِ تاریخ (`JDate`) هیچ‌چیز از شلوغیِ روز نمی‌دانست: کاربر
 * تاریخ را کورکورانه می‌زد و تازه بعدش می‌فهمید آن روز خالی است یا پُر.
 *
 * ⚠️ **فقط شمارش برمی‌گردد، نه ردیف‌ها.** `CalendarService.month` کلِ سطرها را
 * با نامِ بیمار و جراح می‌آورد؛ آن برای صفحهٔ تقویم درست است ولی برای یک
 * پاپ‌آپِ انتخابِ تاریخ یعنی کشیدنِ صدها ردیف برای نشان‌دادنِ چند عدد — و
 * بدتر، رساندنِ نامِ بیمار به میزی که شاید اجازهٔ دیدنش را ندارد.
 *
 * ⚠️ بازهٔ ماه روی **تقویمِ شمسی** بریده می‌شود نه میلادی (همان استدلالِ
 * `CalendarService`): «شهریورِ ۱۴۰۵» وسطِ دو ماهِ میلادی می‌افتد و بریدنِ
 * میلادی چند روزِ سر و ته را بی‌صدا می‌اندازد.
 *
 * ⚠️ دامنه را **فراخوان** می‌دهد، نه این تابع: میزِ اتاقِ عمل فقط عمل‌های
 * خودش را می‌شمارد و میزِ پذیرش نوبت‌های روز را. یک تابع با دو `where`،
 * به‌جای دو شمارندهٔ جدا که با اولین تغییرِ فیلتر از هم دور می‌افتند.
 */
export async function monthDayCounts(
  prisma: any,
  jy: number,
  jm: number,
  opts: { visitWhere?: any; apptWhere?: any } = {},
) {
  if (!Number.isInteger(jy) || jy < 1300 || jy > 1500) throw new BadRequestException('سالِ نامعتبر');
  if (!Number.isInteger(jm) || jm < 1 || jm > 12) throw new BadRequestException('ماهِ نامعتبر');
  const [from, to] = jalaliMonthRange(jy, jm);

  const [visits, appts] = await Promise.all([
    opts.visitWhere
      ? prisma.visit.findMany({
        where: { ...opts.visitWhere, opDate: { gte: from, lt: to } },
        select: { opDate: true },
      })
      : Promise.resolve([] as { opDate: Date | null }[]),
    opts.apptWhere
      ? prisma.appointment.findMany({
        where: { ...opts.apptWhere, date: { gte: from, lt: to } },
        select: { date: true },
      })
      : Promise.resolve([] as { date: Date }[]),
  ]);

  const days = new Map<number, { day: number; visits: number; appointments: number }>();
  const bump = (when: Date | null, key: 'visits' | 'appointments') => {
    if (!when) return;
    const [, , jd] = toJalali(when);
    const row = days.get(jd) ?? { day: jd, visits: 0, appointments: 0 };
    row[key] += 1;
    days.set(jd, row);
  };
  for (const v of visits) bump(v.opDate, 'visits');
  for (const a of appts) bump(a.date, 'appointments');

  return {
    year: jy,
    month: jm,
    /* فقط روزهایی که چیزی دارند — روزِ خالی عددِ صفر نمی‌خواهد و فرستادنش
       payload را سه برابر می‌کند بی‌آنکه چیزی بگوید. */
    days: [...days.values()].sort((a, b) => a.day - b.day),
  };
}
