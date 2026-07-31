import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { faDate, jStrToIso, toEnDigits } from '../lib/jalali.js';
import JDate from './JDate.jsx';
import './inventory.css';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Back = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5v6" /></svg>);
const Plus = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M12 5v14M5 12h14" /></svg>);
const XIc = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>);
const Route = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M8.5 19h5a4 4 0 0 0 0-8h-3a4 4 0 0 1 0-8h5" /></svg>);

const num = (n) => Number(n ?? 0).toLocaleString('fa-IR');
const money = (n) => (n == null ? '—' : `${Number(n).toLocaleString('fa-IR')} تومان`);
const int = (v) => {
  const digits = toEnDigits(String(v ?? '')).replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
};

const FILTERS = [
  { key: 'all', label: 'همه' },
  { key: 'stock', label: 'موجود' },
  { key: 'expiring', label: 'نزدیکِ انقضا' },
];

/**
 * انبار — لات و سریال.
 *
 * صفحه عمداً حولِ «لات» می‌چرخد نه «کالا»: کالا در تعاریفِ پایه است و آن‌چه
 * انباردار با آن کار می‌کند شیءِ فیزیکی است — این بچ، این سریال، این تاریخ.
 */
export default function Inventory() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState(null); // {lot, mode}
  const [tracing, setTracing] = useState(null);
  const [tab, setTab] = useState('lots');
  const [openTransfers, setOpenTransfers] = useState(0);

  useEffect(() => { document.title = 'عمل‌یار — انبار'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim().length >= 2) params.set('q', q.trim());
      if (filter === 'stock') params.set('inStock', '1');
      if (filter === 'expiring') params.set('expiringDays', '180');
      setRows(await api(`/stock/lots${params.toString() ? `?${params}` : ''}`));
    } catch (e) { setToast(e.message); setRows([]); }
    finally { setLoading(false); }
  }, [q, filter]);

  useEffect(() => {
    const t = setTimeout(load, q.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  /// شمارندهٔ حواله‌های باز روی تب — تا «ستی که برنگشته» فراموش نشود.
  useEffect(() => {
    api('/stock/transfers')
      .then((t) => setOpenTransfers(t.filter((x) => x.status !== 'closed').length))
      .catch(() => setOpenTransfers(0));
  }, [tab]);

  const inStock = rows.filter((r) => r.quantity > 0).length;
  const expiredCount = rows.filter((r) => r.expired && r.quantity > 0).length;
  const outCount = rows.reduce((s, r) => s + (r.outside?.reduce((a, o) => a + o.quantity, 0) ?? 0), 0);

  return (
    <div className="iv">
      <div className="iv-bg" aria-hidden="true" />
      <header className="iv-head">
        <Link to="/app" className="iv-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1>انبار</h1>
          <p>موجودی جمعِ دفترِ حرکت است — هر ورود و مصرف ردیفِ خودش را دارد و پاک نمی‌شود.</p>
        </div>
      </header>

      <div className="iv-tabs">
        <button type="button" className={tab === 'lots' ? 'on' : ''} onClick={() => setTab('lots')}>لات‌ها</button>
        <button type="button" className={tab === 'transfers' ? 'on' : ''} onClick={() => setTab('transfers')}>
          حواله‌ها{openTransfers ? <i>{num(openTransfers)}</i> : null}
        </button>
      </div>

      {tab === 'transfers' ? (
        <Transfers onToast={setToast} onChanged={load} />
      ) : (
      <>
      <div className="iv-stats">
        <div><b>{num(rows.length)}</b><span>لات</span></div>
        <div><b>{num(inStock)}</b><span>دارای موجودی</span></div>
        <div className={outCount ? 'iv-warn' : ''}><b>{num(outCount)}</b><span>بیرون از انبار</span></div>
        <div className={expiredCount ? 'iv-warn' : ''}><b>{num(expiredCount)}</b><span>منقضیِ موجود</span></div>
      </div>

      <div className="iv-toolbar">
        <input
          className="iv-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="جستجو: نامِ کالا، شمارهٔ لات، سریال یا محلِ نگه‌داری"
        />
        <div className="iv-filters">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={filter === f.key ? 'on' : ''} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <button type="button" className="iv-add" onClick={() => setAdding(true)}>
          <Plus width="16" height="16" /> لاتِ جدید
        </button>
      </div>

      <div className="iv-list">
        {loading && <div className="iv-empty">در حال بارگذاری…</div>}
        {!loading && rows.length === 0 && (
          <div className="iv-empty">
            {q.trim() || filter !== 'all' ? 'موردی با این فیلتر نیست' : 'هنوز لاتی ثبت نشده — با «لاتِ جدید» کالای رسیده را وارد کنید'}
          </div>
        )}
        {!loading && rows.map((lot) => (
          <article key={lot.id} className={`iv-row${lot.quantity <= 0 ? ' zero' : ''}${lot.expired ? ' exp' : ''}`}>
            {/* عددِ بزرگ «در دسترس» است نه «کل»: کالایی که در بیمارستان است
                موجود هست ولی نمی‌شود دوباره تعهدش کرد، و همین تفاوت است که
                چینشِ غلط می‌سازد. کل زیرش می‌آید، فقط وقتی فرق دارد. */}
            <div className="iv-qty">
              <b>{num(lot.available)}</b>
              <span>{lot.unit}</span>
              {lot.available !== lot.quantity && <i className="iv-oftotal">از {num(lot.quantity)}</i>}
            </div>
            <div className="iv-row-main">
              <b>{lot.itemName}{lot.itemSize ? ` — ${lot.itemSize}` : ''}</b>
              <small>
                {lot.serialNo
                  ? <>سریال <span dir="ltr">{lot.serialNo}</span></>
                  : lot.lotNo ? <>لات <span dir="ltr">{lot.lotNo}</span></> : 'بدونِ شمارهٔ لات'}
                {lot.itemBrand && ` · ${lot.itemBrand}`}
                {lot.location && ` · ${lot.location}`}
              </small>
              <small className="iv-sub2">
                {lot.expiresAt
                  ? <span className={lot.expired ? 'iv-expired' : ''}>{lot.expired ? 'منقضی: ' : 'انقضا: '}{faDate(lot.expiresAt)}</span>
                  : <span>بدونِ تاریخِ انقضا</span>}
                {lot.itemPrice != null && ` · ${money(lot.itemPrice)}`}
              </small>
              {lot.outside?.length > 0 && (
                <small className="iv-out">
                  {lot.outside.map((o) => (
                    <i key={o.location}>{o.location}: {num(o.quantity)}</i>
                  ))}
                </small>
              )}
            </div>
            <div className="iv-acts">
              <button type="button" onClick={() => setMoving({ lot, mode: 'in' })}>ورود</button>
              <button type="button" onClick={() => setMoving({ lot, mode: 'out' })} disabled={lot.quantity <= 0}>مصرف</button>
              <button type="button" onClick={() => setMoving({ lot, mode: 'adjust' })}>شمارش</button>
              <button type="button" className="iv-trace" title="ردیابی" onClick={() => setTracing(lot.id)}>
                <Route width="15" height="15" />
              </button>
            </div>
          </article>
        ))}
      </div>
      </>
      )}

      {adding && (
        <LotSheet
          onClose={() => setAdding(false)}
          onSaved={async (msg) => { setAdding(false); setToast(msg); await load(); }}
          onError={setToast}
        />
      )}
      {moving && (
        <MoveSheet
          lot={moving.lot}
          mode={moving.mode}
          onClose={() => setMoving(null)}
          onSaved={async (msg) => { setMoving(null); setToast(msg); await load(); }}
          onError={setToast}
        />
      )}
      {tracing && <TraceSheet lotId={tracing} onClose={() => setTracing(null)} onError={setToast} />}

      {toast && <div className="iv-toast" role="status">{toast}</div>}
    </div>
  );
}

/**
 * حواله‌ها — سفرِ ست به بیمارستان و برگشتش.
 *
 * چرخه: ارسال → رسیدِ CSR → مصرفِ سرِ عمل → برگشتِ مانده. تعدادِ برگشتی را
 * کاربر وارد نمی‌کند؛ از دفتر می‌آید. اگر کاربر عدد بزند، همان‌جاست که
 * «۳۴ تا فرستادم، ۳۳ تا زدم» به مغایرتِ دائمی تبدیل می‌شود.
 */
function Transfers({ onToast, onChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);   // شناسهٔ حوالهٔ بازشده
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api('/stock/transfers')); }
    catch (e) { onToast(e.message); setRows([]); }
    finally { setLoading(false); }
  }, [onToast]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="iv-toolbar">
        <p className="iv-note">
          ستی که به بیمارستان می‌رود از انبار کم نمی‌شود، ولی از «در دسترس» کم می‌شود.
        </p>
        <button type="button" className="iv-add" onClick={() => setSending(true)}>
          <Plus width="16" height="16" /> حوالهٔ جدید
        </button>
      </div>

      <div className="iv-list">
        {loading && <div className="iv-empty">در حال بارگذاری…</div>}
        {!loading && rows.length === 0 && (
          <div className="iv-empty">هنوز حواله‌ای صادر نشده — با «حوالهٔ جدید» ستِ ارسالی را ثبت کنید</div>
        )}
        {!loading && rows.map((t) => (
          <article key={t.id} className={`iv-row iv-tr st-${t.status}`}>
            <div className="iv-qty"><b dir="ltr">{t.code.replace('HV-', '')}</b><span>حواله</span></div>
            <div className="iv-row-main">
              <b>{t.toLocation}</b>
              <small>{t.fromLocation} ← {t.hospitalName || 'بدونِ بیمارستان'} · {num(t.lineCount)} قلم</small>
              <small className="iv-sub2">
                <span className={`iv-tag s-${t.status}`}>{t.statusLabel}</span>
                {' '}ارسال: {faDate(t.sentAt)}
                {t.receivedBy && ` · تحویل: ${t.receivedBy}`}
              </small>
            </div>
            <div className="iv-acts">
              <button type="button" onClick={() => setOpen(t.id)}>جزئیات</button>
            </div>
          </article>
        ))}
      </div>

      {sending && (
        <TransferSheet
          onClose={() => setSending(false)}
          onSaved={async (msg) => { setSending(false); onToast(msg); await load(); onChanged?.(); }}
          onError={onToast}
        />
      )}
      {open && (
        <TransferDetail
          id={open}
          onClose={() => setOpen(null)}
          onChanged={async (msg) => { onToast(msg); await load(); onChanged?.(); }}
          onError={onToast}
        />
      )}
    </>
  );
}

/** صدورِ حواله: مقصد + چند لات. لات‌ها فقط از موجودیِ **در دسترس** انتخاب می‌شوند. */
function TransferSheet({ onClose, onSaved, onError }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [lines, setLines] = useState([]); // [{lot, quantity}]
  const [form, setForm] = useState({ toLocation: '', hospitalId: '', notes: '' });
  const [hospitals, setHospitals] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api('/hospitals').then(setHospitals).catch(() => setHospitals([])); }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      api(`/stock/lots?q=${encodeURIComponent(q.trim())}&inStock=1`)
        .then((r) => { if (alive) setHits(r.filter((x) => x.available > 0 && !x.expired)); })
        .catch(() => { if (alive) setHits([]); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const add = (lot) => {
    setQ(''); setHits([]);
    if (lines.some((l) => l.lot.id === lot.id)) return;
    setLines((s) => [...s, { lot, quantity: String(lot.available) }]);
  };

  const submit = async () => {
    if (!form.toLocation.trim()) { onError('مقصد را وارد کنید'); return; }
    if (!lines.length) { onError('حداقل یک لات به حواله اضافه کنید'); return; }
    setBusy(true);
    try {
      const t = await api('/stock/transfers', {
        method: 'POST',
        body: {
          toLocation: form.toLocation.trim(),
          hospitalId: form.hospitalId ? Number(form.hospitalId) : undefined,
          notes: form.notes.trim() || undefined,
          lines: lines.map((l) => ({ lotId: l.lot.id, quantity: Number(toEnDigits(l.quantity)) || 0 })),
        },
      });
      onSaved(`حوالهٔ ${t.code} صادر شد ✓`);
    } catch (e) { onError(e.message); } finally { setBusy(false); }
  };

  return (
    <Overlay title="حوالهٔ جدید" onClose={onClose}>
      <label className="iv-field"><span>مقصد *</span>
        <input value={form.toLocation} onChange={(e) => setForm((s) => ({ ...s, toLocation: e.target.value }))}
               placeholder="مثلاً: بیمارستانِ رضوی — CSR" />
      </label>
      <label className="iv-field"><span>بیمارستان (اختیاری)</span>
        <select value={form.hospitalId} onChange={(e) => setForm((s) => ({ ...s, hospitalId: e.target.value }))}>
          <option value="">—</option>
          {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </label>

      <div className="iv-field">
        <span>افزودنِ لات</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="نامِ کالا، شمارهٔ لات یا سریال" />
        {hits.length > 0 && (
          <div className="iv-hits">
            {hits.map((l) => (
              <button key={l.id} type="button" onClick={() => add(l)}>
                <b>{num(l.available)}</b>
                <span>{l.itemName}{l.itemSize ? ` — ${l.itemSize}` : ''} · {l.serialNo || l.lotNo || `#${l.id}`}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {lines.length > 0 && (
        <div className="iv-lines">
          {lines.map((l, i) => (
            <div key={l.lot.id} className="iv-line">
              <span>{l.lot.itemName} · {l.lot.serialNo || l.lot.lotNo || `#${l.lot.id}`}</span>
              <input dir="ltr" inputMode="numeric" value={l.quantity}
                     onChange={(e) => setLines((s) => s.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
              <small>از {num(l.lot.available)}</small>
              <button type="button" onClick={() => setLines((s) => s.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
      )}

      <label className="iv-field"><span>یادداشت</span>
        <input value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} placeholder="مثلاً: ستِ فیوژن کمری" />
      </label>
      <Foot busy={busy} onClose={onClose} onSubmit={submit} label="صدور و ارسال" />
    </Overlay>
  );
}

/** جزئیاتِ حواله: چه رفت، چه مصرف شد، چه مانده — و دو عملِ رسید و برگشت. */
function TransferDetail({ id, onClose, onChanged, onError }) {
  const [t, setT] = useState(null);
  const [busy, setBusy] = useState(false);
  const [csr, setCsr] = useState('');
  const [used, setUsed] = useState({}); // lotId → مقدارِ در حالِ ویرایش

  const load = useCallback(async () => {
    try {
      const fresh = await api(`/stock/transfers/${id}`);
      setT(fresh);
      // ورودی‌ها با عددِ سرور هم‌گام می‌شوند تا پس از ثبت، مقدارِ قدیمی نماند.
      setUsed(Object.fromEntries(fresh.lines.map((l) => [l.lotId, String(l.used)])));
    } catch (e) { onError(e.message); onClose(); }
  }, [id, onError, onClose]);
  useEffect(() => { load(); }, [load]);

  const act = async (path, body, msg) => {
    setBusy(true);
    try {
      await api(path, { method: 'POST', body });
      await load(); onChanged(msg);
    } catch (e) { onError(e.message); } finally { setBusy(false); }
  };

  return (
    <Overlay title={t ? `حوالهٔ ${t.code}` : 'حواله'} onClose={onClose}>
      {!t ? <div className="iv-empty">در حال بارگذاری…</div> : (
        <>
          <div className="iv-trmeta">
            <div><b>{t.fromLocation}</b><span>مبدأ</span></div>
            <div><b>{t.toLocation}</b><span>مقصد</span></div>
            <div><b>{t.statusLabel}</b><span>وضعیت</span></div>
          </div>
          <div className="iv-stats iv-trtot">
            <div><b>{num(t.totals.sent)}</b><span>ارسال</span></div>
            <div><b>{num(t.totals.used)}</b><span>مصرف</span></div>
            <div className={t.totals.remaining ? 'iv-warn' : ''}><b>{num(t.totals.remaining)}</b><span>مانده در مقصد</span></div>
          </div>

          {/* برگهٔ مصرف — کاری که کارشناس سرِ عمل می‌کند. عدد «جمعِ مصرف‌شده»
              است نه «چقدر کم کن»؛ کارشناس وسطِ عمل حسابِ قبلی را نگه نمی‌دارد. */}
          <div className="iv-trlines">
            {t.lines.map((l) => (
              <div key={l.movementId} className="iv-trline">
                <b>{l.itemName}{l.itemSize ? ` — ${l.itemSize}` : ''}</b>
                <small dir="ltr">{l.serialNo || l.lotNo || `#${l.lotId}`}</small>
                {t.status === 'closed' ? (
                  <span>ارسال {num(l.sent)} · مصرف {num(l.used)} · مانده {num(l.remaining)}</span>
                ) : (
                  <div className="iv-uline">
                    <span>ارسال {num(l.sent)}</span>
                    <label>
                      مصرف شد
                      <input dir="ltr" inputMode="numeric"
                             value={used[l.lotId] ?? String(l.used)}
                             onChange={(e) => setUsed((s) => ({ ...s, [l.lotId]: e.target.value }))} />
                    </label>
                    <span className={l.remaining ? 'rem' : ''}>مانده {num(l.remaining)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {t.status !== 'closed' && (
            <button type="button" className="iv-usebtn" disabled={busy}
                    onClick={() => act(
                      `/stock/transfers/${id}/usage`,
                      { lines: t.lines.map((l) => ({ lotId: l.lotId, used: Number(toEnDigits(used[l.lotId] ?? String(l.used))) || 0 })) },
                      'برگهٔ مصرف ثبت شد ✓',
                    )}>
              ثبتِ برگهٔ مصرف
            </button>
          )}

          {t.receivedBy ? (
            <p className="iv-note">تحویلِ CSR: <b>{t.receivedBy}</b> — {faDate(t.receivedAt)}</p>
          ) : (
            <label className="iv-field"><span>رسیدِ تحویل به CSR</span>
              <input value={csr} onChange={(e) => setCsr(e.target.value)} placeholder="نامِ تحویل‌گیرنده" />
              <button type="button" className="iv-mini" disabled={busy}
                      onClick={() => act(`/stock/transfers/${id}/receive`, { receivedBy: csr.trim() }, 'رسیدِ CSR ثبت شد ✓')}>
                ثبتِ رسید
              </button>
            </label>
          )}

          <div className="iv-tracts">
            <button type="button" className="iv-mini" onClick={() => printTransfer(t)}>چاپِ حواله</button>
            {t.status !== 'closed' && (
              <button type="button" className="iv-mini warn" disabled={busy}
                      onClick={() => act(`/stock/transfers/${id}/return`, undefined, 'ماندهٔ حواله برگشت خورد ✓')}>
                برگشتِ مانده و بستنِ حواله
              </button>
            )}
          </div>
        </>
      )}
    </Overlay>
  );
}

/**
 * برگهٔ حواله — سندِ کاغذی که CSR امضا می‌کند.
 *
 * پنجرهٔ جدا با سندِ سفیدِ خودبسنده، به همان دلیلِ خروجیِ فهرستِ مراجعات: تمِ
 * تیره و شیشه‌ای برای چاپ باید یکی‌یکی بازنویسی شود و باز هم مرورگرها فرق دارند.
 */
function printTransfer(t) {
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = t.lines.map((l) => `<tr>
    <td>${esc(l.itemName)}${l.itemSize ? ` — ${esc(l.itemSize)}` : ''}</td>
    <td dir="ltr">${esc(l.serialNo || l.lotNo || '—')}</td>
    <td dir="ltr">${l.expiresAt ? esc(faDate(l.expiresAt)) : '—'}</td>
    <td class="n">${num(l.sent)}</td><td class="n">${num(l.used)}</td><td class="n">${num(l.remaining)}</td>
  </tr>`).join('');
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<title>حوالهٔ ${esc(t.code)}</title><style>
  @page { size: A4; margin: 14mm; }
  body { font-family: Vazirmatn, Tahoma, sans-serif; color: #111; font-size: 11pt; }
  h1 { font-size: 15pt; margin: 0 0 4px; }
  .meta { font-size: 10pt; line-height: 2; margin-block-end: 10px; }
  table { width: 100%; border-collapse: collapse; margin-block-end: 26px; }
  th, td { border: 1px solid #888; padding: 5px 7px; text-align: right; }
  th { background: #eee; }
  td.n { text-align: center; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sign { display: flex; gap: 40px; font-size: 10pt; }
  .sign div { flex: 1; border-top: 1px solid #333; padding-block-start: 6px; }
</style></head><body>
<h1>حوالهٔ ارسال — ${esc(t.code)}</h1>
<div class="meta">
  مبدأ: ${esc(t.fromLocation)} &nbsp;·&nbsp; مقصد: ${esc(t.toLocation)}<br>
  تاریخِ ارسال: ${esc(faDate(t.sentAt))}
  ${t.receivedBy ? ` &nbsp;·&nbsp; تحویل‌گیرندهٔ CSR: ${esc(t.receivedBy)} (${esc(faDate(t.receivedAt))})` : ''}
  ${t.notes ? `<br>${esc(t.notes)}` : ''}
</div>
<table><thead><tr><th>کالا</th><th>لات / سریال</th><th>انقضا</th><th>ارسال</th><th>مصرف</th><th>مانده</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="sign"><div>امضای تحویل‌دهنده</div><div>امضا و مهرِ تحویل‌گیرنده (CSR)</div></div>
</body></html>`);
  w.document.close(); w.focus();
  setTimeout(() => w.print(), 350);
}

/** ثبتِ لاتِ تازه‌رسیده. کالا از کاتالوگ انتخاب می‌شود — تایپِ آزاد نداریم. */
function LotSheet({ onClose, onSaved, onError }) {
  const [itemQ, setItemQ] = useState('');
  const [hits, setHits] = useState([]);
  const [item, setItem] = useState(null);
  const [form, setForm] = useState({ lotNo: '', serialNo: '', expiresJ: '', location: '', quantity: '1', reference: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (item || itemQ.trim().length < 2) { setHits([]); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      api(`/items?q=${encodeURIComponent(itemQ.trim())}`)
        .then((rows) => { if (alive) setHits(rows.filter((r) => r.active)); })
        .catch(() => { if (alive) setHits([]); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [itemQ, item]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (busy) return;
    if (!item) { onError('اول کالا را از کاتالوگ انتخاب کنید'); return; }
    let expiresAt;
    if (form.expiresJ.trim()) {
      expiresAt = jStrToIso(form.expiresJ);
      if (!expiresAt) { onError('تاریخِ انقضا نامعتبر است (مثال: ۱۴۰۶/۰۷/۳۰)'); return; }
    }
    setBusy(true);
    try {
      await api('/stock/lots', {
        method: 'POST',
        body: {
          itemId: item.id,
          lotNo: form.lotNo.trim() || undefined,
          serialNo: form.serialNo.trim() || undefined,
          location: form.location.trim() || undefined,
          reference: form.reference.trim() || undefined,
          quantity: int(form.quantity),
          expiresAt,
        },
      });
      await onSaved('لات ثبت شد ✓');
    } catch (e) { onError(e.message); } finally { setBusy(false); }
  };

  return (
    <Overlay onClose={() => !busy && onClose()} title="ثبتِ لاتِ جدید">
      <div className="iv-form">
        {/* ⚠️ div است نه label: در label، مرورگر کلیکِ روی نتیجه را به اولین
            کنترلِ داخلِ همان label می‌فرستد. با انتخابِ کالا، input جای خودش را
            به دکمهٔ «تغییر» می‌داد و همان کلیک بلافاصله انتخاب را پس می‌گرفت. */}
        <div className="iv-field iv-picker">
          <span>کالا *</span>
          {item ? (
            <div className="iv-picked">
              <b>{item.name}</b>
              <small>{[item.brand, item.size, item.sku].filter(Boolean).join(' · ')}</small>
              <button type="button" onClick={() => { setItem(null); setItemQ(''); }}>تغییر</button>
            </div>
          ) : (
            <>
              <input value={itemQ} onChange={(e) => setItemQ(e.target.value)} placeholder="نام، برند یا کدِ کالا" />
              {hits.length > 0 && (
                <div className="iv-hits">
                  {hits.map((it) => (
                    <button type="button" key={it.id} onClick={() => { setItem(it); setHits([]); }}>
                      <b>{it.name}</b>
                      <span>{[it.brand, it.size, it.sku].filter(Boolean).join(' · ')}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="iv-grid2">
          <label className="iv-field"><span>شمارهٔ لات</span>
            <input dir="ltr" value={form.lotNo} onChange={set('lotNo')} placeholder="A-4471" />
          </label>
          <label className="iv-field"><span>شمارهٔ سریال</span>
            <input dir="ltr" value={form.serialNo} onChange={set('serialNo')} placeholder="فقط اگر تک‌تک ردیابی می‌شود" />
          </label>
          <label className="iv-field"><span>تعداد</span>
            <input dir="ltr" inputMode="numeric" value={form.quantity} onChange={set('quantity')} />
          </label>
          <JDate className="iv-field" label="تاریخِ انقضا (شمسی)" value={form.expiresJ}
            onChange={(v) => setForm((s) => ({ ...s, expiresJ: v }))} placeholder="۱۴۰۶/۰۷/۳۰" />
          <label className="iv-field"><span>محلِ نگه‌داری</span>
            <input value={form.location} onChange={set('location')} placeholder="انبارِ مرکزی، ستِ ۲…" />
          </label>
          <label className="iv-field"><span>شمارهٔ رسید</span>
            <input dir="ltr" value={form.reference} onChange={set('reference')} placeholder="اختیاری" />
          </label>
        </div>
        <p className="iv-hint">
          سریال یعنی این قلم تک‌تک ردیابی می‌شود، پس چنین لاتی بیش از یک عدد نمی‌گیرد.
        </p>
      </div>
      <Foot busy={busy} onClose={onClose} onSubmit={submit} />
    </Overlay>
  );
}

const MOVE_META = {
  in: { title: 'ورودِ کالا', label: 'تعدادِ ورودی', path: 'receive', ok: 'ورود ثبت شد ✓' },
  out: { title: 'مصرف / خروج', label: 'تعدادِ مصرفی', path: 'consume', ok: 'مصرف ثبت شد ✓' },
  adjust: { title: 'اصلاحِ شمارش', label: 'چند عدد شمردید؟', path: 'adjust', ok: 'موجودی اصلاح شد ✓' },
};

function MoveSheet({ lot, mode, onClose, onSaved, onError }) {
  const meta = MOVE_META[mode];
  const [qty, setQty] = useState(mode === 'adjust' ? String(lot.quantity) : '1');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const n = int(qty);
    if (mode !== 'adjust' && n <= 0) { onError('تعداد را وارد کنید'); return; }
    setBusy(true);
    try {
      await api(`/stock/lots/${lot.id}/${meta.path}`, {
        method: 'POST',
        body: mode === 'adjust'
          ? { counted: n, reason: reason.trim() || undefined }
          : { quantity: n, reason: reason.trim() || undefined },
      });
      await onSaved(meta.ok);
    } catch (e) { onError(e.message); } finally { setBusy(false); }
  };

  return (
    <Overlay onClose={() => !busy && onClose()} title={meta.title}>
      <div className="iv-form">
        <div className="iv-lotcard">
          <b>{lot.itemName}</b>
          <small>
            {lot.serialNo ? <>سریال <span dir="ltr">{lot.serialNo}</span></> : lot.lotNo ? <>لات <span dir="ltr">{lot.lotNo}</span></> : '—'}
            {' · '}موجودیِ فعلی: {num(lot.quantity)} {lot.unit}
          </small>
        </div>
        <label className="iv-field"><span>{meta.label}</span>
          <input dir="ltr" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </label>
        <label className="iv-field"><span>توضیح</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === 'adjust' ? 'مثلاً: انبارگردانیِ تیر' : 'اختیاری'} />
        </label>
        {mode === 'adjust' && (
          <p className="iv-hint">عددِ شمرده‌شده را بنویسید، نه اختلاف را — اختلاف خودش حساب و در دفتر ثبت می‌شود.</p>
        )}
        {mode === 'out' && (
          <p className="iv-hint">
            مصرفِ حینِ عمل را از صورت‌حسابِ همان مراجعه ثبت کنید تا به بیمار گره بخورد؛ این‌جا برای ضایعات و خروجِ بدونِ عمل است.
          </p>
        )}
      </div>
      <Foot busy={busy} onClose={onClose} onSubmit={submit} label="ثبت" />
    </Overlay>
  );
}

/** ردیابی — «این لات کجا رفت». جهتِ عکسِ فاکتور و کلِ دلیلِ وجودِ دفتر. */
function TraceSheet({ lotId, onClose, onError }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api(`/stock/lots/${lotId}/trace`).then(setData).catch((e) => { onError(e.message); onClose(); });
  }, [lotId, onClose, onError]);

  return (
    <Overlay onClose={onClose} title="ردیابیِ لات">
      {!data ? <div className="iv-empty">در حال بارگذاری…</div> : (
        <div className="iv-form">
          <div className="iv-lotcard">
            <b>{data.lot.itemName}{data.lot.itemSize ? ` — ${data.lot.itemSize}` : ''}</b>
            <small>
              {data.lot.serialNo ? <>سریال <span dir="ltr">{data.lot.serialNo}</span></> : data.lot.lotNo ? <>لات <span dir="ltr">{data.lot.lotNo}</span></> : '—'}
              {' · '}موجودی: {num(data.lot.quantity)} {data.lot.unit}
              {data.lot.expiresAt && ` · انقضا ${faDate(data.lot.expiresAt)}`}
            </small>
          </div>

          {data.movements.length === 0 ? <div className="iv-empty">هنوز حرکتی ثبت نشده</div> : (
            <div className="iv-ledger">
              {data.movements.map((m) => (
                <div key={m.id} className={`iv-mv k-${m.kind}`}>
                  <span className="iv-mv-tag">{m.kindLabel}</span>
                  <div className="iv-mv-main">
                    <b>{m.quantity > 0 ? `+${num(m.quantity)}` : num(m.quantity)}</b>
                    {m.patient
                      ? <small>{m.patient.name} · <span dir="ltr">{m.visitCode}</span></small>
                      : m.visitCode
                        ? <small dir="ltr">{m.visitCode}</small>
                        : m.reason && <small>{m.reason}</small>}
                  </div>
                  <time>{faDate(m.createdAt)}</time>
                </div>
              ))}
            </div>
          )}
          <p className="iv-hint">
            اگر سازنده این لات را فراخوان بدهد، همین فهرست می‌گوید سراغِ کدام بیمارها باید رفت.
          </p>
        </div>
      )}
      <footer className="iv-foot"><button type="button" className="iv-ghost" onClick={onClose}>بستن</button></footer>
    </Overlay>
  );
}

function Overlay({ title, children, onClose }) {
  return (
    <div className="iv-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="iv-sheet">
        <header className="iv-sheet-head">
          <b>{title}</b>
          <button type="button" className="iv-x" onClick={onClose} aria-label="بستن"><XIc width="18" height="18" /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

function Foot({ busy, onClose, onSubmit, label = 'ذخیره' }) {
  return (
    <footer className="iv-foot">
      <button type="button" className="iv-ghost" onClick={onClose} disabled={busy}>انصراف</button>
      <button type="button" className="iv-save" onClick={onSubmit} disabled={busy}>{busy ? '…' : label}</button>
    </footer>
  );
}
