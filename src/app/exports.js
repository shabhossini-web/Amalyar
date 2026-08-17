import { faDate, isoToJStr, jStr, jToday, jToFa } from '../lib/jalali.js';

/**
 * خروجیِ فهرستِ مراجعات — CSV و چاپ.
 *
 * هر دو از **همان ردیف‌هایی** ساخته می‌شوند که سرور با فیلترِ جاری برگردانده
 * (`/visits/export`)، نه از صفحهٔ روی نمایش. کاربر «همین فهرست» را می‌خواهد.
 */

/** ستون‌ها یک‌جا تعریف می‌شوند تا CSV و چاپ هرگز از هم جدا نشوند. */
const COLUMNS = [
  { key: 'code', label: 'کدِ مراجعه' },
  { key: 'patientCode', label: 'کدِ پرونده' },
  { key: 'fullName', label: 'نامِ بیمار' },
  { key: 'nationalId', label: 'کد ملی' },
  { key: 'phone', label: 'موبایل' },
  { key: 'kindLabel', label: 'نوع' },
  { key: 'opDateJ', label: 'تاریخ' },
  { key: 'opStartTime', label: 'ساعتِ شروع' },
  { key: 'opEndTime', label: 'ساعتِ پایان' },
  { key: 'durationText', label: 'مدت' },
  { key: 'techArriveTime', label: 'حضورِ کارشناس' },
  { key: 'procedureTypeName', label: 'نوعِ عمل' },
  { key: 'diagnosisTitle', label: 'تشخیص' },
  { key: 'surgeonName', label: 'جراح' },
  { key: 'hospitalName', label: 'بیمارستان' },
  { key: 'techName', label: 'کارشناس' },
  { key: 'statusLabel', label: 'وضعیت' },
  { key: 'total', label: 'جمعِ کل (تومان)', money: true },
  { key: 'paid', label: 'پرداخت‌شده (تومان)', money: true },
  { key: 'due', label: 'مانده (تومان)', money: true },
  { key: 'notes', label: 'یادداشت' },
];

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');

/** «۳ ساعت و ۲۵ دقیقه» */
export function durationText(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${faNum(m)} دقیقه`;
  if (!m) return `${faNum(h)} ساعت`;
  return `${faNum(h)} ساعت و ${faNum(m)} دقیقه`;
}

/**
 * ردیفِ خام سرور → ردیفِ آمادهٔ خروجی.
 *
 * برچسب‌ها (نوع، وضعیت) از همان نگاشتی می‌آیند که داشبورد استفاده می‌کند و
 * به‌عنوان پارامتر داده می‌شوند؛ این فایل واژگانِ خودش را نمی‌سازد.
 */
function shape(v, { kindLabel, statusLabel }) {
  return {
    ...v,
    kindLabel: kindLabel(v),
    statusLabel: statusLabel(v),
    opDateJ: v.opDate ? isoToJStr(v.opDate) : '',
    durationText: durationText(v.durationMin),
  };
}

/**
 * CSV — با BOM، وگرنه Excel فارسی را «Ø³Ø§Ø±Ø§» نشان می‌دهد.
 *
 * ⚠️ عددها لاتین و بدونِ جداکنندهٔ هزارگان می‌روند. ارقامِ فارسی در Excel متن
 * می‌شوند و جمع‌زدن ستون از کار می‌افتد — و کاربر CSV را برای همان جمع‌زدن
 * می‌گیرد. جای ارقامِ فارسی، خروجیِ چاپ است.
 */
export function visitsToCsv(rows, opts) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const shaped = rows.map((r) => shape(r, opts));
  const lines = [
    COLUMNS.map((c) => c.label),
    ...shaped.map((r) => COLUMNS.map((c) => (c.money ? Number(r[c.key] ?? 0) : r[c.key] ?? ''))),
  ];

  if (opts.stats) {
    const s = opts.stats;
    lines.push(
      [],
      ['— خلاصه —'],
      ['تعدادِ مراجعات', rows.length],
      ['جمعِ ماندهٔ کل (تومان)', Number(s.due ?? 0)],
      ['در انتظار', Number(s.pending ?? 0)],
    );
    if (opts.filterLabel) lines.push(['فیلترِ اعمال‌شده', opts.filterLabel]);
    if (opts.truncated) lines.push(['هشدار', `فقط ${opts.limit} ردیفِ اول — نتیجه بیشتر از سقف بود`]);
  }

  return `﻿${lines.map((r) => r.map(esc).join(',')).join('\r\n')}`;
}

/**
 * ⚠️ نامِ فایل عمداً لاتین است.
 *
 * کرومیوم نامِ غیر-ASCII را در دانلودِ blob **دور می‌ریزد** و فایل با نامِ
 * «download» و بدونِ پسوند ذخیره می‌شود — یعنی Excel هم بازش نمی‌کند. آزموده:
 * نامِ فارسی → «download»، همان نام با حروفِ لاتین → سالم. عنوانِ فارسی داخلِ
 * خودِ فایل (سطرِ خلاصه) و روی برگهٔ چاپ می‌آید، که جای درستش است.
 */
export function downloadCsv(csv, prefix = 'visits') {
  const name = `amalyar-${prefix}-${jStr(...jToday()).replace(/\//g, '-')}.csv`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  // ⚠️ باید به DOM اضافه شود: روی عنصرِ جدامانده، بعضی مرورگرها خودِ کلیک را
  // اجرا می‌کنند ولی نامِ فایل را نادیده می‌گیرند و فایل «download» ذخیره می‌شود.
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

const escHtml = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * چاپ — پنجرهٔ تازه با HTMLِ خودبسنده.
 *
 * چرا پنجرهٔ جدا و نه `@media print` روی همین صفحه: تمِ تیره، شیشه‌ای‌ها و
 * gradientها برای چاپ باید یکی‌یکی بازنویسی شوند و باز هم مرورگرها فرق دارند.
 * یک سندِ سفیدِ ساده هم قابلِ اتکاتر است هم روی اندروید/سافاری/ویندوز یکسان.
 *
 * فیلترِ اعمال‌شده روی برگه چاپ می‌شود، وگرنه برگهٔ چاپ‌شده بی‌معنی است: معلوم
 * نیست فهرستِ چه چیزی است.
 */
export function printVisits(rows, opts) {
  const shaped = rows.map((r) => shape(r, opts));
  const s = opts.stats ?? {};
  const head = COLUMNS.map((c) => `<th>${escHtml(c.label)}</th>`).join('');
  const body = shaped
    .map(
      (r) =>
        `<tr>${COLUMNS.map((c) => {
          const raw = r[c.key];
          // در چاپ همه‌چیز فارسی خوانده می‌شود؛ ارقامِ لاتین فقط برای CSV لازم
          // بود (تا Excel بتواند جمع بزند) و روی برگهٔ کاغذی ناهمگون دیده می‌شد.
          const cell = c.money ? faNum(raw) : jToFa(escHtml(raw ?? ''));
          return `<td${c.money ? ' class="num"' : ''}>${cell}</td>`;
        }).join('')}</tr>`,
    )
    .join('');

  const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<title>${escHtml(opts.title || 'فهرستِ مراجعات')}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Vazirmatn, Tahoma, sans-serif; margin: 0; color: #111; font-size: 9pt; }
  header { display: flex; align-items: baseline; gap: 10px; border-bottom: 2px solid #333; padding-bottom: 6px; margin-bottom: 8px; }
  header b { font-size: 13pt; }
  header span { font-size: 8.5pt; color: #555; margin-inline-start: auto; }
  .meta { font-size: 8.5pt; color: #333; margin-bottom: 8px; line-height: 1.8; }
  .warn { color: #b00; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 3px 5px; text-align: right; vertical-align: top; }
  th { background: #eee; font-size: 8.5pt; white-space: nowrap; }
  td.num { text-align: left; direction: ltr; white-space: nowrap; }
  tbody tr:nth-child(even) { background: #f7f7f7; }
  /* رنگِ زمینهٔ ردیف‌ها بدونِ این در چاپ حذف می‌شود. */
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  tfoot td { font-weight: 700; background: #eee; }
</style></head><body>
<header>
  <b>${escHtml(opts.brandName || 'عمل‌یار')}</b>
  <i>${escHtml(opts.title || 'فهرستِ مراجعات')}</i>
  <span>تاریخِ چاپ: ${escHtml(faDate(new Date().toISOString()))}</span>
</header>
<div class="meta">
  تعداد: ${jToFa(rows.length)}
  ${s.due ? ` · ماندهٔ کل: ${faNum(s.due)} تومان` : ''}
  ${s.pending != null ? ` · در انتظار: ${jToFa(s.pending)}` : ''}
  ${opts.filterLabel ? `<br>فیلتر: ${escHtml(opts.filterLabel)}` : ''}
  ${opts.truncated ? `<br><span class="warn">هشدار: فقط ${jToFa(opts.limit)} ردیفِ اول چاپ شده — نتیجه بیشتر از سقف بود.</span>` : ''}
</div>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false; // مسدودشدنِ پاپ‌آپ — فراخوان باید به کاربر بگوید
  w.document.write(html);
  w.document.close();
  w.focus();
  // چاپ بعد از رندر؛ بدونِ تأخیر، سافاری صفحهٔ خالی چاپ می‌کند.
  setTimeout(() => w.print(), 350);
  return true;
}

/**
 * فاکتورِ رسمیِ یک مراجعه — برگهٔ A4 عمودی.
 *
 * جدا از برگهٔ فهرستِ مراجعات است چون مخاطبش فرق دارد: آن گزارشِ داخلی است،
 * این سندی است که دستِ بیمار یا بیمارستان می‌رود. پس سربرگِ برند، مشخصاتِ
 * طرفِ حساب، اقلام، پرداخت‌ها و **مانده** را دارد و جای امضا.
 *
 * ⚠️ ارقام فارسی‌اند (برخلافِ CSV): این برگه خوانده می‌شود نه جمع زده.
 */
export function printInvoice({ visit, billing, brand, letterheadUrl, variant = 'official' }) {
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fa = (n) => Number(n || 0).toLocaleString('fa-IR');
  /* غیررسمی = صورت‌حسابِ دستِ بیمار: بدونِ سربرگِ رسمی و بدونِ هویتِ مالیاتی.
     رسمی = سندِ حسابداری/بیمارستان: سربرگ + شناسهٔ ملی و کدِ اقتصادی. */
  const official = variant !== 'informal';
  /* با سربرگ، هویتِ متنیِ شرکت چاپ نمی‌شود — خودِ سربرگ نام و نشان را دارد و
     دوبار چاپ‌شدنش سند را خراب می‌کند. صفحه تمام‌بوم می‌شود (حاشیهٔ صفر) تا
     تصویرِ سربرگ تا لبهٔ کاغذ برسد؛ محتوا با paddingِ بدنه جای خودش می‌ماند. */
  const lh = official && typeof letterheadUrl === 'string' && letterheadUrl.startsWith('data:image/') ? letterheadUrl : null;

  /* مدلِ گلوبال: کدها، شرح و تعداد چاپ می‌شوند ولی ستون‌های مبلغِ تک‌قلم نه —
     مبلغِ فاکتور همان توافقیِ کل است که سرور در billing.total گذاشته. */
  const global = billing.pricingModel === 'global';
  const items = billing.charges.map((c, i) => `<tr>
    <td class="c">${jToFa(i + 1)}</td>
    <td>${esc(c.title)}${c.serviceCode ? ` <small dir="ltr">${esc(c.serviceCode)}</small>${c.codeSystem === 'internal' ? ' <small>(کدِ داخلی)</small>' : ''}` : ''}</td>
    <td class="c">${fa(c.quantity)}</td>
    ${global ? '' : `<td class="n">${fa(c.unitPrice)}</td>
    <td class="n">${fa(c.amount)}</td>`}
  </tr>`).join('');
  const cols = global ? 3 : 5;

  const pays = billing.payments.length
    ? `<h2>پرداخت‌ها</h2><table><thead><tr><th>تاریخ</th><th>روش</th><th>پیگیری</th><th>مبلغ</th></tr></thead><tbody>${
        billing.payments.map((p) => `<tr>
          <td>${esc(faDate(p.paidAt))}</td>
          <td>${esc(PAY_METHODS[p.method] ?? p.method)}</td>
          <td dir="ltr">${esc(p.reference || '—')}</td>
          <td class="n">${fa(p.amount)}</td>
        </tr>`).join('')
      }</tbody></table>`
    : '';

  // هویتِ حقوقیِ شرکت زیرِ نام. فاکتورِ بدونِ شناسهٔ ملی و کدِ اقتصادی سندِ
  // مالیاتی نیست، پس در رسمی هرکدام که پر باشد چاپ می‌شود؛ غیررسمی فقط تلفن.
  const idLine = [
    brand?.phone ? `تلفن: ${esc(jToFa(brand.phone))}` : '',
    official && brand?.nationalId ? `شناسهٔ ملی: ${esc(jToFa(brand.nationalId))}` : '',
    official && brand?.econCode ? `کد اقتصادی: ${esc(jToFa(brand.econCode))}` : '',
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');

  const payTo = visit.payer === 'hospital'
    ? `بیمارستان: ${esc(visit.payerHospitalName || visit.hospitalName || '—')}`
    : `بیمار: ${esc(visit.fullName)}`;

  const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<title>فاکتور ${esc(visit.code)}</title><style>
  @page { size: A4; margin: ${lh ? '0' : '14mm'}; }
  body { font-family: Vazirmatn, Tahoma, sans-serif; color: #111; font-size: 11pt;${lh ? ' margin: 0; padding: 42mm 16mm 24mm;' : ''} }
  /* سربرگ روی هر صفحهٔ چاپی تکرار می‌شود (fixed در چاپ = هر صفحه). */
  .lh-bg { position: fixed; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -1; }
  header { display: flex; align-items: flex-start; gap: 12px; border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 10px; }
  header h1 { font-size: 16pt; margin: 0; }
  header .sub { font-size: 9.5pt; color: #555; }
  header .no { margin-inline-start: auto; text-align: left; font-size: 10pt; }
  .party { font-size: 10.5pt; line-height: 2; margin-bottom: 10px; }
  h2 { font-size: 11pt; margin: 14px 0 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #999; padding: 5px 7px; text-align: right; font-size: 10pt; }
  th { background: #eee; }
  td.n { text-align: left; direction: ltr; white-space: nowrap; }
  td.c { text-align: center; }
  tfoot td { font-weight: 700; background: #f4f4f4; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .due { color: #b00; }
  .sign { display: flex; gap: 40px; margin-top: 34px; font-size: 10pt; }
  .sign div { flex: 1; border-top: 1px solid #333; padding-top: 6px; }
</style></head><body>
${lh ? `<img class="lh-bg" src="${lh}" alt="">` : ''}
<header>
  ${lh ? '<div></div>' : `<div>
    <h1>${esc(brand?.legalName || brand?.name || 'عمل‌یار')}</h1>
    ${idLine ? `<div class="sub">${idLine}</div>` : ''}
    ${brand?.address ? `<div class="sub">${esc(brand.address)}</div>` : ''}
  </div>`}
  <div class="no">
    <b>${official ? 'صورت‌حساب' : 'صورت‌حسابِ غیررسمی'}</b><br>
    شماره: <span dir="ltr">${esc(visit.code)}</span><br>
    تاریخ: ${esc(faDate(visit.opDate || visit.createdAt))}
  </div>
</header>
<div class="party">
  ${payTo}
  ${visit.nationalId ? ` &nbsp;·&nbsp; کد ملی: ${esc(jToFa(visit.nationalId))}` : ''}
  ${visit.phone ? ` &nbsp;·&nbsp; موبایل: ${esc(jToFa(visit.phone))}` : ''}
  ${visit.surgeonName ? `<br>جراح: ${esc(visit.surgeonName)}` : ''}
  ${visit.hospitalName ? ` &nbsp;·&nbsp; بیمارستان: ${esc(visit.hospitalName)}` : ''}
  ${visit.procedureTypeName || visit.opType ? `<br>نوعِ عمل: ${esc(visit.procedureTypeName || visit.opType)}` : ''}
</div>
<table>
  <thead><tr><th>ردیف</th><th>شرح</th><th>تعداد</th>${global ? '' : '<th>مبلغِ واحد</th><th>مبلغ</th>'}</tr></thead>
  <tbody>${items || `<tr><td colspan="${cols}">قلمی ثبت نشده است</td></tr>`}</tbody>
  <tfoot>
    <tr><td colspan="${cols - 1}">${global ? 'مبلغِ کلِ توافقی (تومان)' : 'جمعِ کل (تومان)'}</td><td class="n">${fa(billing.total)}</td></tr>
    <tr><td colspan="${cols - 1}">پرداخت‌شده</td><td class="n">${fa(billing.paid)}</td></tr>
    <tr><td colspan="${cols - 1}" class="due">مانده</td><td class="n due">${fa(billing.due)}</td></tr>
  </tfoot>
</table>
${pays}
<div class="sign"><div>مهر و امضای صادرکننده</div><div>امضای دریافت‌کننده</div></div>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
  return true;
}

const PAY_METHODS = { cash: 'نقدی', card: 'کارت‌خوان', transfer: 'انتقال', cheque: 'چک', insurance: 'بیمه' };
