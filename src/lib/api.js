// کلاینتِ سادهٔ API برای بک‌اندِ عمل‌یار
const SAME_ORIGIN_API = typeof window === 'undefined' ? '/api' : `${window.location.origin}/api`;
const BASE = (import.meta.env.VITE_API_BASE || SAME_ORIGIN_API).replace(/\/$/, '');
const TOKEN_KEY = 'amalyar_token';

// «مرا به خاطر بسپار»: تیک‌خورده → localStorage (ماندگار)؛ بدونِ تیک → sessionStorage (تا بستنِ مرورگر)
export const getToken = () => sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
export const setToken = (t, remember = true) => {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  if (t) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t);
};

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, auth = true, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const tok = token ?? getToken(); // token صریح: برای عملیات روی حسابِ غیرفعال (خروجِ تکی)
  if (auth && tok) headers.Authorization = `Bearer ${tok}`;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('اتصال به سرور برقرار نشد. اینترنت را بررسی کنید.', 0);
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    // سشنِ فعال وسطِ کار مُرد (revoke/انقضا) → رویدادِ سراسری تا AuthProvider بازیابی کند
    if (res.status === 401 && auth && !token && tok) {
      window.dispatchEvent(new CustomEvent('amalyar:unauthorized'));
    }
    const m = data && typeof data === 'object' ? data.message : null;
    const msg = Array.isArray(m) ? m.join('، ') : m || `خطای سرور (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data;
}

/**
 * آپلودِ فایل. عمداً `Content-Type` ست نمی‌شود: مرورگر باید خودش
 * `multipart/form-data` را با boundary بسازد و دست‌کاریِ ما آن را خراب می‌کند.
 */
export async function apiUpload(path, formData) {
  const headers = {};
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: formData });
  } catch {
    throw new ApiError('اتصال به سرور برقرار نشد. اینترنت را بررسی کنید.', 0);
  }
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) {
    if (res.status === 401 && tok) window.dispatchEvent(new CustomEvent('amalyar:unauthorized'));
    const m = data && typeof data === 'object' ? data.message : null;
    throw new ApiError(Array.isArray(m) ? m.join('، ') : m || `خطای سرور (${res.status})`, res.status);
  }
  return data;
}

/**
 * فایلِ محافظت‌شده را به‌شکلِ blob URL می‌گیرد.
 *
 * لازم است چون مدارک پشتِ هدرِ Authorization‌اند و `<img src>` هدر نمی‌فرستد.
 * ⚠️ فراخوان باید URL را با `URL.revokeObjectURL` آزاد کند وگرنه حافظه نشت می‌کند.
 */
/**
 * فایلِ محافظت‌شده به‌شکلِ data URL — برای جاسازی در سندِ چاپیِ پنجرهٔ جدا،
 * جایی که blob URLِ پنجرهٔ مادر قابلِ‌اتکا نیست. نبودِ فایل، null است نه خطا.
 */
export async function apiDataUrl(path) {
  const headers = {};
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  try {
    const res = await fetch(`${BASE}${path}`, { headers });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function apiBlobUrl(path) {
  const headers = {};
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) throw new ApiError('فایل در دسترس نیست', res.status);
  return URL.createObjectURL(await res.blob());
}
