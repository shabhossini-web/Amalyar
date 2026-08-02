import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { faDate, jStr, jStrToIso, jToday, toEnDigits } from '../lib/jalali.js';
import JDate from './JDate.jsx';
import './inventory.css';
import { Back, Close, Plus, Route } from '../ui/icons.jsx';


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
        <button type="button" className={tab === 'assets' ? 'on' : ''} onClick={() => setTab('assets')}>دارایی‌ها</button>
      </div>

      {tab === 'assets' ? (
        <Assets onToast={setToast} />
      ) : tab === 'transfers' ? (
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
const STATE_TONE = { free: 'ok', booked: 'warn', out: 'out', service: 'bad', consigned: 'consign' };
const COUNT_TONE = { overdue: 'bad', due_soon: 'warn', ok: 'ok', none: '' };

/**
 * دارایی‌های برگشتی — ست و دستگاه.
 *
 * جدا از تبِ «لات‌ها» است چون سؤالش فرق می‌کند: آن‌جا «چند تا داریم»، این‌جا
 * «این دستگاه فلان روز آزاد است؟». همان دلیلی که تقویمِ چینش از فهرستِ
 * مراجعات جدا شد.
 */
function Assets({ onToast }) {
  const [day, setDay] = useState(() => jStr(...jToday()));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [needsFor, setNeedsFor] = useState(null); // بیمارستانِ بازشده
  const [consignFor, setConsignFor] = useState(null); // لاتِ در حالِ سپردن
  const [showConsigned, setShowConsigned] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const iso = jStrToIso(day);
      setRows(await api(`/assets${iso ? `?on=${iso}` : ''}`));
    } catch (e) { onToast(e.message); setRows([]); }
    finally { setLoading(false); }
  }, [day, onToast]);
  useEffect(() => { load(); }, [load]);

  const counts = rows.reduce((a, r) => ({ ...a, [r.state]: (a[r.state] ?? 0) + 1 }), {});

  return (
    <>
      <div className="iv-stats">
        <div><b>{num(rows.length)}</b><span>داراییِ برگشتی</span></div>
        <div><b>{num(counts.free ?? 0)}</b><span>آزاد</span></div>
        <div className={counts.booked ? 'iv-warn' : ''}><b>{num(counts.booked ?? 0)}</b><span>رزروِ همین روز</span></div>
        <div className={counts.out || counts.service ? 'iv-warn' : ''}>
          <b>{num((counts.out ?? 0) + (counts.service ?? 0))}</b><span>بیرون یا نیازمندِ سرویس</span>
        </div>
        <div><b>{num(counts.consigned ?? 0)}</b><span>امانیِ مستقر</span></div>
      </div>

      <div className="iv-toolbar">
        <JDate label="وضعیت در تاریخِ" value={day} onChange={setDay} className="iv-daypick" />
        <p className="iv-note">
          «آزاد» یعنی همین روز تعهدی ندارد. ستی که بیرون است موجود هست ولی در دسترس نیست.
        </p>
        <button type="button" className="iv-ghost" onClick={() => setShowConsigned(true)}>امانی‌ها</button>
        <button type="button" className="iv-add" onClick={() => setNeedsFor(0)}>نیازِ بیمارستان‌ها</button>
      </div>

      <div className="iv-list">
        {loading && <div className="iv-empty">در حال بارگذاری…</div>}
        {!loading && rows.length === 0 && (
          <div className="iv-empty">
            هنوز داراییِ برگشتی ندارید — در تعاریفِ پایه نوعِ کالا را «ست» یا «دستگاه» بگذارید.
          </div>
        )}
        {!loading && rows.map((r) => (
          <article key={r.lotId} className={`iv-row as-${r.state}`}>
            <div className="iv-row-main">
              <b>
                {r.itemName}
                <i className="as-kind">{r.assetLabel}</i>
                {r.serialNo && <i className="as-sn" dir="ltr">{r.serialNo}</i>}
              </b>
              <small>
                {r.consignedToId
                  ? `امانیِ ${r.consignedToName}`
                  : r.state === 'out' ? `الان در: ${r.at}` : `محلِ خانه: ${r.home}`}
                {r.nextServiceAt && ` · سرویسِ بعدی: ${faDate(r.nextServiceAt)}`}
                {r.turnaroundHours ? ` · آماده‌سازی: ${num(r.turnaroundHours)} ساعت` : ''}
              </small>
              {r.consignedToId && (
                <small className={`as-count ${COUNT_TONE[r.countStatus] ?? ''}`}>
                  {r.lastCountAt ? `آخرین صورت‌برداری: ${faDate(r.lastCountAt)}` : 'هنوز صورت‌برداری نشده'}
                  {r.countDueAt ? ` · سررسید: ${faDate(r.countDueAt)} (${r.countStatusLabel})` : ' · دوره‌ای تعریف نشده'}
                </small>
              )}
              {r.commitments.length > 0 && (
                <small className="as-book">
                  {r.commitments.map((c) => `${faDate(c.on)} — ${c.hospital}${c.visitCode ? ` (${c.visitCode})` : ''}`).join(' · ')}
                </small>
              )}
            </div>
            <div className="as-actions">
              <span className={`as-state ${STATE_TONE[r.state] ?? ''}`}>{r.stateLabel}</span>
              <button type="button" className="iv-ghost sm" onClick={() => setConsignFor(r)}>
                {r.consignedToId ? 'امانت' : 'سپردن'}
              </button>
            </div>
          </article>
        ))}
      </div>

      {needsFor !== null && <Needs onClose={() => setNeedsFor(null)} onToast={onToast} />}
      {consignFor && (
        <Consign row={consignFor} onClose={() => setConsignFor(null)} onToast={onToast} onDone={load} />
      )}
      {showConsigned && <Consignments onClose={() => setShowConsigned(false)} onToast={onToast} onDone={load} />}
    </>
  );
}

/**
 * سپردنِ یک دارایی به بیمارستان.
 *
 * ⚠️ «امانی» جابه‌جایی نیست، **اعلامِ وضعیت** است: می‌گوید بیرون‌بودنِ این
 * دستگاه خواسته است، پس نه در صفِ جمع‌آوری بیاید نه هر روز در فهرستِ بیرون.
 */
function Consign({ row, onClose, onToast, onDone }) {
  const [hospitals, setHospitals] = useState([]);
  const [hid, setHid] = useState(row.consignedToId ? String(row.consignedToId) : '');
  const [every, setEvery] = useState(row.countEveryDays ? String(row.countEveryDays) : '30');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api('/hospitals').then(setHospitals).catch(() => {}); }, []);

  const save = async () => {
    if (!hid || busy) return;
    setBusy(true);
    try {
      await api(`/assets/lots/${row.lotId}/consign`, {
        method: 'POST',
        body: { hospitalId: Number(hid), countEveryDays: int(every) || undefined },
      });
      onToast('امانت ثبت شد');
      await onDone(); onClose();
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  const end = async () => {
    setBusy(true);
    try {
      await api(`/assets/lots/${row.lotId}/consign`, { method: 'DELETE' });
      onToast('امانت پایان یافت');
      await onDone(); onClose();
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="iv-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="iv-sheet sm">
        <header className="iv-sheet-head">
          <b>امانیِ مستقر — {row.itemName}</b>
          <button type="button" className="iv-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
        </header>
        <div className="iv-sheet-body">
          <p className="iv-note">
            دستگاهی که در بیمارستان مستقر است «بیرون» نیست، آن‌جا زندگی می‌کند. با ثبتِ امانت،
            از صفِ جمع‌آوری خارج می‌شود و به‌جایش سررسیدِ صورت‌برداری می‌گیرد.
          </p>
          <label className="iv-field">
            <span>بیمارستان</span>
            <select value={hid} onChange={(e) => setHid(e.target.value)}>
              <option value="">— انتخاب کنید —</option>
              {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
          <label className="iv-field">
            <span>دورهٔ صورت‌برداری (روز)</span>
            <input type="text" inputMode="numeric" dir="ltr" value={every} onChange={(e) => setEvery(e.target.value)} />
          </label>
          <div className="iv-row2">
            <button type="button" className="iv-add" disabled={busy || !hid} onClick={save}>ثبتِ امانت</button>
            {row.consignedToId && (
              <button type="button" className="iv-del" disabled={busy} onClick={end}>پایانِ امانت</button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/** فهرستِ امانی‌ها با سررسید + صورت‌برداری. */
function Consignments({ onClose, onToast, onDone }) {
  const [data, setData] = useState(null);
  const [countFor, setCountFor] = useState(null);

  const load = useCallback(async () => {
    try { setData(await api('/assets/consignments')); }
    catch (e) { onToast(e.message); }
  }, [onToast]);
  useEffect(() => { load(); }, [load]);

  const rows = data?.rows ?? [];
  return (
    <div className="iv-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="iv-sheet">
        <header className="iv-sheet-head">
          <b>داراییِ امانیِ مستقر{data?.overdue ? ` — ${num(data.overdue)} عقب‌افتاده` : ''}</b>
          <button type="button" className="iv-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
        </header>
        <div className="iv-sheet-body">
          <p className="iv-note">
            امانیِ بدونِ شمارشِ دوره‌ای یعنی موجودیِ کاغذی: مصرف‌شده‌ها فاکتور نمی‌شوند و کسری سال‌ها بعد پیدا می‌شود.
          </p>
          <div className="iv-list">
            {rows.length === 0 && <div className="iv-empty">هنوز داراییِ امانی ثبت نشده</div>}
            {rows.map((r) => (
              <article key={r.lotId} className={`iv-row as-count-${r.status}`}>
                <div className="iv-row-main">
                  <b>
                    {r.itemName}
                    {r.serialNo && <i className="as-sn" dir="ltr">{r.serialNo}</i>}
                  </b>
                  <small>{r.hospitalName} · از {faDate(r.consignedAt)}</small>
                  <small className={`as-count ${COUNT_TONE[r.status] ?? ''}`}>
                    {r.lastCountAt ? `آخرین شمارش: ${faDate(r.lastCountAt)}` : 'هنوز شمرده نشده'}
                    {r.dueAt ? ` · سررسید: ${faDate(r.dueAt)}` : ''}
                    {r.lastCount ? ` · مصرف ${num(r.lastCount.used)} / کسری ${num(r.lastCount.missing)}` : ''}
                  </small>
                </div>
                <div className="as-actions">
                  <span className={`as-state ${COUNT_TONE[r.status] ?? ''}`}>{r.statusLabel}</span>
                  <button type="button" className="iv-ghost sm" onClick={() => setCountFor(r)}>صورت‌برداری</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      {countFor && (
        <CountSheet
          row={countFor}
          onClose={() => setCountFor(null)}
          onToast={onToast}
          onDone={async () => { await load(); await onDone(); }}
        />
      )}
    </div>
  );
}

/**
 * برگهٔ صورت‌برداری.
 *
 * ⚠️ سه ستون دارد نه دو: انتظار، شمرده‌شده، و «چند تا از کسری مصرف شد».
 * تفاوتِ مصرف و گم تفاوتِ فاکتورِ فروش با زیانِ شرکت است.
 */
function CountSheet({ row, onClose, onToast, onDone }) {
  const [sheet, setSheet] = useState(null);
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState([]);

  useEffect(() => {
    api(`/assets/lots/${row.lotId}/count-sheet`).then((d) => { setSheet(d); setLines(d.lines.map((l) => ({ ...l }))); }).catch((e) => onToast(e.message));
    api(`/assets/lots/${row.lotId}/counts`).then((d) => setHist(d.rows)).catch(() => {});
  }, [row.lotId, onToast]);

  const setCell = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await api(`/assets/lots/${row.lotId}/counts`, {
        method: 'POST',
        body: {
          lines: lines.map((l) => ({
            label: l.label,
            expected: int(l.expected) || 0,
            counted: int(l.counted) || 0,
            used: int(l.used) || 0,
          })),
        },
      });
      setHist(d.rows);
      onToast('صورت‌برداری ثبت شد');
      await onDone();
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  const totals = lines.reduce((a, l) => {
    const short = Math.max(0, (int(l.expected) || 0) - (int(l.counted) || 0));
    const used = Math.min(int(l.used) || 0, short);
    return { short: a.short + short, used: a.used + used, missing: a.missing + (short - used) };
  }, { short: 0, used: 0, missing: 0 });

  return (
    <div className="iv-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="iv-sheet">
        <header className="iv-sheet-head">
          <b>صورت‌برداری — {row.itemName} · {row.hospitalName}</b>
          <button type="button" className="iv-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
        </header>
        <div className="iv-sheet-body">
          {!sheet && <div className="iv-empty">در حال بارگذاری…</div>}
          {sheet && sheet.lines.length === 0 && (
            <div className="iv-empty">
              محتویاتِ این ست تعریف نشده — در تعاریفِ پایه «محتویاتِ ست» را پر کنید تا برگهٔ شمارش ساخته شود.
            </div>
          )}
          {sheet && lines.length > 0 && (
            <>
              <div className="as-count-grid">
                <div className="as-count-head"><span>قلم</span><span>انتظار</span><span>شمرده</span><span>مصرف</span><span>کسری</span></div>
                {lines.map((l, i) => {
                  const short = Math.max(0, (int(l.expected) || 0) - (int(l.counted) || 0));
                  const used = Math.min(int(l.used) || 0, short);
                  return (
                    <div key={l.label} className="as-count-row">
                      <span>{l.label}</span>
                      <input type="text" inputMode="numeric" dir="ltr" value={l.expected}
                        onChange={(e) => setCell(i, 'expected', e.target.value)} />
                      <input type="text" inputMode="numeric" dir="ltr" value={l.counted}
                        onChange={(e) => setCell(i, 'counted', e.target.value)} />
                      <input type="text" inputMode="numeric" dir="ltr" value={l.used}
                        onChange={(e) => setCell(i, 'used', e.target.value)} />
                      <span className={short - used > 0 ? 'as-miss' : ''}>{num(short - used)}</span>
                    </div>
                  );
                })}
              </div>
              <p className="iv-note">
                جمع: {num(totals.used)} مصرف (قابلِ فاکتور) · {num(totals.missing)} کسری
              </p>
              <button type="button" className="iv-add" disabled={busy} onClick={save}>ثبتِ صورت‌برداری</button>
            </>
          )}

          {hist.length > 0 && (
            <div className="iv-list">
              {hist.map((h) => (
                <article key={h.id} className="iv-row">
                  <div className="iv-row-main">
                    <b>{faDate(h.countedAt)}</b>
                    <small>
                      انتظار {num(h.totals.expected)} · شمرده {num(h.totals.counted)} ·
                      مصرف {num(h.totals.used)} · کسری {num(h.totals.missing)}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/** نیازِ استانداردِ هر بیمارستان — «لقمان همیشه دستگاهِ C2 می‌خواهد». */
function Needs({ onClose, onToast }) {
  const [hospitals, setHospitals] = useState([]);
  const [items, setItems] = useState([]);
  const [hid, setHid] = useState('');
  const [rows, setRows] = useState([]);
  const [pick, setPick] = useState('');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/hospitals').then(setHospitals).catch(() => {});
    api('/items').then(setItems).catch(() => {});
  }, []);

  const load = useCallback(async (id) => {
    if (!id) { setRows([]); return; }
    try { setRows(await api(`/assets/hospitals/${id}/needs`)); }
    catch (e) { onToast(e.message); }
  }, [onToast]);
  useEffect(() => { load(hid); }, [load, hid]);

  const add = async () => {
    if (!hid || !pick || busy) return;
    setBusy(true);
    try {
      await api(`/assets/hospitals/${hid}/needs`, { method: 'POST', body: { itemId: Number(pick), quantity: int(qty) || 1 } });
      setPick(''); setQty('1');
      await load(hid);
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  const remove = async (id) => {
    setBusy(true);
    try { await api(`/assets/needs/${id}`, { method: 'DELETE' }); await load(hid); }
    catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="iv-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="iv-sheet">
        <header className="iv-sheet-head">
          <b>نیازِ استانداردِ بیمارستان</b>
          <button type="button" className="iv-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
        </header>
        <div className="iv-sheet-body">
          <p className="iv-note">
            پیشنهادِ پیش‌فرضِ حواله برای این بیمارستان. الزام نیست — عملِ خاص می‌تواند چیزِ دیگری بخواهد.
          </p>
          <label className="iv-field">
            <span>بیمارستان</span>
            <select value={hid} onChange={(e) => setHid(e.target.value)}>
              <option value="">— انتخاب کنید —</option>
              {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>

          {hid && (
            <>
              <div className="iv-list">
                {rows.length === 0 && <div className="iv-empty">هنوز چیزی برای این بیمارستان تعریف نشده</div>}
                {rows.map((r) => (
                  <article key={r.id} className="iv-row">
                    <div className="iv-row-main">
                      <b>{r.itemName} <i className="as-kind">{r.assetLabel}</i></b>
                      <small>{num(r.quantity)} عدد{r.notes ? ` · ${r.notes}` : ''}</small>
                    </div>
                    <button type="button" className="iv-del" disabled={busy} onClick={() => remove(r.id)}>حذف</button>
                  </article>
                ))}
              </div>

              <div className="iv-row2">
                <label className="iv-field">
                  <span>کالا</span>
                  <select value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">— انتخاب —</option>
                    {items.map((i) => <option key={i.id} value={i.id}>{[i.name, i.size].filter(Boolean).join(' ')}</option>)}
                  </select>
                </label>
                <label className="iv-field">
                  <span>تعداد</span>
                  <input type="text" inputMode="numeric" dir="ltr" value={qty} onChange={(e) => setQty(e.target.value)} />
                </label>
                <button type="button" className="iv-add" disabled={busy || !pick} onClick={add}>
                  <Plus width="15" height="15" /> افزودن
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

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
  const [rel, setRel] = useState('');
  const [check, setCheck] = useState(null);
  const [miss, setMiss] = useState({});
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

  /** فراخوانِ مشترکِ کنش‌های حواله. `method` و `sink` برای کنش‌هایی که پاسخشان
      چک‌لیستِ برگشت است، نه خودِ حواله. */
  const act = async (path, body, msg, method = 'POST', sink) => {
    setBusy(true);
    try {
      const res = await api(path, { method, body });
      if (sink) sink(res); else { await load(); }
      onChanged(msg);
    } catch (e) { onError(e.message); } finally { setBusy(false); }
  };

  // چک‌لیستِ برگشت جدا بارگذاری می‌شود: فقط برای حواله‌ای که داراییِ برگشتی دارد.
  useEffect(() => {
    if (!t || t.status === 'planned') { setCheck(null); return; }
    api(`/assets/transfers/${id}/return-check`).then(setCheck).catch(() => setCheck(null));
  }, [t, id]);

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

          {/* اعلامِ پایانیِ کارشناس — دفتر نمی‌داند عمل کِی واقعاً تمام شد؛
              همین رویداد هم دارایی را آزاد می‌کند هم صفِ جمع‌آوری را می‌سازد. */}
          {t.status !== 'planned' && t.status !== 'closed' && (
            t.releasedAt ? (
              <p className="iv-note ok">
                کارشناس پایان را اعلام کرد — {faDate(t.releasedAt)}
                {t.releaseNote ? ` · ${t.releaseNote}` : ''} · آمادهٔ جمع‌آوری
              </p>
            ) : (
              <label className="iv-field"><span>پایانِ عمل — آمادهٔ جمع‌آوری</span>
                <input value={rel} onChange={(e) => setRel(e.target.value)} placeholder="یادداشت (اختیاری)" />
                <button type="button" className="iv-mini" disabled={busy}
                        onClick={() => act(`/stock/transfers/${id}/release`, { note: rel.trim() }, 'پایانِ عمل اعلام شد ✓')}>
                  اعلامِ پایان
                </button>
              </label>
            )
          )}

          {/* چک‌لیستِ برگشت — فقط **کسری** ثبت می‌شود نه کلِ شمارش. ثبتِ ۲۰
              ردیفِ «سالم» یعنی هیچ‌کس این کار را نمی‌کند. */}
          {check && check.lots.length > 0 && (
            <div className="iv-check">
              <b>محتویاتِ ست هنگام برگشت</b>
              {check.lots.map((l) => (
                <div key={l.lotId} className="iv-checklot">
                  <span className="iv-checkname">{l.itemName}{l.serialNo ? ` (${l.serialNo})` : ''}</span>
                  {l.contents.length === 0
                    ? <em className="iv-none">فهرستِ محتویات تعریف نشده — از تعاریفِ پایه ← کالاها اضافه کنید</em>
                    : <em className="iv-none">{num(l.contents.length)} قلم</em>}
                  {l.shortages.map((sh) => (
                    <span key={sh.id} className="iv-short">
                      {sh.label} × {num(sh.missing)}
                      <i>{sh.kind === 'damaged' ? 'آسیب‌دیده' : 'کسری'}</i>
                      <button type="button" disabled={busy}
                              onClick={() => act(`/assets/shortages/${sh.id}`, undefined, 'کسری حذف شد', 'DELETE', setCheck)}><Close size={12} /></button>
                    </span>
                  ))}
                  <div className="iv-row2">
                    <select value={miss[l.lotId] ?? ''} onChange={(e) => setMiss((m) => ({ ...m, [l.lotId]: e.target.value }))}>
                      <option value="">— قلمِ کسری —</option>
                      {l.contents.map((c) => <option key={c.label} value={c.label}>{c.label}</option>)}
                    </select>
                    <button type="button" className="iv-mini warn" disabled={busy || !miss[l.lotId]}
                            onClick={() => act(
                              `/assets/transfers/${id}/shortages`,
                              { lotId: l.lotId, label: miss[l.lotId], missing: 1 },
                              'کسری ثبت شد',
                              'POST',
                              setCheck,
                            )}>
                      ثبتِ کسری
                    </button>
                  </div>
                </div>
              ))}
            </div>
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
          <button type="button" className="iv-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
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
