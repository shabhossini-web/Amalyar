import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { faDate, jStrToIso, todayJStr, toEnDigits } from '../lib/jalali.js';
import JDate from './JDate.jsx';
import './accounting.css';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Back = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M9 6l6 6-6 6" /></svg>);
const Plus = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M12 5v14M5 12h14" /></svg>);

const num = (n) => Number(n ?? 0).toLocaleString('fa-IR');
const parseNum = (v) => {
  const d = toEnDigits(String(v ?? '')).replace(/[^0-9]/g, '');
  return d ? Number(d) : 0;
};

/**
 * حسابداری — قراردادِ جراح و سهامداران.
 *
 * تسویهٔ هر مراجعه عمداً این‌جا نیست: آن‌جا که پولِ یک بیمار است، یعنی داخلِ
 * صورت‌حسابِ همان مراجعه. این صفحه فقط **قواعد** را نگه می‌دارد.
 */
export default function Accounting() {
  const [tab, setTab] = useState('contracts');
  const [toast, setToast] = useState('');

  useEffect(() => { document.title = 'عمل‌یار — حسابداری'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="ac">
      <div className="ac-bg" aria-hidden="true" />
      <header className="ac-head">
        <Link to="/app" className="ac-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1>حسابداری</h1>
          <p>قاعده‌ها این‌جا تعریف می‌شوند؛ تقسیمِ سهمِ هر عمل در صورت‌حسابِ همان مراجعه است.</p>
        </div>
      </header>

      <div className="ac-tabs">
        <button type="button" className={tab === 'contracts' ? 'on' : ''} onClick={() => setTab('contracts')}>قراردادِ جراحان</button>
        <button type="button" className={tab === 'partners' ? 'on' : ''} onClick={() => setTab('partners')}>سهامداران</button>
      </div>

      {tab === 'contracts' ? <Contracts onToast={setToast} /> : <Partners onToast={setToast} />}
      {toast && <div className="ac-toast" role="status">{toast}</div>}
    </div>
  );
}

/**
 * قراردادها.
 *
 * ⚠️ ردیفِ قدیمی ویرایش نمی‌شود؛ قراردادِ تازه با تاریخِ شروعِ تازه اضافه می‌شود.
 * دلیلش روی خودِ صفحه نوشته شده، وگرنه کاربر دنبالِ دکمهٔ «ویرایش» می‌گردد و
 * نبودنش را نقص می‌بیند نه تصمیم.
 */
function Contracts({ onToast }) {
  const [rows, setRows] = useState([]);
  const [surgeons, setSurgeons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ surgeonId: '', kind: 'percent', percent: '', amount: '', fromJ: todayJStr(), notes: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, s] = await Promise.all([api('/contracts'), api('/surgeons')]);
      setRows(c);
      setSurgeons(s.filter((x) => x.active !== false));
    } catch (e) { onToast(e.message); }
    finally { setLoading(false); }
  }, [onToast]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!f.surgeonId) { onToast('جراح را انتخاب کنید'); return; }
    const effectiveFrom = f.fromJ.trim() ? jStrToIso(f.fromJ) : undefined;
    if (f.fromJ.trim() && !effectiveFrom) { onToast('تاریخِ شروع نامعتبر است (مثال: ۱۴۰۵/۰۵/۰۹)'); return; }
    setBusy(true);
    try {
      await api('/contracts', {
        method: 'POST',
        body: {
          surgeonId: Number(f.surgeonId), kind: f.kind,
          ...(f.kind === 'percent' ? { percent: parseNum(f.percent) } : { amount: parseNum(f.amount) }),
          effectiveFrom, notes: f.notes.trim() || undefined,
        },
      });
      setF((s) => ({ ...s, percent: '', amount: '', notes: '' }));
      await load();
      onToast('قرارداد ثبت شد ✓');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  const drop = async (id) => {
    setBusy(true);
    try { await api(`/contracts/${id}`, { method: 'DELETE' }); await load(); onToast('قرارداد غیرفعال شد'); }
    catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="ac-add">
        <div className="ac-grid">
          <label className="ac-field"><span>جراح *</span>
            <select value={f.surgeonId} onChange={(e) => setF((s) => ({ ...s, surgeonId: e.target.value }))}>
              <option value="">— انتخاب —</option>
              {surgeons.map((s) => <option key={s.id} value={s.id}>{s.name ?? `${s.firstName} ${s.lastName}`}</option>)}
            </select>
          </label>
          <label className="ac-field"><span>نوع</span>
            <select value={f.kind} onChange={(e) => setF((s) => ({ ...s, kind: e.target.value }))}>
              <option value="percent">درصدی از فاکتور</option>
              <option value="fixed">مبلغِ ثابت</option>
            </select>
          </label>
          {f.kind === 'percent' ? (
            <label className="ac-field"><span>درصد</span>
              <input dir="ltr" inputMode="numeric" value={f.percent} onChange={(e) => setF((s) => ({ ...s, percent: e.target.value }))} placeholder="۳۰" />
            </label>
          ) : (
            <label className="ac-field"><span>مبلغ (تومان)</span>
              <input dir="ltr" inputMode="numeric" value={f.amount} onChange={(e) => setF((s) => ({ ...s, amount: e.target.value }))} placeholder="۰" />
            </label>
          )}
          <JDate label="معتبر از تاریخ" value={f.fromJ} onChange={(v) => setF((s) => ({ ...s, fromJ: v }))} />
        </div>
        <p className="ac-hint">
          قرارداد <b>تاریخ‌دار</b> است و ویرایش نمی‌شود: عملِ پارسال باید با قراردادِ پارسال حساب شود.
          برای تغییرِ شرایط، قراردادِ تازه با تاریخِ شروعِ تازه اضافه کنید.
        </p>
        <button type="button" className="ac-submit" onClick={submit} disabled={busy}>
          <Plus width="15" height="15" /> ثبتِ قرارداد
        </button>
      </div>

      <div className="ac-list">
        {loading && <div className="ac-empty">در حال بارگذاری…</div>}
        {!loading && rows.length === 0 && <div className="ac-empty">هنوز قراردادی ثبت نشده</div>}
        {!loading && rows.map((r) => (
          <article key={r.id} className={`ac-row${r.active ? '' : ' off'}`}>
            <div className="ac-val">
              <b>{r.kind === 'percent' ? `${num(r.percent)}٪` : num(r.amount)}</b>
              <span>{r.kind === 'percent' ? 'از فاکتور' : 'تومان'}</span>
            </div>
            <div className="ac-row-main">
              <b>{r.surgeonName}</b>
              <small>معتبر از {faDate(r.effectiveFrom)}{r.active ? '' : ' · غیرفعال'}</small>
              {r.notes && <small className="ac-note">{r.notes}</small>}
            </div>
            {r.active && (
              <button type="button" className="ac-off" disabled={busy} onClick={() => drop(r.id)}>غیرفعال</button>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

/**
 * سهامداران.
 *
 * فهرست یک‌جا ذخیره می‌شود چون شرطِ «جمعاً ۱۰۰٪» فقط روی کلِ فهرست معنا دارد؛
 * با ذخیرهٔ تکی، سامانه بینِ دو ذخیره در حالتِ نامعتبر می‌ماند.
 */
function Partners({ onToast }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await api('/partners');
      const active = all.filter((p) => p.active);
      setRows(active.length ? active.map((p) => ({ name: p.name, percent: String(p.percent), color: p.color ?? '' })) : [{ name: '', percent: '', color: '' }]);
    } catch (e) { onToast(e.message); }
    finally { setLoading(false); }
  }, [onToast]);
  useEffect(() => { load(); }, [load]);

  const total = rows.reduce((s, r) => s + parseNum(r.percent), 0);

  const save = async () => {
    setBusy(true);
    try {
      await api('/partners', {
        method: 'POST',
        body: { partners: rows.map((r) => ({ name: r.name.trim(), percent: parseNum(r.percent), color: r.color.trim() || undefined })) },
      });
      await load();
      onToast('سهامداران ذخیره شدند ✓');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  if (loading) return <div className="ac-empty">در حال بارگذاری…</div>;

  return (
    <div className="ac-add">
      {rows.map((r, i) => (
        <div key={i} className="ac-prow">
          <input className="ac-pname" value={r.name} placeholder="نامِ سهامدار"
                 onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input className="ac-ppct" dir="ltr" inputMode="numeric" value={r.percent} placeholder="۵۰"
                 onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} />
          <span className="ac-pc">٪</span>
          <input className="ac-pcolor" type="color" value={r.color || '#7c3aed'}
                 onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
          <button type="button" className="ac-prm" disabled={rows.length === 1}
                  onClick={() => setRows((s) => s.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="ac-padd" onClick={() => setRows((s) => [...s, { name: '', percent: '', color: '' }])}>
        <Plus width="14" height="14" /> سهامدارِ دیگر
      </button>

      <p className={`ac-total${total === 100 ? ' ok' : ''}`}>
        جمعِ درصدها: {num(total)}٪ {total === 100 ? '✓' : '— باید دقیقاً ۱۰۰ شود'}
      </p>
      <button type="button" className="ac-submit" onClick={save} disabled={busy || total !== 100}>ذخیرهٔ سهامداران</button>
    </div>
  );
}
