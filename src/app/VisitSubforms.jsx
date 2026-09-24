import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import Overlay from '../ui/Overlay.jsx';
import { Caret, Close, Plus, Search, Star, StarLine } from '../ui/icons.jsx';
import './visit-subforms.css';

/**
 * **قطعه‌های فرمِ مراجعه پس از بازخوردِ ۱۴۰۵/۰۷/۰۳** — طرحِ مصوبِ مالک:
 * - سربرگ: فقط نامِ همین مراجعه، «+ الصاقِ فرم» و سه اسلاتِ «فرمِ منتخب» (نه سه دکمهٔ نوعِ فرم)؛
 * - زیرفرم‌ها: پیش‌فرض پنهان، با الصاق دیده می‌شوند — کارتِ جمع‌شونده با × فقط وقتی خالی است؛
 * - پنجرهٔ الصاق: گروه‌ها، جستجو و ستارهٔ «منتخب»؛
 * - تصمیمِ درمانی: یک کشوییِ چندانتخابی، با گزینهٔ انحصاریِ «فعلاً نیاز به پیگیریِ بعدی نیست».
 *
 * ⚠️ هیچ فهرستی این‌جا هاردکد نیست: زیرفرم‌ها از `/forms/subforms`، تصمیم‌ها و پرچمِ
 * «درخواست/انحصاری»شان از `/config` (`labels.ts`) می‌آیند.
 */

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');

/** کاتالوگِ زیرفرم‌ها — هر بار که فرم باز می‌شود از نو: فرم‌ساز ممکن است همین حالا عوضش کرده باشد. */
export function useSubformCatalog() {
  const [cat, setCat] = useState(null);
  useEffect(() => {
    let on = true;
    api('/forms/subforms')
      .then((r) => { if (on) setCat({ groups: r?.groups ?? [], items: Array.isArray(r?.items) ? r.items : [] }); })
      /* بی‌کاتالوگ یعنی «زیرفرمی نیست» — فرم بی‌دکمهٔ الصاق کار می‌کند، نه صفحهٔ شکسته. */
      .catch(() => { if (on) setCat({ groups: [], items: [] }); });
    return () => { on = false; };
  }, []);
  return cat;
}

/** قابلِ الصاق روی این نوع؟ — داخلی‌ها (علائم/درخواست) در فرمِ عمل تبِ خودشان را دارند. */
export const attachableOn = (item, kind) => !!item && item.active !== false && !(item.nonSurgery && kind === 'surgery');

/**
 * **سربرگِ مراجعه** — نقطهٔ رنگِ نوع، نامِ همین مراجعه، موضوع، «الصاقِ فرم» و سه منتخب.
 *
 * ⚠️ اسلاتِ پر روی فرمی که این‌جا الصاق‌شدنی نیست (داخلی در فرمِ عمل، یا خاموش در
 * فرم‌ساز) غیرفعال است با توضیح — پنهان‌کردنش جای اسلات‌ها را جابه‌جا می‌کرد.
 */
export function VisitHeadBar({ title, color, topic, pins, byKey, kind, attached, onAttach, onPin, disabled, showAttach }) {
  return (
    <div className="vf-bar" data-visit-bar>
      <div className="vf-bar-title">
        <i className="vf-dot" style={color ? { '--k': `var(--kind-${color})` } : undefined} aria-hidden="true" />
        <b data-visit-title>{title}</b>
        {topic && <span className="vf-topic" data-visit-topic>{topic}</span>}
      </div>
      {showAttach && (
        <div className="vf-bar-acts">
          <button type="button" className="vf-attach" onClick={onAttach} disabled={disabled} data-act="attach-open">
            <Plus width="15" height="15" aria-hidden="true" />الصاقِ فرم
          </button>
          {pins.map((key, i) => {
            const it = key ? byKey.get(key) : null;
            if (!it) {
              return (
                <button key={`slot-${i}`} type="button" className="vf-pin" onClick={onAttach} disabled={disabled} data-pin-slot={i}>
                  <Plus width="13" height="13" aria-hidden="true" />فرمِ منتخب {faNum(i + 1)}
                </button>
              );
            }
            const usable = attachableOn(it, kind);
            const on = attached.has(key);
            return (
              <button
                key={`slot-${i}`} type="button" data-pin-slot={i} data-pin={key}
                className={`vf-pin on${on ? ' is-attached' : ''}`}
                onClick={() => onPin(it)} disabled={disabled || !usable}
                title={!usable ? `«${it.title}» در این فرم در دسترس نیست` : on ? `«${it.title}» الصاق شده — برو به آن` : `الصاقِ «${it.title}»`}
              >
                <Star width="13" height="13" aria-hidden="true" />{it.short}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * **کارتِ یک زیرفرم** — عنوان، «الصاق‌شده»، جمع/باز، و × فقط وقتی خالی است (سرور هم
 * همین را می‌سنجد؛ دادهٔ بالینی با یک کلیکِ اشتباه نمی‌رود).
 */
export function SubformCard({ skey, title, badge, open, onToggle, onRemove, removeHint, children }) {
  return (
    <section className="vf-card" data-subform={skey}>
      <header>
        <b>{title}</b>
        {badge && <small>{badge}</small>}
        <button
          type="button" className={`vf-ic${open ? ' is-open' : ''}`} onClick={onToggle}
          aria-expanded={open} aria-label={open ? `جمع‌کردنِ ${title}` : `بازکردنِ ${title}`}
        >
          <Caret width="15" height="15" aria-hidden="true" />
        </button>
        {onRemove ? (
          <button type="button" className="vf-ic" onClick={onRemove} aria-label={`برداشتنِ ${title}`} data-act="subform-remove">
            <Close width="14" height="14" aria-hidden="true" />
          </button>
        ) : removeHint ? <i className="vf-card-lock" title={removeHint} aria-hidden="true" /> : null}
      </header>
      {open && <div className="vf-card-body">{children}</div>}
    </section>
  );
}

/**
 * **پنجرهٔ «الصاقِ فرم»** — گروه‌ها (پرکاربرد/ارزیابی/جراحی/ساختِ خودتان)، جستجو، ستارهٔ
 * منتخب و «الصاق». روی `body` می‌نشیند: transformِ شیتِ مراجعه fixedِ فرزند را می‌بُرد.
 */
export function AttachPicker({ open, onClose, visitWord, groups, items, attached, pins, onPin, onAttach, canBuild }) {
  const [q, setQ] = useState('');
  useEffect(() => { if (!open) setQ(''); }, [open]);
  const needle = q.trim();
  const shown = useMemo(
    () => (needle ? items.filter((x) => `${x.title} ${x.hint ?? ''}`.includes(needle)) : items),
    [items, needle],
  );
  const pinned = new Set((pins ?? []).filter(Boolean));
  return createPortal(
    <AnimatePresence>
      {open && (
        <Overlay
          backdrop="db-overlay vf-pick-overlay" panel="glass vf-pick" from="bottom" onClose={onClose}
          role="dialog" aria-modal="true" aria-label={`الصاقِ فرم به این ${visitWord}`}
        >
          <header className="vf-pick-head">
            <b>الصاقِ فرم به این {visitWord}</b>
            <button type="button" className="db-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
          </header>
          <label className="vf-pick-search">
            <Search width="15" height="15" aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی فرم…" aria-label="جستجوی فرم" />
          </label>
          <div className="vf-pick-list">
            {groups.map((g) => {
              const rows = shown.filter((x) => x.group === g.key);
              if (!rows.length) return null;
              return (
                <div key={g.key} className="vf-pick-group" data-subform-group={g.key}>
                  <span>{g.label}</span>
                  {rows.map((it) => {
                    const done = attached.has(it.key);
                    const star = pinned.has(it.key);
                    return (
                      <div key={it.key} className={`vf-pick-row${done ? ' is-done' : ''}`} data-subform-item={it.key}>
                        <div>
                          <b>{it.title}</b>
                          {it.hint && <small>{it.hint}</small>}
                        </div>
                        <button
                          type="button" className={`vf-star${star ? ' on' : ''}`} onClick={() => onPin(it)}
                          aria-pressed={star} aria-label={star ? `برداشتنِ «${it.title}» از منتخب‌ها` : `افزودنِ «${it.title}» به منتخب‌ها`}
                          title={star ? 'از منتخب‌ها بردار' : 'به منتخب‌ها اضافه کن'}
                        >
                          {star ? <Star width="15" height="15" /> : <StarLine width="15" height="15" />}
                        </button>
                        <button type="button" className="vf-add" disabled={done} onClick={() => onAttach(it)} data-act="attach">
                          {done ? 'الصاق شده' : 'الصاق'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {!shown.length && <p className="vf-pick-empty">{needle ? 'فرمی با این نام نیست.' : 'هنوز زیرفرمی تعریف نشده.'}</p>}
          </div>
          {canBuild && (
            /* تبِ تازه: رفتن از همین‌جا فرمِ نیمه‌پرِ مراجعه را می‌بست و نوشته‌ها گم می‌شد. */
            <a className="vf-pick-foot" href="/app/forms?new=subform" target="_blank" rel="noopener noreferrer">
              <Plus width="14" height="14" aria-hidden="true" />ساختِ زیرفرمِ تازه در فرم‌ساز
            </a>
          )}
        </Overlay>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * **تصمیمِ درمانی — کشوییِ چندانتخابی** (جای ردیفِ چیپ‌ها).
 *
 * ⚠️ کلیدهای «درخواست» (`order`) نشان داده نمی‌شوند ولی در `value` **می‌مانند**: درخواست
 * حالا زیرفرمِ خودش را دارد و ثبتِ سفارش کلید را در سرور می‌گذارد. گزینهٔ انحصاری همه‌چیز
 * (از جمله آن‌ها) را پاک می‌کند — سرور ترکیبش را با هر تصمیمِ دیگری رد می‌کند.
 */
export function DecisionSelect({ label, options, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    /* Escape فقط همین کشو را ببندد، نه شیتِ مراجعه را (همان قاعدهٔ `Pick`). */
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('keydown', key, true); };
  }, [open]);
  const list = options.filter((o) => !o.order);
  const regular = list.filter((o) => !o.exclusive);
  const only = list.find((o) => o.exclusive) ?? null;
  const picked = list.filter((o) => value.includes(o.key));
  const toggle = (o) => {
    const on = value.includes(o.key);
    if (o.exclusive) { onChange(on ? value.filter((k) => k !== o.key) : [o.key]); return; }
    onChange(on ? value.filter((k) => k !== o.key) : [...value.filter((k) => k !== only?.key), o.key]);
  };
  return (
    <div className="vf-dd" ref={ref} data-section="decisions">
      <span className="vf-dd-label">{label}</span>
      <button
        type="button" className="vf-dd-btn" aria-haspopup="listbox" aria-expanded={open} disabled={disabled}
        onClick={() => setOpen((x) => !x)} data-act="decision-open"
      >
        {picked.length
          ? picked.map((o) => <span key={o.key} className="vf-tag" data-decision-tag={o.key}>{o.label}</span>)
          : <i>انتخاب کنید</i>}
        <Caret className="vf-dd-caret" width="16" height="16" aria-hidden="true" />
      </button>
      {open && (
        <div className="vf-dd-panel" role="listbox" aria-multiselectable="true" aria-label={label}>
          {regular.map((o) => {
            const on = value.includes(o.key);
            return (
              <button key={o.key} type="button" role="option" aria-selected={on} className={`vf-opt${on ? ' on' : ''}`} onClick={() => toggle(o)} data-decision={o.key}>
                <i aria-hidden="true" />{o.label}
              </button>
            );
          })}
          {only && (
            <button
              type="button" role="option" aria-selected={value.includes(only.key)} data-decision={only.key}
              className={`vf-opt sep${value.includes(only.key) ? ' on' : ''}`} onClick={() => toggle(only)}
            >
              <i aria-hidden="true" />{only.label}<small>بقیه را پاک می‌کند</small>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const FA = '۰۱۲۳۴۵۶۷۸۹';
const fa = (v) => String(v).replace(/\d/g, (d) => FA[d]).replace('.', '٫');
const numOf = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[۰-۹]/g, (d) => FA.indexOf(d)).replace(/[٫,]/g, '.'));
  return Number.isFinite(n) ? n : null;
};

/** نمودارِ خطیِ کوچک — فقط هندسهٔ رسم، نه دادهٔ مشتق. */
function Spark({ vals }) {
  const w = 110; const h = 30; const pad = 3;
  const lo = Math.min(...vals); const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const pts = vals.map((v, i) => [
    pad + (i * (w - 2 * pad)) / Math.max(1, vals.length - 1),
    h - pad - ((v - lo) * (h - 2 * pad)) / span,
  ]);
  const last = pts[pts.length - 1];
  return (
    <svg className="vf-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill="currentColor" />
    </svg>
  );
}

/**
 * **روندِ رشد** — قد/وزن/دورِ سرِ همین بیمار در مراجعه‌های قبلی (`history`ِ سرور) + مقدارِ
 * همین فرم. فقط اندازه‌ای که دست‌کم دو نوبت دارد رسم می‌شود؛ یک نقطه روند نیست.
 */
export function GrowthTrend({ history, current }) {
  const pts = [...(history ?? [])].reverse().map((h) => h.data ?? {}).concat(current ? [current] : []);
  const series = [['height', 'قد', 'سانتی‌متر'], ['weight', 'وزن', 'کیلوگرم'], ['head', 'دورِ سر', 'سانتی‌متر']]
    .map(([k, l, u]) => ({ k, l, u, vals: pts.map((p) => numOf(p[k])).filter((v) => v != null) }))
    .filter((s) => s.vals.length >= 2);
  if (!series.length) return null;
  return (
    <div className="vf-trend" data-growth-trend>
      {series.map((s) => (
        <figure key={s.k}>
          <figcaption>{s.l}</figcaption>
          <Spark vals={s.vals} />
          <span>{fa(s.vals[s.vals.length - 1])} {s.u}</span>
        </figure>
      ))}
    </div>
  );
}
