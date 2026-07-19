// کلاینتِ سادهٔ API برای بک‌اندِ عمل‌یار
const BASE = (import.meta.env.VITE_API_BASE || 'https://api.amalyar.com/api').replace(/\/$/, '');
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

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

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
    const m = data && typeof data === 'object' ? data.message : null;
    const msg = Array.isArray(m) ? m.join('، ') : m || `خطای سرور (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data;
}
