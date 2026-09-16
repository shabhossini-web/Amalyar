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
import { PATIENT } from '../lib/terms.js';
import { Alert, CheckCircle, Clock } from '../ui/icons.jsx';
import './orders.css';
import './launcher.css';

const T = PATIENT.order;

/**
 * وضعیتِ مسیرِ سفارش از دیدِ بیمار — از `status`ِ سرور (CONTRACTS §۴)، نه از یک
 * پرچمِ «تمام شد» در مرورگر.
 *
 * ⚠️ تا دیروز بعد از ثبت می‌نوشت «لازم نیست کارِ دیگری بکنید» — در حالی که هنوز
 * هیچ‌کس پاسخ را ندیده بود و اگر ناخوانا بود، همین بیمار باید دوباره می‌فرستاد
 * (B4, D10c). `answered`ِ بولی معنای امروزِ سرور را حمل می‌کند تا W1.2 وضعیت‌های
 * بررسی را اضافه کند؛ `null` یعنی هنوز پاسخی نیست.
 */
const routeState = (row, justSent) => {
  if (justSent) return 'answered';
  if (row.status && T[row.status]) return row.status;
  return row.answered ? 'answered' : null;
};

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

  const state = routeState(row, done);
  /* پاسخِ تازه فقط وقتی پذیرفته می‌شود که هنوز پاسخی نیست، یا خودِ تیمِ درمان
     «دوباره بفرست» گفته (CONTRACTS §۵) — نه اینکه پاسخِ قبلی بی‌صدا بازنویسی شود. */
  const canAnswer = state === null || state === 'needs_action';
  const StateIcon = state === 'needs_action' ? Alert : state === 'reviewed' ? CheckCircle : Clock;

  return (
    <div className="op-wrap">
      <div className="op-card">
        {row.clinic && <small className="op-clinic">{row.clinic}</small>}
        <h1>{row.kindFa}</h1>
        <p className="op-summary">{row.summary}</p>
        {row.note && <p className="op-note">{row.note}</p>}
        {row.dueDate && <p className="op-due">مهلتِ انجام: <b>{faDate(row.dueDate)}</b></p>}

        {row.kind !== 'referral' && (
          <>
            {state && (
              <p className={`op-ok st-${state}`}><StateIcon width="15" height="15" /> {T[state]}</p>
            )}
            {canAnswer && (
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
            )}
          </>
        )}
      </div>
    </div>
  );
}
