import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from './auth.jsx';
import { api } from '../lib/api.js';
import { faDate, isoToJStr, jStrToIso, todayJStr, toJalaali, toGregorian } from '../lib/jalali.js';
import { isValidNationalId, toEnDigits } from '../lib/identity.js';
import { badTime, durationMin, normTime } from '../lib/time.js';
import ProfileMenu from './ProfileMenu.jsx';
import { useConfig, useTerms } from './config.jsx';
import BillingSheet from './BillingSheet.jsx';
import JDate from './JDate.jsx';
import { downloadCsv, printVisits, visitsToCsv } from './exports.js';
import './launcher.css';
import './users.css';
import './dashboard.css';
import { Arrive, Back, Calendar, Clock, Close, Diagnosis, Doctor, Download, Filter, Gear, Hospital, Money, Pencil, Plus, Print, Scalpel, Search, Trash, User } from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import TimePick from '../ui/TimePick.jsx';
import { useStagger } from '../ui/stagger.js';

/* ── آیکون‌های خطی ── */


/** فیلترهای پیشرفته‌ای که مستقیم به query سرور می‌روند. */
const ADV_IDS = ['surgeonId', 'hospitalId', 'techId', 'procedureTypeId', 'diagnosisId'];
const EMPTY_ADV = { surgeonId: '', hospitalId: '', techId: '', procedureTypeId: '', diagnosisId: '', fromJ: '', toJ: '', owing: false };
const EMPTY_META = { total: 0, pages: 1, stats: { total: 0, pending: 0, today: 0, due: 0, kinds: [] } };

const SORT_OPTIONS = [
  { v: 'date', l: 'تاریخ' },
  { v: 'created', l: 'تاریخِ ثبت' },
  { v: 'name', l: 'نامِ بیمار' },
  { v: 'code', l: 'کدِ پرونده' },
  // ⚠️ این دو مشتق‌اند و ستونِ دیتابیس ندارند؛ سرور با aggregate مرتب می‌کند.
  // تا فازِ حسابداری عمداً نبودند — ساختنِ ستونِ ذخیره‌شده ناقضِ computeVisit بود.
  { v: 'due', l: 'مانده' },
  { v: 'total', l: 'جمعِ کل' },
];
const PAGE_SIZES = [25, 50, 100, 200];

/**
 * بازه‌های سریع بر تقویمِ شمسی حساب می‌شوند، نه میلادی: «این ماه» یعنی ماهِ
 * شمسی، و هفته از شنبه شروع می‌شود. حسابِ میلادی این‌جا جوابِ غلط می‌دهد.
 */
function quickRange(key) {
  const now = new Date();
  const iso = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  if (key === 'today') return { fromJ: isoToJStr(iso(now)), toJ: isoToJStr(iso(now)) };
  if (key === 'week') {
    const back = (now.getDay() + 1) % 7; // شنبه = ابتدای هفته
    const from = new Date(now); from.setDate(now.getDate() - back);
    const to = new Date(from); to.setDate(from.getDate() + 6);
    return { fromJ: isoToJStr(iso(from)), toJ: isoToJStr(iso(to)) };
  }
  const [jy, jm] = jParts(now);
  const start = jToDate(jy, jm, 1);
  const nextY = jm === 12 ? jy + 1 : jy;
  const nextM = jm === 12 ? 1 : jm + 1;
  const end = jToDate(nextY, nextM, 1);
  end.setDate(end.getDate() - 1);
  return { fromJ: isoToJStr(start.toISOString()), toJ: isoToJStr(end.toISOString()) };
}
const jParts = (d) => {
  const j = toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return [j.jy, j.jm, j.jd];
};
const jToDate = (jy, jm, jd) => {
  const g = toGregorian(jy, jm, jd);
  return new Date(g.gy, g.gm - 1, g.gd);
};

/**
 * نوعِ ملاقات. برچسبِ وضعیت و تاریخ به همین بستگی دارد: «در انتظارِ عمل» برای
 * ویزیتِ مطب بی‌معنی است، و «تاریخِ عمل» هم همین‌طور. ستون‌های DB نامِ op* دارند
 * ولی آنچه کاربر می‌بیند از این‌جا می‌آید.
 */
const KINDS = {
  surgery:  { label: 'عمل',     date: 'تاریخِ عمل',   pending: 'در انتظار عمل' },
  clinic:   { label: 'ویزیت',   date: 'تاریخِ ویزیت', pending: 'در انتظار ویزیت' },
  followup: { label: 'پیگیری',  date: 'تاریخِ پیگیری', pending: 'در انتظار پیگیری' },
  consult:  { label: 'مشاوره',  date: 'تاریخِ مشاوره', pending: 'در انتظار مشاوره' },
};
const kindOf = (k) => KINDS[k] ?? KINDS.surgery;
const statusLabel = (v) => (v.opStatus === 'pending' ? kindOf(v.kind).pending : STATUS_FA[v.opStatus]);

const STATUS_FA = { pending: 'در انتظار', done: 'تمام‌شده', cancelled: 'کنسل' };
const FILTERS = [
  { v: 'all', l: 'همه' },
  { v: 'pending', l: 'در انتظار' },
  { v: 'done', l: 'تمام‌شده' },
  { v: 'cancelled', l: 'کنسل' },
];
const KIND_FILTERS = [{ v: 'all', l: 'همه' }, ...Object.entries(KINDS).map(([v, k]) => ({ v, l: k.label }))];
const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');
/// ارقامِ لاتینِ یک رشته (مثلِ «۱۴۰۵/۰۵/۰۱»ِ ورودی) را فارسی می‌کند — فقط برای
/// نمایش؛ مقدارِ داخلِ input عمداً لاتین می‌ماند تا تایپ و ویرایش ساده بماند.
const faDigits = (s) => String(s ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/** «۳ ساعت و ۲۵ دقیقه» — صفرِ بی‌معنی («۰ ساعت») نشان داده نمی‌شود. */
function faDuration(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${faNum(m)} دقیقه`;
  if (!m) return `${faNum(h)} ساعت`;
  return `${faNum(h)} ساعت و ${faNum(m)} دقیقه`;
}

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
    } catch {
      // پیام را onQuickAdd به‌شکلِ toast داده؛ این‌جا فقط پنل باز می‌ماند تا
      // کاربر همان نوشته را اصلاح کند. بدونِ این catch، خطای اعتبارسنجیِ
      // معمولی به‌صورت unhandled rejection در کنسول می‌نشست.
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
  const t = useTerms();
  const editing = !!initial?.id;
  const [mode, setMode] = useState('new'); // new | existing
  const [pQuery, setPQuery] = useState('');
  const [pResults, setPResults] = useState([]);
  const [picked, setPicked] = useState(null);

  const [f, setF] = useState(() => ({
    kind: initial?.kind || 'surgery',
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
    amount: '', // مبلغِ توافقی — فقط هنگامِ ساخت
    opDateJ: initial?.opDate ? isoToJStr(initial.opDate) : '',
    opStartTime: initial?.opStartTime || '',
    opEndTime: initial?.opEndTime || '',
    techArriveTime: initial?.techArriveTime || '',
    notes: initial?.notes || '',
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const formDuration = durationMin(f.opStartTime, f.opEndTime);

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
  /**
   * افزودنِ سریع از داخلِ فرم.
   *
   * ⚠️ جراح استثناست: هویتش یک Person است و سرور `firstName` و `lastName`
   * جدا می‌خواهد، نه یک `name`. تا امروز همان `{name}` فرستاده می‌شد و دکمهٔ
   * `+` کنارِ جراح **همیشه** با خطای اعتبارسنجی رد می‌شد — بی‌صدا، چون کاربر
   * فقط یک toastِ انگلیسیِ نامفهوم می‌دید. این‌جا نام از اولین فاصله تکه
   * می‌شود (فامیلِ دوکلمه‌ای رایج است، نامِ مرکب نادر).
   */
  const bodyFor = (kind, value) => {
    if (kind !== 'surgeons') return { [kind === 'diagnoses' ? 'title' : 'name']: value };
    const parts = value.trim().split(/\s+/);
    if (parts.length < 2) throw new Error('نام و نام خانوادگیِ جراح را با یک فاصله وارد کنید');
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
  };

  const quickAdd = (kind) => async (value) => {
    try {
      const created = await api(`/${kind}`, { method: 'POST', body: bodyFor(kind, value) });
      await onDefsChanged();
      onToast(`«${value}» اضافه شد ✓`);
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
      if (!opDate) { onToast(`${kindOf(f.kind).date} نامعتبر است (مثال: ۱۴۰۵/۰۴/۲۸)`); return; }
    }
    let birthDate;
    if (f.birthDateJ.trim()) {
      birthDate = jStrToIso(f.birthDateJ);
      if (!birthDate) { onToast('تاریخِ تولد نامعتبر است (مثال: ۱۳۷۰/۰۱/۱۵)'); return; }
    }
    // ساعت‌ها پیش از ارسال نرمال می‌شوند (کاربر ممکن است بدونِ blur ذخیره بزند).
    const times = {
      opStartTime: normTime(f.opStartTime),
      opEndTime: normTime(f.opEndTime),
      techArriveTime: normTime(f.techArriveTime),
    };
    const badKey = Object.entries(times).find(([, v]) => badTime(v));
    if (badKey) { onToast('ساعت باید به شکلِ ۰۸:۳۰ باشد'); return; }

    const nid = toEnDigits(f.nationalId).replace(/[^0-9]/g, '');
    // اعتبارسنجیِ سمتِ کاربر تا پیشِ ارسال بازخورد بگیرد؛ اعتبارِ واقعی سمتِ سرور است.
    if (nid && !isValidNationalId(nid)) { onToast('کد ملی معتبر نیست — رقم‌ها را بررسی کنید'); return; }

    const common = {
      kind: f.kind,
      surgeonId: f.surgeonId ?? (editing ? null : undefined),
      hospitalId: f.hospitalId ?? (editing ? null : undefined),
      techId: f.techId ?? (editing ? null : undefined),
      procedureTypeId: f.procedureTypeId ?? (editing ? null : undefined),
      diagnosisId: f.diagnosisId ?? (editing ? null : undefined),
      opType: f.procedureTypeId ? undefined : f.opType.trim() || undefined,
      opReport: f.opReport.trim() || undefined,
      opDate,
      // رشتهٔ خالی فرستاده می‌شود نه undefined: کاربر که ساعت را پاک می‌کند
      // منظورش «پاکش کن» است، نه «دست نزن».
      opStartTime: editing || times.opStartTime ? times.opStartTime : undefined,
      opEndTime: editing || times.opEndTime ? times.opEndTime : undefined,
      techArriveTime: editing || times.techArriveTime ? times.techArriveTime : undefined,
      notes: f.notes.trim() || undefined,
    };
    /* ⚠️ مبلغ فقط در **ساخت** می‌رود، نه در ویرایش: ویرایشِ مراجعه نباید
       بی‌سروصدا قلمِ تازه بسازد. اصلاحِ مبلغ کارِ صورت‌حساب است. */
    const amount = Number(toEnDigits(String(f.amount)).replace(/[^0-9]/g, '')) || 0;
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
        saved = await api('/visits', { method: 'POST', body: { ...common, patientId: picked.id, amount: amount || undefined } });
      } else {
        saved = await api('/visits', {
          method: 'POST',
          body: {
            amount: amount || undefined,
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
    <Overlay backdrop="db-overlay" panel="glass db-sheet" as="form" from="bottom" onClose={onClose} onSubmit={submit}>
      <header className="db-sheet-head">
        <b>{editing ? `ویرایشِ ${t.visit} ${initial.code}` : t.visitNew}</b>
        <button type="button" className="db-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
      </header>

      {/* نوعِ ملاقات اول می‌آید چون بقیهٔ برچسب‌های فرم از آن پیروی می‌کنند. */}
      <div className="db-kindrow" role="radiogroup" aria-label={`نوعِ ${t.visit}`}>
        {Object.entries(KINDS).map(([v, k]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={f.kind === v}
            className={f.kind === v ? 'on' : ''}
            onClick={() => setF((s) => ({ ...s, kind: v }))}
          >{k.label}</button>
        ))}
      </div>

      {!editing && (
        <Tabs
          variant="inset"
          className="db-modetabs"
          label="نوعِ ثبت"
          value={mode}
          onChange={(k) => { setMode(k); if (k === 'existing') setPicked(null); }}
          items={[{ key: 'new', label: 'بیمارِ جدید' }, { key: 'existing', label: 'بیمارِ موجود' }]}
        />
      )}

      {(!editing && mode === 'existing') ? (
        <div className="db-psearch">
          {picked ? (
            <div className="db-picked">
              <b>{picked.fullName}</b>
              <span dir="ltr">{picked.code}</span>
              {/* شمارهٔ مراجعهٔ بعدی، تا پیش از ثبت معلوم باشد کجا می‌نشیند. */}
              <small>{t.visit} {faNum((picked.visitCount ?? 0) + 1)}</small>
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
                    <small>{p.nationalId ? `${faNum(p.nationalId)} · ` : ''}{faNum(p.visitCount)} {t.visit}</small>
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
              <span>{nidMatch.fullName} — <span dir="ltr">{nidMatch.code}</span> ({faNum(nidMatch.visitCount)} {t.visit})</span>
              <button
                type="button"
                onClick={() => { setPicked(nidMatch); setMode('existing'); }}
              >{t.visitOne}ِ تازه روی همین {t.record}</button>
            </div>
          )}

          <JDate
            label="تاریخِ تولد (شمسی)"
            mode="birth"
            value={f.birthDateJ}
            onChange={(v) => setF((s2) => ({ ...s2, birthDateJ: v }))}
            placeholder="۱۳۷۰/۰۱/۱۵ — اختیاری"
          />
        </>
      )}

      <div className="db-grid2">
        <DefSelect
          label="جراح"
          value={f.surgeonId}
          onChange={(v) => setF((s) => ({ ...s, surgeonId: v }))}
          options={activeSurgeons}
          onQuickAdd={quickAdd('surgeons')}
          addPlaceholder="نام و نام خانوادگیِ جراح…"
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
          label={t.tech}
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
        onQuickAdd={quickAdd('diagnoses')}
        addPlaceholder="عنوانِ تشخیصِ جدید…"
      />

      {/* دکمهٔ «امروز» داخلِ خودِ تقویم است؛ تکرارش کنارِ فیلد فقط جا می‌گرفت. */}
      <JDate
        label={`${kindOf(f.kind).date} (شمسی)`}
        value={f.opDateJ}
        onChange={(v) => setF((s2) => ({ ...s2, opDateJ: v }))}
        placeholder="۱۴۰۵/۰۴/۲۸"
      />

      {/* ساعت‌ها کنارِ هم: کاربر شروع و پایان را با هم می‌زند، و مدت را
          همان‌جا می‌بیند — بدونِ حسابِ ذهنی. */}
      <div className="db-grid3">
        {[
          { key: 'opStartTime', label: 'ساعتِ شروع' },
          { key: 'opEndTime', label: 'ساعتِ پایان' },
          { key: 'techArriveTime', label: `حضورِ ${t.tech}` },
        ].map((fl) => (
          <TimePick
            key={fl.key}
            label={fl.label}
            value={f[fl.key]}
            onChange={(v) => setF((s) => ({ ...s, [fl.key]: v }))}
          />
        ))}
      </div>
      {formDuration != null && (
        <p className="db-hint db-durhint">مدتِ {kindOf(f.kind).label}: {faDuration(formDuration)}</p>
      )}

      {/* مبلغ فقط هنگامِ ثبتِ مراجعهٔ تازه — تا مراجعهٔ صفرتومانی ساخته نشود.
          در ویرایش، صورت‌حساب جای اصلاح است. */}
      {!editing && (
        <label className="db-field"><span>مبلغِ توافقی (تومان)</span>
          <input dir="ltr" inputMode="numeric" value={f.amount} onChange={set('amount')}
                 placeholder="اختیاری — قلمِ خدمت در صورت‌حساب ساخته می‌شود" />
        </label>
      )}

      <label className="db-field"><span>شرحِ عمل</span>
        <textarea rows={3} value={f.opReport} onChange={set('opReport')} placeholder="یافته‌ها، مسیرِ عمل، رخدادهای حینِ مانیتورینگ…" />
      </label>

      <label className="db-field"><span>یادداشت</span>
        <textarea rows={2} value={f.notes} onChange={set('notes')} />
      </label>

      <button className="db-submit" type="submit" disabled={busy}>
        {busy ? 'در حال ذخیره…' : editing ? 'ذخیرهٔ تغییرات' : t.visitOne}
      </button>
    </Overlay>
  );
}

/* ── شیتِ «تعریف‌ها»: مدیریتِ جراحان و بیمارستان‌ها ── */

/* ── کارتِ مراجعه ── */
function VisitCard({ v, index, busy, onEdit, onStatus, onDelete, onBilling }) {
  const row = useStagger();
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => {
    if (!confirmDel) return undefined;
    const t = setTimeout(() => setConfirmDel(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDel]);

  return (
    <motion.div className="glass us-card db-card" onMouseMove={track} {...row(index)}>
      <span className="glass-glow" aria-hidden="true" />
      <div className="us-row">
        {/* نامِ بیمار درِ ورودیِ پرونده است — کاربر همان‌جا که بیمار را می‌بیند
            انتظار دارد بتواند سابقه‌اش را باز کند، نه از یک منویِ دیگر. */}
        <Link className="us-meta db-patlink" to={`/app/patients/${v.patientId}`} title="پروندهٔ بیمار">
          <b>{v.fullName}</b>
          <span>{v.code}</span>
        </Link>
        {/* نشانِ نوع فقط وقتی «عمل» نیست — برچسبِ تکراری روی همهٔ کارت‌ها اطلاعات نیست. */}
        {v.kind && v.kind !== 'surgery' && <span className={`db-kindtag k-${v.kind}`}>{kindOf(v.kind).label}</span>}
        {(v.procedureTypeName || v.opType) && <span className="db-optype">{v.procedureTypeName || v.opType}</span>}
        {/* مانده فقط وقتی صورت‌حساب دارد؛ «۰ تومان» روی هر کارت اطلاعات نیست. */}
        {v.total !== 0 && (
          <span className={`db-due${v.due <= 0 ? ' ok' : ''}`}>
            {v.due > 0 ? `مانده ${faNum(v.due)}` : 'تسویه'}
          </span>
        )}
        <span className={`us-status db-st-${v.opStatus}`}>{statusLabel(v)}</span>
      </div>

      <div className="db-facts">
        {v.surgeonName && <span><Doctor width="14" height="14" /> {v.surgeonName}</span>}
        {v.techName && <span><User width="14" height="14" /> {v.techName}</span>}
        {v.hospitalName && <span><Hospital width="14" height="14" /> {v.hospitalName}</span>}
        {v.opDate && <span><Calendar width="14" height="14" /> {faDate(v.opDate)}</span>}
        {/* ساعت فقط وقتی ثبت شده باشد؛ «—:—» روی هر کارت اطلاعات نیست.
            مدت از سرور می‌آید (durationMin)، نه از تفریقِ همین‌جا. */}
        {v.opStartTime && (
          <span title={v.durationMin != null ? `مدت: ${faDuration(v.durationMin)}` : undefined}>
            <Clock width="14" height="14" />
            <span dir="ltr">{v.opStartTime}{v.opEndTime ? `–${v.opEndTime}` : ''}</span>
            {v.durationMin != null && ` (${faDuration(v.durationMin)})`}
          </span>
        )}
        {v.techArriveTime && (
          <span title={`ساعتِ حضورِ ${v.techName || 'کارشناس'}`}>
            <Arrive width="14" height="14" /> <span dir="ltr">{v.techArriveTime}</span>
          </span>
        )}
        {v.diagnosisTitle && <span><Diagnosis width="14" height="14" /> {v.diagnosisTitle}</span>}
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
        <button type="button" className="db-ico" title="صورت‌حساب" onClick={() => onBilling(v)} disabled={busy}><Money width="15" height="15" /></button>
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
    </motion.div>
  );
}

/* ── جستجوی پیشرفته ──
   پاپ‌آپِ چندپارامتری. عمداً «اعمال» دارد و زنده نیست: کاربر پنج فیلتر را
   می‌چیند و یک‌بار نتیجه می‌خواهد، نه پنج بار بارگذاریِ نصفه‌کاره. */
function AdvancedSearch({ value, defs, onApply, onClose }) {
  const t = useTerms();
  const [f, setF] = useState(value);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const pickRange = (key) => setF((s) => ({ ...s, ...quickRange(key) }));

  const badDate = (v) => !!v.trim() && !jStrToIso(v);
  const invalid = badDate(f.fromJ) || badDate(f.toJ);

  const FIELDS = [
    { key: 'surgeonId', label: 'جراح', options: defs.surgeons },
    { key: 'hospitalId', label: 'بیمارستان', options: defs.hospitals },
    { key: 'techId', label: t.tech, options: defs.techs },
    { key: 'procedureTypeId', label: 'نوعِ عمل', options: defs.procedures },
    { key: 'diagnosisId', label: 'تشخیص', options: defs.diagnoses },
  ];

  return (
    <Overlay backdrop="db-overlay" panel="glass db-sheet db-advsheet" from="bottom" onClose={onClose}>
      <header className="db-sheet-head">
        <b>جستجوی پیشرفته</b>
        <button type="button" className="db-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
      </header>

      <div className="db-advbody">
        <div className="db-grid2">
          {FIELDS.map((fl) => (
            <label key={fl.key} className="db-field">
              <span>{fl.label}</span>
              <select value={f[fl.key] ?? ''} onChange={set(fl.key)}>
                <option value="">همه</option>
                {(fl.options ?? []).map((o) => (
                  <option key={o.id} value={o.id}>{o.name || o.title || o.displayName}</option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <div className="db-quickdates">
          <button type="button" onClick={() => pickRange('today')}>امروز</button>
          <button type="button" onClick={() => pickRange('week')}>این هفته</button>
          <button type="button" onClick={() => pickRange('month')}>این ماه</button>
          <button type="button" onClick={() => setF((s) => ({ ...s, fromJ: '', toJ: '' }))}>بدونِ بازه</button>
        </div>

        <div className="db-grid2">
          <JDate label="از تاریخ (شمسی)" value={f.fromJ}
            onChange={(v) => setF((s2) => ({ ...s2, fromJ: v }))} placeholder="۱۴۰۵/۰۱/۰۱" />
          <JDate label="تا تاریخ (شمسی)" value={f.toJ}
            onChange={(v) => setF((s2) => ({ ...s2, toJ: v }))} placeholder={todayJStr()} />
        </div>

        {/* فیلترِ مالی — تا فازِ حسابداری نبود چون «مانده» ستون ندارد. */}
        <label className="db-owing">
          <input type="checkbox" checked={!!f.owing} onChange={(e) => setF((s2) => ({ ...s2, owing: e.target.checked }))} />
          <span>فقط مراجعاتی که هنوز بدهی دارند</span>
        </label>
      </div>

      <footer className="db-sheet-foot">
        <button type="button" className="db-ghost" onClick={() => setF(EMPTY_ADV)}>پاک‌کردن</button>
        <button type="button" className="db-submit" disabled={invalid} onClick={() => onApply(f)}>اعمال</button>
      </footer>
    </Overlay>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  // brandName برای سربرگِ برگهٔ چاپ لازم است، پس کلِ config خوانده می‌شود نه فقط واژگان.
  const { t, brandName } = useConfig();
  const [visits, setVisits] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [kind, setKind] = useState('all');
  // فیلترِ پیشرفته، سورت و صفحه — همه در URL نیستند چون داشبورد صفحهٔ کاری است
  // نه لینکِ اشتراکی؛ اگر روزی لینکِ فیلتر لازم شد، همین شیء به query می‌رود.
  const [adv, setAdv] = useState(EMPTY_ADV);
  const [advOpen, setAdvOpen] = useState(false);
  const [sort, setSort] = useState('date');
  const [dir, setDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [meta, setMeta] = useState(EMPTY_META);
  const [modal, setModal] = useState(null); // null | {} | {visit}
  const [billing, setBilling] = useState(null); // مراجعه‌ای که صورت‌حسابش باز است
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

  const load = useCallback((query, st, kn, a = EMPTY_ADV, so = 'date', dr = 'desc', pg = 1, ps = 50) => {
    const params = new URLSearchParams();
    if (query?.trim()) params.set('q', query.trim());
    if (st && st !== 'all') params.set('status', st);
    if (kn && kn !== 'all') params.set('kind', kn);
    for (const key of ADV_IDS) if (a[key]) params.set(key, a[key]);
    // تاریخِ شمسیِ نامعتبر اصلاً فرستاده نمی‌شود؛ کاربر وسطِ تایپ نباید
    // فهرستش خالی شود.
    const from = a.fromJ ? jStrToIso(a.fromJ) : null;
    const to = a.toJ ? jStrToIso(a.toJ) : null;
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (a.owing) params.set('owing', '1');
    params.set('sort', so); params.set('dir', dr);
    params.set('page', String(pg)); params.set('pageSize', String(ps));
    return api(`/visits?${params}`)
      .then((res) => {
        setDenied(false);
        setVisits(res.rows);
        setMeta({ total: res.total, pages: res.pages, stats: res.stats ?? EMPTY_META.stats });
      })
      .catch((e) => {
        setVisits([]);
        setMeta(EMPTY_META);
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
    const t = setTimeout(() => load(q, status, kind, adv, sort, dir, page, pageSize), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, status, kind, adv, sort, dir, page, pageSize, load, user?.id]);

  // هر تغییرِ فیلتر کاربر را به صفحهٔ یک برمی‌گرداند؛ وگرنه در صفحهٔ ۴ فیلتری
  // می‌زند که سه صفحه بیشتر ندارد و فهرستِ خالی می‌بیند.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setPage(1);
  }, [q, status, kind, adv, sort, dir, pageSize]);

  useEffect(() => { loadDefs(); }, [loadDefs, user?.id]);

  // سوییچِ حساب وسطِ فرم/شیتِ باز → بسته شود
  useEffect(() => { setModal(null); }, [user?.id]);

  // آمار از سرور می‌آید و کلِ نتیجهٔ فیلترشده را می‌شمارد، نه صفحهٔ جاری را.
  const stats = meta.stats;

  /** نامِ خواندنیِ هر فیلترِ فعال — از همان تعریف‌هایی که در فرم انتخاب شدند. */
  const activeChips = useMemo(() => {
    const nameOf = (list, id, get) => get(list.find((r) => String(r.id) === String(id))) || `#${id}`;
    const out = [];
    if (adv.surgeonId) out.push({ key: 'surgeonId', label: `جراح: ${nameOf(defs.surgeons, adv.surgeonId, (r) => r?.name)}` });
    if (adv.hospitalId) out.push({ key: 'hospitalId', label: `بیمارستان: ${nameOf(defs.hospitals, adv.hospitalId, (r) => r?.name)}` });
    if (adv.techId) out.push({ key: 'techId', label: `کارشناس: ${nameOf(defs.techs, adv.techId, (r) => r?.name)}` });
    if (adv.procedureTypeId) out.push({ key: 'procedureTypeId', label: `نوعِ عمل: ${nameOf(defs.procedures, adv.procedureTypeId, (r) => r?.name)}` });
    if (adv.diagnosisId) out.push({ key: 'diagnosisId', label: `تشخیص: ${nameOf(defs.diagnoses, adv.diagnosisId, (r) => r?.title)}` });
    if (adv.fromJ) out.push({ key: 'fromJ', label: `از ${faDigits(adv.fromJ)}` });
    if (adv.toJ) out.push({ key: 'toJ', label: `تا ${faDigits(adv.toJ)}` });
    if (adv.owing) out.push({ key: 'owing', label: 'فقط بدهکار' });
    return out;
  }, [adv, defs]);
  const advCount = activeChips.length;
  const clearOne = (key) => setAdv((a) => ({ ...a, [key]: key === 'owing' ? false : '' }));

  /**
   * خروجی — ردیف‌ها از سرور و با همین فیلتر خوانده می‌شوند، نه از صفحهٔ جاری.
   *
   * با صفحه‌بندی، `visits` فقط یک صفحه است؛ خروجی گرفتن از آن یعنی کاربر فایلی
   * می‌گیرد که فکر می‌کند کلِ نتیجه است و نیست.
   */
  const [exporting, setExporting] = useState('');
  const runExport = async (mode) => {
    if (exporting) return;
    setExporting(mode);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (status !== 'all') params.set('status', status);
      if (kind !== 'all') params.set('kind', kind);
      for (const key of ADV_IDS) if (adv[key]) params.set(key, adv[key]);
      const from = adv.fromJ ? jStrToIso(adv.fromJ) : null;
      const to = adv.toJ ? jStrToIso(adv.toJ) : null;
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (adv.owing) params.set('owing', '1');
      params.set('sort', sort); params.set('dir', dir);

      const res = await api(`/visits/export?${params}`);
      if (!res.rows.length) { setToast('برای این فیلتر موردی نیست'); return; }

      const opts = {
        rows: res.rows,
        stats: res.stats,
        truncated: res.truncated,
        limit: res.limit,
        filterLabel: [
          q.trim() && `جستجو: ${q.trim()}`,
          status !== 'all' && `وضعیت: ${FILTERS.find((f) => f.v === status)?.l}`,
          kind !== 'all' && `نوع: ${kindOf(kind).label}`,
          ...activeChips.map((c) => c.label),
        ].filter(Boolean).join(' · '),
        kindLabel: (v) => kindOf(v.kind).label,
        statusLabel,
        brandName,
        title: `فهرستِ ${t.visits}`,
      };

      if (mode === 'csv') {
        const name = downloadCsv(visitsToCsv(res.rows, opts));
        setToast(res.truncated
          ? `${faNum(res.rows.length)} ردیف در «${name}» — نتیجه از سقفِ ${faNum(res.limit)} بیشتر بود`
          : `${faNum(res.rows.length)} ردیف در «${name}» ذخیره شد ✓`);
      } else if (!printVisits(res.rows, opts)) {
        setToast('پنجرهٔ چاپ مسدود شد — اجازهٔ پاپ‌آپ را برای این سایت بدهید');
      }
    } catch (e) { setToast(e.message); } finally { setExporting(''); }
  };
  const kindsPresent = stats.kinds ?? [];
  const showKindFilter = kind !== 'all' || kindsPresent.length > 1;

  const onSaved = (saved, wasEdit) => {
    setModal(null);
    load(qRef.current, status, kind);
    if (wasEdit) { setToast(`${t.visit} ویرایش شد ✓`); return; }

    // کاربر باید بفهمد مراجعه در کدام پرونده و با چه شماره‌ای نشست — به‌ویژه وقتی
    // کد ملی به پروندهٔ موجود خورده و پروندهٔ تکراری ساخته نشده است.
    const seq = faNum(saved.code.split('-V')[1] || '1');
    const where = `${t.record} ${saved.patientCode} — ${t.visit} ${seq}`;
    setToast({
      new: `${t.record}ِ جدید ساخته شد ✓ ${where}`,
      matched: `بیمار از قبل ${t.record} داشت؛ ${t.visit}ِ تازه ثبت شد ✓ ${where}`,
      restored: `${t.record}ِ حذف‌شده برگشت و ${t.visit}ِ تازه ثبت شد ✓ ${where}`,
      existing: `${t.visit} ثبت شد ✓ ${where}`,
    }[saved.patientStatus] ?? `${t.visit} ${saved.code} ثبت شد ✓`);
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
          <div className="glass db-stat"><b>{faNum(stats.total)}</b><span>{t.visit}</span></div>
          {/* برچسب‌ها کلی‌اند چون فهرست می‌تواند عمل و ویزیت و پیگیری را با هم داشته باشد؛
              وقتی روی یک نوع فیلتر شده، همان نوع را می‌گویند. */}
          <div className="glass db-stat"><b>{faNum(stats.pending)}</b><span>در انتظار</span></div>
          {stats.due > 0 && <div className="glass db-stat db-stat-due"><b>{faNum(stats.due)}</b><span>ماندهٔ کل</span></div>}
          <div className="glass db-stat db-stat-today"><b>{faNum(stats.today)}</b><span>{kind === 'all' ? 'امروز' : `${kindOf(kind).label}ِ امروز`}</span></div>
        </div>

        <div className="db-toolbar">
          <div className="db-search">
            <Search width="16" height="16" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t.searchHint}
              aria-label="جستجو"
            />
          </div>
          <button
            type="button"
            className={`db-ico db-advbtn${advCount ? ' on' : ''}`}
            title="جستجوی پیشرفته"
            onClick={() => setAdvOpen(true)}
          >
            <Filter width="17" height="17" />
            {advCount > 0 && <i>{faNum(advCount)}</i>}
          </button>
          {/* پیش‌تر این دکمه یک شیتِ کوچکِ خودش داشت که فقط نام و فامیلِ جراح را
              می‌گرفت — نسخهٔ ناقصی از صفحهٔ «تعاریف پایه» که تخصص و شمارهٔ
              نظام‌پزشکی و تلفن هم دارد. نتیجه‌اش جراحانِ نصفه‌کاره بود. حالا
              مستقیم به همان صفحه می‌رود؛ افزودنِ سریعِ داخلِ فرم (دکمهٔ +) سرِ
              جایش است، چون آن یکی در جریانِ کار است نه مدیریتِ فهرست. */}
          <Link to="/app/definitions" className="db-ico db-defbtn" title="تعاریف پایه (جراحان، بیمارستان‌ها، انواعِ عمل…)">
            <Gear width="17" height="17" />
          </Link>
          <button type="button" className="db-add" onClick={() => setModal({})}>
            <Plus width="17" height="17" /> {t.visitNew}
          </button>
        </div>

        <Tabs
          variant="inset"
          className="db-filters"
          label="وضعیت"
          value={status}
          onChange={setStatus}
          items={FILTERS.map((fl) => ({ key: fl.v, label: fl.l }))}
        />

        {/* فیلترِ نوع فقط وقتی دیده می‌شود که واقعاً بیش از یک نوع در کار باشد؛
            برای شرکتی که فقط عمل ثبت می‌کند، یک ردیفِ اضافه فقط شلوغی است.
            ⚠️ وقتی فیلتر فعال است حتماً می‌ماند، وگرنه لیست به یک نوع محدود
            می‌شد، ردیف ناپدید می‌گشت و راهِ برگشتی نبود. */}
        {showKindFilter && (
          <Tabs
            variant="inset"
            className="db-filters db-kindfilter"
            label={`نوعِ ${t.visit}`}
            value={kind}
            onChange={setKind}
            items={KIND_FILTERS
              .filter((fl) => kind !== 'all' || fl.v === 'all' || kindsPresent.includes(fl.v))
              .map((fl) => ({ key: fl.v, label: fl.l }))}
          />
        )}

        {/* چیپِ هر فیلترِ فعال با ضربدرِ خودش — کاربر باید بتواند یک فیلتر را
            بردارد بی‌آنکه پاپ‌آپ را باز کند یا همه را پاک کند. */}
        {activeChips.length > 0 && (
          <div className="db-chips">
            {activeChips.map((c) => (
              <button key={c.key} type="button" onClick={() => clearOne(c.key)}>
                {c.label}<Close width="12" height="12" />
              </button>
            ))}
            <button type="button" className="db-chip-clear" onClick={() => setAdv(EMPTY_ADV)}>پاک‌کردنِ همه</button>
          </div>
        )}

        <div className="db-sortbar">
          <label>
            <span>مرتب‌سازی</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORT_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="db-dir"
            title={dir === 'desc' ? 'نزولی' : 'صعودی'}
            onClick={() => setDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          >
            {dir === 'desc' ? '↓' : '↑'}
          </button>
          <span className="db-count">
            {meta.total > 0
              ? `${faNum((page - 1) * pageSize + 1)}–${faNum(Math.min(page * pageSize, meta.total))} از ${faNum(meta.total)}`
              : ''}
          </span>
          <button
            type="button" className="db-ico db-expbtn" title="خروجیِ CSV"
            disabled={!!exporting || !meta.total} onClick={() => runExport('csv')}
          >
            {exporting === 'csv' ? '…' : <Download width="16" height="16" />}
          </button>
          <button
            type="button" className="db-ico db-expbtn" title="چاپ"
            disabled={!!exporting || !meta.total} onClick={() => runExport('print')}
          >
            {exporting === 'print' ? '…' : <Print width="16" height="16" />}
          </button>
          <label className="db-psize">
            <span>در صفحه</span>
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{faNum(n)}</option>)}
            </select>
          </label>
        </div>
        </>)}

        <div className="us-list">
          {!denied && visits === null && <div className="us-empty">در حال بارگذاری…</div>}
          {denied && <div className="us-empty">دسترسیِ کافی برای این بخش ندارید — مدیرِ سامانه باید سطحِ شما را ارتقا دهد.</div>}
          {!denied && visits?.length === 0 && (
            <div className="us-empty">{q || status !== 'all' ? 'موردی مطابقِ جستجو پیدا نشد' : t.emptyList}</div>
          )}
          {visits?.map((v, i) => (
            <VisitCard
              key={v.id}
              v={v}
              index={i}
              busy={busyId === v.id}
              onEdit={(vv) => setModal({ visit: vv })}
              onStatus={onStatus}
              onDelete={onDelete}
              onBilling={setBilling}
            />
          ))}
        </div>

        {!denied && meta.pages > 1 && (
          <div className="db-pager">
            <button type="button" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>قبلی</button>
            <span>صفحهٔ {faNum(page)} از {faNum(meta.pages)}</span>
            <button type="button" disabled={page >= meta.pages} onClick={() => setPage((n) => n + 1)}>بعدی</button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {advOpen && (
          <AdvancedSearch
            value={adv}
            defs={defs}
            onApply={(next) => { setAdv(next); setAdvOpen(false); }}
            onClose={() => setAdvOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
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
      </AnimatePresence>


      <AnimatePresence>
        {billing && (
          <BillingSheet
            visit={billing}
            onClose={() => setBilling(null)}
            onChanged={() => load(qRef.current, status, kind)}
            onToast={setToast}
          />
        )}
      </AnimatePresence>

      <div className={`lx-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}
