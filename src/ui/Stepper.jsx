import { Minus, Plus } from './icons.jsx';
import './stepper.css';

const num = (n) => Number(n ?? 0).toLocaleString('fa-IR');

/**
 * شمارندهٔ لمسی (بستهٔ ج): «کمتر / عدد / بیشتر» — برای ثبتِ مصرفیِ کارشناس و شمارشِ جمع‌آوریِ راننده.
 *
 * یک کامپوننت برای هر دو پنل تا دو رفتارِ متفاوت در یک اپ نسازیم. دکمه‌ها ۴۰px‌اند (هدفِ لمسی)، عدد
 * با ارقامِ فارسی و `tabular-nums`؛ سقف (`max`) همان لحظه دکمه را می‌بندد، نه بعد از خطای سرور.
 */
export default function Stepper({ value, onChange, min = 0, max = null, unit = '', label, disabled = false }) {
  const v = Number(value ?? 0);
  return (
    <div className="ui-step" role="group" aria-label={label}>
      <button type="button" aria-label={`کمتر — ${label}`} disabled={disabled || v <= min} onClick={() => onChange(v - 1)}>
        <Minus width="15" height="15" />
      </button>
      <b><bdi dir="ltr">{num(v)}</bdi></b>
      {unit && <small>{unit}</small>}
      <button type="button" aria-label={`بیشتر — ${label}`} disabled={disabled || (max !== null && v >= max)} onClick={() => onChange(v + 1)}>
        <Plus width="15" height="15" />
      </button>
    </div>
  );
}
