import { useEffect, useState } from 'react';

export default function VersionNotice() {
  const [update, setUpdate] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let live = true;
    const check = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/version.json', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (live) setUpdate(typeof data.buildId === 'string' && data.buildId !== __BUILD_ID__);
      } catch { /* Offline: keep the current form. */ }
    };
    check();
    const timer = setInterval(check, 60000);
    window.addEventListener('focus', check);
    return () => { live = false; clearInterval(timer); window.removeEventListener('focus', check); };
  }, []);
  return update ? <aside role="status" className="version-notice" dir="rtl"><span>نسخه جدید آماده است. ابتدا تغییرات فرم را ذخیره کنید.</span><button type="button" onClick={() => window.location.reload()}>دریافت نسخه جدید</button></aside> : null;
}
