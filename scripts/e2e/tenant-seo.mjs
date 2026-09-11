/**
 * سئوی سایتِ معرفی — آن‌چه **خزنده** می‌بیند، نه مرورگر.
 *
 * چهار ادعا:
 *  ۱. **پیش از انتشار هیچ‌چیز**: هدِ عمومی فقط نامِ شرکت + `noindex`،
 *     robots یک `Disallow: /`، نقشه خالی، و پیش‌نویسِ متن‌ها اصلاً بیرون نمی‌رود.
 *  ۲. **پس از انتشار هدِ کامل**: عنوان، توضیح، canonical، og/twitter، تصویرِ
 *     پیش‌نمایشِ مطلق، و JSON-LDِ معتبر (کسب‌وکار + پرسش‌های پرتکرار).
 *  ۳. **مرزِ عمومی/خصوصی**: شناسهٔ ملی و کدِ اقتصادی در هیچ‌کدام نیست.
 *  ۴. **فرارِ متن**: نقل‌قول و تگ در متنِ ادمین نباید از attribute یا از
 *     بلوکِ JSON-LD بیرون بزند.
 *
 * پیش‌نیازها: `scripts/e2e/README.md`. متغیرها: `E2E_API` (پیش‌فرض 3009).
 */
import http from 'node:http';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const API = process.env.E2E_API ?? 'http://127.0.0.1:3009/api';

/**
 * درخواستِ خام با `Host` دلخواه.
 *
 * ⚠️ `fetch` اجازهٔ ست‌کردنِ `Host` را نمی‌دهد (هدرِ ممنوعه در undici) و بی‌صدا
 * نادیده‌اش می‌گیرد — دقیقاً همان هدری که در production تنانت را تعیین می‌کند.
 * پس این یک بررسی با `node:http` است، نه سلیقه.
 */
function rawGet(path, headers = {}) {
  const url = new URL(API + path);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: url.hostname, port: url.port, path: url.pathname + url.search, method: 'GET', headers },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, text: body, type: res.headers['content-type'] ?? '' }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}
const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? '  ok ' : 'FAIL '} ${name}${extra ? ` — ${extra}` : ''}`);
};

async function j(path, { method = 'GET', body, token, raw = false, headers = {} } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (raw) return { status: res.status, text, type: res.headers.get('content-type') ?? '' };
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

async function signup(phone, username, password) {
  const r1 = await j('/auth/signup/request-otp', { method: 'POST', body: { phone } });
  const code = r1.data?.devCode;
  if (!code) throw new Error(`devCode نیامد: ${JSON.stringify(r1.data)}`);
  const r2 = await j('/auth/signup/verify-otp', { method: 'POST', body: { phone, code } });
  const signupToken = r2.data?.signupToken;
  if (!signupToken) throw new Error(`signupToken نیامد: ${JSON.stringify(r2.data)}`);
  const selfie = 'data:image/png;base64,' + 'A'.repeat(64);
  return j('/auth/signup/complete', {
    method: 'POST',
    body: { signupToken, firstName: 'آزمون', lastName: 'کاربر', username, password, selfie },
  });
}

/** یک بلوکِ JSON-LD را از قطعهٔ head بیرون می‌کشد و پارس می‌کند. */
function ldBlocks(head) {
  const out = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(head))) {
    try { out.push(JSON.parse(m[1])); } catch { out.push({ __invalid: m[1].slice(0, 80) }); }
  }
  return out;
}

(async () => {
  // ── ① پیش از انتشار ─────────────────────────────────────────────
  const admin = await signup('09120000004', 'seoadmin', 'Passw0rd!');
  ok('ثبت‌نامِ سوپرادمین', admin.status === 201 || admin.status === 200, `status=${admin.status}`);
  const login = await j('/auth/login', { method: 'POST', body: { identifier: 'seoadmin', password: 'Passw0rd!' } });
  const token = login.data?.accessToken;
  ok('ورود و دریافتِ توکن', !!token, `status=${login.status}`);

  await j('/settings', {
    method: 'PATCH', token,
    body: {
      values: {
        brand_name: 'کلینیکِ آزمون',
        company_legal_name: 'شرکتِ درمانیِ آزمون (سهامی خاص)',
        company_national_id: '10101010101',
        company_econ_code: '411111111111',
        company_phone: '02100000000',
        company_address: 'تهران، خیابانِ آزمون، پلاک ۱',
      },
    },
  });

  const pre = await j('/public/site', {});
  ok('پیش از انتشار خاموش است', pre.data?.enabled === false, `enabled=${pre.data?.enabled}`);
  ok('پیش‌نویسِ متن‌ها بیرون نمی‌رود', Object.keys(pre.data?.blocks ?? {}).length === 0,
    `keys=${Object.keys(pre.data?.blocks ?? {}).length}`);

  const head0 = await j('/public/site/head', { raw: true });
  ok('هدِ منتشرنشده نامِ شرکت را دارد', head0.text.includes('کلینیکِ آزمون'), head0.text.trim().slice(0, 60));
  ok('هدِ منتشرنشده noindex است', head0.text.includes('content="noindex"'));
  ok('هدِ منتشرنشده og ندارد', !head0.text.includes('og:title'));

  const rob0 = await j('/public/site/robots.txt', { raw: true });
  ok('robotsِ منتشرنشده همه‌چیز را می‌بندد', /Disallow:\s*\/\s*$/m.test(rob0.text.trim()) && !rob0.text.includes('Allow:'),
    rob0.text.trim().replace(/\n/g, ' | '));

  const map0 = await j('/public/site/sitemap.xml', { raw: true });
  ok('نقشهٔ منتشرنشده خالی است', !map0.text.includes('<loc>'));

  // ── ② محتوا + انتشار ────────────────────────────────────────────
  await j('/site/blocks', {
    method: 'PATCH', token,
    body: {
      values: {
        hero_title: 'درمانی که با "آرامش" شروع می‌شود',
        seo_description: 'کلینیکِ تخصصیِ آزمون — جراحیِ سرپایی، پیگیریِ پس از عمل و <مشاوره>.',
      },
    },
  });
  const svc = await j('/site/items', { method: 'POST', token, body: { kind: 'service', title: 'جراحیِ سرپایی' } });
  ok('افزودنِ خدمت', svc.status === 201 || svc.status === 200, `status=${svc.status}`);
  const faq = await j('/site/items', {
    method: 'POST', token,
    body: { kind: 'faq', title: 'هزینهٔ ویزیت چقدر است؟', body: 'بسته به نوعِ خدمت؛ </script> هم بی‌خطر است.' },
  });
  ok('افزودنِ پرسش', faq.status === 201 || faq.status === 200, `status=${faq.status}`);

  await j('/site/publish', { method: 'PATCH', token, body: { published: true } });
  const pub = await j('/public/site', {});
  ok('سایت منتشر شد', pub.data?.enabled === true);

  // ── ③ هدِ کامل ──────────────────────────────────────────────────
  const head = await j('/public/site/head', { raw: true });
  ok('نوعِ پاسخِ هد html است', head.type.includes('text/html'), head.type);
  ok('عنوان نامِ شرکت و تیتر را دارد',
    /<title>[^<]*کلینیکِ آزمون[^<]*—[^<]*</.test(head.text), (head.text.match(/<title>[^<]*<\/title>/) ?? [''])[0]);
  ok('توضیحِ سئو در meta description است', /<meta name="description" content="[^"]*کلینیکِ تخصصی/.test(head.text));
  ok('canonical مطلق است', /<link rel="canonical" href="https?:\/\/[^"]+\/">/.test(head.text),
    (head.text.match(/<link rel="canonical"[^>]*>/) ?? [''])[0]);
  for (const tag of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:locale']) {
    ok(`تگِ ${tag} هست`, head.text.includes(`property="${tag}"`));
  }
  ok('twitter card هست', head.text.includes('name="twitter:card"'));
  ok('رنگِ برند در theme-color است', /name="theme-color" content="#[0-9a-fA-F]{3,8}"/.test(head.text));

  // ── ④ فرارِ متن ─────────────────────────────────────────────────
  ok('نقل‌قولِ تیتر از attribute بیرون نمی‌زند',
    head.text.includes('&quot;آرامش&quot;') && !/content="[^"]*"آرامش"/.test(head.text));
  ok('تگِ داخلِ توضیح فرار کرده', head.text.includes('&lt;مشاوره&gt;') && !head.text.includes('<مشاوره>'));

  // ── ⑤ JSON-LD ───────────────────────────────────────────────────
  const blocks = ldBlocks(head.text);
  ok('همهٔ بلوک‌های JSON-LD معتبرند', blocks.length >= 2 && blocks.every((b) => !b.__invalid),
    `n=${blocks.length}`);
  const org = blocks.find((b) => b['@type'] === 'MedicalClinic' || b['@type'] === 'MedicalBusiness');
  ok('بلوکِ کسب‌وکار هست', !!org, org?.['@type']);
  ok('تلفن و نشانی در بلوکِ کسب‌وکار است', org?.telephone === '02100000000' && !!org?.address?.streetAddress);
  ok('خدمت در فهرستِ خدمات آمده',
    JSON.stringify(org?.hasOfferCatalog ?? {}).includes('جراحیِ سرپایی'));
  const faqLd = blocks.find((b) => b['@type'] === 'FAQPage');
  ok('بلوکِ پرسش‌های پرتکرار هست', !!faqLd && faqLd.mainEntity?.length === 1);
  ok('«/script» داخلِ پاسخ بلوک را نمی‌بندد',
    !head.text.includes('</script> هم بی‌خطر') && head.text.includes('\\u003c/script>'));

  // ── ⑥ مرزِ عمومی/خصوصی ──────────────────────────────────────────
  const surface = head.text + (await j('/public/site/robots.txt', { raw: true })).text
    + (await j('/public/site/sitemap.xml', { raw: true })).text + JSON.stringify(pub.data);
  ok('شناسهٔ ملی در سطحِ عمومی نیست', !surface.includes('10101010101'));
  ok('کدِ اقتصادی در سطحِ عمومی نیست', !surface.includes('411111111111'));

  // ── ⑦ robots و نقشه پس از انتشار ────────────────────────────────
  const rob = await j('/public/site/robots.txt', { raw: true });
  ok('نوعِ پاسخِ robots متن است', rob.type.includes('text/plain'), rob.type);
  ok('robots اجازه می‌دهد', /^Allow:\s*\/$/m.test(rob.text));
  for (const path of ['/app', '/api', '/login', '/r/', '/f/', '/s/', '/v/', '/p/', '/o/']) {
    ok(`robots مسیرِ ${path} را می‌بندد`, rob.text.includes(`Disallow: ${path}`));
  }
  ok('robots به نقشه اشاره می‌کند', /^Sitemap:\s*https?:\/\/[^\s]+\/sitemap\.xml$/m.test(rob.text));

  const map = await j('/public/site/sitemap.xml', { raw: true });
  ok('نوعِ پاسخِ نقشه xml است', map.type.includes('xml'), map.type);
  ok('نقشه ریشهٔ دامنه را دارد', /<loc>https?:\/\/[^<]+\/<\/loc>/.test(map.text),
    (map.text.match(/<loc>[^<]*<\/loc>/) ?? [''])[0]);

  // ── ⑧ همان مسیری که nginx می‌رود: Host و طرح از هدر ──────────────
  // ⚠️ در production این سه اندپوینت را nginx صدا می‌زند، نه مرورگر. اگر
  // `Host` و `X-Forwarded-Proto` را نبینند، هر canonical و og:url به نشانیِ
  // داخلیِ کانتینر اشاره می‌کند — یعنی گوگل دامنهٔ شرکت را canonical نمی‌بیند.
  const fwd = { Host: 'clinic.localhost', 'X-Forwarded-Proto': 'https' };
  const headFwd = await rawGet('/public/site/head', fwd);
  ok('canonical از Hostِ درخواست ساخته می‌شود',
    headFwd.text.includes('href="https://clinic.localhost/"'),
    (headFwd.text.match(/<link rel="canonical"[^>]*>/) ?? [''])[0]);
  ok('og:url هم همان میزبان است', headFwd.text.includes('content="https://clinic.localhost/"'));
  const robFwd = await rawGet('/public/site/robots.txt', fwd);
  ok('نشانیِ نقشه در robots همان میزبان است',
    robFwd.text.includes('Sitemap: https://clinic.localhost/sitemap.xml'),
    (robFwd.text.match(/^Sitemap:.*$/m) ?? [''])[0]);

  // ── ⑨ همان کاری که nginx می‌کند: تزریقِ قطعه در index.html ───────
  // ⚠️ nginx در این سندباکس نیست، ولی آن‌چه می‌تواند اشتباه شود **جایگاهِ**
  // include است نه خودِ SSI: اگر بعد از <title>ِ ایستا بنشیند، مرورگر و خزنده
  // اولی را برمی‌دارند و عنوانِ شرکت هیچ‌وقت دیده نمی‌شود. پس همان جایگزینی را
  // این‌جا انجام می‌دهیم و سند را به یک مرورگرِ واقعی می‌دهیم.
  const shellPath = fs.existsSync('dist/index.html') ? 'dist/index.html' : 'index.html';
  const shell = fs.readFileSync(shellPath, 'utf8');
  const MARK = '<!--# include virtual="/_seo/head" -->';
  ok('قالبِ صفحه هنوز جای تزریق را دارد', shell.includes(MARK), shellPath);
  /* کامنت‌های توضیحی خودشان واژهٔ «title» دارند؛ برای مقایسهٔ جایگاه باید
     کنار بروند وگرنه سنجه به متنِ توضیح نگاه می‌کند نه به تگِ واقعی. */
  const bare = shell.replace(/<!--(?!#)[\s\S]*?-->/g, '');
  ok('جای تزریق پیش از عنوانِ ایستا است', bare.indexOf(MARK) >= 0 && bare.indexOf(MARK) < bare.indexOf('<title>'),
    `mark=${bare.indexOf(MARK)} title=${bare.indexOf('<title>')}`);

  /* فقط اسکریپت‌های خارجیِ اپ حذف می‌شوند — بلوک‌های JSON-LD باید بمانند،
     چون دقیقاً همان چیزی‌اند که می‌خواهیم در سند بشماریم. */
  const composed = shell.replace(MARK, head.text).replace(/<script[^>]*\ssrc=[^>]*><\/script>/g, '');
  const browser = await chromium.launch({
    executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setContent(composed, { waitUntil: 'domcontentloaded' });
  const seen = await page.evaluate(() => ({
    title: document.title,
    desc: document.querySelector('meta[name="description"]')?.content ?? '',
    ogTitle: document.querySelector('meta[property="og:title"]')?.content ?? '',
    canonical: document.querySelector('link[rel="canonical"]')?.href ?? '',
    ld: [...document.querySelectorAll('script[type="application/ld+json"]')].length,
  }));
  await browser.close();
  ok('مرورگر عنوانِ شرکت را می‌بیند، نه عنوانِ عمل‌یار',
    seen.title.includes('کلینیکِ آزمون') && !seen.title.includes('عمل‌یار'), seen.title);
  ok('توضیحِ شرکت بر توضیحِ ایستا می‌چربد', seen.desc.includes('کلینیکِ تخصصی'), seen.desc.slice(0, 50));
  ok('og:title شرکت است', seen.ogTitle.includes('کلینیکِ آزمون'), seen.ogTitle);
  ok('canonical در سند هست', seen.canonical.endsWith('/'), seen.canonical);
  ok('بلوک‌های دادهٔ ساخت‌یافته در سند هستند', seen.ld >= 2, `n=${seen.ld}`);

  // ── ⑩ خلاصه ─────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.pass);
  console.log(failed.length ? `\n✗ ${failed.length} FAIL از ${results.length}` : `\n✓ ALL PASS — ${results.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e); process.exit(1); });
