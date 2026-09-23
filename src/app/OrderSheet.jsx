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
export const canReviewOrder = (o) => !!o?.id && ['answered', 'in_review'].includes(o.status);

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
      <span className="od-label">پاسخِ بیمار — {faNum(docs.length)} مورد</span>
      <ul className="od-doc-list">
        {docs.map((d) => (
          <li key={d.id} className="od-doc">
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
              {d.title || d.fileName}
              {d.createdAt ? ` · ${faDate(d.createdAt)}` : ''}
              {d.externalUser ? ` · ورود: ${d.externalUser}${d.externalPass ? ` / ${d.externalPass}` : ''}` : ''}
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
    resultText: order?.resultText ?? order?.answerText ?? '',
    resultLink: order?.resultLink ?? order?.answerLink ?? '',
    resultUser: order?.resultUser ?? '',
    resultPass: order?.resultPass ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const [reviewNote, setReviewNote] = useState(order?.reviewNote ?? '');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const reviewable = canReviewOrder(order);

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
      if (meta.hasResult) {
        await api(`/orders/${kind}/${order.id}`, { method: 'PATCH', body: body() });
      }
      // یادداشتِ خالی برای «بررسی شد» مجاز است؛ برچسبِ پیش‌فرض را **سرور** می‌گذارد
      // (قانون یک‌جا بماند، وگرنه دو لایه دو حرفِ متفاوت می‌زنند).
      await api(`/orders/${kind}/${order.id}/review`, { method: 'POST', body: { status, reviewNote: note } });
      onToast(status === 'reviewed' ? 'ثبت شد — بررسی ثبت شد ✓' : 'ثبت شد — بیمار باید دوباره بفرستد');
      onSaved();
      onClose();
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };
  const toggle = (k, v) => setF((s) => ({
    ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v],
  }));

  const body = () => {
    const out = { patientId, visitId, note: f.note.trim() };
    if (kind === 'lab') { out.tests = f.tests; }
    if (kind === 'imaging') { out.modalities = f.modalities; out.region = f.region.trim(); }
    if (kind === 'consult' || kind === 'referral') {
      out.specialty = f.specialty.trim(); out.doctorName = f.doctorName.trim();
    }
    if (meta.hasDue) out.dueDate = f.dueJ.trim() ? jStrToIso(f.dueJ) : null;
    if (meta.hasResult) {
      if (kind === 'consult') { out.answerText = f.resultText.trim(); out.answerLink = f.resultLink.trim(); }
      else {
        out.resultText = f.resultText.trim(); out.resultLink = f.resultLink.trim();
        out.resultUser = f.resultUser.trim(); out.resultPass = f.resultPass.trim();
      }
    }
    return out;
  };

  const save = async (thenSend) => {
    if (meta.hasDue && f.dueJ.trim() && !jStrToIso(f.dueJ)) { onToast('تاریخِ مهلت نامعتبر است'); return; }
    setBusy(true);
    try {
      const saved = order?.id
        ? await api(`/orders/${kind}/${order.id}`, { method: 'PATCH', body: body() })
        : await api(`/orders/${kind}`, { method: 'POST', body: body() });
      if (thenSend) {
        const res = await api(`/orders/${kind}/${saved.id}/send`, { method: 'POST' });
        onToast(res?.stub ? 'ثبت شد ✓ (سرویسِ پیامک آزمایشی است)' : `لینک برای بیمار فرستاده شد ✓ ${res?.to ?? ''}`);
      } else {
        onToast('ثبت شد ✓');
      }
      onSaved();
      onClose();
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  return (
    <Overlay onClose={onClose} closable={!busy} backdrop="od-bg" panel="glass od-sheet"
      role="dialog" aria-modal="true" aria-label={meta.fa}>
      <div className="od-head">
        <h3>{meta.fa}</h3>
        <button type="button" className="db-x" disabled={busy} onClick={onClose} aria-label="بستن">×</button>
      </div>

      {kind === 'lab' && (
        <div className="od-block">
          <span className="od-label">آزمایش‌های روتین — تیک بزنید</span>
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

      {meta.hasResult && (
        <div className="od-block od-result">
          <span className="od-label">پاسخ — اگر رسیده</span>
          {order?.id && (
            <p className={`od-status st-${order.status}`}>
              وضعیت: <b>{order.statusFa ?? orderFa[order.status] ?? order.status}</b>
              {order.reviewNote && !reviewable && <i> — {order.reviewNote}</i>}
            </p>
          )}
          {(order?.documents ?? []).length > 0 && <AnswerDocs docs={order.documents} onToast={onToast} />}
          <label className="db-field"><span>متنِ پاسخ</span>
            <AssistedTextarea disabled={busy} rows={2} value={f.resultText} onChange={set('resultText')} placeholder="خلاصهٔ جواب" />
          </label>
          <label className="db-field"><span>لینکِ پاسخ</span>
            <input dir="ltr" value={f.resultLink} onChange={set('resultLink')} placeholder="https://…" />
          </label>
          {/* توضیحِ صوتیِ کارکنان زیرِ لینک (بستهٔ ۶د) — «رادیولوژیست تلفنی گفت…».
              مدرکِ همان پرونده و مراجعه می‌شود، با دستهٔ همین سفارش. */}
          <div className="db-field od-voice"><span>توضیحِ صوتی (اختیاری)</span>
            <VoiceNote
              disabled={busy}
              onSave={async (file) => {
                const fdv = new FormData();
                fdv.append('file', file);
                fdv.append('category', kind === 'imaging' ? 'imaging' : kind === 'lab' ? 'lab' : 'report');
                fdv.append('title', `توضیحِ صوتی — ${meta.fa}${f.specialty ? ` — ${f.specialty}` : ''}`.slice(0, 120));
                if (visitId) fdv.append('visitId', String(visitId));
                await apiUpload(`/patients/${patientId}/documents`, fdv);
                onToast('توضیحِ صوتی در مدارکِ پرونده ثبت شد ✓');
              }}
            />
          </div>
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
              await apiUpload(`/patients/${patientId}/documents`, fd);
            }}
            onAllDone={() => onToast('عکسِ جواب در مدارکِ پرونده ثبت شد ✓')}
          />
          {reviewable && (
            <div className="od-review">
              <span className="od-label">تصمیمِ بررسی</span>
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
