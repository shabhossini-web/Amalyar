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

  // مرحلهٔ ۱ ثبت‌نام — ارسالِ کدِ یکبارمصرف به موبایل
  const requestOtp = useCallback(
    (phone) => api('/auth/signup/request-otp', { method: 'POST', body: { phone }, auth: false }),
    [],
  );

  // مرحلهٔ ۲ — تأییدِ کد + ساختِ حساب. اگر اولین حساب باشد خودکار وارد می‌شود.
  const verifySignup = useCallback(async (payload) => {
    const r = await api('/auth/signup/verify', { method: 'POST', body: payload, auth: false });
    if (r.accessToken) {
      setToken(r.accessToken);
      setUser(r.user);
    }
    return r; // { pending, bootstrap?, user, accessToken? }
  }, []);

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
    <AuthCtx.Provider value={{ user, loading, login, requestOtp, verifySignup, logout, setUser }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
