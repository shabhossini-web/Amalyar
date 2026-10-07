import { PrismaClient } from '@prisma/client';
import { DEFAULT_VERTICAL } from '../config/verticals';
import { applyProfileFeatures } from '../features/features.service';
import { profileError, profileOf, profileSettingRows, requestedProfile, type TenantKind } from '../config/tenant-profile';

/**
 * بستهٔ خدماتِ ذخیره‌شده در `provisioning_jobs.profile_services` (JSON) → آرایه. هر چیزِ ناخوانا «خالی»
 * است؛ `profileError` بعدش تصمیم می‌گیرد که برای این نوع خالی مجاز است یا نه.
 */
export function parseProfileServices(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** اعتبارسنجیِ پروفایلِ یک کار — خطای فنیِ ثابت (نه متنِ کاربر)؛ Worker همین را به `INVALID_PROFILE` می‌بندد. */
export function assertJobProfile(kind: string | null | undefined, servicesRaw: string | null | undefined) {
  if (!kind) return;
  if (profileError(kind, parseProfileServices(servicesRaw))) throw new Error('INVALID_PROFILE');
}

/**
 * نوعِ نصب را روی دیتابیسِ **تازه‌ساخته** می‌نویسد (پس از migration و پیش از اولین درخواست).
 *
 * دو کار در **یک تراکنش**: (۱) ردیف‌های `settings` (`vertical` و برای شرکت `services`)؛ (۲) گذارِ ماژول‌ها از
 * پروفایلِ پیش‌فرضِ نصب به پروفایلِ درخواستی (`applyProfileFeatures` — همان تابعی که «ذخیره» در تنظیماتِ شرکت
 * صدایش می‌زند). بدونِ (۲)، ردیف‌هایی که خودِ migrationها ساخته‌اند (مثلِ `waitlist` که در لحظهٔ migration
 * خاموش است) با نوعِ پیش‌فرض می‌ماندند و مطبِ تازه «فهرستِ انتظار» نداشت.
 *
 * ⚠️ **فقط روی دیتابیسِ بکر** (بی‌حساب؛ وگرنه `TENANT_NOT_FRESH`). upsert/گذارِ idempotent است تا اجرای دوباره (تلاشِ
 * مجدد پس از شکست) بی‌خطر بماند. کلاینتِ tenant همین‌جا
 * ساخته و بسته می‌شود؛ Worker هیچ‌جا به دیتابیسِ شرکتی وصلِ دائمی نیست.
 */
export async function seedTenantProfile(databaseUrl: string, kind: string, servicesRaw: string | null | undefined) {
  const services = parseProfileServices(servicesRaw);
  assertJobProfile(kind, servicesRaw);
  const after = requestedProfile(kind as TenantKind, services);
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    /* فقط دیتابیسِ **بکر**: «قبل = پیش‌فرضِ نصب» فقط وقتی راست است که هنوز کسی ماژول‌ها را عوض نکرده. روی نصبِ
       زنده (حساب دارد) این تابع ردیف‌ها را به‌اشتباه جابه‌جا می‌کرد — آنجا راهِ درست «ذخیره» در تنظیماتِ خودِ شرکت است. */
    if ((await client.account.count()) > 0) throw new Error('TENANT_NOT_FRESH');
    await client.$transaction(async (tx) => {
      /* «قبل» = آنچه نصبِ تازه بدونِ این کار می‌بود: حوزهٔ پیش‌فرض و بی‌ردیفِ خدمات. اگر اجرا تکراری باشد و
         ردیف‌ها پیش‌تر نوشته شده باشند، `featureChanges` فقط اختلافِ واقعی را می‌بیند. */
      const before = profileOf(DEFAULT_VERTICAL, null);
      for (const row of profileSettingRows(kind as TenantKind, services)) {
        await tx.setting.upsert({ where: { key: row.key }, create: row, update: { value: row.value } });
      }
      if (after.kind === 'clinic') await tx.setting.deleteMany({ where: { key: 'services' } });
      await applyProfileFeatures(tx, before, after);
    });
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}
