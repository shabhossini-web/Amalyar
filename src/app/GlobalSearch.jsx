import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import Overlay from '../ui/Overlay.jsx';
import { api } from '../lib/api.js';
import { Close, Search } from '../ui/icons.jsx';

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');
const isTyping = (el) => {
  const t = el?.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || !!el?.isContentEditable;
};

/**
 * پالتِ جستجوی بیمار — از هر صفحه: Ctrl/⌘+K، یا `/` وقتی در فیلدی نیستی.
 * نتیجه از `GET /search/patients` (همان object-authzِ سرور: زیرِ سوپروایزر فقط
 * بیمارانِ خودش). Enter پرونده را باز می‌کند؛ Escape می‌بندد؛ فوکوس داخلِ جعبه می‌ماند.
 * روی `Overlay`ِ مشترک سوار است تا خروجش هم مثلِ بقیهٔ شیت‌ها انیمیشن داشته باشد.
 */
export default function GlobalSearch({ open, onOpen, onClose }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [idx, setIdx] = useState(0);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);
  const seq = useRef(0);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e) => {
      /* Escape همیشه می‌بندد — حتی اگر فوکوس هنوز به جعبه نرسیده باشد (فوکوس با
         یک تیکِ تأخیر ست می‌شود؛ e2e همین پنجرهٔ کوچک را گرفت). */
      if (open && e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) onClose(); else onOpen();
        return;
      }
      if (!open && e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(document.activeElement)) {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpen, onClose]);

  useEffect(() => {
    if (!open) return;
    setQ(''); setRows([]); setIdx(0); setErr('');
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = q.trim();
    if (t.length < 2) { setRows([]); setBusy(false); return; }
    const my = ++seq.current;
    setBusy(true);
    const h = setTimeout(() => {
      api(`/search/patients?q=${encodeURIComponent(t)}`)
        .then((r) => { if (my === seq.current) { setRows(Array.isArray(r) ? r : []); setIdx(0); setErr(''); } })
        .catch((e) => { if (my === seq.current) { setRows([]); setErr(e?.message || 'جستجو انجام نشد'); } })
        .finally(() => { if (my === seq.current) setBusy(false); });
    }, 220);
    return () => clearTimeout(h);
  }, [q, open]);

  const go = useCallback((p) => {
    if (!p) return;
    onClose();
    navigate(`/app/patients/${p.id}`);
  }, [navigate, onClose]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, Math.max(rows.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(rows[idx]); }
    else if (e.key === 'Tab') { e.preventDefault(); inputRef.current?.focus(); }
  };

  return (
    <AnimatePresence>
      {open && (
        <Overlay backdrop="gs-overlay" panel="gs-panel" onClose={onClose} role="dialog" aria-modal="true" aria-label="جستجوی بیمار" onKeyDown={onKeyDown}>
          <div className="gs-input-row">
            <Search width="18" height="18" aria-hidden="true" />
            {/* autoFocus: فوکوس همان لحظهٔ mount (هم‌زمان با commit)، نه بعد از یک تیک —
                وگرنه پالت باز است ولی تایپ به صفحهٔ زیرش می‌رود. */}
            <input
              ref={inputRef} id="gs-input" className="gs-input" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
              placeholder="نام، کدِ پرونده، موبایل یا کدِ ملی…" autoComplete="off" spellCheck={false}
              role="combobox" aria-expanded={rows.length > 0} aria-controls="gs-list"
              aria-activedescendant={rows[idx] ? `gs-opt-${rows[idx].id}` : undefined}
            />
            {busy && <span className="gs-busy" aria-hidden="true" />}
            <button type="button" className="gs-close" onClick={onClose} aria-label="بستن"><Close width="16" height="16" /></button>
          </div>
          <ul id="gs-list" className="gs-list" role="listbox" aria-label="نتایج">
            {rows.map((p, i) => (
              <li
                key={p.id} id={`gs-opt-${p.id}`} role="option" aria-selected={i === idx} className={i === idx ? 'on' : ''}
                onMouseEnter={() => setIdx(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => go(p)}
              >
                <span className="gs-name">{p.fullName}</span>
                <span className="gs-meta">
                  <code dir="ltr">{p.code}</code>
                  {p.phone && <span dir="ltr">{p.phone}</span>}
                  <span>{faNum(p.visitCount)} مراجعه</span>
                </span>
              </li>
            ))}
            {q.trim().length < 2 && (
              <li className="gs-hint">دستِ‌کم دو حرف بنویسید · <kbd>↑</kbd><kbd>↓</kbd> انتخاب · <kbd>Enter</kbd> بازکردنِ پرونده · <kbd>Esc</kbd> بستن</li>
            )}
            {!busy && q.trim().length >= 2 && rows.length === 0 && !err && <li className="gs-empty">بیماری با این مشخصات پیدا نشد</li>}
            {err && <li className="gs-empty">{err}</li>}
          </ul>
        </Overlay>
      )}
    </AnimatePresence>
  );
}
