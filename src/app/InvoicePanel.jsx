import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiDataUrl } from '../lib/api.js';
import { fmtMoney } from '../lib/money.js';
import { toEnDigits } from '../lib/identity.js';
import { faDate } from '../lib/jalali.js';
import { useAuth } from './auth.jsx';
import { printIssuedInvoice } from './invoice-print.js';

export default function InvoicePanel({ visit, billing, neuro, onToast, reload }) {
  const { user } = useAuth();
  const [info, setInfo] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ code: '', hours: '', year: '', deviceOwner: 'company' });
  const [query, setQuery] = useState(''), [hits, setHits] = useState([]), [preview, setPreview] = useState(null);
  const root = `/visits/${visit.id}/invoices`;
  const refresh = useCallback(async () => {
    const next = await api(root); setInfo(next);
    setDraft(d => ({ ...d, hours: d.hours || String(next.hours ?? ''), year: d.year || next.year }));
  }, [root]);
  useEffect(() => { refresh().catch(e => setError(e.message)); }, [refresh]);
  useEffect(() => {
    let live = true;
    if (query.trim().length < 2) return;
    const timer = setTimeout(() => api(`/service-codes?q=${encodeURIComponent(query.trim())}`).then(rows => { if (live) setHits(rows); }).catch(e => { if (live) setError(e.message); }), 250);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);
  const change = (key, value) => { if (busy) return; setDraft(d => ({ ...d, [key]: value })); setPreview(null); setError(''); };
  const calculate = async (add = false) => {
    setBusy(true); setError('');
    try {
      const result = await api(`${root}/${add ? 'neuro-service' : 'neuro-preview'}`, { method: 'POST', body: { ...draft, hours: Number(toEnDigits(draft.hours)), year: toEnDigits(draft.year) } });
      if (add) { await reload(); setPreview(null); setDraft(d => ({ ...d, code: '' })); setQuery(''); setHits([]); onToast('خدمت به اقلام صورتحساب اضافه شد'); }
      else setPreview(result);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const print = async (documentId) => {
    // Open synchronously in the click event so mobile browsers permit the print window.
    const w = window.open('', '_blank');
    if (!w) { setError('برای چاپ، اجازهٔ بازشدن پنجره را بدهید'); return; }
    w.document.body.textContent = 'در حال آماده‌سازی فاکتور…';
    setBusy(true); setError('');
    try {
      const doc = documentId ? await api(`${root}/${documentId}`) : await api(root, { method: 'POST', body: { variant: billing.invoiceType } });
      const letterheadUrl = doc.snapshot.template.letterhead ? await apiDataUrl(`${root}/${doc.id}/letterhead`) : null;
      if (doc.snapshot.template.letterhead && !letterheadUrl) throw new Error('سربرگ فاکتور بارگذاری نشد؛ چاپ را دوباره بزنید');
      await printIssuedInvoice(w, doc, letterheadUrl);
      await refresh();
      if (!documentId) onToast(`فاکتور ${doc.number} آمادهٔ چاپ است`);
    } catch (e) { w.close(); setError(e.message); } finally { setBusy(false); }
  };
  return <section className="bl-invoice-panel">
    <h3 className="bl-section-title">{neuro ? 'فاکتور خدمات نورومانیتورینگ' : 'فاکتور شرکت'}</h3>
    {user?.level >= 6 && <Link className="bl-mini" to="/app/settings">تنظیم قالب و مشخصات صادرکننده</Link>}
    {error && <p className="bl-error" role="alert">{error}</p>}
    {neuro && <details className="bl-add" open>
      <summary>محاسبه و افزودن خدمت با تعرفه</summary>
      <p className="db-hint">تعرفه از نوع بیمارستان و تعاریف پایه خوانده می‌شود. افزودن خدمت، اقلام قبلی را نگه می‌دارد؛ قلم تکراری را در بخش اقلام حذف کنید.</p>
      <label className="db-field"><span>جستجوی خدمت (نام یا کد)</span><input disabled={busy} value={query} onChange={e => { setQuery(e.target.value); setHits([]); change('code', ''); }} placeholder="EMG، MEP، SEP یا مانیتورینگ" /></label>
      {hits.length > 0 && <div className="bl-code-hits">{hits.map(hit => <button className="bl-mini" type="button" key={hit.code} onClick={() => { change('code', hit.code); setQuery(`${hit.code} · ${hit.title}`); setHits([]); }}>{hit.code} · {hit.title}</button>)}</div>}
      {draft.code && <p>کد انتخاب‌شده: <b dir="ltr">{draft.code}</b></p>}
      <div className="db-grid2">
        <label className="db-field"><span>مدت قابل صورتحساب (ساعت)</span><input dir="ltr" inputMode="numeric" value={draft.hours} onChange={e => change('hours', e.target.value)} /></label>
        <label className="db-field"><span>سال تعرفه (شمسی)</span><input dir="ltr" inputMode="numeric" value={draft.year} onChange={e => change('year', e.target.value)} /></label>
        <label className="db-field"><span>مالک دستگاه</span><select value={draft.deviceOwner} onChange={e => change('deviceOwner', e.target.value)}><option value="company">شرکت</option><option value="hospital">بیمارستان</option></select></label>
      </div>
      <p className="db-hint">مدت پیشنهادی از ساعت شروع و پایان عمل، با گردکردن نیم‌ساعت به بالا و حداقل یک ساعت محاسبه می‌شود؛ پیش از ثبت قابل اصلاح است.</p>
      <button type="button" className="bl-mini" disabled={busy || !draft.code || !draft.hours || !draft.year} onClick={() => calculate()}>محاسبه تعرفه</button>
      {preview && <div className="bl-neuro-preview">
        <b>{preview.title}</b><p>{preview.tariff.sectorLabel} · سال {preview.tariff.year} · {fmtMoney(preview.hours)} ساعت</p>
        <p>حرفه‌ای: {fmtMoney(preview.professional)} تومان · فنی: {fmtMoney(preview.technical)} تومان</p>
        <strong>جمع خدمت: {fmtMoney(preview.total)} تومان</strong>
        <button type="button" className="db-submit bl-btn" disabled={busy} onClick={() => calculate(true)}>افزودن خدمت محاسبه‌شده</button>
      </div>}
    </details>}
    <p className="db-hint">صدور، نسخه‌ای با شمارهٔ ثابت ثبت می‌کند. صدور مجدد بدون تغییر، همان شماره را برمی‌گرداند؛ پس از تغییر، نسخهٔ جدید جایگزین می‌شود و قبلی در سوابق می‌ماند.</p>
    <button type="button" className="db-submit bl-btn" disabled={busy || !info || !billing.invoiceType || !billing.invoiceBankAccount || !billing.charges.length} onClick={() => print()}>
      صدور و چاپ فاکتور {billing.invoiceType === 'informal' ? 'غیررسمی' : 'رسمی'}
    </button>
    {(!billing.invoiceType || !billing.invoiceBankAccount) && <p className="db-hint">نوع فاکتور و حساب دریافت را بالای همین بخش ثبت کنید.</p>}
    {info?.documents?.length > 0 && <section aria-label="فاکتورهای صادرشده"><h4>سوابق صدور</h4>{info.documents.map(doc => <div key={doc.id} className="bl-issued-row"><span><b dir="ltr">{doc.number}</b> · {faDate(doc.createdAt)} · {doc.supersededAt ? 'نسخهٔ قبلی — جایگزین شده' : 'نسخهٔ جاری'}</span><button type="button" className="bl-mini" disabled={busy} onClick={() => print(doc.id)}>چاپ نسخه</button></div>)}</section>}
  </section>;
}
