/* ⚠️ هر صفحه یک چانکِ جدا است (`lazy`)، نه یک باندلِ واحد.
   تا دیروز `App.jsx` هر ۳۸ صفحه را ثابت import می‌کرد، یعنی بازدیدکننده‌ای که
   فقط لندینگ یا فرمِ ورود را باز می‌کرد حسابداری و انبار و چینش و دستیارِ
   هوشِ مصنوعی را هم دانلود می‌کرد: از ۸۴۸ kB باندل، ۴۳۲ kB کدی بود که آن صفحه
   هرگز اجرا نمی‌کرد. اندازه‌گیری‌شده روی همین کامیت: ورودی ۳۰۸ → ۱۳۷ kB فشرده،
   و «تا دیده‌شدنِ محتوا» روی ۴G ایران ۸٫۰ → ۵٫۲ ثانیه.
   افزودنِ صفحهٔ تازه هم باید `lazy` باشد، وگرنه بی‌سروصدا به ورودی برمی‌گردد. */
import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from './app/ErrorBoundary.jsx';
import { AuthProvider, useAuth } from './app/auth.jsx';
import { ConfigProvider } from './app/config.jsx';
const Landing = lazy(() => import('./pages/Landing.jsx'));
const TenantSite = lazy(() => import('./pages/TenantLanding.jsx').then((m) => ({ default: m.TenantSite })));
const Intake = lazy(() => import('./pages/Intake.jsx'));
const Survey = lazy(() => import('./pages/Survey.jsx'));
const VisitSummary = lazy(() => import('./pages/VisitSummary.jsx'));
const Portal = lazy(() => import('./pages/Portal.jsx'));
const Shell = lazy(() => import('./app/Shell.jsx'));
const WorkList = lazy(() => import('./app/WorkList.jsx'));
const SurgeonPortal = lazy(() => import('./app/SurgeonPortal.jsx'));
const Launcher = lazy(() => import('./app/Launcher.jsx'));
const Today = lazy(() => import('./app/Today.jsx'));
const Login = lazy(() => import('./app/Login.jsx'));
const Users = lazy(() => import('./app/Users.jsx'));
const Access = lazy(() => import('./app/Access.jsx'));
const Profile = lazy(() => import('./app/Profile.jsx'));
const Dashboard = lazy(() => import('./app/Dashboard.jsx'));
const Definitions = lazy(() => import('./app/Definitions.jsx'));
const FormBuilder = lazy(() => import('./app/FormBuilder.jsx'));
const Inventory = lazy(() => import('./app/Inventory.jsx'));
const Accounting = lazy(() => import('./app/Accounting.jsx'));
const Calendar = lazy(() => import('./app/Calendar.jsx'));
const FrontDesk = lazy(() => import('./app/FrontDesk.jsx'));
const Schedule = lazy(() => import('./app/Schedule.jsx'));
const Dispatch = lazy(() => import('./app/Dispatch.jsx'));
const Tech = lazy(() => import('./app/Tech.jsx'));
const Transport = lazy(() => import('./app/Transport.jsx'));
const IntakeAdmin = lazy(() => import('./app/Intake.jsx'));
const Crm = lazy(() => import('./app/Crm.jsx'));
const Reminders = lazy(() => import('./app/Reminders.jsx'));
const Letters = lazy(() => import('./app/Letters.jsx'));
const NotesSearch = lazy(() => import('./app/NotesSearch.jsx'));
const OrderPublic = lazy(() => import('./app/OrderPublic.jsx'));
const Assistant = lazy(() => import('./app/Assistant.jsx'));
const Chat = lazy(() => import('./app/Chat.jsx'));
import Gate from './app/Gate.jsx';
const PatientRecord = lazy(() => import('./app/PatientRecord.jsx'));
const Settings = lazy(() => import('./app/Settings.jsx'));
const Site = lazy(() => import('./app/Site.jsx'));
const PlatformAdmin = lazy(() => import('./app/PlatformAdmin.jsx'));
/* دکمه‌های سه‌بعدی + کفِ تاچ‌تارگت — سراسری، بعد از CSSهای صفحه‌ها تا برنده شود. */
import './ui/press.css';

const MARKETING_HOSTS = new Set(['amalyar.com', 'www.amalyar.com', 'localhost', '127.0.0.1']);
const PLATFORM_HOSTS = new Set((import.meta.env.VITE_PLATFORM_HOSTS || 'admin-staging.amalyar.com').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean));

function TenantAwareRoot() {
  const hostname = typeof window === 'undefined' ? '' : window.location.hostname.toLowerCase();
  if (PLATFORM_HOSTS.has(hostname)) return <Navigate to="/platform-admin" replace />;
  const forced = import.meta.env.VITE_TENANT_UI;
  const tenantMode =
    forced === 'true' ||
    (forced !== 'false' && typeof window !== 'undefined' && !MARKETING_HOSTS.has(window.location.hostname));
  if (!tenantMode) return <Landing />;
  /* ریشهٔ دامنهٔ شرکت: اگر سایتِ معرفی روشن باشد همان را نشان بده، وگرنه —
     مثلِ همیشه — فرمِ ورود. تصمیم با سرور است (`/public/site`)، نه با کلاینت. */
  return <TenantSite fallback={<Navigate to="/login" replace />} />;
}

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="lx-boot">در حال بارگذاری…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ConfigProvider>
        <Suspense fallback={<div className="lx-boot">در حال بارگذاری…</div>}>
        <Routes>
          <Route path="/" element={<TenantAwareRoot />} />
          <Route path="/login" element={<Login />} />
          {/* ⚠️ عمومی و بیرونِ Protected — بیمار حسابِ کاربری ندارد. */}
          <Route path="/r/:token" element={<Intake step="register" />} />
          <Route path="/f/:token" element={<Intake step="form" />} />
          {/* نظرسنجیِ بیمار — عمومی، مثلِ لینک‌های ثبت‌نام. */}
          <Route path="/s/:token" element={<Survey />} />
          {/* خلاصهٔ ویزیت — سندِ چاپیِ بیمار؛ عمومی با توکن. */}
          <Route path="/v/:token" element={<VisitSummary />} />
          {/* پروندهٔ الکترونیکِ بیمار — لینکِ دائمی؛ عمومی با توکن. */}
          <Route path="/p/:token" element={<Portal />} />
          {/* سفارشِ بالینی — چیزی که بیمار از لینکِ پیامک باز می‌کند. */}
          <Route path="/o/:token" element={<OrderPublic />} />
          <Route path="/platform-admin" element={<PlatformAdmin />} />
          {/* پوستهٔ سراسری (W2.4): یک نوارِ ثابت بالای همهٔ صفحاتِ سامانه — Shell خودش lazy است. */}
          <Route element={<Protected><Shell /></Protected>}>
            <Route path="/app/surgeon" element={<Gate feature="surgeon"><SurgeonPortal /></Gate>} />
            {/* W2.3 (`DECISIONS.md` #۲): صفحهٔ نخست «امروز» است؛ کاشی‌ها در کشوی «همهٔ ابزارها» و نمای کاملشان روی `/app/tools`. */}
            <Route path="/app" element={<Today />} />
            <Route path="/app/tools" element={<Launcher />} />
            <Route path="/app/dashboard" element={<Gate feature="dashboard"><Dashboard /></Gate>} />
            <Route path="/app/users" element={<Gate feature="users"><Users /></Gate>} />
            <Route path="/app/access" element={<Gate feature="access"><Access /></Gate>} />
            <Route path="/app/definitions" element={<Definitions />} />
            <Route path="/app/forms" element={<FormBuilder />} />
            <Route path="/app/inventory" element={<Gate feature="inventory"><Inventory /></Gate>} />
            <Route path="/app/accounting" element={<Gate feature="accounting"><Accounting /></Gate>} />
            <Route path="/app/calendar" element={<Gate feature="calendar"><Calendar /></Gate>} />
            <Route path="/app/frontdesk" element={<Gate feature="frontdesk"><FrontDesk /></Gate>} />
            <Route path="/app/schedule" element={<Gate feature="calendar"><Schedule /></Gate>} />
            <Route path="/app/dispatch" element={<Gate feature="dispatch"><Dispatch /></Gate>} />
            <Route path="/app/tech" element={<Gate feature="tech"><Tech /></Gate>} />
            <Route path="/app/transport" element={<Gate feature="transport"><Transport /></Gate>} />
            <Route path="/app/intake" element={<Gate feature="formgen"><IntakeAdmin /></Gate>} />
            <Route path="/app/crm" element={<Gate feature="formgen"><Crm /></Gate>} />
            <Route path="/app/reminders" element={<Gate feature="dashboard"><Reminders /></Gate>} />
            <Route path="/app/letters" element={<Letters />} />
            <Route path="/app/notes" element={<Gate feature="dashboard"><NotesSearch /></Gate>} />
            <Route path="/app/assistant" element={<Assistant />} />
            <Route path="/app/chat" element={<Chat />} />
            <Route path="/app/patients/:id" element={<PatientRecord />} />
            <Route path="/app/site" element={<Gate feature="site"><Site /></Gate>} />
            <Route path="/app/settings" element={<Settings />} />
            <Route path="/app/profile" element={<Profile />} />
            <Route path="/app/work" element={<Gate feature="work"><WorkList /></Gate>} />
          </Route>
          {/* CRM زیرِ همان featureِ formgen: داده‌اش تماماً از ثبت‌نام‌ها می‌آید
              و مجوزِ تازه در ماتریسِ دسترسی یعنی یک ردیفِ پیکربندی برای هر نصب. */}
          {/* دفترِ یادآوری‌ها — زیرِ featureِ داشبورد؛ داده‌اش از همان مراجعات است. */}
        </Routes>
        </Suspense>
        </ConfigProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
