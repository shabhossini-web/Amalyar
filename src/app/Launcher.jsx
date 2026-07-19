import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Mark from '../components/Mark.jsx';
import { useAuth } from './auth.jsx';
import './launcher.css';

/* ── آیکون‌های خطی (lucide-style، stroke=currentColor) ── */
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Chart = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M3 3v18h18" /><path d="M7 15l3-4 3 2 4-6" /></svg>);
const Form = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>);
const Chat = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>);
const Bank = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M3 10l9-6 9 6" /><path d="M5 10v9M19 10v9M9 10v9M15 10v9M3 21h18" /></svg>);
const Calendar = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>);
const Dispatch = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><circle cx="8" cy="8" r="3" /><circle cx="17" cy="16" r="3" /><path d="M11 8h4a2 2 0 0 1 2 2v3M8 11v3a2 2 0 0 0 2 2h3" /></svg>);
const Mail = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>);
const Wave = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M2 12h3l3-8 4 16 3-11 2 3h5" /></svg>);
const Cog = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.4 5.4l1.9 1.9M16.7 16.7l1.9 1.9M18.6 5.4l-1.9 1.9M7.3 16.7l-1.9 1.9" /></svg>);
const LogOut = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></svg>);
const Finger = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" /><path d="M14 13.12c0 2.38 0 6.38-1 8.88" /><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" /><path d="M2 12a10 10 0 0 1 18-6" /><path d="M2 16h.01" /><path d="M21.8 16c.2-2 .131-5.354 0-6" /><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" /><path d="M8.65 22c.21-.66.45-1.32.57-2" /><path d="M9 6.8a6 6 0 0 1 9 5.2v2" /></svg>);
const ArrowL = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M19 12H5M11 18l-6-6 6-6" /></svg>);
const Back = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5v6" /></svg>);
const User = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6.5 8-6.5s8 2.5 8 6.5" /></svg>);

const HERO = { key: 'dashboard', label: 'داشبورد مدیریت', desc: 'ثبت بیماران، مالی، گزارش‌ها', icon: Chart, ready: false };
const DAILY = [
  { key: 'formgen', label: 'فرم‌ساز', icon: Form, ready: false },
  { key: 'messenger', label: 'پیام‌رسان', icon: Chat, ready: false },
];
const TOOLS = [
  { key: 'accounting', label: 'حسابداری', icon: Bank, tint: 'violet', ready: false },
  { key: 'calendar', label: 'تقویم عمل‌ها', icon: Calendar, tint: 'green', ready: false },
  { key: 'dispatch', label: 'چینش کارشناس‌ها', icon: Dispatch, tint: 'amber', ready: false },
  { key: 'letter', label: 'نامه اداری', icon: Mail, tint: 'blue', ready: false },
  { key: 'tech', label: 'پنل کارشناسی', icon: Wave, tint: 'teal', ready: false },
];

/* اسپاتلایتِ دنبال‌کنندهٔ اشاره‌گر روی کارتِ شیشه‌ای */
function track(e) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
}

export default function Launcher() {
  const [toast, setToast] = useState('');
  const { user, logout, webauthnRegister } = useAuth();
  const navigate = useNavigate();
  const userName = user?.displayName || user?.username || user?.phone || 'کاربر';
  const roleFa = user?.levelName || '';
  const doLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };
  const setupBio = async () => {
    try {
      await webauthnRegister();
      setToast('ورود با اثر انگشت فعال شد ✓');
    } catch (e) {
      if (e?.name === 'InvalidStateError') setToast('اثر انگشتِ این دستگاه قبلاً فعال شده');
      else if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') setToast(e?.message || 'فعال‌سازی ناموفق بود');
    }
  };
  useEffect(() => { document.title = 'عمل‌یار — سامانه'; }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  const soon = (label) => setToast(`«${label}» به‌زودی`);

  return (
    <div className="lx">
      <div className="lx-bg" aria-hidden="true" />
      <div className="lx-orbs" aria-hidden="true">
        <span className="orb o1" /><span className="orb o2" /><span className="orb o3" />
      </div>
      <div className="lx-grid" aria-hidden="true" />

      <div className="lx-shell">
        <Link to="/" className="lx-back" aria-label="بازگشت به سایت"><Back width="15" height="15" /> سایت</Link>

        <header className="lx-brand">
          <Mark className="lx-mark" gradient draw aria-hidden="true" />
          <div className="lx-word">عمل<span className="grad-text">‌یار</span></div>
          <div className="lx-tag">هوشمند <em>عمل</em> کن</div>
        </header>

        <div className="lx-cards">
          <button className="glass lx-hero shine" onMouseMove={track} onClick={() => soon(HERO.label)}>
            <span className="glass-glow" aria-hidden="true" />
            <span className="lx-hero-ic"><HERO.icon width="30" height="30" /></span>
            <span className="lx-hero-body">
              <span className="lx-hero-title">{HERO.label}{!HERO.ready && <em className="soon">به‌زودی</em>}</span>
              <span className="lx-hero-desc">{HERO.desc}</span>
            </span>
            <span className="lx-hero-arrow"><ArrowL width="22" height="22" /></span>
          </button>

          <div className="lx-row">
            {DAILY.map((t) => (
              <button key={t.key} className="glass lx-card" onMouseMove={track} onClick={() => soon(t.label)}>
                <span className="glass-glow" aria-hidden="true" />
                <span className="lx-card-ic"><t.icon width="24" height="24" /></span>
                <span className="lx-card-title">{t.label}</span>
                {!t.ready && <em className="soon dot" title="به‌زودی" />}
              </button>
            ))}
          </div>

          <div className="lx-tools-label">ابزارها</div>
          <div className="lx-tools">
            {TOOLS.map((t) => (
              <button key={t.key} className="glass lx-tile" onMouseMove={track} onClick={() => soon(t.label)}>
                <span className="glass-glow" aria-hidden="true" />
                <span className={`lx-tile-ic tint-${t.tint}`}><t.icon width="24" height="24" /></span>
                <span className="lx-tile-label">{t.label}</span>
                {!t.ready && <em className="soon dot" title="به‌زودی" />}
              </button>
            ))}
          </div>
        </div>

        <footer className="lx-foot">
          <div className="lx-userbar">
            <button className="glass lx-user" onMouseMove={track} onClick={() => soon('تنظیمات')}>
              <span className="glass-glow" aria-hidden="true" />
              <span className="lx-avatar">{user?.selfie
                ? <img src={user.selfie} alt="" />
                : <User width="17" height="17" />}</span>
              <span className="lx-user-meta">
                <span className="lx-user-name">{userName}</span>
                {roleFa && <span className="lx-user-role">{roleFa}</span>}
              </span>
              <span className="lx-gear"><Cog width="16" height="16" /></span>
            </button>
            {'PublicKeyCredential' in window && (
              <button className="lx-bio" onClick={setupBio} title="فعال‌سازی ورود با اثر انگشت" aria-label="فعال‌سازی ورود با اثر انگشت">
                <Finger width="18" height="18" />
              </button>
            )}
            <button className="lx-logout" onClick={doLogout} title="خروج از حساب" aria-label="خروج از حساب">
              <LogOut width="18" height="18" />
            </button>
          </div>
        </footer>
      </div>

      <div className={`lx-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}
