import { useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * محل‌های تحویل — **تک‌منبع** برای چیپ‌های سه فرم.
 *
 * ⚠️ تا دیروز همین فهرست در سه فایل (`Tech.jsx`، `Transport.jsx`،
 * `Dispatch.jsx`) به‌شکلِ آرایهٔ ثابت تکرار شده بود. یعنی مشتری‌ای که «بخشِ
 * استریل» دارد نمی‌توانست اضافه کند، و هر جایی که یکی از سه آرایه عقب
 * می‌ماند، کاربر در یک صفحه گزینه‌ای می‌دید که در صفحهٔ دیگر نبود.
 *
 * ⚠️ **بی‌صدا شکست می‌خورد و بی‌صدا هم درست است.** اگر درخواست نگرفت، چیپی
 * نشان داده نمی‌شود ولی تایپِ آزاد سرِ جایش است — فهرست میان‌بُر است، نه
 * پیش‌نیازِ ثبت. صفحه‌ای که به‌خاطر نبودِ یک فهرستِ کمکی کار نکند، بدتر از
 * صفحه‌ای است که بدونِ آن کار کند.
 */
export function usePlaces() {
  const [places, setPlaces] = useState([]);
  useEffect(() => {
    let alive = true;
    api('/delivery-places')
      .then((rows) => { if (alive) setPlaces(rows.map((r) => r.name)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return places;
}
