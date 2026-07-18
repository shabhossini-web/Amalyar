import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Mark from '../components/Mark.jsx';
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

/* آیتم‌های هاب — ready:false یعنی هنوز ساخته نشده (به‌زودی) */
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

export default function Launcher() {
  const [toast, setToast] = useState('');
  useEffect(() => {
    document.title = 'عمل‌یار — سامانه';
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  const soon = (label) => setToast(`«${label}» به‌زودی`);

  return (
    <div className="lx">
      <div className="lx-bg" aria-hidden="true" />
      <div className="lx-grid" aria-hidden="true" />

      <div className="lx-shell">
        <Link to="/" className="lx-back" aria-label="بازگشت به سایت">↩ سایت</Link>

        <header className="lx-brand">
          <Mark className="lx-mark" gradient draw aria-hidden="true" />
          <div className="lx-word">عمل<span className="grad-text">‌یار</span></div>
          <div className="lx-tag">هوشمند <em>عمل</em> کن</div>
        </header>

        <div className="lx-cards">
          <button className="lx-hero" onClick={() => soon(HERO.label)}>
            <span className="lx-hero-ic"><HERO.icon width="30" height="30" /></span>
            <span className="lx-hero-body">
              <span className="lx-hero-title">{HERO.label}{!HERO.ready && <em className="soon">به‌زودی</em>}</span>
              <span className="lx-hero-desc">{HERO.desc}</span>
            </span>
            <span className="lx-hero-arrow">←</span>
          </button>

          <div className="lx-row">
            {DAILY.map((t) => (
              <button key={t.key} className="lx-card" onClick={() => soon(t.label)}>
                <span className="lx-card-ic"><t.icon width="24" height="24" /></span>
                <span className="lx-card-title">{t.label}</span>
                {!t.ready && <em className="soon dot" title="به‌زودی" />}
              </button>
            ))}
          </div>

          <div className="lx-tools-label">ابزارها</div>
          <div className="lx-tools">
            {TOOLS.map((t) => (
              <button key={t.key} className="lx-tile" onClick={() => soon(t.label)}>
                <span className={`lx-tile-ic tint-${t.tint}`}><t.icon width="24" height="24" /></span>
                <span className="lx-tile-label">{t.label}</span>
                {!t.ready && <em className="soon dot" title="به‌زودی" />}
              </button>
            ))}
          </div>
        </div>

        <footer className="lx-foot">
          <button className="lx-user" onClick={() => soon('ورود')}>
            <span className="lx-avatar">؟</span>
            <span className="lx-user-name">مهمان</span>
            <span className="lx-gear"><Cog width="17" height="17" /></span>
          </button>
          <p className="lx-note">بک‌اند و ورود در مرحلهٔ بعد وصل می‌شود.</p>
        </footer>
      </div>

      <div className={`lx-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}
