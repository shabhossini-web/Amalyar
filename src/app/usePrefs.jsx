import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from './auth.jsx';

/**
 * **منتخب‌های شخصی** (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳) — سه «فرمِ منتخب» بالای فرمِ مراجعه و سه
 * «ابزارکِ منتخب» بالای صفحهٔ امروز. منبع `GET/PATCH /auth/prefs` است، نه `localStorage`:
 * پزشک بینِ رایانهٔ مطب و گوشی جابه‌جا می‌شود و منتخب‌هایش باید همراهش بیایند.
 *
 * ⚠️ یک انبارِ مشترک برای همهٔ صفحه‌ها، **به‌ازای حساب**: سوییچِ حساب (`/auth/switch`)
 * صفحه را از نو سوار نمی‌کند، پس بی کلیدِ `uid` منتخب‌های حسابِ قبلی می‌ماندند.
 */
const EMPTY = Object.freeze({ subformPins: [null, null, null], todayPins: [null, null, null], usagePresets: [] });
const store = { uid: null, value: null, inflight: null, subs: new Set() };
const emit = () => store.subs.forEach((fn) => fn(store.value));

function load(uid) {
  if (store.uid !== uid) { store.uid = uid; store.value = null; store.inflight = null; }
  if (store.value || store.inflight) return;
  store.inflight = api('/auth/prefs')
    .then((r) => { if (store.uid === uid) store.value = { ...EMPTY, ...(r ?? {}) }; })
    /* شکست یعنی «بی‌منتخب»، نه صفحهٔ شکسته — اسلات‌ها خالی دیده می‌شوند. */
    .catch(() => { if (store.uid === uid) store.value = { ...EMPTY }; })
    .finally(() => { store.inflight = null; emit(); });
}

export function usePrefs() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [value, setValue] = useState(() => (store.uid === uid ? store.value : null));
  useEffect(() => {
    const fn = (v) => setValue(v);
    store.subs.add(fn);
    if (uid) load(uid);
    setValue(store.uid === uid ? store.value : null);
    return () => { store.subs.delete(fn); };
  }, [uid]);

  /** نوشتنِ خوش‌بینانه: اسلات همان لحظه عوض می‌شود و اگر سرور رد کرد برمی‌گردد. */
  const save = useCallback(async (field, pins) => {
    const prev = store.value ?? { ...EMPTY };
    store.value = { ...prev, [field]: pins };
    emit();
    try {
      const r = await api('/auth/prefs', { method: 'PATCH', body: { [field]: pins } });
      store.value = { ...EMPTY, ...(r ?? {}) };
      emit();
    } catch (e) {
      store.value = prev;
      emit();
      throw e;
    }
  }, []);

  return { prefs: value ?? EMPTY, ready: !!value, save };
}

/**
 * ستاره‌زدن روی یک کلید: اگر منتخب است برداشته می‌شود، وگرنه در **اولین خانهٔ خالی**
 * می‌نشیند. `null` یعنی هر سه خانه پرند — فراخوان باید بگوید «اول یکی را بردارید».
 */
export function togglePin(pins, key) {
  const cur = [...(pins ?? [null, null, null])];
  const at = cur.indexOf(key);
  if (at >= 0) { cur[at] = null; return cur; }
  const free = cur.indexOf(null);
  if (free < 0) return null;
  cur[free] = key;
  return cur;
}
