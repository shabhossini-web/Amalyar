import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiStream } from '../lib/api.js';
import './launcher.css';
import './assistant.css';
import { Alert, Back, Send, Wave } from '../ui/icons.jsx';

const STARTERS = [
  'چه فرم‌هایی منتظرِ تاییدند؟',
  'نوبت‌های امروز چیست؟',
  'چطور برای یک عمل قالبِ شرح بسازم؟',
  'گزارشِ مالی را از کجا ببینم؟',
];

/** مسیرهای داخلی در جوابِ دستیار لینکِ کلیک‌شدنی می‌شوند — راه‌بردنِ واقعی، نه فقط حرف. */
function Linkified({ text }) {
  const parts = String(text).split(/(\/app\/[a-z0-9/-]+)/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('/app/')
        ? <Link key={i} className="as-link" to={p}>{p}</Link>
        : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

/**
 * دستیارِ هوشمندِ مدیریت (#52) — چتِ زنده برای مدیر: مشاورِ نرم‌افزار
 * (هر سؤالِ «از کجا/چطور») + آگاه از وضعیتِ لحظه‌ای (صفِ تایید، نوبت‌های
 * امروز، عمل‌های بی‌وضعیت). **هیچ اقدامی خودش نمی‌کند** — داده را می‌گوید
 * و مسیرِ صفحهٔ انجامش را لینک می‌کند؛ تصمیم و کلیک با مدیر است.
 */
export default function Assistant() {
  const [msgs, setMsgs] = useState([]); // {role, content}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // null=loading | {enabled}
  const endRef = useRef(null);

  useEffect(() => { document.title = 'عمل‌یار — دستیارِ هوشمند'; }, []);
  useEffect(() => {
    api('/ai/status').then(setStatus).catch((e) => setStatus({ enabled: false, error: e.message }));
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs]);

  const ask = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput('');
    setBusy(true);
    /* پیامِ دستیار خالی ساخته می‌شود و استریم پرش می‌کند — نوشتنِ زنده. */
    const history = [...msgs, { role: 'user', content: q }];
    setMsgs([...history, { role: 'assistant', content: '' }]);
    try {
      await apiStream('/ai/assistant', { messages: history }, (d) => {
        setMsgs((m) => {
          const out = [...m];
          out[out.length - 1] = { role: 'assistant', content: out[out.length - 1].content + d };
          return out;
        });
      });
    } catch (e) {
      setMsgs((m) => {
        const out = [...m];
        const last = out[out.length - 1];
        out[out.length - 1] = { role: 'assistant', content: last.content || `⛔ ${e.message}`, error: !last.content };
        return out;
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="as">
      <div className="as-bg" aria-hidden="true" />
      <header className="as-head">
        <Link to="/app" className="as-back"><Back width="15" height="15" /> سامانه</Link>
        <h1><Wave width="20" height="20" /> دستیارِ هوشمند</h1>
        <p>مشاورِ نرم‌افزار و وضعیتِ لحظه‌ای — صفِ تایید، نوبت‌های امروز، و «این کار را از کجا انجام بدهم؟»</p>
      </header>

      {status && !status.enabled && (
        <div className="as-off">
          <Alert width="15" height="15" />
          دستیار هنوز پیکربندی نشده — اگر مدیرِ پلتفرم «هوشِ مصنوعیِ مرکزی» را روشن کرده باشد خودکار فعال است؛
          وگرنه در <Link to="/app/settings">تنظیماتِ شرکت</Link> بخشِ «دستیارِ هوشِ مصنوعی» را پر کنید.
        </div>
      )}

      <div className="as-chat" aria-live="polite">
        {msgs.length === 0 && status?.enabled && (
          <div className="as-empty">
            <p>سؤالت را بپرس، یا یکی از این‌ها:</p>
            <div className="as-starters">
              {STARTERS.map((t) => (
                <button key={t} type="button" onClick={() => ask(t)} disabled={busy}>{t}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`as-msg ${m.role}${m.error ? ' err' : ''}`}>
            <div className="as-bubble"><Linkified text={m.content || '…'} /></div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        className="as-inputbar"
        onSubmit={(e) => { e.preventDefault(); ask(); }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={status?.enabled ? 'مثلاً: چه فرم‌هایی منتظرِ تاییدند؟' : 'دستیار پیکربندی نشده'}
          disabled={busy || !status?.enabled}
          aria-label="پیام به دستیار"
        />
        <button type="submit" disabled={busy || !status?.enabled || !input.trim()} aria-label="ارسال">
          <Send width="16" height="16" />
        </button>
      </form>
    </div>
  );
}
