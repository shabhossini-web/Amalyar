import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { faDate, jStrToIso, todayJStr } from '../lib/jalali.js';
import { faTime } from '../lib/time.js';
import JDate from './JDate.jsx';
import { Alert, Back, Check, Clock, Theatre as TheatreIcon } from '../ui/icons.jsx';
import './theatre.css';
import './definitions.css';
import './launcher.css';

const faNum = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const GENDER_FA = { male: 'مرد', female: 'زن' };

/** «HH:MM» → دقیقه؛ برای مدتِ سپری‌شده. ساعتِ دیوار است، پس همان‌روز حساب می‌شود. */
const mins = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const duration = (from, to) => {
  const a = mins(from); const b = mins(to);
  if (a == null || b == null) return null;
  const d = (b - a + 1440) % 1440;
  return `${faNum(Math.floor(d / 60))}:${faNum(String(d % 60).padStart(2, '0'))}`;
};

/**
 * **نمای اتاقِ عمل** (بستهٔ ۳ب) — یک عمل، یک صفحه، در لحظه.
 *
 * بازخوردِ مالک ۱۴۰۵/۰۶/۳۰: «وقتی تو اتاق عمل است راحت به اطلاعاتِ لازم دسترسی
 * داشته باشد و بتواند مدیریت کند».
 *
 * ⚠️ **هیچ عددِ مالی این‌جا نیست.** دستِ دستکش‌دار نه مبلغ لازم دارد نه باید
 * ببیند؛ سرور هم اصلاً نمی‌فرستدش (`theatre.service.ts`). اگر روزی مبلغی دیده
 * شد، اشکال آن‌طرف است نه این فایل.
 *
 * ⚠️ همهٔ متن‌ها و شمارش‌ها از سرور می‌آیند (قانونِ ۱۵): بندهای چک‌لیست، برچسبِ
 * مرحله‌ها و «چندتا از چندتا» هیچ‌کدام این‌جا ساخته نمی‌شوند.
 */
export default function Theatre() {
  const [jday, setJday] = useState(todayJStr());
  const [day, setDay] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [card, setCard] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');

  const iso = jStrToIso(jday);
  useEffect(() => { document.title = 'اتاقِ عمل — عمل‌یار'; }, []);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t); }, [toast]);

  const loadDay = useCallback(async () => {
    if (!iso) return;
    try { setDay(await api(`/theatre/day?date=${iso}`)); setErr(null); }
    catch (e) { setErr({ message: e.message, status: e.status }); }
  }, [iso]);
  useEffect(() => { loadDay(); }, [loadDay]);

  const openCard = useCallback(async (id) => {
    setBusy(`open-${id}`);
    try { setCard(await api(`/theatre/visits/${id}`)); setOpenId(id); }
    catch (e) { setToast(e.message); }
    finally { setBusy(''); }
  }, []);

  const act = async (path, key) => {
    setBusy(key);
    try { setCard(await api(`/theatre/visits/${openId}${path}`, { method: 'POST' })); await loadDay(); }
    catch (e) { setToast(e.message); }
    finally { setBusy(''); }
  };

  const toggle = async (stage, itemKey, checked) => {
    const key = `${stage}/${itemKey}`;
    setBusy(key);
    try { setCard(await api(`/theatre/visits/${openId}/check`, { method: 'POST', body: { stage, key: itemKey, checked } })); await loadDay(); }
    catch (e) { setToast(e.message); }
    finally { setBusy(''); }
  };

  if (err?.status === 403) {
    return <div className="th"><div className="th-note" role="status">{err.message} — از «همهٔ ابزارها» به بخش‌های خودتان بروید.</div></div>;
  }

  return (
    <div className="th">
      <header className="th-head">
        <div>
          <h1><TheatreIcon width="20" height="20" aria-hidden="true" /> اتاقِ عمل</h1>
          <p>{faDate(iso)}</p>
        </div>
        {!openId && <>
          <JDate value={jday} onChange={setJday} />
          <button type="button" className="th-today" onClick={() => setJday(todayJStr())}>امروز</button>
        </>}
        {openId && (
          <button type="button" className="th-today" onClick={() => { setOpenId(null); setCard(null); loadDay(); }}>
            <Back width="15" height="15" aria-hidden="true" /> فهرستِ روز
          </button>
        )}
        <Link className="th-exit" to="/app">سامانه</Link>
      </header>

      {err && err.status !== 403 && <div className="th-err" role="alert">{err.message}</div>}

      {!openId && <DayList day={day} busy={busy} onOpen={openCard} />}
      {openId && card && <Card card={card} busy={busy} onAct={act} onToggle={toggle} />}

      {toast && <button type="button" className="th-toast" onClick={() => setToast('')}>{toast}</button>}
    </div>
  );
}

/** فهرستِ عمل‌های روز — ساعت، بیمار، عمل، و «کجای چک‌لیستیم». */
function DayList({ day, busy, onOpen }) {
  if (!day) return <p className="th-empty">در حالِ بارگذاری…</p>;
  if (!day.visits.length) return <p className="th-empty">برای این روز عملی ثبت نشده.</p>;
  return (
    <ul className="th-list">
      {day.visits.map((v) => (
        <li key={v.id}>
          <button type="button" className={`th-item${busy === `open-${v.id}` ? ' busy' : ''}`} data-visit-id={v.id} onClick={() => onOpen(v.id)}>
            <span className="th-item-time" dir="ltr">{v.opStartTime ? faTime(v.opStartTime) : '—'}</span>
            <span className="th-item-name">{v.patient}</span>
            <span className="th-item-sub">{[v.procedure, v.hospital, v.surgeon].filter(Boolean).join(' · ') || v.code}</span>
            <span className="th-item-side">
              <span className={`th-state is-${v.state}`}>{v.stateFa}</span>
              {/* ⚠️ `title` روی صفحهٔ لمسی دیده نمی‌شود، پس عنوانِ هر مرحله در
                  `aria-label` هم می‌آید و خودِ نوار برچسبِ دیدنی دارد. */}
              <span className="th-mini">
                <small>چک‌لیست</small>
                {v.checklist.map((c) => {
                  const title = day.stages.find((s) => s.key === c.key)?.title ?? c.key;
                  return (
                    <b key={c.key} className={c.done >= c.total ? 'full' : c.done ? 'part' : ''}
                      title={title} aria-label={`${title}: ${faNum(c.done)} از ${faNum(c.total)}`}>
                      {faNum(c.done)}/{faNum(c.total)}
                    </b>
                  );
                })}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** کارتِ حینِ عمل. */
function Card({ card, busy, onAct, onToggle }) {
  const { visit: v, patient: p, alerts, items, documents, checklist } = card;
  /* ⚠️ **مدتِ زنده** وقتی عمل در جریان است: سرِ میز «چقدر گذشته» را کسی از
     تفریقِ ذهنیِ دو ساعت در نمی‌آورد. تیکِ نیم‌دقیقه‌ای کافی است و فقط وقتی
     می‌زند که واقعاً در جریان باشد — نه یک تایمرِ همیشه‌روشن روی هر کارت. */
  const running = !!v.opStartTime && !v.opEndTime && v.state !== 'cancelled';
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const h = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(h);
  }, [running]);
  const nowHHMM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const elapsed = v.opEndTime ? duration(v.opStartTime, v.opEndTime) : running ? duration(v.opStartTime, nowHHMM()) : null;
  void tick;
  return (
    <div className="th-card">
      <section className="th-who" aria-labelledby="th-who-h">
        <h2 id="th-who-h" className="th-name">{p.fullName}</h2>
        <p className="th-meta">
          <span dir="ltr">{p.code}</span>
          {p.age != null && <span>{faNum(p.age)} ساله</span>}
          {p.gender && <span>{GENDER_FA[p.gender] ?? p.gender}</span>}
          <span className={`th-blood${p.bloodType ? '' : ' none'}`}>
            گروه خونی {p.bloodType ? <b dir="ltr">{p.bloodType}</b> : <b>ثبت نشده</b>}
          </span>
        </p>
        <p className="th-op">{[v.procedure, v.hospital].filter(Boolean).join(' · ') || '—'}</p>
        <p className="th-team">
          {v.surgeon && <span>جراح: <b>{v.surgeon}</b></span>}
          {v.tech && <span>کارشناس: <b>{v.tech}</b></span>}
          <span className={`th-state is-${v.state}`}>{v.stateFa}</span>
        </p>
      </section>

      {/* ⚠️ هر سه هشدار **همیشه** رندر می‌شوند. «پرسیده نشده» با «نداشت» یکی
          نیست، و سرِ میز فرقشان می‌تواند حیاتی باشد — کادرِ خالی یعنی برو بپرس. */}
      <section className="th-alerts" aria-label="هشدارهای بالینی">
        {/* ⚠️ حساسیت **قرمز** و دو تای دیگر کهربایی: وقتی هر سه یک قرمز باشند،
            هیچ‌کدام دیگر هشدار نیست. چیزی که سرِ میز می‌تواند بکشد حساسیت است. */}
        {[['allergies', 'حساسیت', 'red'], ['chronicConditions', 'بیماریِ زمینه‌ای', 'amber'], ['medications', 'داروها', 'amber']].map(([k, label, tone]) => (
          <div key={k} className={`th-alert${alerts[k] ? ` on is-${tone}` : ''}`}>
            <span className="th-alert-h">{alerts[k] ? <Alert width="14" height="14" aria-hidden="true" /> : null}{label}</span>
            <p>{alerts[k] || 'در پرونده ثبت نشده — بپرسید'}</p>
          </div>
        ))}
      </section>

      <section className="th-clock" aria-label="ساعتِ عمل">
        <div className="th-times">
          <span>شروع <b dir="ltr">{v.opStartTime ? faTime(v.opStartTime) : '—'}</b></span>
          <span>پایان <b dir="ltr">{v.opEndTime ? faTime(v.opEndTime) : '—'}</b></span>
          {elapsed && <span className="th-elapsed"><Clock width="13" height="13" aria-hidden="true" /> {running ? 'تا این لحظه' : 'مدت'} <b dir="ltr">{elapsed}</b></span>}
        </div>
        {/* ⚠️ «اصلی» روی **کارِ بعدی** می‌نشیند، نه همیشه روی «شروع شد»: وقتی عمل
            شروع شده، دکمهٔ پررنگِ غیرفعال هم چشم را می‌برد هم دروغ می‌گوید. */}
        <div className="th-acts">
          <button type="button" className={`th-btn${running || v.opEndTime ? '' : ' primary'}`}
            disabled={!!v.opStartTime || busy === 'start' || v.state === 'cancelled'}
            onClick={() => onAct('/start', 'start')}>شروع شد</button>
          <button type="button" className={`th-btn${running ? ' primary' : ''}`}
            disabled={!v.opStartTime || !!v.opEndTime || busy === 'finish'}
            onClick={() => onAct('/finish', 'finish')}>پایان یافت</button>
        </div>
      </section>

      {checklist.map((stage) => {
        const done = stage.items.filter((i) => i.checked).length;
        return (
          <section key={stage.key} className={`th-stage${done >= stage.items.length ? ' full' : ''}`} aria-labelledby={`th-${stage.key}`}>
            <h3 id={`th-${stage.key}`}>
              {stage.title} <em>{faNum(done)}/{faNum(stage.items.length)}</em>
              <small>{stage.hint}</small>
            </h3>
            <ul>
              {stage.items.map((i) => (
                <li key={i.key}>
                  {/* دکمه است نه چک‌باکسِ نیتیو: هدفِ لمس باید با دستکش هم بخورد،
                      و تیک باید امضای زننده‌اش را کنارِ خودش نشان بدهد. */}
                  <button type="button" className={`th-check${i.checked ? ' on' : ''}`} aria-pressed={i.checked}
                    disabled={busy === `${stage.key}/${i.key}`} data-check={`${stage.key}/${i.key}`}
                    onClick={() => onToggle(stage.key, i.key, !i.checked)}>
                    <span className="th-box" aria-hidden="true">{i.checked && <Check width="14" height="14" />}</span>
                    <span className="th-label">{i.label}</span>
                    {i.checked && i.by && <span className="th-by">{i.by}{i.at ? ` · ${faTime(new Date(i.at).toTimeString().slice(0, 5))}` : ''}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {v.instructions && (
        <section className="th-note" aria-label="دستورِ جراح"><h3>دستورِ جراح</h3><p>{v.instructions}</p></section>
      )}

      {items.length > 0 && (
        <section className="th-box-list" aria-label="ستِ لازم">
          <h3>ستِ لازم</h3>
          <ul>{items.map((i, n) => <li key={`${i.name}-${n}`}><b>{i.name}</b> <span>×{faNum(i.quantity)}</span>{i.notes && <em>{i.notes}</em>}</li>)}</ul>
        </section>
      )}

      {documents.length > 0 && (
        <section className="th-box-list" aria-label="مدارکِ پرونده">
          <h3>مدارکِ پرونده</h3>
          <ul>{documents.map((d) => <li key={d.id}><b>{d.title || d.fileName}</b></li>)}</ul>
          <p className="th-hint">برای بازکردنِ فایل از پروندهٔ بیمار استفاده کنید.</p>
        </section>
      )}
    </div>
  );
}
