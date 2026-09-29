import AssistedTextarea from '../ui/AssistedTextarea.jsx';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { api, apiDataUrl } from '../lib/api.js';
import { faDate, jToFa } from '../lib/jalali.js';
import { useConfig } from './config.jsx';
import { printLetter } from './exports.js';
import Overlay from '../ui/Overlay.jsx';
import { useStagger } from '../ui/stagger.js';
import './launcher.css'; /* lx-toast */
import './letters.css';
import { Alert, Back, Close, Mail, Plus, Print, Search, Trash } from '../ui/icons.jsx';
import Toast, { useToast } from '../ui/Toast.jsx';

/**
 * نامهٔ اداری (#47) — سندِ رسمیِ شرکت روی سربرگِ آپلودشده در تنظیمات.
 *
 * شماره («سالِ شمسی/شماره») را **سرور** هنگامِ ساخت می‌دهد و دیگر عوض نمی‌شود؛
 * این صفحه فقط فهرست، ویرایشِ متن و چاپ است — هیچ شماره‌سازی سمتِ کلاینت نیست.
 */
export default function Letters() {
  const cfg = useConfig();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState(null); // null | {} | {row}
  const [err, setErr] = useState('');
  const { msg: toast, show: setToast } = useToast(3500);
  const [letterheadUrl, setLetterheadUrl] = useState(null);
  const row = useStagger();
  const tRef = useRef(0);

  useEffect(() => { document.title = 'عمل‌یار — نامهٔ اداری'; }, []);
  useEffect(() => { apiDataUrl('/settings/letterhead').then(setLetterheadUrl); }, []);

  const load = (term = q) =>
    api(`/letters${term.trim() ? `?t=${encodeURIComponent(term.trim())}` : ''}`)
      .then((r) => { setRows(r); setErr(''); })
      .catch((e) => setErr(e.message));

  useEffect(() => { load(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onQ = (v) => {
    setQ(v);
    clearTimeout(tRef.current);
    tRef.current = setTimeout(() => load(v), 350);
  };


  const print = (r) => {
    if (!printLetter({ letter: r, brand: cfg.brand, letterheadUrl })) {
      setToast('پنجرهٔ چاپ مسدود شد — اجازهٔ پاپ‌آپ را بدهید');
    }
  };

  return (
    <div className="lt">
      <div className="lt-bg" aria-hidden="true" />
      <header className="lt-head">
        <Link to="/app" className="lt-back"><Back width="15" height="15" /> سامانه</Link>
        <div className="lt-title">
          <h1><Mail width="20" height="20" /> نامهٔ اداری</h1>
          <p>نامهٔ رسمی روی سربرگِ شرکت — شماره خودکار، چاپ و بایگانی.</p>
        </div>
        <button type="button" className="lt-new" onClick={() => setSheet({})}>
          <Plus width="14" height="14" /> نامهٔ تازه
        </button>
      </header>

      <div className="lt-search">
        <Search width="15" height="15" aria-hidden="true" />
        <input
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder="جستجو در شماره، گیرنده، موضوع…"
          aria-label="جستجو"
        />
      </div>

      {err && <div className="lt-err"><Alert width="15" height="15" /> {err}</div>}
      {!rows && !err && <div className="lt-empty">در حال بارگذاری…</div>}
      {rows && rows.length === 0 && (
        <div className="lt-empty">
          {q.trim() ? 'چیزی با این جستجو پیدا نشد.' : 'هنوز نامه‌ای صادر نشده — «نامهٔ تازه» را بزنید.'}
        </div>
      )}

      {rows && rows.map((r, i) => (
        <motion.article {...row(i)} className="lt-row" key={r.id}>
          <button type="button" className="lt-open" onClick={() => setSheet({ row: r })}>
            <span className="lt-no" dir="ltr">{jToFa(r.no)}</span>
            <span className="lt-main">
              <b>{r.subject}</b>
              <small>به: {r.recipient} · {faDate(r.createdAt)}{r.attachment ? ' · پیوست‌دار' : ''}</small>
            </span>
          </button>
          <button type="button" className="lt-print" title="چاپ" aria-label={`چاپِ نامهٔ ${r.no}`} onClick={() => print(r)}>
            <Print width="15" height="15" />
          </button>
        </motion.article>
      ))}

      <AnimatePresence>
        {sheet && (
          <LetterSheet
            initial={sheet.row}
            onClose={() => setSheet(null)}
            onSaved={(saved, wasEdit) => {
              setSheet(null);
              load();
              setToast(wasEdit ? 'نامه ویرایش شد ✓' : `نامهٔ ${jToFa(saved.no)} صادر شد ✓`);
            }}
            onDeleted={() => { setSheet(null); load(); setToast('نامه حذف شد'); }}
            onPrint={print}
            onToast={setToast}
          />
        )}
      </AnimatePresence>

      <Toast msg={toast} />
    </div>
  );
}

/** فرمِ یک نامه — ساخت یا ویرایش؛ شماره فقط‌خواندنی است. */
function LetterSheet({ initial, onClose, onSaved, onDeleted, onPrint, onToast }) {
  const editing = !!initial;
  const [f, setF] = useState({
    recipient: initial?.recipient ?? '',
    subject: initial?.subject ?? '',
    body: initial?.body ?? '',
    attachment: initial?.attachment ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [askDel, setAskDel] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        recipient: f.recipient.trim(),
        subject: f.subject.trim(),
        body: f.body,
        attachment: f.attachment.trim() || undefined,
      };
      const saved = editing
        ? await api(`/letters/${initial.id}`, { method: 'PATCH', body: { ...body, attachment: f.attachment.trim() || '' } })
        : await api('/letters', { method: 'POST', body });
      onSaved(saved, editing);
    } catch (err) {
      onToast(err.message);
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    setBusy(true);
    try {
      await api(`/letters/${initial.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (err) {
      onToast(err.message);
      setBusy(false);
    }
  };

  return (
    <Overlay backdrop="lt-overlay" panel="glass lt-sheet" as="form" from="bottom" onClose={onClose} onSubmit={submit}>
      <header className="lt-sheet-head">
        <b>{editing ? <>ویرایشِ نامهٔ <span dir="ltr">{jToFa(initial.no)}</span></> : 'نامهٔ تازه'}</b>
        <button type="button" className="lt-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
      </header>

      {editing && (
        <p className="lt-hint">
          شماره و تاریخِ صدور ({faDate(initial.createdAt)}) ثابت می‌مانند — سندِ اداری شماره‌اش عوض نمی‌شود.
        </p>
      )}

      <label className="lt-field"><span>گیرنده (به:)</span>
        <input value={f.recipient} onChange={set('recipient')} placeholder="مثلاً مدیریتِ محترمِ بیمارستانِ …" />
      </label>
      <label className="lt-field"><span>موضوع</span>
        <input value={f.subject} onChange={set('subject')} placeholder="موضوعِ نامه" />
      </label>
      <label className="lt-field"><span>متنِ نامه</span>
        <AssistedTextarea disabled={busy} value={f.body} onChange={set('body')} rows="10" placeholder="با سلام و احترام؛&#10;…" />
      </label>
      <label className="lt-field"><span>پیوست (اختیاری)</span>
        <input value={f.attachment} onChange={set('attachment')} placeholder="مثلاً «تصویرِ قرارداد» — خالی یعنی ندارد" />
      </label>

      <div className="lt-actions">
        {editing && !askDel && (
          <button type="button" className="lt-del" disabled={busy} onClick={() => setAskDel(true)}>
            <Trash width="14" height="14" /> حذف
          </button>
        )}
        {editing && askDel && (
          <span className="lt-delask">
            حذف شود؟
            <button type="button" disabled={busy} onClick={del}>بله</button>
            <button type="button" onClick={() => setAskDel(false)}>نه</button>
          </span>
        )}
        {editing && (
          <button type="button" className="lt-ghost" disabled={busy} onClick={() => onPrint({ ...initial, ...f })}>
            <Print width="14" height="14" /> چاپ
          </button>
        )}
        <button type="submit" className="lt-save" disabled={busy}>
          {busy ? 'در حال ذخیره…' : editing ? 'ذخیرهٔ تغییرات' : 'صدورِ نامه'}
        </button>
      </div>
    </Overlay>
  );
}
