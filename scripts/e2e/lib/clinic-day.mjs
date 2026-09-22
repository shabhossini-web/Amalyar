/**
 * **«امروز» برای سوییت‌ها — به وقتِ مطب، همان‌طور که سرور می‌سنجد.**
 *
 * ⚠️ باگِ واقعیِ خودِ سوییت‌ها (نه محصول): `new Date(); setUTCHours(0,0,0,0)`
 * روزِ **UTC** را می‌دهد، ولی سرور از `common/clinic-day.ts` روزِ **تهران** را
 * می‌گیرد. بینِ ۲۰:۳۰ تا ۲۴:۰۰ UTC این دو یک روز فرق دارند — یعنی هر شب یک
 * پنجرهٔ سه‌ونیم‌ساعته که سوییت‌ها بی‌دلیل قرمز می‌شوند و صبح خودبه‌خود سبز.
 * دقیقاً همان پنجره‌ای که خودِ `clinic-day` برای رفعش نوشته شد؛ سوییت‌ها فقط
 * عقب مانده بودند. (یک‌بار همین‌جا خورده شد: `w1-5` ساعتِ ۲۱:۰۰ UTC قرمز شد.)
 *
 * ⚠️ `CLINIC_TZ` خوانده می‌شود تا اگر محیطِ CI آن را عوض کرد، سوییت هم همان
 * را ببیند — وگرنه همین ناهماهنگی از راهِ دیگری برمی‌گردد.
 */
export const CLINIC_TZ = process.env.CLINIC_TZ || 'Asia/Tehran';

/** `YYYY-MM-DD`ِ امروزِ مطب. */
export const clinicTodayIso = (at = new Date(), tz = CLINIC_TZ) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/**
 * نیمه‌شبِ **UTC**ِ همان روزِ تقویمی — قراردادِ ستونِ `DATE` در کلِ ماژول.
 * (روز از تهران می‌آید، مرز از UTC؛ همان تفکیکی که `common/clinic-day.ts` دارد.)
 */
export const clinicToday = (at = new Date(), tz = CLINIC_TZ) =>
  new Date(`${clinicTodayIso(at, tz)}T00:00:00.000Z`);
