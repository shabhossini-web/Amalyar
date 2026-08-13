/**
 * دو تنانتِ **واقعی**، دو دیتابیسِ واقعی، یک بیمار با یک کدِ ملی در هر دو —
 * و هیچ نشتی.
 *
 * ⚠️ چرا این آزمون لازم بود: گزارش رسید که «تنانت‌ها از دیتابیسِ هم می‌خوانند؛
 * اگر یک بیمار در دو تنانت ثبت باشد از هر دو می‌خواند». ادعای درستی از این
 * جنس یعنی نقضِ قانون ۱۸ و بدترین باگِ ممکنِ یک SaaSِ پزشکی، پس با استدلال
 * بسته نمی‌شود — باید سنجیده شود.
 *
 * `verify-tenant-isolation.js` موجود مرزِ JWT را با DSNهای ساختگی می‌سنجد
 * (واحدی). این یکی مکملش است و **خواندنِ واقعی از دو دیتابیس** را می‌سنجد:
 * دو هاست، دو ورودِ جدا، دادهٔ متمایز، و ادعا روی آنچه هر هاست واقعاً دید.
 *
 * پیش‌نیاز (`scripts/e2e/README.md`): تنانتِ دوم `uitest2` روی `127.0.0.2`.
 * سوئیت با هر دو تنظیمِ API سبز می‌شود، ولی بندِ ۶ فقط وقتی **باربر** است که
 * `DEFAULT_TENANT_SLUG` ست باشد — چون تنها آن‌وقت مسیرِ fallback زنده است.
 * پس برای سنجشِ کامل، API را با `DEFAULT_TENANT_SLUG` بالا بیاورید.
 */
import { request as httpRequest } from 'node:http';

const HOST_A = process.env.E2E_HOST_A ?? '127.0.0.1';
const HOST_B = process.env.E2E_HOST_B ?? '127.0.0.2';
const PORT = process.env.E2E_PORT ?? '3101';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

/**
 * درخواست به یک هاستِ مشخص — همان چیزی که در production تنانت را تعیین می‌کند.
 *
 * ⚠️ `Host` را دستی ست نمی‌کنیم: `fetch` هدرِ Host را forbidden می‌داند و
 * بی‌صدا دور می‌ریزد. آنچه واقعاً روی سیم می‌رود hostnameِ خودِ URL است، پس
 * هاست از `http://${host}:${PORT}` می‌آید. برای Hostی که با URL فرق دارد
 * (بندِ ۶) باید از `rawGet` استفاده کرد.
 */
const call = async (host, path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(`http://${host}:${PORT}/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* متنِ خام */ }
  return { status: res.status, json, text };
};

/**
 * GETِ خام با `node:http` — تنها راهِ فرستادنِ Hostی که با مقصدِ TCP فرق
 * دارد. دقیقاً کاری که یک reverse-proxyِ اشتباه‌تنظیم‌شده (یا یک مهاجم)
 * می‌کند: به IPِ ما وصل شو، ولی نامِ دامنهٔ دیگری را اعلام کن.
 */
const rawGet = (ip, port, hostHeader, path, token) => new Promise((resolve, reject) => {
  const req = httpRequest(
    { host: ip, port, path, method: 'GET', headers: { Host: hostHeader, Authorization: 'Bearer ' + token } },
    (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    },
  );
  req.on('error', reject);
  req.end();
});

const signIn = async (host) => {
  const r = await call(host, '/auth/login', { method: 'POST', body: { identifier: USER, password: PASS } });
  if (!r.json?.accessToken) { console.error(`ورود روی ${host} نشد:`, r.text.slice(0, 200)); process.exit(1); }
  return r.json.accessToken;
};

/** کدِ ملیِ معتبرِ ساختگی — **یکی برای هر دو تنانت**، چون سناریو همین است. */
const nid = (n) => {
  const base = String(n).padStart(9, '0').slice(-9);
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(base[i]) * (10 - i);
  const r = s % 11;
  return base + String(r < 2 ? r : 11 - r);
};
const SHARED_NID = nid(Math.floor(Date.now() / 1000) % 900000 + 100000);

console.log('۰) هر هاست تنانتِ خودش را حل می‌کند');
const [tokA, tokB] = [await signIn(HOST_A), await signIn(HOST_B)];
ok(!!tokA && !!tokB, 'هر دو هاست ورودِ مستقل دادند');
ok(tokA !== tokB, 'توکن‌ها یکی نیستند');

/* ⚠️ کنترلِ سلامتِ آزمون: اگر هر دو هاست به یک دیتابیس بروند (مثلاً چون
   DEFAULT_TENANT_SLUG ست مانده)، بقیهٔ ادعاها بی‌معنی سبز می‌شوند. پس اول
   ثابت می‌کنیم دو دیتابیسِ متفاوت‌اند. */
const visitsA0 = await call(HOST_A, '/visits?pageSize=1', { token: tokA });
const visitsB0 = await call(HOST_B, '/visits?pageSize=1', { token: tokB });
const totalA0 = visitsA0.json?.total ?? (visitsA0.json?.rows ?? visitsA0.json)?.length;
const totalB0 = visitsB0.json?.total ?? (visitsB0.json?.rows ?? visitsB0.json)?.length;
console.log(`   مراجعاتِ A=${totalA0} · B=${totalB0}`);
/* ⚠️ اگر DEFAULT_TENANT_SLUG ست مانده باشد هر دو هاست به یک دیتابیس می‌روند و
   همهٔ ادعاهای بعدی بی‌معنی سبز می‌شوند. این بند همان را می‌گیرد. */
ok(totalA0 !== totalB0 || totalA0 === 0,
  `دو هاست دو دیتابیسِ جدا دارند (A=${totalA0} · B=${totalB0})`);

console.log('\n۱) توکنِ تنانتِ A روی هاستِ B پذیرفته نمی‌شود');
const cross = await call(HOST_B, '/visits', { token: tokA });
ok(cross.status === 401, `۴۰۱ گرفت (${cross.status})`);
const cross2 = await call(HOST_A, '/visits', { token: tokB });
ok(cross2.status === 401, `و برعکسش هم ۴۰۱ (${cross2.status})`);

console.log('\n۲) یک بیمار با **یک کدِ ملی** در هر دو تنانت ثبت می‌شود');
const [kA, sA, hA] = await Promise.all([
  call(HOST_A, '/forms/visit-kinds', { token: tokA }),
  call(HOST_A, '/surgeons', { token: tokA }),
  call(HOST_A, '/hospitals', { token: tokA }),
]);
const [kB, sB, hB] = await Promise.all([
  call(HOST_B, '/forms/visit-kinds', { token: tokB }),
  call(HOST_B, '/surgeons', { token: tokB }),
  call(HOST_B, '/hospitals', { token: tokB }),
]);
const pick = (r) => (r.json?.rows ?? r.json ?? [])[0]?.id;

/* تنانتِ تازه هیچ تعریفی ندارد و فرمِ عمل جراح/بیمارستان می‌خواهد؛ بدونِ این
   کمینه، ساختِ مراجعه در B با ۴۰۰ می‌افتد و بقیهٔ ادعاها بی‌معنی می‌شوند. */
const ensureDefs = async (host, token, sur, hos) => {
  let s = pick(sur), h = pick(hos);
  if (!s) {
    const r = await call(host, '/surgeons', {
      method: 'POST', token, body: { firstName: 'جراحِ', lastName: 'آزمون' },
    });
    s = r.json?.id;
  }
  if (!h) {
    const r = await call(host, '/hospitals', { method: 'POST', token, body: { name: 'بیمارستانِ آزمون' } });
    h = r.json?.id;
  }
  return { s, h };
};

const mkVisit = async (host, token, kinds, surgeonId, hospitalId) => call(host, '/visits', {
  method: 'POST', token,
  body: {
    kind: (kinds.json ?? [])[0]?.kind,
    firstName: 'مشترکِ', lastName: 'دوتننت', nationalId: SHARED_NID,
    ...(surgeonId ? { surgeonId } : {}), ...(hospitalId ? { hospitalId } : {}),
    opDate: new Date().toISOString(),
  },
});
const dA = await ensureDefs(HOST_A, tokA, sA, hA);
const dB = await ensureDefs(HOST_B, tokB, sB, hB);
const vA = await mkVisit(HOST_A, tokA, kA, dA.s, dA.h);
const vB = await mkVisit(HOST_B, tokB, kB, dB.s, dB.h);
ok(!!vA.json?.id, `در A ساخته شد (${vA.json?.code ?? vA.text.slice(0, 90)})`);
ok(!!vB.json?.id, `در B ساخته شد (${vB.json?.code ?? vB.text.slice(0, 90)})`);

console.log('\n۳) هر تنانت شرحِ متمایزِ خودش را می‌گیرد');
await call(HOST_A, `/patients/${vA.json.patientId}/notes`, {
  method: 'POST', token: tokA, body: { kind: 'progress', body: 'نشانهٔ تنانتِ الف — نباید در ب دیده شود' },
});
await call(HOST_B, `/patients/${vB.json.patientId}/notes`, {
  method: 'POST', token: tokB, body: { kind: 'progress', body: 'نشانهٔ تنانتِ ب — نباید در الف دیده شود' },
});

const recA = await call(HOST_A, `/patients/${vA.json.patientId}/record`, { token: tokA });
const recB = await call(HOST_B, `/patients/${vB.json.patientId}/record`, { token: tokB });
const bodiesA = (recA.json?.clinicalNotes ?? []).map((n) => n.body).join(' | ');
const bodiesB = (recB.json?.clinicalNotes ?? []).map((n) => n.body).join(' | ');

ok(/تنانتِ الف/.test(bodiesA), 'A شرحِ خودش را می‌بیند');
ok(!/تنانتِ ب/.test(bodiesA), '**A شرحِ B را نمی‌بیند**');
ok(/تنانتِ ب/.test(bodiesB), 'B شرحِ خودش را می‌بیند');
ok(!/تنانتِ الف/.test(bodiesB), '**B شرحِ A را نمی‌بیند**');
ok(recA.json?.counts?.notes === 1, `شمارشِ شرح‌های A دقیقاً ۱ است (${recA.json?.counts?.notes})`);
ok(recB.json?.counts?.notes === 1, `شمارشِ شرح‌های B دقیقاً ۱ است (${recB.json?.counts?.notes})`);

console.log('\n۴) جست‌وجوی همان کدِ ملی در هر تنانت فقط یک پرونده می‌دهد');
const findA = await call(HOST_A, `/patients/by-national-id?nid=${SHARED_NID}`, { token: tokA });
const findB = await call(HOST_B, `/patients/by-national-id?nid=${SHARED_NID}`, { token: tokB });
/* ⚠️ `undefined === undefined` سبز می‌شود — اگر ساختِ مراجعه شکسته باشد این
   بند بی‌صدا قبول می‌شد. پس وجودِ مقدار جدا سنجیده می‌شود. */
ok(!!vA.json?.patientId && findA.json?.patient?.id === vA.json.patientId, `A پروندهٔ خودش را پیدا می‌کند (${findA.json?.patient?.code})`);
ok(!!vB.json?.patientId && findB.json?.patient?.id === vB.json.patientId, `B پروندهٔ خودش را پیدا می‌کند (${findB.json?.patient?.code})`);
ok(findA.json?.patient?.id !== findB.json?.patient?.id || totalB0 === totalA0,
  'و این دو پرونده یکی نیستند — دو دیتابیسِ جدا');

console.log('\n۵) شناسهٔ پروندهٔ تنانتِ دیگر از این تنانت خوانده نمی‌شود');
/* اگر شناسه‌ها تصادفاً یکی باشند این ادعا بی‌معنی است، پس فقط وقتی سنجیده
   می‌شود که واقعاً متفاوت باشند. */
if (vA.json.patientId !== vB.json.patientId) {
  const leak = await call(HOST_A, `/patients/${vB.json.patientId}/record`, { token: tokA });
  /* شناسه‌ها عددی و per-tenant اند، پس همان id در A ممکن است پروندهٔ **دیگری**
     باشد. ادعا این نیست که ۴۰۴ بدهد؛ ادعا این است که هرچه برگشت، دادهٔ B
     نباشد. */
  ok((leak.json?.clinicalNotes ?? []).every((n) => !/تنانتِ ب/.test(n.body)),
    `خواندنِ همان شناسه از A دادهٔ B را نداد (${leak.status})`);
} else {
  console.log('  — شناسه‌ها یکی‌اند، این بند رد شد (نه شکست)');
}

console.log('\n۶) میزبانِ ثبت‌نشده هرگز به تنانتِ پیش‌فرض نمی‌افتد');
/* ⚠️ خطرناک‌ترین مسیرِ کلِ پروژه: تا دیروز هر Hostی که در `tenant_domains`
   نبود، بی‌سروصدا دیتابیسِ `DEFAULT_TENANT_SLUG` را می‌گرفت و تنها نگهبانش
   `NODE_ENV` بود. یعنی دامنهٔ شرکتِ تازه — که هنوز ثبت نشده — پروندهٔ
   بیمارانِ شرکتِ قبلی را نشان می‌داد. حالا میزبانِ غیرِloopback هرگز به
   پیش‌فرض نمی‌افتد. */
const ghost = await rawGet(HOST_A, PORT, 'ghost-clinic.example.com', '/api/visits', tokA);
ok(ghost.status === 404, `دامنهٔ ناشناخته ۴۰۴ گرفت، نه دادهٔ تنانتِ دیگر (${ghost.status})`);

console.log('\n' + '─'.repeat(50));
console.log(`قبول: ${pass}   رد: ${fail}`);
process.exit(fail ? 1 : 0);
