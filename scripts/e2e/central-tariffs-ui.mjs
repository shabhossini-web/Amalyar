/** چکِ چشمی: بخشِ نیروهای مسلح در فرمِ تعرفه + نشانِ «سراسری» روی ردیفِ مرکزی. */
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const CTRL = process.env.E2E_CTRL_DB ?? 'postgresql://amal:amal@localhost:5432/ctrl_ui';
const YEAR = '1498';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${CTRL}" -qtA`, { input: q }).toString().trim();

sql(`INSERT INTO central_tariffs (year, sector, professional, technical, anesthesia)
     VALUES ('${YEAR}', 'military', 3000, 1500, 700)
     ON CONFLICT (year, sector) DO UPDATE SET professional=3000, technical=1500, anesthesia=700, active=true`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(BASE + '/login');
  await page.waitForTimeout(1000);
  await page.fill('input[name="identifier"], input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'test1234');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/app**', { timeout: 15000 });

  await page.goto(BASE + '/app/settings');
  await page.waitForTimeout(2000);
  ok(await page.locator('.st-tariff select option:has-text("نیروهای مسلح")').count() === 1,
    '**بخشِ «نیروهای مسلح» در فرمِ تعرفه هست**');
  const row = page.locator('.st-tlist .df-row', { hasText: 'نیروهای مسلح' }).first();
  /* فهرستِ تعرفه‌ها جدا از فرم می‌رسد — زیرِ بارِ CI گاهی دیرتر از ۲ ثانیه. */
  await row.waitFor({ timeout: 15000 }).catch(() => {});
  ok(await row.count() === 1, 'ردیفِ تعرفهٔ مرکزی در فهرست دیده می‌شود');
  ok(await row.locator('.st-tsrc:has-text("سراسری")').count() === 1, '**با نشانِ «سراسری»**');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `بدونِ سرریزِ افقی (${overflow}px)`);
  ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
} finally {
  await browser.close();
  sql(`DELETE FROM central_tariffs WHERE year='${YEAR}'`);
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
