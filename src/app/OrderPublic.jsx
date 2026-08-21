/**
 * صفحهٔ عمومیِ سفارش — چیزی که بیمار با کلیک روی لینکِ پیامک می‌بیند.
 *
 * عمداً کم‌حرف و بی‌ورود: بیمار می‌بیند چه خواسته شده، تا کِی، و اگر جواب
 * دارد همان‌جا لینک/متنش را می‌گذارد. هیچ اطلاعاتِ پرسنلی یا شمارهٔ تماسی
 * این‌جا نیست — لینک ممکن است دستِ چند نفر بچرخد.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { faDate } from '../lib/jalali.js';
import './orders.css';
import './launcher.css';

export default function OrderPublic() {
  const { token } = useParams();
  const [row, setRow] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ text: '', link: '', user: '', pass: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = 'عمل‌یار — درخواستِ پزشک';
    api(`/public/order/${token}`, { auth: false })
      .then(setRow)
      .catch((e) => setErr(e.message));
  }, [token]);

  const submit = async () => {
    if (!f.text.trim() && !f.link.trim()) { setErr('متن یا لینکِ پاسخ را وارد کنید'); return; }
    setBusy(true); setErr('');
    try {
      await api(`/public/order/${token}/answer`, { method: 'POST', auth: false, body: f });
      setDone(true);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  if (err && !row) return <div className="op-wrap"><div className="op-card op-err">{err}</div></div>;
  if (!row) return <div className="op-wrap"><div className="op-card">در حال بارگذاری…</div></div>;

  return (
    <div className="op-wrap">
      <div className="op-card">
        {row.clinic && <small className="op-clinic">{row.clinic}</small>}
        <h1>{row.kindFa}</h1>
        <p className="op-summary">{row.summary}</p>
        {row.note && <p className="op-note">{row.note}</p>}
        {row.dueDate && <p className="op-due">مهلتِ انجام: <b>{faDate(row.dueDate)}</b></p>}

        {row.kind !== 'referral' && (done || row.answered ? (
          <p className="op-ok">پاسخ ثبت شد ✓ لازم نیست کارِ دیگری بکنید.</p>
        ) : (
          <div className="op-answer">
            <h2>ثبتِ پاسخ</h2>
            <p className="op-hint">اگر جوابتان آماده است، لینکِ آن را بگذارید یا خلاصه‌اش را بنویسید.</p>
            <label className="db-field"><span>لینکِ جواب</span>
              <input dir="ltr" value={f.link} onChange={(e) => setF((s) => ({ ...s, link: e.target.value }))} placeholder="https://…" />
            </label>
            <div className="db-grid2">
              <label className="db-field"><span>نامِ کاربری (اگر لازم است)</span>
                <input dir="ltr" value={f.user} onChange={(e) => setF((s) => ({ ...s, user: e.target.value }))} />
              </label>
              <label className="db-field"><span>رمز</span>
                <input dir="ltr" value={f.pass} onChange={(e) => setF((s) => ({ ...s, pass: e.target.value }))} />
              </label>
            </div>
            <label className="db-field"><span>یا خلاصهٔ جواب</span>
              <textarea rows={3} value={f.text} onChange={(e) => setF((s) => ({ ...s, text: e.target.value }))} />
            </label>
            {err && <p className="op-err-line">{err}</p>}
            <button type="button" className="od-send" disabled={busy} onClick={submit}>
              {busy ? 'در حالِ ثبت…' : 'ثبتِ پاسخ'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
