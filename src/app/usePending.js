import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/** رویدادی که بعد از تأیید/ردِ یک درخواستِ عضویت فرستاده می‌شود تا زنگ و کشو همان لحظه تازه شوند. */
export const PENDING_CHANGED = 'amalyar:pending-changed';

/**
 * شمارِ درخواست‌های عضویتِ در انتظارِ تأیید — فقط برای سوپرادمین (همان `/accounts/pending`ِ
 * صفحهٔ «کاربران»).
 *
 * بازبینیِ UX (۱۴۰۵/۰۷): تا دیروز این عدد فقط روی کاشیِ «کاربران» در `/app/tools` ساخته
 * می‌شد — صفحه‌ای که از وقتی «امروز» صفحهٔ نخست شد هیچ دکمه‌ای به آن نمی‌رفت؛ منشیِ تازه
 * ثبت‌نام می‌کرد و تا سوپرادمین خودش سراغِ «کاربران» نمی‌رفت منتظر می‌ماند. حالا زنگِ پوسته
 * (به‌صورتِ یک کار) و کاشیِ کشوی «امروز» هم از همین می‌خوانند.
 *
 * `poll` (میلی‌ثانیه) فقط برای زنگ که همیشه روی صفحه است؛ بقیه با بازشدن و با رویدادِ بالا.
 */
export function usePendingAccounts(enabled, { poll = 0 } = {}) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) { setCount(0); return undefined; }
    let alive = true;
    const load = () => api('/accounts/pending')
      .then((r) => { if (alive) setCount(Array.isArray(r) ? r.length : 0); })
      .catch(() => {});
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    load();
    window.addEventListener(PENDING_CHANGED, load);
    if (poll) document.addEventListener('visibilitychange', onVis);
    const t = poll ? setInterval(load, poll) : null;
    return () => {
      alive = false;
      window.removeEventListener(PENDING_CHANGED, load);
      if (poll) document.removeEventListener('visibilitychange', onVis);
      if (t) clearInterval(t);
    };
  }, [enabled, poll]);
  return count;
}
