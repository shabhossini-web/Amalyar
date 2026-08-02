import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { J_MONTHS, jToday } from '../lib/jalali.js';
import JGrid from './JGrid.jsx';
import './calendar.css';
import { ChevronEnd } from '../ui/icons.jsx';


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
        {!picked ? (
          <div className="cal-empty">عملی برای این روز ثبت نشده</div>
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
