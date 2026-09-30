import { useCallback, useEffect, useRef, useState } from 'react';
import { Close } from './icons.jsx';
import './toast.css';

/**
 * توستِ مشترکِ سامانه — پیامِ کوتاهِ «انجام شد»، «ذخیره نشد»، «واگذار شد».
 *
 * هشدار: تا ۱۴۰۵/۰۷ هر صفحه توستِ خودش را داشت (هجده نسخه، سه ظاهر) و در تمِ روشن
 * نیمی‌شان نامرئی بودند: سرمه‌ای روی سرمه‌ای، یا سفید روی سفید — کاربر نمی‌فهمید
 * کارش ثبت شد یا نه. رنگ از توکن‌های `--toast-*` می‌آید (سطحِ وارونه در هر دو تم)
 * و جای ثابتش پایینِ وسطِ صفحه است؛ صفحه‌ها فقط متن می‌دهند.
 *
 * - `msg`: متن؛ خالی یعنی پنهان. عنصر **همیشه در DOM است** (`role="status"`) تا
 *   صفحه‌خوان اولین پیام را هم اعلام کند — ناحیهٔ زنده‌ای که همراهِ متنش ساخته
 *   شود، معمولاً خوانده نمی‌شود.
 * - `bad`: خطا — قابِ قرمز و اعلامِ فوری (`assertive`).
 * - `action`: `{ label, run }` — مثلاً «واگرد» برای تغییری که همین حالا اعمال شد.
 * - `onClose`: دکمهٔ بستن (برای پیامی که خودش نمی‌رود).
 */
export default function Toast({ msg, bad = false, action = null, onClose = null }) {
  const text = msg ? String(msg) : '';
  return (
    <div
      className={`ui-toast${text ? ' on' : ''}${bad ? ' bad' : ''}`}
      role="status" aria-live={bad ? 'assertive' : 'polite'} aria-atomic="true"
      data-toast
    >
      {text && <span className="ui-toast-txt">{text}</span>}
      {text && action && (
        <button type="button" className="ui-toast-act" onClick={action.run}>{action.label}</button>
      )}
      {text && onClose && (
        <button type="button" className="ui-toast-x" onClick={onClose} aria-label="بستنِ پیام">
          <Close width="15" height="15" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * حالتِ توست با پاک‌شدنِ خودکار — همان الگویی که هر صفحه دست‌نویس تکرار می‌کرد.
 * پیامِ بلندتر بیشتر می‌ماند تا خوانده شود؛ `show(msg, { ms, action })` زمان و
 * «واگرد» را برای همان یک پیام می‌گیرد.
 */
export function useToast(base = 2200) {
  const [state, setState] = useState({ msg: '', action: null, ms: 0, n: 0 });
  const timer = useRef(0);
  const show = useCallback((msg, opts = {}) => {
    setState((s) => ({ msg: msg ? String(msg) : '', action: opts.action ?? null, ms: opts.ms ?? 0, n: s.n + 1 }));
  }, []);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!state.msg) return undefined;
    const ms = state.ms || (state.msg.length > 40 ? Math.max(base, 4500) : base);
    timer.current = setTimeout(() => setState((s) => ({ ...s, msg: '', action: null })), ms);
    return () => clearTimeout(timer.current);
  }, [state.msg, state.n, state.ms, base]);
  return { msg: state.msg, action: state.action, show, clear: () => show('') };
}
