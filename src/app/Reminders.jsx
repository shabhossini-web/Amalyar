import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import { faDate } from '../lib/jalali.js';
import './reminders.css';
import { Alert, Back, Clock, Send } from '../ui/icons.jsx';
import { useStagger } from '../ui/stagger.js';
import { useStatusMap } from './config.jsx';

/* ⚠️ «رسیدن به گوشی» **خانوادهٔ جداست** و در سرور همتا ندارد: وضعیتِ یادآوری
   می‌گوید ما چه کردیم، این می‌گوید اپراتور چه گزارش داد. تنها مصرف‌کننده‌اش
   همین صفحه است، پس این‌جا می‌ماند. */
const DELIVERY_FA = { unknown: 'رسیدن به گوشی هنوز تأیید نشده', delivered: 'رسیده به گوشی', not_delivered: 'نرسیده به گوشی', not_sent: 'ارسال نشده', stored: 'در پیام‌رسان ثبت شده؛ هنوز خوانده نشده', read: 'خوانده شده' };
/* ⚠️ کلیدِ خام هرگز روی صفحه نمی‌آید (W0.2): `follow_up` ماه‌ها به‌شکلِ «follow_up»
   دیده می‌شد چون این نگاشت جا مانده بود. حالا نگاشت از `/config` می‌آید (نوعِ
   تازهٔ سرور خودبه‌خود فارسی می‌شود) و اگر کلیدی نبود، برچسبِ عام + خودِ کلید
   در title — تا نه دروغ بگوید نه کد نشان دهد.
   و نسخهٔ قبلیِ همین‌جا `cancelled` را نداشت: یادآوریِ لغوشده «وضعیتِ نامشخص»
   می‌شد، در حالی که پاپ‌آپش در پروندهٔ همان بیمار «لغو شد» می‌گفت. */
/* اقدامِ تک‌ردیفی (W0.7/U10) — همان فهرستی که سرور هم گارد می‌کند.
   ⚠️ `sent` در هیچ‌کدام نیست: پیام واقعاً به گوشیِ بیمار رفته، پس «دوباره»
   یعنی پیامکِ دومِ سردرگم‌کننده و «لغو» یعنی دفتر دربارهٔ چیزی که رخ داده
   دروغ بگوید. `sending` هم نیست چون همین حالا دستِ سرور است. */
const RETRYABLE = ['failed', 'uncertain', 'simulated'];
const CANCELLABLE = ['pending', 'uncertain', 'failed'];
const TABS = [
  { key: 'all', label: 'همه' },
  { key: 'pending', label: 'در صف' },
  { key: 'sent', label: 'رفته' },
  { key: 'failed', label: 'نرفته' },
  { key: 'uncertain', label: 'نامشخص' },
];

/**
 * دفترِ یادآوری‌ها — چه پیامی، به چه کسی، کی می‌رود / رفت / نرفت.
 * workerِ سراسری هر چند دقیقه سررسیده‌ها را می‌فرستد؛ «همین حالا بفرست»
 * برای مدیری است که نمی‌خواهد منتظرِ چرخهٔ بعدی بماند.
 */
export default function Reminders() {
  /* ⚠️ **برچسب از خودِ ردیف** (`r.kindFa`/`r.statusFa`)، و کاتالوگ فقط
     پشتیبان. نسخهٔ اولِ این تغییر فقط `/config` را می‌خواند و یک مسابقه
     ساخت: صفحه پیش از رسیدنِ پیکربندی رندر می‌شود، پس هر ردیف یک لحظه
     برچسبِ عامِ «یادآوری» می‌گرفت (و اگر `/config` نمی‌آمد، برای همیشه). */
  const kindMap = useStatusMap('reminderKind');
  const statusMap = useStatusMap('reminder');
  const kindFa = (r) => r?.kindFa ?? kindMap[r?.kind] ?? 'یادآوری';
  const statusFa = (st) => statusMap[st] ?? 'وضعیتِ نامشخص';
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [tab, setTab] = useState('all');
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

  /**
   * ⚠️ `rowBusy` به‌ازای **هر ردیف** است، نه یک `busy`ِ مشترک: با فلگِ مشترک
   * کلیک روی یک ردیف همهٔ دکمه‌های صفحه را خاکستری می‌کرد و کاربر نمی‌فهمید
   * کدام کار در جریان است.
   */
  const [rowBusy, setRowBusy] = useState(0);
  const act = async (r, what) => {
    setRowBusy(r.id);
    try {
      const fresh = await api(`/reminders/${r.id}/${what}`, { method: 'POST' });
      setToast(what === 'retry'
        ? (fresh?.status === 'sent' ? 'فرستاده شد' : `دوباره در صف نشست (${fresh?.statusFa ?? statusFa(fresh?.status)})`)
        : 'لغو شد و از دفتر برداشته شد');
      await load();
    } catch (e) { setToast(e.message); } finally { setRowBusy(0); }
  };

  const shown = (rows ?? []).filter((r) => tab === 'all' || r.status === tab);
  const count = (k) => (rows ?? []).filter((r) => k === 'all' || r.status === k).length;

  return (
    <div className="rm">
      <div className="rm-bg" aria-hidden="true" />
      <header className="rm-head">
        <Link to="/app" className="rm-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1><Clock width="20" height="20" /> یادآوری‌ها</h1>
          <p>پیام‌های بیماران و ابلاغ کارشناسان؛ پیامک و ربات اطلاع‌رسانی. پذیرش پیامک توسط سرویس به معنی رسیدن آن به گوشی نیست.</p>
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
              <b title={r.kind}>{kindFa(r)}</b>
              {r.patientName && <span>{r.patientName}</span>}
              {r.recipientName && <span>{r.recipientName}</span>}
              <span>{r.channel === 'chat' ? 'پیام‌رسان داخلی' : 'پیامک'}</span>
              {r.visitCode && <em dir="ltr">{r.visitCode}</em>}
              <small>
                {r.status === 'pending' ? `موعد: ${faDate(r.dueAt)}` : faDate(r.sentAt ?? r.dueAt)}
                {r.phone ? ` · ${String(r.phone).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])}` : ''}
              </small>
              <i className={`rm-tag s-${r.status}`} title={r.status}>{r.statusFa ?? statusFa(r.status)}</i>
            </div>
            <p className="rm-text">{r.text}</p>
            {r.status === 'sent' && <p>{DELIVERY_FA[r.deliveryStatus ?? 'unknown'] ?? 'وضعیت تحویل نامشخص'}{r.providerId && <small> · شناسه پیگیری: <span dir="ltr">{r.providerId}</span></small>}</p>}
            {r.error && <p className="rm-fail">علت: {r.error}</p>}
            {(RETRYABLE.includes(r.status) || CANCELLABLE.includes(r.status)) && (
              <div className="rm-acts">
                {RETRYABLE.includes(r.status) && (
                  <button type="button" className="rm-act" disabled={rowBusy === r.id}
                          onClick={() => act(r, 'retry')}>
                    <Send width="13" height="13" /> ارسالِ دوباره
                  </button>
                )}
                {CANCELLABLE.includes(r.status) && (
                  <button type="button" className="rm-act rm-act-off" disabled={rowBusy === r.id}
                          onClick={() => act(r, 'cancel')}>
                    لغوِ این پیام
                  </button>
                )}
              </div>
            )}
          </motion.article>
        ))}
      </div>

      <div className={`rm-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}
