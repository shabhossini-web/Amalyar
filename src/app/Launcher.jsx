import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Mark from '../components/Mark.jsx';
import { useAuth } from './auth.jsx';
import { useConfig } from './config.jsx';
import { usePendingAccounts } from './usePending.js';
import './launcher.css';
import { ArrowStart, Back } from '../ui/icons.jsx';
/* کاتالوگِ کاشی‌ها از W2.3 مشترک است — صفحهٔ «امروز» هم از همین می‌خواند. */
import { HERO, useAllowedTools, track } from './tools.jsx';
import Toast, { useToast } from '../ui/Toast.jsx';


export default function Launcher() {
  const { msg: toast, show: setToast } = useToast(1600);
  const { user } = useAuth();
  const { brandName } = useConfig();
  const navigate = useNavigate();
  useEffect(() => { document.title = 'همهٔ ابزارها — عمل‌یار'; }, []);

  const soon = (label) => setToast(`«${label}» به‌زودی`);
  const open = (t) => (t.to ? navigate(t.to) : soon(t.label));

  const lvl = user?.level ?? 0;
  const { hero, daily, tools, nothing } = useAllowedTools();
  const showHero = !!hero;

  /* بنرِ نصب به پوسته رفت (همهٔ صفحه‌ها)؛ شمارِ درخواست‌های عضویت از همان قلابِ زنگ و «امروز». */
  const pendingCount = usePendingAccounts(lvl >= 6);

  return (
    /* `theme-dark`: لانچر ویترین است و شیشه و نئونش را در هر تمی نگه می‌دارد (§۴.۸). */
    <div className="lx theme-dark">
      <div className="lx-bg" aria-hidden="true" />
      <div className="lx-orbs" aria-hidden="true">
        <span className="orb o1" /><span className="orb o2" /><span className="orb o3" />
      </div>
      <div className="lx-grid" aria-hidden="true" />

      <div className="lx-shell">
        {/* بازگشت به «امروز»، نه به سایتِ عمومی: «سایت» کاربرِ واردشده را از سامانه بیرون می‌برد
            (در این نصب به صفحهٔ تبلیغاتیِ عمل‌یار). منوی پروفایل هم مثلِ بقیهٔ صفحه‌ها در نوارِ پوسته است. */}
        <div className="lx-top">
          <Link to="/app" className="lx-back"><Back width="15" height="15" /> امروز</Link>
          <h1 className="lx-title">همهٔ ابزارها</h1>
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

      <Toast msg={toast} />
    </div>
  );
}
