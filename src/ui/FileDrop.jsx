/**
 * کادرِ بارگذاریِ مشترکِ سامانه — **تک‌منبع**.
 *
 * ⚠️ تا امروز هر صفحه `<input type="file">`ِ خودش را داشت و همه‌شان یک عیبِ
 * مشترک: **یک فایل در هر نوبت**. کاربر که سه صفحه جوابِ آزمایش داشت، باید
 * سه بار کلِ چرخه را تکرار می‌کرد و هیچ‌جا نمی‌دید کدام‌ها رفته‌اند.
 *
 * قاعده‌های این کادر:
 * - **چندتایی هم‌زمان** (انتخاب یا رهاکردنِ چند فایل) و **تک‌تکِ پیاپی** در
 *   همان کادر — صفِ آپلود انباشته می‌شود، پاک نمی‌شود.
 * - هر فایل **پیش‌نمایش + وضعیتِ خودش** دارد: در صف، در حالِ رفتن، رفت ✓،
 *   یا خطا با دکمهٔ تلاشِ دوباره. خطای یک فایل بقیه را زمین نمی‌زند.
 * - ترتیبی می‌فرستد نه موازی: سرورِ اشتراکی با ده آپلودِ هم‌زمان می‌ایستد.
 * - سقفِ حجم این‌جا هم چک می‌شود تا کاربر پیشِ آپلود بفهمد، نه بعدِ انتظار.
 */
import { useEffect, useRef, useState } from 'react';
import { Alert, Check, Close, Trash } from './icons.jsx';
import './filedrop.css';

const faNum = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const fmtSize = (b) => (b < 1024 * 1024
  ? `${faNum(Math.max(1, Math.round(b / 1024)))} کیلوبایت`
  : `${faNum((b / 1024 / 1024).toFixed(1))} مگابایت`);

let seq = 0;

export default function FileDrop({
  onUpload,
  onAllDone,
  label = 'انتخاب یا رهاکردنِ فایل',
  hint = '',
  accept = 'image/*,.pdf',
  maxMb = 25,
  multiple = true,
  disabled = false,
  capture,
  /* 'drop' = کادرِ بزرگ (پرونده، فرم‌ها) | 'button' = دکمهٔ فشرده برای
     پنل‌های متراکم (کارشناس، تختهٔ چینش). صف و وضعیت در هر دو یکی است. */
  variant = 'drop',
}) {
  const [items, setItems] = useState([]);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const runningRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  /* پیش‌نمایش‌ها blob‌اند — با unmount آزاد شوند وگرنه حافظه نشت می‌کند. */
  useEffect(() => () => { itemsRef.current.forEach((i) => i.url && URL.revokeObjectURL(i.url)); }, []);

  const patch = (id, data) => setItems((s) => s.map((i) => (i.id === id ? { ...i, ...data } : i)));

  /** صف را ترتیبی خالی می‌کند؛ اگر از قبل در حالِ اجراست، دوباره شروع نمی‌شود. */
  const drain = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.status === 'queued');
        if (!next) break;
        patch(next.id, { status: 'uploading', error: '' });
        try {
          await onUpload(next.file);
          patch(next.id, { status: 'done' });
        } catch (e) {
          patch(next.id, { status: 'error', error: e?.message || 'ارسال نشد' });
        }
      }
      onAllDone?.();
    } finally {
      runningRef.current = false;
    }
  };

  const add = (list) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    const picked = multiple ? files : files.slice(0, 1);
    const next = picked.map((file) => {
      seq += 1;
      const tooBig = file.size > maxMb * 1024 * 1024;
      return {
        id: `f${seq}`,
        file,
        name: file.name,
        size: file.size,
        url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        status: tooBig ? 'error' : 'queued',
        error: tooBig ? `از ${faNum(maxMb)} مگابایت بزرگ‌تر است` : '',
      };
    });
    setItems((s) => (multiple ? [...s, ...next] : next));
    if (inputRef.current) inputRef.current.value = '';
    /* setState ناهم‌زمان است؛ ref را همین‌جا جلو می‌بریم تا drain صف را ببیند. */
    itemsRef.current = multiple ? [...itemsRef.current, ...next] : next;
    drain();
  };

  const retry = (id) => { patch(id, { status: 'queued', error: '' });
    itemsRef.current = itemsRef.current.map((i) => (i.id === id ? { ...i, status: 'queued' } : i));
    drain(); };
  const drop = (id) => setItems((s) => {
    const gone = s.find((i) => i.id === id);
    if (gone?.url) URL.revokeObjectURL(gone.url);
    const rest = s.filter((i) => i.id !== id);
    itemsRef.current = rest;
    return rest;
  });
  const clearDone = () => setItems((s) => {
    s.filter((i) => i.status === 'done').forEach((i) => i.url && URL.revokeObjectURL(i.url));
    const rest = s.filter((i) => i.status !== 'done');
    itemsRef.current = rest;
    return rest;
  });

  const busy = items.some((i) => i.status === 'uploading' || i.status === 'queued');
  const doneCount = items.filter((i) => i.status === 'done').length;

  if (variant === 'button') {
    return (
      <div className="fd fd-compact">
        <label className={`fd-btn${busy ? ' busy' : ''}`}>
          <input
            ref={inputRef} type="file" accept={accept} multiple={multiple || undefined}
            capture={capture} disabled={disabled}
            onChange={(e) => add(e.target.files)}
          />
          {busy ? 'در حالِ ارسال…' : label}
        </label>
        {items.length > 0 && (
          <div className="fd-list">
            {items.map((i) => (
              <div className={`fd-item ${i.status}`} key={i.id}>
                {i.url
                  ? <img src={i.url} alt="" className="fd-thumb" />
                  : <span className="fd-thumb fd-doc" aria-hidden="true">PDF</span>}
                <div className="fd-meta">
                  <b title={i.name}>{i.name}</b>
                  <small>
                    {i.status === 'done' ? 'ارسال شد ✓'
                      : i.status === 'uploading' ? 'در حالِ ارسال…'
                        : i.status === 'error' ? i.error
                          : `در صف · ${fmtSize(i.size)}`}
                  </small>
                </div>
                {i.status === 'done' && <span className="fd-ok" aria-hidden="true"><Check size={14} /></span>}
                {i.status === 'uploading' && <span className="fd-spin" aria-hidden="true" />}
                {i.status === 'error' && (
                  <button type="button" className="fd-retry" onClick={() => retry(i.id)}>تلاشِ دوباره</button>
                )}
                {i.status !== 'uploading' && (
                  <button type="button" className="fd-x" aria-label="حذف از فهرست" onClick={() => drop(i.id)}>
                    {i.status === 'done' ? <Trash size={13} /> : <Close size={13} />}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fd">
      <label
        className={`fd-drop${drag ? ' on' : ''}${busy ? ' busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!disabled) add(e.dataTransfer.files); }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple || undefined}
          capture={capture}
          disabled={disabled}
          onChange={(e) => add(e.target.files)}
        />
        <b>{busy ? 'در حالِ ارسال…' : label}</b>
        <small>{hint || `تا ${faNum(maxMb)} مگابایت`}</small>
        {multiple && (
          <small className="fd-tip">
            چند فایل با هم، یا یکی‌یکی — هر بار که فایلِ تازه بگذارید به همین فهرست اضافه می‌شود.
          </small>
        )}
      </label>

      {items.length > 0 && (
        <div className="fd-list">
          {items.map((i) => (
            <div className={`fd-item ${i.status}`} key={i.id}>
              {i.url
                ? <img src={i.url} alt="" className="fd-thumb" />
                : <span className="fd-thumb fd-doc" aria-hidden="true">PDF</span>}
              <div className="fd-meta">
                <b title={i.name}>{i.name}</b>
                <small>
                  {i.status === 'done' ? 'ارسال شد ✓'
                    : i.status === 'uploading' ? 'در حالِ ارسال…'
                      : i.status === 'error' ? i.error
                        : `در صف · ${fmtSize(i.size)}`}
                </small>
              </div>
              {i.status === 'done' && <span className="fd-ok" aria-hidden="true"><Check size={14} /></span>}
              {i.status === 'uploading' && <span className="fd-spin" aria-hidden="true" />}
              {i.status === 'error' && (
                <>
                  <span className="fd-bad" aria-hidden="true"><Alert size={14} /></span>
                  <button type="button" className="fd-retry" onClick={() => retry(i.id)}>تلاشِ دوباره</button>
                </>
              )}
              {i.status !== 'uploading' && (
                <button type="button" className="fd-x" aria-label="حذف از فهرست" onClick={() => drop(i.id)}>
                  {i.status === 'done' ? <Trash size={13} /> : <Close size={13} />}
                </button>
              )}
            </div>
          ))}
          {doneCount > 0 && !busy && (
            <button type="button" className="fd-clear" onClick={clearDone}>
              پاک‌کردنِ {faNum(doneCount)} موردِ ارسال‌شده از فهرست
            </button>
          )}
        </div>
      )}
    </div>
  );
}
