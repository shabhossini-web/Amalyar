/**
 * «ساعتِ سکوتِ پیامک» — یادآوری‌های خودکارِ بیماران در شب نمی‌روند و تا پایانِ بازه در صف می‌مانند.
 *
 * تصمیمِ مالک (۱۴۰۵/۰۸/۰۳، ساعتِ ۲ بامداد، هنگامِ آزمودنِ پیامِ مراقبت): روشن با پیش‌فرضِ ۲۱ تا ۸؛ دکمه‌های دستیِ «ارسالِ دوباره»
 * و «ارسالِ سررسیده‌ها» می‌فرستند (کارمند عمداً می‌خواهد)؛ کدِ تأییدِ ورود و ابلاغِ برنامهٔ روزِ کارشناسان هرگز مسدود نمی‌شوند.
 *
 * خالص و بی‌Prisma. پیش‌فرض‌ها این‌جا یک‌بار نوشته می‌شوند و `settings-registry.ts` همین‌ها را می‌خواند — دو کپی از هم می‌افتادند.
 * ساعت به وقتِ کلینیک (`CLINIC_TZ`) است، نه ساعتِ سرور (سرور UTC است؛ ۲۱ تا ۸ تهران = ۱۷:۳۰ تا ۰۴:۳۰ UTC).
 */
import { CLINIC_TZ } from '../common/clinic-day';

export const QUIET_KEYS = ['sms_quiet_on', 'sms_quiet_from', 'sms_quiet_to'] as const;
export const QUIET_DEFAULT = { on: true, from: 21, to: 8 } as const;

export interface QuietConfig { on: boolean; from: number; to: number }

const hourInt = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
};

/** از ردیف‌های خامِ `settings` (کلید ← مقدارِ رشته). ردیفِ نبوده = پیش‌فرض؛ مقدارِ خراب = پیش‌فرضِ همان فیلد. */
export function parseQuiet(rows: Iterable<{ key: string; value: string }> | null | undefined): QuietConfig {
  const m = new Map<string, string>();
  for (const r of rows ?? []) m.set(r.key, r.value);
  const on = m.has('sms_quiet_on') ? m.get('sms_quiet_on') === 'true' : QUIET_DEFAULT.on;
  return { on, from: hourInt(m.get('sms_quiet_from'), QUIET_DEFAULT.from), to: hourInt(m.get('sms_quiet_to'), QUIET_DEFAULT.to) };
}

const hourFmt = new Map<string, Intl.DateTimeFormat>();
/** ساعتِ ۰..۲۳ در منطقهٔ زمانیِ کلینیک. فرمترِ هر منطقه یک‌بار ساخته می‌شود (`Intl` گران است). */
export function clinicHour(at: Date = new Date(), tz: string = CLINIC_TZ): number {
  let f = hourFmt.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }); hourFmt.set(tz, f); }
  return Number(f.format(at)) % 24;
}

/** آیا همین ساعت در بازهٔ سکوت است؟ بازه از نیمه‌شب رد می‌شود (۲۱ تا ۸)؛ `from === to` یعنی بازه‌ای نیست. */
export function inQuiet(cfg: QuietConfig, at: Date = new Date()): boolean {
  if (!cfg.on || cfg.from === cfg.to) return false;
  const h = clinicHour(at);
  return cfg.from < cfg.to ? h >= cfg.from && h < cfg.to : h >= cfg.from || h < cfg.to;
}
