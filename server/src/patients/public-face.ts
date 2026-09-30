import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../config/settings.service';
import { DEFAULT_VERTICAL, isVertical } from '../config/verticals';

/**
 * **«این صفحه مالِ کدام مطب است»** — تک‌منبعِ هویتِ شرکت روی صفحه‌های بی‌احرازِ بیمار
 * (ثبت‌نام، فرم، پرونده، خلاصه، و صفحهٔ خطای هر کدام).
 *
 * ⚠️ فقط همان پنج فیلدی که پرونده و خلاصه از قبل بیرون می‌دادند (نام، لوگو، رنگ، تلفن،
 * نشانی) — نه `settings.brand()`ِ کامل که شناسهٔ ملی و کدِ اقتصادیِ فاکتورِ رسمی را هم
 * دارد. لینکِ این صفحه‌ها در پیامک و بیوی اینستاگرام می‌رود.
 *
 * `vertical` برای تم است: صفحه‌های بیمار بیرونِ `ConfigProvider` رندر می‌شوند (دیگر
 * `/config`ِ پشتِ احراز را صدا نمی‌زنند) و پیش‌فرضِ «مطب روشن، بقیه تیره» را از همین
 * می‌گیرند — تا دیروز بیمارِ مطب صفحهٔ تیرهٔ بنفشِ پیش‌فرض را می‌دید و کارکنان روشن
 * (بازبینیِ UX، بندِ ۹۴).
 *
 * تابعِ آزاد است نه متدِ یک سرویس: `PortalService` و `SummaryService` هر دو لازمش دارند و
 * `portal.service` از قبل از `summary.service` ایمپورت می‌کند — متد روی یکی یعنی چرخه.
 */
export async function publicFaceOf(settings: SettingsService, prisma: PrismaService) {
  const [brand, row] = await Promise.all([
    settings.brand(),
    prisma.setting.findUnique({ where: { key: 'vertical' }, select: { value: true } }),
  ]);
  return {
    brand: {
      name: brand.name, phone: brand.phone, address: (brand as any).address ?? null, color: brand.color,
      logo: (brand as any).logo ?? null,
    },
    vertical: isVertical(row?.value) ? row!.value : DEFAULT_VERTICAL,
  };
}
