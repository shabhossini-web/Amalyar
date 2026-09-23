/**
 * **هستهٔ ثابتِ ویزیت و عمل** (بستهٔ ۶الف) — تصمیمِ مالک پس از بررسیِ HIS:
 * «ویزیت یک استانداردِ ثابت دارد، عمل یک استانداردِ ثابت».
 *
 * چهار ادعا، هر کدام جلوی یک خرابیِ مشخص:
 *  ۱. بخش‌های پایه (شرحِ حال، یافته‌ها، معاینه، طرحِ درمان، نسخه) **سندِ
 *     بالینیِ نسخه‌دار**اند، نه کلیدی در `extra` — وگرنه همان تلهٔ شکایتِ
 *     اولیه: میزِ اتاقِ عمل معاینهٔ ویزیتِ تصمیم را نمی‌دید.
 *  ۲. هسته در فرم‌ساز **خاموش نمی‌شود** ولی ستاره‌اش آزاد است.
 *  ۳. PATCHِ جزئی بخش‌ها را پاک نمی‌کند، و کلاینتِ کهنه (PWAِ کش‌شده) که هنوز
 *     در `extra` می‌فرستد، داده‌اش به جای درست می‌رسد.
 *  ۴. یک داده، چند میز: یافته‌های حینِ عمل از میزِ اتاقِ عمل همان سندی است که
 *     فرمِ مراجعه می‌خواند؛ و خلاصهٔ بیمار فقط همان سه بخشی را نشان می‌دهد که
 *     پیش از این بسته هم نشان می‌داد.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB ?? 'postgresql://amalyar:amalyar@localhost:5432/amalyar_t1';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  ✘ ' + n + (d ? ' — ' + d : '')); }
};
const sql = (q) => execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1`, { input: q }).toString().trim().split('\n')[0];
const num = (q) => Number(sql(q));

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m = 'GET', b, auth = true) => fetch(API + p, {
  method: m, headers: auth ? A : { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = randomBytes(3).toString('hex');
const today = new Date().toISOString().slice(0, 10);
const vertical0 = (await send('/config')).json?.vertical ?? 'ionm';

try {
  const sw = await send('/config/vertical', 'PATCH', { vertical: 'clinic' });
  ok('سوییچ به حوزهٔ مطب', sw.status === 200, String(sw.status));

  /* فرمِ ویزیتِ مطب — اگر نصبِ e2e (نورومانیتورینگ) ندارد، ساخته می‌شود. */
  let forms = (await send('/forms')).json ?? [];
  if (!forms.some((f) => f.scope === 'visit' && f.visitKind === 'clinic')) {
    await send('/forms', 'POST', { key: 'clinic', title: `ویزیت${tag}`, scope: 'visit' });
    forms = (await send('/forms')).json ?? [];
  }
  const visitForm = forms.find((f) => f.scope === 'visit' && f.visitKind === 'clinic');
  const surgeryForm = forms.find((f) => f.scope === 'visit' && f.visitKind === 'surgery');
  const fld = (form, key) => form?.fields?.find((x) => x.key === key);

  console.log('۱) هسته در فرمِ ویزیت و عمل — روشن و قفل‌دار');
  for (const k of ['chiefComplaint', 'history', 'findings', 'exam', 'diagnosisId', 'planNote', 'prescription', 'nextVisitDate']) {
    const f = fld(visitForm, k);
    ok(`ویزیت · «${k}» هسته و روشن است`, f?.core === true && f?.active === true, JSON.stringify(f && { core: f.core, active: f.active }));
  }
  for (const k of ['anesthesia', 'findings', 'opReport', 'procedureTypeId']) {
    const f = fld(surgeryForm, k);
    ok(`عمل · «${k}» هسته و روشن است`, f?.core === true && f?.active === true, JSON.stringify(f && { core: f.core, active: f.active }));
  }
  ok('**نباید بیفتد:** «مبلغ» هسته نیست (تکمیلی است)', fld(visitForm, 'amount')?.core === false);
  /* ترتیبِ ثابت در فهرستِ فرم‌ساز هم: هسته اول و به ترتیبِ coreRank، هر
     چقدر هم `sort`ِ ذخیره‌شده در نصبِ قدیمی پراکنده باشد. */
  for (const form of [visitForm, surgeryForm]) {
    const flags = (form?.fields ?? []).map((x) => x.core);
    const firstFree = flags.indexOf(false);
    const ranks = (form?.fields ?? []).filter((x) => x.core).map((x) => x.coreRank);
    ok(`«${form?.title}»: هسته اول و به ترتیبِ ثابت`,
      firstFree > 0 && !flags.slice(firstFree).includes(true) && ranks.every((r, i) => i === 0 || r > ranks[i - 1]),
      JSON.stringify((form?.fields ?? []).map((x) => (x.core ? `*${x.key}` : x.key))));
  }
  ok('برچسبِ یافته‌ها در فرمِ عمل «حینِ عمل» است',
    fld(surgeryForm, 'findings')?.label === 'یافته‌های حینِ عمل', fld(surgeryForm, 'findings')?.label);

  const exam = fld(visitForm, 'exam');
  const off = await send(`/forms/fields/${exam.id}`, 'PATCH', { active: false });
  ok('خاموش‌کردنِ «شرحِ معاینه» رد می‌شود', off.status === 400 && /استاندارد/.test(off.json?.message ?? ''), `${off.status} ${off.json?.message}`);
  const star = await send(`/forms/fields/${exam.id}`, 'PATCH', { required: true });
  ok('**ولی ستاره‌اش آزاد است**', star.status === 200 && fld(star.json, 'exam')?.required === true, String(star.status));
  await send(`/forms/fields/${exam.id}`, 'PATCH', { required: false });
  const dup = await send(`/forms/${visitForm.id}/fields`, 'POST', { key: 'exam', label: 'معاینهٔ دوم', type: 'textarea' });
  ok('کلیدِ هسته برای فیلدِ دلخواه رزرو است', dup.status === 400, String(dup.status));

  console.log('\n۲) بخش‌ها سندِ بالینی‌اند، نه `extra`');
  const surgeon = (await send('/surgeons')).json?.[0]
    ?? (await send('/surgeons', 'POST', { firstName: 'جراحِ', lastName: `هسته${tag}` })).json;
  const hospital = (await send('/hospitals')).json?.[0]
    ?? (await send('/hospitals', 'POST', { name: `بیمارستانِ ${tag}` })).json;
  const created = await send('/visits', 'POST', {
    kind: 'clinic', firstName: 'هستهٔ', lastName: `ثابت${tag}`, opDate: today, surgeonId: surgeon.id,
    chiefComplaint: 'دردِ کمر با انتشار به پای چپ',
    history: 'از دو ماه پیش، با سرفه بدتر می‌شود',
    findings: 'MRI: فتقِ L4-L5',
    exam: 'SLR مثبتِ چپ',
    planNote: 'فیزیوتراپیِ ده جلسه',
    prescription: 'ژلوفن ۴۰۰ — روزی دو عدد',
    decisions: ['workup', 'followup', 'lab'],
  });
  ok('ویزیت با همهٔ بخش‌ها ساخته شد', created.status === 201 || created.status === 200, `${created.status} ${JSON.stringify(created.json).slice(0, 160)}`);
  const v = created.json;
  let g = (await send(`/visits/${v.id}`)).json;
  ok('شرحِ حال', g.history === 'از دو ماه پیش، با سرفه بدتر می‌شود', g.history);
  ok('یافته‌ها', g.findings === 'MRI: فتقِ L4-L5', g.findings);
  ok('معاینه', g.exam === 'SLR مثبتِ چپ', g.exam);
  ok('طرحِ درمان و نسخه', g.planNote === 'فیزیوتراپیِ ده جلسه' && g.prescription?.startsWith('ژلوفن'));
  ok('**هیچ‌کدام در `extra` نیست**', ['history', 'findings', 'exam', 'planNote', 'prescription'].every((k) => g.extra?.[k] === undefined), JSON.stringify(g.extra));
  ok('پنج سندِ جاری در `clinical_notes`',
    num(`SELECT count(*) FROM clinical_notes WHERE visit_id=${v.id} AND replaced_at IS NULL AND kind IN ('history','findings','exam','plan','rx')`) === 5);
  ok('برچسبِ تصمیم‌های تازه از سرور می‌آید',
    g.decisionsFa?.includes('تکمیلِ بررسی — تصمیمِ قطعی بعداً') && g.decisionsFa?.includes('ویزیتِ بعدی'), JSON.stringify(g.decisionsFa));

  console.log('\n۳) PATCHِ جزئی چیزی را پاک نمی‌کند · کلاینتِ کهنه به جای درست می‌رسد');
  await send(`/visits/${v.id}`, 'PATCH', { nextVisitDate: today });
  g = (await send(`/visits/${v.id}`)).json;
  ok('بعد از PATCHِ فقط-تاریخ، معاینه و نسخه سرِ جایشان‌اند', g.exam === 'SLR مثبتِ چپ' && !!g.prescription);
  await send(`/visits/${v.id}`, 'PATCH', { exam: 'SLR مثبتِ دوطرفه' });
  g = (await send(`/visits/${v.id}`)).json;
  ok('ویرایشِ معاینه — نسخهٔ تازه، قبلی بایگانی',
    g.exam === 'SLR مثبتِ دوطرفه' && num(`SELECT count(*) FROM clinical_notes WHERE visit_id=${v.id} AND kind='exam'`) === 2);
  const legacy = await send(`/visits/${v.id}`, 'PATCH', { extra: { prescription: 'ناپروکسن ۵۰۰', plan: 'refer' } });
  g = (await send(`/visits/${v.id}`)).json;
  ok('کلاینتِ کهنه: نسخهٔ داخلِ `extra` سندِ نسخه شد', legacy.status === 200 && g.prescription === 'ناپروکسن ۵۰۰', `${legacy.status} ${g.prescription}`);
  ok('… و «تصمیم»ِ قدیمیِ `refer` به `referral` ادغام شد — بی‌آنکه تصمیم‌های قبلی بروند',
    g.decisions?.includes('referral') && g.decisions?.includes('workup'), JSON.stringify(g.decisions));
  ok('… و در `extra` چیزی جا نماند', g.extra?.prescription === undefined && g.extra?.plan === undefined, JSON.stringify(g.extra));
  const bad = await send(`/visits/${v.id}`, 'PATCH', { decisions: ['bogus'] });
  ok('تصمیمِ ناشناخته رد می‌شود', bad.status === 400, String(bad.status));

  console.log('\n۴) خلاصهٔ بیمار — همان سه بخشِ قبلی، نه بیشتر');
  const link = (await send(`/visits/${v.id}/summary-link`, 'POST')).json;
  let pub = (await send(`/public/visit-summary/${link.token}`, 'GET', null, false)).json;
  const bodies = JSON.stringify(pub?.answers ?? []);
  ok('طرحِ درمان و نسخه به بیمار می‌رسد', bodies.includes('فیزیوتراپیِ ده جلسه') && bodies.includes('ناپروکسن'), bodies.slice(0, 200));
  ok('**شرحِ حال و یافته‌ها داخلی می‌مانند**', !bodies.includes('سرفه') && !bodies.includes('L4-L5'), bodies.slice(0, 200));
  await send(`/forms/fields/${exam.id}`, 'PATCH', { roles: ['doctor'] });
  pub = (await send(`/public/visit-summary/${link.token}`, 'GET', null, false)).json;
  ok('معاینه‌ای که «بخشِ پزشک» شد، دیگر به بیمار نمی‌رسد', !JSON.stringify(pub?.answers ?? []).includes('دوطرفه'));
  await send(`/forms/fields/${exam.id}`, 'PATCH', { roles: [] });

  console.log('\n۵) عمل از همین ویزیت — بیهوشی ستون، یافته‌ها یک سند در دو میز');
  const badAn = await send('/visits', 'POST', {
    kind: 'surgery', patientId: v.patientId, opDate: today, surgeonId: surgeon.id, hospitalId: hospital.id, anesthesia: 'bogus',
  });
  ok('بیهوشیِ ناشناخته رد می‌شود', badAn.status === 400, String(badAn.status));
  const op = (await send('/visits', 'POST', {
    kind: 'surgery', patientId: v.patientId, decidedInVisitId: v.id, opDate: today,
    surgeonId: surgeon.id, hospitalId: hospital.id, anesthesia: 'general', findings: 'فتقِ اکسترود',
  })).json;
  g = (await send(`/visits/${op.id}`)).json;
  ok('بیهوشی ستون است و برچسبش از سرور', g.anesthesia === 'general' && g.anesthesiaFa === 'عمومی', `${g.anesthesia} ${g.anesthesiaFa}`);
  ok('**و در `extra` نیست**', g.extra?.anesthesia === undefined);
  const card = (await send(`/theatre/visits/${op.id}`)).json;
  ok('میزِ اتاقِ عمل: یافته‌های حینِ عمل', card?.visit?.findings === 'فتقِ اکسترود', card?.visit?.findings);
  ok('میزِ اتاقِ عمل: بیهوشی', card?.visit?.anesthesiaFa === 'عمومی');
  ok('میزِ اتاقِ عمل: معاینه و یافته‌های **ویزیتِ تصمیم** (مشتق، نه کپی)',
    card?.decided?.exam === 'SLR مثبتِ دوطرفه' && card?.decided?.findings === 'MRI: فتقِ L4-L5', JSON.stringify(card?.decided ?? {}).slice(0, 200));
  await send(`/visits/${v.id}`, 'PATCH', { exam: 'SLR مثبتِ چپ؛ ضعفِ EHL' });
  const card2 = (await send(`/theatre/visits/${op.id}`)).json;
  ok('اصلاحِ معاینه در ویزیت، همان لحظه سرِ میز', card2?.decided?.exam === 'SLR مثبتِ چپ؛ ضعفِ EHL', card2?.decided?.exam);
  const fz = await send(`/theatre/visits/${op.id}/findings`, 'POST', { body: 'فتقِ اکسترود با قطعهٔ آزاد' });
  g = (await send(`/visits/${op.id}`)).json;
  ok('یافته از میزِ اتاقِ عمل ← همان سندی که فرمِ مراجعه می‌خواند',
    fz.status < 300 && g.findings === 'فتقِ اکسترود با قطعهٔ آزاد', `${fz.status} ${g.findings}`);

  console.log('\n۶) فهرستِ سبک، متنِ بالینی نمی‌کشد');
  const list = (await send(`/visits?q=${encodeURIComponent('ثابت' + tag)}`)).json;
  const row = (list?.rows ?? list?.items ?? []).find?.((x) => x.id === v.id);
  ok('ردیفِ همین ویزیت در فهرست پیدا شد', !!row, JSON.stringify(Object.keys(list ?? {})));
  ok('ردیفِ فهرست بخش‌های هسته را ندارد (نه خالی — نیامده)', row && row.exam === undefined && row.history === undefined, JSON.stringify(row && { exam: row.exam }));
} finally {
  const back = await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => ({ status: 0 }));
  ok('برگشت به حوزهٔ قبلی', back.status === 200, String(back.status));
}

console.log(`\n${pass} سبز · ${fails.length} قرمز`);
if (fails.length) { console.log(fails.map((f) => '  - ' + f).join('\n')); process.exit(1); }
