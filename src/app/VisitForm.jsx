import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import AssistedTextarea from '../ui/AssistedTextarea.jsx';
import { AiContext } from '../ui/ai-context.js';
import CareEditor from './CareEditor.jsx';
import { useAuth } from './auth.jsx';
import { api, apiBlobUrl, apiStream, apiUpload } from '../lib/api.js';
import { faDate, isoToJStr, jStrToIso, jToFa } from '../lib/jalali.js';
import { isValidNationalId, randomNationalId, toEnDigits } from '../lib/identity.js';
import { badTime, durationMin, normTime, faDuration } from '../lib/time.js';
import { useConfig, useStatusList, useStatusMap } from './config.jsx';
import VitalSigns from './VitalSigns.jsx';
import { useFormDef, star } from './useFormDef.jsx';
import DynForm, { dynErrors } from '../ui/DynForm.jsx';
import VoiceInput from '../ui/VoiceInput.jsx';
import OrderSheet, { ORDER_META } from './OrderSheet.jsx';
import JDate from './JDate.jsx';
import { Close, Copy, Pencil, Plus } from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import TimePick from '../ui/TimePick.jsx';
import Pick from '../ui/Pick.jsx';
import MoneyInput from '../ui/MoneyInput.jsx';
import CodingChips, { PrimaryBadge } from './CodingChips.jsx';
import { OpDefaultChips, OpDefaultSave, withTemplate } from './OpDefaults.jsx';
import { KINDS, kindOf } from './visit-kinds.js';
import VisitDocs from './VisitDocs.jsx';
import { AttachPicker, DecisionSelect, GrowthTrend, PhaseAttach, SubformCard, VisitHeadBar, attachableOn, useSubformCatalog } from './VisitSubforms.jsx';
import { togglePin, usePrefs } from './usePrefs.jsx';
import { useAllowedTools } from './tools.jsx';
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
/**
 * راهنمای رفتاریِ هر تصمیم — **نه برچسبش**. برچسب از `/config.statuses.decision`
 * می‌آید (`labels.ts`)؛ تا بستهٔ ۶ همین آرایه برچسب هم داشت و یک فیلدِ دلخواهِ
 * `plan` در قالبِ مطب واژگانِ دیگری برای همان تصمیم داشت.
 */
/* ⚠️ از راهنماهای تصمیم فقط آن که **رفتار** را عوض می‌کند می‌ماند (طرحِ مصوبِ ۱۴۰۵/۰۷/۰۳:
   «راهنماهای بلند برداشته شوند»): بقیه توضیحِ همان برچسب بودند و فقط جا می‌گرفتند. */
const DECISION_HINTS = {
  surgery: 'بعد از ذخیره، فرمِ عملِ همین بیمار باز می‌شود',
};

/**
 * **ادامهٔ «کاندیدای جراحی»** — فرمِ عملی که بعد از ذخیرهٔ ویزیتِ تصمیم باز می‌شود.
 *
 * ⚠️ یک سازنده برای هر چهار جا (داشبورد، پرونده، پاپ‌آپ‌ها، میزِ پذیرش): تا بازبینیِ
 * ۱۴۰۵/۰۷/۰۳ هرکدام نسخهٔ خودش را داشت، `patientName` از فیلدی خوانده می‌شد که پاسخِ سرور
 * ندارد (`fullName` است) و پزشکِ ویزیت هم به فرمِ عمل نمی‌رسید.
 */
export function surgeryPrefill(saved, patientName) {
  return {
    patientId: saved.patientId, patientName: patientName ?? saved.fullName ?? '', kind: 'surgery',
    surgeonId: saved.surgeonId ?? null,
    decidedInVisitId: saved.id, chiefComplaint: saved.chiefComplaint, decidedInDate: saved.opDate,
  };
}

/** کلیدهای فرم‌سازِ قالبِ قدیمیِ مطب که حالا جای دیگری دارند و در فهرستِ فیلدها تکرار نمی‌شوند. */
const INLINE_KEYS = { duration: 'historyDuration', legacyPlan: 'plan' };

/** بخش‌های متنیِ هستهٔ ثابت (بستهٔ ۶الف) — هر کدام سندِ نسخه‌دارِ خودش در سرور. */
const SECTION_KEYS = ['history', 'findings', 'exam', 'planNote', 'prescription'];

/**
 * **مالکِ کلیدهای «سایرین»** (بستهٔ ۷) — فهرستِ سایرِ تشخیص‌ها/عمل‌ها فیلدِ
 * فرم‌ساز نیست و نقشِ مالکش همان نقشِ فیلدِ اصلی است.
 *
 * ⚠️ آینهٔ وارونهٔ `CODING_TWIN` در `server/src/patients/visit-coding.ts`؛ نگهبانِ
 * CI (C8) هم‌خوانیِ این دو را می‌سنجد. بدونِ این نگاشت، منشی‌ای که مالکِ تشخیص
 * نیست `diagnosisId` را حذف می‌کرد ولی `otherDiagnosisIds` را می‌فرستاد و سرور
 * کلِ ذخیره را ۴۰۰ می‌داد.
 */
const CODING_TWIN_OWNER = { otherDiagnosisIds: 'diagnosisId', otherProcedureTypeIds: 'procedureTypeId' };

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
/** برچسبِ سه مرحله — همان واژه‌های تبِ مرحله، تا بج و تب دو حرفِ متفاوت نزنند. */
const PHASE_FA = { pre: 'قبل از عمل', intra: 'حین عمل', post: 'بعد از عمل' };
/* سه مرحلهٔ فرمِ عمل — تب‌ها و «الصاق به»ِ پنجرهٔ الصاق از همین یک فهرست. */
const PHASE_ITEMS = Object.entries(PHASE_FA).map(([key, label]) => ({ key, label }));
/* پاسخِ یک زیرفرم چیزی دارد؟ — `false`ِ به‌جامانده از یک کلید پاسخ نیست (همان معنای «خالی»ِ سرور). */
const hasAnswer = (data) => Object.values(data ?? {}).some((v) => v !== false && v != null
  && String(Array.isArray(v) ? v.join('') : typeof v === 'object' ? (v.id ?? v.url ?? '') : v).trim() !== '');
/* دسته‌های مدرکی که واقعاً به یک عمل گره می‌خورند. «مدرکِ شناسایی» و «فیش» عمداً
   نیستند: آن‌ها مالِ کلِ پرونده‌اند، نه مرحلهٔ یک عمل — و از تبِ مدارکِ پرونده
   بارگذاری می‌شوند. فهرست زیرمجموعهٔ `DOCUMENT_CATEGORIES`ِ سرور است. */
const VISIT_DOC_CATEGORIES = {
  imaging: 'تصویربرداری', lab: 'آزمایش', report: 'گزارش', consent: 'رضایت‌نامه', prescription: 'دستورِ پزشک', other: 'متفرقه',
};
/* شکلِ آرایه‌ایِ همان برای `VisitDocs` — ثابتِ ماژول، تا باکس در هر رندر فهرست را از نو نخواند. */
const PHASE_DOC_CATS = Object.entries(VISIT_DOC_CATEGORIES).map(([key, label]) => ({ key, label }));

export default function VisitForm({ initial, prefill, defs, onDefsChanged, onClose, onSaved, onToast }) {
  const { t, defaultKind = 'surgery', kind: tenantKind, services: offered = [], serviceCatalog = [] } = useConfig();
  /* خدمتِ مراجعه (`Visit.service`) فقط در شرکتِ **دوخدمته** پرسیده می‌شود؛ تک‌خدمته را سرور خودش پر می‌کند. */
  const pickService = tenantKind === 'company' && offered.length > 1;
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
  /* ⚠️ `defaultKind` از `/config` می‌آید و ممکن است **بعد از** mountِ فرم برسد؛
     چون مقدارِ اولیه یک‌بار در `useState` گرفته می‌شود، مطبِ کندشبکه فرمِ «عمل»
     می‌گرفت بی‌آنکه چیزی بگوید. تا وقتی مراجعهٔ موجود/prefill نباشد و کاربر خودش
     نوعی نزده باشد، پیش‌فرض با حوزه هم‌گام می‌شود. */
  const kindTouched = useRef(false);

  const [f, setF] = useState(() => ({
    /* پیش‌فرضِ نوع از حوزه (`/config.defaultKind`): مطب ویزیت، بقیه عمل (بستهٔ ۵ب). */
    kind: initial?.kind || prefill?.kind || defaultKind,
    service: initial?.service ?? '',
    firstName: initial?.firstName || '',
    lastName: initial?.lastName || '',
    phone: initial?.phone || '',
    nationalId: initial?.nationalId || '',
    birthDateJ: initial?.birthDate ? isoToJStr(initial.birthDate) : '',
    /* پیوستگی (۱۴۰۵/۰۷/۰۳): فرمِ عملِ «کاندیدای جراحی» پزشکِ همان ویزیت را می‌گیرد. */
    surgeonId: initial?.surgeonId ?? prefill?.surgeonId ?? null,
    hospitalId: initial?.hospitalId ?? prefill?.hospitalId ?? null,
    techId: initial?.techId ?? null,
    /* ⚠️ فهرستِ **کامل** به ترتیبِ رتبه (بستهٔ ۷): `[0]` اصلی است (همان ستونِ
       `procedureTypeId`/`diagnosisId`)، بقیه «سایرین». یک آرایه و نه دو فیلد تا
       «اصلی کن» یک setState باشد و اصلی و سایرین هرگز از هم عقب نیفتند.
       رکوردِ خراب (سایرین بدونِ اصلی) هم این‌جا خودبه‌خود اولی را اصلی می‌بیند —
       همان ترمیمی که سرور در ذخیرهٔ بعدی انجام می‌دهد. */
    procedureTypeIds: [initial?.procedureTypeId, ...(initial?.otherProcedureTypeIds ?? [])].filter((x) => x != null),
    diagnosisIds: [initial?.diagnosisId, ...(initial?.otherDiagnosisIds ?? [])].filter((x) => x != null),
    topicId: initial?.topicId ?? null,
    // متنِ آزاد فقط برای رکوردهای قدیمی که هنوز به نوعِ عمل وصل نشده‌اند.
    opType: initial?.procedureTypeId ? '' : initial?.opType || '',
    /* ⚠️ `chiefComplaintOwn` و نه `chiefComplaint`: دومی مقدارِ **مشتق** است
       (ممکن است از ویزیتِ تصمیم آمده باشد) و اگر در فرم می‌نشست، اولین
       «ذخیره» ارث را به کپی تبدیل می‌کرد. سرور هم همین را دوباره می‌سنجد. */
    chiefComplaint: initial?.chiefComplaintOwn ?? '',
    opReport: initial?.opReport || '',
    /* بخش‌های هسته — از نمای **کاملِ** مراجعه (`GET /visits/:id`). */
    history: initial?.history || '',
    findings: initial?.findings || '',
    exam: initial?.exam || '',
    planNote: initial?.planNote || '',
    prescription: initial?.prescription || '',
    anesthesia: initial?.anesthesia || '',
    /* پیش‌نویسِ علائمِ حیاتیِ لحظهٔ ثبت — فقط در ساخت، یکی به‌ازای هر کارتِ الصاق‌شده
       (کلید: مرحلهٔ عمل یا «visit»)؛ بعد از ذخیره هر نوبت جدا ثبت می‌شود. */
    vitals: {},
    amount: '', // مبلغِ توافقی — فقط هنگامِ ساخت
    /* `prefill.opDateJ` — تاریخِ پیش‌فرضِ ثبتِ تازه، به همان شکلِ کادر (شمسی).
       دکمهٔ «+» صفحهٔ «امروز» امروز را می‌دهد (همان `todayJStr` که دکمهٔ «امروز»ِ
       خودِ کادر می‌زند)؛ کاربر عوضش می‌کند اگر مراجعه برای روزِ دیگری است. */
    opDateJ: initial?.opDate ? isoToJStr(initial.opDate) : (initial?.id ? '' : prefill?.opDateJ || ''),
    /* «هنوز تاریخ ندارد» (بستهٔ ۹): عملِ در انتظارِ بی‌تاریخ همان حالت را نشان می‌دهد نه کادرِ ستاره‌دارِ خالی. */
    undated: initial?.id
      ? (initial.undated ?? (initial.kind === 'surgery' && !initial.opDate && initial.opStatus === 'pending'))
      : !!prefill?.undated,
    plannedDateJ: initial?.plannedDate ? isoToJStr(initial.plannedDate) : '',
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

  /* هم‌گامیِ پیش‌فرضِ نوع با حوزه، فقط وقتی هنوز «پیش‌فرض» است (نه ویرایش، نه
     prefill، نه انتخابِ کاربر) — وگرنه انتخابِ کسی را زیرِ دستش عوض می‌کند. */
  useEffect(() => {
    if (initial?.id || initial?.kind || prefill?.kind || kindTouched.current) return;
    setF((s) => (s.kind === defaultKind ? s : { ...s, kind: defaultKind }));
  }, [defaultKind, initial?.id, initial?.kind, prefill?.kind]);
  /* **«سایرین» خوانده شده‌اند یا نه؟** (بستهٔ ۷) — `undefined` در `initial` یعنی
     «نخوانده» نه «خالی» (همان قاعدهٔ بخش‌های هسته، `sectionOut`). فرمی که سایرین
     را ندیده و کاربر هم دستشان نزده، کلیدِ همزاد را **نمی‌فرستد** تا ذخیره‌اش
     فهرستِ ندیده را پاک نکند؛ کلیدِ اصلی به‌تنهایی در سرور سایرین را نگه می‌دارد. */
  const dxLoaded = !editing || Array.isArray(initial?.otherDiagnosisIds);
  const pxLoaded = !editing || Array.isArray(initial?.otherProcedureTypeIds);
  const dxTouched = useRef(false);
  const pxTouched = useRef(false);
  /* تغییرِ فهرستِ تشخیص/عمل — تنها مسیرِ نوشتنِ این دو آرایه، تا «دست‌خورده»
     هیچ‌جا جا نیفتد. عمل‌ها متنِ آزادِ قدیمی (`opType`) را هم پاک می‌کنند؛ همان
     رفتارِ پیش از بستهٔ ۷ برای انتخابِ نوعِ عمل. */
  const nextIds = (next, cur) => (typeof next === 'function' ? next(cur) : next);
  const setDiagnosisIds = (next) => {
    dxTouched.current = true;
    setF((s) => ({ ...s, diagnosisIds: nextIds(next, s.diagnosisIds) }));
  };
  const setProcedureTypeIds = (next) => {
    pxTouched.current = true;
    setF((s) => ({ ...s, procedureTypeIds: nextIds(next, s.procedureTypeIds), opType: '' }));
  };
  /* انتخابِ **اصلی** در DefSelect: پاک‌کردن یعنی «بعدی اصلی شود» (سایرین از
     دست نمی‌روند)، و انتخابِ تازه جای اصلیِ قبلی را می‌گیرد — اگر همین مورد از
     سایرین بود، از آن‌جا برمی‌خیزد تا تکراری نشود.
     ⚠️ به‌شکلِ تابعِ به‌روزرسانی: افزودنِ سریعِ DefSelect بعد از یک درخواستِ
     شبکه `onChange` را صدا می‌زند و فهرستِ لحظهٔ کلیک تا آن موقع کهنه است. */
  const pickPrimary = (v) => (ids) => (v == null ? ids.slice(1) : [v, ...ids.slice(1).filter((x) => x !== v)]);
  /* ⚠️ عوض‌کردنِ **فقط اصلی** «دست‌خورده» حساب نمی‌شود: اگر سایرین خوانده نشده
     باشند، فهرستِ این‌جا فقط اصلی را دارد و فرستادنِ همزادِ `[]` سایرینِ ندیده
     را پاک می‌کرد. کلیدِ اصلی به‌تنهایی در سرور همان کار را می‌کند (X اصلی
     می‌شود، سایرین منهای X می‌مانند؛ `null` اولیِ سایرین را بالا می‌آورد). */
  const setPrimaryDiagnosis = (v) => setF((s) => ({ ...s, diagnosisIds: pickPrimary(v)(s.diagnosisIds) }));
  const setPrimaryProcedure = (v) => setF((s) => ({ ...s, procedureTypeIds: pickPrimary(v)(s.procedureTypeIds), opType: '' }));
  const [busy, setBusy] = useState(false);
  /* دستیارِ AI روی خودِ فرمِ عمل — دکمه‌های شرح فقط در ویرایش (پرونده و مراجعه معلوم‌اند)؛
     پیش‌نویسِ مراقبت و دیکتهٔ صوتی در ساخت هم هست (بافتار از خودِ فرم می‌آید). */
  const [aiOn, setAiOn] = useState(false);
  const [sttOn, setSttOn] = useState(false); // دستیارِ صوتی — با مدلِ گفتار-به-متن
  const [aiBusy, setAiBusy] = useState(false); // false | 'structure' | 'continue' | 'care-pre' | 'care-post' | 'dictate'
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
        { patientId: initial.patientId, visitId: initial.id, kind: 'op', mode, text: raw, ...aiCoding },
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

  /* بافتارِ دستیار از **خودِ فرم** — نوعِ عمل و تشخیصِ انتخاب‌شده، حتی پیش از ذخیره (بازخوردِ مالک
     ۱۴۰۵/۰۷/۰۳: «AI باید نسبت به نوعِ عمل و تشخیص بنویسد»). هر کادرِ `AssistedTextarea`ِ داخلِ فرم
     همین را از `AiContext` می‌گیرد. */
  const aiCoding = useMemo(
    () => ({ procedureTypeIds: f.procedureTypeIds, diagnosisIds: f.diagnosisIds }),
    [f.procedureTypeIds, f.diagnosisIds],
  );
  /* متنِ پیش از آخرین پیش‌نویسِ دستیار، به‌ازای مرحله — «برگرداندنِ متنِ قبلی» در پاپ‌آپ. */
  const [careUndo, setCareUndo] = useState({});
  /**
   * پیش‌نویسِ مراقبتِ **قبل یا بعد از عمل** — از نوعِ عمل و تشخیصِ همین فرم (ثبت‌نشده هم)، قالبِ
   * همان مرحلهٔ عملِ اصلی، شرحِ عمل و متنی که تا این‌جا نوشته شده. تا دیروز فقط «بعد از عمل» و
   * فقط در ویرایش بود.
   */
  const aiCare = async (ph) => {
    const field = ph === 'pre' ? 'preOpCare' : 'postOpCare';
    const before = f[field];
    setAiBusy(`care-${ph}`);
    try {
      const r = await api('/ai/care-draft', {
        method: 'POST',
        body: {
          phase: ph, ...aiCoding, text: before,
          ...(initial?.id ? { visitId: initial.id } : {}),
          ...(ph === 'post' && f.opReport.trim() ? { opReport: f.opReport } : {}),
        },
      });
      if (typeof r?.text !== 'string' || !r.text.trim()) throw new Error('پاسخِ دستیار خالی بود؛ متنِ شما سرِ جایش است');
      aiDraftsRef.current[ph === 'pre' ? 'carePre' : 'care'] = r.text;
      setCareUndo((u) => ({ ...u, [ph]: before }));
      setF((s2) => ({ ...s2, [field]: r.text }));
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
  /* اصلاحِ مالک ۱۴۰۵/۰۷/۰۲: مشخصاتِ بیمار در ویرایش پیش‌فرض بسته است؛ خلاصهٔ کوچکِ بالا کافی است. */
  const [idOpen, setIdOpen] = useState(false);
  /* شرحِ عمل در فرم فقط پیش‌نما دارد؛ نوشتن در پاپ‌آپِ بزرگ (اصلاحِ مالک ۱۴۰۵/۰۷/۰۲). */
  const [reportOpen, setReportOpen] = useState(false);
  /* متنِ پیش‌فرضی که بازکردنِ پاپ‌آپ در شرح گذاشت (اگر گذاشت) — برای «نوشتهٔ کاربر» حساب نشود. */
  const [reportPrefill, setReportPrefill] = useState(null);
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

  /* ⚠️ پیش‌نمایشِ مراقبت **فقط از عملِ اصلی** — همان قاعدهٔ سرور (پیامکِ مراقبت
     و روزهای پیگیری از `procedureTypeId`). اگر این‌جا اجتماعِ همهٔ عمل‌ها نشان
     داده می‌شد، فرم چیزی را وعده می‌داد که یادآوری‌ها نمی‌فرستند. */
  const procRow = defs.procedures.find((p) => p.id === f.procedureTypeIds[0]) ?? null;
  const procDefaults = {
    name: procRow?.name ?? (f.opType || ''),
    preOpCare: procRow?.preOpCare ?? '',
    postOpCare: procRow?.postOpCare ?? '',
    followUpDays: procRow?.followUpDays ?? '',
    has: !!(procRow?.preOpCare || procRow?.postOpCare || procRow?.followUpDays),
  };
  /* قالبِ «عمل‌های همزمان» — خودکار نمی‌رود؛ فقط صریح گفته می‌شود و با یک ضربه
     به متنِ اختصاصیِ همین مراجعه افزوده می‌شود (`.db-careother`). */
  const otherCare = f.procedureTypeIds.slice(1)
    .map((id) => defs.procedures.find((p) => p.id === id))
    .filter((p) => p && (p.preOpCare || p.postOpCare || p.followUpDays));
  /**
   * افزودنِ متنِ مراقبتِ یک عملِ همزمان به متنِ اختصاصی.
   *
   * ⚠️ متنِ اختصاصیِ خالی یعنی «قالبِ عملِ اصلی می‌رود». اگر متنِ دوم روی کادرِ
   * خالی نوشته می‌شد، همان لحظه **جای** قالبِ اصلی را می‌گرفت و مراقبتِ عملِ
   * اصلی بی‌صدا از پیامک حذف می‌شد. پس کادرِ خالی اول قالبِ اصلی را می‌گیرد و
   * بعد متنِ دوم زیرش می‌آید. متنی که از قبل آن‌جاست دوباره افزوده نمی‌شود.
   */
  const appendCare = (p) => setF((s2) => {
    const join = (own, base, extra) => {
      const add = (extra ?? '').trim();
      if (!add) return own;
      const cur = own.trim() || (base ?? '').trim();
      if (cur.includes(add)) return own;
      return cur ? `${cur}\n\n${add}` : add;
    };
    return {
      ...s2,
      preOpCare: join(s2.preOpCare, procDefaults.preOpCare, p.preOpCare),
      postOpCare: join(s2.postOpCare, procDefaults.postOpCare, p.postOpCare),
    };
  });
  const toggleFollowDay = (d) => setF((s2) => {
    const cur = parseFollowDays(s2.followUpDays);
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b);
    return { ...s2, followUpDays: next.join(',') };
  });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  /* تصمیمِ درمانی — چندتایی است چون یک ویزیت می‌تواند هم آزمایش بدهد هم
     مشاوره بخواهد. «کاندیدای جراحی» موضوعِ همین ویزیت را هم پره‌آپ می‌کند:
     همان ویزیت است که تبدیل به ویزیتِ قبل از عمل شده. */
  /* کلیدِ پایدارِ سرور (بستهٔ ۹الف) — نه نام: مطب نامِ موضوع را عوض می‌کند. نصبِ پیش از مهاجرت با همان قاعدهٔ نام. */
  const preOpTopicId = (defs.topics.find((tp) => tp.systemKey === 'preop') ?? defs.topics.find((tp) => tp.name.includes('پره‌آپ')))?.id ?? null;
  const formDuration = durationMin(f.opStartTime, f.opEndTime);

  /* تعریفِ فرمِ همین نوع — برچسب، ستاره و روشن/خاموشِ فیلدهای هسته‌ای، به‌علاوهٔ
     فیلدهای دلخواهی که سوپرادمین ساخته. */
  const fd = useFormDef(f.kind);
  /* ── پیش‌فرض‌های شرحِ عمل (درخواستِ مالک ۱۴۰۵/۰۷/۰۱) ──
     چیپ‌های «قالبِ آماده» بالای کادر و «افزودن به پیش‌فرض» زیرش. عمل‌ها از
     **همین فرم** خوانده می‌شوند نه از مراجعهٔ ذخیره‌شده: فرمِ ساخت هنوز مراجعه
     ندارد و در ویرایش ممکن است اصلی همین حالا عوض شده باشد.
     ⚠️ کلیدِ وابستگی رشته است نه خودِ آرایه — هر setF آرایهٔ تازه‌ای می‌سازد و
     با آرایه هر ضربهٔ کیبورد یک درخواست می‌شد. */
  const opReportOn = fd.isOn('opReport');
  const opIdsKey = f.procedureTypeIds.join(',');
  const [opTpl, setOpTpl] = useState({ items: [], canAdd: false, procedure: null });
  const [opTplRev, setOpTplRev] = useState(0);
  useEffect(() => {
    if (!opReportOn) { setOpTpl({ items: [], canAdd: false, procedure: null }); return undefined; }
    let alive = true;
    api(`/op-templates?procedureTypeIds=${opIdsKey}`)
      .then((r) => { if (alive) setOpTpl({ items: Array.isArray(r?.items) ? r.items : [], canAdd: !!r?.canAdd, procedure: r?.procedure ?? null }); })
      .catch(() => { if (alive) setOpTpl({ items: [], canAdd: false, procedure: null }); });
    return () => { alive = false; };
  }, [opReportOn, opIdsKey, opTplRev]);
  /* کاتالوگ‌های بستهٔ ۶ — برچسب از سرور، نه آرایهٔ هاردکد. */
  const anesthesiaOpts = useStatusList('anesthesia');
  const decisionOpts = useStatusList('decision');
  /* هستهٔ ثابتِ مطب: سرور ردیف‌های هسته را `core` علامت می‌زند (فقط حوزهٔ
     مطب). حضورش یعنی چینشِ استانداردِ ثابت، نه ترتیبِ فرم‌ساز. */
  const isClinicCore = (fd.def?.fields ?? []).some((x) => x.core);
  /* **ویزیتِ تصمیم** — جراح در تبِ «قبل از عمل» می‌بیند بیمار با چه شرحِ حال
     و معاینه و یافته‌ای کاندیدِ عمل شد. همان اسنادِ آن ویزیت، نه کپی. */
  const decidedId = initial?.decidedInVisitId ?? prefill?.decidedInVisitId ?? null;
  const [decidedVisit, setDecidedVisit] = useState(null);
  useEffect(() => {
    if (!decidedId || f.kind !== 'surgery') { setDecidedVisit(null); return undefined; }
    let alive = true;
    api(`/visits/${decidedId}`)
      .then((d) => { if (alive) setDecidedVisit(d ?? null); })
      .catch(() => { if (alive) setDecidedVisit(null); });
    return () => { alive = false; };
  }, [decidedId, f.kind]);
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

  /* ── زیرفرم‌های الصاقی (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳) ──────────────────────────────
     «هر چیزی که به مراجعه اضافه می‌کنیم زیرفرم باشد — پیش‌فرض پنهان، با الصاق نمایش.»
     فهرست از نمای **کاملِ** مراجعه (`subforms`) می‌آید؛ فرمی که از ردیفِ سبک باز شده همان را
     یک‌بار می‌خواند و تا نرسیده دکمهٔ الصاق را نمی‌دهد — وگرنه الصاقِ دوبارهٔ زیرفرمی که
     پاسخ دارد، پاسخش را با یک کارتِ خالی بازنویسی می‌کرد. */
  const catalog = useSubformCatalog();
  const catByKey = useMemo(() => new Map((catalog?.items ?? []).map((x) => [x.key, x])), [catalog]);
  const { prefs, save: savePrefs } = usePrefs();
  const { tools: myTools } = useAllowedTools();
  /* ⚠️ شناسهٔ یک الصاق = کلید + مرحله: فرمِ عمل هر زیرفرم را به‌ازای «قبل / حین / بعد از عمل»
     جدا الصاق می‌کند (علائمِ حیاتیِ قبل و بعد از عمل دو کارت‌اند)؛ غیرجراحی مرحله ندارد. */
  const slotOf = (key, ph) => `${key}@${ph || ''}`;
  /* کلیدِ پیش‌نویس/شمارِ علائمِ حیاتیِ هر کارت — مرحلهٔ عمل، یا «visit» برای غیرجراحی. */
  const vk = (ph) => ph || 'visit';
  const toEntry = (x) => ({ ...x, phase: x.phase ?? '', slot: slotOf(x.key, x.phase), data: x.data ?? {}, fresh: false });
  const [subList, setSubList] = useState(() => (Array.isArray(initial?.subforms) ? initial.subforms.map(toEntry) : []));
  const [subLoaded, setSubLoaded] = useState(() => !editing || Array.isArray(initial?.subforms));
  const savedSlots = useRef(new Set((initial?.subforms ?? []).filter((x) => !x.implicit).map((x) => slotOf(x.key, x.phase))));
  const subTouched = useRef(new Set());
  /* کارتی که با × برداشته شد — کلید، مرحله و پاسخِ آخرش: «پاک کردم و برداشتم» در یک ذخیره
     (× فقط روی خالی دیده می‌شود، پس پاسخ همیشه خالی است؛ سرور بی‌آن پاسخِ ذخیره‌شدهٔ قبلی را
     می‌دید و رد می‌کرد). */
  const removedData = useRef({});
  const [subErr, setSubErr] = useState({});
  const [cardsShut, setCardsShut] = useState({});
  const [pickOpen, setPickOpen] = useState(false);
  /* مرحلهٔ پنجرهٔ الصاق در فرمِ عمل — پیش‌فرض همان تبی که کاربر در آن است. */
  const [pickPhase, setPickPhase] = useState('pre');
  /* اندازه‌گیریِ تایپ‌شده ولی «ثبت»‌نخوردهٔ علائمِ حیاتی — به‌ازای کارت؛ «ذخیره» همراهِ خودش می‌برد. */
  const [pendingVitals, setPendingVitals] = useState({});
  const [vitalsCount, setVitalsCount] = useState({});
  useEffect(() => {
    if (subLoaded || !initial?.id) return undefined;
    let alive = true;
    api(`/visits/${initial.id}`)
      .then((v) => {
        if (!alive) return;
        const list = Array.isArray(v?.subforms) ? v.subforms : [];
        savedSlots.current = new Set(list.filter((x) => !x.implicit).map((x) => slotOf(x.key, x.phase)));
        setSubList(list.map(toEntry));
        setSubLoaded(true);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [subLoaded, initial?.id]);

  const isSurgery = f.kind === 'surgery';
  /* کلیدهای الصاق‌شده در یک مرحله — «الصاق شده»ِ پنجره و منتخب‌ها به‌ازای همان مرحله است. */
  const attachedIn = (ph) => new Set(subList.filter((x) => x.phase === (ph || '')).map((x) => x.key));
  /* کارتِ تازه یا منتخبِ زده‌شده دیده شود — اسکرول تا همان کارت بعد از رندر. */
  const reveal = (key, ph) => requestAnimationFrame(() => {
    const sel = `[data-subform="${CSS.escape(key)}"]${ph ? `[data-subform-phase="${ph}"]` : ''}`;
    document.querySelector(sel)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  /** الصاق — در فرمِ عمل به مرحلهٔ داده‌شده (پنجره/تب/منتخب)، و تب به همان مرحله می‌رود. */
  const attachSub = (it, ph) => {
    if (!attachableOn(it, f.kind)) { onToast(`«${it.title}» در این فرم در دسترس نیست`); return; }
    const where = isSurgery ? (ph || phase) : '';
    const slot = slotOf(it.key, where);
    setCardsShut((s2) => ({ ...s2, [slot]: false }));
    if (!subList.some((x) => x.slot === slot)) {
      subTouched.current.add(slot);
      setSubList((l) => [...l, { key: it.key, phase: where, slot, builtin: !!it.builtin, title: it.title, data: {}, hasData: false, fresh: true }]);
    }
    setPickOpen(false);
    if (where) setPhase(where);
    reveal(it.key, where);
  };
  /* **فرم‌های پیش‌فرضِ موضوع** (بستهٔ ۹): با انتخابِ موضوعِ ویزیت در ثبتِ تازه، زیرفرم‌هایی که در
     «تعریف‌ها → موضوعِ ویزیت» به آن وصل شده‌اند خودشان الصاق می‌شوند — با برچسبِ «از موضوع» و قابلِ
     برداشتن. عوض‌کردنِ موضوع فقط الصاق‌های خودکارِ **خالی** را برمی‌دارد؛ پاسخِ نوشته‌شده نمی‌رود. */
  const topicAuto = useRef(new Map());
  useEffect(() => {
    if (editing || isSurgery || !catalog) return;
    const topic = (defs.topics ?? []).find((x) => x.id === f.topicId);
    const want = (topic?.defaultSubforms ?? [])
      .map((k) => (catalog.items ?? []).find((x) => x.key === k))
      .filter((it) => it && attachableOn(it, f.kind));
    const wantSlots = new Set(want.map((it) => slotOf(it.key, '')));
    setSubList((l) => {
      let next = l.filter((x) => !(topicAuto.current.has(x.slot) && !wantSlots.has(x.slot) && !draftHas(x.data)));
      for (const it of want) {
        const slot = slotOf(it.key, '');
        if (next.some((x) => x.slot === slot)) continue;
        topicAuto.current.set(slot, topic.name);
        subTouched.current.add(slot);
        next = [...next, { key: it.key, phase: '', slot, builtin: !!it.builtin, title: it.title, data: {}, hasData: false, fresh: true }];
      }
      return next;
    });
  }, [f.topicId, catalog, editing, isSurgery]); // eslint-disable-line react-hooks/exhaustive-deps
  const openPicker = (ph) => { setPickPhase(ph || phase); setPickOpen(true); };
  const removeSub = (slot) => {
    const gone = subList.find((x) => x.slot === slot);
    if (gone) removedData.current[slot] = { key: gone.key, phase: gone.phase, data: gone.builtin ? undefined : (gone.data ?? {}) };
    subTouched.current.add(slot);
    setSubList((l) => l.filter((x) => x.slot !== slot));
    setSubErr((e) => { const n = { ...e }; delete n[slot]; return n; });
  };
  const setSubData = (slot, data) => {
    subTouched.current.add(slot);
    setSubList((l) => l.map((x) => (x.slot === slot ? { ...x, data } : x)));
  };
  /* ستارهٔ «منتخب» — خانهٔ خالیِ بعدی؛ هر سه پر یعنی اول یکی را بردارید. */
  const pinSub = async (it) => {
    const next = togglePin(prefs.subformPins, it.key);
    if (!next) { onToast('سه فرمِ منتخب پر است — اول ستارهٔ یکی را بردارید'); return; }
    try { await savePrefs('subformPins', next); } catch (e) { onToast(e.message); }
  };
  /* پیش‌نویسِ علائمی که واقعاً عدد دارد، و کارتی که پاسخ دارد — برای جابه‌جاییِ نوع در ثبتِ تازه. */
  const draftHas = (d) => !!d && Object.entries(d).some(([k, v]) => k !== 'phase' && String(v ?? '').trim() !== '');
  const entryHas = (e) => (e.key === 'vitals' ? draftHas(f.vitals?.[vk(e.phase)]) : !e.builtin && hasAnswer(e.data));
  /**
   * انتخابِ نوع در ثبتِ تازه (گامِ ۲). ⚠️ عمل → ویزیت وقتی یک زیرفرم در دو مرحله پاسخ دارد، یکی‌کردن
   * یعنی دورریختنِ یکی — پس نوع عوض نمی‌شود و گفته می‌شود چرا (همان قاعدهٔ سرور برای مراجعهٔ
   * ثبت‌شده، `planKindPhases`).
   */
  const pickKind = (kind) => {
    if (isSurgery && kind !== 'surgery') {
      const answered = new Map();
      for (const e of subList) if (entryHas(e)) answered.set(e.key, (answered.get(e.key) ?? 0) + 1);
      const clash = subList.find((e) => (answered.get(e.key) ?? 0) > 1);
      if (clash) {
        onToast(`«${catByKey.get(clash.key)?.title ?? clash.title ?? clash.key}» در بیش از یک مرحلهٔ عمل پاسخ دارد — اول یکی را خالی کنید، بعد نوع را عوض کنید`);
        return;
      }
    }
    kindTouched.current = true;
    setF((s) => ({ ...s, kind }));
  };
  /* ثبتِ تازه، برگشت به گامِ «نوع» و عوض‌کردنِ ویزیت ↔ عمل: الصاق‌ها مرحلهٔ نوعِ تازه را می‌گیرند —
     عمل: مرحلهٔ پیش‌فرضِ همان زیرفرم (`defaultPhase`ِ کاتالوگ: ارزیابی «قبل»، پیگیریِ پس از عمل «بعد»)؛
     غیرجراحی: بی‌مرحله، یکی به‌ازای هر زیرفرم و **آن که پاسخ دارد** (دو پاسخ را `pickKind` نمی‌گذارد).
     هنوز چیزی ذخیره نشده، پس فقط همین فهرست و پیش‌نویسِ علائم جابه‌جا می‌شوند — وگرنه بندِ بی‌مرحله
     در عمل ۴۰۰ می‌گرفت. */
  const wasSurgery = useRef(isSurgery);
  useEffect(() => {
    if (editing || wasSurgery.current === isSurgery) return;
    wasSurgery.current = isSurgery;
    const phaseFor = (key) => (isSurgery ? (catByKey.get(key)?.defaultPhase ?? 'pre') : '');
    const keep = new Map();
    for (const e of subList) {
      if (isSurgery && e.key === 'orders') continue; // درخواست در عمل جای ثابتِ خودش را دارد
      const cur = keep.get(e.key);
      if (!cur || (!entryHas(cur) && entryHas(e))) keep.set(e.key, e);
    }
    const next = subList.filter((e) => keep.get(e.key) === e).map((e) => {
      const ph = phaseFor(e.key);
      return { ...e, phase: ph, slot: slotOf(e.key, ph) };
    });
    subTouched.current = new Set(next.map((e) => e.slot));
    setSubList(next);
    setF((s2) => {
      const d = s2.vitals ?? {};
      const card = next.find((e) => e.key === 'vitals');
      /* پیش‌نویسی که واقعاً عدد دارد — نه اولین کلید، که ممکن است فقط رشتهٔ خالی باشد. */
      const src = ['visit', 'pre', 'intra', 'post'].map((k) => d[k]).find(draftHas) ?? null;
      return { ...s2, vitals: card && src ? { [vk(card.phase)]: src } : {} };
    });
    setSubErr({});
    setCardsShut({});
  }, [isSurgery, editing]);

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

  /**
   * انتخابِ پروندهٔ موجود — پزشک و مرکزِ **آخرین مراجعه** در کادرِ خالی می‌نشیند (بازبینیِ
   * ۱۴۰۵/۰۷/۰۳: «پیوستگیِ اطلاعات»). فقط جای خالی: انتخابی که کاربر همین حالا کرده بازنویسی نمی‌شود.
   */
  const pickPatient = (p) => {
    setPicked(p);
    const last = p?.last;
    if (!last) return;
    setF((s2) => ({
      ...s2,
      surgeonId: s2.surgeonId ?? last.surgeonId ?? null,
      hospitalId: s2.hospitalId ?? (s2.kind !== 'surgery' ? last.hospitalId ?? null : null),
    }));
  };

  const goNext = () => {
    if (step === 1) {
      const bad = stepOneProblem();
      setStepErr(bad);
      if (bad) return;
    }
    /* خدمت در همین گام پرسیده می‌شود — همین‌جا جلوی رفتن را می‌گیریم، نه در ثبتِ نهایی که کاربر
       باید برای اصلاحش دوباره به عقب برگردد. */
    if (step === 2 && pickService && !f.service) { setStepErr('خدمتِ این مراجعه را انتخاب کنید'); return; }
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

  /** مقدارِ خروجیِ یک بخشِ هسته — `undefined` یعنی «دست نزن». */
  const sectionOut = (k) => {
    const v = (f[k] ?? '').trim();
    if (!editing) return v || undefined;
    if (initial?.[k] === undefined && !v) return undefined;
    return v;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy || aiBusy) return;
    /* ⚠️ Enter داخلِ یک ورودیِ متنی فرم را submit می‌کند. بدونِ این سد،
       زدنِ Enter روی کادرِ کد ملی در گامِ ۱ مراجعه‌ای نیم‌ساخته می‌فرستاد و
       کاربر خطایی می‌دید که ربطی به کاری که کرده بود نداشت. */
    if (!editing && step < 3) { goNext(); return; }
    /* «هنوز تاریخ ندارد» (بستهٔ ۹ب) — فقط عمل؛ کادرِ تاریخ آن‌وقت دیده نمی‌شود و خوانده هم نمی‌شود. */
    const undatedNow = f.kind === 'surgery' && f.undated;
    let opDate;
    if (!undatedNow && f.opDateJ.trim()) {
      opDate = jStrToIso(f.opDateJ);
      if (!opDate) { onToast(`${kindOf(f.kind).date} نامعتبر است (مثال: ۱۴۰۵/۰۴/۲۸)`); return; }
    }
    let plannedDate;
    if (undatedNow && f.plannedDateJ.trim()) {
      plannedDate = jStrToIso(f.plannedDateJ);
      if (!plannedDate) { onToast('تاریخِ تقریبی نامعتبر است (مثال: ۱۴۰۵/۰۸/۰۱)'); return; }
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
    /* مطب: باکس‌های عکس/لینکِ فرم در ویرایش جای خود را به `VisitDocs` داده‌اند — ستارهٔ
       کادری که دیده نمی‌شود نباید ذخیره را بی‌صدا ببندد. */
    /* «طرح»ِ تک‌انتخابیِ قالبِ قدیمی هم در مطب دیده نمی‌شود (جایش کشوی تصمیم است) — آینهٔ `shownFields`ِ سرور. */
    const eCustom = dynErrors(isClinicCore
      ? fd.customFields.filter((x) => x.type !== 'image' && x.type !== 'links' && x.key !== INLINE_KEYS.legacyPlan)
      : fd.customFields, extra, myRole);
    setExtraErr(eCustom);
    if (Object.keys(eCustom).length) {
      onToast(Object.values(eCustom)[0]);
      return;
    }
    /* ⚠️ مراجعهٔ تازه در شرکتِ دوخدمته بی‌خدمت ثبت نمی‌شود: پرتالِ جراح ویرایشگرِ اقلام را فقط برای
       مراجعهٔ ایمپلنتی باز می‌کند، و مراجعهٔ دستیِ بی‌خدمت هیچ نشانه‌ای از ایمپلنتی‌بودن نداشت. */
    if (pickService && !editing && !f.service) { onToast('خدمتِ این مراجعه را انتخاب کنید'); return; }
    const builtinVals = {
      surgeonId: f.surgeonId, hospitalId: f.hospitalId, techId: f.techId,
      /* ستارهٔ فیلد روی **اصلی** است؛ چون فهرست هرگز بدونِ اصلی نمی‌ماند
         (پاک‌کردنِ اصلی، بعدی را بالا می‌آورد)، «اجباری» یعنی «دست‌کم یکی». */
      procedureTypeId: f.procedureTypeIds[0] ?? null, diagnosisId: f.diagnosisIds[0] ?? null, topicId: f.topicId,
      /* شکایتِ خالی ولی ارثی «پر» است — همان قاعدهٔ سرور (باگِ ممیزی ۱۴۰۵/۰۷/۰۳). */
      chiefComplaint: f.chiefComplaint.trim() || inheritedComplaint,
      opDate: undatedNow ? '' : f.opDateJ, opStartTime: f.opStartTime, opEndTime: f.opEndTime,
      /* همان قاعدهٔ `dynErrors`/سرور: «هنوز تاریخ ندارد» ستارهٔ تاریخ را برمی‌دارد. */
      ...(undatedNow ? { opDateOpen: true } : {}),
      nextVisitDate: f.nextVisitDateJ, notes: f.notes,
      /* بخش‌های هستهٔ ثابت — ستارهٔ فرم‌ساز رویشان هم همین‌جا زود گفته می‌شود. */
      history: f.history, findings: f.findings, exam: f.exam,
      planNote: f.planNote, prescription: f.prescription, opReport: f.opReport,
      anesthesia: f.anesthesia,
      // در ویرایش همان جمعِ محاسبه‌شدهٔ صورت‌حساب مبنای اعتبارسنجی است.
      amount: editing ? initial.total : f.amount,
    };
    const eBuiltin = dynErrors(
      (fd.def?.fields ?? []).filter((x) => x.builtin && x.key in builtinVals && !(isClinicCore && x.key === 'findings')
        /* مطب: عملِ بی‌تاریخ هنوز بیمارستان و مبلغ ندارد — آینهٔ `undatedWaiver`ِ سرور. */
        && !(undatedNow && tenantKind === 'clinic' && (x.key === 'hospitalId' || x.key === 'amount'))),
      builtinVals,
      myRole,
    );
    if (Object.keys(eBuiltin).length) { onToast(Object.values(eBuiltin)[0]); return; }

    /* زیرفرم‌ها: ستارهٔ هر کدام کنارِ همان کادر، و اولین خطا با نامِ زیرفرم. */
    const eSubs = {};
    for (const e of subList) {
      const it = catByKey.get(e.key);
      if (e.builtin || !it) continue;
      const er = dynErrors(it.fields, e.data ?? {}, myRole);
      if (Object.keys(er).length) eSubs[e.slot] = er;
    }
    setSubErr(eSubs);
    const firstSub = Object.entries(eSubs)[0];
    if (firstSub) {
      const e0 = subList.find((x) => x.slot === firstSub[0]);
      setCardsShut((c) => ({ ...c, [firstSub[0]]: false }));
      /* کارتِ عمل داخلِ تبِ مرحلهٔ خودش است — تب به همان‌جا می‌رود تا ستاره دیده شود. */
      if (e0?.phase) setPhase(e0.phase);
      onToast(`${catByKey.get(e0?.key)?.title ?? ''}${e0?.phase ? ` (${PHASE_FA[e0.phase]})` : ''}: ${Object.values(firstSub[1])[0]}`);
      return;
    }
    /* دلتا، نه کلِ فهرست: فقط زیرفرمی که در همین فرم الصاق/پر/برداشته شد می‌رود — با مرحله‌اش
       در فرمِ عمل (سرور بندِ بی‌مرحلهٔ عمل را رد می‌کند). */
    const subformsOut = [];
    const withPhase = (ph) => (ph ? { phase: ph } : {});
    for (const slot of subTouched.current) {
      const e = subList.find((x) => x.slot === slot);
      if (!e) {
        const gone = removedData.current[slot];
        if (gone && savedSlots.current.has(slot)) {
          subformsOut.push({ key: gone.key, ...withPhase(gone.phase), removed: true, ...(gone.data ? { data: gone.data } : {}) });
        }
        continue;
      }
      subformsOut.push(e.builtin ? { key: e.key, ...withPhase(e.phase) } : { key: e.key, ...withPhase(e.phase), data: e.data ?? {} });
    }
    /* پیش‌نویسِ علائمِ حیاتیِ ساخت — یکی به‌ازای هر کارتِ علائمِ الصاق‌شده؛ مرحله از خودِ کارت
       (نه از پیش‌نویس، که ممکن است پیش از عوض‌شدنِ نوع تایپ شده باشد). */
    const vitalsDrafts = subList.filter((e) => e.key === 'vitals').map((e) => {
      const d = f.vitals?.[vk(e.phase)];
      if (!d || !Object.entries(d).some(([k, v]) => k !== 'phase' && String(v ?? '').trim())) return null;
      const { phase: _drop, ...rest } = d;
      return e.phase ? { ...rest, phase: e.phase } : rest;
    }).filter(Boolean);
    const pending = Object.values(pendingVitals).filter(Boolean);

    const common = {
      kind: f.kind,
      /* در ویرایش '' یعنی «بی‌خدمت» (ردیفِ قدیمی)؛ بیرون از شرکتِ دوخدمته اصلاً فرستاده نمی‌شود. */
      service: pickService ? (f.service || (editing ? '' : undefined)) : undefined,
      surgeonId: f.surgeonId ?? (editing ? null : undefined),
      hospitalId: f.hospitalId ?? (editing ? null : undefined),
      techId: f.techId ?? (editing ? null : undefined),
      /* ── تشخیص‌ها و عمل‌ها (بستهٔ ۷): اصلی در کلیدِ همیشگی، سایرین در همزاد ──
         سه‌حالتیِ همزاد:
         - ساخت: فقط وقتی واقعاً سایری هست (مراجعهٔ تک‌موردی همان بدنهٔ دیروز).
         - ویرایش و «خوانده یا دست‌خورده»: فهرستِ کامل، حتی [] — پاک‌کردنِ آخرین
           چیپ باید واقعاً پاک کند.
         - ویرایش، نخوانده و دست‌نخورده: `undefined` = «دست نزن». */
      procedureTypeId: f.procedureTypeIds[0] ?? (editing ? null : undefined),
      otherProcedureTypeIds: editing
        ? ((pxLoaded || pxTouched.current) ? f.procedureTypeIds.slice(1) : undefined)
        : (f.procedureTypeIds.length > 1 ? f.procedureTypeIds.slice(1) : undefined),
      diagnosisId: f.diagnosisIds[0] ?? (editing ? null : undefined),
      otherDiagnosisIds: editing
        ? ((dxLoaded || dxTouched.current) ? f.diagnosisIds.slice(1) : undefined)
        : (f.diagnosisIds.length > 1 ? f.diagnosisIds.slice(1) : undefined),
      topicId: f.topicId ?? (editing ? null : undefined),
      opType: f.procedureTypeIds.length ? undefined : f.opType.trim() || undefined,
      // پاسخِ فیلدهای دلخواه — سرور خودش به ستون و JSON تقسیمشان می‌کند.
      extra,
      /* خالی یعنی «ارث را نگه دار» (یا «بردار»، وقتی ارثی نیست) — پس در
         ویرایش رشتهٔ خالی می‌رود نه undefined. */
      chiefComplaint: f.chiefComplaint.trim() || (editing ? '' : undefined),
      /* «این عمل از کدام ویزیت درآمد» — فقط هنگامِ ساخت، و فقط وقتی فرم از روی
         یک تصمیمِ تازه باز شده باشد. پیوند است نه کپی: شکایت از همان‌جا خوانده
         می‌شود، پس اصلاحِ ویزیت همان لحظه سرِ میزِ اتاقِ عمل هم دیده می‌شود. */
      decidedInVisitId: editing ? undefined : (prefill?.decidedInVisitId ?? undefined),
      opReport: f.opReport.trim() || undefined,
      /* بخش‌های هسته. ⚠️ در ویرایش فقط وقتی می‌رود که فرم **مقدارِ قبلی را
         داشته** (نمای کامل) یا کاربر چیزی نوشته: فرمی که از ردیفِ سبکِ فهرست
         باز شده بود بخش‌ها را خالی می‌دید و ذخیره‌اش سندِ جاری را می‌بست. */
      ...Object.fromEntries(SECTION_KEYS.map((k) => [k, sectionOut(k)])),
      anesthesia: f.anesthesia || (editing ? null : undefined),
      /* علائمِ حیاتی: در ساخت پیش‌نویسِ کارتِ الصاق‌شده؛ در ویرایش اندازه‌گیریِ تایپ‌شده‌ای که
         «ثبت» نخورده — تا دیروز با «ذخیره» بی‌صدا دور ریخته می‌شد. */
      vitals: editing
        ? (pending.length ? pending : undefined)
        : vitalsDrafts.length ? (vitalsDrafts.length === 1 ? vitalsDrafts[0] : vitalsDrafts) : undefined,
      /* ساخت با کاتالوگِ خوانده‌شده: فهرست همیشه می‌رود، حتی خالی — «فرم‌های خودکارِ موضوع» را کاربر
         این‌جا دیده و شاید برداشته؛ `undefined` یعنی سرور خودش آن‌ها را الصاق کند (بستهٔ ۹الف). */
      subforms: subformsOut.length ? subformsOut : (!editing && catalog ? [] : undefined),
      /* بی‌تاریخ: در ویرایش `null` (تاریخِ قبلی برداشته شود) + پرچمِ صریح؛ تاریخِ تقریبی فقط همین‌جا. */
      opDate: undatedNow ? (editing ? null : undefined) : opDate,
      ...(undatedNow ? { opDateOpen: true, plannedDate: plannedDate ?? (editing ? null : undefined) } : {}),
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
    /* کلیدِ «سایرین» مالکِ خودش را ندارد؛ قفلش قفلِ فیلدِ اصلی است. */
    /* ⚠️ قفلِ نقش روی **بدنهٔ نهایی** (`dropLocked`) اعمال می‌شود، نه فقط روی `common`: ویرایش
       شرحِ عمل و تاریخ را بعداً دوباره می‌گذاشت و منشی‌ای که به شرحِ عمل دست نزده بود با
       اختلافِ فاصلهٔ ته متن ۴۰۰ می‌گرفت (بازبینیِ ۱۴۰۵/۰۷/۰۳). */
    const dropLocked = (body) => {
      for (const k of Object.keys(body)) {
        if (k !== 'extra' && k !== 'subforms' && k !== 'vitals' && keyLocked(CODING_TWIN_OWNER[k] ?? k)) delete body[k];
      }
      if (body.extra) body.extra = Object.fromEntries(Object.entries(body.extra).filter(([k]) => !keyLocked(k)));
      return body;
    };

    /* ⚠️ مبلغ فقط در **ساخت** می‌رود، نه در ویرایش: ویرایشِ مراجعه نباید
       بی‌سروصدا قلمِ تازه بسازد. اصلاحِ مبلغ کارِ صورت‌حساب است. */
    const amount = Number(toEnDigits(String(f.amount)).replace(/[^0-9]/g, '')) || 0;
    setBusy(true);
    try {
      let saved;
      if (editing) {
        saved = await api(`/visits/${initial.id}`, {
          method: 'PATCH',
          body: dropLocked({
            ...common,
            /* نوعِ مراجعهٔ ثبت‌شده از این فرم عوض نمی‌شود (انتخابگرش در ویرایش نیست). */
            kind: undefined,
            opType: f.procedureTypeIds.length ? undefined : f.opType.trim(),
            opReport: f.opReport.trim(),
            opDate: opDate ?? null,
            firstName: f.firstName.trim(),
            lastName: f.lastName.trim(),
            phone: toEnDigits(f.phone).trim(),
            nationalId: nid,
            birthDate: birthDate ?? null,
          }),
        });
      } else if (mode === 'existing') {
        if (!picked) { onToast('یک بیمار را از فهرست انتخاب کنید'); setBusy(false); return; }
        saved = await api('/visits', { method: 'POST', body: dropLocked({ ...common, patientId: picked.id, amount: amount || undefined }) });
      } else {
        saved = await api('/visits', {
          method: 'POST',
          body: dropLocked({
            amount: amount || undefined,
            ...common,
            firstName: f.firstName.trim(),
            lastName: f.lastName.trim(),
            phone: toEnDigits(f.phone).trim() || undefined,
            nationalId: nid || undefined,
            birthDate,
          }),
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
      if (fb.carePre?.trim() && f.preOpCare.trim() && fb.carePre.trim() !== f.preOpCare.trim()) {
        api('/ai/feedback', { method: 'POST', body: { kind: 'care_pre', draft: fb.carePre.trim(), final: f.preOpCare.trim() } }).catch(() => {});
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

  /**
   * شکایتی که از **ویزیتِ تصمیم** به ارث می‌رسد.
   *
   * دو منبع، چون دو لحظهٔ متفاوت: در ویرایش، سرور خودش گفته که مقدارِ نشان‌داده
   * مشتق است (`chiefComplaintFrom`)؛ در ساختِ عملی که همین الان از روی یک
   * تصمیم باز شده هنوز رکوردی وجود ندارد، پس از `prefill` می‌آید.
   */
  const inheritedComplaint = (initial?.chiefComplaintFrom ? initial.chiefComplaint : prefill?.chiefComplaint) || '';
  const complaintSourceIso = initial?.chiefComplaintFrom?.opDate ?? prefill?.decidedInDate ?? null;
  /* ویزیتِ پست‌آپ از **عمل** ارث می‌برد، نه از ویزیت — برچسب باید همان را بگوید. */
  const complaintSourceKind = initial?.chiefComplaintFrom?.kind ?? 'clinic';
  const complaintSourceWord = kindOf(complaintSourceKind).label;
  const complaintSourceLabel = complaintSourceIso ? `${complaintSourceWord}ِ ${faDate(complaintSourceIso)}` : `${complaintSourceWord}ِ مرتبط`;

  const activeSurgeons = defs.surgeons.filter((s) => s.active || s.id === f.surgeonId);
  const activeHospitals = defs.hospitals.filter((h) => h.active || h.id === f.hospitalId);
  /* ⚠️ هر غیرفعالی که **در فهرست** است می‌ماند، نه فقط اصلی: «اصلی کن» روی
     سایرِ غیرفعال آن را به DefSelect می‌برد و بدونِ گزینه‌اش دکمه خالی دیده می‌شد. */
  const activeProcedures = defs.procedures.filter((p) => p.active || f.procedureTypeIds.includes(p.id));
  const activeDiagnoses = defs.diagnoses.filter((d) => d.active || f.diagnosisIds.includes(d.id));
  const activeTopics = (defs.topics ?? []).filter((t) => t.active || t.id === f.topicId);

  /**
   * ترتیبِ پیش‌فرضِ کد — پشتوانه‌ای برای فیلدهایی که هنوز در هیچ قالبی نیامده‌اند.
   * تعریفِ فرم بر این مقدم است؛ این فقط می‌گوید «اگر تعریف چیزی نگفت، کجا بنشیند».
   */
  const BUILTIN_ORDER = [
    'surgeonId', 'hospitalId', 'techId', 'procedureTypeId', 'diagnosisId', 'chiefComplaint', 'topicId',
    'history', 'findings', 'exam', 'anesthesia',
    'opDate', 'opStartTime', 'opEndTime', 'opReport', 'planNote', 'prescription', 'nextVisitDate',
    'amount', 'notes',
  ];
  /**
   * **چینشِ استانداردِ مطب** (بستهٔ ۶) — ترتیبِ یادداشتِ بالینی، ثابت.
   *
   * ⚠️ این چینشِ **رابط** است؛ اینکه کدام بخش قفل است را سرور می‌گوید
   * (`CLINIC_CORE`، پرچمِ `core`). کلیدهای شبه‌فیلد (`vitals`, `media`,
   * `decisions`) بلوک‌اند نه فیلدِ فرم، و جایشان همین‌جا تعیین می‌شود.
   */
  const CLINIC_LAYOUT = {
    visit: [
      'opDate', 'surgeonId', 'hospitalId', 'topicId', 'techId', 'procedureTypeId',
      'chiefComplaint', 'history', 'vitals', 'findings', 'media', 'exam', 'diagnosisId',
      'decisions', 'planNote', 'prescription', 'nextVisitDate',
      'anesthesia', 'opStartTime', 'opEndTime', 'opReport', 'amount', 'notes',
    ],
    surgery: [
      'opDate', 'surgeonId', 'hospitalId', 'procedureTypeId', 'diagnosisId', 'chiefComplaint',
      'anesthesia', 'techId', 'topicId', 'history', 'exam', 'planNote', 'prescription', 'amount', 'notes',
      'opStartTime', 'opEndTime', 'findings', 'opReport',
    ],
  };
  /* فیلدهای «حینِ عمل» — در فرمِ عمل داخلِ تبِ خودشان می‌نشینند، نه در کارتِ بالا. */
  const INTRA_KEYS = ['opStartTime', 'opEndTime', 'findings', 'opReport'];

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
      label={<>{fd.labelOf('hospitalId', 'بیمارستان')}{star(fd.requiredOf('hospitalId') && !(f.kind === 'surgery' && f.undated && tenantKind === 'clinic'))}</>}
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
  /* ── نوعِ عمل و تشخیص: اصلی + «سایرین» (بستهٔ ۷) ──
     ⚠️ چیپ‌ها **داخلِ همان گره** زیرِ DefSelect می‌نشینند، نه گرهِ جدا: ترتیبِ
     فرم‌ساز، `isOn`، برچسب، ستاره و جعبهٔ نقش همه مالِ همین یک کلید‌اند و
     فهرستِ سایرین فیلدِ فرم‌ساز نیست که جای خودش را داشته باشد. */
  if (fd.isOn('procedureTypeId')) builtinNodes.procedureTypeId = { el: (
    <>
      <DefSelect
        label={<>{fd.labelOf('procedureTypeId', 'نوعِ عمل')}{star(fd.requiredOf('procedureTypeId'))}{f.procedureTypeIds.length > 1 && <PrimaryBadge />}</>}
        value={f.procedureTypeIds[0] ?? null}
        onChange={setPrimaryProcedure}
        options={activeProcedures}
        onQuickAdd={quickAdd('procedure-types')}
        addPlaceholder="نامِ نوعِ عملِ جدید…"
      />
      <CodingChips
        axis="procedure"
        ids={f.procedureTypeIds}
        options={defs.procedures}
        onChange={setProcedureTypeIds}
        onQuickAdd={quickAdd('procedure-types')}
        addLabel="عملِ همزمان"
        max={10}
      />
    </>) };
  /* **تشخیصِ ویزیتِ تصمیم** — عملی که از یک ویزیت درآمده و هنوز تشخیصی ندارد.
     ⚠️ نه ارث و نه کپیِ خودکار: تشخیصِ پیش از عمل و پس از عمل دو واقعیتِ
     جدا‌اند (یافتهٔ حینِ عمل ممکن است عوضش کند)، و منشی شاید اصلاً مالکِ
     فیلدِ تشخیص نباشد. فقط پیشنهاد + یک ضربه؛ غیرفعال‌ها کپی نمی‌شوند چون سرور
     افزودنِ تازهٔ غیرفعال را رد می‌کند و کلِ ذخیره می‌ماند. */
  const decidedDxIds = decidedVisit?.diagnosisId != null
    ? [...new Set([decidedVisit.diagnosisId, ...(decidedVisit.otherDiagnosisIds ?? [])])]
    : [];
  const showDxCopy = f.kind === 'surgery' && decidedDxIds.length > 0 && f.diagnosisIds.length === 0
    && !keyLocked('diagnosisId');
  const copyDecidedDx = () => {
    const keep = [];
    const skipped = [];
    /* ⚠️ «در تعریف‌ها نیست» یعنی «هنوز نیامده»، نه «غیرفعال» (بازبینیِ بستهٔ ۷):
       تعریف‌ها تنبل بار می‌شوند و این دکمه زودتر از آن‌ها ظاهر می‌شد، پس همهٔ
       تشخیص‌ها «غیرفعال» خوانده و هیچ‌کدام کپی نمی‌شد. فقط غیرفعالِ **واقعی**
       کنار می‌ماند؛ ناشناخته‌ها می‌روند و سرور (`assertCodingRefs`) خودش می‌سنجد. */
    for (const id of decidedDxIds) {
      const d = defs.diagnoses.find((x) => x.id === id);
      if (d && d.active === false) skipped.push(d.title ?? 'یک تشخیص'); else keep.push(id);
    }
    if (keep.length) setDiagnosisIds(keep.slice(0, 10));
    if (skipped.length) {
      onToast(skipped.length === 1
        ? `«${skipped[0]}» غیرفعال است و کپی نشد`
        : `${skipped.map((n) => `«${n}»`).join('، ')} غیرفعال‌اند و کپی نشدند`);
    }
  };
  if (fd.isOn('diagnosisId')) builtinNodes.diagnosisId = { wide: true, el: (
    <>
      <DefSelect
        label={<>{fd.labelOf('diagnosisId', 'تشخیص')}{star(fd.requiredOf('diagnosisId'))}{f.diagnosisIds.length > 1 && <PrimaryBadge />}</>}
        value={f.diagnosisIds[0] ?? null}
        onChange={setPrimaryDiagnosis}
        options={activeDiagnoses}
        onQuickAdd={quickAdd('diagnoses')}
        addPlaceholder="عنوانِ تشخیصِ جدید…"
      />
      <CodingChips
        axis="diagnosis"
        ids={f.diagnosisIds}
        options={defs.diagnoses}
        onChange={setDiagnosisIds}
        onQuickAdd={quickAdd('diagnoses')}
        addLabel="تشخیصِ دیگر"
        max={10}
      />
      {showDxCopy && (
        <div className="cc-copy" data-coding-copy>
          <p>
            تشخیصِ ویزیتِ تصمیم
            ({decidedVisit.opDate ? faDate(decidedVisit.opDate) : <span dir="ltr">{decidedVisit.code}</span>}):
            {' '}<b>{decidedVisit.diagnosisLabel ?? decidedVisit.diagnosisTitle}</b>
          </p>
          <button type="button" onClick={copyDecidedDx}>
            <Copy width="14" height="14" />
            همین‌ها
          </button>
        </div>
      )}
    </>) };
  /**
   * **شکایتِ اولیه** — «چرا آمده»، به زبانِ خودِ بیمار.
   *
   * ⚠️ وقتی این عمل از یک ویزیت درآمده، فیلد **خالی** می‌ماند و متنِ ویزیت
   * به‌شکلِ placeholder دیده می‌شود، نه به‌شکلِ مقدار. تفاوتش جدی است: مقدار
   * با اولین ذخیره کپی می‌شد و اصلاحِ بعدیِ ویزیت دیگر سرِ میزِ اتاقِ عمل
   * دیده نمی‌شد. خالی‌ماندن یعنی «همان ویزیت را بخوان»، و تایپ یعنی «برای
   * این عمل فرق دارد».
   */
  /* «مدتِ علائم» (فیلدِ فرم‌سازِ قالبِ قدیمیِ مطب) کنارِ شکایت می‌نشیند، نه در جعبهٔ جدای
     «اطلاعاتِ تکمیلی» — آن جعبه فقط همین یک کادر را داشت (طرحِ مصوبِ ۱۴۰۵/۰۷/۰۳). */
  const durationField = fd.customFields.find((x) => x.key === INLINE_KEYS.duration && x.type === 'text') ?? null;
  if (fd.isOn('chiefComplaint')) builtinNodes.chiefComplaint = { wide: true, el: (
    <div className={durationField ? 'vf-cc' : undefined}>
      <div className="db-field">
        <span>{fd.labelOf('chiefComplaint', 'شکایتِ اولیه')}{star(fd.requiredOf('chiefComplaint'))}</span>
        <textarea
          rows={2}
          value={f.chiefComplaint}
          onChange={set('chiefComplaint')}
          placeholder={inheritedComplaint || 'به زبانِ خودِ بیمار…'}
        />
        {inheritedComplaint && !f.chiefComplaint.trim() && (
          <p className="db-hint" data-complaint-source>
            از {complaintSourceLabel} به ارث می‌رسد — خالی بماند تا همیشه هم‌گام بماند.
          </p>
        )}
      </div>
      {durationField && (
        <label className={`db-field${extraErr[durationField.key] ? ' bad' : ''}`} data-field={durationField.key}>
          <span>{durationField.label}{star(durationField.required)}</span>
          <input
            type="text" value={extra[durationField.key] ?? ''} placeholder={durationField.placeholder || 'مثلاً ۳ ماه'}
            disabled={busy || keyLocked(durationField.key)}
            onChange={(e) => setExtra((x) => ({ ...x, [durationField.key]: e.target.value }))}
          />
          {extraErr[durationField.key] && <small className="db-hint bad">{extraErr[durationField.key]}</small>}
        </label>
      )}
    </div>) };
  /* موضوعِ ویزیت — اولیه/پست‌آپ/زیبایی. `docs/BOOKING.md` مرحلهٔ ۱. مثلِ بقیهٔ
     تعریف‌ها افزودنِ سریع دارد تا منشی وسطِ ثبت مجبور به رفتن به «تعریف‌ها» نشود. */
  if (fd.isOn('topicId')) builtinNodes.topicId = { wide: !isClinicCore, el: (
    <DefSelect
      label={<>{fd.labelOf('topicId', 'موضوعِ ویزیت')}{star(fd.requiredOf('topicId'))}</>}
      value={f.topicId}
      onChange={(v) => setF((s) => ({ ...s, topicId: v }))}
      options={activeTopics}
      onQuickAdd={quickAdd('visit-topics')}
      addPlaceholder="موضوعِ تازه… مثلِ پست‌آپ"
    />) };
  /* مطب: تاریخ و پزشک در یک ردیف (طرحِ مصوب) — تراکم، نه یک کادرِ تمام‌عرض برای ده رقم. */
  /* عمل می‌تواند «هنوز تاریخ نداشته باشد» (بستهٔ ۹): همان کنترلِ دوگزینه‌ایِ فرمِ عمومیِ بیمار —
     «تاریخ مشخص است / هنوز تاریخ ندارد» — و در هر لحظه فقط محتوای گزینهٔ انتخاب‌شده. */
  const undatable = f.kind === 'surgery';
  const dateLabel = <>{fd.labelOf('opDate', kindOf(f.kind).date)} (شمسی){!(undatable && f.undated) && star(fd.requiredOf('opDate'))}</>;
  if (fd.isOn('opDate')) builtinNodes.opDate = { wide: !isClinicCore || undatable, el: !undatable ? (
    /* دکمهٔ «امروز» داخلِ خودِ تقویم است؛ تکرارش کنارِ فیلد فقط جا می‌گرفت.
       ⚠️ راهنمای کادر «سال / ماه / روز» است، نه یک تاریخِ نمونه که با مقدارِ واقعی اشتباه شود. */
    <JDate
      label={dateLabel}
      value={f.opDateJ}
      onChange={(v) => setF((s2) => ({ ...s2, opDateJ: v }))}
      placeholder="سال / ماه / روز"
    />) : (
    <div className="db-when" role="group" aria-labelledby="db-when-l">
      <span id="db-when-l" className="db-when-l">{dateLabel}</span>
      <div className="db-when-pick">
        <button type="button" className={`db-when-pill${!f.undated ? ' on' : ''}`} aria-pressed={!f.undated}
                onClick={() => setF((s2) => ({ ...s2, undated: false }))}>تاریخ مشخص است</button>
        <button type="button" className={`db-when-pill${f.undated ? ' on' : ''}`} aria-pressed={f.undated}
                onClick={() => setF((s2) => ({ ...s2, undated: true, opDateJ: '' }))}>هنوز تاریخ ندارد</button>
      </div>
      {!f.undated ? (
        <JDate label={<span className="db-sr">{fd.labelOf('opDate', kindOf(f.kind).date)}</span>} value={f.opDateJ}
               onChange={(v) => setF((s2) => ({ ...s2, opDateJ: v }))} placeholder="سال / ماه / روز" />
      ) : (
        <>
          <JDate label="تاریخِ تقریبی (اختیاری)" value={f.plannedDateJ}
                 onChange={(v) => setF((s2) => ({ ...s2, plannedDateJ: v }))} placeholder="مثلاً اولِ ماهِ بعد" />
          <p className="db-hint db-when-hint">
            {tenantKind === 'clinic'
              ? 'تا تاریخِ قطعی، پیامک، یادآوری، تقویم و اتاقِ عمل برای این عمل راه نمی‌افتند و بیمار در «فهرستِ انتظارِ عمل» می‌ماند. بیمارستان و مبلغ هم تا آن موقع اجباری نیستند.'
              : 'تا تاریخِ قطعی، پیامک، یادآوری و تقویم برای این مراجعه راه نمی‌افتند.'}
          </p>
        </>
      )}
    </div>) };
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
  /* ابزارهای شرحِ عمل (قالب‌ها، «افزودن به پیش‌فرض»، دیکته و دستیار) — یک‌بار تعریف و در
     هر دو جا (کادرِ درونِ فرم / پاپ‌آپِ مطب) همان‌ها، تا دو نسخه از هم نیفتند. */
  const reportTools = (area) => (<>
    <OpDefaultChips
      items={opTpl.items}
      disabled={busy || !!aiBusy}
      onPick={(tpl) => setF((s2) => ({ ...s2, opReport: withTemplate(s2.opReport, tpl.body) }))}
    />
    {area}
    {/* «افزودن به پیش‌فرض» — مقصد عملِ **اصلیِ همین فرم**؛ همان قراردادِ
        «کلیدِ تکی = اصلی» (بستهٔ ۷). */}
    <OpDefaultSave
      text={f.opReport}
      /* ⚠️ پیش‌فرضی که خودِ بازکردنِ پاپ‌آپ در متن گذاشت «نوشتهٔ کاربر» نیست — تا دستش نزده،
         پیشنهادِ «همین را پیش‌فرض کن» بی‌معناست. */
      typed={f.opReport.trim() !== (initial?.opReport ?? '').trim() && f.opReport.trim() !== (reportPrefill ?? '').trim()}
      noTarget={!f.procedureTypeIds.length}
      procedureName={defs.procedures.find((p) => p.id === f.procedureTypeIds[0])?.name
        ?? (opTpl.procedure && opTpl.procedure.id === f.procedureTypeIds[0] ? opTpl.procedure.name : null)}
      canAdd={opTpl.canAdd}
      disabled={busy || !!aiBusy}
      onToast={onToast}
      onSave={async (title) => {
        const r = await api('/op-templates', {
          method: 'POST',
          body: {
            procedureTypeId: f.procedureTypeIds[0], body: f.opReport, source: 'form',
            ...(initial?.id ? { visitId: initial.id } : {}), ...(title ? { title } : {}),
          },
        });
        setOpTplRev((n) => n + 1);
        return r;
      }}
    />
    {editing && aiOn && (
      <div className="db-aibar">
        {sttOn && (
          <VoiceInput
            disabled={busy || !!aiBusy}
            onText={(txt) => setF((s2) => ({ ...s2, opReport: s2.opReport.trim() ? `${s2.opReport}\n${txt}` : txt }))}
            onErr={(m) => onToast(m)}
          />
        )}
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
      </div>
    )}
  </>);
  const reportLabel = fd.labelOf('opReport', 'شرحِ عمل');
  /* **پیش‌فرضِ همین نوعِ عمل** (اصلاحِ مالک ۱۴۰۵/۰۷/۰۲): تا شرحی نوشته نشده، اولین پیش‌فرضِ
     اختصاصیِ عملِ اصلی کم‌رنگ روی کادر دیده می‌شود و با بازکردنِ پاپ‌آپ در متن می‌نشیند تا
     ویرایش شود. ⚠️ پیش از بازکردن در `f` نمی‌رود: شرحی که کسی ندیده نباید با «ذخیره» ثبت شود. */
  const reportDefault = isClinicCore && !f.opReport.trim()
    ? (opTpl.items.find((x) => x.procedureTypeId != null && x.procedureTypeId === f.procedureTypeIds[0]) ?? null)
    : null;
  const openReport = () => {
    if (reportDefault) {
      setF((s2) => (s2.opReport.trim() ? s2 : { ...s2, opReport: reportDefault.body }));
      setReportPrefill(reportDefault.body);
    }
    setReportOpen(true);
  };
  /* ⚠️ مطب: شرحِ عمل در فرم فقط **پیش‌نما** دارد و نوشتن در پاپ‌آپِ بزرگ است (اصلاحِ مالک
     ۱۴۰۵/۰۷/۰۲) — متنِ بلند در کادرِ سه‌خطیِ وسطِ فرم خوانده و ویرایش نمی‌شد. پاپ‌آپ روی
     `document.body` می‌نشیند: transformِ شیتِ ویزیت، fixedِ فرزند را می‌بُرد (مثلِ OrderSheetHost).
     مدلِ شرکتی دست نخورده، تا مالک برایش جدا تصمیم بگیرد (قانونِ ۲۶). */
  if (fd.isOn('opReport')) builtinNodes.opReport = { wide: true, el: isClinicCore ? (
    <div className="db-field db-report">
      <span>{reportLabel}{star(fd.requiredOf('opReport'))}</span>
      {/* ⚠️ کلِ کادر یک دکمه است — هر جایش بخورد پاپ‌آپ باز می‌شود، نه فقط «بازکردن». */}
      <button type="button" className={`db-report-preview${reportDefault ? ' is-default' : ''}`} data-report-open
        onClick={openReport} disabled={busy} aria-label={`${reportLabel} — بازکردن برای نوشتن`}>
        {f.opReport.trim() ? (
          <span className="db-report-text">{f.opReport}</span>
        ) : reportDefault ? (<>
          <small className="db-report-deflabel">پیش‌فرضِ «{reportDefault.title}»</small>
          <span className="db-report-text" data-report-default>{reportDefault.body}</span>
        </>) : (
          <i>هنوز نوشته نشده</i>
        )}
        <b>
          <Pencil width="14" height="14" aria-hidden="true" />
          {f.opReport.trim() ? 'بزنید تا باز و ویرایش شود' : reportDefault ? 'بزنید تا با همین پیش‌فرض بنویسید' : 'بزنید تا بنویسید'}
        </b>
      </button>
      {createPortal(
        <AnimatePresence>
          {reportOpen && (
            <Overlay backdrop="db-overlay db-report-overlay" panel="glass db-sheet db-report-sheet" from="bottom"
              closable={!aiBusy} onClose={() => setReportOpen(false)} aria-label={reportLabel}>
              <header className="db-sheet-head">
                <b>{reportLabel}</b>
                <button type="button" className="db-x" onClick={() => setReportOpen(false)} disabled={!!aiBusy} aria-label="بستن"><Close width="18" height="18" /></button>
              </header>
              <div className="db-field db-report db-report-body" data-report-sheet>
                {reportTools(
                  <textarea className="db-report-area" rows={14} autoFocus value={f.opReport} readOnly={!!aiBusy} onChange={set('opReport')}
                    placeholder="مسیرِ عمل، اقدام‌ها، رخدادهای حینِ عمل…" aria-label={reportLabel} data-report-area />,
                )}
              </div>
              <button type="button" className="db-submit db-report-done" data-act="report-done" disabled={!!aiBusy} onClick={() => setReportOpen(false)}>تمام</button>
            </Overlay>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  ) : (
    <div className="db-field db-report">
      <span>{reportLabel}{star(fd.requiredOf('opReport'))}</span>
      {reportTools(
        <textarea rows={3} value={f.opReport} readOnly={!!aiBusy} onChange={set('opReport')} placeholder="یافته‌ها، مسیرِ عمل، رخدادهای حینِ مانیتورینگ…" />,
      )}
    </div>) };
  /* ── بخش‌های متنیِ هستهٔ ثابت (بستهٔ ۶الف) ──
     هر کدام سندِ نسخه‌دارِ خودش در سرور است؛ دستیارِ صوتی/AI همان
     `AssistedTextarea`ِ بقیهٔ متن‌هاست. */
  const textSection = (key, fallback, placeholder, purpose) => (
    <div className="db-field db-section" data-section={key}>
      <span>{fd.labelOf(key, fallback)}{star(fd.requiredOf(key))}</span>
      <AssistedTextarea
        disabled={busy || !!aiBusy} rows={3} value={f[key]} onChange={set(key)}
        placeholder={placeholder} purpose={purpose}
      />
    </div>
  );
  if (fd.isOn('history')) builtinNodes.history = { wide: true, el: textSection('history', 'شرحِ حال و علائم', 'شروع، مدت، سیر، علائمِ همراه…', 'شرحِ حال') };
  /* ⚠️ مطب: «یافته‌های پاراکلینیک/حینِ عمل» کادرِ متنی نیست (اصلاحِ مالک ۱۴۰۵/۰۷/۰۲) —
     پاراکلینیک یعنی خودِ مدارکِ پرونده (`VisitDocs`). متنِ ثبت‌شدهٔ قبلی در پرونده می‌ماند. */
  if (fd.isOn('findings') && !isClinicCore) builtinNodes.findings = { wide: true, el: textSection('findings',
    f.kind === 'surgery' ? 'یافته‌های حینِ عمل' : 'یافته‌های پاراکلینیک',
    f.kind === 'surgery' ? 'آنچه حینِ عمل دیده شد…' : 'خلاصهٔ آزمایش، MRI، سونوگرافی، سی‌تی، آندوسکوپی…',
    f.kind === 'surgery' ? 'یافته‌های حین عمل' : 'یافته‌های پاراکلینیک') };
  if (fd.isOn('exam')) builtinNodes.exam = { wide: true, el: textSection('exam', 'شرحِ معاینه', 'یافته‌های معاینهٔ بالینی…', 'شرح معاینه') };
  if (fd.isOn('planNote')) builtinNodes.planNote = { wide: true, el: textSection('planNote', 'طرحِ درمان و توصیه‌ها', 'شرحِ درمان، توصیه‌ها…', 'طرح درمان') };
  if (fd.isOn('prescription')) builtinNodes.prescription = { wide: true, el: textSection('prescription', 'نسخه / دارو', 'داروها و دستورِ مصرف', 'نسخه') };
  /* نوعِ بیهوشی — ستونِ گزارش‌پذیر؛ دکمه‌ها از `/config` (بستهٔ ۶الف). */
  if (fd.isOn('anesthesia')) builtinNodes.anesthesia = { wide: true, el: (
    <div className="db-field" data-section="anesthesia">
      <span>{fd.labelOf('anesthesia', 'نوعِ بیهوشی')}{star(fd.requiredOf('anesthesia'))}</span>
      <div className="db-daychips" role="radiogroup" aria-label="نوعِ بیهوشی">
        {anesthesiaOpts.map((o) => (
          <button
            key={o.key} type="button" role="radio" aria-checked={f.anesthesia === o.key}
            className={f.anesthesia === o.key ? 'db-daychip on' : 'db-daychip'}
            onClick={() => setF((s2) => ({ ...s2, anesthesia: s2.anesthesia === o.key ? '' : o.key }))}
          >{o.label}</button>
        ))}
      </div>
    </div>) };

  /* «دو هفتهٔ دیگر بیاید» — روی خودِ فرم، تا پزشک وسطِ ویزیت ثبتش کند؛
     پایهٔ فازِ یادآوری‌ها. */
  /* ⚠️ در فرمِ عمل، «ویزیتِ بعدی» داخلِ بخشِ برنامهٔ مراقبت رندر می‌شود؛
     این‌جا رد می‌شود تا دو ورودیِ هم‌ارز روی یک state نباشد. */
  if (fd.isOn('nextVisitDate') && f.kind !== 'surgery') builtinNodes.nextVisitDate = { wide: true, el: (
    <JDate
      className="db-field jd-next"
      label={<>{fd.labelOf('nextVisitDate', 'ویزیتِ بعدی')} (شمسی){star(fd.requiredOf('nextVisitDate'))}</>}
      value={f.nextVisitDateJ}
      onChange={(v) => setF((s2) => ({ ...s2, nextVisitDateJ: v }))}
      placeholder="سال / ماه / روز"
    />) };
  /* مبلغ فقط هنگامِ ثبتِ مراجعهٔ تازه — تا مراجعهٔ صفرتومانی ساخته نشود.
     در ویرایش، صورت‌حساب جای اصلاح است. */
  /* باکسِ مبلغِ مشترک (قانونِ ۱۳): سه‌رقمی در blur + «به‌حروف»ِ زنده — «20000000»ِ خام صفرِ کم/زیاد را پنهان می‌کرد. */
  if (!editing && fd.isOn('amount')) builtinNodes.amount = { wide: true, el: (
    <label className="db-field"><span>{fd.labelOf('amount', 'مبلغِ توافقی (تومان)')}{star(fd.requiredOf('amount') && !(f.kind === 'surgery' && f.undated && tenantKind === 'clinic'))}</span>
      <MoneyInput value={f.amount} onChange={(v) => setF((s) => ({ ...s, amount: v }))}
             placeholder="اختیاری — قلمِ خدمت در صورت‌حساب ساخته می‌شود" />
    </label>) };
  if (editing && fd.isOn('amount')) builtinNodes.amount = { wide: true, el: (
    <div className="db-field db-financial-context" aria-label="وضعیت مالی ثبت‌شده">
      <span>{fd.labelOf('amount', 'مبلغ')} — صورت‌حساب</span>
      <p>مبلغ: {initial.total == null ? '—' : faNum(initial.total)} تومان · پرداخت‌شده: {initial.paid == null ? '—' : faNum(initial.paid)} تومان · مانده: {initial.due == null ? '—' : faNum(initial.due)} تومان</p>
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
  /* ⚠️ برچسبِ وضعیت از خودِ سفارش (`statusFa`، `labels.ts`) — نگاشتِ سه‌حالتیِ دستیِ قبلی
     «بررسی‌شده» و «نیازمندِ اقدام» را «ثبت‌شده» نشان می‌داد (بازبینیِ ۱۴۰۵/۰۷/۰۳). */
  const ordersBlock = initial?.id ? (
            <div className="db-orders">
              {orders.map((o) => (
                <div className="db-order" key={`${o.kind}-${o.id}`}>
                  <b>{o.kindFa}</b>
                  <span>{o.summary}</span>
                  <i className={o.status}>{o.statusFa ?? o.status}</i>
                  <button type="button" onClick={() => setOrderSheet({ kind: o.kind, order: o })}>باز کردن</button>
                </div>
              ))}
              <div className="db-daychips">
                {Object.entries(ORDER_META).map(([k, m]) => (
                  <button key={k} type="button" className="db-daychip" data-order-new={k}
                          onClick={() => setOrderSheet({ kind: k })}>+ {m.fa.replace(/^درخواستِ\s*/, '')}</button>
                ))}
              </div>
            </div>
  ) : null;

  /* ── مدارکِ همین مرحله ─────────────────────────────────────────────────
     بازخوردِ مالک ۱۴۰۵/۰۶/۳۰: «بسته به اینکه مدارکِ هر عمل قبل یا بعد از عمل
     است، همان‌جا باید ذخیره شود؛ وقتی مدارکِ یک عمل را می‌بینیم باید بفهمیم
     کدام عکس و آزمایش قبل از عمل بود و کدام بعدش.»

     تا دیروز مدرک فقط از تبِ «مدارک»ِ پرونده بالا می‌رفت و آن‌جا نه مرحله‌ای
     داشت نه راهی برای فهمیدنش — MRIِ پیش از عمل و عکسِ کنترلِ بعدش دو ردیفِ
     یکسان بودند. حالا آپلود داخلِ **همان تب** است و `visitId` و `phase` از
     جایی می‌آیند که کاربر ایستاده، نه از یک کشویی که باید یادش بماند پرش کند.
     دستهٔ مدرک از خودِ نوعِ فایل حدس زده نمی‌شود — کاربر انتخابش می‌کند. */
  /* اصلاحِ مالک ۱۴۰۵/۰۷/۰۲: همان باکسِ مدارکِ ویزیت، این‌جا با برچسبِ مرحله — مدرکی هست
     باز و کامل، وگرنه فقط «+» با توضیح؛ در هر دو مدل. */
  const phaseDocs = initial?.id ? (
    <VisitDocs
      key={`docs-${phase}`}
      patientId={initial.patientId}
      visitId={initial.id}
      phase={phase}
      phaseFa={PHASE_FA[phase]}
      cats={PHASE_DOC_CATS}
      disabled={busy}
      onToast={onToast}
    />
  ) : (
    <p className="db-decide-hint">بعد از ذخیرهٔ همین {t.visit}، مدارکِ هر مرحله از همین‌جا بارگذاری می‌شود.</p>
  );

  /* ── تصمیمِ درمانی ──
     «بیمار آمد، معاینه شد، حالا چه؟» — یک کشوییِ چندانتخابی (طرحِ مصوبِ ۱۴۰۵/۰۷/۰۳) به‌جای
     ردیفِ چیپ‌ها. درخواست‌ها (آزمایش/تصویربرداری/مشاوره/ارجاع) این‌جا نیستند: زیرفرمِ
     «درخواستِ پاراکلینیک و مشاوره» خودش ثبتشان می‌کند و سرور کلیدِ همان تصمیم را می‌گذارد —
     تا دیروز هر درخواست دو بار دیده می‌شد و چیپ و سفارش از هم عقب می‌افتادند.
     «کاندیدای جراحی» موضوعِ همین ویزیت را هم پره‌آپ می‌کند (همان رفتارِ قبلی). */
  const setDecisions = (next) => setF((s2) => {
    const fresh = next.includes('surgery') && !s2.decisions.includes('surgery');
    return { ...s2, decisions: next, topicId: fresh && preOpTopicId && !s2.topicId ? preOpTopicId : s2.topicId };
  });
  const decisionsEl = (
    <div className="db-field db-decide">
      <DecisionSelect label="تصمیمِ درمانی" options={decisionOpts} value={f.decisions} onChange={setDecisions} disabled={busy} />
      {f.decisions.filter((d) => DECISION_HINTS[d]).map((d) => (
        <small key={d} className="db-decide-hint">{DECISION_HINTS[d]}</small>
      ))}
    </div>
  );

  /* ── توضیحِ صوتیِ لینک‌ها (بستهٔ ۶د) ──
     فقط برای مراجعهٔ ذخیره‌شده: صدا مدرکِ پرونده است و پرونده و مراجعه باید
     معلوم باشند. هنگامِ ذخیرهٔ فرم، سرور صدا را زیرِ مدرکِ همان لینک وصل
     می‌کند (`syncLinkDocuments`). */
  const onVoice = initial?.id ? async (file, field) => {
    const fdv = new FormData();
    fdv.append('file', file);
    fdv.append('category', field.docCategory || 'other');
    fdv.append('visitId', String(initial.id));
    fdv.append('title', `توضیحِ صوتی — ${field.label}`.slice(0, 120));
    const doc = await apiUpload(`/patients/${initial.patientId}/documents`, fdv);
    return { id: doc.id, name: doc.fileName };
  } : undefined;
  const voiceUrl = (ref) => apiBlobUrl(`/patients/documents/${ref.id}/file`);

  /* ── شبه‌فیلدهای چینشِ استانداردِ مطب ──
     بلوک‌اند نه فیلدِ فرم، ولی در همان شبکه و به همان ترتیبِ یادداشتِ بالینی
     می‌نشینند: علائمِ حیاتی بعد از شرحِ حال، مدارک و لینک‌ها کنارِ یافته‌ها،
     تصمیم زیرِ تشخیص. */
  const mediaFields = isClinicCore ? fd.customFields.filter((x) => x.type === 'image' || x.type === 'links') : [];
  /* ⚠️ «اطلاعاتِ تکمیلی» دیگر جعبهٔ جدا نیست (طرحِ مصوبِ ۱۴۰۵/۰۷/۰۳): فیلدهای دلخواهِ باقی‌مانده
     زیرِ هستهٔ بالینی می‌نشینند، «مدتِ علائم» کنارِ شکایت، و `plan`ِ قالبِ قدیمی اصلاً نه —
     سرور همان را در ذخیره به «تصمیمِ درمانی» می‌بَرد (`liftLegacy`) و کادرش دو تصمیمِ موازی بود. */
  const restFields = fd.customFields.filter((x) => !mediaFields.includes(x)
    && x !== durationField && !(isClinicCore && x.key === INLINE_KEYS.legacyPlan));
  if (isClinicCore && f.kind !== 'surgery') {
    /* مدارکِ بالینیِ ویزیت (اصلاحِ مالک ۱۴۰۵/۰۷/۰۲): آنچه بیمار فرستاده کامل، وگرنه یک خطِ
       «+ افزودنِ مدارک» که باکسِ استاندارد (عکس، لینک + نام کاربری/رمز، صدا) را باز می‌کند. */
    builtinNodes.media = { wide: true, el: (
      <VisitDocs patientId={initial?.patientId ?? null} visitId={initial?.id ?? null} disabled={busy} onToast={onToast} />) };
  }
  if (f.kind !== 'surgery') builtinNodes.decisions = { wide: true, el: decisionsEl };

  /* ── کارت‌های زیرفرم ──
     داخلی‌ها: علائمِ حیاتی (پیش‌نویسِ ساخت یا اندازه‌گیریِ تایپ‌شده) و درخواست‌ها؛ فرم‌سازی‌ها با
     همان `DynForm`ِ فرم‌ها. × فقط وقتی خالی است — سرور هم همین را می‌سنجد. */
  const subUpload = (title) => async (file, field) => {
    if (!initial?.id) throw new Error(`اول ${t.visit} را ذخیره کنید، بعد عکس بگذارید`);
    const fdu = new FormData();
    fdu.append('file', file);
    fdu.append('category', field.docCategory || 'other');
    fdu.append('visitId', String(initial.id));
    fdu.append('title', `${title} — ${field.label}`.slice(0, 120));
    const doc = await apiUpload(`/patients/${initial.patientId}/documents`, fdu);
    return { id: doc.id, name: doc.fileName };
  };
  const subRemoveFile = async (ref) => { if (ref?.id) await api(`/patients/documents/${ref.id}`, { method: 'DELETE' }); };
  const cardOf = (e) => {
    const it = catByKey.get(e.key);
    const title = it?.title ?? e.title ?? e.key;
    const open = cardsShut[e.slot] !== true;
    let body;
    let empty;
    if (e.key === 'vitals') {
      /* فرمِ عمل: هر مرحله کارتِ خودش — فقط اندازه‌های همان مرحله، پیش‌نویسِ همان مرحله. */
      const k = vk(e.phase);
      const draft = f.vitals?.[k] ?? null;
      empty = !(vitalsCount[k] ?? (e.count ?? (e.hasData ? 1 : 0))) && !pendingVitals[k]
        && !(draft && Object.entries(draft).some(([kk, v]) => kk !== 'phase' && String(v ?? '').trim()));
      body = (
        <VitalSigns
          visitId={initial?.id ?? null}
          phase={e.phase || null}
          draft={draft}
          onDraft={(v) => setF((s2) => ({ ...s2, vitals: { ...(s2.vitals ?? {}), [k]: v } }))}
          pending={pendingVitals[k] ?? null}
          onPending={(v) => setPendingVitals((p2) => ({ ...p2, [k]: v }))}
          onCount={(n) => setVitalsCount((c) => (c[k] === n ? c : { ...c, [k]: n }))}
          disabled={busy}
          onToast={onToast}
        />
      );
    } else if (e.key === 'orders') {
      empty = orders.length === 0;
      body = ordersBlock ?? <p className="vf-card-hint">بعد از ذخیرهٔ همین {t.visit}، درخواست از همین‌جا ثبت و برای بیمار فرستاده می‌شود.</p>;
    } else {
      empty = !hasAnswer(e.data);
      body = it ? (<>
        <DynForm
          assistance
          fields={it.fields}
          values={e.data ?? {}}
          errors={subErr[e.slot] ?? {}}
          onChange={(v) => setSubData(e.slot, v)}
          disabled={busy}
          myRole={myRole}
          onUpload={subUpload(title)}
          onRemove={subRemoveFile}
        />
        {e.derived?.bmi != null && (
          <p className="vf-card-bmi" data-subform-bmi>BMI (آخرین ذخیره): <b>{Number(e.derived.bmi).toLocaleString('fa-IR')}</b></p>
        )}
        <GrowthTrend history={e.history} current={e.data} />
      </>) : <p className="vf-card-hint">تعریفِ این زیرفرم در فرم‌ساز پیدا نشد؛ پاسخِ ثبت‌شده‌اش سرِ جایش است.</p>;
    }
    return (
      <SubformCard
        key={e.slot} skey={e.key} phase={e.phase} title={title}
        badge={e.implicit ? 'داده دارد' : topicAuto.current.has(e.slot) ? `از موضوعِ «${topicAuto.current.get(e.slot)}»` : 'الصاق‌شده'}
        open={open} onToggle={() => setCardsShut((c) => ({ ...c, [e.slot]: open }))}
        onRemove={empty && !busy ? () => removeSub(e.slot) : undefined}
        removeHint={empty ? undefined : 'داده دارد و برداشته نمی‌شود'}
      >
        {body}
      </SubformCard>
    );
  };
  /* غیرجراحی: ستونِ زیرفرم‌ها. فرمِ عمل: هر کارت داخلِ تبِ مرحلهٔ خودش (`phaseSubs`). */
  const subCards = isSurgery ? [] : subList.map(cardOf);
  const builtinOrder = isClinicCore
    ? CLINIC_LAYOUT[f.kind === 'surgery' ? 'surgery' : 'visit']
    : fd.orderBuiltins(BUILTIN_ORDER);

  /* ویزیتِ تصمیم (فقط‌خواندنی) — کارتِ اولِ تبِ «قبل از عمل». */
  const decidedCard = decidedVisit ? (
    <div className="db-careblock db-decided" data-section="decided-visit">
      <div className="db-carehead">
        <span>از ویزیتِ تصمیم — {decidedVisit.code}{decidedVisit.opDate ? ` · ${faDate(decidedVisit.opDate)}` : ''}</span>
        <i>فقط‌خواندنی؛ اصلاح در همان ویزیت</i>
      </div>
      {/* ⚠️ برچسبِ ترکیبی (همهٔ تشخیص‌ها، اصلی اول) نه فقط اصلی — این همان
          «تشخیصِ پیش از عمل» است و جراح باید همه را ببیند. */}
      {[
        ['تشخیص', decidedVisit.diagnosisLabel ?? decidedVisit.diagnosisTitle],
        ['شرحِ حال و علائم', decidedVisit.history],
        ['یافته‌های پاراکلینیک', decidedVisit.findings],
        ['شرحِ معاینه', decidedVisit.exam],
        ['طرحِ درمان', decidedVisit.planNote],
      ].filter(([, v]) => v).map(([l, v]) => (
        <p key={l} className="db-decided-row"><b>{l}</b><span>{v}</span></p>
      ))}
      {![decidedVisit.diagnosisLabel ?? decidedVisit.diagnosisTitle, decidedVisit.history, decidedVisit.findings, decidedVisit.exam, decidedVisit.planNote].some(Boolean) && (
        <p className="db-decide-hint">در آن ویزیت هنوز شرحی ثبت نشده.</p>
      )}
    </div>
  ) : null;

  /* فرمِ انتخاب‌شده — برای عنوان و رنگِ بخشِ «فرم» (تمایز از ردیفِ نوع‌ها). */
  const kindMeta = (fd.kinds ?? []).find((k) => k.kind === f.kind) ?? null;
  /* نامِ همین مراجعه در سربرگ — «فرمِ ویزیت» → «ویزیت» (طرحِ مصوب). شرکتِ دوخدمته: نامِ خدمتِ
     انتخاب‌شده («نورومانیتورینگ»/«ایمپلنت») به‌جای «خدمت»ِ مشترک — نگاشتش از سرور (`serviceTitles`). */
  const visitTitle = (kindMeta?.serviceTitles?.[f.service] ?? kindMeta?.title ?? fd.def?.title ?? initial?.kindTitle ?? kindOf(f.kind).label).replace(/^\s*فرم(?:ِ)?\s+/, '');
  const topicName = (defs.topics ?? []).find((tp) => tp.id === f.topicId)?.name ?? initial?.topicName ?? null;
  const attachItems = (catalog?.items ?? []).filter((x) => attachableOn(x, f.kind));
  const canBuildSubform = (myTools ?? []).some((x) => x.key === 'forms');
  const canAttach = !!catalog && attachItems.length > 0;
  /* **فرمِ عمل: زیرفرم‌های هر مرحله داخلِ تبِ خودش** (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳، دورِ دوم) — کارت‌ها
     و ته‌شان «+ الصاقِ فرم به این مرحله». علائمِ حیاتی دیگر کادرِ ثابتِ تب‌ها نیست؛ عملی که از قبل
     اندازه دارد کارتش را خودکار در همان تب می‌بیند (`implicit`ِ سرور). */
  const phaseSubs = (ph) => {
    const cards = subList.filter((e) => e.phase === ph).map(cardOf);
    if (!cards.length && !canAttach) return null;
    return (
      <div className="vf-phase-subs" data-phase-subforms={ph}>
        {cards}
        {canAttach && <PhaseAttach phase={ph} label={PHASE_FA[ph]} onClick={() => openPicker(ph)} disabled={busy || !subLoaded} />}
      </div>
    );
  };

  /* خدمتِ مراجعه (شرکتِ دوخدمته) — در ثبتِ تازه گامِ دوم، در ویرایش زیرِ سربرگ. */
  const serviceEl = pickService ? (<>
    <div className="db-sect">
      <b>خدمت</b>
      <small>این {t.visit} مالِ کدام خدمتِ شرکت است؟ ویرایشگرِ اقلامِ پرتالِ جراح فقط برای «ایمپلنت» باز می‌شود.</small>
    </div>
    <div className="db-kindbox">
      <div className="db-kindrow" role="radiogroup" aria-label={`خدمتِ این ${t.visit}`}>
        {serviceCatalog.filter((x) => offered.includes(x.key)).map((x) => (
          <button key={x.key} type="button" role="radio" aria-checked={f.service === x.key}
                  className={f.service === x.key ? 'on' : ''}
                  onClick={() => setF((s) => ({ ...s, service: x.key }))}>{x.label}</button>
        ))}
      </div>
    </div>
  </>) : null;

  /* ── چیدمان: هسته (ستونِ اصلی)، زیرفرم‌ها و باقی (ستونِ کناری) ── */
  const SIDE_KEYS = f.kind === 'surgery' ? ['amount', 'notes'] : ['media', 'decisions', 'nextVisitDate', 'amount', 'notes'];
  const cell = (key) => {
    const node = builtinNodes[key];
    if (!node) return null;
    return <div key={key} className={node.wide ? 'db-span2' : undefined}>{node.el}</div>;
  };
  /* «کِی می‌رود» — هم سرِ کادرِ مراقبت در تب، هم بالای پاپ‌آپش. */
  const preWhen = [
    f.preOpImmediate ? 'به‌محضِ ثبت' : null,
    timing ? `${faNum(timing.preOpDays)} روز قبل از عمل، ساعتِ ${faNum(timing.hour)}` : 'پیش از عمل',
  ].filter(Boolean).join(' + ');
  const postWhen = f.postOpImmediate
    ? 'ارسال: بلافاصله بعد از ثبتِ فرم'
    : timing ? `ارسال: ${faNum(timing.postOpDays)} روز بعد از عمل، ساعتِ ${faNum(timing.hour)}` : 'ارسال: بعد از عمل';
  /* دستیارِ مراقبت بی‌بافتار «مراقبتِ عمومی» می‌نوشت — همان که مالک نخواست؛ پس دست‌کم یکی از
     نوعِ عمل، تشخیص یا متنِ خودِ کادر لازم است (سرور هم همین را می‌سنجد). */
  const careAiReady = (own) => f.procedureTypeIds.length > 0 || f.diagnosisIds.length > 0 || !!String(own ?? '').trim();
  /**
   * **کادرِ مراقبتِ قبل/بعد از عمل** — مطب: پیش‌نما + پاپ‌آپِ بزرگ، مثلِ شرحِ عمل (بازخوردِ مالک
   * ۱۴۰۵/۰۷/۰۳)؛ مدلِ شرکتی دست‌نخورده (همان استدلالِ شرحِ عمل، قانونِ ۲۶) و فقط دستیارش بافتارِ
   * نوعِ عمل و تشخیص گرفت. در هر دو، «خالی = قالبِ نوعِ عمل».
   */
  const careField = (ph) => {
    const field = ph === 'pre' ? 'preOpCare' : 'postOpCare';
    const label = `مراقبت‌های ${PHASE_FA[ph]} — پیامک به بیمار`;
    const def = ph === 'pre' ? procDefaults.preOpCare : procDefaults.postOpCare;
    const placeholder = def ? 'خالی = همان پیش‌فرضِ بالا' : 'خالی = پیامی نمی‌رود';
    if (isClinicCore) {
      const undo = careUndo[ph];
      return (
        <CareEditor
          phase={ph}
          label={label}
          when={ph === 'pre' ? preWhen : postWhen}
          value={f[field]}
          onChange={(v) => setF((s2) => ({ ...s2, [field]: v }))}
          defaultText={def}
          defaultName={procDefaults.name}
          placeholder={placeholder}
          disabled={busy}
          aiOn={aiOn}
          aiBusy={aiBusy === `care-${ph}`}
          aiReady={careAiReady(f[field]) || (ph === 'post' && !!f.opReport.trim())}
          onAi={() => aiCare(ph)}
          canUndo={undo !== undefined && undo !== f[field]}
          onUndo={() => { setF((s2) => ({ ...s2, [field]: undo ?? '' })); setCareUndo((u) => ({ ...u, [ph]: undefined })); }}
        />
      );
    }
    return (<>
      {def && (
        <div className="db-default">
          <p>{def}</p>
          <button type="button" onClick={() => setF((s2) => ({ ...s2, [field]: def }))}>
            استفاده و ویرایش
          </button>
        </div>
      )}
      <AssistedTextarea disabled={busy || !!aiBusy} rows={ph === 'pre' ? 2 : 3} value={f[field]} onChange={set(field)}
                placeholder={placeholder} purpose={label} aiContext={{ care: ph }} />
      {ph === 'post' && editing && aiOn && (
        <div className="db-aibar">
          <button type="button" className="db-aibtn" disabled={busy || !!aiBusy} onClick={() => aiCare('post')}>
            {aiBusy === 'care-post' ? 'دستیار در حالِ نوشتن…' : 'پیش‌نویسِ مراقبت با دستیار (از پرونده)'}
          </button>
        </div>
      )}
    </>);
  };
  const mainKeys = builtinOrder.filter((key) => !(f.kind === 'surgery' && INTRA_KEYS.includes(key)) && !SIDE_KEYS.includes(key));
  const sideKeys = SIDE_KEYS.filter((key) => builtinNodes[key]);

  return (
    <AiContext.Provider value={aiCoding}>
    <Overlay backdrop="db-overlay" panel={`glass db-sheet${editing || step === 3 ? ' vf-wide' : ''}`} as="form" from="bottom" onClose={onClose} onSubmit={submit}>
      <header className="db-sheet-head">
        {/* نوعِ «عمل» نامِ خودش را دارد (`surgery`/`surgeryNew`ِ واژگان) — فرمِ عملِ مطب «ویزیتِ جدید» می‌نوشت. */}
        <b data-sheet-title>{editing ? `ویرایشِ ${f.kind === 'surgery' ? t.surgery : t.visit} ${initial.code}` : f.kind === 'surgery' ? t.surgeryNew : t.visitNew}</b>
        <button type="button" className="db-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
      </header>

      {editing && <PatientSummary prep={prep} f={f} idOpen={idOpen} onToggleId={() => setIdOpen((x) => !x)} />}

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
      <div className="db-step" hidden={editing ? !idOpen : step !== 1}>
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
                  <button type="button" key={p.id} onClick={() => pickPatient(p)}>
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
              <input type="text" value={f.firstName} onChange={set('firstName')} required={editing ? idOpen : step === 1} minLength={2} />
            </label>
            <label className="db-field"><span>نام خانوادگی</span>
              <input type="text" value={f.lastName} onChange={set('lastName')} required={editing ? idOpen : step === 1} minLength={2} />
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
                onClick={() => { pickPatient(nidMatch); setMode('existing'); }}
              >{t.visitOne}ِ تازه روی همین {t.record}</button>
            </div>
          )}

          <JDate
            label="تاریخِ تولد (شمسی)"
            mode="birth"
            value={f.birthDateJ}
            onChange={(v) => setF((s2) => ({ ...s2, birthDateJ: v }))}
            placeholder="سال / ماه / روز — اختیاری"
          />
        </>
      )}

      </div>

      {/* ── گامِ ۲: نوعِ فرم ── فقط در ثبتِ تازه (طرحِ مصوبِ ۱۴۰۵/۰۷/۰۳): در ویرایش سربرگ فقط
          نامِ همین مراجعه را می‌گوید؛ سه دکمهٔ نوعِ فرم بالای **هر** مراجعه بی‌معنا و پرخطر بود
          (نوعِ مراجعهٔ ثبت‌شده را سرور هم فقط برای ادمین و بیرونِ زنجیره عوض می‌کند). */}
      {!editing && step === 2 && (<>
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
              onClick={() => pickKind(k.kind)}
            >{k.title}</button>
          ))}
        </div>
        )}
      </div>
      {serviceEl}

      </>)}

      {/* ── گامِ ۳: تکمیل ── */}
      {(editing || step === 3) && (<>
      {/* سربرگ (طرحِ مصوبِ ۱۴۰۵/۰۷/۰۳): نامِ همین مراجعه + موضوع + «الصاقِ فرم» + سه منتخب. */}
      <VisitHeadBar
        title={visitTitle}
        color={kindMeta?.color ?? initial?.kindColor ?? null}
        topic={topicName}
        pins={prefs.subformPins}
        byKey={catByKey}
        kind={f.kind}
        attached={attachedIn(isSurgery ? phase : '')}
        pinPhase={isSurgery ? PHASE_FA[phase] : null}
        onAttach={() => openPicker(phase)}
        onPin={(it) => attachSub(it, isSurgery ? phase : '')}
        disabled={busy || !subLoaded}
        showAttach={canAttach}
      />
      {editing && serviceEl}
      {/* کارتِ خودِ فرم: زمینهٔ جدا + لبهٔ رنگیِ فرمِ انتخاب‌شده. */}
      <div
        className="db-formcard"
        style={kindMeta?.color ? { '--k': `var(--kind-${kindMeta.color})` } : undefined}
      >
      {/* فرمِ عمل ستونِ زیرفرم ندارد (کارت‌ها در تبِ مرحلهٔ خودشان‌اند) و ستونِ کناری‌اش فقط «مبلغ» و
          «توضیحات» است — دوستونه یعنی نیمهٔ خالی؛ پس یک‌ستونه، و همان دو کادر زیرِ هسته. */}
      <div className={`vf-cols${isSurgery ? ' vf-flat' : ''}`}>
        <div className="vf-main">
          {/* ⚠️ فیلدهای هسته‌ای **به ترتیبِ تعریف** چیده می‌شوند، نه به ترتیبِ این
              فایل. هر کدام یک ورودیِ نام‌دار است تا `orderBuiltins` بتواند
              جابه‌جاشان کند. `wide` یعنی تمامِ عرضِ ردیف را بگیرد. */}
          <div className="db-grid2 db-builtins">{mainKeys.map(cell)}</div>

          {/* رکوردهای قدیمی متنِ آزاد دارند؛ تا وقتی به نوعِ عمل وصل نشده‌اند نمایش داده می‌شود. */}
          {!f.procedureTypeIds.length && f.opType && (
            <label className="db-field"><span>نوعِ عمل (متنِ قدیمی)</span>
              <input type="text" value={f.opType} onChange={set('opType')} />
              <small className="db-hint">برای گزارش‌گیری، از فهرستِ بالا یکی را انتخاب کنید.</small>
            </label>
          )}

          {/* فیلدهای دلخواهِ سوپرادمین — بی جعبه و عنوانِ جدا، زیرِ هسته. */}
          {restFields.length > 0 && (
            <div className="db-extra vf-extra">
              <DynForm assistance
                fields={restFields}
                values={extra}
                errors={extraErr}
                onChange={setExtra}
                disabled={busy}
                myRole={myRole}
                onVoice={onVoice}
                voiceUrl={voiceUrl}
              />
            </div>
          )}
        </div>

        <div className="vf-sub" data-subforms>{subCards}</div>

        <div className="vf-side">
          {sideKeys.length > 0 && <div className="db-grid2 db-builtins">{sideKeys.map(cell)}</div>}
          {/* ── برنامهٔ پیام‌ها — چه پیامکی چه وقت می‌رود (گزارشِ کاربر) ── */}
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
        </div>
      </div>
      </div>

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
          {/* ── عمل‌های همزمانِ قالب‌دار (بستهٔ ۷ج) ──
              ⚠️ پیامکِ مراقبت و روزهای پیگیری **فقط از عملِ اصلی** است (سرور،
              `reminders.service`)؛ این خط همین را همان‌جا که کاربر عمل را
              انتخاب کرده می‌گوید، نه بعد از رسیدنِ پیامِ ناقص به بیمار. افزودنِ
              قالبِ عملِ دوم کارِ صریحِ کاربر است — یک ضربه، به متنِ اختصاصی. */}
          {otherCare.length > 0 && (
            <div className="db-careother" data-section="care-other">
              <p>
                مراقبت و روزهای پیگیری فقط از عملِ اصلی («{procDefaults.name}») فرستاده می‌شود؛
                قالبِ {otherCare.map((p) => `«${p.name}»`).join('، ')} ارسال نمی‌شود.
              </p>
              {otherCare.some((p) => p.preOpCare || p.postOpCare) && (
                <div className="db-careother-btns">
                  {otherCare.filter((p) => p.preOpCare || p.postOpCare).map((p) => (
                    <button key={p.id} type="button" onClick={() => appendCare(p)}>
                      افزودنِ متنِ «{p.name}» به متنِ اختصاصی
                    </button>
                  ))}
                </div>
              )}
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
            items={PHASE_ITEMS}
          />

          {phase === 'pre' && (
          <div className="db-phase" data-phase="pre">
          {decidedCard}
          {/* ── مراقبتِ قبل از عمل ── */}
          <div className="db-careblock">
            <div className="db-carehead">
              <span>مراقبت‌های قبل از عمل — پیامک به بیمار</span>
              <i>{preWhen}</i>
            </div>
            {opIsToday && (
              <p className="db-decide-hint">
                عملْ همین امروز است — معمولاً دیگر پیامِ «قبل از عمل» لازم نیست؛ اگر لازم است، «به‌محضِ ثبت» را بزنید.
              </p>
            )}
            {careField('pre')}
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

          {phaseSubs('pre')}
          {phaseDocs}
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
              <p className="db-decide-hint">فیلدهای حینِ عمل (ساعتِ شروع/پایان{isClinicCore ? '' : '، یافته‌ها'}، شرحِ عمل) در فرم‌ساز برای این فرم خاموش‌اند.</p>
            )}

            {phaseSubs('intra')}
            {phaseDocs}
          </div>
          )}

          {phase === 'post' && (
          <div className="db-phase" data-phase="post">
          {/* ── مراقبتِ بعد از عمل ── */}
          <div className="db-careblock">
            <div className="db-carehead">
              <span>مراقبت‌های بعد از عمل — پیامک به بیمار</span>
              <i>{postWhen}</i>
            </div>
            {careField('post')}
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
              className="db-field jd-next"
              value={f.nextVisitDateJ}
              onChange={(v) => setF((s2) => ({ ...s2, nextVisitDateJ: v }))}
              placeholder="سال / ماه / روز"
            />
          </div>

          {phaseSubs('post')}
          {phaseDocs}
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


      <AttachPicker
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        visitWord={isSurgery ? 'عمل' : t.visit}
        groups={catalog?.groups ?? []}
        items={attachItems}
        attached={attachedIn(isSurgery ? pickPhase : '')}
        pins={prefs.subformPins}
        onPin={pinSub}
        onAttach={(it) => attachSub(it, isSurgery ? pickPhase : '')}
        canBuild={canBuildSubform}
        phases={isSurgery ? PHASE_ITEMS : null}
        phase={pickPhase}
        onPhase={setPickPhase}
      />

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
        {busy ? 'در حال ذخیره…' : editing ? 'ذخیرهٔ تغییرات' : f.kind === 'surgery' ? t.surgeryOne : t.visitOne}
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
    </AiContext.Provider>
  );
}

/* ⚠️ نگاشتِ نوعِ سند این‌جا **نبود که باشد**: نسخهٔ قبلی `discharge`،
   `progress` و `history` را نداشت و `followup`ی داشت که اصلاً نوعِ معتبری
   نیست — پس از روزِ افزودنِ خلاصهٔ ترخیص، کلیدِ خام روی صفحه چاپ می‌شد.
   حالا برچسب همراهِ خودِ سند می‌آید (`kindFa`). */
/* ⚠️ نگاشتِ وضعیتِ سفارش هم برداشته شد. این یکی بدترینشان بود: «منتظرِ پاسخ»
   و «پاسخ آمده» در حالی که همان سفارش در شیتِ خودش «فرستاده شد — منتظرِ
   نتیجه» و «نتیجه آمد — بررسی نشده» بود. حالا از `/config.statuses.order`. */

/**
 * **خلاصهٔ کوچکِ بیمار** بالای فرمِ ویرایش (اصلاحِ مالک ۱۴۰۵/۰۷/۰۲) — مثلِ کارتِ
 * جزئیاتِ ملک‌طب: همهٔ جزئیات، ولی دوستونهٔ ریز تا چشم گم نشود. تا دیروز یک کارتِ
 * بزرگ و زیرش کلِ بخشِ «پرونده» با پنج کادرِ ورودی بالای **هر** فرم می‌نشست؛ هم جا
 * می‌گرفت هم کاربر را گیج می‌کرد. حالا کادرهای مشخصات پشتِ «ویرایشِ مشخصات» است.
 *
 * همان چیزهای کارتِ آماده‌سازی (W3.2، §۴.۴) هم این‌جاست: حساسیت و داروی بیمار
 * **باز** (نباید دیده نشود)، سابقه **بسته**. هیچ عددی این‌جا حساب نمی‌شود: مانده و
 * سن از سرور می‌آیند؛ موبایل و کد ملی از خودِ فرم، تا ویرایشِ همین حالا دیده شود.
 */
function PatientSummary({ prep: raw, f, idOpen, onToggleId }) {
  const orderFa = useStatusMap('order');
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

  const name = p.fullName || `${f.firstName} ${f.lastName}`.trim();
  const rows = [
    ['موبایل', f.phone, true],
    ['کد ملی', f.nationalId, true],
    ['تاریخِ تولد', f.birthDateJ],
    p.bloodType && ['گروهِ خون', p.bloodType, true],
    p.insurer && ['بیمه', p.insurer],
  ].filter(Boolean);

  return (
    <section className="db-psum" aria-label="خلاصهٔ بیمار" data-patient-summary>
      <div className="db-psum-head">
        <b>{name || '—'}</b>
        {p.code && <span dir="ltr">{p.code}</span>}
        {p.age != null && <span>{faNum(p.age)} ساله</span>}
        <button type="button" className="db-psum-edit" aria-expanded={idOpen} onClick={onToggleId} data-act="edit-identity">
          {idOpen ? 'بستنِ مشخصات' : 'ویرایشِ مشخصات'}
        </button>
      </div>
      <dl className="db-psum-grid">
        {rows.map(([k, v, ltr]) => (
          <div key={k}><dt>{k}:</dt><dd dir={ltr && v ? 'ltr' : undefined}>{v ? jToFa(v) : '—'}</dd></div>
        ))}
      </dl>
      {risky.length > 0 && (
        <ul className="db-prep-risk db-psum-risk">
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
                  <b>{n.kindFa ?? n.kind}</b>
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
                  <i className={o.status}>{o.statusFa ?? orderFa[o.status] ?? o.status}</i>
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
