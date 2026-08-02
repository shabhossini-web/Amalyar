import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import PersonFields, { personErrors } from './PersonFields.jsx';
import './definitions.css';
import { Back, Close, Pencil, Plus, Trash } from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';


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
  const [merging, setMerging] = useState(false);
  const [parts, setParts] = useState(null); // کالایی که محتویاتش باز است
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

      <Tabs
        label="بخش‌های تعاریفِ پایه"
        variant="scroll"
        value={merging ? '__merge' : tab}
        onChange={(k) => {
          if (k === '__merge') { setMerging(true); return; }
          setTab(k); setMerging(false);
        }}
        items={[
          { key: '__merge', label: 'یکسان‌سازیِ نام‌ها' },
          ...SECTIONS.map((s) => ({ key: s.key, label: s.label })),
        ]}
      />

      {merging ? <NameMerge onToast={setToast} /> : (
      <>
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
              {/* فقط ست و دستگاه محتویات دارند؛ قلمِ مصرفی جزء ندارد. */}
              {tab === 'items' && row.assetKind && row.assetKind !== 'consumable' && (
                <button type="button" className="df-parts" onClick={() => setParts(row)}>محتویات</button>
              )}
              <button type="button" title="ویرایش" onClick={() => setEditing(row)}><Pencil width="15" height="15" /></button>
              <button type="button" title={row.active ? 'غیرفعال کن' : 'فعال کن'} onClick={() => toggle(row)}>
                <span className={`df-dot${row.active ? ' on' : ''}`} />
              </button>
              <button type="button" className="df-del" title="حذف" onClick={() => remove(row)}><Trash width="15" height="15" /></button>
            </div>
          </article>
        ))}
      </div>

      </>
      )}

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
    <Overlay backdrop="df-overlay" panel="df-sheet" as="section" onClose={onClose} closable={!busy}>
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
    </Overlay>
  );
}
