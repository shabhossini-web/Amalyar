import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { faDate, jStrToIso, toEnDigits } from '../lib/jalali.js';
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

  const inStock = rows.filter((r) => r.quantity > 0).length;
  const expiredCount = rows.filter((r) => r.expired && r.quantity > 0).length;

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

      <div className="iv-stats">
        <div><b>{num(rows.length)}</b><span>لات</span></div>
        <div><b>{num(inStock)}</b><span>دارای موجودی</span></div>
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
            <div className="iv-qty">
              <b>{num(lot.quantity)}</b>
              <span>{lot.unit}</span>
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
          <label className="iv-field"><span>تاریخِ انقضا (شمسی)</span>
            <input dir="ltr" inputMode="numeric" value={form.expiresJ} onChange={set('expiresJ')} placeholder="۱۴۰۶/۰۷/۳۰" />
          </label>
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
