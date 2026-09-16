import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import Mark from '../components/Mark.jsx';
import { useConfig } from './config.jsx';
import ProfileMenu from './ProfileMenu.jsx';
import GlobalSearch from './GlobalSearch.jsx';
import WorkBell from './WorkBell.jsx';
import { Search } from '../ui/icons.jsx';
/* `.glass`ِ منوی پروفایل در launcher.css تعریف شده؛ حالا که منو روی همهٔ صفحات است،
   پوسته صریحاً آن را می‌آورد (قانونِ ۲۱: هیچ صفحه‌ای از CSSِ صفحهٔ دیگر ارث نمی‌برد). */
import './launcher.css';
import './shell.css';

/**
 * پوستهٔ سراسریِ سامانه (W2.4) — یک نوارِ ثابت بالای **همهٔ** صفحاتِ `/app`:
 * نشانِ کوچک + نامِ شرکت، جستجوی بیمار (Ctrl/⌘+K یا `/`)، زنگِ کارها، و منوی پروفایل.
 *
 * ⚠️ `ProfileMenu` فقط این‌جا رندر می‌شود. تا دیروز شش صفحه هرکدام خودشان
 * می‌گذاشتند و ۲۴ صفحهٔ دیگر هیچ — هر صفحه‌ای که دوباره بگذارد، دو منو می‌سازد.
 * صفحه‌ها هدر و لینکِ بازگشتِ خودشان را نگه می‌دارند؛ این نوار جای آن‌ها نیست،
 * لایهٔ مشترکِ بالای آن‌هاست.
 */
export default function Shell() {
  const { brandName } = useConfig();
  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, setToast] = useState('');
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 1800);
    return () => clearTimeout(t);
  }, [toast]);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
  /* صفحهٔ «همهٔ ابزارها» (لانچر) منوی پروفایلِ خودش را دارد — این‌جا دو تا نشود.
     از W2.3 نشانی‌اش `/app/tools` است و `/app` خودش صفحهٔ «امروز» است. */
  const { pathname } = useLocation();
  const launcher = pathname === '/app/tools' || pathname === '/app/tools/';

  return (
    <>
      <header className="sh-bar" role="banner">
        <div className="sh-in">
          <Link to="/app" className="sh-brand" aria-label="سامانه">
            <Mark className="sh-mark" gradient aria-hidden="true" />
            <span className="sh-brand-name">{brandName || 'عمل‌یار'}</span>
          </Link>
          <button
            type="button" id="sh-search-btn" className="sh-search"
            onClick={() => setSearchOpen(true)} aria-label="جستجوی بیمار" aria-keyshortcuts="Control+K"
          >
            <Search width="16" height="16" />
            <span className="sh-search-label">جستجوی بیمار…</span>
            <kbd className="sh-kbd" aria-hidden="true">{isMac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
          <div className="sh-end">
            <WorkBell onToast={setToast} />
            {!launcher && <ProfileMenu onToast={setToast} />}
          </div>
        </div>
      </header>
      <GlobalSearch open={searchOpen} onOpen={() => setSearchOpen(true)} onClose={() => setSearchOpen(false)} />
      <Outlet />
      {toast && <div className="sh-toast" role="status">{toast}</div>}
    </>
  );
}
