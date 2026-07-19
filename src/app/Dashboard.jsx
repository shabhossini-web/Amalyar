import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { api } from '../lib/api.js';
import { faDate, isoToJStr, jStrToIso, todayJStr } from '../lib/jalali.js';
import { fmtMoney, group3, numToWordsFa, parseMoney } from '../lib/money.js';
import ProfileMenu from './ProfileMenu.jsx';
import './launcher.css';
import './users.css';
import './dashboard.css';

/* ── آیکون‌های خطی ── */
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Back = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5v6" /></svg>);
const Plus = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M12 5v14M5 12h14" /></svg>);
const SearchIc = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>);
const Pencil = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></svg>);
const Trash = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>);
const XIc = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>);
const Doctor = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M9 3v5a3 3 0 0 0 6 0V3" /><path d="M12 11v3a4 4 0 0 1-8 0v-1" /><circle cx="4" cy="11" r="2" /><circle cx="19" cy="16" r="3" /><path d="M19 19v2" /></svg>);
const Hospital = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M3 21V8l9-5 9 5v13" /><path d="M3 21h18" /><path d="M12 9v6M9 12h6" /></svg>);
const CalIc = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>);

const STATUS_FA = { pending: 'در انتظار عمل', done: 'تمام‌شده', cancelled: 'کنسل' };
const FILTERS = [
  { v: 'all', l: 'همه' },
  { v: 'pending', l: 'در انتظار' },
  { v: 'done', l: 'تمام‌شده' },
  { v: 'cancelled', l: 'کنسل' },
];

/* اسپاتلایتِ شیشه */
function track(e) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
}

/* ── باکسِ مبلغ: گروه‌بندی در blur (باگِ Gboard)، به‌حروف زنده ── */
function MoneyInput({ label, value, onChange }) {
  const [focus, setFocus] = useState(false);
  const shown = focus ? value : group3(value);
  const n = parseMoney(value);
  return (
    <label className="db-field">
      <span>{label} <small>(تومان)</small></span>
      <input
        type="text"
        inputMode="numeric"
        dir="ltr"
        value={shown}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onChange={(e) => onChange(String(parseMoney(e.target.value) || ''))}
        placeholder="0"
      />
      <em className="db-words">{n ? `${numToWordsFa(n)} تومان` : ' '}</em>
    </label>
  );
}

/* ── فرمِ ثبت/ویرایشِ مراجعه (مودالِ شیشه‌ای) ── */
function VisitForm({ initial, onClose, onSaved, onToast }) {
  const editing = !!initial?.id;
  const [mode, setMode] = useState('new'); // new | existing (فقط در حالتِ افزودن)
  const [pQuery, setPQuery] = useState('');
  const [pResults, setPResults] = useState([]);
  const [picked, setPicked] = useState(null); // بیمارِ موجودِ انتخاب‌شده

  const [f, setF] = useState(() => ({
    firstName: initial?.firstName || '',
    lastName: initial?.lastName || '',
    phone: initial?.phone || '',
    nationalId: initial?.nationalId || '',
    surgeonName: initial?.surgeonName || '',
    hospitalName: initial?.hospitalName || '',
    opDateJ: initial?.opDate ? isoToJStr(initial.opDate) : '',
    amount: initial?.amount ? String(initial.amount) : '',
    paid: initial?.paid ? String(initial.paid) : '',
    notes: initial?.notes || '',
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  // جستجوی بیمارِ موجود (debounce)
  useEffect(() => {
    if (mode !== 'existing') return undefined;
    const t = setTimeout(() => {
      api(`/patients?q=${encodeURIComponent(pQuery)}`)
        .then(setPResults)
        .catch(() => setPResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [pQuery, mode]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    let opDate;
    if (f.opDateJ.trim()) {
      opDate = jStrToIso(f.opDateJ);
      if (!opDate) { onToast('تاریخِ عمل نامعتبر است (مثال: ۱۴۰۵/۰۴/۲۸)'); return; }
    }
    const common = {
      surgeonName: f.surgeonName.trim() || undefined,
      hospitalName: f.hospitalName.trim() || undefined,
      opDate,
      amount: parseMoney(f.amount),
      paid: parseMoney(f.paid),
      notes: f.notes.trim() || undefined,
    };
    setBusy(true);
    try {
      let saved;
      if (editing) {
        saved = await api(`/visits/${initial.id}`, {
          method: 'PATCH',
          body: {
            ...common,
            opDate: opDate ?? null,
            firstName: f.firstName.trim(),
            lastName: f.lastName.trim(),
            phone: f.phone.trim(),
            nationalId: f.nationalId.trim(),
          },
        });
      } else if (mode === 'existing') {
        if (!picked) { onToast('یک بیمار را از فهرست انتخاب کنید'); setBusy(false); return; }
        saved = await api('/visits', { method: 'POST', body: { ...common, patientId: picked.id } });
      } else {
        saved = await api('/visits', {
          method: 'POST',
          body: {
            ...common,
            firstName: f.firstName.trim(),
            lastName: f.lastName.trim(),
            phone: f.phone.trim() || undefined,
            nationalId: f.nationalId.trim() || undefined,
          },
        });
      }
      onSaved(saved, editing);
    } catch (err) {
      onToast(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="db-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="glass db-sheet" onSubmit={submit}>
        <header className="db-sheet-head">
          <b>{editing ? `ویرایشِ مراجعه ${initial.code}` : 'ثبتِ مراجعهٔ جدید'}</b>
          <button type="button" className="db-x" onClick={onClose} aria-label="بستن"><XIc width="18" height="18" /></button>
        </header>

        {!editing && (
          <div className="lg-tabs db-modetabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'new'} className={mode === 'new' ? 'on' : ''} onClick={() => setMode('new')}>بیمارِ جدید</button>
            <button type="button" role="tab" aria-selected={mode === 'existing'} className={mode === 'existing' ? 'on' : ''} onClick={() => { setMode('existing'); setPicked(null); }}>بیمارِ موجود</button>
          </div>
        )}

        {(!editing && mode === 'existing') ? (
          <div className="db-psearch">
            {picked ? (
              <div className="db-picked">
                <b>{picked.fullName}</b>
                <span dir="ltr">{picked.code}</span>
                <button type="button" onClick={() => setPicked(null)}>تغییر</button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={pQuery}
                  onChange={(e) => setPQuery(e.target.value)}
                  placeholder="جستجوی نام / کد / موبایل…"
                  autoFocus
                />
                <div className="db-plist">
                  {pResults.map((p) => (
                    <button type="button" key={p.id} onClick={() => setPicked(p)}>
                      <b>{p.fullName}</b>
                      <span dir="ltr">{p.code}</span>
                      <small>{p.visitCount} مراجعه</small>
                    </button>
                  ))}
                  {pResults.length === 0 && <div className="db-pnone">بیماری پیدا نشد</div>}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="db-grid2">
            <label className="db-field"><span>نام</span>
              <input type="text" value={f.firstName} onChange={set('firstName')} required minLength={2} />
            </label>
            <label className="db-field"><span>نام خانوادگی</span>
              <input type="text" value={f.lastName} onChange={set('lastName')} required minLength={2} />
            </label>
            <label className="db-field"><span>موبایل</span>
              <input type="tel" dir="ltr" inputMode="numeric" value={f.phone} onChange={set('phone')} placeholder="09xxxxxxxxx" />
            </label>
            <label className="db-field"><span>کد ملی</span>
              <input type="text" dir="ltr" inputMode="numeric" value={f.nationalId} onChange={set('nationalId')} placeholder="اختیاری" />
            </label>
          </div>
        )}

        <div className="db-grid2">
          <label className="db-field"><span>جراح</span>
            <input type="text" value={f.surgeonName} onChange={set('surgeonName')} placeholder="دکتر …" />
          </label>
          <label className="db-field"><span>بیمارستان</span>
            <input type="text" value={f.hospitalName} onChange={set('hospitalName')} />
          </label>
        </div>

        <label className="db-field">
          <span>تاریخِ عمل (شمسی)</span>
          <div className="db-daterow">
            <input type="text" dir="ltr" inputMode="numeric" value={f.opDateJ} onChange={set('opDateJ')} placeholder="۱۴۰۵/۰۴/۲۸" />
            <button type="button" className="db-today" onClick={() => setF((s) => ({ ...s, opDateJ: todayJStr() }))}>امروز</button>
          </div>
        </label>

        <div className="db-grid2">
          <MoneyInput label="مبلغ" value={f.amount} onChange={(v) => setF((s) => ({ ...s, amount: v }))} />
          <MoneyInput label="پرداختی" value={f.paid} onChange={(v) => setF((s) => ({ ...s, paid: v }))} />
        </div>

        <label className="db-field"><span>یادداشت</span>
          <textarea rows={2} value={f.notes} onChange={set('notes')} />
        </label>

        <button className="db-submit" type="submit" disabled={busy}>
          {busy ? 'در حال ذخیره…' : editing ? 'ذخیرهٔ تغییرات' : 'ثبتِ مراجعه'}
        </button>
      </form>
    </div>
  );
}

/* ── کارتِ مراجعه ── */
function VisitCard({ v, busy, onEdit, onStatus, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => {
    if (!confirmDel) return undefined;
    const t = setTimeout(() => setConfirmDel(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDel]);

  return (
    <div className="glass us-card db-card" onMouseMove={track}>
      <span className="glass-glow" aria-hidden="true" />
      <div className="us-row">
        <div className="us-meta">
          <b>{v.fullName}</b>
          <span>{v.code}</span>
        </div>
        <span className={`us-status db-st-${v.opStatus}`}>{STATUS_FA[v.opStatus]}</span>
      </div>

      <div className="db-facts">
        {v.surgeonName && <span><Doctor width="14" height="14" /> {v.surgeonName}</span>}
        {v.hospitalName && <span><Hospital width="14" height="14" /> {v.hospitalName}</span>}
        {v.opDate && <span><CalIc width="14" height="14" /> {faDate(v.opDate)}</span>}
      </div>

      <div className="db-money">
        <span>مبلغ <b>{fmtMoney(v.amount)}</b></span>
        <span>پرداختی <b className="ok">{fmtMoney(v.paid)}</b></span>
        <span>مانده <b className={v.due > 0 ? 'due' : 'ok'}>{fmtMoney(v.due)}</b></span>
      </div>

      <div className="db-actions">
        <div className="db-statuspick" role="group" aria-label="تغییر وضعیت">
          {Object.entries(STATUS_FA).map(([k, l]) => (
            <button
              key={k}
              type="button"
              className={v.opStatus === k ? `on db-st-${k}` : ''}
              disabled={busy || v.opStatus === k}
              onClick={() => onStatus(v, k)}
            >
              {l}
            </button>
          ))}
        </div>
        <button type="button" className="db-ico" title="ویرایش" onClick={() => onEdit(v)} disabled={busy}><Pencil width="15" height="15" /></button>
        <button
          type="button"
          className={`db-ico del${confirmDel ? ' arm' : ''}`}
          title={confirmDel ? 'برای حذفِ قطعی دوباره بزنید' : 'حذف'}
          disabled={busy}
          onClick={() => (confirmDel ? onDelete(v) : setConfirmDel(true))}
        >
          {confirmDel ? 'حذف؟' : <Trash width="15" height="15" />}
        </button>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [visits, setVisits] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [modal, setModal] = useState(null); // null | {} | {visit}
  const [busyId, setBusyId] = useState(0);
  const [toast, setToast] = useState('');
  const [denied, setDenied] = useState(false);
  const qRef = useRef(q);
  qRef.current = q;

  useEffect(() => { document.title = 'عمل‌یار — داشبورد مدیریت'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback((query, st) => {
    const params = new URLSearchParams();
    if (query?.trim()) params.set('q', query.trim());
    if (st && st !== 'all') params.set('status', st);
    return api(`/visits?${params}`)
      .then((rows) => { setDenied(false); setVisits(rows); })
      .catch((e) => {
        setVisits([]);
        if (e.status === 403) setDenied(true);
        else setToast(e.message);
      });
  }, []);

  // بارِ اول + سرچِ زنده (debounce) + فیلترِ وضعیت.
  // ⚠️ user.id هم جزو وابستگی‌هاست: بعد از سوییچِ حساب، دسترسی/داده با حسابِ جدید
  // دوباره از سرور خوانده می‌شود (باگِ واقعی: دادهٔ حسابِ قبلی تا رفرش می‌ماند)
  useEffect(() => {
    setDenied(false);
    const t = setTimeout(() => load(q, status), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, status, load, user?.id]);

  // سوییچِ حساب وسطِ فرمِ باز → فرم بسته شود (با حسابِ جدید معنایی ندارد)
  useEffect(() => { setModal(null); }, [user?.id]);

  const stats = useMemo(() => {
    const rows = visits || [];
    return {
      total: rows.length,
      pending: rows.filter((v) => v.opStatus === 'pending').length,
      due: rows.reduce((s, v) => s + (v.opStatus === 'cancelled' ? 0 : v.due), 0),
    };
  }, [visits]);

  const onSaved = (saved, wasEdit) => {
    setModal(null);
    setToast(wasEdit ? 'مراجعه ویرایش شد ✓' : `مراجعهٔ ${saved.code} ثبت شد ✓`);
    load(qRef.current, status);
  };

  const onStatus = async (v, st) => {
    setBusyId(v.id);
    try {
      const fresh = await api(`/visits/${v.id}/status`, { method: 'PATCH', body: { opStatus: st } });
      setVisits((rows) => rows.map((r) => (r.id === v.id ? fresh : r)));
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusyId(0);
    }
  };

  const onDelete = async (v) => {
    setBusyId(v.id);
    try {
      await api(`/visits/${v.id}`, { method: 'DELETE' });
      setVisits((rows) => rows.filter((r) => r.id !== v.id));
      setToast('مراجعه حذف شد');
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusyId(0);
    }
  };

  return (
    <div className="lx">
      <div className="lx-bg" aria-hidden="true" />
      <div className="lx-grid" aria-hidden="true" />
      <div className="lx-shell us-shell db-shell">
        <header className="us-head">
          <Link to="/app" className="lx-back" aria-label="بازگشت به لانچر"><Back width="15" height="15" /> لانچر</Link>
          <h1>داشبورد مدیریت</h1>
          <div className="us-head-left"><ProfileMenu onToast={setToast} /></div>
        </header>

        {!denied && (<>
        <div className="db-stats">
          <div className="glass db-stat"><b>{fmtMoney(stats.total)}</b><span>مراجعه</span></div>
          <div className="glass db-stat"><b>{fmtMoney(stats.pending)}</b><span>در انتظار عمل</span></div>
          <div className="glass db-stat db-stat-due"><b>{fmtMoney(stats.due)}</b><span>ماندهٔ کل (تومان)</span></div>
        </div>

        <div className="db-toolbar">
          <div className="db-search">
            <SearchIc width="16" height="16" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="جستجوی بیمار، جراح، بیمارستان…"
              aria-label="جستجو"
            />
          </div>
          <button type="button" className="db-add" onClick={() => setModal({})}>
            <Plus width="17" height="17" /> مراجعهٔ جدید
          </button>
        </div>

        <div className="lg-tabs db-filters" role="tablist">
          {FILTERS.map((fl) => (
            <button key={fl.v} type="button" role="tab" aria-selected={status === fl.v} className={status === fl.v ? 'on' : ''} onClick={() => setStatus(fl.v)}>
              {fl.l}
            </button>
          ))}
        </div>
        </>)}

        <div className="us-list">
          {!denied && visits === null && <div className="us-empty">در حال بارگذاری…</div>}
          {denied && <div className="us-empty">دسترسیِ کافی برای این بخش ندارید — مدیرِ سامانه باید سطحِ شما را ارتقا دهد.</div>}
          {!denied && visits?.length === 0 && (
            <div className="us-empty">{q || status !== 'all' ? 'موردی مطابقِ جستجو پیدا نشد' : 'هنوز مراجعه‌ای ثبت نشده — اولین را ثبت کن'}</div>
          )}
          {visits?.map((v) => (
            <VisitCard
              key={v.id}
              v={v}
              busy={busyId === v.id}
              onEdit={(vv) => setModal({ visit: vv })}
              onStatus={onStatus}
              onDelete={onDelete}
            />
          ))}
        </div>
      </div>

      {modal && (
        <VisitForm
          initial={modal.visit}
          onClose={() => setModal(null)}
          onSaved={onSaved}
          onToast={setToast}
        />
      )}

      <div className={`lx-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}
