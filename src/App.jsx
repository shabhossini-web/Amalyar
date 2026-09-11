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
const SurgeonPortal = lazy(() => import('./app/SurgeonPortal.jsx'));
const Launcher = lazy(() => import('./app/Launcher.jsx'));
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
          <Route path="/app/surgeon" element={<Protected><Gate feature="surgeon"><SurgeonPortal /></Gate></Protected>} />
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
          <Route path="/app" element={<Protected><Launcher /></Protected>} />
          <Route path="/app/dashboard" element={<Protected><Gate feature="dashboard"><Dashboard /></Gate></Protected>} />
          <Route path="/app/users" element={<Protected><Gate feature="users"><Users /></Gate></Protected>} />
          <Route path="/app/access" element={<Protected><Gate feature="access"><Access /></Gate></Protected>} />
          <Route path="/app/definitions" element={<Protected><Definitions /></Protected>} />
          <Route path="/app/forms" element={<Protected><FormBuilder /></Protected>} />
          <Route path="/app/inventory" element={<Protected><Gate feature="inventory"><Inventory /></Gate></Protected>} />
          <Route path="/app/accounting" element={<Protected><Gate feature="accounting"><Accounting /></Gate></Protected>} />
          <Route path="/app/calendar" element={<Protected><Gate feature="calendar"><Calendar /></Gate></Protected>} />
          <Route path="/app/schedule" element={<Protected><Gate feature="calendar"><Schedule /></Gate></Protected>} />
          <Route path="/app/dispatch" element={<Protected><Gate feature="dispatch"><Dispatch /></Gate></Protected>} />
          <Route path="/app/tech" element={<Protected><Gate feature="tech"><Tech /></Gate></Protected>} />
          <Route path="/app/transport" element={<Protected><Gate feature="transport"><Transport /></Gate></Protected>} />
          <Route path="/app/intake" element={<Protected><Gate feature="formgen"><IntakeAdmin /></Gate></Protected>} />
          {/* CRM زیرِ همان featureِ formgen: داده‌اش تماماً از ثبت‌نام‌ها می‌آید
              و مجوزِ تازه در ماتریسِ دسترسی یعنی یک ردیفِ پیکربندی برای هر نصب. */}
          <Route path="/app/crm" element={<Protected><Gate feature="formgen"><Crm /></Gate></Protected>} />
          {/* دفترِ یادآوری‌ها — زیرِ featureِ داشبورد؛ داده‌اش از همان مراجعات است. */}
          <Route path="/app/reminders" element={<Protected><Gate feature="dashboard"><Reminders /></Gate></Protected>} />
          <Route path="/app/letters" element={<Protected><Letters /></Protected>} />
          <Route path="/app/notes" element={<Protected><Gate feature="dashboard"><NotesSearch /></Gate></Protected>} />
          <Route path="/app/assistant" element={<Protected><Assistant /></Protected>} />
          <Route path="/app/chat" element={<Protected><Chat /></Protected>} />
          <Route path="/app/patients/:id" element={<Protected><PatientRecord /></Protected>} />
          <Route path="/app/site" element={<Protected><Gate feature="site"><Site /></Gate></Protected>} />
          <Route path="/app/settings" element={<Protected><Settings /></Protected>} />
          <Route path="/app/profile" element={<Protected><Profile /></Protected>} />
        </Routes>
        </Suspense>
        </ConfigProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
