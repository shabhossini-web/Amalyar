import type { Request } from 'express';

/**
 * نشانیِ بازدیدکننده برای **سقفِ نرخ** — آخرین خانهٔ `X-Forwarded-For`، نه اولی.
 *
 * زنجیره: مرورگر → Traefik → API (nginxِ فرانت `/api` را پروکسی نمی‌کند). Traefik نشانیِ
 * واقعیِ اتصال را به **تهِ** فهرست می‌افزاید؛ خانه‌های جلوتر را خودِ فرستنده می‌تواند بنویسد،
 * پس کلیدِ سطل از آن‌ها ساخته نمی‌شود — وگرنه با عوض‌کردنِ یک هدر هر درخواست سطلِ تازه می‌گرفت.
 */
export function clientIp(req: Request): string {
  const raw = req.headers['x-forwarded-for'];
  const hops = (Array.isArray(raw) ? raw.join(',') : raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return (hops.at(-1) || req.ip || 'unknown').slice(0, 64);
}
