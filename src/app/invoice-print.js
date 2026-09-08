import fontRegular from '@fontsource/vazirmatn/files/vazirmatn-arabic-400-normal.woff2?url';
import fontBold from '@fontsource/vazirmatn/files/vazirmatn-arabic-700-normal.woff2?url';
import { faDate } from '../lib/jalali.js';
import { fmtMoney, numToWordsFa } from '../lib/money.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cell = value => `<td>${esc(value)}</td>`;
const number = value => `<td class="num">${esc(fmtMoney(value))}</td>`;

let fontsPromise;
export function loadInvoiceFonts() {
  // Embed the local font bytes in the print document. Blank print windows can
  // defer external font requests; an issued document must print independently.
  return fontsPromise ??= Promise.all([fontRegular, fontBold].map(async url => {
    const response = await fetch(new URL(url, import.meta.url));
    if (!response.ok) throw new Error('فونت چاپ بارگذاری نشد');
    const blob = await response.blob();
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
  })).catch(e => { fontsPromise = null; throw e; });
}

export function issuedInvoiceHtml(doc, letterheadUrl = null, fonts = [fontRegular, fontBold]) {
  const { visit: v, billing: b, template: t } = doc.snapshot;
  const brand = t.brand, formal = doc.variant === 'formal', global = b.pricingModel === 'global';
  const neuro = b.charges.some(c => c.neuroDetail);
  const lh = formal && /^data:image\/(png|jpeg|webp);base64,/.test(letterheadUrl ?? '') ? letterheadUrl : null;
  const top = lh ? Math.min(65, Math.max(10, Number(t.top) || 42)) : 14;
  const bottom = lh ? Math.min(45, Math.max(10, Number(t.bottom) || 24)) : 14;
  const cols = neuro ? (global ? 5 : 8) : (global ? 3 : 5);
  const rows = b.charges.map((c, index) => {
    const d = c.neuroDetail;
    if (neuro && d) return ['professional', 'technical'].map((part, p) => `<tr>
      ${cell(fmtMoney(index + 1))}${cell(`${c.serviceCode || ''} · ${c.title}`)}${number(d.hours)}${cell(p ? 'فنی' : 'حرفه‌ای')}${number(d.coefficients[part])}
      ${global ? '' : `${number(d.factors[part])}${number(d[part])}${cell(d.deviceOwner === 'hospital' ? 'بیمارستان' : 'شرکت')}`}
    </tr>`).join('');
    return `<tr>${cell(fmtMoney(index + 1))}${cell([c.serviceCode, c.title].filter(Boolean).join(' · '))}${number(c.quantity)}
      ${neuro ? `${cell('—')}${cell('—')}` : ''}${global ? '' : `${number(c.unitPrice)}${number(c.amount)}${neuro ? cell('—') : ''}`}</tr>`;
  }).join('');
  const identity = [brand.phone && `تلفن: ${brand.phone}`, formal && brand.nationalId && `شناسه ملی: ${brand.nationalId}`, formal && brand.econCode && `کد اقتصادی: ${brand.econCode}`, formal && brand.registration && `شماره ثبت: ${brand.registration}`, brand.postal && `کد پستی: ${brand.postal}`, brand.website].filter(Boolean).map(esc).join(' · ');
  const pays = t.showPayments && b.payments.length ? `<h2>ریز پرداخت‌ها (تومان)</h2><table><thead><tr><th>تاریخ</th><th>روش</th><th>پیگیری</th><th>مبلغ</th></tr></thead><tbody>${b.payments.map(p => `<tr>${cell(faDate(p.paidAt))}${cell(({ cash: 'نقدی', card: 'کارت‌خوان', transfer: 'انتقال', cheque: 'چک', insurance: 'بیمه' })[p.method] ?? p.method)}${cell(p.reference)}${number(p.amount)}</tr>`).join('')}</tbody></table>` : '';
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>فاکتور ${esc(doc.number)}</title>
  <style>
    @font-face { font-family: InvoiceFa; src: url('${esc(new URL(fonts[0], import.meta.url).href)}') format('woff2'); font-weight: 400; }
    @font-face { font-family: InvoiceFa; src: url('${esc(new URL(fonts[1], import.meta.url).href)}') format('woff2'); font-weight: 700; }
    @page { size: A4; margin: ${top}mm 14mm ${bottom}mm; }
    * { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    body { margin: 0; color: #151515; font: 10pt/1.8 InvoiceFa, Tahoma, sans-serif; }
    .sheet { max-width: 182mm; margin: auto; }
    .letterhead { position: fixed; top: -${top}mm; left: -14mm; width: 210mm; height: 297mm; z-index: -1; }
    header { display: flex; justify-content: space-between; gap: 12px; border-bottom: 2px solid #333; padding-bottom: 8px; }
    h1 { font-size: 16pt; margin: 0; } h2 { font-size: 11pt; margin: 12px 0 5px; }
    header small { display: block; } .serial { white-space: nowrap; }
    .party { margin: 10px 0; } .meta { font-size: 9pt; }
    table { width: 100%; border-collapse: collapse; table-layout: auto; margin: 8px 0; }
    thead { display: table-header-group; } tr { break-inside: avoid; page-break-inside: avoid; }
    td, th { border: 1px solid #888; padding: 5px; text-align: right; font-size: 9pt; overflow-wrap: anywhere; }
    th { background: #eee; } .num { direction: ltr; text-align: left; white-space: nowrap; }
    .totals, .signatures { break-inside: avoid; page-break-inside: avoid; }
    .totals { margin-top: 12px; padding: 10px; border: 1px solid #888; }
    .notes { white-space: pre-wrap; overflow-wrap: anywhere; }
    .signatures { display: flex; gap: 14px; margin-top: 40px; }
    .signatures span { flex: 1; border-top: 1px solid #777; padding-top: 8px; text-align: center; }
    .superseded { color: #9c2419; border: 1px solid; padding: 8px; }
    @media screen { body { padding: 20px; background: #eee; } .sheet { background: white; padding: 18px; } .letterhead { display: none; } }
  </style></head><body><main class="sheet">
  ${lh ? `<img class="letterhead" src="${lh}" alt="">` : ''}
  ${doc.supersededAt ? '<p class="superseded">نسخهٔ قبلی — با فاکتور جدید جایگزین شده است</p>' : ''}
  <header><div><h1>${esc(brand.legalName || '')}</h1><small>${identity}</small><small>${esc(brand.address)}</small></div><div class="serial"><b>${esc(t.title || 'صورتحساب خدمات')}</b><br>${formal ? 'رسمی' : 'غیررسمی'}<br>شماره: <b dir="ltr">${esc(doc.number)}</b><br>تاریخ صدور: ${esc(faDate(doc.createdAt))}</div></header>
  <div class="party"><b>طرف حساب: ${esc(v.payer === 'hospital' ? v.payerHospitalName || v.hospitalName : v.fullName)}</b>
  <br>بیمار: ${esc(v.fullName)} ${v.nationalId ? `· کد ملی: ${esc(v.nationalId)}` : ''}
  <br>جراح: ${esc(v.surgeonName)} · بیمارستان: ${esc(v.hospitalName)}
  ${v.payerAddress || v.hospitalAddress ? `<br>نشانی مرکز: ${esc(v.payerAddress || v.hospitalAddress)}` : ''}
  <br>تاریخ عمل: ${esc(faDate(v.opDate))} · نوع عمل: ${esc(v.procedureTypeName)}
  ${v.opStartTime ? `<br>شروع: ${esc(v.opStartTime)} · پایان: ${esc(v.opEndTime || '—')}` : ''}</div>
  <h2>اقلام و خدمات · مبالغ به تومان</h2>
  <table><thead><tr><th>ردیف</th><th>کد و شرح خدمت / کالا</th><th>${neuro ? 'ساعت / تعداد' : 'تعداد'}</th>${neuro ? '<th>سهم</th><th>ارزش نسبی</th>' : ''}${global ? '' : `<th>${neuro ? 'ضریب / فی واحد' : 'فی واحد'}</th><th>مبلغ</th>${neuro ? '<th>مالک دستگاه</th>' : ''}`}</tr></thead><tbody>${rows || `<tr><td colspan="${cols}">قلمی ثبت نشده است</td></tr>`}</tbody></table>
  <div class="totals"><b>${global ? 'مبلغ کل توافقی' : 'جمع کل'}: ${esc(fmtMoney(b.total))} تومان</b><br>به حروف: ${esc(numToWordsFa(b.total))} تومان<br>پرداخت‌شده: ${esc(fmtMoney(b.paid))} تومان · ${b.due < 0 ? 'بستانکاری' : 'مانده'}: ${esc(fmtMoney(Math.abs(b.due)))} تومان</div>
  ${pays}
  ${b.invoiceBankAccount ? `<p class="meta">حساب دریافت: ${esc([b.invoiceBankAccount.ownerName, b.invoiceBankAccount.bankName, b.invoiceBankAccount.accountNumber, b.invoiceBankAccount.iban].filter(Boolean).join(' · '))}</p>` : ''}
  ${t.notes ? `<p class="notes">${esc(t.notes)}</p>` : ''}
  <div class="signatures">${(t.signatures || []).map(s => `<span>${esc(s)}</span>`).join('')}</div>
  </main></body></html>`;
}

export async function printIssuedInvoice(w, doc, letterheadUrl) {
  const fonts = await loadInvoiceFonts();
  w.document.open(); w.document.write(issuedInvoiceHtml(doc, letterheadUrl, fonts)); w.document.close();
  await Promise.all([w.document.fonts.load('400 10pt InvoiceFa', 'فاکتور'), w.document.fonts.load('700 10pt InvoiceFa', 'فاکتور'), ...Array.from(w.document.images).map(img => img.decode())]);
  await w.document.fonts.ready;
  if (!w.closed) { w.focus(); w.print(); }
}
