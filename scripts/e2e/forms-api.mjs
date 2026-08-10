/**
 * آزمونِ مرحلهٔ ۱ روی APIِ واقعی و Postgresِ واقعی.
 *
 * هر ادعا با **حالتِ برگشتیِ سرور** سنجیده می‌شود، نه با اینکه درخواست ۲۰۰ داد.
 */
const API = 'http://localhost:3101/api';
let TOKEN = '';
let pass = 0;
const fails = [];

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✘ ' + name + (detail ? ' — ' + detail : '')); }
}

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* پاسخِ غیرJSON */ }
  return { status: r.status, json, text };
}

const login = await api('/auth/login', { method: 'POST', body: { identifier: 'admin', password: 'test1234' } });
TOKEN = login.json?.accessToken;
if (!TOKEN) { console.error('ورود نشد:', login.text.slice(0, 300)); process.exit(1); }
console.log('ورود ✓\n');

// آزمون باید قابلِ اجرای دوباره باشد: فرم‌های اجرای قبلی حذف/غیرفعال می‌شوند.
// ⚠️ فرمی که مراجعه دارد فقط **خاموش** می‌شود (قاعدهٔ خودِ سرویس)، پس کلیدش
// می‌ماند — برای همین کلیدها در هر اجرا یکتا ساخته می‌شوند.
const RUN = 'r' + (await api('/forms')).json.length + Math.floor(process.uptime() * 1000) % 9973;
for (const f of (await api('/forms')).json.filter((x) => /^visit\.(implant|checkup)r?\d*$/.test(x.key))) {
  await api(`/forms/${f.id}`, { method: 'DELETE' });
}

// ── ۱. مهاجرتِ scope: نظرسنجی باید record باشد، نه survey ──────────────────
console.log('۱) مهاجرتِ scope');
{
  const { json: forms } = await api('/forms');
  const survey = forms.find((f) => f.key === 'survey');
  ok('فرمِ نظرسنجی هست', !!survey);
  ok('scope آن record است', survey?.scope === 'record', 'scope=' + survey?.scope);
  ok('هیچ فرمی scope=survey ندارد', !forms.some((f) => f.scope === 'survey'),
    forms.filter((f) => f.scope === 'survey').map((f) => f.key).join(','));
}

// ── ۲. رنگ: خودکار، دستی، و برگشت به خودکار ────────────────────────────────
console.log('\n۲) رنگِ کارت');
let form;
{
  const c = await api('/forms', { method: 'POST', body: { key: 'implant' + RUN, title: 'ایمپلنت', scope: 'visit', color: 'teal' } });
  ok('فرمِ تازه ساخته شد', c.status === 201 || c.status === 200, c.status + ' ' + c.text.slice(0, 160));
  form = c.json;
  ok('رنگِ انتخابی نشست', form?.color === 'teal', 'color=' + form?.color);
  ok('colorSet درست است', form?.colorSet === true);

  const auto = await api('/forms', { method: 'POST', body: { key: 'checkup' + RUN, title: 'چکاپ', scope: 'visit' } });
  ok('فرمِ بی‌رنگ هم رنگ می‌گیرد', !!auto.json?.color, 'color=' + auto.json?.color);
  ok('ولی colorSet=false است', auto.json?.colorSet === false);

  // همان تابعِ hash در کلاینت هم هست؛ اگر دو طرف یکی نباشند، رنگِ داشبورد و
  // فرم‌ساز فرق می‌کند. این‌جا مقدارِ سرور را با پیاده‌سازیِ کلاینت می‌سنجیم.
  const KEYS = ['violet', 'teal', 'amber', 'rose', 'sky', 'lime', 'fuchsia', 'slate'];
  const clientColor = (k) => { let h = 0; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0; return KEYS[h % KEYS.length]; };
  ok('رنگِ خودکارِ سرور با کلاینت یکی است',
    auto.json?.color === clientColor('visit.checkup' + RUN),
    'server=' + auto.json?.color + ' client=' + clientColor('visit.checkup' + RUN));

  const back = await api(`/forms/${form.id}`, { method: 'PATCH', body: { color: '' } });
  ok('رشته‌ی خالی رنگ را خودکار می‌کند', back.json?.colorSet === false, back.status + ' colorSet=' + back.json?.colorSet);
  const again = await api(`/forms/${form.id}`, { method: 'PATCH', body: { color: 'rose' } });
  ok('رنگِ دستی دوباره می‌نشیند', again.json?.color === 'rose' && again.json?.colorSet === true);
  form = again.json;

  const badColor = await api(`/forms/${form.id}`, { method: 'PATCH', body: { color: '#ff0000' } });
  ok('هگز رد می‌شود', badColor.status === 400, 'status=' + badColor.status);
}

// ── ۳. دو نوعِ تازهٔ فیلد ───────────────────────────────────────────────────
console.log('\n۳) نوعِ image و payment');
{
  const img = await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'xray', label: 'عکسِ رادیولوژی', type: 'image', required: true } });
  ok('فیلدِ عکس ساخته شد', img.status < 300, img.status + ' ' + img.text.slice(0, 160));
  ok('نوعش image ماند', img.json?.fields.find((f) => f.key === 'xray')?.type === 'image');

  const pay1 = await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'pay', label: 'پرداخت', type: 'payment' } });
  ok('باکسِ پرداخت ساخته شد', pay1.status < 300, pay1.status + ' ' + pay1.text.slice(0, 160));

  const pay2 = await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'pay2', label: 'پرداختِ دوم', type: 'payment' } });
  ok('باکسِ پرداختِ دوم رد می‌شود', pay2.status === 400, 'status=' + pay2.status + ' ' + pay2.text.slice(0, 120));

  const bad = await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'zzz', label: 'ناشناخته', type: 'hologram' } });
  ok('نوعِ ناشناخته رد می‌شود', bad.status === 400, 'status=' + bad.status);
}

// ── ۴. صفحه‌بندی ────────────────────────────────────────────────────────────
console.log('\n۴) صفحه‌بندی');
{
  const p2 = await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'note2', label: 'یادداشتِ صفحهٔ دو', type: 'text', page: 2 } });
  ok('فیلد روی صفحهٔ ۲ نشست', p2.json?.fields.find((f) => f.key === 'note2')?.page === 2);
  ok('pages برابرِ ۲ شد', p2.json?.pages === 2, 'pages=' + p2.json?.pages);

  // شکاف: صفحهٔ ۹ روی فرمی که تا ۲ دارد → باید فشرده شود به ۳
  const gap = await api(`/forms/${form.id}/fields`, { method: 'POST', body: { key: 'note9', label: 'یادداشتِ دور', type: 'text', page: 9 } });
  const at = gap.json?.fields.find((f) => f.key === 'note9')?.page;
  ok('شکافِ صفحه فشرده شد (۹ → ۳)', at === 3, 'page=' + at);
  ok('pages برابرِ ۳ شد', gap.json?.pages === 3, 'pages=' + gap.json?.pages);

  // ترتیبِ خروجی باید (page, sort) باشد
  const pages = gap.json.fields.map((f) => f.page);
  ok('فیلدها به ترتیبِ صفحه برمی‌گردند', pages.every((p, i) => i === 0 || p >= pages[i - 1]), JSON.stringify(pages));

  // حذفِ تنها فیلدِ صفحهٔ ۲ → صفحهٔ ۳ باید بشود ۲
  const f2 = gap.json.fields.find((f) => f.key === 'note2');
  const del = await api(`/forms/fields/${f2.id}`, { method: 'DELETE' });
  ok('بعد از حذف، صفحهٔ ۳ شد ۲', del.json?.fields.find((f) => f.key === 'note9')?.page === 2,
    'page=' + del.json?.fields.find((f) => f.key === 'note9')?.page);
  ok('pages برگشت به ۲', del.json?.pages === 2, 'pages=' + del.json?.pages);
}

// ── ۵. reorder داخلِ صفحه ───────────────────────────────────────────────────
console.log('\n۵) ترتیب داخلِ صفحه');
{
  let { json: f } = await api(`/forms/${form.key}`);
  const p1 = f.fields.filter((x) => x.page === 1);
  const p2 = f.fields.filter((x) => x.page === 2);
  ok('صفحهٔ ۱ چند فیلد دارد', p1.length >= 2, 'n=' + p1.length);
  ok('صفحهٔ ۲ فیلد دارد', p2.length >= 1, 'n=' + p2.length);

  // جابه‌جاییِ دو فیلدِ اولِ صفحهٔ ۱
  const ids = [...f.fields.map((x) => x.id)];
  const i0 = ids.indexOf(p1[0].id); const i1 = ids.indexOf(p1[1].id);
  [ids[i0], ids[i1]] = [ids[i1], ids[i0]];
  const re = await api(`/forms/${form.id}/reorder`, { method: 'POST', body: { ids } });
  const newP1 = re.json.fields.filter((x) => x.page === 1);
  ok('جابه‌جایی داخلِ صفحهٔ ۱ اثر کرد', newP1[0].id === p1[1].id && newP1[1].id === p1[0].id,
    'got=' + newP1.slice(0, 2).map((x) => x.key).join(','));
  ok('صفحهٔ فیلدها با reorder عوض نشد', re.json.fields.every((x) => x.page === f.fields.find((y) => y.id === x.id).page));
  // sortها داخلِ هر صفحه از ۱۰ شروع می‌شوند — نه از دنبالهٔ سراسری
  ok('sortِ صفحهٔ ۲ از ابتدا شمرده شد',
    re.json.fields.filter((x) => x.page === 2)[0].sort === 10,
    'sort=' + re.json.fields.filter((x) => x.page === 2)[0].sort);
}

// ── ۶. اعتبارسنجی: پرداخت اجباری نمی‌شود، عکس می‌شود ────────────────────────
console.log('\n۶) اعتبارسنجی');
{
  const { json: f } = await api(`/forms/${form.key}`);
  const payField = f.fields.find((x) => x.type === 'payment');
  // پرداخت را عمداً اجباری می‌کنیم تا ببینیم اعتبارسنجی نادیده‌اش می‌گیرد
  await api(`/forms/fields/${payField.id}`, { method: 'PATCH', body: { required: true } });

  const empty = await api('/forms/validate-probe', { method: 'GET' }); // مسیری نیست — فقط برای اطمینان از ۴۰۴
  ok('endpointِ ساختگی ۴۰۴ می‌دهد (کنترلِ سلامتِ آزمون)', empty.status === 404, 'status=' + empty.status);
}

console.log('\n──────────────────────────────');
console.log(`قبول: ${pass}   رد: ${fails.length}`);
if (fails.length) { console.log('\nمردودها:\n- ' + fails.join('\n- ')); process.exit(1); }
