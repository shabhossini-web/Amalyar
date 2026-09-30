import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import {
  getAccounts,
  upsertAccount,
  replaceAccounts,
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

// باقی‌ماندهٔ نسخهٔ توکن‌دار — یک‌بار پاک می‌شود تا توکنِ کهنه در storage نماند.
const LEGACY_TOKEN_KEY = 'amalyar_token';
const dropLegacyToken = () => {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* — */
  }
};

/**
 * AuthProvider — نشست در **کوکیِ HttpOnly** است (`server/src/auth/session-cookie.ts`).
 *
 * کلاینت هیچ توکنی ندارد و نمی‌خواهد: ورود → سرور کوکی می‌گذارد؛ `/auth/me`
 * می‌گوید کی هستیم؛ سوییچ و خروج هم سمتِ سرور روی مجموعهٔ نشست‌های همین
 * مرورگر انجام می‌شود. `accountsStore` فقط کشِ نمایشیِ منوی چندحسابی است.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // نسخهٔ لیستِ حساب‌ها — برای رفرشِ UI بعد از هر تغییرِ مخزن
  const [accountsVersion, setAccountsVersion] = useState(0);
  const bump = () => setAccountsVersion((v) => v + 1);

  /** فهرستِ زندهٔ سرور → کشِ محلی. خطای شبکه → کشِ قبلی می‌ماند. */
  const syncAccounts = useCallback(async () => {
    try {
      const list = await api('/auth/accounts', { quiet401: true });
      replaceAccounts(list);
    } catch {
      /* آفلاین یا نشستِ موقت — کشِ فعلی کافی است */
    }
    bump();
  }, []);

  useEffect(() => {
    let alive = true;
    dropLegacyToken();
    (async () => {
      try {
        const me = await api('/auth/me', { quiet401: true });
        if (!alive) return;
        setUser(me);
        updateAccountUser(me.id, me); // پروفایلِ ذخیره‌شده تازه بماند
        await syncAccounts();
      } catch {
        /* وارد نشده‌ایم — صفحهٔ ورود */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [syncAccounts]);

  /** به حسابِ زندهٔ بعدیِ مجموعه برو؛ نبود → خروجِ کامل. خروجی: کاربرِ فعال یا null */
  const fallbackToNext = useCallback(async () => {
    let list = [];
    try {
      list = await api('/auth/accounts', { quiet401: true });
    } catch {
      /* ۴۰۱ یعنی نشستِ فعال هم مرده؛ از کشِ محلی امتحان می‌کنیم */
      list = getAccounts().map((a) => a.user);
    }
    for (const a of list) {
      if (a.id === user?.id) continue;
      try {
        const me = await api('/auth/switch', { method: 'POST', body: { accountId: a.id }, quiet401: true });
        setUser(me);
        updateAccountUser(me.id, me);
        await syncAccounts();
        return me;
      } catch (e) {
        if (e?.status === 401 || e?.status === 403) removeAccount(a.id);
        else return null; // شبکه قطع → دست نزن
      }
    }
    clearAccounts();
    setUser(null);
    bump();
    return null;
  }, [user, syncAccounts]);

  // سشنِ فعال وسطِ کار مُرد (۴۰۱ سراسری از api.js) → حسابِ مرده حذف،
  // پرش به حسابِ زندهٔ بعدی وگرنه خروج به /login — به‌جای گیرکردنِ اپ
  useEffect(() => {
    let recovering = false;
    const onUnauthorized = async () => {
      if (recovering) return;
      recovering = true;
      try {
        try {
          await api('/auth/me', { quiet401: true }); // شاید گذرا بود (ری‌استارتِ سرور)
          return;
        } catch (e) {
          if (e?.status !== 401) return; // خطای شبکه → دست نزن
        }
        if (user) removeAccount(user.id);
        await fallbackToNext();
      } finally {
        recovering = false;
      }
    };
    window.addEventListener('amalyar:unauthorized', onUnauthorized);
    return () => window.removeEventListener('amalyar:unauthorized', onUnauthorized);
  }, [user, fallbackToNext]);

  /** بعد از ورودِ موفق — سرور کوکی را گذاشته؛ این‌جا فقط state و کشِ منو. */
  const adopt = (u, remember) => {
    if (remember) upsertAccount(u); // فقط ورودهای ماندگار در لیستِ چندحسابی
    setUser(u);
    bump();
  };

  const login = useCallback(async (identifier, password, remember = true) => {
    const r = await api('/auth/login', { method: 'POST', body: { identifier, password, remember } });
    adopt(r.user, remember);
    return r.user;
  }, []);

  // ورود با اثر انگشت (WebAuthn)
  const webauthnLogin = useCallback(async () => {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    const { options, challengeToken } = await api('/auth/webauthn/login/options', {
      method: 'POST',
      body: { credIds: getCredIds() },
    });
    const response = await startAuthentication({ optionsJSON: options });
    const r = await api('/auth/webauthn/login/verify', { method: 'POST', body: { response, challengeToken, remember: true } });
    addCredId(response?.id);
    adopt(r.user, true);
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
    (phone) => api('/auth/signup/request-otp', { method: 'POST', body: { phone } }),
    [],
  );

  // مرحلهٔ ۲ — تأییدِ کد → توکنِ کوتاه‌عمرِ ثبت‌نام
  const verifyOtp = useCallback(
    (phone, code) => api('/auth/signup/verify-otp', { method: 'POST', body: { phone, code } }),
    [],
  );

  // مرحلهٔ ۳ — تکمیلِ پروفایل. اگر اولین حساب باشد خودکار وارد می‌شود.
  const completeSignup = useCallback(async (payload) => {
    const r = await api('/auth/signup/complete', { method: 'POST', body: payload });
    if (r.accessToken) adopt(r.user, true);
    return r; // { pending, bootstrap?, user, accessToken? }
  }, []);

  /** سوییچ به حسابِ دیگری از لیست — سمتِ سرور؛ اگر نشستش مرده بود از لیست حذف می‌شود. */
  const switchAccount = useCallback(async (id) => {
    try {
      const me = await api('/auth/switch', { method: 'POST', body: { accountId: id }, quiet401: true });
      setUser(me);
      updateAccountUser(id, me);
      bump();
      return me;
    } catch (e) {
      if (e?.status === 401 || e?.status === 403) {
        removeAccount(id);
        bump();
        throw new Error('نشستِ این حساب منقضی شده؛ دوباره وارد شوید');
      }
      throw e; // خطای شبکه → حساب حذف نشود
    }
  }, []);

  /** خروجِ تکی از یک حساب (فعال یا غیرفعال). خروجی: id حسابِ فعالِ بعدی یا null */
  const logoutAccount = useCallback(
    async (id) => {
      let r = null;
      try {
        r = await api('/auth/logout', { method: 'POST', body: id !== user?.id ? { accountId: id } : {}, quiet401: true });
      } catch {
        /* نشستِ سرور شاید قبلاً مرده باشد */
      }
      removeAccount(id);
      if (user?.id !== id) {
        bump();
        return user?.id ?? null;
      }
      // حسابِ فعال خارج شد → سرور یا حسابِ بعدی را فعال کرده یا کوکی‌ها را پاک
      if (r?.next) {
        setUser(r.next);
        updateAccountUser(r.next.id, r.next);
        bump();
        return r.next.id;
      }
      setUser(null);
      bump();
      return null;
    },
    [user],
  );

  /** خروج از همهٔ حساب‌ها (سشن‌های سرور هم باطل می‌شوند) */
  const logoutAll = useCallback(async () => {
    try {
      await api('/auth/logout-all', { method: 'POST', quiet401: true });
    } catch {
      /* — */
    }
    clearAccounts();
    setUser(null);
    bump();
  }, []);

  /** ویرایشِ پروفایلِ حسابِ جاری (نام/نام‌خانوادگی/سلفی) */
  const updateProfile = useCallback(async (payload) => {
    const me = await api('/auth/profile', { method: 'PATCH', body: payload });
    setUser(me);
    updateAccountUser(me.id, me);
    bump();
    return me;
  }, []);

  const changePassword = useCallback(
    (current, next) => api('/auth/change-password', { method: 'POST', body: { current, next } }),
    [],
  );

  /** خروجِ سادهٔ حسابِ جاری (میان‌بر) */
  const logout = useCallback(async () => {
    if (user) return logoutAccount(user.id);
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
        updateProfile,
        changePassword,
        setUser,
      }}
    >
      {user?.verificationDueAt && !user.phoneVerifiedAt && (
        <div className={`account-verification-notice${user.verificationOverdue ? ' overdue' : ''}`} role="status">
          {/* مهلت گذشته ولی حساب باز است — فقط آخرین سوپرادمینِ فعال (بستهٔ PS، PS2؛ مشتقِ سرور). */}
          {user.verificationOverdue
            ? <>مهلتِ تأییدِ شمارهٔ شما گذشته است؛ حساب فقط چون تنها مدیرِ کلِ فعالِ سامانه هستید باز مانده — <a href="/app/profile">همین حالا شماره را تأیید کنید</a>.</>
            : <>حساب شما موقت است؛ پیش از پایان هفت روز <a href="/app/profile">شماره را تأیید و پروفایل را تکمیل کنید</a>.</>}
        </div>
      )}
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
