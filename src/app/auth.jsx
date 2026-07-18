import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from '../lib/api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api('/auth/me');
        if (alive) setUser(me);
      } catch {
        setToken(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (identifier, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { identifier, password }, auth: false });
    setToken(r.accessToken);
    setUser(r.user);
    return r.user;
  }, []);

  const register = useCallback(async (payload) => {
    await api('/auth/register', { method: 'POST', body: payload, auth: false });
    // بعد از ساختِ اولین مدیر، بلافاصله واردش می‌کنیم
    return login(payload.username || payload.phone, payload.password);
  }, [login]);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* توکن به‌هرحال پاک می‌شود */
    }
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, logout, setUser }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
