import { useRef, useState } from 'react';
import Pick from '../ui/Pick.jsx';
import { Close, Plus, Star } from '../ui/icons.jsx';
import './coding-chips.css';

/**
 * **چیپ‌های «سایرین»** — تشخیص‌ها یا عمل‌های دوم به بعدِ یک مراجعه (بستهٔ ۷ب/۷ج).
 *
 * خواستهٔ مالک: «تشخیص با امکانِ چند تشخیص» و «چند عمل همزمان تو یک مراجعه».
 *
 * ⚠️ **اصلی این‌جا رندر نمی‌شود.** `ids[0]` همان مقدارِ `DefSelect`ِ بالای این
 * ردیف است (ستونِ `Visit.diagnosisId`/`procedureTypeId`)، و ستارهٔ «اجباری»،
 * برچسب، نقشِ مالک و ترتیبِ فرم‌ساز همه روی همان فیلد سوارند. این کامپوننت فقط
 * `ids.slice(1)` را می‌کشد، ولی همیشه **فهرستِ کامل** را تحویل می‌دهد تا «اصلی
 * کن» (جابه‌جاییِ اصلی با یکی از سایرین) یک تغییرِ اتمی باشد نه دو setState.
 *
 * ⚠️ تا اصلی نباشد **هیچ** چیزی رندر نمی‌شود: «سایرِ تشخیص‌ها» بدونِ تشخیصِ
 * اصلی معنا ندارد (سرور هم اولیِ سایرین را اصلی می‌کند)، و رکوردِ قدیمی که فقط
 * متنِ `opType` دارد همان کادرِ متنیِ قدیمی را نگه می‌دارد.
 *
 * ⚠️ افزودن از همان `ui/Pick` است نه selectِ بومی و نه پنلِ تازه — همان پنلِ
 * وسطِ صفحه، همان جستجو و همان قراردادِ `pick-ui` (انتخاب = بستنِ پنل). فقط
 * تعریف‌های **فعال** و ناموجود در فهرست پیشنهاد می‌شوند؛ غیرفعالی که از قبل روی
 * مراجعه است می‌ماند و برچسبِ «غیرفعال» می‌گیرد (سرور هم افزودنِ تازه‌اش را رد
 * و ماندنش را قبول می‌کند).
 *
 * قفلِ نقش این‌جا کاری ندارد: فیلدِ بخشِ نقشِ دیگر داخلِ `<fieldset disabled>`ِ
 * `VisitForm` است و همهٔ دکمه‌های این ردیف بومی از کار می‌افتند.
 */
const AXIS = {
  diagnosis: { noun: 'تشخیص', list: 'سایرِ تشخیص‌ها', nameOf: (o) => o?.title ?? o?.name ?? '' },
  procedure: { noun: 'عمل', list: 'سایرِ عمل‌ها', nameOf: (o) => o?.name ?? o?.title ?? '' },
};

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');

/** بجِ «اصلی» کنارِ برچسبِ فیلد — فقط وقتی واقعاً بیش از یکی هست. */
export function PrimaryBadge() {
  return <em className="cc-badge">اصلی</em>;
}

export default function CodingChips({ axis, ids, options = [], onChange, onQuickAdd, addLabel, max = 10 }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  /* فهرستِ **تازه** برای افزودنِ سریع: پاسخِ ساختِ تعریف بعد از یک درخواستِ شبکه
     می‌رسد و `ids`ِ لحظهٔ کلیک تا آن موقع ممکن است کهنه باشد (کاربر وسطش چیپی
     را برداشته یا اصلی کرده). */
  const idsRef = useRef(ids);
  idsRef.current = ids;

  if (!ids?.length) return null;

  const ax = AXIS[axis] ?? AXIS.diagnosis;
  const byId = new Map(options.map((o) => [o.id, o]));
  const others = ids.slice(1);
  const full = ids.length >= max;
  /* فقط فعال‌ها و نه آنچه همین حالا (اصلی یا سایر) روی مراجعه است — تکرار را
     سرور هم بی‌صدا حذف می‌کند، ولی گزینه‌ای که کاری نمی‌کند نباید دیده شود. */
  const addable = options.filter((o) => o.active !== false && !ids.includes(o.id));

  const add = (id) => {
    if (id == null || ids.includes(id) || full) return;
    onChange([...ids, id]);
  };
  /* «اصلی کن»: همین به جای صفر می‌رود و اصلیِ قبلی **اولینِ سایرین** می‌شود —
     نه آخرشان: رتبه دادهٔ بالینی است و پزشکی که جابه‌جا می‌کند، اصلیِ قبلی را
     هنوز مهم‌ترینِ بقیه می‌داند. */
  const makePrimary = (id) => onChange([id, ...ids.filter((x) => x !== id)]);
  const remove = (id) => onChange(ids.filter((x) => x !== id));

  const submitAdd = async () => {
    const n = name.trim();
    if (n.length < 2 || busy || !onQuickAdd) return;
    setBusy(true);
    try {
      const created = await onQuickAdd(n);
      const cur = idsRef.current ?? [];
      if (created?.id != null && !cur.includes(created.id) && cur.length < max) onChange([...cur, created.id]);
      setAdding(false);
      setName('');
    } catch {
      /* پیام را خودِ `onQuickAdd` به‌شکلِ toast داده (همان قراردادِ DefSelect)؛
         کادر باز می‌ماند تا کاربر همان نوشته را اصلاح کند. */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cc" data-coding-chips={axis}>
      {others.length > 0 && (
        <ul className="cc-list" role="list" aria-label={ax.list}>
          {others.map((id) => {
            const o = byId.get(id);
            /* تعریفِ نیامده (فهرستِ تعاریف هنوز در راه است) — جای خالی، نه عددِ خام. */
            const label = o ? ax.nameOf(o) : '—';
            return (
              <li key={id} className="cc-chip" role="listitem" data-coding-chip data-id={id}>
                <span className="cc-name" title={label}>{label}</span>
                {axis === 'diagnosis' && o?.icdCode && <small className="cc-icd" dir="ltr">{o.icdCode}</small>}
                {o && o.active === false && <em className="cc-off">غیرفعال</em>}
                <button
                  type="button" className="cc-ico cc-star" data-coding-primary
                  aria-label={`«${label}» اصلی شود`} title="اصلی کن"
                  onClick={() => makePrimary(id)}
                >
                  <Star width="15" height="15" />
                </button>
                <button
                  type="button" className="cc-ico cc-del" data-coding-remove
                  aria-label={`حذفِ «${label}»`} title="حذف"
                  onClick={() => remove(id)}
                >
                  <Close width="15" height="15" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <div className="cc-quick" data-coding-quick>
          <input
            type="text"
            value={name}
            autoFocus
            aria-label={`${ax.noun}ِ تازه`}
            placeholder={axis === 'diagnosis' ? 'عنوانِ تشخیصِ تازه…' : 'نامِ نوعِ عملِ تازه…'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitAdd(); } }}
          />
          <button type="button" disabled={busy || name.trim().length < 2} onClick={submitAdd}>ثبت</button>
          <button type="button" className="ghost" onClick={() => { setAdding(false); setName(''); }}>لغو</button>
        </div>
      ) : (
        <div className="cc-addrow">
          {/* ⚠️ `data-coding-add` روی پوسته است چون `Pick` صفتِ اضافه را به دکمه‌اش
              نمی‌دهد؛ پوسته دقیقاً هم‌اندازهٔ دکمه است، پس کلیک روی آن همان کلیک
              روی دکمه است. `value` همیشه خالی: این دکمه «افزودن» است، نه فیلد. */}
          <span className="cc-add" data-coding-add aria-disabled={full || undefined}>
            <Pick
              label={addLabel}
              value={null}
              clearable={false}
              disabled={full}
              options={addable}
              labelOf={(o) => (axis === 'diagnosis' && o.icdCode ? `${ax.nameOf(o)} · ${o.icdCode}` : ax.nameOf(o))}
              placeholder={<><Plus width="15" height="15" /> {addLabel}</>}
              onChange={add}
            />
          </span>
          {onQuickAdd && !full && (
            <button type="button" className="cc-new" data-coding-new aria-label={`تعریفِ ${ax.noun}ِ تازه`} onClick={() => setAdding(true)}>
              تعریفِ تازه
            </button>
          )}
          {full && <small className="cc-max">حداکثر {faNum(max)}</small>}
        </div>
      )}
    </div>
  );
}
