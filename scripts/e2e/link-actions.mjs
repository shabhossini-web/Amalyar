/**
 * مرحلهٔ ۸ — کنش‌های ردیفِ لینک: **ویرایش** و **ارسالِ پیامکی**.
 *
 * (کپی و پریویو کارِ مرورگرند و در `stage8-browser` سنجیده می‌شوند: یکی
 * clipboard است و دیگری بازکردنِ تبِ تازه.)
 *
 * ⚠️ ادعاها روی **حالتِ برگشته از سرور**اند، نه روی «۲۰۰ گرفت». مثلاً ویرایش
 * با خواندنِ دوبارهٔ فهرست سنجیده می‌شود، نه با کدِ وضعیتِ PATCH.
 *
 * اجرا: `node scripts/e2e/link-actions.mjs`
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

// پاک‌سازیِ اجرای قبلی — لینک حذفِ سخت ندارد، پس خاموش و تغییرِ نام می‌شود.
for (const l of (await api('/intake/links')).json.filter((x) => /^\[la]/.test(x.title))) {
  await api(`/intake/links/${l.id}`, { method: 'PATCH', body: { title: '[la-old] ' + l.id, active: false } });
}

const forms = (await api('/intake/link-options')).json.forms ?? [];
/* فرمِ «زیرپرونده» (`makesVisit: false`) مبلغ نمی‌پذیرد — قاعدهٔ سرور: مراجعه‌ای
   نمی‌سازد، پس مبلغش جایی در دفترِ مالی نمی‌نشیند. برای سنجیدنِ «مبلغ و فرم با هم
   عوض می‌شوند» فرمِ مراجعه‌ایِ بدونِ پرداخت لازم است؛ روی نصبِ تازه (فقط قالب‌ها)
   چنین فرمی نیست، پس با فرمِ زیرپرونده مبلغ صفر سنجیده می‌شود. */
const plainForm = forms.find((f) => !f.hasPayment && f.makesVisit) ?? forms.find((f) => !f.hasPayment);
const editAmount = plainForm && !plainForm.makesVisit ? 0 : 480000;

console.log('\n۱) لینکِ آزمون ساخته می‌شود');
let link = null;
{
  const made = await api('/intake/links', { method: 'POST', body: { title: '[la] لینکِ کنش', amount: 250000 } });
  ok('لینک ساخته شد', made.status < 300, made.status + ' ' + made.text.slice(0, 160));
  link = made.json;
  ok('توکن دارد', !!link?.token, 'token=' + link?.token);
  ok('فعال است', link?.active === true, 'active=' + link?.active);
}

console.log('\n۲) ویرایش: عنوان، مبلغ و فرم عوض می‌شوند و **می‌مانند**');
{
  const patched = await api(`/intake/links/${link.id}`, {
    method: 'PATCH',
    body: { title: '[la] لینکِ ویرایش‌شده', amount: editAmount, ...(plainForm ? { formId: plainForm.id } : {}) },
  });
  ok('ویرایش پذیرفته شد', patched.status < 300, patched.status + ' ' + patched.text.slice(0, 160));

  /* ⚠️ از **فهرست** خوانده می‌شود نه از پاسخِ PATCH: چیزی که ادمین می‌بیند
     همان فهرست است، و اگر روزی `listLinks` فیلدی را جا بگذارد، ادعایی که
     فقط پاسخِ PATCH را می‌سنجد سبز می‌ماند و کاربر تغییر را نمی‌بیند. */
  const row = (await api('/intake/links')).json.find((x) => x.id === link.id);
  ok('عنوانِ تازه در فهرست است', row?.title === '[la] لینکِ ویرایش‌شده', 'title=' + row?.title);
  ok('مبلغِ تازه در فهرست است', row?.amount === editAmount, `amount=${row?.amount} انتظار=${editAmount}`);
  if (plainForm) {
    ok('فرمِ انتخاب‌شده در فهرست است', row?.formTitle === plainForm.title,
      `formTitle=${row?.formTitle} انتظار=${plainForm.title}`);
  }
  /* توکن **نباید** با ویرایش عوض شود: لینکی که ادمین دیروز فرستاده باید
     همچنان کار کند. اگر توکن بازتولید می‌شد، ویرایشِ یک عنوان، همهٔ
     لینک‌های فرستاده‌شده را می‌کشت — بی‌هیچ خطایی. */
  ok('توکن دست‌نخورده ماند', row?.token === link.token, `${row?.token} ≠ ${link.token}`);
}

console.log('\n۳) ارسالِ پیامکی — شمارهٔ نامعتبر همان‌جا رد می‌شود');
{
  for (const bad of ['0912', '12345678901', 'سلام', '']) {
    const r = await api(`/intake/links/${link.id}/sms`, { method: 'POST', body: { phone: bad } });
    ok(`«${bad || '(خالی)'}» رد شد`, r.status === 400, 'status=' + r.status + ' ' + r.text.slice(0, 100));
  }
  /* پیام باید **بگوید چه شکلی درست است**، نه فقط «نامعتبر». */
  const r = await api(`/intake/links/${link.id}/sms`, { method: 'POST', body: { phone: '0912' } });
  ok('پیام نمونه‌ی درست را نشان می‌دهد', /۰۹۱۲|09/.test(r.text), r.text.slice(0, 140));
}

console.log('\n۴) ارسالِ پیامکی — شمارهٔ درست');
{
  const r = await api(`/intake/links/${link.id}/sms`, { method: 'POST', body: { phone: '۰۹۱۲۳۴۵۶۷۸۹' } });
  ok('پذیرفته شد', r.status < 300, r.status + ' ' + r.text.slice(0, 160));
  /* ⚠️ ارقامِ فارسی باید نرمال شوند. بدونِ آن، `SmsService` شماره را نامعتبر
     می‌دید و **بی‌صدا** `sent:false` می‌داد — ادمین پیامِ موفقیت می‌گرفت و
     هیچ پیامکی نمی‌رفت. */
  ok('ارقامِ فارسی نرمال شدند', r.json?.to === '09123456789', 'to=' + r.json?.to);
  ok('نشانیِ لینک هم برمی‌گردد', typeof r.json?.url === 'string' && r.json.url.includes(link.token),
    'url=' + r.json?.url);
  ok('نشانی به مسیرِ ثبت‌نام اشاره می‌کند', /\/r\//.test(r.json?.url ?? ''), 'url=' + r.json?.url);
  /* در محیطِ آزمون کلیدِ ملی‌پیامک نیست، پس `stub: true`. ادعا این است که
     سرور **صادقانه** می‌گوید چیزی نرفته — نه اینکه وانمود کند رفته. */
  ok('صادقانه می‌گوید سرویس پیکربندی نشده', r.json?.stub === true && r.json?.sent === false,
    JSON.stringify(r.json));
}

console.log('\n۵) لینکِ غیرفعال پیامک نمی‌شود');
{
  await api(`/intake/links/${link.id}`, { method: 'PATCH', body: { active: false } });
  const r = await api(`/intake/links/${link.id}/sms`, { method: 'POST', body: { phone: '09123456789' } });
  /* ⚠️ بدونِ این سد، ادمین لینکی می‌فرستاد که بیمار با بازکردنش «این لینک
     غیرفعال شده است» می‌دید — و تماسِ پشتیبانی می‌گرفت. */
  ok('رد شد', r.status === 400, 'status=' + r.status + ' ' + r.text.slice(0, 120));
  ok('و دلیلش را گفت', /غیرفعال/.test(r.text), r.text.slice(0, 140));
  await api(`/intake/links/${link.id}`, { method: 'PATCH', body: { active: true } });
}

console.log('\n۶) لینکِ ناموجود ۴۰۴ می‌دهد، نه ۵۰۰');
{
  const r = await api('/intake/links/99999999/sms', { method: 'POST', body: { phone: '09123456789' } });
  ok('۴۰۴ گرفت', r.status === 404, 'status=' + r.status + ' ' + r.text.slice(0, 100));
}

/* ⚠️ ثبت در **دفترِ ممیزی** عمداً این‌جا سنجیده نمی‌شود: `audit_events`
   هیچ endpointِ HTTP ندارد و این سوئیت فقط از راهِ API حرف می‌زند. ادعایی
   که نمی‌تواند چیزی را ببیند، ادعا نیست — نسخهٔ اول همین را نوشت و روی
   `{}` سبز شد (`!('text' in {})` همیشه درست است).

   بررسیِ دستی (یک‌بار انجام و تأیید شد):
     psql -d <tenant> -c "SELECT action, entity_id, after_json
                          FROM audit_events WHERE action='intake.link.sms'"
   → {"to": "09123456789", "sent": false, "stub": true}
   یعنی مقصد ثبت می‌شود ولی **متنِ پیام** نه. */

// ── پاک‌سازی ────────────────────────────────────────────────────────────────
await api(`/intake/links/${link.id}`, { method: 'PATCH', body: { title: '[la-old] ' + link.id, active: false } });

console.log(`\n${'─'.repeat(58)}\n${pass} ادعا درست`);
if (fails.length) { console.log(`${fails.length} شکست:`); fails.forEach((f) => console.log('  • ' + f)); process.exit(1); }
console.log('همه سبز ✅');
