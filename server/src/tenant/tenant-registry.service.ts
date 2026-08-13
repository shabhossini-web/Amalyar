import { Injectable, Logger } from '@nestjs/common';
import { ControlPrismaService } from './control-prisma.service';
import { decryptDatabaseUrl } from './tenant-crypto';

/**
 * میزبان‌هایی که «توسعهٔ محلی» به‌حساب می‌آیند.
 *
 * ⚠️ این فهرست تنها چیزی است که پیش‌فرضِ توسعه را از یک نشتِ بین‌شرکتی جدا
 * می‌کند — پس عمداً تنگ است: فقط loopback. هر دامنهٔ واقعی، حتی روی ماشینِ
 * توسعه، باید در `tenant_domains` ثبت شده باشد.
 */
const LOOPBACK_HOST = /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[?::1\]?|0\.0\.0\.0)$/;

@Injectable()
export class TenantRegistryService {
  private readonly log = new Logger(TenantRegistryService.name);
  constructor(private readonly control: ControlPrismaService) {}

  async resolveHostname(hostname: string) {
    const domain = await this.control.tenantDomain.findUnique({
      where: { hostname },
      include: { tenant: true },
    });
    if (!domain || domain.tenant.status !== 'active') return null;
    return {
      tenantId: domain.tenant.id,
      tenantSlug: domain.tenant.slug,
      databaseUrl: decryptDatabaseUrl(domain.tenant.databaseUrlEncrypted),
    };
  }

  /**
   * پیش‌فرضِ توسعه — تا روی `localhost` بشود بدونِ ثبتِ دامنه کار کرد.
   *
   * ⚠️ **این خطرناک‌ترین تابعِ کلِ پروژه است و عمداً fail-closed شد.**
   * تا دیروز تنها نگهبانش `NODE_ENV !== 'production'` بود، یعنی: هر Hostی که
   * در `tenant_domains` **پیدا نشود** بی‌سروصدا دیتابیسِ تنانتِ پیش‌فرض را
   * می‌گرفت. اگر روزی `NODE_ENV` در Coolify بازنویسی می‌شد یا اپ بیرونِ ایمیج
   * اجرا می‌شد، دامنهٔ شرکتِ ب — که هنوز ثبت نشده — **پروندهٔ بیمارانِ شرکتِ
   * الف** را نشان می‌داد. نه خطایی، نه لاگی؛ دقیقاً همان چیزی که کاربر
   * گزارشش کرد («تنانت‌ها از دیتابیسِ هم می‌خوانند»).
   *
   * حالا سه قفل روی هم است و هر سه باید باز باشند:
   *  ۱. `NODE_ENV` نباید production باشد،
   *  ۲. `DEFAULT_TENANT_SLUG` صریحاً ست شده باشد،
   *  ۳. **میزبانِ درخواست loopback باشد** — یک دامنهٔ واقعی هرگز، حتی روی
   *     ماشینِ توسعه. قفلِ سوم همان چیزی است که «پیکربندیِ اشتباه» را از
   *     «نشتِ دادهٔ پزشکی» جدا می‌کند.
   *
   * و هر بار که این مسیر اجرا شود **لاگ می‌شود**: بازگشتی که بی‌صدا باشد،
   * روزی که غلط عمل کند هم بی‌صدا خواهد بود.
   */
  async resolveDevelopmentDefault(hostname: string) {
    const slug = process.env.DEFAULT_TENANT_SLUG;
    if (!slug || process.env.NODE_ENV === 'production') return null;
    if (hostname && !LOOPBACK_HOST.test(hostname)) {
      this.log.warn(`میزبانِ «${hostname}» در tenant_domains نیست و loopback هم نیست — پیش‌فرضِ توسعه اعمال نشد.`);
      return null;
    }
    const tenant = await this.control.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status !== 'active') return null;
    this.log.warn(`پیش‌فرضِ توسعه: میزبانِ «${hostname || '—'}» به شرکتِ «${slug}» نگاشت شد. در production این مسیر بسته است.`);
    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      databaseUrl: decryptDatabaseUrl(tenant.databaseUrlEncrypted),
    };
  }
}
