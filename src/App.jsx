import { Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from './app/ErrorBoundary.jsx';
import { AuthProvider, useAuth } from './app/auth.jsx';
import { ConfigProvider } from './app/config.jsx';
import Landing from './pages/Landing.jsx';
import Intake from './pages/Intake.jsx';
import Survey from './pages/Survey.jsx';
import Launcher from './app/Launcher.jsx';
import Login from './app/Login.jsx';
import Users from './app/Users.jsx';
import Access from './app/Access.jsx';
import Profile from './app/Profile.jsx';
import Dashboard from './app/Dashboard.jsx';
import Definitions from './app/Definitions.jsx';
import FormBuilder from './app/FormBuilder.jsx';
import Inventory from './app/Inventory.jsx';
import Accounting from './app/Accounting.jsx';
import Calendar from './app/Calendar.jsx';
import Schedule from './app/Schedule.jsx';
import Dispatch from './app/Dispatch.jsx';
import Tech from './app/Tech.jsx';
import Transport from './app/Transport.jsx';
import IntakeAdmin from './app/Intake.jsx';
import Crm from './app/Crm.jsx';
import Gate from './app/Gate.jsx';
import PatientRecord from './app/PatientRecord.jsx';
import Settings from './app/Settings.jsx';
import PlatformAdmin from './app/PlatformAdmin.jsx';
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
  return tenantMode ? <Navigate to="/login" replace /> : <Landing />;
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
        <Routes>
          <Route path="/" element={<TenantAwareRoot />} />
          <Route path="/login" element={<Login />} />
          {/* ⚠️ عمومی و بیرونِ Protected — بیمار حسابِ کاربری ندارد. */}
          <Route path="/r/:token" element={<Intake step="register" />} />
          <Route path="/f/:token" element={<Intake step="form" />} />
          {/* نظرسنجیِ بیمار — عمومی، مثلِ لینک‌های ثبت‌نام. */}
          <Route path="/s/:token" element={<Survey />} />
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
          <Route path="/app/patients/:id" element={<Protected><PatientRecord /></Protected>} />
          <Route path="/app/settings" element={<Protected><Settings /></Protected>} />
          <Route path="/app/profile" element={<Protected><Profile /></Protected>} />
        </Routes>
        </ConfigProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
