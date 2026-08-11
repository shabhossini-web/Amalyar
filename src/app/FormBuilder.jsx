import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useConfig } from './config.jsx';
import './definitions.css';
import './formbuilder.css';
import { ArrowDown, ArrowUp, Back, Close, Eye, EyeOff, Pencil, Plus, Trash } from '../ui/icons.jsx';
import { COLOR_KEYS, FORM_COLORS } from '../lib/formColor.js';
import { toEnDigits } from '../lib/identity.js';
import { toFa } from '../lib/utils.js';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import { useStagger } from '../ui/stagger.js';

/**
 * فرم‌ساز — سوپرادمین تعیین می‌کند چه چیزی پرسیده شود و چه چیزی اجباری باشد.
 *
 * ⚠️ **ستاره این‌جا تزئین نیست.** همان `required`ی که این‌جا روشن می‌شود، هم
 * ستاره‌ی قرمزِ کنارِ برچسب را می‌سازد و هم ۴۰۰ِ سرور را. تا دیروز این دو در دو
 * جای مستقل نوشته می‌شدند (`personErrors` در کلاینت و دکوراتورهای DTO در سرور)
 * و نتیجه‌اش فرم‌هایی بود که ستاره داشتند ولی سرور قبولشان می‌کرد، یا برعکس.
 *
 * ⚠️ **فیلدِ هسته‌ای و دلخواه عمداً در یک فهرست‌اند و شبیهِ هم دیده می‌شوند.**
 * وسوسه این بود که هسته‌ای‌ها بالا و قفل‌شده جدا شوند، ولی آن‌وقت کاربر فکر
 * می‌کرد ستاره‌ی آن‌ها هم قفل است — و کلِ خواسته همین بود که نباشد. تفاوتشان
 * فقط با یک نشانِ کوچک و **نبودِ** سطلِ زباله گفته می‌شود.
 */

const TYPES = [
  { v: 'text', l: 'متنِ کوتاه' },
  { v: 'textarea', l: 'متنِ بلند' },
  { v: 'number', l: 'عدد' },
  { v: 'money', l: 'مبلغ' },
  { v: 'select', l: 'انتخاب از فهرست' },
  { v: 'multiselect', l: 'انتخابِ چندتایی' },
  { v: 'date', l: 'تاریخ' },
  { v: 'time', l: 'ساعت' },
  { v: 'bool', l: 'بله/خیر' },
  { v: 'phone', l: 'موبایل' },
  { v: 'rating', l: 'امتیاز (۱ تا ۵)' },
  { v: 'image', l: 'باکسِ عکس' },
  { v: 'payment', l: 'باکسِ پرداخت' },
];
const typeLabel = (v) => TYPES.find((t) => t.v === v)?.l ?? v;

/**
 * ⚠️ `survey` هنوز در نگاشت هست هرچند دیگر ساخته نمی‌شود: نصبی که مهاجرت روی
 * آن اجرا نشده هنوز فرمِ `scope: 'survey'` دارد، و نبودِ کلید یعنی کاربر
 * به‌جای «زیرپرونده» رشته‌ی خامِ انگلیسی می‌دید.
 */
const SCOPE_FA = { visit: 'مراجعه', record: 'زیرپرونده', intake: 'ثبت‌نام', survey: 'زیرپرونده' };

export default function FormBuilder() {
  const stagger = useStagger();
  const { verticalLabel } = useConfig();
  const [forms, setForms] = useState(null);
  const [tab, setTab] = useState('');
  const [editing, setEditing] = useState(null); // {formId, field} — field={} یعنی جدید
  const [resetting, setResetting] = useState(false);
  const [newForm, setNewForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => { document.title = 'عمل‌یار — فرم‌ساز'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setErr('');
    try {
      const d = await api('/forms');
      setForms(d);
      /* ⚠️ تبِ فعال فقط وقتی ست می‌شود که هنوز چیزی انتخاب نشده یا تبِ فعلی
         دیگر وجود ندارد (مثلاً بعد از «بازگرداندن به قالب»). اگر هر بار ست
         می‌شد، بعد از هر ذخیره کاربر به تبِ اول پرت می‌شد. */
      setTab((cur) => (cur && d.some((f) => f.key === cur) ? cur : d[0]?.key ?? ''));
    } catch (e) { setErr(e.message); setForms([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const form = useMemo(() => forms?.find((f) => f.key === tab) ?? null, [forms, tab]);

  /** هر نوشتن پاسخِ همان فرم را برمی‌گرداند — همان الگوی `addNeed` در تعاریف. */
  const apply = async (fn, msg) => {
    if (busy) return;
    setBusy(true);
    try {
      const fresh = await fn();
      setForms((list) => list.map((f) => (f.id === fresh.id ? fresh : f)));
      if (msg) setToast(msg);
    } catch (e) {
      setToast(e.message);
      /* ⚠️ در شکست، فهرست از سرور تازه می‌شود. بدونِ این، جابه‌جاییِ خوش‌بینانه‌ی
         `move()` روی صفحه می‌ماند در حالی که سرور ترتیبِ قبلی را دارد — و کاربر
         ترتیبی می‌بیند که وجود ندارد. */
      load();
    } finally { setBusy(false); }
  };

  const toggleRequired = (field) =>
    apply(
      () => api(`/forms/fields/${field.id}`, { method: 'PATCH', body: { required: !field.required } }),
      !field.required ? `«${field.label}» اجباری شد` : `«${field.label}» اختیاری شد`,
    );

  const toggleActive = (field) =>
    apply(
      () => api(`/forms/fields/${field.id}`, { method: 'PATCH', body: { active: !field.active } }),
      !field.active ? 'روشن شد' : 'خاموش شد',
    );

  const removeField = (field) =>
    apply(() => api(`/forms/fields/${field.id}`, { method: 'DELETE' }), 'حذف شد');

  /** رنگِ کارتِ فرم. رشته‌ی خالی یعنی «برگرد به خودکار». */
  const setColor = (color) =>
    apply(
      () => api(`/forms/${form.id}`, { method: 'PATCH', body: { color } }),
      color ? 'رنگ عوض شد' : 'رنگ خودکار شد',
    );

  /** جابه‌جایی — کلِ ترتیب یک‌جا می‌رود تا دو کلیکِ سریع ترتیب را قاطی نکنند. */
  const move = (field, dir) => {
    const list = [...form.fields];
    const i = list.findIndex((f) => f.id === field.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;

    /* ⚠️ عبور از مرزِ صفحه یعنی **تغییرِ صفحه**، نه جابه‌جاییِ ترتیب. اگر مثلِ
       حالتِ عادی فقط فهرستِ idها را می‌فرستادیم، سرور اول با `page` مرتب
       می‌کند و فیلد دقیقاً سرِ جای اولش برمی‌گشت — کاربر دکمه را می‌زد و هیچ
       اتفاقی نمی‌افتاد، بدونِ هیچ خطایی. */
    const here = field.page ?? 1;
    const there = list[j].page ?? 1;
    if (there !== here) {
      /* بالا رفتن → **تهِ** صفحهٔ قبلی (بعد از `list[j]`)، پایین رفتن → **سرِ**
         صفحهٔ بعدی (قبل از `list[j]`). پس علامت وارونهٔ جهت است. */
      apply(
        () => api(`/forms/fields/${field.id}`, {
          method: 'PATCH',
          body: { page: there, sort: (list[j].sort ?? 0) - dir * 5 },
        }),
        `به صفحهٔ ${toFa(there)} رفت`,
      );
      return;
    }

    [list[i], list[j]] = [list[j], list[i]];
    setForms((fs) => fs.map((f) => (f.id === form.id ? { ...f, fields: list } : f)));
    apply(() => api(`/forms/${form.id}/reorder`, { method: 'POST', body: { ids: list.map((f) => f.id) } }));
  };

  const doReset = async () => {
    setBusy(true);
    try {
      setForms(await api('/forms/reset', { method: 'POST', body: {} }));
      setResetting(false);
      setToast('فرم‌ها به قالبِ حوزه برگشتند');
    } catch (e) { setToast(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="lx df fb">
      <div className="lx-bg" aria-hidden="true" />
      <div className="lx-grid" aria-hidden="true" />

      <div className="lx-shell">
        <header className="df-head">
          <Link to="/app" className="lx-back" aria-label="بازگشت به لانچر"><Back width="15" height="15" /> لانچر</Link>
          <h1>فرم‌ساز</h1>
        </header>

        <p className="fb-lead">
          هر فرم را می‌توانید کامل بچینید: فیلدِ تازه اضافه کنید، ترتیب را عوض کنید،
          و <b>ستاره‌ی هر فیلد</b> را روشن یا خاموش کنید. ستاره فقط ظاهر نیست —
          فیلدِ ستاره‌دار روی سرور هم اجباری می‌شود.
        </p>

        {err && <div className="df-err">{err}</div>}
        {forms === null && <p className="df-empty">در حال بارگذاری…</p>}
        {forms?.length === 0 && !err && <p className="df-empty">هنوز فرمی تعریف نشده.</p>}

        {forms?.length > 0 && (
          <>
            <div className="fb-tabrow">
              <Tabs
                variant="scroll"
                label="فرم‌ها"
                value={tab}
                onChange={setTab}
                items={forms.map((f) => ({ key: f.key, label: f.title }))}
              />
              {/* ⚠️ ساختنِ فرم = ساختنِ یک **نوعِ تازه‌ی مراجعه**. مطبی که
                  مسیرش «ویزیت → درمان → پیگیری» است، «درمان» را خودش
                  می‌سازد؛ ما ترتیب را تحمیل نمی‌کنیم. */}
              <button type="button" className="fb-newform" onClick={() => setNewForm(true)} title="فرمِ تازه">
                <Plus width="15" height="15" />
              </button>
            </div>

            {form && (
              <>
                <div className="fb-meta">
                  <span className="fb-chip">{SCOPE_FA[form.scope] ?? form.scope}</span>
                  {form.visitKind && <span className="fb-chip ghost">{form.visitKind}</span>}
                  {/* ارقامِ فارسی — تا کنارِ «۲ صفحه» یک زبان داشته باشند. */}
                  <span className="fb-count">{toFa(form.fields.length)} فیلد</span>
                  {form.pages > 1 && <span className="fb-count">{toFa(form.pages)} صفحه</span>}
                  <ColorPick form={form} busy={busy} onPick={setColor} />
                </div>
                {form.hint && <p className="fb-hint">{form.hint}</p>}

                <div className="fb-list">
                  {form.fields.map((f, i) => (
                    <motion.article key={f.id} {...stagger(i)} className={`glass fb-row${f.active ? '' : ' off'}`}>
                      <div className="fb-order">
                        {/* ⚠️ آیکونِ SVG، نه نویسه‌ی «▲»: نویسه‌های هندسی روی
                            اندروید و سافاری با فونت‌های متفاوت رندر می‌شوند و
                            گاهی اصلاً glyph ندارند. نگهبانِ CI همین را می‌گیرد. */}
                        <button type="button" onClick={() => move(f, -1)} disabled={busy || i === 0} aria-label="بالاتر"><ArrowUp width="11" height="11" /></button>
                        <button type="button" onClick={() => move(f, 1)} disabled={busy || i === form.fields.length - 1} aria-label="پایین‌تر"><ArrowDown width="11" height="11" /></button>
                      </div>

                      <div className="fb-main">
                        <b>
                          {f.label}
                          {f.required && <i className="fb-star" title="اجباری">*</i>}
                        </b>
                        <span>
                          {typeLabel(f.type)}
                          {f.builtin ? <i className="fb-tag core">هسته‌ای</i> : <i className="fb-tag">دلخواه</i>}
                          {/* نشانِ صفحه فقط وقتی فرم چندصفحه‌ای است — روی فرمِ
                              تک‌صفحه‌ای «صفحهٔ ۱» روی هر ردیف فقط شلوغی است. */}
                          {form.pages > 1 && <i className="fb-page">صفحهٔ {toFa(f.page ?? 1)}</i>}
                          {!f.active && <i className="fb-tag off">خاموش</i>}
                        </span>
                        {f.options?.length > 0 && (
                          <small className="fb-opts">{f.options.map((o) => o.l).join(' · ')}</small>
                        )}
                      </div>

                      <div className="fb-acts">
                        {/* ⚠️ کلیدِ اجباری عمداً جدا از فرمِ ویرایش است و همان‌جا اثر
                            می‌کند: پرتکرارترین کاری که سوپرادمین می‌کند همین است،
                            و بردنش داخلِ شیت یعنی سه کلیک به‌جای یک کلیک. */}
                        <button
                          type="button"
                          className={`fb-req${f.required ? ' on' : ''}`}
                          disabled={busy}
                          onClick={() => toggleRequired(f)}
                          aria-pressed={f.required}
                          title={f.required ? 'اجباری — برای اختیاری‌کردن بزنید' : 'اختیاری — برای اجباری‌کردن بزنید'}
                        >
                          <span aria-hidden="true">*</span> اجباری
                        </button>
                        <button type="button" className="df-act" disabled={busy} onClick={() => setEditing({ formId: form.id, field: f })} aria-label="ویرایش">
                          <Pencil width="15" height="15" />
                        </button>
                        <button type="button" className="df-act" disabled={busy} onClick={() => toggleActive(f)} aria-label={f.active ? 'خاموش‌کردن' : 'روشن‌کردن'}>
                          {f.active ? <Eye width="15" height="15" /> : <EyeOff width="15" height="15" />}
                        </button>
                        {/* فیلدِ هسته‌ای سطلِ زباله ندارد — نبودِ دکمه از خطای بعدِ کلیک بهتر است. */}
                        {!f.builtin && (
                          <button type="button" className="df-act danger" disabled={busy} onClick={() => removeField(f)} aria-label="حذف">
                            <Trash width="15" height="15" />
                          </button>
                        )}
                      </div>
                    </motion.article>
                  ))}
                </div>

                <div className="fb-foot">
                  <button type="button" className="df-add" onClick={() => setEditing({ formId: form.id, field: {} })}>
                    <Plus width="16" height="16" /> فیلدِ تازه
                  </button>
                  <button
                    type="button"
                    className="fb-delform"
                    onClick={async () => {
                      const r = await api(`/forms/${form.id}`, { method: 'DELETE' }).catch((e) => ({ error: e.message }));
                      if (r.error) { setToast(r.error); return; }
                      /* پیام از خودِ پاسخ ساخته می‌شود، نه از حدس: سرور
                         می‌داند حذف شد یا فقط خاموش. */
                      setToast(r.deactivated ? `به‌دلیلِ ${r.used} مراجعهٔ ثبت‌شده فقط خاموش شد` : 'فرم حذف شد');
                      load();
                    }}
                  >
                    حذفِ این فرم
                  </button>
                  <button type="button" className="fb-reset" onClick={() => setResetting(true)}>
                    بازگرداندن به قالبِ {verticalLabel || 'حوزه'}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <AnimatePresence>
        {editing && (
          <FieldSheet
            formId={editing.formId}
            field={editing.field}
            pages={form?.pages ?? 1}
            onClose={() => setEditing(null)}
            onSaved={(fresh, msg) => {
              setForms((list) => list.map((f) => (f.id === fresh.id ? fresh : f)));
              setEditing(null);
              setToast(msg);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {newForm && (
          <NewFormSheet
            onClose={() => setNewForm(false)}
            onCreated={(fresh) => {
              setNewForm(false);
              setForms((list) => [...list, fresh]);
              setTab(fresh.key);
              setToast('فرم ساخته شد ✓');
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {resetting && (
          <Overlay backdrop="df-overlay" panel="df-sheet" as="section" onClose={() => setResetting(false)} closable={!busy}>
            <header className="df-sheet-head">
              <b>بازگرداندن به قالب</b>
              <button type="button" className="df-x" onClick={() => setResetting(false)} aria-label="بستن"><Close width="17" height="17" /></button>
            </header>
            <div className="df-sheet-body">
              {/* ⚠️ متنِ هشدار صریح می‌گوید چه چیزی از دست می‌رود. «آیا مطمئنید؟»
                  به کسی نمی‌گوید چه اتفاقی می‌افتد. */}
              <p className="fb-warn">
                همه‌ی فرم‌ها به قالبِ پیش‌فرضِ <b>{verticalLabel}</b> برمی‌گردند.
                فیلدهایی که خودتان ساخته‌اید <b>پاک می‌شوند</b> و ستاره‌هایی که
                جابه‌جا کرده‌اید به حالتِ اول برمی‌گردند. این کار برگشت ندارد.
              </p>
            </div>
            <footer className="df-sheet-foot">
              <button type="button" className="df-ghost" onClick={() => setResetting(false)} disabled={busy}>انصراف</button>
              <button type="button" className="df-save danger" onClick={doReset} disabled={busy}>
                {busy ? 'در حال بازگرداندن…' : 'بله، برگردان'}
              </button>
            </footer>
          </Overlay>
        )}
      </AnimatePresence>

      <div className={`df-toast${toast ? ' on' : ''}`} role="status">{toast}</div>
    </div>
  );
}

/**
 * انتخابگرِ رنگِ کارت.
 *
 * ⚠️ «خودکار» یعنی «یک رنگِ **آزاد** به من بده»، نه «رنگ نداشته باش». هر فرم
 * هنگامِ ساخت رنگِ واقعی می‌گیرد، پس بعد از زدنِ این دکمه بلافاصله یکی از
 * سوآچ‌ها انتخاب‌شده دیده می‌شود. کاربردش وقتی است که رنگِ دستی را پس بگیری و
 * بگذاری سرور رنگی بدهد که هیچ فرمِ دیگری برنداشته.
 *
 * ⚠️ `colorSet` **حذف شد**: با تثبیتِ رنگ هنگامِ ساخت همیشه `true` می‌شد و
 * هیچ اطلاعاتی حمل نمی‌کرد. انتخاب حالا فقط با مقایسهٔ خودِ رنگ مشخص می‌شود.
 */
function ColorPick({ form, busy, onPick }) {
  return (
    <span className="fb-colors" role="group" aria-label="رنگِ کارت">
      <button
        type="button"
        className="fb-color auto"
        disabled={busy}
        onClick={() => onPick('')}
        title="یک رنگِ آزاد از پالت بگیر"
      >
        خودکار
      </button>
      {COLOR_KEYS.map((k) => (
        <button
          key={k}
          type="button"
          className={`fb-color${form.color === k ? ' on' : ''}`}
          style={{ '--sw': FORM_COLORS[k].solid }}
          disabled={busy}
          onClick={() => onPick(k)}
          aria-pressed={form.color === k}
          aria-label={FORM_COLORS[k].fa}
          title={FORM_COLORS[k].fa}
        />
      ))}
    </span>
  );
}

/** شیتِ ساخت/ویرایشِ یک فیلد. */
function FieldSheet({ formId, field, pages = 1, onClose, onSaved }) {
  const isNew = !field.id;
  const [form, setForm] = useState(() => ({
    key: field.key ?? '',
    label: field.label ?? '',
    type: field.type ?? 'text',
    required: !!field.required,
    hint: field.hint ?? '',
    placeholder: field.placeholder ?? '',
    page: String(field.page ?? 1),
    /* گزینه‌ها به‌شکلِ متنِ چندخطی ویرایش می‌شوند — سریع‌ترین راه برای کاربر.
       سرور هر دو شکل (متن و آرایه) را می‌پذیرد. */
    options: (field.options ?? []).map((o) => (o.v === o.l ? o.l : `${o.v}=${o.l}`)).join('\n'),
  }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const hasOptions = form.type === 'select' || form.type === 'multiselect';
  /* باکسِ پرداخت مقدار نمی‌گیرد، پس نه «اجباری» دارد نه راهنمای داخلِ کادر. */
  const isPayment = form.type === 'payment';
  const isImage = form.type === 'image';

  const save = async () => {
    if (busy) return;
    const e = {};
    if (!form.label.trim() || form.label.trim().length < 2) e.label = 'برچسب را کامل بنویسید';
    if (isNew && !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(form.key.trim())) {
      e.key = 'با حرفِ لاتین شروع شود؛ فقط حرف، رقم و _';
    }
    if (hasOptions && !form.options.trim()) e.options = 'دستِ‌کم یک گزینه بنویسید';
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    try {
      const body = {
        label: form.label.trim(),
        /* ⚠️ `false` صریح فرستاده می‌شود نه حذفِ کلید: اگر فیلدی که قبلاً
           اجباری بود به پرداخت تبدیل شود، نفرستادنِ `required` یعنی ستاره‌ی
           قدیمی روی سرور می‌ماند و اعتبارسنجی سرِ فیلدی گیر می‌کند که هیچ
           کادری ندارد. */
        required: isPayment ? false : form.required,
        hint: form.hint,
        placeholder: form.placeholder,
        page: Number(toEnDigits(form.page)) || 1,
        ...(hasOptions ? { options: form.options } : {}),
        /* نوع فقط برای فیلدِ تازه یا دلخواه فرستاده می‌شود. سرور فرستادنِ همان
           نوعِ فعلی روی فیلدِ هسته‌ای را هم می‌پذیرد، ولی نفرستادنش صریح‌تر است. */
        ...(isNew || !field.builtin ? { type: form.type } : {}),
        ...(isNew ? { key: form.key.trim() } : {}),
      };
      const fresh = isNew
        ? await api(`/forms/${formId}/fields`, { method: 'POST', body })
        : await api(`/forms/fields/${field.id}`, { method: 'PATCH', body });
      onSaved(fresh, isNew ? 'فیلد اضافه شد ✓' : 'ذخیره شد ✓');
    } catch (err) {
      setErrors({ _: err.message });
      setBusy(false);
    }
  };

  const fld = (key, label, node, hint) => (
    <label className={`pf-field${errors[key] ? ' bad' : ''}`}>
      <span>{label}</span>
      {node}
      {errors[key] ? <em className="pf-err">{errors[key]}</em> : hint ? <em className="pf-hint">{hint}</em> : null}
    </label>
  );

  return (
    <Overlay backdrop="df-overlay" panel="df-sheet" as="section" onClose={onClose} closable={!busy}>
      <header className="df-sheet-head">
        <b>{isNew ? 'فیلدِ تازه' : field.builtin ? `ویرایشِ «${field.label}» (هسته‌ای)` : `ویرایشِ «${field.label}»`}</b>
        <button type="button" className="df-x" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>

      <div className="df-sheet-body pf">
        {errors._ && <div className="df-err">{errors._}</div>}

        {fld('label', 'برچسب', <input type="text" value={form.label} onChange={set('label')} disabled={busy} />)}

        {isNew && fld('key', 'کلید', (
          <input type="text" dir="ltr" value={form.key} onChange={set('key')} disabled={busy} placeholder="chiefComplaint" />
        ), 'نامِ ماشینی — بعداً عوض نمی‌شود، چون داده با همین کلید ذخیره می‌شود.')}

        {field.builtin && !isNew && (
          <p className="fb-note">
            این فیلدِ هسته‌ای است: مقدارش به ستونِ خودش در پرونده می‌نشیند، پس
            <b> کلید و نوعش عوض نمی‌شود</b>. برچسب، اجباری‌بودن و ترتیبش کاملاً دستِ شماست.
          </p>
        )}

        {(isNew || !field.builtin) && fld('type', 'نوع', (
          <select value={form.type} onChange={set('type')} disabled={busy}>
            {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        ))}

        {isImage && (
          <p className="fb-note">
            بیمار یک <b>عکس</b> پیوست می‌کند. خودِ فایل کنارِ پروندهٔ بیمار ذخیره
            می‌شود و در فرم فقط نشانی‌اش می‌ماند — پس فرم سنگین نمی‌شود.
          </p>
        )}
        {isPayment && (
          <p className="fb-note">
            شمارهٔ حساب و کارت و شبا <b>این‌جا نوشته نمی‌شوند</b>: هنگامِ ساختِ
            لینک یک حساب انتخاب می‌کنید و همان شماره‌ها روی فرم می‌نشینند. پس
            عوض‌کردنِ حساب، لینک‌های تازه را درست می‌کند بی‌آنکه فرم را دست بزند.
            هر فرم فقط <b>یک</b> باکسِ پرداخت دارد.
          </p>
        )}

        {hasOptions && fld('options', 'گزینه‌ها', (
          <textarea rows={4} dir="auto" value={form.options} onChange={set('options')} disabled={busy} placeholder={'بله\nخیر'} />
        ), 'هر خط یک گزینه. برای کلیدِ جدا: «yes=بله».')}

        {/* ⚠️ شمارهٔ صفحه یک **جایگاه** است نه شناسه: اگر روی فرمِ تک‌صفحه‌ای
            عددِ ۵ بنویسید، سرور فشرده‌اش می‌کند به ۲ — وگرنه بیمار سه بار
            «بعدی» می‌زد بی‌آنکه چیزی ببیند. */}
        {fld('page', 'صفحه', (
          <input
            type="text" inputMode="numeric" dir="ltr"
            value={form.page}
            onChange={(e) => setForm((s) => ({ ...s, page: toEnDigits(e.target.value).replace(/[^0-9]/g, '') }))}
            disabled={busy}
          />
        ), pages > 1
          ? `این فرم ${toFa(pages)} صفحه دارد. عددِ بزرگ‌تر صفحهٔ تازه می‌سازد.`
          : 'صفحهٔ ۲ به بعد، فرمِ بیمار را چندصفحه‌ای می‌کند.')}

        {!isPayment && fld('placeholder', 'متنِ راهنمای داخلِ کادر', <input type="text" value={form.placeholder} onChange={set('placeholder')} disabled={busy} />)}
        {fld('hint', 'راهنمای زیرِ فیلد', <input type="text" value={form.hint} onChange={set('hint')} disabled={busy} />)}

        {/* باکسِ پرداخت مقدار ندارد، پس ستاره‌اش هیچ‌وقت سنجیده نمی‌شود —
            نشان‌دادنِ کلیدی که کار نمی‌کند بدتر از نبودنش است. */}
        {!isPayment && (
          <label className="fb-check">
            <input type="checkbox" checked={form.required} onChange={(e) => setForm((s) => ({ ...s, required: e.target.checked }))} disabled={busy} />
            <span>اجباری — بدونِ پرکردنش فرم ذخیره نمی‌شود</span>
          </label>
        )}
      </div>

      <footer className="df-sheet-foot">
        <button type="button" className="df-ghost" onClick={onClose} disabled={busy}>انصراف</button>
        <button type="button" className="df-save" onClick={save} disabled={busy}>
          {busy ? 'در حال ذخیره…' : isNew ? 'افزودن' : 'ذخیره'}
        </button>
      </footer>
    </Overlay>
  );
}

/**
 * ساختِ فرمِ تازه — یعنی نوعِ تازه‌ی مراجعه.
 *
 * ⚠️ فقط سه چیز می‌پرسد و بقیه را بعداً می‌شود چید: عنوان، کلید، و اینکه
 * کجای برنامه استفاده می‌شود. فرمی که ساختش ده فیلد بخواهد، ساخته نمی‌شود.
 */
function NewFormSheet({ onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', key: '', scope: 'visit', hint: '', color: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  const save = async () => {
    if (busy) return;
    const e = {};
    if (form.title.trim().length < 2) e.title = 'عنوان را کامل بنویسید';
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(form.key.trim())) {
      e.key = 'با حرفِ لاتین شروع شود؛ فقط حرف، رقم و _';
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      onCreated(await api('/forms', { method: 'POST', body: { ...form, key: form.key.trim(), title: form.title.trim() } }));
    } catch (err) { setErrors({ _: err.message }); setBusy(false); }
  };

  const fld = (key, label, node, hint) => (
    <label className={`pf-field${errors[key] ? ' bad' : ''}`}>
      <span>{label}</span>
      {node}
      {errors[key] ? <em className="pf-err">{errors[key]}</em> : hint ? <em className="pf-hint">{hint}</em> : null}
    </label>
  );

  return (
    <Overlay backdrop="df-overlay" panel="df-sheet" as="section" onClose={onClose} closable={!busy}>
      <header className="df-sheet-head">
        <b>فرمِ تازه</b>
        <button type="button" className="df-x" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>
      <div className="df-sheet-body pf">
        {errors._ && <div className="df-err">{errors._}</div>}
        {fld('title', 'عنوان', <input type="text" value={form.title} onChange={set('title')} disabled={busy} placeholder="فرمِ درمان" />)}
        {fld('key', 'کلید', (
          <input type="text" dir="ltr" value={form.key} onChange={set('key')} disabled={busy} placeholder="treatment" />
        ), 'نامِ ماشینی — بعداً عوض نمی‌شود.')}
        {/* ⚠️ همان چیزی که کاربر «kindِ فرم» می‌نامد. مفهومِ تازه‌ای اضافه نشد:
            `scope` از اول همین را می‌گفت، فقط `survey` جای `record` را گرفته
            بود و «زیرپرونده» اسمی نداشت. بعد از ساخت **عوض نمی‌شود** — پس
            این‌جا با توضیح انتخاب می‌شود، نه با یک انتخابگرِ خشک. */}
        {fld('scope', 'این فرم چیست', (
          <select value={form.scope} onChange={set('scope')} disabled={busy}>
            <option value="visit">مراجعه — پرشدنش یک مراجعهٔ تازه می‌سازد</option>
            <option value="record">زیرپرونده — به پروندهٔ بیمار می‌چسبد</option>
            <option value="intake">ثبت‌نام — پروندهٔ تازه باز می‌کند</option>
          </select>
        ), 'بعد از ساخت عوض نمی‌شود؛ تعیین می‌کند پرشدنِ فرم کجا می‌نشیند.')}
        {fld('hint', 'راهنمای بالای فرم', <input type="text" value={form.hint} onChange={set('hint')} disabled={busy} />)}

        {fld('color', 'رنگِ کارت', (
          <span className="fb-colors">
            <button
              type="button" className={`fb-color auto${form.color ? '' : ' on'}`}
              disabled={busy} onClick={() => setForm((s) => ({ ...s, color: '' }))}
              aria-pressed={!form.color}
            >
              خودکار
            </button>
            {COLOR_KEYS.map((k) => (
              <button
                key={k} type="button"
                className={`fb-color${form.color === k ? ' on' : ''}`}
                style={{ '--sw': FORM_COLORS[k].solid }}
                disabled={busy}
                onClick={() => setForm((s) => ({ ...s, color: k }))}
                aria-pressed={form.color === k}
                aria-label={FORM_COLORS[k].fa}
                title={FORM_COLORS[k].fa}
              />
            ))}
          </span>
        ), 'در داشبورد کارتِ این فرم با همین رنگ دیده می‌شود.')}

        {form.scope === 'visit' && (
          <p className="fb-note">
            یک نوعِ تازه‌ی مراجعه ساخته می‌شود با یک فیلدِ <b>تاریخ</b>. بقیه‌ی
            فیلدها را همین‌جا اضافه کنید. <b>ترتیبِ مسیر جایی تعریف نمی‌شود</b> —
            از خودِ مراجعاتی که ثبت می‌کنید خوانده می‌شود.
          </p>
        )}
        {form.scope === 'record' && (
          <p className="fb-note">
            پرشدنِ این فرم <b>مراجعه نمی‌سازد</b>؛ زیرِ پروندهٔ بیمار می‌نشیند —
            مثلِ نظرسنجی، جوابِ آزمایش یا شرحِ حال.
          </p>
        )}
      </div>
      <footer className="df-sheet-foot">
        <button type="button" className="df-ghost" onClick={onClose} disabled={busy}>انصراف</button>
        <button type="button" className="df-save" onClick={save} disabled={busy}>{busy ? 'در حال ساخت…' : 'بساز'}</button>
      </footer>
    </Overlay>
  );
}
