/**
 * **یک مبلغ، یک قاعده — جمعِ بالای صفحه با کارت‌های زیرش بخواند.**
 *
 * ادامهٔ همان بازخورد («همهٔ داده‌ها … یک دیتا در ویوهای مختلف»)، این‌بار روی
 * **عدد** نه برچسب.
 *
 * ⚠️ باگِ واقعی: قاعدهٔ «مبلغِ یک مراجعه» سه پیاده داشت و یکی‌شان ناقص بود.
 *
 * | کجا | مدلِ **گلوبال** را می‌دید؟ |
 * |---|---|
 * | `billing.summarize` (کارتِ مراجعه، فاکتور) | بله |
 * | `moneyOrderedIds` (سورت و فیلترِ «بدهکار») | بله |
 * | `visitStats` («ماندهٔ کل» و تفکیکِ طرفِ حساب) | **نه** |
 *
 * یعنی مراجعه‌ای با **مبلغِ توافقیِ گلوبال** (که اقلامش صفر یا جزئی است) در
 * کارتِ خودش ماندهٔ درست نشان می‌داد ولی در «ماندهٔ کلِ» بالای همان صفحه
 * اصلاً شمرده نمی‌شد. بدتر: `charge.groupBy` فقط مراجعه‌های **دارای قلم** را
 * برمی‌گرداند، پس مراجعهٔ گلوبالِ **بی‌قلم** از تفکیکِ «طرفِ حساب» هم می‌افتاد
 * — یعنی طلبی که وجود داشت، در هیچ جمعی دیده نمی‌شد و هیچ خطایی هم نبود.
 *
 * ادعای این سوییت مقایسهٔ **بینِ نماها**ست: هر عددی که داشبورد بالای صفحه
 * می‌گوید باید با جمعِ همان چیزی بخواند که کارت‌ها و صورت‌حساب می‌گویند.
 */
import { randomBytes } from 'node:crypto';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد — سرور را ری‌استارت کنید'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b) => fetch(API + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const get = (p) => send(p, 'GET').then((r) => r.json);

const tag = 'mn' + randomBytes(3).toString('hex');
const trash = [];
let code = 1;

try {
  const kinds = await get('/forms/visit-kinds');
  if (!Array.isArray(kinds) || !kinds.some((k) => k.kind === 'clinic')) {
    await send('/forms', 'POST', { key: 'clinic', title: `ویزیتِ ${tag}`, scope: 'visit' });
  }

  const mk = async (last) => {
    const v = (await send('/visits', 'POST', {
      kind: 'clinic', firstName: 'مبلغِ', lastName: `${last}${tag}`,
      phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)),
      opDate: new Date().toISOString(),
    })).json;
    if (!v?.id) { console.error('مراجعه ساخته نشد:', JSON.stringify(v)); process.exit(1); }
    trash.push(v.id);
    return v;
  };

  /* سه حالت: اقلامی، گلوبالِ **بی‌قلم** (حالتِ گمشده)، و گلوبالِ دارای قلم. */
  const coded = await mk('اقلامی');
  await send(`/visits/${coded.id}/charges`, 'POST', { title: 'ویزیت', unitPrice: 1_000_000 });

  const globalBare = await mk('گلوبالِ‌بی‌قلم');
  const setG = await send(`/visits/${globalBare.id}/billing/pricing`, 'POST', { pricingModel: 'global', globalAmount: 5_000_000 });
  ok(setG.status < 300, `مدلِ گلوبال روی مراجعهٔ بی‌قلم ثبت شد (${setG.status})`, JSON.stringify(setG.json).slice(0, 160));

  const globalWith = await mk('گلوبالِ‌قلم‌دار');
  await send(`/visits/${globalWith.id}/charges`, 'POST', { title: 'قلمِ نمایشی', unitPrice: 200_000 });
  await send(`/visits/${globalWith.id}/billing/pricing`, 'POST', { pricingModel: 'global', globalAmount: 9_000_000 });
  await send(`/visits/${globalWith.id}/payments`, 'POST', { amount: 1_000_000 });

  console.log('۱) کارتِ هر مراجعه — مرجعِ حقیقت');
  const cardOf = async (id) => {
    const b = await get(`/visits/${id}/billing`);
    return { total: b?.total ?? null, paid: b?.paid ?? null, due: b?.due ?? null };
  };
  const [cCoded, cBare, cWith] = await Promise.all([cardOf(coded.id), cardOf(globalBare.id), cardOf(globalWith.id)]);
  ok(cCoded.total === 1_000_000 && cCoded.due === 1_000_000, 'اقلامی: جمعِ اقلام', JSON.stringify(cCoded));
  ok(cBare.total === 5_000_000 && cBare.due === 5_000_000,
    'گلوبالِ بی‌قلم: مبلغِ توافقی جای جمعِ اقلام می‌نشیند', JSON.stringify(cBare));
  ok(cWith.total === 9_000_000 && cWith.due === 8_000_000,
    'گلوبالِ قلم‌دار: قلم فقط نمایشی است، مبنا همان توافق', JSON.stringify(cWith));

  console.log('\n۲) فهرستِ داشبورد — ردیف‌ها همان عدد را می‌دهند');
  const listRow = async (id) => {
    const r = await get(`/visits?q=${encodeURIComponent(tag)}&limit=100`);
    return (r?.rows ?? r?.data ?? []).find((x) => x.id === id) ?? null;
  };
  const rBare = await listRow(globalBare.id);
  ok(rBare != null && rBare.total === cBare.total && rBare.due === cBare.due,
    'ردیفِ گلوبالِ بی‌قلم در فهرست با کارتش می‌خواند',
    JSON.stringify({ row: rBare && { total: rBare.total, due: rBare.due }, card: cBare }));

  console.log('\n۳) جمعِ بالای صفحه = جمعِ همان کارت‌ها');
  const meta = await get(`/visits?q=${encodeURIComponent(tag)}&limit=100`);
  const rows = meta?.rows ?? meta?.data ?? [];
  const mine = rows.filter((r) => trash.includes(r.id));
  const sumCards = mine.reduce((s, r) => s + Math.max(0, r.due ?? 0), 0);
  ok(mine.length === 3, `هر سه مراجعه در نتیجهٔ فیلتر هستند (${mine.length})`);
  ok(meta?.stats?.due === sumCards,
    `⚠️ «ماندهٔ کل» با جمعِ کارت‌ها یکی است (${meta?.stats?.due} = ${sumCards})`,
    JSON.stringify({ stats: meta?.stats?.due, cards: sumCards, rows: mine.map((r) => [r.id, r.due]) }));
  /* ⚠️ همین یکی بود که می‌افتاد: بدونِ اصلاح، `stats.due` مراجعهٔ گلوبالِ
     بی‌قلم را نمی‌دید و عدد ۵ میلیون کمتر می‌شد. */
  ok((meta?.stats?.due ?? 0) >= 5_000_000,
    '… و مراجعهٔ گلوبالِ بی‌قلم واقعاً در آن جمع هست', String(meta?.stats?.due));

  console.log('\n۴) تفکیکِ «طرفِ حساب» هم همان مجموعه را می‌شمارد');
  const byPayer = meta?.stats?.byPayer ?? [];
  const payerDue = byPayer.reduce((s, r) => s + (r.due ?? 0), 0);
  ok(payerDue === meta?.stats?.due,
    `جمعِ تفکیکِ طرفِ حساب با ماندهٔ کل برابر است (${payerDue})`, JSON.stringify(byPayer));
  ok(byPayer.reduce((s, r) => s + (r.count ?? 0), 0) >= 3,
    '**نباید بیفتد:** مراجعهٔ گلوبالِ بی‌قلم از شمارشِ بدهکاران بیفتد',
    JSON.stringify(byPayer));

  console.log('\n۵) فیلترِ «فقط بدهکار» هم از همان قاعده');
  const owing = await get(`/visits?q=${encodeURIComponent(tag)}&owing=1&limit=100`);
  const owingIds = (owing?.rows ?? owing?.data ?? []).map((r) => r.id);
  ok(owingIds.includes(globalBare.id),
    '**نباید بیفتد:** مراجعهٔ گلوبالِ بی‌قلم بدهکار باشد ولی در فیلترِ بدهکار نیاید',
    JSON.stringify(owingIds));

  code = fail ? 1 : 0;
} finally {
  for (const id of trash.reverse()) await fetch(API + `/visits/${id}`, { method: 'DELETE', headers: A }).catch(() => {});
  console.log('\n' + '─'.repeat(50));
  console.log(`قبول: ${pass}   رد: ${fail}`);
}
process.exit(code);
