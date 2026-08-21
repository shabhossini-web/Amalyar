/**
 * فرمِ سفارشِ بالینی — آزمایش، تصویربرداری، مشاوره، ارجاع.
 *
 * روی همان چیپِ تصمیمِ فرمِ ویزیت باز می‌شود: پر می‌شود، ذخیره می‌شود، و
 * لینکش برای بیمار می‌رود. چهار نوع، یک پوسته — چون کاربر یک الگو یاد
 * می‌گیرد و همه‌جا همان را می‌بیند؛ فیلدهای اختصاصیِ هر نوع داخلِ همین
 * پوسته عوض می‌شوند.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { jStrToIso, isoToJStr } from '../lib/jalali.js';
import Overlay from '../ui/Overlay.jsx';
import JDate from './JDate.jsx';
import VoiceInput from '../ui/VoiceInput.jsx';
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

/**
 * میزبانِ شیت — ⚠️ `AnimatePresence` **این‌جا** می‌ماند، نه در والد و نه
 * داخلِ خودِ شیت: میزبان همیشه سوار است، پس وقتی شیت بسته می‌شود
 * AnimatePresence هنوز هست و انیمیشنِ خروج واقعاً اجرا می‌شود.
 */
export default function OrderSheetHost({ open, ...rest }) {
  return (
    <AnimatePresence>
      {open && <OrderSheet {...rest} />}
    </AnimatePresence>
  );
}

function OrderSheet({ kind, patientId, visitId, order, onClose, onSaved, onToast }) {
  const meta = ORDER_META[kind] ?? ORDER_META.lab;
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
  const [sttOn, setSttOn] = useState(false);
  useEffect(() => {
    let on = true;
    api('/ai/status').then((r) => { if (on) setSttOn(!!r?.stt); }).catch(() => {});
    return () => { on = false; };
  }, []);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
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
    <Overlay onClose={onClose} backdrop="od-bg" panel="glass od-sheet">
      <div className="od-head">
        <h3>{meta.fa}</h3>
        <button type="button" className="db-x" onClick={onClose} aria-label="بستن">×</button>
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
        <textarea rows={3} value={f.note} onChange={set('note')} />
      </label>
      {sttOn && (
        <div className="db-aibar">
          <VoiceInput
            disabled={busy}
            onText={(t) => setF((s) => ({ ...s, note: s.note.trim() ? `${s.note}\n${t}` : t }))}
            onErr={(m) => onToast(m)}
          />
        </div>
      )}

      {meta.hasDue && (
        <JDate label="مهلتِ انجام و ارسالِ پاسخ" value={f.dueJ}
               onChange={(v) => setF((s) => ({ ...s, dueJ: v }))} placeholder="اختیاری" />
      )}

      {meta.hasResult && (
        <div className="od-block od-result">
          <span className="od-label">پاسخ — اگر رسیده</span>
          <label className="db-field"><span>متنِ پاسخ</span>
            <textarea rows={2} value={f.resultText} onChange={set('resultText')} placeholder="خلاصهٔ جواب" />
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
          <p className="db-decide-hint">
            عکسِ جوابْ در پروندهٔ بیمار، تبِ «مدارک» بارگذاری می‌شود تا در تاریخچه بماند.
          </p>
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
