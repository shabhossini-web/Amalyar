import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import WorkRow from './WorkRow.jsx';
import './work.css';

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');

/* آیکونِ خطیِ زنگ — همان قراردادِ `src/ui/icons.jsx` (stroke=currentColor)؛ این‌جا
   محلی است تا فایلِ آیکون‌ها (لِینِ ب) دست نخورد. W3.7 می‌تواند منتقلش کند. */
const Bell = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true" {...p}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" />
  </svg>
);

/** رویدادی که هر جای اپ بعد از تغییرِ یک کار می‌فرستد تا شمارنده تازه شود. */
export const WORK_CHANGED = 'amalyar:work-changed';

/**
 * زنگِ کارها — شمارندهٔ `GET /work/counts` (هر ۶۰ ثانیه، با برگشتِ تب، و با رویدادِ
 * `WORK_CHANGED`) + کشوی هشت کارِ اولِ صفِ «من». ۴۰۳ یعنی ماژولِ `work` برای این
 * کاربر خاموش است → زنگ اصلاً رندر نمی‌شود، نه اینکه خطا بدهد.
 */
export default function WorkBell({ onToast }) {
  const [counts, setCounts] = useState(null);
  const [enabled, setEnabled] = useState(true);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(0);
  const ref = useRef(null);

  const load = useCallback(() => {
    api('/work/counts').then(setCounts).catch((e) => { if (e?.status === 403) setEnabled(false); });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener(WORK_CHANGED, load);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); window.removeEventListener(WORK_CHANGED, load); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    setRows(null);
    api('/work?scope=inbox&limit=8').then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const act = async (w, action, body = {}) => {
    setBusy(w.id);
    try {
      await api(`/work/${w.id}`, { method: 'PATCH', body: { action, ...body } });
      setRows((r) => (r ?? []).filter((x) => x.id !== w.id));
      window.dispatchEvent(new Event(WORK_CHANGED));
      onToast?.(action === 'done' ? 'انجام شد ✓' : 'به فردا موکول شد');
    } catch (e) {
      onToast?.(e?.message || 'انجام نشد');
    } finally {
      setBusy(0);
    }
  };

  if (!enabled) return null;
  const total = counts?.total ?? 0;
  const overdue = counts?.overdue ?? 0;

  return (
    <div className="wb" ref={ref}>
      <button
        type="button" id="wb-btn" className={`wb-btn${overdue > 0 ? ' hot' : ''}`}
        aria-label={total ? `کارها: ${faNum(total)}${overdue ? `، ${faNum(overdue)} عقب‌افتاده` : ''}` : 'کارها'}
        aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}
      >
        <Bell />
        {total > 0 && <span className="wb-badge" data-count={total}>{faNum(total)}</span>}
      </button>
      {open && (
        <div className="wb-menu" role="dialog" aria-label="کارهای من">
          <div className="wb-head">
            <b>کارهای من</b>
            <span className="wb-counts">
              {faNum(counts?.mine ?? 0)} به نامِ من · {faNum(counts?.role ?? 0)} در صفِ نقش{overdue > 0 && <> · <em>{faNum(overdue)} عقب‌افتاده</em></>}
            </span>
          </div>
          {rows === null && <div className="wb-empty">در حال بارگذاری…</div>}
          {rows && rows.length === 0 && <div className="wb-empty">کاری منتظرِ شما نیست ✓</div>}
          {rows && rows.length > 0 && (
            <ul className="wk-list compact">
              {rows.map((w) => <WorkRow key={w.id} w={w} onAct={act} busy={busy} compact />)}
            </ul>
          )}
          <Link to="/app/work" className="wb-all" onClick={() => setOpen(false)}>همهٔ کارها</Link>
        </div>
      )}
    </div>
  );
}
