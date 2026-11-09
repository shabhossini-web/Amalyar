import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { toEnDigits } from '../lib/jalali.js';
import { Trash } from '../ui/icons.jsx';

/**
 * «مصرفیِ پیش‌فرضِ هر بیمار» (ب-۳، مالک ۱۴۰۵/۰۸/۱۸) — در تعاریفِ پایه.
 *
 * یک فهرست برای کلِ خدمت (نورومانیتورینگ)، نه برای MEP/SEP جدا: «هر مریض یه مصرفیِ کلی می‌خوره». برگهٔ مصرفیِ
 * کارشناس و کاربرِ شرکت با همین عددها پر می‌شود و آن‌ها عددِ واقعی را اصلاح و ثبت می‌کنند؛ فهرستِ خالی یعنی
 * «پیش‌فرض ندارد» و برگه خالی باز می‌شود.
 */
const num = (n) => Number(n ?? 0).toLocaleString('fa-IR');
const int = (v) => { const d = toEnDigits(String(v ?? '')).replace(/[^0-9]/g, ''); return d ? Number(d) : 0; };

export default function UsageDefaults({ onToast }) {
  const [lines, setLines] = useState(null);
  const [legacy, setLegacy] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api('/stock/usage-defaults').then((d) => { setLines(d.lines ?? []); setLegacy(d.legacy ?? []); }).catch((e) => { onToast(e.message); setLines([]); });
    api('/stock/items').then((r) => setCatalog(r.filter((i) => i.active && i.assetKind === 'consumable'))).catch(() => {});
  }, [onToast]);

  const term = q.trim();
  const hits = term ? catalog.filter((p) => !(lines ?? []).some((l) => l.itemId === p.id) && [p.name, p.size, p.brand, p.sku].filter(Boolean).join(' ').includes(term)).slice(0, 8) : [];
  const change = (fn) => { setLines(fn); setDirty(true); };
  const save = async () => {
    if (lines.some((l) => !l.quantity)) { onToast('تعدادِ هر قلم باید دستِ‌کم ۱ باشد'); return; }
    setBusy(true);
    try {
      const d = await api('/stock/usage-defaults', { method: 'POST', body: { lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })) } });
      setLines(d.lines); setDirty(false); onToast('مصرفیِ پیش‌فرض ذخیره شد');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  return (
    <section className="df-usage" aria-labelledby="df-usage-h">
      <h2 id="df-usage-h">مصرفیِ پیش‌فرضِ هر بیمار</h2>
      <p className="df-note">برگهٔ مصرفیِ هر بیمار با همین عددها پر می‌شود؛ کارشناس یا کاربرِ شرکت عددِ واقعی را اصلاح و ثبت می‌کند. اگر فهرست خالی باشد، برگه خالی باز می‌شود و خودشان می‌زنند. تا «ثبت» زده نشود، چیزی از انبار کم نمی‌شود.</p>
      {lines === null ? <p className="df-note">در حالِ بارگذاری…</p> : (
        <>
          <div className="df-usage-list">
            {lines.length === 0 && <p className="df-empty">پیش‌فرضی تعریف نشده — برگه خالی باز می‌شود.</p>}
            {lines.map((l, i) => (
              <div key={l.itemId} className="df-usage-row">
                <b>{l.name}{l.active === false && <em> (غیرفعال)</em>}</b>
                <label className="df-usage-q"><span className="df-sr">تعدادِ {l.name}</span>
                  <input dir="ltr" inputMode="numeric" value={l.quantity || ''} onChange={(e) => change((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: int(e.target.value) } : x)))} />
                </label>
                <span className="df-usage-u">{l.unit}</span>
                <button type="button" className="df-usage-x" aria-label={`برداشتنِ ${l.name}`} onClick={() => change((ls) => ls.filter((_, j) => j !== i))}><Trash width="15" height="15" /></button>
              </div>
            ))}
          </div>
          <div className="pf-field df-usage-add">
            <span>افزودن از کاتالوگِ انبار</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="نامِ قلم: الکترود، سوزن، پد…" aria-label="جستجوی قلم برای پیش‌فرض" />
            {hits.length > 0 && (
              <div className="df-usage-hits">
                {hits.map((p) => (
                  <button type="button" key={p.id} onClick={() => { change((ls) => [...ls, { itemId: p.id, name: [p.name, p.size].filter(Boolean).join(' '), unit: p.unit, quantity: 1, active: true }]); setQ(''); }}>
                    <b>{[p.name, p.size].filter(Boolean).join(' ')}</b><span>{num(p.available)} {p.unit} در انبار</span>
                  </button>
                ))}
              </div>
            )}
            {term && hits.length === 0 && <em className="pf-hint">قلمِ مصرفی با «{term}» در کاتالوگِ انبار نیست.</em>}
          </div>
          {legacy.length > 0 && <p className="df-note">ردیف‌های قدیمیِ بی‌کالا ({legacy.join('، ')}) فقط در فاکتور می‌مانند و برگه را پر نمی‌کنند.</p>}
          <div className="df-toolbar">
            <button type="button" className="df-add" disabled={busy || !dirty} onClick={save}>{busy ? 'در حالِ ذخیره…' : 'ذخیره'}</button>
          </div>
        </>
      )}
    </section>
  );
}
