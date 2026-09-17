import { useState } from 'react';
import { useConfig } from '../app/config.jsx';
import Overlay from './Overlay.jsx';
import './cancel-reason.css';

/**
 * پرسشِ **دلیلِ لغو** — یک پنجره برای هر سه جای لغو (داشبورد، میزِ پذیرش، تقویم).
 *
 * تصمیمِ مالک (۱۴۰۵/۰۶/۲۶): لغو بی‌دلیل ثبت نشود، و بیمار **بداند چرا**.
 * پیش از این، لغو یک کلیکِ بی‌سؤال بود: بیمار هیچ خبری نمی‌گرفت و فردا سرِ
 * نوبتی می‌آمد که دیگر وجود نداشت، و کارکنان هم یک ماه بعد نمی‌دانستند چرا
 * لغو شده.
 *
 * ⚠️ **دو متن، دو مخاطب** — و همین دلیلِ وجودِ این پنجره است:
 *  - **دلیل** از فهرستِ بسته انتخاب می‌شود، چون متنش به دستِ بیمار می‌رسد.
 *    متنِ آزاد یعنی هر کارمند جملهٔ خودش را برای بیمار می‌نویسد.
 *  - **یادداشت** متنِ آزاد است و **هرگز** فرستاده نمی‌شود — همان‌جا نوشته شده
 *    تا کارمند وسوسه نشود حرفِ داخلی را در دلیل بگذارد.
 *
 * ⚠️ پیش‌نمایشِ پیامک تزئین نیست: بدونِ آن، انتخابِ دلیل یک برچسبِ اداری است
 * («تعویقِ پزشک») و کارمند نمی‌داند بیمار چه می‌خواند. متن از سرور می‌آید،
 * ساختهٔ همان تابعی که پیامک را می‌سازد (قانون ۱۵) — نه بازنویسیِ کلاینتی که
 * با اولین تغییرِ متن دروغ می‌شود.
 */
export default function CancelReason({ kind = 'visit', what, onClose, onConfirm }) {
  const { cancelReasons = [] } = useConfig();
  const [key, setKey] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const picked = cancelReasons.find((r) => r.key === key);

  const submit = async (e) => {
    e.preventDefault();
    if (!key || busy) return;
    setErr(''); setBusy(true);
    try {
      /* یادداشتِ خالی اصلاً فرستاده نمی‌شود — رشتهٔ تهی در دیتابیس با «یادداشتی
         نبود» فرق دارد و گزارشِ بعدی باید بتواند این دو را از هم جدا کند. */
      await onConfirm({ cancelReason: key, cancelNote: note.trim() || undefined });
      /* موفق شد → والد می‌بنددش؛ `setBusy(false)` این‌جا یعنی setState روی
         کامپوننتِ unmount‌شده. */
    } catch (e2) {
      setErr(e2?.message || 'لغو ثبت نشد');
      setBusy(false);
    }
  };

  return (
    <Overlay
      backdrop="cr-overlay"
      panel="glass cr-sheet"
      as="form"
      onClose={onClose}
      closable={!busy}
      onSubmit={submit}
      aria-label="دلیلِ لغو"
    >
      <header className="cr-head">
        <h3>دلیلِ لغو</h3>
        {what && <p className="cr-what">{what}</p>}
      </header>

      {/* رادیو، نه کشویی: پنج گزینه است و انتخاب باید **دیده** شود — کشویی
          یعنی کارمند بدونِ خواندنِ گزینه‌ها اولی را می‌زند. */}
      <div className="cr-reasons" role="radiogroup" aria-label="دلیل">
        {cancelReasons.map((r) => (
          <label key={r.key} className={`cr-reason${key === r.key ? ' on' : ''}${busy ? ' off' : ''}`}>
            <input
              type="radio" name="cancel-reason" value={r.key}
              checked={key === r.key} disabled={busy}
              onChange={() => setKey(r.key)}
            />
            <i aria-hidden="true" />
            <span>{r.label}</span>
          </label>
        ))}
      </div>

      {picked && (
        <p className="cr-sms">
          <b>پیامکِ بیمار:</b> {picked.sms?.[kind] ?? picked.sms?.visit}
        </p>
      )}

      <label className="cr-note">
        <span>یادداشتِ داخلی (اختیاری) — برای بیمار فرستاده نمی‌شود</span>
        <textarea
          rows={2} maxLength={400} value={note} disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          placeholder="مثلاً: بیمار تلفنی اطلاع داد، هفتهٔ بعد هماهنگ می‌کند"
        />
      </label>

      {err && <p className="cr-err" role="alert">{err}</p>}

      {/* ترتیب مثلِ پرسشِ تأییدِ `BillingSheet`: اقدام اول (در RTL سمتِ راست)،
          «انصراف» آخر. */}
      <div className="cr-acts">
        <button type="submit" className="cr-btn danger" disabled={!key || busy}>
          {busy ? 'در حالِ ثبت…' : 'ثبتِ لغو'}
        </button>
        <button type="button" className="cr-btn" onClick={onClose} disabled={busy}>انصراف</button>
      </div>
    </Overlay>
  );
}
