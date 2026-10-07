import { storageHealth, type StorageHealth } from '../storage/storage-health';

/**
 * **آمادگیِ سامانه برای مشتریِ پولی** — آنچه مدیرِ پلتفرم پیش از فروش باید یک‌جا ببیند (گزارشِ آمادگیِ فروش،
 * بندهای ۱ و ۳). فقط **بله/نه و علت** — هیچ رازی، شماره‌ای یا مقدارِ تنظیماتی بیرون نمی‌آید.
 *
 *  - فایل‌ها: ماندگاریِ volume با شواهدِ `storage-health.ts` (سوارشدنِ جدا + دفترِ کانتینرها).
 *  - پیامک: کلید و خطِ **مشترکِ** ملی‌پیامک. همهٔ شرکت‌ها از یک جفت می‌فرستند (`SmsService`)؛ پس «تنظیم نبودن» یعنی
 *    هیچ شرکتی پیامک ندارد، نه فقط یکی — و شرکتِ تازه بی‌هیچ کارِ دستی از همین جفت می‌فرستد.
 *  - اجرا: نسخهٔ در حالِ اجرا (`SOURCE_COMMIT`ی که Coolify می‌گذارد) و زمانِ روشن‌شدن — «دیپلوی شد؟» با یک نگاه.
 *
 * ⚠️ پشتیبان‌گیری عمداً این‌جا نیست: خارج از برنامه (Coolify) انجام می‌شود و برنامه از آن چیزی نمی‌داند؛ نمایشِ یک
 * «سبز»ِ ساختگی بدترین حالت است. جایش `docs/BACKUP-RESTORE.md` و تمرینِ بازگردانی است.
 */
export interface PlatformHealth {
  storage: StorageHealth;
  sms: { configured: boolean; shared: true; message: string };
  runtime: { bootedAt: string; commit: string | null; environment: string };
}

export function smsReadiness(env: NodeJS.ProcessEnv = process.env): PlatformHealth['sms'] {
  const configured = Boolean(env.MELI_API_KEY && env.MELI_FROM);
  return {
    configured, shared: true,
    message: configured
      ? 'کلید و خطِ مشترکِ ملی‌پیامک تنظیم است؛ همهٔ شرکت‌ها از همین جفت می‌فرستند'
      : 'کلید یا خطِ ملی‌پیامک (MELI_API_KEY / MELI_FROM) در سرور تنظیم نیست — هیچ شرکتی پیامک نمی‌فرستد',
  };
}

export async function platformHealth(now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<PlatformHealth> {
  return {
    storage: await storageHealth(undefined, now),
    sms: smsReadiness(env),
    runtime: {
      bootedAt: new Date(now.getTime() - process.uptime() * 1000).toISOString(),
      commit: String(env.SOURCE_COMMIT || env.GIT_COMMIT || '').trim().slice(0, 7) || null,
      environment: env.NODE_ENV || 'development',
    },
  };
}
