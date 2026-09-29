import { useCallback, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import Overlay from './Overlay.jsx';
import './confirm.css';

/**
 * پرسشِ تأییدِ یک کارِ برگشت‌ناپذیر یا پراثر — روی همان `Overlay`ِ مشترک (Escape، تلهٔ فوکوس،
 * بازگشتِ فوکوس به دکمه‌ای که پرسش را باز کرد).
 *
 *   const [confirmNode, confirm] = useConfirm();
 *   if (!(await confirm({ title: 'ردِ درخواستِ «سارا»؟', body: '…', ok: 'رد کن', danger: true }))) return;
 *   …  return <>{…}{confirmNode}</>;
 *
 * بازبینیِ UX (۱۴۰۵/۰۷): «رد»ِ درخواستِ عضویت، خاموش‌کردنِ یک ماژول برای همه و «خروج از همهٔ
 * حساب‌ها» بی‌پرسش انجام می‌شدند. متنِ پرسش **اثر** را می‌گوید، نه «مطمئنید؟».
 * دکمهٔ امن («انصراف») اول است و فوکوسِ پیش‌فرض روی خودِ پنجره — Enter کارِ مخرب را انجام نمی‌دهد.
 */
export function useConfirm() {
  const [req, setReq] = useState(null);
  const pending = useRef(null);
  const confirm = useCallback((opts) => new Promise((resolve) => {
    pending.current?.(false);
    pending.current = resolve;
    setReq(opts);
  }), []);
  const close = (value) => {
    pending.current?.(value);
    pending.current = null;
    setReq(null);
  };
  const node = (
    <AnimatePresence>
      {req && (
        <Overlay backdrop="cf-overlay" panel="cf-sheet" role="alertdialog" aria-labelledby="cf-title"
          aria-describedby={req.body ? 'cf-body' : undefined} onClose={() => close(false)}>
          <h2 id="cf-title" className="cf-title">{req.title}</h2>
          {req.body && <p id="cf-body" className="cf-body">{req.body}</p>}
          <div className="cf-acts">
            <button type="button" className="cf-no" onClick={() => close(false)}>{req.cancel ?? 'انصراف'}</button>
            <button type="button" className={`cf-yes${req.danger ? ' danger' : ''}`} onClick={() => close(true)}>{req.ok ?? 'تأیید'}</button>
          </div>
        </Overlay>
      )}
    </AnimatePresence>
  );
  return [node, confirm];
}
