import React, { useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation, useNavigationType } from 'react-router-dom';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/700.css';
import '@fontsource/vazirmatn/900.css';
import './index.css';
import App from './App.jsx';
/* ⚠️ **پیش از رندر** اعمال می‌شود، نه در یک افکت: اگر منتظرِ اولین رندر می‌ماند،
   کاربرِ تمِ روشن یک فریمِ کاملِ تیره می‌دید و بعد صفحه سفید می‌شد. */
import { applyTheme, applyDensity, resolveTheme, resolveDensity } from './lib/theme.js';
import VersionNotice from './ui/VersionNotice.jsx';

applyTheme(resolveTheme(null));
applyDensity(resolveDensity());

/**
 * **جای اسکرول با تغییرِ مسیر** (بازبینیِ UX، company-09).
 *
 * ⚠️ `BrowserRouter` خودش اسکرول را جابه‌جا نمی‌کند (و `ScrollRestoration` فقط مالِ data router است):
 * پرونده‌ای که از پایینِ فهرستِ «بیماران» باز می‌شد با همان مقدارِ اسکرولِ قبلی باز می‌شد — نام و دکمهٔ
 * بازگشت زیرِ نوارِ بالا، کاربر وسطِ صفحه. حالا:
 *  - صفحهٔ **تازه** (PUSH/REPLACE با مسیرِ دیگر) از بالا باز می‌شود؛ عوض‌شدنِ فقط `?query` (زبانه، فیلتر،
 *    پزشکِ انتخاب‌شده) اسکرول را دست نمی‌زند.
 *  - «بازگشت/جلو» (POP) جای قبلیِ همان ورودیِ تاریخچه را برمی‌گرداند — و چون فهرست بعد از بارگذاری
 *    بلند می‌شود، چند فریم تلاش می‌کند تا صفحه آن‌قدر بلند شود؛ لمس/چرخ/کلیدِ کاربر تلاش را قطع می‌کند.
 * جای هر ورودی با شنوندهٔ scroll نگه داشته می‌شود نه لحظهٔ تغییرِ مسیر: آن لحظه صفحهٔ تازه رندر شده و
 * مرورگر ممکن است اسکرول را به قدِ صفحهٔ کوتاه‌تر بریده باشد.
 */
function ScrollManager() {
  const { key, pathname } = useLocation();
  const nav = useNavigationType();
  const saved = useRef(new Map());
  const cur = useRef({ key, pathname });

  useLayoutEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; saved.current.set(cur.current.key, window.scrollY); });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);

  useLayoutEffect(() => {
    const was = cur.current;
    cur.current = { key, pathname };
    if (was.key === key) return undefined;
    if (nav !== 'POP') {
      if (was.pathname !== pathname) window.scrollTo(0, 0);
      return undefined;
    }
    const target = saved.current.get(key) ?? 0;
    let frame = 0;
    let tries = 0;
    const stop = () => { cancelAnimationFrame(frame); frame = 0; };
    const tick = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, Math.min(target, Math.max(0, max)));
      if (max >= target || ++tries > 150) { frame = 0; return; }   // ~۲٫۵ ثانیه برای بارگذاریِ فهرست
      frame = requestAnimationFrame(tick);
    };
    tick();
    const user = ['wheel', 'touchstart', 'keydown'];
    user.forEach((ev) => window.addEventListener(ev, stop, { passive: true, once: true }));
    return () => { stop(); user.forEach((ev) => window.removeEventListener(ev, stop)); };
  }, [key, pathname, nav]);

  return null;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ScrollManager />
      <App />
      <VersionNotice />
    </BrowserRouter>
  </React.StrictMode>
);

// PWA — فقط در پروداکشن (تا dev server کش نشود)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
