import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { api, apiBlobUrl } from '../lib/api.js';
import { faDate, jStrToIso, todayJStr } from '../lib/jalali.js';
import { faTime } from '../lib/time.js';
import JDate from './JDate.jsx';
import Overlay from '../ui/Overlay.jsx';
import { Alert, Back, Close, Clock, Form, LogOut, Theatre as TheatreIcon } from '../ui/icons.jsx';
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
 * **نمای اتاقِ عمل** — یک عمل، یک صفحه، در لحظه.
 *
 * بازخوردِ مالک ۱۴۰۵/۰۶/۳۱ («برای میزِ اتاقِ عمل خیلی ناقص ساختی») این صفحه را
 * از نو تعریف کرد. آنچه جراح **واقعاً** سرِ میز می‌خواهد، به همان ترتیب:
 *   ۱. بداند بیمار **چرا** آمده — شکایتِ اولیه.
 *   ۲. مدارکِ قبل و حین و بعد را **باز کند**، نه اینکه فقط نامشان را ببیند.
 *   ۳. **شرحِ عمل** را همین‌جا بنویسد.
 *   ۴. **ترخیص** بزند و وضعیتِ بیمار را هنگامِ ترخیص ثبت کند.
 * و چک‌لیستِ ایمنیِ WHO فعلاً لازم نیست — از رابط برداشته شد (داده و APIش
 * سرِ جایشان است؛ توضیح در `theatre.service.ts`).
 *
 * ⚠️ **هیچ عددِ مالی این‌جا نیست.** دستِ دستکش‌دار نه مبلغ لازم دارد نه باید
 * ببیند؛ سرور هم اصلاً نمی‌فرستدش. اگر روزی مبلغی دیده شد، اشکال آن‌طرف است.
 *
 * ⚠️ همهٔ متن‌ها و برچسب‌ها از سرور می‌آیند (قانونِ ۱۵): وضعیتِ اتاق، برچسبِ
 * مرحلهٔ مدارک و شکایتِ مشتق‌شده هیچ‌کدام این‌جا ساخته نمی‌شوند.
 */
export default function Theatre() {
  const [jday, setJday] = useState(todayJStr());
  const [day, setDay] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [card, setCard] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [discharging, setDischarging] = useState(false);

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

  /** هر کنشِ کارت یک POST و یک کارتِ تازه — فهرستِ روز هم با آن هم‌گام می‌شود. */
  const act = async (path, key, body) => {
    setBusy(key);
    try {
      setCard(await api(`/theatre/visits/${openId}${path}`, { method: 'POST', ...(body ? { body } : {}) }));
      await loadDay();
      return true;
    } catch (e) { setToast(e.message); return false; }
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
      {openId && card && (
        <Card
          card={card}
          busy={busy}
          onAct={act}
          onDischarge={() => setDischarging(true)}
          onToast={setToast}
        />
      )}

      {/* ⚠️ `AnimatePresence` در **والد** است نه داخلِ خودِ دیالوگ — وگرنه
          هنگامِ بسته‌شدن با آن unmount می‌شود و خروجی اجرا نمی‌شود. */}
      <AnimatePresence>
        {discharging && card && (
          <DischargeDialog
            initial={card.visit.dischargeNote ?? ''}
            already={!!card.visit.dischargeAt}
            busy={busy === 'discharge'}
            onClose={() => setDischarging(false)}
            onSave={async (condition) => {
              const done = await act('/discharge', 'discharge', { condition });
              if (done) { setDischarging(false); setToast('ترخیص ثبت شد ✓'); }
            }}
          />
        )}
      </AnimatePresence>

      {toast && <button type="button" className="th-toast" onClick={() => setToast('')}>{toast}</button>}
    </div>
  );
}

/** فهرستِ عمل‌های روز — ساعت، بیمار، عمل، و **چرا آمده**. */
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
            {/* ⚠️ جای شمارشِ چک‌لیست را گرفت: عددِ «۳/۷» به کسی نمی‌گفت این
                بیمار کیست، ولی «چرا آمده» همان چیزی است که جراح می‌خواهد. */}
            {v.chiefComplaint && <span className="th-item-cc">{v.chiefComplaint}</span>}
            <span className="th-item-side">
              <span className={`th-state is-${v.state}`}>{v.stateFa}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** کارتِ حینِ عمل. */
function Card({ card, busy, onAct, onDischarge, onToast }) {
  const { visit: v, patient: p, alerts, items, documents } = card;
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

      {/* ⚠️ **همیشه** رندر می‌شود، حتی خالی. «پرسیده نشده» با «نداشت» یکی نیست،
          و شکایتِ اولیه اولین چیزی است که جراح سرِ میز می‌پرسد. */}
      <section className={`th-cc${v.chiefComplaint ? ' on' : ''}`} aria-label="شکایتِ اولیه">
        <h3>شکایتِ اولیه</h3>
        <p>{v.chiefComplaint || 'در پرونده ثبت نشده — از بیمار بپرسید و در فرمِ مراجعه ثبت کنید'}</p>
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
            شروع شده، دکمهٔ پررنگِ غیرفعال هم چشم را می‌برد هم دروغ می‌گوید.
            ⚠️ و ترخیص دکمهٔ **سوم** است نه مترادفِ پایان — «توی جراحی یه پایانِ
            عمل داریم یه ترخیص». */}
        <div className="th-acts">
          <button type="button" className={`th-btn${running || v.opEndTime ? '' : ' primary'}`}
            disabled={!!v.opStartTime || busy === 'start' || v.state === 'cancelled'}
            onClick={() => onAct('/start', 'start')}>شروع شد</button>
          <button type="button" className={`th-btn${running ? ' primary' : ''}`}
            disabled={!v.opStartTime || !!v.opEndTime || busy === 'finish'}
            onClick={() => onAct('/finish', 'finish')}>پایان یافت</button>
          <button type="button" className={`th-btn${v.opEndTime && !v.dischargeAt ? ' primary' : ''}`}
            data-act="discharge"
            disabled={!v.opEndTime || v.state === 'cancelled' || busy === 'discharge'}
            onClick={onDischarge}>
            <LogOut width="15" height="15" aria-hidden="true" /> {v.dischargeAt ? 'ویرایشِ ترخیص' : 'ترخیص'}
          </button>
        </div>
      </section>

      {v.dischargeAt && (
        <section className="th-discharged" aria-label="ترخیص">
          <h3>ترخیص — {faDate(v.dischargeAt)}</h3>
          <p>{v.dischargeNote || '—'}</p>
        </section>
      )}

      <OpReport visit={v} busy={busy} onAct={onAct} onToast={onToast} />

      <Documents visitId={v.id} groups={documents} />

      {v.instructions && (
        <section className="th-note" aria-label="دستورِ جراح"><h3>دستورِ جراح</h3><p>{v.instructions}</p></section>
      )}

      {items.length > 0 && (
        <section className="th-box-list" aria-label="ستِ لازم">
          <h3>ستِ لازم</h3>
          <ul>{items.map((i, n) => <li key={`${i.name}-${n}`}><b>{i.name}</b> <span>×{faNum(i.quantity)}</span>{i.notes && <em>{i.notes}</em>}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

/**
 * **شرحِ عمل، همین‌جا.**
 *
 * ⚠️ متن در stateِ محلی می‌ماند و فقط با «ذخیره» می‌رود: ذخیرهٔ خودکار وسطِ
 * تایپِ جراح یعنی هر مکث یک نسخهٔ تازه در پرونده — و این سند نسخه‌دار است.
 *
 * ⚠️ اگر سرور متنِ تازه‌تری داشت (کسی از فرمِ مراجعه نوشته)، پیش‌نویسِ روی
 * صفحه بازنویسی **نمی‌شود**؛ فقط وقتی هم‌گام می‌شویم که کاربر چیزی ننوشته
 * باشد. همان قاعدهٔ `JDate`: نوشتهٔ کاربر زیرِ دستش عوض نمی‌شود.
 */
function OpReport({ visit, busy, onAct, onToast }) {
  const [text, setText] = useState(visit.opReport ?? '');
  const dirty = useRef(false);
  useEffect(() => {
    if (dirty.current) return;
    setText(visit.opReport ?? '');
  }, [visit.opReport]);

  const saved = (visit.opReport ?? '').trim();
  const changed = text.trim() !== saved;
  return (
    <section className="th-report" aria-label="شرحِ عمل">
      <h3><Form width="15" height="15" aria-hidden="true" /> شرحِ عمل</h3>
      <textarea
        rows={5}
        value={text}
        data-report
        placeholder="یافته‌ها، مسیرِ عمل، رخدادهای حینِ مانیتورینگ…"
        onChange={(e) => { dirty.current = true; setText(e.target.value); }}
      />
      <div className="th-report-bar">
        <span className="th-hint">
          {changed ? 'ذخیره نشده' : saved ? 'ذخیره شده در پروندهٔ بیمار' : 'هنوز نوشته نشده'}
        </span>
        <button
          type="button" className="th-btn" data-act="save-report"
          disabled={!changed || busy === 'report'}
          onClick={async () => {
            const done = await onAct('/report', 'report', { body: text });
            if (done) { dirty.current = false; onToast('شرحِ عمل ذخیره شد ✓'); }
          }}
        >ذخیرهٔ شرح</button>
      </div>
    </section>
  );
}

/**
 * **مدارکِ قبل / حین / بعد — بازشدنی.**
 *
 * ⚠️ تا دیروز فقط نامِ مدرک نوشته می‌شد و زیرش «از پروندهٔ بیمار بازش کنید»:
 * یعنی جراحِ وسطِ عمل باید از این صفحه بیرون می‌رفت و دسترسیِ بالاتری هم
 * می‌خواست. حالا مسیرِ خودِ اتاق (`theatre/.../file`) بازشان می‌کند.
 *
 * ⚠️ لینکِ دانلود با `<a download>` ساخته نمی‌شود چون نشستِ ما کوکیِ HttpOnly
 * است و کوکی روی همان دامنه می‌رود — پس `credentials: 'include'` لازم است و
 * تگِ ساده کافی نیست. برای همین مدرک با `fetch` گرفته و در تبِ تازه باز
 * می‌شود؛ مدرکِ لینکی هم که اصلاً فایلی ندارد و خودِ نشانی‌اش باز می‌شود.
 */
function Documents({ visitId, groups }) {
  const [busyId, setBusyId] = useState(0);
  const [err, setErr] = useState('');
  if (!groups.length) return null;

  const open = async (doc) => {
    if (doc.url) { window.open(doc.url, '_blank', 'noopener'); return; }
    /* 🔴 **پنجره باید پیش از `await` باز شود.** Safari (و کرومِ موبایل در
       بعضی حالت‌ها) `window.open` بعد از یک await را پاپ‌آپِ ناخواسته
       می‌شمارد و **بی‌صدا** بلاک می‌کند — یعنی همان مدرکی که مالک خواست
       سرِ میز باز شود، روی آیفون هیچ کاری نمی‌کرد و هیچ خطایی هم نمی‌داد.
       پس اول تبِ خالی باز می‌شود و بعد نشانی‌اش گذاشته می‌شود.
       ⚠️ `noopener` این‌جا عمداً نیست: با آن `window.open` مقدارِ `null`
       برمی‌گرداند و دیگر نمی‌شود نشانی را ست کرد. */
    const win = window.open('', '_blank');
    setBusyId(doc.id); setErr('');
    try {
      const url = await apiBlobUrl(`/theatre/visits/${visitId}/documents/${doc.id}/file`);
      if (win) {
        win.location = url;
      } else {
        /* پنجره بلاک شد (تنظیماتِ سخت‌گیر) — دستِ‌کم دانلود شود، نه اینکه
           لمسِ کاربر هیچ اثری نداشته باشد. */
        const a = document.createElement('a');
        a.href = url; a.download = doc.title || 'document';
        a.click();
      }
      /* ⚠️ نشانیِ بلاب باید آزاد شود وگرنه حافظه نشت می‌کند (هشدارِ خودِ
         `apiBlobUrl`) — ولی نه فوری: تبِ تازه هنوز آن را می‌خواند. */
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      win?.close();
      setErr(e.message || 'بازکردنِ مدرک ممکن نشد');
    } finally { setBusyId(0); }
  };

  return (
    <section className="th-docs" aria-label="مدارکِ پرونده">
      <h3>مدارکِ بیمار</h3>
      {groups.map((g) => (
        <div key={g.phase ?? 'none'} className="th-docgroup">
          <h4>{g.label}</h4>
          <ul>
            {g.items.map((d) => (
              <li key={d.id}>
                <button type="button" className="th-doc" data-doc={d.id}
                  disabled={busyId === d.id} onClick={() => open(d)}>
                  <b>{d.title}</b>
                  {d.url && <em>لینکِ بیرونی</em>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {err && <p className="th-hint" role="alert">{err}</p>}
    </section>
  );
}

/**
 * **پاپ‌آپِ ترخیص** — «با زدنِ ترخیص، توضیحِ وضعیت حینِ ترخیص باید پاپ‌آپ شه،
 * پر شه، سیو شه» (بازخوردِ مالک).
 *
 * ⚠️ متن اجباری است و دکمه تا پر نشدنش غیرفعال می‌ماند: ترخیصِ بی‌شرح سطری
 * است که می‌گوید بیمار رفت و نمی‌گوید در چه حالی — و همان سطر سندِ پرونده
 * می‌شود. سرور هم دوباره همین را می‌سنجد.
 */
function DischargeDialog({ initial, already, busy, onClose, onSave }) {
  const [text, setText] = useState(initial);
  const ok = text.trim().length >= 2;
  return (
    <Overlay
      backdrop="th-overlay" panel="th-dialog" as="form" from="center"
      closable={!busy} onClose={onClose} aria-label="ثبتِ ترخیص"
      onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onSave(text); }}
    >
      <header className="th-dialog-head">
        <b>{already ? 'ویرایشِ شرحِ ترخیص' : 'ترخیصِ بیمار'}</b>
        <button type="button" className="th-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
      </header>
      <label className="th-dialog-field">
        <span>وضعیتِ بیمار هنگامِ ترخیص</span>
        <textarea
          rows={5} value={text} autoFocus data-discharge-note
          placeholder="سطحِ هوشیاری، درد، محلِ عمل، توصیه‌های ترخیص…"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="th-hint">این متن در پروندهٔ بیمار به‌عنوانِ «شرحِ ترخیص» ثبت می‌شود و نامِ شما را می‌گیرد.</p>
      <div className="th-dialog-acts">
        <button type="button" className="th-btn" onClick={onClose} disabled={busy}>انصراف</button>
        <button type="submit" className="th-btn primary" disabled={!ok || busy}>
          {busy ? 'در حالِ ثبت…' : already ? 'ذخیرهٔ شرح' : 'ثبتِ ترخیص'}
        </button>
      </div>
    </Overlay>
  );
}
