import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { api, apiDataUrl } from '../lib/api.js';
import { faDate } from '../lib/jalali.js';
import { fmtMoney } from '../lib/money.js';
import { useAuth } from './auth.jsx';
import { printIssuedInvoice } from './invoice-print.js';
import NeuroInvoiceDialog from './NeuroInvoiceDialog.jsx';
import { Alert } from '../ui/icons.jsx';

export default function InvoicePanel({ visit, billing, neuro, onToast, reload }) {
  const { user } = useAuth();
  const [info, setInfo] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  /* پنجرهٔ خدمات: `null` بسته؛ `{}` باز؛ `{ intent: 'replace' }` از هشدارِ دوبارشماری (DF3). */
  const [picker, setPicker] = useState(null);
  const root = `/visits/${visit.id}/invoices`;
  const refresh = useCallback(async () => setInfo(await api(root)), [root]);
  useEffect(() => { refresh().catch(e => setError(e.message)); }, [refresh]);
  const print = async (documentId, preparedWindow) => {
    // Open synchronously in the click event so mobile browsers permit the print window.
    const w = preparedWindow ?? window.open('', '_blank');
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
  const neuroLines = billing.charges.filter(c => c.neuroDetail && !c.neuroDetail.consumable);
  const neuroCons = billing.charges.filter(c => c.neuroDetail?.consumable);
  /* قلمِ مبلغِ کلِ مراجعه (سرور، `lumpLines`) — تا پنل نگوید «خدمتی نیست» وقتی قلمِ ثبت‌نام همان خدمت است (company-14). */
  const lump = info?.lumpLines ?? [];
  /* DF3: قلمِ مبلغِ کل و خدماتِ ریزشده هر دو روی صورت‌حساب‌اند و کاربر هرگز صریحاً «کنار» نگفته — مثلاً ثبتی که
     پیش از پرسیدنِ «جایگزین یا کنار» انجام شده. تا دیروز پنل در این حال فقط خدمات را نشان می‌داد و قلمِ کل را
     پنهان می‌کرد، پس دوبارشماری از این‌جا دیده نمی‌شد. هر دو پرچم از سرور است. */
  const doubled = neuro && info?.lumpBesideNeuro && !info?.lumpKept;
  return <section className="bl-invoice-panel">
    <h3 className="bl-section-title">{neuro ? 'فاکتور خدمات نورومانیتورینگ' : 'فاکتور شرکت'}</h3>
    {user?.level >= 6 && <Link className="bl-mini" to="/app/settings">تنظیم قالب و مشخصات صادرکننده</Link>}
    {error && <p className="bl-error" role="alert">{error}</p>}
    {neuro && <div className="bl-add nv-launch">
      {/* یک پاپ‌آپ برای همهٔ خدمات — نه یکی‌یکی. وضعیتِ فعلی همین‌جا خلاصه می‌شود تا کاربر بداند چه روی فاکتور است. */}
      <div className="nv-launch-sum">
        {neuroLines.length
          ? <><b>{neuroLines.map(c => c.neuroDetail.label ?? c.title).join(' · ')}</b><small>{neuroLines[0].neuroDetail.hours} ساعت · مالک دستگاه: {neuroLines[0].neuroDetail.deviceOwner === 'hospital' ? 'بیمارستان' : 'شرکت'}{neuroCons.length ? ` · ${neuroCons.length.toLocaleString('fa-IR')} قلم مصرفی` : ''}{info?.lumpKept ? ` · کنارِ ${lump.map(c => c.title).join('، ')} (به انتخابِ شما)` : ''}</small></>
          : lump.length
            ? <><b>روی صورت‌حساب: {lump.map(c => `${c.title} · ${fmtMoney(c.amount)} تومان`).join('، ')}</b><small>این قلمِ مبلغِ کل است، نه ریزِ خدمات. برای فاکتور خدمات را انتخاب کنید؛ همان‌جا می‌گویید جایگزینِ این قلم شوند یا کنارش بمانند.</small></>
            : <><b>هنوز خدمتِ نورومانیتورینگی روی این صورت‌حساب نیست</b><small>خدمات با تیکِ پیش‌فرضِ شرکت و مدتِ عمل پیش‌پر می‌آیند؛ فقط تأیید کنید.</small></>}
      </div>
      <button type="button" className="db-submit bl-btn" disabled={busy || !info} onClick={() => setPicker({})}>
        {neuroLines.length ? 'ویرایشِ خدمات و مصرفی‌ها' : 'انتخابِ خدمات و مصرفی‌ها'}
      </button>
    </div>}
    {doubled && (
      <div className="nv-double" role="alert">
        <Alert width="20" height="20" />
        <div>
          <b>این صورت‌حساب هم مبلغِ کلِ ثبت‌نام و هم خدماتِ ریزشده را دارد — احتمالاً دوبار شمرده شده.</b>
          <small>
            {lump.map(c => `${c.title} (${fmtMoney(c.amount)} تومان)`).join('، ')} کنارِ خدماتِ نورو در جمع آمده است.
            اگر همان خدمت است جایگزینش کنید؛ اگر خدمتِ دیگری است، در پنجرهٔ خدمات «کنارش بماند» را بزنید تا این هشدار نیاید.
          </small>
        </div>
        <button type="button" className="bl-mini" disabled={busy} onClick={() => setPicker({ intent: 'replace' })}>جایگزینیِ قلمِ ثبت‌نام</button>
      </div>
    )}
    <p className="db-hint">صدور، نسخه‌ای با شمارهٔ ثابت ثبت می‌کند. صدور مجدد بدون تغییر، همان شماره را برمی‌گرداند؛ پس از تغییر، نسخهٔ جدید جایگزین می‌شود و قبلی در سوابق می‌ماند.</p>
    <button type="button" className="db-submit bl-btn" disabled={busy || !info || !billing.invoiceType || !billing.invoiceBankAccount || !billing.charges.length} onClick={() => print()}>
      صدور و چاپ فاکتور {billing.invoiceType === 'informal' ? 'غیررسمی' : 'رسمی'}
    </button>
    {(!billing.invoiceType || !billing.invoiceBankAccount) && <p className="db-hint">نوع فاکتور و حساب دریافت را بالای همین بخش ثبت کنید.</p>}
    {info?.documents?.length > 0 && <section aria-label="فاکتورهای صادرشده"><h4>سوابق صدور</h4>{info.documents.map(doc => <div key={doc.id} className="bl-issued-row"><span><b dir="ltr">{doc.number}</b> · {faDate(doc.createdAt)} · {doc.supersededAt ? 'نسخهٔ قبلی — جایگزین شده' : 'نسخهٔ جاری'}</span><button type="button" className="bl-mini" disabled={busy} onClick={() => print(doc.id)}>چاپ نسخه</button></div>)}</section>}
    <AnimatePresence>
      {picker && (
        <NeuroInvoiceDialog
          visit={visit} billing={billing} onToast={onToast} intent={picker.intent}
          reload={async () => { await reload(); await refresh().catch(() => {}); }}
          onClose={() => setPicker(null)}
          onIssue={w => print(undefined, w)}
        />
      )}
    </AnimatePresence>
  </section>;
}
