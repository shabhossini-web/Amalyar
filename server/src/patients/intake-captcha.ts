import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { DIGIT_GLYPHS } from './captcha-glyphs';

/**
 * **پرسشِ امنیتیِ ثبت‌نامِ عمومی — سمتِ سرور** (تصمیمِ مالک، ۱۴۰۵/۰۷/۰۱: «کپچای واقعی»).
 *
 * تا دیروز مرورگر خودش دو عدد را انتخاب می‌کرد و هر سه عدد را همراهِ فرم می‌فرستاد؛ سرور فقط
 * «a + b = پاسخ» را می‌سنجید. یعنی یک اسکریپت بی‌آنکه صفحه را باز کند با `1 + 1 = 2` ثبت‌نام
 * می‌ساخت — پرسشی که پرسنده و پاسخ‌دهنده‌اش یکی‌اند پرسش نیست.
 *
 * حالا:
 * 1. **سرور** دو عدد را انتخاب می‌کند و پرسش را **تصویر** (PNG، رقم‌های فارسی از خطوطِ فونت با
 *    چرخش و موج و نویز) برمی‌گرداند — نه متن، تا پاسخ از روی HTML/JSON خوانده نشود.
 * 2. پاسخ در یک **نشانِ رمزشده** (AES-256-GCM با کلیدِ مشتق از رازِ سرور) همراهِ پرسش می‌رود؛
 *    سرور حالت نگه نمی‌دارد و مرورگر پاسخ را نمی‌بیند. نشان به **همان لینک** و ۱۰ دقیقه بسته است.
 * 3. هر نشان **یک‌بار** سنجیده می‌شود — درست یا غلط. وگرنه یک اسکریپت همان پرسش را با ۲ تا ۱۸
 *    امتحان می‌کرد و با حداکثر ۱۷ درخواست رد می‌شد.
 *
 * ⚠️ فهرستِ نشان‌های مصرف‌شده در حافظهٔ همین پروسه است (مثلِ `RateLimitService`)؛ در چند replica
 * یک نشان روی هر replica یک‌بار پذیرفته می‌شود — سقفِ نرخ جلوی تکرارِ انبوه را می‌گیرد.
 */

/** عمرِ یک پرسش — بیمار فرم را پر می‌کند و بعد پاسخ می‌دهد. */
export const CAPTCHA_TTL_MS = 10 * 60_000;

/** محتوای نشان: `s` دامنه (توکنِ لینک)، `a` پاسخ، `e` انقضا (ms). */
export interface ChallengeBody { s: string; a: number; e: number }

const keyOf = (secret: string) => createHash('sha256').update(`${secret}|intake-captcha`).digest();

export function sealChallenge(secret: string, body: ChallengeBody): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(body), 'utf8'), cipher.final()]);
  return [iv, ct, cipher.getAuthTag()].map((b) => b.toString('base64url')).join('.');
}

/** نشانِ سالم ← محتوا + شناسهٔ یکتا (`n`)؛ دستکاری‌شده/خراب/کلیدِ دیگر ← `null`. */
export function openChallenge(secret: string, token: unknown): (ChallengeBody & { n: string }) | null {
  if (typeof token !== 'string' || token.length > 512) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const [iv, ct, tag] = parts.map((p) => Buffer.from(p, 'base64url'));
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', keyOf(secret), iv);
    decipher.setAuthTag(tag);
    const body = JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8'));
    if (typeof body?.s !== 'string' || !Number.isInteger(body?.a) || !Number.isFinite(body?.e)) return null;
    return { s: body.s, a: body.a, e: body.e, n: parts[0] };
  } catch {
    return null;
  }
}

/** نشان‌های مصرف‌شده تا انقضایشان — بعد از انقضا خودِ نشان رد می‌شود و نگه‌داشتنش لازم نیست. */
export class UsedChallenges {
  private used = new Map<string, number>();

  /** `true` = اولین بار؛ `false` = قبلاً سنجیده شده. */
  consume(nonce: string, expiresAt: number, now = Date.now()): boolean {
    if (this.used.size > 2000) for (const [k, e] of this.used) if (e <= now) this.used.delete(k);
    if (this.used.has(nonce)) return false;
    this.used.set(nonce, expiresAt);
    return true;
  }
}

export type CaptchaVerdict = 'ok' | 'wrong' | 'stale';

/**
 * سنجش — **اول مصرف، بعد مقایسه**: پاسخِ غلط هم نشان را می‌سوزاند.
 * `stale` = خراب، مالِ لینکِ دیگر، منقضی یا تکراری — بیمار باید پرسشِ تازه بگیرد.
 */
export function verifyChallenge(
  secret: string, used: UsedChallenges, scope: string, token: unknown, answer: unknown, now = Date.now(),
): CaptchaVerdict {
  const c = openChallenge(secret, token);
  if (!c || c.s !== scope || c.e <= now) return 'stale';
  if (!used.consume(c.n, c.e, now)) return 'stale';
  const n = typeof answer === 'number' ? answer : Number(String(answer ?? '').trim());
  return Number.isInteger(n) && n === c.a ? 'ok' : 'wrong';
}

/** پرسشِ تازه: تصویر + نشان. */
export function issueChallenge(secret: string, scope: string, now = Date.now()) {
  const a = randomInt(1, 10), b = randomInt(1, 10);
  const expiresAt = now + CAPTCHA_TTL_MS;
  return {
    challenge: sealChallenge(secret, { s: scope, a: a + b, e: expiresAt }),
    image: `data:image/png;base64,${renderChallenge(a, b).toString('base64')}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

// ── تصویر ─────────────────────────────────────────────────────────────
/* بوم دو برابرِ اندازهٔ نمایش (۱۸۰×۶۴) است تا روی صفحهٔ پرتراکم تار نشود. */
const W = 360, H = 128;
type Pt = [number, number];

const rnd = () => randomInt(0, 1_000_000) / 1_000_000;
const between = (lo: number, hi: number) => lo + (hi - lo) * rnd();

/**
 * «a + b» به‌شکلِ PNGِ خاکستری: رقم‌ها با خطوطِ Vazirmatn، هرکدام با اندازه، چرخش و جابه‌جاییِ
 * تصادفی، کلِ متن روی یک موجِ سینوسی، چند خطِ نویز و یک خطِ «پاک‌کن» که از میانِ رقم‌ها می‌گذرد.
 * هدف این است که **آدم** بی‌زحمت بخواند و اسکریپت بدونِ OCR نتواند.
 */
export function renderChallenge(a: number, b: number): Buffer {
  const ink = new Float32Array(W * H);
  const wave = { amp: between(3, 6), len: between(38, 60), ph: between(0, Math.PI * 2) };
  const warp = ([x, y]: Pt): Pt => [x, y + wave.amp * Math.sin(x / wave.len + wave.ph)];
  const place = (contours: Pt[][], cx: number, cy: number, rot: number) => {
    const cos = Math.cos(rot), sin = Math.sin(rot);
    return contours.map((c) => c.map(([x, y]) => warp([cx + x * cos - y * sin, cy + x * sin + y * cos])));
  };
  const digit = (d: number, cx: number) => {
    const g = DIGIT_GLYPHS[d]!;
    const s = between(70, 84) / g.h;
    const contours: Pt[][] = g.c.map((flat) => {
      const pts: Pt[] = [];
      for (let i = 0; i < flat.length; i += 2) pts.push([(flat[i] - g.w / 2) * s, (flat[i + 1] - g.h / 2) * s]);
      return pts;
    });
    return place(contours, cx + between(-10, 10), H / 2 + between(-6, 6), between(-0.22, 0.22));
  };
  const plus = (cx: number) => {
    const L = between(24, 30), T = between(7, 9);
    const rect = (w: number, h: number): Pt[] => [[-w, -h], [w, -h], [w, h], [-w, h]];
    return place([rect(L, T / 2), rect(T / 2, L)], cx + between(-6, 6), H / 2 + between(-5, 5), between(-0.4, 0.4));
  };
  fill(ink, [...digit(a, 72), ...plus(178), ...digit(b, 284)]);

  /* نویز: چند منحنیِ نازکِ هم‌رنگِ جوهر، و یک منحنیِ «پاک‌کن» که جوهر را برمی‌دارد. */
  for (let k = 0; k < 3; k++) stroke(ink, between(1.2, 2.2), 1);
  stroke(ink, between(2, 3), -1);
  for (let k = 0; k < 90; k++) dot(ink, between(0, W), between(0, H), between(1, 2.2), between(0.25, 0.6));

  const px = new Uint8Array(W * H);
  const shade = between(35, 70);
  for (let i = 0; i < px.length; i++) {
    const y = Math.floor(i / W);
    const bg = 246 - (y / H) * 10 + between(-7, 7);
    const t = Math.max(0, Math.min(1, ink[i]));
    px[i] = Math.round(bg * (1 - t) + shade * t);
  }
  return png(px, W, H);
}

/** پرکردنِ چندضلعی‌ها با قاعدهٔ nonzero و ۴ نمونه در هر ردیف (لبهٔ نرم). */
function fill(ink: Float32Array, polys: Pt[][]) {
  const SS = 4;
  const edges: [number, number, number, number][] = [];
  for (const p of polys) for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
    if (y0 !== y1) edges.push([x0, y0, x1, y1]);
  }
  const xs: { x: number; d: number }[] = [];
  for (let sy = 0; sy < H * SS; sy++) {
    const y = (sy + 0.5) / SS;
    xs.length = 0;
    for (const [x0, y0, x1, y1] of edges) {
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push({ x: x0 + ((y - y0) * (x1 - x0)) / (y1 - y0), d: y1 > y0 ? 1 : -1 });
    }
    xs.sort((p, q) => p.x - q.x);
    let wind = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      wind += xs[i].d;
      if (wind !== 0) span(ink, Math.floor(sy / SS), xs[i].x, xs[i + 1].x, 1 / SS);
    }
  }
}

function span(ink: Float32Array, row: number, xa: number, xb: number, w: number) {
  xa = Math.max(0, xa); xb = Math.min(W, xb);
  if (xb <= xa) return;
  const i0 = Math.floor(xa), i1 = Math.floor(xb);
  if (i0 === i1) { ink[row * W + i0] += (xb - xa) * w; return; }
  ink[row * W + i0] += (i0 + 1 - xa) * w;
  for (let i = i0 + 1; i < i1; i++) ink[row * W + i] += w;
  if (i1 < W) ink[row * W + i1] += (xb - i1) * w;
}

/** نقطهٔ نرم؛ `alpha` منفی جوهر را پاک می‌کند. */
function dot(ink: Float32Array, cx: number, cy: number, r: number, alpha: number) {
  for (let y = Math.max(0, Math.floor(cy - r - 1)); y <= Math.min(H - 1, Math.ceil(cy + r + 1)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(W - 1, Math.ceil(cx + r + 1)); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const t = Math.max(0, Math.min(1, r + 0.5 - d));
      if (!t) continue;
      const i = y * W + x;
      ink[i] = alpha > 0 ? Math.max(ink[i], t * alpha) : Math.min(ink[i], 1 - t);
    }
  }
}

/** منحنیِ سینوسی از چپ تا راست. */
function stroke(ink: Float32Array, width: number, alpha: number) {
  const y0 = between(H * 0.25, H * 0.75), amp = between(8, 26), len = between(30, 80), ph = between(0, Math.PI * 2);
  const tilt = between(-0.25, 0.25);
  for (let x = -4; x <= W + 4; x += 0.75) dot(ink, x, y0 + tilt * (x - W / 2) + amp * Math.sin(x / len + ph), width / 2, alpha);
}

// ── PNGِ خاکستریِ ۸بیتی — بی‌کتابخانه ─────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(gray: Uint8Array, w: number, h: number) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) raw.set(gray.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // عمقِ بیت
  ihdr[9] = 0; // خاکستری
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
