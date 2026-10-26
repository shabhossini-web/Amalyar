import AssistedTextarea from '../ui/AssistedTextarea.jsx';
/**
 * فرمِ سفارشِ بالینی — آزمایش، تصویربرداری، مشاوره، ارجاع.
 *
 * روی همان چیپِ تصمیمِ فرمِ ویزیت باز می‌شود: پر می‌شود، ذخیره می‌شود، و
 * لینکش برای بیمار می‌رود. چهار نوع، یک پوسته — چون کاربر یک الگو یاد
 * می‌گیرد و همه‌جا همان را می‌بیند؛ فیلدهای اختصاصیِ هر نوع داخلِ همین
 * پوسته عوض می‌شوند.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { api, apiBlobUrl, apiUpload } from '../lib/api.js';
import { jStrToIso, isoToJStr, faDate } from '../lib/jalali.js';
import { DocThumb, isImageDoc, openDoc } from '../ui/DocThumb.jsx';
import VoiceNote, { VoiceClip } from '../ui/VoiceNote.jsx';
import Overlay from '../ui/Overlay.jsx';
import JDate from './JDate.jsx';
import FileDrop from '../ui/FileDrop.jsx';
import { useStatusMap } from './config.jsx';
import './orders.css';

/** پنلِ روتینِ آزمایش — استاندارد و کامل، تیک‌خور. */
export const LAB_PANEL = [
  'CBC diff', 'ESR', 'CRP', 'FBS', 'BUN', 'Creatinine', 'Na', 'K', 'Ca', 'Mg',
  'AST', 'ALT', 'ALP', 'Bilirubin (T/D)', 'Albumin', 'PT', 'PTT', 'INR',
  'U/A', 'U/C', 'Blood Group & Rh', 'HBs Ag', 'HCV Ab', 'HIV Ab', 'TSH',
  'Cholesterol', 'Triglyceride', 'HbA1c',
];
export const IMAGING_MODALITIES = [
  'رادیوگرافی (X-Ray)', 'سونوگرافی', 'سی‌تی‌اسکن (CT)', 'ام‌آر‌آی (MRI)',
  'ماموگرافی', 'اکوکاردیوگرافی', 'اندوسکوپی', 'کولونوسکوپی', 'نوارِ عصب و عضله (EMG/NCV)',
];

export const ORDER_META = {
  lab: { fa: 'درخواستِ آزمایش', hasDue: true, hasResult: true },
  imaging: { fa: 'درخواستِ تصویربرداری', hasDue: true, hasResult: true },
  consult: { fa: 'درخواستِ مشاوره', hasDue: false, hasResult: true },
  referral: { fa: 'نامهٔ ارجاع', hasDue: false, hasResult: false },
};

/* ⚠️ نگاشتِ فارسیِ وضعیتِ سفارش برداشته شد: چهار نسخه بود و هر چهار فرق
   داشتند («نتیجه آمد — بررسی نشده» این‌جا، «پاسخ آمده» در فرمِ مراجعه،
   «نتیجه آمده» در میزِ پزشک). حالا از `/config.statuses.order` می‌آید. */
/** سفارشی که پاسخش آمده و هنوز تصمیمی رویش ثبت نشده — همین‌جا بررسی می‌شود. */
export const canReviewOrder = (o) => !!o?.id && (['answered', 'in_review'].includes(o.status)
  /* «بررسی شد» که بیمار بعدش چیزِ تازه فرستاده دوباره بررسی‌پذیر است (سرور هم همین را می‌پذیرد). */
  || (o.status === 'reviewed' && (o.documents ?? []).some((d) => d.fresh)));

const faNum = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/**
 * آنچه **بیمار** فرستاده (W0.8): عکس/PDF، متن، یا لینک — همه به‌شکلِ مدرکِ
 * پرونده با `refType=<kind>_order` ثبت می‌شوند و همراهِ سفارش می‌آیند.
 *
 * ⚠️ تا دیروز شیت این‌ها را **اصلاً نشان نمی‌داد**: پزشک فرمِ مشاوره را باز
 * می‌کرد و «پاسخِ خالی» می‌دید در حالی که عکسِ بیمار در مدارکِ پرونده نشسته
 * بود (گزارشِ مالک، ۱۴۰۵/۰۶/۲۹). پاسخی که در فرمِ خودش دیده نشود، عملاً
 * نرسیده.
 */
function AnswerDocs({ docs, onToast }) {
  return (
    <div className="od-docs">
      {/* برچسبِ بی‌طرف: این فهرست هم فایلِ بیمار را دارد و هم صدایی که کارمند خودش توی همین شیت ضبط کرده. */}
      <span className="od-label">{faNum(docs.length)} مورد — پاسخ</span>
      <ul className="od-doc-list">
        {docs.map((d) => (
          <li key={d.id} className={`od-doc${String(d.mimeType ?? '').startsWith('audio/') ? ' is-audio' : ''}`}>
            {isImageDoc(d) ? (
              <button type="button" className="od-doc-thumb" title="بازکردن در اندازهٔ کامل" onClick={() => openDoc(d, onToast)}>
                <DocThumb id={d.id} alt={d.title || d.fileName} />
              </button>
            ) : String(d.mimeType ?? '').startsWith('audio/') ? (
              /* توضیحِ صوتیِ بیمار (بستهٔ ۶د) — پخش همین‌جا، نه دانلود. */
              <VoiceClip load={() => apiBlobUrl(`/patients/documents/${d.id}/file`)} name={d.title || 'توضیحِ صوتی'} />
            ) : d.contentText ? (
              <p className="od-doc-text">{d.contentText}</p>
            ) : d.externalUrl ? (
              <a className="od-doc-link" href={d.externalUrl} target="_blank" rel="noopener noreferrer" dir="ltr">{d.externalUrl}</a>
            ) : (
              <button type="button" className="od-doc-file" onClick={() => openDoc(d, onToast)}>{d.fileName}</button>
            )}
            <small>
              {/* چه کسی فرستاد — تا ۱۴۰۵/۰۸/۰۴ فایلِ بیمار و پیوستِ کارکنان بی‌نشان کنارِ هم بودند. */}
              <i className={`od-from ${d.from === 'patient' ? 'patient' : ''}`}>{d.from === 'patient' ? 'از بیمار' : 'از کارکنان'}</i>
              {d.fresh && <i className="od-from fresh">تازه پس از بررسی</i>}
              {/* صدا نامش را خودِ پخش‌کننده بالا نشان می‌دهد؛ تکرارش در کپشن فقط شلوغی بود. */}
              {[
                String(d.mimeType ?? '').startsWith('audio/') ? null : (d.title || d.fileName),
                d.createdAt ? faDate(d.createdAt) : null,
                d.externalUser ? `ورود: ${d.externalUser}${d.externalPass ? ` / ${d.externalPass}` : ''}` : null,
              ].filter(Boolean).join(' · ')}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * میزبانِ شیت — ⚠️ `AnimatePresence` **این‌جا** می‌ماند، نه در والد و نه
 * داخلِ خودِ شیت: میزبان همیشه سوار است، پس وقتی شیت بسته می‌شود
 * AnimatePresence هنوز هست و انیمیشنِ خروج واقعاً اجرا می‌شود.
 */
export default function OrderSheetHost({ open, ...rest }) {
  // بیرونِ شیتِ ویزیت: transform/backdrop-filter و overflow والد، fixed را می‌بُرند.
  return createPortal(
    <AnimatePresence>
      {open && <OrderSheet key={`${rest.kind}-${rest.order?.id ?? 'new'}`} {...rest} />}
    </AnimatePresence>,
    document.body,
  );
}

function OrderSheet({ kind, patientId, visitId, order, onClose, onSaved, onToast }) {
  const meta = ORDER_META[kind] ?? ORDER_META.lab;
  const orderFa = useStatusMap('order');
  const [f, setF] = useState(() => ({
    tests: order?.tests ?? [],
    modalities: order?.modalities ?? [],
    region: order?.region ?? '',
    specialty: order?.specialty ?? '',
    doctorName: order?.doctorName ?? '',
    note: order?.note ?? '',
    dueJ: order?.dueDate ? isoToJStr(order.dueDate) : '',
    /* «هر ارسال، پاسخِ جدا»: این کادرها برای **پاسخِ تازه‌ای** است که کارکنان ثبت می‌کنند — پاسخ‌های قبلی
       کارتِ خودشان را دارند و دیگر در کادرِ قابلِ‌ویرایش پیش‌پر نمی‌شوند (ذخیرهٔ دوباره آن‌ها را بازنویسی می‌کرد). */
    resultText: '',
    resultLink: '',
    resultUser: '',
    resultPass: '',
  }));
  const [busy, setBusy] = useState(false);
  /* هشدار: سفارشِ **تازه‌شدهٔ** سرور بعد از وصل‌کردنِ صدا (`PATCH documentIds`) — وضعیت و فهرستِ مدارکِ همین
     شیت از اینجا می‌آید تا صدای ضبط‌شده همان لحظه دیده شود، نه فقط پس از بستن و بازکردنِ دوباره.
     `pending` صداهایی است که پیش از ساخته‌شدنِ سفارش ضبط شده‌اند و با «ثبت» به آن می‌پیوندند. */
  const [live, setLive] = useState(null);
  const [pending, setPending] = useState([]);
  const ord = live ?? order;
  const [reviewNote, setReviewNote] = useState(order?.reviewNote ?? '');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const reviewable = canReviewOrder(ord);
  /* درخواستِ ارسال‌شده قفل است (سرور هم رد می‌کند) — بیمار بر پایهٔ همین پاسخ می‌دهد. */
  const locked = !!ord?.id && ord.status !== 'draft';
  const [received, setReceived] = useState(() => order?.receivedItems ?? []);
  const responses = ord?.responses ?? [];
  const items = ord?.items ?? [];
  /* صدای کارکنان روی سفارش = توضیحِ **درخواست**، نه پاسخ — جایش کنارِ «توضیح برای بیمار» است. */
  const reqVoices = (ord?.documents ?? []).filter((d) => d.requestNote);
  /* مدارکِ قدیمیِ بی‌پاسخ (پیش از «پاسخِ جدا») — جایی نمی‌روند، فقط جدا دیده می‌شوند. */
  /* فایلِ بیمار که هنوز با «ارسال» به پاسخی نپیوسته پیش‌نویس است و این‌جا نمی‌آید. */
  const answerDocs = (ord?.documents ?? []).filter((d) => !d.requestNote && !d.responseId && d.from !== 'patient');

  /** پیوستِ کارکنان به **خودِ سفارش** (صدای درخواست یا عکسِ جواب)؛ سفارشِ هنوز ساخته‌نشده → با «ثبت». */
  const attach = async (doc, title, okMsg) => {
    if (ord?.id) {
      try {
        setLive(await api(`/orders/${kind}/${ord.id}`, { method: 'PATCH', body: { documentIds: [doc.id] } }));
        onSaved?.();
        onToast(okMsg);
      } catch (e) {
        onToast(`در مدارکِ پرونده ثبت شد ولی به این فرم وصل نشد — ${e.message}`);
      }
    } else if (doc?.id) {
      setPending((list) => [...list, { id: doc.id, title, audio: String(doc.mimeType ?? '').startsWith('audio/') }]);
      onToast(`${okMsg} — با «ثبت» به این فرم می‌پیوندد`);
    }
  };

  /**
   * تصمیمِ بررسی — `POST /orders/:kind/:id/review` (CONTRACTS §۴/§۵).
   *
   * ⚠️ تا امروز این endpoint هیچ دکمه‌ای در رابط نداشت: تنها راهِ «بررسی»
   * زدنِ «انجام شد» روی کارِ `review_result` بود که فقط کار را می‌بست و
   * خودِ سفارش `answered` می‌ماند — پرونده تا ابد «۲ نتیجه آمده و بررسی
   * نشده» نشان می‌داد (اسکرین‌شاتِ مالک). حالا تصمیم روی خودِ سفارش ثبت
   * می‌شود و رویدادِ `order.reviewed` کارِ بررسی را خودش می‌بندد.
   */
  const review = async (status) => {
    const note = reviewNote.trim();
    /* دلیلِ «ناقص است» اجباری می‌ماند چون **بیمار همان را می‌خواند** و باید
       بداند دوباره چه بفرستد. ولی «بررسی شد» نه: پزشک خلاصهٔ جواب را همین بالا
       در «متنِ پاسخ» نوشته و اجبارِ یک یادداشتِ دوم فقط راه را می‌بست — کاربر
       دکمه را می‌زد، یک توست می‌آمد و هیچ اتفاقی نمی‌افتاد (گزارشِ مالک
       ۱۴۰۵/۰۶/۳۰). خالی که باشد، خودِ سیستم «بررسی شد» می‌نویسد. */
    if (status !== 'reviewed' && !note) {
      onToast('دلیلِ ناقص‌بودن را بنویسید — بیمار همان را می‌بیند');
      return;
    }
    setBusy(true);
    try {
      /* ⚠️ اول **ذخیره**، بعد بررسی. تا دیروز این تابع فقط `{status, reviewNote}`
         می‌فرستاد؛ یعنی «متنِ پاسخ»، لینک، نام کاربری و رمزی که پزشک همان لحظه
         تایپ کرده بود با بسته‌شدنِ شیت **بی‌صدا دور ریخته می‌شد**. تصمیمی که روی
         جوابی گرفته شده که ذخیره نشده، ردِ ممیزی ندارد. */
      /* `ord` نه `order`: دکمه‌های بررسی از `ord` تصمیم می‌گیرند، پس سفارشی که همین شیت ساخته (و `order`ِ ورودی‌اش
         تهی است) هم باید با همان شناسه بررسی شود — وگرنه `undefined.id`. */
      if (meta.hasResult) {
        await api(`/orders/${kind}/${ord.id}`, { method: 'PATCH', body: body() });
      }
      // یادداشتِ خالی برای «بررسی شد» مجاز است؛ برچسبِ پیش‌فرض را **سرور** می‌گذارد
      // (قانون یک‌جا بماند، وگرنه دو لایه دو حرفِ متفاوت می‌زنند).
      await api(`/orders/${kind}/${ord.id}/review`, { method: 'POST', body: { status, reviewNote: note, ...(items.length ? { receivedItems: received } : {}) } });
      onToast(status === 'reviewed' ? 'ثبت شد — بررسی ثبت شد' : 'ثبت شد — بیمار باید دوباره بفرستد');
      onSaved();
      onClose();
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };
  const toggle = (k, v) => setF((s) => ({
    ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v],
  }));

  const body = () => {
    const out = { patientId, visitId };
    /* درخواستِ قفل‌شده دیگر فرستاده نمی‌شود — تغییری ندارد و مقایسهٔ تاریخ هم بی‌مورد ۴۰۹ می‌داد. */
    if (!locked) {
      out.note = f.note.trim();
      if (kind === 'lab') { out.tests = f.tests; }
      if (kind === 'imaging') { out.modalities = f.modalities; out.region = f.region.trim(); }
      if (kind === 'consult' || kind === 'referral') {
        out.specialty = f.specialty.trim(); out.doctorName = f.doctorName.trim();
      }
      if (meta.hasDue) out.dueDate = f.dueJ.trim() ? jStrToIso(f.dueJ) : null;
    }
    /* صداهای پیش از ساختِ سفارش (حداکثر ۵ در هر درخواست — سقفِ سرور) با «ثبت» به همین سفارش می‌پیوندند. */
    if (pending.length) out.documentIds = pending.map((x) => x.id).slice(0, 5);
    /* پاسخِ تازهٔ کارکنان — فقط کادرهای پرشده؛ خالی یعنی «پاسخی ثبت نمی‌کنم»، نه «پاسخِ قبلی را پاک کن». */
    if (meta.hasResult) {
      const put = (k, v) => { if (v.trim()) out[k] = v.trim(); };
      if (kind === 'consult') { put('answerText', f.resultText); put('answerLink', f.resultLink); }
      else { put('resultText', f.resultText); put('resultLink', f.resultLink); put('resultUser', f.resultUser); put('resultPass', f.resultPass); }
    }
    return out;
  };

  const save = async (thenSend) => {
    if (meta.hasDue && f.dueJ.trim() && !jStrToIso(f.dueJ)) { onToast('تاریخِ مهلت نامعتبر است'); return; }
    setBusy(true);
    let saved = null;
    try {
      /* ⚠️ `ord` نه `order`: سفارشی که همین شیت ساخته به‌محضِ ساخت شناخته می‌شود. تا امروز ارسالِ ناموفقِ پیامک شیت را
         باز می‌گذاشت و «ثبت و ارسال»ِ دوباره (با `order` هنوز تهی) **سفارشِ دومی** می‌ساخت. */
      saved = ord?.id
        ? await api(`/orders/${kind}/${ord.id}`, { method: 'PATCH', body: body() })
        : await api(`/orders/${kind}`, { method: 'POST', body: body() });
      setLive(saved);
      setPending([]);
      if (thenSend) {
        const res = await api(`/orders/${kind}/${saved.id}/send`, { method: 'POST' });
        onToast(res?.stub ? 'ثبت شد (سرویسِ پیامک آزمایشی است)' : `لینک برای بیمار فرستاده شد${res?.to ? ` به ${res.to}` : ''}`);
      } else {
        onToast('ثبت شد');
      }
      onSaved();
      onClose();
    } catch (e) {
      /* سفارش ذخیره است ولی پیامک نرفت: علتِ واقعی (از سرور) دیده می‌شود، فهرست تازه می‌شود و شیت باز می‌ماند تا
         همان سفارش دوباره فرستاده شود — نه یک سفارشِ تازه. */
      const msg = String(e?.message ?? '');
      if (saved) onSaved();
      /* «نتیجه نامعلوم» (قطعِ شبکه با ملی‌پیامک، یا پاسخِ خودِ ما که به مرورگر نرسید) «ناموفق» نیست: شاید رفته باشد و
         ارسالِ دوباره پیامِ تکراری می‌سازد. سرور این حالت را با `code` جدا می‌کند، نه با متن. */
      onToast(!saved ? msg
        : e?.code === 'SMS_UNKNOWN' || e?.status === 0 ? 'سفارش ثبت شد؛ نتیجهٔ ارسالِ پیامک مشخص نیست — پیش از ارسالِ دوباره دفترِ پیامک‌ها را ببینید یا از بیمار بپرسید'
          : /ثبت شد/.test(msg) ? msg : `سفارش ثبت شد ولی ارسالِ پیامک ناموفق بود — ${msg}`);
    } finally { setBusy(false); }
  };

  return (
    <Overlay onClose={onClose} closable={!busy} backdrop="od-bg" panel="glass od-sheet"
      role="dialog" aria-modal="true" aria-label={meta.fa}>
      <div className="od-head">
        <h3>{meta.fa}</h3>
        <button type="button" className="db-x" disabled={busy} onClick={onClose} aria-label="بستن">×</button>
      </div>

      {locked && (
        <p className="od-locked">این درخواست برای بیمار فرستاده شده و <b>قفل</b> است — بیمار بر پایهٔ همین پاسخ می‌دهد. برای تغییر، درخواستِ تازه بسازید.</p>
      )}
      <fieldset className="od-req" disabled={locked}>
      {kind === 'lab' && (
        <div className="od-block">
          <span className="od-label">{locked ? 'آزمایش‌های درخواستی' : 'آزمایش‌های روتین — تیک بزنید'}</span>
          <div className="od-chips">
            {LAB_PANEL.map((t) => (
              <button key={t} type="button" dir="ltr"
                className={f.tests.includes(t) ? 'od-chip on' : 'od-chip'}
                aria-pressed={f.tests.includes(t)}
                onClick={() => toggle('tests', t)}>{t}</button>
            ))}
          </div>
        </div>
      )}

      {kind === 'imaging' && (
        <>
          <div className="od-block">
            <span className="od-label">نوعِ تصویربرداری</span>
            <div className="od-chips">
              {IMAGING_MODALITIES.map((t) => (
                <button key={t} type="button"
                  className={f.modalities.includes(t) ? 'od-chip on' : 'od-chip'}
                  aria-pressed={f.modalities.includes(t)}
                  onClick={() => toggle('modalities', t)}>{t}</button>
              ))}
            </div>
          </div>
          <label className="db-field"><span>ناحیه</span>
            <input value={f.region} onChange={set('region')} placeholder="مثلاً شکم و لگن" />
          </label>
        </>
      )}

      {(kind === 'consult' || kind === 'referral') && (
        <div className="db-grid2">
          <label className="db-field"><span>تخصص</span>
            <input value={f.specialty} onChange={set('specialty')} placeholder="مثلاً قلب و عروق" />
          </label>
          <label className="db-field"><span>نامِ پزشکِ پیشنهادی</span>
            <input value={f.doctorName} onChange={set('doctorName')} placeholder="اختیاری" />
          </label>
        </div>
      )}

      <label className="db-field"><span>{kind === 'referral' ? 'متنِ ارجاع' : 'توضیح برای بیمار / آزمایشگاه'}</span>
        <AssistedTextarea disabled={busy} rows={3} value={f.note} onChange={set('note')} />
      </label>


      {meta.hasDue && (
        <JDate label="مهلتِ انجام و ارسالِ پاسخ" value={f.dueJ}
               onChange={(v) => setF((s) => ({ ...s, dueJ: v }))} placeholder="اختیاری" />
      )}
      </fieldset>
      {/* توضیحِ صوتیِ پزشک برای بیمار — بخشی از **درخواست** است و در صفحهٔ بیمار پخش می‌شود.
          تا ۱۴۰۵/۰۸/۰۴ داخلِ بخشِ «پاسخ» بود: سفارش را «پاسخ آمد» می‌کرد و به بیمار هم نمی‌رسید. */}
      <div className="db-field od-voice od-req-voice"><span>توضیحِ صوتی برای بیمار (اختیاری)</span>
        {reqVoices.map((d) => (
          <VoiceClip key={d.id} load={() => apiBlobUrl(`/patients/documents/${d.id}/file`)} name={d.title || 'توضیحِ صوتی'} disabled={busy} />
        ))}
        {pending.filter((d) => d.audio !== false).map((d) => (
          <div key={d.id} data-pending-voices>
            <VoiceClip load={() => apiBlobUrl(`/patients/documents/${d.id}/file`)} name={d.title} disabled={busy} />
          </div>
        ))}
        <VoiceNote
          disabled={busy}
          onSave={async (file) => {
            const fdv = new FormData();
            fdv.append('file', file);
            fdv.append('category', kind === 'imaging' ? 'imaging' : kind === 'lab' ? 'lab' : 'report');
            const title = `توضیحِ صوتیِ پزشک — ${meta.fa}`.slice(0, 120);
            fdv.append('title', title);
            if (visitId) fdv.append('visitId', String(visitId));
            const doc = await apiUpload(`/patients/${patientId}/documents`, fdv);
            await attach({ ...doc, mimeType: doc?.mimeType ?? 'audio/wav' }, title, 'توضیحِ صوتی به درخواست پیوست شد');
          }}
        />
      </div>


      {meta.hasResult && (
        <div className="od-block od-result">
          <span className="od-label">{responses.length ? `پاسخ‌ها — ${faNum(responses.length)} ارسال` : 'پاسخ'}</span>
          {ord?.id && (
            <p className={`od-status st-${ord.status}`}>
              وضعیت: <b>{ord.statusFa ?? orderFa[ord.status] ?? ord.status}</b>
              {ord.reviewNote && !reviewable && <i> — {ord.reviewNote}</i>}
            </p>
          )}
          {/* «هر ارسال، پاسخِ جدا» — هر ارسال کارتِ خودش با تاریخ، فرستنده، مدارک و تصمیمِ بررسی. */}
          {responses.map((r) => (
            <div key={r.id} className={`od-resp st-${r.status}`} data-response={r.seq}>
              <div className="od-resp-head">
                <b>پاسخِ {faNum(r.seq)}</b>
                <span>{faDate(r.createdAt)} · {r.sourceFa}</span>
                <i className={`od-rst st-${r.status}`}>{r.statusFa}</i>
              </div>
              {r.documents.length > 0 && <AnswerDocs docs={r.documents} onToast={onToast} />}
              {r.text && <p className="od-doc-text">{r.text}</p>}
              {r.link && <a className="od-doc-link" href={r.link} target="_blank" rel="noopener noreferrer" dir="ltr">{r.link}</a>}
              {r.linkUser && <small dir="ltr">{r.linkUser}{r.linkPass ? ` / ${r.linkPass}` : ''}</small>}
              {r.reviewNote && <small className="od-resp-note">تصمیم: {r.reviewNote}</small>}
            </div>
          ))}
          {answerDocs.length > 0 && <AnswerDocs docs={answerDocs} onToast={onToast} />}
          {pending.some((d) => d.audio === false) && (
            <p className="od-status">{faNum(pending.filter((d) => d.audio === false).length)} عکس — با «ثبت» به همین فرم می‌پیوندد</p>
          )}
          <details className="od-staff-answer" open={!responses.length}>
          <summary>{responses.length ? 'ثبتِ پاسخِ تازه‌ای که به مطب رسیده' : 'ثبتِ پاسخ — اگر به مطب رسیده'}</summary>
          <label className="db-field"><span>متنِ پاسخ</span>
            <AssistedTextarea disabled={busy} rows={2} value={f.resultText} onChange={set('resultText')} placeholder="خلاصهٔ جواب" />
          </label>
          <label className="db-field"><span>لینکِ پاسخ</span>
            <input dir="ltr" value={f.resultLink} onChange={set('resultLink')} placeholder="https://…" />
          </label>
          {kind !== 'consult' && (
            <div className="db-grid2">
              <label className="db-field"><span>نامِ کاربری (اگر لینک رمز دارد)</span>
                <input dir="ltr" value={f.resultUser} onChange={set('resultUser')} />
              </label>
              <label className="db-field"><span>رمز</span>
                <input dir="ltr" value={f.resultPass} onChange={set('resultPass')} />
              </label>
            </div>
          )}
          {/* عکسِ جواب همان‌جا بارگذاری می‌شود و در «مدارکِ» پرونده می‌نشیند —
              با دستهٔ درست، تا بعداً در تاریخچه پیدا شود. چندصفحه‌ای هم هست. */}
          <span className="od-label">عکسِ جواب — چند صفحه هم می‌شود</span>
          <FileDrop
            accept="image/*,.pdf"
            maxMb={25}
            hint="عکس یا PDFِ جواب — در «مدارکِ» پرونده ثبت می‌شود"
            onUpload={async (file) => {
              const fd = new FormData();
              fd.append('file', file);
              fd.append('category', kind === 'imaging' ? 'imaging' : kind === 'lab' ? 'lab' : 'report');
              fd.append('title', `${meta.fa}${f.specialty ? ` — ${f.specialty}` : ''}`);
              if (visitId) fd.append('visitId', String(visitId));
              const doc = await apiUpload(`/patients/${patientId}/documents`, fd);
              /* تا ۱۴۰۵/۰۸/۰۴ عکسِ جوابی که کارکنان می‌گذاشتند فقط مدرکِ پرونده می‌شد و در همین فرم دیده نمی‌شد. */
              await attach({ ...doc, mimeType: doc?.mimeType ?? file.type }, file.name, 'عکسِ جواب به همین فرم پیوست شد');
            }}
          />
          </details>
          {reviewable && (
            <div className="od-review">
              <span className="od-label">تصمیمِ بررسی{responses.length ? ` — پاسخِ ${faNum(responses[responses.length - 1].seq)}` : ''}</span>
              {/* چک‌لیستِ کامل‌بودن: کدام موردِ درخواستی در پاسخ‌ها آمده — بیمار هم همین را می‌بیند. */}
              {items.length > 1 && (
                <div className="od-checklist" role="group" aria-label="موردهای رسیده">
                  {items.map((it) => (
                    <label key={it} className={received.includes(it) ? 'on' : ''}>
                      <input type="checkbox" checked={received.includes(it)} disabled={busy}
                        onChange={() => setReceived((r) => (r.includes(it) ? r.filter((x) => x !== it) : [...r, it]))} />
                      <bdi dir="auto">{it}</bdi>
                    </label>
                  ))}
                  <small>{faNum(received.length)} از {faNum(items.length)} رسیده</small>
                </div>
              )}
              <label className="db-field"><span>یادداشت / تصمیم</span>
                <AssistedTextarea purpose="تصمیمِ بررسیِ نتیجه" disabled={busy} rows={2} value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)} placeholder="مثلاً: نرمال — نیاز به اقدام ندارد" />
              </label>
              <div className="od-actions">
                <button type="button" className="od-send" disabled={busy} onClick={() => review('reviewed')}>بررسی شد</button>
                <button type="button" className="od-save od-warn" disabled={busy} onClick={() => review('needs_action')}>ناقص است — دوباره بفرستد</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="od-actions">
        <button type="button" className="od-send" disabled={busy} onClick={() => save(true)}>
          {busy ? 'در حالِ ارسال…' : 'ثبت و ارسال برای بیمار'}
        </button>
        <button type="button" className="od-save" disabled={busy} onClick={() => save(false)}>
          فقط ثبت
        </button>
      </div>
    </Overlay>
  );
}
