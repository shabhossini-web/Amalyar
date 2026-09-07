/**
 * سفارش‌های بالینی — آزمایش، تصویربرداری، مشاوره، ارجاع (#64):
 *
 * - چهار موجودیتِ جدا با فیلدهای خودشان؛ زیرِ همان ویزیت می‌نشینند.
 * - ارسال برای بیمار: پیامکِ لینک + ثبت در دفترِ پیام‌های پرونده.
 * - صفحهٔ عمومی (`/o/:token`) بدونِ ورود باز می‌شود، خلاصه را نشان می‌دهد،
 *   و پاسخِ بیمار را می‌گیرد؛ ثبتِ پاسخ وضعیت را «answered» می‌کند.
 * - مرورگر: چیپِ تصمیم فرمِ سفارش را باز می‌کند، تیک‌های استاندارد هست، و
 *   بعد از ارسال، سفارش زیرِ همان مراجعه فهرست می‌شود.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const BASE = 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
const PHONE = '09120000967';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const tag = 'co' + randomBytes(3).toString('hex');
const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const pub = (p, m, b) => fetch(API + p, {
  method: m ?? 'GET', headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const trash = { visits: [], forms: [] };

try {
  console.log('۱) چیدمان');
  const vform = (await send('/forms', 'POST', { key: tag, title: 'ویزیتِ سفارش', scope: 'visit' })).json;
  trash.forms.push(vform.id);
  const visit = (await send('/visits', 'POST', {
    kind: tag, firstName: 'بیمارِ', lastName: 'سفارشی', phone: PHONE, opDate: new Date().toISOString(),
  })).json;
  trash.visits.push(visit.id);
  ok(!!visit?.id, `مراجعه ساخته شد (#${visit?.id})`);

  console.log('\n۲) چهار نوعِ سفارش — هر کدام فیلدهای خودش');
  const lab = (await send('/orders/lab', 'POST', {
    patientId: visit.patientId, visitId: visit.id,
    tests: ['CBC diff', 'FBS', 'CBC diff'], note: `ناشتا ${tag}`,
    dueDate: new Date(Date.now() + 5 * 864e5).toISOString(),
  })).json;
  ok(lab?.id && lab.tests.length === 2 && lab.status === 'draft',
    `**آزمایش ثبت شد و تیکِ تکراری یکی شد** (${(lab?.tests ?? []).join('، ')})`);
  ok((lab?.summary ?? '').includes('CBC diff') && (lab?.summary ?? '').includes(tag), 'خلاصه از تیک‌ها و توضیح ساخته شد');

  const img = (await send('/orders/imaging', 'POST', {
    patientId: visit.patientId, visitId: visit.id, modalities: ['سونوگرافی'], region: `شکم ${tag}`,
  })).json;
  const cons = (await send('/orders/consult', 'POST', {
    patientId: visit.patientId, visitId: visit.id, specialty: `قلبِ ${tag}`, doctorName: 'دکتر نمونه',
  })).json;
  const ref = (await send('/orders/referral', 'POST', {
    patientId: visit.patientId, visitId: visit.id, specialty: 'ارتوپدی', note: `متنِ ارجاعِ ${tag}`,
  })).json;
  ok(!!img?.id && !!cons?.id && !!ref?.id, 'عکس‌برداری، مشاوره و ارجاع هم ثبت شدند');

  const list = (await send(`/orders?visitId=${visit.id}`, 'GET')).json ?? [];
  ok(list.length === 4 && new Set(list.map((o) => o.kind)).size === 4,
    `**هر چهار سفارش زیرِ همان مراجعه فهرست می‌شوند** (${list.length})`);

  console.log('\n۳) ارسال برای بیمار');
  const sent = await send(`/orders/lab/${lab.id}/send`, 'POST');
  ok(sent.status < 300 && /\/o\//.test(sent.json?.url ?? ''), `**لینکِ بیمار ساخته و فرستاده شد** (${sent.json?.url?.slice(-14)})`);
  ok(sql(`SELECT status FROM lab_orders WHERE id=${lab.id}`) === 'sent', 'وضعیت به «فرستاده‌شده» رفت');
  const notice = Number(sql(`SELECT count(*) FROM reminders WHERE patient_id=${visit.patientId} AND kind='notice' AND text LIKE '%/o/%'`));
  ok(notice >= 1, '**پیام در دفترِ پرونده ثبت شد**');

  console.log('\n۴) صفحهٔ عمومیِ بیمار');
  const token = sql(`SELECT token FROM lab_orders WHERE id=${lab.id}`);
  const view = await pub(`/public/order/${token}`);
  ok(view.status === 200 && view.json?.kind === 'lab' && (view.json?.summary ?? '').includes('CBC diff'),
    '**بدونِ ورود، بیمار سفارش را می‌بیند**');
  ok(!JSON.stringify(view.json ?? {}).includes(PHONE) && !JSON.stringify(view.json ?? {}).includes('سفارشی'),
    '**نام و شمارهٔ بیمار در صفحهٔ عمومی نیست**');
  ok((await pub('/public/order/ghost-token')).status === 404, 'توکنِ نامعتبر ۴۰۴');

  const ans = await pub(`/public/order/${token}/answer`, 'POST', { link: `https://lab.example/${tag}`, user: 'u1', pass: 'p1' });
  ok(ans.status === 200 || ans.status === 201, `پاسخِ بیمار پذیرفته شد (${ans.status})`);
  ok(sql(`SELECT status FROM lab_orders WHERE id=${lab.id}`) === 'answered'
    && sql(`SELECT result_link FROM lab_orders WHERE id=${lab.id}`).includes(tag),
    '**پاسخ نشست و وضعیت «answered» شد**');
  ok((await pub(`/public/order/${token}/answer`, 'POST', {})).status === 400, 'پاسخِ خالی رد می‌شود');
  const refToken = sql(`SELECT token FROM referral_orders WHERE id=${ref.id}`);
  ok((await pub(`/public/order/${refToken}/answer`, 'POST', { text: 'x' })).status === 400,
    'برای نامهٔ ارجاع پاسخی ثبت نمی‌شود');

  console.log('\n۵) ویرایشِ کادرِ پاسخ توسطِ پزشک');
  const upd = await send(`/orders/consult/${cons.id}`, 'PATCH', { answerText: `جوابِ مشاورهٔ ${tag}` });
  ok(upd.status === 200 && upd.json?.status === 'answered', '**ثبتِ جوابِ مشاوره وضعیت را جلو می‌برد**');

  console.log('\n۶) مرورگر — چیپِ تصمیم فرم را باز می‌کند');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1150, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(BASE + '/login');
    await page.waitForTimeout(900);
    await page.fill('input[name="identifier"], input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/app**', { timeout: 15000 });

    await page.goto(BASE + `/app/dashboard?patient=${visit.id}`);
    await page.waitForTimeout(2600);
    ok(await page.locator('.db-order').count() === 4, `چهار سفارشِ موجود زیرِ مراجعه دیده می‌شوند (${await page.locator('.db-order').count()})`);

    await page.locator('.db-decide .db-daychip', { hasText: 'درخواستِ آزمایش' }).first().click();
    await page.waitForTimeout(900);
    const sheet = page.locator('.od-sheet');
    ok(await sheet.count() === 1, '**کلیکِ چیپِ تصمیم، فرمِ درخواست را باز کرد**');
    const chips = sheet.locator('.od-chip');
    ok(await chips.count() > 15, `تیک‌های استانداردِ آزمایش هست (${await chips.count()})`);
    await chips.filter({ hasText: 'ESR' }).first().click();
    await sheet.locator('textarea').first().fill(`دیکتهٔ ${tag}`);
    await sheet.locator('.od-send').click();
    await page.waitForTimeout(2600);
    ok(await page.locator('.od-sheet').count() === 0, 'بعد از ارسال، فرم بسته شد');
    const labs = Number(sql(`SELECT count(*) FROM lab_orders WHERE visit_id=${visit.id}`));
    ok(labs === 2, `**سفارشِ تازه از مرورگر ثبت شد** (${labs})`);
    ok(sql(`SELECT array_to_string(tests, ',') FROM lab_orders WHERE visit_id=${visit.id} ORDER BY id DESC LIMIT 1`).includes('ESR'),
      'تیکِ انتخابی ذخیره شد');

    /* صفحهٔ عمومی در مرورگرِ واقعی. */
    await page.goto(BASE + `/o/${token}`);
    await page.waitForTimeout(1800);
    ok((await page.locator('.op-card').innerText()).includes('آزمایش'), '**صفحهٔ عمومی برای بیمار باز می‌شود**');
    ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  } finally {
    await browser.close();
  }
} finally {
  sql(`DELETE FROM reminders WHERE patient_id IN (SELECT id FROM patients WHERE phone='${PHONE}')`);
  for (const t of ['lab_orders', 'imaging_orders', 'consult_orders', 'referral_orders']) {
    sql(`DELETE FROM ${t} WHERE patient_id IN (SELECT id FROM patients WHERE phone='${PHONE}')`);
  }
  for (const id of trash.visits) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  sql(`DELETE FROM patients WHERE phone='${PHONE}' AND id NOT IN (SELECT patient_id FROM visits)`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
