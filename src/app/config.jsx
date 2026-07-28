import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { DEFAULT_VERTICAL, termsFor } from '../lib/terms.js';

const Ctx = createContext(null);

/**
 * پیکربندیِ شرکت — حوزهٔ کاری و واژگانِ برآمده از آن.
 *
 * فقط کلیدِ حوزه از سرور می‌آید؛ خودِ دیکشنریِ واژه‌ها در کلاینت است. دلیل:
 * این‌ها متنِ رابط‌اند، با همان نسخه‌ای که رابط را می‌سازد deploy می‌شوند، و
 * آوردنشان از API فقط یک رفت‌وبرگشت و یک پرشِ متن اضافه می‌کرد.
 *
 * تا وقتی پاسخ نرسیده، واژگانِ پیش‌فرض استفاده می‌شوند — نه رشتهٔ خالی.
 */
export function ConfigProvider({ children }) {
  const [config, setConfig] = useState({ vertical: DEFAULT_VERTICAL, brandName: null, verticals: [] });

  const reload = useCallback(async () => {
    try {
      const fresh = await api('/config');
      setConfig((c) => ({ ...c, ...fresh }));
    } catch {
      /* بدونِ پیکربندی هم رابط باید کار کند — واژگانِ پیش‌فرض می‌مانند */
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const value = useMemo(
    () => ({ ...config, t: termsFor(config.vertical), reload }),
    [config, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** واژگان + پیکربندی. خارج از Provider هم امن است (پیش‌فرض برمی‌گردد). */
export function useConfig() {
  return useContext(Ctx) ?? { vertical: DEFAULT_VERTICAL, brandName: null, verticals: [], t: termsFor(DEFAULT_VERTICAL), reload: () => {} };
}

/** میان‌بر برای جایی که فقط واژه لازم است. */
export const useTerms = () => useConfig().t;
