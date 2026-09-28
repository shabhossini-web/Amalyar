/**
 * **عکس از پاپ‌آپ‌ها، جریان‌ها و صفحه‌های عمومی** — مکملِ `capture.mjs` (اسکیلِ `ux-audit`).
 *
 * روی دادهٔ `seed-demo.mjs` کار می‌کند (نام‌های بیماران و توکن‌های `$UX_OUT/links.json`)؛ هر گام
 * در دو تم و دو اندازه عکس می‌شود. گامی که کلیکش نرسد باز هم عکس می‌گیرد و در `flows.json`
 * با `actErr` علامت می‌خورد — نبودنِ دکمه خودش یافته است، نه خطای اسکریپت.
 *
 *   UX_UI_CLINIC=http://127.0.0.1:5600 UX_API_CLINIC=http://127.0.0.1:3502/api \
 *   UX_UI_COMPANY=http://127.0.0.2:5601 UX_API_COMPANY=http://127.0.0.2:3502/api \
 *   UX_OUT=/tmp/ux-audit node scripts/ux/flows.mjs [filter]
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = process.env.UX_OUT ?? '/tmp/ux-audit';
const L = JSON.parse(readFileSync(`${ROOT}/links.json`, 'utf8'));
const T = {
  clinic: { UI: process.env.UX_UI_CLINIC ?? 'http://127.0.0.1:5600', API: process.env.UX_API_CLINIC ?? 'http://127.0.0.1:3502/api', token: L.t1token },
  company: { UI: process.env.UX_UI_COMPANY ?? 'http://127.0.0.2:5601', API: process.env.UX_API_COMPANY ?? 'http://127.0.0.2:3502/api', token: L.t2token },
};
const filter = process.argv[2] ?? '';
const OUT = `${ROOT}/shots/flows`;
mkdirSync(OUT, { recursive: true });
const tok = (s) => String(s ?? '').split('/').pop();

const clickText = async (page, text, opts = {}) => {
  const el = page.getByText(text, { exact: false }).first();
  await el.waitFor({ state: 'visible', timeout: 6000 });
  await el.click(opts);
};
const clickRole = async (page, name, role = 'button') => {
  const el = page.getByRole(role, { name, exact: false }).first();
  await el.waitFor({ state: 'visible', timeout: 6000 });
  await el.click();
};

const STEPS = [
  // ── مطب ──
  ['c-quick-visit', 'clinic', '/app', async (p) => { await p.click('[data-quick-visit]'); await p.waitForTimeout(1200); }],
  ['c-search', 'clinic', '/app', async (p) => { await p.keyboard.press('Control+k'); await p.waitForTimeout(400); await p.keyboard.type('رضا'); await p.waitForTimeout(1200); }],
  ['c-profile-menu', 'clinic', '/app', async (p) => { await p.click('button[aria-label="منوی پروفایل"]'); await p.waitForTimeout(700); }],
  ['c-bell', 'clinic', '/app', async (p) => { await p.locator('button[aria-label^="کار"]').first().click(); await p.waitForTimeout(900); }],
  ['c-theatre-desk', 'clinic', '/app/theatre', async (p) => { await clickText(p, 'رضا کاظمی'); await p.waitForTimeout(1500); }],
  ['c-discharge', 'clinic', '/app/theatre', async (p) => { await clickText(p, 'رضا کاظمی'); await p.waitForTimeout(1200); await p.click('[data-act="discharge"]'); await p.waitForTimeout(900); }],
  ['c-frontdesk-row', 'clinic', '/app/frontdesk', async (p) => { await clickText(p, 'نرگس سلیمانی'); await p.waitForTimeout(1000); }],
  ['c-record-visit', 'clinic', '/app/dashboard', async (p) => { await clickText(p, 'محمد حسینی'); await p.waitForTimeout(1500); }],
  ['c-waitlist-close', 'clinic', '/app/waitlist', async (p) => { await clickRole(p, 'بستنِ تصمیم'); await p.waitForTimeout(800); }],
  ['c-waitlist-plan', 'clinic', '/app/waitlist', async (p) => { await clickRole(p, 'برنامهٔ عمل'); await p.waitForTimeout(1500); }],
  ['c-calendar-day', 'clinic', '/app/calendar', async (p) => { await p.waitForTimeout(600); }],
  ['c-definitions-topic', 'clinic', '/app/definitions', async (p) => { await clickText(p, 'موضوع'); await p.waitForTimeout(800); }],
  ['c-settings-sms', 'clinic', '/app/settings', async (p) => { await clickText(p, 'پیامک'); await p.waitForTimeout(800); }],
  // ── شرکت ──
  ['k-quick-visit', 'company', '/app', async (p) => { await p.click('[data-quick-visit]'); await p.waitForTimeout(1200); }],
  ['k-intake-approve', 'company', '/app/intake', async (p) => { await clickText(p, 'شهلا صفری'); await p.waitForTimeout(1500); }],
  ['k-tech-status', 'company', '/app/tech', async (p) => { await clickRole(p, 'وضعیتِ عمل'); await p.waitForTimeout(900); }],
  ['k-dispatch', 'company', '/app/dispatch', async (p) => { await p.waitForTimeout(800); }],
  ['k-dashboard-row', 'company', '/app/dashboard', async (p) => { await clickText(p, 'اکبر نوروزی'); await p.waitForTimeout(1500); }],
  // ── عمومی (بی‌ورود) ──
  ['pub-login', 'clinic', '/login', null, true],
  ['pub-register-clinic', 'clinic', `/r/${L.t1intake}`, null, true],
  ['pub-register-company', 'company', `/r/${L.t2intake}`, null, true],
  ['pub-form-company', 'company', `/f/${L.t2form}`, null, true],
  ['pub-portal', 'clinic', `/p/${tok(L.t1portal)}`, null, true],
  ['pub-summary', 'clinic', `/v/${tok(L.t1summary)}`, null, true],
];

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium' });
const log = [];
for (const [vp, viewport] of [['d', { width: 1280, height: 800 }], ['m', { width: 390, height: 844 }]]) {
  for (const theme of ['dark', 'light']) {
    for (const [name, tenant, path, act, anon] of STEPS) {
      if (filter && !name.includes(filter)) continue;
      const { UI, API, token } = T[tenant];
      const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce', locale: 'fa-IR', isMobile: vp === 'm', hasTouch: vp === 'm' });
      if (!anon) {
        const u = new URL(API); u.pathname = '/';
        await ctx.addCookies([
          { name: 'amalyar_session', value: token, url: u.toString(), httpOnly: true, sameSite: 'Lax' },
          { name: 'amalyar_csrf', value: 'ux-' + Date.now().toString(36), url: u.toString(), httpOnly: false, sameSite: 'Lax' },
        ]);
      }
      await ctx.addInitScript((t) => { try { localStorage.setItem('amalyar_theme', t); } catch {} }, theme);
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 140)));
      page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) errs.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 80)}`); });
      let actErr = null;
      try {
        await page.goto(UI + path, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(700);
        if (act) await act(page);
      } catch (e) { actErr = e.message.split('\n')[0].slice(0, 140); }
      const ov = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)).catch(() => -1);
      await page.screenshot({ path: `${OUT}/${name}__${vp}__${theme}.jpg`, type: 'jpeg', quality: 72 });
      if (vp === 'd' && theme === 'dark' || actErr) log.push({ name, vp, theme, url: page.url().replace(UI, ''), actErr, overflowX: ov, errs: [...new Set(errs)].slice(0, 8) });
      process.stdout.write(`${name}:${vp}:${theme}${actErr ? '✘' : ''} `);
      await ctx.close();
    }
  }
}
await browser.close();
writeFileSync(`${ROOT}/flows${filter ? '-' + filter : ''}.json`, JSON.stringify(log, null, 1));
console.log('\nOK');
