// کلاینتِ سادهٔ API برای بک‌اندِ عمل‌یار
//
// ⚠️ احراز با **کوکیِ HttpOnly** است، نه توکن در storage: مرورگر خودش کوکی را
// می‌فرستد (`credentials: 'include'`) و جاوااسکریپت هیچ توکنی در دست ندارد که
// با XSS لو برود. برای درخواست‌های تغییردهنده، نشانِ CSRF از کوکیِ خواندنی
// در هدرِ `X-CSRF-Token` تکرار می‌شود (double-submit) — سایتِ دیگری آن کوکی را
// نمی‌بیند. (`server/src/auth/session-cookie.ts`)
const SAME_ORIGIN_API = typeof window === 'undefined' ? '/api' : `${window.location.origin}/api`;
const BASE = (import.meta.env.VITE_API_BASE || SAME_ORIGIN_API).replace(/\/$/, '');
const CSRF_COOKIE = 'amalyar_csrf';

const readCookie = (name) => {
  try {
    const hit = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
  } catch {
    return null;
  }
};
const mutating = (method) => !['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase());

/** هدرهای احراز: فقط نشانِ CSRF برای درخواستِ تغییردهنده — توکنی وجود ندارد که فرستاده شود. */
function authHeaders(method, headers = {}) {
  if (mutating(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  return headers;
}

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

const parseBody = async (res) => {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const messageOf = (data, status) => {
  const m = data && typeof data === 'object' ? data.message : null;
  return Array.isArray(m) ? m.join('، ') : m || `خطای سرور (${status})`;
};

/** سشنِ فعال وسطِ کار مُرد (revoke/انقضا) → رویدادِ سراسری تا AuthProvider بازیابی کند. */
const announceUnauthorized = (path, quiet) => {
  if (quiet || path.startsWith('/auth/')) return;
  window.dispatchEvent(new CustomEvent('amalyar:unauthorized'));
};

/**
 * @param {string} path
 * @param {{method?: string, body?: any, quiet401?: boolean}} [opts]
 *   quiet401 — برای کاوش‌های خودِ AuthProvider که ۴۰۱ برایشان جواب است نه حادثه.
 */
export async function api(path, { method = 'GET', body, quiet401 = false } = {}) {
  const headers = authHeaders(method);
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('اتصال به سرور برقرار نشد. اینترنت را بررسی کنید.', 0);
  }

  const data = await parseBody(res);
  if (!res.ok) {
    if (res.status === 401) announceUnauthorized(path, quiet401);
    throw new ApiError(messageOf(data, res.status), res.status);
  }
  return data;
}

/**
 * آپلودِ فایل. عمداً `Content-Type` ست نمی‌شود: مرورگر باید خودش
 * `multipart/form-data` را با boundary بسازد و دست‌کاریِ ما آن را خراب می‌کند.
 */
export async function apiUpload(path, formData) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method: 'POST', headers: authHeaders('POST'), credentials: 'include', body: formData });
  } catch {
    throw new ApiError('اتصال به سرور برقرار نشد. اینترنت را بررسی کنید.', 0);
  }
  const data = await parseBody(res);
  if (!res.ok) {
    if (res.status === 401) announceUnauthorized(path, false);
    /* ⚠️ ۴۱۳ از multer با متنِ انگلیسیِ «File too large» می‌آید و خام کنارِ دکمهٔ بیمار می‌نشست
       (بازبینیِ UX، بندِ ۹۹). پیامِ فارسیِ خودِ سرور (اگر بود) مقدم است. */
    const tooLarge = res.status === 413 && !/[\u0600-\u06FF]/.test(messageOf(data, res.status));
    throw new ApiError(tooLarge ? 'حجمِ فایل از سقفِ مجاز بیشتر است — فایلِ کوچک‌تری بفرستید' : messageOf(data, res.status), res.status);
  }
  return data;
}

/**
 * فایلِ محافظت‌شده به‌شکلِ data URL — برای جاسازی در سندِ چاپیِ پنجرهٔ جدا،
 * جایی که blob URLِ پنجرهٔ مادر قابلِ‌اتکا نیست. نبودِ فایل، null است نه خطا.
 */
export async function apiDataUrl(path) {
  try {
    const res = await fetch(`${BASE}${path}`, { credentials: 'include' });
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

/**
 * فایلِ محافظت‌شده را به‌شکلِ blob URL می‌گیرد.
 *
 * هنوز لازم است: مدارک پشتِ احرازند و بعضی جاها (پیش‌نمایشِ داخلِ اپ) کنترلِ
 * خطا و آزادسازیِ حافظه می‌خواهند. ⚠️ فراخوان باید URL را با
 * `URL.revokeObjectURL` آزاد کند وگرنه حافظه نشت می‌کند.
 */
export async function apiBlobUrl(path) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { credentials: 'include' });
  } catch {
    throw new ApiError('اتصال به سرور برقرار نشد. اینترنت را بررسی کنید.', 0);
  }
  if (!res.ok) {
    /* ⚠️ پیامِ خودِ سرور را نشان بده («فایلِ این مدرک روی سرور نیست» با «دسترسی
       ندارید» فرق دارد و درمانشان هم فرق می‌کند)؛ پیامِ کلی فقط وقتی بدنه نیست. */
    if (res.status === 401) announceUnauthorized(path, false);
    const data = await parseBody(res).catch(() => null);
    throw new ApiError(data && typeof data === 'object' && data.message ? messageOf(data, res.status) : 'فایل در دسترس نیست', res.status);
  }
  return URL.createObjectURL(await res.blob());
}

/**
 * POSTِ استریمی (SSE) — برای دستیارِ AI: رویدادهای `data: {d}` تکه‌تکه به
 * `onChunk` می‌رسند تا متن زنده نوشته شود؛ `{error}` وسطِ راه یعنی استریم
 * برید و همان پیامِ سرور پرتاب می‌شود؛ `[DONE]` پایانِ سالم.
 *
 * ⚠️ EventSource نیست چون بدنهٔ POST می‌خواهد — fetchِ خام با خواندنِ
 * ReadableStream همین کار را بدونِ وابستگی می‌کند.
 */
export async function apiStream(path, body, onChunk) {
  const headers = authHeaders('POST', { 'Content-Type': 'application/json' });
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body) });
  } catch {
    throw new ApiError('اتصال به سرور برقرار نشد. اینترنت را بررسی کنید.', 0);
  }
  if (!res.ok || !res.body) {
    if (res.status === 401) announceUnauthorized(path, false);
    const j = await res.json().catch(() => null);
    const m = j?.message;
    throw new ApiError(Array.isArray(m) ? m.join('، ') : m || 'خطای سرور', res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let hasText = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new ApiError('پاسخِ دستیار کامل دریافت نشد — دوباره تلاش کنید', 502);
      buf += dec.decode(value, { stream: true });
      let boundary;
      // SSE با LF و CRLF معتبر است؛ مرز ممکن است بین دو بسته بشکند.
      while ((boundary = /\r?\n\r?\n/.exec(buf))) {
        const evt = buf.slice(0, boundary.index);
        buf = buf.slice(boundary.index + boundary[0].length);
        const data = evt.split(/\r?\n/).filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, '')).join('\n');
        if (!data) continue;
        if (data === '[DONE]') {
          if (!hasText) throw new ApiError('پاسخِ سرویسِ هوشِ مصنوعی خالی بود — متنِ قبلی حفظ شد', 502);
          return;
        }
        let j;
        try { j = JSON.parse(data); }
        catch { throw new ApiError('پاسخِ دستیار نامعتبر بود — دوباره تلاش کنید', 502); }
        if (j.error) throw new ApiError(typeof j.error === 'string' ? j.error : 'خطای سرویسِ هوشِ مصنوعی', 502);
        if (typeof j.d === 'string' && j.d) {
          hasText ||= !!j.d.trim();
          onChunk(j.d);
        }
      }
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('ارتباط با دستیار قطع شد — دوباره تلاش کنید', 0);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
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
        const res = await fetch(`${BASE}${path}`, { credentials: 'include', signal: ctl.signal });
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
