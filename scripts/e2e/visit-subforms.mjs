/**
 * **زیرفرم‌های مراجعه، منتخب‌ها و تصمیمِ «پیگیری لازم نیست»** (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳،
 * طرحِ مصوب — «عکسا مورد تایید ه»). سمتِ API؛ رابط در `visit-subforms-ui.mjs`.
 *
 *  باید بیفتد:
 *   - کاتالوگ: داخلی‌ها (علائمِ حیاتی فقط مطب، درخواستِ پاراکلینیک) + چهار زیرفرمِ آماده در گروهِ خودشان
 *   - الصاق با پاسخ؛ کلیدِ بیگانه دور ریخته می‌شود؛ BMI سمتِ سرور (با رقمِ فارسی)
 *   - ستارهٔ فیلدِ زیرفرم ذخیره را می‌بندد و پیامش عنوانِ زیرفرم را دارد
 *   - × فقط روی خالی: پاسخ، اندازه‌گیری یا سفارش برداشتن را می‌بندد
 *   - عمل: هر الصاق مرحلهٔ خودش را دارد (قبل/حین/بعد)، اجباری؛ یک زیرفرم در چند مرحله؛ علائمِ
 *     حیاتی به‌ازای مرحله (با شمارِ همان مرحله)؛ «درخواست» روی عمل الصاق نمی‌شود (تبِ ثابتِ خودش)
 *   - غیرجراحی مرحله نمی‌پذیرد؛ اندازهٔ بی‌مرحله روی عمل رد می‌شود
 *   - تغییرِ نوع ↔ مرحله‌ها: ویزیت→عمل «قبل از عمل»؛ عمل→ویزیت یکی‌شدن، و دو پاسخ در دو مرحله رد
 *   - زیرفرمِ خاموش الصاقِ تازه نمی‌پذیرد ولی ردیفِ موجودش ویرایش می‌شود
 *   - سابقه فقط از مراجعه‌های **پیش از** همین مراجعه، تازه‌ترین اول
 *   - «فعلاً نیاز به پیگیریِ بعدی نیست» انحصاری است؛ ثبتِ سفارش کلیدش را می‌گذارد و آن را برمی‌دارد
 *   - اندازه‌گیریِ ثبت‌نخورده با ذخیرهٔ فرم می‌نشیند (باگِ ممیزی)
 *   - شکایتِ ارثی ستارهٔ «شکایتِ اولیه» را پر می‌کند (ساخت و ویرایش)
 *   - کادرِ پنهانِ مطب (یافته‌ها، عکس/لینکِ فرم) با ستاره ذخیره را نمی‌بندد
 *   - تغییرِ نوعِ مراجعهٔ ثبت‌شده: فقط ادمین، و نه روی زنجیره
 *   - پست‌آپ دوطرفه: تاریخ/لغوِ فرزند «ویزیتِ بعدی»ِ عمل را عوض می‌کند و جراحِ عمل به فرزند می‌رسد
 *   - منتخب‌ها به‌ازای حساب و سمتِ سرور؛ کلیدِ بدشکل رد می‌شود
 *   - «بازگرداندن به قالب» زیرفرم‌های آماده را پاک نمی‌کند
 *   - پاک‌کردن و × در یک ذخیره پذیرفته می‌شود
 *   - جستجوی بیمار آخرین پزشک/مرکز را برای پیش‌پرکردن می‌دهد
 *  نباید بیفتد:
 *   - ذخیره‌ای که `subforms` ندارد یا فقط یک زیرفرم را می‌فرستد، بقیه را بردارد
 *   - `false`ی به‌جامانده از خاموش‌کردنِ یک کلید «داده» حساب شود
 *   - مراجعهٔ بعدی (آینده) در سابقهٔ امروز بیاید
 *   - ذخیرهٔ عمل تاریخِ دستیِ فرزند را بازنویسی کند یا فرزندِ لغوشده را زنده کند
 *   - پزشکی که منشی دستی روی پست‌آپ گذاشته با اصلاحِ جراحِ عمل عوض شود
 *   - تصمیمِ عمل با ثبتِ سفارش عوض شود
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

const loginAs = async (identifier, password) => {
  const r = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }),
  }).then((x) => x.json());
  return r?.accessToken ?? null;
};
const admin = await loginAs(process.env.E2E_USER ?? 'admin', process.env.E2E_PASS ?? 'test1234');
if (!admin) { console.error('ورود نشد'); process.exit(1); }
const sendAs = (tok) => (p, m = 'GET', b) => fetch(API + p, {
  method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const send = sendAs(admin);

const tag = randomBytes(3).toString('hex');
const day = (d) => new Date(Date.UTC(2026, 9, 1) + d * 864e5).toISOString();
const dayOf = (iso) => (iso ? String(iso).slice(0, 10) : null);
const vertical0 = (await send('/config')).json?.vertical ?? 'ionm';
const trash = { visits: [], forms: [], accounts: [], fields: [] };
const restoreRequired = [];
const sfOf = (v, key) => (v?.subforms ?? []).find((x) => x.key === key);
/* ⚠️ افزودنِ فیلد **کلِ فرم** را برمی‌گرداند، نه فیلد را — شناسهٔ فیلد از روی کلیدش؛ `json.id`
   شناسهٔ فرم است و پاک‌کردنش فیلدِ دیگری را برمی‌داشت و فیلدِ آزمون را جا می‌گذاشت. */
const fieldIdOf = (r, key) => r?.json?.fields?.find((f) => f.key === key)?.id ?? null;
const msg = (r) => String(r?.json?.message ?? '');

try {
  console.log('۰) حوزهٔ شرکتی — علائمِ حیاتی زیرفرم نیست');
  ok('سوییچ به حوزهٔ شرکتی (ionm)', (await send('/config/vertical', 'PATCH', { vertical: 'ionm' })).status === 200);
  const catIonm = (await send('/forms/subforms')).json;
  ok('کاتالوگ در حوزهٔ شرکتی «درخواستِ پاراکلینیک» را دارد', !!catIonm?.items?.some((x) => x.key === 'orders'));
  ok('ولی «علائمِ حیاتی» را نه (فقط مطب)', !catIonm?.items?.some((x) => x.key === 'vitals'));

  console.log('\n۱) کاتالوگِ مطب');
  ok('سوییچ به مطب', (await send('/config/vertical', 'PATCH', { vertical: 'clinic' })).status === 200);
  if (!((await send('/forms/visit-kinds')).json ?? []).some((k) => (k.kind ?? k.key) === 'clinic')) {
    await send('/forms', 'POST', { key: 'clinic', title: 'فرمِ ویزیت', scope: 'visit' });
  }
  const cat = (await send('/forms/subforms')).json;
  ok('چهار گروه به ترتیبِ طرح', JSON.stringify((cat?.groups ?? []).map((g) => g.key)) === JSON.stringify(['common', 'assess', 'surgery', 'custom']),
    JSON.stringify(cat?.groups));
  const it = (k) => cat?.items?.find((x) => x.key === k);
  ok('داخلی‌ها: علائمِ حیاتی و درخواستِ پاراکلینیک، هر دو «پرکاربرد»',
    ['vitals', 'orders'].every((k) => it(k)?.builtin && it(k)?.group === 'common'));
  ok('**علائمِ حیاتی روی عمل هم الصاق می‌شود؛ درخواست نه** (تبِ ثابتِ «قبل از عمل»)',
    it('vitals')?.nonSurgery === false && it('orders')?.nonSurgery === true, JSON.stringify([it('vitals')?.nonSurgery, it('orders')?.nonSurgery]));
  ok('عنوانِ یکپارچهٔ درخواست‌ها «فرم درخواستِ پاراکلینیک و مشاوره»', it('orders')?.title === 'فرم درخواستِ پاراکلینیک و مشاوره', it('orders')?.title);
  ok('قد و وزن و زخم در «ارزیابی»', it('subform.growth')?.group === 'assess' && it('subform.wound')?.group === 'assess');
  ok('پیگیریِ پست‌آپ و ASA در «جراحی»', it('subform.postop')?.group === 'surgery' && it('subform.asa')?.group === 'surgery');
  ok('عنوانِ کوتاهِ اسلات («فرم زخم» ← «زخم»)', it('subform.wound')?.short === 'زخم', it('subform.wound')?.short);
  ok('زیرفرمِ آماده فیلدهایش را دارد', (it('subform.growth')?.fields ?? []).map((f) => f.key).join(',') === 'height,weight,head,note');
  ok('هیچ فیلدِ زیرفرمِ آماده اجباری نیست',
    ['subform.growth', 'subform.wound', 'subform.postop', 'subform.asa'].every((k) => (it(k)?.fields ?? []).every((f) => !f.required)));

  const s1 = (await send('/surgeons', 'POST', { firstName: 'دکترِ', lastName: `زیرفرم${tag}` })).json;
  const s2 = (await send('/surgeons', 'POST', { firstName: 'دکترِ', lastName: `دوم${tag}` })).json;
  const s3 = (await send('/surgeons', 'POST', { firstName: 'دکترِ', lastName: `دستی${tag}` })).json;
  const office = (await send('/hospitals', 'POST', { name: `مطبِ زیرفرم ${tag}` })).json;
  const hosp = (await send('/hospitals', 'POST', { name: `بیمارستانِ زیرفرم ${tag}` })).json;
  const proc = (await send('/procedure-types', 'POST', { name: `عملِ زیرفرم ${tag}` })).json;
  ok('تعریف‌ها ساخته شدند', [s1, s2, s3, office, hosp, proc].every((x) => x?.id));

  const clinicVisit = async (body) => {
    const r = await send('/visits', 'POST', { kind: 'clinic', surgeonId: s1.id, hospitalId: office.id, chiefComplaint: `شکایت ${tag}`, ...body });
    if (r.json?.id) trash.visits.push(r.json.id);
    return r;
  };
  const V0 = (await clinicVisit({ firstName: 'زیرفرمِ', lastName: `آزمون${tag}`, opDate: day(-60), subforms: [{ key: 'subform.growth', data: { height: '90', weight: '13' } }] })).json;
  if (!V0?.id) throw new Error('ویزیتِ اول ساخته نشد: ' + JSON.stringify(V0).slice(0, 300));
  const P = V0.patientId;
  ok('ساختِ مراجعه با زیرفرم در همان درخواست', sfOf(V0, 'subform.growth')?.data?.height === '90', JSON.stringify(V0.subforms));

  console.log('\n۲) الصاق، پاسخ و سنجش');
  const V1 = (await clinicVisit({ patientId: P, opDate: day(-30) })).json;
  ok('ویزیتِ بی‌زیرفرم فهرستِ خالی دارد', Array.isArray(V1?.subforms) && V1.subforms.length === 0, JSON.stringify(V1?.subforms));
  let r = await send(`/visits/${V1.id}`, 'PATCH', {
    subforms: [{ key: 'subform.growth', data: { height: '۹۸', weight: '۱۵٫۵', head: '49', junk: 'x' } }],
  });
  let g = sfOf(r.json, 'subform.growth');
  ok('الصاق با پاسخ ذخیره شد', r.status === 200 && g?.data?.head === '49', `${r.status} ${msg(r)} ${JSON.stringify(g)}`);
  ok('**کلیدِ بیگانه دفن نشد** (junk)', g && !('junk' in (g.data ?? {})));
  ok('**BMI سمتِ سرور، با رقمِ فارسی** (۱۵٫۵ ÷ ۰٫۹۸² = ۱۶٫۱)', g?.derived?.bmi === 16.1, JSON.stringify(g?.derived));
  ok('الصاقِ فرم‌ساز «implicit» نیست و formId دارد', g?.implicit === false && !!g?.formId);

  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'subform.nope' }] });
  ok('کلیدِ ناموجود ۴۰۰ با «پیدا نشد»', r.status === 400 && msg(r).includes('پیدا نشد'), msg(r));
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'subform.wound' }, { key: 'subform.wound' }] });
  ok('کلیدِ تکراری در یک درخواست ۴۰۰', r.status === 400, msg(r));
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'subform.wound', data: ['x'] }] });
  ok('پاسخِ غیرِ آبجکت ۴۰۰', r.status === 400, msg(r));
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: '' }] });
  ok('کلیدِ خالی ۴۰۰', r.status === 400, msg(r));

  /* ستارهٔ فیلدِ زیرفرم — زیرفرمِ ساختِ خودِ مدیر. */
  const custom = (await send('/forms', 'POST', { key: `chk${tag}`, title: `فرم چک‌لیست ${tag}`, scope: 'subform' })).json;
  if (custom?.id) trash.forms.push(custom.id);
  ok('زیرفرمِ فرم‌ساز با پیشوندِ subform. ساخته شد', custom?.key === `subform.chk${tag}`, JSON.stringify(custom).slice(0, 200));
  const fr = await send(`/forms/${custom.id}/fields`, 'POST', { key: 'score', label: 'امتیازِ چک‌لیست', type: 'text', required: true });
  ok('فیلدِ اجباری اضافه شد', fr.status === 201 || fr.status === 200, msg(fr));
  const catNow = (await send('/forms/subforms')).json;
  ok('زیرفرمِ تازه در گروهِ «ساختِ خودتان»', catNow?.items?.find((x) => x.key === custom.key)?.group === 'custom');
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: custom.key, data: { score: '' } }] });
  ok('**ستارهٔ زیرفرم ذخیره را بست و پیام عنوانِ زیرفرم را دارد**', r.status === 400 && msg(r).includes(`فرم چک‌لیست ${tag}`) && msg(r).includes('امتیازِ چک‌لیست'), msg(r));
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: custom.key }] });
  ok('الصاقِ بی‌پاسخ (هنوز پر نشده) ستاره را نمی‌سنجد', r.status === 200 && !!sfOf(r.json, custom.key), msg(r));
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: custom.key, data: { score: 'کامل' } }] });
  ok('با پاسخ ذخیره شد', r.status === 200 && sfOf(r.json, custom.key)?.data?.score === 'کامل', msg(r));

  console.log('\n۳) دلتا — هر بند فقط همان زیرفرم');
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'subform.wound', data: { site: 'زانو', signs: ['redness'] } }] });
  ok('الصاقِ زخم', r.status === 200 && sfOf(r.json, 'subform.wound')?.data?.site === 'زانو', msg(r));
  ok('**قد و وزن و چک‌لیست سرِ جایشان ماندند**', !!sfOf(r.json, 'subform.growth') && !!sfOf(r.json, custom.key));
  r = await send(`/visits/${V1.id}`, 'PATCH', { notes: `یادداشت ${tag}` });
  ok('**ذخیرهٔ بی‌`subforms` چیزی برنداشت**', (r.json?.subforms ?? []).length === 3, JSON.stringify((r.json?.subforms ?? []).map((x) => x.key)));
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'subform.growth' }] });
  ok('بندِ بی‌`data` پاسخ را دست نزد', sfOf(r.json, 'subform.growth')?.data?.head === '49', JSON.stringify(sfOf(r.json, 'subform.growth')?.data));
  ok('ترتیب: به ترتیبِ الصاق', JSON.stringify((r.json?.subforms ?? []).map((x) => x.key)) === JSON.stringify(['subform.growth', custom.key, 'subform.wound']),
    JSON.stringify((r.json?.subforms ?? []).map((x) => x.key)));

  console.log('\n۴) برداشتن فقط روی خالی');
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'subform.wound', removed: true }] });
  ok('زیرفرمِ پاسخ‌دار برداشته نمی‌شود', r.status === 400 && msg(r).includes('پاسخ دارد'), msg(r));
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'subform.wound', data: { site: '', signs: [], discharge: '' } }] });
  ok('پاک‌کردنِ مقادیر', r.status === 200 && sfOf(r.json, 'subform.wound')?.hasData === false, msg(r));
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'subform.wound', removed: true }] });
  ok('بعد از خالی‌شدن × کار کرد', r.status === 200 && !sfOf(r.json, 'subform.wound'), msg(r));
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'subform.wound', data: { site: 'ساق' } }] });
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'subform.wound', removed: true, data: { site: '' } }] });
  ok('**پاک‌کردن و × در یک ذخیره** (پاسخِ خالیِ همراهِ برداشتن)', r.status === 200 && !sfOf(r.json, 'subform.wound'), `${r.status} ${msg(r)}`);
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'subform.wound', data: { site: 'ساق' } }] });
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'subform.wound', removed: true, data: { site: 'ساق' } }] });
  ok('نباید بیفتد: برداشتن با پاسخِ پر رد می‌شود', r.status === 400 && msg(r).includes('پاسخ دارد'), `${r.status} ${msg(r)}`);
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'subform.wound', removed: true, data: { site: '' } }] });
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'subform.postop', data: { meds: false, pain: '' } }] });
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'subform.postop', removed: true }] });
  ok('**`false`ِ به‌جامانده از یک کلید «داده» نیست** — برداشته شد', r.status === 200 && !sfOf(r.json, 'subform.postop'), msg(r));
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'subform.wound', removed: true, data: { site: 'x' } }] });
  ok('برداشتنِ زیرفرمِ الصاق‌نشده بی‌اثر است (خطا نیست)', r.status === 200 && !sfOf(r.json, 'subform.wound'), msg(r));

  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'vitals' }] });
  let vs = sfOf(r.json, 'vitals');
  ok('الصاقِ علائمِ حیاتیِ خالی', r.status === 200 && vs?.builtin && vs?.implicit === false && vs?.count === 0, JSON.stringify(vs));
  ok('داخلی‌ها اول می‌آیند', r.json?.subforms?.[0]?.key === 'vitals', JSON.stringify((r.json?.subforms ?? []).map((x) => x.key)));
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'vitals', removed: true }] });
  ok('علائمِ حیاتیِ خالی برداشته شد', r.status === 200 && !sfOf(r.json, 'vitals'), msg(r));

  console.log('\n۵) اندازه‌گیریِ ثبت‌نخورده با ذخیرهٔ فرم');
  r = await send(`/visits/${V1.id}`, 'PATCH', { vitals: { bpSys: '۱۲۰', bpDia: '80', hr: '72' } });
  vs = sfOf(r.json, 'vitals');
  ok('**اندازه‌گیری با همان ذخیره نشست**', r.status === 200 && Number(sql(`SELECT count(*) FROM vital_signs WHERE visit_id=${V1.id}`)) === 1, msg(r));
  ok('و زیرفرمش ضمنی (بی‌ردیف) دیده می‌شود', vs?.implicit === true && vs?.count === 1 && vs?.hasData === true, JSON.stringify(vs));
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'vitals', removed: true }] });
  ok('علائمِ حیاتیِ ثبت‌شده برداشته نمی‌شود', r.status === 400 && msg(r).includes('علائمِ حیاتیِ ثبت‌شده'), msg(r));
  r = await send(`/visits/${V1.id}`, 'PATCH', { vitals: [{ hr: '70' }, { hr: '71' }, { hr: '72' }, { hr: '73' }] });
  ok('بیش از سه اندازه در یک ذخیره ۴۰۰', r.status === 400, msg(r));
  r = await send(`/visits/${V1.id}`, 'PATCH', { vitals: { bpSys: '120' } });
  ok('اندازهٔ نیمه‌کاره (فشارِ یک‌عددی) ۴۰۰ و چیزی ننشست',
    r.status === 400 && Number(sql(`SELECT count(*) FROM vital_signs WHERE visit_id=${V1.id}`)) === 1, msg(r));

  console.log('\n۶) تصمیم و درخواست');
  const cfg = (await send('/config')).json;
  const decs = cfg?.statuses?.decision ?? [];
  ok('«فعلاً نیاز به پیگیریِ بعدی نیست» در کاتالوگ و انحصاری', decs.some((d) => d.key === 'none' && d.exclusive && d.label === 'فعلاً نیاز به پیگیریِ بعدی نیست'),
    JSON.stringify(decs.find((d) => d.key === 'none')));
  ok('چهار تصمیمِ درخواستی نشانِ «order» دارند', ['lab', 'imaging', 'consult', 'referral'].every((k) => decs.find((d) => d.key === k)?.order));
  r = await send(`/visits/${V1.id}`, 'PATCH', { decisions: ['none', 'followup'] });
  ok('**«پیگیری لازم نیست» با تصمیمِ دیگر جمع نمی‌شود**', r.status === 400 && msg(r).includes('جمع نمی‌شود'), msg(r));
  r = await send(`/visits/${V1.id}`, 'PATCH', { decisions: ['none'] });
  ok('به‌تنهایی ذخیره شد', r.status === 200 && JSON.stringify(r.json?.decisions) === '["none"]', JSON.stringify(r.json?.decisions));
  const lab = await send('/orders/lab', 'POST', { patientId: P, visitId: V1.id, tests: ['CBC'] });
  ok('سفارشِ آزمایش ثبت شد', lab.status === 201 && !!lab.json?.id, msg(lab));
  let fresh = (await send(`/visits/${V1.id}`)).json;
  ok('**سفارش کلیدِ «lab» را گذاشت و «none» را برداشت**', fresh?.decisions?.includes('lab') && !fresh?.decisions?.includes('none'), JSON.stringify(fresh?.decisions));
  const ords = sfOf(fresh, 'orders');
  ok('زیرفرمِ درخواست ضمنی الصاق شد (یک سفارش)', ords?.implicit === true && ords?.count === 1, JSON.stringify(ords));
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'orders', removed: true }] });
  ok('درخواستِ ثبت‌شده برداشته نمی‌شود', r.status === 400 && msg(r).includes('درخواستِ ثبت‌شده'), msg(r));
  await send('/orders/lab', 'POST', { patientId: P, visitId: V1.id, tests: ['FBS'] });
  fresh = (await send(`/visits/${V1.id}`)).json;
  ok('سفارشِ دوم کلید را تکراری نکرد', fresh?.decisions?.filter((d) => d === 'lab').length === 1, JSON.stringify(fresh?.decisions));

  console.log('\n۷) عمل: هر الصاق مرحلهٔ خودش را دارد');
  const surgeryBody = { kind: 'surgery', patientId: P, decidedInVisitId: V1.id, opDate: day(-20), surgeonId: s1.id, hospitalId: hosp.id, procedureTypeId: proc.id };
  let S = await send('/visits', 'POST', { ...surgeryBody, subforms: [{ key: 'vitals' }] });
  ok('**الصاقِ بی‌مرحله روی عمل ۴۰۰ با «مرحله»**', S.status === 400 && msg(S).includes('مرحلهٔ زیرفرم'), msg(S));
  S = await send('/visits', 'POST', { ...surgeryBody, subforms: [{ key: 'subform.asa', phase: 'lunch' }] });
  ok('مرحلهٔ ساختگی ۴۰۰', S.status === 400 && msg(S).includes('مرحلهٔ زیرفرم'), msg(S));
  S = await send('/visits', 'POST', { ...surgeryBody, vitals: { hr: '70' } });
  ok('**اندازهٔ بی‌مرحله روی عمل ۴۰۰**', S.status === 400 && msg(S).includes('مرحلهٔ اندازه‌گیری'), msg(S));
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: 'subform.wound', phase: 'pre' }] });
  ok('نباید بیفتد: مرحله روی ویزیت پذیرفته شود', r.status === 400 && msg(r).includes('فقط در فرمِ عمل'), msg(r));
  const S1r = await send('/visits', 'POST', {
    ...surgeryBody, decisions: [],
    subforms: [
      { key: 'subform.asa', phase: 'pre', data: { asa: 'II', emergency: true } },
      { key: 'vitals', phase: 'pre' }, { key: 'vitals', phase: 'post' },
    ],
    vitals: [{ hr: '80', phase: 'pre' }, { bpSys: '110', bpDia: '70', phase: 'post' }],
  });
  const S1 = S1r.json;
  if (S1?.id) trash.visits.push(S1.id);
  const sfAt = (v, key, ph) => (v?.subforms ?? []).find((x) => x.key === key && x.phase === ph);
  ok('عمل با زیرفرمِ «قبل» و علائمِ «قبل» و «بعد» ساخته شد', S1r.status === 201 && sfAt(S1, 'subform.asa', 'pre')?.data?.asa === 'II',
    `${S1r.status} ${msg(S1r)} ${JSON.stringify(S1?.subforms ?? []).slice(0, 240)}`);
  ok('**هر مرحله کارتِ علائمِ خودش با شمارِ همان مرحله**',
    sfAt(S1, 'vitals', 'pre')?.count === 1 && sfAt(S1, 'vitals', 'post')?.count === 1 && !sfAt(S1, 'vitals', 'intra'),
    JSON.stringify((S1?.subforms ?? []).map((x) => [x.key, x.phase, x.count])));
  ok('اندازه‌ها با مرحلهٔ درست نشستند',
    sql(`SELECT string_agg(phase || ':' || coalesce(hr::text, bp_sys::text), ',' ORDER BY phase) FROM vital_signs WHERE visit_id=${S1.id}`) === 'post:110,pre:80');
  r = await send(`/visits/${S1.id}`, 'PATCH', { subforms: [{ key: 'subform.asa', phase: 'post', data: { asa: 'III' } }] });
  ok('**همان زیرفرم در مرحلهٔ دیگر هم الصاق شد**', r.status === 200 && sfAt(r.json, 'subform.asa', 'post')?.data?.asa === 'III'
    && sfAt(r.json, 'subform.asa', 'pre')?.data?.asa === 'II', `${r.status} ${msg(r)}`);
  ok('ترتیب: مرحله به مرحله، داخلی‌ها اولِ هر مرحله',
    JSON.stringify((r.json?.subforms ?? []).map((x) => `${x.phase}:${x.key}`)) === JSON.stringify(['pre:vitals', 'pre:subform.asa', 'post:vitals', 'post:subform.asa']),
    JSON.stringify((r.json?.subforms ?? []).map((x) => `${x.phase}:${x.key}`)));
  r = await send(`/visits/${S1.id}`, 'PATCH', { subforms: [{ key: 'subform.asa', phase: 'pre' }, { key: 'subform.asa', phase: 'pre' }] });
  ok('یک زیرفرم دو بار در یک مرحله ۴۰۰', r.status === 400 && msg(r).includes('دو بار'), msg(r));
  r = await send(`/visits/${S1.id}`, 'PATCH', { subforms: [{ key: 'vitals', phase: 'post', removed: true }] });
  ok('علائمِ «بعد» با اندازه برداشته نمی‌شود', r.status === 400 && msg(r).includes('علائمِ حیاتیِ ثبت‌شده'), msg(r));
  const postRow = sql(`SELECT id FROM vital_signs WHERE visit_id=${S1.id} AND phase='post'`);
  await send(`/visits/${S1.id}/vitals/${postRow}`, 'DELETE');
  r = await send(`/visits/${S1.id}`, 'PATCH', { subforms: [{ key: 'vitals', phase: 'post', removed: true }] });
  ok('**بعد از حذفِ اندازهٔ همان مرحله برداشته شد — «قبل» ماند**', r.status === 200 && !sfAt(r.json, 'vitals', 'post') && sfAt(r.json, 'vitals', 'pre')?.count === 1,
    `${r.status} ${msg(r)}`);
  r = await send(`/visits/${S1.id}`, 'PATCH', { subforms: [{ key: 'orders', phase: 'pre' }] });
  ok('الصاقِ درخواست روی عمل ۴۰۰ (تبِ ثابتِ خودش را دارد)', r.status === 400 && msg(r).includes('الصاق نمی‌شود'), msg(r));
  const bare = await send(`/visits/${S1.id}/vitals`, 'POST', { hr: '75' });
  ok('**ثبتِ اندازهٔ بی‌مرحله روی عمل ۴۰۰**', bare.status === 400 && msg(bare).includes('مرحلهٔ اندازه‌گیری'), msg(bare));
  await send('/orders/lab', 'POST', { patientId: P, visitId: S1.id, tests: ['PT'] });
  await send(`/visits/${S1.id}/vitals`, 'POST', { hr: '88', phase: 'intra' });
  fresh = (await send(`/visits/${S1.id}`)).json;
  ok('**اندازهٔ «حین» کارتِ ضمنیِ همان مرحله را ساخت**', sfAt(fresh, 'vitals', 'intra')?.implicit === true && sfAt(fresh, 'vitals', 'intra')?.count === 1,
    JSON.stringify((fresh?.subforms ?? []).map((x) => [x.key, x.phase, x.implicit])));
  ok('**فهرستِ زیرفرمِ عمل «درخواست» را نشان نمی‌دهد** (تبِ ثابت)', !sfOf(fresh, 'orders'), JSON.stringify((fresh?.subforms ?? []).map((x) => x.key)));
  ok('**تصمیمِ عمل با ثبتِ سفارش عوض نشد**', !(fresh?.decisions ?? []).includes('lab'), JSON.stringify(fresh?.decisions));

  console.log('\n۸) زیرفرمِ خاموش');
  const del = await send(`/forms/${custom.id}`, 'DELETE');
  ok('حذفِ زیرفرمِ استفاده‌شده = خاموش (نه پاک)', del.json?.deactivated === true, JSON.stringify(del.json));
  ok('در کاتالوگ خاموش دیده می‌شود', (await send('/forms/subforms')).json?.items?.find((x) => x.key === custom.key)?.active === false);
  const V2 = (await clinicVisit({ patientId: P, opDate: day(0) })).json;
  r = await send(`/visits/${V2.id}`, 'PATCH', { subforms: [{ key: custom.key }] });
  ok('**الصاقِ تازهٔ زیرفرمِ خاموش ۴۰۰**', r.status === 400 && msg(r).includes('خاموش'), msg(r));
  r = await send(`/visits/${V1.id}`, 'PATCH', { subforms: [{ key: custom.key, data: { score: 'اصلاح' } }] });
  ok('ولی ردیفِ موجودش ویرایش می‌شود', r.status === 200 && sfOf(r.json, custom.key)?.data?.score === 'اصلاح', msg(r));
  const lone = (await send('/forms', 'POST', { key: `lone${tag}`, title: `فرم بی‌استفاده ${tag}`, scope: 'subform' })).json;
  const del2 = await send(`/forms/${lone.id}`, 'DELETE');
  ok('زیرفرمِ بی‌استفاده واقعاً پاک شد', del2.json?.deactivated === false && !(await send('/forms/subforms')).json?.items?.some((x) => x.key === lone.key),
    JSON.stringify(del2.json));

  console.log('\n۹) سابقه — فقط پیش از همین مراجعه');
  r = await send(`/visits/${V2.id}`, 'PATCH', { subforms: [{ key: 'subform.growth', data: { height: '101', weight: '16' } }] });
  const V3 = (await clinicVisit({ patientId: P, opDate: day(30), subforms: [{ key: 'subform.growth', data: { height: '105', weight: '17' } }] })).json;
  const V1e = (await clinicVisit({ patientId: P, opDate: day(-10), subforms: [{ key: 'subform.growth' }] })).json;
  fresh = (await send(`/visits/${V2.id}`)).json;
  const hist = sfOf(fresh, 'subform.growth')?.history ?? [];
  ok('سابقه دو نوبتِ قبلی را دارد، تازه‌ترین اول', JSON.stringify(hist.map((h) => h.visitId)) === JSON.stringify([V1.id, V0.id]),
    JSON.stringify(hist.map((h) => [h.visitId, dayOf(h.date)])));
  ok('**مراجعهٔ آینده در سابقهٔ امروز نیست**', !hist.some((h) => h.visitId === V3.id));
  ok('نوبتِ الصاق‌شدهٔ بی‌پاسخ در سابقه نیست', !hist.some((h) => h.visitId === V1e.id));
  ok('هر نوبتِ سابقه BMIِ خودش را دارد', hist[0]?.derived?.bmi === 16.1 && hist[1]?.derived?.bmi === 16, JSON.stringify(hist.map((h) => h.derived)));
  const hist0 = sfOf((await send(`/visits/${V0.id}`)).json, 'subform.growth')?.history ?? [];
  ok('اولین نوبت سابقه ندارد', hist0.length === 0, JSON.stringify(hist0.map((h) => h.visitId)));

  console.log('\n۱۰) شکایتِ ارثی و کادرهای پنهانِ مطب');
  const sForm = (await send('/forms/visit.surgery')).json;
  const ccField = sForm?.fields?.find((f) => f.key === 'chiefComplaint');
  if (ccField && !ccField.required) {
    await send(`/forms/fields/${ccField.id}`, 'PATCH', { required: true });
    restoreRequired.push({ id: ccField.id, required: false });
  }
  const X1 = await send('/visits', 'POST', {
    kind: 'surgery', patientId: P, decidedInVisitId: V1.id, opDate: day(-5), surgeonId: s1.id, hospitalId: hosp.id, procedureTypeId: proc.id,
  });
  if (X1.json?.id) trash.visits.push(X1.json.id);
  ok('**عملِ ارثی با «شکایتِ اولیه»ِ اجباری ثبت شد**', X1.status === 201, `${X1.status} ${msg(X1)}`);
  const X2 = await send('/visits', 'POST', {
    kind: 'surgery', patientId: P, opDate: day(-5), surgeonId: s1.id, hospitalId: hosp.id, procedureTypeId: proc.id,
  });
  if (X2.json?.id) trash.visits.push(X2.json.id);
  ok('نباید بیفتد: عملِ بی‌ارث بدونِ شکایت ۴۰۰', X2.status === 400 && msg(X2).includes('شکایتِ اولیه'), `${X2.status} ${msg(X2)}`);
  if (X1.json?.id) {
    r = await send(`/visits/${X1.json.id}`, 'PATCH', { chiefComplaint: '' });
    ok('**خالی‌کردنِ شکایت در ویرایش = برگشت به ارث، نه ۴۰۰**', r.status === 200 && r.json?.chiefComplaint === `شکایت ${tag}`, `${r.status} ${msg(r)}`);
  }

  const cForm = (await send('/forms/visit.clinic')).json;
  const findings = cForm?.fields?.find((f) => f.key === 'findings');
  if (findings && !findings.required) {
    await send(`/forms/fields/${findings.id}`, 'PATCH', { required: true });
    restoreRequired.push({ id: findings.id, required: false });
  }
  const img = await send(`/forms/${cForm.id}/fields`, 'POST', { key: `xr${tag}`, label: 'عکسِ رادیولوژی', type: 'image', required: true });
  if (fieldIdOf(img, `xr${tag}`)) trash.fields.push(fieldIdOf(img, `xr${tag}`));
  /* «طرح»ِ تک‌انتخابیِ قالبِ قدیمی — در مطب جایش کشوی تصمیم است و کادرش دیده نمی‌شود. */
  const legacyPlan = cForm?.fields?.some((f) => f.key === 'plan')
    ? null : await send(`/forms/${cForm.id}/fields`, 'POST', { key: 'plan', label: 'طرحِ قدیمی', type: 'select', options: [{ v: 'surgery', l: 'جراحی' }], required: true });
  if (fieldIdOf(legacyPlan, 'plan')) trash.fields.push(fieldIdOf(legacyPlan, 'plan'));
  ok('فیلدِ «طرح»ِ قالبِ قدیمی (اجباری) کاشته شد', !legacyPlan || legacyPlan.status === 201 || legacyPlan.status === 200, `${legacyPlan?.status} ${msg(legacyPlan)}`);
  const H1 = await clinicVisit({ patientId: P, opDate: day(-2) });
  ok('**ستاره روی کادرهای پنهانِ مطب (یافته‌ها، عکسِ فرم، «طرح»ِ قدیمی) ذخیره را نبست**', H1.status === 201, `${H1.status} ${msg(H1)}`);
  if (H1.json?.id) {
    r = await send(`/visits/${H1.json.id}`, 'PATCH', { findings: '' });
    ok('در ویرایش هم نه', r.status === 200, `${r.status} ${msg(r)}`);
  }

  console.log('\n۱۱) تغییرِ نوعِ مراجعهٔ ثبت‌شده');
  const K = (await clinicVisit({ firstName: 'نوعِ', lastName: `تغییر${tag}`, opDate: day(-3) })).json;
  const sup = (await send('/accounts/temporary', 'POST', {
    firstName: 'سوپروایزرِ', lastName: `زیرفرم ${tag}`, phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)),
    level: 4, jobRole: 'secretary', username: `sf${tag}`,
  })).json;
  if (sup?.account?.id) trash.accounts.push(sup.account.id);
  const supTok = sup?.temporaryPassword ? await loginAs(`sf${tag}`, sup.temporaryPassword) : null;
  ok('حسابِ سوپروایزر (سطحِ ۴) ساخته شد', !!supTok, JSON.stringify(sup).slice(0, 160));
  if (supTok) {
    const sendSup = sendAs(supTok);
    r = await sendSup(`/visits/${K.id}`, 'PATCH', { notes: `سوپروایزر ${tag}` });
    ok('سوپروایزر مراجعه را ویرایش می‌کند', r.status === 200, `${r.status} ${msg(r)}`);
    r = await sendSup(`/visits/${K.id}`, 'PATCH', { kind: 'surgery' });
    ok('**ولی نوعش را نه (۴۰۳)**', r.status === 403 && msg(r).includes('فقط ادمین'), `${r.status} ${msg(r)}`);
    const pr = (await sendSup('/auth/prefs')).json;
    ok('منتخب‌های هر حساب جداست (سوپروایزرِ تازه خالی است)', JSON.stringify(pr?.subformPins) === '[null,null,null]', JSON.stringify(pr));
  }
  /* مرحله‌ها با نوع جابه‌جا می‌شوند: زیرفرمِ پاسخ‌دار + اندازهٔ بی‌مرحله روی ویزیت. */
  await send(`/visits/${K.id}`, 'PATCH', { subforms: [{ key: 'subform.growth', data: { height: '100', weight: '15' } }] });
  await send(`/visits/${K.id}/vitals`, 'POST', { hr: '70' });
  r = await send(`/visits/${K.id}`, 'PATCH', { kind: 'surgery' });
  ok('ادمین نوعِ مراجعهٔ مستقل را عوض می‌کند', r.status === 200 && r.json?.kind === 'surgery', `${r.status} ${msg(r)}`);
  ok('**ویزیت → عمل: زیرفرم و اندازه «قبل از عمل» شدند**',
    (r.json?.subforms ?? []).find((x) => x.key === 'subform.growth')?.phase === 'pre'
    && (r.json?.subforms ?? []).find((x) => x.key === 'vitals')?.phase === 'pre'
    && sql(`SELECT string_agg(coalesce(phase,'-'), ',') FROM vital_signs WHERE visit_id=${K.id}`) === 'pre',
    JSON.stringify((r.json?.subforms ?? []).map((x) => [x.key, x.phase])));
  r = await send(`/visits/${K.id}`, 'PATCH', { subforms: [{ key: 'subform.growth', phase: 'post', data: { height: '101' } }, { key: 'vitals', phase: 'post' }] });
  ok('همان زیرفرم در «بعد» با پاسخِ دیگر', r.status === 200, msg(r));
  r = await send(`/visits/${K.id}`, 'PATCH', { kind: 'clinic' });
  ok('**عمل → ویزیت با دو پاسخ در دو مرحله ۴۰۰** (یکی‌کردن یعنی دورریختنِ یکی)', r.status === 400 && msg(r).includes('بیش از یک مرحله'), `${r.status} ${msg(r)}`);
  r = await send(`/visits/${K.id}`, 'PATCH', { subforms: [{ key: 'subform.growth', phase: 'post', removed: true, data: { height: '' } }] });
  ok('پاسخِ «بعد» پاک و برداشته شد', r.status === 200, msg(r));
  r = await send(`/visits/${K.id}`, 'PATCH', { kind: 'clinic' });
  ok('و برمی‌گرداند', r.status === 200 && r.json?.kind === 'clinic', `${r.status} ${msg(r)}`);
  ok('**عمل → ویزیت: یک ردیف به‌ازای هر زیرفرم، بی‌مرحله** (علائمِ «قبل» و «بعد» یکی شد)',
    sql(`SELECT string_agg(key || ':' || phase, ',' ORDER BY key) FROM visit_subforms WHERE visit_id=${K.id}`) === 'subform.growth:,vitals:'
    && (r.json?.subforms ?? []).find((x) => x.key === 'subform.growth')?.data?.height === '100',
    sql(`SELECT string_agg(key || ':' || phase, ',' ORDER BY key) FROM visit_subforms WHERE visit_id=${K.id}`));
  r = await send(`/visits/${V1.id}`, 'PATCH', { kind: 'surgery' });
  ok('**ویزیتی که عمل از آن درآمده نوعش عوض نمی‌شود**', r.status === 400 && msg(r).includes('پیوند دارد'), `${r.status} ${msg(r)}`);
  r = await send(`/visits/${K.id}`, 'PATCH', { kind: `nokind${tag}` });
  ok('نوعِ بی‌فرم ۴۰۰', r.status === 400, `${r.status} ${msg(r)}`);

  console.log('\n۱۲) پست‌آپِ دوطرفه');
  const X = (await send('/visits', 'POST', {
    kind: 'surgery', patientId: P, decidedInVisitId: V1.id, opDate: day(-1), nextVisitDate: day(7),
    surgeonId: s1.id, hospitalId: hosp.id, procedureTypeId: proc.id,
  })).json;
  if (X?.id) trash.visits.push(X.id);
  const cid = Number(sql(`SELECT id FROM visits WHERE follow_of_visit_id=${X.id} ORDER BY id LIMIT 1`)) || null;
  if (cid) trash.visits.unshift(cid);
  ok('ویزیتِ پست‌آپ ساخته شد', !!cid);
  const parentNext = async () => dayOf((await send(`/visits/${X.id}`)).json?.nextVisitDate);
  const child = async () => (await send(`/visits/${cid}`)).json;
  r = await send(`/visits/${cid}`, 'PATCH', { opDate: day(9) });
  ok('**تاریخِ فرزند «ویزیتِ بعدی»ِ عمل را عوض کرد**', r.status === 200 && (await parentNext()) === dayOf(day(9)), `${r.status} ${msg(r)} ${await parentNext()}`);
  await send(`/visits/${X.id}`, 'PATCH', { notes: `ذخیرهٔ عمل ${tag}` });
  ok('نباید بیفتد: ذخیرهٔ عمل تاریخِ دستیِ فرزند را بازنویسی نکرد', dayOf((await child()).opDate) === dayOf(day(9)));
  const reason = cfg?.cancelReasons?.[0]?.key;
  r = await send(`/visits/${cid}/status`, 'PATCH', { opStatus: 'cancelled', cancelReason: reason });
  ok('**لغوِ فرزند «ویزیتِ بعدی»ِ عمل را پاک کرد**', r.status === 200 && (await parentNext()) === null, `${r.status} ${msg(r)} ${await parentNext()}`);
  await send(`/visits/${X.id}`, 'PATCH', { notes: `ذخیرهٔ دوم ${tag}` });
  ok('نباید بیفتد: ذخیرهٔ عمل فرزندِ لغوشده را زنده نکرد', (await child()).opStatus === 'cancelled');
  await send(`/visits/${X.id}`, 'PATCH', { nextVisitDate: day(12) });
  let c = await child();
  ok('**تاریخِ تازه روی عمل فرزند را برگرداند** (در انتظار، تاریخِ تازه، بی‌دلیلِ لغو)',
    c.opStatus === 'pending' && dayOf(c.opDate) === dayOf(day(12)) && !c.cancelReason, JSON.stringify({ s: c.opStatus, d: c.opDate, r: c.cancelReason }));
  await send(`/visits/${X.id}`, 'PATCH', { surgeonId: s2.id });
  ok('**اصلاحِ جراحِ عمل به پست‌آپ رسید**', (await child()).surgeonId === s2.id);
  await send(`/visits/${cid}`, 'PATCH', { surgeonId: s3.id });
  await send(`/visits/${X.id}`, 'PATCH', { surgeonId: s1.id });
  ok('نباید بیفتد: پزشکِ دستیِ پست‌آپ با اصلاحِ جراحِ عمل عوض نشد', (await child()).surgeonId === s3.id);
  await send(`/visits/${cid}/status`, 'PATCH', { opStatus: 'done' });
  await send(`/visits/${cid}`, 'PATCH', { opDate: day(14) });
  ok('فرزندِ انجام‌شده برنامهٔ عمل را عوض نمی‌کند', (await parentNext()) === dayOf(day(12)), await parentNext());

  console.log('\n۱۳) منتخب‌ها');
  r = await send('/auth/prefs');
  ok('پیش‌فرضِ خالی، سه خانه', JSON.stringify(r.json) === JSON.stringify({ subformPins: [null, null, null], todayPins: [null, null, null] }), JSON.stringify(r.json));
  r = await send('/auth/prefs', 'PATCH', { subformPins: ['vitals', 'subform.growth'] });
  ok('فرم‌های منتخب ذخیره شد و به سه خانه پر شد', JSON.stringify(r.json?.subformPins) === JSON.stringify(['vitals', 'subform.growth', null]), JSON.stringify(r.json));
  r = await send('/auth/prefs', 'PATCH', { todayPins: ['dashboard', null, 'dashboard'] });
  ok('تکراری یک‌بار؛ فرم‌های منتخب دست نخورد',
    JSON.stringify(r.json?.todayPins) === JSON.stringify(['dashboard', null, null]) && r.json?.subformPins?.[1] === 'subform.growth', JSON.stringify(r.json));
  r = await send('/auth/prefs', 'PATCH', { subformPins: ['bad key!'] });
  ok('کلیدِ بدشکل ۴۰۰', r.status === 400, msg(r));
  r = await send('/auth/prefs', 'PATCH', { todayPins: ['a', 'b', 'c', 'd'] });
  ok('بیش از سه خانه ۴۰۰', r.status === 400, msg(r));
  ok('ماندگار در سرور', (await send('/auth/prefs')).json?.subformPins?.[0] === 'vitals');
  await send('/auth/prefs', 'PATCH', { subformPins: [null, null, null], todayPins: [null, null, null] });

  console.log('\n۱۴) پیوستگی — آخرین پزشک و مرکز');
  const found = (await send('/patients?q=' + encodeURIComponent(`آزمون${tag}`))).json ?? [];
  const me = found.find((p) => p.id === P);
  ok('جستجو «آخرین» را می‌دهد', !!me?.last, JSON.stringify(me?.last));
  const lastRow = sql(`SELECT kind || '|' || coalesce(surgeon_id::text,'') || '|' || coalesce(hospital_id::text,'') FROM visits WHERE patient_id=${P} AND op_status <> 'cancelled' ORDER BY seq DESC LIMIT 1`);
  const [lk, ls, lh] = lastRow.split('|');
  ok('پزشک = پزشکِ آخرین مراجعهٔ زنده', me?.last?.surgeonId === Number(ls), `${lastRow} ${JSON.stringify(me?.last)}`);
  ok('مرکز فقط از مراجعهٔ غیرجراحی (بیمارستانِ عمل جای مطب نیست)',
    me?.last?.hospitalId === (lk === 'surgery' ? null : Number(lh) || null), `${lastRow} ${JSON.stringify(me?.last)}`);

  console.log('\n۱۵) «بازگرداندن به قالب» زیرفرم‌های آماده را برمی‌گرداند');
  const rs = await send('/forms/reset', 'POST', { vertical: 'clinic' });
  ok('بازگرداندن به قالب انجام شد', rs.status === 201 || rs.status === 200, `${rs.status} ${msg(rs)}`);
  const afterReset = (await send('/forms/subforms')).json?.items ?? [];
  ok('**چهار زیرفرمِ آماده بعد از بازگرداندن هستند و روشن‌اند** (پرچمِ یک‌باره جلویشان را نگرفت)',
    ['subform.growth', 'subform.wound', 'subform.postop', 'subform.asa'].every((k) => afterReset.some((x) => x.key === k && x.active)),
    JSON.stringify(afterReset.map((x) => `${x.key}:${x.active}`)));
} catch (e) {
  fails.push('اجرا متوقف شد: ' + (e?.message ?? e));
  console.log('  ✘ اجرا متوقف شد: ' + (e?.stack ?? e));
} finally {
  for (const f of restoreRequired) await send(`/forms/fields/${f.id}`, 'PATCH', { required: f.required }).catch(() => {});
  for (const id of trash.fields) await send(`/forms/fields/${id}`, 'DELETE').catch(() => {});
  for (const id of trash.visits) {
    try {
      for (const t of ['lab_orders', 'imaging_orders', 'consult_orders', 'referral_orders', 'vital_signs', 'visit_subforms']) sql(`DELETE FROM ${t} WHERE visit_id=${id}`);
    } catch { /* جدول در این نسخه نیست */ }
    await send(`/visits/${id}`, 'DELETE').catch(() => {});
  }
  for (const id of trash.forms) {
    try { sql(`DELETE FROM visit_subforms WHERE form_id=${id}`); } catch { /* نیست */ }
    await send(`/forms/${id}`, 'DELETE').catch(() => {});
  }
  for (const id of trash.accounts) {
    try { sql(`DELETE FROM account_sessions WHERE account_id=${id}`); sql(`DELETE FROM accounts WHERE id=${id}`); } catch { /* ردِ ممیزی نگهش داشت */ }
  }
  await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => {});
  console.log('\nبرگشت به حوزهٔ قبلی');
}

console.log(`\n${pass} ✔  ${fails.length} ✘`);
if (fails.length) { console.log('\nقرمزها:'); for (const f of fails) console.log('  - ' + f); }
process.exit(fails.length ? 1 : 0);
