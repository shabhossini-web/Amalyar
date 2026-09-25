import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import WorkRow from './WorkRow.jsx';
import { Bell } from '../ui/icons.jsx';
import './work.css';

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');

/** رویدادی که هر جای اپ بعد از تغییرِ یک کار می‌فرستد تا شمارنده تازه شود. */
export const WORK_CHANGED = 'amalyar:work-changed';

/**
 * زنگِ کارها — شمارندهٔ `GET /work/counts` (هر ۶۰ ثانیه، با برگشتِ تب، و با رویدادِ
 * `WORK_CHANGED`) + کشوی هشت کارِ اولِ صفِ «من». ۴۰۳ یعنی ماژولِ `work` برای این
 * کاربر خاموش است → زنگ اصلاً رندر نمی‌شود، نه اینکه خطا بدهد.
 *
 * **نمای تیم** (سوپرادمین، قانونِ ۲۹): سرور `team` می‌گوید و شمار همان «کارِ بازِ
 * تیم»ِ چیپِ صفحهٔ «امروز» است — دو عددِ متفاوت برای یک چیز یعنی یکی دروغ می‌گوید.
 * کشو «عقب‌افتاده اول» می‌چیند (`sort=overdue`): زنگ برای «چه چیزی از دست رفته»
 * است، و در صفِ همه، کارِ کم‌اولویتِ سه‌روز‌عقب‌افتاده زیرِ کارهای پراولویتِ فردا گم
 * می‌شد. هر ردیف می‌گوید مالِ کیست؛ واگذاری عمداً این‌جا نیست (کشوی کوچکِ زنگ جای
 * فهرستِ افراد نیست) — در «امروز» و «کارهای من» است.
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

  const team = counts?.team === true;
  useEffect(() => {
    if (!open) return;
    setRows(null);
    api(`/work?scope=inbox&limit=8${team ? '&sort=overdue' : ''}`).then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([]));
  }, [open, team]);

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
      onToast?.(action === 'done' ? 'انجام شد' : 'به فردا موکول شد');
    } catch (e) {
      onToast?.(e?.message || 'انجام نشد');
    } finally {
      setBusy(0);
    }
  };

  if (!enabled) return null;
  const total = counts?.total ?? 0;
  const overdue = counts?.overdue ?? 0;
  const heading = team ? 'کارهای تیم' : 'کارهای من';

  return (
    <div className="wb" ref={ref}>
      <button
        type="button" id="wb-btn" className={`wb-btn${overdue > 0 ? ' hot' : ''}`}
        aria-label={total ? `${team ? 'کارهای تیم' : 'کارها'}: ${faNum(total)}${overdue ? `، ${faNum(overdue)} عقب‌افتاده` : ''}` : 'کارها'}
        aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}
      >
        <Bell width="20" height="20" />
        {total > 0 && <span className="wb-badge" data-count={total}>{faNum(total)}</span>}
      </button>
      {open && (
        <div className="wb-menu" role="dialog" aria-label={heading}>
          <div className="wb-head">
            <b>{heading}</b>
            <span className="wb-counts">
              {team
                ? <>{faNum(total)} کارِ باز · {faNum(counts?.mine ?? 0)} به نامِ من</>
                : <>{faNum(counts?.mine ?? 0)} به نامِ من · {faNum(counts?.role ?? 0)} در صفِ نقش</>}
              {overdue > 0 && <> · <em>{faNum(overdue)} عقب‌افتاده</em></>}
            </span>
          </div>
          {rows === null && <div className="wb-empty">در حال بارگذاری…</div>}
          {rows && rows.length === 0 && <div className="wb-empty">{team ? 'تیم کارِ بازی ندارد.' : 'کاری منتظرِ شما نیست.'}</div>}
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
