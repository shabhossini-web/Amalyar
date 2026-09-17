/**
 * نوعِ واقعیِ فایل از روی **بایت‌های اولش**، نه از حرفِ کلاینت.
 *
 * `multipart` نوع را در هدرِ خودِ درخواست می‌گوید و آن هدر را فرستنده می‌نویسد؛
 * پس روی یک نشانیِ **عمومی و بی‌احراز** هرچه کلاینت ادعا کند ذخیره می‌شود.
 * مسیرِ دانلود همان `mimeType`ِ ذخیره‌شده را در `Content-Type` می‌گذارد و
 * برای عکس `inline` هم می‌دهد، پس دروغِ کلاینت مستقیم به مرورگرِ کارکنان
 * می‌رسد. این تابع جلوی همان را می‌گیرد: چیزی که امضایش را نشناسیم ذخیره نمی‌شود.
 *
 * ⚠️ SVG عمداً نیست — XML است، امضای دودویی ندارد، و اسکریپت حمل می‌کند.
 */
const SIGNATURES: { mime: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'application/pdf', test: b => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/webp', test: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  /* HEIC/HEIF — دوربینِ آیفون. جعبهٔ `ftyp` در بایتِ ۴ می‌نشیند و برندش نوع را می‌گوید. */
  {
    mime: 'image/heic',
    test: b => b.subarray(4, 8).toString('latin1') === 'ftyp'
      && ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'mif1', 'msf1']
        .includes(b.subarray(8, 12).toString('latin1')),
  },
];

/** نوعِ شناخته‌شده، یا `null` اگر امضا با هیچ‌کدام نخواند. */
export function sniffMime(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 12) return null;
  for (const s of SIGNATURES) {
    try { if (s.test(buffer)) return s.mime; } catch { /* بافرِ کوتاه — همان null */ }
  }
  return null;
}
