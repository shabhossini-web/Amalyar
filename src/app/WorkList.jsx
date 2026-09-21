import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import WorkRow from './WorkRow.jsx';
import { ThingPopups, useThings, workTarget } from './thing-popups.jsx';
import { WORK_CHANGED } from './WorkBell.jsx';
import { Back } from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import './shell.css';
import './work.css';

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');
const SCOPES = [
  { key: 'inbox', label: 'همه' },
  { key: 'overdue', label: 'عقب‌افتاده' },
  { key: 'mine', label: 'به نامِ من' },
  { key: 'role', label: 'صفِ نقشِ من' },
];
const dueOf = (v) => {
  if (v === 'today') { const d = new Date(); d.setHours(18, 0, 0, 0); return d.toISOString(); }
  if (v === 'tomorrow') { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); }
  return undefined;
};

/**
 * «کارهای من» — فهرستِ کاملِ صفِ کار (W2.4). صفحهٔ «امروز» (W2.3) روی همین می‌نشیند.
 * سوپروایزر و بالاتر تبِ «همهٔ کارها» را هم دارد (`scope=all`).
 */
export default function WorkList() {
  const { user } = useAuth();
  const [scope, setScope] = useState('inbox');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(0);
  const [toast, setToast] = useState('');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const supervisor = (user?.level ?? 0) >= 4;

  useEffect(() => { document.title = 'کارهای من — عمل‌یار'; }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 1800); return () => clearTimeout(t); }, [toast]);

  const load = useCallback(() => {
    const q = scope === 'overdue' ? 'scope=inbox&due=overdue' : `scope=${scope}`;
    api(`/work?${q}&limit=200`).then((r) => setRows(Array.isArray(r) ? r : [])).catch((e) => { setRows([]); setToast(e?.message || 'بارگذاری نشد'); });
  }, [scope]);
  useEffect(() => { setRows(null); load(); }, [load]);
  /* عنوانِ کارِ مقصددار پاپ‌آپِ همان سفارش/مراجعه را باز می‌کند — همان که صفحهٔ
     «امروز» و پرونده دارند (بازخوردِ مالک). بعد از ثبت، فهرست و زنگ تازه می‌شوند. */
  const things = useThings({
    onChanged: () => { load(); window.dispatchEvent(new Event(WORK_CHANGED)); },
    toast: (m) => setToast(m),
  });

  const act = async (w, action, body = {}) => {
    setBusy(w.id);
    try {
      await api(`/work/${w.id}`, { method: 'PATCH', body: { action, ...body } });
      setRows((r) => (r ?? []).filter((x) => x.id !== w.id));
      window.dispatchEvent(new Event(WORK_CHANGED));
      setToast(action === 'done' ? 'انجام شد ✓' : 'به فردا موکول شد');
    } catch (e) {
      setToast(e?.message || 'انجام نشد');
    } finally {
      setBusy(0);
    }
  };

  const create = async (e) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    try {
      await api('/work', { method: 'POST', body: { title: t, dueAt: dueOf(due) } });
      setTitle(''); setDue('');
      window.dispatchEvent(new Event(WORK_CHANGED));
      setToast('کار ثبت شد ✓');
      load();
    } catch (err) {
      setToast(err?.message || 'ثبت نشد');
    }
  };

  return (
    <div className="wk-page">
      <header className="wk-head">
        <Link to="/app" className="wk-back"><Back width="15" height="15" /> سامانه</Link>
        <h1>کارهای من</h1>
      </header>

      <form className="wk-new" onSubmit={create}>
        <input id="wk-new-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="یادداشتِ کاری برای خودم… (مثلاً تماس با بیمارِ فلان)" maxLength={160} />
        <select id="wk-new-due" value={due} onChange={(e) => setDue(e.target.value)} aria-label="مهلت">
          <option value="">بدونِ مهلت</option>
          <option value="today">امروز</option>
          <option value="tomorrow">فردا</option>
        </select>
        <button type="submit" className="wk-btn primary" disabled={!title.trim()}>ثبت</button>
      </form>

      <Tabs
        variant="scroll" className="wk-tabs" label="دامنه" value={scope} onChange={setScope}
        items={[...SCOPES, ...(supervisor ? [{ key: 'all', label: 'همهٔ کارها' }] : [])]}
      />

      {rows === null && <div className="wk-empty">در حال بارگذاری…</div>}
      {rows && rows.length === 0 && <div className="wk-empty">کاری در این دامنه نیست ✓</div>}
      {rows && rows.length > 0 && (
        <>
          <div className="wk-count">{faNum(rows.length)} کار</div>
          <ul className="wk-list">
            {rows.map((w) => (
              <WorkRow key={w.id} w={w} onAct={act} busy={busy} onOpen={workTarget(w) ? () => things.open(workTarget(w)) : undefined} />
            ))}
          </ul>
        </>
      )}
      <ThingPopups things={things} />
      {toast && <div className="sh-toast" role="status">{toast}</div>}
    </div>
  );
}
