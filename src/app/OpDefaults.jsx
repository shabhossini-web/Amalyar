import { useState } from 'react';
import { Plus } from '../ui/icons.jsx';
import './op-defaults.css';

/**
 * **پیش‌فرض‌های شرحِ عمل** — چیپ‌های بالای کادرِ شرح و «افزودن به پیش‌فرض» زیرش.
 *
 * درخواستِ مالک (۱۴۰۵/۰۷/۰۱): «زیرِ شرحِ عمل وقتی تایپ کردند یک "افزودن به
 * پیش‌فرض" بگذار، که شرحی که نوشته‌اند را همان‌جا به شرح‌عمل‌های آن عمل اضافه
 * کنند».
 *
 * ⚠️ یک کامپوننت برای سه جا (فرمِ عمل، میزِ اتاقِ عمل، کامپوزرِ پرونده): هر سه
 * همان سندِ «شرحِ عمل» را می‌نویسند، پس اگر رفتارِ «افزودن» در یکی فرق می‌کرد،
 * کاربر در یک صفحه تکراری می‌ساخت و در دیگری نه. داده و قاعده هم یکی است
 * (`server/src/patients/op-templates.ts`)؛ این‌جا فقط رابط است.
 *
 * ⚠️ دکمه فقط وقتی هست که سرور گفته این کاربر می‌تواند (`canAdd`، مجوزِ
 * `templates.add`) — دکمه‌ای که به ۴۰۳ بخورد بدتر از نبودنش است.
 */

/** کوتاه‌تر از این «شرح» نیست — همان کمینهٔ سرور (`OP_TEMPLATE_MIN`). */
export const OP_DEFAULT_MIN = 10;

/**
 * درجِ قالب در متن: کادرِ خالی → خودِ قالب؛ وگرنه زیرِ متنِ فعلی با یک خطِ
 * فاصله. همان رفتارِ چیپ‌های کامپوزرِ پرونده — درج هرگز نوشتهٔ کاربر را پاک
 * نمی‌کند.
 */
export const withTemplate = (cur, body) => {
  const c = String(cur ?? '');
  return c.trim() ? `${c.replace(/\s+$/, '')}\n\n${body}` : body;
};

/** چیپ‌های «قالبِ آماده» — اختصاصیِ همین عمل اول، عمومی بعد (ترتیبِ سرور). */
export function OpDefaultChips({ items, onPick, disabled }) {
  if (!items?.length) return null;
  return (
    <div className="od-chips" data-op-defaults aria-label="قالب‌های آمادهٔ شرحِ عمل">
      <small>قالبِ آماده:</small>
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`od-chip${t.specific ? ' sp' : ''}`}
          data-op-default={t.id}
          disabled={disabled}
          title={t.specific ? 'اختصاصیِ همین نوعِ عمل' : 'قالبِ عمومی'}
          onClick={() => onPick(t)}
        >
          {t.title}
        </button>
      ))}
    </div>
  );
}

/**
 * «افزودن به پیش‌فرض» — زیرِ کادرِ شرح، **فقط وقتی چیزی نوشته شده**.
 *
 * یک ضربه عنوانِ اختیاری را باز می‌کند (پیش‌فرض: نامِ عمل) و ضربهٔ دوم می‌افزاید؛
 * دو ضربه تا یک لمسِ اشتباه روی گوشی وسطِ عمل قالبِ ناخواسته نسازد.
 *
 * ⚠️ Enter در کادرِ عنوان فرمِ بیرونی (`VisitForm`) را **ثبت نمی‌کند** و Escape
 * فقط همین کادر را می‌بندد نه کلِ شیت را: شنوندهٔ Escapeِ `Overlay` روی
 * document است و `stopPropagation`ِ React پیش از رسیدن به آن جلویش را می‌گیرد.
 *
 * @param {object} p
 * @param {string} p.text متنِ فعلیِ کادرِ شرح
 * @param {string|null} p.procedureName نامِ عملِ مقصد (اصلی)؛ نبودش یعنی هنوز مقصدی نیست
 * @param {string} [p.missingHint] وقتی مقصد نیست چه بگوییم (هر صفحه راهِ خودش را دارد)
 * @param {boolean} p.canAdd از سرور
 * @param {(title?: string) => Promise<{duplicate?: boolean}>} p.onSave
 * @param {(msg: string, bad?: boolean) => void} p.onToast
 */
export function OpDefaultSave({ text, procedureName, missingHint, canAdd, onSave, onToast, disabled }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  if (!canAdd || !String(text ?? '').trim()) return null;
  if (!procedureName) {
    return <p className="od-hint" data-op-default-hint>{missingHint || 'برای «افزودن به پیش‌فرض»، اول نوعِ عمل را انتخاب کنید.'}</p>;
  }

  const close = () => { setOpen(false); setTitle(''); };
  const save = async () => {
    if (busy) return;
    if (String(text).trim().length < OP_DEFAULT_MIN) {
      onToast('متن کوتاه‌تر از آن است که پیش‌فرض شود', true);
      return;
    }
    setBusy(true);
    try {
      const r = await onSave(title.trim() || undefined);
      onToast(r?.duplicate
        ? `همین متن از قبل پیش‌فرضِ «${procedureName}» است`
        : `به پیش‌فرض‌های «${procedureName}» اضافه شد ✓`);
      close();
    } catch (e) {
      onToast(e?.message || 'به پیش‌فرض‌ها اضافه نشد', true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="od-save" data-op-default-save>
      {open ? (
        <>
          <div className="od-row">
            <input
              type="text"
              value={title}
              autoFocus
              maxLength={120}
              aria-label="عنوانِ پیش‌فرض"
              placeholder={`عنوان (اختیاری) — پیش‌فرض: ${procedureName}`}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); save(); }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
              }}
            />
            <button type="button" className="od-ok" data-op-default-confirm disabled={busy || disabled} onClick={save}>
              {busy ? 'در حالِ افزودن…' : 'افزودن'}
            </button>
            <button type="button" className="od-cancel" disabled={busy} onClick={close}>لغو</button>
          </div>
          <small className="od-note">
            همین متن قالبِ آمادهٔ شرحِ «{procedureName}» می‌شود و از این به بعد بالای همین کادر پیشنهاد می‌شود.
          </small>
        </>
      ) : (
        <button type="button" className="od-btn" data-op-default-add disabled={disabled} onClick={() => setOpen(true)}>
          <Plus width="14" height="14" aria-hidden="true" />
          افزودن به پیش‌فرض‌های «{procedureName}»
        </button>
      )}
    </div>
  );
}
