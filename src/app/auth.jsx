import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from '../lib/api.js';
import {
  getAccounts,
  upsertAccount,
  removeAccount,
  updateAccountUser,
  clearAccounts,
} from '../lib/accountsStore.js';

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
  // نسخهٔ لیستِ حساب‌ها — برای رفرشِ UI بعد از هر تغییرِ مخزن
  const [accountsVersion, setAccountsVersion] = useState(0);
  const bump = () => setAccountsVersion((v) => v + 1);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api('/auth/me');
        if (alive) {
          setUser(me);
          updateAccountUser(me.id, me); // پروفایلِ ذخیره‌شده تازه بماند
          bump();
        }
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

  const adopt = (accessToken, u, remember) => {
    setToken(accessToken, remember);
    if (remember) upsertAccount(accessToken, u); // فقط ورودهای ماندگار در لیستِ چندحسابی
    setUser(u);
    bump();
  };

  const login = useCallback(async (identifier, password, remember = true) => {
    const r = await api('/auth/login', { method: 'POST', body: { identifier, password }, auth: false });
    adopt(r.accessToken, r.user, remember);
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
    adopt(r.accessToken, r.user, true);
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
    if (r.accessToken) adopt(r.accessToken, r.user, true);
    return r; // { pending, bootstrap?, user, accessToken? }
  }, []);

  /** سوییچ به حسابِ دیگری از لیست؛ اگر سشنش مرده بود از لیست حذف می‌شود */
  const switchAccount = useCallback(async (id) => {
    const acc = getAccounts().find((a) => a.user.id === id);
    if (!acc) throw new Error('حساب یافت نشد');
    setToken(acc.token, true);
    try {
      const me = await api('/auth/me');
      setUser(me);
      updateAccountUser(id, me);
      bump();
      return me;
    } catch (e) {
      removeAccount(id);
      bump();
      // برگشت به حسابِ قبلی اگر هنوز زنده است
      const prev = getAccounts()[0];
      if (prev) {
        setToken(prev.token, true);
      } else {
        setToken(null);
        setUser(null);
      }
      throw new Error(e?.status === 401 ? 'نشستِ این حساب منقضی شده؛ دوباره وارد شوید' : e.message);
    }
  }, []);

  /** خروجِ تکی از یک حساب (فعال یا غیرفعال). خروجی: id حسابِ فعالِ بعدی یا null */
  const logoutAccount = useCallback(
    async (id) => {
      const acc = getAccounts().find((a) => a.user.id === id);
      if (acc) {
        try {
          await api('/auth/logout', { method: 'POST', token: acc.token });
        } catch {
          /* سشنِ سرور شاید قبلاً مرده باشد */
        }
        removeAccount(id);
      }
      if (user?.id === id) {
        // حسابِ فعال خارج شد → سوییچ به بعدی یا خروجِ کامل
        const next = getAccounts()[0];
        if (next) {
          setToken(next.token, true);
          try {
            const me = await api('/auth/me');
            setUser(me);
            updateAccountUser(me.id, me);
            bump();
            return me.id;
          } catch {
            removeAccount(next.user.id);
          }
        }
        setToken(null);
        setUser(null);
        bump();
        return null;
      }
      bump();
      return user?.id ?? null;
    },
    [user],
  );

  /** خروج از همهٔ حساب‌ها (سشن‌های سرور هم باطل می‌شوند) */
  const logoutAll = useCallback(async () => {
    const accs = getAccounts();
    await Promise.allSettled(
      accs.map((a) => api('/auth/logout', { method: 'POST', token: a.token })),
    );
    // سشنِ موقتِ خارج از لیست (ورودِ بدونِ «به خاطر بسپار»)
    if (getToken() && !accs.some((a) => a.token === getToken())) {
      try {
        await api('/auth/logout', { method: 'POST' });
      } catch {
        /* — */
      }
    }
    clearAccounts();
    setToken(null);
    setUser(null);
    bump();
  }, []);

  /** خروجِ سادهٔ حسابِ جاری (میان‌بر) */
  const logout = useCallback(async () => {
    if (user) return logoutAccount(user.id);
    setToken(null);
    setUser(null);
    bump();
    return null;
  }, [user, logoutAccount]);

  return (
    <AuthCtx.Provider
      value={{
        user,
        loading,
        accountsVersion,
        login,
        requestOtp,
        verifyOtp,
        completeSignup,
        webauthnLogin,
        webauthnRegister,
        switchAccount,
        logoutAccount,
        logoutAll,
        logout,
        setUser,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
