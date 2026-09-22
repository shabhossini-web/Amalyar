/**
 * **علائمِ حیاتی** (بستهٔ ۶ج) — تصمیمِ مالک: «در هر دو (ویزیت و عمل)، بدونِ اجبار».
 *
 *  باید بیفتد:
 *   - کاتالوگِ اندازه‌ها (برچسب، واحد، بازه) از `/config.vitals` — یک منبع برای
 *     فرم و سنجهٔ سرور
 *   - ثبتِ مراجعه با علائمِ حیاتی → یک ردیفِ `vital_signs`، BMI مشتق
 *   - ارقامِ فارسی و ممیزِ «٫» پذیرفته می‌شوند
 *   - هر «ثبت» بعد از ذخیره یک نوبتِ تازه است؛ حذف با ردِ ممیزی
 *   - کارتِ میزِ اتاقِ عمل همان ردیف‌ها را با مرحله نشان می‌دهد
 *   - در مرورگر: شبکهٔ علائمِ حیاتی در فرمِ ویزیتِ مطب، ثبت از همان‌جا
 *  نباید بیفتد:
 *   - مراجعهٔ بدونِ علائمِ حیاتی ردیفِ خالی بسازد («بدونِ اجبار»)
 *   - فشارِ نیمه (فقط یک عدد) یا سیستولیکِ کوچک‌تر از دیاستولیک
 *   - عددِ بیرون از بازه **بی‌صدا** دور ریخته شود — باید ۴۰۰ با پیامِ فارسی بدهد
 *   - مراجعه‌ای با علائمِ حیاتیِ نامعتبر نیمه‌کاره ساخته شود
 *   - کسی که مراجعه را نمی‌بیند، علائمش را بخواند یا بنویسد
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserLogin } from './lib/browser-login.mjs';

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
const loginAs = (i, p) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: i, password: p }),
}).then((r) => r.json());
const call = (t) => (p, m = 'GET', b) => fetch(API + p, {
  method: m, headers: { Authorization: 'Bearer ' + t, ...(b ? { 'Content-Type': 'application/json' } : {}) },
  body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const login = await loginAs(USER, PASS);
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const send = call(login.accessToken);

const tag = randomBytes(3).toString('hex');
const phone = () => '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
const today = new Date().toISOString().slice(0, 10);
const vertical0 = (await send('/config')).json?.vertical ?? 'ionm';
const errText = (r) => JSON.stringify(r.json?.message ?? r.json ?? '');

try {
  const sw = await send('/config/vertical', 'PATCH', { vertical: 'clinic' });
  ok('سوییچ به حوزهٔ مطب', sw.status === 200, String(sw.status));
  /* فرمِ ویزیتِ مطب — نصبِ e2e (نورومانیتورینگ) شاید نداشته باشدش. */
  const forms = (await send('/forms')).json ?? [];
  if (!forms.some((f) => f.scope === 'visit' && f.visitKind === 'clinic')) {
    await send('/forms', 'POST', { key: 'clinic', title: `ویزیت${tag}`, scope: 'visit' });
  }

  console.log('\n۱) کاتالوگ — یک منبع برای فرم و سنجه');
  const cat = (await send('/config')).json?.vitals ?? [];
  const byKey = Object.fromEntries(cat.map((c) => [c.key, c]));
  ok('نُه اندازه با برچسبِ فارسی و واحد', cat.length === 9 && cat.every((c) => /[؀-ۿ]/.test(c.label) && c.unit),
    JSON.stringify(cat.map((c) => c.key)));
  ok('فشار دو عدد است ولی یک گروه', byKey.bpSys?.group === 'bp' && byKey.bpDia?.group === 'bp' && byKey.bpSys?.label === byKey.bpDia?.label);
  ok('بازه‌ها گشادند — نبضِ ۱۸۰ ممکن است', byKey.hr?.max >= 200 && byKey.spo2?.max === 100);

  console.log('\n۲) ثبتِ مراجعه — اختیاری، ولی نامعتبر خطاست');
  const surgeons = (await send('/surgeons')).json ?? [];
  const surgeonId = surgeons[0]?.id ?? (await send('/surgeons', 'POST', { firstName: 'پزشکِ', lastName: `علائم${tag}` })).json?.id;
  const base = (last) => ({
    kind: 'clinic', firstName: 'بیمارِ', lastName: last, phone: phone(),
    opDate: new Date().toISOString(), surgeonId, chiefComplaint: 'سرگیجه',
  });
  const bare = (await send('/visits', 'POST', base(`بی‌علائم${tag}`))).json;
  ok('مراجعهٔ بدونِ علائمِ حیاتی ساخته می‌شود', !!bare?.id, JSON.stringify(bare).slice(0, 160));
  ok('**نباید بیفتد:** ردیفِ خالی بسازد', num(`SELECT count(*) FROM vital_signs WHERE visit_id=${bare.id}`) === 0);
  const blankDraft = (await send('/visits', 'POST', { ...base(`خالی${tag}`), vitals: { bpSys: '', hr: ' ' } })).json;
  ok('پیش‌نویسِ خالیِ فرم هم ردیف نمی‌سازد', !!blankDraft?.id && num(`SELECT count(*) FROM vital_signs WHERE visit_id=${blankDraft.id}`) === 0);

  const half = await send('/visits', 'POST', { ...base(`نیمه${tag}`), vitals: { bpSys: 120 } });
  ok('**نباید بیفتد:** فشارِ نیمه', half.status === 400 && /فشار/.test(errText(half)), errText(half));
  ok('**نباید بیفتد:** مراجعهٔ نیمه‌کاره ساخته شود (تراکنش)',
    num(`SELECT count(*) FROM patients WHERE last_name='نیمه${tag}'`) === 0);
  const flip = await send('/visits', 'POST', { ...base(`وارونه${tag}`), vitals: { bpSys: 70, bpDia: 110 } });
  ok('**نباید بیفتد:** سیستولیکِ کوچک‌تر از دیاستولیک', flip.status === 400 && /سیستولیک/.test(errText(flip)), errText(flip));
  const typo = await send('/visits', 'POST', { ...base(`غلط${tag}`), vitals: { temp: 370 } });
  ok('**نباید بیفتد:** دمای ۳۷۰ بی‌صدا دور ریخته شود — ۴۰۰ با بازه', typo.status === 400 && /بازه/.test(errText(typo)), errText(typo));
  const frac = await send('/visits', 'POST', { ...base(`کسری${tag}`), vitals: { hr: '72.5' } });
  ok('**نباید بیفتد:** نبضِ اعشاری', frac.status === 400, errText(frac));

  const made = (await send('/visits', 'POST', {
    ...base(`علائم${tag}`),
    vitals: { bpSys: '۱۳۰', bpDia: '۸۵', hr: '۷۸', temp: '۳۷٫۲', spo2: '98', weight: '80', height: '180' },
  })).json;
  ok('مراجعه با علائمِ حیاتی ساخته شد', !!made?.id, JSON.stringify(made).slice(0, 160));
  const list1 = (await send(`/visits/${made.id}/vitals`)).json ?? [];
  const r1 = list1[0];
  ok('یک نوبتِ اندازه‌گیری نشست — ارقامِ فارسی و «٫» خوانده شدند',
    list1.length === 1 && r1.bpSys === 130 && r1.bpDia === 85 && r1.hr === 78 && r1.temp === 37.2 && r1.spo2 === 98,
    JSON.stringify(r1));
  ok('BMI مشتقِ سرور است (۲۴٫۷)', r1?.bmi === 24.7, String(r1?.bmi));
  ok('نامِ ثبت‌کننده روی ردیف', !!r1?.recordedByName, String(r1?.recordedByName));
  ok('بیمار هم روی ردیف است (برای روندِ پرونده)',
    num(`SELECT count(*) FROM vital_signs v JOIN visits x ON x.id=v.visit_id WHERE v.visit_id=${made.id} AND v.patient_id=x.patient_id`) === 1);

  console.log('\n۳) نوبت‌های بعدی — افزودن و حذف، نه بازنویسی');
  const add = await send(`/visits/${made.id}/vitals`, 'POST', { hr: 92, pain: 6, note: 'بعد از تزریق' });
  ok('نوبتِ دوم ثبت شد', add.status < 300 && add.json?.hr === 92 && add.json?.pain === 6, JSON.stringify(add.json).slice(0, 160));
  ok('BMI بدونِ وزن و قدِ همان نوبت ساخته نمی‌شود', add.json?.bmi === null, String(add.json?.bmi));
  const empty = await send(`/visits/${made.id}/vitals`, 'POST', {});
  ok('**نباید بیفتد:** نوبتِ خالی', empty.status === 400 && /علائمِ حیاتی/.test(errText(empty)), errText(empty));
  const pBad = await send(`/visits/${made.id}/vitals`, 'POST', { hr: 70, phase: 'lunch' });
  ok('**نباید بیفتد:** مرحلهٔ ساختگی', pBad.status === 400, String(pBad.status));
  const future = await send(`/visits/${made.id}/vitals`, 'POST', { hr: 70, takenAt: new Date(Date.now() + 86400000).toISOString() });
  ok('**نباید بیفتد:** اندازه‌گیری در آینده', future.status === 400, String(future.status));
  const list2 = (await send(`/visits/${made.id}/vitals`)).json ?? [];
  ok('فهرست به ترتیبِ زمان — دو نوبت', list2.length === 2 && list2[0].id === r1.id, JSON.stringify(list2.map((r) => r.id)));
  const del = await send(`/visits/${made.id}/vitals/${add.json.id}`, 'DELETE');
  ok('حذفِ اندازهٔ غلط', del.status < 300 && ((await send(`/visits/${made.id}/vitals`)).json ?? []).length === 1);
  ok('با ردِ ممیزی', num(`SELECT count(*) FROM audit_events WHERE action='visit.vitals_delete' AND entity_id='${made.id}'`) === 1);
  const cross = await send(`/visits/${bare.id}/vitals/${r1.id}`, 'DELETE');
  ok('**نباید بیفتد:** ردیفِ یک مراجعه از مسیرِ مراجعهٔ دیگر حذف شود', cross.status === 404, String(cross.status));

  console.log('\n۴) عمل — قبل و بعد، روی میزِ اتاقِ عمل');
  /* فرمِ عملِ مطب «بیمارستان» را اجباری دارد (هستهٔ ثابتِ عمل). */
  const hospital = (await send('/hospitals')).json?.[0]
    ?? (await send('/hospitals', 'POST', { name: `بیمارستانِ ${tag}` })).json;
  const op = (await send('/visits', 'POST', {
    kind: 'surgery', firstName: 'بیمارِ', lastName: `عمل${tag}`, phone: phone(),
    opDate: new Date().toISOString(), surgeonId, hospitalId: hospital?.id, vitals: { bpSys: 125, bpDia: 80, phase: 'pre' },
  })).json;
  ok('عمل با علائمِ پیش از عمل ساخته شد', !!op?.id, JSON.stringify(op).slice(0, 160));
  await send(`/visits/${op.id}/vitals`, 'POST', { bpSys: 110, bpDia: 70, spo2: 96, phase: 'post' });
  const card = (await send(`/theatre/visits/${op.id}`)).json;
  const vs = card?.vitals ?? card?.visit?.vitals ?? [];
  ok('کارتِ میزِ اتاقِ عمل هر دو نوبت را با مرحلهٔ فارسی دارد',
    vs.length === 2 && vs.some((r) => r.phase === 'pre' && r.phaseFa) && vs.some((r) => r.phase === 'post' && r.spo2 === 96),
    JSON.stringify(vs.map((r) => [r.phase, r.phaseFa])));

  console.log('\n۵) دامنهٔ دید');
  const other = (await send('/accounts/temporary', 'POST', {
    firstName: 'کارشناسِ', lastName: `بیگانه${tag}`, phone: phone(), level: 2, jobRole: 'technician', username: `vs${tag}`,
  })).json;
  const ol = await loginAs(`vs${tag}`, other?.temporaryPassword);
  const oApi = call(ol.accessToken);
  const oRead = await oApi(`/visits/${made.id}/vitals`);
  ok('**نباید بیفتد:** کسی که مراجعه را نمی‌بیند علائمش را بخواند', [403, 404].includes(oRead.status), String(oRead.status));
  const oWrite = await oApi(`/visits/${made.id}/vitals`, 'POST', { hr: 60 });
  ok('**نباید بیفتد:** … یا بنویسد', [403, 404].includes(oWrite.status)
    && ((await send(`/visits/${made.id}/vitals`)).json ?? []).length === 1, String(oWrite.status));

  console.log('\n۶) مرورگر — شبکهٔ علائمِ حیاتی در فرمِ ویزیتِ مطب');
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await browserLogin(page, login.accessToken);
    await page.goto(`${UI}/app/dashboard?patient=${made.id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const box = page.locator('[data-vitals="visit"]');
    ok('بخشِ علائمِ حیاتی در فرمِ ویزیت هست', await box.count() === 1);
    ok('با برچسبِ «اختیاری»', (await box.innerText().catch(() => '')).includes('اختیاری'));
    ok('نوبتِ ثبت‌شده در فهرستش دیده می‌شود (۱۳۰/۸۵)',
      (await box.locator('[data-vital-row]').first().innerText().catch(() => '')).includes('۱۳۰/۸۵'));
    await box.locator('[data-vital="hr"]').fill('۸۸');
    await box.locator('[data-vital="spo2"]').fill('97');
    await box.locator('.vs-add').click();
    await page.waitForTimeout(1200);
    const after = (await send(`/visits/${made.id}/vitals`)).json ?? [];
    ok('ثبت از مرورگر روی سرور نشست', after.length === 2 && after.some((r) => r.hr === 88 && r.spo2 === 97), JSON.stringify(after.map((r) => r.hr)));
    ok('و فهرستِ همان بخش تازه شد', await box.locator('[data-vital-row]').count() === 2);
    ok('ورودی پس از ثبت خالی شد', (await box.locator('[data-vital="hr"]').inputValue()) === '');
    ok('بدونِ خطای JS', errors.length === 0, errors[0]);
  } finally {
    await browser.close();
  }
} finally {
  await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => {});
}

console.log(`\n${pass} سنجه سبز${fails.length ? `، ${fails.length} قرمز` : ''}`);
if (fails.length) { for (const f of fails) console.log('  ✘ ' + f); process.exit(1); }
