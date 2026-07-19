import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from '../lib/api.js';

const AuthCtx = createContext(null);

// شناسهٔ پس‌کی‌های ثبت‌شده روی همین دستگاه — تا موقعِ ورود allowCredentials پر شود
// و مرورگر بدونِ پنجرهٔ «انتخابِ پس‌کی» مستقیم اثر انگشت بخواهد.
const CRED_KEY = 'amalyar_cred_ids';
const getCredIds = () => {
  try {
    const v = JSON.parse(localStorage.getItem(CRED_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const addCredId = (id) => {
  if (!id) return;
  const s = new Set(getCredIds());
  s.add(id);
  localStorage.setItem(CRED_KEY, JSON.stringify([...s]));
};

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

  const login = useCallback(async (identifier, password, remember = true) => {
    const r = await api('/auth/login', { method: 'POST', body: { identifier, password }, auth: false });
    setToken(r.accessToken, remember);
    setUser(r.user);
    return r.user;
  }, []);

  // ورود با اثر انگشت (WebAuthn)
  const webauthnLogin = useCallback(async () => {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    const { options, challengeToken } = await api('/auth/webauthn/login/options', {
      method: 'POST',
      body: { credIds: getCredIds() },
      auth: false,
    });
    const response = await startAuthentication({ optionsJSON: options });
    const r = await api('/auth/webauthn/login/verify', { method: 'POST', body: { response, challengeToken }, auth: false });
    addCredId(response?.id);
    setToken(r.accessToken, true);
    setUser(r.user);
    return r.user;
  }, []);

  // ثبتِ اثر انگشت برای حسابِ جاری
  const webauthnRegister = useCallback(async () => {
    const { startRegistration } = await import('@simplewebauthn/browser');
    const { options, challengeToken } = await api('/auth/webauthn/register/options', { method: 'POST' });
    const response = await startRegistration({ optionsJSON: options });
    const r = await api('/auth/webauthn/register/verify', { method: 'POST', body: { response, challengeToken } });
    addCredId(response?.id);
    return r;
  }, []);

  // مرحلهٔ ۱ ثبت‌نام — ارسالِ کدِ یکبارمصرف به موبایل
  const requestOtp = useCallback(
    (phone) => api('/auth/signup/request-otp', { method: 'POST', body: { phone }, auth: false }),
    [],
  );

  // مرحلهٔ ۲ — تأییدِ کد → توکنِ کوتاه‌عمرِ ثبت‌نام
  const verifyOtp = useCallback(
    (phone, code) =>
      api('/auth/signup/verify-otp', { method: 'POST', body: { phone, code }, auth: false }),
    [],
  );

  // مرحلهٔ ۳ — تکمیلِ پروفایل. اگر اولین حساب باشد خودکار وارد می‌شود.
  const completeSignup = useCallback(async (payload) => {
    const r = await api('/auth/signup/complete', { method: 'POST', body: payload, auth: false });
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
    <AuthCtx.Provider value={{ user, loading, login, requestOtp, verifyOtp, completeSignup, webauthnLogin, webauthnRegister, logout, setUser }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
