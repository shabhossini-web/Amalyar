import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { faDate } from '../lib/jalali.js';
import { useStatusList } from './config.jsx';
import { useThings, ThingPopups } from './thing-popups.jsx';
import Overlay from '../ui/Overlay.jsx';
import { Alert, Back, Close, Waitlist as WaitlistIcon } from '../ui/icons.jsx';
import { useStagger } from '../ui/stagger.js';
import './waitlist.css';

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');

/**
 * **فهرستِ انتظارِ عمل** (بستهٔ ۹) — بیمارانی که تصمیمِ جراحی دارند و هنوز عملشان
 * انجام نشده، به ترتیبِ طولِ انتظار.
 *
 * ⚠️ هیچ وضعیتی این‌جا ساخته نمی‌شود: ردیف، برچسب، فاصلهٔ انتظار و آمار همه از سرور
 * (قانونِ ۱۵). کارهای هر ردیف را هم سرور می‌گوید (`can`) — صفحه فقط نشان می‌دهد.
 */
export default function Waitlist() {
  const stagger = useStagger();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('all');
  const [surgeon, setSurgeon] = useState('');
  const [toast, setToast] = useState('');
  const [closing, setClosing] = useState(null); // ردیفِ «بستنِ تصمیم»
  const states = useStatusList('waitlist');

  useEffect(() => { document.title = 'فهرستِ انتظارِ عمل — عمل‌یار'; }, []);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t); }, [toast]);

  const load = useCallback(async () => {
    try { setData(await api('/waitlist')); setErr(''); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const things = useThings({ onChanged: load, toast: (m) => setToast(m) });

  const rows = data?.rows ?? [];
  const surgeons = useMemo(() => [...new Set(rows.map((r) => r.surgeon).filter(Boolean))], [rows]);
  /* فیلترِ جراحی که دیگر در فهرست نیست خودبه‌خود کنار می‌رود — وگرنه صفحهٔ خالی بی‌راهِ برگشت (بازبینی). */
  const sel = surgeons.includes(surgeon) ? surgeon : '';
  const bySurgeon = rows.filter((r) => !sel || r.surgeon === sel);
  /* «همه» تصمیم‌های بسته‌شده را نشان نمی‌دهد؛ آن‌ها تبِ خودشان را دارند. */
  const shown = bySurgeon.filter((r) => (tab === 'all' ? r.state !== 'closed' : r.state === tab));
  const count = (k) => bySurgeon.filter((r) => (k === 'all' ? r.state !== 'closed' : r.state === k)).length;
  const s = data?.stats;
  const reopen = async (r) => {
    try { await api(`/waitlist/decisions/${r.decision.visitId}/reopen`, { method: 'POST', body: {} }); setToast('تصمیم دوباره باز شد'); load(); }
    catch (e) { setToast(e.message); }
  };

  /* «برنامهٔ عمل»: فرمِ عملِ تازه، گره‌خورده به همان ویزیتِ تصمیم، در حالتِ بی‌تاریخ. */
  const plan = (r) => things.show({ type: 'visit', prefill: {
    patientId: r.patient.id, patientName: r.patient.fullName, kind: 'surgery', surgeonId: r.surgeonId ?? null,
    decidedInVisitId: r.decision.visitId, decidedInDate: r.decision.date, undated: true,
  } });

  return (
    <div className="wl">
      <div className="wl-bg" aria-hidden="true" />
      <header className="wl-head">
        <Link to="/app" className="wl-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1><WaitlistIcon width="20" height="20" /> فهرستِ انتظارِ عمل</h1>
          <p>
            بیمارانی که تصمیمِ جراحی دارند و هنوز عمل نشده‌اند — طولانی‌ترین انتظار بالا.
            {data?.scoped ? ' فقط بیمارانِ خودتان.' : ''}
          </p>
        </div>
      </header>

      {err && <div className="wl-err"><Alert width="15" height="15" /> {err}</div>}

      {s && (
        <section className="wl-stats" aria-label="آمار">
          {states.filter((st) => st.key !== 'closed').map((st) => (
            <div key={st.key}><b>{faNum(s[st.key])}</b><span>{st.label}</span></div>
          ))}
          <div><b>{s.medianWaitDays == null ? '—' : faNum(s.medianWaitDays)}</b><span>میانهٔ انتظار (روز)</span></div>
          <div title="عمل‌های انجام‌شدهٔ ۱۸۰ روزِ اخیر که به ویزیتِ تصمیم گره خورده‌اند">
            <b>{s.decisionToSurgery?.medianDays == null ? '—' : faNum(s.decisionToSurgery.medianDays)}</b>
            <span>تصمیم تا عمل (روز){s.decisionToSurgery?.n ? ` · ${faNum(s.decisionToSurgery.n)} عمل` : ''}</span>
          </div>
        </section>
      )}

      <div className="wl-bar">
        <nav className="wl-tabs" role="radiogroup" aria-label="وضعیت">
          {[{ key: 'all', label: 'همه' }, ...states].map((t) => (
            <button key={t.key} type="button" role="radio" aria-checked={tab === t.key}
                    className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
              {t.label}<i>{faNum(count(t.key))}</i>
            </button>
          ))}
        </nav>
        {surgeons.length > 1 && (
          <nav className="wl-tabs wl-surgeons" role="radiogroup" aria-label="جراح">
            {['', ...surgeons].map((n) => (
              <button key={n || 'all'} type="button" role="radio" aria-checked={sel === n}
                      className={sel === n ? 'on' : ''} onClick={() => setSurgeon(n)}>{n || 'همهٔ جراحان'}</button>
            ))}
          </nav>
        )}
      </div>

      {data === null && !err && <div className="wl-empty">در حال بارگذاری…</div>}
      {data && shown.length === 0 && <div className="wl-empty">در این وضعیت بیماری نیست</div>}
      {data?.truncated && <p className="wl-note">فقط {faNum(data.cap)} ردیفِ اول نشان داده شده است.</p>}

      <div className="wl-list">
        {shown.map((r, i) => (
          <motion.article key={r.key} {...stagger(i)} className={`wl-row st-${r.state}`} data-wl-row={r.key}>
            <div className="wl-row-head">
              <b>{r.patient.fullName}</b>
              <em dir="ltr">{r.patient.code}</em>
              <i className={`wl-tag s-${r.state}`}>{r.stateFa}</i>
              <span className="wl-days" title={r.waitStartApprox ? 'از تاریخِ ثبت (تقریبی)' : 'از روزِ تصمیم'}>
                {faNum(r.waitingDays)} روز انتظار{r.waitStartApprox ? '*' : ''}
              </span>
            </div>
            <dl className="wl-facts">
              {r.decision && (<div><dt>تصمیم</dt><dd>{faDate(r.decision.date)}{r.decision.diagnosis ? ` — ${r.decision.diagnosis}` : ''}</dd></div>)}
              {r.surgery?.procedure && (<div><dt>عمل</dt><dd>{r.surgery.procedure}{r.surgery.sides ? ` (${r.surgery.sides})` : ''}</dd></div>)}
              {r.surgeon && (<div><dt>جراح</dt><dd>{r.surgeon}</dd></div>)}
              {r.surgery?.hospital && (<div><dt>بیمارستان</dt><dd>{r.surgery.hospital}</dd></div>)}
              {r.surgery?.opDate && (<div><dt>تاریخِ عمل</dt><dd>{faDate(r.surgery.opDate)}</dd></div>)}
              {!r.surgery?.opDate && r.surgery?.plannedDate && (<div><dt>تاریخِ تقریبی</dt><dd>{faDate(r.surgery.plannedDate)}</dd></div>)}
              {r.lastCancelReasonFa && (<div><dt>لغوِ قبلی</dt><dd>{r.lastCancelReasonFa}</dd></div>)}
              {r.state === 'closed' && (<div><dt>بسته شد</dt><dd>{faDate(r.closedAt)}{r.closeReasonFa ? ` — ${r.closeReasonFa}` : ''}</dd></div>)}
            </dl>
            <div className="wl-acts">
              {r.state === 'awaiting' && data.can?.plan && (
                <button type="button" className="wl-act primary" data-act="plan" onClick={() => plan(r)}>برنامهٔ عمل</button>
              )}
              {r.surgery && data.can?.edit && (
                <button type="button" className="wl-act" data-act="open" onClick={() => things.open({ type: 'visit', id: r.surgery.id, patientId: r.patient.id })}>
                  {r.state === 'planned' ? 'تعیینِ تاریخ' : 'بازکردنِ عمل'}
                </button>
              )}
              {r.state === 'awaiting' && data.can?.manage && (
                <button type="button" className="wl-act ghost" data-act="close" onClick={() => setClosing(r)}>بستنِ تصمیم</button>
              )}
              {r.state === 'closed' && data.can?.manage && (
                <button type="button" className="wl-act" data-act="reopen" onClick={() => reopen(r)}>بازکردنِ تصمیم</button>
              )}
            </div>
          </motion.article>
        ))}
      </div>

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
      <div className={`wl-toast${toast ? ' on' : ''}`} role="status">{toast}</div>
    </div>
  );
}

/** بستنِ تصمیمِ جراحی با دلیل — برگشت‌پذیر (بازکردن از همین API). */
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
        <b>بستنِ تصمیمِ جراحی — {row.patient.fullName}</b>
        <button type="button" className="wl-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
      </header>
      <div className="wl-reasons" role="radiogroup" aria-label="دلیل">
        {reasons.map((o) => (
          <button key={o.key} type="button" role="radio" aria-checked={reason === o.key}
                  className={reason === o.key ? 'on' : ''} onClick={() => setReason(o.key)}>{o.label}</button>
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
