import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { api } from '../lib/api.js';
import { faDate, isoToJStr, jStrToIso, todayJStr } from '../lib/jalali.js';
import { isValidNationalId, toEnDigits } from '../lib/identity.js';
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
const DiagIc = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></svg>);
const CalIc = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>);
const TechIc = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6.5 8-6.5s8 2.5 8 6.5" /></svg>);
const Scalpel = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M3 21l7-2 11-11a2.5 2.5 0 0 0-4-4L6 15z" /><path d="M14 6l4 4" /></svg>);
const Gear = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" /></svg>);

const STATUS_FA = { pending: 'در انتظار عمل', done: 'تمام‌شده', cancelled: 'کنسل' };
const FILTERS = [
  { v: 'all', l: 'همه' },
  { v: 'pending', l: 'در انتظار' },
  { v: 'done', l: 'تمام‌شده' },
  { v: 'cancelled', l: 'کنسل' },
];
const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');

/* اسپاتلایتِ شیشه */
function track(e) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
}

/* ── سلکتِ موجودیت + افزودنِ سریع (جراح/بیمارستان) ── */
function DefSelect({ label, icon, value, onChange, options, onQuickAdd, addPlaceholder }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submitAdd = async () => {
    const n = name.trim();
    if (n.length < 2 || busy) return;
    setBusy(true);
    try {
      const created = await onQuickAdd(n);
      onChange(created.id);
      setAdding(false);
      setName('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="db-field">
      <span>{icon} {label}</span>
      {adding ? (
        <div className="db-quickadd">
          <input
            type="text"
            value={name}
            autoFocus
            placeholder={addPlaceholder}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitAdd(); } }}
          />
          <button type="button" disabled={busy || name.trim().length < 2} onClick={submitAdd}>ثبت</button>
          <button type="button" className="ghost" onClick={() => { setAdding(false); setName(''); }}>لغو</button>
        </div>
      ) : (
        <div className="db-selrow">
          <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? +e.target.value : null)}>
            <option value="">— انتخاب —</option>
            {/* تشخیص‌ها `title` دارند، بقیه `name`/`displayName` — یک select برای همه. */}
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.name || o.title || o.displayName}</option>
            ))}
          </select>
          {onQuickAdd && (
            <button type="button" className="db-addmini" title="افزودنِ جدید" onClick={() => setAdding(true)}>
              <Plus width="15" height="15" />
            </button>
          )}
        </div>
      )}
    </label>
  );
}

/* ── فرمِ ثبت/ویرایشِ مراجعه ── */
function VisitForm({ initial, defs, onDefsChanged, onClose, onSaved, onToast }) {
  const editing = !!initial?.id;
  const [mode, setMode] = useState('new'); // new | existing
  const [pQuery, setPQuery] = useState('');
  const [pResults, setPResults] = useState([]);
  const [picked, setPicked] = useState(null);

  const [f, setF] = useState(() => ({
    firstName: initial?.firstName || '',
    lastName: initial?.lastName || '',
    phone: initial?.phone || '',
    nationalId: initial?.nationalId || '',
    birthDateJ: initial?.birthDate ? isoToJStr(initial.birthDate) : '',
    surgeonId: initial?.surgeonId ?? null,
    hospitalId: initial?.hospitalId ?? null,
    techId: initial?.techId ?? null,
    procedureTypeId: initial?.procedureTypeId ?? null,
    diagnosisId: initial?.diagnosisId ?? null,
    // متنِ آزاد فقط برای رکوردهای قدیمی که هنوز به نوعِ عمل وصل نشده‌اند.
    opType: initial?.procedureTypeId ? '' : initial?.opType || '',
    opReport: initial?.opReport || '',
    opDateJ: initial?.opDate ? isoToJStr(initial.opDate) : '',
    notes: initial?.notes || '',
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    if (mode !== 'existing') return undefined;
    const t = setTimeout(() => {
      api(`/patients?q=${encodeURIComponent(pQuery)}`)
        .then(setPResults)
        .catch(() => setPResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [pQuery, mode]);

  /**
   * کد ملیِ کامل → همان لحظه پروندهٔ موجود را نشان بده.
   *
   * بدونِ این، کاربر کلِ فرم را پر می‌کرد و تازه هنگامِ ثبت با ۴۰۹ روبه‌رو می‌شد.
   * این‌طور «مراجعهٔ مجدد» پیش از اتلافِ وقت دیده می‌شود، که هدفِ اصلیِ
   * «هر کد ملی یک پرونده» است.
   */
  const [nidMatch, setNidMatch] = useState(null);
  useEffect(() => {
    const nid = toEnDigits(f.nationalId).replace(/[^0-9]/g, '');
    if (editing || mode !== 'new' || !isValidNationalId(nid)) { setNidMatch(null); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      api(`/patients?q=${nid}`)
        .then((rows) => { if (alive) setNidMatch(rows.find((r) => r.nationalId === nid) || null); })
        .catch(() => { if (alive) setNidMatch(null); });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [f.nationalId, mode, editing]);

  // تشخیص با `title` ساخته می‌شود، بقیهٔ تعاریف با `name`.
  const quickAdd = (kind, field = 'name') => async (name) => {
    try {
      const created = await api(`/${kind}`, { method: 'POST', body: { [field]: name } });
      await onDefsChanged();
      onToast(`«${name}» اضافه شد ✓`);
      return created;
    } catch (e) {
      onToast(e.message);
      throw e;
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    let opDate;
    if (f.opDateJ.trim()) {
      opDate = jStrToIso(f.opDateJ);
      if (!opDate) { onToast('تاریخِ عمل نامعتبر است (مثال: ۱۴۰۵/۰۴/۲۸)'); return; }
    }
    let birthDate;
    if (f.birthDateJ.trim()) {
      birthDate = jStrToIso(f.birthDateJ);
      if (!birthDate) { onToast('تاریخِ تولد نامعتبر است (مثال: ۱۳۷۰/۰۱/۱۵)'); return; }
    }
    const nid = toEnDigits(f.nationalId).replace(/[^0-9]/g, '');
    // اعتبارسنجیِ سمتِ کاربر تا پیشِ ارسال بازخورد بگیرد؛ اعتبارِ واقعی سمتِ سرور است.
    if (nid && !isValidNationalId(nid)) { onToast('کد ملی معتبر نیست — رقم‌ها را بررسی کنید'); return; }

    const common = {
      surgeonId: f.surgeonId ?? (editing ? null : undefined),
      hospitalId: f.hospitalId ?? (editing ? null : undefined),
      techId: f.techId ?? (editing ? null : undefined),
      procedureTypeId: f.procedureTypeId ?? (editing ? null : undefined),
      diagnosisId: f.diagnosisId ?? (editing ? null : undefined),
      opType: f.procedureTypeId ? undefined : f.opType.trim() || undefined,
      opReport: f.opReport.trim() || undefined,
      opDate,
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
            opType: f.procedureTypeId ? undefined : f.opType.trim(),
            opReport: f.opReport.trim(),
            opDate: opDate ?? null,
            firstName: f.firstName.trim(),
            lastName: f.lastName.trim(),
            phone: toEnDigits(f.phone).trim(),
            nationalId: nid,
            birthDate: birthDate ?? null,
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
            phone: toEnDigits(f.phone).trim() || undefined,
            nationalId: nid || undefined,
            birthDate,
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

  // غیرفعال‌ها پنهان‌اند، مگر همان‌که روی این مراجعه ثبت شده — وگرنه ویرایش، مقدارِ
  // قبلی را بی‌صدا پاک می‌کرد.
  // «هنوز در حالِ تایپ» غلط نیست؛ فقط طولِ کامل ارزیابی می‌شود.
  const nidDigits = toEnDigits(f.nationalId).replace(/[^0-9]/g, '');
  const nidBad = nidDigits.length === 10 && !isValidNationalId(nidDigits);

  const activeSurgeons = defs.surgeons.filter((s) => s.active || s.id === f.surgeonId);
  const activeHospitals = defs.hospitals.filter((h) => h.active || h.id === f.hospitalId);
  const activeProcedures = defs.procedures.filter((p) => p.active || p.id === f.procedureTypeId);
  const activeDiagnoses = defs.diagnoses.filter((d) => d.active || d.id === f.diagnosisId);

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
                {/* شمارهٔ مراجعهٔ بعدی، تا پیش از ثبت معلوم باشد کجا می‌نشیند. */}
                <small>مراجعهٔ {faNum((picked.visitCount ?? 0) + 1)}</small>
                <button type="button" onClick={() => setPicked(null)}>تغییر</button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={pQuery}
                  onChange={(e) => setPQuery(e.target.value)}
                  placeholder="جستجوی نام / کد پرونده / موبایل / کد ملی…"
                  autoFocus
                />
                <div className="db-plist">
                  {pResults.map((p) => (
                    <button type="button" key={p.id} onClick={() => setPicked(p)}>
                      <b>{p.fullName}</b>
                      <span dir="ltr">{p.code}</span>
                      <small>{p.nationalId ? `${faNum(p.nationalId)} · ` : ''}{faNum(p.visitCount)} مراجعه</small>
                    </button>
                  ))}
                  {pResults.length === 0 && <div className="db-pnone">بیماری پیدا نشد</div>}
                </div>
              </>
            )}
          </div>
        ) : (
          <>
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
              <label className={`db-field${nidBad ? ' bad' : ''}`}><span>کد ملی</span>
                <input type="text" dir="ltr" inputMode="numeric" maxLength={12} value={f.nationalId} onChange={set('nationalId')} placeholder="کلیدِ پرونده — اختیاری" />
                {nidBad && <small className="db-hint bad">کد ملی معتبر نیست</small>}
              </label>
            </div>

            {nidMatch && (
              <div className="db-nidmatch">
                <b>این کد ملی از قبل پرونده دارد</b>
                <span>{nidMatch.fullName} — <span dir="ltr">{nidMatch.code}</span> ({faNum(nidMatch.visitCount)} مراجعه)</span>
                <button
                  type="button"
                  onClick={() => { setPicked(nidMatch); setMode('existing'); }}
                >ثبتِ مراجعهٔ تازه روی همین پرونده</button>
              </div>
            )}

            <label className="db-field"><span>تاریخِ تولد (شمسی)</span>
              <input type="text" dir="ltr" inputMode="numeric" value={f.birthDateJ} onChange={set('birthDateJ')} placeholder="۱۳۷۰/۰۱/۱۵ — اختیاری" />
            </label>
          </>
        )}

        <div className="db-grid2">
          <DefSelect
            label="جراح"
            value={f.surgeonId}
            onChange={(v) => setF((s) => ({ ...s, surgeonId: v }))}
            options={activeSurgeons}
            onQuickAdd={quickAdd('surgeons')}
            addPlaceholder="نامِ جراحِ جدید…"
          />
          <DefSelect
            label="بیمارستان"
            value={f.hospitalId}
            onChange={(v) => setF((s) => ({ ...s, hospitalId: v }))}
            options={activeHospitals}
            onQuickAdd={quickAdd('hospitals')}
            addPlaceholder="نامِ بیمارستانِ جدید…"
          />
          <DefSelect
            label="کارشناس"
            value={f.techId}
            onChange={(v) => setF((s) => ({ ...s, techId: v }))}
            options={defs.techs}
          />
          <DefSelect
            label="نوعِ عمل"
            value={f.procedureTypeId}
            onChange={(v) => setF((s) => ({ ...s, procedureTypeId: v, opType: '' }))}
            options={activeProcedures}
            onQuickAdd={quickAdd('procedure-types')}
            addPlaceholder="نامِ نوعِ عملِ جدید…"
          />
        </div>

        {/* رکوردهای قدیمی متنِ آزاد دارند؛ تا وقتی به نوعِ عمل وصل نشده‌اند نمایش داده می‌شود. */}
        {!f.procedureTypeId && f.opType && (
          <label className="db-field"><span>نوعِ عمل (متنِ قدیمی)</span>
            <input type="text" value={f.opType} onChange={set('opType')} />
            <small className="db-hint">برای گزارش‌گیری، از فهرستِ بالا یکی را انتخاب کنید.</small>
          </label>
        )}

        <DefSelect
          label="تشخیص"
          value={f.diagnosisId}
          onChange={(v) => setF((s) => ({ ...s, diagnosisId: v }))}
          options={activeDiagnoses}
          onQuickAdd={quickAdd('diagnoses', 'title')}
          addPlaceholder="عنوانِ تشخیصِ جدید…"
        />

        <label className="db-field">
          <span>تاریخِ عمل (شمسی)</span>
          <div className="db-daterow">
            <input type="text" dir="ltr" inputMode="numeric" value={f.opDateJ} onChange={set('opDateJ')} placeholder="۱۴۰۵/۰۴/۲۸" />
            <button type="button" className="db-today" onClick={() => setF((s) => ({ ...s, opDateJ: todayJStr() }))}>امروز</button>
          </div>
        </label>

        <label className="db-field"><span>شرحِ عمل</span>
          <textarea rows={3} value={f.opReport} onChange={set('opReport')} placeholder="یافته‌ها، مسیرِ عمل، رخدادهای حینِ مانیتورینگ…" />
        </label>

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

/* ── شیتِ «تعریف‌ها»: مدیریتِ جراحان و بیمارستان‌ها ── */
function DefsSheet({ defs, onDefsChanged, onClose, onToast }) {
  const [tab, setTab] = useState('surgeons'); // surgeons | hospitals
  // جراح هویتش در Person است، پس نام و نام‌خانوادگی جدا گرفته می‌شوند؛
  // بیمارستان سازمان است و یک نام دارد.
  const [name, setName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState(0);
  const [editName, setEditName] = useState('');
  const [editLast, setEditLast] = useState('');
  const isSurgeon = tab === 'surgeons';

  const kind = tab; // مسیرِ API
  const rows = tab === 'surgeons' ? defs.surgeons : defs.hospitals;

  const run = async (fn, okMsg) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await onDefsChanged();
      if (okMsg) onToast(okMsg);
    } catch (e) {
      onToast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const canAdd = isSurgeon
    ? name.trim().length >= 2 && lastName.trim().length >= 2
    : name.trim().length >= 2;

  const add = () => {
    if (!canAdd) return;
    const n = name.trim();
    const l = lastName.trim();
    run(async () => {
      const body = isSurgeon ? { firstName: n, lastName: l } : { name: n };
      await api(`/${kind}`, { method: 'POST', body });
      setName('');
      setLastName('');
    }, `«${isSurgeon ? `${n} ${l}` : n}» اضافه شد ✓`);
  };

  const saveRename = (row) => {
    const n = editName.trim();
    const l = editLast.trim();
    if (n.length < 2 || (isSurgeon && l.length < 2)) { setEditId(0); return; }
    const unchanged = isSurgeon
      ? n === row.firstName && l === row.lastName
      : n === row.name;
    if (unchanged) { setEditId(0); return; }
    run(async () => {
      const body = isSurgeon ? { firstName: n, lastName: l } : { name: n };
      await api(`/${kind}/${row.id}`, { method: 'PATCH', body });
      setEditId(0);
    }, 'نام ویرایش شد ✓');
  };

  const toggle = (row) =>
    run(() => api(`/${kind}/${row.id}`, { method: 'PATCH', body: { active: !row.active } }),
      row.active ? 'غیرفعال شد' : 'فعال شد ✓');

  const del = (row) =>
    run(async () => {
      const r = await api(`/${kind}/${row.id}`, { method: 'DELETE' });
      onToast(r.deactivated ? 'به‌دلیلِ سابقهٔ مراجعه، غیرفعال شد' : 'حذف شد');
    });

  return (
    <div className="db-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass db-sheet">
        <header className="db-sheet-head">
          <b>تعریف‌ها</b>
          <button type="button" className="db-x" onClick={onClose} aria-label="بستن"><XIc width="18" height="18" /></button>
        </header>

        <div className="lg-tabs db-modetabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'surgeons'} className={tab === 'surgeons' ? 'on' : ''} onClick={() => setTab('surgeons')}>جراحان</button>
          <button type="button" role="tab" aria-selected={tab === 'hospitals'} className={tab === 'hospitals' ? 'on' : ''} onClick={() => setTab('hospitals')}>بیمارستان‌ها</button>
        </div>

        <div className="db-quickadd">
          <input
            type="text"
            value={name}
            placeholder={isSurgeon ? 'نام…' : 'نامِ بیمارستانِ جدید…'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          />
          {isSurgeon && (
            <input
              type="text"
              value={lastName}
              placeholder="نام خانوادگی…"
              onChange={(e) => setLastName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            />
          )}
          <button type="button" disabled={busy || !canAdd} onClick={add}>افزودن</button>
        </div>

        <div className="db-defs">
          {rows.length === 0 && <div className="db-pnone">هنوز موردی تعریف نشده</div>}
          {rows.map((row) => (
            <div key={row.id} className={`db-def${row.active ? '' : ' off'}`}>
              {editId === row.id ? (
                <span className="db-def-editrow">
                  <input
                    className="db-def-edit"
                    type="text"
                    value={editName}
                    autoFocus
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveRename(row); } if (e.key === 'Escape') setEditId(0); }}
                  />
                  {isSurgeon && (
                    <input
                      className="db-def-edit"
                      type="text"
                      value={editLast}
                      placeholder="نام خانوادگی"
                      onChange={(e) => setEditLast(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveRename(row); } if (e.key === 'Escape') setEditId(0); }}
                    />
                  )}
                  <button type="button" className="db-def-save" onClick={() => saveRename(row)}>ثبت</button>
                </span>
              ) : (
                <b>{row.name}{!row.active && <i> (غیرفعال)</i>}</b>
              )}
              <small>{faNum(row.visitCount)} مراجعه</small>
              <span className="db-def-acts">
                <button type="button" title="ویرایشِ نام" disabled={busy} onClick={() => { setEditId(row.id); setEditName(isSurgeon ? row.firstName : row.name); setEditLast(isSurgeon ? row.lastName : ''); }}><Pencil width="14" height="14" /></button>
                <button type="button" title={row.active ? 'غیرفعال‌کردن' : 'فعال‌کردن'} disabled={busy} onClick={() => toggle(row)}>{row.active ? '⏸' : '▶'}</button>
                <button type="button" className="danger" title="حذف" disabled={busy} onClick={() => del(row)}><Trash width="14" height="14" /></button>
              </span>
            </div>
          ))}
        </div>
      </div>
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
        {(v.procedureTypeName || v.opType) && <span className="db-optype">{v.procedureTypeName || v.opType}</span>}
        <span className={`us-status db-st-${v.opStatus}`}>{STATUS_FA[v.opStatus]}</span>
      </div>

      <div className="db-facts">
        {v.surgeonName && <span><Doctor width="14" height="14" /> {v.surgeonName}</span>}
        {v.techName && <span><TechIc width="14" height="14" /> {v.techName}</span>}
        {v.hospitalName && <span><Hospital width="14" height="14" /> {v.hospitalName}</span>}
        {v.opDate && <span><CalIc width="14" height="14" /> {faDate(v.opDate)}</span>}
        {v.diagnosisTitle && <span><DiagIc width="14" height="14" /> {v.diagnosisTitle}</span>}
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
  const [defsOpen, setDefsOpen] = useState(false);
  const [busyId, setBusyId] = useState(0);
  const [toast, setToast] = useState('');
  const [denied, setDenied] = useState(false);
  const [defs, setDefs] = useState({ surgeons: [], hospitals: [], techs: [], procedures: [], diagnoses: [] });
  const qRef = useRef(q);
  qRef.current = q;

  useEffect(() => { document.title = 'عمل‌یار — داشبورد مدیریت'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    // پیامِ «کدام پرونده، چندمین مراجعه» بلند است؛ ۲۲۰۰ms برای خواندنش کم بود.
    const t = setTimeout(() => setToast(''), toast.length > 40 ? 4500 : 2200);
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

  const loadDefs = useCallback(async () => {
    try {
      const [surgeons, hospitals, techs, procedures, diagnoses] = await Promise.all([
        api('/surgeons'),
        api('/hospitals'),
        api('/techs'),
        api('/procedure-types'),
        api('/diagnoses'),
      ]);
      setDefs({ surgeons, hospitals, techs, procedures, diagnoses });
    } catch {
      /* دسترسی نداشته باشد، denied از load اصلی می‌آید */
    }
  }, []);

  // بارِ اول + سرچِ زنده (debounce) + فیلترِ وضعیت.
  // ⚠️ user.id هم جزو وابستگی‌هاست: بعد از سوییچِ حساب، دسترسی/داده با حسابِ جدید
  // دوباره از سرور خوانده می‌شود (باگِ واقعی: دادهٔ حسابِ قبلی تا رفرش می‌ماند)
  useEffect(() => {
    setDenied(false);
    const t = setTimeout(() => load(q, status), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, status, load, user?.id]);

  useEffect(() => { loadDefs(); }, [loadDefs, user?.id]);

  // سوییچِ حساب وسطِ فرم/شیتِ باز → بسته شود
  useEffect(() => { setModal(null); setDefsOpen(false); }, [user?.id]);

  const stats = useMemo(() => {
    const rows = visits || [];
    const todayIso = new Date().toDateString();
    return {
      total: rows.length,
      pending: rows.filter((v) => v.opStatus === 'pending').length,
      today: rows.filter((v) => v.opDate && new Date(v.opDate).toDateString() === todayIso && v.opStatus !== 'cancelled').length,
    };
  }, [visits]);

  const onSaved = (saved, wasEdit) => {
    setModal(null);
    load(qRef.current, status);
    if (wasEdit) { setToast('مراجعه ویرایش شد ✓'); return; }

    // کاربر باید بفهمد مراجعه در کدام پرونده و با چه شماره‌ای نشست — به‌ویژه وقتی
    // کد ملی به پروندهٔ موجود خورده و پروندهٔ تکراری ساخته نشده است.
    const seq = faNum(saved.code.split('-V')[1] || '1');
    const where = `پروندهٔ ${saved.patientCode} — مراجعهٔ ${seq}`;
    setToast({
      new: `پروندهٔ جدید ساخته شد ✓ ${where}`,
      matched: `بیمار از قبل پرونده داشت؛ مراجعهٔ تازه ثبت شد ✓ ${where}`,
      restored: `پروندهٔ حذف‌شده برگشت و مراجعهٔ تازه ثبت شد ✓ ${where}`,
      existing: `مراجعه ثبت شد ✓ ${where}`,
    }[saved.patientStatus] ?? `مراجعهٔ ${saved.code} ثبت شد ✓`);
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
          <div className="glass db-stat"><b>{faNum(stats.total)}</b><span>مراجعه</span></div>
          <div className="glass db-stat"><b>{faNum(stats.pending)}</b><span>در انتظار عمل</span></div>
          <div className="glass db-stat db-stat-today"><b>{faNum(stats.today)}</b><span>عملِ امروز</span></div>
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
          <button type="button" className="db-ico db-defbtn" title="تعریف‌ها (جراحان/بیمارستان‌ها)" onClick={() => setDefsOpen(true)}>
            <Gear width="17" height="17" />
          </button>
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
          defs={defs}
          onDefsChanged={loadDefs}
          onClose={() => setModal(null)}
          onSaved={onSaved}
          onToast={setToast}
        />
      )}

      {defsOpen && (
        <DefsSheet defs={defs} onDefsChanged={loadDefs} onClose={() => setDefsOpen(false)} onToast={setToast} />
      )}

      <div className={`lx-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}
