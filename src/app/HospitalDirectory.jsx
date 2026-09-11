import { useEffect, useRef, useState } from 'react';
import './hospital-directory.css';
import { api } from '../lib/api.js';
const sectors = { private: 'خصوصی', public: 'دولتی', nonprofit: 'عمومی غیردولتی', charity: 'خیریه', military: 'نیروهای مسلح' };
const blank = { name: '', province: 'تهران', city: 'تهران', phone: '', address: '', sector: '', website: '', sourceUrl: '', sourceName: '', verified: false, active: true };
export default function HospitalDirectory({ platformApi, onChanged = () => {} }) {
  const central = !!platformApi;
  const [data, setData] = useState(null), [q, setQ] = useState(''), [province, setProvince] = useState('تهران'), [city, setCity] = useState(''), [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [selected, setSelected] = useState([]), [sector, setSector] = useState('');
  const [form, setForm] = useState(null), [links, setLinks] = useState({});
  const requestVersion = useRef(0);
  const [filterSector, setFilterSector] = useState('');
  const load = async (valid = () => true) => {
    const version = ++requestVersion.current;
    const qs = new URLSearchParams({ q, province, city, sector: filterSector, page: String(page), ...(central ? { all: '1' } : {}) });
    const r = central ? await platformApi(`/hospitals?${qs}`) : await api(`/hospitals/directory?${qs}`);
    if (valid() && version === requestVersion.current) { setData(r); setSelected([]); setError(''); }
  };
  useEffect(() => { let alive = true; const t = setTimeout(() => { load(() => alive).catch(e => { if (alive) setError(e.message); }); }, 250); return () => { alive = false; clearTimeout(t); }; }, [q, province, city, page, central, filterSector]);
  const run = async fn => { if (busy) return; setBusy(true); setError(''); setMessage(''); try { await fn(); await load(); await onChanged(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const importRows = (ids, localId, fillMissing = false) => run(async () => {
    const result = await api('/hospitals/directory/import', { method: 'POST', body: { ids, ...(sector ? { sector } : {}), ...(localId ? { localId: Number(localId) } : {}), fillMissing } });
    setMessage(`${result.created} افزوده شد؛ ${result.linked} مورد متصل بود یا متصل شد. ${result.pending ? `${result.pending} مورد نیاز به تعیین نوع تعرفه یا اتصال به تعریف موجود دارد.` : ''}`);
  });
  const save = event => { event.preventDefault(); run(async () => { await platformApi('/hospitals', { method: 'POST', csrf: true, body: form }); setForm(null); setMessage('اطلاعات مرکزی ذخیره شد؛ ویرایش‌های شرکت‌ها حفظ می‌شود.'); }); };
  return <section className={central ? 'pa-card pa-jobs' : 'df-directory'} dir="rtl">
    <h2>فهرست مرکزی بیمارستان‌ها</h2>
    <p>جستجو بر اساس نام، استان، شهر و نشانی. اطلاعات هر شرکت پس از دریافت، مستقل قابل تکمیل و ویرایش است.</p>
    {data?.coverage && <p>{data.coverage.total} بیمارستان در فهرست؛ {data.coverage.verified} مورد با اطلاعات تماس بررسی‌شده. پوشش فهرست در حال تکمیل است.</p>}
    <div className="df-directory-tools">
      <label>نام یا نشانی<input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} /></label>
      <label>استان<select aria-label="استان" value={province} onChange={e => { setProvince(e.target.value); setPage(1); }}><option value="">همه استان‌ها</option>{!data?.provinces?.some(p => p.name === 'تهران') && <option value="تهران">تهران</option>}{data?.provinces?.filter(p => p.name).map(p => <option key={p.name}>{p.name}</option>)}</select></label>
      <label>شهر<input value={city} onChange={e => { setCity(e.target.value); setPage(1); }} placeholder="همه شهرها" /></label>
      <label>فیلتر نوع بیمارستان<select aria-label="فیلتر نوع بیمارستان" value={filterSector} onChange={e => { setFilterSector(e.target.value); setPage(1); }}><option value="">همه انواع</option>{Object.entries(sectors).map(([k,v]) => <option key={k} value={k}>{v}</option>)}<option value="unknown">نوع نامشخص</option></select></label>
      {central ? <button type="button" disabled={busy} onClick={() => setForm({ ...blank })}>افزودن بیمارستان مرکزی</button> : <><label>تعرفه موارد بدون نوع<select value={sector} onChange={e => setSector(e.target.value)}><option value="">انتخاب کنید</option>{Object.entries(sectors).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label><button disabled={busy || !selected.length} onClick={() => importRows(selected)}>دریافت انتخاب‌شده‌ها ({selected.length})</button></>}
    </div>
    {form && central && <form className="df-directory-form" onSubmit={save}>
      <h3>{form.id ? 'ویرایش بیمارستان مرکزی' : 'بیمارستان جدید'}</h3>
      {['name', 'province', 'city', 'phone', 'address', 'website', 'sourceUrl', 'sourceName'].map((key,i) => <label key={key}>{['نام', 'استان', 'شهر', 'تلفن', 'آدرس', 'وب‌سایت', 'لینک منبع', 'نام منبع'][i]}<input value={form[key] || ''} required={key === 'name'} maxLength={key === 'address' ? 600 : ['website','sourceUrl'].includes(key) ? 500 : 180} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} /></label>)}
      <label>نوع بیمارستان<select value={form.sector || ''} onChange={e => setForm(f => ({ ...f, sector: e.target.value }))}><option value="">نیازمند بررسی</option>{Object.entries(sectors).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label><input type="checkbox" checked={!!form.verified} onChange={e => setForm(f => ({ ...f, verified: e.target.checked }))} /> اطلاعات تماس با منبع بررسی شده</label>
      <label><input type="checkbox" checked={!!form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} /> قابل دریافت برای شرکت‌ها</label>
      <button disabled={busy}>ذخیره بیمارستان مرکزی</button><button type="button" disabled={busy} onClick={() => setForm(null)}>انصراف</button>
    </form>}
    {!central && <button className="df-directory-select" disabled={busy || !data?.rows?.some(h => !h.localId && !h.candidates?.length)} onClick={() => setSelected(data.rows.filter(h => !h.localId && !h.candidates?.length).map(h => h.id))}>انتخاب موارد جدید این صفحه</button>}
    {!central && <p>مورد مشابه به‌صورت خودکار ادغام نمی‌شود؛ تعریف موجود را انتخاب و متصل کنید. «تکمیل فیلدهای خالی» فقط استان، شهر، تلفن و آدرس خالی را پر می‌کند.</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="df-directory-list">
      {data?.rows?.map(h => <article key={h.id} className="df-directory-row">
        <div><b>{h.name}</b><small>{[h.province, h.city, sectors[h.sector] || 'نوع تعرفه نیازمند بررسی'].filter(Boolean).join(' · ')}</small></div>
        <p>{h.address || 'آدرس نیازمند تکمیل'}</p><p dir="ltr">{h.phone || 'تلفن نیازمند تکمیل'}</p>
        <small>{h.checkedAt && `بررسی منبع: ${new Date(h.checkedAt).toLocaleDateString('fa-IR')} · `}{h.verified ? 'اطلاعات تماس بررسی‌شده' : 'نیازمند بررسی اطلاعات تماس'}{!h.active ? ' · غیرفعال در فهرست مرکزی' : ''}</small>
        {h.sourceUrl && <a href={h.sourceUrl} target="_blank" rel="noreferrer">منبع: {h.sourceName || 'مشاهده'}</a>}
        {central ? <button disabled={busy} onClick={() => setForm({ ...h })}>ویرایش {h.name}</button> : h.localId ? <><span>در تعاریف شرکت ثبت شده</span><button disabled={busy} onClick={() => importRows([h.id], null, true)}>تکمیل فیلدهای خالی {h.name}</button></> : h.candidates?.length ? <><label>تعریف موجود برای {h.name}<select value={links[h.id] || ''} onChange={e => setLinks(l => ({ ...l, [h.id]: e.target.value }))}><option value="">انتخاب کنید</option>{h.candidates.map(c => <option key={c.id} value={c.id}>{c.name} {c.city}</option>)}</select></label><button disabled={busy || !links[h.id]} onClick={() => importRows([h.id], links[h.id])}>اتصال به تعریف موجود</button></> : <label><input type="checkbox" checked={selected.includes(h.id)} disabled={busy} onChange={e => setSelected(a => e.target.checked ? [...a, h.id] : a.filter(id => id !== h.id))} /> دریافت {h.name}</label>}
      </article>)}
      {data && !data.rows?.length && <p>موردی پیدا نشد؛ فیلترها را تغییر دهید.</p>}
    </div>
    <div className="df-directory-tools"><button disabled={busy || page <= 1} onClick={() => setPage(p => p - 1)}>صفحه قبل</button><span>صفحه {data?.page || page} از {data?.pages || 1} · {data?.total || 0} نتیجه</span><button disabled={busy || page >= (data?.pages || 1)} onClick={() => setPage(p => p + 1)}>صفحه بعد</button></div>
  </section>;
}
