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

  /** بخشِ نقشِ فیلد — «این فیلد مالِ کیست». null = عمومی. */
  const roleOf = useCallback((key) => byKey.get(key)?.role ?? null, [byKey]);
  const roleLabelOf = useCallback((key) => byKey.get(key)?.roleLabel ?? null, [byKey]);

  /**
   * آیا این فیلد نشان داده شود؟
   *
   * ⚠️ وقتی تعریف هست، «در تعریف نیست» یعنی **خاموش** — عکسِ قاعدهٔ قدیمی.
   * قاعدهٔ قدیمی («غایب = روشن») چاره بود نه انتخاب: کاتالوگِ سرور ناقص بود
   * و چند فیلد (حضورِ کارشناس، شرحِ عمل) در هیچ قالبی نبودند؛ خاموش‌خواندنِ
   * غایب‌ها یعنی ناپدیدشدنِ بی‌صدایشان. عوارضش را کاربر گزارش کرد: نوعِ
   * «ویزیت» که در فرم‌ساز ساخته می‌شد فقط `opDate` در تعریف داشت، پس جراح و
   * بیمارستان و ساعتِ عمل همه «غایب = روشن» می‌شدند و **هیچ ردیفی در
   * فرم‌ساز نبود که خاموششان کند**. حالا سرور کاتالوگِ کامل را روی هر فرمِ
   * مراجعه backfill می‌کند (`backfillVisitBuiltins`) و این‌جا می‌شود به
   * تعریف اعتماد کرد.
   *
   * فرمِ **نداشته** (`def === null`) همچنان همه‌چیز را روشن می‌گیرد — نصبی
   * که برای نوعی فرم ندارد باید بتواند مراجعه ثبت کند.
   */
  const isOn = useCallback((key) => {
    if (!def) return true;
    const fl = byKey.get(key);
    return fl ? fl.active !== false : false;
  }, [def, byKey]);

  /** فقط فیلدهای دلخواه — همان‌هایی که `DynForm` رندرشان می‌کند. */
  const customFields = useMemo(
    () => (def?.fields ?? []).filter((f) => !f.builtin && f.active !== false),
    [def],
  );

  /**
   * ترتیبِ فیلدهای هسته‌ای — از تعریف، نه از ترتیبِ کد.
   *
   * ⚠️ **این تکهٔ گم‌شدهٔ فرم‌ساز بود.** برچسب و ستاره و روشن/خاموش از تعریف
   * می‌آمدند ولی *جای* فیلد همان‌جا می‌ماند که در JSX نوشته شده بود. یعنی
   * سوپرادمین در فرم‌ساز تاریخ را می‌برد اولِ فرم، ذخیره می‌کرد، و در فرمِ
   * واقعی تاریخ همچنان ششم بود — بی‌هیچ خطایی. قالبِ `visit.surgery` دقیقاً
   * همین بود: تعریفش تاریخ را اول دارد، فرم بعد از چهار انتخابگر نشانش می‌داد.
   *
   * `codeOrder` نقشِ **پشتوانه** دارد نه تشریفات: فیلدی که در تعریف نیامده
   * (چون هنوز در هیچ قالبی نیست — مثل حضورِ کارشناس) باید سرِ جای منطقیِ خودش
   * بماند، نه اینکه به تهِ فرم پرت شود. سرور فیلدها را با `sort` مرتب می‌دهد،
   * پس ترتیبِ `def.fields` همان چیزی است که در فرم‌ساز چیده شده.
   */
  const orderBuiltins = useCallback((codeOrder) => {
    const rank = new Map();
    let i = 0;
    for (const fl of def?.fields ?? []) {
      // کلیدِ تکراری ممکن است: قالب‌ها گاهی یک کلید را با دو برچسب دارند.
      if (!fl.builtin || rank.has(fl.key) || !codeOrder.includes(fl.key)) continue;
      rank.set(fl.key, i++);
    }
    if (rank.size === 0) return [...codeOrder]; // تعریفی نیست → همان ترتیبِ کد

    /* فیلدِ تعریف‌نشده به **همسایهٔ قبلیِ خودش می‌چسبد**، نه به تهِ فرم.
       تشخیص در هیچ قالبی نیست ولی جایش کنارِ نوعِ عمل است؛ اگر به آخر پرتاب
       می‌شد، تعریف‌نکردنِ یک فیلد سکوت نبود — جابه‌جاییِ ناخواسته بود. */
    let anchor = -1;
    const rows = codeOrder.map((key, ci) => {
      if (rank.has(key)) anchor = rank.get(key);
      return { key, anchor, glued: rank.has(key) ? 0 : 1, ci };
    });
    rows.sort((a, b) => a.anchor - b.anchor || a.glued - b.glued || a.ci - b.ci);
    return rows.map((r) => r.key);
  }, [def]);

  return { def, kinds, labelOf, requiredOf, roleOf, roleLabelOf, isOn, customFields, orderBuiltins };
}

/** ستاره‌ی کنارِ برچسب — یک نشانِ مشترک، تا فرم‌ساز و فرم یک زبان داشته باشند. */
export const star = (on) => (on ? <i className="dyn-star" aria-label="اجباری"> *</i> : null);
