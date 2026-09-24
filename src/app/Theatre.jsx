import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { api, apiBlobUrl } from '../lib/api.js';
import { faDate, jStrToIso, todayJStr } from '../lib/jalali.js';
import { faTime } from '../lib/time.js';
import JDate from './JDate.jsx';
import { useConfig, useStatusList } from './config.jsx';
import Overlay from '../ui/Overlay.jsx';
import { OpDefaultChips, OpDefaultSave, withTemplate } from './OpDefaults.jsx';
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

  /* شمارشِ عمل‌های هر روزِ ماه — همان دامنه‌ای که خودِ تخته دارد.
     `useCallback` چون `JDate` آن را در وابستگیِ افکتش می‌گذارد. */
  const loadMarks = useCallback(async (yy, mm) => {
    try {
      const r = await api(`/theatre/month?year=${yy}&month=${mm}`);
      return Object.fromEntries((r?.days ?? []).map((d) => [d.day, d.visits]));
    } catch { return {}; }
  }, []);

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
          <JDate value={jday} onChange={setJday} loadMarks={loadMarks} />
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
            initial={{
              condition: card.visit.dischargeNote ?? '',
              disposition: card.visit.dischargeDisposition ?? '',
              summary: card.visit.dischargeSummary ?? '',
              remark: card.visit.dischargeRemark ?? '',
            }}
            already={!!card.visit.dischargeAt}
            busy={busy === 'discharge'}
            onClose={() => setDischarging(false)}
            onSave={async (body) => {
              const done = await act('/discharge', 'discharge', body);
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
  /* ⚠️ «یافته‌های حینِ عمل» در مطب نیست (اصلاحِ مالک ۱۴۰۵/۰۷/۰۲) — همان
     چیزی که از فرمِ عمل برداشته شد، سرِ میز هم نباید دوباره پیدا شود. */
  const isClinic = useConfig().kind === 'clinic';
  /* ⚠️ عمل‌ها و تشخیص‌ها از **فهرستِ سرور** خوانده می‌شوند (اصلی اول، بستهٔ
     ۷) — نه با شکافتنِ برچسبِ «A + B» (قانونِ ۱۵). برچسب فقط وقتی به کار
     می‌آید که سرورِ قدیمی‌تر هنوز فهرست را نفرستد (فرانت و بک‌اند جدا دیپلوی
     می‌شوند و چند ثانیه‌ای ناهمگام‌اند). */
  const procs = v.procedures ?? [];
  const dxs = v.diagnoses ?? [];
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
        {/* ⚠️ `div` نه `p`: فهرست (`ul`) داخلِ پاراگراف HTMLِ نامعتبر است و
            مرورگر پاراگراف را پیش از فهرست می‌بندد. */}
        <div className="th-op">
          {procs.length > 0
            ? <CodingList items={procs} label="عمل‌ها" />
            : v.procedure && <span>{v.procedure}</span>}
          {v.hospital && <span className="th-op-at">{v.hospital}</span>}
          {!procs.length && !v.procedure && !v.hospital && <span>—</span>}
        </div>
        {(dxs.length > 0 || v.diagnosis || v.anesthesiaFa) && (
          <div className="th-dx">
            {dxs.length > 0 ? (
              <div className={`th-dx-set${dxs.length > 1 ? ' multi' : ''}`}>
                <span className="th-dx-h">{dxs.length > 1 ? 'تشخیص‌ها:' : 'تشخیص:'}</span>
                <CodingList items={dxs} label="تشخیص‌ها" />
              </div>
            ) : v.diagnosis && <span>تشخیص: <b>{v.diagnosis}</b></span>}
            {v.anesthesiaFa && <span>بیهوشی: <b>{v.anesthesiaFa}</b></span>}
          </div>
        )}
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

      {/* ویزیتی که تصمیمِ عمل در آن گرفته شد — «بیمار با چه یافته‌ای کاندیدِ
          عمل شد» سرِ میز، بی‌آنکه جراح پرونده را جدا باز کند (بستهٔ ۶الف). */}
      {card.decided && (
        <section className="th-decided" aria-label="ویزیتِ تصمیم">
          <h3>از ویزیتِ تصمیم{card.decided.opDate ? ` — ${faDate(card.decided.opDate)}` : ''}</h3>
          {/* ⚠️ تشخیص‌های ویزیتِ تصمیم «تشخیصِ **پیش از** عمل»اند و عمداً با همین
              عنوان جدا می‌آیند: به عمل ارث نمی‌رسند و کپی نمی‌شوند، چون تشخیصِ
              پس از عمل (بالای کارت) واقعیتِ دیگری است و می‌تواند فرق کند. */}
          {card.decided.diagnoses?.length > 0 ? (
            <div className="th-decided-dx">
              <b>تشخیصِ پیش از عمل</b>
              <CodingList items={card.decided.diagnoses} label="تشخیصِ پیش از عمل" />
            </div>
          ) : card.decided.diagnosis && (
            <p><b>تشخیصِ پیش از عمل</b><span>{card.decided.diagnosis}</span></p>
          )}
          {[
            ['شرحِ حال', card.decided.history],
            ['یافته‌ها', card.decided.findings],
            ['معاینه', card.decided.exam],
            ['طرحِ درمان', card.decided.plan],
          ].filter(([, t]) => t).map(([l, t]) => (
            <p key={l}><b>{l}</b><span>{t}</span></p>
          ))}
        </section>
      )}

      {card.vitals?.length > 0 && <VitalsView rows={card.vitals} />}

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
          <h3>ترخیص — {faDate(v.dischargeAt)}{v.dischargeDispositionFa ? ` · ${v.dischargeDispositionFa}` : ''}</h3>
          <p>{v.dischargeNote || '—'}</p>
          {v.dischargeSummary && <p className="th-dsum"><b>شرحِ ترخیص</b><span>{v.dischargeSummary}</span></p>}
          {v.dischargeRemark && <p className="th-dsum"><b>یادداشت</b><span>{v.dischargeRemark}</span></p>}
        </section>
      )}

      {!isClinic && (
        <NoteBox
          key={`findings-${v.id}`}
          visit={v} field="findings" path="/findings" actKey="findings"
          title="یافته‌های حینِ عمل" placeholder="آنچه حینِ عمل دیده شد…"
          savedMsg="یافته‌ها ذخیره شد ✓" busy={busy} onAct={onAct} onToast={onToast}
        />
      )}
      <NoteBox
        key={`report-${v.id}`}
        visit={v} field="opReport" path="/report" actKey="report"
        title="شرحِ عمل" placeholder="مسیرِ عمل، اقدام‌ها، رخدادهای حینِ عمل…"
        savedMsg="شرحِ عمل ذخیره شد ✓" busy={busy} onAct={onAct} onToast={onToast}
      />

      <Documents visitId={v.id} groups={documents} />

      {v.instructions && (
        <section className="th-note" aria-label="دستورِ جراح"><h3>دستورِ جراح</h3><p>{v.instructions}</p></section>
      )}

      {items.length > 0 && (
        <section className="th-box-list" aria-label="ستِ لازم">
          <h3>ستِ لازم</h3>
          {/* «طبقِ نسخه» کنارِ برنامه (مالک): اگر برنامه با نسخه فرق دارد، تیم سرِ عمل باید ببیند. */}
          <ul>{items.map((i, n) => <li key={`${i.name}-${n}`}><b>{i.name}</b> <span>×{faNum(i.quantity)}</span>
            {i.prescribed != null && <small className={`th-rx${i.prescribed !== i.quantity ? ' diff' : ''}`}>طبقِ نسخه ×{faNum(i.prescribed)}</small>}
            {i.notes && <em>{i.notes}</em>}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

/**
 * **فهرستِ تشخیص‌ها یا عمل‌ها** — همان فهرستِ آمادهٔ سرور (`procedures` /
 * `diagnoses`؛ بستهٔ ۷).
 *
 * ⚠️ ترتیب رتبهٔ بالینیِ سرور است و این‌جا مرتب نمی‌شود؛ اولی همیشه اصلی است.
 * ⚠️ نشانِ «اصلی» فقط وقتی **دو یا بیشتر** مورد هست: روی تک‌مورد هیچ خبری
 * نمی‌دهد و فقط سطرِ سرِ میز را شلوغ می‌کند — تک‌مورد درست مثلِ دیروز دیده
 * می‌شود.
 * ⚠️ کدِ ICD با `dir="ltr"` (قانونِ ۹): «M51.1» در متنِ راست‌به‌چپ بی‌آن
 * نقطه‌اش جابه‌جا می‌شود.
 */
function CodingList({ items, label }) {
  const multi = items.length > 1;
  return (
    <ul className={`th-codes${multi ? ' multi' : ''}`} aria-label={label}>
      {items.map((it) => (
        <li key={`${it.rank}-${it.id ?? ''}`} className={multi && it.primary ? 'is-primary' : undefined}>
          <span className="th-code-name">{it.name ?? it.title}</span>
          {it.icdCode && <span className="th-code-icd" dir="ltr">{it.icdCode}</span>}
          {multi && it.primary && <span className="th-code-primary">اصلی</span>}
        </li>
      ))}
    </ul>
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
function NoteBox({ visit, field, path, actKey, title, placeholder, savedMsg, busy, onAct, onToast }) {
  const [text, setText] = useState(visit[field] ?? '');
  const dirty = useRef(false);
  /* «نوشتهٔ خودم»: برخلافِ `dirty` با ذخیره پاک نمی‌شود — «بنویس، ذخیره کن، بعد
     به پیش‌فرض بیفزا» باید کار کند، ولی شرحی که میز با آن باز شده نه. */
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (dirty.current) return;
    setText(visit[field] ?? '');
  }, [visit[field]]); // eslint-disable-line react-hooks/exhaustive-deps

  const saved = (visit[field] ?? '').trim();
  const changed = text.trim() !== saved;

  /* ── پیش‌فرض‌های شرحِ عمل (درخواستِ مالک ۱۴۰۵/۰۷/۰۱) — فقط برای شرحِ عمل ──
     چیپ‌ها و «افزودن به پیش‌فرض» همان کامپوننتِ فرمِ عمل‌اند؛ مسیرِ سرور زیرِ
     ماژولِ اتاق است تا جراحِ سطح ۲ که داشبورد ندارد هم برسد. عمل‌ها از مراجعهٔ
     ذخیره‌شده (کلیدِ رشته‌ای، نه آرایهٔ تازهٔ هر رندر). */
  const isOp = field === 'opReport';
  const procKey = (visit.procedures ?? []).map((p) => p.id).join(',');
  const [tpl, setTpl] = useState({ items: [], canAdd: false, procedure: null });
  const [tplRev, setTplRev] = useState(0);
  useEffect(() => {
    if (!isOp) return undefined;
    let alive = true;
    api(`/theatre/visits/${visit.id}/op-templates`)
      .then((r) => {
        if (alive) setTpl({ items: Array.isArray(r?.items) ? r.items : [], canAdd: !!r?.canAdd, procedure: r?.procedure ?? null });
      })
      .catch(() => { if (alive) setTpl({ items: [], canAdd: false, procedure: null }); });
    return () => { alive = false; };
  }, [isOp, visit.id, procKey, tplRev]);

  return (
    <section className="th-report" aria-label={title} data-note={field}>
      <h3><Form width="15" height="15" aria-hidden="true" /> {title}</h3>
      {isOp && (
        <OpDefaultChips
          items={tpl.items}
          disabled={busy === actKey}
          onPick={(t) => { dirty.current = true; setTouched(true); setText((cur) => withTemplate(cur, t.body)); }}
        />
      )}
      <textarea
        rows={field === 'opReport' ? 5 : 3}
        value={text}
        {...(field === 'opReport' ? { 'data-report': true } : { 'data-findings': true })}
        placeholder={placeholder}
        onChange={(e) => { dirty.current = true; setTouched(true); setText(e.target.value); }}
      />
      <div className="th-report-bar">
        <span className="th-hint">
          {changed ? 'ذخیره نشده' : saved ? 'ذخیره شده در پروندهٔ بیمار' : 'هنوز نوشته نشده'}
        </span>
        <button
          type="button" className="th-btn" data-act={field === 'opReport' ? 'save-report' : 'save-findings'}
          disabled={!changed || busy === actKey}
          onClick={async () => {
            const done = await onAct(path, actKey, { body: text });
            if (done) { dirty.current = false; onToast(savedMsg); }
          }}
        >ذخیره</button>
      </div>
      {isOp && (
        <OpDefaultSave
          text={text}
          typed={touched}
          noTarget={!procKey}
          procedureName={tpl.procedure?.name ?? null}
          missingHint="این عمل هنوز نوعِ عمل ندارد — در فرمِ عمل انتخابش کنید تا بشود پیش‌فرض ساخت."
          canAdd={tpl.canAdd}
          disabled={busy === actKey}
          onToast={onToast}
          onSave={async (tTitle) => {
            const r = await api(`/theatre/visits/${visit.id}/op-templates`, {
              method: 'POST', body: { body: text, ...(tTitle ? { title: tTitle } : {}) },
            });
            setTplRev((n) => n + 1);
            return r;
          }}
        />
      )}
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
    /* ⚠️ **پنجره باید پیش از `await` باز شود.** Safari (و کرومِ موبایل در
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
  const dispositions = useStatusList('disposition');
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  /* وضعیتِ خروج و وضعیتِ بیمار اجباری‌اند؛ شرح و یادداشت اختیاری. */
  const ok = f.condition.trim().length >= 2 && !!f.disposition;
  return (
    <Overlay
      backdrop="th-overlay" panel="th-dialog" as="form" from="center"
      closable={!busy} onClose={onClose} aria-label="ثبتِ ترخیص"
      onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onSave(f); }}
    >
      <header className="th-dialog-head">
        <b>{already ? 'ویرایشِ ترخیص' : 'ترخیصِ بیمار'}</b>
        <button type="button" className="th-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
      </header>
      {/* ⚠️ وضعیتِ خروج دکمه است نه کشویی: یک لمس، و هر چهار گزینه همیشه
          جلوی چشم — «فوت» نباید پشتِ یک منوی بسته پنهان بماند. */}
      <div className="th-dialog-field">
        <span>وضعیتِ خروج</span>
        <div className="th-dispo" role="radiogroup" aria-label="وضعیتِ خروج">
          {dispositions.map((d) => (
            <button
              key={d.key} type="button" role="radio" aria-checked={f.disposition === d.key}
              data-disposition={d.key}
              className={`th-dispo-btn${f.disposition === d.key ? ' on' : ''}${d.key === 'death' ? ' grave' : ''}`}
              onClick={() => setF((x) => ({ ...x, disposition: d.key }))}
            >{d.label}</button>
          ))}
        </div>
      </div>
      <label className="th-dialog-field">
        <span>وضعیتِ بیمار هنگامِ ترخیص</span>
        <textarea
          rows={3} value={f.condition} autoFocus data-discharge-note
          placeholder="سطحِ هوشیاری، درد، محلِ عمل…"
          onChange={set('condition')}
        />
      </label>
      <label className="th-dialog-field">
        <span>شرحِ ترخیص <i>اختیاری</i></span>
        <textarea
          rows={4} value={f.summary} data-discharge-summary
          placeholder="سیرِ بستری، داروهای ترخیص، توصیه‌ها، زمانِ مراجعهٔ بعدی…"
          onChange={set('summary')}
        />
      </label>
      <label className="th-dialog-field">
        <span>یادداشت <i>اختیاری</i></span>
        <textarea
          rows={2} value={f.remark} data-discharge-remark
          placeholder="نکته‌ای برای تیم…"
          onChange={set('remark')}
        />
      </label>
      <p className="th-hint">هر سه متن در پروندهٔ بیمار با نامِ شما ثبت می‌شوند؛ اصلاحِ بعدی نسخهٔ تازه می‌سازد.</p>
      <div className="th-dialog-acts">
        <button type="button" className="th-btn" onClick={onClose} disabled={busy}>انصراف</button>
        <button type="submit" className="th-btn primary" disabled={!ok || busy}>
          {busy ? 'در حالِ ثبت…' : already ? 'ذخیرهٔ ترخیص' : 'ثبتِ ترخیص'}
        </button>
      </div>
    </Overlay>
  );
}

/**
 * علائمِ حیاتیِ همین عمل — فقط‌خواندنی سرِ میز (ثبتش در فرمِ مراجعه است).
 * برچسب و واحد از `/config.vitals`؛ BMI و برچسبِ مرحله از خودِ ردیف (سرور).
 */
function VitalsView({ rows }) {
  const FA = '۰۱۲۳۴۵۶۷۸۹';
  const fa = (x) => String(x).replace(/\d/g, (d) => FA[d]).replace('.', '٫');
  const line = (r) => [
    r.bpSys != null ? `فشار ${fa(r.bpSys)}/${fa(r.bpDia)}` : null,
    r.hr != null ? `نبض ${fa(r.hr)}` : null,
    r.rr != null ? `تنفس ${fa(r.rr)}` : null,
    r.temp != null ? `دما ${fa(r.temp)}` : null,
    r.spo2 != null ? `اکسیژن ${fa(r.spo2)}٪` : null,
    r.pain != null ? `درد ${fa(r.pain)}/۱۰` : null,
    r.bmi != null ? `BMI ${fa(r.bmi)}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <section className="th-vitals" aria-label="علائمِ حیاتی">
      <h3>علائمِ حیاتی</h3>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            {r.phaseFa && <b>{r.phaseFa}</b>}
            <span>{line(r)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
