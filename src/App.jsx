import { Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from './app/ErrorBoundary.jsx';
import { AuthProvider, useAuth } from './app/auth.jsx';
import Landing from './pages/Landing.jsx';
import Launcher from './app/Launcher.jsx';
import Login from './app/Login.jsx';
import Users from './app/Users.jsx';
import Profile from './app/Profile.jsx';
import Dashboard from './app/Dashboard.jsx';

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
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/app" element={<Protected><Launcher /></Protected>} />
          <Route path="/app/dashboard" element={<Protected><Dashboard /></Protected>} />
          <Route path="/app/users" element={<Protected><Users /></Protected>} />
          <Route path="/app/profile" element={<Protected><Profile /></Protected>} />
        </Routes>
      </AuthProvider>
    </ErrorBoundary>
  );
}
