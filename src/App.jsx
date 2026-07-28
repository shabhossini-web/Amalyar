import { Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from './app/ErrorBoundary.jsx';
import { AuthProvider, useAuth } from './app/auth.jsx';
import Landing from './pages/Landing.jsx';
import Launcher from './app/Launcher.jsx';
import Login from './app/Login.jsx';
import Users from './app/Users.jsx';
import Profile from './app/Profile.jsx';
import Dashboard from './app/Dashboard.jsx';
import Definitions from './app/Definitions.jsx';
import PatientRecord from './app/PatientRecord.jsx';
import PlatformAdmin from './app/PlatformAdmin.jsx';

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
        <Routes>
          <Route path="/" element={<TenantAwareRoot />} />
          <Route path="/login" element={<Login />} />
          <Route path="/platform-admin" element={<PlatformAdmin />} />
          <Route path="/app" element={<Protected><Launcher /></Protected>} />
          <Route path="/app/dashboard" element={<Protected><Dashboard /></Protected>} />
          <Route path="/app/users" element={<Protected><Users /></Protected>} />
          <Route path="/app/definitions" element={<Protected><Definitions /></Protected>} />
          <Route path="/app/patients/:id" element={<Protected><PatientRecord /></Protected>} />
          <Route path="/app/profile" element={<Protected><Profile /></Protected>} />
        </Routes>
      </AuthProvider>
    </ErrorBoundary>
  );
}
