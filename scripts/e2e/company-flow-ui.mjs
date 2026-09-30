/**
 * **رابطِ جریانِ شرکتیِ نورومانیتورینگ** — مرورگرِ واقعی روی سرورِ زنده، گوشی (۳۹۰) و هر دو تم.
 * گزارشِ مالک ۱۴۰۵/۰۷/۰۵ روی roham؛ قراردادِ سرورش را `company-service-flow` می‌سنجد.
 *
 *  باید بیفتد:
 *   - فیشِ واریزی: پس از اولین فیش کادر **سرِ جایش می‌ماند**؛ دو فیشِ هم‌زمان (انتخابِ چندتایی) هر دو
 *     می‌نشینند؛ «تمام شد» کادر را می‌بندد و «افزودنِ فیشِ دیگر» برش می‌گرداند
 *   - پنلِ تأیید: «ساعتِ عمل» نیست (تاریخ هست)؛ پیشنهادِ نزدیک‌ترین با نوشتهٔ بیمار کنارش؛ وقتی
 *     چیزی نزدیک نیست هشدارِ بالای کشویی و «+» که همان نوشته را پیش‌پر می‌کند
 *   - پنلِ کارشناس: «وضعیتِ عمل» ← موکولِ بی‌تاریخ و با تاریخ، «انجام شد»، «لغو شد» با پنجرهٔ
 *     مشترکِ دلیل (و «انصراف»ش به همان شیت برمی‌گردد)؛ دکمهٔ گزارش «آپلودِ گزارشِ نورومانیتورینگ»
 *   - کارهای رویدادی (بازبینیِ UX، company-01): دکمهٔ اصلیِ ردیف خودِ کار است — «ثبتِ وضعیت» همان
 *     پنجرهٔ سه‌گزینه‌ای، «بارگذاریِ گزارش» کادرِ فایل — و کار با رویدادِ واقعی همان لحظه بسته
 *     می‌شود؛ «بستن بدونِ اقدام» با پرسشِ تأیید فقط یادآوری را برمی‌دارد
 *  نباید بیفتد:
 *   - کادرِ فیش با اولین آپلود بسته شود (همان باگِ گزارش‌شده)
 *   - «موکول» به گذشته بی‌پیام بماند یا چیزی را عوض کند
 *   - دکمهٔ «وضعیتِ عمل» روی عملِ ثبت‌شده؛ اسکرولِ افقی در ۳۹۰؛ خطای JS
 */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { captchaFor } from './lib/captcha.mjs';
import { browserLogin } from './lib/browser-login.mjs';
import { faDate, ymdToJStr } from '../../src/lib/jalali.js';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB;
if (![API, DB].every((u) => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const shots = process.env.E2E_SHOTS;
const db = new PrismaClient({ datasources: { db: { url: DB } } });

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log(`  ✘ ${m}${d ? ` — ${d}` : ''}`); } };
const dir = mkdtempSync(join(tmpdir(), 'cfu-'));
const photos = [];
const photo = (n) => photos[n - 1];
async function api(path, body, method = body ? 'POST' : 'GET', token) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const upload = async (path) => {
  const fd = new FormData();
  /* همان JPEGِ سالمِ فیش‌ها (پایین‌تر ساخته می‌شود) — پنلِ تأیید عکسِ شکسته نشان ندهد. */
  const bytes = photos.length ? readFileSync(photos[0]) : Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048)]);
  fd.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'x.jpg');
  const r = await fetch(API + path, { method: 'POST', body: fd });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const set = (key, value) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
const tag = randomBytes(3).toString('hex');
let seed = Number.parseInt(randomBytes(3).toString('hex'), 16);
function nid(n) { const b = String(n % 1e9).padStart(9, '0'); let s = 0; for (let i = 0; i < 9; i++) s += +b[i] * (10 - i); const r = s % 11; return b + (r < 2 ? r : 11 - r); }
const phone = () => '0912' + String(1000000 + ((seed += 13) % 8999999));
/* «امروز» روزِ مطب است (`common/clinic-day.ts`) — دفترِ کار و «موکول به گذشته» همان را می‌سنجند. */
const clinicDay = (offset = 0) => new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.CLINIC_TZ || 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(Date.now() + offset * 864e5));


const auth = (await api('/auth/login', { identifier: 'admin', password: 'test1234' })).data?.accessToken;
if (!auth) throw new Error('ورودِ ادمین');
await set('vertical', 'ionm'); await set('services', JSON.stringify(['ionm']));
await db.feature.updateMany({ where: { key: 'tech' }, data: { enabled: true } });
await api('/forms', null, 'GET', auth);
const ionm = await db.formDef.findUnique({ where: { key: 'intake.ionm' } });
const bank = await db.bankAccount.create({ data: { bankName: 'ملت', ownerName: 'شرکتِ آزمون', cardNumber: '6104337912345678', showOnIntake: true } });
const link = await api('/intake/links', { title: 'نورومانیتورینگ', formId: ionm.id, amount: 40000000, bankAccountId: bank.id }, 'POST', auth);
if (!link.data?.token) throw new Error('لینک: ' + JSON.stringify(link.data));
const hosp = await db.hospital.create({ data: { name: 'بیمارستان آراد' } });
const surgeon = await db.surgeon.create({ data: { person: { create: { firstName: 'علیرضا', lastName: 'طبیب' } } } });
for (const n of ['اسکولیوز', 'BT', 'کرانیوتومی مغز']) await db.procedureType.create({ data: { name: n } });

/** ثبت‌نام تا «فیشِ واریزی» (مدارک و صفحهٔ اول از راهِ API — این‌ها را `intake-service-ui` در مرورگر می‌سنجد). */
const register = async (lastName, procedure) => {
  seed += 7;
  const r = await api(`/public/intake/link/${link.data.token}/register`, { firstName: 'سارا', lastName, nationalId: nid(seed * 7919), phone: phone(), ...(await captchaFor(API, link.data.token)) });
  const t = r.data?.token;
  if (!t) throw new Error('ثبت‌نام: ' + JSON.stringify(r.data));
  for (const f of ['nationalIdImage', 'prescription']) await upload(`/public/intake/form/${t}/image/${f}`);
  const day = clinicDay(2);
  const fill = await api(`/public/intake/form/${t}/fill`, { values: { hospitalName: hosp.name, hospitalId: hosp.id, surgeonName: 'دکتر طبیب', procedure, opDate: day }, opDate: day });
  if (fill.data?.status !== 'pending_payment') throw new Error('ثبت: ' + JSON.stringify(fill.data).slice(0, 200));
  return t;
};

const mkTech = async (u, last) => {
  const made = (await api('/accounts/temporary', { firstName: 'مهسا', lastName: last, phone: phone(), level: 2, jobRole: 'technician', username: `${u}${tag}` }, 'POST', auth)).data;
  if (!made?.account?.id) throw new Error('حسابِ کارشناس: ' + JSON.stringify(made).slice(0, 160));
  const t = (await api('/auth/login', { identifier: `${u}${tag}`, password: made.temporaryPassword })).data?.accessToken;
  if (!t) throw new Error('ورودِ کارشناس');
  return { id: made.account.id, token: t };
};

const THEMES = [
  { key: 'dark', fa: 'تیره', people: ['کریمی', 'رضایی', 'احمدی', 'موسوی'], typed: 'لامینکتومی', save: true },
  { key: 'light', fa: 'روشن', people: ['حسینی', 'جعفری', 'کاظمی', 'صادقی'], typed: 'آنوریسم مغزی', save: false },
];

const b = await chromium.launch({ executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const errs = [];
/* فیشِ «واقعی» (JPEGِ سالم از canvas) — تا پیش‌نمایشِ ردیف‌ها در اسکرین‌شات عکسِ شکسته نباشد. */
{
  const pg = await b.newPage();
  const jpgs = await pg.evaluate(() => [0, 1, 2].map((i) => {
    const c = document.createElement('canvas'); c.width = 240; c.height = 320;
    const g = c.getContext('2d');
    g.fillStyle = '#f6f5ef'; g.fillRect(0, 0, 240, 320);
    g.fillStyle = ['#1f4e8c', '#8c1f4e', '#1f8c5a'][i]; g.fillRect(0, 0, 240, 46);
    g.fillStyle = '#444';
    for (let y = 76; y < 300; y += 26) g.fillRect(22, y, 196 - ((y / 26 + i) % 3) * 38, 8);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  }));
  jpgs.forEach((b64, i) => { const f = join(dir, `receipt-${i + 1}.jpg`); writeFileSync(f, Buffer.from(b64, 'base64')); photos.push(f); });
  await pg.close();
}
const context = async (theme) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'fa-IR', isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('amalyar_theme', t); } catch { /* */ } }, theme);
  const p = await ctx.newPage();
  p.setDefaultTimeout(10000);
  p.on('pageerror', (e) => errs.push(`${theme}: ${e}`));
  return { ctx, p };
};
const hOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

try {
  for (const T of THEMES) {
    console.log(`\n══ تمِ ${T.fa}`);

    console.log('۱) فیشِ واریزی: چند فیش، بیمار خودش «تمام شد» می‌زند');
    {
      const token = await register(`نیک‌نام`, 'کرانیوتومی');
      const { ctx, p } = await context(T.key);
      await p.goto(`${UI}/f/${token}`, { waitUntil: 'networkidle' });
      const pay = p.locator('.ik-pay');
      await pay.waitFor();
      const rows = p.locator('.ik-receipt-row');
      const input = pay.locator('input[type="file"]');
      await input.setInputFiles(photo(1));
      await p.locator('.ik-receipt-done').waitFor();
      ok(await pay.isVisible() && await rows.count() === 1, '**پس از فیشِ اول کادر سرِ جایش ماند** (همان باگِ گزارش‌شده)');
      ok((await p.locator('.ik-steps li.now').innerText()).includes('فیش'), 'مرحلهٔ جاری هنوز «فیشِ واریزی» است');
      ok((await p.locator('.ik-receipt-done').innerText()).includes('تمام شد'), 'دکمهٔ «تمام شد» پیدا شد');
      /* انتخابِ چندتایی: تا دیروز اولین پاسخِ سرور کادر را برمی‌داشت و فایلِ دومِ صف هرگز نمی‌رفت. */
      await input.setInputFiles([photo(2), photo(3)]);
      await p.waitForFunction(() => document.querySelectorAll('.ik-receipt-row').length === 3, null, { timeout: 15000 });
      const labels = (await rows.locator('b').allInnerTexts()).map((t) => t.trim()).join('|');
      ok(labels === 'فیشِ ۱|فیشِ ۲|فیشِ ۳', '**دو فیشِ هم‌زمان هر دو نشستند** — شماره‌ها فارسی', labels);
      ok((await p.locator('.ik-receipt-done').innerText()).includes('۳ فیش رسید'), 'متن شمارِ فیش‌ها را می‌گوید («۳ فیش رسید»)');
      const single = await p.waitForFunction(() => !document.querySelector('.ik-pay .fdrop-item'), null, { timeout: 5000 }).then(() => true, () => false);
      ok(single, '**یک فهرست، نه دو** — کادرِ بارگذاری فایلِ رفته را نگه نمی‌دارد');
      ok(await rows.locator('img.ik-receipt-thumb').count() === 3, 'هر ردیف پیش‌نمایشِ همان عکس را دارد');
      const del = await rows.first().getByRole('button', { name: 'حذفِ فیشِ ۱' }).boundingBox();
      ok(del && del.height >= 40, `هدفِ لمسیِ «حذف» کافی است (${Math.round(del?.height ?? 0)})`);
      let row = await db.intakeSubmission.findUnique({ where: { token } });
      ok(row.status === 'pending_approval' && (row.data.receiptDocumentIds ?? []).length === 3, 'روی سرور: «در انتظارِ بررسی» با سه فیش', `${row.status} ${JSON.stringify(row.data.receiptDocumentIds)}`);
      ok(await hOverflow(p) <= 0, 'اسکرولِ افقی نیست');
      if (shots) await p.screenshot({ path: `${shots}/company-flow-${T.key}-receipts.png`, fullPage: true });
      /* عکسِ اشتباه: همان ردیف برداشته می‌شود، شماره‌ها جابه‌جا می‌شوند و کادر باز می‌ماند. */
      await rows.nth(2).getByRole('button', { name: 'حذفِ فیشِ ۳' }).tap();
      await p.waitForFunction(() => document.querySelectorAll('.ik-receipt-row').length === 2);
      row = await db.intakeSubmission.findUnique({ where: { token } });
      ok((row.data.receiptDocumentIds ?? []).length === 2 && await pay.isVisible(), '«حذف» فیشِ سوم را از سرور برداشت و کادر باز ماند');

      await p.getByRole('button', { name: 'تمام شد' }).tap();
      await pay.waitFor({ state: 'detached' });
      ok((await p.locator('.ik-steps li.now').innerText()).includes('بررسی'), '«تمام شد» ← مرحلهٔ «بررسیِ تیمِ درمان»');
      ok((await p.locator('body').innerText()).includes('فیشِ شما دریافت شد'), 'پیامِ «فیشِ شما دریافت شد»');
      const more = p.getByRole('button', { name: 'افزودنِ فیشِ دیگر' });
      ok(await more.count() === 1, 'راهِ برگشت: «افزودنِ فیشِ دیگر»');
      if (shots) await p.screenshot({ path: `${shots}/company-flow-${T.key}-review.png`, fullPage: true });
      await more.tap();
      await pay.waitFor();
      ok(await rows.count() === 2, '«افزودنِ فیشِ دیگر» کادر را با همان دو فیش برگرداند');
      await p.getByRole('button', { name: 'تمام شد' }).tap();
      await pay.waitFor({ state: 'detached' });
      await ctx.close();
    }

    console.log('\n۲) پنلِ تأیید: بی‌ساعتِ عمل؛ نوعِ عمل از نوشتهٔ بیمار');
    {
      const near = await register(`پیشنهادی${T.key === 'dark' ? '' : ' دوم'}`, 'کرانیوتومی');
      const far = await register(`بی‌فهرست${T.key === 'dark' ? '' : ' دوم'}`, T.typed);
      for (const t of [near, far]) await upload(`/public/intake/form/${t}/receipt`);
      const { ctx, p } = await context(T.key);
      await browserLogin(p, auth, { ui: UI });
      await p.goto(`${UI}/app/intake`, { waitUntil: 'networkidle' });
      const open = async (last) => {
        const card = p.locator('.ia-card', { hasText: last }).first();
        await card.waitFor();
        await card.locator('.ia-facts').click();
        const sheet = p.locator('.ia-sheet');
        await sheet.getByRole('button', { name: /تأیید و ساختِ مراجعه/ }).waitFor();
        return sheet;
      };
      let sheet = await open(`پیشنهادی${T.key === 'dark' ? '' : ' دوم'}`);
      await sheet.locator('.ia-field', { hasText: 'تاریخِ عمل' }).first().waitFor();
      ok(await sheet.locator('.ia-field', { hasText: /ساعت/ }).count() === 0, '**«ساعتِ عمل» در تأییدِ شرکتی نیست**');
      ok(await sheet.locator('.ia-field', { hasText: 'تاریخِ عمل' }).count() === 1, 'تاریخِ عمل سرِ جایش است');
      await p.waitForFunction(() => [...document.querySelectorAll('.ia-sheet .ia-note')].some((n) => n.textContent.includes('کرانیوتومی مغز')));
      const note = (await sheet.locator('.ia-note', { hasText: 'کرانیوتومی مغز' }).first().innerText()).trim();
      ok(/پیشنهادی/.test(note) && note.includes('(بیمار نوشته: «کرانیوتومی»)'), '**نزدیک‌ترین پیشنهاد شد و نوشتهٔ بیمار کنارش است**', note);
      const px = sheet.locator('#approve-procedureTypeId');
      ok(await px.inputValue() !== '' && (await px.locator('option:checked').innerText()).includes('کرانیوتومی مغز'), 'کشویی روی «کرانیوتومی مغز» پیش‌پر شد');
      ok(await sheet.locator('.ia-px-typed').count() === 0, 'وقتی پیشنهاد هست هشدارِ «در فهرست نیست» نمی‌آید');
      ok(await hOverflow(p) <= 0, 'اسکرولِ افقی نیست');
      if (shots) {
        await px.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await p.screenshot({ path: `${shots}/company-flow-${T.key}-approve-near.png` });
      }
      await sheet.getByRole('button', { name: 'بستن' }).first().click();
      await sheet.waitFor({ state: 'detached' });

      sheet = await open(`بی‌فهرست${T.key === 'dark' ? '' : ' دوم'}`);
      const warn = sheet.locator('.ia-px-typed');
      await warn.waitFor();
      ok((await warn.innerText()).includes(`بیمار نوشته «${T.typed}»`), '**نوشتهٔ بیمار درست بالای کشویی** وقتی در فهرست نیست', await warn.innerText());
      ok(await sheet.locator('#approve-procedureTypeId').inputValue() === '', 'چیزی به‌زور انتخاب نشد');
      if (shots) { await warn.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${shots}/company-flow-${T.key}-approve-typed.png` }); }
      await sheet.getByRole('button', { name: 'افزودن نوعِ عمل' }).click();
      const quick = p.locator('.df-sheet');
      await quick.waitFor();
      const name = quick.locator('.pf-field', { has: p.locator(':scope > span', { hasText: /^عنوان/ }) }).first().locator('input');
      ok(await name.inputValue() === T.typed, `**«+» همان نوشته را پیش‌پر کرد** («${await name.inputValue()}»)`);
      if (shots) await p.screenshot({ path: `${shots}/company-flow-${T.key}-approve-quick.png` });
      if (T.save) {
        await quick.getByRole('button', { name: 'ذخیره' }).click();
        await quick.waitFor({ state: 'detached' });
        await p.waitForFunction(() => document.querySelector('#approve-procedureTypeId')?.value !== '');
        ok((await sheet.locator('#approve-procedureTypeId option:checked').innerText()).trim() === T.typed, 'ذخیره ← نوعِ عملِ تازه همان‌جا انتخاب شد');
        ok(await warn.count() === 0, 'و هشدار رفت');
        ok(!!(await db.procedureType.findFirst({ where: { name: T.typed } })), 'نوعِ عمل در تعریف‌ها ساخته شد');
      } else {
        await quick.getByRole('button', { name: 'انصراف' }).click();
        await quick.waitFor({ state: 'detached' });
        ok(await warn.count() === 1 && !(await db.procedureType.findFirst({ where: { name: T.typed } })), '«انصراف» چیزی نساخت و هشدار ماند');
      }
      ok(errs.length === 0, 'بی‌خطای JS تا این‌جا', errs[0]);
      await ctx.close();
    }

    console.log('\n۳) پنلِ کارشناس: وضعیتِ عمل');
    {
      const tech = await mkTech(`cf${T.key}`, T.fa === 'تیره' ? 'یکم' : 'دوم');
      const today = clinicDay(0);
      const [pa, pb, pc, pd] = T.people;
      const mk = async (last, time) => {
        const r = await api('/visits', { kind: 'surgery', firstName: 'علی', lastName: last, phone: phone(), hospitalId: hosp.id, surgeonId: surgeon.id, opDate: `${today}T00:00:00.000Z`, techId: tech.id, opStartTime: time }, 'POST', auth);
        if (!r.data?.id) throw new Error('مراجعه: ' + JSON.stringify(r.data).slice(0, 160));
        return r.data.id;
      };
      const ids = { a: await mk(pa, '08:00'), b: await mk(pb, '09:30'), c: await mk(pc, '11:00'), d: await mk(pd, '13:00') };
      const visit = (id) => db.visit.findUnique({ where: { id } });
      ok((await visit(ids.a)).service === 'ionm', 'مراجعهٔ تک‌خدمته خدمتِ `ionm` گرفت');

      const { ctx, p } = await context(T.key);
      await browserLogin(p, tech.token, { ui: UI });
      await p.goto(`${UI}/app/tech`, { waitUntil: 'networkidle' });
      const card = (last) => p.locator('article.tk-card', { hasText: last });
      await card(pa).waitFor();
      const toast = p.locator('.tk-toast.on');
      const openStatus = async (last) => {
        await card(last).getByRole('button', { name: 'وضعیتِ عمل' }).tap();
        const sheet = p.locator('.tk-sheet');
        await sheet.getByRole('radiogroup', { name: 'وضعیتِ عمل' }).waitFor();
        return sheet;
      };
      ok(await card(pa).getByRole('button', { name: 'وضعیتِ عمل' }).count() === 1, 'روی کارتِ عملِ در انتظار دکمهٔ «وضعیتِ عمل» هست');
      ok((await card(pa).innerText()).includes('آپلودِ گزارشِ نورومانیتورینگ'), '**دکمهٔ گزارش «آپلودِ گزارشِ نورومانیتورینگ»** — نه «گزارشِ عمل»');
      const btn = await card(pa).getByRole('button', { name: 'وضعیتِ عمل' }).boundingBox();
      ok(btn && btn.height >= 40, `هدفِ لمسیِ دکمه کافی است (${Math.round(btn?.height ?? 0)})`);
      if (shots) await p.screenshot({ path: `${shots}/company-flow-${T.key}-tech-list.png`, fullPage: true });

      /* الف) موکول به گذشته ← پیامِ روشن، هیچ تغییری؛ بعد بی‌تاریخ. */
      let sheet = await openStatus(pa);
      const choices = (await sheet.locator('[role="radio"] b').allInnerTexts()).map((t) => t.trim()).join('|');
      ok(choices === 'انجام شد|موکول شد|لغو شد', 'سه گزینه: انجام شد، موکول شد، لغو شد', choices);
      const cta = sheet.locator('.tk-save');
      ok(await cta.isDisabled() && (await cta.innerText()).includes('یکی را انتخاب کنید'), 'بی‌انتخاب دکمهٔ ثبت غیرفعال است');
      await sheet.getByRole('radio', { name: /موکول شد/ }).tap();
      ok(await sheet.getByRole('radio', { name: /موکول شد/ }).getAttribute('aria-checked') === 'true', 'گزینهٔ انتخاب‌شده aria-checked دارد');
      const date = sheet.locator('.tk-field input');
      ok(await date.count() === 1 && (await cta.innerText()).includes('بی‌تاریخ'), 'کادرِ «تاریخِ تازه (اختیاری)» آمد؛ خالی ← «ثبت: موکول، بی‌تاریخ»');
      await date.fill(ymdToJStr(clinicDay(-1)));
      ok((await cta.innerText()).includes('موکول به همین تاریخ'), 'با تاریخ ← «ثبت: موکول به همین تاریخ»');
      await cta.tap();
      await sheet.getByRole('alert').waitFor();
      ok((await sheet.getByRole('alert').innerText()).includes('امروز یا بعد از آن'), '**موکول به گذشته پیامِ فارسیِ روشن می‌گیرد**', await sheet.getByRole('alert').innerText());
      ok(String((await visit(ids.a)).opDate?.toISOString()).startsWith(today), '… و تاریخِ عمل دست نخورد');
      await date.fill('');
      await cta.tap();
      await sheet.waitFor({ state: 'detached' });
      await toast.waitFor();
      ok((await toast.innerText()).includes('تاریخِ تازه را مدیر می‌گذارد'), 'موکولِ بی‌تاریخ ← توست «تاریخِ تازه را مدیر می‌گذارد»', await toast.innerText());
      await card(pa).waitFor({ state: 'detached' });
      const a = await visit(ids.a);
      ok(a.opDate === null && a.opStatus === 'pending', 'عمل از دفترِ امروز رفت؛ روی سرور بی‌تاریخ و هنوز «در انتظار»');

      /* ب) موکول به سه روزِ بعد. */
      sheet = await openStatus(pb);
      await sheet.getByRole('radio', { name: /موکول شد/ }).tap();
      const later = clinicDay(3);
      await sheet.locator('.tk-field input').fill(ymdToJStr(later));
      if (shots) await p.screenshot({ path: `${shots}/company-flow-${T.key}-tech-postpone.png` });
      await sheet.locator('.tk-save').tap();
      await sheet.waitFor({ state: 'detached' });
      await p.waitForFunction((t) => document.querySelector('.tk-toast.on')?.textContent.includes(t), `موکول شد به ${faDate(later)}`);
      ok(true, `توست «موکول شد به ${faDate(later)}»`);
      ok((await visit(ids.b)).opDate?.toISOString().startsWith(later), 'تاریخِ تازه روی سرور نشست');

      /* ج) انجام شد — شروع ثبت شده و پایان خالی: همان‌جا ساعت را می‌پرسد و پایان با «الان» پیش‌پر
         است (بازبینیِ UX company-15)؛ «انجام شد» پیش از این گام روی سرور نشسته است. */
      sheet = await openStatus(pc);
      await sheet.getByRole('radio', { name: /انجام شد/ }).tap();
      ok((await sheet.locator('.tk-field').count()) === 0 && (await sheet.locator('.tk-save').innerText()).includes('ثبت: انجام شد'), '«انجام شد» کادرِ تاریخ ندارد');
      await sheet.locator('.tk-save').tap();
      await sheet.locator('.tk-done-note').waitFor();
      const tp = sheet.locator('.tp-input');
      const [st, en] = [await tp.nth(0).inputValue(), await tp.nth(1).inputValue()];
      ok(st === '۱۱:۰۰' && /^[۰-۹]{2}:[۰-۹]{2}$/.test(en), '**پس از «انجام شد» ساعتِ خالی همان‌جا پرسیده شد** — شروع ۱۱:۰۰، پایان با «الان» پیش‌پر', `${st} | ${en}`);
      ok((await visit(ids.c)).opStatus === 'done', '… و «انجام شد» پیش از پرسشِ ساعت روی سرور نشسته');
      await sheet.getByRole('button', { name: 'ذخیرهٔ ساعت' }).tap();
      await sheet.waitFor({ state: 'detached' });
      await p.waitForFunction(() => document.querySelector('.tk-toast.on')?.textContent.includes('انجام شد'));
      await card(pc).locator('.tk-tag.ok').waitFor();
      ok(await card(pc).getByRole('button', { name: 'وضعیتِ عمل' }).count() === 0, '**کارت «انجام‌شده» شد و دکمهٔ وضعیت از رویش رفت**');
      const cRow = await visit(ids.c);
      ok(cRow.opStatus === 'done' && /^\d{2}:\d{2}$/.test(cRow.opEndTime ?? ''), 'روی سرور «انجام شد» و ساعتِ پایان هم نشست', cRow.opEndTime);

      /* د) لغو — پنجرهٔ مشترکِ دلیل؛ «انصراف» به همان شیت برمی‌گردد. */
      sheet = await openStatus(pd);
      await sheet.getByRole('radio', { name: /لغو شد/ }).tap();
      ok((await sheet.locator('.tk-save').innerText()).includes('ادامه: دلیلِ لغو'), '«لغو شد» ← «ادامه: دلیلِ لغو»');
      await sheet.locator('.tk-save').tap();
      const cr = p.locator('.cr-sheet');
      await cr.waitFor();
      ok(await p.locator('.tk-sheet').count() === 0, 'پنجرهٔ دلیل **به‌جای** شیت آمد، نه رویش');
      await cr.getByRole('button', { name: 'انصراف' }).click();
      await p.locator('.tk-sheet').waitFor();
      ok(await p.locator('.tk-sheet').getByRole('radio', { name: /لغو شد/ }).getAttribute('aria-checked') === 'true', '«انصراف» به همان شیت برگشت، با همان انتخاب');
      await p.locator('.tk-sheet .tk-save').tap();
      await cr.waitFor();
      const submit = cr.getByRole('button', { name: 'ثبتِ لغو' });
      ok(await submit.isDisabled(), 'لغوِ بی‌دلیل ممکن نیست');
      await cr.locator('.cr-reason').first().click();
      ok((await cr.locator('.cr-sms').innerText()).includes('پیامکِ بیمار'), 'پیش‌نمایشِ پیامکِ بیمار دیده می‌شود');
      if (shots) await p.screenshot({ path: `${shots}/company-flow-${T.key}-tech-cancel.png` });
      await submit.click();
      await cr.waitFor({ state: 'detached' });
      await p.waitForFunction(() => document.querySelector('.tk-toast.on')?.textContent.includes('لغو شد'));
      /* دفترِ «امروز» و «پیشِ رو» عملِ لغوشده را نشان نمی‌دهد (کارِ کسی نیست)؛ «گذشته» نشانش می‌دهد. */
      await card(pd).waitFor({ state: 'detached' });
      const dRow = await visit(ids.d);
      ok(dRow.opStatus === 'cancelled' && !!dRow.cancelReason, `روی سرور «لغو» با دلیل (${dRow.cancelReason}) و کارت از دفترِ امروز رفت`);
      ok(await hOverflow(p) <= 0, 'اسکرولِ افقی نیست');
      if (shots) await p.screenshot({ path: `${shots}/company-flow-${T.key}-tech-after.png`, fullPage: true });
      await ctx.close();

      /* پرونده: مراجعه «نورومانیتورینگ» نام دارد، نه «فرمِ عمل» (بندِ ۴ِ مالک). */
      const adm = await context(T.key);
      await browserLogin(adm.p, auth, { ui: UI });
      await adm.p.goto(`${UI}/app/patients/${(await visit(ids.c)).patientId}`, { waitUntil: 'networkidle' });
      const kind = adm.p.locator('.rc-kind').first();
      await kind.waitFor();
      ok((await kind.innerText()).trim() === 'نورومانیتورینگ', '**پرونده: مراجعه «نورومانیتورینگ» نام دارد** — نه «فرمِ عمل»', await kind.innerText());
      if (shots) { await kind.scrollIntoViewIfNeeded(); await adm.p.screenshot({ path: `${shots}/company-flow-${T.key}-record.png` }); }
      await adm.ctx.close();
    }
  }

  console.log('\n۴) کارهای رویدادی: دکمهٔ اصلی خودِ کار است، نه «انجام شد»ِ خالی');
  {
    const tech = await mkTech('cfw', 'چهارم');
    const past = clinicDay(-2);
    const mkPast = async (last) => {
      const r = await api('/visits', { kind: 'surgery', firstName: 'رضا', lastName: last, phone: phone(), hospitalId: hosp.id, surgeonId: surgeon.id, opDate: `${past}T00:00:00.000Z`, techId: tech.id, opStartTime: '10:00' }, 'POST', auth);
      if (!r.data?.id) throw new Error('مراجعه: ' + JSON.stringify(r.data).slice(0, 160));
      return r.data;
    };
    const vs = await mkPast('وضعیت‌نگرفته');
    const vd = await mkPast('کنارگذاشتنی');
    const vr = await mkPast('بی‌گزارش');
    await api(`/visits/${vr.id}/status`, { opStatus: 'done' }, 'PATCH', auth);
    await api('/work/process', {}, 'POST', auth);
    const work = (type, visitId) => db.workItem.findUnique({ where: { idempotencyKey: `${type}:visit:${visitId}` } });
    ok((await work('confirm_surgery_done', vs.id))?.state === 'open' && (await work('complete_report', vr.id))?.state === 'open', 'آشکارساز کارهای رویدادی را ساخت');
    const { ctx, p } = await context('dark');
    await browserLogin(p, auth, { ui: UI });
    const next = async (pid) => {
      await p.goto(`${UI}/app/patients/${pid}`, { waitUntil: 'networkidle' });
      const row = p.locator('.rc-next-main .wk-row');
      await row.waitFor();
      return row;
    };
    const gone = () => p.waitForFunction(() => !document.querySelector('.rc-next-main .wk-row'), null, { timeout: 10000 }).catch(() => {});

    /* الف) «ثبتِ وضعیت» ← همان پنجرهٔ سه‌گزینه‌ایِ پنلِ کارشناس؛ کار با رویدادِ واقعی بسته می‌شود. */
    let row = await next(vs.patientId);
    ok(await row.getByRole('button', { name: 'انجام شد', exact: true }).count() === 0, '**نباید بیفتد:** «انجام شد»ِ خالی روی کارِ رویدادی');
    await row.getByRole('button', { name: 'ثبتِ وضعیت' }).tap();
    const sheet = p.locator('.tk-sheet');
    await sheet.getByRole('radiogroup', { name: 'وضعیتِ عمل' }).waitFor();
    const opts = (await sheet.locator('[role="radio"] b').allInnerTexts()).map((t) => t.trim()).join('|');
    ok(opts === 'انجام شد|موکول شد|لغو شد', '**«ثبتِ وضعیت» همان پنجرهٔ سه‌گزینه‌ایِ پنلِ کارشناس را باز کرد**', opts);
    await sheet.getByRole('radio', { name: /موکول شد/ }).tap();
    await sheet.locator('.tk-save').tap();
    await sheet.waitFor({ state: 'detached' });
    await gone();
    const ws = await work('confirm_surgery_done', vs.id);
    ok(ws?.state === 'done' && ws?.outcome?.closedBy === 'event', '**کار با رویدادِ واقعی («موکول شد») همان لحظه بسته شد**', JSON.stringify([ws?.state, ws?.outcome]));

    /* ب) «بستن بدونِ اقدام» — پرسشِ تأیید؛ عمل دست نمی‌خورد. */
    row = await next(vd.patientId);
    await row.getByRole('button', { name: 'بستن بدونِ اقدام' }).tap();
    const ask = row.locator('.wk-dismiss');
    await ask.waitFor();
    ok((await ask.innerText()).includes('وضعیتِ عمل ثبت نمی‌شود'), 'پرسشِ تأیید می‌گوید چه چیزی ثبت **نمی‌شود**', await ask.innerText());
    if (shots) await p.screenshot({ path: `${shots}/company-flow-work-dismiss.png` });
    await ask.getByRole('button', { name: 'بله، ببند' }).tap();
    await gone();
    const wd = await work('confirm_surgery_done', vd.id);
    ok(wd?.state === 'done' && wd?.outcome?.closedBy === 'dismiss' && (await db.visit.findUnique({ where: { id: vd.id } })).opStatus === 'pending',
      '«بستن بدونِ اقدام»: یادآوری بسته شد ولی عمل «در انتظار» ماند', JSON.stringify([wd?.state, wd?.outcome]));

    /* ج) «بارگذاریِ گزارش» ← کادرِ فایل؛ گزارش که آمد کار بسته است. */
    row = await next(vr.patientId);
    await row.getByRole('button', { name: 'بارگذاریِ گزارش' }).tap();
    const pop = p.locator('.rc-pop-report');
    await pop.waitFor();
    await pop.locator('input[type="file"]').setInputFiles(photo(1));
    await pop.waitFor({ state: 'detached', timeout: 15000 });
    await gone();
    const wr = await work('complete_report', vr.id);
    ok(wr?.state === 'done' && (await db.document.count({ where: { visitId: vr.id, category: 'report' } })) === 1,
      '**«بارگذاریِ گزارش» فایل را گذاشت و کار با همان بسته شد**', wr?.state);
    ok(errs.length === 0, 'بی‌خطای JS', errs[0]);
    await ctx.close();
  }
} finally {
  console.log('\n' + '─'.repeat(50));
  console.log(`قبول: ${pass}   رد: ${fail}`);
  console.log('خطای جاوااسکریپت:', errs.length ? errs : 'ندارد');
  await b.close();
  await db.$disconnect();
}
process.exit(fail || errs.length ? 1 : 0);
