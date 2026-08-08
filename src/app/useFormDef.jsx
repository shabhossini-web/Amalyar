import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * تعریفِ فرمِ یک نوعِ مراجعه — همان چیزی که سوپرادمین در فرم‌ساز چیده.
 *
 * ⚠️ **بدونِ این هوک، فرم‌ساز تزئینی بود.** سوپرادمین فیلد می‌ساخت و ستاره
 * جابه‌جا می‌کرد و هیچ‌کدام در فرمِ واقعیِ ثبتِ مراجعه دیده نمی‌شد. این‌جا
 * تعریف به فرم می‌رسد.
 *
 * ⚠️ فرمِ نبوده **خطا نیست**. نصبِ نورومانیتورینگ فرمِ «پیگیری» ندارد؛ در آن
 * حالت `def` برابرِ null می‌ماند و توابعِ کمکی به رفتارِ پیش‌فرضِ کد برمی‌گردند
 * (برچسبِ هاردکد، بدونِ ستاره، همه‌چیز روشن). فرم باید کار کند حتی وقتی
 * تعریفی نیست — وگرنه یک نصبِ بدونِ فرم اصلاً نمی‌تواند مراجعه ثبت کند.
 */
export function useFormDef(kind) {
  const [defs, setDefs] = useState({});      // kind → تعریف
  const [kinds, setKinds] = useState(null);  // نوع‌هایی که واقعاً فرم دارند

  useEffect(() => {
    let alive = true;
    api('/forms/visit-kinds')
      .then((d) => { if (alive) setKinds(Array.isArray(d) ? d : []); })
      /* خطا بلعیده می‌شود ولی به `[]` تبدیل نمی‌شود: `null` یعنی «نمی‌دانم» و
         فراخوان به فهرستِ کاملِ هاردکد برمی‌گردد. اگر `[]` می‌گذاشتیم، یک
         قطعیِ لحظه‌ایِ شبکه انتخابگرِ نوع را **خالی** می‌کرد. */
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!kind || defs[kind] !== undefined) return undefined;
    let alive = true;
    api(`/forms/visit.${kind}`)
      .then((d) => { if (alive) setDefs((s) => ({ ...s, [kind]: d })); })
      /* `null` یعنی «این نوع فرم ندارد» — با `undefined` («هنوز نپرسیده‌ایم»)
         فرق دارد، وگرنه هر رندر دوباره درخواست می‌فرستد. */
      .catch(() => { if (alive) setDefs((s) => ({ ...s, [kind]: null })); });
    return () => { alive = false; };
  }, [kind, defs]);

  const def = defs[kind] ?? null;

  const byKey = useMemo(() => {
    const m = new Map();
    for (const f of def?.fields ?? []) m.set(f.key, f);
    return m;
  }, [def]);

  /** برچسبِ سفارشیِ سوپرادمین، وگرنه همان برچسبِ کد. */
  const labelOf = useCallback((key, fallback) => byKey.get(key)?.label ?? fallback, [byKey]);

  /** آیا ستاره بخورد؟ فیلدی که تعریف ندارد، اجباری نیست. */
  const requiredOf = useCallback((key) => !!byKey.get(key)?.required, [byKey]);

  /**
   * آیا این فیلد نشان داده شود؟
   *
   * ⚠️ فیلدی که در تعریف **نیست** روشن حساب می‌شود، نه خاموش. دلیل: فرمِ
   * واقعی چند فیلد دارد که هنوز در قالب‌ها نیامده‌اند (ساعتِ حضورِ کارشناس،
   * شرحِ عمل). اگر نبودن را «خاموش» می‌خواندیم، آن‌ها بی‌صدا از فرم ناپدید
   * می‌شدند و کاربر فکر می‌کرد قابلیت حذف شده.
   */
  const isOn = useCallback((key) => byKey.get(key)?.active !== false, [byKey]);

  /** فقط فیلدهای دلخواه — همان‌هایی که `DynForm` رندرشان می‌کند. */
  const customFields = useMemo(
    () => (def?.fields ?? []).filter((f) => !f.builtin && f.active !== false),
    [def],
  );

  return { def, kinds, labelOf, requiredOf, isOn, customFields };
}

/** ستاره‌ی کنارِ برچسب — یک نشانِ مشترک، تا فرم‌ساز و فرم یک زبان داشته باشند. */
export const star = (on) => (on ? <i className="dyn-star" aria-label="اجباری"> *</i> : null);
