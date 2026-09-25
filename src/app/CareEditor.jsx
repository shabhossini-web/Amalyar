import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import AssistedTextarea from '../ui/AssistedTextarea.jsx';
import Overlay from '../ui/Overlay.jsx';
import { Close, Pencil } from '../ui/icons.jsx';
import './dashboard.css';
import './care-editor.css';

/**
 * **مراقبت‌های قبل/بعد از عمل — پیش‌نما در فرم، نوشتن در پاپ‌آپِ بزرگ.**
 *
 * بازخوردِ مالک (۱۴۰۵/۰۷/۰۳): «در بخشِ مراقبت‌های پیش و پس از عمل، باکس‌ها جایشان برای تایپ
 * و دیدن مناسب نیست؛ مثلِ شرحِ عمل پاپ‌آپش کن.» پس همان الگوی شرحِ عمل (`.db-report-*`): کلِ
 * پیش‌نما یک دکمه است و نوشتن در شیتِ بزرگ.
 *
 * ⚠️ یک فرقِ عمدی با شرحِ عمل: بازکردنِ پاپ‌آپ قالبِ نوعِ عمل را در متن **نمی‌نشاند**. این‌جا
 * «خالی» معنا دارد — «همان قالبِ نوعِ عمل فرستاده شود» — و کپیِ قالب در متنِ اختصاصی باید کارِ
 * صریحِ کاربر باشد («استفاده و ویرایش»)، وگرنه خلاصهٔ برنامه «متنِ همین فرم» می‌گفت در حالی که
 * کسی چیزی ننوشته بود.
 *
 * دستیار: «پیش‌نویس با دستیار» از نوعِ عمل و تشخیصِ همین فرم می‌نویسد (`onAi` → `/ai/care-draft`)؛
 * ابزارهای گوشهٔ کادر (دیکته، اصلاح، ادامه) هم همان بافتار را دارند (`AiContext` + `care`).
 * پاپ‌آپ روی `document.body` می‌نشیند: transformِ شیتِ مراجعه fixedِ فرزند را می‌بُرد.
 */
export default function CareEditor({
  phase, label, when, value, onChange, defaultText, defaultName, placeholder, disabled,
  aiOn, aiBusy, aiReady, onAi, canUndo, onUndo,
}) {
  const [open, setOpen] = useState(false);
  const own = String(value ?? '').trim();
  const shut = () => { if (!aiBusy) setOpen(false); };
  return (<>
    {/* ⚠️ کلِ کادر یک دکمه است — هر جایش بخورد پاپ‌آپ باز می‌شود. */}
    <button
      type="button" className={`db-report-preview${!own && defaultText ? ' is-default' : ''}`} data-care-open={phase}
      onClick={() => setOpen(true)} disabled={disabled} aria-label={`${label} — بازکردن برای نوشتن`}
    >
      {own ? (
        <span className="db-report-text">{value}</span>
      ) : defaultText ? (<>
        <small className="db-report-deflabel">پیش‌فرضِ «{defaultName}» — همین فرستاده می‌شود</small>
        <span className="db-report-text" data-care-default>{defaultText}</span>
      </>) : (
        <i>هنوز نوشته نشده — خالی یعنی پیامی نمی‌رود</i>
      )}
      <b>
        <Pencil width="14" height="14" aria-hidden="true" />
        {own ? 'بزنید تا باز و ویرایش شود' : 'بزنید تا بنویسید'}
      </b>
    </button>
    {createPortal(
      <AnimatePresence>
        {open && (
          <Overlay
            backdrop="db-overlay db-report-overlay" panel="glass db-sheet db-report-sheet" from="bottom"
            closable={!aiBusy} onClose={shut} aria-label={label}
          >
            <header className="db-sheet-head">
              <b>{label}</b>
              <button type="button" className="db-x" onClick={shut} disabled={aiBusy} aria-label="بستن"><Close width="18" height="18" /></button>
            </header>
            <div className="db-field db-report db-report-body db-care-body" data-care-sheet={phase}>
              {when && <p className="db-care-when">{when}</p>}
              {defaultText && (
                <div className="db-default">
                  <p>{defaultText}</p>
                  <button type="button" disabled={aiBusy} onClick={() => onChange(defaultText)}>استفاده و ویرایش</button>
                </div>
              )}
              <AssistedTextarea
                className="db-report-area" rows={12} autoFocus value={value} readOnly={aiBusy}
                onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label}
                purpose={label} aiContext={{ care: phase }} data-care-area={phase}
              />
              {aiOn && (
                <div className="db-aibar">
                  <button type="button" className="db-aibtn" data-act="care-ai" disabled={aiBusy || !aiReady} onClick={onAi}>
                    {aiBusy ? 'دستیار در حالِ نوشتن…' : 'پیش‌نویس با دستیار — از نوعِ عمل و تشخیص'}
                  </button>
                  {canUndo && (
                    <button type="button" className="db-aighost" disabled={aiBusy} onClick={onUndo}>برگرداندنِ متنِ قبلی</button>
                  )}
                  {!aiReady && <small className="db-care-aihint">اول نوعِ عمل یا تشخیص را انتخاب کنید.</small>}
                </div>
              )}
            </div>
            <button type="button" className="db-submit db-report-done" data-act="care-done" disabled={aiBusy} onClick={shut}>تمام</button>
          </Overlay>
        )}
      </AnimatePresence>,
      document.body,
    )}
  </>);
}
