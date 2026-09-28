/**
 * **دادهٔ واقعی‌نما برای بررسیِ UX** (اسکیلِ `ux-audit`) — فقط روی دیتابیسِ تازهٔ بررسی، هرگز
 * روی نصبِ واقعی: بیمار، مراجعه، عمل، نوبت و پیوندِ عمومی می‌سازد.
 *
 *   UX_API_CLINIC=http://127.0.0.1:3502/api UX_API_COMPANY=http://127.0.0.2:3502/api \
 *   JWT_SECRET=… UX_OUT=/tmp/ux-audit node scripts/ux/seed-demo.mjs
 *
 * مطب (`UX_API_CLINIC`): جراحِ مغز و اعصاب — ویزیت‌های اولیه با تشخیص و تصمیم، عمل‌های
 * گذشته/امروز/آینده/بی‌تاریخ/لغوشده، ترخیص، نوبت‌های امروزِ میزِ پذیرش.
 * شرکت (`UX_API_COMPANY`): نورومانیتورینگ + ایمپلنت — کارشناس‌ها، خدمت‌های روزهای مختلف،
 * و ثبت‌نام‌های عمومی در صفِ بررسی (با عکسِ کارت ملی/دستور پزشک/فیش).
 * پیوندهای عمومی و توکن‌ها در `$UX_OUT/links.json` نوشته می‌شوند (برای `flows.mjs`).
 * هر خطا گزارش می‌شود و اجرا ادامه پیدا می‌کند. `JWT_SECRET` برای بازکردنِ پرسشِ امنیتیِ ثبت‌نام است.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { captchaFor } from '../e2e/lib/captcha.mjs';

const T1 = process.env.UX_API_CLINIC ?? '';
const T2 = process.env.UX_API_COMPANY ?? '';
const UX_OUT = process.env.UX_OUT ?? '/tmp/ux-audit';
const USER = process.env.UX_USER ?? 'admin';
const PASS = process.env.UX_PASS ?? 'test1234';
const log = (...a) => console.log(...a);
const bad = [];

const day = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const iso = (d, h = 9, m = 0) => { const x = new Date(Date.now() + d * 864e5); x.setUTCHours(h - 3, m - 30, 0, 0); return x.toISOString(); };
let seq = 7;
const nid = () => {
  seq += 13;
  const base = String(1000000 + (seq * 7919) % 8999999).padStart(9, '0').slice(0, 9);
  const s = [...base].reduce((a, d, i) => a + Number(d) * (10 - i), 0) % 11;
  return base + String(s < 2 ? s : 11 - s);
};
let ph = 1234567;
const phone = () => { ph = (ph * 7 + 1911) % 8999999 + 1000000; return '0912' + String(ph).slice(0, 7); };

async function client(API, user = USER, pass = PASS) {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: user, password: pass }) }).then((x) => x.json());
  if (!r?.accessToken) throw new Error('ورود نشد: ' + JSON.stringify(r).slice(0, 200));
  const send = async (p, m = 'GET', b) => {
    const res = await fetch(API + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + r.accessToken }, body: b !== undefined ? JSON.stringify(b) : undefined });
    const json = await res.json().catch(() => null);
    if (res.status >= 400) { bad.push(`${m} ${p} → ${res.status} ${JSON.stringify(json?.message ?? json).slice(0, 180)}`); }
    return json;
  };
  return send;
}

/* ─────────────── مطب ─────────────── */
async function clinic() {
  const send = await client(T1);
  log('── مطب');
  await send('/config/profile', 'PATCH', { kind: 'clinic', services: [] });
  await send('/settings', 'PATCH', { values: {
    brand_name: 'مطب دکتر رحیمی',
    company_legal_name: 'مطب تخصصی جراحی مغز و اعصاب دکتر سعید رحیمی',
    company_phone: '021-88776655',
    company_address: 'تهران، خیابان ولیعصر، بالاتر از پارک ساعی، ساختمان پزشکان سینا، طبقهٔ سوم',
  } });
  await send('/forms');
  const kinds = await send('/forms/visit-kinds') ?? [];
  for (const [kind, title] of [['clinic', 'فرمِ ویزیت'], ['surgery', 'فرمِ عمل']]) {
    if (!kinds.some((k) => (k.kind ?? k.key) === kind)) await send('/forms', 'POST', { key: kind, title, scope: 'visit' });
  }
  await send('/forms/subforms');

  /* مدیر = خودِ پزشک */
  const me = await send('/auth/me');
  if (me?.id) await send(`/accounts/${me.id}`, 'PATCH', { firstName: 'سعید', lastName: 'رحیمی' });

  const acc = [];
  for (const a of [
    { firstName: 'مریم', lastName: 'احمدی', level: 3, jobRole: 'secretary', username: 'monshi' },
    { firstName: 'زهرا', lastName: 'کریمی', level: 2, jobRole: 'nurse', username: 'parastar' },
    { firstName: 'امیر', lastName: 'صادقی', level: 2, jobRole: 'assistant', username: 'dastyar' },
  ]) acc.push(await send('/accounts/temporary', 'POST', { ...a, phone: phone() }));

  /* تعریف‌ها */
  const surgeons = await send('/surgeons') ?? [];
  const list = surgeons.rows ?? surgeons;
  let s1 = list.find((s) => (s.lastName ?? s.person?.lastName) === 'آزمون');
  if (s1) await send(`/surgeons/${s1.id}`, 'PATCH', { firstName: 'سعید', lastName: 'رحیمی', specialty: 'جراحی مغز و اعصاب' });
  else s1 = await send('/surgeons', 'POST', { firstName: 'سعید', lastName: 'رحیمی', specialty: 'جراحی مغز و اعصاب' });
  const s2 = await send('/surgeons', 'POST', { firstName: 'علی', lastName: 'نوری', specialty: 'جراحی ستون فقرات', phone: phone() });
  const hosps = await send('/hospitals') ?? [];
  const hl = hosps.rows ?? hosps;
  let h1 = hl.find((h) => h.name === 'بیمارستان آزمون');
  if (h1) await send(`/hospitals/${h1.id}`, 'PATCH', { name: 'بیمارستان پارس', city: 'تهران', sector: 'private' });
  else h1 = await send('/hospitals', 'POST', { name: 'بیمارستان پارس', city: 'تهران', sector: 'private' });
  const h2 = await send('/hospitals', 'POST', { name: 'بیمارستان آتیه', city: 'تهران', sector: 'private' });
  const h3 = await send('/hospitals', 'POST', { name: 'بیمارستان شهدای تجریش', city: 'تهران', sector: 'public' });

  const dx = {};
  for (const [k, title, icd] of [
    ['hnp', 'فتق دیسک کمری', 'M51.2'], ['cs', 'تنگی کانال نخاعی گردنی', 'M48.02'],
    ['ls', 'تنگی کانال نخاعی کمری', 'M48.06'], ['men', 'مننژیوم', 'D32.9'],
    ['mig', 'میگرن', 'G43.9'], ['cts', 'سندرم تونل کارپ', 'G56.0'],
  ]) dx[k] = await send('/diagnoses', 'POST', { title, icdCode: icd });
  const pr = {};
  for (const [k, name, care] of [
    ['mdx', 'میکرودیسککتومی کمری', 'تا دو هفته از خم‌شدن و بلندکردنِ بارِ سنگین پرهیز کنید. پانسمان را خشک نگه دارید.'],
    ['acdf', 'دیسککتومی و فیوژن گردنی (ACDF)', 'گردن‌بند طبیِ نرم تا ده روز. در صورتِ اشکال در بلع با مطب تماس بگیرید.'],
    ['lam', 'لامینکتومی کمری', 'راه‌رفتنِ کوتاه از روزِ اول. تا ۶ هفته ورزشِ سنگین ممنوع.'],
    ['cran', 'کرانیوتومی و برداشتنِ تومور', 'داروی ضدتشنج را قطع نکنید. هرگونه سردردِ شدید یا تب را فوراً گزارش دهید.'],
    ['ctr', 'آزادسازیِ تونل کارپ', 'دست را بالا نگه دارید و انگشتان را حرکت دهید.'],
  ]) pr[k] = await send('/procedure-types', 'POST', { name, postOpCare: care, followUpDays: '1,7,30' });

  const topics = await send('/visit-topics') ?? [];
  const T = (k) => topics.find((t) => t.systemKey === k)?.id;

  /* برنامهٔ کاری: شنبه تا چهارشنبه ۱۶ تا ۲۰ */
  for (const w of [0, 1, 2, 3, 4, 5, 6]) {
    await send('/availability/rules', 'POST', { weekday: w, startMin: 16 * 60, endMin: 20 * 60, mode: 'slot', slotMinutes: 20, topicIds: [T('initial'), T('followup'), T('preop'), T('postop')].filter(Boolean) });
  }

  const people = [
    ['محمد', 'حسینی', 58], ['فاطمه', 'محمدی', 44], ['علی', 'رضایی', 36], ['زهرا', 'موسوی', 62], ['حسین', 'جعفری', 51],
    ['مریم', 'قاسمی', 29], ['رضا', 'کاظمی', 47], ['سارا', 'نادری', 33], ['مهدی', 'اکبری', 55], ['نرگس', 'سلیمانی', 40],
    ['امیرحسین', 'شریفی', 25], ['لیلا', 'رستمی', 67], ['جواد', 'باقری', 49], ['الهام', 'یوسفی', 38], ['کامران', 'فرهادی', 60],
    ['پریسا', 'ملکی', 31],
  ];
  const P = [];
  const visit = async (body) => {
    const v = await send('/visits', 'POST', body);
    return v?.id ? v : null;
  };
  const bill = async (v, total, paid) => {
    if (!v) return;
    await send(`/visits/${v.id}/billing/pricing`, 'POST', { pricingModel: 'global', globalAmount: total });
    if (paid > 0) await send(`/visits/${v.id}/payments`, 'POST', { amount: paid, method: 'card' });
  };
  const birth = (age) => `${new Date().getFullYear() - age}-03-15`;

  /* ویزیت‌های اولیهٔ گذشته — شکایت، تشخیص، تصمیم */
  const complaints = {
    hnp: ['درد کمر با انتشار به پای چپ از سه ماه پیش', 'درد تیرکشنده در پای راست و بی‌حسیِ انگشتان'],
    cs: ['درد گردن و گزگز هر دو دست'], ls: ['درد پاها هنگامِ راه‌رفتن که با نشستن بهتر می‌شود'],
    men: ['سردردهای صبحگاهی و یک بار تشنج'], mig: ['سردردهای ضربان‌دار یک‌طرفه'], cts: ['بی‌حسیِ شبانهٔ انگشتانِ دست راست'],
  };
  const plan = [
    // [person, dxKey, daysAgo, decisions, surgeon]
    [0, 'hnp', 40, ['surgery'], s1], [1, 'cs', 35, ['surgery'], s2], [2, 'hnp', 30, ['conservative', 'imaging'], s1],
    [3, 'men', 28, ['surgery'], s1], [4, 'ls', 25, ['surgery'], s2], [5, 'mig', 20, ['conservative'], s1],
    [6, 'hnp', 18, ['surgery'], s1], [7, 'cts', 15, ['surgery'], s2], [8, 'ls', 12, ['surgery'], s1],
    [9, 'cs', 10, ['conservative', 'followup'], s2], [10, 'mig', 8, ['conservative'], s1], [11, 'hnp', 6, ['surgery'], s1],
    [12, 'men', 5, ['surgery'], s1], [13, 'hnp', 3, ['conservative', 'lab'], s2],
  ];
  for (const [i, dk, ago, decisions, sur] of plan) {
    const [fn, ln, age] = people[i];
    const v = await visit({
      kind: 'clinic', firstName: fn, lastName: ln, phone: phone(), nationalId: nid(), birthDate: birth(age),
      opDate: iso(-ago, 17, 20), surgeonId: sur?.id, topicId: T('initial'),
      chiefComplaint: complaints[dk][i % complaints[dk].length], diagnosisId: dx[dk]?.id,
      history: 'سابقهٔ فشار خون؛ داروی مصرفی: لوزارتان ۵۰ میلی‌گرم روزانه.',
      exam: 'قدرت عضلانی ۴ از ۵ در اندام تحتانی چپ؛ رفلکس‌ها قرینه.',
      findings: 'MRI: فتق دیسک در سطح L4-L5 با فشار بر ریشهٔ عصبی.',
      planNote: decisions.includes('surgery') ? 'کاندیدِ جراحی؛ آزمایش‌های پیش از عمل درخواست شد.' : 'درمانِ نگهدارنده و پیگیری یک ماه بعد.',
      prescription: decisions.includes('conservative') ? 'ژلوفن ۴۰۰ هر ۸ ساعت، متوکاربامول ۵۰۰ شب‌ها' : '',
      decisions, subforms: [],
    });
    if (v) { P[i] = { ...v, decisions, dk, sur }; await bill(v, 1200000, i % 4 === 3 ? 0 : 1200000); }
  }

  /* عمل‌ها: گذشته (انجام‌شده)، امروز، آینده، بی‌تاریخ، لغوشده */
  const surg = async (pi, body) => {
    const src = P[pi];
    if (!src) return null;
    return visit({
      kind: 'surgery', patientId: src.patientId, decidedInVisitId: src.id, surgeonId: src.sur?.id,
      diagnosisId: dx[src.dk]?.id, anesthesia: 'general', subforms: [], ...body,
    });
  };
  const done1 = await surg(0, { opDate: iso(-20, 8), hospitalId: h1?.id, procedureTypeId: pr.mdx?.id, amount: 45000000, nextVisitDate: day(-6) });
  const done2 = await surg(3, { opDate: iso(-14, 9), hospitalId: h2?.id, procedureTypeId: pr.cran?.id, amount: 120000000, nextVisitDate: day(4) });
  const today1 = await surg(6, { opDate: iso(0, 8), hospitalId: h1?.id, procedureTypeId: pr.mdx?.id, amount: 48000000, opStartTime: '08:30' });
  const today2 = await surg(1, { opDate: iso(0, 11), hospitalId: h1?.id, procedureTypeId: pr.acdf?.id, amount: 85000000 });
  const fut1 = await surg(4, { opDate: iso(3, 8), hospitalId: h2?.id, procedureTypeId: pr.lam?.id, amount: 60000000 });
  const fut2 = await surg(8, { opDate: iso(9, 10), hospitalId: h3?.id, procedureTypeId: pr.lam?.id, amount: 30000000 });
  const undated = await surg(11, { opDateOpen: true, plannedDate: day(25), procedureTypeId: pr.mdx?.id });
  const cancelled = await surg(7, { opDate: iso(2, 9), hospitalId: h2?.id, procedureTypeId: pr.ctr?.id, amount: 18000000 });
  await bill(done1, 45000000, 45000000); await bill(done2, 120000000, 80000000);
  await bill(today1, 48000000, 48000000); await bill(today2, 85000000, 40000000); await bill(fut1, 60000000, 20000000);
  if (cancelled) await send(`/visits/${cancelled.id}/status`, 'PATCH', { opStatus: 'cancelled', cancelReason: 'patient' });

  /* عملِ انجام‌شده: شرح، ترخیص */
  for (const [v, rep] of [[done1, 'بیمار در وضعیت پرون. برش میانی کمری در سطح L4-L5. لامینوتومی چپ و برداشتنِ قطعهٔ فتق‌یافتهٔ دیسک. ریشهٔ L5 آزاد شد. هموستاز. بستنِ لایه‌به‌لایه.'],
    [done2, 'کرانیوتومی فرونتال راست. تومور با حاشیهٔ مشخص به‌طور کامل برداشته شد (Simpson II). نمونه به پاتولوژی ارسال شد.']]) {
    if (!v) continue;
    await send(`/theatre/visits/${v.id}/start`, 'POST', {});
    await send(`/theatre/visits/${v.id}/report`, 'POST', { body: rep });
    await send(`/theatre/visits/${v.id}/finish`, 'POST', {});
    await send(`/visits/${v.id}/status`, 'PATCH', { opStatus: 'done' });
    await send(`/theatre/visits/${v.id}/discharge`, 'POST', { condition: 'هوشیار، درد کنترل‌شده، زخم تمیز', disposition: 'home', summary: 'بستری دو روز بدون عارضه.', rx: 'سفکسیم ۴۰۰ روزانه تا ۵ روز\nاستامینوفن ۵۰۰ هر ۶ ساعت در صورت درد' });
  }
  /* امروز: اولی شروع شده */
  if (today1) await send(`/theatre/visits/${today1.id}/start`, 'POST', {});

  /* نوبت‌های امروز در میزِ پذیرش */
  const todayStr = day(0);
  const walkers = [2, 5, 9, 10, 12, 13];
  const appts = [];
  for (const pi of walkers) {
    const src = P[pi];
    if (!src) continue;
    const a = await send('/frontdesk/walk-in', 'POST', { patientId: src.patientId, date: todayStr, topicId: T(pi % 2 ? 'followup' : 'initial') });
    if (a?.id) appts.push(a);
  }
  const st = ['arrived', 'arrived', 'confirmed', 'done', 'noshow'];
  for (let i = 0; i < appts.length && i < st.length; i++) {
    const a = appts[i];
    if (st[i] === 'done') { await send(`/frontdesk/appointments/${a.id}/status`, 'POST', { status: 'arrived' }); await send(`/frontdesk/appointments/${a.id}/start`, 'POST', {}); }
    await send(`/frontdesk/appointments/${a.id}/status`, 'POST', { status: st[i] });
  }

  /* چند بیمارِ تازه بی‌مراجعه + پیام در گفتگو */
  await visit({ kind: 'clinic', firstName: people[14][0], lastName: people[14][1], phone: phone(), nationalId: nid(), birthDate: birth(people[14][2]), opDate: iso(1, 17, 40), surgeonId: s1?.id, topicId: T('initial'), chiefComplaint: 'درد گردن پس از تصادف', subforms: [] });
  await visit({ kind: 'clinic', firstName: people[15][0], lastName: people[15][1], phone: phone(), nationalId: nid(), birthDate: birth(people[15][2]), opDate: iso(2, 18, 0), surgeonId: s2?.id, topicId: T('initial'), chiefComplaint: 'کمردرد مزمن', subforms: [] });

  log('  مطب: بیمار', P.filter(Boolean).length, '| نوبتِ امروز', appts.length);
  return { acc };
}

/* ─────────────── شرکت ─────────────── */
async function company() {
  const send = await client(T2);
  log('── شرکت');
  await send('/config/profile', 'PATCH', { kind: 'company', services: ['ionm', 'implant'] });
  await send('/settings', 'PATCH', { values: {
    brand_name: 'نوروپایش', company_legal_name: 'شرکت دانش‌بنیان نوروپایش آریا', company_phone: '021-44332211',
    company_address: 'تهران، سعادت‌آباد، خیابان سرو غربی، پلاک ۱۲', invoice_prefix: 'NP-',
  } });
  await send('/forms');
  const me = await send('/auth/me');
  if (me?.id) await send(`/accounts/${me.id}`, 'PATCH', { firstName: 'بهرام', lastName: 'افشار' });
  const techs = [];
  for (const [fn, ln, u] of [['نیما', 'حیدری', 'nima'], ['سمیرا', 'عباسی', 'samira'], ['پویا', 'مرادی', 'pouya']]) {
    const t = await send('/accounts/temporary', 'POST', { firstName: fn, lastName: ln, phone: phone(), level: 2, jobRole: 'technician', username: u });
    if (t?.account?.id) techs.push(t.account);
  }
  await send('/accounts/temporary', 'POST', { firstName: 'شیرین', lastName: 'طاهری', phone: phone(), level: 4, jobRole: 'secretary', username: 'supervisor' });

  const surgeons = await send('/surgeons') ?? [];
  const sl = surgeons.rows ?? surgeons;
  let s0 = sl.find((s) => (s.lastName ?? s.person?.lastName) === 'آزمون');
  if (s0) await send(`/surgeons/${s0.id}`, 'PATCH', { firstName: 'محسن', lastName: 'طاهرخانی', specialty: 'جراحی مغز و اعصاب' });
  const S = [s0];
  for (const [fn, ln, sp] of [['کاوه', 'رجبی', 'ارتوپدی ستون فقرات'], ['فرزانه', 'اسدی', 'جراحی مغز و اعصاب'], ['حمید', 'نیک‌نام', 'گوش و حلق و بینی']]) S.push(await send('/surgeons', 'POST', { firstName: fn, lastName: ln, specialty: sp }));
  const hosps = await send('/hospitals') ?? [];
  const hl = hosps.rows ?? hosps;
  let h0 = hl.find((h) => h.name === 'بیمارستان آزمون');
  if (h0) await send(`/hospitals/${h0.id}`, 'PATCH', { name: 'بیمارستان میلاد', city: 'تهران', sector: 'public' });
  const H = [h0];
  for (const [n, c, s] of [['بیمارستان پارس', 'تهران', 'private'], ['بیمارستان کسری', 'تهران', 'private'], ['بیمارستان رسول اکرم', 'تهران', 'public']]) H.push(await send('/hospitals', 'POST', { name: n, city: c, sector: s }));
  const PT = [];
  for (const n of ['فیوژن ستون فقرات کمری', 'اسکولیوز', 'تومور نخاعی', 'جراحی تیروئید']) PT.push(await send('/procedure-types', 'POST', { name: n }));

  const kinds = await send('/forms/visit-kinds') ?? [];
  const svcKind = kinds.find((k) => (k.kind ?? k.key) === 'surgery') ? 'surgery' : (kinds[0]?.kind ?? 'surgery');
  const people = [['اکبر', 'نوروزی'], ['شهلا', 'صفری'], ['بهزاد', 'کرمی'], ['منیژه', 'حیدری'], ['داوود', 'رحمانی'], ['ثریا', 'عزیزی'], ['فرشید', 'امینی'], ['هانیه', 'پاکزاد'], ['مجید', 'زمانی'], ['رویا', 'قربانی']];
  const V = [];
  for (let i = 0; i < people.length; i++) {
    const [fn, ln] = people[i];
    const d = [-9, -6, -3, -1, 0, 0, 1, 2, 4, 6][i];
    const v = await send('/visits', 'POST', {
      kind: svcKind, service: i % 4 === 3 ? 'implant' : 'ionm', firstName: fn, lastName: ln, phone: phone(), nationalId: nid(),
      opDate: iso(d, 8 + (i % 3) * 2), surgeonId: S[i % S.length]?.id, hospitalId: H[i % H.length]?.id,
      procedureTypeId: PT[i % PT.length]?.id, amount: 18000000 + (i % 3) * 4000000, techId: techs[i % techs.length]?.id,
    });
    if (v?.id) V.push({ ...v, d });
  }
  for (const v of V.filter((x) => x.d < 0).slice(0, 3)) {
    await send(`/visits/${v.id}/status`, 'PATCH', { opStatus: 'done' });
    await send(`/visits/${v.id}/billing/pricing`, 'POST', { pricingModel: 'global', globalAmount: 22000000 });
    await send(`/visits/${v.id}/payments`, 'POST', { amount: 22000000, method: 'card' });
  }
  log('  شرکت: مراجعه', V.length, '| کارشناس', techs.length);
}


/* ─────────────── اجرا ─────────────── */
const out = {};
if (T1) await clinic().catch((e) => bad.push('clinic: ' + e.message));
if (T2) await company().catch((e) => bad.push('company: ' + e.message));

/* ─────────────── پیوندهای عمومی و صفِ ثبت‌نامِ شرکت ─────────────── */
/* یک عکسِ واقعی‌نمای «فیش» و «کارت ملی» با خودِ کرومیوم */
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await browser.newPage({ viewport: { width: 640, height: 400 } });
const card = async (html) => { await pg.setContent(`<body style="margin:0;font-family:Vazirmatn,Tahoma,sans-serif;direction:rtl">${html}</body>`); return pg.screenshot({ type: 'jpeg', quality: 80 }); };
const receipt = await card('<div style="width:640px;height:400px;background:#f7f7f2;padding:28px;box-sizing:border-box"><div style="font-size:26px;font-weight:700;color:#0b5">رسید انتقال وجه — بانک ملت</div><div style="margin-top:22px;font-size:20px;line-height:2">مبلغ: ۴۰٬۰۰۰٬۰۰۰ ریال<br>به کارت: ۶۱۰۴-۳۳۷۹-۱۲۳۴-۵۶۷۸<br>شمارهٔ پیگیری: ۸۴۵۲۱۷<br>تاریخ: ۱۴۰۵/۰۷/۰۵ — ۱۰:۲۴</div></div>');
const idcard = await card('<div style="width:640px;height:400px;background:linear-gradient(135deg,#dfe9f3,#fff);padding:28px;box-sizing:border-box;border:6px solid #2b6"><div style="font-size:24px;font-weight:700">کارت ملی هوشمند</div><div style="margin-top:26px;font-size:20px;line-height:2.1">نام: شهلا<br>نام خانوادگی: صفری<br>شمارهٔ ملی: ۰۰۱۲۳۴۵۶۷۸</div></div>');
const rx = await card('<div style="width:640px;height:400px;background:#fff;padding:28px;box-sizing:border-box;border:1px solid #ccc"><div style="font-size:22px;font-weight:700">دکتر محسن طاهرخانی — جراح مغز و اعصاب</div><div style="margin-top:24px;font-size:19px;line-height:2">جهت بیمار: شهلا صفری<br>نوروفیزیولوژی حین عمل (IONM) جهت عمل فیوژن ستون فقرات کمری<br>تاریخ عمل: هفتهٔ آینده</div></div>');
await browser.close();

async function publicClient(API) {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: USER, password: PASS }) }).then((x) => x.json());
  const token = r.accessToken;
  const send = async (p, m = 'GET', b, auth = true) => {
    const res = await fetch(API + p, { method: m, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + token } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined });
    const json = await res.json().catch(() => null);
    if (res.status >= 400) bad.push(`${m} ${p} → ${res.status} ${JSON.stringify(json?.message ?? json).slice(0, 200)}`);
    return json;
  };
  const upload = async (path, buf, name = 'x.jpg') => {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: 'image/jpeg' }), name);
    const res = await fetch(API + path, { method: 'POST', body: fd });
    const json = await res.json().catch(() => null);
    if (res.status >= 400) bad.push(`UPLOAD ${path} → ${res.status} ${JSON.stringify(json?.message ?? json).slice(0, 160)}`);
    return json;
  };
  return { token, send, upload };
}
let seed2 = 4242;
const nid2 = () => { seed2 += 7919; const b = String(seed2 % 1e9).padStart(9, '0'); let s = 0; for (let i = 0; i < 9; i++) s += +b[i] * (10 - i); const r = s % 11; return b + (r < 2 ? r : 11 - r); };
const phone2 = () => '0935' + String(1000000 + ((seed2 += 131) % 8999999));
const isoDay = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

/* ── مطب ── */
if (T1) {
  const { token, send, upload } = await publicClient(T1);
  out.t1token = token;
  const pats = await send('/patients?limit=20');
  const rows = pats?.rows ?? pats?.items ?? pats ?? [];
  const pid = rows[0]?.id;
  if (pid) { const l = await send(`/patients/${pid}/portal-link`, 'POST', {}); out.t1portal = l?.url ?? l?.token ?? l; }
  const done = await send('/visits?status=done&limit=5');
  const dv = (done?.rows ?? done ?? []).find((v) => v.kind === 'surgery') ?? (done?.rows ?? done ?? [])[0];
  if (dv?.id) { const l = await send(`/visits/${dv.id}/summary-link`, 'POST', {}); out.t1summary = l?.url ?? l?.token ?? l; }
  await send('/forms');
  const forms = await send('/forms') ?? [];
  const intake = (forms.rows ?? forms).find((f) => f.scope === 'intake' && f.active !== false);
  if (intake) {
    const link = await send('/intake/links', 'POST', { title: 'ثبت‌نام نوبتِ ویزیتِ مطب', formId: intake.id });
    out.t1intake = link?.token;
    if (link?.token) {
      for (const [fn, ln] of [['کیوان', 'مهدوی'], ['شیما', 'فروتن']]) {
        const r = await send(`/public/intake/link/${link.token}/register`, 'POST', { firstName: fn, lastName: ln, nationalId: nid2(), phone: phone2(), ...(await captchaFor(T1, link.token)) }, false);
        if (r?.token) out.t1form = r.token;
      }
    }
  }
}

/* ── شرکت ── */
if (T2) {
  const { token, send, upload } = await publicClient(T2);
  out.t2token = token;
  await send('/forms');
  const ionm = ((await send('/forms')) ?? []).find?.((f) => f.key === 'intake.ionm') ?? null;
  const banks = await send('/bank-accounts');
  let bank = (banks?.rows ?? banks ?? [])[0];
  if (!bank) bank = await send('/bank-accounts', 'POST', { bankName: 'ملت', ownerName: 'شرکت نوروپایش آریا', cardNumber: '6104337912345678', iban: 'IR120120000000003112223344', showOnIntake: true });
  if (ionm?.id) {
    const link = await send('/intake/links', 'POST', { title: 'نورومانیتورینگ حین عمل', formId: ionm.id, amount: 40000000, ...(bank?.id ? { bankAccountId: bank.id } : {}) });
    out.t2intake = link?.token;
    const hosp = ((await send('/hospitals')) ?? [])?.[0] ?? (await send('/hospitals'))?.rows?.[0];
    const people = [['شهلا', 'صفری', 'فیوژن ستون فقرات کمری', 5, 'approval'], ['بهمن', 'کیانی', 'تومور نخاعی', 8, 'approval'], ['آزاده', 'نیکو', 'اسکولیوز', 11, 'payment'], ['رامین', 'فتحی', 'دیسک گردن', null, 'approval']];
    for (const [fn, ln, proc, d, stage] of people) {
      if (!link?.token) break;
      const r = await send(`/public/intake/link/${link.token}/register`, 'POST', { firstName: fn, lastName: ln, nationalId: nid2(), phone: phone2(), ...(await captchaFor(T2, link.token)) }, false);
      const t = r?.token;
      if (!t) continue;
      if (!out.t2form) out.t2form = t;
      await upload(`/public/intake/form/${t}/image/nationalIdImage`, idcard);
      await upload(`/public/intake/form/${t}/image/prescription`, rx);
      const values = { hospitalName: hosp?.name ?? 'بیمارستان میلاد', hospitalId: hosp?.id, surgeonName: 'دکتر طاهرخانی', procedure: proc, ...(d ? { opDate: isoDay(d) } : {}) };
      await send(`/public/intake/form/${t}/fill`, 'POST', { values, ...(d ? { opDate: isoDay(d) } : { reserveUndated: true }) }, false);
      if (stage === 'approval') { await upload(`/public/intake/form/${t}/receipt`, receipt); await send(`/public/intake/form/${t}/finish`, 'POST', {}, false); }
    }
  }
}
mkdirSync(UX_OUT, { recursive: true });
writeFileSync(`${UX_OUT}/links.json`, JSON.stringify(out, null, 1));
log(JSON.stringify({ ...out, t1token: '…', t2token: '…' }, null, 1));
log('\nخطاها (' + bad.length + '):');
for (const b of bad) log('  ✘ ' + b);
