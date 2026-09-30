import { toJalali } from '../common/jalali';
import { CLINIC_TZ, clinicDateIso, dayUtc } from '../common/clinic-day';

/**
 * **«کِی بیایم؟» به زبانِ بیمار** — روزِ هفته + روز + ماه + سال و ساعت، با رقمِ فارسی، به وقتِ مطب.
 *
 * صفحه‌های بیمار (پرتال، پایانِ فرم) باید تاریخ را همان‌طور بگویند که منشی پشتِ تلفن می‌گوید:
 * «چهارشنبه ۸ مهر ۱۴۰۵، ساعت ۱۸:۰۰» — نه «۱۴۰۵/۰۷/۰۸» بی‌ساعت (بازبینیِ UX، بندهای ۱۰۰ و ۱۰۲).
 * ⚠️ `Intl`ِ `fa-IR` در Node ترتیبِ «۱۴۰۵ مهر ۸, چهارشنبه» با ویرگولِ لاتین می‌دهد؛ پس دستی ساخته می‌شود.
 */
const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

export const faDigits = (s: string | number) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);

/** «چهارشنبه ۸ مهر ۱۴۰۵» — روزِ تقویمیِ **مطب** همان لحظه. */
export function faDayLong(at: Date): string {
  const day = dayUtc(clinicDateIso(at));
  const [jy, jm, jd] = toJalali(day);
  return `${WEEKDAYS[(day.getUTCDay() + 1) % 7]} ${faDigits(jd)} ${MONTHS[jm - 1]} ${faDigits(jy)}`;
}

/** «۱۸:۰۰» از «18:00». */
export const faClock = (hhmm: string) => faDigits(hhmm);

const HHMM = new Intl.DateTimeFormat('en-GB', { timeZone: CLINIC_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/**
 * ساعتِ یک مراجعه («18:00») یا `null`:
 * ساعتِ شروعِ عمل (`opStartTime`، ساعتِ دیوارِ اتاقِ عمل) ← ساعتِ نوبتِ وصل‌شده (`startMin`) ← خودِ
 * `opDate` وقتی ساعت دارد. ⚠️ نیمه‌شبِ UTC یعنی «فقط تاریخ» (قراردادِ ذخیرهٔ روزِ بی‌ساعت)، نه ۰۳:۳۰ِ تهران.
 */
export function visitClock(v: { opStartTime?: string | null; opDate?: Date | null; appointment?: { startMin?: number | null } | null }): string | null {
  if (v.opStartTime && /^\d{1,2}:\d{2}$/.test(v.opStartTime)) return v.opStartTime.padStart(5, '0');
  const m = v.appointment?.startMin;
  if (m != null) return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  if (v.opDate && (v.opDate.getUTCHours() !== 0 || v.opDate.getUTCMinutes() !== 0)) return HHMM.format(v.opDate);
  return null;
}
