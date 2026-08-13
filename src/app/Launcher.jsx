import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Mark from '../components/Mark.jsx';
import { useAuth } from './auth.jsx';
import ProfileMenu from './ProfileMenu.jsx';
import './launcher.css';
import { ArrowStart, Back, Bank, Book, Box, Calendar, Chart, Chat, Clock, Dispatch, Form, Gear, Lock, Mail, Truck, Users, Wave } from '../ui/icons.jsx';

/* ── آیکون‌های خطی (lucide-style، stroke=currentColor) ── */


/* min = حداقل سطحِ دسترسی (۱ بازدید … ۶ سوپرادمین) */
const HERO = { key: 'dashboard', label: 'داشبورد مدیریت', desc: 'ثبت بیماران، مالی، گزارش‌ها', icon: Chart, ready: true, min: 5, to: '/app/dashboard' };
const DAILY = [
  { key: 'formgen', label: 'ثبت‌نامِ بیماران', icon: Form, ready: true, min: 5, to: '/app/intake' },
  { key: 'messenger', label: 'پیام‌رسان', icon: Chat, ready: false, min: 2 },
];
const TOOLS = [
  { key: 'accounting', label: 'حسابداری', icon: Bank, tint: 'violet', ready: true, min: 5, to: '/app/accounting' },
  { key: 'calendar', label: 'تقویم عمل‌ها', icon: Calendar, tint: 'green', ready: true, min: 4, to: '/app/calendar' },
  /* برنامهٔ کاری — `docs/BOOKING.md`. کنارِ تقویم می‌نشیند چون هم‌خانواده‌اند:
     یکی می‌گوید چه شد، آن یکی می‌گوید چه وقتی می‌شود. */
  { key: 'schedule', label: 'برنامهٔ کاری', icon: Clock, tint: 'green', ready: true, min: 5, to: '/app/schedule' },
  { key: 'dispatch', label: 'چینشِ نیروها', icon: Dispatch, tint: 'amber', ready: true, min: 4, to: '/app/dispatch' },
  { key: 'letter', label: 'نامه اداری', icon: Mail, tint: 'blue', ready: false, min: 5 },
  { key: 'tech', label: 'پنل کارشناسی', icon: Wave, tint: 'teal', ready: true, min: 2, to: '/app/tech' },
  { key: 'transport', label: 'پرتالِ حمل‌ونقل', icon: Truck, tint: 'amber', ready: true, min: 2, to: '/app/transport' },
  { key: 'inventory', label: 'انبار', icon: Box, tint: 'green', ready: true, min: 3, to: '/app/inventory' },
  { key: 'definitions', label: 'تعاریف پایه', icon: Book, tint: 'teal', ready: true, min: 5, to: '/app/definitions' },
  { key: 'forms', label: 'فرم‌ساز', icon: Book, tint: 'violet', ready: true, min: 6, to: '/app/forms' },
  { key: 'users', label: 'کاربران', icon: Users, tint: 'violet', ready: true, min: 6, to: '/app/users' },
  { key: 'access', label: 'سطوحِ دسترسی', icon: Lock, tint: 'blue', ready: true, min: 6, to: '/app/access' },
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
  /**
   * ⚠️ تصمیم از **سرور** می‌آید (`allowed`)، نه از حسابِ سطح در کلاینت.
   *
   * تا دیروز این‌جا `lvl >= min` حساب می‌شد و صلاحیتِ نقش اصلاً دیده نمی‌شد:
   * رانندهٔ سطح ۲ کاشیِ «پنلِ کارشناسی» را می‌دید و کارشناسِ سطح ۲ کاشیِ
   * «پرتالِ حمل‌ونقل» را، و هر کدام که می‌زد به صفحهٔ خالی می‌رسید.
   *
   * `min`ِ کد فقط تا رسیدنِ پاسخِ سرور به کار می‌آید تا کاشی‌ها نپرند.
   */
  const allowed = (t) => {
    const f = features?.[t.key];
    if (f) return !!f.allowed;
    return lvl >= t.min;
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
              <span className="lx-hero-arrow"><ArrowStart width="22" height="22" /></span>
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
