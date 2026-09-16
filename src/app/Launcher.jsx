import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Mark from '../components/Mark.jsx';
import { useAuth } from './auth.jsx';
import { useConfig } from './config.jsx';
import ProfileMenu from './ProfileMenu.jsx';
import './launcher.css';
import { ArrowStart, Back } from '../ui/icons.jsx';
/* کاتالوگِ کاشی‌ها از W2.3 مشترک است — صفحهٔ «امروز» هم از همین می‌خواند. */
import { HERO, useAllowedTools, track } from './tools.jsx';


export default function Launcher() {
  const [toast, setToast] = useState('');
  const { user } = useAuth();
  const { brandName } = useConfig();
  const navigate = useNavigate();
  useEffect(() => { document.title = 'همهٔ ابزارها — عمل‌یار'; }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  const soon = (label) => setToast(`«${label}» به‌زودی`);
  const open = (t) => (t.to ? navigate(t.to) : soon(t.label));

  const lvl = user?.level ?? 0;
  const { hero, daily, tools, nothing } = useAllowedTools();
  const showHero = !!hero;

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
          {/* نامِ شرکتِ مشتری — تنها جایی که برندِ انتخابیِ خودش را می‌بیند. */}
          {brandName && <div className="lx-company">{brandName}</div>}
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
