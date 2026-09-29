import { useEffect, useId, useRef, useState } from 'react';
import { group3, numToWordsFa, parseMoney } from '../lib/money.js';
import './money-input.css';

/**
 * **باکسِ مبلغ** — تک‌منبعِ ورودیِ مبلغ (قانونِ ۱۳، بازبینیِ UX ۱۴۰۵/۰۷).
 *
 * تا امروز هر فرم یک `<input inputMode="numeric">`ِ خام داشت: «20000000» بی‌جداکننده و بی‌«به‌حروف»،
 * و منشی به‌راحتی یک صفر کم یا زیاد می‌زد. این‌جا دو چیز یک‌بار نوشته می‌شود:
 *  - **گروه‌بندیِ سه‌رقمی فقط در blur** — نه حینِ تایپ: بازنویسیِ مقدار وسطِ تایپ روی Gboardِ
 *    اندروید ارقامِ بعدی را دور می‌ریزد (همان باگِ ملک‌طب). حینِ تایپ متن **دست‌نخورده** می‌ماند.
 *  - **«به‌حروف»ِ زنده** زیرِ کادر — «بیست میلیون تومان» — از همان لحظهٔ اولِ تایپ.
 *
 * ⚠️ مقدار رشته است و همان رشته بالا می‌رود (با جداکننده یا ارقامِ فارسی)؛ خواندنِ عدد کارِ
 * `parseMoney` است که هر دو را می‌پذیرد — پس مصرف‌کننده‌ها منطقِ ذخیره‌شان را عوض نمی‌کنند.
 *
 * ⚠️ مقدارِ **بیرونی** (مثلاً قیمتی که از کاتالوگ در کادر نشست) همان لحظه آراسته نشان داده می‌شود؛
 * آنچه کاربر همین حالا تایپ کرده تا blur دست نمی‌خورد (همان قاعدهٔ `JDate`).
 */
export default function MoneyInput({
  value, onChange, unit = 'تومان', placeholder, disabled, className, id, words: showWords = true, ...rest
}) {
  const raw = String(value ?? '');
  const [text, setText] = useState(() => group3(raw) || raw);
  /* آخرین چیزی که خودمان بالا فرستادیم — تا بازگشتِ همان مقدار «تغییرِ بیرونی» خوانده نشود. */
  const sent = useRef(raw);
  useEffect(() => {
    if (raw === sent.current) return;
    sent.current = raw;
    setText(group3(raw) || raw);
  }, [raw]);

  const emit = (v) => { setText(v); sent.current = v; onChange(v); };
  const n = parseMoney(text);
  const wordsId = useId();

  return (
    <>
      <input
        {...rest}
        type="text" dir="ltr" inputMode="numeric" autoComplete="off"
        id={id} className={className} value={text} placeholder={placeholder} disabled={disabled}
        aria-describedby={showWords ? wordsId : undefined}
        onChange={(e) => emit(e.target.value)}
        onBlur={() => { const g = group3(text); if (g !== text) emit(g); }}
      />
      {showWords && (
        <small id={wordsId} className="mi-words" data-money-words>
          {n > 0 ? `${numToWordsFa(n)} ${unit}` : ''}
        </small>
      )}
    </>
  );
}
