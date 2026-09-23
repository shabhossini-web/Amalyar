/**
 * کلیدِ رزروشده مالِ سیستم است + بنیان‌گذارِ مطب پزشک است — بازخوردِ مالک ۱۴۰۵/۰۶/۳۰، بستهٔ ۱.
 *
 * دو باگِ واقعی که هر دو **بی‌صدا** بودند:
 *
 * ① «۸ تیر ۷۸۴». پریستِ ثبت‌نام فیلدی با کلیدِ رزروشدهٔ `opDate` و نوعِ `date`
 *    دارد که روی صفحهٔ بیمار رندر می‌شود؛ `JDate` رشتهٔ **شمسی** می‌دهد و حلقهٔ
 *    `values` در `intake.service.ts` بعد از حلقهٔ `fixed` اجرا می‌شود، پس مقدارِ
 *    ISO را بازنویسی می‌کرد. بعدش `Intake.jsx` با `faDate` چاپش می‌کرد و
 *    ۱۴۰۵/۰۶/۲۸ به‌عنوانِ تاریخِ **میلادی** خوانده می‌شد → «۸ تیر ۷۸۴».
 *    گاردِ `addField` فقط جلوی ساختنِ **دستیِ** چنین فیلدی را می‌گیرد؛ پریست از
 *    قبل یکی دارد. این‌جا همان حالت با SQL بازسازی می‌شود تا آزمون به شکلِ
 *    امروزِ پریست‌ها گره نخورد.
 *
 * ② `jobRole`ِ بنیان‌گذار. `auth.service.ts` فقط لحظهٔ ثبت‌نام و فقط اگر حوزه از
 *    قبل `clinic` باشد نقشِ `doctor` می‌دهد — ولی `DEFAULT_VERTICAL` برابرِ
 *    `ionm` است و مطب بعداً حوزه را عوض می‌کند. پس `job_role` خالی می‌مانْد و
 *    صفِ نقشِ پزشک (کارِ «بررسیِ نتیجه») هیچ‌وقت به او نمی‌رسید.
 *
 *  باید بیفتد:
 *   - مقدارِ شمسیِ یک کلیدِ **رزروشدهٔ** نوعِ date به ISO برمی‌گردد
 *   - سوییچ به مطب روی نصبِ تک‌سوپرادمینِ بی‌نقش، `jobRole='doctor'` می‌دهد و تعریفِ جراح می‌سازد
 *   - همان کار را migration روی نصبی که **از قبل** روی مطب است انجام می‌دهد
 *  نباید بیفتد:
 *   - کلیدِ **دلخواهِ** نوعِ date دست بخورد (مقدارش خام نمایش داده می‌شود؛ تبدیلش نمایشِ همهٔ پاسخ‌های قبلی را خراب می‌کند)
 *   - مقدارِ از قبل ISO دوباره تبدیل شود
 *   - نصبی که **دو** سوپرادمینِ فعال دارد نقشی بگیرد (نمی‌شود حدس زد کدام پزشک است)
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { captchaFor } from './lib/captcha.mjs';

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
  method: m, headers: auth ? A : { 'Content-Type': 'application/json' },
  body: b ? JSON.stringify(b) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const tag = 'rk' + randomBytes(3).toString('hex');
/* رقمِ کنترلیِ معتبر — ثبت‌نام کدِ ملیِ بی‌معنا را رد می‌کند. */
const NID = '0084575646';
const NID_B = '0012069361';
const wipe = () => {
  sql(`DELETE FROM intake_submissions WHERE patient_id IN (SELECT id FROM patients WHERE national_id IN ('${NID}','${NID_B}'))`);
  sql(`DELETE FROM patients WHERE national_id IN ('${NID}','${NID_B}') AND id NOT IN (SELECT patient_id FROM visits)`);
};

const trash = { forms: [], accounts: [] };
let vertical0 = 'ionm';
let role0 = null;
let adminId = 0;

try {
  wipe();

  console.log('۱) کلیدِ رزروشدهٔ نوعِ date از هر مسیری که پر شود ISO ذخیره می‌شود');
  const form = (await send('/forms', 'POST', { key: `f${tag}`, title: 'فرمِ کلیدِ رزروشده', scope: 'visit' })).json;
  if (!form?.id) throw new Error('فرم ساخته نشد: ' + JSON.stringify(form).slice(0, 160));
  trash.forms.push(form.id);

  /* فیلدِ **دلخواهِ** تاریخ از مسیرِ واقعی — گارد فقط کلیدهای رزروشده را رد می‌کند. */
  const custom = await send(`/forms/${form.id}/fields`, 'POST', { key: 'followUpOn', label: 'پیگیری در', type: 'date' });
  ok('فیلدِ تاریخِ دلخواه با کلیدِ غیررزرو ساخته می‌شود', custom.status < 300, String(custom.status));

  /* و همین کلید از مسیرِ API **رد** می‌شود — گاردِ موجود سرِ جایش است. */
  const blocked = await send(`/forms/${form.id}/fields`, 'POST', { key: 'opDate', label: 'تاریخِ عمل', type: 'date' });
  ok('کلیدِ رزروشده از فرم‌ساز پذیرفته نمی‌شود', blocked.status === 400, String(blocked.status));

  /* ⚠️ **شکلی که باگ را می‌سازد، دقیقاً همین است.**

     هر فرمِ مراجعه از کاتالوگ یک ردیفِ `opDate` می‌گیرد، ولی `builtin` است و
     `formView` با `!x.builtin` از دیدِ بیمار حذفش می‌کند — پس آن ردیف بی‌خطر
     است. باگ وقتی است که یک فیلدِ **غیرbuiltin** کلیدِ رزروشده داشته باشد؛ و
     `form-presets.ts` در پریستِ ثبت‌نامِ نورومانیتورینگ دقیقاً یکی دارد
     (`{ key: 'opDate', type: 'date', required: true }` بدونِ `builtin`). این‌جا
     همان شکل بازسازی می‌شود، نه خودِ پریست — تا آزمون به چیدمانِ امروزِ
     پریست‌ها گره نخورد و اگر فردا پریستِ دیگری همین اشتباه را کرد باز هم بگیرد. */
  ok('کاتالوگ ردیفِ builtinِ `opDate` را خودش ساخته',
    num(`SELECT count(*) FROM form_fields WHERE form_id=${form.id} AND key='opDate' AND builtin`) === 1);
  sql(`UPDATE form_fields SET builtin=false, active=true, page=1 WHERE form_id=${form.id} AND key='opDate'`);

  const link = (await send('/intake/links', 'POST', { title: 'کلیدِ رزروشده', amount: 0, formId: form.id })).json;
  const reg = await send(`/public/intake/link/${link.token}/register`, 'POST',
    { firstName: 'کلیدِ', lastName: 'رزروشده', nationalId: NID, phone: '09120000471', ...(await captchaFor(API, link.token)) }, false);
  ok('ثبت‌نامِ بیمار روی همان لینک', reg.status < 300, String(reg.status));

  const filled = await send(`/public/intake/form/${reg.json.token}/fill`, 'POST',
    { values: { opDate: '1405/06/28', followUpOn: '1405/07/01' } }, false);
  ok('پرکردنِ فرم خطا نمی‌دهد', filled.status < 300, String(filled.status));
  ok('**کلیدِ رزروشده به ISO برگشت** (۱۴۰۵/۰۶/۲۸ → ۲۰۲۶-۰۹-۱۹) — ریشهٔ «۸ تیر ۷۸۴»',
    filled.json?.data?.opDate === '2026-09-19', String(filled.json?.data?.opDate));
  ok('**ولی کلیدِ دلخواه دست‌نخورده مانْد** (نمایشش خام است؛ تبدیلش پاسخ‌های قبلی را خراب می‌کند)',
    filled.json?.data?.followUpOn === '1405/07/01', String(filled.json?.data?.followUpOn));

  /* ⚠️ حالتِ «از قبل ISO» روی یک ثبت‌نامِ **تازه** سنجیده می‌شود: اولین `fill`
     وضعیت را جلو می‌برد و `fill`ِ دوم روی همان ثبت‌نام اصلاً پذیرفته نمی‌شود،
     پس سنجهٔ قبلی به‌جای رفتارِ تبدیل، وضعیتِ فرم را می‌سنجید. */
  const link2 = (await send('/intake/links', 'POST', { title: 'ایزو مانْد', amount: 0, formId: form.id })).json;
  const reg2 = await send(`/public/intake/link/${link2.token}/register`, 'POST',
    { firstName: 'ایزو', lastName: 'مانْد', nationalId: NID_B, phone: '09120000472', ...(await captchaFor(API, link2.token)) }, false);
  const again = await send(`/public/intake/form/${reg2.json.token}/fill`, 'POST',
    { values: { opDate: '2026-09-19' } }, false);
  ok('**مقدارِ از قبل ISO دوباره تبدیل نمی‌شود** (وگرنه هر ذخیره ۶۲۱ سال عقب می‌رفت)',
    again.json?.data?.opDate === '2026-09-19', String(again.json?.data?.opDate));

  console.log('\n۲) بنیان‌گذارِ مطب نقشِ پزشک می‌گیرد');
  adminId = num(`SELECT id FROM accounts WHERE username='${USER}'`);
  role0 = sql(`SELECT coalesce(job_role,'') FROM accounts WHERE id=${adminId}`);
  vertical0 = (await send('/config')).json?.vertical ?? 'ionm';

  const solo = num(`SELECT count(*) FROM accounts WHERE level=6 AND status='active'`);
  ok('نصبِ آزمون یک سوپرادمینِ فعال دارد', solo === 1, String(solo));

  /* حالتِ واقعیِ مطب: حساب ساخته شده وقتی حوزه هنوز `ionm` بود، پس نقشی ندارد. */
  sql(`UPDATE accounts SET job_role=NULL WHERE id=${adminId}`);
  await send('/config/vertical', 'PATCH', { vertical: 'ionm' });
  const sw = await send('/config/vertical', 'PATCH', { vertical: 'clinic' });
  ok('سوییچ به مطب', sw.status === 200 && sw.json?.vertical === 'clinic', String(sw.status));
  ok('**نقشِ شغلیِ بنیان‌گذار «پزشک» شد** — بدونِ این، صفِ نقشِ پزشک هیچ‌وقت به او نمی‌رسد',
    sql(`SELECT coalesce(job_role,'') FROM accounts WHERE id=${adminId}`) === 'doctor',
    sql(`SELECT coalesce(job_role,'—') FROM accounts WHERE id=${adminId}`));

  /* نیمهٔ دومِ باگ: بدونِ تعریفِ جراح، `orders.service` همیشه `doctorId: null`
     می‌گیرد و کار بی‌مالک در صفِ نقش می‌مانَد. */
  const viaApi = await send(`/accounts/${adminId}/job-role`, 'POST', { jobRole: 'doctor' });
  ok('ست‌کردنِ نقشِ پزشک از صفحهٔ کاربران', viaApi.status < 300, String(viaApi.status));
  ok('**و همان مسیر تعریفِ جراح هم می‌سازد** (قرارِ `createTemporary`، که این مسیر نداشت)',
    num(`SELECT count(*) FROM surgeons s JOIN accounts a ON a.person_id=s.person_id WHERE a.id=${adminId}`) === 1);

  console.log('\n۳) migration همین کار را روی نصبی که از قبل روی مطب است می‌کند');
  sql(`UPDATE accounts SET job_role=NULL WHERE id=${adminId}`);
  ok('بازسازیِ نصبِ قدیمی: نقش خالی است و حوزه از قبل مطب است',
    sql(`SELECT coalesce(job_role,'') FROM accounts WHERE id=${adminId}`) === ''
    && sql(`SELECT value FROM settings WHERE key='vertical'`) === 'clinic');
  execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1 -f server/prisma/migrations/20260921190000_clinic_founder_doctor/migration.sql`);
  ok('**migration نقش را داد**', sql(`SELECT coalesce(job_role,'') FROM accounts WHERE id=${adminId}`) === 'doctor');

  console.log('\n۴) با دو سوپرادمین هیچ حدسی زده نمی‌شود');
  const second = (await send('/accounts/temporary', 'POST', {
    firstName: 'سوپرادمینِ', lastName: 'دوم', phone: '0912' + String(Math.floor(1e6 + Math.random() * 9e6)),
    level: 6, jobRole: 'secretary', username: `sa${tag}`,
  })).json;
  if (second?.account?.id) trash.accounts.push(second.account.id);
  ok('سوپرادمینِ دومِ فعال ساخته شد', num(`SELECT count(*) FROM accounts WHERE level=6 AND status='active'`) === 2);
  sql(`UPDATE accounts SET job_role=NULL WHERE id=${adminId}`);
  await send('/config/vertical', 'PATCH', { vertical: 'ionm' });
  await send('/config/vertical', 'PATCH', { vertical: 'clinic' });
  ok('**نقشی داده نشد** — حدسِ غلط یعنی کارِ بررسیِ نتیجهٔ پزشکی روی میزِ آدمِ اشتباه',
    sql(`SELECT coalesce(job_role,'') FROM accounts WHERE id=${adminId}`) === '',
    sql(`SELECT coalesce(job_role,'—') FROM accounts WHERE id=${adminId}`));
  execSync(`psql "${DB}" -qtA -v ON_ERROR_STOP=1 -f server/prisma/migrations/20260921190000_clinic_founder_doctor/migration.sql`);
  ok('**و migration هم حدس نمی‌زند**',
    sql(`SELECT coalesce(job_role,'') FROM accounts WHERE id=${adminId}`) === '');
} finally {
  /* ⚠️ حالتِ اولیه حتماً برمی‌گردد: این سوییت حوزه و نقشِ حسابِ آزمون را عوض
     می‌کند و رهاکردنشان بقیهٔ سوییت‌های همان شارد را کج می‌کند. */
  for (const id of trash.accounts) sql(`DELETE FROM accounts WHERE id=${id}`);
  if (adminId) sql(`UPDATE accounts SET job_role=${role0 ? `'${role0}'` : 'NULL'} WHERE id=${adminId}`);
  await send('/config/vertical', 'PATCH', { vertical: vertical0 }).catch(() => {});
  for (const id of trash.forms) await send(`/forms/${id}`, 'DELETE').catch(() => {});
  wipe();
}

console.log(`\n${pass} سنجه سبز${fails.length ? `، ${fails.length} قرمز` : ''}`);
if (fails.length) { for (const f of fails) console.log('  ✘ ' + f); process.exit(1); }
