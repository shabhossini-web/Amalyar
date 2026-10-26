/**
 * فرمِ خدمتِ شرکتی به‌جای فرمِ عمل — تصمیمِ مالک (۱۴۰۵/۰۸/۰۴): «فرمِ عمل برای نورومانیتورینگ لود می‌شود…
 * فرمِ خدمتِ نورومانیتورینگ باید لود شود: کارشناس‌ها و ساعتشان، جراح و عمل، دستگاه، مصرفی‌ها، گزارش».
 *
 *  باید بیفتد:
 *   - تیمِ کارشناسی با ساعتِ هر نفر ثبت می‌شود؛ اولی `techId` می‌شود؛ عضوِ دوم هم عمل را در پنلش می‌بیند
 *   - دستگاه از دارایی‌های انبار؛ همان دستگاه روزِ دیگری سرِ مراجعهٔ دیگری بی‌هشدار، همان روز با هشدار
 *   - گزارشِ کارشناس از فرمِ خدمت بارگذاری می‌شود
 *   - فرمِ مراجعهٔ شرکتی زبانه‌های «پرونده و مشخصات» + «خدمت» دارد، نه «قبل/حین/بعد از عمل»
 *  نباید بیفتد:
 *   - ساعتِ خروجِ پیش از ورود، کارشناسِ تکراری، کالای غیرِدستگاه
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { browserLogin } from './lib/browser-login.mjs';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB;
const SHOTS = process.env.E2E_SHOTS;
if (!DB || ![API, DB].every((u) => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log(`  ✘ ${m}${d ? ` — ${d}` : ''}`); } };
const j = async (r) => ({ status: r.status, data: await r.json().catch(() => null) });
const call = (token, path, body, method = body ? 'POST' : 'GET') => fetch(API + path, { method,
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(j);
const set = (key, value) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
const tag = randomBytes(3).toString('hex');
const errs = [];

await set('vertical', 'ionm'); await set('services', JSON.stringify(['ionm']));
const admin = (await j(await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'test1234' }) }))).data?.accessToken;
if (!admin) throw new Error('ورود نشد');
const A = (p, b, m) => call(admin, p, b, m);

const hash = await bcrypt.hash('test1234', 4);
const mkTech = async (n) => db.account.create({ data: { username: `${tag}t${n}`, passwordHash: hash, level: 2, status: 'active',
  person: { create: { firstName: `کارشناس${n}`, lastName: tag } } } });
const t1 = await mkTech(1), t2 = await mkTech(2);
const hospital = await db.hospital.create({ data: { name: `بیمارستانِ ${tag}` } });
const surgeon = await db.surgeon.create({ data: { person: { create: { firstName: 'دکتر', lastName: `جراح${tag}` } } } });
const item = await db.item.create({ data: { name: `دستگاهِ ${tag}`, assetKind: 'device', unit: 'دستگاه' } });
const lot = await db.stockLot.create({ data: { itemId: item.id, serialNo: `SN-${tag}` } });
const cons = await db.item.create({ data: { name: `ست ${tag}`, assetKind: 'consumable', unit: 'عدد' } });
const consLot = await db.stockLot.create({ data: { itemId: cons.id, lotNo: `L-${tag}` } });

const op = new Date(Date.now() + 2 * 864e5);
const mkVisit = async (n) => (await A('/visits', { kind: 'surgery', firstName: 'بیمارِ', lastName: `خدمت${n}${tag}`, opDate: op.toISOString(), hospitalId: hospital.id, surgeonId: surgeon.id, opStartTime: '08:00' })).data;
const v1 = await mkVisit(1), v2 = await mkVisit(2);

try {
  console.log('۱) تیمِ کارشناسی با ساعت');
  ok(!!v1?.id && !!v2?.id, 'دو مراجعهٔ خدمت ساخته شد', JSON.stringify(v1).slice(0, 120));
  const crew = await A(`/visits/${v1.id}/service/crew`, { crew: [
    { accountId: t1.id, fromTime: '08:00', toTime: '10:30' }, { accountId: t2.id, fromTime: '۰۹:۰۰', toTime: '12:00' }] }, 'PUT');
  ok(crew.status === 200 && crew.data?.crew?.length === 2, '**دو کارشناس با ساعتِ خودشان ثبت شد**', JSON.stringify(crew.data).slice(0, 160));
  ok(crew.data?.crew?.[1]?.fromTime === '09:00', 'ارقامِ فارسیِ ساعت نرمال شد', crew.data?.crew?.[1]?.fromTime);
  ok((await db.visit.findUnique({ where: { id: v1.id } })).techId === t1.id, '**اولی کارشناسِ اصلی (`techId`) شد**');
  ok((await A(`/visits/${v1.id}/service/crew`, { crew: [{ accountId: t1.id, fromTime: '10:00', toTime: '09:00' }] }, 'PUT')).status === 400, 'خروج پیش از ورود رد می‌شود');
  ok((await A(`/visits/${v1.id}/service/crew`, { crew: [{ accountId: t1.id }, { accountId: t1.id }] }, 'PUT')).status === 400, 'کارشناسِ تکراری رد می‌شود');

  const t2tok = (await j(await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: `${tag}t2`, password: 'test1234' }) }))).data?.accessToken;
  const agenda = t2tok ? await call(t2tok, '/tech/agenda?scope=upcoming') : { status: 0 };
  const rows = agenda.data?.visits ?? [];
  ok(rows.some((r) => r.id === v1.id), '**کارشناسِ دوم عمل را در پنلِ خودش می‌بیند**', `status=${agenda.status} rows=${rows.length}`);

  console.log('\n۲) دستگاه');
  const opts = await A(`/visits/${v1.id}/service/devices`);
  ok(opts.data?.some?.((d) => d.lotId === lot.id), 'دستگاهِ انبار در فهرست هست', JSON.stringify(opts.data).slice(0, 160));
  ok(!opts.data?.some?.((d) => d.lotId === consLot.id), 'کالای مصرفی دستگاه حساب نمی‌شود');
  ok((await A(`/visits/${v1.id}/service/device`, { lotId: consLot.id }, 'PUT')).status === 404, 'کالای غیرِدستگاه رد می‌شود');
  const dv = await A(`/visits/${v1.id}/service/device`, { lotId: lot.id }, 'PUT');
  ok(dv.data?.device?.lotId === lot.id && dv.data.device.clash.length === 0, '**دستگاه ثبت شد، بی‌تعارض**');
  const dv2 = await A(`/visits/${v2.id}/service/device`, { lotId: lot.id }, 'PUT');
  ok(dv2.data?.device?.clash?.length === 1 && dv2.data.device.clash[0].visitId === v1.id, '**همان دستگاه همان روز سرِ مراجعهٔ دیگر هشدار می‌دهد**', JSON.stringify(dv2.data?.device));
  const opts2 = await A(`/visits/${v2.id}/service/devices`);
  ok(opts2.data?.find((d) => d.lotId === lot.id)?.usedBy?.length === 1, 'فهرستِ دستگاه‌ها می‌گوید سرِ کدام مراجعه است');
  await A(`/visits/${v2.id}/service/device`, { lotId: null }, 'PUT');

  console.log('\n۳) گزارشِ کارشناس');
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048)])], { type: 'image/jpeg' }), 'report.jpg');
  const rep = await j(await fetch(`${API}/visits/${v1.id}/service/report`, { method: 'POST', headers: { Authorization: 'Bearer ' + admin }, body: fd }));
  ok(rep.status === 201 && rep.data?.reports?.length === 1, '**گزارش از فرمِ خدمت بارگذاری شد**', `status=${rep.status}`);

  console.log('\n۴) مرورگر — فرمِ خدمت به‌جای فرمِ عمل');
  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    for (const [w, h, name] of [[1280, 1000, 'desk'], [390, 860, 'phone']]) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      page.on('pageerror', (e) => errs.push(String(e)));
      await browserLogin(page, admin, { ui: UI });
      await page.goto(`${UI}/app/patients/${v1.patientId}`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: /مراجعه‌ها|خدمت‌ها|مراجعات/ }).first().click().catch(() => {});
      await page.locator('.rc-visit-btn').first().click();
      await page.locator('.db-sheet').waitFor({ timeout: 10000 });
      const tabs = page.locator('.vf-svctabs [role="tab"]');
      await tabs.first().waitFor({ timeout: 8000 });
      const labels = await tabs.allInnerTexts();
      if (name === 'desk') {
        ok(labels.length === 2 && labels[0].includes('پرونده') && labels[1].includes('خدمت'), '**زبانه‌ها: «پرونده و مشخصات» + «خدمت»**', labels.join(' | '));
        ok(await page.getByRole('tab', { name: 'قبل از عمل', exact: true }).count() === 0, '**زبانه‌های قبل/حین/بعد از عمل نیست**');
      }
      await page.locator('[data-service-panel] [data-crew-row]').first().waitFor({ timeout: 8000 });
      /* تیم و دستگاه و گزارش از سرور می‌آیند — منتظرِ خودِ نتیجه، نه ساعت. */
      await page.waitForFunction((sn) => document.querySelectorAll('[data-crew-row]').length === 2
        && (document.querySelector('[data-sv="device"]')?.innerText ?? '').includes(sn)
        && document.querySelectorAll('[data-sv="report"] .sv-thumb, [data-sv="report"] .sv-file').length === 1, `SN-${tag}`, { timeout: 10000 }).catch(() => {});
      if (name === 'desk') {
        ok(await page.locator('[data-crew-row]').count() === 2, 'زبانهٔ خدمت هر دو کارشناس را دارد');
        ok((await page.locator('[data-sv="device"]').innerText()).includes(`SN-${tag}`), 'دستگاهِ ثبت‌شده دیده می‌شود');
        ok(await page.locator('[data-sv="report"] .sv-thumb, [data-sv="report"] .sv-file').count() === 1, 'گزارش در زبانهٔ خدمت هست');
        const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        ok(ov <= 1, `بی‌سرریزِ افقی (${ov}px)`);
      }
      if (SHOTS) {
        for (const theme of ['dark', 'light']) {
          await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
          await page.waitForTimeout(250);
          await page.locator('.db-sheet').screenshot({ path: `${SHOTS}/service-panel-${name}-${theme}.png` });
          /* پایینِ زبانه (دستگاه، مصرفی، گزارش) هم دیده شود. */
          await page.locator('[data-sv="report"]').scrollIntoViewIfNeeded();
          await page.locator('.db-sheet').screenshot({ path: `${SHOTS}/service-panel-${name}-${theme}-2.png` });
        }
      }
      if (name === 'phone') {
        const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        ok(ov <= 1, `موبایل بی‌سرریزِ افقی (${ov}px)`);
      }
      await page.close();
    }
  } finally { await browser.close(); }
  ok(errs.length === 0, 'بی‌خطای JS', errs[0]);
} finally {
  for (const v of [v1, v2].filter((x) => x?.id)) {
    await db.document.deleteMany({ where: { visitId: v.id } }).catch(() => {});
    await db.visitCrew.deleteMany({ where: { visitId: v.id } }).catch(() => {});
  }
  await db.$disconnect();
}
console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
