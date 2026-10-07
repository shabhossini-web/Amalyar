/**
 * «نوبتم انتخاب شد» باید دیده شود — فرمِ عمومیِ نوبت‌گیری، مرورگرِ واقعی.
 *
 * گزارشِ مالک (۱۴۰۵/۰۷/۱۵، با عکس): بیمار روز را می‌زند، «همین روز را می‌خواهم» را می‌زند و **هیچ‌جا نشان
 * داده نمی‌شود** که نوبتش گرفته شد؛ دکمه همان دکمه می‌ماند و «نوبتِ شما: …» بالای بخش (بیرون از دیدِ او) می‌نشست.
 *
 *  باید بیفتد:
 *   - روزِ ظرفیتی: پس از زدنِ دکمه، همان‌جا (جای دکمه) «نوبتِ شما ثبت شد: تاریخِ شمسی» می‌آید و دکمه می‌رود
 *   - همان روز روی تقویم تیک می‌گیرد (نه نقطهٔ «باز»)
 *   - ساعتی: پس از انتخابِ ساعت، زیرِ ساعت‌ها همان پیام می‌آید و ساعتِ انتخاب‌شده علامت دارد
 *   - روزِ دیگر که باز شود دکمه برمی‌گردد (جابه‌جایی ممکن است) و پیامِ «ثبت شد» روی آن نیست
 *   - در هر دو تم و موبایل ۳۹۰، بدونِ سرریزِ افقی
 *  نباید بیفتد:
 *   - ثبتِ نوبت با خطای سرور «ثبت شد» را نشان دهد
 *   - هیچ خطای JS/کنسول
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { captchaFor } from './lib/captcha.mjs';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const EXE = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium';
const SHOTS = process.env.E2E_SHOTS ?? '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, method = 'GET', body, auth = true) => fetch(API + p, {
  method, headers: auth ? A : { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const nid = (n) => {
  const base = String(n).padStart(9, '0').slice(-9);
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(base[i]) * (10 - i);
  const r = s % 11;
  return base + String(r < 2 ? r : 11 - r);
};
const tag = Math.random().toString(36).slice(2, 7);
let seed = Math.floor(Math.random() * 800000) + 100000;

/* دو حالتِ روز: ظرفیتی («۲۹ جا مانده») و ساعتی. هر هفت روزِ هفته، تا آزمون به روزِ اجرا حساس نباشد. */
const form = (await send('/forms', 'POST', { key: `bc${tag}`, title: 'ویزیتِ نوبت‌دار', scope: 'visit' })).json;
const link = (await send('/intake/links', 'POST', { title: `[e2e] تأییدِ نوبت ${tag}`, formId: form.id })).json;
if (!link?.token) { console.error('لینک ساخته نشد'); process.exit(1); }
const topicCap = (await send('/visit-topics', 'POST', { name: `ظرفیتی ${tag}` })).json;
const topicSlot = (await send('/visit-topics', 'POST', { name: `ساعتی ${tag}` })).json;
for (let w = 0; w < 7; w++) {
  await send('/availability/rules', 'POST', { weekday: w, startMin: 17 * 60, endMin: 20 * 60, mode: 'capacity', capacity: 29, topicIds: [topicCap.id] });
  await send('/availability/rules', 'POST', { weekday: w, startMin: 9 * 60, endMin: 12 * 60, mode: 'slot', slotMinutes: 30, topicIds: [topicSlot.id] });
}
const reg = (await send(`/public/intake/link/${link.token}/register`, 'POST', {
  firstName: 'نوبتِ', lastName: `تأیید ${tag}`, nationalId: nid(seed++), phone: '09120000091',
  ...(await captchaFor(API, link.token)),
}, false)).json;
ok('ثبت‌نام انجام شد و نوبت‌دهی روشن است', !!reg?.token && reg?.booking?.required === true, JSON.stringify(reg).slice(0, 140));

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const errors = [];
const run = async (theme) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fa-IR' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('amalyar_theme', t); } catch { /* حالتِ ناشناس */ } }, theme);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${theme}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${theme} console: ${m.text().slice(0, 160)}`); });
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/booking-confirm-${theme}-${name}.png` }); };

  /* هر تم با یک ثبت‌نامِ تازه می‌آید تا «نوبتِ قبلی» روی پیامِ این دور اثر نگذارد. */
  const r = (await send(`/public/intake/link/${link.token}/register`, 'POST', {
    firstName: 'نوبتِ', lastName: `تأیید ${theme} ${tag}`, nationalId: nid(seed++), phone: '09120000092',
    ...(await captchaFor(API, link.token)),
  }, false)).json;
  await page.goto(`${UI}/f/${r.token}`, { waitUntil: 'networkidle' });
  await page.locator('.ik-book').waitFor({ timeout: 15000 });
  const openCell = () => page.locator('.jg-cell:has(.ik-cell.open):not(.empty)');
  /* اولین ماهی که روزِ باز دارد (آخرِ ماه ممکن است همه‌اش گذشته باشد). */
  for (let i = 0; i < 2 && (await openCell().count()) === 0; i++) {
    await page.getByRole('button', { name: 'ماهِ بعد' }).tap();
    await page.waitForTimeout(500);
  }

  console.log(`\n— تم ${theme === 'dark' ? 'تیره' : 'روشن'} · موضوعِ ظرفیتی —`);
  await page.locator('.ik-book-topics button', { hasText: topicCap.name }).tap();
  await page.waitForTimeout(500);
  for (let i = 0; i < 2 && (await openCell().count()) === 0; i++) {
    await page.getByRole('button', { name: 'ماهِ بعد' }).tap();
    await page.waitForTimeout(500);
  }
  const cells = openCell();
  ok('روزِ باز دارد', (await cells.count()) >= 2, 'n=' + (await cells.count()));
  await cells.nth(0).tap();
  const go = page.locator('.ik-book-go');
  await go.waitFor({ timeout: 5000 });
  ok('پیش از انتخاب، دکمهٔ «همین روز را می‌خواهم» هست و «ثبت شد» نیست',
    (await go.innerText()).includes('همین روز را می‌خواهم') && (await page.locator('.ik-book-done').count()) === 0);
  await shot('1-before');
  await go.tap();
  await page.locator('.ik-book-done').waitFor({ timeout: 8000 }).catch(() => {});
  const done = page.locator('.ik-book-done');
  ok('**پس از زدن، همان‌جا «نوبتِ شما ثبت شد» دیده می‌شود**', (await done.count()) === 1 && (await done.innerText()).includes('نوبتِ شما ثبت شد'), (await done.allInnerTexts()).join('|'));
  ok('تاریخ شمسی و فارسی است (نه ISO)', /[۰-۹]/.test(await done.innerText()) && !/20\d\d-\d\d-\d\d/.test(await done.innerText()), await done.innerText());
  ok('دکمهٔ «همین روز…» رفت (جایش را پیام گرفت)', (await page.locator('.ik-book-go').count()) === 0);
  ok('روی تقویم همان روز تیک دارد', (await page.locator('.ik-cell.mine .ik-tick').count()) === 1);
  ok('**بدونِ پرش:** پیامِ «نوبتِ شما: …»ِ جدا تکرار نمی‌شود (خودِ کارت جایش را گرفته)', (await page.locator('.ik-book-has').count()) === 0);
  const box = await done.boundingBox();
  const vh = page.viewportSize().height;
  ok('پیام در همان صفحهٔ دیدِ کاربر است (از پایینِ پنجره بیرون نیست)', !!box && box.y >= 0 && box.y + box.height <= vh, JSON.stringify(box));
  await shot('2-done');

  /* روزِ دیگر ← دکمه برمی‌گردد؛ همان روز ← پیام هست. */
  await cells.nth(1).tap();
  await page.waitForTimeout(400);
  ok('روزِ دیگر که باز شود دکمه برمی‌گردد و پیامِ «ثبت شد» روی آن نیست',
    (await page.locator('.ik-book-go').count()) === 1 && (await page.locator('.ik-book-done').count()) === 0);
  ok('و یادآوریِ «نوبتِ شما: …» زیرِ تقویم می‌آید (نه بالا)', (await page.locator('.ik-book-has').count()) === 1
    && (await page.locator('.ik-book-has').evaluate((n) => n.compareDocumentPosition(document.querySelector('.ik-book-day')) & Node.DOCUMENT_POSITION_PRECEDING)) > 0);
  await page.locator('.jg-cell.sel').first().waitFor({ timeout: 2000 }).catch(() => {});
  await page.locator('.jg-cell:has(.ik-cell.mine)').first().tap();
  await page.waitForTimeout(400);
  ok('برگشت به روزِ نوبت ← پیام دوباره هست', (await page.locator('.ik-book-done').count()) === 1);

  console.log(`— تم ${theme === 'dark' ? 'تیره' : 'روشن'} · موضوعِ ساعتی —`);
  await page.locator('.ik-book-topics button', { hasText: topicSlot.name }).tap();
  await page.waitForTimeout(600);
  for (let i = 0; i < 2 && (await openCell().count()) === 0; i++) {
    await page.getByRole('button', { name: 'ماهِ بعد' }).tap();
    await page.waitForTimeout(500);
  }
  await openCell().last().tap();
  const slot = page.locator('.ik-slots button:not([disabled])').first();
  await slot.waitFor({ timeout: 5000 });
  await slot.tap();
  await page.locator('.ik-book-done').waitFor({ timeout: 8000 }).catch(() => {});
  ok('ساعتی: پس از انتخابِ ساعت پیامِ «ثبت شد» با ساعت می‌آید',
    (await page.locator('.ik-book-done').count()) === 1 && /ساعتِ\s*[۰-۹]/.test(await page.locator('.ik-book-done').innerText()), await page.locator('.ik-book-done').allInnerTexts().then((x) => x.join('|')));
  ok('و ساعتِ انتخاب‌شده علامت دارد (aria-checked)', (await page.locator('.ik-slots button[aria-checked="true"]').count()) === 1);
  await shot('3-slot');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('بدونِ سرریزِ افقی روی موبایل ۳۹۰', overflow <= 1, overflow + 'px');
  await ctx.close();
};

try {
  await run('dark');
  await run('light');
  console.log('\n— همهٔ تم‌ها —');
  ok('هیچ خطای JS/کنسول', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

console.log(`\nقبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
