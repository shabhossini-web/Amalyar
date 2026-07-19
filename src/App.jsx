import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './app/auth.jsx';
import Landing from './pages/Landing.jsx';
import Launcher from './app/Launcher.jsx';
import Login from './app/Login.jsx';
import Users from './app/Users.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="lx-boot">در حال بارگذاری…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/app" element={<Protected><Launcher /></Protected>} />
        <Route path="/app/users" element={<Protected><Users /></Protected>} />
      </Routes>
    </AuthProvider>
  );
}
