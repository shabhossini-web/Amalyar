import { useEffect, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import Mark from '../components/Mark.jsx';
import { useConfig } from './config.jsx';
import ProfileMenu from './ProfileMenu.jsx';
import GlobalSearch from './GlobalSearch.jsx';
import WorkBell from './WorkBell.jsx';
import ChatBell from './ChatBell.jsx';
import { Search } from '../ui/icons.jsx';
/* `.glass`ِ منوی پروفایل در launcher.css تعریف شده؛ حالا که منو روی همهٔ صفحات است،
   پوسته صریحاً آن را می‌آورد (قانونِ ۲۱: هیچ صفحه‌ای از CSSِ صفحهٔ دیگر ارث نمی‌برد). */
import './launcher.css';
import './shell.css';
import Toast, { useToast } from '../ui/Toast.jsx';

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
  const { msg: toast, show: setToast } = useToast(1800);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
  /* منوی پروفایل **فقط** این‌جاست — روی لانچر (`/app/tools`) هم. تا بازبینیِ UX (۱۴۰۵/۰۷)
     لانچر چیپِ خودش را داخلِ بدنه داشت و این نوار آن‌جا بی‌پروفایل بود. */

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
            {/* روی گوشی «جستجو»: «جستجوی بیم…»ِ بریده بدتر از واژهٔ کوتاه است (بازبینیِ UX ۱۴۰۵/۰۷). */}
            <span className="sh-search-label">جستجوی بیمار…</span>
            <span className="sh-search-short" aria-hidden="true">جستجو</span>
            <kbd className="sh-kbd" aria-hidden="true">{isMac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
          <div className="sh-end">
            <ChatBell />
            <WorkBell onToast={setToast} />
            <ProfileMenu onToast={setToast} />
          </div>
        </div>
      </header>
      <InstallBanner onToast={setToast} />
      <GlobalSearch open={searchOpen} onOpen={() => setSearchOpen(true)} onClose={() => setSearchOpen(false)} />
      <Outlet />
      <Toast msg={toast} />
    </>
  );
}

const A2HS_KEY = 'amalyar_a2hs_dismissed';
const dismissed = () => { try { return !!localStorage.getItem(A2HS_KEY); } catch { return false; } };

/**
 * بنرِ «عمل‌یار را روی گوشی نصب کن» (اندروید/کروم — `beforeinstallprompt`).
 *
 * تا بازبینیِ UX (۱۴۰۵/۰۷) فقط لانچر به این رویداد گوش می‌داد — صفحه‌ای که از وقتی «امروز»
 * صفحهٔ نخست شد کسی به آن نمی‌رسید؛ یعنی بنرِ نصبِ خودِ سامانه دیگر دیده نمی‌شد. حالا پوسته
 * گوش می‌دهد و بنر زیرِ نوار، داخلِ جریانِ صفحه می‌نشیند — نه شناورِ پایین، که روی «+»ِ
 * «امروز» و توست بیفتد.
 */
function InstallBanner({ onToast }) {
  const [evt, setEvt] = useState(null);
  useEffect(() => {
    if (dismissed()) return undefined;
    const h = (e) => { e.preventDefault(); setEvt(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  if (!evt) return null;
  const install = async () => {
    evt.prompt();
    const { outcome } = await evt.userChoice;
    if (outcome === 'accepted') onToast?.('عمل‌یار نصب شد');
    setEvt(null);
  };
  const later = () => {
    try { localStorage.setItem(A2HS_KEY, '1'); } catch { /* حالتِ خصوصی — فقط همین بار بسته می‌شود */ }
    setEvt(null);
  };
  return (
    <div className="sh-install" role="region" aria-label="نصبِ اپلیکیشن">
      <span className="sh-install-txt">عمل‌یار را روی گوشی نصب کنید — بی‌مرورگر و با یک لمس باز می‌شود.</span>
      <button type="button" className="sh-install-ok" onClick={install}>نصب</button>
      <button type="button" className="sh-install-no" onClick={later}>بعداً</button>
    </div>
  );
}
