import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { J_MONTHS, jToday } from '../lib/jalali.js';
import JGrid from './JGrid.jsx';
import { useStatusList, useTerms } from './config.jsx';
import { useAllowedTools } from './tools.jsx';
import { FLOW } from '../lib/terms.js';
import CancelReason from '../ui/CancelReason.jsx';
import { ThingPopups, useThings } from './thing-popups.jsx';
import './calendar.css';
import { ChevronEnd, Clock } from '../ui/icons.jsx';
import { kindOf } from './visit-kinds.js';
import { faTime } from '../lib/time.js';


const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');

/**
 * تقویم — «تقویمِ عمل‌ها» در شرکت، «تقویمِ نوبت‌ها» در مطب (`t.calendar`).
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
  const [busyAppt, setBusyAppt] = useState(0);
  const [cancelAsk, setCancelAsk] = useState(null); // نوبتی که دلیلِ لغوش پرسیده می‌شود
  const [err2, setErr2] = useState('');
  const [ty, tm, td] = jToday();
  const [ym, setYm] = useState({ y: ty, m: tm });
  const [data, setData] = useState(null);
  const [day, setDay] = useState(td);
  const [err, setErr] = useState('');
  const [note, setNote] = useState(null); // { text, bad } — پیامِ کوتاهِ پایینِ صفحه
  /* بازکردنِ فرمِ مراجعه «بیماران» (`dashboard`) می‌خواهد، و در مطب تقویم از سطحِ ۳ باز است ولی
     «بیماران» از ۴. تصمیم از سرور (`/features` از راهِ `useAllowedTools`، همان الگوی میزِ پزشک و
     میزِ پذیرش)؛ تا نیامده «می‌شود» فرض می‌شود — سرور به‌هرحال می‌سنجد. */
  const { hero, loading: accessLoading } = useAllowedTools();
  const canOpen = accessLoading || hero?.key === 'dashboard';
  /* برچسبِ رنگ‌ها از فهرستِ وضعیتِ سرور — همان واژه‌ای که کارتِ «بیماران» می‌گوید. */
  const visitStatuses = useStatusList('visit');
  const stLabel = (k, fb) => visitStatuses.find((x) => x.key === k)?.label ?? fb;
  useEffect(() => {
    if (!note || note.bad) return undefined;
    const id = setTimeout(() => setNote(null), note.text.length > 40 ? 4500 : 2400);
    return () => clearTimeout(id);
  }, [note]);

  /* ⚠️ نام و واژه‌ها از واژه‌نامهٔ حوزه (بازبینیِ UX، clinic-daily-05): در مطب این صفحه بیشتر نوبت
     و ویزیت نشان می‌دهد و «تقویمِ عمل‌ها / ۱۱ عمل در مهر / عملی ثبت نشده» برای منشی غلط بود.
     کاشیِ لانچر همان `t.calendar` را می‌خواند (قانونِ ۲۴: نامِ کاشی = عنوانِ صفحه). */
  useEffect(() => { document.title = `عمل‌یار — ${t.calendar}`; }, [t.calendar]);

  const load = useCallback(async (y, m) => {
    setErr('');
    try { setData(await api(`/calendar?year=${y}&month=${m}`)); }
    catch (e) { setErr(e.message); setData(null); }
  }, []);
  useEffect(() => { load(ym.y, ym.m); }, [load, ym]);

  /* فرمِ مراجعه **همین‌جا** باز می‌شود، نه با پرش به «بیماران» (بازبینیِ UX، clinic-daily-06) —
     مثلِ میزِ پذیرش و پرونده. بستنش کاربر را روی همان روزِ تقویم نگه می‌دارد. */
  const things = useThings({
    onChanged: () => load(ym.y, ym.m),
    toast: (text, bad) => setNote({ text, bad: !!bad }),
  });

  const byDay = new Map((data?.days ?? []).map((d) => [d.day, d]));
  const picked = byDay.get(day);

  /* میزِ پذیرش — گذارِ وضعیتِ نوبت. دکمه‌ها از `next`ِ خودِ سرور ساخته
     می‌شوند، نه از کپیِ کلاینتیِ ماشینِ وضعیت. */
  const runApptStatus = async (a, status, cancel) => {
    setBusyAppt(a.id); setErr2('');
    try { await api(`/appointments/${a.id}/status`, { method: 'POST', body: { status, ...cancel } }); await load(ym.y, ym.m); }
    finally { setBusyAppt(0); }
  };

  /* لغو دلیل می‌خواهد و بیمار پیامک می‌گیرد (تصمیمِ مالک ۱۴۰۵/۰۶/۲۶) — سرور
     هم بدونِ دلیل ۴۰۰ می‌دهد، پس این پنجره تنها راهِ لغو است. */
  const setApptStatus = (a, status) => {
    if (status === 'cancelled') { setCancelAsk(a); return; }
    runApptStatus(a, status).catch((e) => setErr2(e.message));
  };

  /* شروعِ ویزیت — مراجعه از خودِ نوبت ساخته (یا پیدا) می‌شود و فرمش **همین‌جا** باز.
     ⚠️ تا بازبینیِ UX (clinic-daily-06) این دکمه به «بیماران» می‌پرید: کاربر دیگر روی آن روزِ
     تقویم نبود، و کاربرِ سطحِ ۳ِ مطب (که «بیماران» را ندارد) بعد از عوض‌شدنِ وضعیتِ نوبت به
     صفحه‌ای می‌رسید که اجازه‌اش را نداشت. حالا اگر بازکردنِ فرم مجاز نیست، شروع ثبت می‌شود و
     صریح گفته می‌شود فرم دستِ کیست. */
  const startVisit = async (a) => {
    setBusyAppt(a.id); setErr2('');
    try {
      const r = a.visitId ? { visitId: a.visitId } : await api(`/appointments/${a.id}/visit`, { method: 'POST' });
      if (!a.visitId) await load(ym.y, ym.m);
      if (canOpen) await things.open({ type: 'visit', id: r.visitId, patientId: a.patientId });
      else setNote({ text: `${t.visitStart} ثبت شد ✓ — فرمش را کسی باز می‌کند که به «بیماران» دسترسی دارد` });
    } catch (e) { setErr2(e.message); } finally { setBusyAppt(0); }
  };

  return (
    <div className="cal">
      <div className="cal-bg" aria-hidden="true" />
      <header className="cal-head">
        <Link to="/app" className="cal-back"><ChevronEnd width="15" height="15" /> سامانه</Link>
        <div>
          <h1>{t.calendar}</h1>
          <p>
            {data
              ? `${faNum(data.total)} ${t.calendarUnit}${data.appointments ? ` و ${faNum(data.appointments)} ${FLOW.appointment}` : ''} در ${J_MONTHS[ym.m - 1]}`
              : 'در حال بارگذاری…'}
          </p>
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
                {/* ⚠️ معنای رنگ فقط در `title` بود (روی گوشی هرگز دیده نمی‌شد) — حالا زیرِ تقویم
                    راهنما دارد و صفحه‌خوان هم «۲ در انتظار» می‌خواند (clinic-daily-14). */}
                {cell.counts.pending > 0 && <i className="p" title={stLabel('pending', 'در انتظار')} aria-label={`${faNum(cell.counts.pending)} ${stLabel('pending', 'در انتظار')}`}>{faNum(cell.counts.pending)}</i>}
                {cell.counts.done > 0 && <i className="d" title={stLabel('done', 'انجام شد')} aria-label={`${faNum(cell.counts.done)} ${stLabel('done', 'انجام شد')}`}>{faNum(cell.counts.done)}</i>}
                {cell.counts.cancelled > 0 && <i className="c" title={stLabel('cancelled', 'لغو')} aria-label={`${faNum(cell.counts.cancelled)} ${stLabel('cancelled', 'لغو')}`}>{faNum(cell.counts.cancelled)}</i>}
              </div>
              {cell.counts.appointments > 0 && (
                <div className="cal-appt-dot" title={FLOW.appointments}><Clock width="9" height="9" /> {faNum(cell.counts.appointments)}</div>
              )}
              <div className="cal-names">
                {cell.visits.slice(0, 2).map((v) => (
                  <span key={v.id} className={`s-${v.opStatus}`}>
                    {v.opStartTime ? `${faTime(v.opStartTime)} ` : ''}{v.fullName}
                  </span>
                ))}
                {cell.visits.length > 2 && <span className="more">+{faNum(cell.visits.length - 2)} دیگر</span>}
              </div>
            </>
          );
        }}
      />

      {/* راهنمای رنگ‌های خانه‌های تقویم — معنا نباید فقط با رنگ یا نگه‌داشتنِ ماوس باشد. */}
      <ul className="cal-legend" aria-label="راهنمای رنگ‌های تقویم">
        <li><i className="p" aria-hidden="true" />{stLabel('pending', 'در انتظار')}</li>
        <li><i className="d" aria-hidden="true" />{stLabel('done', 'انجام شد')}</li>
        <li><i className="c" aria-hidden="true" />{stLabel('cancelled', 'لغو')}</li>
        <li className="appt"><Clock width="11" height="11" aria-hidden="true" />{FLOW.appointments}</li>
      </ul>

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
                  {/* ساعت با ارقامِ فارسی — مثلِ میزِ پذیرش و میزِ پزشک (clinic-daily-25). */}
                  {a.time ? <b dir="ltr">{faTime(a.time)}</b> : a.seq ? <b>#{faNum(a.seq)}</b> : <b className="none">—</b>}
                </div>
                <div className="cal-main">
                  <b>
                    {/* ⚠️ فاصلهٔ واقعی بینِ نام و برچسب (بازبینیِ UX، clinic-daily-13): مرورگر حروفِ فارسی
                        را از مرزِ دو عنصر هم به هم می‌چسباند و «رضایی» کنارِ «در مطب» «رضایـ» دیده می‌شد. */}
                    {a.fullName ?? 'بدونِ پرونده'}{' '}
                    <i className={`cal-appt-st st-${a.status}`}>{a.statusLabel}</i>
                  </b>
                  <small>{[a.topicName, a.patientCode, a.phone].filter(Boolean).join(' · ') || '—'}</small>
                </div>
                <div className="cal-appt-acts">
                  {/* «شروعِ ویزیت» مقصدِ اصلیِ کلِ این ماژول است: نوبت ← فرمِ
                      همان مراجعه، هر نقش بخشِ خودش.

                      ⚠️ شرطش از سرور می‌آید (`canStart`)، نه از یک ماشینِ
                      وضعیتِ محلی. نسخهٔ قبلی شرطش `status !== 'cancelled' &&
                      status !== 'noshow'` بود ولی **«نیامد» را هم دکمه
                      می‌کرد** (شرط روی `a.status` بود و ردیف `next` داشت)، و
                      مسیرِ سرورش هم جلویش را نمی‌گرفت.
                      ⚠️ ولی «پول‌نداده» و «فقط امروز» این‌جا اعمال **نمی‌شوند**:
                      آن دو سیاستِ تختهٔ یک‌روزهٔ میزِ پذیرش‌اند. ثبت‌نامِ آنلاین
                      نوبتِ `held` می‌سازد و ادمین از همین‌جا شروعش می‌کند؛ و
                      بیمارِ زودآمدهٔ هفتهٔ بعد مراجعه‌اش امروز ثبت می‌شود.

                      ⚠️ وقتی نمی‌شود، دکمه **حذف نمی‌شود**: خاموش می‌ماند و
                      علتش را می‌گوید. دکمهٔ ناپدید یعنی کاربر فکر کند صفحه
                      خراب است؛ `title` روی لمس دیده نمی‌شود، پس کلیکش هم
                      همان علت را نشان می‌دهد. */}
                  {a.visitId ? (canOpen && (
                    <button type="button" className="cal-appt-go" disabled={busyAppt === a.id}
                            onClick={() => startVisit(a)}>
                      {t.visitOpen}
                    </button>
                  )) : a.canStart ? (
                    <button type="button" className="cal-appt-go" disabled={busyAppt === a.id}
                            onClick={() => startVisit(a)}>
                      {t.visitStart}
                    </button>
                  ) : a.startHint ? (
                    <button type="button" className="cal-appt-go is-off" title={a.startHint}
                            onClick={() => setErr2(a.startHint)}>
                      {t.visitStart}
                    </button>
                  ) : null}
                  {/* ⚠️ برچسبِ دکمه از `nextOptions`ِ سرور می‌آید. سرور همین را
                      **برای همین‌جا** ساخته بود (کامنتِ `appointments.service`
                      صریحاً می‌گوید «تا نگاشتِ کلاینتیِ دوم مثلِ آنکه در
                      Calendar.jsx بود لازم نشود») ولی این صفحه هیچ‌وقت به آن
                      منتقل نشد — نگهبانِ «یک وضعیت، یک برچسب» پیدایش کرد.

                      ⚠️ و `done` دیگر جدا نیست: استثنایش یک `<button>`ِ دوم با
                      متنِ هاردکدِ «تمام شد» ساخته بود، در حالی که
                      `APPT_ACTIONS.done` دقیقاً همان است. */}
                  {(a.nextOptions ?? []).map((o) => (
                    <button key={o.status} type="button" className={`cal-appt-act st-${o.status}`} disabled={busyAppt === a.id}
                            onClick={() => setApptStatus(a, o.status)}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}

        {!picked || picked.visits.length === 0 ? (
          (picked?.appointments ?? []).length === 0
            ? <div className="cal-empty">برای این روز {t.calendarUnit} یا نوبتی ثبت نشده</div>
            : null
        ) : picked.visits.map((v) => (
          <article key={v.id} className={`cal-row s-${v.opStatus}`}>
            <div className="cal-time">
              {v.opStartTime ? <b dir="ltr">{faTime(v.opStartTime)}</b> : <b className="none">—</b>}
              {v.opEndTime && <small>تا <bdi dir="ltr">{faTime(v.opEndTime)}</bdi></small>}
            </div>
            <div className="cal-main">
              <b>
                {v.fullName}{' '}
                {/* نامِ نوع از سرور (`kindTitle`، همان کارتِ «بیماران») — نه نگاشتِ هاردکد. */}
                {v.kind && <i className="cal-kind">{v.kindTitle || kindOf(v.kind).label}</i>}
              </b>
              <small>
                {[v.procedureName, v.surgeonName, v.hospitalName].filter(Boolean).join(' · ') || '—'}
              </small>
              {v.techName && <small className="cal-tech">{t.tech}: {v.techName}{v.techArriveTime ? ` — حضور ${faTime(v.techArriveTime)}` : ''}</small>}
            </div>
            {/* بازکردنِ خودِ مراجعه **همین‌جا** (clinic-daily-06) — نه پرش به «بیماران». */}
            {canOpen ? (
              <button type="button" className="cal-open" onClick={() => things.open({ type: 'visit', id: v.id })}
                      aria-label={`بازکردنِ ${v.code} — ${v.fullName}`}>
                {/* «بازکردن» روی خودِ دکمه (clinic-daily-14): کدِ تنها نمی‌گفت این تنها راهِ بازکردنِ مراجعه است. */}
                <span className="cal-open-v">بازکردن</span>
                <span dir="ltr">{v.code}</span>
              </button>
            ) : <span className="cal-code" dir="ltr">{v.code}</span>}
          </article>
        ))}
      </section>

      {/* ⚠️ همهٔ لایه‌های شناور داخلِ **یک** ظرف: قاعدهٔ `.cal > *:not(.cal-bg) { position: relative }`
          (برای بالاآوردنِ محتوا از روی درخششِ پس‌زمینه) اولویتِ بیشتری از `position: fixed`ِ پرده‌ها
          دارد، پس پنجرهٔ دلیلِ لغو تا امروز ته صفحه در جریانِ متن می‌نشست نه روی صفحه. ظرفِ نسبی
          مرجعِ fixed نیست و z-indexِ پرده‌ها را هم در خودش حبس نمی‌کند. */}
      <div className="cal-layer">
        <ThingPopups things={things} />

        {note && (
          <button type="button" className={`cal-toast${note.bad ? ' bad' : ''}`} onClick={() => setNote(null)}
                  aria-live={note.bad ? 'assertive' : 'polite'}>
            {note.text}
          </button>
        )}

        <AnimatePresence>
          {cancelAsk && (
            <CancelReason
              kind="appointment"
              what={cancelAsk.fullName}
              onClose={() => setCancelAsk(null)}
              onConfirm={async (c) => {
                await runApptStatus(cancelAsk, 'cancelled', c);
                setCancelAsk(null);
              }}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
