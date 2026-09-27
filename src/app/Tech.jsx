import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import FileDrop from '../ui/FileDrop.jsx';
import { api, apiUpload } from '../lib/api.js';
import { faDate, jStrToIso, toEnDigits } from '../lib/jalali.js';
import './tech.css';
import { Alert, Arrive, Back, CheckCircle, Clock, Close, Hospital, Doctor, Box, User, Users, Wave } from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import TimePick from '../ui/TimePick.jsx';
import CancelReason from '../ui/CancelReason.jsx';
import JDate from './JDate.jsx';
import { badTime, faTime, normTime } from '../lib/time.js';
import { useStagger } from '../ui/stagger.js';
import { usePlaces } from '../lib/places.js';
import { useTerms } from './config.jsx';

const num = (n) => Number(n ?? 0).toLocaleString('fa-IR');
/* نمایشِ فارسیِ ساعت از `lib/time` می‌آید — همان تبدیلی که خودِ ورودی به کار
   می‌برد، تا آنچه کارشناس ثبت می‌کند و آنچه بعداً روی کارت می‌بیند یکی باشد. */
const time = (t) => (t ? faTime(t) : '—');

const SCOPES = [
  { key: 'today', label: 'امروز', icon: Arrive },
  { key: 'upcoming', label: 'پیشِ رو', icon: Clock },
  { key: 'past', label: 'گذشته', icon: CheckCircle },
];

/**
 * برچسبِ فیلتر با شمارِ کار — نام و عددِ پررنگ؛ بی‌کار، فقط نام. همان شکلِ فیلترِ
 * «مسئولِ کار» در «امروز» (`td-own-n`)، تا ناظر در دو صفحه دو زبان نبیند. شمار
 * داخلِ برچسب است نه `badge`: نشانِ کهربایی یعنی «هشدار» و این‌جا هشداری نیست.
 */
const counted = (label, n) => (n ? <>{label} <b className="tk-own-n">{num(n)}</b></> : label);

/**
 * نفرهای نمای سرپرستی، به ترتیبِ نام.
 *
 * «مالِ کیست» (`ownerId` + `techName`) را سرور روی هر ردیف می‌گذارد؛ این‌جا فقط
 * گروه می‌شوند. کسی که امروز فقط برنامهٔ حضور دارد (و مراجعهٔ آزادی برای
 * پذیرش) هم در فهرست می‌آید، ولی شمارش فقط عمل‌های به‌نامِ اوست.
 */
function peopleOf(visits, duties) {
  const by = new Map();
  const add = (row, work) => {
    if (row.ownerId == null) return;
    const key = String(row.ownerId);
    const p = by.get(key) ?? { key, name: row.techName || '—', n: 0 };
    p.n += work;
    by.set(key, p);
  };
  visits.forEach((v) => add(v, 1));
  duties.forEach((d) => add(d, 0));
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
}

/** «مالِ کیست» روی کارت — فقط در نمای سرپرستی؛ برچسبِ نقش از واژگانِ حوزه. */
function Owner({ role, name }) {
  return <p className="tk-owner"><User width="14" height="14" /> {role}: <b>{name || '—'}</b></p>;
}

/**
 * دفترِ کارِ کارشناس.
 *
 * این صفحه عمداً **فهرستِ داشبورد نیست با یک فیلتر**. سرور نمای جداگانه‌ای
 * می‌دهد که هیچ عددِ مالی در آن نیست؛ اگر روزی این‌جا مبلغ دیده شد، اشکال در
 * `tech.service.ts` است نه در این فایل.
 *
 * ترتیبِ کارتِ هر عمل همان ترتیبِ روزِ کارشناس است: کجا و کِی، بعد چه ستی
 * همراهش می‌رود، بعد کاری که باید بکند (ساعت، مصرف، پایان، گزارش).
 *
 * نمای سرپرستی (سوپرادمین، `data.team` از سرور — قانونِ ۲۹): کارِ **همهٔ**
 * کارشناسان، با نامِ صاحب روی هر کارت و فیلترِ نفر؛ همهٔ دکمه‌ها همان‌اند و
 * از طرفِ صاحبِ همان ردیف ثبت می‌کنند — «پذیرش» به نامِ صاحبِ همان برنامهٔ حضور.
 */
export default function Tech() {
  const terms = useTerms();
  const [scope, setScope] = useState('today');
  const [who, setWho] = useState('all');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [usageFor, setUsageFor] = useState(null); // {visit, transfer}
  const [timesFor, setTimesFor] = useState(null); // visit
  const [statusFor, setStatusFor] = useState(null); // visit
  const [claiming, setClaiming] = useState(null);
  const row = useStagger();

  useEffect(() => { document.title = 'عمل‌یار — پنلِ کارشناسی'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async (s) => {
    setErr('');
    try { setData(await api(`/tech/agenda?scope=${s}`)); }
    catch (e) { setErr(e.message); setData(null); }
  }, []);
  useEffect(() => { load(scope); }, [load, scope]);

  const team = !!data?.team;
  const allVisits = data?.visits ?? [];
  const allDuties = data?.hospitals ?? [];
  const people = team ? peopleOf(allVisits, allDuties) : [];
  /* نفرِ انتخاب‌شده ممکن است در بازهٔ تازه کاری نداشته باشد؛ آن‌وقت «همه» —
     بی‌آنکه انتخابش دور ریخته شود (برگشت به همان بازه دوباره همان نفر است). */
  /* فیلترِ نفر فقط وقتی بیش از یک نفر در کار است — برای یک نفر، نامِ روی کارت کافی است. */
  const filterable = people.length > 1;
  const pick = people.some((p) => p.key === who) ? who : 'all';
  const picked = people.find((p) => p.key === pick);
  const shown = (it) => pick === 'all' || String(it.ownerId) === pick;
  const visits = allVisits.filter(shown);
  /* در «همه»ِ نمای سرپرستی فقط کارتِ حضوری که مراجعهٔ آزاد برای پذیرش دارد —
     ده کارتِ «مراجعهٔ آزادی نیست» جلوی کارِ اصلی را می‌گرفت. با انتخابِ یک نفر،
     همهٔ برنامهٔ حضورِ او (ساعتِ حضور) برمی‌گردد. ولی فقط وقتی فیلتر هست: اگر
     امروز یک نفر برنامه دارد، ردیفِ فیلتر نمی‌آید و پنهان‌کردنِ کارتش یعنی
     حضورش هیچ‌جا دیده نمی‌شد. */
  const duties = allDuties.filter((h) => shown(h) && (!team || !filterable || pick !== 'all' || h.openVisits.length > 0));
  /* در نمای سرپرستی یک مراجعهٔ آزاد زیرِ کارتِ حضورِ هر کارشناسِ همان
     بیمارستان و روز می‌آید؛ پس «در حال ثبت» باید به جفتِ «حضور + مراجعه» بچسبد
     نه به خودِ مراجعه، وگرنه دکمهٔ کارتِ دیگر هم «در حال ثبت…» نشان می‌داد. */
  const claim = async (duty, visit) => {
    setClaiming(`${duty.id}:${visit.id}`);
    try {
      const r = await api(`/tech/visits/${visit.id}/claim`, { method: 'POST', ...(team ? { body: { dutyId: duty.id } } : {}) });
      setToast(team ? `مراجعه به نامِ ${r?.techName || duty.techName} ثبت شد` : 'مراجعه به نام شما ثبت شد');
    }
    catch (e) { setToast(e.message); }
    finally { await load(scope); setClaiming(null); }
  };

  return (
    <div className="tk">
      <div className="tk-bg" aria-hidden="true" />
      <header className="tk-head">
        <Link to="/app" className="tk-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1>{team ? `دفترِ کارِ ${terms.techs}` : 'دفترِ کار'}</h1>
          {/* تا پاسخ نیامده متنِ خنثی — وگرنه سوپرادمین یک لحظه «شما» را می‌دید. */}
          <p>
            {team
              ? `نمای سرپرستی — کارِ همهٔ ${terms.techs}، با نامِ صاحب روی هر کارت. هر کاری این‌جا از طرفِ همان نفر ثبت می‌شود.`
              : data ? 'عمل‌هایی که کارشناسشان شما هستید — ساعت، ست، مصرف و گزارش.' : 'ساعت، ست، مصرف و گزارش.'}
          </p>
        </div>
      </header>

      <Tabs label="بازهٔ کار" tone="brand" value={scope} onChange={setScope} items={SCOPES} />

      {filterable && (
        <Tabs
          label={terms.techs}
          variant="scroll"
          className="tk-people"
          value={pick}
          onChange={setWho}
          items={[
            { key: 'all', label: counted('همه', allVisits.length), icon: Users },
            ...people.map((p) => ({ key: p.key, label: counted(p.name, p.n) })),
          ]}
        />
      )}

      {err && <div className="tk-err" role="alert"><Alert width="15" height="15" /> {err}</div>}

      <div className="tk-list">
        {duties.map(h => <section className="tk-card" key={h.id}>
          <header><div className="tk-title"><b>{h.name}</b><small>{faDate(h.date)} · {team ? 'حضور' : 'حضور شما'}: {time(h.arriveTime)}</small></div></header>
          {team && <Owner role={terms.tech} name={h.techName} />}
          <p>بیماران احتمالی — هنوز به کارشناس تخصیص داده نشده‌اند</p>
          {h.openVisits.length === 0 && <p>مراجعه آزادی در این بیمارستان نیست.</p>}
          {h.openVisits.map(v => <div className="tk-open-visit" key={v.id}><div><b>{v.name}</b><small>{v.procedure || ''} · {time(v.opStartTime)}</small></div><button className="tk-ghost" disabled={claiming !== null} onClick={() => claim(h, v)}>{claiming === `${h.id}:${v.id}` ? 'در حال ثبت…' : team ? `پذیرش برای ${h.techName || terms.tech}` : 'پذیرش این مراجعه'}</button></div>)}
        </section>)}
        {!data && !err && <div className="tk-empty">در حال بارگذاری…</div>}
        {data && visits.length === 0 && (
          <div className="tk-empty">
            {picked
              ? `در این بازه عملی به نامِ ${picked.name} نیست`
              : scope === 'today'
                ? (team ? `امروز عملی برای ${terms.techs} ثبت نشده` : 'امروز عملی به نامِ شما ثبت نشده')
                : scope === 'upcoming' ? 'برای سه هفتهٔ آینده عملی ثبت نشده' : 'در سی روزِ گذشته عملی نبوده'}
          </div>
        )}
        {visits.map((v, i) => (
          <motion.article key={v.id} {...row(i)} className={`tk-card st-${v.status}`}>
            <header>
              <span className="tk-time" dir="ltr">{time(v.opStartTime)}</span>
              <div className="tk-title">
                <b>{v.patientName}</b>
                <small>{v.code} · {faDate(v.opDate)}</small>
              </div>
              {v.status === 'done' && <span className="tk-tag ok">انجام‌شده</span>}
              {v.status === 'cancelled' && <span className="tk-tag no">لغو</span>}
            </header>

            {team && <Owner role={terms.tech} name={v.techName} />}

            <div className="tk-facts">
              <span><Hospital width="14" height="14" /> {v.hospitalName || '—'}</span>
              <span><Doctor width="14" height="14" /> {v.surgeonName || '—'}</span>
              {!team && v.techName && <span className="tk-tech">{v.techName}</span>}
              {v.procedure && <span><Wave width="14" height="14" /> {v.procedure}</span>}
              {v.techArriveTime && <span><Clock width="14" height="14" /> حضور {time(v.techArriveTime)}</span>}
            </div>

            {v.transfers.length > 0 && (
              <div className="tk-sets">
                {v.transfers.map((t) => (
                  <div key={t.id} className="tk-set">
                    <div className="tk-set-head">
                      <b><Box width="14" height="14" /> {t.code}</b>
                      <span>{t.toLocation}</span>
                      {t.releasedAt
                        ? <i className="tk-tag ok">پایان اعلام شد</i>
                        : t.status === 'planned' ? <i className="tk-tag">هنوز ارسال نشده</i> : null}
                    </div>
                    <ul className="tk-items">
                      {t.items.map((it, k) => (
                        <li key={k}>
                          {it.name}
                          {it.serialNo && <em dir="ltr">{it.serialNo}</em>}
                          <span>{num(it.quantity)}</span>
                        </li>
                      ))}
                    </ul>
                    {t.status !== 'planned' && (
                      <button type="button" className="tk-mini" onClick={() => setUsageFor({ visit: v, transfer: t })}>
                        برگهٔ مصرف و پایانِ عمل
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <footer className="tk-acts">
              {/* مالک (۱۴۰۵/۰۷/۰۵): «کارشناس باید وضعیتِ عمل را تعیین کند — انجام شد، موکول شد یا کلاً
                  لغو شد». فقط برای عملِ در انتظار؛ برگرداندنِ وضعیتِ ثبت‌شده کارِ مدیر است. */}
              {v.status === 'pending' && (
                <button type="button" className="tk-ghost tk-status-btn" onClick={() => setStatusFor(v)}>وضعیتِ عمل</button>
              )}
              <button type="button" className="tk-ghost" onClick={() => setTimesFor(v)}>ثبتِ ساعت</button>
              <ReportButton visit={v} onDone={(msg) => { setToast(msg); load(scope); }} onError={setErr} />
            </footer>
          </motion.article>
        ))}
      </div>

      {/* `AnimatePresence` باید در **والد** باشد، نه داخلِ خودِ شیت: اگر
          داخل بنشیند، با unmountِ شیت خودش هم می‌رود و انیمیشنِ خروج هرگز
          اجرا نمی‌شود — شیت به‌جای بسته‌شدن، می‌پرد. */}
      <AnimatePresence>
        {usageFor && (
          <UsageSheet
            transferId={usageFor.transfer.id}
            onClose={() => setUsageFor(null)}
            onToast={(m) => { setToast(m); load(scope); }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {timesFor && (
          <TimesSheet
            visit={timesFor}
            onClose={() => setTimesFor(null)}
            onSaved={(m) => { setTimesFor(null); setToast(m); load(scope); }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {statusFor && (
          <StatusSheet
            visit={statusFor}
            onClose={() => setStatusFor(null)}
            onSaved={(m) => { setStatusFor(null); setToast(m); load(scope); }}
          />
        )}
      </AnimatePresence>

      <div className={`tk-toast${toast ? ' on' : ''}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}

/* سه پاسخِ «این عمل چه شد؟» — ترتیب همان ترتیبِ رخداد: بیشترِ عمل‌ها انجام می‌شوند. */
const STATUS_CHOICES = [
  { key: 'done', label: 'انجام شد', hint: 'خدمت سرِ عمل ارائه شد', icon: CheckCircle },
  { key: 'postponed', label: 'موکول شد', hint: 'عمل به روزِ دیگری افتاد', icon: Clock },
  { key: 'cancelled', label: 'لغو شد', hint: 'عمل انجام نمی‌شود — دلیلش به بیمار پیامک می‌شود', icon: Close },
];

/**
 * **وضعیتِ عمل** — انجام شد / موکول شد / لغو شد (`POST /tech/visits/:id/status`).
 *
 * ⚠️ لغو پنجرهٔ مشترکِ `CancelReason` را باز می‌کند، نه یک فهرستِ دوم: دلیل به دستِ بیمار
 * می‌رسد و متنِ پیامکش همان‌جا پیش‌نمایش دارد — همان پنجره‌ای که داشبورد و تقویم دارند.
 * ⚠️ «موکول» بی‌تاریخ هم پذیرفته است (خالی = «هنوز تاریخ ندارد»): کارشناسِ سرِ عمل معمولاً
 * فقط می‌داند که امروز نشد، نه روزِ بعدش را؛ تاریخ را مدیر بعداً می‌گذارد.
 */
function StatusSheet({ visit, onClose, onSaved }) {
  const [pick, setPick] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [asking, setAsking] = useState(false);

  const send = async (body, msg) => {
    setBusy(true); setErr('');
    try {
      await api(`/tech/visits/${visit.id}/status`, { method: 'POST', body });
      onSaved(msg);
    } catch (e) { setErr(e.message); setBusy(false); throw e; }
  };
  const save = async () => {
    if (pick === 'cancelled') { setAsking(true); return; }
    if (pick === 'done') { await send({ status: 'done' }, 'انجام شد — ثبت شد').catch(() => {}); return; }
    const iso = date.trim() ? jStrToIso(date) : '';
    if (date.trim() && !iso) { setErr('تاریخ را به شکلِ ۱۴۰۵/۰۷/۱۲ بنویسید'); return; }
    await send({ status: 'postponed', ...(iso ? { opDate: iso } : {}) },
      iso ? `موکول شد به ${faDate(iso)}` : 'موکول شد — تاریخِ تازه را مدیر می‌گذارد').catch(() => {});
  };
  const cta = pick === 'done' ? 'ثبت: انجام شد'
    : pick === 'postponed' ? (date.trim() ? 'ثبت: موکول به همین تاریخ' : 'ثبت: موکول، بی‌تاریخ')
      : pick === 'cancelled' ? 'ادامه: دلیلِ لغو' : 'یکی را انتخاب کنید';

  /* ⚠️ پنجرهٔ دلیلِ لغو **به‌جای** این شیت، نه داخلش: `Overlay` پورتال نمی‌شود و پوششِ `fixed`
     داخلِ پنلی که `transform` دارد نسبت به همان پنل جا می‌گیرد — همان تلهٔ شیت‌های تودرتو. */
  if (asking) {
    return (
      <CancelReason
        kind="visit"
        what={`${visit.patientName} · ${faDate(visit.opDate)}`}
        onClose={() => setAsking(false)}
        onConfirm={({ cancelReason, cancelNote }) => send({ status: 'cancelled', cancelReason, cancelNote }, 'لغو شد — به بیمار پیامک می‌شود')}
      />
    );
  }
  return (
    <Overlay backdrop="tk-overlay" panel="tk-sheet sm" as="section" onClose={onClose} closable={!busy}>
      <header className="tk-sheet-head">
        <b>وضعیتِ عمل — {visit.patientName}</b>
        <button type="button" className="tk-x" onClick={onClose} aria-label="بستن" disabled={busy}><Close width="17" height="17" /></button>
      </header>
      <div className="tk-sheet-body">
        <p className="tk-note">{visit.code} · {faDate(visit.opDate)}{visit.procedure ? ` · ${visit.procedure}` : ''}</p>
        <div className="tk-status" role="radiogroup" aria-label="وضعیتِ عمل">
          {STATUS_CHOICES.map(({ key, label, hint, icon: Icon }) => (
            <button key={key} type="button" role="radio" aria-checked={pick === key} disabled={busy}
                    className={`tk-status-opt k-${key}${pick === key ? ' on' : ''}`} onClick={() => { setPick(key); setErr(''); }}>
              <Icon width="18" height="18" aria-hidden="true" />
              <span><b>{label}</b><small>{hint}</small></span>
            </button>
          ))}
        </div>
        {pick === 'postponed' && (
          <JDate className="tk-field" label="تاریخِ تازه (اختیاری)" value={date} onChange={setDate} disabled={busy}
                 hint="اگر هنوز معلوم نیست خالی بگذارید؛ عمل از دفترِ امروز برداشته می‌شود و مدیر تاریخ را می‌گذارد." />
        )}
        {err && <p className="tk-note no" role="alert">{err}</p>}
        <button type="button" className="tk-save" disabled={busy || !pick} onClick={save}>
          {busy ? 'در حال ثبت…' : cta}
        </button>
      </div>
    </Overlay>
  );
}

/**
 * آپلودِ گزارشِ خدمت — یک دکمه، بدونِ شیت: کارشناس فایل را همان‌جا می‌دهد.
 *
 * ⚠️ «گزارشِ خدمت» (نامش از سرور: «گزارشِ نورومانیتورینگ») نه «گزارشِ عمل» — شرکت عمل انجام
 * نمی‌دهد، خدمتی حینِ عمل می‌دهد و این گزارشِ همان است (مالک، ۱۴۰۵/۰۷/۰۵).
 */
function ReportButton({ visit, onDone, onError }) {
  /* گزارش معمولاً **چند صفحه** است؛ تا دیروز هر صفحه یک رفت‌وبرگشتِ
     کامل بود. حالا همان کادرِ مشترک صف را می‌گرداند. */
  const send = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    await apiUpload(`/tech/visits/${visit.id}/report`, fd);
  };
  return (
    <FileDrop
      variant="button"
      accept="image/*,application/pdf"
      label={visit.reportAt ? `گزارش ثبت شده — ${faDate(visit.reportAt)} · افزودنِ صفحه` : `آپلودِ ${visit.reportLabel || 'گزارشِ خدمت'}`}
      onUpload={send}
      onAllDone={() => onDone(`${visit.reportLabel || 'گزارشِ خدمت'} ثبت شد`)}
    />
  );
}

/**
 * برگهٔ مصرف + اعلامِ پایان.
 *
 * عدد «جمعِ مصرف‌شده» است نه «چقدر کم کن» — کارشناسِ وسطِ عمل حسابِ ثبتِ
 * قبلی را نگه نمی‌دارد. همان قراردادی که صفحهٔ انبار دارد؛ دو معنیِ متفاوت
 * برای یک فیلد یعنی موجودیِ غلط.
 */
function UsageSheet({ transferId, onClose, onToast }) {
  const [t, setT] = useState(null);
  const [used, setUsed] = useState({});
  const [note, setNote] = useState('');
  const [pickupAt, setPickupAt] = useState('');
  const [leftAt, setLeftAt] = useState('');
  const [busy, setBusy] = useState(false);
  /* میان‌بُرهای محل از تعاریفِ پایه می‌آیند، نه از آرایهٔ ثابتِ این فایل. */
  const places = usePlaces();

  const load = useCallback(async () => {
    try { setT(await api(`/stock/transfers/${transferId}`)); }
    catch (e) { onToast(e.message); }
  }, [transferId, onToast]);
  useEffect(() => { load(); }, [load]);

  const act = async (path, body, msg) => {
    setBusy(true);
    try {
      await api(path, { method: 'POST', body });
      onToast(msg);
      await load();
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  return (
    <Overlay backdrop="tk-overlay" panel="tk-sheet" as="section" onClose={onClose} closable={!busy}>
      <header className="tk-sheet-head">
        <b>{t ? `حوالهٔ ${t.code}` : 'حواله'}</b>
        <button type="button" className="tk-x" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>

      {!t ? <div className="tk-empty">در حال بارگذاری…</div> : (
        <div className="tk-sheet-body">
          <div className="tk-tot">
            <div><b>{num(t.totals.sent)}</b><span>ارسال</span></div>
            <div><b>{num(t.totals.used)}</b><span>مصرف</span></div>
            <div className={t.totals.remaining ? 'warn' : ''}><b>{num(t.totals.remaining)}</b><span>مانده</span></div>
          </div>

          {t.lines.map((l) => (
            <div key={l.movementId} className="tk-line">
              <b>{l.itemName}{l.itemSize ? ` — ${l.itemSize}` : ''}</b>
              <small dir="ltr">{l.serialNo || l.lotNo || `#${l.lotId}`}</small>
              {t.status === 'closed' ? (
                <span>ارسال {num(l.sent)} · مصرف {num(l.used)}</span>
              ) : (
                <label>
                  <span>ارسال {num(l.sent)}</span>
                  مصرف شد
                  <input dir="ltr" inputMode="numeric"
                         value={used[l.lotId] ?? String(l.used)}
                         onChange={(e) => setUsed((s) => ({ ...s, [l.lotId]: e.target.value }))} />
                </label>
              )}
            </div>
          ))}

          {t.status !== 'closed' && (
            <button type="button" className="tk-save" disabled={busy}
                    onClick={() => act(
                      `/stock/transfers/${transferId}/usage`,
                      { lines: t.lines.map((l) => ({ lotId: l.lotId, used: Number(toEnDigits(used[l.lotId] ?? String(l.used))) || 0 })) },
                      'برگهٔ مصرف ثبت شد',
                    )}>
              ثبتِ برگهٔ مصرف
            </button>
          )}

          {/* اعلامِ پایان هم دارایی را آزاد می‌کند هم صفِ جمع‌آوری را می‌سازد —
              دفتر خودش نمی‌داند عمل کِی واقعاً تمام شد. */}
          {t.status !== 'planned' && t.status !== 'closed' && (
            t.releasedAt ? (
              <p className="tk-note ok">
                پایان اعلام شد — {faDate(t.releasedAt)}
                {t.pickupAt ? ` · ساعتِ ${faTime(t.pickupAt)}` : ''}
                {t.leftAt ? ` · ${t.leftAt}` : ''} · آمادهٔ جمع‌آوری
              </p>
            ) : (
              <div className="tk-rel">
                {/* «تمام شد» به‌تنهایی برای تیمِ حمل‌ونقل تکلیف نمی‌سازد: راننده
                    باید بداند **کِی** برود و **از کجا** بردارد. همین دو فیلد
                    توقفِ جمع‌آوری را در تختهٔ چینش می‌سازد. */}
                <TimePick
                  className="tk-field"
                  label="کِی بیایند ببرند؟"
                  value={pickupAt}
                  onChange={setPickupAt}
                />
                <label className="tk-field">
                  <span>کجا گذاشتید؟</span>
                  <input value={leftAt} onChange={(e) => setLeftAt(e.target.value)} placeholder="مثلاً CSR" />
                </label>
                <div className="tk-chips">
                  {places.map((p) => (
                    <button key={p} type="button" className={`tk-chip${leftAt === p ? ' on' : ''}`}
                            onClick={() => setLeftAt(p)}>{p}</button>
                  ))}
                </div>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت (اختیاری)" />
                <button type="button" className="tk-save" disabled={busy}
                        onClick={() => {
                          const at = normTime(pickupAt);
                          if (badTime(at)) { onToast('ساعت باید به شکلِ ۰۸:۳۰ باشد'); return; }
                          act(
                            `/stock/transfers/${transferId}/release`,
                            { note: note.trim(), pickupAt: at, leftAt: leftAt.trim() },
                            'پایانِ عمل اعلام شد',
                          );
                        }}>
                  اعلامِ پایانِ عمل
                </button>
              </div>
            )
          )}
        </div>
      )}
    </Overlay>
  );
}

/**
 * ساعتِ واقعیِ عمل — شروع و پایان.
 *
 * «ساعتِ حضورِ شما» عمداً این‌جا نیست (W3.8/U7، تصمیمِ مالک ۱۴۰۵/۰۶/۲۶):
 * حضور مالِ «کارشناس در آن بیمارستان در آن روز» است، نه مالِ یک بیمار، و از
 * برنامهٔ چینش می‌آید. وقتی سه جا می‌نوشتندش، سه جا واگرا می‌شد.
 */
function TimesSheet({ visit, onClose, onSaved }) {
  const [f, setF] = useState({
    opStartTime: visit.opStartTime ?? '',
    opEndTime: visit.opEndTime ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    // نرمال‌سازی پیش از ارسال، چون کاربر ممکن است بدونِ خروج از فیلد
    //    مستقیم «ذخیره» را بزند و «۸:۵» خام به سرور برسد.
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, normTime(v)]));
    if (Object.values(body).some(badTime)) { setErr('ساعت باید به شکلِ ۰۸:۳۰ باشد'); return; }
    setBusy(true); setErr('');
    try {
      await api(`/tech/visits/${visit.id}/times`, { method: 'PATCH', body });
      onSaved('ساعت ثبت شد');
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Overlay backdrop="tk-overlay" panel="tk-sheet sm" as="section" onClose={onClose} closable={!busy}>
      <header className="tk-sheet-head">
        <b>ساعتِ عمل — {visit.patientName}</b>
        <button type="button" className="tk-x" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>
      <div className="tk-sheet-body">
        {[['opStartTime', 'شروعِ عمل'], ['opEndTime', 'پایانِ عمل']].map(([k, label]) => (
          <TimePick
            key={k}
            className="tk-field"
            label={label}
            value={f[k]}
            onChange={(v) => setF((s) => ({ ...s, [k]: v }))}
          />
        ))}
        {err && <p className="tk-note no">{err}</p>}
        <button type="button" className="tk-save" disabled={busy} onClick={save}>
          {busy ? 'در حال ذخیره…' : 'ذخیرهٔ ساعت'}
        </button>
      </div>
    </Overlay>
  );
}
