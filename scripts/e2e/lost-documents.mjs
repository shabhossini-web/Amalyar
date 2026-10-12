/**
 * **مدرکِ بی‌فایل** (مالک، ۱۴۰۵/۰۷/۲۰) — ردیفِ مدرک هست ولی خودِ فایل روی سرور نیست.
 *
 * زمینه: اولین تمرینِ بازگردانیِ واقعی ۲۴ مدرک پیدا کرد که پیش از ماندگارشدنِ پوشهٔ فایل‌ها آپلود شده بودند و
 * فایلشان با یک دیپلوی رفته بود. پرونده آن‌ها را مثلِ مدرکِ سالم نشان می‌داد و «دانلود» فقط خطا می‌داد. سه تصمیمِ
 * مالک: ۱) پرونده علامت بزند و «آپلودِ دوباره» بدهد، ۲) منشیِ همان شرکت در «کارهای من» یک کار بگیرد، ۳) پنلِ پلتفرم
 * فقط **شمار** را نشان دهد (بی‌نامِ بیمار).
 *
 *  باید بیفتد:
 *   - فهرستِ مدارک برای ردیفِ بی‌فایل `missing` + توضیح می‌دهد؛ مدرکِ پیش از ۱۴۰۵/۰۷/۰۱ توضیحِ همان تاریخ را
 *   - آشکارساز یک کارِ `reupload_doc` در صفِ منشی می‌سازد — و دورِ دوم کارِ دوم نمی‌سازد
 *   - آپلودِ دوباره روی همان ردیف: عنوان می‌ماند، فایل برمی‌گردد، کار بسته می‌شود
 *   - حذفِ ردیف، یا برگشتنِ فایل از هر مسیرِ دیگر، کار را می‌بندد
 *   - `settings.files_missing` شمارِ واقعی است و پنلِ پلتفرم همان را **فقط به‌صورتِ عدد** می‌گیرد
 *  نباید بیفتد:
 *   - مدرکِ سالم `missing` نمی‌گیرد و آپلودِ دوباره رویش ۴۰۹ است (محتوای سندِ سالم بی‌صدا عوض نمی‌شود)
 *   - مدرکِ لینکی آپلودِ دوباره ندارد (۴۰۰)
 *   - در پاسخِ snapshotِ پلتفرم هیچ عنوانِ مدرک یا نامِ بیماری نیست
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { rm, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { browserLogin } from './lib/browser-login.mjs';

const API = process.env.E2E_API ?? 'http://127.0.0.1:3101/api';
const UI = process.env.E2E_UI;
const DB = process.env.E2E_DB;
const CTRL = process.env.E2E_CTRL_DB;
const SHOTS = process.env.E2E_SHOTS;
if (!DB) { console.log('E2E_DB لازم است'); process.exit(1); }
const ROOT = process.env.STORAGE_ROOT || resolve('server/storage');
const sql = (q, url = DB) => execSync(`psql "${url}" -v ON_ERROR_STOP=1 -qAtc ${JSON.stringify(q)}`, { encoding: 'utf8' }).trim();

let pass = 0; const fails = [];
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fails.push(m); console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

const login = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' }) }).then((r) => r.json());
if (!login.accessToken) { console.log('ورود نشد'); process.exit(1); }
const H = { Authorization: 'Bearer ' + login.accessToken };
const send = (p, method = 'GET', body) => fetch(API + p, { method, headers: { ...H, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const upFile = (path, bytes, name, fields = {}) => {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: 'image/png' }), name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  return fetch(API + path, { method: 'POST', headers: H, body: fd }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
};
/* هر محتوا یکتا — فایل با sha ذخیره می‌شود و دو مدرکِ هم‌محتوا یک فایل‌اند. */
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const bytes = (tag) => Buffer.concat([png, Buffer.from(`lost-docs-${tag}-${Date.now()}`)]);
/* فایل روی دیسک: `<ریشه>/<شناسهٔ شرکت>/<دو حرف>/<sha>` — شرکت را از خودِ دیسک پیدا می‌کنیم. */
const fileOf = (sha) => {
  for (const t of existsSync(ROOT) ? readdirSync(ROOT) : []) {
    const p = join(ROOT, t, sha.slice(0, 2), sha);
    if (existsSync(p)) return { path: p, tenantId: t };
  }
  return null;
};
const shaOf = (id) => sql(`SELECT sha256 FROM documents WHERE id = ${id}`);
const workOf = (id) => sql(`SELECT coalesce(string_agg(state || '|' || coalesce(owner_role, '-'), ','), '') FROM work_items WHERE type = 'reupload_doc' AND ref_type = 'document' AND ref_id = ${id}`);
const docsOf = async (pid) => (await send(`/patients/${pid}/documents`)).json ?? [];
const settle = () => send('/work?scope=all');   // هر خواندنِ صفِ کار رویدادهای تازه را پردازش می‌کند (`WorkService.settle`)

/* پایه: دیتابیس/پوشهٔ محلی ممکن است از اجرای قبلی مدرکِ بی‌فایل داشته باشد — شمارها نسبت به همین سنجیده می‌شوند. */
const M0 = (await send('/work/process', 'POST')).json?.lostFiles?.missing ?? 0;
const lostSetting = () => Number(sql(`SELECT coalesce((SELECT value FROM settings WHERE key = 'files_missing'), '0')`)) - M0;

console.log('۰) بیمار و سه مدرک');
const kinds = (await send('/forms/visit-kinds')).json ?? [];
if (!kinds.some((k) => (k.kind ?? k.key) === 'clinic')) await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });
const visit = (await send('/visits', 'POST', { kind: 'clinic', firstName: 'مریم', lastName: 'بی‌فایل', phone: '09120000977', opDate: new Date().toISOString() })).json;
const pid = visit?.patientId;
ok(!!pid, 'بیمار ساخته شد', JSON.stringify(visit)?.slice(0, 200));
const A = (await upFile(`/patients/${pid}/documents`, bytes('a'), 'mri.png', { title: 'MRI کمر', category: 'imaging', visitId: visit.id })).json;
const B = (await upFile(`/patients/${pid}/documents`, bytes('b'), 'lab.png', { title: 'آزمایشِ خون', category: 'lab' })).json;
const L = (await send(`/patients/${pid}/documents/link`, 'POST', { url: 'https://pacs.example.com/s/1', title: 'پکس', category: 'imaging' })).json;
ok(A?.id && B?.id && L?.id, 'سه مدرک (دو فایل، یک لینک) ثبت شد');
const fa = fileOf(shaOf(A.id));
ok(!!fa, 'فایلِ مدرکِ اول روی دیسک پیدا شد', ROOT);
const tenantId = fa?.tenantId;

console.log('\n۱) فایلِ اول را از دیسک برمی‌داریم — پرونده باید بفهمد');
await rm(fa.path);
let docs = await docsOf(pid);
let a = docs.find((d) => d.id === A.id), b = docs.find((d) => d.id === B.id), l = docs.find((d) => d.id === L.id);
ok(a?.missing === true, 'ردیفِ بی‌فایل `missing` گرفت');
ok(a?.missingNote === 'فایلش روی سرور نیست — دوباره آپلود کنید', 'مدرکِ تازه توضیحِ کلی می‌گیرد (نه تاریخِ ۱۴۰۵/۰۷/۰۱)', a?.missingNote);
ok(b?.missing === false && b?.missingNote === null, 'مدرکِ سالم `missing` نگرفت');
ok(l?.missing === false, 'مدرکِ لینکی فایلی ندارد و بی‌فایل شمرده نمی‌شود');
sql(`UPDATE documents SET created_at = '2026-09-01T08:00:00Z' WHERE id = ${A.id}`);
a = (await docsOf(pid)).find((d) => d.id === A.id);
ok(/پیش از ۱۴۰۵\/۰۷\/۰۱ آپلود شده/.test(a?.missingNote ?? ''), 'مدرکِ پیش از ماندگارشدنِ پوشه همان توضیحِ تاریخ‌دار را می‌گیرد', a?.missingNote);
ok((await fetch(`${API}/patients/documents/${A.id}/file`, { headers: H })).status === 404, 'دانلودش همان ۴۰۴ِ قبلی است');

console.log('\n۲) آشکارساز ← کارِ منشی');
let proc = (await send('/work/process', 'POST')).json;
ok(proc?.lostFiles?.missing === M0 + 1 && proc?.lostFiles?.emitted === 1, 'سنجش یک مدرکِ بی‌فایلِ تازه دید و یک رویداد داد', JSON.stringify(proc?.lostFiles));
ok(workOf(A.id) === 'open|secretary', 'کارِ «دوباره آپلود کنید» باز و در صفِ منشی است', workOf(A.id));
const title = sql(`SELECT title FROM work_items WHERE type = 'reupload_doc' AND ref_id = ${A.id}`);
ok(title.includes('«MRI کمر»'), 'عنوانِ کار نامِ مدرک را دارد', title);
ok(lostSetting() === 1, '`settings.files_missing` یکی بالا رفت');
proc = (await send('/work/process', 'POST')).json;
ok(proc?.lostFiles?.emitted === 0, 'دورِ دوم رویدادِ تازه نداد');
ok(sql(`SELECT count(*) FROM work_items WHERE type = 'reupload_doc' AND ref_id = ${A.id}`) === '1', 'و کارِ دوم ساخته نشد');
const mine = (await send('/work?scope=all')).json;
const row = (Array.isArray(mine) ? mine : mine?.items ?? mine?.rows ?? []).find((w) => w.type === 'reupload_doc' && w.refId === A.id);
ok(!!row && row.patientId === pid, 'کار در فهرستِ «کارها» با بیمارش می‌آید');

console.log('\n۳) آپلودِ دوباره — فقط برای ردیفِ بی‌فایل');
const healthy = await upFile(`/patients/documents/${B.id}/file`, bytes('b2'), 'other.png');
ok(healthy.status === 409, 'روی مدرکِ سالم ۴۰۹ (محتوای سندِ سالم بی‌صدا عوض نمی‌شود)', `${healthy.status} ${healthy.json?.message}`);
ok(shaOf(B.id) && fileOf(shaOf(B.id)), 'و فایلِ مدرکِ سالم دست نخورد');
const link = await upFile(`/patients/documents/${L.id}/file`, bytes('l'), 'x.png');
ok(link.status === 400, 'روی مدرکِ لینکی ۴۰۰', `${link.status} ${link.json?.message}`);
const fresh = bytes('a2');
const re = await upFile(`/patients/documents/${A.id}/file`, fresh, 'mri-new.png');
ok(re.status === 201 || re.status === 200, 'آپلودِ دوباره پذیرفته شد', `${re.status} ${JSON.stringify(re.json)}`);
a = (await docsOf(pid)).find((d) => d.id === A.id);
ok(a?.missing === false && a?.title === 'MRI کمر' && a?.category === 'imaging' && a?.visitId === visit.id, 'همان ردیف: عنوان، دسته و مراجعه ماندند و دیگر بی‌فایل نیست');
ok(a?.fileName === 'mri-new.png', 'نامِ فایلِ تازه نشست', a?.fileName);
const dl = await fetch(`${API}/patients/documents/${A.id}/file`, { headers: H });
ok(dl.status === 200 && Buffer.from(await dl.arrayBuffer()).equals(fresh), 'دانلود همان فایلِ تازه را می‌دهد');
await settle();
ok(workOf(A.id).startsWith('done|'), 'کارِ منشی با آپلودِ دوباره بسته شد', workOf(A.id));
ok(sql(`SELECT count(*) FROM audit_events WHERE action = 'document.reupload' AND entity_id = '${A.id}'`) === '1', 'ممیزی `document.reupload` ثبت شد');
proc = (await send('/work/process', 'POST')).json;
ok(proc?.lostFiles?.missing === M0 && lostSetting() === 0, 'شمار به پایه برگشت');

console.log('\n۳ب) فایل بعد از آپلودِ دوباره **دوباره** رفت — همان کار باز می‌شود (نه یک هفته بعد)');
await rm(fileOf(shaOf(A.id)).path);
await send('/work/process', 'POST');
ok(workOf(A.id) === 'open|secretary', 'کارِ بسته‌شده دوباره باز شد', workOf(A.id));
ok(sql(`SELECT count(*) FROM work_items WHERE type = 'reupload_doc' AND ref_id = ${A.id}`) === '1', 'همان یک کار، نه کارِ دوم');
const again = await upFile(`/patients/documents/${A.id}/file`, bytes('a3'), 'mri-3.png');
ok(again.status === 201 || again.status === 200, 'و دوباره آپلود شد');
await settle();
ok(workOf(A.id).startsWith('done|'), 'و دوباره بسته شد', workOf(A.id));

console.log('\n۳ج) منشی «بستن بدونِ اقدام» زد (بیمار مدرک را ندارد) — هر هفته دوباره جلویش نمی‌آید');
const E = (await upFile(`/patients/${pid}/documents`, bytes('e'), 'old.png', { title: 'نامهٔ قدیمی', category: 'other' })).json;
await rm(fileOf(shaOf(E.id)).path);
await send('/work/process', 'POST');
const eWork = Number(sql(`SELECT id FROM work_items WHERE type = 'reupload_doc' AND ref_id = ${E.id}`));
const dismiss = await send(`/work/${eWork}`, 'PATCH', { action: 'done', outcome: { dismissed: true } });
ok(dismiss.status === 200, 'بستن بدونِ اقدام پذیرفته شد', `${dismiss.status} ${dismiss.json?.message}`);
proc = (await send('/work/process', 'POST')).json;
ok(proc?.lostFiles?.missing === M0 + 1 && proc?.lostFiles?.emitted === 0, 'آشکارساز هنوز می‌شماردش ولی رویدادِ تازه نمی‌دهد', JSON.stringify(proc?.lostFiles));
ok(workOf(E.id).startsWith('done|'), 'کارِ کنارگذاشته بسته می‌ماند', workOf(E.id));
ok((await docsOf(pid)).find((d) => d.id === E.id)?.missing === true, 'ولی ردیفِ پرونده همچنان قرمز است');
ok((await send(`/patients/documents/${E.id}`, 'DELETE')).status === 200, 'ردیفش را حذف می‌کنیم تا شمارِ بقیهٔ سنجه‌ها ساده بماند');

console.log('\n۴) بستن از راه‌های دیگر');
const C = (await upFile(`/patients/${pid}/documents`, bytes('c'), 'card.png', { title: 'کارت ملی', category: 'identity' })).json;
/* عنوانِ یکتا در هر اجرا — ردیفِ «کارهای من» پایین با همین پیدا می‌شود، نه با ردیفِ جامانده از اجرای قبلی. */
const RUN = Date.now().toString(36).slice(-5);
const D = (await upFile(`/patients/${pid}/documents`, bytes('d'), 'eco.png', { title: `اکو ${RUN}`, category: 'imaging' })).json;
const fc = fileOf(shaOf(C.id)), fd = fileOf(shaOf(D.id));
await rm(fc.path); await rm(fd.path);
await send('/work/process', 'POST');
ok(workOf(C.id) === 'open|secretary' && workOf(D.id) === 'open|secretary', 'دو مدرکِ تازهٔ بی‌فایل دو کار گرفتند');
ok(lostSetting() === 2, 'شمار دو تا بالا رفت');
ok((await send(`/patients/documents/${C.id}`, 'DELETE')).status === 200, 'ردیفِ سوم حذف شد');
await settle();
ok(workOf(C.id).startsWith('done|'), 'حذفِ ردیف کارش را بست', workOf(C.id));
/* فایل از مسیرِ دیگری برگشت (مثلاً بازگردانیِ پشتیبان) — آشکارساز خودش می‌فهمد. */
await mkdir(join(fd.path, '..'), { recursive: true });
await writeFile(fd.path, Buffer.from('restored'));
await send('/work/process', 'POST');
ok(workOf(D.id).startsWith('done|'), 'فایلی که از بیرون برگشت هم کارش را بست', workOf(D.id));

console.log('\n۵) پنلِ پلتفرم: فقط شمار');
await rm(fd.path);
await send('/work/process', 'POST');
ok(lostSetting() === 1, 'یک مدرکِ بی‌فایلِ تازه مانده');
let snap = null;
if (CTRL) {
  const require = createRequire(new URL('../../server/package.json', import.meta.url));
  require('reflect-metadata');
  const { PlatformProvisioningService } = require('./dist/platform/platform.module');
  const { TenantProfileProbe } = require('./dist/platform/tenant-profile-probe');
  const { PrismaClient: ControlClient } = require('./src/generated/control');
  const { PrismaClient } = require('@prisma/client');
  const control = new ControlClient({ datasources: { db: { url: CTRL } } });
  const tenantDb = new PrismaClient({ datasources: { db: { url: DB } } });
  try {
    /* همان کوئریِ واقعی روی دیتابیسِ همین شرکت؛ مسیریابیِ per-tenantِ PrismaService این‌جا با یک نگاشتِ ساده
       جایگزین است: شرکتِ دیگر دیتابیسِ دیگری دارد که این سوییت به آن کاری ندارد (تنظیمِ خالی). */
    let current = null;
    const probe = new TenantProfileProbe(
      { setting: { findMany: (args) => (current === tenantId ? tenantDb.setting.findMany(args) : Promise.resolve([])) } },
      { run: (c, fn) => { current = c.tenantId; return fn(); } },
    );
    const svc = new PlatformProvisioningService(control, probe);
    snap = await svc.snapshot();
    const mineT = snap.tenants.find((t) => t.id === tenantId);
    ok(mineT?.lostDocs === M0 + 1, 'snapshot برای همین شرکت همان شمار را دارد', JSON.stringify(mineT?.lostDocs));
    ok(mineT?.profile && !('lostDocs' in mineT.profile), 'شمار کنارِ شرکت است، نه داخلِ نوعِ نصب');
    ok(snap.tenants.filter((t) => t.id !== tenantId).every((t) => t.lostDocs === 0), 'شرکتِ دیگر شمارِ این شرکت را نمی‌گیرد');
    const text = JSON.stringify(snap);
    ok(!text.includes('اکو') && !text.includes('بی‌فایل') && !text.includes('MRI'), 'در snapshot هیچ عنوانِ مدرک یا نامِ بیماری نیست');
  } finally {
    await control.$disconnect(); await tenantDb.$disconnect();
  }
} else ok(false, 'E2E_CTRL_DB لازم است');

/* ───── نما — هر دو تم و گوشی (قانونِ ۲۸) ───── */
if (UI && SHOTS) {
  console.log('\n۶) نما');
  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    for (const [theme, vp, tag] of [['light', { width: 1280, height: 900 }, 'desk-light'], ['dark', { width: 1280, height: 900 }, 'desk-dark'], ['light', { width: 390, height: 844 }, 'phone-light']]) {
      const ctx = await browser.newContext({ viewport: vp, locale: 'fa-IR' });
      const page = await ctx.newPage();
      await browserLogin(page, login.accessToken);
      await page.addInitScript((t) => { try { localStorage.setItem('amalyar_theme', t); } catch { /* */ } }, theme);
      await page.goto(`${UI}/app/patients/${pid}`, { waitUntil: 'networkidle' });
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await page.getByRole('tab', { name: /مدارک/ }).first().click();
      await page.locator('.rc-lost-banner').waitFor({ timeout: 10000 });
      ok(/۱ مدرکِ این پرونده فایلش روی سرور نیست/.test(await page.locator('.rc-lost-banner').innerText()), `${tag}: بنر شمارِ درست دارد`);
      const lostRow = page.locator('.rc-doc.missing');
      ok(await lostRow.count() === 1, `${tag}: یک ردیفِ قرمز`);
      ok(await lostRow.locator('.rc-doc-reup').isVisible(), `${tag}: «آپلودِ دوباره» به‌جای دانلود`);
      ok(await lostRow.locator('button[title="دانلود"]').count() === 0, `${tag}: ردیفِ بی‌فایل دکمهٔ دانلود ندارد`);
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag}: اسکرولِ افقی ندارد`);
      await page.locator('.rc-lost-banner').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/lost-docs-record-${tag}.png` });
      if (tag === 'desk-light') {
        /* آپلودِ دوباره از خودِ صفحه — همان مسیرِ کاربر. */
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), lostRow.locator('.rc-doc-reup').click()]);
        await chooser.setFiles({ name: 'eco-new.png', mimeType: 'image/png', buffer: bytes('ui') });
        await page.locator('.rc-lost-banner').waitFor({ state: 'detached', timeout: 10000 });
        ok(await page.locator('.rc-doc.missing').count() === 0, 'آپلود از صفحه: ردیفِ قرمز و بنر رفتند');
        ok(!(await docsOf(pid)).some((d) => d.missing), 'و سرور هم دیگر مدرکِ بی‌فایل نمی‌بیند');
        /* برای بقیهٔ نماها دوباره بی‌فایلش می‌کنیم. */
        await rm(fileOf(shaOf(D.id)).path);
        await send('/work/process', 'POST');
        await page.goto(`${UI}/app/work`, { waitUntil: 'networkidle' });
        await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
        const wr = page.locator('li, article, .wk-row').filter({ hasText: `اکو ${RUN}` }).first();
        await wr.waitFor({ timeout: 10000 });
        await page.screenshot({ path: `${SHOTS}/lost-docs-work-${tag}.png` });
        const go = wr.getByRole('button', { name: 'رفتن به مدارک' });
        ok(await go.count() === 1, '«کارهای من»: دکمهٔ «رفتن به مدارک»');
        if (await go.count()) {
          await go.click();
          await page.waitForURL(new RegExp(`/app/patients/${pid}`), { timeout: 10000, waitUntil: 'commit' });
          await page.locator('.rc-lost-banner').waitFor({ timeout: 10000 });
          ok(true, 'و همان پرونده را روی تبِ مدارک باز کرد');
        }
      }
      await ctx.close();
    }
    /* پنلِ پلتفرم با همان snapshotِ واقعیِ بالا (API پلتفرم ورودِ جدا دارد؛ فقط خودِ پاسخ جعل نمی‌شود). */
    if (snap) {
      const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      for (const [theme, vp, tag] of [['dark', { width: 1200, height: 800 }, 'desk-dark'], ['light', { width: 390, height: 844 }, 'phone-light']]) {
        const ctx = await browser.newContext({ viewport: vp, locale: 'fa-IR' });
        const pa = await ctx.newPage();
        await pa.route('**/api/platform/auth/me', (r) => json(r, { ok: true }));
        await pa.route('**/api/platform/snapshot', (r) => json(r, snap));
        await pa.route('**/api/platform/health', (r) => json(r, { storage: { verdict: 'ok', message: 'ماندگار' }, sms: { configured: true }, runtime: { commit: 'abc1234', bootedAt: new Date().toISOString() } }));
        await pa.route('**/api/platform/hospitals**', (r) => json(r, { rows: [], total: 0, page: 1, pages: 1, provinces: [], coverage: { total: 0, verified: 0 } }));
        await pa.goto(UI + '/platform-admin', { waitUntil: 'networkidle' });
        await pa.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
        const lost = pa.locator('.pa-lost');
        await lost.first().waitFor({ timeout: 10000 });
        ok(await lost.count() === 1, `پلتفرم ${tag}: فقط کنارِ همان یک شرکت`);
        ok((await lost.first().innerText()).startsWith(`${(M0 + 1).toLocaleString('fa-IR')} مدرک فایلش روی سرور نیست`), `پلتفرم ${tag}: شمار کنارِ همان شرکت`);
        await lost.first().scrollIntoViewIfNeeded();
        await pa.screenshot({ path: `${SHOTS}/lost-docs-platform-${tag}.png` });
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
}

/* اجرای بعدی روی همین دیتابیس/پوشه نباید مدرکِ بی‌فایلِ این سوییت را ارث ببرد. */
for (const d of await docsOf(pid)) await send(`/patients/documents/${d.id}`, 'DELETE');
await send('/work/process', 'POST');

console.log(`\nسبز: ${pass}  قرمز: ${fails.length}`);
if (fails.length) process.exit(1);
