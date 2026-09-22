/**
 * **توضیحِ صوتی زیرِ لینک‌ها و مدارک** (بستهٔ ۶د) — خواستهٔ مالک: «زیرِ جاهایی
 * که لینک وارد می‌کنند امکانِ ثبتِ صدا هم باشد».
 *
 *  باید بیفتد:
 *   - کارمند صدای WAV را روی پرونده می‌گذارد و پرونده آن را «صوتی» می‌شناسد
 *   - بیمار روی لینکِ عمومیِ سفارش صدا می‌فرستد (کنارِ عکس/PDF)
 *   - فرمِ عمومیِ ثبت‌نام: صدای یک ردیفِ باکسِ لینک آپلود می‌شود و پس از تأیید
 *     **زیرِ همان مدرکِ لینکی** و به همان مراجعه وصل می‌شود
 *   - ضبطِ واقعی در مرورگر (میکروفونِ ساختگیِ Chromium): رمزگذارِ WAVِ ما
 *     فایلی می‌سازد که سنجهٔ بایت‌محورِ سرور می‌پذیرد
 *  نباید بیفتد:
 *   - فایلی که فقط اسمش .wav است (بایتِ دیگر) به‌عنوانِ صدا پذیرفته شود
 *   - نشانیِ عمومیِ صدا روی کادری که باکسِ لینک نیست کار کند (آپلودرِ آزاد)
 *   - شناسهٔ صدای **بیمارِ دیگر** در ردیفِ لینک، آن صدا را به این پرونده بکشد
 */
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const EXE = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));

let TOKEN = '';
async function api(path, { method = 'GET', body, auth = true } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let json = null; try { json = JSON.parse(t); } catch { /* غیرJSON */ }
  return { status: r.status, json, text: t };
}
/** آپلودِ multipart — با یا بدونِ توکن. */
async function upload(path, buf, name, type, { auth = true, fields = {} } = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  const r = await fetch(API + path, { method: 'POST', body: fd, headers: auth ? { Authorization: 'Bearer ' + TOKEN } : {} });
  const t = await r.text();
  let json = null; try { json = JSON.parse(t); } catch { /* غیرJSON */ }
  return { status: r.status, json, text: t };
}

/** WAVِ واقعی: PCMِ ۱۶بیتیِ تک‌کانالهٔ ۱۶ کیلوهرتز — همان خروجیِ `wav-recorder.js`. */
function wav(seconds = 0.3) {
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
const FAKE = Buffer.from('<html><script>alert(1)</script></html>');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function nid(seed) {
  const base = String(seed % 1_000_000_000).padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(base[i]) * (10 - i);
  const r = sum % 11;
  return base + String(r < 2 ? r : 11 - r);
}
const RUN = Math.floor(Date.now() / 1000) % 100_000_000;

TOKEN = (await api('/auth/login', { method: 'POST', body: { identifier: USER, password: PASS } })).json?.accessToken;
if (!TOKEN) { console.error('ورود نشد'); process.exit(1); }

/* مراجعهٔ پایه — نوعِ clinic اگر در این نصب فرم ندارد ساخته می‌شود. */
const kinds = (await api('/forms/visit-kinds')).json ?? [];
if (!kinds.some((k) => (k.kind ?? k.key) === 'clinic')) await api('/forms', { method: 'POST', body: { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' } });
const mkVisit = async (last, phone) => (await api('/visits', { method: 'POST', body: {
  kind: 'clinic', firstName: 'بیمارِ', lastName: last, phone, opDate: new Date().toISOString(),
} })).json;

console.log('۱) کارمند — صدا روی پرونده');
const va = await mkVisit(`صوتی${RUN}`, '09120000971');
ok('مراجعهٔ پایه ساخته شد', !!va?.id, JSON.stringify(va).slice(0, 120));
{
  const r = await upload(`/patients/${va.patientId}/documents`, WAV, 'voice-staff.wav', 'audio/wav', { fields: { category: 'other', visitId: va.id } });
  ok('WAV روی پرونده نشست', r.status < 300 && !!r.json?.id, r.status + ' ' + r.text.slice(0, 140));
  const docs = (await api(`/patients/${va.patientId}/documents`)).json ?? [];
  const d = docs.find((x) => x.id === r.json?.id);
  ok('فهرستِ مدارک آن را «صوتی» می‌شناسد', d?.isAudio === true && d?.mimeType === 'audio/wav', JSON.stringify(d && { a: d.isAudio, m: d.mimeType }));
  const f = await fetch(`${API}/patients/documents/${r.json?.id}/file`, { headers: { Authorization: 'Bearer ' + TOKEN } });
  const bytes = Buffer.from(await f.arrayBuffer());
  ok('و همان بایت‌ها برای پخش برمی‌گردد (RIFF/WAVE)', f.ok && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WAVE',
    `HTTP ${f.status} · ${bytes.subarray(0, 12).toString('latin1')}`);
}

console.log('\n۲) لینکِ عمومیِ سفارش — بیمار صدا می‌فرستد');
{
  const order = (await api('/orders/lab', { method: 'POST', body: { patientId: va.patientId, visitId: va.id, tests: ['CBC'] } })).json;
  ok('سفارشِ آزمایش با توکنِ عمومی', !!order?.token, JSON.stringify(order).slice(0, 120));
  await api(`/orders/lab/${order.id}/send`, { method: 'POST' });
  const fake = await upload(`/public/order/${order.token}/files`, FAKE, 'voice.wav', 'audio/wav', { auth: false });
  ok('**نباید بیفتد:** HTML با پسوندِ .wav', fake.status === 400, fake.status + ' ' + fake.text.slice(0, 120));
  const good = await upload(`/public/order/${order.token}/files`, WAV, 'voice.wav', 'audio/wav', { auth: false });
  ok('WAVِ واقعی پذیرفته شد', good.status < 300 && !!good.json?.id, good.status + ' ' + good.text.slice(0, 120));
  ok('با عنوانِ «توضیحِ صوتیِ پاسخ» و نوعِ صوتی',
    sql(`SELECT mime_type || '|' || title FROM documents WHERE id=${good.json?.id}`).startsWith('audio/wav|توضیحِ صوتیِ پاسخ'),
    sql(`SELECT mime_type || '|' || title FROM documents WHERE id=${good.json?.id}`));
}

console.log('\n۳) فرمِ عمومیِ ثبت‌نام — صدا زیرِ ردیفِ لینک');
for (const l of ((await api('/intake/links')).json ?? []).filter((x) => /^\[vn]/.test(x.title))) {
  await api(`/intake/links/${l.id}`, { method: 'PATCH', body: { title: '[vn-old] ' + l.id, active: false, formId: 0, bankAccountId: 0 } });
}
let form = ((await api('/forms')).json ?? []).find((x) => x.key === 'visit.vnvisit');
if (form) {
  for (const fl of form.fields.filter((x) => !x.builtin)) await api(`/forms/fields/${fl.id}`, { method: 'DELETE' });
} else {
  form = (await api('/forms', { method: 'POST', body: { key: 'vnvisit', title: '[vn] ویزیت با لینکِ صوتی', scope: 'visit' } })).json;
}
await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'links', label: 'لینکِ تصاویر', type: 'links', docCategory: 'imaging' } });
await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'mri', label: 'عکسِ MRI', type: 'image', docCategory: 'imaging' } });
await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'story', label: 'شرحِ ماجرا', type: 'textarea' } });
const link = (await api('/intake/links', { method: 'POST', body: { title: '[vn] لینکِ صوتی', amount: 0, formId: form.id } })).json;
if (!link?.token) { console.error('لینک ساخته نشد: ' + JSON.stringify(link).slice(0, 200)); process.exit(1); }
const register = async (last, seed, phone) => (await api(`/public/intake/link/${link.token}/register`, {
  method: 'POST', auth: false,
  body: { firstName: 'بیمارِ', lastName: last, nationalId: nid(seed), phone, captchaA: 2, captchaB: 3, captchaAnswer: 5 },
})).json;
const reg = await register(`لینک‌صوتی${RUN}`, RUN * 13 + 7, '09120000972');
ok('ثبت‌نام انجام شد', !!reg?.token, JSON.stringify(reg).slice(0, 120));

const pv = (field, buf, name = 'voice.wav') => upload(`/public/intake/form/${reg.token}/voice/${field}`, buf, name, 'audio/wav', { auth: false });
const onImage = await pv('mri', WAV);
ok('**نباید بیفتد:** صدا روی کادرِ عکس (آپلودرِ آزاد)', onImage.status === 400, onImage.status + ' ' + onImage.text.slice(0, 100));
const onGhost = await pv('nope', WAV);
ok('**نباید بیفتد:** صدا روی کادرِ ناموجود', onGhost.status === 400, String(onGhost.status));
const asPng = await pv('links', PNG, 'voice.wav');
ok('**نباید بیفتد:** عکس با پسوندِ .wav', asPng.status === 400 && /صدا/.test(asPng.text), asPng.status + ' ' + asPng.text.slice(0, 100));
const good = await pv('links', WAV);
ok('صدای ردیفِ لینک آپلود شد و شناسه برگشت', good.status < 300 && !!good.json?.id, good.status + ' ' + good.text.slice(0, 120));
const voiceId = good.json?.id;
const regPid = num(`SELECT patient_id FROM documents WHERE id=${voiceId}`);
ok('صدا مدرکِ همین پرونده است، هنوز بی‌مراجعه و بی‌لینک',
  sql(`SELECT coalesce(visit_id::text,'-') || '|' || coalesce(ref_type,'-') FROM documents WHERE id=${voiceId}`) === '-|-');

/* صدای **بیمارِ دیگر** (پروندهٔ الف از بخشِ ۱) — شناسه‌اش را در ردیفِ دوم می‌گذاریم. */
const foreign = (await upload(`/patients/${va.patientId}/documents`, WAV, 'foreign.wav', 'audio/wav', { fields: { category: 'other' } })).json;
const URL1 = `https://pacs.example.com/vn/${RUN}`;
const URL2 = `https://lab.example.com/vn/${RUN}`;
const filled = await api(`/public/intake/form/${reg.token}/fill`, {
  method: 'POST', auth: false,
  body: { values: {
    links: [
      { url: URL1, title: 'MRI کمر', kind: 'imaging', voice: { id: voiceId, name: 'voice.wav', seconds: 7 } },
      { url: URL2, title: 'آزمایش', kind: 'lab', voice: { id: foreign?.id, name: 'x', seconds: 2 } },
    ],
    story: 'درد از دو هفته پیش',
  } },
});
ok('فرم با ارجاعِ صدا ذخیره شد', filled.status < 300, filled.status + ' ' + filled.text.slice(0, 140));
const saved = filled.json?.data?.links ?? [];
ok('ارجاعِ صدا داخلِ ردیفِ لینک ماند (شناسه، نام، ثانیه)',
  saved[0]?.voice?.id === voiceId && saved[0]?.voice?.seconds === 7, JSON.stringify(saved[0]?.voice));

const sub = ((await api('/intake/submissions?status=pending_approval')).json ?? []).find((x) => x.token === reg.token)
  ?? ((await api('/intake/submissions')).json ?? []).find((x) => x.token === reg.token);
ok('ثبت‌نام در صفِ تأیید است', !!sub);
const surgeon = (await api('/surgeons')).json?.[0];
const ap = await api(`/intake/submissions/${sub?.id}/approve`, {
  method: 'POST', body: { surgeonId: surgeon?.id, opDate: new Date().toISOString().slice(0, 10), registerPayment: false },
});
ok('تأیید شد و مراجعه ساخت', ap.status < 300 && !!ap.json?.visitId, ap.status + ' ' + ap.text.slice(0, 140));
const visitId = ap.json?.visitId;
const linkDoc = num(`SELECT id FROM documents WHERE patient_id=${regPid} AND external_url='${URL1}' AND deleted_at IS NULL`);
ok('مدرکِ لینکی ساخته شد', linkDoc > 0);
ok('**صدا زیرِ همان مدرکِ لینکی نشست** (ref_type=document)',
  sql(`SELECT ref_type || ':' || ref_id FROM documents WHERE id=${voiceId}`) === `document:${linkDoc}`,
  sql(`SELECT coalesce(ref_type,'-') || ':' || coalesce(ref_id::text,'-') FROM documents WHERE id=${voiceId}`));
ok('و به همین مراجعه چسبید', num(`SELECT coalesce(visit_id,0) FROM documents WHERE id=${voiceId}`) === visitId);
ok('**نباید بیفتد:** صدای بیمارِ دیگر به این پرونده کشیده شود',
  sql(`SELECT patient_id || '|' || coalesce(ref_type,'-') || '|' || coalesce(visit_id::text,'-') FROM documents WHERE id=${foreign?.id}`) === `${va.patientId}|-|-`,
  sql(`SELECT patient_id || '|' || coalesce(ref_type,'-') || '|' || coalesce(visit_id::text,'-') FROM documents WHERE id=${foreign?.id}`));
const lateVoice = await pv('links', WAV);
ok('**نباید بیفتد:** بعد از تأیید هنوز صدا بگیرد', lateVoice.status === 400, String(lateVoice.status));

console.log('\n۴) مرورگر — ضبطِ واقعی با میکروفونِ ساختگی');
{
  const reg2 = await register(`ضبط${RUN}`, RUN * 17 + 3, '09120000973');
  const before = num(`SELECT count(*) FROM documents d JOIN intake_submissions s ON s.patient_id=d.patient_id WHERE s.token='${reg2.token}' AND d.mime_type='audio/wav'`);
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
    await ctx.grantPermissions(['microphone'], { origin: UI });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${UI}/f/${reg2.token}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.dyn-links', { timeout: 15000 }).catch(() => {});
    await page.locator('.dyn-links .dyn-img-pick').click();
    const row = page.locator('.dyn-link').first();
    ok('پیش از نشانی، ضبط بسته است و راهنما دارد',
      await row.locator('[data-voice-note]').count() === 0 && (await row.innerText()).includes('اول نشانیِ لینک'));
    await row.locator('input[type=url]').fill(`https://pacs.example.com/rec/${RUN}`);
    const note = row.locator('[data-voice-note]');
    ok('با نشانی، دکمهٔ ضبط آمد', await note.count() === 1 && (await note.getAttribute('data-voice-note')) === 'idle');
    await note.locator('button.vc-btn').click();
    await page.waitForFunction(() => document.querySelector('[data-voice-note]')?.getAttribute('data-voice-note') === 'rec', null, { timeout: 5000 }).catch(() => {});
    ok('ضبط شروع شد (حالتِ rec)', (await note.getAttribute('data-voice-note')) === 'rec', await note.getAttribute('data-voice-note'));
    await page.waitForTimeout(1600);
    await note.locator('button.vc-rec').click();
    await page.waitForTimeout(300);
    ok('پس از پایان، پیش‌نمایشِ پخش آمد', (await note.getAttribute('data-voice-note')) === 'review' && await note.locator('audio').count() === 1,
      await note.getAttribute('data-voice-note'));
    await note.locator('[data-voice-save]').click();
    await page.waitForSelector('.dyn-voice-done', { timeout: 8000 }).catch(() => {});
    ok('پیوست شد — ردیفِ لینک «توضیحِ صوتی ثبت شد» دارد', await row.locator('.dyn-voice-done').count() === 1);
    const after = num(`SELECT count(*) FROM documents d JOIN intake_submissions s ON s.patient_id=d.patient_id WHERE s.token='${reg2.token}' AND d.mime_type='audio/wav'`);
    ok('**سرور WAVِ ضبط‌شده در مرورگر را پذیرفت** (سنجهٔ بایت‌محور)', after === before + 1, `${before} → ${after}`);
    const sz = num(`SELECT d.size FROM documents d JOIN intake_submissions s ON s.patient_id=d.patient_id WHERE s.token='${reg2.token}' AND d.mime_type='audio/wav' ORDER BY d.id DESC LIMIT 1`);
    ok('حجمِ ~۱٫۵ ثانیه در ۱۶ کیلوهرتز معقول است (نه خالی، نه بی‌فشرده‌سازیِ ۴۸k)', sz > 20000 && sz < 150000, `${sz} bytes`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('بدونِ سرریزِ افقی روی موبایل', overflow <= 1, overflow + 'px');
    ok('بدونِ خطای JS', errors.length === 0, errors[0]);
  } finally {
    await browser.close();
  }
}

console.log(`\nسبز: ${pass}   قرمز: ${fails.length}`);
for (const f of fails) console.log('  ✘ ' + f);
process.exit(fails.length ? 1 : 0);
