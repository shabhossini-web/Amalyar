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

/**
 * نشانیِ کاملِ یک مسیرِ API — برای `src` تصویر و هر جایی که `fetch` نیست.
 *
 * ⚠️ لازم است چون در توسعه API روی مبدأِ دیگری است (`VITE_API_BASE`)؛ نشانیِ
 * نسبی آن‌جا به سرورِ ویت می‌خورد و ۴۰۴ می‌گیرد. مقدارِ خالی → همان خالی، تا
 * `<img src>` با رشتهٔ بی‌معنی پر نشود.
 */
export const apiUrl = (path) => (path ? `${BASE}${path}` : path);

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

/**
 * POSTِ استریمی (SSE) — برای دستیارِ AI: رویدادهای `data: {d}` تکه‌تکه به
 * `onChunk` می‌رسند تا متن زنده نوشته شود؛ `{error}` وسطِ راه یعنی استریم
 * برید و همان پیامِ سرور پرتاب می‌شود؛ `[DONE]` پایانِ سالم.
 *
 * ⚠️ EventSource نیست چون هدرِ ورود می‌خواهد و بدنهٔ POST — fetchِ خام با
 * خواندنِ ReadableStream همین کار را بدونِ وابستگی می‌کند.
 */
export async function apiStream(path, body, onChunk) {
  const headers = { 'Content-Type': 'application/json' };
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => null);
    throw new ApiError(j?.message ?? 'خطای سرور', res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const evt = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = evt.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const data = line.slice(6);
      if (data === '[DONE]') return;
      const j = JSON.parse(data);
      if (j.error) throw new ApiError(j.error, 502);
      if (j.d) onChunk(j.d);
    }
  }
}

/**
 * اشتراکِ SSE با GET (چتِ سازمانی) — رویدادهای JSON به `onEvent` می‌رسند.
 * تابعِ برگشتی اتصال را می‌بندد (برای unmount). قطعِ شبکه با تأخیرِ کوتاه
 * دوباره وصل می‌شود — قطعیِ استریم فقط «دیرتر فهمیدن» است، نه گم‌شدنِ پیام.
 */
export function apiEvents(path, onEvent) {
  let stopped = false;
  let ctl = null;

  const connect = async () => {
    while (!stopped) {
      ctl = new AbortController();
      try {
        const headers = {};
        const tok = getToken();
        if (tok) headers.Authorization = `Bearer ${tok}`;
        const res = await fetch(`${BASE}${path}`, { headers, signal: ctl.signal });
        if (!res.ok || !res.body) throw new Error(String(res.status));
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const evt = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const line = evt.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try { onEvent(JSON.parse(line.slice(6))); } catch { /* ضربان/ناقص */ }
          }
        }
      } catch { /* قطع شد — دوباره وصل می‌شویم */ }
      if (!stopped) await new Promise((r) => setTimeout(r, 4000));
    }
  };
  connect();
  return () => { stopped = true; ctl?.abort(); };
}
