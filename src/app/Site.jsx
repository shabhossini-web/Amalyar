import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, apiUpload, apiUrl } from '../lib/api.js';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import { useStagger } from '../ui/stagger.js';
import { SITE_ICON_KEYS } from '../pages/TenantLanding.jsx';
import { ArrowDown, ArrowUp, Close, Pencil, Plus, Trash, Upload } from '../ui/icons.jsx';
import PageHeader from '../ui/PageHeader.jsx';
import './definitions.css';
import './launcher.css';
import './users.css';
import './site.css';
import Toast, { useToast } from '../ui/Toast.jsx';
import { useTerms } from './config.jsx';

/**
 * ویرایشگرِ سایتِ عمومیِ شرکت.
 *
 * ⚠️ زبانِ بصری عمداً همان «تعاریفِ پایه» است (`definitions.css`) نه چیزی
 * تازه: این هم یک فهرست + یک شیتِ فرم است، و صفحهٔ نهمی با CSSِ خودش یعنی
 * نهمین تعریفِ «دکمهٔ ذخیره چه شکلی است».
 */

/* شکلِ فرمِ هر نوعِ قلم — افزودنِ نوعِ تازه = یک ورودی این‌جا، نه یک صفحهٔ نو. */
const KINDS = {
  stat: {
    label: 'اعداد',
    empty: 'هنوز عددی اضافه نشده',
    hint: 'سه تا چهار عددِ کوتاه. مثلاً «۱۲ سال» با برچسبِ «سابقهٔ فعالیت».',
    fields: [
      { key: 'title', label: 'عدد *', required: true, placeholder: '۱۲ سال' },
      { key: 'subtitle', label: 'برچسب', placeholder: 'سابقهٔ فعالیت' },
    ],
  },
  service: {
    label: 'خدمات',
    empty: 'هنوز خدمتی اضافه نشده',
    fields: [
      { key: 'title', label: 'نامِ خدمت *', required: true },
      { key: 'body', label: 'توضیح', textarea: true },
      { key: 'icon', label: 'آیکون', icons: true },
    ],
  },
  gallery: {
    label: 'نمونه‌کارها',
    empty: 'هنوز تصویری اضافه نشده',
    hint: 'با دو تصویر، اسلایدرِ «قبل / بعد» ساخته می‌شود؛ با یک تصویر، عکسِ ساده. انتشارِ تصویرِ مراجع رضایتِ کتبی می‌خواهد.',
    images: 2,
    fields: [{ key: 'title', label: 'شرحِ تصویر' }],
  },
  process: {
    label: 'مسیرِ مراجعه',
    empty: 'هنوز گامی اضافه نشده',
    hint: 'شماره‌گذاری خودکار است و از ترتیبِ همین فهرست می‌آید.',
    fields: [
      { key: 'title', label: 'عنوانِ گام *', required: true },
      { key: 'body', label: 'توضیح', textarea: true },
    ],
  },
  doctor: {
    label: 'تیمِ درمان',
    empty: 'هنوز کسی اضافه نشده',
    images: 1,
    fields: [
      { key: 'title', label: 'نام *', required: true },
      { key: 'subtitle', label: 'تخصص' },
      { key: 'body', label: 'معرفیِ کوتاه', textarea: true },
    ],
  },
  testimonial: {
    label: 'نظرِ مراجعان',
    empty: 'هنوز نظری اضافه نشده',
    hint: 'فقط نظرِ واقعی و با اجازهٔ خودِ فرد. نامِ کامل لازم نیست.',
    fields: [
      { key: 'title', label: 'نامِ فرد *', required: true },
      { key: 'subtitle', label: 'توضیحِ کوتاه', placeholder: 'تهران' },
      { key: 'body', label: 'متنِ نظر *', required: true, textarea: true },
    ],
  },
  faq: {
    label: 'پرسش‌ها',
    empty: 'هنوز پرسشی اضافه نشده',
    fields: [
      { key: 'title', label: 'پرسش *', required: true },
      { key: 'body', label: 'پاسخ *', required: true, textarea: true },
    ],
  },
};

const faNum = (n) => new Intl.NumberFormat('fa-IR').format(n ?? 0);

/**
 * آپلودِ تصویر — از `apiUpload`ِ مشترک، نه `fetch`ِ محلی.
 *
 * ⚠️ نسخهٔ اول `fetch`ِ خودش را داشت چون `api()` فقط JSON می‌فرستد؛ بعد
 * `apiUpload` به `lib/api.js` اضافه شد که همان کار را می‌کند **به‌علاوهٔ**
 * رویدادِ ۴۰۱ (خروجِ خودکارِ سشنِ باطل‌شده). دو مسیرِ آپلود یعنی یکی‌شان
 * روزی این رفتار را نداشته باشد.
 */
const uploadImage = (itemId, slot, file) => {
  const fd = new FormData();
  fd.append('file', file);
  return apiUpload(`/site/items/${itemId}/image${slot === 2 ? '2' : ''}`, fd);
};

function ItemSheet({ kind, row, onClose, onSaved, onToast }) {
  const def = KINDS[kind];
  const [form, setForm] = useState(() => ({ ...row }));
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState({});
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const errs = {};
    for (const f of def.fields) {
      if (f.required && !String(form[f.key] ?? '').trim()) errs[f.key] = 'الزامی است';
    }
    setBad(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      const body = {};
      for (const f of def.fields) body[f.key] = String(form[f.key] ?? '').trim();
      const saved = row.id
        ? await api(`/site/items/${row.id}`, { method: 'PATCH', body })
        : await api('/site/items', { method: 'POST', body: { ...body, kind } });

      /* ⚠️ تصویر **بعد از** ساختِ رکورد آپلود می‌شود: مسیرِ آپلود شناسهٔ قلم
         می‌خواهد، پس برای قلمِ تازه هنوز وجود ندارد. */
      for (const slot of [1, 2]) {
        const file = form[`_file${slot}`];
        if (file) await uploadImage(saved.id, slot, file);
      }
      onSaved();
      onToast(row.id ? 'ذخیره شد' : 'اضافه شد');
      onClose();
    } catch (e) {
      onToast(e?.message || 'ذخیره نشد');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClose={onClose} className="df-overlay">
      <motion.div
        className="df-sheet"
        initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="df-sheet-head">
          <b>{row.id ? 'ویرایش' : 'افزودن'} — {def.label}</b>
          <button type="button" className="df-x" onClick={onClose} aria-label="بستن"><Close width="16" height="16" /></button>
        </div>
        <div className="df-sheet-body">
          <div className="pf">
            {def.fields.map((f) => (
              f.icons ? (
                <div key={f.key} className="pf-field">
                  <span>{f.label}</span>
                  <div className="st-icons">
                    {SITE_ICON_KEYS.map((k) => (
                      <button
                        key={k} type="button"
                        className={`st-icon${form.icon === k ? ' on' : ''}`}
                        onClick={() => set('icon', k)}
                        aria-pressed={form.icon === k}
                        aria-label={k}
                      >
                        <SiteIcon name={k} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <label key={f.key} className={`pf-field${bad[f.key] ? ' bad' : ''}`}>
                  <span>{f.label}</span>
                  {f.textarea
                    ? <textarea rows={4} value={form[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
                    : <input value={form[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />}
                  {bad[f.key] && <i className="pf-err">{bad[f.key]}</i>}
                </label>
              )
            ))}

            {Array.from({ length: def.images ?? 0 }, (_, i) => i + 1).map((slot) => (
              <label key={slot} className="pf-field">
                <span>{def.images === 2 ? (slot === 1 ? 'تصویرِ «قبل»' : 'تصویرِ «بعد»') : 'تصویر'}</span>
                <div className="st-file">
                  <Upload width="15" height="15" />
                  <span>{form[`_file${slot}`]?.name || (row[slot === 2 ? 'image2' : 'image'] ? 'تصویری هست — برای تعویض انتخاب کنید' : 'انتخابِ تصویر')}</span>
                  <input
                    type="file" accept="image/png,image/jpeg,image/webp,image/avif"
                    onChange={(e) => set(`_file${slot}`, e.target.files?.[0] ?? null)}
                  />
                </div>
              </label>
            ))}
          </div>
        </div>
        <div className="df-sheet-foot">
          <button type="button" className="df-ghost" onClick={onClose}>انصراف</button>
          <button type="button" className="df-save" disabled={busy} onClick={save}>{busy ? '…' : 'ذخیره'}</button>
        </div>
      </motion.div>
    </Overlay>
  );
}

/* آیکونِ خدمت — از همان نگاشتی که خودِ صفحهٔ عمومی می‌خواند. */
function SiteIcon({ name }) {
  const [Comp, setComp] = useState(null);
  useEffect(() => {
    let alive = true;
    import('../ui/icons.jsx').then((m) => {
      const map = {
        scalpel: m.Scalpel, doctor: m.Doctor, hospital: m.Hospital, diagnosis: m.Diagnosis,
        calendar: m.Calendar, clock: m.Clock, chart: m.Chart, route: m.Route, camera: m.Camera,
        phone: m.Phone, star: m.Star, user: m.User, check: m.Check,
      };
      if (alive) setComp(() => map[name] ?? m.Diagnosis);
    });
    return () => { alive = false; };
  }, [name]);
  return Comp ? <Comp width="18" height="18" /> : <span style={{ width: 18, height: 18 }} />;
}

export default function Site() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('sections');
  const [editing, setEditing] = useState(null); // {kind, row}
  const [draft, setDraft] = useState({});       // متن‌های ویرایش‌نشده‌ی در دست
  const { msg: toast, show: setToast } = useToast(2200);
  const [busy, setBusy] = useState(false);
  const stagger = useStagger();

  /* «دامنهٔ خودِ مطب» / «دامنهٔ خودِ شرکت» — واژهٔ سازمان از حوزه (بازبینیِ UX). */
  const { org } = useTerms();

  const load = useCallback(async () => {
    try {
      const fresh = await api('/site');
      setData(fresh);
      setDraft(fresh.blocks);
    } catch (e) {
      setToast(e?.message || 'بارگذاری نشد');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const setSection = async (key, patch) => {
    setBusy(true);
    try {
      const sections = await api('/site/sections', { method: 'PATCH', body: { sections: [{ key, ...patch }] } });
      setData((d) => ({ ...d, sections }));
    } catch (e) {
      setToast(e?.message || 'ذخیره نشد');
    } finally { setBusy(false); }
  };

  const move = (key, dir) => {
    const list = data.sections;
    const i = list.findIndex((s) => s.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    /* ترتیب با **جابه‌جاییِ دو مقدار** ذخیره می‌شود نه با بازنویسیِ کلِ فهرست:
       دو ردیف عوض شده‌اند و فقط همان دو باید بروند. */
    api('/site/sections', {
      method: 'PATCH',
      body: { sections: [{ key: list[i].key, sort: list[j].sort }, { key: list[j].key, sort: list[i].sort }] },
    }).then((sections) => setData((d) => ({ ...d, sections })))
      .catch((e) => setToast(e?.message || 'ذخیره نشد'));
  };

  const saveBlocks = async () => {
    const values = {};
    for (const def of data.blockDefs) {
      if ((draft[def.key] ?? '') !== (data.blocks[def.key] ?? '')) values[def.key] = draft[def.key] ?? '';
    }
    if (!Object.keys(values).length) { setToast('چیزی عوض نشده'); return; }
    setBusy(true);
    try {
      const res = await api('/site/blocks', { method: 'PATCH', body: { values } });
      setData((d) => ({ ...d, blocks: res.blocks }));
      setDraft(res.blocks);
      setToast(`${faNum(res.changed)} متن ذخیره شد`);
    } catch (e) {
      setToast(e?.message || 'ذخیره نشد');
    } finally { setBusy(false); }
  };

  const publish = async (value) => {
    setBusy(true);
    try {
      await api('/site/publish', { method: 'PATCH', body: { published: value } });
      setData((d) => ({ ...d, published: value }));
      setToast(value ? 'سایت منتشر شد' : 'انتشار متوقف شد');
    } catch (e) {
      setToast(e?.message || 'ذخیره نشد');
    } finally { setBusy(false); }
  };

  const removeItem = async (id) => {
    try {
      await api(`/site/items/${id}`, { method: 'DELETE' });
      await load();
      setToast('حذف شد');
    } catch (e) { setToast(e?.message || 'حذف نشد'); }
  };

  const kindsWithSection = useMemo(
    () => (data ? data.sections.filter((s) => s.kind) : []),
    [data],
  );

  if (!data) {
    return (
      <div className="df df-form">
        <div className="df-bg" aria-hidden="true" />
        <PageHeader tool="site" />
        <div className="df-empty">در حال بارگذاری…</div>
      </div>
    );
  }

  const activeKind = tab.startsWith('k:') ? tab.slice(2) : null;
  const blocksBySection = data.blockDefs.reduce((acc, b) => {
    (acc[b.section] ??= []).push(b);
    return acc;
  }, {});

  return (
    <div className="df df-form">
      <div className="df-bg" aria-hidden="true" />
      <PageHeader tool="site" sub={`صفحه‌ای که روی دامنهٔ خودِ ${org} دیده می‌شود — پیش از هر ورودی.`} />

      {/* ── وضعیتِ انتشار ── */}
      <div className={`st-publish${data.published ? ' on' : ''}`}>
        <div>
          <b>{data.published ? 'سایت منتشر شده است' : 'سایت منتشر نشده'}</b>
          <small>
            {data.published
              ? `ریشهٔ دامنهٔ ${org} این صفحه را نشان می‌دهد.`
              : 'تا وقتی منتشر نشود، ریشهٔ دامنه مثلِ همیشه به فرمِ ورود می‌رود.'}
          </small>
        </div>
        <label className="us-switch">
          <input type="checkbox" checked={data.published} disabled={busy} onChange={(e) => publish(e.target.checked)} />
          <span className="us-track" />
        </label>
      </div>

      <Tabs
        label="بخش‌های سایت"
        variant="scroll"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'sections', label: 'چیدمان' },
          { key: 'texts', label: 'متن‌ها' },
          ...kindsWithSection.map((s) => ({ key: `k:${s.kind}`, label: KINDS[s.kind]?.label ?? s.label })),
        ]}
      />

      {tab === 'sections' && (
        <>
          <p className="df-note">هر بخش را می‌توانید خاموش کنید یا جابه‌جا. بخشی که محتوایی نداشته باشد خودبه‌خود روی صفحه دیده نمی‌شود.</p>
          <div className="df-list">
            {data.sections.map((s, i) => (
              <motion.article key={s.key} {...stagger(i)} className={`df-row${s.enabled ? '' : ' off'}`}>
                <div className="df-row-main">
                  <b>{s.label}</b>
                  {s.hint && <small>{s.hint}</small>}
                </div>
                <div className="df-acts">
                  <button type="button" onClick={() => move(s.key, -1)} disabled={i === 0} aria-label="بالاتر"><ArrowUp width="15" height="15" /></button>
                  <button type="button" onClick={() => move(s.key, 1)} disabled={i === data.sections.length - 1} aria-label="پایین‌تر"><ArrowDown width="15" height="15" /></button>
                  <label className="us-switch">
                    <input type="checkbox" checked={s.enabled} disabled={busy} onChange={(e) => setSection(s.key, { enabled: e.target.checked })} />
                    <span className="us-track" />
                  </label>
                </div>
              </motion.article>
            ))}
          </div>
        </>
      )}

      {tab === 'texts' && (
        <>
          <div className="df-list">
            {data.sections.map((s) => {
              const defs = blocksBySection[s.key];
              if (!defs?.length) return null;
              return (
                <section key={s.key} className="st-group">
                  <h2>{s.label}</h2>
                  <div className="pf">
                    {defs.map((b) => (
                      <label key={b.key} className="pf-field">
                        <span>{b.label}</span>
                        {b.multiline
                          ? <textarea rows={3} value={draft[b.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [b.key]: e.target.value }))} />
                          : <input value={draft[b.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [b.key]: e.target.value }))} />}
                        {b.hint && <i className="pf-hint">{b.hint}</i>}
                      </label>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          <div className="st-save">
            <button type="button" className="df-save" disabled={busy} onClick={saveBlocks}>ذخیرهٔ متن‌ها</button>
          </div>
        </>
      )}

      {activeKind && (
        <>
          {KINDS[activeKind]?.hint && <p className="df-note">{KINDS[activeKind].hint}</p>}
          <div className="df-toolbar">
            <button type="button" className="df-add" onClick={() => setEditing({ kind: activeKind, row: {} })}>
              <Plus width="16" height="16" /> افزودن
            </button>
            <span className="df-count">{faNum((data.items[activeKind] ?? []).length)} مورد</span>
          </div>
          <div className="df-list">
            {(data.items[activeKind] ?? []).length === 0 && <div className="df-empty">{KINDS[activeKind]?.empty}</div>}
            {(data.items[activeKind] ?? []).map((row, i) => (
              <motion.article key={row.id} {...stagger(i)} className={`df-row${row.active ? '' : ' off'}`}>
                {row.image && <img className="st-thumb" src={apiUrl(row.image)} alt="" />}
                <div className="df-row-main">
                  <b>{row.title}{!row.active && <i> (پنهان)</i>}</b>
                  {(row.subtitle || row.body) && <small>{row.subtitle || row.body}</small>}
                </div>
                <div className="df-acts">
                  <button type="button" onClick={() => setEditing({ kind: activeKind, row })} aria-label="ویرایش"><Pencil width="15" height="15" /></button>
                  <button type="button" className="df-del" onClick={() => removeItem(row.id)} aria-label="حذف"><Trash width="15" height="15" /></button>
                </div>
              </motion.article>
            ))}
          </div>
        </>
      )}

      <AnimatePresence>
        {editing && (
          <ItemSheet
            kind={editing.kind}
            row={editing.row}
            onClose={() => setEditing(null)}
            onSaved={load}
            onToast={setToast}
          />
        )}
      </AnimatePresence>

      <Toast msg={toast} />
    </div>
  );
}
