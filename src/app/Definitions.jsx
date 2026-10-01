import HospitalDirectory from './HospitalDirectory.jsx';
import AssistedTextarea from '../ui/AssistedTextarea.jsx';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { toEnDigits } from '../lib/jalali.js';
import PersonFields, { personErrors } from './PersonFields.jsx';
import './definitions.css';
import './users.css'; // کلیدِ دوحالتهٔ `us-switch` — همان کلیدِ بخش‌های «سایت» (قانونِ ۲۱: صریح ایمپورت)
import './def-acts.css';
import { Check, Close, Pencil, Plus, Trash } from '../ui/icons.jsx';
import PageHeader from '../ui/PageHeader.jsx';
import Tabs from '../ui/Tabs.jsx';
import Overlay, { ConfirmDialog } from '../ui/Overlay.jsx';
import { useStagger } from '../ui/stagger.js';
import { useConfig } from './config.jsx';
import { hasService } from '../lib/profile.js';


const faNum = (n) => new Intl.NumberFormat('fa-IR').format(n ?? 0);
const ASSET_FA = { set: 'ست', device: 'دستگاه' }; // «مصرفی» پیش‌فرض است و برچسب نمی‌خواهد

/**
 * ساختارِ هر بخش در یک جا تعریف می‌شود تا افزودنِ بخشِ جدید یک ورودی به این
 * آرایه باشد، نه کپیِ یک صفحهٔ کامل.
 */
const SECTIONS = [
  {
    key: 'surgeons',
    label: 'جراحان',
    path: '/surgeons',
    person: true,
    title: (r) => r.name,
    sub: (r) => [r.specialty, r.phone].filter(Boolean).join(' · '),
    empty: 'هنوز جراحی تعریف نشده',
    extra: [
      { key: 'specialty', label: 'تخصص' },
      { key: 'licenseNo', label: 'شمارهٔ نظام پزشکی', dir: 'ltr' },
    ],
  },
  {
    key: 'transport-staff',
    label: 'راننده و پیک',
    path: '/transport-staff',
    person: true,
    title: (r) => r.name,
    sub: (r) => [r.roleLabel, r.phone, r.vehicle, r.account && `حساب: ${r.account}`].filter(Boolean).join(' · '),
    uses: (r) => `${faNum(r.missionCount)} مأموریت`,
    empty: 'هنوز راننده یا پیکی تعریف نشده',
    hint: 'رانندهٔ بی‌حساب همین‌جا تعریف می‌شود و برنامه‌اش را پیامک می‌گیرد. راننده یا پیکی که خودش وارد سامانه می‌شود را این‌جا نسازید: در «کاربران» نقشِ حسابش را «راننده» یا «پیک» بگذارید تا خودکار در این فهرست بیاید («حساب: …» کنارش) و مسیرش را در «حمل‌ونقل» ببیند. همهٔ این‌ها در تختهٔ حمل‌ونقل انتخاب می‌شوند.',
    extra: [
      { key: 'role', label: 'نقش *', options: [{ v: 'driver', l: 'راننده' }, { v: 'courier', l: 'پیک' }] },
      { key: 'vehicle', label: 'خودرو و پلاک' },
    ],
  },
  {
    key: 'hospitals',
    label: 'بیمارستان‌ها',
    path: '/hospitals',
    title: (r) => r.name,
    sub: (r) => [r.city, r.phone, r.contactName && `رابط: ${r.contactName}`].filter(Boolean).join(' · '),
    empty: 'هنوز بیمارستانی تعریف نشده',
    fields: [
      { key: 'name', label: 'نام مرکز *', required: true },
      { key: 'province', label: 'استان' },
      { key: 'sector', label: 'نوع بیمارستان / تعرفه', options: [{ v: 'private', l: 'خصوصی' }, { v: 'public', l: 'دولتی' }, { v: 'nonprofit', l: 'عمومی غیردولتی' }, { v: 'charity', l: 'خیریه' }, { v: 'military', l: 'نیروهای مسلح' }] },
      { key: 'city', label: 'شهر' },
      { key: 'address', label: 'آدرس' },
      { key: 'phone', label: 'تلفن', dir: 'ltr' },
      { key: 'contactName', label: 'نامِ رابط' },
      { key: 'contactPhone', label: 'تلفنِ رابط', dir: 'ltr' },
      { key: 'notes', label: 'یادداشت', textarea: true },
    ],
  },
  {
    key: 'procedure-types',
    label: 'انواع عمل',
    path: '/procedure-types',
    title: (r) => r.name,
    sub: (r) => r.code || '',
    empty: 'هنوز نوعِ عملی تعریف نشده',
    hint: 'نوعِ عمل موجودیت است نه متنِ آزاد — گزارش‌گیری و تحلیل روی همین تعریف‌ها انجام می‌شود.',
    fields: [
      { key: 'name', label: 'عنوان *', required: true },
      { key: 'code', label: 'کد', dir: 'ltr' },
      /* قالبِ پیامکِ مراقبت — خالی یعنی برای این نوعِ عمل پیامی نمی‌رود.
         دو روز قبل و یک روز بعدِ عمل، خودکار به بیمار پیامک می‌شود. */
      { key: 'preOpCare', label: 'مراقبتِ قبل از عمل (پیامک به بیمار، ۲ روز قبل)', textarea: true },
      { key: 'postOpCare', label: 'مراقبتِ بعد از عمل (پیامک به بیمار، روزِ بعد)', textarea: true },
      /* فرمِ پیگیری در این روزها بعد از عمل خودکار پیامک می‌شود — به‌شرطی که
         فرمی با نقشِ پیگیری (فرم‌ساز) تعریف شده باشد. */
      { key: 'followUpDays', label: 'روزهای فرمِ پیگیری (مثلاً ۰,۷,۳۰ — ۰ = بلافاصله بعد از عمل؛ خالی = نمی‌رود)', dir: 'ltr' },
      { key: 'notes', label: 'یادداشت', textarea: true },
    ],
  },
  /* جراحی/خدمتِ داخلِ مطب — کدِ **داخلیِ** خودِ مطب با مبلغِ مصوب. جدا از
     کتابِ ارزش نسبی (که ملی و مرکزی است)؛ فاکتورِ «با کد» هر دو را می‌پذیرد. */
  {
    key: 'internal-codes',
    label: 'جراحیِ داخلِ مطب',
    path: '/internal-codes',
    title: (r) => r.name,
    sub: (r) => [r.code, `${Number(r.price).toLocaleString('fa-IR')} تومان`].filter(Boolean).join(' · '),
    uses: (r) => (r.usedCount ? `${faNum(r.usedCount)} فاکتور` : ''),
    empty: 'هنوز کدی تعریف نشده — مثلاً تزریق، بخیه، عملِ سرپایی',
    hint: 'هر مطب برای کارهای داخلِ مطبش کد و مبلغِ خودش را تعیین می‌کند. این کدها در فاکتورِ «با کد» کنارِ کدهای کتابِ ارزش نسبی قابلِ انتخاب‌اند.',
    fields: [
      { key: 'code', label: 'کدِ داخلی *', dir: 'ltr', required: true },
      { key: 'name', label: 'نامِ خدمت/عمل *', required: true },
      { key: 'price', label: 'مبلغ (تومان) *', dir: 'ltr', required: true, num: true },
      { key: 'notes', label: 'یادداشت', textarea: true },
    ],
  },
  {
    key: 'note-templates',
    label: 'قالب‌های شرح',
    path: '/note-templates',
    ai: true,
    title: (r) => r.title,
    sub: (r) => [
      /* برچسب از خودِ ردیف (`kindFa`) — نگاشتِ محلی جمع شد. */
      r.kindFa ?? r.kind,
      r.procedureTypeName, r.diagnosisTitle, r.topicName,
    ].filter(Boolean).join(' · '),
    uses: (r) => (r.active === false ? 'غیرفعال' : ''),
    empty: 'هنوز قالبی نیست — مثلاً «شرحِ عملِ بلفاروپلاستی» یا «شرحِ حالِ اولیه»',
    hint: 'قالبِ آماده مثل HIS: هنگامِ نوشتنِ شرح در پرونده، قالب‌های هم‌نوع پیشنهاد می‌شوند. قالبِ بی‌هدف عمومی است؛ قالبِ گره‌خورده به عمل/تشخیص/موضوع فقط برای مراجعهٔ منطبق می‌آید و جلوتر می‌نشیند.',
    fields: [
      /* گزینه‌های کشویی از `/config.statuses.note` — `optionsFrom` همان مسیری
         است که بقیهٔ فیلدها (نوعِ عمل، تشخیص، موضوع) از آن پر می‌شوند. */
      { key: 'kind', label: 'نوعِ شرح *', optionsFrom: 'config:note' },
      { key: 'title', label: 'عنوانِ قالب *', required: true },
      { key: 'procedureTypeId', label: 'نوعِ عمل (اختیاری)', optionsFrom: '/procedure-types' },
      { key: 'diagnosisId', label: 'تشخیص (اختیاری)', optionsFrom: '/diagnoses' },
      { key: 'topicId', label: 'موضوعِ ویزیت (اختیاری)', optionsFrom: '/visit-topics' },
      { key: 'body', label: 'متنِ قالب *', textarea: true, required: true, rows: 8 },
    ],
  },
  {
    key: 'items',
    label: 'کالاها',
    path: '/items',
    title: (r) => r.name,
    sub: (r) => [ASSET_FA[r.assetKind], r.brand, r.size, r.sku, r.price && `${Number(r.price).toLocaleString('fa-IR')} تومان`]
      .filter(Boolean).join(' · '),
    empty: 'هنوز کالایی تعریف نشده',
    hint: 'کاتالوگِ کالاست، نه انبار. «نوع» تعیین می‌کند برمی‌گردد یا نه: ست و دستگاه برمی‌گردند و تقویمِ در دسترس‌بودن می‌گیرند، مصرفی نه.',
    fields: [
      { key: 'name', label: 'نامِ کالا *', required: true },
      { key: 'assetKind', label: 'نوع *', options: [
        { v: 'consumable', l: 'مصرفی — یک‌بار می‌رود' },
        { v: 'set', l: 'ست — برمی‌گردد' },
        { v: 'device', l: 'دستگاه — برمی‌گردد' },
      ] },
      { key: 'turnaroundHours', label: 'ساعتِ آماده‌سازی پس از برگشت', dir: 'ltr' },
      { key: 'brand', label: 'برند' },
      { key: 'size', label: 'اندازه / مشخصه' },
      { key: 'category', label: 'دسته (پیچ، راد، کیج…)' },
      { key: 'sku', label: 'کدِ کالا (SKU)', dir: 'ltr' },
      { key: 'irc', label: 'کد IRC', dir: 'ltr' },
      { key: 'unit', label: 'واحد' },
      { key: 'price', label: 'قیمتِ پایه (تومان)', dir: 'ltr' },
      { key: 'notes', label: 'یادداشت', textarea: true },
    ],
  },
  {
    key: 'delivery-places',
    label: 'محل‌های تحویل',
    path: '/delivery-places',
    listPath: '/delivery-places?all=1', // غیرفعال‌ها هم این‌جا دیده شوند
    title: (r) => r.name,
    sub: (r) => (r.aliases?.length ? `همچنین: ${r.aliases.join('، ')}` : ''),
    uses: () => '',
    empty: 'هنوز محلی تعریف نشده',
    hint: 'جایی که بار تحویل داده یا گذاشته می‌شود: CSR، اتاقِ عمل، داروخانه… کارشناس و راننده همچنان می‌توانند هر چیزی تایپ کنند؛ این فهرست فقط باعث می‌شود «CSR» و «سی اس آر» یک چیز شمرده شوند تا گزارشِ تأخیر و تحویل معنا داشته باشد.',
    fields: [
      { key: 'name', label: 'نامِ محل *', required: true },
      { key: 'aliases', label: 'املاهای دیگر (با ، جدا کنید)', list: true },
    ],
  },
  {
    key: 'diagnoses',
    label: 'تشخیص‌ها',
    path: '/diagnoses',
    title: (r) => r.title,
    sub: (r) => r.icdCode || '',
    empty: 'هنوز تشخیصی تعریف نشده',
    hint: 'کدِ ICD اختیاری است ولی برای گزارش‌های استاندارد و تحلیل توصیه می‌شود.',
    fields: [
      { key: 'title', label: 'عنوان *', required: true },
      { key: 'icdCode', label: 'کد ICD-10', dir: 'ltr' },
    ],
  },
  /* موضوعِ ویزیت — «ویزیتِ اولیه»، «پست‌آپ»، «زیبایی». مرحلهٔ ۱ از
     `docs/BOOKING.md`. عمداً از «نوعِ مراجعه» جداست: نوع تعیین می‌کند کدام
     فرم باز شود، موضوع دسته‌بندیِ داخلِ همان فرم است و در مرحلهٔ بعد روزِ
     کاری به آن گره می‌خورد («شنبه‌ها ویزیتِ اولیه»). */
  {
    key: 'visit-topics',
    label: 'موضوعِ ویزیت',
    path: '/visit-topics',
    title: (r) => r.name,
    /* شمارِ مراجعه در ستونِ کناری هست (`df-uses`)؛ زیرِ عنوان فقط «فرم‌های خودکار» (بستهٔ ۹الف). */
    sub: (r) => (r.defaultSubformTitles?.length ? `خودکار: ${r.defaultSubformTitles.join('، ')}` : ''),
    empty: 'هنوز موضوعی تعریف نشده — مثلِ «ویزیتِ اولیه»، «پست‌آپ»، «زیبایی»',
    hint: 'موضوع همان چیزی است که روزِ کاری به آن گره می‌خورد؛ بیمار در هر روز فقط موضوعِ همان روز را می‌بیند.',
    fields: [
      { key: 'name', label: 'عنوان *', required: true },
      { key: 'notes', label: 'توضیح' },
      /* بستهٔ ۹: زیرفرم‌هایی که با انتخابِ همین موضوع در ویزیتِ تازه خودشان الصاق می‌شوند. */
      { key: 'defaultSubforms', label: 'فرم‌هایی که با این موضوع خودکار الصاق می‌شوند', subforms: true,
        hint: 'در ویزیتِ تازه با انتخابِ همین موضوع، این فرم‌ها خودشان باز می‌شوند؛ اگر لازم نبود با × برداشته می‌شوند.' },
    ],
  },
];

/**
 * بخشی که فقط با یک ماژول معنا دارد (بازبینیِ UX ۱۴۰۵/۰۷ — surgery-17).
 *
 * «تعاریف پایه»ِ مطب یازده زبانه داشت: «راننده و پیک»، «کالاها» و «محل‌های تحویل» (ابزارِ حمل و
 * انبارِ شرکت) جلو بودند و «تشخیص‌ها» و «موضوعِ ویزیت» ته نوار و بیرون از دید. حالا بخشی که ماژولش
 * در این نصب **خاموش** است دیده نمی‌شود. ملاک `enabled`ِ ردیفِ `/features` است نه `allowed`:
 * `allowed`ِ «حمل‌ونقل» یعنی «این حساب خودش راننده است» و مدیرِ تعریف‌کنندهٔ راننده‌ها را هم کنار
 * می‌گذاشت. ردیفِ غایب (mock، ماژولِ ثبت‌نشده) یعنی روشن — پنهان‌کردن فقط ادب است؛ خودِ endpointها
 * همچنان پشتِ گاردِ «تعاریف»اند و داده‌ای جابه‌جا نمی‌شود.
 */
const SECTION_NEEDS = {
  'transport-staff': (on) => on('transport') || on('dispatch'),
  // کالا هم در انبار به کار می‌آید هم در اقلامِ مراجعهٔ ایمپلنت (پرتالِ جراح، پذیرش).
  items: (on, implant) => on('inventory') || implant,
  // چیپ‌های محلِ تحویل در سه صفحه‌اند: حمل‌ونقل، چینش و پنلِ کارشناسی.
  'delivery-places': (on) => on('inventory') || on('transport') || on('dispatch') || on('tech'),
};
/** مطب: پرکاربردها جلو (بقیه به همان ترتیبِ `SECTIONS` پشتِ این‌ها). */
const CLINIC_ORDER = ['surgeons', 'procedure-types', 'diagnoses', 'visit-topics', 'note-templates', 'internal-codes', 'hospitals'];

/**
 * **فرم‌های خودکارِ یک موضوعِ ویزیت** (بستهٔ ۹) — چیپ‌های روشن/خاموش از همان کاتالوگِ «الصاقِ فرم»
 * (`/forms/subforms`)؛ فقط فرم‌هایی که روی ویزیت الصاق می‌شوند.
 */
function SubformDefaults({ label, hint, value, onChange, disabled }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let on = true;
    /* موضوع مالِ ویزیت است نه عمل: فرمی که جایش «حینِ عمل» است (جزئیاتِ حینِ عمل) این‌جا پیشنهاد نمی‌شود. */
    api('/forms/subforms').then((r) => { if (on) setItems((r?.items ?? []).filter((x) => x.active !== false && x.defaultPhase !== 'intra')); }).catch(() => { if (on) setItems([]); });
    return () => { on = false; };
  }, []);
  const toggle = (k) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <div className="pf-field df-subdefs" role="group" aria-label={label}>
      <span>{label}</span>
      {items === null ? <em className="pf-hint">در حالِ بارگذاری…</em> : !items.length ? (
        <em className="pf-hint">هنوز زیرفرمی ساخته نشده — از «فرم‌ساز ← زیرفرم‌های مراجعه».</em>
      ) : (
        <div className="df-subdefs-chips">
          {items.map((it) => (
            <button key={it.key} type="button" aria-pressed={value.includes(it.key)} disabled={disabled}
                    className={`df-subdef${value.includes(it.key) ? ' on' : ''}`} onClick={() => toggle(it.key)}>
              {value.includes(it.key) ? <Check width="13" height="13" aria-hidden="true" /> : <Plus width="13" height="13" aria-hidden="true" />}
              {it.title}
            </button>
          ))}
        </div>
      )}
      {hint && <em className="pf-hint">{hint}</em>}
    </div>
  );
}

export default function Definitions() {
  const stagger = useStagger();
  const [tab, setTab] = useState(() => { const key = new URLSearchParams(window.location.search).get('section'); return SECTIONS.some((s) => s.key === key) ? key : 'surgeons'; });
  const [merging, setMerging] = useState(false);
  const [parts, setParts] = useState(null); // کالایی که محتویاتش باز است
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [editing, setEditing] = useState(null); // null | {} (جدید) | row (ویرایش)
  /* حذف اول می‌پرسد (بازبینیِ UX ۱۴۰۵/۰۷ — clinic-daily-15): سطلِ هر ردیف با یک لمس و بی‌برگشت پاک
     می‌کرد، درست کنارِ کلیدِ فعال/غیرفعال. */
  const [deleting, setDeleting] = useState(null);
  const [delBusy, setDelBusy] = useState(false);

  const section = useMemo(() => SECTIONS.find((s) => s.key === tab), [tab]);

  /* بخش‌های این نصب (surgery-17) — ماژول‌های خاموش بیرون، پرکاربردهای مطب جلو.
     تا رسیدنِ `/features` حدس از نوعِ نصب است (مطب: ابزارِ شرکت خاموش) تا نوار نپرد. */
  const cfg = useConfig();
  const clinic = cfg.kind === 'clinic';
  const implant = hasService(cfg, 'implant');
  const [mods, setMods] = useState(null); // key → ردیفِ `/features`
  useEffect(() => {
    let alive = true;
    api('/features')
      .then((rows) => { if (alive) setMods(Object.fromEntries((Array.isArray(rows) ? rows : []).map((r) => [r.key, r]))); })
      .catch(() => { if (alive) setMods({}); });
    return () => { alive = false; };
  }, []);
  const modOn = useCallback((k) => (mods ? mods[k]?.enabled !== false : !clinic), [mods, clinic]);
  const sections = useMemo(() => {
    const list = SECTIONS.filter((s) => !SECTION_NEEDS[s.key] || SECTION_NEEDS[s.key](modOn, implant));
    if (!clinic) return list;
    const rank = (k) => { const i = CLINIC_ORDER.indexOf(k); return i < 0 ? CLINIC_ORDER.length : i; };
    return [...list].sort((a, b) => rank(a.key) - rank(b.key));
  }, [modOn, implant, clinic]);
  /* پیوندِ مستقیم به بخشی که این نصب ندارد (‎?section=items در مطب) به بخشِ اول می‌رود —
     فقط پس از رسیدنِ پاسخ، تا حدسِ اولیه پیوندِ درست را نبرد. */
  useEffect(() => {
    if (mods && sections.length && !sections.some((s) => s.key === tab)) setTab(sections[0].key);
  }, [mods, sections, tab]);
  /* زبانهٔ فعال همیشه در دید (surgery-17): با ‎?section=visit-topics زبانه بیرون از نوار می‌ماند و
     هیچ زبانه‌ای روشن دیده نمی‌شد. `nearest` برای عمود تا صفحه نپرد؛ `center` تا از زیرِ محوشدگیِ لبه بیرون بیاید. */
  const tabSig = sections.map((s) => s.key).join('|');
  useEffect(() => {
    const el = document.querySelector('.df-sectabs [role="tab"][aria-selected="true"]');
    el?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [tab, merging, tabSig]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // بعضی بخش‌ها برای فهرستِ مدیریتی مسیرِ متفاوت می‌خواهند (مثلاً محل‌های
      // تحویل که غیرفعال‌ها هم باید دیده شوند تا بشود دوباره فعالشان کرد).
      setRows(await api(section.listPath ?? section.path));
    } catch (e) {
      setToast(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [section]);

  useEffect(() => { load(); }, [load]);

  const [toggling, setToggling] = useState(null); // شناسهٔ ردیفی که کلیدش در راه است
  const toggle = async (row) => {
    setToggling(row.id);
    try {
      await api(`${section.path}/${row.id}`, { method: 'PATCH', body: { active: !row.active } });
      setToast(row.active ? 'غیرفعال شد' : 'فعال شد ✓');
      await load();
    } catch (e) { setToast(e.message); }
    finally { setToggling(null); }
  };

  const remove = async (row) => {
    setDelBusy(true);
    try {
      const r = await api(`${section.path}/${row.id}`, { method: 'DELETE' });
      setToast(r.deactivated ? `«${section.title(row)}» به‌دلیلِ سابقهٔ استفاده فقط غیرفعال شد` : `«${section.title(row)}» حذف شد`);
      await load();
    } catch (e) { setToast(e.message); }
    finally { setDelBusy(false); setDeleting(null); }
  };

  return (
    <div className="df">
      <div className="df-bg" aria-hidden="true" />
      <PageHeader tool="definitions" sub="هر موجودیت یک‌بار این‌جا تعریف می‌شود و همه‌جای سامانه از همین تعریف استفاده می‌کند." />

      <Tabs
        label="بخش‌های تعاریفِ پایه"
        variant="scroll"
        className="df-sectabs"
        value={merging ? '__merge' : tab}
        onChange={(k) => {
          if (k === '__merge') { setMerging(true); return; }
          setTab(k); setMerging(false);
        }}
        /* «یکسان‌سازیِ نام‌ها» ابزارِ نگهداری است نه بخشِ روزمره — آخرِ نوار. */
        items={[
          ...sections.map((s) => ({ key: s.key, label: s.label })),
          { key: '__merge', label: 'یکسان‌سازیِ نام‌ها' },
        ]}
      />

      {merging ? <NameMerge onToast={setToast} /> : (
      <>
      {section.hint && <p className="df-note">{section.hint}</p>}

      {tab === 'hospitals' && <details className="df-directory-disclosure"><summary>دریافت از فهرست مرکزی بیمارستان‌ها</summary><HospitalDirectory onChanged={load} /></details>}
      <div className="df-toolbar">
        <button type="button" className="df-add" onClick={() => setEditing({})}>
          <Plus width="16" height="16" /> افزودن
        </button>
        <span className="df-count">{loading ? '…' : `${faNum(rows.length)} مورد`}</span>
      </div>

      <div className="df-list df-defs">
        {loading && <div className="df-empty">در حال بارگذاری…</div>}
        {!loading && rows.length === 0 && <div className="df-empty">{section.empty}</div>}
        {!loading && rows.map((row, i) => (
          <motion.article key={row.id} {...stagger(i)} className={`df-row${row.active ? '' : ' off'}`}>
            <div className="df-row-main">
              <b>{section.title(row)}{!row.active && <i> (غیرفعال)</i>}</b>
              {section.sub(row) && <small dir="auto">{section.sub(row)}</small>}
            </div>
            <span className="df-uses">{section.uses ? section.uses(row) : `${faNum(row.visitCount)} مراجعه`}</span>
            <div className="df-acts">
              {/* فقط ست و دستگاه محتویات دارند؛ قلمِ مصرفی جزء ندارد. */}
              {tab === 'items' && row.assetKind && row.assetKind !== 'consumable' && (
                <button type="button" className="df-parts" onClick={() => setParts(row)}>محتویات</button>
              )}
              <button type="button" className="df-edit" title="ویرایش" aria-label={`ویرایشِ ${section.title(row)}`} onClick={() => setEditing(row)}><Pencil width="15" height="15" /></button>
              {/* کلیدِ دوحالتهٔ نوشته‌دار به‌جای نقطهٔ سبزِ بی‌متن (surgery-18) — حالت روی خودِ کلید خوانده می‌شود. */}
              <label className="us-switch df-switch" title={row.active ? 'غیرفعال کن' : 'فعال کن'}>
                <input
                  type="checkbox"
                  role="switch"
                  checked={!!row.active}
                  disabled={toggling === row.id}
                  aria-label={`فعال‌بودنِ ${section.title(row)}`}
                  onChange={() => toggle(row)}
                />
                <span className="us-track" aria-hidden="true" />
                <span className="df-switch-t" aria-hidden="true">{row.active ? 'فعال' : 'غیرفعال'}</span>
              </label>
              <button type="button" className="df-del" title="حذف" aria-label={`حذفِ ${section.title(row)}`} onClick={() => setDeleting(row)}><Trash width="15" height="15" /></button>
            </div>
          </motion.article>
        ))}
      </div>

      </>
      )}

      <AnimatePresence>
        {deleting && (
          <ConfirmDialog
            title={`حذفِ «${section.title(deleting)}»؟`}
            text="این کار برگشت ندارد. اگر در مراجعه یا سندی به کار رفته باشد، پاک نمی‌شود و فقط غیرفعال می‌شود."
            busy={delBusy}
            onConfirm={() => remove(deleting)}
            onCancel={() => setDeleting(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {parts && <SetContents item={parts} onClose={() => setParts(null)} onToast={setToast} />}
      </AnimatePresence>

      <AnimatePresence>
        {editing && (
          <EditSheet
            section={section}
            row={editing}
            onClose={() => setEditing(null)}
            onSaved={async (msg) => { setEditing(null); setToast(msg); await load(); }}
            onError={setToast}
          />
        )}
      </AnimatePresence>

      {toast && <div className="df-toast" role="status">{toast}</div>}
    </div>
  );
}

/**
 * محتویاتِ یک ست.
 *
 * ⚠️ بدونِ این فهرست، ست یک واحدِ اتمی است و کسریِ برگشت دیده نمی‌شود: ستی که
 * با ۲۰ قلم رفت و با ۱۹ برگشت، در دفتر همان «۱ ست» است.
 */
function SetContents({ item, onClose, onToast }) {
  const [rows, setRows] = useState([]);
  const [items, setItems] = useState([]);
  const [label, setLabel] = useState('');
  const [partId, setPartId] = useState('');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await api(`/assets/items/${item.id}/contents`)); }
    catch (e) { onToast(e.message); }
  }, [item.id, onToast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api('/items').then((r) => setItems(r.filter((i) => i.id !== item.id))).catch(() => {}); }, [item.id]);

  const add = async () => {
    if (busy || (!label.trim() && !partId)) return;
    setBusy(true);
    try {
      await api(`/assets/items/${item.id}/contents`, {
        method: 'POST',
        body: { label: label.trim() || undefined, partId: partId ? Number(partId) : undefined, quantity: Number(qty) || 1 },
      });
      setLabel(''); setPartId(''); setQty('1');
      await load();
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  const remove = async (id) => {
    setBusy(true);
    try { await api(`/assets/contents/${id}`, { method: 'DELETE' }); await load(); }
    catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  return (
    <Overlay backdrop="df-overlay" panel="df-sheet" as="section" onClose={onClose} closable={!busy}>
      <header className="df-sheet-head">
        <b>محتویاتِ «{item.name}»</b>
        <button type="button" className="df-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
      </header>
      <div className="df-sheet-body">
        <p className="df-note" style={{ marginTop: 0 }}>
          هنگام برگشتِ ست، همین فهرست چک‌لیستِ شمارش می‌شود و فقط <b>کسری</b> ثبت می‌شود.
        </p>
        <div className="df-list">
          {rows.length === 0 && <div className="df-empty">هنوز قلمی تعریف نشده</div>}
          {rows.map((r) => (
            <article key={r.id} className="df-row">
              <div className="df-row-main">
                <b>{r.label}</b>
                <small>{faNum(r.quantity)} عدد{r.partName ? ` · کالای تعریف‌شده` : ''}</small>
              </div>
              <button type="button" className="df-del" disabled={busy} onClick={() => remove(r.id)}>
                <Trash width="15" height="15" />
              </button>
            </article>
          ))}
        </div>

        <div className="pf-row2" style={{ marginTop: 12 }}>
          <label className="pf-field">
            <span>از کالاهای تعریف‌شده</span>
            <select value={partId} onChange={(e) => { setPartId(e.target.value); if (e.target.value) setLabel(''); }} disabled={busy}>
              <option value="">— انتخاب —</option>
              {items.map((i) => <option key={i.id} value={i.id}>{[i.name, i.size].filter(Boolean).join(' ')}</option>)}
            </select>
          </label>
          <label className="pf-field">
            <span>یا عنوانِ دستی</span>
            <input type="text" value={label} disabled={busy || !!partId} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="pf-field">
            <span>تعداد</span>
            <input type="text" inputMode="numeric" dir="ltr" value={qty} onChange={(e) => setQty(e.target.value)} disabled={busy} />
          </label>
        </div>
      </div>
      <footer className="df-sheet-foot">
        <button type="button" className="df-ghost" onClick={onClose} disabled={busy}>بستن</button>
        <button type="button" className="df-save" onClick={add} disabled={busy || (!label.trim() && !partId)}>افزودنِ قلم</button>
      </footer>
    </Overlay>
  );
}


/**
 * یکسان‌سازیِ نامِ بیمارستان.
 *
 * فرمِ مراجعه و ایمپورت نامِ آزاد می‌دهند: «لقمان»، «لقمان حکیم»، «بیمارستان
 * لقمان». تا این‌ها به یک موجودیت نرسند، گزارشِ «درآمد به تفکیکِ بیمارستان»
 * چند ردیفِ نصفه می‌دهد.
 *
 * ⚠️ هیچ ادغامی خودکار نیست — پیشنهاد از سرور می‌آید و تأیید با کاربر است.
 */
function NameMerge({ onToast }) {
  const [rows, setRows] = useState(null);
  const [hospitals, setHospitals] = useState([]);
  const [pick, setPick] = useState({});   // key → hospitalId
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [p, h] = await Promise.all([api('/name-merge/hospitals/pending'), api('/hospitals')]);
      setRows(p);
      setHospitals(h);
    } catch (e) { onToast(e.message); setRows([]); }
  }, [onToast]);
  useEffect(() => { load(); }, [load]);

  const run = async (key, fn, msg) => {
    if (busy) return;
    setBusy(key);
    try { const r = await fn(); onToast(msg(r)); await load(); }
    catch (e) { onToast(e.message); } finally { setBusy(''); }
  };

  const link = (g, hospitalId) => run(
    g.key,
    () => api('/name-merge/hospitals/link', { method: 'POST', body: { name: g.names[0], hospitalId: Number(hospitalId) } }),
    (r) => `${r.hospitalName} — ${faNum(r.visitsLinked)} مراجعه وصل شد ✓`,
  );

  const create = (g) => run(
    g.key,
    () => api('/name-merge/hospitals/create', { method: 'POST', body: { name: g.names[0] } }),
    (r) => `«${r.hospitalName}» ساخته شد — ${faNum(r.visitsLinked)} مراجعه وصل شد ✓`,
  );

  return (
    <>
      <p className="df-note">
        نامِ بیمارستان در فرم‌ها به شکل‌های مختلف نوشته می‌شود. این‌جا هرکدام را به بیمارستانِ
        درست وصل کنید؛ تصمیمِ شما ذخیره می‌شود و دفعهٔ بعد خودکار اعمال می‌شود.
        <b> هیچ ادغامی خودکار انجام نمی‌شود.</b>
      </p>

      <div className="df-list">
        {rows === null && <div className="df-empty">در حال بارگذاری…</div>}
        {rows?.length === 0 && <div className="df-empty">همهٔ نام‌ها به بیمارستانِ تعریف‌شده وصل‌اند ✓</div>}
        {rows?.map((g) => (
          <article key={g.key} className="df-row nm">
            <div className="df-row-main">
              <b>{g.names.join(' · ')}</b>
              <small>
                {faNum(g.count)} مراجعه
                {g.resolvedHospitalId && ' · قبلاً تأیید شده، فقط اعمال نشده'}
              </small>
              {g.suggestions.length > 0 && (
                <div className="nm-sugg">
                  {g.suggestions.map((sg) => (
                    <button
                      key={sg.id}
                      type="button"
                      className={sg.strong ? 'strong' : ''}
                      disabled={!!busy}
                      onClick={() => link(g, sg.id)}
                    >
                      {sg.name} <i>{Math.round(sg.score * 100)}٪</i>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="df-acts nm-acts">
              <select
                value={pick[g.key] ?? g.resolvedHospitalId ?? ''}
                disabled={!!busy}
                onChange={(e) => setPick((s) => ({ ...s, [g.key]: e.target.value }))}
              >
                <option value="">— بیمارستان —</option>
                {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
              <button
                type="button"
                className="df-save"
                disabled={!!busy || !(pick[g.key] ?? g.resolvedHospitalId)}
                onClick={() => link(g, pick[g.key] ?? g.resolvedHospitalId)}
              >
                وصل کن
              </button>
              <button type="button" className="us-btn" disabled={!!busy} onClick={() => create(g)}>
                بیمارستانِ تازه
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

/** فرمِ افزودن/ویرایش — برای بخشِ «شخص‌دار» از کامپوننتِ مشترک استفاده می‌کند. */
function EditSheet({ section, row, onClose, onSaved, onError, quick = false }) {
  /* فهرست‌هایی که از `/config` می‌آیند (نه از یک endpointِ تعریف‌ها) — فعلاً
     فقط نوعِ سندِ بالینی. با پیشوندِ `config:` از `optionsFrom` تفکیک می‌شوند. */
  const cfgStatuses = useConfig().statuses ?? {};
  const isNew = !row.id;
  /* فیلدِ فهرستی (مثلِ املاهای یک محل) در فرم به‌شکلِ متنِ جداشده با «،»
     ویرایش می‌شود و هنگامِ ارسال دوباره آرایه می‌شود — چون آرایه ورودیِ
     قابلِ‌تایپ ندارد و ساختنِ ویرایشگرِ چندتایی برای یک فیلد صرف نمی‌کند. */
  const listKeys = (section.fields ?? []).filter((f) => f.list).map((f) => f.key);
  const [form, setForm] = useState(() => {
    const f = { ...(section.key === 'hospitals' ? { sector: 'private' } : {}), ...row };
    for (const k of listKeys) if (Array.isArray(f[k])) f[k] = f[k].join('، ');
    return f;
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  /* گزینه‌های پویا (optionsFrom) — مثلِ نوعِ عمل/تشخیص برای قالبِ شرح. */
  const [dynOpts, setDynOpts] = useState({});
  /* دستیارِ AI (فقط بخش‌های ai-دار) — پیشنهادِ متنِ قالب از روی شرح‌های موجود. */
  const [aiOn, setAiOn] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    if (!section.ai) return undefined;
    let on = true;
    api('/ai/status').then((r) => { if (on) setAiOn(!!r?.enabled); }).catch(() => {});
    return () => { on = false; };
  }, [section]);

  /**
   * «پیشنهادِ متن با دستیار» — سرور از شرح‌های واقعیِ همین مطب (همان نوع و
   * هدف) قالبِ بازمصرف‌شونده می‌سازد؛ متن فقط در فرم می‌نشیند و ذخیره
   * همچنان دستِ ادمین است. عنوانِ خالی هم از پیشنهاد پر می‌شود.
   */
  const aiTemplate = async () => {
    if (!form.kind) { onError('اول «نوعِ شرح» را انتخاب کنید'); return; }
    setAiBusy(true);
    try {
      const r = await api('/ai/template-draft', {
        method: 'POST',
        body: {
          kind: form.kind,
          procedureTypeId: Number(toEnDigits(String(form.procedureTypeId ?? '0')).replace(/[^0-9]/g, '') || 0) || undefined,
          diagnosisId: Number(toEnDigits(String(form.diagnosisId ?? '0')).replace(/[^0-9]/g, '') || 0) || undefined,
          topicId: Number(toEnDigits(String(form.topicId ?? '0')).replace(/[^0-9]/g, '') || 0) || undefined,
        },
      });
      setForm((f) => ({ ...f, body: r.body, title: String(f.title ?? '').trim() ? f.title : r.title }));
    } catch (e) { onError(e.message); } finally { setAiBusy(false); }
  };

  useEffect(() => {
    const dyn = (section.fields ?? []).filter((f) => f.optionsFrom);
    if (!dyn.length) return undefined;
    let on = true;
    Promise.all(dyn.map((f) => (f.optionsFrom.startsWith('config:')
      /* کاتالوگِ سرور، نه endpointِ تعریف‌ها: شکلش `{key,label}` است نه `{id,name}`. */
      ? Promise.resolve([f.key, (cfgStatuses[f.optionsFrom.slice('config:'.length)] ?? []).map((r) => ({ v: r.key, l: r.label }))])
      : api(f.optionsFrom)
        .then((rows) => [f.key, (rows ?? []).map((r) => ({ v: String(r.id), l: r.name ?? r.title ?? String(r.id) }))])
        .catch(() => [f.key, []]))))
      .then((pairs) => { if (on) setDynOpts(Object.fromEntries(pairs)); });
    return () => { on = false; };
  }, [section, cfgStatuses]);

  const setField = (k) => (ev) => setForm((f) => ({ ...f, [k]: ev.target.value }));

  const submit = async () => {
    if (busy) return;
    if (section.person) {
      const e = personErrors(form);
      // فیلدهای اختصاصیِ بخش (مثلِ «نقش») هم اجباری‌اند اگر گزینه‌دار باشند.
      for (const f of section.extra ?? []) {
        if (f.options && !form[f.key]) e[f.key] = 'این فیلد لازم است';
      }
      setErrors(e);
      if (Object.keys(e).length) return;
    } else {
      const e = {};
      for (const f of section.fields ?? []) {
        const need = f.required || (f.options && f.label.includes('*'));
        if (need && !String(form[f.key] ?? '').trim()) e[f.key] = 'این فیلد لازم است';
      }
      setErrors(e);
      if (Object.keys(e).length) return;
    }

    // فقط فیلدهای همین بخش فرستاده می‌شوند تا چیزی ناخواسته روی سرور ننشیند.
    const keys = section.person
      ? ['firstName', 'lastName', 'phone', 'nationalId', 'email', 'city', 'address', 'iban', 'notes',
         ...(section.extra ?? []).map((f) => f.key)]
      : (section.fields ?? []).map((f) => f.key);
    // فیلدِ عددی (مبلغ) قبل از ارسال نرمال می‌شود — ارقامِ فارسی و جداکننده مجازند.
    const numKeys = (section.fields ?? []).filter((f) => f.num || f.optionsFrom).map((f) => f.key);
    const body = {};
    for (const k of keys) {
      if (form[k] === undefined) continue;
      body[k] = listKeys.includes(k)
        ? String(form[k] ?? '').split(/[،,]/).map((x) => x.trim()).filter(Boolean)
        : numKeys.includes(k)
          ? Number(toEnDigits(String(form[k] ?? '')).replace(/[^0-9]/g, '') || 0)
          : form[k] ?? '';
    }

    setBusy(true);
    try {
      const saved = isNew ? await api(section.path, { method: 'POST', body }) : await api(`${section.path}/${row.id}`, { method: 'PATCH', body });
      await onSaved(isNew ? 'اضافه شد ✓' : 'ذخیره شد ✓', saved);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay backdrop={quick ? "df-overlay df-quick-overlay" : "df-overlay"} panel="df-sheet" as="section" onClose={onClose} closable={!busy}>
      <header className="df-sheet-head">
        <b>{isNew ? `افزودن به ${section.label}` : 'ویرایش'}</b>
        <button type="button" className="df-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
      </header>

      <div className="df-sheet-body">
        {section.person ? (
          <>
            <PersonFields value={form} onChange={setForm} errors={errors} disabled={busy} />
            <div className="pf-row2">
              {(section.extra ?? []).map((f) => (
                <label key={f.key} className={`pf-field${errors[f.key] ? ' bad' : ''}`}>
                  <span>{f.label}</span>
                  {f.options
                    ? (
                      <select value={form[f.key] ?? ''} onChange={setField(f.key)} disabled={busy}>
                        <option value="">— انتخاب کنید —</option>
                        {f.options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                      </select>
                    )
                    : <input type="text" dir={f.dir || 'rtl'} value={form[f.key] ?? ''} onChange={setField(f.key)} disabled={busy} />}
                  {errors[f.key] && <em className="pf-err">{errors[f.key]}</em>}
                </label>
              ))}
            </div>
          </>
        ) : (
          <div className="pf">
            {(section.fields ?? []).map((f) => f.subforms ? (
              <SubformDefaults key={f.key} label={f.label} hint={f.hint} disabled={busy}
                               value={Array.isArray(form[f.key]) ? form[f.key] : []}
                               onChange={(v) => setForm((x) => ({ ...x, [f.key]: v }))} />
            ) : (
              <label key={f.key} className={`pf-field${errors[f.key] ? ' bad' : ''}`}>
                <span>{f.label}</span>
                {f.options || f.optionsFrom ? (
                  <select value={String(form[f.key] ?? '')} onChange={setField(f.key)} disabled={busy}>
                    <option value={f.optionsFrom ? '0' : ''}>{f.optionsFrom ? '— عمومی (همه) —' : '— انتخاب کنید —'}</option>
                    {(f.options ?? dynOpts[f.key] ?? []).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                ) : f.textarea
                  ? <AssistedTextarea rows={f.rows ?? 2} value={form[f.key] ?? ''} onChange={setField(f.key)} disabled={busy} />
                  : <input type="text" dir={f.dir || 'rtl'} value={form[f.key] ?? ''} onChange={setField(f.key)} disabled={busy} />}
                {errors[f.key] && <em className="pf-err">{errors[f.key]}</em>}
              </label>
            ))}
            {section.ai && aiOn && (
              <button type="button" className="df-ai" onClick={aiTemplate} disabled={busy || aiBusy}>
                {aiBusy ? 'دستیار در حالِ ساختنِ قالب…' : 'پیشنهادِ متن با دستیارِ AI (از شرح‌های موجود)'}
              </button>
            )}
          </div>
        )}
      </div>

      <footer className="df-sheet-foot">
        <button type="button" className="df-ghost" onClick={onClose} disabled={busy}>انصراف</button>
        <button type="button" className="df-save" onClick={submit} disabled={busy}>{busy ? '…' : 'ذخیره'}</button>
      </footer>
    </Overlay>
  );
}

/**
 * افزودنِ سریعِ یک تعریف از وسطِ کارِ دیگر (پنلِ تأیید، فرمِ مراجعه).
 *
 * `initial` پیش‌پرِ ردیفِ **تازه** است — مثلاً همان نامِ عملی که بیمار نوشته و در فهرست نبود
 * (مالک، ۱۴۰۵/۰۷/۰۵). شناسه ندارد، پس همیشه «افزودن» است نه «ویرایش».
 */
export function QuickDefinitionEditor({ sectionKey, initial, onClose, onSaved }) {
  const [error, setError] = useState('');
  const section = sectionKey === 'techs'
    ? { key: 'techs', path: '/accounts/technicians', label: 'کارشناسان', person: true, extra: [] }
    : SECTIONS.find((s) => s.key === sectionKey);
  if (!section) return null;
  const seed = { ...(initial ?? {}) };
  delete seed.id;
  return createPortal(<div>
    <EditSheet quick section={section} row={seed} onClose={onClose} onSaved={onSaved} onError={setError} />
    {error && <div className="df-quick-error" role="alert" onClick={() => setError('')}>{error}</div>}
  </div>, document.body);
}
