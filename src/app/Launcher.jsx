import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Mark from '../components/Mark.jsx';
import { useAuth } from './auth.jsx';
import ProfileMenu from './ProfileMenu.jsx';
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
const ArrowL = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M19 12H5M11 18l-6-6 6-6" /></svg>);
const Back = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5v6" /></svg>);

const BoxIc = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3 8 9 5 9-5M12 13v8" /></svg>);
const BookIc = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z" /><path d="M9 7h7M9 11h7" /></svg>);
const Gear = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" /></svg>);
const UsersIc = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.7-3.4 3.4-5.5 6.5-5.5s5.8 2.1 6.5 5.5" /><circle cx="17.5" cy="9" r="2.6" /><path d="M15.6 14.9c2.6.3 4.9 2 5.6 4.6" /></svg>);

/* min = حداقل سطحِ دسترسی (۱ بازدید … ۶ سوپرادمین) */
const HERO = { key: 'dashboard', label: 'داشبورد مدیریت', desc: 'ثبت بیماران، مالی، گزارش‌ها', icon: Chart, ready: true, min: 5, to: '/app/dashboard' };
const DAILY = [
  { key: 'formgen', label: 'فرم‌ساز', icon: Form, ready: false, min: 5 },
  { key: 'messenger', label: 'پیام‌رسان', icon: Chat, ready: false, min: 2 },
];
const TOOLS = [
  { key: 'accounting', label: 'حسابداری', icon: Bank, tint: 'violet', ready: true, min: 5, to: '/app/accounting' },
  { key: 'calendar', label: 'تقویم عمل‌ها', icon: Calendar, tint: 'green', ready: false, min: 4 },
  { key: 'dispatch', label: 'چینش کارشناس‌ها', icon: Dispatch, tint: 'amber', ready: false, min: 4 },
  { key: 'letter', label: 'نامه اداری', icon: Mail, tint: 'blue', ready: false, min: 5 },
  { key: 'tech', label: 'پنل کارشناسی', icon: Wave, tint: 'teal', ready: false, min: 2 },
  { key: 'inventory', label: 'انبار', icon: BoxIc, tint: 'green', ready: true, min: 3, to: '/app/inventory' },
  { key: 'definitions', label: 'تعاریف پایه', icon: BookIc, tint: 'teal', ready: true, min: 5, to: '/app/definitions' },
  { key: 'users', label: 'کاربران', icon: UsersIc, tint: 'violet', ready: true, min: 6, to: '/app/users' },
  { key: 'settings', label: 'تنظیماتِ شرکت', icon: Gear, tint: 'amber', ready: true, min: 6, to: '/app/settings' },
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
  const { user } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { document.title = 'عمل‌یار — سامانه'; }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  const soon = (label) => setToast(`«${label}» به‌زودی`);
  const open = (t) => (t.to ? navigate(t.to) : soon(t.label));

  // دسترسی‌ها از سرور (قابلِ‌تنظیم توسط سوپرادمین)؛ minِ کد فقط fallback است
  const lvl = user?.level ?? 0;
  const [features, setFeatures] = useState(null); // key → {minLevel, enabled}
  useEffect(() => {
    let alive = true;
    import('../lib/api.js').then(({ api }) =>
      api('/features')
        .then((rows) => {
          if (alive) setFeatures(Object.fromEntries(rows.map((r) => [r.key, r])));
        })
        .catch(() => {}),
    );
    return () => { alive = false; };
  }, []);
  const allowed = (t) => {
    const f = features?.[t.key];
    const min = f?.minLevel ?? t.min;
    const enabled = f?.enabled ?? true;
    return enabled && lvl >= min;
  };
  const showHero = allowed(HERO);
  const daily = DAILY.filter(allowed);
  const tools = TOOLS.filter(allowed);
  const nothing = !showHero && daily.length === 0 && tools.length === 0;

  // بنرِ نصبِ PWA (اندروید/کروم — beforeinstallprompt)
  const [installEvt, setInstallEvt] = useState(null);
  useEffect(() => {
    if (localStorage.getItem('amalyar_a2hs_dismissed')) return;
    const h = (e) => {
      e.preventDefault();
      setInstallEvt(e);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  const doInstall = async () => {
    if (!installEvt) return;
    installEvt.prompt();
    const { outcome } = await installEvt.userChoice;
    if (outcome === 'accepted') setToast('عمل‌یار نصب شد ✓');
    setInstallEvt(null);
  };
  const dismissInstall = () => {
    localStorage.setItem('amalyar_a2hs_dismissed', '1');
    setInstallEvt(null);
  };

  // نشانِ تعدادِ در انتظارِ تأیید (فقط سوپرادمین)
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    if (lvl < 6) return;
    let alive = true;
    import('../lib/api.js').then(({ api }) =>
      api('/accounts/pending')
        .then((rows) => { if (alive) setPendingCount(rows.length); })
        .catch(() => {}),
    );
    return () => { alive = false; };
  }, [lvl]);

  return (
    <div className="lx">
      <div className="lx-bg" aria-hidden="true" />
      <div className="lx-orbs" aria-hidden="true">
        <span className="orb o1" /><span className="orb o2" /><span className="orb o3" />
      </div>
      <div className="lx-grid" aria-hidden="true" />

      <div className="lx-shell">
        <div className="lx-top">
          <Link to="/" className="lx-back" aria-label="بازگشت به سایت"><Back width="15" height="15" /> سایت</Link>
          <ProfileMenu onToast={setToast} />
        </div>

        <header className="lx-brand">
          <Mark className="lx-mark" gradient draw aria-hidden="true" />
          <div className="lx-word">عمل<span className="grad-text">‌یار</span></div>
          <div className="lx-tag">هوشمند <em>عمل</em> کن</div>
        </header>

        <div className="lx-cards">
          {showHero && (
            <button className="glass lx-hero shine" onMouseMove={track} onClick={() => open(HERO)}>
              <span className="glass-glow" aria-hidden="true" />
              <span className="lx-hero-ic"><HERO.icon width="30" height="30" /></span>
              <span className="lx-hero-body">
                <span className="lx-hero-title">{HERO.label}{!HERO.ready && <em className="soon">به‌زودی</em>}</span>
                <span className="lx-hero-desc">{HERO.desc}</span>
              </span>
              <span className="lx-hero-arrow"><ArrowL width="22" height="22" /></span>
            </button>
          )}

          {daily.length > 0 && (
            <div className="lx-row">
              {daily.map((t) => (
                <button key={t.key} className="glass lx-card" onMouseMove={track} onClick={() => open(t)}>
                  <span className="glass-glow" aria-hidden="true" />
                  <span className="lx-card-ic"><t.icon width="24" height="24" /></span>
                  <span className="lx-card-title">{t.label}</span>
                  {!t.ready && <em className="soon dot" title="به‌زودی" />}
                </button>
              ))}
            </div>
          )}

          {tools.length > 0 && (
            <>
              <div className="lx-tools-label">ابزارها</div>
              <div className="lx-tools">
                {tools.map((t) => (
                  <button key={t.key} className="glass lx-tile" onMouseMove={track} onClick={() => open(t)}>
                    <span className="glass-glow" aria-hidden="true" />
                    <span className={`lx-tile-ic tint-${t.tint}`}><t.icon width="24" height="24" /></span>
                    <span className="lx-tile-label">{t.label}</span>
                    {!t.ready && <em className="soon dot" title="به‌زودی" />}
                    {t.key === 'users' && pendingCount > 0 && <span className="lx-badge">{pendingCount}</span>}
                  </button>
                ))}
              </div>
            </>
          )}

          {nothing && (
            <div className="glass lx-hero" style={{ cursor: 'default' }}>
              <span className="lx-hero-body">
                <span className="lx-hero-title">دسترسیِ شما هنوز محدود است</span>
                <span className="lx-hero-desc">مدیرِ سامانه باید سطحِ دسترسیِ شما را ارتقا دهد.</span>
              </span>
            </div>
          )}
        </div>

      </div>

      {installEvt && (
        <div className="glass lx-install" role="dialog" aria-label="نصبِ اپلیکیشن">
          <span className="lx-install-txt">عمل‌یار را روی گوشی نصب کن</span>
          <button className="lx-install-ok" onClick={doInstall}>نصب</button>
          <button className="lx-install-no" onClick={dismissInstall}>بعداً</button>
        </div>
      )}

      <div className={`lx-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}
