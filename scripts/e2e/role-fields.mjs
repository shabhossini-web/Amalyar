/**
 * **«هر کس قسمتِ خودش را پر کند»** — `docs/BOOKING.md` مرحلهٔ ۴.
 *
 * ⚠️ قاعده دنبالِ **نقش** است، با یک استثنای صریح: **سوپرادمین (سطح ۶) همیشه
 * بیرون از قاعده است** — باید یک نفر باشد که کلِ چرخه را ببیند و هر بخشی را
 * اصلاح کند. از ادمین (سطح ۵) به پایین، حسابِ نقش‌دار فقط بخشِ خودش و
 * بخش‌های عمومی را می‌نویسد؛ حسابِ بی‌نقش هیچ محدودیتی ندارد.
 *
 * ⚠️ فقط مقدارِ **تغییرکرده** رد می‌شود: کلاینتی که مقدارِ دست‌نخورده‌ی بخشِ
 * دیگر را echo می‌کند نباید رد شود — وگرنه هر ذخیره‌ی منشی به «شرحِ معاینه»ی
 * پزشک گیر می‌کرد.
 *
 * نقش و سطحِ حسابِ آزمون با SQL ست/پاک می‌شود (ساختِ حسابِ دوم مسیرِ OTP
 * دارد؛ سطح را هم باید پایین‌وبالا کنیم که با API خودِ حساب شدنی نیست).
 * بازگردانی به (سطح ۶، بی‌نقش) هم در ابتدا هم در `finally` — کرشِ وسطِ کار
 * نباید admin را سطح‌۵ یا نقش‌دار جا بگذارد و سوئیت‌های بعدی را قرمز کند.
 */
import { chromium } from 'playwright-core';

const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const { execSync } = await import('node:child_process');
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
const sql = (q) => execSync(`psql "${DB}" -qtAc ${JSON.stringify(q)}`).toString().trim().split('\n')[0];
const setMe = (role, level) =>
  sql(`UPDATE accounts SET job_role=${role ? `'${role}'` : 'NULL'}, level=${level} WHERE username='${USER}'`);
setMe(null, 6); // اجرای قبلی اگر وسطِ راه مرده باشد

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد — سرور را ری‌استارت کنید'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const get = (p) => fetch(API + p, { headers: A }).then((r) => r.json());
const send = (p, method, body) => fetch(API + p, { method, headers: A, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = Math.random().toString(36).slice(2, 7);
const trash = { forms: [], visits: [] };

try {
  console.log('۱) فرمِ مطب با سه بخش: پذیرش (منشی)، معاینه (پزشک)، عمومی');
  await get('/forms');
  const form = (await send('/forms', 'POST', { key: `rl${tag}`, title: 'ویزیتِ بخش‌دار', scope: 'visit' })).json;
  trash.forms.push(form.id);
  await send(`/forms/${form.id}/fields`, 'POST', { key: 'reception', label: 'یادداشتِ پذیرش', type: 'text', role: 'secretary' });
  await send(`/forms/${form.id}/fields`, 'POST', { key: 'examNote', label: 'شرحِ معاینه', type: 'textarea', role: 'doctor' });
  await send(`/forms/${form.id}/fields`, 'POST', { key: 'shared', label: 'توضیحِ عمومی', type: 'text' });
  const def = await get(`/forms/visit.rl${tag}`);
  const byKey = new Map(def.fields.map((x) => [x.key, x]));
  ok(byKey.get('reception')?.role === 'secretary', 'بخشِ منشی ثبت شد');
  ok(byKey.get('examNote')?.roleLabel === 'پزشک', `و برچسبِ فارسیِ بخش از سرور می‌آید («${byKey.get('examNote')?.roleLabel}»)`);
  ok(byKey.get('shared')?.role === null, 'فیلدِ بی‌بخش عمومی است');

  console.log('\n۲) بخش روی فیلدِ هسته‌ای هم می‌نشیند');
  const dateRow = def.fields.find((x) => x.key === 'opDate');
  await send(`/forms/fields/${dateRow.id}`, 'PATCH', { role: 'secretary' });
  const def2 = await get(`/forms/visit.rl${tag}`);
  ok(def2.fields.find((x) => x.key === 'opDate')?.role === 'secretary', 'تاریخ بخشِ منشی شد');
  await send(`/forms/fields/${dateRow.id}`, 'PATCH', { role: null });

  console.log('\n۳) ادمینِ بی‌نقش (سطح ۵) همه‌چیز را می‌نویسد — رفتارِ همهٔ نصب‌های امروز');
  setMe(null, 5);
  const visit = (await send('/visits', 'POST', {
    kind: `rl${tag}`, firstName: 'بخشِ', lastName: 'نقش',
    opDate: new Date().toISOString(),
    extra: { reception: 'پذیرش شد', examNote: 'معاینهٔ اولیه', shared: 'عمومی' },
  })).json;
  if (!visit?.id) { console.error('مراجعه ساخته نشد:', JSON.stringify(visit)); process.exit(1); }
  trash.visits.push(visit.id);
  ok(visit.extra?.examNote === 'معاینهٔ اولیه', 'هر سه بخش نوشته شد');

  console.log('\n۴) ادمینِ نقش‌دار (سطح ۵ + منشی) فقط بخشِ خودش را می‌نویسد');
  setMe('secretary', 5);
  const okOwn = await send(`/visits/${visit.id}`, 'PATCH', { extra: { reception: 'پروندهٔ کاغذی آماده شد' } });
  ok(okOwn.status === 200, `منشی بخشِ خودش را نوشت (${okOwn.status})`);
  const okShared = await send(`/visits/${visit.id}`, 'PATCH', { extra: { shared: 'به‌روز شد' } });
  ok(okShared.status === 200, `و بخشِ عمومی را هم (${okShared.status})`);

  const denied = await send(`/visits/${visit.id}`, 'PATCH', { extra: { examNote: 'دست‌کاریِ منشی' } });
  ok(denied.status === 400, `**ولی بخشِ پزشک را نه** (${denied.status})`);
  ok(/شرحِ معاینه/.test(denied.json?.message ?? '') && /پزشک/.test(denied.json?.message ?? ''),
    `پیام نامِ فیلد و صاحبش را می‌گوید («${denied.json?.message}»)`);
  const fresh = await get(`/visits/${visit.id}`);
  ok(fresh.extra?.examNote === 'معاینهٔ اولیه', 'و مقدارِ پزشک دست‌نخورده ماند');

  console.log('\n۵) echoی بی‌تغییرِ بخشِ دیگر رد نمی‌شود — کلاینتِ قدیمی نمی‌شکند');
  const echo = await send(`/visits/${visit.id}`, 'PATCH', {
    extra: { reception: 'تماس گرفته شد', examNote: 'معاینهٔ اولیه' },
  });
  ok(echo.status === 200, `payloadِ حاملِ مقدارِ دست‌نخوردهٔ پزشک پذیرفته شد (${echo.status})`);
  const fresh2 = await get(`/visits/${visit.id}`);
  ok(fresh2.extra?.reception === 'تماس گرفته شد', 'و بخشِ منشی واقعاً عوض شد');

  console.log('\n۶) در ساخت هم بخشِ دیگر بسته است');
  const badCreate = await send('/visits', 'POST', {
    kind: `rl${tag}`, firstName: 'ساختِ', lastName: 'ممنوع',
    opDate: new Date().toISOString(),
    extra: { examNote: 'منشی نمی‌تواند' },
  });
  ok(badCreate.status === 400, `ساخت با بخشِ پزشکِ پُر رد شد (${badCreate.status})`);
  const okCreate = (await send('/visits', 'POST', {
    kind: `rl${tag}`, firstName: 'ساختِ', lastName: 'مجاز',
    opDate: new Date().toISOString(),
    extra: { reception: 'ثبتِ منشی', examNote: '' },
  })).json;
  ok(!!okCreate?.id, 'ولی با بخشِ خودش (و بخشِ پزشکِ خالی) ساخته شد');
  if (okCreate?.id) trash.visits.push(okCreate.id);

  console.log('\n۷) روی صفحه: بخشِ پزشک برای منشیِ سطح‌۵ قفل و برچسب‌دار است');
  const b = await chromium.launch({
    executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const p = await (await b.newContext({ viewport: { width: 420, height: 900 }, locale: 'fa-IR' })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  try {
    await p.goto(UI + '/', { waitUntil: 'domcontentloaded' });
    await p.evaluate((t) => localStorage.setItem('amalyar_token', t), login.accessToken);
    await p.goto(UI + `/app/dashboard?patient=${visit.id}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2500);
    const sheet = p.locator('.db-sheet');
    ok(await sheet.count() === 1, 'شیتِ ویرایش با deep-link باز شد');
    const doctorField = sheet.locator('.pf-field', { hasText: 'شرحِ معاینه' });
    ok(/بخشِ پزشک/.test(await doctorField.innerText()), 'برچسبِ «بخشِ پزشک» روی فیلد هست');
    ok(await doctorField.locator('textarea').isDisabled(), '**و برای منشی قفل است**');
    const ownField = sheet.locator('.pf-field', { hasText: 'یادداشتِ پذیرش' });
    ok(!(await ownField.locator('input').isDisabled()), 'بخشِ خودِ منشی باز است');
    ok(/بخشِ منشی/.test(await ownField.innerText()), 'و برچسبِ بخشِ خودش را دارد');

    /* ذخیره از همان صفحه — payload نباید فیلدِ قفل را بفرستد و باید سبز شود. */
    await ownField.locator('input').fill('پذیرشِ مرورگری');
    await sheet.locator('.db-submit').click();
    await p.waitForTimeout(1800);
    const after = await get(`/visits/${visit.id}`);
    ok(after.extra?.reception === 'پذیرشِ مرورگری', 'ذخیرهٔ منشی از مرورگر نشست');
    ok(after.extra?.examNote === 'معاینهٔ اولیه', '**و بخشِ پزشک را با خود نبرد**');

    console.log('\n۸) **سوپرادمین (سطح ۶) بیرون از قاعده است — حتی نقش‌دار**');
    setMe('secretary', 6);
    const superEdit = await send(`/visits/${visit.id}`, 'PATCH', { extra: { examNote: 'اصلاحِ سوپرادمین' } });
    ok(superEdit.status === 200, `سوپرادمینِ منشی‌نقش بخشِ پزشک را نوشت (${superEdit.status})`);
    const afterSuper = await get(`/visits/${visit.id}`);
    ok(afterSuper.extra?.examNote === 'اصلاحِ سوپرادمین', 'و واقعاً نشست — کلِ چرخه زیرِ دستش است');

    /* روی صفحه: برچسبِ بخش می‌ماند (بداند کجای چرخه است) ولی قفلی در کار نیست. */
    await p.goto(UI + `/app/dashboard?patient=${visit.id}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2500);
    const sheet2 = p.locator('.db-sheet');
    ok(await sheet2.count() === 1, 'شیت دوباره باز شد');
    const docField2 = sheet2.locator('.pf-field', { hasText: 'شرحِ معاینه' });
    ok(/بخشِ پزشک/.test(await docField2.innerText()), 'برچسبِ بخش برای سوپرادمین می‌ماند');
    ok(!(await docField2.locator('textarea').isDisabled()), '**ولی هیچ فیلدی برایش قفل نیست**');
  } finally {
    await b.close();
  }

  console.log('\n۹) نقش که برداشته شود، ادمینِ سطح‌۵ هم دوباره همه‌کاره است');
  setMe(null, 5);
  const freed = await send(`/visits/${visit.id}`, 'PATCH', { extra: { examNote: 'اصلاحِ ادمینِ بی‌نقش' } });
  ok(freed.status === 200, `بی‌نقش بی‌محدودیت است (${freed.status})`);

  console.log('\n' + '─'.repeat(50));
  console.log(`قبول: ${pass}   رد: ${fail}`);
  console.log('خطای جاوااسکریپت:', errs.length ? errs : 'ندارد');
  process.exitCode = fail || errs.length ? 1 : 0;
} finally {
  setMe(null, 6);
  for (const id of trash.visits) await fetch(API + `/visits/${id}`, { method: 'DELETE', headers: A });
  for (const id of trash.forms) await fetch(API + `/forms/${id}`, { method: 'DELETE', headers: A });
}
