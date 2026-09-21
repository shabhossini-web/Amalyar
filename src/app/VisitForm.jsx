import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import AssistedTextarea from '../ui/AssistedTextarea.jsx';
import { useAuth } from './auth.jsx';
import { api, apiStream } from '../lib/api.js';
import { isoToJStr, jStrToIso } from '../lib/jalali.js';
import { isValidNationalId, randomNationalId, toEnDigits } from '../lib/identity.js';
import { badTime, durationMin, normTime, faDuration } from '../lib/time.js';
import { useConfig } from './config.jsx';
import { useFormDef, star } from './useFormDef.jsx';
import DynForm, { dynErrors } from '../ui/DynForm.jsx';
import VoiceInput from '../ui/VoiceInput.jsx';
import OrderSheet, { ORDER_META } from './OrderSheet.jsx';
import JDate from './JDate.jsx';
import { Close, Plus } from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import TimePick from '../ui/TimePick.jsx';
import Pick from '../ui/Pick.jsx';
import { KINDS, kindOf } from './visit-kinds.js';
import './dashboard.css';
import './surgeon-portal.css'; // sp-card در فرمِ ویرایشِ مراجعه

/**
 * فرمِ ثبت و ویرایشِ مراجعه — از W3.2 فایلِ خودش دارد.
 *
 * تا دیروز داخلِ `Dashboard.jsx` بود و آن فایل ۲۴۳۶ خط شده بود: فهرست، فیلتر،
 * جستجوی پیشرفته، کارت، و یک فرمِ ۱۲۰۰خطی در یک جا. این استخراج **هیچ رفتاری
 * را عوض نمی‌کند** — همان کد است با همان propها — و فقط فضای کارِ ویزیت (بقیهٔ
 * W3.2) را ممکن می‌کند: صفحه‌ای که همین فرم را بدونِ داشبورد باز می‌کند.
 *
 * ⚠️ `DefSelect` هم همین‌جاست چون فقط همین فرم استفاده‌اش می‌کند. واژگانِ نوعِ
 * مراجعه (`kindOf`) و `faDuration` مشترک‌اند و به `visit-kinds.js` و
 * `lib/time.js` رفتند تا دو نسخه نشوند.
 */

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');

/** تصمیمِ درمانیِ ویزیت — همان فهرستِ سرور (DECISIONS در visit.dto). */
const DECISIONS = [
  { v: 'surgery', l: 'کاندیدای جراحی', hint: 'بعد از ذخیره، فرمِ عملِ همین بیمار باز می‌شود' },
  { v: 'conservative', l: 'درمانِ محافظه‌کارانه', hint: 'ویزیتِ بعدی با موضوعِ پیگیریِ درمان' },
  { v: 'lab', l: 'درخواستِ آزمایش' },
  { v: 'imaging', l: 'درخواستِ عکس‌برداری' },
  { v: 'consult', l: 'مشاوره' },
  { v: 'referral', l: 'ارجاع' },
];

/* ── سلکتِ موجودیت + افزودنِ سریع (جراح/بیمارستان) ── */
function DefSelect({ label, icon, value, onChange, options, onQuickAdd, addPlaceholder }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submitAdd = async () => {
    const n = name.trim();
    if (n.length < 2 || busy) return;
    setBusy(true);
    try {
      const created = await onQuickAdd(n);
      onChange(created.id);
      setAdding(false);
      setName('');
    } catch {
      // پیام را onQuickAdd به‌شکلِ toast داده؛ این‌جا فقط پنل باز می‌ماند تا
      // کاربر همان نوشته را اصلاح کند. بدونِ این catch، خطای اعتبارسنجیِ
      // معمولی به‌صورت unhandled rejection در کنسول می‌نشست.
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="db-field">
      <span>{icon} {label}</span>
      {adding ? (
        <div className="db-quickadd">
          <input
            type="text"
            value={name}
            autoFocus
            placeholder={addPlaceholder}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitAdd(); } }}
          />
          <button type="button" disabled={busy || name.trim().length < 2} onClick={submitAdd}>ثبت</button>
          <button type="button" className="ghost" onClick={() => { setAdding(false); setName(''); }}>لغو</button>
        </div>
      ) : (
        <div className="db-selrow">
          {/* ⚠️ Pick به‌جای selectِ بومی: پاپ‌آپِ بومی روی ویندوز کند و بدرنگ
              باز می‌شد (گزینه‌ها تا repaint سیاه می‌ماندند) — گزارشِ کاربر. */}
          <Pick
            label={label}
            value={value ?? null}
            onChange={onChange}
            options={options}
          />
          {onQuickAdd && (
            <button type="button" className="db-addmini" title="افزودنِ جدید" onClick={() => setAdding(true)}>
              <Plus width="15" height="15" />
            </button>
          )}
        </div>
      )}
    </label>
  );
}

/* ── فرمِ ثبت/ویرایشِ مراجعه ── */
export default function VisitForm({ initial, prefill, defs, onDefsChanged, onClose, onSaved, onToast }) {
  const { t, defaultKind = 'surgery' } = useConfig();
  const editing = !!initial?.id;
  /* prefill = ادامهٔ یک تصمیم («کاندیدای جراحی» در ویزیتِ قبلی): پرونده از
     قبل معلوم است، پس نه گامِ انتخابِ بیمار لازم است نه انتخابِ نوعِ فرم. */
  const [mode, setMode] = useState(prefill?.patientId ? 'existing' : 'new');
  const [pQuery, setPQuery] = useState('');
  const [pResults, setPResults] = useState([]);
  const [picked, setPicked] = useState(prefill?.patientId ? { id: prefill.patientId, fullName: prefill.patientName ?? '' } : null);

  /**
   * گام‌های ثبتِ تازه: ۱ پرونده → ۲ نوعِ فرم → ۳ پرکردن.
   *
   * ⚠️ ترتیب عمدی است و برعکسِ قبل. تا دیروز نوعِ مراجعه **اولین** چیزِ فرم
   * بود و پرونده دومی؛ یعنی کاربر پیش از آنکه بداند این آدم کیست، باید
   * تصمیم می‌گرفت چه نوع مراجعه‌ای است. در پذیرشِ واقعی اول می‌پرسند «شما؟»
   * و بعد «برای چه آمده‌اید؟».
   *
   * ⚠️ در **ویرایش** هیچ گامی نیست: پرونده از قبل معلوم است و کاربر آمده یک
   * فیلد را درست کند، نه اینکه سه‌بار «بعدی» بزند.
   */
  const [step, setStep] = useState(prefill?.patientId ? 3 : 1);
  const [stepErr, setStepErr] = useState('');

  const [f, setF] = useState(() => ({
    /* پیش‌فرضِ نوع از حوزه (`/config.defaultKind`): مطب ویزیت، بقیه عمل (بستهٔ ۵ب). */
    kind: initial?.kind || prefill?.kind || defaultKind,
    firstName: initial?.firstName || '',
    lastName: initial?.lastName || '',
    phone: initial?.phone || '',
    nationalId: initial?.nationalId || '',
    birthDateJ: initial?.birthDate ? isoToJStr(initial.birthDate) : '',
    surgeonId: initial?.surgeonId ?? null,
    hospitalId: initial?.hospitalId ?? null,
    techId: initial?.techId ?? null,
    procedureTypeId: initial?.procedureTypeId ?? null,
    diagnosisId: initial?.diagnosisId ?? null,
    topicId: initial?.topicId ?? null,
    // متنِ آزاد فقط برای رکوردهای قدیمی که هنوز به نوعِ عمل وصل نشده‌اند.
    opType: initial?.procedureTypeId ? '' : initial?.opType || '',
    opReport: initial?.opReport || '',
    amount: '', // مبلغِ توافقی — فقط هنگامِ ساخت
    opDateJ: initial?.opDate ? isoToJStr(initial.opDate) : '',
    nextVisitDateJ: initial?.nextVisitDate ? isoToJStr(initial.nextVisitDate) : '',
    postOpCare: initial?.postOpCare ?? '',
    followUpDays: initial?.followUpDays ?? '',
    postOpImmediate: initial?.postOpImmediate ?? false,
    preOpCare: initial?.preOpCare ?? '',
    preOpImmediate: initial?.preOpImmediate ?? false,
    decisions: initial?.decisions ?? [],
    opStartTime: initial?.opStartTime || '',
    opEndTime: initial?.opEndTime || '',
    notes: initial?.notes || '',
  }));
  const [busy, setBusy] = useState(false);
  /* دستیارِ AI روی خودِ فرمِ عمل — دکمه‌های شرح/مراقبت فقط در ویرایش
     (پرونده و مراجعه معلوم‌اند)؛ دیکتهٔ صوتی در ساخت هم هست. */
  const [aiOn, setAiOn] = useState(false);
  const [sttOn, setSttOn] = useState(false); // دستیارِ صوتی — با مدلِ گفتار-به-متن
  const [aiBusy, setAiBusy] = useState(false); // false | 'structure' | 'continue' | 'care' | 'dictate'
  const [rawReport, setRawReport] = useState(null);
  /* آخرین پیش‌نویس‌های دستیار روی همین فرم — برای «یادگیری از اصلاحِ دستی». */
  const aiDraftsRef = useRef({});

  useEffect(() => {
    let on = true;
    api('/ai/status').then((r) => { if (on) { setAiOn(!!r?.enabled); setSttOn(!!r?.stt); } }).catch(() => {});
    return () => { on = false; };
  }, []);

  /** ساخت‌یافته/ادامهٔ شرحِ عمل — همان دستیارِ زندهٔ پرونده، همین‌جا روی فرم. */
  const aiReport = async (mode) => {
    if (!f.opReport.trim()) { onToast('اول شرح را بنویسید، بعد دستیار', true); return; }
    setAiBusy(mode);
    const raw = f.opReport;
    let draft = mode === 'continue' ? raw.replace(/\n?$/, '\n') : '';
    try {
      setRawReport(raw);
      await apiStream(
        '/ai/note-draft/stream',
        { patientId: initial.patientId, visitId: initial.id, kind: 'op', mode, text: raw },
        (d) => { draft += d; setF((s2) => ({ ...s2, opReport: draft })); },
      );
      /* متنِ کامل، همان‌طور که دستیار تحویل داد — مبنای «یادگیری از اصلاح». */
      aiDraftsRef.current.op = draft;
    } catch (e) {
      setF((s2) => ({ ...s2, opReport: raw }));
      setRawReport(null);
      onToast(e.message);
    } finally { setAiBusy(false); }
  };

  /** پیش‌نویسِ مراقبتِ پس از عمل — با اشراف به پرونده/تشخیص/شرحِ همین مراجعه. */
  const aiCare = async () => {
    setAiBusy('care');
    try {
      const r = await api('/ai/care-draft', { method: 'POST', body: { visitId: initial.id } });
      aiDraftsRef.current.care = r.text;
      setF((s2) => ({ ...s2, postOpCare: r.text }));
    } catch (e) { onToast(e.message); } finally { setAiBusy(false); }
  };

  /**
   * دیکتهٔ بیمارِ جدید — متنِ ویسپرشده را دستیارِ متنی تحلیل می‌کند و
   * فیلدهای گامِ اول را پر می‌کند؛ فقط فیلدهای خالی پر می‌شوند تا تایپِ
   * دستیِ کاربر خورده نشود. تا «ثبت» زده نشود چیزی ذخیره نمی‌شود.
   */
  const dictatePatient = async (text) => {
    setAiBusy('dictate');
    try {
      const r = await api('/ai/parse-patient', { method: 'POST', body: { text } });
      const fields = r?.fields ?? {};
      setF((s2) => ({
        ...s2,
        firstName: s2.firstName.trim() ? s2.firstName : (fields.firstName || s2.firstName),
        lastName: s2.lastName.trim() ? s2.lastName : (fields.lastName || s2.lastName),
        phone: s2.phone.trim() ? s2.phone : (fields.phone || s2.phone),
        nationalId: s2.nationalId.trim() ? s2.nationalId : (fields.nationalId || s2.nationalId),
        notes: fields.notes ? (s2.notes.trim() ? `${s2.notes}\n${fields.notes}` : fields.notes) : s2.notes,
      }));
      onToast('فیلدها از دیکته پر شدند — پیش از ادامه مرورشان کنید');
    } catch (e) { onToast(e.message); } finally { setAiBusy(false); }
  };
  /* روزهای پیگیری — آینهٔ parseDays سرور: ارقامِ فارسی/هر جداکننده‌ای، ۰..۳۶۵
     (روزِ ۰ = بلافاصله بعد از عمل). */
  const parseFollowDays = (raw) => [...new Set(toEnDigits(raw || '').split(/[^0-9]+/)
    .map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 365))].sort((a, b) => a - b);
  const followList = parseFollowDays(f.followUpDays);
  /* زمان‌بندیِ پیام‌ها از تنظیماتِ شرکت — تا فرم **صریح** بگوید هر پیام کِی
     می‌رود، نه اینکه جراح حدس بزند. نبودش فقط یعنی جملهٔ کلی‌تر. */
  const [timing, setTiming] = useState(null);
  useEffect(() => {
    let on = true;
    api('/care-plan/timing').then((r) => { if (on) setTiming(r); }).catch(() => {});
    return () => { on = false; };
  }, []);
  /* پیش‌فرضِ همین نوعِ عمل (تعریف‌های پایه) — منبعِ «چه چیزی خودکار اجرا می‌شود». */
  /* ⚠️ «عمل برای فرداست یا همین امروز؟» — پاسخش هم پیش‌فرضِ ارسال را عوض
     می‌کند هم متنِ راهنما را. ثبتِ چندروزقبل: بیمار باید همان لحظه دستورهای
     قبل از عمل را بگیرد. ثبتِ همان‌روز: دیگر «قبل از عمل»ی نمانده. */
  const opDayDelta = (() => {
    const iso = jStrToIso(f.opDateJ);
    if (!iso) return null;
    const d = new Date(iso);
    const day = (x) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
    const now = new Date();
    return Math.round((day(d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
  })();
  const opIsToday = opDayDelta === 0;
  /* تب‌های مرحلهٔ عمل (بازخوردِ مالک ۱۴۰۵/۰۶/۲۹): پایینِ فرمِ عمل سه بخشِ
     «قبل / حین / بعد از عمل» به‌جای یک ستونِ شلوغ. تبِ آغازین از **زمانِ عمل**
     می‌آید — ثبتِ تازه یا عملِ آینده: قبل؛ همین امروز: حین؛ گذشته: تا شرح نوشته
     نشده حین، بعدش بعد. فقط یک‌بار در باز شدن حساب می‌شود تا تایپِ شرح
     تب را زیرِ دستِ کاربر عوض نکند. */
  const [phase, setPhase] = useState(() => {
    if (!initial?.id || !initial?.opDate) return 'pre';
    const d = new Date(initial.opDate);
    const now = new Date();
    const delta = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
      - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
    if (delta > 0) return 'pre';
    if (delta === 0) return 'intra';
    return (initial.opReport || '').trim() ? 'post' : 'intra';
  });
  /* پیش‌فرض فقط تا وقتی کاربر خودش دست نزده — بعدش انتخابِ او حاکم است. */
  /* سفارش‌های همین مراجعه (آزمایش/عکس/مشاوره/ارجاع) — چیپِ تصمیم فقط
     «ثبتِ تصمیم» نیست: فرمش را همان‌جا باز می‌کند و ارسال می‌کند. */
  const [orders, setOrders] = useState([]);
  const [orderSheet, setOrderSheet] = useState(null); // {kind, order?}
  /* کارتِ آماده‌سازی (W3.2) — یک درخواست، فقط برای مراجعهٔ ذخیره‌شده. */
  const [prep, setPrep] = useState(null);
  useEffect(() => {
    if (!initial?.id) return;
    let on = true;
    api(`/visits/${initial.id}/prep`).then((r) => { if (on) setPrep(r); }).catch(() => {});
    return () => { on = false; };
  }, [initial?.id]);
  const loadOrders = useCallback(() => {
    if (!initial?.id) return;
    api(`/orders?visitId=${initial.id}`).then((r) => setOrders(Array.isArray(r) ? r : [])).catch(() => {});
  }, [initial?.id]);
  useEffect(() => { loadOrders(); }, [loadOrders]);

  const preTouched = useRef(false);
  useEffect(() => {
    if (editing || preTouched.current || opDayDelta === null) return;
    setF((s2) => (s2.preOpImmediate === opDayDelta > 0 ? s2 : { ...s2, preOpImmediate: opDayDelta > 0 }));
  }, [opDayDelta, editing]);

  const procRow = defs.procedures.find((p) => p.id === f.procedureTypeId) ?? null;
  const procDefaults = {
    name: procRow?.name ?? (f.opType || ''),
    preOpCare: procRow?.preOpCare ?? '',
    postOpCare: procRow?.postOpCare ?? '',
    followUpDays: procRow?.followUpDays ?? '',
    has: !!(procRow?.preOpCare || procRow?.postOpCare || procRow?.followUpDays),
  };
  const toggleFollowDay = (d) => setF((s2) => {
    const cur = parseFollowDays(s2.followUpDays);
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b);
    return { ...s2, followUpDays: next.join(',') };
  });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  /* تصمیمِ درمانی — چندتایی است چون یک ویزیت می‌تواند هم آزمایش بدهد هم
     مشاوره بخواهد. «کاندیدای جراحی» موضوعِ همین ویزیت را هم پره‌آپ می‌کند:
     همان ویزیت است که تبدیل به ویزیتِ قبل از عمل شده. */
  const preOpTopicId = defs.topics.find((tp) => tp.name.includes('پره‌آپ'))?.id ?? null;
  const toggleDecision = (v) => setF((s2) => {
    const on = s2.decisions.includes(v);
    const decisions = on ? s2.decisions.filter((x) => x !== v) : [...s2.decisions, v];
    const topicId = !on && v === 'surgery' && preOpTopicId && !s2.topicId ? preOpTopicId : s2.topicId;
    return { ...s2, decisions, topicId };
  });
  const formDuration = durationMin(f.opStartTime, f.opEndTime);

  /* تعریفِ فرمِ همین نوع — برچسب، ستاره و روشن/خاموشِ فیلدهای هسته‌ای، به‌علاوهٔ
     فیلدهای دلخواهی که سوپرادمین ساخته. */
  const fd = useFormDef(f.kind);
  /* پشتیبانِ هاردکدِ نوع‌ها فقط بعد از مهلتِ بی‌پاسخی — نه در اولین رندر. */
  const [kindsWaited, setKindsWaited] = useState(false);
  useEffect(() => {
    if (fd.kinds !== null) return undefined;
    const t2 = setTimeout(() => setKindsWaited(true), 4000);
    return () => clearTimeout(t2);
  }, [fd.kinds]);
  /* «هر کس قسمتِ خودش را پر کند» — نقشِ شغلیِ کاربرِ جاری. قفل و برچسب فقط
     نمایش‌اند؛ اجرای واقعی سمتِ سرور است. سوپرادمین (سطح ۶) بیرون از قاعده
     است: برچسبِ بخش‌ها را می‌بیند ولی هیچ فیلدی برایش قفل نمی‌شود — یک نفر
     باید کلِ چرخه را ببیند و اصلاح کند. */
  const { user: me } = useAuth();
  const myRole = (me?.level ?? 0) >= 6 ? null : (me?.jobRole ?? null);
  const keyLocked = (key) => { const roles = fd.rolesOf(key); return !!(roles.length && myRole && !roles.includes(myRole)); };
  const [extra, setExtra] = useState(() => initial?.extra ?? {});
  const [extraErr, setExtraErr] = useState({});

  useEffect(() => {
    if (mode !== 'existing') return undefined;
    const t = setTimeout(() => {
      api(`/patients?q=${encodeURIComponent(pQuery)}`)
        .then(setPResults)
        .catch(() => setPResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [pQuery, mode]);

  /**
   * کد ملیِ کامل → همان لحظه پروندهٔ موجود را نشان بده.
   *
   * بدونِ این، کاربر کلِ فرم را پر می‌کرد و تازه هنگامِ ثبت با ۴۰۹ روبه‌رو می‌شد.
   * این‌طور «مراجعهٔ مجدد» پیش از اتلافِ وقت دیده می‌شود، که هدفِ اصلیِ
   * «هر کد ملی یک پرونده» است.
   */
  const [nidMatch, setNidMatch] = useState(null);
  useEffect(() => {
    const nid = toEnDigits(f.nationalId).replace(/[^0-9]/g, '');
    if (editing || mode !== 'new' || !isValidNationalId(nid)) { setNidMatch(null); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      /* ⚠️ endpointِ **دقیق**، نه `/patients?q=`. آن `contains` می‌زد و تا ۲۰
         پرونده می‌آورد تا کلاینت خودش دنبالِ تطابقِ دقیق بگردد — یعنی برای یک
         «بله/خیر»، بیست پروندهٔ دیگر هم از سرور بیرون می‌رفت. */
      api(`/patients/by-national-id?nid=${nid}`)
        .then((r) => { if (alive) setNidMatch(r?.found ? (r.patient ?? { restricted: true }) : null); })
        .catch(() => { if (alive) setNidMatch(null); });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [f.nationalId, mode, editing]);

  /**
   * آیا گامِ «پرونده» تمام است؟ — و اگر نه، **چرا**.
   *
   * ⚠️ خواستهٔ کاربر (بندِ ۱۴): کد ملیِ تازه یعنی اول پرونده باز و **کامل**
   * شود، بعد مراجعه. پس این‌جا جلوی رفتن به گامِ بعد گرفته می‌شود، نه در
   * لحظهٔ ثبت. تفاوتش این است که کاربر پیش از پرکردنِ کلِ فرم می‌فهمد چه کم
   * دارد، نه بعدش.
   *
   * ⚠️ حالتِ نام‌خانوادگیِ متفاوت **بلوکه** می‌شود چون سرور همان‌جا ۴۰۹
   * می‌دهد (`findByNationalId`). بدونِ این سد، کاربر سه گام جلو می‌رفت و
   * دستِ آخر خطایی می‌گرفت که ربطی به گامِ سوم نداشت.
   */
  const stepOneProblem = () => {
    if (mode === 'existing') return picked ? '' : `${t.record}ی انتخاب نشده — از فهرست یکی را بردارید`;
    if (f.firstName.trim().length < 2) return 'نام را وارد کنید';
    if (f.lastName.trim().length < 2) return 'نام خانوادگی را وارد کنید';
    const nid = toEnDigits(f.nationalId).replace(/[^0-9]/g, '');
    if (nid && !isValidNationalId(nid)) return 'کد ملی معتبر نیست — رقم‌ها را بررسی کنید';
    if (nidMatch && !nidMatch.restricted && nidMatch.lastName?.trim() !== f.lastName.trim()) {
      return `این کد ملی به پروندهٔ «${nidMatch.code} — ${nidMatch.fullName}» تعلق دارد.`
        + ' اگر همان بیمار است رویش بزنید، وگرنه کد ملی را بررسی کنید.';
    }
    return '';
  };

  const goNext = () => {
    if (step === 1) {
      const bad = stepOneProblem();
      setStepErr(bad);
      if (bad) return;
    }
    setStepErr('');
    setStep((s) => Math.min(3, s + 1));
  };

  // تشخیص با `title` ساخته می‌شود، بقیهٔ تعاریف با `name`.
  /**
   * افزودنِ سریع از داخلِ فرم.
   *
   * ⚠️ جراح استثناست: هویتش یک Person است و سرور `firstName` و `lastName`
   * جدا می‌خواهد، نه یک `name`. تا امروز همان `{name}` فرستاده می‌شد و دکمهٔ
   * `+` کنارِ جراح **همیشه** با خطای اعتبارسنجی رد می‌شد — بی‌صدا، چون کاربر
   * فقط یک toastِ انگلیسیِ نامفهوم می‌دید. این‌جا نام از اولین فاصله تکه
   * می‌شود (فامیلِ دوکلمه‌ای رایج است، نامِ مرکب نادر).
   */
  const bodyFor = (kind, value) => {
    if (kind !== 'surgeons') return { [kind === 'diagnoses' ? 'title' : 'name']: value };
    const parts = value.trim().split(/\s+/);
    if (parts.length < 2) throw new Error('نام و نام خانوادگیِ جراح را با یک فاصله وارد کنید');
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
  };

  const quickAdd = (kind) => async (value) => {
    try {
      const created = await api(`/${kind}`, { method: 'POST', body: bodyFor(kind, value) });
      await onDefsChanged();
      onToast(`«${value}» اضافه شد ✓`);
      return created;
    } catch (e) {
      onToast(e.message);
      throw e;
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy || aiBusy) return;
    /* ⚠️ Enter داخلِ یک ورودیِ متنی فرم را submit می‌کند. بدونِ این سد،
       زدنِ Enter روی کادرِ کد ملی در گامِ ۱ مراجعه‌ای نیم‌ساخته می‌فرستاد و
       کاربر خطایی می‌دید که ربطی به کاری که کرده بود نداشت. */
    if (!editing && step < 3) { goNext(); return; }
    let opDate;
    if (f.opDateJ.trim()) {
      opDate = jStrToIso(f.opDateJ);
      if (!opDate) { onToast(`${kindOf(f.kind).date} نامعتبر است (مثال: ۱۴۰۵/۰۴/۲۸)`); return; }
    }
    let nextVisitDate;
    if (f.nextVisitDateJ.trim()) {
      nextVisitDate = jStrToIso(f.nextVisitDateJ);
      if (!nextVisitDate) { onToast('تاریخِ ویزیتِ بعدی نامعتبر است (مثال: ۱۴۰۵/۰۵/۱۰)'); return; }
    }
    let birthDate;
    if (f.birthDateJ.trim()) {
      birthDate = jStrToIso(f.birthDateJ);
      if (!birthDate) { onToast('تاریخِ تولد نامعتبر است (مثال: ۱۳۷۰/۰۱/۱۵)'); return; }
    }
    // ساعت‌ها پیش از ارسال نرمال می‌شوند (کاربر ممکن است بدونِ blur ذخیره بزند).
    const times = {
      opStartTime: normTime(f.opStartTime),
      opEndTime: normTime(f.opEndTime),
    };
    const badKey = Object.entries(times).find(([, v]) => badTime(v));
    if (badKey) { onToast('ساعت باید به شکلِ ۰۸:۳۰ باشد'); return; }

    const nid = toEnDigits(f.nationalId).replace(/[^0-9]/g, '');
    // اعتبارسنجیِ سمتِ کاربر تا پیشِ ارسال بازخورد بگیرد؛ اعتبارِ واقعی سمتِ سرور است.
    if (nid && !isValidNationalId(nid)) { onToast('کد ملی معتبر نیست — رقم‌ها را بررسی کنید'); return; }

    /* ⚠️ ستاره‌ی فیلدهای هسته‌ای هم این‌جا سنجیده می‌شود، نه فقط دلخواه‌ها.
       سرور هر دو را می‌سنجد؛ این‌جا فقط زودتر و کنارِ خودِ فیلد گفته می‌شود.
       مقدارها از دو جا می‌آیند چون هسته‌ای‌ها در `f` هستند و دلخواه‌ها در
       `extra` — همان تقسیمی که سرور هم دارد. */
    const eCustom = dynErrors(fd.customFields, extra, myRole);
    setExtraErr(eCustom);
    if (Object.keys(eCustom).length) {
      onToast(Object.values(eCustom)[0]);
      return;
    }
    const builtinVals = {
      surgeonId: f.surgeonId, hospitalId: f.hospitalId, techId: f.techId,
      procedureTypeId: f.procedureTypeId, diagnosisId: f.diagnosisId, topicId: f.topicId,
      opDate: f.opDateJ, opStartTime: f.opStartTime, opEndTime: f.opEndTime,
      nextVisitDate: f.nextVisitDateJ, notes: f.notes,
      // در ویرایش همان جمعِ محاسبه‌شدهٔ صورت‌حساب مبنای اعتبارسنجی است.
      amount: editing ? initial.total : f.amount,
    };
    const eBuiltin = dynErrors(
      (fd.def?.fields ?? []).filter((x) => x.builtin && x.key in builtinVals),
      builtinVals,
      myRole,
    );
    if (Object.keys(eBuiltin).length) { onToast(Object.values(eBuiltin)[0]); return; }

    const common = {
      kind: f.kind,
      surgeonId: f.surgeonId ?? (editing ? null : undefined),
      hospitalId: f.hospitalId ?? (editing ? null : undefined),
      techId: f.techId ?? (editing ? null : undefined),
      procedureTypeId: f.procedureTypeId ?? (editing ? null : undefined),
      diagnosisId: f.diagnosisId ?? (editing ? null : undefined),
      topicId: f.topicId ?? (editing ? null : undefined),
      opType: f.procedureTypeId ? undefined : f.opType.trim() || undefined,
      // پاسخِ فیلدهای دلخواه — سرور خودش به ستون و JSON تقسیمشان می‌کند.
      extra,
      opReport: f.opReport.trim() || undefined,
      opDate,
      /* پاک‌کردن در ویرایش با null — پزشکِ منصرف باید بتواند برش دارد. */
      nextVisitDate: f.nextVisitDateJ.trim() ? nextVisitDate : (editing ? null : undefined),
      /* پیگیریِ اختصاصیِ همین بیمار — خالی یعنی «برگرد به قالبِ نوعِ عمل». */
      postOpCare: f.postOpCare.trim() || (editing ? '' : undefined),
      followUpDays: toEnDigits(f.followUpDays).trim() || (editing ? '' : undefined),
      postOpImmediate: !!f.postOpImmediate,
      preOpCare: f.preOpCare.trim() || (editing ? '' : undefined),
      preOpImmediate: !!f.preOpImmediate,
      decisions: f.decisions,
      // رشتهٔ خالی فرستاده می‌شود نه undefined: کاربر که ساعت را پاک می‌کند
      // منظورش «پاکش کن» است، نه «دست نزن».
      opStartTime: editing || times.opStartTime ? times.opStartTime : undefined,
      opEndTime: editing || times.opEndTime ? times.opEndTime : undefined,
      notes: f.notes.trim() || undefined,
    };
    /* ⚠️ فیلدِ بخشِ نقشِ دیگر اصلاً فرستاده نمی‌شود — نه مقدارِ قفل‌شده‌اش.
       سرور echoی بی‌تغییر را تحمل می‌کند، ولی نفرستادن هم تمیزتر است هم
       جلوی ردشدنِ الکی با کلاینتِ ناهمگام را می‌گیرد. */
    for (const k of Object.keys(common)) {
      if (k !== 'extra' && keyLocked(k)) delete common[k];
    }
    if (common.extra) {
      common.extra = Object.fromEntries(Object.entries(common.extra).filter(([k]) => !keyLocked(k)));
    }

    /* ⚠️ مبلغ فقط در **ساخت** می‌رود، نه در ویرایش: ویرایشِ مراجعه نباید
       بی‌سروصدا قلمِ تازه بسازد. اصلاحِ مبلغ کارِ صورت‌حساب است. */
    const amount = Number(toEnDigits(String(f.amount)).replace(/[^0-9]/g, '')) || 0;
    setBusy(true);
    try {
      let saved;
      if (editing) {
        saved = await api(`/visits/${initial.id}`, {
          method: 'PATCH',
          body: {
            ...common,
            opType: f.procedureTypeId ? undefined : f.opType.trim(),
            opReport: f.opReport.trim(),
            opDate: opDate ?? null,
            firstName: f.firstName.trim(),
            lastName: f.lastName.trim(),
            phone: toEnDigits(f.phone).trim(),
            nationalId: nid,
            birthDate: birthDate ?? null,
          },
        });
      } else if (mode === 'existing') {
        if (!picked) { onToast('یک بیمار را از فهرست انتخاب کنید'); setBusy(false); return; }
        saved = await api('/visits', { method: 'POST', body: { ...common, patientId: picked.id, amount: amount || undefined } });
      } else {
        saved = await api('/visits', {
          method: 'POST',
          body: {
            amount: amount || undefined,
            ...common,
            firstName: f.firstName.trim(),
            lastName: f.lastName.trim(),
            phone: toEnDigits(f.phone).trim() || undefined,
            nationalId: nid || undefined,
            birthDate,
          },
        });
      }
      /* یادگیری از اصلاحِ دستی: متنِ ذخیره‌شده با پیش‌نویسِ دستیار فرق دارد؟
         جفتش بی‌سروصدا ثبت می‌شود تا پیش‌نویس‌های بعدی سلیقهٔ کاربر را
         رعایت کنند؛ شکستش نباید ذخیرهٔ موفق را خراب کند. */
      const fb = aiDraftsRef.current;
      if (fb.op?.trim() && f.opReport.trim() && fb.op.trim() !== f.opReport.trim()) {
        api('/ai/feedback', { method: 'POST', body: { kind: 'op', draft: fb.op.trim(), final: f.opReport.trim() } }).catch(() => {});
      }
      if (fb.care?.trim() && f.postOpCare.trim() && fb.care.trim() !== f.postOpCare.trim()) {
        api('/ai/feedback', { method: 'POST', body: { kind: 'care', draft: fb.care.trim(), final: f.postOpCare.trim() } }).catch(() => {});
      }
      aiDraftsRef.current = {};
      /* ⚠️ فرمِ عمل فقط وقتی باز می‌شود که تصمیم **در همین ذخیره تازه**
         گرفته شده باشد — وگرنه هر بار ویرایشِ یک ویزیتِ پره‌آپِ قدیمی هم
         یک فرمِ عملِ ناخواسته باز می‌کرد. */
      const hadSurgery = (initial?.decisions ?? []).includes('surgery');
      const newSurgery = f.decisions.includes('surgery') && f.kind !== 'surgery' && !hadSurgery;
      onSaved(saved, editing, { openSurgery: newSurgery });
    } catch (err) {
      onToast(err.message);
    } finally {
      setBusy(false);
    }
  };

  // غیرفعال‌ها پنهان‌اند، مگر همان‌که روی این مراجعه ثبت شده — وگرنه ویرایش، مقدارِ
  // قبلی را بی‌صدا پاک می‌کرد.
  // «هنوز در حالِ تایپ» غلط نیست؛ فقط طولِ کامل ارزیابی می‌شود.
  const nidDigits = toEnDigits(f.nationalId).replace(/[^0-9]/g, '');
  const nidBad = nidDigits.length === 10 && !isValidNationalId(nidDigits);

  const activeSurgeons = defs.surgeons.filter((s) => s.active || s.id === f.surgeonId);
  const activeHospitals = defs.hospitals.filter((h) => h.active || h.id === f.hospitalId);
  const activeProcedures = defs.procedures.filter((p) => p.active || p.id === f.procedureTypeId);
  const activeDiagnoses = defs.diagnoses.filter((d) => d.active || d.id === f.diagnosisId);
  const activeTopics = (defs.topics ?? []).filter((t) => t.active || t.id === f.topicId);

  /**
   * ترتیبِ پیش‌فرضِ کد — پشتوانه‌ای برای فیلدهایی که هنوز در هیچ قالبی نیامده‌اند.
   * تعریفِ فرم بر این مقدم است؛ این فقط می‌گوید «اگر تعریف چیزی نگفت، کجا بنشیند».
   */
  const BUILTIN_ORDER = [
    'surgeonId', 'hospitalId', 'techId', 'procedureTypeId', 'diagnosisId', 'topicId',
    'opDate', 'opStartTime', 'opEndTime', 'opReport', 'nextVisitDate',
    'amount', 'notes',
  ];
  /* فیلدهای «حینِ عمل» — در فرمِ عمل داخلِ تبِ خودشان می‌نشینند، نه در کارتِ بالا. */
  const INTRA_KEYS = ['opStartTime', 'opEndTime', 'opReport'];

  /**
   * هر فیلدِ هسته‌ای یک گرهِ نام‌دار.
   *
   * ⚠️ `isOn` این‌جا اعمال می‌شود نه در JSX: گرهِ خاموش اصلاً ساخته نمی‌شود تا
   * جای خالی در شبکه نگذارد. ساعت‌ها هم تازه این‌جا به تعریف وصل شدند — تا
   * دیروز `opStartTime`/`opEndTime` با اینکه در `BUILTIN_VISIT_KEYS` بودند،
   * برچسب و ستاره و خاموشی‌شان را از تعریف نمی‌گرفتند.
   */
  const timeNode = (key, fallback) => (
    <TimePick
      label={<>{fd.labelOf(key, fallback)}{star(fd.requiredOf(key))}</>}
      value={f[key]}
      onChange={(v) => setF((s) => ({ ...s, [key]: v }))}
    />
  );

  const builtinNodes = {};
  if (fd.isOn('surgeonId')) builtinNodes.surgeonId = { el: (
    <DefSelect
      label={<>{fd.labelOf('surgeonId', 'جراح')}{star(fd.requiredOf('surgeonId'))}</>}
      value={f.surgeonId}
      onChange={(v) => setF((s) => ({ ...s, surgeonId: v }))}
      options={activeSurgeons}
      onQuickAdd={quickAdd('surgeons')}
      addPlaceholder="نام و نام خانوادگیِ جراح…"
    />) };
  if (fd.isOn('hospitalId')) builtinNodes.hospitalId = { el: (
    <DefSelect
      label={<>{fd.labelOf('hospitalId', 'بیمارستان')}{star(fd.requiredOf('hospitalId'))}</>}
      value={f.hospitalId}
      onChange={(v) => setF((s) => ({ ...s, hospitalId: v }))}
      options={activeHospitals}
      onQuickAdd={quickAdd('hospitals')}
      addPlaceholder="نامِ بیمارستانِ جدید…"
    />) };
  if (fd.isOn('techId')) builtinNodes.techId = { el: (
    <DefSelect
      label={<>{fd.labelOf('techId', t.tech)}{star(fd.requiredOf('techId'))}</>}
      value={f.techId}
      onChange={(v) => setF((s) => ({ ...s, techId: v }))}
      options={defs.techs}
    />) };
  if (fd.isOn('procedureTypeId')) builtinNodes.procedureTypeId = { el: (
    <DefSelect
      label={<>{fd.labelOf('procedureTypeId', 'نوعِ عمل')}{star(fd.requiredOf('procedureTypeId'))}</>}
      value={f.procedureTypeId}
      onChange={(v) => setF((s) => ({ ...s, procedureTypeId: v, opType: '' }))}
      options={activeProcedures}
      onQuickAdd={quickAdd('procedure-types')}
      addPlaceholder="نامِ نوعِ عملِ جدید…"
    />) };
  if (fd.isOn('diagnosisId')) builtinNodes.diagnosisId = { wide: true, el: (
    <DefSelect
      label={<>{fd.labelOf('diagnosisId', 'تشخیص')}{star(fd.requiredOf('diagnosisId'))}</>}
      value={f.diagnosisId}
      onChange={(v) => setF((s) => ({ ...s, diagnosisId: v }))}
      options={activeDiagnoses}
      onQuickAdd={quickAdd('diagnoses')}
      addPlaceholder="عنوانِ تشخیصِ جدید…"
    />) };
  /* موضوعِ ویزیت — اولیه/پست‌آپ/زیبایی. `docs/BOOKING.md` مرحلهٔ ۱. مثلِ بقیهٔ
     تعریف‌ها افزودنِ سریع دارد تا منشی وسطِ ثبت مجبور به رفتن به «تعریف‌ها» نشود. */
  if (fd.isOn('topicId')) builtinNodes.topicId = { wide: true, el: (
    <DefSelect
      label={<>{fd.labelOf('topicId', 'موضوعِ ویزیت')}{star(fd.requiredOf('topicId'))}</>}
      value={f.topicId}
      onChange={(v) => setF((s) => ({ ...s, topicId: v }))}
      options={activeTopics}
      onQuickAdd={quickAdd('visit-topics')}
      addPlaceholder="موضوعِ تازه… مثلِ پست‌آپ"
    />) };
  if (fd.isOn('opDate')) builtinNodes.opDate = { wide: true, el: (
    /* دکمهٔ «امروز» داخلِ خودِ تقویم است؛ تکرارش کنارِ فیلد فقط جا می‌گرفت. */
    <JDate
      label={<>{fd.labelOf('opDate', kindOf(f.kind).date)} (شمسی){star(fd.requiredOf('opDate'))}</>}
      value={f.opDateJ}
      onChange={(v) => setF((s2) => ({ ...s2, opDateJ: v }))}
      placeholder="۱۴۰۵/۰۴/۲۸"
    />) };
  if (fd.isOn('opStartTime')) builtinNodes.opStartTime = { el: timeNode('opStartTime', 'ساعتِ شروع') };
  if (fd.isOn('opEndTime')) builtinNodes.opEndTime = { el: (
    <>
      {timeNode('opEndTime', 'ساعتِ پایان')}
      {/* مدت زیرِ ساعتِ پایان می‌نشیند تا کاربر حسابِ ذهنی نکند — هر جای فرم که
          ساعت‌ها رفته باشند، این هم با آن‌ها می‌رود. */}
      {formDuration != null && (
        <p className="db-hint db-durhint">مدتِ {kindOf(f.kind).label}: {faDuration(formDuration)}</p>
      )}
    </>) };
  /* شرحِ عمل هم حالا ردیفِ کاتالوگ دارد؛ روی نوعی مثلِ «ویزیت» که عمل ندارد
     خاموش است و برچسبش را سوپرادمین می‌تواند مثلاً «شرحِ معاینه» کند. */
  if (fd.isOn('opReport')) builtinNodes.opReport = { wide: true, el: (
    <div className="db-field db-report">
      <span>{fd.labelOf('opReport', 'شرحِ عمل')}{star(fd.requiredOf('opReport'))}</span>
      <textarea rows={3} value={f.opReport} readOnly={!!aiBusy} onChange={set('opReport')} placeholder="یافته‌ها، مسیرِ عمل، رخدادهای حینِ مانیتورینگ…" />
      {editing && aiOn && (
        <div className="db-aibar">
          {sttOn && (
            <VoiceInput
              disabled={busy || !!aiBusy}
              onText={(txt) => setF((s2) => ({ ...s2, opReport: s2.opReport.trim() ? `${s2.opReport}\n${txt}` : txt }))}
              onErr={(m) => onToast(m)}
            />
          )}
          {editing && aiOn && (<>
          <button type="button" className="db-aibtn" disabled={busy || !!aiBusy} onClick={() => aiReport('structure')}>
            {aiBusy === 'structure' ? 'دستیار در حالِ نوشتن…' : 'ساخت‌یافته کن'}
          </button>
          <button type="button" className="db-aibtn" disabled={busy || !!aiBusy} onClick={() => aiReport('continue')}>
            {aiBusy === 'continue' ? 'در حالِ ادامه…' : 'ادامه بنویس'}
          </button>
          {rawReport !== null && (
            <button type="button" className="db-aighost" disabled={!!aiBusy} onClick={() => { setF((s2) => ({ ...s2, opReport: rawReport })); setRawReport(null); }}>
              برگرداندنِ متنِ خام
            </button>
          )}
          </>)}
        </div>
      )}
    </div>) };
  /* «دو هفتهٔ دیگر بیاید» — روی خودِ فرم، تا پزشک وسطِ ویزیت ثبتش کند؛
     پایهٔ فازِ یادآوری‌ها. */
  /* ⚠️ در فرمِ عمل، «ویزیتِ بعدی» داخلِ بخشِ برنامهٔ مراقبت رندر می‌شود؛
     این‌جا رد می‌شود تا دو ورودیِ هم‌ارز روی یک state نباشد. */
  if (fd.isOn('nextVisitDate') && f.kind !== 'surgery') builtinNodes.nextVisitDate = { wide: true, el: (
    <JDate
      label={<>{fd.labelOf('nextVisitDate', 'ویزیتِ بعدی')} (شمسی){star(fd.requiredOf('nextVisitDate'))}</>}
      value={f.nextVisitDateJ}
      onChange={(v) => setF((s2) => ({ ...s2, nextVisitDateJ: v }))}
      placeholder="۱۴۰۵/۰۵/۱۰"
    />) };
  /* مبلغ فقط هنگامِ ثبتِ مراجعهٔ تازه — تا مراجعهٔ صفرتومانی ساخته نشود.
     در ویرایش، صورت‌حساب جای اصلاح است. */
  if (!editing && fd.isOn('amount')) builtinNodes.amount = { wide: true, el: (
    <label className="db-field"><span>{fd.labelOf('amount', 'مبلغِ توافقی (تومان)')}{star(fd.requiredOf('amount'))}</span>
      <input dir="ltr" inputMode="numeric" value={f.amount} onChange={set('amount')}
             placeholder="اختیاری — قلمِ خدمت در صورت‌حساب ساخته می‌شود" />
    </label>) };
  if (editing && fd.isOn('amount')) builtinNodes.amount = { wide: true, el: (
    <div className="db-field db-financial-context" aria-label="وضعیت مالی ثبت‌شده">
      <span>{fd.labelOf('amount', 'مبلغ')} — صورت‌حساب</span>
      <p>مبلغ: {initial.total == null ? '—' : faNum(initial.total)} تومان · پرداخت‌شده: {initial.paid == null ? '—' : faNum(initial.paid)} تومان · مانده: {initial.due == null ? '—' : faNum(initial.due)} تومان</p>
      <small className="db-hint">اصلاح مبلغ و پرداخت‌ها از صورت‌حساب انجام می‌شود. تغییر تاریخ و اطلاعات مراجعه، پرداخت قبلی را تغییر نمی‌دهد.</small>
    </div>) };
  if (fd.isOn('notes')) builtinNodes.notes = { wide: true, el: (
    <label className="db-field"><span>{fd.labelOf('notes', 'یادداشت')}{star(fd.requiredOf('notes'))}</span>
      <AssistedTextarea disabled={busy || !!aiBusy} rows={2} value={f.notes} onChange={set('notes')} />
    </label>) };

  /* ⚠️ بخش‌بندیِ نقش روی فیلدهای هسته‌ای — بعد از ساختِ همهٔ نودها اعمال
     می‌شود تا سیزده بلوکِ جدا هرکدام کپیِ خودش را نگیرد. `<fieldset disabled>`
     همهٔ ورودی‌های داخلش را بومی قفل می‌کند؛ برچسبِ بخش هم همان‌جاست تا
     «چرا قفل است» بی‌جواب نماند. */
  for (const bk of Object.keys(builtinNodes)) {
    const role = fd.roleOf(bk);
    if (!role) continue;
    const locked = keyLocked(bk);
    const node = builtinNodes[bk];
    builtinNodes[bk] = { ...node, el: (
      <fieldset key={bk} className={`db-rolebox${locked ? ' locked' : ''}`} disabled={locked || undefined}>
        <legend>بخشِ {fd.roleLabelOf(bk)}{locked ? ' — فقط‌خواندنی' : ''}</legend>
        {node.el}
      </fieldset>) };
  }


  /* سفارش‌های همین مراجعه — در فرمِ ویزیت زیرِ تصمیم، در فرمِ عمل داخلِ تبِ
     «قبل از عمل» (آزمایش/تصویربرداریِ پیش از عمل — تا دیروز از فرمِ عمل اصلاً
     قابلِ ثبت نبود؛ یافتهٔ جانبیِ بستهٔ ۱). فقط برای مراجعهٔ ذخیره‌شده. */
  const ordersBlock = initial?.id ? (
            <div className="db-orders">
              {orders.map((o) => (
                <div className="db-order" key={`${o.kind}-${o.id}`}>
                  <b>{o.kindFa}</b>
                  <span>{o.summary}</span>
                  <i className={o.status}>
                    {o.status === 'answered' ? 'پاسخ ثبت شد' : o.status === 'sent' ? 'برای بیمار رفت' : 'ثبت‌شده'}
                  </i>
                  <button type="button" onClick={() => setOrderSheet({ kind: o.kind, order: o })}>باز کردن</button>
                </div>
              ))}
              <div className="db-daychips">
                {Object.entries(ORDER_META).map(([k, m]) => (
                  <button key={k} type="button" className="db-daychip"
                          onClick={() => setOrderSheet({ kind: k })}>+ {m.fa}</button>
                ))}
              </div>
            </div>
  ) : null;

  /* فرمِ انتخاب‌شده — برای عنوان و رنگِ بخشِ «فرم» (تمایز از ردیفِ نوع‌ها). */
  const kindMeta = (fd.kinds ?? []).find((k) => k.kind === f.kind) ?? null;

  return (
    <Overlay backdrop="db-overlay" panel="glass db-sheet" as="form" from="bottom" onClose={onClose} onSubmit={submit}>
      <header className="db-sheet-head">
        <b>{editing ? `ویرایشِ ${t.visit} ${initial.code}` : t.visitNew}</b>
        <button type="button" className="db-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
      </header>

      {editing && prep && <PrepCard prep={prep} />}

      {editing && (initial.surgeonInstructions || initial.requiredItems?.length > 0) && <details className="sp-card">
        <summary>دستور جراح و اقلام موردنیاز</summary>
        {initial.surgeonInstructions && <p style={{ whiteSpace: 'pre-wrap' }}>{initial.surgeonInstructions}</p>}
        {initial.requiredItems?.map(item => <p key={item.itemId}>{item.name} × {faNum(item.quantity)}{item.notes ? ` — ${item.notes}` : ''}</p>)}
        <Link to="/app/surgeon" target="_blank" rel="noopener noreferrer">بررسی و اصلاح در پرتال جراح</Link>
      </details>}
      {/* نشانگرِ گام — کاربر باید بداند کجای کار است و چند قدم مانده. */}
      {!editing && (
        <ol className="db-steps" aria-label="گام‌های ثبت">
          {[t.record, `نوعِ ${t.visit}`, 'تکمیل'].map((label, i) => (
            <li key={label} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}>
              {/* برگشت فقط به گامِ **گذشته** — پرشِ رو به جلو همان دور زدنِ
                  اعتبارسنجیِ گام است. */}
              <button
                type="button"
                disabled={step <= i + 1}
                onClick={() => { setStepErr(''); setStep(i + 1); }}
              >
                <i>{faNum(i + 1)}</i>{label}
              </button>
            </li>
          ))}
        </ol>
      )}

      {/* ── گامِ ۱: پرونده ──
          ⚠️ **پنهان می‌شود، unmount نمی‌شود** تا `required`ِ مرورگر روی
          ورودی‌های همین گام زنده بماند و «بعدی» از رویشان رد نشود.

          این‌جا زمانی وصلهٔ باگِ دیگری هم بود: نوارِ تب المانِ shared-layout
          را با هر عوض‌کردنِ تب unmount می‌کرد و خروجِ `AnimatePresence` گیر
          می‌افتاد — یک `.db-overlay`ِ نامرئی روی صفحه می‌ماند و کلیک‌ها را
          می‌بلعید. آن ریشه در `Tabs.jsx` بسته شد (قرصِ همیشه‌مانده، بدونِ
          `layoutId`) و این `hidden` فقط برای اعتبارسنجی مانده. */}
      <div className="db-step" hidden={!(editing || step === 1)}>
      {/* توضیحِ بالای بخش — کاربر باید بداند این قسمت چه کاری می‌کند. */}
      <div className="db-sect">
        <b>{!editing && <i>{faNum(1)}</i>}{t.record}</b>
        <small>
          {editing
            ? 'مشخصاتِ بیمار — تغییرش روی همهٔ مراجعاتِ همین پرونده اثر می‌گذارد.'
            : 'اول بیمار: پروندهٔ جدید بسازید یا پروندهٔ موجود را جستجو کنید — مراجعه زیرِ همین پرونده ثبت می‌شود.'}
        </small>
      </div>
      {!editing && (
        <Tabs
          variant="inset"
          className="db-modetabs"
          label="نوعِ ثبت"
          value={mode}
          onChange={(k) => { setMode(k); if (k === 'existing') setPicked(null); }}
          items={[{ key: 'new', label: 'بیمارِ جدید' }, { key: 'existing', label: 'بیمارِ موجود' }]}
        />
      )}

      {(!editing && mode === 'existing') ? (
        <div className="db-psearch">
          {picked ? (
            <div className="db-picked">
              <b>{picked.fullName}</b>
              <span dir="ltr">{picked.code}</span>
              {/* شمارهٔ مراجعهٔ بعدی، تا پیش از ثبت معلوم باشد کجا می‌نشیند. */}
              <small>{t.visit} {faNum((picked.visitCount ?? 0) + 1)}</small>
              <button type="button" onClick={() => setPicked(null)}>تغییر</button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={pQuery}
                onChange={(e) => setPQuery(e.target.value)}
                placeholder="جستجوی نام / کد پرونده / موبایل / کد ملی…"
                autoFocus
              />
              <div className="db-plist">
                {pResults.map((p) => (
                  <button type="button" key={p.id} onClick={() => setPicked(p)}>
                    <b>{p.fullName}</b>
                    <span dir="ltr">{p.code}</span>
                    <small>{p.nationalId ? `${faNum(p.nationalId)} · ` : ''}{faNum(p.visitCount)} {t.visit}</small>
                  </button>
                ))}
                {pResults.length === 0 && <div className="db-pnone">بیماری پیدا نشد</div>}
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          {/* دیکتهٔ بیمارِ جدید — ضبط → ویسپر → تحلیلِ دستیار → پرشدنِ فیلدها. */}
          {sttOn && !editing && (
            <div className="db-dictate">
              <VoiceInput
                label="دیکتهٔ بیمارِ جدید"
                disabled={busy || !!aiBusy}
                onText={dictatePatient}
                onErr={(m) => onToast(m)}
              />
              <small className="db-hint">
                {aiBusy === 'dictate'
                  ? 'دستیار در حالِ تحلیلِ دیکته…'
                  : 'مثلاً بگویید: «علی رضایی، ۰۹۱۲…، کد ملی…، شکایت از…» — دستیار فیلدها را پر می‌کند.'}
              </small>
            </div>
          )}
          <div className="db-grid2">
            {/* ⚠️ `required` فقط وقتی که این گام **دیده می‌شود**. کادرِ
                اجباریِ پنهان، submit را با «An invalid form control is not
                focusable» بی‌صدا متوقف می‌کند — کاربر دکمه را می‌زند و هیچ
                اتفاقی نمی‌افتد. اعتبارسنجیِ واقعیِ این گام در
                `stepOneProblem` است که پیام را کنارِ دکمه می‌نویسد. */}
            <label className="db-field"><span>نام</span>
              <input type="text" value={f.firstName} onChange={set('firstName')} required={editing || step === 1} minLength={2} />
            </label>
            <label className="db-field"><span>نام خانوادگی</span>
              <input type="text" value={f.lastName} onChange={set('lastName')} required={editing || step === 1} minLength={2} />
            </label>
            <label className="db-field"><span>موبایل</span>
              <input type="tel" dir="ltr" inputMode="numeric" value={f.phone} onChange={set('phone')} placeholder="09xxxxxxxxx" />
            </label>
            <label className={`db-field${nidBad ? ' bad' : ''}`}><span>کد ملی
              {/* موقت — بیمارِ آزمایشی (خواستهٔ مالک): کدِ تصادفیِ معتبر تا
                  اعتبارسنجی رد شود. فقط سوپرادمین می‌بیند. */}
              {me?.level >= 6 && !editing && (
                <button type="button" className="db-nidtest" title="فقط برای بیمارِ آزمایشی — کدِ تصادفیِ معتبر (موقت)"
                  onClick={() => setF((s) => ({ ...s, nationalId: randomNationalId() }))}>کدِ آزمایشی</button>
              )}
            </span>
              <input type="text" dir="ltr" inputMode="numeric" maxLength={12} value={f.nationalId} onChange={set('nationalId')} placeholder="کلیدِ پرونده — اختیاری" />
              {nidBad && <small className="db-hint bad">کد ملی معتبر نیست</small>}
            </label>
          </div>

          {nidMatch && (
            <div className="db-nidmatch">
              <b>این کد ملی از قبل پرونده دارد</b>
              <span>{nidMatch.fullName} — <span dir="ltr">{nidMatch.code}</span> ({faNum(nidMatch.visitCount)} {t.visit})</span>
              <button
                type="button"
                onClick={() => { setPicked(nidMatch); setMode('existing'); }}
              >{t.visitOne}ِ تازه روی همین {t.record}</button>
            </div>
          )}

          <JDate
            label="تاریخِ تولد (شمسی)"
            mode="birth"
            value={f.birthDateJ}
            onChange={(v) => setF((s2) => ({ ...s2, birthDateJ: v }))}
            placeholder="۱۳۷۰/۰۱/۱۵ — اختیاری"
          />
        </>
      )}

      </div>

      {/* ── گامِ ۲: نوعِ فرم ── */}
      {(editing || step === 2) && (<>
      {/* ⚠️ نوعِ فرم **بعد از** پرونده می‌آید، نه قبلش. در پذیرشِ واقعی اول
          می‌پرسند «شما؟» و بعد «برای چه آمده‌اید؟» — و تا ندانیم بیمار کیست،
          پیشنهادِ نوع هم بی‌معنی است. برچسب‌های بقیهٔ فرم از همین انتخاب
          پیروی می‌کنند، پس گامِ بعدی به آن وابسته است. */}
      {/* ⚠️ فقط نوع‌هایی که این نصب واقعاً فرم دارد. نصبِ نورومانیتورینگ چهار
          دکمه نشان نمی‌دهد وقتی سه‌تایشان فرمی ندارند — انتخابی که به هیچ فرمی
          نمی‌رسد، فقط کاربر را سرگردان می‌کند.

          ⚠️ **فهرست از سرور می‌آید، نه از `KINDS`.** تا دیروز روی
          `Object.entries(KINDS)` می‌چرخید و `filter` هم فقط همان چهار کلیدِ
          هاردکد را نگه می‌داشت: نوعی که کاربر در فرم‌ساز می‌ساخت (مثلاً
          «ایمپلنت») **در داشبورد اصلاً دیده نمی‌شد** — هرچند
          `/forms/visit-kinds` می‌شناختش و `approve` هم رویش مراجعه می‌ساخت.
          هیچ خطایی نبود؛ فقط یک نوعِ نامرئی.

          تا وقتی پاسخِ سرور نرسیده فهرستِ پشتیبان می‌ماند، وگرنه یک قطعیِ
          لحظه‌ای ردیف را **خالی** می‌کرد. */}
      <div className="db-sect">
        <b>{!editing && <i>{faNum(2)}</i>}نوعِ فرم</b>
        <small>
          این {t.visit} با کدام فرم ثبت شود؟ هر دکمه یکی از فرم‌های ساخته‌شده در
          فرم‌ساز است و رنگش، رنگِ کارتِ همان فرم روی داشبورد.
        </small>
      </div>
      {/* جعبهٔ خنثیِ خط‌چین — تا ردیفِ انتخابِ نوع از کارتِ رنگیِ خودِ فرم
          (پایین) جدا دیده شود؛ گزارشِ کاربر: «رنگ‌ها قاطی می‌شد». */}
      <div className="db-kindbox">
        {/* ⚠️ تا پاسخِ سرور نیامده، هیچ فهرستی رندر نمی‌شود — گزارشِ میدانی:
            فهرستِ پشتیبانِ هاردکد (عمل/ویزیت/پیگیری/مشاوره) یک لحظه دیده
            می‌شد و بعد جای خودش را به فهرستِ واقعی می‌داد؛ کاربر فکر می‌کرد
            «با مدلِ اشتباه باز شد». پشتیبان فقط بعد از چند ثانیه بی‌پاسخی
            برمی‌گردد تا قطعیِ کاملِ شبکه هم فرم را قفل نکند. */}
        {fd.kinds === null && !kindsWaited ? (
          <div className="db-kindrow db-kindrow-loading" aria-hidden="true">
            <span /><span />
          </div>
        ) : (
        <div className="db-kindrow" role="radiogroup" aria-label={`نوعِ ${t.visit}`}>
          {(fd.kinds ?? Object.entries(KINDS).map(([kind, k]) => ({ kind, title: k.label })))
            .map((k) => (
            <button
              key={k.kind}
              type="button"
              role="radio"
              aria-checked={f.kind === k.kind}
              className={f.kind === k.kind ? 'on' : ''}
              style={k.color ? { '--k': `var(--kind-${k.color})` } : undefined}
              onClick={() => setF((s) => ({ ...s, kind: k.kind }))}
            >{k.title}</button>
          ))}
        </div>
        )}
      </div>

      </>)}

      {/* ── گامِ ۳: تکمیل ── */}
      {(editing || step === 3) && (<>
      <div className="db-sect">
        <b>
          {!editing && <i>{faNum(3)}</i>}
          {/* عنوانِ فرم‌ها معمولاً خودشان با «فرم» شروع می‌شوند («فرمِ عمل»)؛
              پیشوندِ دوباره «فرمِ فرمِ عمل» می‌ساخت. */}
          {(() => { const ft = kindMeta?.title ?? fd.def?.title ?? t.visit; return /^\s*فرم/.test(ft) ? ft : `فرمِ ${ft}`; })()}
        </b>
        <small>فیلدهای همین فرم — لبهٔ رنگیِ این کارت، رنگِ همان فرم است تا با انتخابگرِ بالا اشتباه نشود.</small>
      </div>
      {/* کارتِ خودِ فرم: زمینهٔ جدا + لبهٔ رنگیِ فرمِ انتخاب‌شده — تمایز از ردیفِ نوع‌ها. */}
      <div
        className="db-formcard"
        style={kindMeta?.color ? { '--k': `var(--kind-${kindMeta.color})` } : undefined}
      >
      {/* ⚠️ فیلدهای هسته‌ای **به ترتیبِ تعریف** چیده می‌شوند، نه به ترتیبِ این
          فایل. هر کدام یک ورودیِ نام‌دار است تا `orderBuiltins` بتواند
          جابه‌جاشان کند؛ اگر مثل قبل JSXِ درجا بودند، ترتیبِ فرم‌ساز هیچ
          اثری نداشت. `wide` یعنی تمامِ عرضِ ردیف را بگیرد. */}
      <div className="db-grid2 db-builtins">
        {fd.orderBuiltins(BUILTIN_ORDER).filter((key) => !(f.kind === 'surgery' && INTRA_KEYS.includes(key))).map((key) => {
          const node = builtinNodes[key];
          if (!node) return null;
          return (
            <div key={key} className={node.wide ? 'db-span2' : undefined}>
              {node.el}
            </div>
          );
        })}
      </div>

      {/* رکوردهای قدیمی متنِ آزاد دارند؛ تا وقتی به نوعِ عمل وصل نشده‌اند نمایش داده می‌شود. */}
      {!f.procedureTypeId && f.opType && (
        <label className="db-field"><span>نوعِ عمل (متنِ قدیمی)</span>
          <input type="text" value={f.opType} onChange={set('opType')} />
          <small className="db-hint">برای گزارش‌گیری، از فهرستِ بالا یکی را انتخاب کنید.</small>
        </label>
      )}

      {/* ⚠️ فیلدهای دلخواهِ سوپرادمین. عمداً **انتهای فرم** و زیرِ یک عنوان:
          این‌ها به‌ازای هر شرکت فرق می‌کنند و قاطی‌کردنشان با فیلدهای همیشگی
          یعنی کاربری که بین دو نصب جابه‌جا می‌شود، فرم را نمی‌شناسد. */}
      {fd.customFields.length > 0 && (
        <div className="db-extra">
          <h4>{fd.def?.title ?? 'اطلاعاتِ تکمیلی'}</h4>
          {fd.def?.hint && <p className="db-hint">{fd.def.hint}</p>}
          <DynForm assistance
            fields={fd.customFields}
            values={extra}
            errors={extraErr}
            onChange={setExtra}
            disabled={busy}
            myRole={myRole}
          />
        </div>
      )}
      </div>

      {/* ── برنامهٔ پیام‌ها — انتهای فرمِ ویزیت ──
          گزارشِ کاربر: «پایینِ فرم‌های ویزیت هم نمایش بده چه پیامکی چه وقت
          ارسال می‌شود». تا امروز فقط فرمِ عمل این را می‌گفت و کاربرِ فرمِ
          ویزیت نمی‌دانست ذخیره‌اش چه پیامی می‌فرستد — و «فرستاد یا نه؟»
          سؤالی بود که فقط با دیدنِ گوشیِ بیمار جواب می‌گرفت. */}
      {f.kind !== 'surgery' && (
        <div className="db-postop db-msgplan">
          <h4>برنامهٔ پیام‌ها</h4>
          {f.nextVisitDateJ.trim() ? (
            <p className="db-postop-plan">
              یادآوریِ ویزیتِ بعدی برای <b>{f.nextVisitDateJ}</b> در صف می‌نشیند
              {timing ? ` — ${faNum(timing.nextVisitDays)} روز قبل، ساعتِ ${faNum(timing.hour)}` : ''}.
              اگر برای همان روز نوبتِ فعال ثبت شود، یادآوریِ نوبت جای این یکی را می‌گیرد تا پیامِ دوتایی نرود.
            </p>
          ) : (
            <p className="db-postop-plan">
              تاریخِ ویزیتِ بعدی خالی است، پس پیامی زمان‌بندی نمی‌شود. برای یادآوریِ خودکار،
              «ویزیتِ بعدی» را در همین فرم پر کنید.
            </p>
          )}
        </div>
      )}

      {/* ── تصمیمِ درمانی — انتهای فرمِ ویزیت ──
          «بیمار آمد، معاینه شد، حالا چه؟» تا امروز جوابش جایی ثبت نمی‌شد و
          مرحلهٔ بعد در ذهنِ پزشک می‌ماند. این ردیف همان تصمیم را روی خودِ
          مراجعه می‌نشاند (چندتایی، چون یک ویزیت می‌تواند هم آزمایش بدهد هم
          مشاوره بخواهد) و مسیرِ بعدی را از همان‌جا باز می‌کند. */}
      {f.kind !== 'surgery' && (
        <div className="db-decide">
          <h4>تصمیمِ درمانیِ این ویزیت</h4>
          <p className="db-hint">
            چند مورد هم می‌تواند انتخاب شود. تصمیم روی همین مراجعه ثبت می‌شود تا
            در پرونده و گزارش‌ها دیده شود.
          </p>
          <div className="db-daychips">
            {DECISIONS.map((d) => (
              <button
                key={d.v} type="button"
                className={f.decisions.includes(d.v) ? 'db-daychip on' : 'db-daychip'}
                aria-pressed={f.decisions.includes(d.v)}
                onClick={() => {
                  toggleDecision(d.v);
                  /* ⚠️ فرمِ سفارش فقط وقتی باز می‌شود که تصمیم **تازه** زده
                     شده و مراجعه ذخیره‌شده است (سفارش به visitId نیاز دارد). */
                  if (ORDER_META[d.v] && !f.decisions.includes(d.v)) {
                    if (initial?.id) setOrderSheet({ kind: d.v });
                    else onToast('اول مراجعه را ذخیره کنید، بعد فرمِ درخواست باز می‌شود');
                  }
                }}
              >{d.l}</button>
            ))}
          </div>
          {DECISIONS.filter((d) => d.hint && f.decisions.includes(d.v)).map((d) => (
            <p key={d.v} className="db-decide-hint">{d.l}: {d.hint}</p>
          ))}
          {!initial?.id && f.decisions.some((d) => ORDER_META[d]) && (
            <p className="db-decide-hint">
              فرمِ درخواست بعد از ذخیرهٔ همین مراجعه باز می‌شود (هر سفارش زیرِ مراجعهٔ خودش می‌نشیند).
            </p>
          )}
          {ordersBlock}
        </div>
      )}

      {/* ── برنامهٔ مراقبت و پیگیری — در ادامهٔ خودِ فرمِ عمل ──
          جراح همان‌جا که شرح را می‌نویسد برنامهٔ بعد را هم می‌بندد. قاعدهٔ
          کلیدی: **پیش‌فرضِ نوعِ عمل همیشه دیده می‌شود** — خالی‌گذاشتن یعنی
          «همان پیش‌فرض اجرا شود»، و نوشتن یعنی «فقط برای همین بیمار این».
          اگر نوعِ عمل هنوز قالبی ندارد (روزهای اولِ راه‌اندازی)، به‌جای
          سکوت، صریح گفته می‌شود و راهِ ثبتِ دائمی‌اش نشان داده می‌شود. */}
      {f.kind === 'surgery' && (
        <div className="db-postop">
          <h4>برنامهٔ مراقبت و پیگیری</h4>
          {procDefaults.has ? (
            <p className="db-hint">
              پیش‌فرضِ «{procDefaults.name}» پایین نشان داده شده. هر کادر را خالی بگذارید
              تا همان پیش‌فرض برای این بیمار اجرا شود؛ اگر بنویسید، فقط در همین مراجعه جایگزین می‌شود.
            </p>
          ) : (
            <div className="db-nodefault">
              <b>برای {procDefaults.name ? `«${procDefaults.name}»` : 'این عمل'} هنوز مراقبت و زمان‌بندیِ پیگیری تعریف نشده.</b>
              <span>
                هرچه این‌جا بنویسید فقط برای همین بیمار اجرا می‌شود. برای اینکه دفعهٔ بعد
                خودکار بیاید، همان را در «تعریف‌های پایه ← نوعِ عمل» ثبت کنید.
              </span>
            </div>
          )}


          {/* ── سه مرحله، سه تب (بازخوردِ مالک: «قبل/حین/بعد از عمل به‌صورتِ تبِ جدا؛
              الان خیلی شلوغ است»). فقط تبِ فعال رندر می‌شود؛ مقدارها در `f` می‌مانند،
              پس جابه‌جایی چیزی را پاک نمی‌کند و «ذخیره» هر سه را با هم می‌فرستد.
              خطِ برنامه (پایین) بیرونِ تب‌هاست تا خلاصهٔ هر سه همیشه دیده شود. */}
          <Tabs
            variant="inset"
            className="db-phasetabs"
            label="مرحلهٔ عمل"
            value={phase}
            onChange={setPhase}
            items={[{ key: 'pre', label: 'قبل از عمل' }, { key: 'intra', label: 'حین عمل' }, { key: 'post', label: 'بعد از عمل' }]}
          />

          {phase === 'pre' && (
          <div className="db-phase" data-phase="pre">
          {/* ── مراقبتِ قبل از عمل ── */}
          <div className="db-careblock">
            <div className="db-carehead">
              <span>مراقبت‌های قبل از عمل — پیامک به بیمار</span>
              <i>{[
                f.preOpImmediate ? 'به‌محضِ ثبت' : null,
                timing ? `${faNum(timing.preOpDays)} روز قبل از عمل، ساعتِ ${faNum(timing.hour)}` : 'پیش از عمل',
              ].filter(Boolean).join(' + ')}</i>
            </div>
            {opIsToday && (
              <p className="db-decide-hint">
                عملْ همین امروز است — معمولاً دیگر پیامِ «قبل از عمل» لازم نیست؛ اگر لازم است، «به‌محضِ ثبت» را بزنید.
              </p>
            )}
            {procDefaults.preOpCare && (
              <div className="db-default">
                <p>{procDefaults.preOpCare}</p>
                <button type="button" onClick={() => setF((s2) => ({ ...s2, preOpCare: procDefaults.preOpCare }))}>
                  استفاده و ویرایش
                </button>
              </div>
            )}
            <AssistedTextarea disabled={busy || !!aiBusy} rows={2} value={f.preOpCare} onChange={set('preOpCare')}
                      placeholder={procDefaults.preOpCare ? 'خالی = همان پیش‌فرضِ بالا' : 'خالی = پیامی نمی‌رود'} />
            {/* ⚠️ این‌جا «به‌محضِ ثبت» **جایگزینِ** موعدِ مقرر نیست، اضافه بر
                آن است — برعکسِ مراقبتِ بعد از عمل. */}
            <div className="db-daychips db-whenchips">
              {[{ v: false, l: 'فقط طبقِ زمان‌بندی' }, { v: true, l: 'به‌محضِ ثبت + زمان‌بندی' }].map((o) => (
                <button
                  key={String(o.v)} type="button"
                  className={!!f.preOpImmediate === o.v ? 'db-daychip on' : 'db-daychip'}
                  aria-pressed={!!f.preOpImmediate === o.v}
                  onClick={() => { preTouched.current = true; setF((s2) => ({ ...s2, preOpImmediate: o.v })); }}
                >{o.l}</button>
              ))}
            </div>
          </div>

          <div className="db-careblock">
            <div className="db-carehead">
              <span>درخواست‌های پیش از عمل — آزمایش، تصویربرداری، مشاوره</span>
              {!initial?.id && <i>بعد از ذخیره</i>}
            </div>
            {initial?.id
              ? ordersBlock
              : <p className="db-decide-hint">بعد از ذخیرهٔ همین مراجعه، از همین‌جا درخواست ثبت و برای بیمار فرستاده می‌شود.</p>}
          </div>
          </div>
          )}

          {phase === 'intra' && (
          <div className="db-phase" data-phase="intra">
            {INTRA_KEYS.some((k) => builtinNodes[k]) ? (
              <div className="db-grid2 db-builtins">
                {INTRA_KEYS.map((key) => {
                  const node = builtinNodes[key];
                  if (!node) return null;
                  return <div key={key} className={node.wide ? 'db-span2' : undefined}>{node.el}</div>;
                })}
              </div>
            ) : (
              <p className="db-decide-hint">فیلدهای حینِ عمل (ساعتِ شروع/پایان، شرحِ عمل) در فرم‌ساز برای این فرم خاموش‌اند.</p>
            )}
          </div>
          )}

          {phase === 'post' && (
          <div className="db-phase" data-phase="post">
          {/* ── مراقبتِ بعد از عمل ── */}
          <div className="db-careblock">
            <div className="db-carehead">
              <span>مراقبت‌های بعد از عمل — پیامک به بیمار</span>
              <i>{f.postOpImmediate
                ? 'ارسال: بلافاصله بعد از ثبتِ فرم'
                : timing ? `ارسال: ${faNum(timing.postOpDays)} روز بعد از عمل، ساعتِ ${faNum(timing.hour)}` : 'ارسال: بعد از عمل'}</i>
            </div>
            {procDefaults.postOpCare && (
              <div className="db-default">
                <p>{procDefaults.postOpCare}</p>
                <button type="button" onClick={() => setF((s2) => ({ ...s2, postOpCare: procDefaults.postOpCare }))}>
                  استفاده و ویرایش
                </button>
              </div>
            )}
            <AssistedTextarea disabled={busy || !!aiBusy} rows={3} value={f.postOpCare} onChange={set('postOpCare')}
                      placeholder={procDefaults.postOpCare ? 'خالی = همان پیش‌فرضِ بالا' : 'خالی = پیامی نمی‌رود'} />
            {editing && aiOn && (
              <div className="db-aibar">
                {editing && aiOn && (
                  <button type="button" className="db-aibtn" disabled={busy || !!aiBusy} onClick={aiCare}>
                    {aiBusy === 'care' ? 'دستیار در حالِ نوشتن…' : 'پیش‌نویسِ مراقبت با دستیار (از پرونده)'}
                  </button>
                )}
              </div>
            )}
            <div className="db-daychips db-whenchips">
              {[{ v: false, l: 'فردایِ عمل' }, { v: true, l: 'بلافاصله بعد از ثبت' }].map((o) => (
                <button
                  key={String(o.v)} type="button"
                  className={f.postOpImmediate === o.v ? 'db-daychip on' : 'db-daychip'}
                  aria-pressed={f.postOpImmediate === o.v}
                  onClick={() => setF((s2) => ({ ...s2, postOpImmediate: o.v }))}
                >{o.l}</button>
              ))}
            </div>
          </div>

          {/* ── روزهای فرمِ پیگیری ── */}
          <div className="db-careblock">
            {timing && timing.followUpFormReady === false && (
              <div className="db-nodefault">
                <b>فرمِ پیگیری هنوز در فرم‌ساز ساخته نشده.</b>
                <span>
                  موجِ پیگیری «لینکِ فرم» است؛ تا در فرم‌ساز یک فرم با نقشِ «پیگیریِ
                  عمومی» نسازید، روزهای انتخابیِ پایین ارسال نمی‌شوند.
                </span>
              </div>
            )}
            <div className="db-carehead">
              <span>فرمِ پیگیری چند روز بعد از عمل برود؟</span>
              <i>{procDefaults.followUpDays
                ? `پیش‌فرضِ نوعِ عمل: ${procDefaults.followUpDays.split(/[^0-9۰-۹]+/).filter(Boolean).map((d) => faNum(d)).join('، ')}`
                : 'برای این عمل پیش‌فرضی تعریف نشده'}</i>
            </div>
            <div className="db-daychips">
              {/* چیپ‌ها = پیش‌فرض‌ها + روزهای نوعِ عمل + هر عددی که تایپ شده. */}
              {[...new Set([0, 7, 30, 90, ...parseFollowDays(procDefaults.followUpDays), ...followList])]
                .sort((a, b) => a - b).map((d) => (
                <button
                  key={d} type="button"
                  className={followList.includes(d) ? 'db-daychip on' : 'db-daychip'}
                  aria-pressed={followList.includes(d)}
                  onClick={() => toggleFollowDay(d)}
                >{d === 0 ? 'بلافاصله' : `روزِ ${Number(d).toLocaleString('fa-IR')}`}</button>
              ))}
              <input
                dir="ltr" inputMode="numeric" className="db-dayinput"
                value={f.followUpDays} onChange={set('followUpDays')}
                placeholder="مثلاً ۰,۷,۳۰" aria-label="روزهای پیگیری (دلخواه)"
              />
            </div>
          </div>

          {/* ── اولین مراجعهٔ بعد از عمل ── */}
          <div className="db-careblock">
            <div className="db-carehead">
              <span>اولین مراجعهٔ بعد از عمل (ویزیتِ پست‌آپ)</span>
              <i>{timing ? `یادآوری: ${faNum(timing.nextVisitDays)} روز قبل از همان تاریخ` : 'یادآوری پیش از موعد'}</i>
            </div>
            <JDate
              value={f.nextVisitDateJ}
              onChange={(v) => setF((s2) => ({ ...s2, nextVisitDateJ: v }))}
              placeholder="۱۴۰۵/۰۵/۱۰"
            />
          </div>

          </div>
          )}

          <p className="db-postop-plan">
            {timing && timing.followUpFormReady === false
              ? 'پیگیری: ارسال نمی‌شود (فرمِ پیگیری تعریف نشده)'
              : followList.length
                ? `پیگیری: ${followList.map((d) => (d === 0 ? 'بلافاصله' : `روزِ ${Number(d).toLocaleString('fa-IR')}`)).join('، ')} (اختصاصیِ همین بیمار)`
                : procDefaults.followUpDays ? 'پیگیری: طبقِ روزهای نوعِ عمل' : 'پیگیری: فرمی ارسال نمی‌شود'}
            {' · '}
            {`مراقبتِ بعد: ${f.postOpCare.trim() ? 'متنِ همین فرم' : procDefaults.postOpCare ? 'قالبِ نوعِ عمل' : 'ارسال نمی‌شود'}`}
            {' · '}
            {`مراقبتِ قبل: ${f.preOpCare.trim() ? 'متنِ همین فرم' : procDefaults.preOpCare ? 'قالبِ نوعِ عمل' : 'ارسال نمی‌شود'}`}
            {(f.preOpCare.trim() || procDefaults.preOpCare) ? (f.preOpImmediate ? '، به‌محضِ ثبت + موعدِ مقرر' : '، موعدِ مقرر') : ''}
          </p>
        </div>
      )}


      {/* میزبان همیشه سوار است و خودش presence را می‌گرداند (OrderSheet.jsx). */}
      <OrderSheet
        open={!!orderSheet}
        kind={orderSheet?.kind}
        order={orderSheet?.order}
        patientId={initial?.patientId}
        visitId={initial?.id}
        onClose={() => setOrderSheet(null)}
        onSaved={loadOrders}
        onToast={onToast}
      />

      <button className="db-submit" type="submit" disabled={busy || !!aiBusy}>
        {busy ? 'در حال ذخیره…' : editing ? 'ذخیرهٔ تغییرات' : t.visitOne}
      </button>
      </>)}

      {/* ── ناوبریِ گام ── */}
      {!editing && step < 3 && (
        <>
          {/* ⚠️ دلیلِ نرفتن **کنارِ خودِ دکمه** نوشته می‌شود، نه در toast:
              toast می‌رود و کاربر با یک دکمهٔ بی‌جواب می‌ماند. */}
          {stepErr && <p className="db-steperr" role="alert">{stepErr}</p>}
          <div className="db-stepnav">
            {step > 1 && (
              <button type="button" className="db-stepback" onClick={() => { setStepErr(''); setStep(step - 1); }}>
                بازگشت
              </button>
            )}
            <button type="button" className="db-submit" onClick={goNext}>بعدی</button>
          </div>
        </>
      )}
    </Overlay>
  );
}

const NOTE_FA = { visit: 'شرحِ ویزیت', op: 'شرحِ عمل', followup: 'پیگیری', consult: 'مشاوره' };
const ORDER_STATUS_FA = { sent: 'منتظرِ پاسخ', answered: 'پاسخ آمده' };

/**
 * **کارتِ آماده‌سازیِ ویزیت** (W3.2، §۴.۴ سند) — آنچه باید *پیش از* دیدنِ بیمار دانست.
 *
 * تا امروز این چند تکه در چند صفحه پخش بود: حساسیت و داروی بیمار در پرونده،
 * شرحِ ویزیتِ قبلی در تبِ دیگر، نتیجهٔ در انتظار در بخشِ سفارش‌ها، و ماندهٔ مالی
 * در صورت‌حساب. کسی که وقت ندارد هیچ‌کدام را باز نمی‌کند — و «حساسیت به
 * پنی‌سیلین» چیزی است که نباید دیده نشود.
 *
 * ⚠️ **هشدارِ بالینی باز است، بقیه بسته.** اگر همه‌چیز باز باشد، فرم زیرِ یک
 * دیوارِ متن دفن می‌شود؛ اگر همه بسته باشد، حساسیت دیده نمی‌شود.
 * ⚠️ هیچ عددی این‌جا حساب نمی‌شود: مانده، سن و کوتاه‌شدنِ متن از سرور می‌آیند.
 */
function PrepCard({ prep: raw }) {
  /* ⚠️ سرورِ واقعی همیشه هر پنج بخش را می‌فرستد، ولی پاسخِ ناقص (fixtureِ
     آزمون، یا لحظه‌ای که endpoint چیزی ندارد) نباید کلِ فرمِ مراجعه را
     بیندازد — `orders-ai-ui` همین را گرفت: «Cannot read properties of
     undefined (reading 'allergies')» و صفحهٔ سفید. یک‌بار این‌جا نرمال می‌شود
     تا هر خواندنِ `prep.*` پایین‌تر بی‌خطر بماند. */
  const prep = { patient: {}, notes: [], pendingResults: [], prevVisits: [], billing: {}, ...(raw ?? {}) };
  const p = prep.patient ?? {};
  const risky = [
    p.allergies && { k: 'allergies', l: 'حساسیت', v: p.allergies },
    p.chronicConditions && { k: 'chronic', l: 'بیماریِ زمینه‌ای', v: p.chronicConditions },
    p.medications && { k: 'meds', l: 'داروها', v: p.medications },
  ].filter(Boolean);
  const answered = prep.pendingResults.filter((o) => o.status === 'answered').length;
  const due = prep.billing?.due;

  return (
    <section className="db-prep" aria-label="آماده‌سازیِ ویزیت">
      <div className="db-prep-id">
        <b>{p.fullName}</b>
        <span dir="ltr">{p.code}</span>
        {p.age != null && <span>{faNum(p.age)} ساله</span>}
        {p.bloodType && <span className="db-prep-blood">{p.bloodType}</span>}
        {p.insurer && <span>{p.insurer}</span>}
      </div>

      {risky.length > 0 && (
        <ul className="db-prep-risk">
          {risky.map((r) => <li key={r.k}><b>{r.l}:</b> {r.v}</li>)}
        </ul>
      )}

      <div className="db-prep-rows">
        {answered > 0 && (
          <span className="db-prep-hot">{faNum(answered)} نتیجهٔ پاسخ‌آمده منتظرِ بررسی</span>
        )}
        {due > 0 && <span className="db-prep-hot">ماندهٔ مالی: {faNum(due)}</span>}
      </div>

      {(prep.notes.length > 0 || prep.pendingResults.length > 0 || prep.prevVisits.length > 0) && (
        <details className="db-prep-more">
          <summary>سابقهٔ کوتاه</summary>
          {prep.notes.length > 0 && (
            <ul className="db-prep-notes">
              {prep.notes.map((n) => (
                <li key={n.id}>
                  <b>{NOTE_FA[n.kind] ?? n.kind}</b>
                  <i>{n.authorName || ''}</i>
                  <p>{n.excerpt}</p>
                </li>
              ))}
            </ul>
          )}
          {prep.pendingResults.length > 0 && (
            <ul className="db-prep-orders">
              {prep.pendingResults.map((o) => (
                <li key={`${o.kind}-${o.id}`}>
                  <b>{o.kindFa}</b>
                  <i className={o.status}>{ORDER_STATUS_FA[o.status] ?? o.status}</i>
                </li>
              ))}
            </ul>
          )}
          {prep.prevVisits.length > 0 && (
            <ul className="db-prep-visits">
              {prep.prevVisits.map((v) => (
                <li key={v.id}><b>{kindOf(v.kind).label}</b><span dir="ltr">{v.code}</span></li>
              ))}
            </ul>
          )}
        </details>
      )}
    </section>
  );
}
