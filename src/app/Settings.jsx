import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useConfig } from './config.jsx';
import { termsFor } from '../lib/terms.js';
import './launcher.css';
import './definitions.css';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Back = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5v6" /></svg>);
const Check = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="m4 12 5 5L20 6" /></svg>);

/**
 * تنظیماتِ شرکت — «همان یک تغییرِ کوچک».
 *
 * حوزهٔ کاری هم واژگانِ رابط را عوض می‌کند هم ماژول‌های فعال را. هیچ داده‌ای
 * تبدیل یا حذف نمی‌شود، پس برگشت هم بی‌خطر است — و همین را به کاربر می‌گوییم
 * تا از تغییرش نترسد.
 */
export default function Settings() {
  const { vertical, verticals, brandName, reload } = useConfig();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [brand, setBrand] = useState(brandName || '');

  useEffect(() => { document.title = 'عمل‌یار — تنظیماتِ شرکت'; }, []);
  useEffect(() => { setBrand(brandName || ''); }, [brandName]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), toast.length > 40 ? 4500 : 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const pick = async (key) => {
    if (key === vertical || busy) return;
    setBusy(true);
    try {
      await api('/config/vertical', { method: 'PATCH', body: { vertical: key } });
      await reload();
      setToast('حوزهٔ کاری تغییر کرد ✓ واژگان و ماژول‌ها به‌روز شدند.');
    } catch (e) { setToast(e.message); } finally { setBusy(false); }
  };

  const saveBrand = async () => {
    setBusy(true);
    try {
      await api('/config/brand', { method: 'PATCH', body: { brandName: brand.trim() } });
      await reload();
      setToast('نامِ برند ذخیره شد ✓');
    } catch (e) { setToast(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="df">
      <div className="df-bg" />
      <header className="df-head">
        <Link className="df-back" to="/app"><Back width="14" height="14" /> لانچر</Link>
        <div>
          <h1>تنظیماتِ شرکت</h1>
          <p>حوزهٔ کاری تعیین می‌کند کاربر چه کلماتی ببیند و کدام ماژول‌ها فعال باشند.</p>
        </div>
      </header>

      <div className="df-note">
        تغییرِ حوزه هیچ داده‌ای را پاک یا تبدیل نمی‌کند؛ فقط واژگان و دسترسیِ ماژول‌ها عوض می‌شود.
        برگشت به حوزهٔ قبلی هم همین‌قدر بی‌خطر است.
      </div>

      <div className="df-list st-verticals">
        {verticals.map((v) => {
          const on = v.key === vertical;
          const sample = termsFor(v.key);
          return (
            <button
              key={v.key}
              type="button"
              className={`df-row st-vertical${on ? ' on' : ''}`}
              disabled={busy}
              onClick={() => pick(v.key)}
            >
              <span className={`st-check${on ? ' on' : ''}`}>{on && <Check width="14" height="14" />}</span>
              <span className="df-row-main">
                <b>{v.label}</b>
                {/* نمونهٔ واژگان، تا پیش از انتخاب معلوم باشد چه چیزی عوض می‌شود. */}
                <small>{sample.visitNew} · {sample.visits} · {sample.tech}</small>
              </span>
            </button>
          );
        })}
      </div>

      <h3 className="st-h3">نامِ برند</h3>
      <div className="st-brand">
        <label className="pf-field">
          <span>نامی که در سربرگ‌ها و گزارش‌ها نشان داده می‌شود</span>
          <input value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={60} placeholder="نامِ شرکت" />
        </label>
        <button type="button" className="df-save" onClick={saveBrand} disabled={busy}>ذخیره</button>
      </div>

      {toast && <div className="df-toast">{toast}</div>}
    </div>
  );
}
