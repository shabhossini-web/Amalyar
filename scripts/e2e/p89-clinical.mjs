/**
 * **بسته‌های ۸ و ۹ (طرحِ مصوبِ ۱۴۰۵/۰۷/۰۶) — سمتِ API: میزِ اتاقِ عمل، ترخیص، پرونده، فرم‌های خودکارِ موضوع.**
 * رابط در `p89-ui.mjs`؛ فهرستِ انتظار و عملِ بی‌تاریخ در `waitlist.mjs`.
 *
 *  باید بیفتد:
 *   - زیرفرمِ آمادهٔ «جزئیاتِ حینِ عمل» در کاتالوگ، مرحلهٔ پیش‌فرضش «حین»، و نصبِ کلیددار (Z1)
 *   - موضوع‌های استاندارد کلیدِ پایدار دارند؛ پره‌آپ ← ASA و پست‌آپ ← پیگیری یک‌بار نصب می‌شوند (T1)
 *   - فرم‌های خودکارِ موضوع: قابلِ تنظیم با سنجشِ کلید؛ ثبتِ بی‌فهرست الصاقشان می‌کند؛ پست‌آپِ خودکار هم (T2–T4)
 *   - میز: خلاصهٔ پیش از عمل از زیرفرمِ «قبل»، الصاق و پرکردنِ «حین» با همان نویسنده و ممیزی (D1–D3)
 *   - ترخیص: داروها و ویزیتِ بعدی (پست‌آپ + یادآوری)، مجوزِ جدای `theatre.followup` (X1–X4)
 *   - «فوت»: ویزیتِ بعدی و داروها بسته، پیام‌های پس از عمل و پست‌آپِ در انتظار لغو؛ اصلاحش برمی‌گرداند (X5–X6)
 *   - پرونده: پاسخِ زیرفرم‌ها زیرِ هر مراجعه با مرحله (R1)
 *  نباید بیفتد:
 *   - ثبتِ فرمِ مراجعه با `subforms: []` فرم‌های خودکار را برگرداند (T3)
 *   - موضوعِ استاندارد حذفِ سخت شود (T5)
 *   - میز فرمِ «قبل/بعد» بنویسد، یا روی ویزیت/عملِ لغوشده (D4)
 *   - ویزیتِ بعدی پیش از روزِ عمل، برداشتنش از ترخیص، یا «فوت» با دارو (X2)
 *   - داروها و ویزیتِ بعدی بیرون از مطب (X7)
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));
const loginAs = async (identifier, password) => {
  const r = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }),
  }).then((x) => x.json());
  return r?.accessToken ?? null;
};
const admin = await loginAs(process.env.E2E_USER ?? 'admin', process.env.E2E_PASS ?? 'test1234');
if (!admin) { console.error('ورود نشد'); process.exit(1); }
const sendAs = (tok) => (p, m = 'GET', b) => fetch(API + p, {
  method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: b !== undefined ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const send = sendAs(admin);
const msg = (r) => { const m = r?.json?.message; return Array.isArray(m) ? m.join('، ') : String(m ?? ''); };

const tag = randomBytes(3).toString('hex');
const today = new Date().toISOString().slice(0, 10);
const day = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const vertical0 = (await send('/config')).json?.vertical ?? 'ionm';
const trash = { visits: [], accounts: [] };
const topicDefaults0 = [];
const keep = (v) => { if (v?.id) trash.visits.push(v.id); return v; };
const sub = (card, key) => (card?.subforms ?? []).find((x) => x.key === key);
const pendingRem = (vid) => num(`SELECT count(*) FROM reminders WHERE visit_id=${vid} AND status='pending'`);
const childOf = (vid) => sql(`SELECT coalesce((SELECT id||':'||op_status FROM visits WHERE follow_of_visit_id=${vid} ORDER BY id DESC LIMIT 1), '∅')`);

try {
  console.log('۰) مطب و زیرفرم‌های آماده');
  ok('سوییچ به مطب', (await send('/config/vertical', 'PATCH', { vertical: 'clinic' })).status === 200);
  /* DBِ تازهٔ CI فرمِ ویزیت/عمل ندارد — مثلِ بقیهٔ سوییت‌ها، اگر نیست ساخته می‌شود. */
  for (const [kind, title] of [['clinic', 'فرمِ ویزیت'], ['surgery', 'فرمِ عمل']]) {
    if (num(`SELECT count(*) FROM form_defs WHERE scope='visit' AND active=TRUE AND visit_kind='${kind}'`) === 0) {
      await send('/forms', 'POST', { key: kind, title, scope: 'visit' });
    }
  }
  await send('/forms'); // نصبِ زیرفرم‌های آماده + فرم‌های خودکارِ موضوع
  const cat = (await send('/forms/subforms')).json;
  const intra = cat?.items?.find((x) => x.key === 'subform.intra');
  ok('Z1 «فرم جزئیاتِ حینِ عمل» در کاتالوگ، گروهِ «جراحی»، مرحلهٔ پیش‌فرض «حین»',
    intra?.group === 'surgery' && intra?.defaultPhase === 'intra' && (intra?.fields ?? []).some((f) => f.key === 'bloodLoss'),
    JSON.stringify(intra).slice(0, 200));
  ok('Z1 نصبِ کلیددار: فهرستِ کلیدها «حین» را دارد',
    sql(`SELECT value FROM settings WHERE key='subform_presets_keys'`).includes('subform.intra'));

  console.log('\n۱) موضوع‌ها: کلیدِ پایدار و فرم‌های خودکار');
  let topics = (await send('/visit-topics')).json ?? [];
  const bySys = (k) => topics.find((t) => t.systemKey === k);
  ok('T1 چهار موضوعِ استاندارد کلیدِ پایدار دارند',
    ['initial', 'preop', 'postop', 'followup'].every((k) => !!bySys(k)), JSON.stringify(topics.map((t) => [t.name, t.systemKey])));
  for (const t of topics) topicDefaults0.push([t.id, t.defaultSubforms ?? []]);
  ok('T1 پره‌آپ ← ASA و پست‌آپ ← پیگیری (نصبِ یک‌باره)',
    (bySys('preop')?.defaultSubforms ?? []).includes('subform.asa') && (bySys('postop')?.defaultSubforms ?? []).includes('subform.postop')
      && sql(`SELECT value FROM settings WHERE key='topic_default_subforms_seeded'`) === 'true',
    JSON.stringify([bySys('preop')?.defaultSubforms, bySys('postop')?.defaultSubforms]));
  ok('T1 عنوانِ فرم‌های خودکار از سرور', (bySys('preop')?.defaultSubformTitles ?? []).some((x) => x.includes('ASA')),
    JSON.stringify(bySys('preop')?.defaultSubformTitles));

  const initial = bySys('initial');
  let r = await send(`/visit-topics/${initial.id}`, 'PATCH', { defaultSubforms: ['subform.nope'] });
  ok('T2 **نباید بیفتد:** کلیدِ ناشناخته', r.status === 400 && msg(r).includes('پیدا نشد'), `${r.status} ${msg(r)}`);
  r = await send(`/visit-topics/${initial.id}`, 'PATCH', { defaultSubforms: ['vitals', 'subform.wound', 'subform.wound'] });
  ok('T2 تنظیم با داخلی و فرم‌ساز؛ تکراری یکی می‌شود',
    r.status === 200 && JSON.stringify(r.json?.defaultSubforms) === JSON.stringify(['vitals', 'subform.wound']), `${r.status} ${JSON.stringify(r.json?.defaultSubforms)}`);
  topics = (await send('/visit-topics')).json ?? [];
  ok('T2 خلاصهٔ «خودکار» با عنوان‌ها', (bySys('initial')?.defaultSubformTitles ?? []).length === 2, JSON.stringify(bySys('initial')?.defaultSubformTitles));

  const surgeon = (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `هشت‌نه${tag}` })).json;
  const hosp = (await send('/hospitals', 'POST', { name: `بیمارستانِ ${tag}` })).json;
  const proc = (await send('/procedure-types', 'POST', { name: `عملِ ${tag}` })).json;
  /* متنِ مراقبتِ بعد از عمل تا «فوت» چیزی برای لغوکردن داشته باشد (یادآوریِ مراقبت). */
  await send(`/procedure-types/${proc.id}`, 'PATCH', { postOpCare: 'پانسمان را خشک نگه دارید.' });
  const phone = '0912' + String(Math.floor(1e6 + Math.random() * 9e6));
  const P = keep((await send('/visits', 'POST', {
    kind: 'clinic', firstName: 'آزمونِ', lastName: `هشت‌نه${tag}`, phone, opDate: day(-3), surgeonId: surgeon.id,
    chiefComplaint: 'کمردرد', topicId: initial.id,
  })).json);
  ok('T3 ثبتِ بی‌فهرست ← فرم‌های خودکارِ موضوع الصاق شدند',
    !!P?.id && ['vitals', 'subform.wound'].every((k) => (P.subforms ?? []).some((x) => x.key === k)), JSON.stringify(P?.subforms ?? P).slice(0, 240));
  const P2 = keep((await send('/visits', 'POST', {
    kind: 'clinic', patientId: P.patientId, opDate: day(-2), surgeonId: surgeon.id, chiefComplaint: 'پیگیری', topicId: initial.id, subforms: [],
  })).json);
  ok('T3 **نباید بیفتد:** `subforms: []` (کاربر برداشته) دوباره الصاق شود',
    !!P2?.id && !(P2.subforms ?? []).some((x) => x.key === 'subform.wound'), JSON.stringify(P2?.subforms));
  const del = await send(`/visit-topics/${bySys('followup').id}`, 'DELETE');
  topics = (await send('/visit-topics')).json ?? [];
  ok('T5 **نباید بیفتد:** موضوعِ استاندارد حذفِ سخت شود — خاموش می‌شود',
    del.status < 300 && del.json?.deactivated === true && bySys('followup')?.active === false, JSON.stringify(del.json));
  await send(`/visit-topics/${bySys('followup').id}`, 'PATCH', { active: true });

  console.log('\n۲) میزِ اتاقِ عمل: پیش از عمل و فرم‌های حین');
  const S = keep((await send('/visits', 'POST', {
    kind: 'surgery', patientId: P.patientId, decidedInVisitId: P.id, opDate: today, surgeonId: surgeon.id, hospitalId: hosp.id,
    procedureTypeId: proc.id, amount: 1000000,
    subforms: [{ key: 'subform.asa', phase: 'pre', data: { asa: 'II' } }],
  })).json);
  ok('ساختِ عملِ امروز با ASA در «قبل»', !!S?.id && (S.subforms ?? []).some((x) => x.key === 'subform.asa' && x.phase === 'pre'), JSON.stringify(S?.subforms ?? S).slice(0, 200));
  let card = (await send(`/theatre/visits/${S.id}`)).json;
  const asa = sub(card, 'subform.asa');
  ok('D1 خلاصهٔ «قبل از عمل» سرِ میز با برچسبِ فارسیِ مرحله و متنِ سرور',
    asa?.phase === 'pre' && asa?.phaseFa && (asa?.summary ?? []).length >= 1 && card?.clinical === true && card?.can?.subforms === true,
    JSON.stringify(asa).slice(0, 240));
  r = await send(`/theatre/visits/${S.id}/subforms`, 'POST', { items: [{ key: 'subform.intra', phase: 'intra' }] });
  ok('D2 الصاقِ «حین» از میز (بی‌پاسخ)', r.status < 300 && sub(r.json, 'subform.intra')?.phase === 'intra' && (sub(r.json, 'subform.intra')?.summary ?? []).length === 0,
    `${r.status} ${msg(r)}`);
  r = await send(`/theatre/visits/${S.id}/subforms`, 'POST', {
    items: [{ key: 'subform.intra', phase: 'intra', data: { bloodLoss: '150', asPlanned: 'yes', specimen: 'sent', junk: 'x' } }],
  });
  const intraRow = sub(r.json, 'subform.intra');
  const line = (l) => (intraRow?.summary ?? []).find((x) => x.key === l)?.text;
  ok('D3 پرکردن از میز: متنِ گزینه‌ها و ارقامِ فارسی از سرور؛ کلیدِ بیگانه دور ریخته شد',
    r.status < 300 && line('bloodLoss') === '۱۵۰' && line('asPlanned') === 'بله' && line('specimen') === 'ارسال شد'
      && !sql(`SELECT data::text FROM visit_subforms WHERE visit_id=${S.id} AND key='subform.intra'`).includes('junk'),
    JSON.stringify(intraRow?.summary));
  ok('D3 همان ردیفِ فرمِ عمل — یک نویسنده، یک داده',
    num(`SELECT count(*) FROM visit_subforms WHERE visit_id=${S.id} AND key='subform.intra' AND phase='intra'`) === 1);
  ok('D3 ممیزی با مسیرِ «میز»',
    num(`SELECT count(*) FROM audit_events WHERE action='visit.subforms' AND entity_id='${S.id}' AND after_json::text LIKE '%theatre%'`) >= 1);
  r = await send(`/theatre/visits/${S.id}/subforms`, 'POST', { items: [{ key: 'subform.postop', phase: 'post' }] });
  ok('D4 **نباید بیفتد:** میز فرمِ «بعد از عمل» بنویسد', r.status === 400 && msg(r).includes('فقط فرم'), `${r.status} ${msg(r)}`);
  r = await send(`/theatre/visits/${P.id}/subforms`, 'POST', { items: [{ key: 'subform.intra', phase: 'intra' }] });
  ok('D4 **نباید بیفتد:** روی ویزیت (نه عمل)', r.status === 400, `${r.status} ${msg(r)}`);

  console.log('\n۳) ترخیص: داروها، ویزیتِ بعدی، «فوت»');
  await send(`/theatre/visits/${S.id}/start`, 'POST');
  await send(`/theatre/visits/${S.id}/finish`, 'POST');
  r = await send(`/theatre/visits/${S.id}/discharge`, 'POST', { condition: 'هوشیار', disposition: 'home', nextVisitDate: day(-10) });
  ok('X2 **نباید بیفتد:** ویزیتِ بعدی پیش از روزِ عمل', r.status === 400 && msg(r).includes('پیش از روزِ عمل'), `${r.status} ${msg(r)}`);
  r = await send(`/theatre/visits/${S.id}/discharge`, 'POST', { condition: 'هوشیار', disposition: 'home', nextVisitDate: null });
  ok('X2 **نباید بیفتد:** برداشتنِ ویزیتِ بعدی از ترخیص', r.status === 400 && msg(r).includes('فرمِ عمل'), `${r.status} ${msg(r)}`);
  r = await send(`/theatre/visits/${S.id}/discharge`, 'POST', { condition: 'هوشیار', disposition: 'death', rx: 'استامینوفن' });
  ok('X2 **نباید بیفتد:** «فوت» با داروی ترخیص', r.status === 400 && msg(r).includes('فوت'), `${r.status} ${msg(r)}`);
  r = await send(`/theatre/visits/${S.id}/discharge`, 'POST', {
    condition: 'هوشیار و پایدار', disposition: 'home', rx: 'استامینوفن ۵۰۰ هر ۸ ساعت — ۵ روز', nextVisitDate: day(7),
  });
  card = r.json;
  ok('X1 داروهای ترخیص سندِ `discharge_rx`ِ پرونده؛ ویزیتِ بعدی روی عمل',
    r.status < 300 && card?.visit?.dischargeRx?.startsWith('استامینوفن') && String(card?.visit?.nextVisitDate).slice(0, 10) === day(7)
      && num(`SELECT count(*) FROM clinical_notes WHERE visit_id=${S.id} AND kind='discharge_rx' AND replaced_at IS NULL`) === 1,
    `${r.status} ${msg(r)} ${JSON.stringify([card?.visit?.dischargeRx, card?.visit?.nextVisitDate])}`);
  const child1 = childOf(S.id);
  ok('X1 ویزیتِ پست‌آپِ خودکار ساخته شد و فرمِ خودکارِ موضوعش را گرفت (پیگیریِ پس از عمل)',
    child1.endsWith(':pending') && num(`SELECT count(*) FROM visit_subforms WHERE visit_id=${child1.split(':')[0]} AND key='subform.postop'`) === 1
      && Number(sql(`SELECT topic_id FROM visits WHERE id=${child1.split(':')[0]}`)) === bySys('postop').id,
    child1);
  ok('X1 یادآوری‌های پس از عمل کاشته شدند', pendingRem(S.id) > 0, String(pendingRem(S.id)));
  ok('X1 کارت: «ویزیتِ بعدی» برای مدیر شدنی است', card?.can?.followup === true && card?.locks?.followup === null, JSON.stringify([card?.can, card?.locks]));
  ok('X1 نوعِ سند در پرونده برچسب دارد', ((await send('/config')).json?.statuses?.note ?? []).some((x) => x.key === 'discharge_rx' && x.label === 'داروهای ترخیص'));

  /* ── مجوزِ جدا: کارشناسِ سطح ۲ ترخیص می‌زند ولی ویزیتِ بعدی نمی‌گذارد ── */
  const made = (await send('/accounts/temporary', 'POST', {
    firstName: 'پرستارِ', lastName: `اتاق ${tag}`, phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)), level: 2, jobRole: 'nurse', username: `p89${tag}`,
  })).json;
  if (made?.account?.id) {
    trash.accounts.push(made.account.id);
    await send(`/visits/${S.id}`, 'PATCH', { techId: made.account.id });
    const nurse = sendAs(await loginAs(`p89${tag}`, made.temporaryPassword));
    const nc = (await nurse(`/theatre/visits/${S.id}`)).json;
    ok('X3 کارت برای سطح ۲: ویزیتِ بعدی شدنی نیست (از سرور)', nc?.can?.followup === false && nc?.can?.subforms === true, JSON.stringify(nc?.can));
    r = await nurse(`/theatre/visits/${S.id}/discharge`, 'POST', { condition: 'هوشیار', disposition: 'home', nextVisitDate: day(9) });
    ok('X3 **نباید بیفتد:** سطح ۲ ویزیتِ بعدی را جابه‌جا کند', r.status === 403, `${r.status} ${msg(r)}`);
    r = await nurse(`/theatre/visits/${S.id}/discharge`, 'POST', { condition: 'هوشیار', disposition: 'home', rx: 'استامینوفن', nextVisitDate: day(7) });
    ok('X3 همان تاریخِ قبلی «دست نزن» است و مجوز نمی‌خواهد', r.status < 300, `${r.status} ${msg(r)}`);
  } else ok('حسابِ پرستار ساخته شد', false, JSON.stringify(made).slice(0, 200));

  r = await send(`/theatre/visits/${S.id}/discharge`, 'POST', { condition: 'ایست قلبی', disposition: 'death' });
  card = r.json;
  ok('X5 «فوت»: ویزیتِ بعدی و داروها بسته شدند',
    r.status < 300 && card?.visit?.nextVisitDate === null && card?.visit?.dischargeRx === null
      && num(`SELECT count(*) FROM clinical_notes WHERE visit_id=${S.id} AND kind='discharge_rx' AND replaced_at IS NULL`) === 0,
    `${r.status} ${msg(r)} ${JSON.stringify([card?.visit?.nextVisitDate, card?.visit?.dischargeRx])}`);
  ok('X5 «فوت»: هیچ پیامِ پس از عملی در صف نماند و پست‌آپِ در انتظار لغو شد',
    pendingRem(S.id) === 0 && childOf(S.id).endsWith(':cancelled'), `${pendingRem(S.id)} ${childOf(S.id)}`);
  r = await send(`/theatre/visits/${S.id}/discharge`, 'POST', { condition: 'اصلاحِ اشتباه', disposition: 'home' });
  ok('X6 اصلاحِ «فوت»ِ اشتباهی: مراقبتِ پس از عمل دوباره کاشته شد', r.status < 300 && pendingRem(S.id) > 0, `${r.status} ${pendingRem(S.id)}`);

  console.log('\n۴) پرونده: پاسخِ زیرفرم‌ها زیرِ هر مراجعه');
  const rec = (await send(`/patients/${P.patientId}/record`)).json;
  const rv = (rec?.visits ?? []).find((v) => v.id === S.id);
  const titles = (rv?.subformSummaries ?? []).map((x) => `${x.title}@${x.phase}`);
  ok('R1 ASA و «حین» با مرحله؛ زیرفرمِ خالی سطر نمی‌گیرد',
    titles.some((t) => t.includes('ASA') && t.endsWith('@pre')) && titles.some((t) => t.includes('حینِ عمل') && t.endsWith('@intra'))
      && (rv?.subformSummaries ?? []).every((x) => x.summary.length > 0) && (rv?.subformSummaries ?? [])[0]?.phaseFa,
    JSON.stringify(rv?.subformSummaries).slice(0, 300));

  console.log('\n۵) بیرون از مطب');
  const other = vertical0 === 'clinic' ? 'ionm' : vertical0;
  await send('/config/vertical', 'PATCH', { vertical: other });
  r = await send(`/theatre/visits/${S.id}/discharge`, 'POST', { condition: 'هوشیار', disposition: 'home', rx: 'x' });
  ok(`X7 **نباید بیفتد:** داروهای ترخیص در ${other}`, r.status === 400 && msg(r).includes('مطب'), `${r.status} ${msg(r)}`);
  card = (await send(`/theatre/visits/${S.id}`)).json;
  ok(`X7 کارت در ${other}: بی‌پرچمِ بالینی و بی‌ویزیتِ بعدی`, card?.clinical === false && card?.can?.followup === false, JSON.stringify([card?.clinical, card?.can]));
} catch (e) {
  ok(`اجرا متوقف شد: ${e?.message ?? e}`, false);
} finally {
  const back = await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => ({ status: 0 }));
  ok('برگشت به حوزهٔ قبلی', back.status === 200, String(back.status));
  for (const [id, defs] of topicDefaults0) await send(`/visit-topics/${id}`, 'PATCH', { defaultSubforms: defs }).catch(() => {});
  for (const id of trash.visits.reverse()) await send(`/visits/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.accounts) {
    try {
      sql(`DELETE FROM account_sessions WHERE account_id=${id}`);
      sql(`DELETE FROM hospital_duties WHERE tech_id=${id}`);
      sql(`DELETE FROM accounts WHERE id=${id}`);
    } catch { /* پاک‌سازیِ بهترین‌تلاش */ }
  }
}
console.log(`\n${pass} سبز · ${fails.length} قرمز`);
if (fails.length) { console.log(fails.map((f) => '  - ' + f).join('\n')); process.exit(1); }
