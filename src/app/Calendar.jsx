import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { J_MONTHS, jToday } from '../lib/jalali.js';
import JGrid from './JGrid.jsx';
import { useTerms } from './config.jsx';
import { FLOW } from '../lib/terms.js';
import './calendar.css';
import { ChevronEnd, Clock } from '../ui/icons.jsx';


const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');
const KIND_TAG = { surgery: '', clinic: 'ویزیت', followup: 'پیگیری', consult: 'مشاوره' };

/**
 * تقویمِ عمل‌ها.
 *
 * سلولِ روز فقط **خلاصه** نشان می‌دهد (تعداد + چند نام) و جزئیات زیرِ تقویم
 * می‌آید: ریختنِ همهٔ اطلاعات داخلِ سلول، تقویم را در موبایل غیرقابلِ استفاده
 * می‌کند و همان‌جاست که کاربر به فهرست برمی‌گردد.
 */
export default function Calendar() {
  /* ⚠️ «ویزیت» واژهٔ حوزهٔ **مطب** است، نه واژهٔ عمومی. تا W3.7 این صفحه آن را
     هاردکد داشت، پس نصبِ نورومانیتورینگ («مراجعه») و تجهیزات («عمل») هم روی
     دکمهٔ میزِ پذیرش «ویزیت» می‌دید (یافتهٔ U15). */
  const t = useTerms();
  const navigate = useNavigate();
  const [busyAppt, setBusyAppt] = useState(0);
  const [err2, setErr2] = useState('');
  const [ty, tm, td] = jToday();
  const [ym, setYm] = useState({ y: ty, m: tm });
  const [data, setData] = useState(null);
  const [day, setDay] = useState(td);
  const [err, setErr] = useState('');

  useEffect(() => { document.title = 'عمل‌یار — تقویمِ عمل‌ها'; }, []);

  const load = useCallback(async (y, m) => {
    setErr('');
    try { setData(await api(`/calendar?year=${y}&month=${m}`)); }
    catch (e) { setErr(e.message); setData(null); }
  }, []);
  useEffect(() => { load(ym.y, ym.m); }, [load, ym]);

  const byDay = new Map((data?.days ?? []).map((d) => [d.day, d]));
  const picked = byDay.get(day);

  /* میزِ پذیرش — گذارِ وضعیتِ نوبت. دکمه‌ها از `next`ِ خودِ سرور ساخته
     می‌شوند، نه از کپیِ کلاینتیِ ماشینِ وضعیت. */
  const setApptStatus = async (a, status) => {
    setBusyAppt(a.id); setErr2('');
    try { await api(`/appointments/${a.id}/status`, { method: 'POST', body: { status } }); await load(ym.y, ym.m); }
    catch (e) { setErr2(e.message); } finally { setBusyAppt(0); }
  };

  /* شروعِ ویزیت — مراجعه از خودِ نوبت ساخته (یا پیدا) می‌شود و فرمش باز. */
  const startVisit = async (a) => {
    setBusyAppt(a.id); setErr2('');
    try {
      const r = await api(`/appointments/${a.id}/visit`, { method: 'POST' });
      navigate(`/app/dashboard?patient=${r.visitId}`);
    } catch (e) { setErr2(e.message); setBusyAppt(0); }
  };

  return (
    <div className="cal">
      <div className="cal-bg" aria-hidden="true" />
      <header className="cal-head">
        <Link to="/app" className="cal-back"><ChevronEnd width="15" height="15" /> سامانه</Link>
        <div>
          <h1>تقویمِ عمل‌ها</h1>
          <p>{data ? `${faNum(data.total)} عمل در ${J_MONTHS[ym.m - 1]}` : 'در حال بارگذاری…'}</p>
        </div>
      </header>

      {err && <div className="cal-err">{err}</div>}

      <JGrid
        year={ym.y}
        month={ym.m}
        selected={day}
        onNav={(y, m) => { setYm({ y, m }); setDay(1); }}
        onPickDay={setDay}
        renderDay={(d) => {
          const cell = byDay.get(d);
          if (!cell) return null;
          return (
            <>
              <div className="cal-dots">
                {cell.counts.pending > 0 && <i className="p" title="در انتظار">{faNum(cell.counts.pending)}</i>}
                {cell.counts.done > 0 && <i className="d" title="تمام‌شده">{faNum(cell.counts.done)}</i>}
                {cell.counts.cancelled > 0 && <i className="c" title="لغو">{faNum(cell.counts.cancelled)}</i>}
              </div>
              {cell.counts.appointments > 0 && (
                <div className="cal-appt-dot" title={FLOW.appointments}><Clock width="9" height="9" /> {faNum(cell.counts.appointments)}</div>
              )}
              <div className="cal-names">
                {cell.visits.slice(0, 2).map((v) => (
                  <span key={v.id} className={`s-${v.opStatus}`}>
                    {v.opStartTime ? `${v.opStartTime} ` : ''}{v.fullName}
                  </span>
                ))}
                {cell.visits.length > 2 && <span className="more">+{faNum(cell.visits.length - 2)} دیگر</span>}
              </div>
            </>
          );
        }}
      />

      <section className="cal-day">
        <b>{faNum(day)} {J_MONTHS[ym.m - 1]}</b>
        {err2 && <div className="cal-err">{err2}</div>}

        {/* ── میزِ پذیرش: نوبت‌های این روز ──
            «در انتظارِ پرداخت ← قطعی ← در مطب ← انجام شد» — همان چرخه‌ای که
            نرم‌افزارهای مطب دارند، ولی دکمه‌ها از ماشینِ وضعیتِ سرور می‌آیند. */}
        {(picked?.appointments ?? []).length > 0 && (
          <div className="cal-appts">
            {/* ⚠️ عمداً رشتهٔ کامل، نه `{FLOW.appointments}ی …`: چسباندنِ پسوند به واژهٔ
                واژه‌نامه اگر روزی «نوبت‌ها» به «نوبت» عوض شود «نوبتی این روز»
                می‌سازد. واژه‌نامه برای **یکی‌بودنِ مفهوم** است، نه صرفِ فارسی. */}
            <small className="cal-appts-title">نوبت‌های این روز</small>
            {picked.appointments.map((a) => (
              <article key={`ap${a.id}`} className={`cal-appt st-${a.status}`}>
                <div className="cal-time">
                  {a.time ? <b dir="ltr">{a.time}</b> : a.seq ? <b>#{faNum(a.seq)}</b> : <b className="none">—</b>}
                </div>
                <div className="cal-main">
                  <b>
                    {a.fullName}
                    <i className={`cal-appt-st st-${a.status}`}>{a.statusLabel}</i>
                  </b>
                  <small>{[a.topicName, a.patientCode, a.phone].filter(Boolean).join(' · ') || '—'}</small>
                </div>
                <div className="cal-appt-acts">
                  {/* «شروعِ ویزیت» مقصدِ اصلیِ کلِ این ماژول است: نوبت ← فرمِ
                      همان مراجعه، هر نقش بخشِ خودش. */}
                  {a.status !== 'cancelled' && a.status !== 'noshow' && (
                    <button type="button" className="cal-appt-go" disabled={busyAppt === a.id}
                            onClick={() => startVisit(a)}>
                      {a.visitId ? t.visitOpen : t.visitStart}
                    </button>
                  )}
                  {a.next.filter((s) => s !== 'done').map((s) => (
                    <button key={s} type="button" className={`cal-appt-act st-${s}`} disabled={busyAppt === a.id}
                            onClick={() => setApptStatus(a, s)}>
                      {{ confirmed: 'قطعی', arrived: 'رسید', noshow: 'نیامد', cancelled: 'لغو' }[s] ?? s}
                    </button>
                  ))}
                  {a.next.includes('done') && (
                    <button type="button" className="cal-appt-act st-done" disabled={busyAppt === a.id}
                            onClick={() => setApptStatus(a, 'done')}>
                      تمام شد
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {!picked || picked.visits.length === 0 ? (
          (picked?.appointments ?? []).length === 0
            ? <div className="cal-empty">عملی برای این روز ثبت نشده</div>
            : null
        ) : picked.visits.map((v) => (
          <article key={v.id} className={`cal-row s-${v.opStatus}`}>
            <div className="cal-time">
              {v.opStartTime ? <b dir="ltr">{v.opStartTime}</b> : <b className="none">—</b>}
              {v.opEndTime && <small dir="ltr">تا {v.opEndTime}</small>}
            </div>
            <div className="cal-main">
              <b>
                {v.fullName}
                {KIND_TAG[v.kind] && <i className="cal-kind">{KIND_TAG[v.kind]}</i>}
              </b>
              <small>
                {[v.procedureName, v.surgeonName, v.hospitalName].filter(Boolean).join(' · ') || '—'}
              </small>
              {v.techName && <small className="cal-tech">کارشناس: {v.techName}{v.techArriveTime ? ` — حضور ${v.techArriveTime}` : ''}</small>}
            </div>
            <Link className="cal-open" to={`/app/dashboard?patient=${v.id}`} title="بازکردن در داشبورد">
              <span dir="ltr">{v.code}</span>
            </Link>
          </article>
        ))}
      </section>
    </div>
  );
}
