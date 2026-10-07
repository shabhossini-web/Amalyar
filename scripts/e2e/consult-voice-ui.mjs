/**
 * صدای ضبط‌شده در فرمِ مشاوره (شیتِ سفارش) — سرورِ زنده + مرورگرِ واقعی.
 *
 * گزارشِ مالک (۱۴۰۵/۰۷/۱۵، با عکس): «ویس‌هایی که توی فرمِ مشاوره ثبت می‌شود و بهش اتچ می‌شود نشان
 * داده نمی‌شود». دو راهِ ورودِ صدا به یک فرمِ مشاوره هست و هر دو باید در همان فرم دیده و پخش شوند:
 *   ۱) بیمار/پزشکِ مشاور روی لینکِ عمومیِ `/o/:token` صدا می‌فرستد؛
 *   ۲) کارمند توی خودِ شیت «ضبطِ توضیحِ صوتی» را می‌زند (تلفنی شنیده، می‌خواهد نگه دارد).
 *
 *  باید بیفتد:
 *   - صدای بیمار در شیت **پخش‌کنندهٔ دیدنی** است (نه چیپی شبیهِ برچسب) و با یک لمس پخش می‌شود
 *   - صدایی که کارمند توی شیت ضبط کرد **همان‌جا** دیده می‌شود، به همان سفارش وصل است و پس از
 *     بستن و بازکردنِ دوباره هم هست
 *   - پخش یک بار بارگیری می‌کند و `<audio>` واقعاً بایتِ WAV می‌گیرد (duration > 0)
 *  نباید بیفتد:
 *   - صدای کارمند سفارشِ بی‌پاسخ را «answered» کند (توضیحِ صوتی پاسخ نیست)
 *   - صدای مدارکِ **مراجعهٔ دیگر** در شیتِ این سفارش بیاید
 *   - هیچ خطای JS/کنسول
 */
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { browserLogin } from './lib/browser-login.mjs';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const EXE = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium';
const SHOTS = process.env.E2E_SHOTS ?? '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const H = { Authorization: 'Bearer ' + login.accessToken };
const send = (p, method = 'GET', body) => fetch(API + p, {
  method, headers: { ...H, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

/** WAVِ واقعی: PCMِ ۱۶بیتیِ تک‌کانالهٔ ۱۶ کیلوهرتز — همان خروجیِ `wav-recorder.js`. */
function wav(seconds = 1.2) {
  const rate = 16000, n = Math.round(rate * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8, 'latin1');
  b.write('fmt ', 12, 'latin1'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1'); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 3000), 44 + i * 2);
  return b;
}
const WAV = wav();

const kinds = (await send('/forms/visit-kinds')).json ?? [];
if (!kinds.some((k) => (k.kind ?? k.key) === 'clinic')) await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });

const RUN = Math.floor(Date.now() / 1000) % 100_000_000;
console.log('۱) سفارشِ مشاوره — بیمار با لینکِ عمومی صدا می‌فرستد');
const visit = (await send('/visits', 'POST', {
  kind: 'clinic', firstName: 'بیمارِ', lastName: `ویسِ مشاوره ${RUN}`, phone: '09120000981', opDate: new Date().toISOString(),
})).json;
ok('مراجعه ساخته شد', !!visit?.id, JSON.stringify(visit).slice(0, 140));
const other = (await send('/visits', 'POST', {
  kind: 'clinic', firstName: 'بیمارِ', lastName: `دیگر ${RUN}`, phone: '09120000982', opDate: new Date().toISOString(),
})).json;
const order = (await send('/orders/consult', 'POST', { patientId: visit.patientId, visitId: visit.id, specialty: 'قلب', doctorName: 'دکتر کریمی', note: 'لطفاً نظر بدهید' })).json;
ok('سفارشِ مشاوره با توکنِ عمومی', !!order?.id && !!order?.token, JSON.stringify(order).slice(0, 140));
await send(`/orders/consult/${order.id}/send`, 'POST');

const fd = new FormData();
fd.append('file', new Blob([WAV], { type: 'audio/wav' }), 'voice.wav');
const up = await fetch(`${API}/public/order/${order.token}/files`, { method: 'POST', body: fd });
ok('صدای بیمار روی لینکِ عمومی نشست', up.ok, `HTTP ${up.status}`);
const ans = await fetch(`${API}/public/order/${order.token}/answer`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'نرمال', link: '', user: '', pass: '' }),
}).then((r) => r.json());
ok('پاسخ ثبت شد', ans?.status === 'answered', JSON.stringify(ans));

/* صدای **مراجعهٔ دیگر** — نباید در شیتِ این سفارش بیاید. */
const foreignFd = new FormData();
foreignFd.append('file', new Blob([WAV], { type: 'audio/wav' }), 'foreign.wav');
foreignFd.append('category', 'other'); foreignFd.append('title', 'صدای مراجعهٔ دیگر'); foreignFd.append('visitId', String(other.id));
await fetch(`${API}/patients/${other.patientId}/documents`, { method: 'POST', headers: H, body: foreignFd });

const orderRow = async () => ((await send(`/orders?visitId=${visit.id}`)).json ?? []).find((o) => o.kind === 'consult' && o.id === order.id);

console.log('\n۲) مرورگر — صدای بیمار در شیت دیده و پخش می‌شود');
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, locale: 'fa-IR' });
await ctx.grantPermissions(['microphone'], { origin: UI });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 160)); });
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };
const openSheet = async () => {
  await page.goto(`${UI}/app/dashboard?patient=${visit.id}`, { waitUntil: 'networkidle' });
  await page.locator('.db-orders .db-order').first().waitFor({ timeout: 15000 });
  await page.locator('.db-orders .db-order button').first().click();
  await page.locator('.od-sheet').waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
};
try {
  await browserLogin(page, login.accessToken);
  await openSheet();
  await shot('consult-voice-01-sheet');

  const clip = page.locator('.od-doc [data-voice-clip]').first();
  ok('صدای بیمار در فهرستِ پاسخ هست', (await clip.count()) === 1);
  const clipBox = await clip.locator('button').first().boundingBox().catch(() => null);
  ok('پخش‌کننده روی صفحه دیده می‌شود و هدفِ لمسِ ۴۴ پیکسلی دارد', !!clipBox && clipBox.height >= 44 && clipBox.width >= 180, JSON.stringify(clipBox));
  ok('پخش‌کننده «برای پخش بزنید» می‌گوید (نه چیپِ برچسب)', (await clip.innerText()).includes('برای پخش بزنید'), await clip.innerText());
  /* یک لمس: بارگیری + پخش. */
  await clip.locator('button').first().tap();
  const audio = page.locator('.od-doc audio').first();
  await audio.waitFor({ timeout: 8000 }).catch(() => {});
  ok('پس از لمس، `<audio>` ساخته شد', (await audio.count()) === 1);
  const info = await audio.evaluate((a) => new Promise((res) => {
    const done = () => res({ rs: a.readyState, d: a.duration, err: a.error?.code ?? 0 });
    if (a.readyState >= 1) return done();
    a.addEventListener('loadedmetadata', done, { once: true });
    a.addEventListener('error', done, { once: true });
    setTimeout(done, 6000);
  })).catch(() => null);
  ok('**WAV واقعاً بارگیری شد** (duration > 0، بدونِ خطای رسانه)', !!info && info.d > 0.5 && info.err === 0, JSON.stringify(info));
  await shot('consult-voice-02-playing');

  console.log('\n۳) کارمند توی شیت صدا ضبط می‌کند — همان‌جا دیده می‌شود');
  const before = num(`SELECT count(*) FROM documents WHERE patient_id=${visit.patientId} AND mime_type='audio/wav' AND deleted_at IS NULL`);
  const note = page.locator('.od-voice [data-voice-note]');
  ok('ضبطِ توضیحِ صوتی در شیت هست', (await note.count()) === 1);
  await note.locator('button.vc-btn').tap();
  await page.waitForFunction(() => document.querySelector('.od-voice [data-voice-note]')?.getAttribute('data-voice-note') === 'rec', null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await note.locator('button.vc-rec').tap();
  await page.waitForTimeout(300);
  ok('پیش‌نمایشِ ضبط آمد', (await note.getAttribute('data-voice-note')) === 'review');
  await note.locator('[data-voice-save]').tap();
  await page.waitForFunction(() => document.querySelector('.od-voice [data-voice-note]')?.getAttribute('data-voice-note') === 'idle', null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
  const after = num(`SELECT count(*) FROM documents WHERE patient_id=${visit.patientId} AND mime_type='audio/wav' AND deleted_at IS NULL`);
  ok('سرور صدا را پذیرفت', after === before + 1, `${before} → ${after}`);
  await shot('consult-voice-03-after-save');

  const clips = await page.locator('.od-doc [data-voice-clip]').count();
  ok('**صدای ضبط‌شده همان‌جا در شیت دیده می‌شود** (دو صدا: بیمار + کارمند)', clips === 2, `clips=${clips}`);
  ok('صدای مراجعهٔ دیگر در این شیت نیامد',
    !(await page.locator('.od-sheet').innerText()).includes('مراجعهٔ دیگر'));
  const staffDoc = num(`SELECT id FROM documents WHERE patient_id=${visit.patientId} AND mime_type='audio/wav' AND deleted_at IS NULL AND title LIKE 'توضیحِ صوتی — %' ORDER BY id DESC LIMIT 1`);
  ok('صدای کارمند به **همین سفارش** وصل شد', sql(`SELECT coalesce(ref_type,'-') || ':' || coalesce(ref_id::text,'-') FROM documents WHERE id=${staffDoc}`) === `consult_order:${order.id}`,
    sql(`SELECT coalesce(ref_type,'-') || ':' || coalesce(ref_id::text,'-') FROM documents WHERE id=${staffDoc}`));

  /* بستن و بازکردنِ دوباره — «ثبت شد» یعنی ماندگار. */
  await page.keyboard.press('Escape');
  await page.locator('.od-sheet').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await openSheet();
  ok('پس از بازکردنِ دوباره هر دو صدا هست', (await page.locator('.od-doc [data-voice-clip]').count()) === 2);
  await shot('consult-voice-04-reopened');

  const row = await orderRow();
  ok('وضعیتِ سفارش «answered» ماند و هر دو صدا در `documents`ِ سفارش‌اند',
    row?.status === 'answered' && (row?.documents ?? []).filter((d) => String(d.mimeType).startsWith('audio/')).length === 2,
    `status=${row?.status} audio=${(row?.documents ?? []).filter((d) => String(d.mimeType).startsWith('audio/')).length}`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('بدونِ سرریزِ افقی روی موبایل', overflow <= 1, overflow + 'px');
  ok('هیچ خطای JS/کنسول', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

console.log(`\nقبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
