import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { faDate, J_MONTHS, jToday } from '../lib/jalali.js';
import JGrid from '../app/JGrid.jsx';
import { CheckCircle } from '../ui/icons.jsx';

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');
/** «16:00» ← «۱۶:۰۰»: تاریخِ کنارش فارسی است و ساعتِ لاتین کنارِ آن («۶ مهر ساعتِ 16:00») ناهمخوان بود. */
const faTime = (t) => String(t ?? '').replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

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
export default function BookingPick({ token, booking, onBooked, disabled, error = '' }) {
  const [ty, tm] = jToday();
  const [ym, setYm] = useState({ y: ty, m: tm });
  const [cal, setCal] = useState(null);
  const [topics, setTopics] = useState([]);
  const [topicId, setTopicId] = useState(booking?.appointment?.topicId ?? null);
  const [day, setDay] = useState(booking?.appointment?.date ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  /* اعلامِ «ثبت شد» فقط پس از رزروِ **خودِ بیمار** — نه هنگامِ بازکردنِ صفحه برای بیماری که از قبل نوبت دارد.
     ناحیهٔ `role="status"` همیشه در صفحه است و فقط متنش عوض می‌شود: ناحیه‌ای که همراهِ متنش سوار شود را بسیاری
     از صفحه‌خوان‌ها اعلام نمی‌کنند. `focusDone` کارت را یک‌بار به دید می‌آورد و فوکوس را رویش می‌گذارد، چون دکمه‌ای
     که بیمار با صفحه‌کلید زده بود همان لحظه برداشته می‌شود و فوکوس به `<body>` می‌افتاد. */
  const [announce, setAnnounce] = useState('');
  const [focusDone, setFocusDone] = useState(false);

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
      /* پاسخ همان نمای کاملِ فرم است (`booking.appointment`)، نه خودِ نوبت. */
      const a = fresh?.booking?.appointment ?? fresh?.appointment;
      if (a?.date) {
        setAnnounce(`نوبتِ شما ثبت شد: ${faDate(a.date) || a.date}${a.time ? ` ساعتِ ${faTime(a.time)}` : ''}`);
        setFocusDone(true);
      }
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
  /* موضوع هم جزوِ نوبت است (سرور با موضوعِ تازه جابه‌جا می‌کند): همان روز زیرِ موضوعِ دیگر «نوبتِ من» نیست، وگرنه
     تعویضِ موضوع در همان روز ممکن نبود و تیک و «ثبت شد» زیرِ موضوعِ اشتباه می‌آمد. بی‌موضوع = هر موضوعی. */
  const sameTopic = chosen?.topicId == null || topicId == null || Number(chosen.topicId) === Number(topicId);
  const isMine = (date) => !!chosen && sameTopic && chosen.date === date;
  /* روزِ بازشده همان روزِ نوبتِ ثبت‌شدهٔ بیمار است؟ */
  const mineDay = !!picked && isMine(picked.date);

  return (
    <section className={`ik-book${error ? ' bad' : ''}`} aria-describedby={error ? 'ik-book-need' : undefined}>
      <h3>روزِ نوبت را انتخاب کنید</h3>
      {/* «روزی انتخاب نشده» روی خودِ تقویم — فرم با اسکرول همین‌جا می‌آورد (بازبینیِ UX، بندِ ۱۰۵). */}
      {error && <p id="ik-book-need" className="ik-book-err" role="alert">{error}</p>}

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
        compact
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
          /* هشدار: روزِ **نوبتِ خودِ بیمار** تیک می‌گیرد، نه نقطهٔ «باز» — حتی وقتی نوبتِ خودش آخرین جا را گرفته و
             سرور روز را دیگر «باز» نمی‌گوید. مالک (۱۴۰۵/۰۷/۱۵): «نوبت را انتخاب می‌کند و جایی نشانش نمی‌دهد
             که نوبتش انتخاب شده». */
          const mine = isMine(cell.date);
          return (
            /* مینیمال: روزِ باز فقط یک نقطهٔ نئون می‌گیرد؛ عددِ «جا مانده» در
               کارتِ پایینِ تقویم می‌آید، نه داخلِ سلول — سلولِ شلوغ همان
               چیزی بود که کاربر «افتضاح» خواند. */
            <div className={`ik-cell${cell.open ? ' open' : ''}${mine ? ' mine' : ''}`}>
              {mine ? <CheckCircle className="ik-tick" width="14" height="14" aria-hidden="true" />
                : cell.open ? <i className="ik-dot" aria-hidden="true" /> : null}
            </div>
          );
        }}
      />

      {picked && (
        <div className="ik-book-day">
          <b>{faNum(picked.day)} {J_MONTHS[ym.m - 1]}</b>
          {slotMode ? (
            <>
              <small id="ik-slots-q">ساعت را انتخاب کنید</small>
              <div className="ik-slots" role="radiogroup" aria-labelledby="ik-slots-q">
                {picked.windows.filter((w) => w.mode === 'slot').flatMap((w) => w.slots).map((sl) => {
                  /* هشدار: ساعتِ **خودِ بیمار** «انتخاب‌شده» است، نه «پر» (بازبینیِ UX، بندِ ۹۶): سرور آن را
                     هم «گرفته» می‌شمارد (نوبتِ خودش جا را گرفته) و تا دیروز دکمه‌اش کم‌رنگ و خط‌خورده می‌شد —
                     بیمار فکر می‌کرد رزرو نشده. زدنِ دوباره‌اش کاری نمی‌کند. */
                  const mine = isMine(picked.date) && chosen?.startMin === sl.startMin;
                  const state = mine ? '' : sl.past ? ' — گذشته' : sl.taken ? ' — پر' : '';
                  return (
                    <button
                      key={sl.startMin}
                      type="button"
                      role="radio"
                      aria-checked={mine}
                      aria-label={`${faTime(sl.time)}${state}`}
                      dir="ltr"
                      disabled={(sl.taken && !mine) || busy || disabled}
                      className={mine ? 'on' : ''}
                      onClick={() => { if (!mine) book(sl.startMin); }}
                    >
                      {faTime(sl.time)}
                    </button>
                  );
                })}
              </div>
              {mineDay && <Done chosen={chosen} focusNow={focusDone} onFocused={() => setFocusDone(false)} />}
            </>
          ) : (
            <>
              <small>
                {faTime(picked.windows.map((w) => `${w.start}–${w.end}`).join('، '))} · {faNum(picked.free)} جا مانده
              </small>
              {/* هشدار: همین‌جا که دکمه بود، «ثبت شد» می‌نشیند — جایی که چشمِ بیمار بعد از لمس مانده است. دکمه‌ای که
                  بعد از زدن هیچ تغییری نمی‌کرد یعنی بیمار نمی‌دانست نوبتش گرفته شد یا نه. */}
              {mineDay ? <Done chosen={chosen} focusNow={focusDone} onFocused={() => setFocusDone(false)} /> : (
                <button type="button" className="ik-book-go" disabled={busy || disabled} onClick={() => book(null)}>
                  {busy ? 'در حال ثبت…' : 'همین روز را می‌خواهم'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* هشدار: «نوبتِ شما: …» **زیرِ** تقویم و کارتِ روز می‌آید نه بالای بخش: تا دیروز بالای بخش بود و با
          ثبتِ نوبت یک‌دفعه ۷۰ پیکسل می‌نشست و تقویم و دکمه‌ای که بیمار همان لحظه رویش بود را به پایین می‌پراند
          (و پیام از دیدِ او بیرون می‌افتاد). وقتی روزِ بازشده همان روزِ نوبت است، خودِ کارت (`Done`) جایگزینش
          است و این‌جا تکرار نمی‌شود؛ وقتی بیمار ماه/موضوع/روزِ دیگری را می‌بیند، همین یادآوری می‌ماند. */}
      <p className="ik-sr" role="status" aria-live="polite">{announce}</p>

      {chosen && !mineDay && (
        <p className="ik-book-has">
          {/* هشدار: تاریخ به بیمار **شمسی** نشان داده می‌شود — ISOِ خامِ سرور
              (2026-08-15) روی نصبِ واقعی دیده شد و برای بیمار بی‌معنی است. */}
          نوبتِ شما: <b>{faDate(chosen.date) || chosen.date}</b>
          {chosen.time ? <> ساعتِ <b dir="ltr">{faTime(chosen.time)}</b></> : null}
          {chosen.topicName ? <> — {chosen.topicName}</> : null}
          <small>می‌توانید روزِ دیگری بزنید تا جابه‌جا شود.</small>
        </p>
      )}
    </section>
  );
}

/**
 * «نوبتِ شما ثبت شد» — پیامِ تأییدِ پایدار زیرِ همان روزی که بیمار زد؛ تاریخ شمسی و ساعت فارسی (همان قاعدهٔ بالای
 * صفحه). اعلامِ صفحه‌خوان از ناحیهٔ ثابتِ `role="status"`ِ بالاست، نه این کارت.
 */
function Done({ chosen, focusNow, onFocused }) {
  /* فقط یک‌بار و فقط پس از رزروِ خودِ بیمار (`focusNow`): کارت زیرِ روزِ زده‌شده می‌نشیند و روی گوشی ممکن است زیرِ لبهٔ
     پایینِ صفحه بیفتد — همان «جایی نشان نمی‌دهد»ِ مالک. به‌اندازهٔ لازم به دید می‌آید (بی‌انیمیشن برای کسی که حرکتِ
     کم خواسته) و فوکوس می‌گیرد. بازکردنِ صفحه برای بیماری که از قبل نوبت دارد، یا برگشتن به روزِ نوبت، صفحه را نمی‌پراند. */
  const ref = useRef(null);
  useEffect(() => {
    if (!focusNow) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    ref.current?.focus?.({ preventScroll: true });
    onFocused?.();
  }, [focusNow]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <p className="ik-book-done" tabIndex={-1} ref={ref}>
      <CheckCircle width="20" height="20" aria-hidden="true" />
      <span>
        <b>نوبتِ شما ثبت شد: {faDate(chosen.date) || chosen.date}{chosen.time ? <> ساعتِ <bdi dir="ltr">{faTime(chosen.time)}</bdi></> : null}</b>
        <small>روزِ دیگری بزنید تا جابه‌جا شود.</small>
      </span>
    </p>
  );
}
