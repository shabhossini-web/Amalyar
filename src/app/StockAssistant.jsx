import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { jStrToIso } from '../lib/jalali.js';
import Overlay from '../ui/Overlay.jsx';
import { Boxes, Close, Plus, Sparkle, Tag, Trash } from '../ui/icons.jsx';

/**
 * دستیارِ انباردار (الف-۴، تأییدِ مالک ۱۴۰۵/۰۸/۱۷).
 *
 * سؤال → جواب از دادهٔ واقعیِ انبار؛ دستور («یه ست بساز با …») → **کارتِ پیش‌نویس**. هیچ چیزی بی‌«ثبت کن»ِ کاربر
 * نوشته نمی‌شود، و ثبت از همان مسیرهای عادیِ انبار می‌گذرد (`/stock/items`، `/stock/lots`، `/stock/sets/build`) —
 * یعنی همان مجوزها و همان سنجه‌ها. ترتیبِ ثبتِ همه: کالا ← موجودی ← ست، چون موجودی و ست ممکن است به کالایی ارجاع
 * دهند که همین پیام پیشنهاد کرده (`itemId` خالی، فقط نام).
 */
const HINTS = ['چند تا الکترود سوزنی آماده داریم؟', 'ستِ SE-01 کجاست و چه کم دارد؟', 'چه چیزی تا سه ماهِ دیگر منقضی می‌شود؟', 'یه ست بساز با ۲۰ سوزن و ۲ کابل'];
const KEY = 'amalyar.stockAssistant';
const num = (n) => Number(n ?? 0).toLocaleString('fa-IR');

export default function StockAssistant({ onClose, onChanged }) {
  const [msgs, setMsgs] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; }
  });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const end = useRef(null);

  useEffect(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))); } catch { /* ناشناس */ }
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [msgs, busy]);

  const ask = async (q) => {
    const content = (q ?? text).trim();
    if (!content || busy) return;
    const next = [...msgs, { role: 'user', content }];
    setMsgs(next); setText(''); setErr(''); setBusy(true);
    try {
      const r = await api('/stock/assistant', { method: 'POST', body: { messages: next.map(({ role, content: c }) => ({ role, content: c })) } });
      setMsgs((m) => [...m, { role: 'assistant', content: r.reply, actions: (r.actions ?? []).map((a, i) => ({ ...a, key: `${Date.now()}-${i}`, state: 'draft' })) }]);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const setAction = (mi, key, patch) => setMsgs((m) => m.map((x, i) => (i !== mi ? x : { ...x, actions: x.actions.map((a) => (a.key === key ? { ...a, ...patch } : a)) })));

  /** نامِ کالا → شناسه؛ فقط تطابقِ کامل (کالای اشتباه از نبودنش بدتر است). */
  const resolve = async (name) => {
    const rows = await api(`/stock/items?q=${encodeURIComponent(name)}`);
    const hit = rows.filter((r) => r.active && [r.name, [r.name, r.size].filter(Boolean).join(' ')].includes(name.trim()));
    if (hit.length !== 1) throw new Error(hit.length ? `«${name}» چند کالای هم‌نام دارد` : `«${name}» در کاتالوگ نیست — اول کالا را ثبت کنید`);
    return hit[0].id;
  };

  const exec = async (a) => {
    if (a.type === 'item') {
      await api('/stock/items', { method: 'POST', body: { name: a.name, assetKind: a.assetKind, usageMode: a.usageMode, unit: a.unit, brand: a.brand, size: a.size, showInTechPanel: !!a.showInTechPanel } });
      return `کالای «${a.name}» تعریف شد`;
    }
    if (a.type === 'stock') {
      const itemId = a.itemId ?? (await resolve(a.itemName));
      let expiresAt;
      if (a.expiresJ) { expiresAt = jStrToIso(a.expiresJ); if (!expiresAt) throw new Error(`تاریخِ انقضا نامعتبر است (${a.expiresJ})`); }
      await api('/stock/lots', { method: 'POST', body: { itemId, quantity: a.quantity, lotNo: a.lotNo, serialNo: a.serialNo, expiresAt } });
      return `${num(a.quantity)} ${a.itemName} وارد شد`;
    }
    const lines = [];
    for (const l of a.lines) lines.push({ partId: l.itemId ?? (await resolve(l.itemName)), quantity: l.quantity });
    const set = await api('/stock/sets/build', { method: 'POST', body: { name: a.name, lines } });
    return `ستِ ${set.serialNo} ساخته شد`;
  };

  const run = async (mi, a) => {
    setAction(mi, a.key, { state: 'busy', note: '' });
    try { const note = await exec(a); setAction(mi, a.key, { state: 'done', note }); onChanged?.(); }
    catch (e) { setAction(mi, a.key, { state: 'error', note: e.message }); }
  };
  const runAll = async (mi) => {
    const order = { item: 0, stock: 1, set: 2 };
    const list = [...msgs[mi].actions].filter((a) => a.state === 'draft' || a.state === 'error').sort((x, y) => order[x.type] - order[y.type]);
    for (const a of list) await run(mi, a); // eslint-disable-line no-await-in-loop -- ترتیب مهم است
  };

  return (
    <Overlay backdrop="iv-overlay" panel="iv-sheet sa" as="section" onClose={onClose}>
      <header className="iv-sheet-head">
        <b><Sparkle width="16" height="16" aria-hidden="true" /> دستیارِ انباردار</b>
        <button type="button" className="iv-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
      </header>
      <div className="sa-log" aria-live="polite">
        {msgs.length === 0 && (
          <div className="sa-intro">
            <p>از موجودی بپرسید یا بگویید چه بسازم. هیچ چیزی بی‌تأییدِ شما ثبت نمی‌شود: پیش‌نویس را می‌بینید و «ثبت کن» می‌زنید.</p>
            <div className="sa-hints">
              {HINTS.map((h) => <button type="button" key={h} onClick={() => ask(h)}>{h}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, mi) => (
          <div key={mi} className={`sa-msg ${m.role}`}>
            <p>{m.content}</p>
            {m.actions?.length > 0 && (
              <div className="sa-actions">
                {m.actions.map((a) => <ActionCard key={a.key} a={a} onRun={() => run(mi, a)} onDrop={() => setAction(mi, a.key, { state: 'dropped' })} />)}
                {m.actions.filter((a) => a.state === 'draft').length > 1 && (
                  <button type="button" className="iv-save sa-all" onClick={() => runAll(mi)}>ثبتِ همه به ترتیب</button>
                )}
              </div>
            )}
          </div>
        ))}
        <AnimatePresence>
          {busy && <motion.div className="sa-msg assistant sa-typing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>در حالِ بررسیِ انبار…</motion.div>}
        </AnimatePresence>
        {err && <p className="sa-err" role="alert">{err}</p>}
        <div ref={end} />
      </div>
      <form className="sa-input" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <textarea
          rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="بپرسید یا بنویسید چه کنم…" aria-label="پیام به دستیارِ انباردار"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
        />
        <div className="sa-row">
          {msgs.length > 0 && <button type="button" className="iv-ghost" onClick={() => { setMsgs([]); setErr(''); }} disabled={busy}>گفتگوی تازه</button>}
          <button type="submit" className="iv-save" disabled={busy || !text.trim()}>{busy ? '…' : 'بفرست'}</button>
        </div>
      </form>
    </Overlay>
  );
}

function ActionCard({ a, onRun, onDrop }) {
  if (a.state === 'dropped') return null;
  const Icon = a.type === 'set' ? Boxes : a.type === 'item' ? Tag : Plus;
  const title = a.type === 'item' ? 'تعریفِ کالا' : a.type === 'stock' ? 'ورودِ موجودی' : 'ساختِ ست';
  return (
    <article className={`sa-card ${a.state}`}>
      <header><Icon width="15" height="15" aria-hidden="true" /> <b>{title}</b></header>
      {a.type === 'item' && (
        <p><b>{a.name}</b> · {a.assetKind === 'device' ? 'دستگاه' : 'مصرفی'} · {a.usageMode === 'multi' ? 'چندبارمصرف' : 'یک‌بارمصرف'}{a.unit ? ` · ${a.unit}` : ''}{a.showInTechPanel ? ' · در پنلِ کارشناسی' : ''}</p>
      )}
      {a.type === 'stock' && (
        <p><b>{num(a.quantity)} × {a.itemName}</b>{a.lotNo ? <> · لات <bdi dir="ltr">{a.lotNo}</bdi></> : ''}{a.serialNo ? <> · سریال <bdi dir="ltr">{a.serialNo}</bdi></> : ''}{a.expiresJ ? ` · انقضا ${a.expiresJ}` : ''}{a.itemId ? '' : ' · (کالای تازه)'}</p>
      )}
      {a.type === 'set' && (
        <>
          <p><b>{a.name}</b> — شماره خودکار</p>
          <ul>{a.lines.map((l) => <li key={l.itemName}>{l.itemName}: {num(l.quantity)}</li>)}</ul>
        </>
      )}
      {a.note && <p className={a.state === 'error' ? 'sa-err' : 'sa-ok'} role={a.state === 'error' ? 'alert' : undefined}>{a.note}</p>}
      {a.state !== 'done' && (
        <footer>
          <button type="button" className="iv-ghost" onClick={onDrop} disabled={a.state === 'busy'} aria-label="کنار گذاشتنِ این پیش‌نویس"><Trash width="14" height="14" /></button>
          <button type="button" className="iv-save" onClick={onRun} disabled={a.state === 'busy'}>{a.state === 'busy' ? '…' : a.state === 'error' ? 'دوباره' : 'ثبت کن'}</button>
        </footer>
      )}
    </article>
  );
}

