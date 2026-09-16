/**
 * مرورگرِ واقعی + APIِ ساختگی — برای آزمون‌های رابطی که به سرور و دیتابیس نیاز ندارند.
 *
 * الگو همان `orders-ai-ui.mjs`: Vite روی یک پورت بالا می‌آید، هر درخواستِ `/api/**`
 * در خودِ مرورگر با fixture جواب می‌گیرد، و ادعاها روی **صفحهٔ رندرشده** است.
 * قراردادِ سرور این‌جا سنجیده نمی‌شود — کارِ آزمون‌های سرورِ زنده است.
 *
 * ⚠️ صفحه‌های عمومی (`/f`, `/o`) هم `/auth/*` و `/config` را صدا می‌زنند (AuthProvider
 * و ConfigProvider سراسری‌اند)؛ ۴۰۱ برایشان عادی است. `handle` برای هر مسیری که
 * `undefined` برگرداند، ۴۰۱ می‌گیرد — پس مسیرِ فراموش‌شده به‌جای «صفحهٔ سالم با
 * دادهٔ تصادفی» یک خطای دیدنی می‌دهد.
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

export const CHROME = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium';

export async function startVite(port) {
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { stdio: 'ignore' });
  for (let i = 0; i < 150; i++) {
    if (await fetch(base).then((r) => r.ok).catch(() => false)) return { base, stop: () => proc.kill() };
    await delay(200);
  }
  proc.kill();
  throw new Error(`Vite روی ${port} بالا نیامد`);
}

export const launch = () => chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

/**
 * یک context با API ساختگی.
 * `handle({ path, method, body })` → شیِ پاسخ (۲۰۰)، یا `{ status, body }`، یا `undefined` (→ ۴۰۱).
 * `writes` هر درخواستِ غیرِ GET را نگه می‌دارد تا بشود روی «چه چیزی به سرور رفت» ادعا کرد؛
 * `errors` خطاهای JS هر صفحهٔ این context است.
 */
export async function mockContext(browser, handle, { viewport = { width: 390, height: 844 } } = {}) {
  const context = await browser.newContext({ viewport, locale: 'fa-IR', serviceWorkers: 'block' });
  const writes = [];
  const errors = [];
  context.on('page', (page) => page.on('pageerror', (e) => errors.push(String(e))));
  await context.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, '');
    const method = req.method();
    const raw = req.postData();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    if (method !== 'GET') writes.push({ path, method, body });
    const res = await handle({ path, method, body });
    const out = res === undefined
      ? { status: 401, body: { message: 'ورود لازم است' } }
      : (res && typeof res === 'object' && 'status' in res && 'body' in res) ? res : { status: 200, body: res };
    return route.fulfill({ status: out.status, contentType: 'application/json', body: JSON.stringify(out.body) });
  });
  return { context, writes, errors };
}

/** سرریزِ افقی — روی موبایل هیچ صفحه‌ای نباید اسکرولِ افقی داشته باشد. */
export const hOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
