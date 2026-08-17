import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import { faDate } from '../lib/jalali.js';
import './reminders.css';
import { Alert, Back, Clock, Send } from '../ui/icons.jsx';
import { useStagger } from '../ui/stagger.js';

const KIND_FA = {
  next_visit: 'ویزیتِ بعدی', surgery: 'عملِ پیشِ‌رو', appointment: 'نوبت',
  pre_op_care: 'مراقبتِ قبل از عمل', post_op_care: 'مراقبتِ بعد از عمل', notice: 'اطلاع‌رسانی',
};
const STATUS_FA = { pending: 'در صف', sent: 'رفت', failed: 'نرفت' };
const TABS = [
  { key: 'pending', label: 'در صف' },
  { key: 'sent', label: 'رفته' },
  { key: 'failed', label: 'نرفته' },
];

/**
 * دفترِ یادآوری‌ها — چه پیامی، به چه کسی، کی می‌رود / رفت / نرفت.
 * workerِ سراسری هر چند دقیقه سررسیده‌ها را می‌فرستد؛ «همین حالا بفرست»
 * برای مدیری است که نمی‌خواهد منتظرِ چرخهٔ بعدی بماند.
 */
export default function Reminders() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [tab, setTab] = useState('pending');
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const row = useStagger();

  useEffect(() => { document.title = 'عمل‌یار — یادآوری‌ها'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setErr('');
    try { setRows(await api('/reminders')); }
    catch (e) { setErr(e.message); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const sweep = async () => {
    setBusy(true);
    try {
      const r = await api('/reminders/sweep', { method: 'POST' });
      setToast(r.due ? `${Number(r.sent).toLocaleString('fa-IR')} پیام فرستاده شد` : 'چیزی سررسید نشده');
      await load();
    } catch (e) { setToast(e.message); } finally { setBusy(false); }
  };

  const shown = (rows ?? []).filter((r) => r.status === tab);
  const count = (k) => (rows ?? []).filter((r) => r.status === k).length;

  return (
    <div className="rm">
      <div className="rm-bg" aria-hidden="true" />
      <header className="rm-head">
        <Link to="/app" className="rm-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1><Clock width="20" height="20" /> یادآوری‌ها</h1>
          <p>هر پیامی که برای بیماران برنامه‌ریزی یا فرستاده شده — ارسالِ خودکار هر چند دقیقه.</p>
        </div>
      </header>

      {err && <div className="rm-err"><Alert width="15" height="15" /> {err}</div>}

      <div className="rm-bar">
        <nav className="rm-tabs" role="radiogroup" aria-label="وضعیت">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="radio" aria-checked={tab === t.key}
                    className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
              {t.label}<i>{count(t.key).toLocaleString('fa-IR')}</i>
            </button>
          ))}
        </nav>
        {(user?.level ?? 0) >= 6 && (
          <button type="button" className="rm-sweep" disabled={busy} onClick={sweep}>
            <Send width="14" height="14" /> ارسالِ سررسیده‌ها
          </button>
        )}
      </div>

      {rows === null && !err && <div className="rm-empty">در حال بارگذاری…</div>}
      {rows !== null && shown.length === 0 && (
        <div className="rm-empty">در این وضعیت یادآوری‌ای نیست</div>
      )}

      <div className="rm-list">
        {shown.map((r, i) => (
          <motion.article key={r.id} {...row(i)} className={`rm-row st-${r.status}`}>
            <div className="rm-row-head">
              <b>{KIND_FA[r.kind] ?? r.kind}</b>
              {r.patientName && <span>{r.patientName}</span>}
              {r.visitCode && <em dir="ltr">{r.visitCode}</em>}
              <small>
                {r.status === 'pending' ? `موعد: ${faDate(r.dueAt)}` : faDate(r.sentAt ?? r.dueAt)}
                {r.phone ? ` · ${String(r.phone).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])}` : ''}
              </small>
              <i className={`rm-tag s-${r.status}`}>{STATUS_FA[r.status] ?? r.status}</i>
            </div>
            <p className="rm-text">{r.text}</p>
            {r.error && <p className="rm-fail">علت: {r.error}</p>}
          </motion.article>
        ))}
      </div>

      <div className={`rm-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}
