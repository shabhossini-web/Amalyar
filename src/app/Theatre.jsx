import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, apiBlobUrl } from '../lib/api.js';
import { faDate, jStrToIso, toEnDigits, todayJStr, ymdToJStr } from '../lib/jalali.js';
import { faDuration, faTime } from '../lib/time.js';
import JDate from './JDate.jsx';
import { useConfig, useStatusList, useTerms } from './config.jsx';
import Overlay, { CloseButton, UnsavedPrompt } from '../ui/Overlay.jsx';
import Tabs from '../ui/Tabs.jsx';
import DynForm, { dynErrors } from '../ui/DynForm.jsx';
import { AttachPicker, useSubformCatalog } from './VisitSubforms.jsx';
import { ThingPopups, useThings } from './thing-popups.jsx';
import { useAuth } from './auth.jsx';
import { OpDefaultChips, OpDefaultSave, withTemplate } from './OpDefaults.jsx';
import { Alert, Back, Check, Close, Clock, Form, LogOut, Pencil, Plus, Theatre as TheatreIcon, User, Users } from '../ui/icons.jsx';
import TimePick from '../ui/TimePick.jsx';
import './theatre.css';
import './definitions.css';
import './launcher.css';

const faNum = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/**
 * برچسبِ دکمهٔ فیلتر: نام و شمارِ پررنگ — همان شکلِ فیلترِ «مالِ کیست» در پنلِ
 * کارشناسی و «امروز»، تا ناظر در سه صفحه یک زبان ببیند. شمار داخلِ برچسب است نه
 * `badge`ِ کهربایی (آن یعنی «هشدار»).
 */
const counted = (label, n) => <>{label} <b className="th-own-n">{faNum(n)}</b></>;
const GENDER_FA = { male: 'مرد', female: 'زن' };
/* «ویزیتِ بعدی» روزِ تقویمی است (نیمه‌شبِ UTC) — از اجزا، نه `new Date` که در منطقهٔ منفی روزِ قبل می‌شود. */
const nextYmd = (iso) => (iso ? String(iso).slice(0, 10) : '');
const nextJ = (iso) => ymdToJStr(nextYmd(iso));
/** روزِ شمسی ← پارامترِ نشانی «1405-07-06» (رقمِ لاتین، دوتایی)؛ نیمه‌تایپ‌شده ← null. */
const dayParam = (j) => {
  const m = toEnDigits(j).trim().match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  return m && jStrToIso(j) ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
};

/** «HH:MM» → دقیقه؛ برای مدتِ سپری‌شده. ساعتِ دیوار است، پس همان‌روز حساب می‌شود. */
const mins = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
/** دقیقه‌های میانِ دو ساعتِ دیوار؛ پایانِ کوچک‌تر یعنی عمل از نیمه‌شب گذشته. */
const minutesBetween = (from, to) => {
  const a = mins(from); const b = mins(to);
  if (a == null || b == null) return null;
  return (b - a + 1440) % 1440;
};

/* **پیش‌نویسِ روی دستگاه** (بازبینیِ UX ۱۴۰۵/۰۷ — surgery-07): «شرحِ عمل»ِ ذخیره‌نشده با زدنِ «فهرستِ
   روز»، برگشتِ گوشی یا تازه‌کردنِ صفحه پاک می‌شد. حالا تا «ذخیره» یا «دور ریختن» روی همین دستگاه
   می‌ماند و با بازکردنِ دوبارهٔ کارت برمی‌گردد. کلید شناسهٔ کاربر را دارد (دستگاهِ مشترکِ اتاقِ عمل)
   و پس از یک روز کهنه حساب و پاک می‌شود. */
const DRAFT_TTL = 24 * 3600e3;
const draftKey = (uid, visitId, field) => `amalyar_draft:${uid ?? 0}:${visitId}:${field}`;
const readDraft = (k) => {
  try {
    const v = JSON.parse(localStorage.getItem(k) ?? 'null');
    if (!v || typeof v.text !== 'string' || Date.now() - (Number(v.at) || 0) > DRAFT_TTL) { localStorage.removeItem(k); return null; }
    return v.text;
  } catch { return null; }
};
const writeDraft = (k, text) => { try { localStorage.setItem(k, JSON.stringify({ text, at: Date.now() })); } catch { /* حالتِ ناشناس — فقط همین صفحه */ } };
const dropDraft = (k) => { try { localStorage.removeItem(k); } catch { /* همان */ } };

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
 * **هیچ عددِ مالی این‌جا نیست.** دستِ دستکش‌دار نه مبلغ لازم دارد نه باید
 * ببیند؛ سرور هم اصلاً نمی‌فرستدش. اگر روزی مبلغی دیده شد، اشکال آن‌طرف است.
 *
 * همهٔ متن‌ها و برچسب‌ها از سرور می‌آیند (قانونِ ۱۵): وضعیتِ اتاق، برچسبِ
 * مرحلهٔ مدارک و شکایتِ مشتق‌شده هیچ‌کدام این‌جا ساخته نمی‌شوند.
 */
export default function Theatre() {
  const t = useTerms();
  /* **نشانی منبعِ حقیقتِ روز و عملِ باز است** (بازبینیِ UX ۱۴۰۵/۰۷ — surgery-06):
     «/app/theatre?date=1405-07-06&visit=19». تا دیروز هر دو فقط در state بودند: «برگشت»ِ گوشی به‌جای
     فهرستِ روز از کلِ صفحه بیرون می‌رفت، تازه‌کردن عملِ باز و روزِ انتخابی را گم می‌کرد و پیوندِ یک عمل
     را نمی‌شد برای همکار فرستاد. بازکردنِ کارت یک ورودیِ تاریخچه می‌سازد تا «برگشت» اول همان را ببندد؛
     عوض‌کردنِ روز جای ورودیِ فعلی را می‌گیرد (ده روز جلو رفتن ده «برگشت» نمی‌خواهد). */
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const urlDay = (() => { const d = dayParam(params.get('date') ?? ''); return d ? d.replace(/-/g, '/') : null; })();
  const [jday, setJdayText] = useState(() => urlDay ?? todayJStr());
  const openId = Number(params.get('visit')) || null;
  const [day, setDay] = useState(null);
  const [card, setCard] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [discharging, setDischarging] = useState(false);
  /* فیلترِ «مالِ کیست» (نمای سرپرستی) — در state همین صفحه، تا با باز و بسته‌شدنِ
     کارتِ یک عمل همان فیلتر بماند. */
  const [who, setWho] = useState('all');
  /* **نوشته‌های ذخیره‌نشدهٔ کارت** (surgery-07) — هر جعبه (شرحِ عمل، یافته‌ها، فرمِ حینِ عمل) خودش
     را این‌جا ثبت می‌کند: `{label, save, discard}`. «فهرستِ روز» پیش از بستنِ کارت همین را می‌پرسد. */
  const unsaved = useRef(new Map()).current;
  const [leaving, setLeaving] = useState(null); // null | برچسب‌های ذخیره‌نشده
  const [leaveBusy, setLeaveBusy] = useState(false);

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
  /* با بازشدن و بسته‌شدنِ کارت هم — فهرستِ روز بعد از کارهای کارت تازه بماند. */
  useEffect(() => { loadDay(); }, [loadDay, openId]);

  /** روزِ تازه — کادرِ تاریخ همان متنِ تایپ‌شده را نگه می‌دارد؛ نشانی فقط تاریخِ کامل و درست را. */
  const setJday = (v) => {
    setJdayText(v);
    const d = dayParam(v);
    if (d) setParams((p) => { const n = new URLSearchParams(p); n.set('date', d); return n; }, { replace: true });
  };
  /* نشانی از بیرون عوض شد (برگشت/جلو، پیوندِ فرستاده‌شده) — کادرِ تاریخ هم‌گام می‌شود. */
  useEffect(() => {
    if (urlDay && jStrToIso(urlDay) !== jStrToIso(jday)) setJdayText(urlDay);
  }, [urlDay]); // eslint-disable-line react-hooks/exhaustive-deps

  /** کلیک روی ردیف: اول کارت خوانده می‌شود (ردیف تا آن موقع «در حالِ باز شدن» است)، بعد نشانی. */
  const openCard = useCallback(async (id) => {
    setBusy(`open-${id}`);
    try {
      setCard(await api(`/theatre/visits/${id}`));
      setParams((p) => {
        const n = new URLSearchParams(p);
        const d = dayParam(jday);
        if (d) n.set('date', d);
        n.set('visit', String(id));
        return n;
      }, { state: { thCard: true } });
    }
    catch (e) { setToast(e.message); }
    finally { setBusy(''); }
  }, [jday, setParams]);
  /* نشانی ← کارت: تازه‌کردن، برگشت/جلو یا پیوندِ فرستاده‌شده. عملِ نیافتنی (حذف‌شده، بی‌دسترسی)
     پیامش را می‌دهد و از نشانی برداشته می‌شود — نه صفحهٔ خالیِ «در حالِ بارگذاری» تا ابد. */
  useEffect(() => {
    if (!openId) { setCard(null); return undefined; }
    if (card?.visit?.id === openId) return undefined;
    let alive = true;
    api(`/theatre/visits/${openId}`)
      .then((c) => { if (alive) setCard(c); })
      .catch((e) => {
        if (!alive) return;
        setToast(e.message);
        setParams((p) => { const n = new URLSearchParams(p); n.delete('visit'); return n; }, { replace: true });
      });
    return () => { alive = false; };
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /* کارتی که همین‌جا باز شد یک ورودیِ تاریخچه دارد — «فهرستِ روز» همان را برمی‌دارد (برگشتِ بعدی
     صفحه را عوض می‌کند، نه اینکه کارت را دوباره باز کند)؛ کارتی که از پیوند آمد فقط از نشانی می‌رود. */
  /* «بازکردنِ فرمِ عمل» روی خودِ میز (surgery-04) — همان میزبانِ پاپ‌آپِ «فهرستِ انتظار»؛ بعد از ذخیره
     کارت و فهرستِ روز تازه می‌شوند. */
  const reloadCard = useCallback(async () => {
    if (openId) { try { setCard(await api(`/theatre/visits/${openId}`)); } catch { /* کارت همان قبلی می‌ماند */ } }
    loadDay();
  }, [openId, loadDay]);
  const things = useThings({ onChanged: reloadCard, toast: (m) => setToast(m) });

  const closeCard = () => {
    if (location.state?.thCard) navigate(-1);
    else setParams((p) => { const n = new URLSearchParams(p); n.delete('visit'); return n; }, { replace: true });
  };
  /** برگشت به فهرستِ روز — نوشتهٔ ذخیره‌نشده اول پرسیده می‌شود (ذخیره / دور ریختن / ادامهٔ ویرایش). */
  const backToDay = () => {
    if (unsaved.size) { setLeaving([...unsaved.values()].map((u) => u.label)); return; }
    closeCard();
  };
  const leaveSaving = async () => {
    setLeaveBusy(true);
    try {
      for (const u of [...unsaved.values()]) {
        /* شکستِ یکی (پیامش را `act` داده) یعنی روی کارت بمان — نه اینکه بقیه را هم بی‌صدا رها کنی. */
        if (!(await u.save())) { setLeaving(null); return; }
      }
      setLeaving(null);
      closeCard();
    } finally { setLeaveBusy(false); }
  };
  const leaveDiscarding = () => {
    for (const u of unsaved.values()) u.discard?.();
    unsaved.clear();
    setLeaving(null);
    closeCard();
  };

  /* دسته‌ها و شمارشان از سرور می‌آیند (`day.owners`، فقط در نمای سرپرستی)؛ این‌جا فقط
     انتخاب می‌شوند. با یک نفر چیزی برای فیلترکردن نیست. دسته‌ای که با عوض‌شدنِ روز
     دیگر نیست، بی‌صدا به «همه» برمی‌گردد — نه فهرستِ خالی. */
  const owners = day?.team ? day.owners ?? [] : [];
  const filterable = owners.length > 1;
  const pickedOwner = owners.find((o) => o.key === who);
  const pick = pickedOwner ? who : 'all';
  const visible = day ? (pickedOwner ? day.visits.filter((v) => (v.techId ?? null) === pickedOwner.techId) : day.visits) : [];

  if (err?.status === 403) {
    return <div className="th"><div className="th-note" role="status">{err.message} — از «همهٔ ابزارها» به بخش‌های خودتان بروید.</div></div>;
  }

  return (
    <div className="th">
      <header className="th-head">
        <div>
          <h1><TheatreIcon width="20" height="20" aria-hidden="true" /> اتاقِ عمل</h1>
          <p>{faDate(iso)}</p>
          {/* نمای سرپرستی (قانونِ ۲۹) — تصمیمش از سرور می‌آید (`day.team`)، نه از
              سطحِ کاربر؛ بقیه همان عنوانِ دیروز را می‌بینند. */}
          {day?.team && !openId && (
            <p className="th-scope"><Users width="14" height="14" aria-hidden="true" /> {`عمل‌های همه — نامِ جراح و ${t.tech}ِ هر عمل روی ردیفش است`}</p>
          )}
        </div>
        {!openId && <>
          <JDate value={jday} onChange={setJday} loadMarks={loadMarks} />
          <button type="button" className="th-today" onClick={() => setJday(todayJStr())}>امروز</button>
        </>}
        {openId && (
          <button type="button" className="th-today" onClick={backToDay}>
            <Back width="15" height="15" aria-hidden="true" /> فهرستِ روز
          </button>
        )}
        <Link className="th-exit" to="/app">سامانه</Link>
      </header>

      {err && err.status !== 403 && <div className="th-err" role="alert">{err.message}</div>}

      {!openId && filterable && (
        <Tabs
          label={`${t.tech}ِ هر عمل`}
          variant="scroll"
          className="th-owners"
          value={pick}
          onChange={setWho}
          items={[
            { key: 'all', label: counted('همه', day.visits.length), icon: Users },
            ...owners.map((o) => ({ key: o.key, label: counted(o.kind === 'none' ? `بی‌${t.tech}` : o.label, o.count) })),
          ]}
        />
      )}
      {!openId && <DayList day={day} visits={visible} busy={busy} onOpen={openCard} techLabel={t.tech} />}
      {openId && !card && <p className="th-empty">در حالِ بارگذاری…</p>}
      {openId && card && (
        <Card
          card={card}
          team={!!day?.team}
          techLabel={t.tech}
          busy={busy}
          onAct={act}
          onDischarge={() => setDischarging(true)}
          onToast={setToast}
          unsaved={unsaved}
          onOpenForm={() => things.open({ type: 'visit', id: card.visit.id, patientId: card.patient?.id })}
        />
      )}

      {/* `AnimatePresence` در **والد** است نه داخلِ خودِ دیالوگ — وگرنه
          هنگامِ بسته‌شدن با آن unmount می‌شود و خروجی اجرا نمی‌شود. */}
      <AnimatePresence>
        {discharging && card && (
          <DischargeDialog
            initial={{
              condition: card.visit.dischargeNote ?? '',
              disposition: card.visit.dischargeDisposition ?? '',
              summary: card.visit.dischargeSummary ?? '',
              remark: card.visit.dischargeRemark ?? '',
              rx: card.visit.dischargeRx ?? '',
              nextVisitDateJ: nextJ(card.visit.nextVisitDate),
            }}
            clinical={!!card.clinical}
            canFollowUp={!!card.can?.followup}
            followLock={card.locks?.followup ?? null}
            already={!!card.visit.dischargeAt}
            patientName={card.patient?.fullName ?? ''}
            patientCode={card.patient?.code ?? ''}
            procedure={card.visit.procedure ?? ''}
            busy={busy === 'discharge'}
            onClose={() => setDischarging(false)}
            onSave={async (f) => {
              /* بدنه صریح ساخته می‌شود نه `f`ِ خام: `nextVisitDateJ` مقدارِ کادر است نه فیلدِ API. */
              const body = { condition: f.condition, disposition: f.disposition, summary: f.summary, remark: f.remark };
              if (card.clinical && f.disposition !== 'death') {
                body.rx = f.rx ?? '';
                const iso = f.nextVisitDateJ ? jStrToIso(f.nextVisitDateJ) : null;
                /* فقط تاریخِ **تازه** — همان تاریخ یعنی «دست نزن» (سرور هم همین را می‌فهمد). */
                if (card.can?.followup && iso && iso !== nextYmd(card.visit.nextVisitDate)) body.nextVisitDate = iso;
              }
              const done = await act('/discharge', 'discharge', body);
              if (done) { setDischarging(false); setToast('ترخیص ثبت شد'); }
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {leaving && (
          <UnsavedPrompt
            busy={leaveBusy}
            text={`${leaving.map((l) => `«${l}»`).join('، ')} هنوز ذخیره نشده — اگر بی‌ذخیره به فهرستِ روز برگردید، از بین می‌رود.`}
            onSave={leaveSaving}
            onDiscard={leaveDiscarding}
            onCancel={() => setLeaving(null)}
          />
        )}
      </AnimatePresence>

      <ThingPopups things={things} />
      {toast && <button type="button" className="th-toast" onClick={() => setToast('')}>{toast}</button>}
    </div>
  );
}

/**
 * فهرستِ عمل‌های روز — ساعت، بیمار، عمل، و **چرا آمده**.
 *
 * در نمای سرپرستی (`day.team`) هر ردیف یک سطرِ «مالِ کیست» هم دارد — جراح و
 * کارشناسِ همان عمل، با متن و آیکون (نه فقط رنگ). جراح از سطرِ فرعی به همین
 * سطر می‌آید تا دو بار نوشته نشود؛ «تعیین نشده» هم خودش خبر است: عملی که
 * هنوز کسی برایش گذاشته نشده.
 */
function DayList({ day, visits, busy, onOpen, techLabel }) {
  if (!day) return <p className="th-empty">در حالِ بارگذاری…</p>;
  if (!day.visits.length) return <p className="th-empty">برای این روز عملی ثبت نشده.</p>;
  const team = !!day.team;
  return (
    <ul className="th-list">
      {visits.map((v) => (
        <li key={v.id}>
          <button type="button" className={`th-item${team ? ' has-owner' : ''}${busy === `open-${v.id}` ? ' busy' : ''}`} data-visit-id={v.id} onClick={() => onOpen(v.id)}>
            {/* ساعتِ نامعلوم «ساعت؟»ِ کم‌رنگ است، نه یک «—»ِ درشتِ فیروزه‌ای که شبیهِ دکمهٔ «جمع‌کردن» بود
                (بازبینیِ UX ۱۴۰۵/۰۷ — company-22). خودِ ردیف میز را باز می‌کند و «ثبتِ شروع» اولِ همان است. */}
            {v.opStartTime
              ? <span className="th-item-time" dir="ltr">{faTime(v.opStartTime)}</span>
              : <span className="th-item-time is-empty" data-no-time title="ساعتِ شروع هنوز ثبت نشده">ساعت؟</span>}
            <span className="th-item-name">{v.patient}</span>
            {team && (
              <span className="th-item-owner">
                <User width="13" height="13" aria-hidden="true" />
                <span>جراح: <b>{v.surgeon || 'ثبت نشده'}</b></span>
                <span className={v.tech ? undefined : 'none'}>{techLabel}: <b>{v.tech || 'تعیین نشده'}</b></span>
              </span>
            )}
            <span className="th-item-sub">{[v.procedure, v.hospital, team ? null : v.surgeon].filter(Boolean).join(' · ') || v.code}</span>
            {/* جای شمارشِ چک‌لیست را گرفت: عددِ «۳/۷» به کسی نمی‌گفت این
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

/**
 * **مراحلِ عمل سرِ میز** — «۱ شروع ← ۲ پایان ← ۳ ترخیص» (بازبینیِ UX ۱۴۰۵/۰۷ — surgery-03/04).
 *
 * تا دیروز سه دکمهٔ هم‌شکل بودند: «شروع شد» خاکستری یعنی «انجام شد»، «ترخیص» خاکستری یعنی «هنوز نه» و
 * هیچ‌کدام نمی‌گفت چرا؛ برچسب‌ها گزارشِ گذشته بودند نه فرمان، و «تا این لحظه ۱۱:۵۶» شبیهِ ساعت خوانده
 * می‌شد نه مدت. حالا:
 *  - مرحلهٔ انجام‌شده **تیک و ساعت** می‌گیرد، نه دکمهٔ مرده؛ فقط مرحلهٔ بعدی دکمهٔ اصلی است، با فعل
 *    («ثبتِ شروع»، «ثبتِ پایان»)؛ مرحلهٔ بعدتر می‌گوید کِی باز می‌شود.
 *  - هر ثبت یک نوارِ ۱۰ثانیه‌ای «… ساعتِ ۱۰:۱۵ ثبت شد — برگرداندن» دارد و کنارِ هر ساعت «اصلاحِ ساعت» —
 *    لمسِ اشتباهِ دستِ دستکش‌دار دیگر فقط از فرمِ عمل درست نمی‌شود (`POST …/times`).
 *  - مدت به‌صورتِ «۱۱ ساعت و ۵۶ دقیقه».
 * در نصبِ شرکتی ترخیص نیست (company-12): شرکت حینِ عملِ جراحِ دیگری خدمت می‌دهد، بیمار را ترخیص نمی‌کند.
 */
function OpSteps({ v, clinical, canTimes, busy, onAct, onDischarge, onToast, elapsedMin, running }) {
  const [undo, setUndo] = useState(null); // {which, at}
  const [fixing, setFixing] = useState(null); // 'start' | 'end'
  const [draft, setDraft] = useState('');
  useEffect(() => {
    if (!undo) return undefined;
    const h = setTimeout(() => setUndo(null), 10000);
    return () => clearTimeout(h);
  }, [undo]);
  const cancelled = v.state === 'cancelled';
  const stamp = async (which) => {
    if (await onAct(which === 'start' ? '/start' : '/finish', which === 'start' ? 'start' : 'finish')) {
      setUndo({ which });
    }
  };
  const revert = async () => {
    const u = undo;
    setUndo(null);
    if (await onAct('/times', 'times', u.which === 'start' ? { opStartTime: null } : { opEndTime: null })) {
      onToast(u.which === 'start' ? 'شروعِ عمل برگشت — دوباره می‌شود ثبتش کرد' : 'پایانِ عمل برگشت — عمل دوباره در جریان است');
    }
  };
  const saveFix = async () => {
    const key = fixing === 'start' ? 'opStartTime' : 'opEndTime';
    if (await onAct('/times', 'times', { [key]: draft })) { setFixing(null); onToast('ساعت اصلاح شد'); }
  };
  const steps = [
    { key: 'start', label: 'شروعِ عمل', verb: 'ثبتِ شروع', act: 'start', at: v.opStartTime, wait: '' },
    { key: 'end', label: 'پایانِ عمل', verb: 'ثبتِ پایان', act: 'finish', at: v.opEndTime, wait: 'بعد از ثبتِ شروع' },
    ...(clinical ? [{ key: 'discharge', label: 'ترخیص', verb: 'ترخیص', act: 'discharge', at: v.dischargeAt, wait: 'بعد از ثبتِ پایان فعال می‌شود' }] : []),
  ];
  const next = cancelled ? null : steps.find((st) => !st.at)?.key ?? null;
  const timeOf = (st) => (st.key === 'start' ? v.opStartTime : st.key === 'end' ? v.opEndTime : null);
  return (
    <section className="th-clock" aria-label="مراحلِ عمل">
      <ol className="th-steps">
        {steps.map((st, i) => {
          const done = !!st.at;
          const state = done ? 'done' : st.key === next ? 'next' : 'wait';
          const t = timeOf(st);
          return (
            <li key={st.key} className={`th-step is-${state}`} data-step={st.key} data-state={state}>
              <span className="th-step-n" aria-hidden="true">{done ? <Check width="15" height="15" /> : faNum(i + 1)}</span>
              <div className="th-step-body">
                <b>{st.label}</b>
                {done && t && <span className="th-step-at" dir="ltr">{faTime(t)}</span>}
                {done && st.key === 'discharge' && <span className="th-step-at">{faDate(v.dischargeAt)}</span>}
                {state === 'wait' && <small id={`th-wait-${st.key}`}>{cancelled ? 'عمل لغو شده است' : st.wait}</small>}
                {done && canTimes && t && fixing !== st.key && (
                  <button type="button" className="th-link" data-act={`fix-${st.key}`}
                          onClick={() => { setFixing(st.key); setDraft(t); setUndo(null); }}>
                    <Pencil width="13" height="13" aria-hidden="true" /> اصلاحِ ساعت
                  </button>
                )}
                {fixing === st.key && (
                  <div className="th-fix">
                    <TimePick label={`ساعتِ ${st.key === 'start' ? 'شروع' : 'پایان'}`} value={draft} onChange={setDraft} className="db-field th-fix-pick" />
                    <button type="button" className="th-btn primary" onClick={saveFix} disabled={busy === 'times' || !draft}>ذخیرهٔ ساعت</button>
                    <button type="button" className="th-btn" onClick={() => setFixing(null)} disabled={busy === 'times'}>انصراف</button>
                  </div>
                )}
              </div>
              {state === 'next' && st.act !== 'discharge' && (
                <button type="button" className="th-btn primary" data-act={st.act} disabled={busy === st.act}
                        onClick={() => stamp(st.key)}>{busy === st.act ? 'در حالِ ثبت…' : st.verb}</button>
              )}
              {st.act === 'discharge' && (state === 'next' || done) && (
                <button type="button" className={`th-btn${state === 'next' ? ' primary' : ''}`} data-act="discharge"
                        disabled={busy === 'discharge'} onClick={onDischarge}>
                  <LogOut width="15" height="15" aria-hidden="true" /> {done ? 'ویرایشِ ترخیص' : st.verb}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {elapsedMin != null && (
        <p className="th-elapsed"><Clock width="13" height="13" aria-hidden="true" /> {running ? 'مدت تا این لحظه' : 'مدتِ عمل'}: <b>{faDuration(elapsedMin)}</b></p>
      )}
      {undo && (
        <div className="th-undo" role="status">
          <span>
            {undo.which === 'start' ? 'شروعِ عمل' : 'پایانِ عمل'} ساعتِ{' '}
            <b dir="ltr">{faTime(undo.which === 'start' ? v.opStartTime : v.opEndTime)}</b> ثبت شد
          </span>
          {canTimes && <button type="button" className="th-link" data-act="undo" onClick={revert} disabled={busy === 'times'}>برگرداندن</button>}
        </div>
      )}
    </section>
  );
}

/**
 * کارتِ حینِ عمل.
 *
 * `team` همان پرچمِ سرور در پاسخِ تخته است (قانونِ ۲۹): در نمای سرپرستی
 * عملِ بی‌کارشناس «تعیین نشده» می‌گوید، نه اینکه جایش خالی بماند — همان خبری
 * که ردیفِ فهرست داد، با بازکردنِ کارت گم نشود.
 *
 * ⚠️ **ترتیب** (بازبینیِ UX ۱۴۰۵/۰۷ — surgery-05): در ۳۹۰px هشدارِ حساسیت از پیکسلِ ۸۶۷ و دکمه‌های
 * شروع/پایان از ۱۲۵۴ شروع می‌شدند؛ وقتی پرستار به دکمه‌ها می‌رسید نامِ بیمار دیگر روی صفحه نبود. حالا:
 * نام و عمل ← هشدارها (سه کادرِ خالی یک سطر) ← مراحل ← شکایت ← «از ویزیتِ تصمیم» (جمع‌شونده) ← بقیه.
 * ترتیبِ DOM همان ترتیبِ دیداری است — نه `order`ِ CSS — تا Tab و صفحه‌خوان هم همین را بخوانند.
 */
function Card({ card, team, techLabel, busy, onAct, onDischarge, onToast, unsaved, onOpenForm }) {
  const { visit: v, patient: p, alerts, items, documents } = card;
  const t = useTerms();
  /* «یافته‌های حینِ عمل» در مطب نیست (اصلاحِ مالک ۱۴۰۵/۰۷/۰۲) — همان
     چیزی که از فرمِ عمل برداشته شد، سرِ میز هم نباید دوباره پیدا شود. */
  const isClinic = useConfig().kind === 'clinic';
  /* پرسش‌های بالینیِ «از بیمار بپرسید» (گروهِ خونی، حساسیت، دارو، شکایت) کارِ مطب است؛ شرکت حینِ عملِ
     جراحِ دیگری خدمت می‌دهد و کارشناسش این‌ها را نمی‌پرسد (company-12) — فقط اگر ثبت شده باشند دیده
     می‌شوند. پرچم از سرور است (`clinical`)، نه از حدسِ حوزه. */
  const clinical = !!card.clinical;
  /* عمل‌ها و تشخیص‌ها از **فهرستِ سرور** خوانده می‌شوند (اصلی اول، بستهٔ
     ۷) — نه با شکافتنِ برچسبِ «A + B» (قانونِ ۱۵). برچسب فقط وقتی به کار
     می‌آید که سرورِ قدیمی‌تر هنوز فهرست را نفرستد (فرانت و بک‌اند جدا دیپلوی
     می‌شوند و چند ثانیه‌ای ناهمگام‌اند). */
  const procs = v.procedures ?? [];
  const dxs = v.diagnoses ?? [];
  /* **مدتِ زنده** وقتی عمل در جریان است: سرِ میز «چقدر گذشته» را کسی از
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
  const elapsedMin = v.opEndTime ? minutesBetween(v.opStartTime, v.opEndTime) : running ? minutesBetween(v.opStartTime, nowHHMM()) : null;
  void tick;
  /* «از ویزیتِ تصمیم» جمع‌شونده: در موبایل بسته (۳۶۰px متنِ فقط‌خواندنی جای دکمه‌ها را می‌گرفت)، در
     دسکتاپ باز. فقط وضعیتِ آغازین است؛ بعدش انتخابِ کاربر. */
  const [decidedOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia?.('(max-width: 620px)').matches);
  const alertRows = [['allergies', 'حساسیت', 'red'], ['chronicConditions', 'بیماریِ زمینه‌ای', 'amber'], ['medications', 'داروها', 'amber']];
  const noAlerts = alertRows.every(([k]) => !alerts[k]);

  return (
    <div className="th-card">
      <section className="th-who" aria-labelledby="th-who-h">
        <div className="th-who-top">
          <h2 id="th-who-h" className="th-name">{p.fullName}</h2>
          {/* فرمِ کاملِ همین عمل — تنها جایی که شرح، ساعت و مدارک یک‌جا اصلاح می‌شوند (surgery-04). */}
          {card.can?.form && onOpenForm && (
            <button type="button" className="th-link th-open-form" data-act="open-form" onClick={onOpenForm}>
              <Form width="14" height="14" aria-hidden="true" /> بازکردنِ فرمِ {t.surgery}
            </button>
          )}
        </div>
        <p className="th-meta">
          <span dir="ltr">{p.code}</span>
          {p.age != null && <span>{faNum(p.age)} ساله</span>}
          {p.gender && <span>{GENDER_FA[p.gender] ?? p.gender}</span>}
          {(clinical || p.bloodType) && (
            <span className={`th-blood${p.bloodType ? '' : ' none'}`}>
              گروه خونی {p.bloodType ? <b dir="ltr">{p.bloodType}</b> : <b>ثبت نشده</b>}
            </span>
          )}
        </p>
        {/* `div` نه `p`: فهرست (`ul`) داخلِ پاراگراف HTMLِ نامعتبر است و
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
          {v.tech
            ? <span>{techLabel}: <b>{v.tech}</b></span>
            : team && <span className="none">{techLabel}: <b>تعیین نشده</b></span>}
          <span className={`th-state is-${v.state}`}>{v.stateFa}</span>
        </p>
      </section>

      {/* هر سه هشدار در مطب **همیشه** دیده می‌شوند: «پرسیده نشده» با «نداشت» یکی نیست و سرِ میز فرقشان
          می‌تواند حیاتی باشد. ولی سه کادرِ خالیِ هم‌شکل ۲۴۵px جا می‌گرفت و دکمه‌های کار را زیرِ تا می‌برد
          (surgery-05) — اگر هر سه خالی‌اند، یک سطر. */}
      {noAlerts ? (clinical && (
        <section className="th-alerts-none" aria-label="هشدارهای بالینی">
          <Alert width="14" height="14" aria-hidden="true" />
          <span>حساسیت / بیماریِ زمینه‌ای / دارو: <b>در پرونده ثبت نشده — بپرسید</b></span>
        </section>
      )) : (
        <section className="th-alerts" aria-label="هشدارهای بالینی">
          {/* حساسیت **قرمز** و دو تای دیگر کهربایی: وقتی هر سه یک قرمز باشند،
              هیچ‌کدام دیگر هشدار نیست. چیزی که سرِ میز می‌تواند بکشد حساسیت است. */}
          {alertRows.map(([k, label, tone]) => (
            <div key={k} className={`th-alert${alerts[k] ? ` on is-${tone}` : ''}`}>
              <span className="th-alert-h">{alerts[k] ? <Alert width="14" height="14" aria-hidden="true" /> : null}{label}</span>
              <p>{alerts[k] || (clinical ? 'در پرونده ثبت نشده — بپرسید' : 'ثبت نشده')}</p>
            </div>
          ))}
        </section>
      )}

      <OpSteps
        v={v} clinical={clinical} canTimes={!!card.can?.times} busy={busy}
        onAct={onAct} onDischarge={onDischarge} onToast={onToast} elapsedMin={elapsedMin} running={running}
      />

      {v.dischargeAt && (
        <section className="th-discharged" aria-label="ترخیص">
          <h3>ترخیص — {faDate(v.dischargeAt)}{v.dischargeDispositionFa ? ` · ${v.dischargeDispositionFa}` : ''}</h3>
          <p>{v.dischargeNote || '—'}</p>
          {v.dischargeSummary && <p className="th-dsum"><b>شرحِ ترخیص</b><span>{v.dischargeSummary}</span></p>}
          {v.dischargeRx && <p className="th-dsum" data-discharged-rx><b>داروهای ترخیص</b><span>{v.dischargeRx}</span></p>}
          {v.nextVisitDate && <p className="th-dsum" data-discharged-next><b>ویزیتِ بعدی</b><span>{faDate(nextYmd(v.nextVisitDate))}</span></p>}
          {v.dischargeRemark && <p className="th-dsum"><b>یادداشت</b><span>{v.dischargeRemark}</span></p>}
        </section>
      )}

      {/* شکایتِ اولیه در مطب **همیشه**، حتی خالی: اولین چیزی که جراح سرِ میز می‌پرسد. در شرکت فقط اگر
          ثبت شده باشد — کارشناس از بیمار نمی‌پرسد (company-12). */}
      {(clinical || v.chiefComplaint) && (
        <section className={`th-cc${v.chiefComplaint ? ' on' : ''}`} aria-label="شکایتِ اولیه">
          <h3>شکایتِ اولیه</h3>
          <p>{v.chiefComplaint || 'در پرونده ثبت نشده — از بیمار بپرسید و در فرمِ مراجعه ثبت کنید'}</p>
        </section>
      )}

      {/* ویزیتی که تصمیمِ عمل در آن گرفته شد — «بیمار با چه یافته‌ای کاندیدِ
          عمل شد» سرِ میز، بی‌آنکه جراح پرونده را جدا باز کند (بستهٔ ۶الف). */}
      {card.decided && (
        <details className="th-decided" aria-label="ویزیتِ تصمیم" open={decidedOpen}>
          <summary><h3>از ویزیتِ تصمیم{card.decided.opDate ? ` — ${faDate(card.decided.opDate)}` : ''}</h3></summary>
          {/* تشخیص‌های ویزیتِ تصمیم «تشخیصِ **پیش از** عمل»اند و عمداً با همین
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
          ].filter(([, x]) => x).map(([l, x]) => (
            <p key={l}><b>{l}</b><span>{x}</span></p>
          ))}
        </details>
      )}

      {card.vitals?.length > 0 && <VitalsView rows={card.vitals} />}

      {/* بستهٔ ۸: در مطب همیشه (جای خالی خودش خبر است)؛ در نصبِ شرکتی فقط اگر واقعاً فرمی الصاق شده. */}
      {(card.clinical || (card.subforms ?? []).some((x) => x.phase === 'pre')) && <PreOpSummary subforms={card.subforms ?? []} />}

      {!isClinic && (
        <NoteBox
          key={`findings-${v.id}`}
          visit={v} field="findings" path="/findings" actKey="findings"
          title="یافته‌های حینِ عمل" placeholder="آنچه حینِ عمل دیده شد…"
          savedMsg="یافته‌ها ذخیره شد" busy={busy} onAct={onAct} onToast={onToast} unsaved={unsaved}
        />
      )}
      {/* مطب «شرحِ عمل» می‌نویسد، شرکت «گزارشِ خدمت» — واژه از حوزه (`t.workReport`، company-12). */}
      <NoteBox
        key={`report-${v.id}`}
        visit={v} field="opReport" path="/report" actKey="report"
        title={t.workReport}
        placeholder={clinical ? 'مسیرِ عمل، اقدام‌ها، رخدادهای حینِ عمل…' : 'خدمتی که حینِ عمل داده شد و نکته‌هایش…'}
        savedMsg={`${t.workReport} ذخیره شد`} busy={busy} onAct={onAct} onToast={onToast} unsaved={unsaved}
      />

      <DeskSubforms
        key={`subs-${v.id}`}
        subforms={(card.subforms ?? []).filter((x) => x.phase === 'intra')}
        canWrite={!!card.can?.subforms} canAttach={!!card.clinical && !!card.can?.subforms}
        busy={busy} onAct={onAct} onToast={onToast} unsaved={unsaved}
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
 * ترتیب رتبهٔ بالینیِ سرور است و این‌جا مرتب نمی‌شود؛ اولی همیشه اصلی است.
 * نشانِ «اصلی» فقط وقتی **دو یا بیشتر** مورد هست: روی تک‌مورد هیچ خبری
 * نمی‌دهد و فقط سطرِ سرِ میز را شلوغ می‌کند — تک‌مورد درست مثلِ دیروز دیده
 * می‌شود.
 * کدِ ICD با `dir="ltr"` (قانونِ ۹): «M51.1» در متنِ راست‌به‌چپ بی‌آن
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
 * متن در stateِ محلی می‌ماند و فقط با «ذخیره» می‌رود: ذخیرهٔ خودکار وسطِ
 * تایپِ جراح یعنی هر مکث یک نسخهٔ تازه در پرونده — و این سند نسخه‌دار است.
 *
 * اگر سرور متنِ تازه‌تری داشت (کسی از فرمِ مراجعه نوشته)، پیش‌نویسِ روی
 * صفحه بازنویسی **نمی‌شود**؛ فقط وقتی هم‌گام می‌شویم که کاربر چیزی ننوشته
 * باشد. همان قاعدهٔ `JDate`: نوشتهٔ کاربر زیرِ دستش عوض نمی‌شود.
 */
function NoteBox({ visit, field, path, actKey, title, placeholder, savedMsg, busy, onAct, onToast, unsaved }) {
  const { user: me } = useAuth();
  const dk = draftKey(me?.id, visit.id, field);
  /* پیش‌نویسِ همین دستگاه (اگر با پرونده فرق دارد) جای متنِ پرونده می‌نشیند — «ذخیره نشده» می‌ماند
     تا کاربر خودش ذخیره یا دور بریزد. */
  const [fromDevice] = useState(() => {
    const d = readDraft(dk);
    return d != null && d.trim() !== (visit[field] ?? '').trim() ? d : null;
  });
  const [text, setText] = useState(fromDevice ?? visit[field] ?? '');
  const dirty = useRef(fromDevice != null);
  /* «نوشتهٔ خودم»: برخلافِ `dirty` با ذخیره پاک نمی‌شود — «بنویس، ذخیره کن، بعد
     به پیش‌فرض بیفزا» باید کار کند، ولی شرحی که میز با آن باز شده نه. */
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (dirty.current) return;
    setText(visit[field] ?? '');
  }, [visit[field]]); // eslint-disable-line react-hooks/exhaustive-deps

  const saved = (visit[field] ?? '').trim();
  const changed = text.trim() !== saved;
  /* هر تغییرِ کاربر (تایپ یا چیپِ پیش‌فرض) روی دستگاه می‌نشیند؛ برگشت به متنِ پرونده پاکش می‌کند. */
  useEffect(() => {
    if (!dirty.current) return;
    if (changed) writeDraft(dk, text); else dropDraft(dk);
  }, [text, changed, dk]);
  const saveNow = async () => {
    const done = await onAct(path, actKey, { body: text });
    if (done) { dirty.current = false; dropDraft(dk); onToast(savedMsg); }
    return done;
  };
  const saveRef = useRef(saveNow);
  saveRef.current = saveNow;
  /* ثبت در فهرستِ «ذخیره‌نشده»های کارت — «فهرستِ روز» پیش از رفتن همین را می‌پرسد. */
  useEffect(() => {
    if (!unsaved) return undefined;
    const key = `note:${field}`;
    if (!changed) { unsaved.delete(key); return undefined; }
    unsaved.set(key, { label: title, save: () => saveRef.current(), discard: () => dropDraft(dk) });
    return () => { unsaved.delete(key); };
  }, [unsaved, changed, field, title, dk]);

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
        <span className={`th-hint${changed ? ' is-warn' : ''}`} data-note-state={changed ? 'unsaved' : 'saved'}>
          {changed
            ? (fromDevice ? 'پیش‌نویسِ ذخیره‌نشدهٔ همین دستگاه — هنوز در پرونده نیست' : 'ذخیره نشده')
            : saved ? 'ذخیره شده در پروندهٔ بیمار' : 'هنوز نوشته نشده'}
        </span>
        <button
          type="button" className="th-btn" data-act={field === 'opReport' ? 'save-report' : 'save-findings'}
          disabled={!changed || busy === actKey}
          onClick={saveNow}
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
 * تا دیروز فقط نامِ مدرک نوشته می‌شد و زیرش «از پروندهٔ بیمار بازش کنید»:
 * یعنی جراحِ وسطِ عمل باید از این صفحه بیرون می‌رفت و دسترسیِ بالاتری هم
 * می‌خواست. حالا مسیرِ خودِ اتاق (`theatre/.../file`) بازشان می‌کند.
 *
 * لینکِ دانلود با `<a download>` ساخته نمی‌شود چون نشستِ ما کوکیِ HttpOnly
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
    /* **پنجره باید پیش از `await` باز شود.** Safari (و کرومِ موبایل در
       بعضی حالت‌ها) `window.open` بعد از یک await را پاپ‌آپِ ناخواسته
       می‌شمارد و **بی‌صدا** بلاک می‌کند — یعنی همان مدرکی که مالک خواست
       سرِ میز باز شود، روی آیفون هیچ کاری نمی‌کرد و هیچ خطایی هم نمی‌داد.
       پس اول تبِ خالی باز می‌شود و بعد نشانی‌اش گذاشته می‌شود.
       `noopener` این‌جا عمداً نیست: با آن `window.open` مقدارِ `null`
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
      /* نشانیِ بلاب باید آزاد شود وگرنه حافظه نشت می‌کند (هشدارِ خودِ
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
 * **ارزیابیِ پیش از عمل سرِ میز** (بستهٔ ۸) — پاسخ‌های زیرفرم‌های الصاق‌شده به مرحلهٔ «قبل از عمل»
 * (مثلِ «فرم ارزیابیِ بیهوشی (ASA)»)، فقط‌خواندنی، درست کنارِ هشدارها: لحظهٔ تایم‌اوت همین‌جاست.
 * ⚠️ متنِ هر سطر را سرور می‌سازد (`summary`، قانونِ ۱۵) — این‌جا هیچ برچسب یا گزینه‌ای ترجمه نمی‌شود.
 */
function PreOpSummary({ subforms }) {
  const pre = subforms.filter((x) => x.phase === 'pre');
  return (
    <section className={`th-pre${pre.length ? ' on' : ''}`} aria-label="ارزیابیِ پیش از عمل">
      <h3>ارزیابیِ پیش از عمل</h3>
      {pre.length === 0 ? (
        <p className="th-pre-none">در فرمِ عمل فرمی برای «قبل از عمل» الصاق نشده — مثلِ فرم ارزیابیِ بیهوشی (ASA).</p>
      ) : pre.map((x) => (
        <div key={x.key} className="th-pre-row">
          <b>{x.title}</b>
          {x.summary?.length ? (
            <p>{x.summary.map((l) => <span key={l.label}><em>{l.label}</em> {l.text}</span>)}</p>
          ) : <p className="th-pre-none">الصاق شده ولی هنوز پر نشده.</p>}
        </div>
      ))}
    </section>
  );
}

/**
 * **فرم‌های حینِ عمل سرِ میز** (بستهٔ ۸، طرحِ مصوبِ ۱۴۰۵/۰۷/۰۶) — همان زیرفرم‌هایی که در تبِ «حینِ عمل»ِ
 * فرمِ عمل الصاق شده‌اند (مثلِ «فرم جزئیاتِ حینِ عمل») این‌جا پر و ذخیره می‌شوند، و اگر هنوز فرمی
 * الصاق نشده، از همین‌جا الصاق می‌شود — جراحِ وسطِ عمل برای یک فرم به فرمِ عمل برنمی‌گردد.
 *
 * ⚠️ یک نویسنده: `POST /theatre/visits/:id/subforms` همان `writeSubforms` و قفلِ نقشِ فیلدهای فرمِ
 * عمل است؛ هرچه این‌جا ذخیره شود در تبِ «حینِ عمل» هم دیده می‌شود. خطای «اجباری» پیش از رفت‌وبرگشت
 * کنارِ فیلد نشان داده می‌شود (`dynErrors` — همان قاعدهٔ سرور).
 * ⚠️ پنجرهٔ الصاق همان `AttachPicker`ِ فرمِ مراجعه است (بی‌ستارهٔ منتخب و بی‌انتخابِ مرحله) — نه
 * نسخهٔ موازی. کاتالوگ فقط با بازشدنِ پنجره خوانده می‌شود.
 */
function DeskSubforms({ subforms, canWrite, canAttach, busy, onAct, onToast, unsaved }) {
  const { user: me } = useAuth();
  /* همان نقشی که فرمِ مراجعه به `DynForm` می‌دهد — قفلِ نمایشی؛ اجرای واقعی سمتِ سرور است. */
  const myRole = (me?.level ?? 0) >= 6 ? null : (me?.jobRole ?? null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState({});
  const [picking, setPicking] = useState(false);
  const cat = useSubformCatalog(picking);
  /* فرمِ حینِ عملِ نیمه‌پر هم «ذخیره‌نشده» است (surgery-07) — «فهرستِ روز» پیش از رفتن می‌پرسد. */
  const saveRef = useRef(null);
  useEffect(() => {
    if (!unsaved) return undefined;
    const x = editing ? subforms.find((s2) => s2.key === editing) : null;
    if (!x || JSON.stringify(draft) === JSON.stringify(x.data ?? {})) { unsaved.delete('desk-subform'); return undefined; }
    unsaved.set('desk-subform', { label: x.title, save: () => saveRef.current?.(x) ?? false, discard: () => setEditing(null) });
    return () => { unsaved.delete('desk-subform'); };
  }, [unsaved, editing, draft, subforms]);
  if (!subforms.length && !canAttach) return null;
  const saving = busy === 'subforms';
  const start = (x) => { setDraft(x.data ?? {}); setErrors({}); setEditing(x.key); };
  const save = async (x) => {
    const e = dynErrors(x.fields ?? [], draft, myRole);
    setErrors(e);
    if (Object.keys(e).length) return false;
    if (await onAct('/subforms', 'subforms', { items: [{ key: x.key, phase: 'intra', data: draft }] })) {
      setEditing(null);
      onToast?.(`«${x.title}» ذخیره شد`);
      return true;
    }
    return false;
  };
  saveRef.current = save;
  /* الصاق بی‌پاسخ می‌رود (`data` نیامده = «دست نزن»): فرمِ تازه هنوز کادرِ اجباریِ پرشده ندارد و
     سرور ستاره را روی پاسخِ فرستاده‌شده می‌سنجد. بعدش همان‌جا برای پرکردن باز می‌شود. */
  const attach = async (it) => {
    if (await onAct('/subforms', 'subforms', { items: [{ key: it.key, phase: 'intra' }] })) {
      setPicking(false);
      setDraft({}); setErrors({}); setEditing(it.key);
    }
  };
  /* فقط آنچه به «حینِ عمل» می‌خورد: زیرفرمِ آمادهٔ همین مرحله و فرم‌های ساختِ خودِ مطب. ارزیابی‌ها (ASA، قد و
     وزن) و پیگیریِ پس از عمل جایشان تبِ خودشان در فرمِ عمل است — فهرستِ ده‌تایی وسطِ عمل فقط مکث می‌آورد. */
  const items = (cat?.items ?? []).filter((x) => !x.builtin && x.active !== false && (x.defaultPhase === 'intra' || x.group === 'custom'));
  return (
    <section className="th-subs" aria-label="فرم‌های حینِ عمل" data-desk-subforms>
      <div className="th-subs-head">
        <h3>فرم‌های حینِ عمل</h3>
        {canAttach && (
          <button type="button" className="th-btn th-subs-add" onClick={() => setPicking(true)} disabled={saving} data-act="desk-attach">
            <Plus width="14" height="14" aria-hidden="true" /> الصاقِ فرم
          </button>
        )}
      </div>
      {!subforms.length && (
        <p className="th-pre-none">در فرمِ عمل فرمی برای «حینِ عمل» الصاق نشده — مثلِ «فرم جزئیاتِ حینِ عمل» (تیم، خون‌ریزی، نمونه، درن، ایمپلنت).</p>
      )}
      {subforms.map((x) => (
        <div key={x.key} className="th-sub" data-desk-subform={x.key}>
          <div className="th-sub-head">
            <b>{x.title}</b>
            {x.inactive && <small className="th-sub-off">در فرم‌ساز خاموش است</small>}
            {canWrite && editing !== x.key && (
              <button type="button" className="th-btn" onClick={() => start(x)} disabled={saving} data-act="desk-subform-edit">
                {x.summary?.length ? 'ویرایش' : 'پرکردن'}
              </button>
            )}
          </div>
          {editing === x.key ? (
            <div className="th-sub-form">
              <DynForm
                fields={x.fields ?? []} values={draft} errors={errors} myRole={myRole} disabled={saving}
                onChange={(v) => { setDraft(v); if (Object.keys(errors).length) setErrors(dynErrors(x.fields ?? [], v, myRole)); }}
              />
              <div className="th-report-bar">
                <span className="th-hint">همان فرمِ تبِ «حینِ عمل»؛ هرچه این‌جا ذخیره شود در فرمِ عمل هم دیده می‌شود.</span>
                <button type="button" className="th-btn" onClick={() => setEditing(null)} disabled={saving}>انصراف</button>
                <button type="button" className="th-btn primary" onClick={() => save(x)} disabled={saving} data-act="desk-subform-save">
                  {saving ? 'در حالِ ذخیره…' : 'ذخیره'}
                </button>
              </div>
            </div>
          ) : x.summary?.length ? (
            <p className="th-sub-sum">{x.summary.map((l) => <span key={l.key ?? l.label}><em>{l.label}</em> {l.text}</span>)}</p>
          ) : <p className="th-pre-none">الصاق شده ولی هنوز پر نشده.</p>}
        </div>
      ))}
      {canAttach && (
        <AttachPicker
          open={picking} onClose={() => setPicking(false)}
          title="الصاقِ فرم به «حینِ عمل»" visitWord="عمل"
          groups={cat?.groups ?? []} items={items} loading={!cat}
          attached={new Set(subforms.map((x) => x.key))}
          onAttach={attach}
        />
      )}
    </section>
  );
}

/**
 * **پاپ‌آپِ ترخیص** — «با زدنِ ترخیص، توضیحِ وضعیت حینِ ترخیص باید پاپ‌آپ شه،
 * پر شه، سیو شه» (بازخوردِ مالک).
 *
 * متن اجباری است و دکمه تا پر نشدنش غیرفعال می‌ماند: ترخیصِ بی‌شرح سطری
 * است که می‌گوید بیمار رفت و نمی‌گوید در چه حالی — و همان سطر سندِ پرونده
 * می‌شود. سرور هم دوباره همین را می‌سنجد.
 */
function DischargeDialog({ initial, already, busy, onClose, onSave, clinical = false, canFollowUp = false, followLock = null, patientName = '', patientCode = '', procedure = '' }) {
  const dispositions = useStatusList('disposition');
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  /* تاریخِ نیمه‌تایپ‌شده یعنی ترخیصی که «ثبت شد» می‌گوید ولی ویزیتِ بعدی را بی‌صدا جا انداخته. */
  const nextBad = clinical && canFollowUp && f.disposition !== 'death' && !!f.nextVisitDateJ && !jStrToIso(f.nextVisitDateJ);
  /* برداشتنِ تاریخ از ترخیص انجام نمی‌شود (پست‌آپِ ساخته‌شده شاید نوبت داشته باشد) — کادرِ خالی‌شده «دست نزن» است. */
  const clearing = clinical && canFollowUp && !!initial.nextVisitDateJ && !f.nextVisitDateJ;
  /* وضعیتِ خروج و وضعیتِ بیمار اجباری‌اند؛ شرح و یادداشت اختیاری. */
  const ok = f.condition.trim().length >= 2 && !!f.disposition && !nextBad;
  /* دکمهٔ خاموش می‌گوید چه کم است (surgery-03) — نه یک خاکستریِ بی‌توضیح. */
  const missing = !f.disposition ? 'وضعیتِ خروج را انتخاب کنید'
    : f.condition.trim().length < 2 ? 'وضعیتِ بیمار هنگامِ ترخیص را بنویسید'
      : nextBad ? 'تاریخِ ویزیتِ بعدی را درست کنید' : '';
  /* نوشتهٔ ذخیره‌نشده (surgery-07) — بستن اول می‌پرسد؛ لمسِ پس‌زمینه این فرمِ پنج‌کادره را نمی‌بندد. */
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  return (
    <Overlay
      backdrop="th-overlay" panel="th-dialog" as="form" from="center"
      closable={!busy} onClose={onClose} aria-label={patientName ? `ترخیصِ ${patientName}` : 'ثبتِ ترخیص'}
      dirty={dirty} onSave="submit" backdropClose={false} history
      onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onSave(f); }}
    >
      {/* برای کیست؟ (surgery-13) — در موبایل این پنجره کلِ میز را می‌پوشاند؛ نامِ بیمار در عنوان و عمل و
          کدِ پرونده در خطِ دوم، همان الگوی پنجرهٔ «بستنِ تصمیم». */}
      <header className="th-dialog-head">
        <div className="th-dialog-titles">
          <b data-dialog-title>{`${already ? 'ویرایشِ ترخیصِ' : 'ترخیصِ'} ${patientName || 'بیمار'}`}</b>
          {(procedure || patientCode) && (
            <small data-dialog-sub>{procedure}{procedure && patientCode ? ' · ' : ''}{patientCode && <bdi dir="ltr">{patientCode}</bdi>}</small>
          )}
        </div>
        <CloseButton className="th-x" aria-label="بستن"><Close width="18" height="18" /></CloseButton>
      </header>
      {/* وضعیتِ خروج دکمه است نه کشویی: یک لمس، و هر چهار گزینه همیشه
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
          placeholder="سیرِ بستری، توصیه‌ها…"
          onChange={set('summary')}
        />
      </label>
      {/* بستهٔ ۸: داروها و ویزیتِ بعدی هم همین‌جا — «ویزیتِ بعدی» همان تاریخی است که ویزیتِ پست‌آپِ
          خودکار و پیامک‌هایش از آن ساخته می‌شوند. «فوت» هر دو را می‌بندد و پیامک‌های پس از عمل را لغو می‌کند. */}
      {clinical && (f.disposition === 'death' ? (
        <p className="th-death" role="note" data-discharge-death>
          <Alert width="15" height="15" aria-hidden="true" />
          با «فوت» داروی ترخیص و ویزیتِ بعدی ثبت نمی‌شود؛ پیامک‌های پس از عمل و ویزیتِ پست‌آپِ در انتظار خودکار لغو می‌شوند.
          اگر اشتباهی زده شد، با انتخابِ وضعیتِ دیگر برمی‌گردند.
        </p>
      ) : (
        <>
          <label className="th-dialog-field">
            <span>داروهای ترخیص <i>اختیاری</i></span>
            <textarea
              rows={3} value={f.rx ?? ''} data-discharge-rx
              placeholder="نامِ دارو، دوز، دفعات، مدت…"
              onChange={set('rx')}
            />
          </label>
          {canFollowUp ? (
            <div className="th-dialog-field th-next" data-discharge-next>
              <JDate label={<>ویزیتِ بعدی <i>اختیاری</i></>} value={f.nextVisitDateJ ?? ''}
                     onChange={(v) => setF((x) => ({ ...x, nextVisitDateJ: v }))} placeholder="سال / ماه / روز" />
              {nextBad ? <em className="th-hint is-err" role="alert">تاریخ را کامل و درست بنویسید — مثلاً ۱۴۰۵/۰۷/۲۰</em>
                : clearing ? <em className="th-hint is-warn">برداشتنِ ویزیتِ بعدی از فرمِ عمل انجام می‌شود؛ این‌جا همان تاریخِ قبلی می‌ماند.</em>
                  : <em className="th-hint">با این تاریخ ویزیتِ پست‌آپ و یادآوری‌هایش ساخته می‌شود؛ اگر از قبل تاریخی بود، همان جابه‌جا می‌شود.</em>}
            </div>
          ) : (initial.nextVisitDateJ || followLock) ? (
            /* بی‌مجوز: تاریخِ فعلی دیده شود (نه کادرِ مرده) و بگوید مالِ کیست. */
            <p className="th-next-ro" data-discharge-next-ro>
              <b>ویزیتِ بعدی</b>
              <span>{initial.nextVisitDateJ ? faDate(jStrToIso(initial.nextVisitDateJ)) : 'تعیین نشده'}</span>
              <small>{followLock ? `تعیینش بخشِ ${followLock} است.` : 'تعیینش با حسابِ شما نیست.'}</small>
            </p>
          ) : null}
        </>
      ))}
      <label className="th-dialog-field">
        <span>یادداشت <i>اختیاری</i></span>
        <textarea
          rows={2} value={f.remark} data-discharge-remark
          placeholder="نکته‌ای برای تیم…"
          onChange={set('remark')}
        />
      </label>
      <p className="th-hint">متن‌ها در پروندهٔ بیمار با نامِ شما ثبت می‌شوند؛ اصلاحِ بعدی نسخهٔ تازه می‌سازد.</p>
      <div className="th-dialog-acts">
        {missing && <span className="th-hint th-dialog-missing" id="th-dis-missing" data-discharge-missing>{missing}</span>}
        <CloseButton className="th-btn" disabled={busy}>انصراف</CloseButton>
        <button type="submit" className="th-btn primary" disabled={!ok || busy} aria-describedby={missing ? 'th-dis-missing' : undefined}>
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
