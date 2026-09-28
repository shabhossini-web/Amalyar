import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { faDate } from '../lib/jalali.js';
import { useStatusList, useTerms } from './config.jsx';
import { useThings, ThingPopups } from './thing-popups.jsx';
import { surgeryPrefill } from './VisitForm.jsx';
import Overlay from '../ui/Overlay.jsx';
import Tabs from '../ui/Tabs.jsx';
import Pick from '../ui/Pick.jsx';
import { Alert, Back, Close, Doctor, Refresh, Waitlist as WaitlistIcon } from '../ui/icons.jsx';
import './waitlist.css';

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');

/** شدتِ انتظار — فقط برای رنگِ کم‌رنگِ نشان؛ خودِ عدد همیشه نوشته می‌شود (رنگ تنها نشانه نیست). */
const waitTone = (d) => (d >= 90 ? 'long' : d >= 30 ? 'mid' : 'short');

/**
 * **فهرستِ انتظارِ عمل** (بستهٔ ۹، طرحِ دوباره روی ساختارِ امروز) — بیمارانی که در ویزیت «کاندیدای
 * جراحی» خورده‌اند و هنوز عمل نشده‌اند، طولانی‌ترین انتظار بالا.
 *
 * ⚠️ هیچ وضعیتی این‌جا ساخته نمی‌شود: ردیف، برچسب، روزهای انتظار، آمار و کارهای مجازِ هر ردیف
 * (`can`) همه از سرور می‌آیند (قانونِ ۱۵). پزشک فقط بیمارانِ خودش را می‌بیند و سوپرادمین همه را،
 * با نامِ پزشکِ هر ردیف (قانونِ ۲۹) — تصمیمش با سرور است (`team`).
 */
export default function Waitlist() {
  const t = useTerms();
  const states = useStatusList('waitlist');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('open');
  const [surgeonId, setSurgeonId] = useState(null);
  const [toast, setToast] = useState('');
  const [closing, setClosing] = useState(null);

  useEffect(() => { document.title = 'فهرستِ انتظارِ عمل — عمل‌یار'; }, []);
  useEffect(() => { if (!toast) return undefined; const x = setTimeout(() => setToast(''), 2600); return () => clearTimeout(x); }, [toast]);

  const load = useCallback(async () => {
    try { setData(await api('/waitlist')); setErr(''); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const things = useThings({ onChanged: load, toast: (m) => setToast(m) });

  const rows = data?.rows ?? [];
  /* فهرستِ پزشک‌ها از خودِ ردیف‌ها — فیلترِ پزشکی که دیگر ردیفی ندارد خودبه‌خود کنار می‌رود. */
  const surgeons = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => { if (r.surgeonId && !m.has(r.surgeonId)) m.set(r.surgeonId, { id: r.surgeonId, name: r.surgeon }); });
    return [...m.values()];
  }, [rows]);
  const sel = surgeons.some((s) => s.id === surgeonId) ? surgeonId : null;
  const mine = rows.filter((r) => !sel || r.surgeonId === sel);
  const inTab = (r, k) => (k === 'open' ? r.state !== 'closed' : r.state === k);
  const shown = mine.filter((r) => inTab(r, tab));
  const s = data?.stats;

  const reopen = async (r) => {
    try {
      await api(`/waitlist/decisions/${r.decision.visitId}/reopen`, { method: 'POST', body: {} });
      setToast('تصمیم دوباره باز شد'); load();
    } catch (e) { setToast(e.message); }
  };
  /* «برنامهٔ عمل»: فرمِ عملِ تازه، گره‌خورده به همان ویزیتِ تصمیم، در حالتِ «هنوز تاریخ ندارد». */
  const plan = (r) => things.show({ type: 'visit', prefill: {
    ...surgeryPrefill({
      id: r.decision.visitId, patientId: r.patient.id, surgeonId: r.surgeonId ?? null,
      chiefComplaint: r.decision.chiefComplaint ?? '', opDate: r.decision.date,
    }, r.patient.fullName),
    undated: true,
  } });

  const tabs = [
    { key: 'open', label: <>همه <b className="wl-n">{faNum(mine.filter((r) => inTab(r, 'open')).length)}</b></> },
    ...states.map((st) => ({ key: st.key, label: <>{st.label} <b className="wl-n">{faNum(mine.filter((r) => inTab(r, st.key)).length)}</b></> })),
  ];
  const emptyText = {
    open: 'هیچ بیماری در انتظارِ عمل نیست.',
    awaiting: 'بیماری با تصمیمِ جراحی که هنوز برنامه نگرفته باشد نیست.',
    planned: 'عملِ ثبت‌شده‌ای که هنوز تاریخ نگرفته باشد نیست.',
    booked: 'عملِ تاریخ‌داری که هنوز انجام نشده باشد نیست.',
    closed: 'تصمیمی بسته نشده است.',
  }[tab];

  return (
    <div className="wl">
      <div className="wl-bg" aria-hidden="true" />
      <header className="wl-head">
        <Link to="/app" className="wl-back"><Back width="15" height="15" aria-hidden="true" /> سامانه</Link>
        <div className="wl-title">
          <div>
            <h1><WaitlistIcon width="20" height="20" aria-hidden="true" /> فهرستِ انتظارِ عمل</h1>
            <p>
              بیمارانی که در {t.visit} «کاندیدای جراحی» شده‌اند و هنوز عمل نشده‌اند — طولانی‌ترین انتظار بالا.
              {data && !data.team ? ' فقط بیمارانِ خودتان.' : ''}
            </p>
          </div>
          {data?.team && surgeons.length > 1 && (
            <div className="wl-who">
              <span className="wl-who-l" id="wl-who-l"><Doctor width="14" height="14" aria-hidden="true" /> پزشک</span>
              <Pick
                label="پزشک" value={sel} onChange={setSurgeonId} options={surgeons}
                placeholder="همهٔ پزشک‌ها" clearable
              />
            </div>
          )}
        </div>
      </header>

      {err && (
        <div className="wl-err" role="alert">
          <Alert width="15" height="15" aria-hidden="true" /> {err}
          <button type="button" className="wl-retry" onClick={load}><Refresh width="14" height="14" aria-hidden="true" /> دوباره</button>
        </div>
      )}

      {s && (
        <section className="wl-kpis" aria-label="آمارِ انتظار">
          <div className="wl-kpi">
            <b>{s.medianWaitDays == null ? '—' : faNum(s.medianWaitDays)}<small>روز</small></b>
            <span>میانهٔ انتظارِ بیمارانِ همین فهرست</span>
          </div>
          <div className="wl-kpi">
            <b>{s.decisionToSurgery?.medianDays == null ? '—' : faNum(s.decisionToSurgery.medianDays)}<small>روز</small></b>
            <span>
              از تصمیم تا عمل
              {s.decisionToSurgery?.n ? ` — میانهٔ ${faNum(s.decisionToSurgery.n)} عملِ شش ماهِ اخیر` : ' — هنوز عملِ انجام‌شده‌ای نیست'}
            </span>
          </div>
        </section>
      )}

      <Tabs label="وضعیتِ انتظار" variant="scroll" className="wl-tabs" value={tab} onChange={setTab} items={tabs} />

      {data === null && !err && (
        <div className="wl-list" aria-busy="true" aria-label="در حالِ بارگذاری">
          {[0, 1, 2].map((i) => <div key={i} className="wl-row wl-skel" aria-hidden="true"><i /><i /><i /></div>)}
        </div>
      )}
      {data && shown.length === 0 && <p className="wl-empty">{emptyText}</p>}
      {data?.truncated && <p className="wl-note">فقط {faNum(data.cap)} ردیفِ اول نشان داده شده است.</p>}

      {data && shown.length > 0 && (
        <ul className="wl-list">
          {shown.map((r) => (
            <li key={r.key} className={`wl-row st-${r.state}`} data-wl-row={r.key}>
              <div className="wl-row-head">
                <button type="button" className="wl-name" onClick={() => things.open({ type: 'visit', id: r.surgery?.id ?? r.decision?.visitId, patientId: r.patient.id })}>
                  {r.patient.fullName}
                </button>
                <em dir="ltr">{r.patient.code}</em>
                <i className={`wl-tag s-${r.state}`}>{r.stateFa}</i>
                {r.state !== 'closed' && (
                  <span className={`wl-days d-${waitTone(r.waitingDays)}`} title={r.waitStartApprox ? 'از روزِ ثبتِ عمل (ویزیتِ تصمیم ندارد)' : 'از روزِ ویزیتِ تصمیم'}>
                    <b>{faNum(r.waitingDays)}</b> روز انتظار{r.waitStartApprox ? '*' : ''}
                  </span>
                )}
              </div>
              <p className="wl-facts">
                {r.decision && <span><em>تصمیم</em> {faDate(r.decision.date)}{r.decision.diagnosis ? ` — ${r.decision.diagnosis}` : ''}</span>}
                {r.surgery?.procedure && <span><em>عمل</em> {r.surgery.procedure}{r.surgery.sides ? ` (${r.surgery.sides})` : ''}</span>}
                {r.surgery?.opDate && <span><em>تاریخِ عمل</em> {faDate(r.surgery.opDate)}</span>}
                {!r.surgery?.opDate && r.surgery?.plannedDate && <span><em>تاریخِ تقریبی</em> {faDate(r.surgery.plannedDate)}</span>}
                {r.surgery?.hospital && <span><em>مرکز</em> {r.surgery.hospital}</span>}
                {data.team && r.surgeon && <span className="wl-owner"><em>پزشک</em> {r.surgeon}</span>}
                {r.lastCancelReasonFa && <span className="wl-warn"><em>عملِ قبلی لغو شد</em> {r.lastCancelReasonFa}</span>}
                {r.state === 'closed' && <span><em>بسته شد</em> {faDate(r.closedAt)}{r.closeReasonFa ? ` — ${r.closeReasonFa}` : ''}</span>}
              </p>
              <div className="wl-acts">
                {r.state === 'awaiting' && data.can?.plan && (
                  <button type="button" className="wl-act primary" data-act="plan" onClick={() => plan(r)}>برنامهٔ عمل</button>
                )}
                {r.surgery && data.can?.edit && (
                  <button type="button" className={`wl-act${r.state === 'planned' ? ' primary' : ''}`} data-act="open"
                          onClick={() => things.open({ type: 'visit', id: r.surgery.id, patientId: r.patient.id })}>
                    {r.state === 'planned' ? 'تعیینِ تاریخ' : 'بازکردنِ فرمِ عمل'}
                  </button>
                )}
                {r.state === 'awaiting' && data.can?.manage && (
                  <button type="button" className="wl-act ghost" data-act="close" onClick={() => setClosing(r)}>بستنِ تصمیم</button>
                )}
                {r.state === 'closed' && data.can?.manage && (
                  <button type="button" className="wl-act" data-act="reopen" onClick={() => reopen(r)}>بازکردنِ دوبارهٔ تصمیم</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <AnimatePresence>
        {closing && (
          <CloseDialog
            row={closing}
            onClose={() => setClosing(null)}
            onDone={(m) => { setClosing(null); setToast(m); load(); }}
            onError={(m) => setToast(m)}
          />
        )}
      </AnimatePresence>
      <ThingPopups things={things} />
      <div className={`wl-toast${toast ? ' on' : ''}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}

/** بستنِ تصمیمِ جراحی با دلیل — برگشت‌پذیر («بازکردنِ دوبارهٔ تصمیم»). */
function CloseDialog({ row, onClose, onDone, onError }) {
  const reasons = useStatusList('decisionClose');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!reason || busy) return;
    setBusy(true);
    try {
      await api(`/waitlist/decisions/${row.decision.visitId}/close`, { method: 'POST', body: { reason } });
      onDone('تصمیم بسته شد — بیمار از فهرست بیرون رفت');
    } catch (e) { onError(e.message); } finally { setBusy(false); }
  };
  return (
    <Overlay backdrop="wl-overlay" panel="wl-dialog" from="center" closable={!busy} onClose={onClose} aria-label="بستنِ تصمیمِ جراحی">
      <header className="wl-dialog-head">
        <div>
          <b>بستنِ تصمیمِ جراحی</b>
          <small>{row.patient.fullName}{row.decision?.date ? ` — تصمیمِ ${faDate(row.decision.date)}` : ''}</small>
        </div>
        <button type="button" className="wl-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
      </header>
      <p className="wl-dialog-hint">بیمار از فهرست بیرون می‌رود؛ هر وقت لازم شد از تبِ «بسته‌شده» برمی‌گردد.</p>
      <div className="wl-reasons" role="radiogroup" aria-label="دلیلِ بستن">
        {reasons.map((o) => (
          <button key={o.key} type="button" role="radio" aria-checked={reason === o.key}
                  className={reason === o.key ? 'on' : ''} onClick={() => setReason(o.key)}>
            <span className="wl-dot" aria-hidden="true" />
            <span><b>{o.label}</b>{o.hint && <small>{o.hint}</small>}</span>
          </button>
        ))}
      </div>
      <div className="wl-dialog-acts">
        <button type="button" className="wl-act" onClick={onClose} disabled={busy}>انصراف</button>
        <button type="button" className="wl-act primary" data-act="close-confirm" onClick={submit} disabled={!reason || busy}>
          {busy ? 'در حالِ ثبت…' : 'بستنِ تصمیم'}
        </button>
      </div>
    </Overlay>
  );
}
