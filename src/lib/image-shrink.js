/**
 * **کوچک‌کردنِ عکس پیش از آپلود** — ضلعِ بلند تا ۱۶۰۰ پیکسل، JPEGِ ۰٫۸ (بازبینیِ UX، بندِ ۹۹).
 *
 * هشدار — چرا: عکسِ دوربینِ گوشی ۴ تا ۱۲ مگابایت است و بیمار با اینترنتِ کند می‌فرستدش؛ کارتِ ملی یا
 * دستورِ پزشک با ۱۶۰۰ پیکسل کاملاً خواناست و زیرِ ۵۰۰ کیلوبایت می‌ماند. تا دیروز کادرِ عکسِ فرمِ
 * بیمار فایل را خام می‌فرستاد و عکسِ بزرگ‌تر از ۸ مگابایت، پس از دقیقه‌ها انتظار، خطای انگلیسیِ
 * «File too large» می‌گرفت — روی کادری که اجباری بود.
 *
 * شکست هرگز خطا نیست: اگر مرورگر عکس را باز نکند (HEIC روی کروم، فایلِ خراب) یا نتیجه بزرگ‌تر شود،
 * **همان فایلِ اصلی** برمی‌گردد و سقفِ حجم/سرور تصمیم می‌گیرد.
 */
const SHRINKABLE = /^image\/(jpeg|jpg|png|webp|bmp)$/i;

function decode(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    /* جهتِ EXIF را مرورگرهای امروزی خودشان اعمال می‌کنند (`image-orientation: from-image`). */
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

export async function shrinkImage(file, { maxSide = 1600, quality = 0.8 } = {}) {
  if (!file || !SHRINKABLE.test(file.type || '')) return file;
  try {
    const img = await decode(file);
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return file;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    /* عکسِ از قبل کوچکِ JPEG دوباره فشرده نمی‌شود — هر بار فشرده‌سازی کیفیت را کم می‌کند. */
    if (scale === 1 && /jpe?g/i.test(file.type) && file.size < 1.5 * 1024 * 1024) return file;
    const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    /* زمینهٔ سفید: JPEG شفافیت ندارد و PNGِ شفاف بی‌این سیاه می‌شد. */
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    const name = `${String(file.name || 'photo').replace(/\.[^.]+$/, '')}.jpg`;
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}
