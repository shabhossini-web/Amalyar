import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * تعریف‌هایی که `VisitForm` برای رندر لازم دارد — شش فهرستِ کشویی.
 *
 * چرا هوک و نه کپیِ دوم: تا امروز فقط `Dashboard` فرمِ مراجعه را باز می‌کرد و
 * این شش fetch داخلِ خودش بود. میزِ پذیرش (W3.3) هم همان فرم را باز می‌کند، و
 * کپی‌کردنِ فهرست یعنی روزی که تعریفِ تازه‌ای اضافه شود (مثلاً «اتاق») یکی از دو
 * صفحه آن را ندارد و کشویی‌اش خالی می‌ماند.
 *
 * ⚠️ **تنبل است و باید بماند.** میزِ پذیرش هر چند ثانیه تخته را تازه می‌کند و
 * خودِ تخته به جراح و تشخیص و نوعِ عمل هیچ نیازی ندارد؛ بار‌کردنِ شش فهرست در
 * هر بارگذاریِ صفحه یعنی شش درخواستِ بی‌مصرف روی هر رفرش. تا وقتی `want` نشود
 * هیچ درخواستی نمی‌رود.
 *
 * `reload` برای `onDefsChanged` است: `DefSelect` داخلِ فرم می‌تواند جراح یا
 * بیمارستانِ تازه بسازد و فهرست باید همان‌جا تازه شود.
 *
 * ⚠️ `scope` (معمولاً `user?.id`) **لازم است، نه تزئینی**: این فهرست‌ها به مجوزِ
 * همان حساب بسته‌اند و بعد از سوییچِ حساب باید دوباره خوانده شوند. نسخهٔ اولِ
 * همین هوک آن را جا انداخت و داشبورد بعد از سوییچ فهرستِ حسابِ قبلی را نگه
 * می‌داشت — همان باگی که کدِ قبلی با `[loadDefs, user?.id]` عمداً بسته بود.
 */
const EMPTY = { surgeons: [], hospitals: [], techs: [], procedures: [], diagnoses: [], topics: [] };

export function useVisitDefs(want, scope) {
  const [defs, setDefs] = useState(EMPTY);
  const [loadedFor, setLoadedFor] = useState(null);
  const loaded = loadedFor !== null && loadedFor === scope;

  const reload = useCallback(async () => {
    try {
      const [surgeons, hospitals, techs, procedures, diagnoses, topics] = await Promise.all([
        api('/surgeons'),
        api('/hospitals'),
        api('/techs'),
        api('/procedure-types'),
        api('/diagnoses'),
        api('/visit-topics'),
      ]);
      setDefs({ surgeons, hospitals, techs, procedures, diagnoses, topics });
      setLoadedFor(scope ?? '-');
    } catch {
      /* دسترسی نداشته باشد، خطای اصلی از خودِ صفحه می‌آید — فرم با فهرستِ
         خالی رندر می‌شود و کاربر «انتخاب نشده» می‌بیند، نه صفحهٔ سفید. */
    }
  }, [scope]);

  useEffect(() => {
    if (!want) return;
    if (loadedFor === (scope ?? '-')) return;
    reload();
  }, [want, scope, loadedFor, reload]);

  return { defs, reload };
}
