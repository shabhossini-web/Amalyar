import { useEffect, useState } from 'react';
import { apiBlobUrl } from '../lib/api.js';
import './doc-thumb.css';

/**
 * بندانگشتیِ مدرک — فایل پشتِ توکن است، پس باید blob گرفته شود؛ `<img src>`
 * مستقیم ۴۰۱ می‌گرفت.
 *
 * یک منبع برای پرونده و شیتِ سفارش (قانون ۲۱: کامپوننتِ مشترک با CSSِ خودش).
 * تا دیروز پرونده نسخهٔ خصوصیِ خودش را داشت و شیتِ سفارش **هیچ** بندانگشتی‌ای
 * نداشت — عکسی که بیمار فرستاده بود از داخلِ فرم دیده نمی‌شد.
 */
export function DocThumb({ id, alt, className = 'dt-thumb' }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    let made = null;
    apiBlobUrl(`/patients/documents/${id}/file`)
      .then((u) => { if (alive) { made = u; setUrl(u); } else URL.revokeObjectURL(u); })
      .catch(() => {});
    // بدونِ revoke، هر بار بازکردنِ صفحه یک blob در حافظه جا می‌گذارد.
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [id]);
  return url ? <img className={className} src={url} alt={alt} /> : <div className={`${className} ${className}-ph`} />;
}

/** «عکس است؟» — سرورِ پرونده `isImage` می‌دهد؛ ردیفِ خامِ سفارش فقط mimeType دارد. */
export const isImageDoc = (doc) => doc?.isImage ?? String(doc?.mimeType ?? '').startsWith('image/');

/**
 * بازکردن/دانلودِ مدرک با توکن. مدرکِ لینکی (پکس، سایتِ آزمایشگاه) فایلی روی
 * دیسک ندارد و همان نشانی در تبِ تازه باز می‌شود.
 */
export async function openDoc(doc, onErr) {
  if (doc?.externalUrl) { window.open(doc.externalUrl, '_blank', 'noopener,noreferrer'); return; }
  try {
    const url = await apiBlobUrl(`/patients/documents/${doc.id}/file`);
    const a = document.createElement('a');
    a.href = url;
    if (!isImageDoc(doc)) a.download = doc.fileName;
    else a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    onErr?.(e.message);
  }
}
