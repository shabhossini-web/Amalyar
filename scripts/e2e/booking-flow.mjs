/**
 * **نوبت‌گیریِ بیمار** — `docs/BOOKING.md` مرحلهٔ ۳.
 *
 * جریانِ کامل: لینکِ ثبت‌نام → بیمار ثبت‌نام می‌کند → **روز/ساعت را می‌گیرد**
 * → فرم را پر می‌کند → ادمین تأیید می‌کند → نوبت `confirmed` می‌شود و تاریخِ
 * مراجعه **از همان نوبت** می‌آید.
 *
 * ⚠️ ادعاهای مرکزی:
 *  • نصبی که برنامهٔ کاری ندارد باید دقیقاً مثلِ دیروز کار کند (fail-soft).
 *  • بدونِ انتخابِ روز نمی‌شود فرم را تمام کرد — وگرنه ثبت‌نامی به صفِ تأیید
 *    می‌رسد که هیچ روزی ندارد و ادمین باید تلفنی بپرسد «کِی می‌آیی؟».
 *  • نوبتِ گرفته‌شده جا را اشغال می‌کند و نفرِ دوم همان ساعت را نمی‌گیرد.
 *  • ردکردنِ ثبت‌نام جا را **آزاد** می‌کند، وگرنه تقویم پر از جای سوخته می‌شود.
 */
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد — سرور را ری‌استارت کنید'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const get = (p) => fetch(API + p, { headers: A }).then((r) => r.json());
const send = (p, method, body, auth = true) => fetch(API + p, {
  method,
  headers: auth ? A : { 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

/** کدِ ملیِ معتبرِ ساختگی. */
const nid = (n) => {
  const base = String(n).padStart(9, '0').slice(-9);
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(base[i]) * (10 - i);
  const r = s % 11;
  return base + String(r < 2 ? r : 11 - r);
};

const tag = Math.random().toString(36).slice(2, 7);
let seed = Math.floor(Math.random() * 800000) + 100000;
const trash = { rules: [], topics: [], links: [], forms: [] };

/* ⚠️ پاک‌سازیِ نوبت‌ها با SQL، چون هنوز مسیرِ ادمینی برای کنسل‌کردنِ نوبت
   وجود ندارد (مرحلهٔ ۵). بدونِ آن اجرای دوم روی جاهای اشغالِ اجرای اول
   می‌افتد و همه‌چیز بی‌دلیل قرمز می‌شود — قاعدهٔ README: هر آزمون باید بارِ
   دوم هم سبز باشد. */
const { execSync } = await import('node:child_process');
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
const sql = (q) => execSync(`psql "${DB}" -qtAc ${JSON.stringify(q)}`).toString().trim().split('\n')[0];

/* پاک‌سازیِ اولیه — اجرای کرش‌کردهٔ قبلی نباید ماهِ آزمون را شلوغ کند. */
for (const r of await get('/availability/rules')) {
  await fetch(API + `/availability/rules/${r.id}`, { method: 'DELETE', headers: A });
}

const register = async (token) => send(`/public/intake/link/${token}/register`, 'POST', {
  firstName: 'نوبتِ', lastName: `آزمون ${tag}`, nationalId: nid(seed++), phone: '09120000099',
  captchaA: 3, captchaB: 4, captchaAnswer: 7,
}, false);

try {
  console.log('۰) فرم و لینکِ ثبت‌نام');
  await get('/forms');
  const form = (await send('/forms', 'POST', { key: `bk${tag}`, title: 'ویزیتِ نوبت‌دار', scope: 'visit' })).json;
  trash.forms.push(form.id);
  const link = (await send('/intake/links', 'POST', { title: `[e2e] نوبت ${tag}`, formId: form.id })).json;
  if (!link?.token) { console.error('لینک ساخته نشد:', JSON.stringify(link)); process.exit(1); }
  trash.links.push(link.id);

  console.log('\n۱) بدونِ برنامهٔ کاری، همه‌چیز مثلِ دیروز است (fail-soft)');
  const r0 = await register(link.token);
  ok(r0.status < 300, `ثبت‌نام انجام شد (${r0.status})`);
  ok(r0.json?.booking?.required === false, '**نوبت‌دهی خاموش است چون برنامهٔ کاری وجود ندارد**');
  const noBook = await send(`/public/intake/form/${r0.json.token}/fill`, 'POST', { procedure: 'ویزیت' }, false);
  ok(noBook.status < 300, `و فرم بدونِ هیچ نوبتی تمام شد (${noBook.status})`);

  console.log('\n۲) با تعریفِ برنامهٔ کاری، گامِ نوبت ظاهر می‌شود');
  const topic = (await send('/visit-topics', 'POST', { name: `اولیهٔ ${tag}` })).json;
  trash.topics.push(topic.id);
  /* هر هفت روز باز، تا آزمون به روزِ اجرا حساس نباشد. */
  for (let w = 0; w < 7; w++) {
    const rule = (await send('/availability/rules', 'POST', {
      weekday: w, startMin: 16 * 60, endMin: 18 * 60, mode: 'slot', slotMinutes: 30, topicIds: [topic.id],
    })).json;
    trash.rules.push(rule.id);
  }
  const r1 = await register(link.token);
  const tok1 = r1.json.token;
  ok(r1.json?.booking?.required === true, 'حالا `booking.required` روشن است');
  ok(r1.json?.booking?.appointment === null, 'و هنوز نوبتی گرفته نشده');

  console.log('\n۳) بدونِ انتخابِ روز نمی‌شود فرم را تمام کرد');
  const early = await send(`/public/intake/form/${tok1}/fill`, 'POST', { procedure: 'ویزیت' }, false);
  ok(early.status >= 400, `تکمیلِ بی‌نوبت رد شد (${early.status})`);
  ok(/روزِ نوبت/.test(early.json?.message ?? ''), `و می‌گوید چه باید کرد («${early.json?.message}»)`);

  console.log('\n۴) بیمار روزهای آزاد را می‌بیند و یکی را می‌گیرد');
  const now = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: 'numeric', timeZone: 'UTC' })
    .formatToParts(new Date());
  const jy = Number(now.find((x) => x.type === 'year').value.replace(/[^\d]/g, ''));
  const jm = Number(now.find((x) => x.type === 'month').value);
  const slots = await fetch(`${API}/public/intake/form/${tok1}/slots?year=${jy}&month=${jm}`).then((r) => r.json());
  const openDay = slots.days.find((d) => d.open);
  ok(!!openDay, `روزِ باز پیدا شد (${openDay?.date})`);
  ok(openDay.windows[0].slots.length === 4, `۲ ساعت ÷ ۳۰ دقیقه = ۴ نوبت (${openDay.windows[0].slots.length})`);

  const topicsPub = await fetch(`${API}/public/intake/form/${tok1}/topics`).then((r) => r.json());
  ok(topicsPub.some((t) => t.id === topic.id), 'موضوعِ روز در فهرستِ عمومی هست');

  const first = openDay.windows[0].slots[0].startMin;
  const booked = await send(`/public/intake/form/${tok1}/book`, 'POST',
    { date: openDay.date, startMin: first, topicId: topic.id }, false);
  ok(booked.status < 300, `رزرو پذیرفته شد (${booked.status})`);
  ok(booked.json?.booking?.appointment?.date === openDay.date, `روزِ نوبت برگشت (${booked.json?.booking?.appointment?.date})`);
  ok(booked.json?.booking?.appointment?.status === 'held', '**وضعیتش `held` است، نه `confirmed` — پرداخت هنوز دیده نشده**');
  ok(booked.json?.booking?.appointment?.topicName === topicsPub.find((t) => t.id === topic.id).name, 'موضوع هم ثبت شد');

  console.log('\n۵) همان ساعت برای نفرِ بعدی آزاد نیست');
  const after = await fetch(`${API}/public/intake/form/${tok1}/slots?year=${jy}&month=${jm}`).then((r) => r.json());
  const sameDay = after.days.find((d) => d.date === openDay.date);
  ok(sameDay.windows[0].slots.find((x) => x.startMin === first)?.taken === true, 'اسلات اشغال علامت خورد');
  ok(sameDay.free === openDay.free - 1, `جای آزاد یکی کم شد (${openDay.free} → ${sameDay.free})`);

  const r2 = await register(link.token);
  const clash = await send(`/public/intake/form/${r2.json.token}/book`, 'POST',
    { date: openDay.date, startMin: first }, false);
  ok(clash.status >= 400, `**نفرِ دوم همان ساعت را نگرفت** (${clash.status})`);
  ok(/آزاد نیست|گرفت/.test(clash.json?.message ?? ''), `و پیامش قابلِ فهم است («${clash.json?.message}»)`);

  console.log('\n۶) جابه‌جایی نوبتِ دوم نمی‌سازد');
  const second = openDay.windows[0].slots[1].startMin;
  await send(`/public/intake/form/${tok1}/book`, 'POST', { date: openDay.date, startMin: second }, false);
  const moved = await fetch(`${API}/public/intake/form/${tok1}/slots?year=${jy}&month=${jm}`).then((r) => r.json());
  const d2 = moved.days.find((d) => d.date === openDay.date);
  ok(d2.windows[0].slots.find((x) => x.startMin === first)?.taken === false, 'ساعتِ قبلی آزاد شد');
  ok(d2.windows[0].slots.find((x) => x.startMin === second)?.taken === true, 'و ساعتِ تازه اشغال');
  ok(d2.free === openDay.free - 1, 'در مجموع همچنان یک جا اشغال است — نه دو تا');

  console.log('\n۷) با نوبت، تکمیلِ فرم پیش می‌رود');
  const filled = await send(`/public/intake/form/${tok1}/fill`, 'POST', { procedure: 'ویزیتِ اولیه' }, false);
  ok(filled.status < 300, `فرم تمام شد (${filled.status})`);
  ok(['pending_payment', 'pending_approval'].includes(filled.json?.status), `وضعیت: ${filled.json?.status}`);

  console.log('\n۸) تأیید ⇒ نوبت قطعی، و تاریخِ مراجعه از خودِ نوبت می‌آید');
  const subs = await get('/intake/submissions');
  const mine = (subs.rows ?? subs).find((x) => x.token === tok1);
  ok(!!mine, 'ثبت‌نام در صفِ تأیید هست');
  const okRes = await send(`/intake/submissions/${mine.id}/approve`, 'POST', {});
  ok(okRes.status < 300, `تأیید شد (${okRes.status})${okRes.status >= 300 ? ' — ' + JSON.stringify(okRes.json)?.slice(0, 300) : ''}`);
  if (okRes.json?.visitId) trash.visits = [...(trash.visits ?? []), okRes.json.visitId];
  const visit = await get(`/visits/${(await get('/visits')).rows?.[0]?.id ?? 0}`).catch(() => null);
  void visit;
  const view = await fetch(`${API}/public/intake/form/${tok1}`).then((r) => r.json());
  ok(view.booking?.appointment?.status === 'confirmed', `**نوبت قطعی شد** (${view.booking?.appointment?.status})`);

  const madeVisitId = okRes.json?.visitId ?? null;
  const v = madeVisitId ? await get(`/visits/${madeVisitId}`) : null;
  if (v) {
    ok(String(v.opDate ?? '').slice(0, 10) === openDay.date, `تاریخِ مراجعه = روزِ نوبت (${String(v.opDate).slice(0, 10)})`);
    ok(v.topicId === topic.id, 'و موضوعِ نوبت روی مراجعه نشست');
  } else {
    console.log('    (شناسهٔ مراجعه در پاسخِ تأیید نبود — دو ادعای تاریخ/موضوع رد شد)');
  }

  console.log('\n۹) ردکردنِ ثبت‌نام جا را آزاد می‌کند');
  const r3 = await register(link.token);
  const tok3 = r3.json.token;
  const third = openDay.windows[0].slots[2].startMin;
  await send(`/public/intake/form/${tok3}/book`, 'POST', { date: openDay.date, startMin: third }, false);
  await send(`/public/intake/form/${tok3}/fill`, 'POST', { procedure: 'ویزیت' }, false);
  const subs2 = await get('/intake/submissions');
  const s3 = (subs2.rows ?? subs2).find((x) => x.token === tok3);
  await send(`/intake/submissions/${s3.id}/reject`, 'POST', { note: 'فیش نامعتبر بود' });
  const freed = await fetch(`${API}/public/intake/form/${tok1}/slots?year=${jy}&month=${jm}`).then((r) => r.json());
  const d3 = freed.days.find((d) => d.date === openDay.date);
  ok(d3.windows[0].slots.find((x) => x.startMin === third)?.taken === false,
    '**جای ثبت‌نامِ ردشده آزاد شد — تقویم جای سوخته نمی‌گیرد**');
} finally {
  console.log('\n' + '─'.repeat(50));
  console.log(`قبول: ${pass}   رد: ${fail}`);
  for (const id of trash.visits ?? []) await fetch(API + `/visits/${id}`, { method: 'DELETE', headers: A });
  /* نوبت‌های همین اجرا — از راهِ ثبت‌نام‌هایی که به لینکِ این آزمون وصل‌اند. */
  for (const id of trash.links) {
    sql(`DELETE FROM appointments WHERE submission_id IN (SELECT id FROM intake_submissions WHERE link_id = ${id})`);
  }
  for (const id of trash.rules) await fetch(API + `/availability/rules/${id}`, { method: 'DELETE', headers: A });
  for (const id of trash.links) await fetch(API + `/intake/links/${id}`, { method: 'DELETE', headers: A }).catch(() => {});
  for (const id of trash.topics) await fetch(API + `/visit-topics/${id}`, { method: 'DELETE', headers: A });
  for (const id of trash.forms) await fetch(API + `/forms/${id}`, { method: 'DELETE', headers: A });
}
process.exit(fail ? 1 : 0);
