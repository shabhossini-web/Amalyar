import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Lock } from '../ui/icons.jsx';
import './gate.css';

/**
 * دروازهٔ ماژول در سمتِ کلاینت.
 *
 * ⚠️ **این جایگزینِ گاردِ سرور نیست و نباید باشد.** سرور همچنان هر درخواست را
 * می‌سنجد؛ کارِ این کامپوننت فقط این است که کاربر به‌جای صفحهٔ خالی یا یک
 * خطای خامِ ۴۰۳، بفهمد چرا نمی‌بیند. پنهان‌کردن در UI امنیت نیست، ادب است.
 *
 * ⚠️ تصمیم از **سرور** می‌آید (`allowed` در `/features`)، نه از حسابِ سطح در
 * کلاینت: دو منبعِ حقیقت برای «چه چیزی را می‌بینم» یعنی روزی لانچر چیزی را
 * نشان دهد که صفحه‌اش باز نمی‌شود — همان چیزی که راننده با «پنلِ کارشناسی»
 * تجربه می‌کرد.
 */
export default function Gate({ feature, children }) {
  const [state, setState] = useState(null); // null | {allowed, reason, label}

  useEffect(() => {
    let alive = true;
    api('/features')
      .then((rows) => {
        if (!alive) return;
        const row = rows.find((r) => r.key === feature);
        // کلیدِ ناشناخته را **باز** می‌گذاریم: ماژولی که هنوز در رجیستری ثبت
        // نشده نباید صفحه‌اش قفل شود؛ سرور به‌هرحال جلوی داده را می‌گیرد.
        setState(row ?? { allowed: true });
      })
      .catch(() => { if (alive) setState({ allowed: true }); });
    return () => { alive = false; };
  }, [feature]);

  if (!state) return <div className="gt-wait">در حال بررسیِ دسترسی…</div>;
  if (state.allowed) return children;

  return (
    <div className="gt">
      <div className="gt-card">
        <span className="gt-ic"><Lock width="22" height="22" /></span>
        <b>{state.label ?? 'این بخش'} در دسترسِ شما نیست</b>
        <p>{state.reason ?? 'برای این بخش دسترسی ندارید.'}</p>
        <Link to="/app" className="gt-back">بازگشت به سامانه</Link>
      </div>
    </div>
  );
}
