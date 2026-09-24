/**
 * خدمتِ فرم (فرم‌ساز) و خدمتِ مراجعه (فرمِ ثبتِ مراجعه) — فقط در شرکتِ دوخدمته.
 * مرورگرِ واقعی، APIِ ساختگی (`lib/mock-ui.mjs`). قراردادِ سرور را `company-service-columns.mjs` می‌سنجد.
 *
 *  باید بیفتد:
 *   - فرم‌ساز برای فرمی که مراجعه می‌سازد انتخابگرِ خدمت دارد و `{service}` را PATCH می‌کند
 *   - فرمِ ثبتِ مراجعه در شرکتِ دوخدمته خدمت را می‌پرسد و بی‌انتخاب از گامِ «نوع» جلو نمی‌رود
 *   - انتخاب همان `service` است که به سرور می‌رود
 *  نباید بیفتد:
 *   - فرمِ زیرپرونده و شرکتِ تک‌خدمته انتخابگر ندارند؛ شرکتِ تک‌خدمته `service` نمی‌فرستد
 */
import { startVite, launch, mockContext } from './lib/mock-ui.mjs';

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };
const CATALOG = [{ key: 'ionm', label: 'نورومانیتورینگ' }, { key: 'implant', label: 'ایمپلنت و تجهیزات' }];
const config = (services) => ({ vertical: 'ionm', kind: 'company', services, serviceCatalog: CATALOG, brand: {}, verticals: [], defaultKind: 'surgery' });
const FORMS = [
  { id: 1, key: 'visit.custom', title: 'ثبت‌نامِ دلخواه', scope: 'visit', visitKind: 'custom', color: 'violet', active: true, pages: 1, hint: '', service: null, fields: [] },
  { id: 2, key: 'survey', title: 'نظرسنجیِ زیرپرونده', scope: 'record', visitKind: null, color: 'teal', active: true, pages: 1, hint: '', service: null, fields: [] },
];
const base = (services) => ({ path, method }) => {
  if (path === '/auth/me') return { id: 1, firstName: 'تست', lastName: 'مدیر', displayName: 'تست مدیر', levelName: 'سوپرادمین', level: 6, status: 'active' };
  if (path === '/auth/accounts') return [];
  if (path === '/config') return config(services);
  if (path === '/features') return ['dashboard', 'formgen', 'work'].map((key) => ({ key, allowed: true }));
  if (path === '/work/counts') return { mine: 0, role: 0, overdue: 0, total: 0 };
  if (path.startsWith('/work')) return [];
  if (path === '/procedure-types' || path === '/diagnoses') return [];
  if (path === '/forms' && method === 'GET') return FORMS;
  if (path === '/forms/1' && method === 'PATCH') return FORMS[0];
  if (path === '/visits' && method === 'GET') return { rows: [], total: 0, pages: 1, stats: { total: 0, pending: 0, today: 0, due: 0, kinds: [] } };
  if (path === '/visits' && method === 'POST') return { id: 9, patientId: 1, kind: 'surgery', seq: 1, fullName: 'بیمارِ خدمت', code: 'AM-9', decisions: [] };
  if (path === '/forms/visit-kinds') return [{ kind: 'surgery', title: 'عمل', color: 'violet' }];
  if (path === '/forms/visit.surgery') return { fields: [{ key: 'opDate', builtin: true, active: true, label: 'تاریخِ عمل' }] };
  if (path === '/ai/status') return { enabled: false, stt: false };
  if (path.startsWith('/forms')) return [];
  if (method !== 'GET') return {};
  return [];
};

const vite = await startVite(5224);
const browser = await launch();
try {
  console.log('۱) فرم‌ساز');
  let m = await mockContext(browser, base(['ionm', 'implant']), { viewport: { width: 1280, height: 900 } });
  let page = await m.context.newPage();
  page.setDefaultTimeout(9000);
  await page.goto(`${vite.base}/app/forms`, { waitUntil: 'networkidle' });
  const pick = page.getByLabel('خدمتِ این فرم (برای ثبت‌نام)');
  await pick.first().waitFor();
  ok(await pick.count() === 1, 'فرمی که مراجعه می‌سازد انتخابگرِ خدمت دارد', String(await pick.count()));
  await pick.selectOption('implant');
  await page.waitForFunction(() => true);
  await page.waitForTimeout(300);
  const patch = m.writes.find((w) => w.path === '/forms/1' && w.method === 'PATCH');
  ok(JSON.stringify(patch?.body) === '{"service":"implant"}', '**انتخاب همان `{service}` را PATCH می‌کند**', JSON.stringify(patch?.body));
  /* فرم‌ساز یک فرم را در هر لحظه نشان می‌دهد — فرمِ زیرپرونده باید **باز** شود تا سنجه واقعی باشد. */
  await page.getByRole('tab', { name: 'نظرسنجیِ زیرپرونده' }).click();
  await page.getByText('نقش در پیگیریِ پس از عمل').first().waitFor();
  ok(true, 'پیش‌شرط: فرمِ زیرپرونده باز است (کادرِ پیگیریِ مخصوصش دیده می‌شود)');
  ok(await pick.count() === 0, '**فرمِ زیرپرونده انتخابگرِ خدمت ندارد** — مراجعه نمی‌سازد', String(await pick.count()));
  ok(m.errors.length === 0, 'بدونِ خطای JS', m.errors[0]);
  await m.context.close();

  m = await mockContext(browser, base(['ionm']), { viewport: { width: 1280, height: 900 } });
  page = await m.context.newPage();
  await page.goto(`${vite.base}/app/forms`, { waitUntil: 'networkidle' });
  await page.getByText('ثبت‌نامِ دلخواه').first().waitFor();
  ok(await page.getByLabel('خدمتِ این فرم (برای ثبت‌نام)').count() === 0, 'شرکتِ تک‌خدمته انتخابگرِ خدمتِ فرم ندارد');
  await m.context.close();

  console.log('\n۲) فرمِ ثبتِ مراجعه');
  const newVisit = async (services) => {
    const mc = await mockContext(browser, base(services), { viewport: { width: 480, height: 1000 } });
    const p = await mc.context.newPage();
    p.setDefaultTimeout(9000);
    await p.goto(`${vite.base}/app/dashboard`, { waitUntil: 'networkidle' });
    await p.locator('.db-add').first().click();
    await p.locator('input[required]').first().fill('بیمارِ');
    await p.locator('input[required]').nth(1).fill('خدمت');
    await p.locator('.db-stepnav .db-submit').click();
    await p.locator('.db-kindbox').first().waitFor();
    return { ...mc, p };
  };
  let v = await newVisit(['ionm', 'implant']);
  const group = v.p.getByRole('radiogroup', { name: /خدمتِ این/ });
  ok(await group.count() === 1 && (await group.getByRole('radio').allInnerTexts()).join('|') === 'نورومانیتورینگ|ایمپلنت و تجهیزات',
    '**شرکتِ دوخدمته خدمتِ مراجعه را می‌پرسد**', (await group.getByRole('radio').allInnerTexts()).join('|'));
  if (process.env.SHOT) await v.p.screenshot({ path: process.env.SHOT + '-visit-service.png', fullPage: true });
  await v.p.locator('.db-kindbox .db-kindrow button').first().click();
  await v.p.locator('.db-stepnav .db-submit').click();
  await v.p.waitForTimeout(300);
  ok(await v.p.locator('.db-formcard').count() === 0, '**بی‌انتخابِ خدمت به گامِ بعد نمی‌رود**');
  ok(await v.p.getByText('خدمتِ این مراجعه را انتخاب کنید').count() > 0, 'و پیامش همین را می‌گوید، کنارِ همان انتخابگر');
  await group.getByRole('radio', { name: 'ایمپلنت و تجهیزات' }).click();
  ok(await group.getByRole('radio', { name: 'ایمپلنت و تجهیزات' }).getAttribute('aria-checked') === 'true', 'انتخاب نشست (aria-checked)');
  await v.p.locator('.db-stepnav .db-submit').click();
  await v.p.locator('.db-formcard').waitFor();
  await v.p.locator('.db-stepnav .db-submit, .db-sheet .db-submit').last().click();
  await v.p.waitForTimeout(500);
  const post = v.writes.find((w) => w.path === '/visits' && w.method === 'POST');
  ok(post?.body?.service === 'implant', '**`service: implant` به سرور رفت**', JSON.stringify(post?.body?.service));
  ok(v.errors.length === 0, 'بدونِ خطای JS', v.errors[0]);
  await v.context.close();

  v = await newVisit(['ionm']);
  ok(await v.p.getByRole('radiogroup', { name: /خدمتِ این/ }).count() === 0, 'شرکتِ تک‌خدمته خدمت نمی‌پرسد');
  await v.p.locator('.db-kindbox .db-kindrow button').first().click();
  await v.p.locator('.db-stepnav .db-submit').click();
  await v.p.locator('.db-formcard').waitFor();
  await v.p.locator('.db-stepnav .db-submit, .db-sheet .db-submit').last().click();
  await v.p.waitForTimeout(500);
  const post1 = v.writes.find((w) => w.path === '/visits' && w.method === 'POST');
  ok(post1 && !('service' in post1.body), 'و `service` نمی‌فرستد (سرور خودش پر می‌کند)', JSON.stringify(post1?.body && Object.keys(post1.body)));
  await v.context.close();
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\nقبول: ${pass}   رد: ${fail}`);
process.exit(fail ? 1 : 0);
