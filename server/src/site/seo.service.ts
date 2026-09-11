import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { SettingsService } from '../config/settings.service';
import { SiteService } from './site.service';

/**
 * سئوی سایتِ معرفی — چیزی که **خزنده** می‌بیند، نه مرورگر.
 *
 * ⚠️ چرا سمتِ سرور: اپ یک SPAست و `<title>`/`description` را JS ست می‌کند.
 * گوگل JS اجرا می‌کند پس معمولاً درست می‌بیند، ولی خزندهٔ **پیش‌نمایشِ لینک**
 * (واتساپ، تلگرام، ایتا، بله، لینکدین) هرگز JS اجرا نمی‌کند. بدونِ این ماژول،
 * لینکِ دامنهٔ هر شرکت با نام و توضیحِ *عمل‌یار* پیش‌نمایش می‌شد — یعنی هر
 * مشتریِ ما تبلیغِ فروشندهٔ نرم‌افزارش را برای بیمارانش می‌فرستاد.
 *
 * خروجی‌ها قطعه‌های متنی‌اند نه JSON، چون مصرف‌کننده‌شان nginx است (SSI) و
 * خزنده‌ها، نه کلاینتِ React.
 */
@Injectable()
export class SeoService {
  constructor(
    private site: SiteService,
    private settings: SettingsService,
    private config: ConfigService,
  ) {}

  /** ریشهٔ مطلقِ همین درخواست — og:image و canonical نشانیِ نسبی نمی‌پذیرند. */
  private origin(host: string, proto: string) {
    return `${proto}://${host}`;
  }

  /**
   * فرارِ متن در HTML.
   *
   * ⚠️ متن‌ها را **ادمینِ شرکت** می‌نویسد و مستقیم داخلِ `content="…"` می‌نشیند؛
   * بدونِ فرار، یک `"` در تیتر کافی است تا از attribute بیرون بزند.
   */
  private esc(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * JSON-LD امن.
   *
   * ⚠️ `JSON.stringify` تنها `</script>` را خنثی نمی‌کند — یک `</script>` در
   * متنِ یک پرسشِ پرتکرار بلوک را می‌بندد و بقیه‌اش HTMLِ اجراشدنی می‌شود.
   */
  private ld(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, ' ');
  }

  private clean(value: unknown, max: number): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  /**
   * قطعهٔ `<head>` برای همین میزبان.
   *
   * ⚠️ باید **اولین** چیزِ داخلِ `<head>` تزریق شود: مرورگر و هر خزنده‌ای
   * نخستین `<title>` و نخستین `og:*` را برمی‌دارد، پس فقط در این صورت مقدارِ
   * شرکت بر مقدارِ ایستای عمل‌یار می‌چربد. اگر بک‌اند در دسترس نباشد قطعه
   * خالی می‌ماند و همان هدِ ایستا سرِ جایش است — خرابیِ نرم، نه صفحهٔ سفید.
   */
  async head(host: string, proto: string): Promise<string> {
    const view = await this.site.publicView();
    const brand = view.brand;
    const name = this.clean(brand.name || brand.legalName, 120);
    const origin = this.origin(host, proto);

    /* شرکتی که هنوز منتشر نکرده، ریشهٔ دامنه‌اش فرمِ ورود است. عنوان باید نامِ
       خودش باشد نه نامِ عمل‌یار، ولی نه توضیح می‌خواهد نه og و نه JSON-LD. */
    if (!view.enabled) {
      return name ? `<title>${this.esc(name)}</title>\n<meta name="robots" content="noindex">\n` : '';
    }

    const blocks = view.blocks as Record<string, string>;
    const tagline = this.clean(blocks.hero_title, 90);
    const title = name ? (tagline ? `${name} — ${tagline}` : name) : tagline;
    const desc = this.clean(blocks.seo_description || blocks.hero_sub, 300);
    const image = this.coverUrl(view, origin);

    const out: string[] = [];
    out.push(`<title>${this.esc(title)}</title>`);
    if (desc) out.push(`<meta name="description" content="${this.esc(desc)}">`);
    out.push(`<link rel="canonical" href="${this.esc(origin)}/">`);
    out.push(`<meta property="og:type" content="website">`);
    out.push(`<meta property="og:site_name" content="${this.esc(name)}">`);
    out.push(`<meta property="og:title" content="${this.esc(title)}">`);
    if (desc) out.push(`<meta property="og:description" content="${this.esc(desc)}">`);
    out.push(`<meta property="og:url" content="${this.esc(origin)}/">`);
    out.push(`<meta property="og:locale" content="fa_IR">`);
    if (image) out.push(`<meta property="og:image" content="${this.esc(image)}">`);
    /* یک قاعده بدونِ استثنا: هر مقدارِ داخلِ attribute از esc رد می‌شود، حتی
       ثابت‌های خودمان. استثنا یعنی روزی کسی متغیرِ کاربر را هم بی‌فرار بگذارد. */
    const card = image ? 'summary_large_image' : 'summary';
    out.push(`<meta name="twitter:card" content="${this.esc(card)}">`);
    out.push(`<meta name="twitter:title" content="${this.esc(title)}">`);
    if (desc) out.push(`<meta name="twitter:description" content="${this.esc(desc)}">`);
    if (image) out.push(`<meta name="twitter:image" content="${this.esc(image)}">`);
    out.push(`<meta name="theme-color" content="${this.esc(brand.color)}">`);

    for (const block of await this.jsonLd(view, origin, { name, desc, image })) {
      out.push(`<script type="application/ld+json">${block}</script>`);
    }
    return out.join('\n') + '\n';
  }

  /**
   * تصویرِ پیش‌نمایش — نخستین تصویرِ واقعیِ همین سایت.
   *
   * ترتیب عمدی است: نمونه‌کار بهترین ویترین است، بعد چهرهٔ تیمِ درمان، بعد
   * خدمت. اسلاتِ تصویرِ اختصاصی نساختیم چون یعنی یک فیلدِ دیگر در ویرایشگر که
   * اغلب خالی می‌ماند و همین‌جا دوباره به همین fallback می‌رسیدیم.
   */
  private coverUrl(view: any, origin: string): string | null {
    for (const kind of ['gallery', 'doctor', 'service', 'stat', 'process']) {
      for (const item of view.items?.[kind] ?? []) {
        if (item.image) return `${origin}/api${item.image}`;
      }
    }
    return null;
  }

  /**
   * دادهٔ ساخت‌یافته.
   *
   * نوعِ کسب‌وکار از حوزهٔ کاری می‌آید: مطب یک `MedicalClinic` است ولی شرکتِ
   * نورومانیتورینگ یا تأمین‌کنندهٔ ایمپلنت بیمار را پذیرش نمی‌کند — برچسبِ
   * کلینیک روی آن‌ها دادهٔ نادرست به گوگل می‌دهد، نه «سئوی بیشتر».
   */
  private async jsonLd(view: any, origin: string, meta: { name: string; desc: string; image: string | null }) {
    const vertical = await this.config.vertical();
    const brand = view.brand;
    const blocks = view.blocks as Record<string, string>;
    const out: string[] = [];

    const org: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': vertical === 'clinic' ? 'MedicalClinic' : 'MedicalBusiness',
      name: meta.name,
      url: `${origin}/`,
      ...(meta.desc ? { description: meta.desc } : {}),
      ...(meta.image ? { image: meta.image } : {}),
      ...(brand.legalName && brand.legalName !== meta.name ? { legalName: this.clean(brand.legalName, 160) } : {}),
      ...(brand.phone ? { telephone: this.clean(brand.phone, 40) } : {}),
      ...(brand.address
        ? { address: { '@type': 'PostalAddress', addressCountry: 'IR', streetAddress: this.clean(brand.address, 300) } }
        : {}),
    };
    const services = (view.items?.service ?? []).map((s: any) => this.clean(s.title, 120)).filter(Boolean);
    if (services.length) {
      org.hasOfferCatalog = {
        '@type': 'OfferCatalog',
        name: this.clean(blocks.services_title, 120) || 'خدمات',
        itemListElement: services.slice(0, 30).map((title: string) => ({
          '@type': 'Offer', itemOffered: { '@type': 'Service', name: title },
        })),
      };
    }
    out.push(this.ld(org));

    /* پرسش‌های پرتکرار از قبل ساخت‌یافته‌اند — تبدیلشان به FAQPage تقریباً
       مجانی است و همان چیزی است که در نتیجهٔ جستجو آکاردئون می‌شود. */
    const faq = (view.items?.faq ?? [])
      .map((f: any) => ({ q: this.clean(f.title, 300), a: this.clean(f.body || f.subtitle, 1200) }))
      .filter((f: any) => f.q && f.a);
    if (faq.length) {
      out.push(this.ld({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faq.slice(0, 30).map((f: any) => ({
          '@type': 'Question', name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      }));
    }
    return out;
  }

  /**
   * robots.txt
   *
   * ⚠️ سایتِ منتشرنشده باید **کاملاً** بسته باشد: ریشهٔ دامنه آن‌جا فرمِ ورود
   * است و ایندکس‌شدنِ فرمِ ورودِ یک شرکت نه به خودش کمک می‌کند نه به کسی.
   */
  async robots(host: string, proto: string): Promise<string> {
    const origin = this.origin(host, proto);
    if (!(await this.site.publicView()).enabled) {
      return 'User-agent: *\nDisallow: /\n';
    }
    return [
      'User-agent: *',
      'Allow: /',
      /* مسیرهای پشتِ لاگین و API هیچ‌وقت محتوای قابلِ ایندکس ندارند؛ خزیدنشان
         فقط بودجهٔ خزشِ دامنه را می‌سوزاند. */
      'Disallow: /app',
      'Disallow: /api',
      'Disallow: /login',
      /* لینک‌های توکن‌دارِ بیمار — ثبت‌نام، فرم، نظرسنجی، خلاصهٔ ویزیت، پرونده،
         سفارش. اگر جایی لو بروند نباید در نتیجهٔ جستجو هم بنشینند. */
      'Disallow: /r/', 'Disallow: /f/', 'Disallow: /s/',
      'Disallow: /v/', 'Disallow: /p/', 'Disallow: /o/',
      '',
      `Sitemap: ${origin}/sitemap.xml`,
      '',
    ].join('\n');
  }

  /** نقشهٔ سایت — امروز یک صفحه است؛ با آمدنِ صفحهٔ هر خدمت این‌جا رشد می‌کند. */
  async sitemap(host: string, proto: string): Promise<string> {
    const origin = this.origin(host, proto);
    const view = await this.site.publicView();
    const urls = view.enabled ? [`${origin}/`] : [];
    const body = urls.map((loc) => `  <url><loc>${this.esc(loc)}</loc><changefreq>weekly</changefreq></url>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}${body ? '\n' : ''}</urlset>\n`;
  }
}
