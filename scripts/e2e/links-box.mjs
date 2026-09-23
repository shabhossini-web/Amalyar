/**
 * باکسِ لینک (`links`) + دستهٔ مدرکِ باکس‌ها — از فرم‌ساز تا پروندهٔ بیمار.
 *
 * ادعای اصلی: چیزی که بیمار در فرم می‌گذارد (لینکِ MRI/آزمایش با رمزِ پورتال،
 * عکسِ MRI، شرحِ متنی) **در پرونده** پیدا می‌شود — لینک و عکس در تبِ مدارک
 * (با دستهٔ درست و چسبیده به همان مراجعه)، متن در تبِ شرح‌ها. نه فقط دفن در
 * `Visit.extra`.
 *
 * اجرا: `node scripts/e2e/links-box.mjs` (API روی 3101، UI روی 5199).
 * هر بار قابلِ تکرار: دادهٔ اجرای قبلی با پیشوندِ `[lk]` جمع می‌شود.
 */
import { chromium } from 'playwright-core';
import { captchaFor } from './lib/captcha.mjs';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const EXE = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let TOKEN = '';
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};

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

TOKEN = (await api('/auth/login', { method: 'POST', body: { identifier: process.env.E2E_USER ?? 'admin', password: process.env.E2E_PASS ?? 'test1234' } })).json?.accessToken;
if (!TOKEN) { console.error('ورود نشد'); process.exit(1); }

function nid(seed) {
  const base = String(seed % 1_000_000_000).padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(base[i]) * (10 - i);
  const r = sum % 11;
  return base + String(r < 2 ? r : 11 - r);
}
const RUN = Math.floor(Date.now() / 1000) % 100_000_000;

// ── آماده‌سازیِ تکرارپذیر ───────────────────────────────────────────────────
for (const l of ((await api('/intake/links')).json ?? []).filter((x) => /^\[lk]/.test(x.title))) {
  await api(`/intake/links/${l.id}`, { method: 'PATCH', body: { title: '[lk-old] ' + l.id, active: false, formId: 0, bankAccountId: 0 } });
}
async function ensureVisitForm(key, title) {
  const full = `visit.${key}`;
  let f = ((await api('/forms')).json ?? []).find((x) => x.key === full);
  if (f) {
    await api(`/forms/${f.id}`, { method: 'PATCH', body: { active: true, title } });
    for (const fl of f.fields.filter((x) => !x.builtin)) await api(`/forms/fields/${fl.id}`, { method: 'DELETE' });
    return (await api(`/forms/${encodeURIComponent(full)}`)).json;
  }
  const made = await api('/forms', { method: 'POST', body: { key, title, scope: 'visit' } });
  if (!made.json?.id) { console.error('فرم ساخته نشد: ' + made.text.slice(0, 200)); process.exit(1); }
  return made.json;
}
const surgeon = (await api('/surgeons')).json?.[0]
  ?? (await api('/surgeons', { method: 'POST', body: { firstName: 'جراحِ', lastName: 'آزمون' } })).json;
const hospital = (await api('/hospitals')).json?.[0]
  ?? (await api('/hospitals', { method: 'POST', body: { name: '[lk] بیمارستانِ آزمون' } })).json;

console.log('\n۱) نوعِ «links» در فرم‌ساز + دستهٔ مدرک');
const form = await ensureVisitForm('lkvisit', '[lk] ویزیت با لینک');
{
  const r = await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'mri', label: 'تصاویرِ پزشکی', type: 'image', docCategory: 'imaging' } });
  ok('باکسِ عکس با دستهٔ تصویربرداری ساخته شد', r.status < 300, r.status + ' ' + r.text.slice(0, 120));
  const r2 = await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'links', label: 'لینکِ تصاویر و آزمایش‌ها', type: 'links', docCategory: 'imaging' } });
  ok('باکسِ لینک ساخته شد', r2.status < 300, r2.status + ' ' + r2.text.slice(0, 120));
  /* ⚠️ کلید `examNote` است نه `exam`: از بستهٔ ۶الف `exam` کلیدِ رزروِ هستهٔ
     ثابت است (شرحِ بخشی → ClinicalNote) و فیلدِ سفارشی با آن ساخته نمی‌شود.
     این سوییت دربارهٔ «هر textareaی سفارشی در تبِ شرح‌ها» است، نه آن بخش. */
  await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'examNote', label: 'شرحِ معاینه', type: 'textarea' } });
  const bad = await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'badcat', label: 'نامعتبر', type: 'links', docCategory: 'bogus' } });
  ok('دستهٔ مدرکِ نامعتبر ۴۰۰ می‌گیرد', bad.status === 400, 'status=' + bad.status);
  const view = (await api(`/forms/${encodeURIComponent('visit.lkvisit')}`)).json;
  const lf = view?.fields?.find((x) => x.key === 'links');
  ok('نوع و دسته در تعریفِ فرم برمی‌گردد', lf?.type === 'links' && lf?.docCategory === 'imaging', JSON.stringify({ t: lf?.type, c: lf?.docCategory }));
  const p = await api(`/forms/fields/${lf.id}`, { method: 'PATCH', body: { docCategory: 'lab' } });
  ok('ویرایشِ دسته', p.status < 300 && p.json?.fields?.find((x) => x.key === 'links')?.docCategory === 'lab', p.status + ' ' + p.text.slice(0, 100));
  await api(`/forms/fields/${lf.id}`, { method: 'PATCH', body: { docCategory: 'imaging' } });
}

console.log('\n۲) backfill: فرمِ ویزیتِ مطب (visit.clinic) دو باکسِ مدرک می‌گیرد — یک‌بار');
{
  const all = (await api('/forms')).json ?? [];
  let clinic = all.find((x) => x.key === 'visit.clinic');
  if (!clinic) {
    /* نصبِ آزمون نورومانیتورینگ است و فرمِ مطب ندارد؛ ساختنش همان چیزی است که
       نصبِ مطبِ قدیمی دارد: فرمِ visit.clinic **بدونِ** باکس‌های تازه. */
    const made = await api('/forms', { method: 'POST', body: { key: 'clinic', title: '[lk] فرمِ ویزیتِ مطب', scope: 'visit' } });
    clinic = made.json;
  }
  /* seed/backfill تنبل است و با اولین خواندنِ فرم‌ها اجرا می‌شود. */
  const after = ((await api('/forms')).json ?? []).find((x) => x.key === 'visit.clinic');
  const keys = (after?.fields ?? []).map((f) => f.key);
  ok('باکسِ عکسِ «تصاویرِ پزشکی» اضافه شد', keys.includes('imaging'), keys.join(','));
  ok('باکسِ لینک اضافه شد', keys.includes('imagingLinks'), keys.join(','));
  const lk = (after?.fields ?? []).find((f) => f.key === 'imagingLinks');
  ok('با نوعِ links و دستهٔ تصویربرداری', lk?.type === 'links' && lk?.docCategory === 'imaging', JSON.stringify({ t: lk?.type, c: lk?.docCategory }));
  const n1 = (after?.fields ?? []).filter((f) => ['imaging', 'imagingLinks'].includes(f.key)).length;
  const again = ((await api('/forms')).json ?? []).find((x) => x.key === 'visit.clinic');
  const n2 = (again?.fields ?? []).filter((f) => ['imaging', 'imagingLinks'].includes(f.key)).length;
  ok('اجرای دوباره چیزی اضافه نمی‌کند (idempotent)', n1 === 2 && n2 === 2, `${n1} → ${n2}`);
}

console.log('\n۳) فرمِ عمومی: نشانیِ خراب رد می‌شود');
const link = (await api('/intake/links', { method: 'POST', body: { title: '[lk] لینکِ فرمِ لینک‌دار', amount: 0, formId: form.id } })).json;
if (!link?.token) { console.error('لینک ساخته نشد: ' + JSON.stringify(link).slice(0, 200)); process.exit(1); }
const reg = (await api(`/public/intake/link/${link.token}/register`, {
  method: 'POST', auth: false,
  body: { firstName: 'بیمارِ', lastName: 'لینک‌دار', nationalId: nid(RUN * 7 + 3), phone: '09120000041', ...(await captchaFor(API, link.token)) },
})).json;
if (!reg?.token) { console.error('ثبت‌نام نشد: ' + JSON.stringify(reg).slice(0, 200)); process.exit(1); }
const fill = (values) => api(`/public/intake/form/${reg.token}/fill`, { method: 'POST', auth: false, body: { values } });
{
  const js = await fill({ links: [{ url: 'javascript:alert(1)' }] });
  ok('javascript: → ۴۰۰', js.status === 400, js.status + ' ' + js.text.slice(0, 120));
  const ftp = await fill({ links: [{ url: 'ftp://pacs.example.com/x' }] });
  ok('ftp: → ۴۰۰', ftp.status === 400, ftp.status + ' ' + ftp.text.slice(0, 120));
  const bare = await fill({ links: [{ url: 'pacs.example.com/study/1' }] });
  ok('بدونِ scheme → ۴۰۰ با پیامِ فارسی', bare.status === 400 && /https/.test(bare.text), bare.status + ' ' + bare.text.slice(0, 120));
  const many = await fill({ links: Array.from({ length: 11 }, (_, i) => ({ url: `https://pacs.example.com/s/${i}` })) });
  ok('بیش از ۱۰ لینک → ۴۰۰', many.status === 400, many.status + ' ' + many.text.slice(0, 120));
}

console.log('\n۴) آپلودِ عکس روی باکسِ تصاویرِ پزشکی — پیش از ذخیرهٔ نهایی (فرمِ رایگان با ذخیره به صفِ تأیید می‌رود و بعدش بسته است)');
{
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'mri.png');
  const r = await fetch(`${API}/public/intake/form/${reg.token}/image/mri`, { method: 'POST', body: fd });
  const j = await r.json().catch(() => null);
  ok('عکس آپلود شد', r.status < 300 && Array.isArray(j?.data?.mri) && j.data.mri.length === 1, r.status + ' ' + JSON.stringify(j?.data?.mri));
}

console.log('\n۵) ذخیرهٔ درست: دو لینک (یکی با ورودِ پورتال)، ردیفِ خالی حذف، شرحِ متنی');
const LINKS = [
  { url: 'https://pacs.example.com/study/lk-' + RUN, title: 'MRI کمر', kind: 'imaging' },
  { url: 'http://lab.example.com/result/lk-' + RUN, title: 'آزمایشِ خون', user: 'patient' + RUN, pass: 'p@ss-' + RUN, kind: 'lab' },
  { url: '   ', title: 'ردیفِ خالی' },
];
let saved;
{
  const r = await fill({ links: LINKS, examNote: 'دردِ کمر با انتشار به پای چپ — تستِ لینک' });
  ok('ذخیره شد', r.status < 300, r.status + ' ' + r.text.slice(0, 160));
  saved = r.json?.data?.links;
  ok('ردیفِ بی‌نشانی حذف شد — دو لینک ماند', Array.isArray(saved) && saved.length === 2, JSON.stringify(saved)?.slice(0, 160));
  ok('نامِ کاربری و رمز و نوع ماندند', saved?.[1]?.user === 'patient' + RUN && saved?.[1]?.pass === 'p@ss-' + RUN && saved?.[1]?.kind === 'lab', JSON.stringify(saved?.[1]));
  ok('نشانی نرمال شد (با اسلشِ مسیر، بدونِ تغییرِ محتوا)', saved?.[0]?.url === LINKS[0].url, saved?.[0]?.url);
  console.log('   status=' + r.json?.status);
}

console.log('\n۶) تأیید → مراجعه؛ لینک و عکس و شرح در پرونده');
const sub = ((await api('/intake/submissions?status=pending_approval')).json ?? []).find((x) => x.token === reg.token)
  ?? ((await api('/intake/submissions')).json ?? []).find((x) => x.token === reg.token);
ok('ثبت‌نام در صفِ تأیید است', !!sub, 'token=' + reg.token);
let rec, visitId;
const patientId = sub?.patient?.id ?? sub?.patientId;
if (sub) {
  const ap = await api(`/intake/submissions/${sub.id}/approve`, {
    method: 'POST', body: { surgeonId: surgeon?.id, hospitalId: hospital?.id, opDate: new Date().toISOString().slice(0, 10), registerPayment: false },
  });
  ok('تأیید شد و مراجعه ساخت', ap.status < 300 && !!ap.json?.visitId, ap.status + ' ' + ap.text.slice(0, 160));
  visitId = ap.json?.visitId;
  rec = (await api(`/patients/${patientId}/record`)).json;
  const linkDocs = (rec?.documents ?? []).filter((d) => d.isLink && String(d.externalUrl).includes('lk-' + RUN));
  ok('دو مدرکِ لینکی در تبِ مدارک', linkDocs.length === 2, 'n=' + linkDocs.length);
  ok('چسبیده به همین مراجعه', linkDocs.every((d) => d.visitId === visitId), JSON.stringify(linkDocs.map((d) => d.visitId)));
  const mri = linkDocs.find((d) => d.externalUrl === LINKS[0].url);
  const lab = linkDocs.find((d) => d.externalUrl === LINKS[1].url);
  ok('دستهٔ هر لینک از خودِ ردیف (تصویربرداری / آزمایش)', mri?.category === 'imaging' && lab?.category === 'lab', JSON.stringify({ m: mri?.category, l: lab?.category }));
  ok('عنوان از خودِ لینک', mri?.title === 'MRI کمر' && mri?.fileName === 'MRI کمر', JSON.stringify({ t: mri?.title, f: mri?.fileName }));
  ok('نامِ کاربری و رمزِ پورتال روی مدرک', lab?.externalUser === 'patient' + RUN && lab?.externalPass === 'p@ss-' + RUN, JSON.stringify({ u: lab?.externalUser, p: lab?.externalPass }));
  const img = (rec?.documents ?? []).find((d) => !d.isLink && d.fileName === 'mri.png' && d.visitId === visitId);
  ok('عکسِ باکس به مراجعه چسبید و دسته‌اش تصویربرداری است', !!img && img.category === 'imaging', JSON.stringify(img && { c: img.category, v: img.visitId }));
  const text = (rec?.visitTexts ?? []).find((t) => t.visitId === visitId && /تستِ لینک/.test(t.body));
  ok('شرحِ معاینه در تبِ شرح‌ها (visitTexts) هست', !!text && text.label === 'شرحِ معاینه', JSON.stringify(text)?.slice(0, 120));
  const v = (rec?.visits ?? []).find((x) => x.id === visitId);
  const ans = (v?.answers ?? []).find((a) => a.key === 'links');
  ok('پاسخِ لینک در کارتِ مراجعه خوانا است («۲ لینک: …»)', /2 لینک/.test(ans?.value ?? '') && /MRI کمر/.test(ans?.value ?? ''), ans?.value);
}

console.log('\n۷) ویرایشِ مراجعه: لینکِ تکراری مدرکِ دوباره نمی‌سازد؛ لینکِ تازه یکی می‌سازد');
if (visitId && sub) {
  const before = (rec?.documents ?? []).filter((d) => d.isLink).length;
  const same = await api(`/visits/${visitId}`, { method: 'PATCH', body: { extra: { links: saved } } });
  ok('ویرایش با همان لینک‌ها ذخیره شد', same.status < 300, same.status + ' ' + same.text.slice(0, 120));
  let now = (await api(`/patients/${patientId}/record`)).json;
  ok('تعدادِ مدارکِ لینکی تغییر نکرد', (now?.documents ?? []).filter((d) => d.isLink).length === before, `${before} → ${(now?.documents ?? []).filter((d) => d.isLink).length}`);
  const more = await api(`/visits/${visitId}`, { method: 'PATCH', body: { extra: { links: [...saved, { url: 'https://drive.example.com/ct/lk-' + RUN, title: 'CT', kind: 'imaging' }] } } });
  ok('لینکِ سوم پذیرفته شد', more.status < 300, more.status + ' ' + more.text.slice(0, 120));
  now = (await api(`/patients/${patientId}/record`)).json;
  ok('دقیقاً یک مدرکِ تازه', (now?.documents ?? []).filter((d) => d.isLink).length === before + 1, `${before} → ${(now?.documents ?? []).filter((d) => d.isLink).length}`);
  const badEdit = await api(`/visits/${visitId}`, { method: 'PATCH', body: { extra: { links: [{ url: 'javascript:void(0)' }] } } });
  ok('لینکِ خراب در ویرایش هم ۴۰۰ می‌گیرد', badEdit.status === 400, badEdit.status + ' ' + badEdit.text.slice(0, 120));
}

console.log('\n۸) مرورگر: باکسِ لینک روی فرمِ عمومی');
{
  const reg2 = (await api(`/public/intake/link/${link.token}/register`, {
    method: 'POST', auth: false,
    body: { firstName: 'بیمارِ', lastName: 'مرورگر', nationalId: nid(RUN * 11 + 5), phone: '09120000042', ...(await captchaFor(API, link.token)) },
  })).json;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${UI}/f/${reg2.token}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.pf.dyn', { timeout: 15000 }).catch(() => {});
  ok('باکسِ لینک رندر شد', await page.locator('.dyn-links').count() === 1, 'n=' + await page.locator('.dyn-links').count());
  ok('اول هیچ ردیفی نیست، فقط دکمهٔ افزودن', await page.locator('.dyn-link').count() === 0 && await page.locator('.dyn-links .dyn-img-pick').count() === 1);
  await page.locator('.dyn-links .dyn-img-pick').click();
  ok('افزودن یک ردیف می‌سازد', await page.locator('.dyn-link').count() === 1);
  const st = await page.locator('.dyn-link').first().evaluate((el) => {
    const c = getComputedStyle(el); const inp = el.querySelector('input[type=url]');
    return { display: c.display, radius: c.borderRadius, inputH: Math.round(inp.getBoundingClientRect().height), pills: el.querySelectorAll('.dyn-link-kinds .dyn-pill').length, on: el.querySelector('.dyn-link-kinds .dyn-pill.on')?.textContent };
  });
  ok('کارتِ لینک استایل دارد (ستونی، گرد، input کوتاه)', st.display === 'flex' && parseInt(st.radius) >= 10 && st.inputH >= 36 && st.inputH <= 44, JSON.stringify(st));
  ok('سه پیلِ نوع، پیش‌فرض از دستهٔ فیلد (تصویربرداری)', st.pills === 3 && st.on === 'تصویربرداری', JSON.stringify(st));
  await page.locator('.dyn-link input[type=url]').fill('https://pacs.example.com/browser/lk-' + RUN);
  await page.locator('.dyn-link-cred input').nth(0).fill('u' + RUN);
  await page.locator('.dyn-link-cred input').nth(1).fill('s3cret');
  await page.getByRole('button', { name: 'ذخیرهٔ اطلاعات' }).first().click();
  await page.waitForTimeout(1500);
  const persisted = (await api(`/public/intake/form/${reg2.token}`, { auth: false })).json?.data?.links;
  ok('ذخیره از مرورگر روی سرور نشست (با ورودِ پورتال)', persisted?.[0]?.url === 'https://pacs.example.com/browser/lk-' + RUN && persisted?.[0]?.user === 'u' + RUN && persisted?.[0]?.pass === 's3cret', JSON.stringify(persisted));
  /* ⚠️ بازگشت به فرم آزموده نمی‌شود: فرمِ رایگان با همین ذخیره به صفِ تأیید
     می‌رود و صفحه بعدش مرحلهٔ «بررسیِ ما» را نشان می‌دهد، نه فیلدها. ماندگاریِ
     مقدار همان بالا از خودِ سرور سنجیده شد. */
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('بدونِ سرریزِ افقی روی موبایل', overflow <= 1, overflow + 'px');
  ok('بدونِ خطای JS', errors.length === 0, errors[0]);
  await browser.close();
}

console.log(`\nسبز: ${pass}   قرمز: ${fails.length}`);
for (const f of fails) console.log('  ✘ ' + f);
process.exit(fails.length ? 1 : 0);
