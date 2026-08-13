import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { J_MONTHS, jToday } from '../lib/jalali.js';
import JGrid from '../app/JGrid.jsx';

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');

/**
 * **انتخابِ نوبت توسطِ بیمار** — `docs/BOOKING.md` مرحلهٔ ۳.
 *
 * ⚠️ فقط روزهایی که سرور «باز» گفته قابلِ زدن‌اند، و «باز» یعنی **جای آزاد
 * دارد** نه «قاعده دارد». محاسبه هیچ‌جا در کلاینت تکرار نمی‌شود (قانون ۱۵):
 * نسخهٔ دومِ این حساب یعنی بیمار روزی را بزند که سرور ردش می‌کند.
 *
 * ⚠️ همان `JGrid`ِ تقویمِ ادمین است. گریدِ دوم یعنی دو محاسبهٔ هفته که با
 * اولین اختلافِ کبیسه از هم جدا می‌شوند — و آن‌وقت بیمار و منشی دو تقویمِ
 * متفاوت می‌بینند.
 */
export default function BookingPick({ token, booking, onBooked, disabled }) {
  const [ty, tm] = jToday();
  const [ym, setYm] = useState({ y: ty, m: tm });
  const [cal, setCal] = useState(null);
  const [topics, setTopics] = useState([]);
  const [topicId, setTopicId] = useState(booking?.appointment?.topicId ?? null);
  const [day, setDay] = useState(booking?.appointment?.date ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async (y, m, tid) => {
    setErr('');
    try {
      const q = tid ? `&topicId=${tid}` : '';
      setCal(await api(`/public/intake/form/${token}/slots?year=${y}&month=${m}${q}`, { auth: false }));
    } catch (e) { setErr(e.message); setCal(null); }
  }, [token]);

  useEffect(() => {
    api(`/public/intake/form/${token}/topics`, { auth: false }).then(setTopics).catch(() => setTopics([]));
  }, [token]);
  useEffect(() => { load(ym.y, ym.m, topicId); }, [load, ym, topicId]);

  const byDay = new Map((cal?.days ?? []).map((x) => [x.day, x]));
  const picked = (cal?.days ?? []).find((x) => x.date === day) ?? null;
  const slotMode = !!picked?.windows?.some((w) => w.mode === 'slot');

  const book = async (startMin) => {
    setBusy(true);
    setErr('');
    try {
      const fresh = await api(`/public/intake/form/${token}/book`, {
        auth: false,
        method: 'POST',
        body: { date: day, ...(startMin != null ? { startMin } : {}), ...(topicId ? { topicId: Number(topicId) } : {}) },
      });
      onBooked?.(fresh);
      await load(ym.y, ym.m, topicId);
    } catch (e) {
      setErr(e.message);
      /* ⚠️ تقویم **دوباره خوانده می‌شود** حتی وقتی رزرو شکست خورد: علتِ
         رایجِ شکست این است که همان لحظه کسی آن جا را گرفت، و نشان‌دادنِ
         تقویمِ کهنه یعنی بیمار دوباره همان ساعت را بزند. */
      await load(ym.y, ym.m, topicId);
    } finally { setBusy(false); }
  };

  const chosen = booking?.appointment;

  return (
    <section className="ik-book">
      <h3>روزِ نوبت را انتخاب کنید</h3>

      {chosen && (
        <p className="ik-book-has">
          نوبتِ شما: <b>{chosen.date}</b>
          {chosen.time ? <> ساعتِ <b dir="ltr">{chosen.time}</b></> : null}
          {chosen.topicName ? <> — {chosen.topicName}</> : null}
          <small>می‌توانید روزِ دیگری بزنید تا جابه‌جا شود.</small>
        </p>
      )}

      {topics.length > 0 && (
        <div className="ik-book-topics" role="radiogroup" aria-label="موضوعِ ویزیت">
          {topics.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={Number(topicId) === t.id}
              className={Number(topicId) === t.id ? 'on' : ''}
              disabled={disabled || busy}
              onClick={() => { setTopicId(Number(topicId) === t.id ? null : t.id); setDay(null); }}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {err && <div className="ik-book-err">{err}</div>}

      <JGrid
        year={ym.y}
        month={ym.m}
        selected={picked?.day ?? null}
        onNav={(y, m) => { setYm({ y, m }); setDay(null); }}
        onPickDay={(dd) => {
          const cell = byDay.get(dd);
          /* روزِ بسته اصلاً انتخاب نمی‌شود — بهترین خطا آن است که رخ ندهد. */
          if (cell?.open) setDay(cell.date);
        }}
        renderDay={(dd) => {
          const cell = byDay.get(dd);
          if (!cell) return null;
          return (
            <div className={`ik-cell${cell.open ? ' open' : ''}`}>
              {cell.open ? <b>{faNum(cell.free)}</b> : null}
            </div>
          );
        }}
      />

      {picked && (
        <div className="ik-book-day">
          <b>{faNum(picked.day)} {J_MONTHS[ym.m - 1]}</b>
          {slotMode ? (
            <>
              <small>ساعت را انتخاب کنید</small>
              <div className="ik-slots">
                {picked.windows.filter((w) => w.mode === 'slot').flatMap((w) => w.slots).map((sl) => (
                  <button
                    key={sl.startMin}
                    type="button"
                    dir="ltr"
                    disabled={sl.taken || busy || disabled}
                    className={chosen?.date === picked.date && chosen?.startMin === sl.startMin ? 'on' : ''}
                    onClick={() => book(sl.startMin)}
                  >
                    {sl.time}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <small>
                {picked.windows.map((w) => `${w.start}–${w.end}`).join('، ')} · {faNum(picked.free)} جا مانده
              </small>
              <button type="button" className="ik-book-go" disabled={busy || disabled} onClick={() => book(null)}>
                {busy ? 'در حال ثبت…' : 'همین روز را می‌خواهم'}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
