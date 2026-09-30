import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import WorkRow from './WorkRow.jsx';
import { ThingPopups, useThings, workTarget } from './thing-popups.jsx';
import { WORK_CHANGED } from './WorkBell.jsx';
import { Bell } from '../ui/icons.jsx';
import PageHeader from '../ui/PageHeader.jsx';
import Tabs from '../ui/Tabs.jsx';
import './shell.css';
import './work.css';
import Toast, { useToast } from '../ui/Toast.jsx';

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');
const NONE = [];
const dueOf = (v) => {
  if (v === 'today') { const d = new Date(); d.setHours(18, 0, 0, 0); return d.toISOString(); }
  if (v === 'tomorrow') { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); }
  return undefined;
};

/**
 * «کارهای من» — فهرستِ کاملِ صفِ کار (W2.4). صفحهٔ «امروز» (W2.3) روی همین می‌نشیند.
 * سوپروایزر و بالاتر تبِ «همهٔ کارها» را هم دارد (`scope=all`).
 *
 * **نمای تیم** (سوپرادمین، قانونِ ۲۹): سرور در `GET /work/counts?owners=1` می‌گوید
 * `team` و دسته‌های «مالِ کیست» را می‌دهد. تب‌ها راست می‌گویند: «همه» می‌شود «همهٔ
 * تیم» (صفِ پیش‌فرضِ او خودش همهٔ کارکنان است)، «صفِ نقشِ من» فقط وقتی هست که او
 * واقعاً نقشی دارد، و «همهٔ کارها» — که با «همهٔ تیم» فقط در کارِ خودِ بیماران فرق
 * دارد — همین را در نامش می‌گوید. زیرِ «همهٔ تیم» همان فیلترِ «مالِ کیست»ِ صفحهٔ
 * «امروز» است و `?owner=` در نشانی همان دسته را باز می‌کند.
 */
export default function WorkList() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [scope, setScope] = useState('inbox');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(0);
  const { msg: toast, show: setToast } = useToast(1800);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const supervisor = (user?.level ?? 0) >= 4;
  /* `null` تا وقتی سرور نگفته — فیلترِ نشانی تا آن موقع منتظر می‌ماند، نه اینکه اول
     همه را نشان دهد و بعد بپرد. */
  const [meta, setMeta] = useState(null);
  const [assignees, setAssignees] = useState(null);
  const team = meta?.team === true;
  const owners = (team && meta.owners) || NONE;
  const facetKey = params.get('owner') || 'all';
  const facet = scope === 'inbox' && team && facetKey !== 'all' ? owners.find((o) => o.key === facetKey) ?? null : null;
  const waiting = facetKey !== 'all' && meta === null;
  const req = useRef(0);


  const loadMeta = useCallback(() => {
    api('/work/counts?owners=1').then(setMeta).catch(() => setMeta({ team: false }));
  }, []);
  /* حسابِ دیگر (سوییچ در همین تب) = تب‌های دیگر: «صفِ نقشِ من» یا «همهٔ کارها»ی حسابِ
     قبلی ممکن است برای این یکی نباشد — ماندنِ روی آن یعنی نوارِ بی‌تبِ فعال یا ۴۰۳. */
  useEffect(() => { setScope('inbox'); setMeta(null); setAssignees(null); loadMeta(); }, [loadMeta, user?.id]);
  /* دسته‌ای که در نشانی هست ولی دیگر کاری ندارد (یا کاربر تیم نیست): نشانی پاک می‌شود. */
  useEffect(() => {
    if (meta && facetKey !== 'all' && !(team && owners.some((o) => o.key === facetKey))) setParams({}, { replace: true });
  }, [meta, team, owners, facetKey, setParams]);
  useEffect(() => {
    if (!team || assignees !== null) return undefined;
    let live = true;
    api('/work/assignees').then((r) => { if (live) setAssignees(Array.isArray(r) ? r : []); }).catch(() => { if (live) setAssignees(false); });
    return () => { live = false; };
  }, [team, assignees]);

  const query = (() => {
    const q = new URLSearchParams({ limit: '200' });
    if (scope === 'overdue') { q.set('scope', 'inbox'); q.set('due', 'overdue'); } else q.set('scope', scope);
    for (const [k, v] of Object.entries(facet?.filter ?? {})) q.set(k, String(v));
    return q.toString();
  })();
  const load = useCallback(() => {
    if (waiting) return;
    const my = ++req.current;
    api(`/work?${query}`)
      .then((r) => { if (req.current === my) setRows(Array.isArray(r) ? r : []); })
      .catch((e) => { if (req.current === my) { setRows([]); setToast(e?.message || 'بارگذاری نشد'); } });
  }, [query, waiting]);
  useEffect(() => { setRows(null); load(); }, [load]);
  /* عنوانِ کارِ مقصددار پاپ‌آپِ همان سفارش/مراجعه را باز می‌کند — همان که صفحهٔ
     «امروز» و پرونده دارند (بازخوردِ مالک). بعد از ثبت، فهرست و زنگ تازه می‌شوند. */
  const things = useThings({
    onChanged: () => { load(); if (team) loadMeta(); window.dispatchEvent(new Event(WORK_CHANGED)); },
    toast: (m) => setToast(m),
  });

  const act = async (w, action, body = {}) => {
    setBusy(w.id);
    try {
      await api(`/work/${w.id}`, { method: 'PATCH', body: { action, ...body } });
      setRows((r) => (r ?? []).filter((x) => x.id !== w.id));
      window.dispatchEvent(new Event(WORK_CHANGED));
      if (team) loadMeta();
      setToast(action === 'done' ? (body.outcome?.dismissed ? 'یادآوری بسته شد' : 'انجام شد') : 'یادآوری به فردا افتاد');
    } catch (e) {
      setToast(e?.message || 'انجام نشد');
    } finally {
      setBusy(0);
    }
  };
  /* «واگذاری» (نمای تیم): ردیف با مسئولِ تازه دوباره خوانده می‌شود — اگر فیلترِ یک
     دسته روشن است، کار از همان دسته بیرون می‌رود و شمارِ تب‌ها هم تازه می‌شود. */
  const assign = async (w, accountId) => {
    setBusy(w.id);
    try {
      const r = await api(`/work/${w.id}`, { method: 'PATCH', body: { action: 'assign', accountId } });
      window.dispatchEvent(new Event(WORK_CHANGED));
      load();
      loadMeta();
      setToast(r?.mine ? 'به نامِ خودتان شد' : r?.ownerName ? `به ${r.ownerName} واگذار شد` : 'واگذار شد');
    } catch (e) {
      setToast(e?.message || 'واگذار نشد');
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
      setToast('کار ثبت شد');
      load();
      if (team) loadMeta();
    } catch (err) {
      setToast(err?.message || 'ثبت نشد');
    }
  };

  const scopes = [
    { key: 'inbox', label: team ? 'همهٔ تیم' : 'همه' },
    { key: 'overdue', label: 'عقب‌افتاده' },
    { key: 'mine', label: 'به نامِ من' },
    ...(team && !user?.jobRole ? [] : [{ key: 'role', label: 'صفِ نقشِ من' }]),
    ...(supervisor ? [{ key: 'all', label: team ? 'با کارِ بیماران' : 'همهٔ کارها' }] : []),
  ];
  const pickFacet = (key) => setParams(key === 'all' ? {} : { owner: key }, { replace: true });

  return (
    <div className="wk-page">
      {/* صفحهٔ زنگِ کارها (کاشی نیست) — آیکونش همان زنگی است که به این‌جا می‌رساند. */}
      <PageHeader title="کارهای من" icon={Bell} />

      <form className="wk-new" onSubmit={create}>
        <input id="wk-new-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="یادداشتِ کاری برای خودم… (مثلاً تماس با بیمارِ فلان)" aria-label="کارِ تازه برای خودم" maxLength={160} />
        <select id="wk-new-due" value={due} onChange={(e) => setDue(e.target.value)} aria-label="مهلت">
          <option value="">بدونِ مهلت</option>
          <option value="today">امروز</option>
          <option value="tomorrow">فردا</option>
        </select>
        <button type="submit" className="wk-btn primary" disabled={!title.trim()}>ثبت</button>
      </form>

      {/* تب‌ها بعد از پاسخِ سرور: برچسبِ «همهٔ تیم» و بود‌ونبودِ «صفِ نقشِ من» از `team` می‌آید و
          نوارِ تبی که زیرِ دستِ کاربر عوض شود، بدتر از چند میلی‌ثانیه دیرتر آمدنش است. */}
      {meta && <Tabs variant="scroll" className="wk-tabs" label="دامنه" value={scope} onChange={setScope} items={scopes} />}
      {/* «مالِ کیست» فقط زیرِ «همهٔ تیم»: شمارِ هر دسته روی همان صف حساب شده، و زیرِ
          «عقب‌افتاده» عددِ تب با ردیف‌ها نمی‌خواند. */}
      {team && scope === 'inbox' && owners.length > 0 && (
        <Tabs
          variant="scroll" className="wk-owners" label="مسئولِ کار" value={facet ? facet.key : 'all'} onChange={pickFacet}
          items={[
            { key: 'all', label: <>همه <b className="wk-own-n">{faNum(meta.total)}</b></> },
            ...owners.map((o) => ({ key: o.key, label: <>{o.label} <b className="wk-own-n">{faNum(o.count)}</b></> })),
          ]}
        />
      )}

      {rows === null && <div className="wk-empty">در حال بارگذاری…</div>}
      {rows && rows.length === 0 && (
        <div className="wk-empty">{team && scope === 'inbox' ? (facet ? 'در این دسته کارِ بازی نمانده.' : 'تیم کارِ بازی ندارد.') : 'کاری در این دامنه نیست.'}</div>
      )}
      {rows && rows.length > 0 && (
        <>
          <div className="wk-count">{faNum(rows.length)} کار</div>
          <ul className="wk-list">
            {rows.map((w) => (
              <WorkRow
                key={w.id} w={w} onAct={act} busy={busy}
                onOpen={workTarget(w) ? () => things.open(workTarget(w)) : undefined}
                onAssign={assignees ? assign : undefined} assignees={assignees || undefined}
              />
            ))}
          </ul>
        </>
      )}
      <ThingPopups things={things} />
      <Toast msg={toast} />
    </div>
  );
}
