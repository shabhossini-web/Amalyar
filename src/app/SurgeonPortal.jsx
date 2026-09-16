import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiBlobUrl } from '../lib/api.js';
import { faDate } from '../lib/jalali.js';
import { useAuth } from './auth.jsx';
import { useConfig } from './config.jsx';
import RequiredItems from './RequiredItems.jsx';
import AssistedTextarea from '../ui/AssistedTextarea.jsx';
import Tabs from '../ui/Tabs.jsx';
import './surgeon-portal.css';
import './launcher.css';
import './dashboard.css';
import './intake-admin.css'; // پایهٔ db-*/bl-*/ia-* که تا پیش از lazy‌شدنِ مسیرها از باندلِ مشترک می‌آمد

export default function SurgeonPortal() {
  const { user } = useAuth();
  const { verticalLabel } = useConfig();
  const [data, setData] = useState(null), [query, setQuery] = useState(''), [page, setPage] = useState(1), [error, setError] = useState('');
  const [surgeons, setSurgeons] = useState([]), [surgeonId, setSurgeonId] = useState(''), [notice, setNotice] = useState('');
  const [grantBusy, setGrantBusy] = useState(false);
  const [tab, setTab] = useState('visits');
  const requestId = useRef(0);
  const load = useCallback(async () => { const id = ++requestId.current; try { const next = await api(`/surgeon/visits?q=${encodeURIComponent(query)}&page=${page}`); if (id === requestId.current) { setData(next); setError(''); } } catch (e) { if (id === requestId.current) setError(e.message); } }, [query, page]);
  useEffect(() => { const timer = setTimeout(load, 200); return () => { requestId.current++; clearTimeout(timer); }; }, [load]);
  useEffect(() => { if (user?.level >= 6) api('/surgeons').then(setSurgeons).catch(e => setError(e.message)); }, [user?.level]);
  const grant = async () => {
    setGrantBusy(true);
    try { const result = await api(`/surgeon/accounts/${surgeonId}`, { method: 'POST', body: {} });
      setNotice(result.existing ? `حساب جراح موجود است (سطح ${result.level}، وضعیت ${result.status}). وضعیت و سطح از مدیریت کاربران قابل بررسی است.` : 'حساب جراح آماده شد. جراح با شمارهٔ ثبت‌شده، از «ثبت‌نام» و کد پیامکی حسابش را تحویل می‌گیرد؛ نیازی به ساخت هویت تکراری نیست.');
    } catch (e) { setError(e.message); } finally { setGrantBusy(false); }
  };
  return <main className="sp-page">
    <header className="sp-head"><h1>پرتال جراح</h1><Link to="/app">لانچر</Link></header>
    <p>این پرتال برای پزشکان همکار شرکت است: بیماران خود، گزارش عمل، دستور تیم و بیلان سهم و پرداخت خود را اینجا می‌بینید. پزشک صاحب مطب از داشبورد مطب استفاده می‌کند.</p>
    <Tabs value={tab} onChange={setTab} label="بخش‌های پرتال جراح" items={[{ key: 'visits', label: 'بیماران و دستورها' }, { key: 'finances', label: user?.level >= 6 ? 'بیلان جراح' : 'بیلان مالی من' }]} />
    <p>{verticalLabel} · {user?.level >= 6 ? 'نمای مدیر برای بررسی مراجعات جراحان' : 'مراجعات ارجاع‌شده به نام شما، گزارش‌ها و دستورهای تیم جراحی'}</p>
    {user?.level >= 6 && <details className="sp-card"><summary>فعال‌سازی حساب جراح از تعاریف پایه</summary>
      <label className="ia-field"><span>جراح</span><select value={surgeonId} onChange={e => setSurgeonId(e.target.value)}><option value="">انتخاب جراح</option>{surgeons.filter(s => s.active !== false).map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
      <button className="bl-mini" disabled={!surgeonId || grantBusy} type="button" onClick={grant}>آماده‌سازی حساب پرتال</button>
      <Link to="/app/definitions?section=surgeons">تعریف یا اصلاح مشخصات جراح</Link>
      {notice && <p role="status">{notice}</p>}
    </details>}
    {tab === 'finances' ? <SurgeonFinances admin={user?.level >= 6} surgeons={surgeons} /> : <>
    <label className="ia-field"><span>جستجوی بیمار یا کد پرونده</span><input value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label>
    {error && <p className="bl-error" role="alert">{error}</p>}
    {!data && !error && <p>در حال بارگذاری…</p>}
    {data?.rows.length === 0 && <p>مراجعه‌ای برای نمایش نیست. انتساب جراح هر مراجعه از تعاریف پایه بررسی می‌شود.</p>}
    <div className="sp-list">{data?.rows.map(row => <SurgeonCase key={row.id} row={row} implant={data.workflow === 'implant'} reload={load} />)}</div>
    {data && <nav className="sp-pagination" aria-label="صفحه‌های مراجعات"><button className="bl-mini" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>قبلی</button><span>{page} از {data.pages} · {data.total} مراجعه</span><button className="bl-mini" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>بعدی</button></nav>}
    </>}
  </main>;
}

function SurgeonCase({ row, implant, reload }) {
  const [instructions, setInstructions] = useState(row.instructions), [items, setItems] = useState(row.requiredItems), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [itemsDirty, setItemsDirty] = useState(false);
  const save = async () => {
    setBusy(true); setMessage('');
    try { await api(`/surgeon/visits/${row.id}/instructions`, { method: 'PATCH', body: { instructions, ...(implant && itemsDirty ? { requiredItems: items.map(({ itemId, quantity, notes }) => ({ itemId, quantity, notes: notes || '' })) } : {}) } }); setItemsDirty(false); await reload(); setMessage('دستور و نیازهای بیمار ثبت شد و در آماده‌سازی تیم دیده می‌شود'); }
    catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  const document = async doc => {
    const w = window.open('', '_blank'); if (!w) { setMessage('اجازهٔ بازشدن پنجرهٔ مدرک را بدهید'); return; }
    try { const url = await apiBlobUrl(`/surgeon/visits/${row.id}/documents/${doc.id}`); w.location.href = url; setTimeout(() => URL.revokeObjectURL(url), 60000); }
    catch (e) { w.close(); setMessage(e.message); }
  };
  return <article className="sp-card glass">
    <h2>{row.fullName}</h2><span>{row.code} · {faDate(row.opDate)} · {row.hospital || 'مرکز تعیین نشده'}</span>
    <span>{row.procedure || 'عمل تعیین نشده'} · {({ pending: 'در انتظار عمل', done: 'انجام‌شده', cancelled: 'لغوشده' })[row.opStatus] || row.opStatus}</span>
    {row.report && <details><summary>گزارش ثبت‌شدهٔ عمل</summary><div className="sp-report">{row.report}</div></details>}
    {row.documents?.map(doc => <button className="bl-mini" type="button" key={doc.id} onClick={() => document(doc)}>{doc.title || doc.fileName}</button>)}
    <details><summary>دستور جراح و آماده‌سازی بیمار</summary>
      <label className="ia-field"><span>دستور و توضیحات جراح</span><AssistedTextarea purpose="دستور و توضیحات جراح" rows={4} value={instructions} onChange={e => setInstructions(e.target.value)} disabled={busy} /></label>
      {implant && <RequiredItems endpoint="/surgeon/items" value={items} onChange={next => { setItems(next); setItemsDirty(true); }} disabled={busy} />}
      <button className="db-submit bl-btn" type="button" disabled={busy} onClick={save}>ثبت دستور</button>
    </details>
    {message && <p role="status">{message}</p>}
  </article>;
}

function SurgeonFinances({ admin, surgeons }) {
  const [id, setId] = useState(''), [page, setPage] = useState(1), [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => { let alive = true; setData(null); setError(''); if (admin && !id) return;
    api(`/surgeon/finances?surgeonId=${id}&page=${page}`).then(d => { if (alive) setData(d); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [admin, id, page]);
  const money = n => Number(n ?? 0).toLocaleString('fa-IR');
  return <section className="sp-list">
    {admin && <label className="ia-field"><span>بیلان کدام جراح؟</span><select value={id} onChange={e => { setId(e.target.value); setPage(1); }}><option value="">انتخاب جراح</option>{surgeons.filter(s => s.active !== false).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
    <p>همه مبالغ تومان است. سهم فقط از تسویه نهایی محاسبه می‌شود. پرداخت‌ها، ثبت‌های مالی شرکت هستند؛ ثبت چک به معنی وصول آن نیست. پرونده بدون تسویه نهایی، سهم قطعی ندارد.</p>
    {error && <p role="alert">{error}</p>}
    {!data && !error && (!admin || id) && <p>در حال دریافت بیلان…</p>}
    {data && !data.selectionRequired && <><article className="sp-card"><h2>{data.surgeon}</h2><p>سهم نهایی: {money(data.earned)} · پرداخت ثبت‌شده: {money(data.paid)} · مانده: {money(data.balance)}</p></article>
      {data.rows.length === 0 && <p>مراجعه‌ای ثبت نشده است.</p>}
      {data.rows.map(r => <article className="sp-card" key={r.id}><h2>{r.patient}</h2><span>{r.code} · {faDate(r.date)} · {r.hospital}</span>
        <p>{r.finalized ? `سهم نهایی: ${money(r.earned)}` : 'در انتظار تسویه نهایی'} · پرداخت: {money(r.paid)}{r.finalized ? ` · مانده: ${money(r.balance)}` : ''}</p>
        {r.payments.length > 0 && <details><summary>پرداخت‌های این مراجعه</summary>{r.payments.map(p => <p key={p.id}>{faDate(p.paidAt)} · {money(p.amount)} تومان {p.reference ? `· پیگیری ${p.reference}` : ''}</p>)}</details>}
      </article>)}
      <nav className="sp-pagination" aria-label="صفحه‌های بیلان"><button className="bl-mini" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>قبلی</button><span>{page} از {data.pages}</span><button className="bl-mini" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>بعدی</button></nav>
    </>}
  </section>;
}
