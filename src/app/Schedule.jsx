import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { J_MONTHS, jToday } from '../lib/jalali.js';
import { toEnDigits } from '../lib/identity.js';
import { faTime } from '../lib/time.js';
import JGrid from './JGrid.jsx';
import TimePick from '../ui/TimePick.jsx';
import { ChevronEnd, Plus, Trash } from '../ui/icons.jsx';
import './schedule.css';

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');

/** شنبه = ۰ — همان قراردادِ سرور (`AvailabilityService.jalaliWeekday`). */
const WEEKDAYS = ['شنبه', 'یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

/** «۱۷:۳۰» ← 1050. ارقامِ فارسی هم قبول است (قانون ۱۴). */
const hhmmToMin = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(toEnDigits(String(s ?? '')).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
};

const EMPTY = {
  weekday: 0, start: '16:00', end: '20:00',
  mode: 'slot', slotMinutes: '15', capacity: '30',
  doctorId: '', topicIds: [],
};

/**
 * **برنامهٔ کاری** — `docs/BOOKING.md` مرحلهٔ ۲.
 *
 * ⚠️ تعریف و **پیش‌نمایش** عمداً روی یک صفحه‌اند. «شنبه‌ها ۱۶ تا ۲۰، هر نوبت
 * ۱۵ دقیقه» یک جملهٔ ساده است ولی نتیجه‌اش — کدام روزها باز می‌شوند و چند جا
 * دارند — چیزی است که فقط با دیدن معلوم می‌شود. صفحه‌ای که فقط قاعده بگیرد و
 * نتیجه را جای دیگری نشان بدهد، کاربر را وادار می‌کند حدس بزند.
 */
export default function Schedule() {
  const [ty, tm] = jToday();
  const [ym, setYm] = useState({ y: ty, m: tm });
  const [rules, setRules] = useState([]);
  const [topics, setTopics] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [cal, setCal] = useState(null);
  const [day, setDay] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null); // { text, bad }

  const say = useCallback((text, bad = false) => setToast(text ? { text, bad } : null), []);
  useEffect(() => {
    if (!toast || toast.bad) return undefined;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => { document.title = 'عمل‌یار — برنامهٔ کاری'; }, []);

  const loadDefs = useCallback(async () => {
    try {
      const [r, t, d] = await Promise.all([
        api('/availability/rules'),
        api('/visit-topics'),
        api('/techs').catch(() => []),
      ]);
      setRules(r);
      setTopics(t.filter((x) => x.active));
      setDoctors(Array.isArray(d) ? d : []);
    } catch (e) { say(e.message, true); }
  }, [say]);

  const loadCal = useCallback(async (y, m) => {
    try { setCal(await api(`/availability/month?year=${y}&month=${m}`)); }
    catch (e) { say(e.message, true); setCal(null); }
  }, [say]);

  useEffect(() => { loadDefs(); }, [loadDefs]);
  useEffect(() => { loadCal(ym.y, ym.m); }, [loadCal, ym]);

  const byDay = useMemo(() => new Map((cal?.days ?? []).map((d) => [d.day, d])), [cal]);
  const picked = day == null ? null : byDay.get(day);

  const save = async () => {
    const startMin = hhmmToMin(form.start);
    const endMin = hhmmToMin(form.end);
    if (startMin == null || endMin == null) { say('ساعت را مثلِ ۱۶:۰۰ وارد کنید', true); return; }
    if (endMin <= startMin) { say('ساعتِ پایان باید بعد از شروع باشد', true); return; }
    setBusy(true);
    try {
      await api('/availability/rules', {
        method: 'POST',
        body: {
          weekday: Number(form.weekday),
          startMin,
          endMin,
          mode: form.mode,
          ...(form.mode === 'slot'
            ? { slotMinutes: Number(toEnDigits(form.slotMinutes)) || 0 }
            : { capacity: Number(toEnDigits(form.capacity)) || 0 }),
          ...(form.doctorId ? { doctorId: Number(form.doctorId) } : {}),
          ...(form.topicIds.length ? { topicIds: form.topicIds.map(Number) } : {}),
        },
      });
      setForm(EMPTY);
      setAdding(false);
      await Promise.all([loadDefs(), loadCal(ym.y, ym.m)]);
      say('روزِ کاری اضافه شد');
    } catch (e) { say(e.message, true); } finally { setBusy(false); }
  };

  const toggle = async (r) => {
    setBusy(true);
    try {
      await api(`/availability/rules/${r.id}`, { method: 'PATCH', body: { active: !r.active } });
      await Promise.all([loadDefs(), loadCal(ym.y, ym.m)]);
    } catch (e) { say(e.message, true); } finally { setBusy(false); }
  };

  /* هشدار: حذفِ روزِ کاری **می‌پرسد** (بازبینیِ UX، clinic-daily-15): سطلِ هر روز کنارِ کلیدِ «فعال»
     بود و با یک لمس کلِ آن روزِ هفته را از نوبت‌دهی برمی‌داشت، بی‌پرسش و بی‌برگشت. پرسش همان‌جا
     روی ردیف باز می‌شود (نامِ روز و ساعت + پیامد)، فوکوس روی «انصراف» می‌نشیند. */
  const [askDel, setAskDel] = useState(0);
  const remove = async (r) => {
    setAskDel(0);
    setBusy(true);
    try {
      await api(`/availability/rules/${r.id}`, { method: 'DELETE' });
      await Promise.all([loadDefs(), loadCal(ym.y, ym.m)]);
      say('حذف شد');
    } catch (e) { say(e.message, true); } finally { setBusy(false); }
  };

  /* بستن/بازکردنِ یک روزِ خاص. ⚠️ استثنا لازم است چون خاموش‌کردنِ قاعده
     **همهٔ** پنجشنبه‌های آینده را هم می‌بَرد، نه فقط این یکی. */
  const closeDay = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await api('/availability/exceptions', { method: 'POST', body: { date: picked.date, closed: true } });
      await loadCal(ym.y, ym.m);
      say('این روز تعطیل شد');
    } catch (e) { say(e.message, true); } finally { setBusy(false); }
  };

  const openDay = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      const list = await api('/availability/exceptions');
      const row = list.find((x) => String(x.date).slice(0, 10) === picked.date);
      if (row) await api(`/availability/exceptions/${row.id}`, { method: 'DELETE' });
      await loadCal(ym.y, ym.m);
      say('تعطیلی برداشته شد');
    } catch (e) { say(e.message, true); } finally { setBusy(false); }
  };

  const grouped = WEEKDAYS.map((label, i) => ({ label, i, rows: rules.filter((r) => r.weekday === i) }));

  return (
    <div className="sc">
      <div className="sc-bg" aria-hidden="true" />

      <header className="sc-head">
        <Link to="/app" className="sc-back"><ChevronEnd width="15" height="15" /> سامانه</Link>
        <div>
          <h1>برنامهٔ کاری</h1>
          <p>روزها و ساعت‌هایی که بیمار می‌تواند نوبت بگیرد</p>
        </div>
      </header>

      <section className="sc-card">
        <div className="sc-title">
          <h2>روزهای هفته</h2>
          <button type="button" className="sc-add" onClick={() => setAdding((v) => !v)} disabled={busy}>
            <Plus width="15" height="15" /> {adding ? 'بستن' : 'روزِ کاری'}
          </button>
        </div>

        {adding && (
          <div className="sc-form">
            <label className="sc-field"><span>روزِ هفته</span>
              <select value={form.weekday} onChange={(e) => setForm((s) => ({ ...s, weekday: e.target.value }))}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </label>

            <div className="sc-row2">
              <TimePick
                label="از ساعت" className="sc-field" value={form.start}
                onChange={(v) => setForm((s) => ({ ...s, start: v }))}
                onCommit={(v) => setForm((s) => ({ ...s, start: v }))}
              />
              <TimePick
                label="تا ساعت" className="sc-field" value={form.end}
                onChange={(v) => setForm((s) => ({ ...s, end: v }))}
                onCommit={(v) => setForm((s) => ({ ...s, end: v }))}
              />
            </div>

            {/* ⚠️ دو حالت با `radiogroup`، نه dropdown: انتخابِ بینِ دو مدلِ
                کاملاً متفاوتِ نوبت‌دهی باید **دیده** شود، نه اینکه لای یک
                منوی بسته بماند. */}
            <div className="sc-modes" role="radiogroup" aria-label="حالتِ نوبت‌دهی">
              <button
                type="button" role="radio" aria-checked={form.mode === 'slot'}
                className={form.mode === 'slot' ? 'on' : ''}
                onClick={() => setForm((s) => ({ ...s, mode: 'slot' }))}
              >
                ساعتِ دقیق
                <i>بیمار ساعت می‌گیرد</i>
              </button>
              <button
                type="button" role="radio" aria-checked={form.mode === 'capacity'}
                className={form.mode === 'capacity' ? 'on' : ''}
                onClick={() => setForm((s) => ({ ...s, mode: 'capacity' }))}
              >
                ظرفیتِ روز
                <i>بیمار فقط روز می‌گیرد</i>
              </button>
            </div>

            {form.mode === 'slot' ? (
              <label className="sc-field"><span>طولِ هر نوبت (دقیقه)</span>
                <input
                  className="sc-num" inputMode="numeric" value={form.slotMinutes}
                  onChange={(e) => setForm((s) => ({ ...s, slotMinutes: e.target.value }))}
                />
              </label>
            ) : (
              <label className="sc-field"><span>ظرفیتِ کلِ بازه (نفر)</span>
                <input
                  className="sc-num" inputMode="numeric" value={form.capacity}
                  onChange={(e) => setForm((s) => ({ ...s, capacity: e.target.value }))}
                />
              </label>
            )}

            {doctors.length > 0 && (
              <label className="sc-field"><span>پزشک (خالی = کلِ مطب)</span>
                <select value={form.doctorId} onChange={(e) => setForm((s) => ({ ...s, doctorId: e.target.value }))}>
                  <option value="">— کلِ مطب —</option>
                  {doctors.map((d) => <option key={d.id} value={d.id}>{d.name || d.displayName}</option>)}
                </select>
              </label>
            )}

            {topics.length > 0 && (
              <div className="sc-field">
                <span>موضوعِ این روز (خالی = همه)</span>
                {/* چیپ، نه multi-select: انتخابِ چندتایی در `<select multiple>`
                    روی موبایل عملاً غیرقابلِ استفاده است. */}
                <div className="sc-chips">
                  {topics.map((t) => {
                    const on = form.topicIds.includes(String(t.id)) || form.topicIds.includes(t.id);
                    return (
                      <button
                        key={t.id} type="button" className={on ? 'on' : ''}
                        onClick={() => setForm((s) => ({
                          ...s,
                          topicIds: on ? s.topicIds.filter((x) => Number(x) !== t.id) : [...s.topicIds, t.id],
                        }))}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <button type="button" className="sc-save" onClick={save} disabled={busy}>
              <Plus width="15" height="15" /> ثبتِ روزِ کاری
            </button>
          </div>
        )}

        <div className="sc-week">
          {grouped.map((g) => (
            /* هشدار: نامِ روز یک ستون و ساعت‌های همان روز کنارش (بازبینیِ UX، clinic-daily-25): تا پیش از
               این ساعت با `dir="ltr"` روی خودِ بلوک وسطِ کارت می‌افتاد، دور از نامِ روز، و رقمش لاتین بود. */
            <div key={g.i} className={`sc-day${g.rows.length ? '' : ' empty'}`}>
              <b>{g.label}</b>
              <div className="sc-day-rules">
                {g.rows.length === 0 ? <small>—</small> : g.rows.map((r) => (
                  <article key={r.id} className={`sc-rule${r.active ? '' : ' off'}`}>
                    <div>
                      <b className="sc-hours"><bdi dir="ltr">{faTime(r.start)}–{faTime(r.end)}</bdi></b>
                      <small>
                        {r.mode === 'slot'
                          ? `هر ${faNum(r.slotMinutes)} دقیقه · ${faNum(r.slotsPerDay)} نوبت`
                          : `ظرفیت ${faNum(r.capacity)} نفر`}
                        {r.doctorName ? ` · ${r.doctorName}` : ''}
                      </small>
                      {r.topics.length > 0 && (
                        <small className="sc-topics">{r.topics.map((t) => t.name).join('، ')}</small>
                      )}
                    </div>
                    {askDel === r.id ? (
                      <div className="sc-ask" role="group" aria-label={`حذفِ روزِ کاریِ ${g.label}`}>
                        <p>
                          حذفِ «{g.label} <bdi dir="ltr">{faTime(r.start)}–{faTime(r.end)}</bdi>»؟ نوبت‌دهیِ این ساعت‌ها در همهٔ {g.label}‌ها
                          برداشته می‌شود و برگشت ندارد. برای بستنِ فقط یک روز، «تعطیل‌کردنِ این روز» در پیش‌نمایش کافی است.
                        </p>
                        <div>
                          <button type="button" className="danger" onClick={() => remove(r)} disabled={busy}>حذفِ روزِ کاری</button>
                          {/* فوکوس روی گزینهٔ امن، همان لحظه که پرسش باز شد. */}
                          <button type="button" autoFocus onClick={() => setAskDel(0)}>انصراف</button>
                        </div>
                      </div>
                    ) : (
                      <div className="sc-tools">
                        <button type="button" onClick={() => toggle(r)} disabled={busy} aria-pressed={r.active}
                                title={r.active ? 'خاموش‌کردنِ نوبت‌دهیِ این ساعت‌ها' : 'روشن‌کردنِ نوبت‌دهیِ این ساعت‌ها'}>
                          {r.active ? 'فعال' : 'خاموش'}
                        </button>
                        {/* سطل **دور** از کلیدِ روشن/خاموش، با جداکننده — و خودش فقط پرسش را باز می‌کند. */}
                        <button type="button" className="del" onClick={() => setAskDel(r.id)} disabled={busy}
                                aria-label={`حذفِ روزِ کاریِ ${g.label} ${faTime(r.start)} تا ${faTime(r.end)}`} title="حذفِ این روزِ کاری">
                          <Trash width="14" height="14" />
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="sc-card">
        <div className="sc-title">
          <h2>پیش‌نمایشِ {J_MONTHS[ym.m - 1]}</h2>
          <p>عددِ هر روز = جای آزاد</p>
        </div>

        <JGrid
          year={ym.y}
          month={ym.m}
          selected={day}
          onNav={(y, m) => { setYm({ y, m }); setDay(null); }}
          onPickDay={setDay}
          renderDay={(d) => {
            const cell = byDay.get(d);
            if (!cell) return null;
            return (
              <div className={`sc-cell${cell.open ? ' open' : ''}${cell.closed ? ' shut' : ''}`}>
                {cell.closed ? <i>تعطیل</i> : cell.open ? <b>{faNum(cell.free)}</b> : null}
              </div>
            );
          }}
        />

        {picked && (
          <div className="sc-detail">
            <b>{faNum(picked.day)} {J_MONTHS[ym.m - 1]} — {WEEKDAYS[picked.weekday]}</b>
            {picked.past ? (
              <small>روزِ گذشته است</small>
            ) : picked.closed ? (
              <>
                <small>این روز تعطیل است</small>
                <button type="button" className="sc-mini" onClick={openDay} disabled={busy}>برداشتنِ تعطیلی</button>
              </>
            ) : picked.windows.length === 0 ? (
              <small>برنامه‌ای برای این روز تعریف نشده</small>
            ) : (
              <>
                {picked.windows.map((w, i) => (
                  <div key={i} className="sc-win">
                    <b><bdi dir="ltr">{faTime(w.start)}–{faTime(w.end)}</bdi></b>
                    {w.mode === 'capacity' ? (
                      <small>{faNum(w.left)} از {faNum(w.capacity)} جا مانده</small>
                    ) : (
                      <div className="sc-slots">
                        {w.slots.map((sl) => (
                          <span key={sl.startMin} className={sl.taken ? 'taken' : ''} dir="ltr">{faTime(sl.time)}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <button type="button" className="sc-mini" onClick={closeDay} disabled={busy}>تعطیل‌کردنِ این روز</button>
              </>
            )}
          </div>
        )}
      </section>

      {toast && (
        <button
          type="button"
          className={`sc-toast${toast.bad ? ' bad' : ''}`}
          onClick={() => setToast(null)}
        >
          {toast.text}
          {toast.bad && <i>برای بستن بزنید</i>}
        </button>
      )}
    </div>
  );
}
