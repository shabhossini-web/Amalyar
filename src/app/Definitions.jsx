import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import PersonFields, { personErrors } from './PersonFields.jsx';
import './definitions.css';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Back = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5v6" /></svg>);
const Plus = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M12 5v14M5 12h14" /></svg>);
const Pencil = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>);
const Trash = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>);
const XIc = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>);

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
    sub: (r) => [r.roleLabel, r.phone, r.vehicle].filter(Boolean).join(' · '),
    uses: (r) => `${faNum(r.missionCount)} مأموریت`,
    empty: 'هنوز راننده یا پیکی تعریف نشده',
    hint: 'راننده و پیک به سامانه وارد نمی‌شوند، پس حسابِ کاربری ندارند و این‌جا تعریف می‌شوند — نه در «کاربران». همین‌ها در پنلِ چینش، تبِ حمل‌ونقل، انتخاب می‌شوند.',
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
      { key: 'notes', label: 'یادداشت', textarea: true },
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
];

export default function Definitions() {
  const [tab, setTab] = useState('surgeons');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [editing, setEditing] = useState(null); // null | {} (جدید) | row (ویرایش)

  const section = useMemo(() => SECTIONS.find((s) => s.key === tab), [tab]);

  useEffect(() => { document.title = 'عمل‌یار — تعاریف پایه'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api(section.path));
    } catch (e) {
      setToast(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [section]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (row) => {
    try {
      await api(`${section.path}/${row.id}`, { method: 'PATCH', body: { active: !row.active } });
      setToast(row.active ? 'غیرفعال شد' : 'فعال شد ✓');
      await load();
    } catch (e) { setToast(e.message); }
  };

  const remove = async (row) => {
    try {
      const r = await api(`${section.path}/${row.id}`, { method: 'DELETE' });
      setToast(r.deactivated ? 'به‌دلیلِ سابقهٔ استفاده، غیرفعال شد' : 'حذف شد');
      await load();
    } catch (e) { setToast(e.message); }
  };

  return (
    <div className="df">
      <div className="df-bg" aria-hidden="true" />
      <header className="df-head">
        <Link to="/app" className="df-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1>تعاریف پایه</h1>
          <p>هر موجودیت یک‌بار این‌جا تعریف می‌شود و همه‌جای سامانه از همین تعریف استفاده می‌کند.</p>
        </div>
      </header>

      <nav className="df-tabs" role="tablist">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={tab === s.key}
            className={tab === s.key ? 'on' : ''}
            onClick={() => setTab(s.key)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {section.hint && <p className="df-note">{section.hint}</p>}

      <div className="df-toolbar">
        <button type="button" className="df-add" onClick={() => setEditing({})}>
          <Plus width="16" height="16" /> افزودن
        </button>
        <span className="df-count">{loading ? '…' : `${faNum(rows.length)} مورد`}</span>
      </div>

      <div className="df-list">
        {loading && <div className="df-empty">در حال بارگذاری…</div>}
        {!loading && rows.length === 0 && <div className="df-empty">{section.empty}</div>}
        {!loading && rows.map((row) => (
          <article key={row.id} className={`df-row${row.active ? '' : ' off'}`}>
            <div className="df-row-main">
              <b>{section.title(row)}{!row.active && <i> (غیرفعال)</i>}</b>
              {section.sub(row) && <small dir="auto">{section.sub(row)}</small>}
            </div>
            <span className="df-uses">{section.uses ? section.uses(row) : `${faNum(row.visitCount)} مراجعه`}</span>
            <div className="df-acts">
              <button type="button" title="ویرایش" onClick={() => setEditing(row)}><Pencil width="15" height="15" /></button>
              <button type="button" title={row.active ? 'غیرفعال کن' : 'فعال کن'} onClick={() => toggle(row)}>
                <span className={`df-dot${row.active ? ' on' : ''}`} />
              </button>
              <button type="button" className="df-del" title="حذف" onClick={() => remove(row)}><Trash width="15" height="15" /></button>
            </div>
          </article>
        ))}
      </div>

      {editing && (
        <EditSheet
          section={section}
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => { setEditing(null); setToast(msg); await load(); }}
          onError={setToast}
        />
      )}

      {toast && <div className="df-toast" role="status">{toast}</div>}
    </div>
  );
}

/** فرمِ افزودن/ویرایش — برای بخشِ «شخص‌دار» از کامپوننتِ مشترک استفاده می‌کند. */
function EditSheet({ section, row, onClose, onSaved, onError }) {
  const isNew = !row.id;
  const [form, setForm] = useState(() => ({ ...row }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

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
    const body = {};
    for (const k of keys) if (form[k] !== undefined) body[k] = form[k] ?? '';

    setBusy(true);
    try {
      if (isNew) await api(section.path, { method: 'POST', body });
      else await api(`${section.path}/${row.id}`, { method: 'PATCH', body });
      await onSaved(isNew ? 'اضافه شد ✓' : 'ذخیره شد ✓');
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="df-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <section className="df-sheet">
        <header className="df-sheet-head">
          <b>{isNew ? `افزودن به ${section.label}` : 'ویرایش'}</b>
          <button type="button" className="df-x" onClick={onClose} aria-label="بستن"><XIc width="18" height="18" /></button>
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
              {(section.fields ?? []).map((f) => (
                <label key={f.key} className={`pf-field${errors[f.key] ? ' bad' : ''}`}>
                  <span>{f.label}</span>
                  {f.options ? (
                    <select value={form[f.key] ?? ''} onChange={setField(f.key)} disabled={busy}>
                      <option value="">— انتخاب کنید —</option>
                      {f.options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                    </select>
                  ) : f.textarea
                    ? <textarea rows={2} value={form[f.key] ?? ''} onChange={setField(f.key)} disabled={busy} />
                    : <input type="text" dir={f.dir || 'rtl'} value={form[f.key] ?? ''} onChange={setField(f.key)} disabled={busy} />}
                  {errors[f.key] && <em className="pf-err">{errors[f.key]}</em>}
                </label>
              ))}
            </div>
          )}
        </div>

        <footer className="df-sheet-foot">
          <button type="button" className="df-ghost" onClick={onClose} disabled={busy}>انصراف</button>
          <button type="button" className="df-save" onClick={submit} disabled={busy}>{busy ? '…' : 'ذخیره'}</button>
        </footer>
      </section>
    </div>
  );
}
