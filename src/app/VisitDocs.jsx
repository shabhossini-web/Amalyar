import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, apiBlobUrl, apiUpload } from '../lib/api.js';
import FileDrop from '../ui/FileDrop.jsx';
import VoiceNote, { VoiceClip } from '../ui/VoiceNote.jsx';
import { DocThumb, isImageDoc, openDoc } from '../ui/DocThumb.jsx';
import { LinkIcon, Plus } from '../ui/icons.jsx';
import { faDate } from '../lib/jalali.js';
import './visit-docs.css';

/* دسته‌های «مدارکِ بالینیِ» ویزیت. ⚠️ «مشاوره» دستهٔ جدا در پرونده ندارد و مثلِ
   پاسخِ درخواستِ مشاوره زیرِ `report` می‌نشیند؛ عنوانش «مشاوره» می‌ماند. */
export const VISIT_DOC_CATS = [
  { key: 'imaging', label: 'تصویربرداری' },
  { key: 'lab', label: 'آزمایش' },
  { key: 'report', label: 'مشاوره' },
  { key: 'other', label: 'سایر مدارکِ بالینی' },
];
/* برچسبِ همهٔ دسته‌های پرونده — برای زیرنویسِ مدرکی که دسته‌اش در انتخاب‌گرِ همین باکس
   نیست (مثلاً مدرکی که از تبِ «مدارکِ» پرونده با دستهٔ دیگری روی همین مرحله نشسته). */
const ALL_FA = {
  imaging: 'تصویربرداری', lab: 'آزمایش', report: 'گزارش', consent: 'رضایت‌نامه',
  prescription: 'دستورِ پزشک', identity: 'مدرکِ شناسایی', receipt: 'رسید', other: 'متفرقه',
};
const EMPTY_LINK = { url: '', title: '', user: '', pass: '' };

/**
 * **باکسِ مدارک** (اصلاحِ مالک ۱۴۰۵/۰۷/۰۲) — یک الگو برای هر جای فرمِ ویزیت و فرمِ عمل:
 *
 * - مدرکی هست (از جمله آنچه بیمار در فرمِ فرستاده‌شده گذاشته و با تأیید روی همین
 *   مراجعه نشسته)؟ باکس **باز** است و همه را کامل نشان می‌دهد.
 * - زیرِ فهرست — و وقتی چیزی نیست، به‌تنهایی — یک خطِ «+» با توضیح؛ زدنش باکسِ
 *   استاندارد را باز می‌کند: عکس/PDF، لینک + نام کاربری/رمز، ضبطِ صدا.
 *
 * `phase` (قبل/حین/بعد از عمل) همین باکس را به تبِ همان مرحلهٔ فرمِ عمل می‌برد: فقط
 * مدارکِ آن مرحله را نشان می‌دهد و هر چه افزوده شود همان برچسب را می‌گیرد — در هر دو
 * مدل (مطب و شرکتی)، چون مرحلهٔ مدرک در هر دو یک معنا دارد.
 *
 * ⚠️ پاسخِ درخواست‌ها (`*_order`) این‌جا نمی‌آید؛ کنارِ همان درخواست دیده می‌شود.
 * ⚠️ `cats` باید ثابتِ سطحِ ماژول باشد نه آرایهٔ تازه در هر رندر — وگرنه فهرست بی‌وقفه
 * دوباره خوانده می‌شود.
 */
export default function VisitDocs({ patientId, visitId, phase = null, phaseFa = '', cats = VISIT_DOC_CATS, disabled, onToast }) {
  const [docs, setDocs] = useState(null);
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState(cats[0]?.key ?? 'other');
  const [link, setLink] = useState(EMPTY_LINK);
  const [saving, setSaving] = useState(false);
  const catFa = useMemo(() => Object.fromEntries(cats.map((c) => [c.key, c.label])), [cats]);
  const labelOf = (k) => catFa[k] ?? ALL_FA[k] ?? k;

  const load = useCallback(async () => {
    if (!patientId || !visitId) { setDocs([]); return; }
    try {
      const all = await api(`/patients/${patientId}/documents`);
      setDocs((all ?? []).filter((d) => d.visitId === visitId
        && (phase ? d.phase === phase : !d.phase && catFa[d.category])
        && !String(d.refType ?? '').endsWith('_order')));
    } catch { setDocs([]); }
  }, [patientId, visitId, phase, catFa]);
  useEffect(() => { load(); }, [load]);

  /* «مشاوره» فقط در ویزیت عنوانِ خودش را دارد؛ در مرحلهٔ عمل `report` همان «گزارش» است. */
  const title = !phase && cat === 'report' ? 'مشاوره' : undefined;
  const upload = async (file, extraTitle) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('category', cat);
    fd.append('visitId', String(visitId));
    if (phase) fd.append('phase', phase);
    if (extraTitle || title) fd.append('title', extraTitle || title);
    await apiUpload(`/patients/${patientId}/documents`, fd);
  };
  const addLink = async () => {
    if (!link.url.trim() || saving) return;
    setSaving(true);
    try {
      await api(`/patients/${patientId}/documents/link`, {
        method: 'POST',
        body: {
          url: link.url.trim(), category: cat, visitId,
          ...(phase ? { phase } : {}),
          ...(link.title.trim() || title ? { title: link.title.trim() || title } : {}),
          ...(link.user.trim() ? { user: link.user.trim() } : {}),
          ...(link.pass.trim() ? { pass: link.pass.trim() } : {}),
        },
      });
      setLink(EMPTY_LINK);
      onToast?.('لینک ثبت شد ✓');
      load();
    } catch (e) { onToast?.(e.message, true); } finally { setSaving(false); }
  };

  const heading = phase ? `مدارکِ ${phaseFa}` : 'مدارکِ بالینی';
  const addText = phase
    ? `افزودنِ مدارکِ ${phaseFa} (عکس، آزمایش، گزارش)`
    : 'افزودنِ مدارک (تصویربرداری، آزمایش، مشاوره و سایر مدارکِ بالینی)';
  const where = phase ? `روی همین عمل با برچسبِ «${phaseFa}»` : 'روی همین ویزیت';
  const has = (docs ?? []).length > 0;
  const images = (docs ?? []).filter((d) => isImageDoc(d));
  const rows = (docs ?? []).filter((d) => !isImageDoc(d));
  const off = disabled || !visitId;
  return (
    <div className={`db-field vd${phase ? ' vd-phase' : ''}`} data-section={phase ? undefined : 'media'} data-visit-docs data-phase={phase || undefined}>
      {has && <span>{heading}</span>}
      {/* عکس‌ها شبکهٔ بندانگشتی؛ لینک/صدا/فایل هر کدام یک ردیفِ تمام‌عرض — نشانیِ بلند
          و نام کاربری/رمز در ستونِ باریکِ شبکه می‌شکست. */}
      {images.length > 0 && (
        <ul className="vd-grid">
          {images.map((d) => (
            <li key={d.id} className="vd-doc" data-doc={d.id}>
              <button type="button" className="vd-thumb" title="بازکردن در اندازهٔ کامل" onClick={() => openDoc(d, (m) => onToast?.(m, true))}>
                <DocThumb id={d.id} alt={d.title || d.fileName} />
              </button>
              <Caption d={d} labelOf={labelOf} />
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <ul className="vd-rows">
          {rows.map((d) => (
            <li key={d.id} className="vd-row" data-doc={d.id}>
              {d.isAudio ? (
                <VoiceClip load={() => apiBlobUrl(`/patients/documents/${d.id}/file`)} name={d.title || 'توضیحِ صوتی'} />
              ) : d.isLink ? (
                <a className="vd-link" href={d.externalUrl} target="_blank" rel="noopener noreferrer">
                  <LinkIcon width="15" height="15" aria-hidden="true" />
                  <bdi>{d.title || d.externalUrl}</bdi>
                </a>
              ) : d.contentText ? (
                <p className="vd-text">{d.contentText}</p>
              ) : (
                <button type="button" className="vd-file" onClick={() => openDoc(d, (m) => onToast?.(m, true))}><bdi>{d.fileName}</bdi></button>
              )}
              {d.isLink && d.title && <small className="vd-url" dir="ltr">{d.externalUrl}</small>}
              <Caption d={d} labelOf={labelOf} skipTitle={d.isAudio || d.isLink} />
            </li>
          ))}
        </ul>
      )}

      {!open ? (
        <button type="button" className="vd-add" data-act="add-docs" disabled={off} onClick={() => setOpen(true)}>
          <Plus width="16" height="16" aria-hidden="true" />
          {addText}
        </button>
      ) : (
        <div className="vd-box" data-docs-box>
          <div className="vd-cats" role="radiogroup" aria-label="دستهٔ مدرک">
            {cats.map((c) => (
              <button key={c.key} type="button" role="radio" aria-checked={cat === c.key}
                className={cat === c.key ? 'on' : ''} onClick={() => setCat(c.key)} disabled={off}>{c.label}</button>
            ))}
          </div>
          <FileDrop
            accept="image/*,.pdf"
            maxMb={25}
            disabled={off}
            label="عکس یا PDF — انتخاب یا رهاکردن"
            hint={`با دستهٔ «${catFa[cat]}» ${where} ثبت می‌شود`}
            onUpload={(file) => upload(file)}
            /* «ثبت شد» فقط وقتی همه رفتند (R2)؛ فایلِ خطادار با «تلاشِ دوباره» در همین کادر می‌ماند. */
            onAllDone={({ ok = 0, failed = 0 } = {}) => { if (!ok) return; load(); if (!failed) onToast?.('مدرک ثبت شد'); }}
          />
          <div className="vd-linkrow">
            <input type="url" dir="ltr" placeholder="لینک — پکس، درایو یا سایتِ آزمایشگاه" value={link.url}
              onChange={(e) => setLink((s) => ({ ...s, url: e.target.value }))} disabled={off || saving} />
            <input type="text" placeholder="عنوان (اختیاری) — مثلاً MRI کمر" value={link.title}
              onChange={(e) => setLink((s) => ({ ...s, title: e.target.value }))} disabled={off || saving} />
            <div className="vd-cred">
              <input type="text" dir="ltr" placeholder="نامِ کاربری" aria-label="نامِ کاربریِ لینک" value={link.user}
                onChange={(e) => setLink((s) => ({ ...s, user: e.target.value }))} disabled={off || saving} />
              <input type="text" dir="ltr" placeholder="رمز" aria-label="رمزِ لینک" value={link.pass}
                onChange={(e) => setLink((s) => ({ ...s, pass: e.target.value }))} disabled={off || saving} />
            </div>
            <button type="button" className="vd-linkbtn" data-act="add-link" disabled={off || saving || !link.url.trim()} onClick={addLink}>
              {saving ? 'در حالِ ثبت…' : 'افزودنِ لینک'}
            </button>
          </div>
          <VoiceNote
            disabled={off}
            onSave={async (file) => {
              await upload(file, `توضیحِ صوتی — ${phase ? phaseFa : catFa[cat]}`);
              onToast?.('توضیحِ صوتی ثبت شد ✓');
              load();
            }}
          />
          <button type="button" className="vd-close" onClick={() => setOpen(false)}>بستن</button>
        </div>
      )}
      {!visitId && <small className="db-hint">بعد از ذخیرهٔ همین {phase ? 'عمل' : 'ویزیت'}، مدارک از همین‌جا افزوده می‌شود.</small>}
    </div>
  );
}

/** زیرنویسِ هر مدرک. ⚠️ هر تکه در `<bdi>` و جداکننده **بیرونِ** آن — «MRI» یا نام کاربریِ
    لاتین وسطِ متنِ فارسی جداکننده را جابه‌جا می‌کرد. جداکننده خطِ نازک است نه «·»: نقطهٔ
    وسط در وزیرمتن با صفرِ فارسی («۰») یکی دیده می‌شود و «· ۲ مهر» مثلِ «۰۲ مهر» خوانده می‌شد. */
function Caption({ d, labelOf, skipTitle }) {
  const cat = labelOf(d.category);
  const parts = [cat];
  if (!skipTitle && d.title && d.title !== cat) parts.push(d.title);
  if (d.createdAt) parts.push(faDate(d.createdAt));
  return (
    <small className="vd-cap">
      {parts.map((x, i) => (
        <span key={i} className="vd-part">{i > 0 && <i className="vd-sep" aria-hidden="true" />}<bdi dir="rtl">{x}</bdi></span>
      ))}
      {d.externalUser && (
        <span className="vd-cred-show">
          ورود: <bdi dir="ltr">{d.externalUser}{d.externalPass ? ` / ${d.externalPass}` : ''}</bdi>
        </span>
      )}
    </small>
  );
}
