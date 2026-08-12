/**
 * مرحلهٔ ۵ — **رنگ و تفکیکِ نوعِ مراجعه در داشبورد**.
 *
 * ⚠️ سه نقصِ بی‌صدا که این فایل نگهبانشان است:
 *
 * ۱) ردیفِ انتخابِ نوع در داشبورد **هاردکد** بود. نوعی که کاربر در فرم‌ساز
 *    می‌ساخت، `/forms/visit-kinds` می‌شناختش و `approve` هم درست می‌ساختش —
 *    ولی در داشبورد دیده نمی‌شد. هیچ خطایی نبود؛ فقط یک نوعِ نامرئی.
 *
 * ۲) رنگِ کارت اگر در مرورگر مشتق می‌شد، یک فرم در داشبورد یک رنگ و در
 *    فرم‌ساز رنگِ دیگری می‌گرفت. پس `kindTitle`/`kindColor` باید **از سرور**
 *    بیایند (قانون ۱۵).
 *
 * ۳) رنگِ خودکار hashِ خالی بود و hash تصادم دارد — دو نوعِ مراجعه دقیقاً
 *    یک‌شکل می‌شدند، یعنی همان تفکیکی که خواسته شده بود وجود نداشت.
 *
 * اجرا: `node scripts/e2e/dashboard-kind.mjs`
 */
const API = 'http://localhost:3101/api';
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

TOKEN = (await api('/auth/login', { method: 'POST', body: { identifier: 'admin', password: 'test1234' } })).json?.accessToken;
if (!TOKEN) { console.error('ورود نشد'); process.exit(1); }

/** کدِ ملیِ چک‌سام‌درست — وگرنه اجرای دوم روی کدِ تکراری ۴۰۰ می‌گیرد. */
function nid(seed) {
  const base = String(seed % 1_000_000_000).padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(base[i]) * (10 - i);
  const r = sum % 11;
  return base + String(r < 2 ? r : 11 - r);
}
const RUN = Math.floor(Date.now() / 1000) % 100_000_000;

/** پالتِ کلاینت — عیناً از `src/lib/formColor.js`. اگر این دو از هم جدا شوند
    سرور توکنی می‌فرستد که مرورگر نمی‌تواند بکشد و کارت **بی‌رنگ** می‌ماند. */
const COLOR_KEYS = ['violet', 'teal', 'amber', 'rose', 'sky', 'lime', 'fuchsia', 'slate'];

/** بازاستفاده نه حذف‌وساخت — فرمی که مراجعه دارد فقط خاموش می‌شود. */
async function ensureForm(key, title, scope, patch = {}) {
  const full = scope === 'visit' ? `visit.${key}` : key;
  const f = (await api('/forms')).json.find((x) => x.key === full);
  if (f) {
    await api(`/forms/${f.id}`, { method: 'PATCH', body: { active: true, title, ...patch } });
    return (await api(`/forms/${encodeURIComponent(full)}`)).json;
  }
  const made = await api('/forms', { method: 'POST', body: { key, title, scope } });
  if (!made.json?.id) { console.error('فرم ساخته نشد: ' + made.text.slice(0, 200)); process.exit(1); }
  if (Object.keys(patch).length) await api(`/forms/${made.json.id}`, { method: 'PATCH', body: patch });
  return (await api(`/forms/${encodeURIComponent(full)}`)).json;
}

const surgeon = (await api('/surgeons')).json?.[0]
  ?? (await api('/surgeons', { method: 'POST', body: { firstName: 'جراحِ', lastName: 'آزمون' } })).json;
const hospital = (await api('/hospitals')).json?.[0]
  ?? (await api('/hospitals', { method: 'POST', body: { name: '[dk] بیمارستانِ آزمون' } })).json;

// فرمِ مراجعه با رنگِ **انتخابی**، و یکی که رنگش را سرور می‌دهد
const picked = await ensureForm('dkPicked', '[dk] ویزیتِ رنگی', 'visit', { color: 'fuchsia' });
const auto = await ensureForm('dkAuto', '[dk] پیگیریِ خودکار', 'visit');

console.log('\n۱) `/forms/visit-kinds` نوعِ ساخته‌شده را با عنوان و رنگ می‌دهد');
{
  const kinds = (await api('/forms/visit-kinds')).json;
  ok('پاسخ آرایه است', Array.isArray(kinds), typeof kinds);
  const p = kinds.find((k) => k.kind === 'dkPicked');
  const a = kinds.find((k) => k.kind === 'dkAuto');
  ok('نوعِ رنگی در فهرست هست', !!p, kinds.map((k) => k.kind).join('،'));
  ok('نوعِ خودکار هم هست', !!a);
  ok('عنوان همان عنوانِ فرم است', p?.title === '[dk] ویزیتِ رنگی', 'title=' + p?.title);
  ok('رنگِ انتخابی برمی‌گردد', p?.color === 'fuchsia', 'color=' + p?.color);
  ok('رنگِ خودکار خالی نیست', !!a?.color, 'color=' + a?.color);
  ok('همهٔ رنگ‌ها از پالتِ مشترک‌اند', kinds.length > 0 && kinds.every((k) => COLOR_KEYS.includes(k.color)),
    kinds.map((k) => k.color).join('،'));

  /* ⚠️ **مهم‌ترین ادعای این فایل.** تا وقتی رنگ فقط hashِ کلید بود، دو نوع
     می‌توانستند یک رنگ بگیرند — و گرفتند: «فرمِ عمل» و «پیگیری» هر دو
     کهربایی شدند، یعنی همان تفکیکی که کاربر خواسته بود اصلاً وجود نداشت و
     هیچ خطایی هم نمی‌داد. حالا رنگ هنگامِ **ساخت** تثبیت می‌شود و در پالت
     تا اولین رنگِ آزاد جلو می‌رود.

     ⚠️ ادعا فقط دربارهٔ رنگِ **خودکار** است، نه هر دو نوع. همین فایل چند خط
     بالاتر `dkPicked` را با `color: 'fuchsia'`ِ **صریح** می‌سازد؛ اگر کاربر
     عمداً رنگی را دوباره انتخاب کند، انتخابش محترم است و کارِ آزمون نیست که
     جلویش را بگیرد. آنچه باید تضمین شود این است که **سرور خودش** رنگِ
     گرفته‌شده انتخاب نکند. (نسخهٔ اول یکتاییِ سراسری را می‌سنجید و درست به
     همین دلیل قرمز شد.) */
  const others = kinds.filter((k) => k.kind !== 'dkAuto').map((k) => k.color);
  ok('رنگی که سرور خودش داد، نوعِ دیگری نگرفته است',
    others.length >= COLOR_KEYS.length || !others.includes(a?.color),
    `خودکار=${a?.color} بقیه=${others.join('،')}`);
}

console.log('\n۲) مراجعه با `kindTitle` و `kindColor` از سرور می‌آید');
let visitId = 0;
{
  const made = await api('/visits', {
    method: 'POST',
    body: {
      kind: 'dkPicked', firstName: 'رنگین', lastName: 'کمانی',
      nationalId: nid(RUN * 23 + 7), phone: '09120000051',
      surgeonId: surgeon?.id, hospitalId: hospital?.id,
      opDate: new Date().toISOString().slice(0, 10),
    },
  });
  ok('مراجعه ثبت شد', made.status < 300, made.status + ' ' + made.text.slice(0, 180));
  visitId = made.json?.id;
  ok('نوع همان چیزی است که فرستادیم', made.json?.kind === 'dkPicked', 'kind=' + made.json?.kind);
  /* ⚠️ داشبورد پاسخِ ثبت را مستقیم به فهرستش اضافه می‌کند؛ اگر این‌جا نگاشت
     نمی‌رسید، کارتِ تازه بی‌رنگ می‌نشست تا وقتی کاربر صفحه را تازه کند — و
     چون بعد از تازه‌سازی درست می‌شد، کسی باور نمی‌کرد باگ است. */
  ok('عنوانِ نوع در پاسخِ ثبت هست', made.json?.kindTitle === '[dk] ویزیتِ رنگی', 'kindTitle=' + made.json?.kindTitle);
  ok('رنگِ نوع در پاسخِ ثبت هست', made.json?.kindColor === 'fuchsia', 'kindColor=' + made.json?.kindColor);
}

console.log('\n۳) همان دو فیلد در تکِ مراجعه و در فهرست هم هست');
{
  const one = (await api(`/visits/${visitId}`)).json;
  ok('تکِ مراجعه عنوان دارد', one?.kindTitle === '[dk] ویزیتِ رنگی', 'kindTitle=' + one?.kindTitle);
  ok('تکِ مراجعه رنگ دارد', one?.kindColor === 'fuchsia', 'kindColor=' + one?.kindColor);

  /* ⚠️ فهرست مسیرِ جدایی دارد (`.map(enrich)`) و دقیقاً همان‌جا بود که نگاشت
     فراموش می‌شد: `Array.map` ایندکس را به‌عنوانِ آرگومانِ دوم می‌فرستد، پس
     یک **عدد** به‌جای نگاشتِ نوع‌ها می‌رسید. */
  const list = (await api('/visits?q=' + encodeURIComponent('کمانی'))).json;
  const row = list?.rows?.find((v) => v.id === visitId);
  ok('مراجعه در فهرست پیدا شد', !!row, 'rows=' + (list?.rows?.length ?? 'ندارد'));
  ok('ردیفِ فهرست عنوانِ نوع دارد', row?.kindTitle === '[dk] ویزیتِ رنگی', 'kindTitle=' + row?.kindTitle);
  ok('ردیفِ فهرست رنگِ نوع دارد', row?.kindColor === 'fuchsia', 'kindColor=' + row?.kindColor);
  ok('هیچ ردیفی رنگِ خارج از پالت ندارد',
    (list?.rows ?? []).length > 0 && (list?.rows ?? []).every((v) => v.kindColor === null || COLOR_KEYS.includes(v.kindColor)),
    (list?.rows ?? []).map((v) => v.kindColor).join('،'));

  // ویرایش هم باید نگاشت را برگرداند — مسیرِ نوشتنِ دیگری است
  const upd = await api(`/visits/${visitId}`, { method: 'PATCH', body: { notes: 'یادداشتِ آزمون' } });
  ok('پاسخِ ویرایش هم عنوانِ نوع دارد', upd.json?.kindTitle === '[dk] ویزیتِ رنگی', 'kindTitle=' + upd.json?.kindTitle);
  ok('پاسخِ ویرایش هم رنگ دارد', upd.json?.kindColor === 'fuchsia', 'kindColor=' + upd.json?.kindColor);

  const st = await api(`/visits/${visitId}/status`, { method: 'PATCH', body: { opStatus: 'done' } });
  ok('پاسخِ تغییرِ وضعیت هم نگاشت دارد', st.json?.kindColor === 'fuchsia', 'kindColor=' + st.json?.kindColor);
  await api(`/visits/${visitId}/status`, { method: 'PATCH', body: { opStatus: 'pending' } });
}

console.log('\n۴) نوعی که فرم ندارد → `null` می‌گیرد، نه «جراحی»');
{
  /* ⚠️ ادعای اصلیِ این بخش: کلاینت حق ندارد نوعِ ناشناخته را «عمل» بنامد.
     فرم را خاموش می‌کنیم و همان مراجعه باید بی‌عنوان و بی‌رنگ برگردد. */
  const off = await api(`/forms/${picked.id}`, { method: 'PATCH', body: { active: false } });
  ok('فرم خاموش شد', off.status < 300, off.status + ' ' + off.text.slice(0, 140));

  const kinds = (await api('/forms/visit-kinds')).json;
  ok('نوع از فهرستِ انتخابگر رفت', !kinds.some((k) => k.kind === 'dkPicked'), kinds.map((k) => k.kind).join('،'));

  const one = (await api(`/visits/${visitId}`)).json;
  ok('مراجعه هنوز `kind` خودش را دارد', one?.kind === 'dkPicked', 'kind=' + one?.kind);
  ok('عنوانِ نوع `null` شد', one?.kindTitle === null, 'kindTitle=' + JSON.stringify(one?.kindTitle));
  ok('رنگِ نوع `null` شد', one?.kindColor === null, 'kindColor=' + JSON.stringify(one?.kindColor));

  await api(`/forms/${picked.id}`, { method: 'PATCH', body: { active: true } });
  const back = (await api(`/visits/${visitId}`)).json;
  ok('با روشن‌شدنِ فرم عنوان برمی‌گردد', back?.kindTitle === '[dk] ویزیتِ رنگی', 'kindTitle=' + back?.kindTitle);
}

console.log('\n۵) عوض‌کردنِ رنگِ فرم، رنگِ کارت‌های موجود را هم عوض می‌کند');
{
  /* رنگ روی **فرم** است نه روی مراجعه — پس تغییرش گذشته را هم می‌گیرد.
     اگر رنگ هنگامِ ثبت روی مراجعه snapshot می‌شد، کاربر رنگ را عوض می‌کرد و
     هیچ‌چیز در داشبورد تغییر نمی‌کرد. */
  await api(`/forms/${picked.id}`, { method: 'PATCH', body: { color: 'lime' } });
  const one = (await api(`/visits/${visitId}`)).json;
  ok('کارتِ قدیمی رنگِ تازه گرفت', one?.kindColor === 'lime', 'kindColor=' + one?.kindColor);
  ok('عنوان دست‌نخورده ماند', one?.kindTitle === '[dk] ویزیتِ رنگی', 'kindTitle=' + one?.kindTitle);
  await api(`/forms/${picked.id}`, { method: 'PATCH', body: { color: 'fuchsia' } });
}

console.log('\n۶) رنگِ نامعتبر رنگِ فعلی را خراب نمی‌کند');
{
  /* هگز توکن نیست؛ `normColor` ردش می‌کند. مهم این است که نتیجه‌اش
     «رنگ پاک شد» نباشد — وگرنه یک تایپِ کاربر کارت را بی‌رنگ می‌کرد. */
  await api(`/forms/${picked.id}`, { method: 'PATCH', body: { color: '#ff0000' } });
  const still = (await api(`/visits/${visitId}`)).json;
  ok('رنگ همچنان از پالت است', COLOR_KEYS.includes(still?.kindColor), 'kindColor=' + still?.kindColor);
  await api(`/forms/${picked.id}`, { method: 'PATCH', body: { color: 'fuchsia' } });
}

console.log('\n۷) آمارِ داشبورد نوع‌های موجود را می‌شمارد');
{
  /* `stats` در **ریشهٔ** پاسخ است نه زیرِ `meta` — داشبورد خودش `meta` را از
     `res.total`/`res.pages`/`res.stats` می‌سازد. */
  const res = (await api('/visits?page=1')).json;
  ok('آمارِ نوع‌ها برمی‌گردد', Array.isArray(res?.stats?.kinds), JSON.stringify(res?.stats)?.slice(0, 160));
  ok('نوعِ تازه در آمار هست', (res?.stats?.kinds ?? []).includes('dkPicked'),
    JSON.stringify(res?.stats?.kinds)?.slice(0, 200));

  const only = (await api('/visits?kind=dkPicked')).json;
  ok('فیلترِ نوع کار می‌کند', (only?.rows ?? []).length > 0 && (only?.rows ?? []).every((v) => v.kind === 'dkPicked'),
    (only?.rows ?? []).map((v) => v.kind).join('،'));
  ok('مراجعهٔ آزمون در فیلتر هست', (only?.rows ?? []).some((v) => v.id === visitId));
}

// ── پاک‌سازی ────────────────────────────────────────────────────────────────
await api(`/visits/${visitId}`, { method: 'DELETE' });
await api(`/forms/${auto.id}`, { method: 'DELETE' });

console.log(`\n${'─'.repeat(58)}\n${pass} ادعا درست`);
if (fails.length) { console.log(`${fails.length} شکست:`); fails.forEach((f) => console.log('  • ' + f)); process.exit(1); }
console.log('همه سبز ✅');
