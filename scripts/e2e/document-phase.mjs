/**
 * مرحلهٔ مدرک — «کدام عکس و آزمایش قبل از عمل بود و کدام بعدش؟»
 * سرورِ زنده + مرورگرِ واقعی (بازخوردِ مالک ۱۴۰۵/۰۶/۳۰).
 *
 *  باید بیفتد:
 *   - مدرکِ گره‌خورده به یک عمل مرحله می‌گیرد و در تبِ «مدارک» **بجِ فارسی** دارد
 *   - ردیفِ فیلترِ مرحله می‌آید و «قبل از عمل» فقط مدرکِ همان مرحله را می‌گذارد
 *   - کشویِ مرحله تا مراجعه انتخاب نشده **غیرفعال** است
 *  نباید بیفتد:
 *   - مدرکِ بی‌مرحله برچسبِ حدسی بگیرد؛ هیچ خطای JS/کنسول
 *
 * ⚠️ چرا مرورگر و نه فقط API: بج و فیلتر چیزی‌اند که کاربر **می‌بیند**. سنجهٔ
 * «فیلد در پاسخِ API هست» یک‌بار سبز بود در حالی که رابط اصلاً نشانش نمی‌داد.
 */
import { chromium } from 'playwright-core';
import { browserLogin } from './lib/browser-login.mjs';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const EXE = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium';

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
const H = { Authorization: 'Bearer ' + login.accessToken };
const send = (p, method = 'GET', body) => fetch(API + p, {
  method, headers: { ...H, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

console.log('۱) داده: یک عمل با MRIِ پیش از آن و عکسِ کنترلِ بعد از آن');
const kinds = (await send('/forms/visit-kinds')).json ?? [];
if (!kinds.some((k) => (k.kind ?? k.key) === 'clinic')) await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });
const visit = (await send('/visits', 'POST', {
  kind: 'clinic', firstName: 'بیمارِ', lastName: 'مرحله', phone: '09120000977', opDate: new Date().toISOString(),
})).json;
ok('مراجعه ساخته شد', !!visit?.id, JSON.stringify(visit).slice(0, 120));
const pid = visit.patientId;

/* عملِ جراحی — تب‌های «قبل/حین/بعد» فقط در فرمِ عمل هستند، و همان‌جایی است که
   مالک گفت مدرک باید ذخیره شود: «بسته به اینکه پره‌اپ یا پست‌اپِ هر عمل است،
   همون‌جا باید سیو شه». */
if (!kinds.some((k) => (k.kind ?? k.key) === 'surgery')) await send('/forms', 'POST', { key: 'surgery', title: 'فرمِ عمل', scope: 'visit' });
const surgeon = (await send('/surgeons')).json?.[0];
const hospital = (await send('/hospitals')).json?.[0];
const op = (await send('/visits', 'POST', {
  kind: 'surgery', patientId: visit.patientId, opDate: new Date().toISOString(),
  surgeonId: surgeon?.id, hospitalId: hospital?.id,
})).json;
ok('عملِ جراحی ساخته شد', !!op?.id, JSON.stringify(op).slice(0, 120));

const link = (body) => send(`/patients/${pid}/documents/link`, 'POST', body);
const pre = await link({ url: 'https://pacs.test/mri-pre', title: 'MRI پیش از عمل', category: 'imaging', visitId: visit.id, phase: 'pre' });
const post = await link({ url: 'https://pacs.test/xray-post', title: 'رادیوگرافی کنترل', category: 'imaging', visitId: visit.id, phase: 'post' });
const plain = await link({ url: 'https://pacs.test/card', title: 'کارت ملی', category: 'identity' });
ok('هر سه مدرک ثبت شدند', [pre, post, plain].every((r) => r.status === 201),
  [pre, post, plain].map((r) => r.status).join(','));

ok('مرحله بدونِ مراجعه رد می‌شود («قبل از کدام عمل؟» جواب ندارد)',
  (await link({ url: 'https://pacs.test/x', category: 'lab', phase: 'pre' })).status === 400);

const docs = (await send(`/patients/${pid}/documents`)).json ?? [];
const preRow = docs.find((d) => d.id === pre.json.id);
ok('برچسبِ فارسیِ مرحله از سرور می‌آید (قانون ۱۵)', preRow?.phase === 'pre' && preRow?.phaseFa === 'قبل از عمل',
  `phase=${preRow?.phase} fa=${preRow?.phaseFa}`);
ok('مدرکِ بی‌مرحله برچسبِ حدسی نمی‌گیرد', docs.find((d) => d.id === plain.json.id)?.phase === null);

console.log('\n۲) مرورگر — تبِ مدارک: بج، فیلتر، و قفلِ کشویِ مرحله');
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await browserLogin(page, login.accessToken);
  await page.goto(`${UI}/app/patients/${pid}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /مدارک/ }).first().click();
  await page.locator('.rc-docs .rc-doc').first().waitFor({ timeout: 10000 });

  const badges = await page.locator('.rc-doc-phase').allInnerTexts();
  ok('**بجِ «قبل از عمل» و «بعد از عمل» روی کارتِ مدرک دیده می‌شود**',
    badges.includes('قبل از عمل') && badges.includes('بعد از عمل'), badges.join(' | '));
  ok('کارتِ مدرکِ بی‌مرحله بج ندارد', badges.length === 2, `badges=${badges.length}`);

  /* کشویِ مرحله تا مراجعه انتخاب نشده باید قفل باشد — سرور هم ردش می‌کند، ولی
     رابط نباید بگذارد کاربر اصلاً به آن حالت برسد و بعد خطا بخورد. */
  const phaseSelect = page.locator('.rc-upload select').nth(2);
  ok('کشویِ مرحله پیش از انتخابِ مراجعه غیرفعال است', await phaseSelect.isDisabled());

  const chips = page.locator('.rc-phasefilter button');
  ok('ردیفِ فیلترِ مرحله آمده است', (await chips.count()) >= 3, `chips=${await chips.count()}`);
  await page.screenshot({ path: '/tmp/doc-phase-all.png' });

  await page.getByRole('button', { name: 'قبل از عمل', exact: true }).click();
  await page.waitForTimeout(300);
  const shown = await page.locator('.rc-doc-main b').allInnerTexts();
  ok('**فیلترِ «قبل از عمل» فقط همان مدرک را می‌گذارد**',
    shown.length === 1 && shown[0].includes('MRI'), shown.join(' | '));
  await page.screenshot({ path: '/tmp/doc-phase-pre.png' });

  await page.getByRole('button', { name: 'بدونِ مرحله', exact: true }).click();
  await page.waitForTimeout(300);
  ok('چیپِ «بدونِ مرحله» مدرکِ برچسب‌نخورده را نشان می‌دهد تا گم نشود',
    (await page.locator('.rc-doc-main b').allInnerTexts()).some((x) => x.includes('کارت ملی')));

  console.log('\n۳) فرمِ عمل — بلوکِ مدرک داخلِ هر تبِ مرحله');
  await page.getByRole('tab', { name: /مراجعه‌ها/ }).first().click();
  await page.locator('.rc-visit-btn').filter({ hasText: op.code }).first().click();
  await page.locator('.db-sheet').waitFor({ timeout: 10000 });
  /* اصلاحِ مالک ۱۴۰۵/۰۷/۰۲: باکسِ مدارکِ هر مرحله همان باکسِ ویزیت است — مدرکی نیست؟ فقط
     یک خطِ «+» با توضیحِ همان مرحله؛ دسته‌ها داخلِ باکسی است که همان «+» باز می‌کند. */
  for (const [tab, phase] of [['قبل از عمل', 'pre'], ['حین عمل', 'intra'], ['بعد از عمل', 'post']]) {
    await page.locator('.db-phasetabs').getByRole('tab', { name: tab, exact: true }).click();
    await page.waitForTimeout(250);
    const add = await page.locator(`[data-visit-docs][data-phase="${phase}"] [data-act="add-docs"]`).innerText().catch(() => '');
    ok(`تبِ «${tab}» خطِ «+» با توضیحِ همان مرحله را دارد`, add.includes(`مدارکِ ${tab}`), add);
  }
  const box = page.locator('[data-visit-docs][data-phase="post"]');
  await box.locator('[data-act="add-docs"]').click();
  await box.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/doc-phase-form.png' });
  ok('دسته‌های مدرک داخلِ باکسِ همان مرحله هست (شش دسته)', (await box.locator('[data-docs-box] [role="radio"]').count()) === 6);

  console.log('\n۴) بدونِ خطای جاوااسکریپت');
  ok('هیچ خطای JS/کنسول', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

console.log(`\nقبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('مردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
