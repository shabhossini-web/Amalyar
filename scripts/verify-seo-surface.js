/**
 * نگهبانِ سطحِ سئوی سایتِ معرفی — ایستا، بی‌سرور، برای CI.
 *
 * ⚠️ عمداً فایلِ جدا است نه `node -e` داخلِ YAML (مثلِ `verify-tenant-isolation.js`):
 * این بررسی‌ها پر از `$` و `{}` و نقل‌قول‌اند و همان‌ها یک‌بار داخلِ رشتهٔ bash
 * بی‌سروصدا تفسیر شدند و نگهبان چیزی جز خودش را نسنجید.
 *
 * اجرا از ریشهٔ مخزن:  node scripts/verify-seo-surface.js
 */
import fs from 'node:fs';
const read = (p) => fs.readFileSync(p, 'utf8');
/* ⚠️ کامنت‌ها پیش از هر تطبیق برداشته می‌شوند — همان تلهٔ بندهای بالا:
   نثرِ توضیحیِ خودِ فایل بارها به‌جای کد سنجیده شده است. */
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const die = (m) => { console.error(m); process.exit(1); };

/* ① جای تزریق باید در قالب باشد و **پیش از** عنوانِ ایستا. مرورگر و خزنده
   نخستین title را برمی‌دارند؛ یک جابه‌جاییِ ساده یعنی عنوانِ هر شرکت دوباره
   «عمل‌یار» می‌شود و هیچ تستی هم قرمز نمی‌شود. */
const MARK = '<!--# include virtual="/_seo/head" -->';
const shell = read('index.html');
if (!shell.includes(MARK)) die('index.html جای تزریقِ سئو را ندارد');
const bare = shell.replace(/<!--(?!#)[\s\S]*?-->/g, '');
if (!(bare.indexOf(MARK) < bare.indexOf('<title>'))) die('تزریقِ سئو باید پیش از عنوانِ ایستا بنشیند');

/* ② nginx: SSI فقط روی ریشه، نشانیِ بک‌اند متغیر (وگرنه نبودنِ بک‌اند کلِ
   فرانت را بالا نمی‌آورد)، Host دست‌نخورده (tenant از همان حل می‌شود)، و
   fallbackِ ایستا برای میزبانی که tenant نیست. */
const ngx = read('nginx.conf.template');
for (const need of ['ssi on;', 'ssi_silent_errors on;', 'resolver ', 'set $api_root', 'location @seo_static'])
  if (!ngx.includes(need)) die('nginx.conf.template بندِ «' + need + '» را ندارد');
if (/proxy_pass\s+http:\/\/[a-z]/i.test(ngx)) die('نشانیِ upstream نباید ثابت باشد — nginx آن را هنگامِ استارت resolve می‌کند');
for (const loc of ['/_seo/head', '/robots.txt', '/sitemap.xml']) {
  const i = ngx.indexOf('location = ' + loc);
  if (i < 0) die('nginx مسیرِ ' + loc + ' را ندارد');
  const block = ngx.slice(i, ngx.indexOf('\n  }', i));
  if (!block.includes('proxy_set_header Host $host;')) die('مسیرِ ' + loc + ' باید Host را دست‌نخورده بفرستد');
  if (!block.includes('X-Forwarded-Proto')) die('مسیرِ ' + loc + ' باید طرحِ بیرونی را بفرستد');
  /* `API_UPSTREAM` می‌تواند نشانیِ https باشد (وقتی دو کانتینر شبکهٔ مشترک
     ندارند). بدونِ SNI پراکسیِ بیرونی نمی‌داند کدام گواهی را بدهد و دست‌دادنِ
     TLS بی‌صدا می‌شکند. */
  if (!block.includes('proxy_ssl_server_name on;')) die('مسیرِ ' + loc + ' برای upstreamِ https به SNI نیاز دارد');
  /* ⚠️ باگِ واقعیِ روی سرور: `rewrite` مقدارِ `$uri` را عوض می‌کند، پس هر
     locationی که rewrite دارد و fallback می‌خواهد باید مسیرِ اصلی را **پیش
     از** rewrite در متغیرِ خودش نگه دارد. بدونِ این، fallback دنبالِ مسیرِ
     API روی دیسک می‌گشت و ۴۰۴ خامِ nginx می‌داد. */
  if (block.includes('@seo_static') && block.indexOf('set $seo_file') > block.indexOf('rewrite ^'))
    die('مسیرِ ' + loc + ' باید پیش از rewrite مقدارِ $seo_file را ست کند');
}
const fallback = ngx.slice(ngx.indexOf('location @seo_static'), ngx.indexOf('\n  }', ngx.indexOf('location @seo_static')));
if (/try_files\s+\$uri/.test(fallback))
  die('fallbackِ ایستا نباید به $uri تکیه کند — rewrite عوضش کرده؛ از $seo_file استفاده کن');
if (!fallback.includes('try_files $seo_file')) die('fallbackِ ایستا باید از $seo_file بخواند');
const dockerfile = read('Dockerfile');
if (!dockerfile.includes('/etc/nginx/templates/')) die('Dockerfile قالبِ nginx را کپی نمی‌کند');
if (!/ENV API_UPSTREAM=/.test(dockerfile)) die('Dockerfile پیش‌فرضِ API_UPSTREAM را ندارد');
for (const f of ['public/robots.txt', 'public/sitemap.xml'])
  if (!fs.existsSync(f)) die('فایلِ پشتیبانِ ' + f + ' نیست');

/* ③ هر مقدارِ تزریقی در attribute باید از esc رد شود — متن‌ها را ادمینِ شرکت
   می‌نویسد و یک نقل‌قول کافی است تا از attribute بیرون بزند. */
const seo = read('server/src/site/seo.service.ts');
for (const m of code(seo).matchAll(/(?:content|href)="\$\{([^}]*)\}/g))
  if (!m[1].trim().startsWith('this.esc(')) die('مقدارِ بدونِ فرار در attribute: ' + m[1].trim());
if (!/replace\(\/<\/g, '\\\\u003c'\)/.test(seo)) die('JSON-LD باید نویسهٔ < را خنثی کند وگرنه </script> بلوک را می‌بندد');
for (const leak of ['nationalId', 'econCode'])
  if (code(seo).includes(leak)) die('قطعهٔ سئو نباید ' + leak + ' را بیرون بدهد');

/* ④ اندپوینت‌های سئو باید روی کنترلرِ **عمومی** باشند؛ زیرِ گارد یعنی خزنده
   ۴۰۱ می‌گیرد و کلِ این ماژول بی‌اثر است. */
const ctrl = code(read('server/src/site/site.controller.ts'));
const pubStart = ctrl.indexOf("@Controller('public/site')");
const pubEnd = ctrl.indexOf("@Controller('site')", pubStart);
const pubBlock = ctrl.slice(pubStart, pubEnd);
for (const route of ["@Get('head')", "@Get('robots.txt')", "@Get('sitemap.xml')"])
  if (!pubBlock.includes(route)) die('مسیرِ ' + route + ' باید روی کنترلرِ عمومیِ سایت باشد');

/* ⑤ هر صفحه باید چانکِ خودش بماند. یک import ثابتِ فراموش‌شده بی‌سروصدا کلِ
   آن صفحه را به باندلِ ورودی برمی‌گرداند و لندینگ دوباره سنگین می‌شود. */
const app = code(read('src/App.jsx'));
const SHELL = ['./app/ErrorBoundary.jsx', './app/auth.jsx', './app/config.jsx', './app/Gate.jsx'];
for (const m of app.matchAll(/^import\s+[^\n]*?from\s+'(\.\/(?:app|pages)\/[^']+)';/gm))
  if (!SHELL.includes(m[1])) die('صفحهٔ ' + m[1] + ' ثابت import شده — باید lazy باشد');
if (!/<Suspense fallback=/.test(read('src/App.jsx'))) die('مسیرهای lazy به Suspense نیاز دارند');
/* پردهٔ بارگذاری باید در CSSِ ورودی باشد، نه در استایلِ یک صفحهٔ lazy — وگرنه
   کاربر تا رسیدنِ چانک یک متنِ بی‌استایل می‌بیند. */
if (!read('src/index.css').includes('.lx-boot')) die('استایلِ .lx-boot باید در index.css باشد');

console.log('tenant SEO surface ok');
