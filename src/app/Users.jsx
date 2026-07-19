import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { api } from '../lib/api.js';
import ProfileMenu from './ProfileMenu.jsx';
import './launcher.css';
import './users.css';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Back = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5v6" /></svg>);
const UserIc = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6.5 8-6.5s8 2.5 8 6.5" /></svg>);
const Check = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M20 6 9 17l-5-5" /></svg>);
const XIc = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>);

const LEVELS = [
  { v: 1, l: 'بازدید' },
  { v: 2, l: 'کارشناس' },
  { v: 3, l: 'کارشناس‌ادمین' },
  { v: 4, l: 'سوپروایزر' },
  { v: 5, l: 'ادمین' },
  { v: 6, l: 'سوپرادمین' },
];
const FEATURE_FA = {
  dashboard: 'داشبورد مدیریت',
  formgen: 'فرم‌ساز',
  messenger: 'پیام‌رسان',
  accounting: 'حسابداری',
  calendar: 'تقویم عمل‌ها',
  dispatch: 'چینش کارشناس‌ها',
  letter: 'نامه اداری',
  tech: 'پنل کارشناسی',
  users: 'مدیریت کاربران',
};
const STATUS_FA = { pending: 'در انتظار', active: 'فعال', rejected: 'ردشده', disabled: 'غیرفعال' };

const faDate = (d) => {
  try {
    return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));
  } catch {
    return '';
  }
};

export default function Users() {
  const { user } = useAuth();
  const [tab, setTab] = useState('pending'); // pending | all | perm
  const [pending, setPending] = useState(null);
  const [all, setAll] = useState(null);
  const [features, setFeatures] = useState(null);
  const [levelSel, setLevelSel] = useState({}); // id → سطحِ انتخابی
  const [busyId, setBusyId] = useState(0);
  const [toast, setToast] = useState('');

  useEffect(() => { document.title = 'عمل‌یار — مدیریت کاربران'; }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    try {
      const [p, a, f] = await Promise.all([api('/accounts/pending'), api('/accounts'), api('/features')]);
      setPending(p);
      setAll(a);
      setFeatures(f);
    } catch (e) {
      setToast(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const patchFeature = async (key, patch) => {
    // خوش‌بینانه: اول UI، بعد سرور
    setFeatures((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    try {
      await api(`/features/${key}`, { method: 'PATCH', body: patch });
      setToast(`دسترسیِ «${FEATURE_FA[key] || key}» ذخیره شد`);
    } catch (e) {
      setToast(e.message);
      load();
    }
  };

  const resetFeatures = async () => {
    try {
      const rows = await api('/features/reset', { method: 'POST' });
      setFeatures(rows);
      setToast('دسترسی‌ها به پیش‌فرض برگشت');
    } catch (e) {
      setToast(e.message);
    }
  };

  if (user && user.level < 6) return <Navigate to="/app" replace />;

  const approve = async (row) => {
    const level = levelSel[row.id] ?? 2;
    setBusyId(row.id);
    try {
      await api(`/accounts/${row.id}/approve`, { method: 'POST', body: { level } });
      setToast(`«${row.displayName}» تأیید شد — ${LEVELS.find((x) => x.v === level)?.l}`);
      await load();
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusyId(0);
    }
  };

  const reject = async (row) => {
    setBusyId(row.id);
    try {
      await api(`/accounts/${row.id}/reject`, { method: 'POST' });
      setToast(`درخواستِ «${row.displayName}» رد شد`);
      await load();
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusyId(0);
    }
  };

  const setLevel = async (row, level) => {
    setBusyId(row.id);
    try {
      await api(`/accounts/${row.id}/level`, { method: 'POST', body: { level } });
      setToast(`سطحِ «${row.displayName}» شد ${LEVELS.find((x) => x.v === level)?.l}`);
      await load();
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusyId(0);
    }
  };

  const Avatar = ({ row, size = 46 }) => (
    <span className="us-avatar" style={{ width: size, height: size }}>
      {row.selfie ? <img src={row.selfie} alt="" /> : <UserIc width={size * 0.5} height={size * 0.5} />}
    </span>
  );

  return (
    <div className="lx us">
      <div className="lx-bg" aria-hidden="true" />
      <div className="lx-grid" aria-hidden="true" />

      <div className="lx-shell us-shell">
        <header className="us-head">
          <Link to="/app" className="lx-back" aria-label="بازگشت به لانچر"><Back width="15" height="15" /> لانچر</Link>
          <h1>مدیریت کاربران</h1>
          <div className="us-head-left"><ProfileMenu onToast={setToast} /></div>
        </header>

        <div className="lg-tabs us-tabs" role="tablist">
          <button className={tab === 'pending' ? 'on' : ''} onClick={() => setTab('pending')} role="tab">
            در انتظار تأیید{pending?.length ? <em className="us-count">{pending.length}</em> : null}
          </button>
          <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')} role="tab">همهٔ کاربران</button>
          <button className={tab === 'perm' ? 'on' : ''} onClick={() => setTab('perm')} role="tab">دسترسی‌ها</button>
        </div>

        {/* ── در انتظار تأیید ── */}
        {tab === 'pending' && (
          <div className="us-list">
            {pending === null && <p className="us-empty">در حال بارگذاری…</p>}
            {pending?.length === 0 && <p className="us-empty">درخواستی در انتظارِ تأیید نیست.</p>}
            {pending?.map((row) => (
              <div key={row.id} className="glass us-card">
                <div className="us-row">
                  <Avatar row={row} size={52} />
                  <div className="us-meta">
                    <b>{row.displayName}</b>
                    <span dir="ltr">@{row.username}</span>
                    <span dir="ltr">{row.phone}</span>
                    {row.createdAt && <small>{faDate(row.createdAt)}</small>}
                  </div>
                </div>
                <div className="us-actions">
                  <label className="us-levelpick">
                    <span>سطح:</span>
                    <select
                      value={levelSel[row.id] ?? 2}
                      onChange={(e) => setLevelSel((s) => ({ ...s, [row.id]: +e.target.value }))}
                    >
                      {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.v} — {l.l}</option>)}
                    </select>
                  </label>
                  <button className="us-btn ok" disabled={busyId === row.id} onClick={() => approve(row)}>
                    <Check width="16" height="16" /> تأیید
                  </button>
                  <button className="us-btn no" disabled={busyId === row.id} onClick={() => reject(row)}>
                    <XIc width="16" height="16" /> رد
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── همهٔ کاربران ── */}
        {tab === 'all' && (
          <div className="us-list">
            {all === null && <p className="us-empty">در حال بارگذاری…</p>}
            {all?.map((row) => (
              <div key={row.id} className="glass us-card slim">
                <div className="us-row">
                  <Avatar row={row} />
                  <div className="us-meta">
                    <b>{row.displayName}{row.id === user.id && <i className="us-you">شما</i>}</b>
                    <span dir="ltr">@{row.username}</span>
                  </div>
                  <span className={`us-status ${row.status}`}>{STATUS_FA[row.status] || row.status}</span>
                </div>
                <div className="us-actions">
                  <label className="us-levelpick grow">
                    <span>سطح:</span>
                    <select
                      value={row.level}
                      disabled={busyId === row.id || row.id === user.id || row.status !== 'active'}
                      onChange={(e) => setLevel(row, +e.target.value)}
                    >
                      {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.v} — {l.l}</option>)}
                    </select>
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* ── دسترسی‌ها (سطحِ لازم برای هر ماژول) ── */}
        {tab === 'perm' && (
          <div className="us-list">
            <p className="us-hint">
              حداقل سطحِ لازم برای دیدنِ هر بخش را تعیین کن یا بخش را کلاً خاموش کن.
              این تنظیمات بلافاصله روی لانچرِ همهٔ کاربران اثر می‌گذارد.
            </p>
            {features === null && <p className="us-empty">در حال بارگذاری…</p>}
            {features?.map((f) => (
              <div key={f.key} className="glass us-card slim">
                <div className="us-row">
                  <div className="us-meta">
                    <b>{FEATURE_FA[f.key] || f.key}</b>
                    {f.locked && <small>قفل — همیشه فقط سوپرادمین</small>}
                  </div>
                  <label className="us-switch" title={f.enabled ? 'روشن' : 'خاموش'}>
                    <input
                      type="checkbox"
                      checked={f.enabled}
                      disabled={f.locked}
                      onChange={(e) => patchFeature(f.key, { enabled: e.target.checked })}
                    />
                    <span className="us-track" aria-hidden="true" />
                  </label>
                </div>
                <div className="us-actions">
                  <label className="us-levelpick grow">
                    <span>حداقل سطح:</span>
                    <select
                      value={f.minLevel}
                      disabled={f.locked || !f.enabled}
                      onChange={(e) => patchFeature(f.key, { minLevel: +e.target.value })}
                    >
                      {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.v} — {l.l}</option>)}
                    </select>
                  </label>
                  {f.minLevel !== f.defaultLevel && !f.locked && (
                    <button className="us-btn no" onClick={() => patchFeature(f.key, { minLevel: f.defaultLevel })}>
                      پیش‌فرض ({f.defaultLevel})
                    </button>
                  )}
                </div>
              </div>
            ))}
            {features && (
              <button className="us-btn no us-reset" onClick={resetFeatures}>بازگشتِ همه به پیش‌فرض</button>
            )}
          </div>
        )}
      </div>

      <div className={`lx-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}
