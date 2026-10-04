import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { faDate, jStr, jStrToIso, jToday, toEnDigits } from '../lib/jalali.js';
import JDate from './JDate.jsx';
import './inventory.css';
import { Alert, Box, Boxes, Close, Pencil, Plus, Route, Tag, Trash, Wave } from '../ui/icons.jsx';
import './users.css'; // کلیدِ دوحالتهٔ `us-switch` (قانونِ ۲۱: صریح ایمپورت)
import PageHeader from '../ui/PageHeader.jsx';
import Tabs from '../ui/Tabs.jsx';
import Overlay, { ConfirmDialog } from '../ui/Overlay.jsx';
import { useStagger } from '../ui/stagger.js';


const num = (n) => Number(n ?? 0).toLocaleString('fa-IR');
// «مصرفی» پیش‌فرض است و برچسب نمی‌خواهد — همان قرارداد صفحهٔ تعاریف.
const ASSET_FA = { set: 'ست', device: 'دستگاه' };
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
  const row = useStagger();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState(null); // {lot, mode}
  const [tracing, setTracing] = useState(null);
  /* پیوندِ مستقیم به یک تب (‎?tab=items از تعاریفِ پایه) — کالاها تبِ اول است (مالک، ۱۴۰۵/۰۷/۱۱). */
  const [tab, setTab] = useState(() => {
    const key = new URLSearchParams(window.location.search).get('tab');
    return ['items', 'lots', 'sets', 'transfers', 'assets'].includes(key) ? key : 'items';
  });
  const [openTransfers, setOpenTransfers] = useState(0);

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
      <PageHeader tool="inventory" sub="موجودی جمعِ دفترِ حرکت است — هر ورود و مصرف ردیفِ خودش را دارد و پاک نمی‌شود." />

      <Tabs
        label="بخش‌های انبار"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'items', label: 'کالاها', icon: Tag },
          { key: 'lots', label: 'لات‌ها', icon: Box },
          { key: 'sets', label: 'ست‌ها', icon: Boxes },
          { key: 'transfers', label: 'حواله‌ها', icon: Route, badge: openTransfers ? num(openTransfers) : null },
          { key: 'assets', label: 'دارایی‌ها', icon: Wave },
        ]}
      />

      {tab === 'items' ? (
        <Items onToast={setToast} />
      ) : tab === 'sets' ? (
        <Sets onToast={setToast} />
      ) : tab === 'assets' ? (
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
          aria-label="جستجو در انبار"
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
        {!loading && rows.map((lot, i) => (
          <motion.article key={lot.id} {...row(i)} className={`iv-row${lot.quantity <= 0 ? ' zero' : ''}${lot.expired ? ' exp' : ''}`}>
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
              <button type="button" onClick={() => setMoving({ lot, mode: 'damage' })} disabled={lot.available <= 0}>خرابی</button>
              <button type="button" className="iv-trace" title="ردیابی" onClick={() => setTracing(lot.id)}>
                <Route width="15" height="15" />
              </button>
            </div>
          </motion.article>
        ))}
      </div>
      </>
      )}

      <AnimatePresence>
        {adding && (
          <LotSheet
            onClose={() => setAdding(false)}
            onSaved={async (msg) => { setAdding(false); setToast(msg); await load(); }}
            onError={setToast}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {moving && (
          <MoveSheet
            lot={moving.lot}
            mode={moving.mode}
            onClose={() => setMoving(null)}
            onSaved={async (msg) => { setMoving(null); setToast(msg); await load(); }}
            onError={setToast}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {tracing && <TraceSheet lotId={tracing} onClose={() => setTracing(null)} onError={setToast} />}
      </AnimatePresence>

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

const KINDS = [
  { v: 'consumable', l: 'مصرفی — یک‌بار می‌رود' },
  { v: 'set', l: 'ست — برمی‌گردد' },
  { v: 'device', l: 'دستگاه — برمی‌گردد' },
];

/**
 * کالاها — کاتالوگ از نگاهِ انبار (مالک، ۱۴۰۵/۰۷/۱۱: «تعریفِ کالا را از تعاریفِ پایه ببر توی کاشیِ انبار»).
 *
 * همان جدولِ تعاریف است (تک‌منبع)؛ فقط درِ ورودش انبار شد تا انباردار (سطح ۳) بی‌دسترسیِ مدیریتی
 * کالا تعریف کند. دو تیکِ تازه: «نمایش در پنلِ کارشناسی» و «چندبارمصرف».
 */
function Items({ onToast }) {
  const row = useStagger();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | {} (تازه) | ردیف
  const [parts, setParts] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = q.trim().length >= 2 ? `?q=${encodeURIComponent(q.trim())}` : '';
      setRows(await api(`/stock/items${p}`));
    } catch (e) { onToast(e.message); setRows([]); }
    finally { setLoading(false); }
  }, [q, onToast]);
  useEffect(() => {
    const t = setTimeout(load, q.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const remove = async (it) => {
    setBusy(true);
    try {
      const r = await api(`/stock/items/${it.id}`, { method: 'DELETE' });
      onToast(r.deactivated ? `«${it.name}» به‌دلیلِ سابقهٔ استفاده فقط غیرفعال شد` : `«${it.name}» حذف شد`);
      await load();
    } catch (e) { onToast(e.message); }
    finally { setBusy(false); setDeleting(null); }
  };

  const returnable = rows.filter((r) => r.assetKind !== 'consumable').length;
  const inTech = rows.filter((r) => r.showInTechPanel).length;

  return (
    <>
      <div className="iv-stats">
        <div><b>{num(rows.length)}</b><span>کالا</span></div>
        <div><b>{num(returnable)}</b><span>ست و دستگاه</span></div>
        <div><b>{num(inTech)}</b><span>در پنلِ کارشناسی</span></div>
      </div>
      <div className="iv-toolbar">
        <input className="iv-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو: نام، برند، کد یا دسته" aria-label="جستجو در کالاها" />
        <button type="button" className="iv-add" onClick={() => setEditing({})}><Plus width="16" height="16" /> کالای جدید</button>
      </div>
      <p className="iv-note iv-tabnote">کاتالوگِ کالاست، نه موجودی. «نوع» می‌گوید برمی‌گردد یا نه؛ «چندبارمصرف» می‌گوید با مصرف از موجودی کم شود یا فقط دفعاتِ استفاده شمرده شود (و فقط با خرابی کم شود).</p>

      <div className="iv-list">
        {loading && <div className="iv-empty">در حال بارگذاری…</div>}
        {!loading && rows.length === 0 && (
          <div className="iv-empty">{q.trim() ? 'کالایی با این نام نیست' : 'هنوز کالایی تعریف نشده — با «کالای جدید» شروع کنید'}</div>
        )}
        {!loading && rows.map((it, i) => (
          <motion.article key={it.id} {...row(i)} className={`iv-row iv-item${it.active ? '' : ' zero'}`}>
            <div className="iv-qty"><b>{num(it.available)}</b><span>{it.unit}</span></div>
            <div className="iv-row-main">
              <b>{it.name}{it.size ? ` — ${it.size}` : ''}{!it.active && <i className="iv-off"> (غیرفعال)</i>}</b>
              <small>{[it.assetLabel, it.brand, it.sku, it.category].filter(Boolean).join(' · ')}</small>
              <small className="iv-sub2 iv-chips">
                <span className={`iv-chip${it.usageMode === 'multi' ? ' multi' : ''}`}>{it.usageLabel}</span>
                {it.showInTechPanel && <span className="iv-chip on">در پنلِ کارشناسی</span>}
                {it.assetKind !== 'consumable' && <span className="iv-chip">{num(it.contentCount)} قلم در قالب</span>}
                <span className="iv-chip">{num(it.lotCount)} لات</span>
              </small>
            </div>
            <div className="iv-acts">
              {it.assetKind !== 'consumable' && <button type="button" onClick={() => setParts(it)}>محتویات</button>}
              <button type="button" aria-label={`ویرایشِ ${it.name}`} onClick={() => setEditing(it)}><Pencil width="14" height="14" /></button>
              <button type="button" aria-label={`حذفِ ${it.name}`} className="iv-acts-del" onClick={() => setDeleting(it)}><Trash width="14" height="14" /></button>
            </div>
          </motion.article>
        ))}
      </div>

      <AnimatePresence>
        {editing && (
          <ItemSheet row={editing} onClose={() => setEditing(null)} onSaved={async (m) => { setEditing(null); onToast(m); await load(); }} onError={onToast} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {parts && <SetContents item={parts} onClose={() => setParts(null)} onToast={onToast} onChanged={load} />}
      </AnimatePresence>
      <AnimatePresence>
        {deleting && (
          <ConfirmDialog
            title={`حذفِ «${deleting.name}»؟`}
            text="اگر لات یا سندی با این کالا ثبت شده باشد پاک نمی‌شود و فقط غیرفعال می‌شود."
            busy={busy}
            onConfirm={() => remove(deleting)}
            onCancel={() => setDeleting(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/** فرمِ کالا — همان فیلدهای تعاریف + دو تیکِ تازه. */
function ItemSheet({ row, onClose, onSaved, onError }) {
  const isNew = !row.id;
  const [f, setF] = useState({
    name: row.name ?? '', assetKind: row.assetKind ?? 'consumable', brand: row.brand ?? '', size: row.size ?? '',
    category: row.category ?? '', sku: row.sku ?? '', irc: row.irc ?? '', unit: row.unit ?? 'عدد',
    price: row.price ?? '', turnaroundHours: row.turnaroundHours ?? '', notes: row.notes ?? '',
    showInTechPanel: !!row.showInTechPanel,
    usageMode: row.usageMode ?? (row.assetKind && row.assetKind !== 'consumable' ? 'multi' : 'single'),
  });
  const [busy, setBusy] = useState(false);
  const returnable = f.assetKind !== 'consumable';
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const txt = (v) => (String(v ?? '').trim() ? String(v).trim() : null);

  const submit = async () => {
    if (busy) return;
    if (f.name.trim().length < 2) { onError('نامِ کالا را کامل وارد کنید'); return; }
    setBusy(true);
    try {
      const body = {
        name: f.name.trim(), assetKind: f.assetKind, brand: txt(f.brand), size: txt(f.size), category: txt(f.category),
        sku: txt(f.sku), irc: txt(f.irc), unit: txt(f.unit) ?? 'عدد', notes: txt(f.notes),
        price: String(f.price).trim() === '' ? null : int(f.price),
        turnaroundHours: String(f.turnaroundHours).trim() === '' ? null : int(f.turnaroundHours),
        showInTechPanel: f.showInTechPanel,
        usageMode: returnable ? 'multi' : f.usageMode,
      };
      await api(isNew ? '/stock/items' : `/stock/items/${row.id}`, { method: isNew ? 'POST' : 'PATCH', body });
      await onSaved(isNew ? 'کالا تعریف شد' : 'کالا ویرایش شد');
    } catch (e) { onError(e.message); } finally { setBusy(false); }
  };

  return (
    <TitledSheet onClose={() => !busy && onClose()} title={isNew ? 'کالای جدید' : `ویرایشِ «${row.name}»`}>
      <div className="iv-form">
        <label className="iv-field"><span>نامِ کالا *</span>
          <input value={f.name} onChange={set('name')} autoFocus />
        </label>
        <div className="iv-grid2">
          <label className="iv-field"><span>نوع *</span>
            <select value={f.assetKind} onChange={set('assetKind')}>
              {KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
            </select>
          </label>
          <label className="iv-field"><span>واحد</span>
            <input value={f.unit} onChange={set('unit')} />
          </label>
        </div>

        {/* دو تیکِ مالک (۱۴۰۵/۰۷/۱۱) — کلیدِ دوحالتهٔ مشترکِ سامانه. کنارِ «نوع» نشسته‌اند چون به آن
            بسته‌اند: ست و دستگاه همیشه چندبارمصرف‌اند و این‌جا همان لحظه دیده می‌شود، نه تهِ فرم. */}
        <label className="us-switch iv-switch">
          <input type="checkbox" role="switch" checked={f.showInTechPanel} onChange={(e) => setF((s) => ({ ...s, showInTechPanel: e.target.checked }))} />
          <span className="us-track" aria-hidden="true" />
          <span className="iv-switch-t">نمایش در پنلِ کارشناسی<small>کارشناس این قلم را در بلوکِ «ثبتِ مصرفی» می‌بیند</small></span>
        </label>
        <label className="us-switch iv-switch">
          <input type="checkbox" role="switch" checked={returnable || f.usageMode === 'multi'} disabled={returnable}
                 onChange={(e) => setF((s) => ({ ...s, usageMode: e.target.checked ? 'multi' : 'single' }))} />
          <span className="us-track" aria-hidden="true" />
          <span className="iv-switch-t">چندبارمصرف
            <small>
              {returnable
                ? 'ست و دستگاه همیشه چندبارمصرف‌اند — با مصرف از موجودی کم نمی‌شوند'
                : f.usageMode === 'multi'
                  ? 'فقط دفعاتِ استفاده شمرده می‌شود؛ تنها با خرابی از موجودی کم می‌شود'
                  : 'یک‌بارمصرف: هر مصرف از موجودی کم می‌شود'}
            </small>
          </span>
        </label>

        <div className="iv-grid2">
          <label className="iv-field"><span>برند</span><input value={f.brand} onChange={set('brand')} /></label>
          <label className="iv-field"><span>اندازه / مشخصه</span><input value={f.size} onChange={set('size')} /></label>
          <label className="iv-field"><span>دسته (پیچ، راد، کیج…)</span><input value={f.category} onChange={set('category')} /></label>
          <label className="iv-field"><span>کدِ کالا (SKU)</span><input dir="ltr" value={f.sku} onChange={set('sku')} /></label>
          <label className="iv-field"><span>کد IRC</span><input dir="ltr" value={f.irc} onChange={set('irc')} /></label>
          <label className="iv-field"><span>قیمتِ پایه (تومان)</span><input dir="ltr" inputMode="numeric" value={f.price} onChange={set('price')} /></label>
          {returnable && (
            <label className="iv-field"><span>ساعتِ آماده‌سازی پس از برگشت</span><input dir="ltr" inputMode="numeric" value={f.turnaroundHours} onChange={set('turnaroundHours')} /></label>
          )}
        </div>

        <label className="iv-field"><span>یادداشت</span><input value={f.notes} onChange={set('notes')} /></label>
      </div>
      <Foot busy={busy} onClose={onClose} onSubmit={submit} />
    </TitledSheet>
  );
}

/**
 * قالبِ محتویاتِ یک ست — «ستِ SDN بیست الکترود و پنج سوزن دارد».
 *
 * قلمی که به یک کالای تعریف‌شده وصل شود **ردیابی** می‌شود (تبِ «ست‌ها» موجودیِ داخلِ ست را از
 * دفتر می‌خواند و تکمیل/خرابی دارد)؛ قلمِ فقط‌نام در شمارش می‌آید ولی موجودی ندارد.
 */
function SetContents({ item, onClose, onToast, onChanged }) {
  const [rows, setRows] = useState([]);
  const [items, setItems] = useState([]);
  const [label, setLabel] = useState('');
  const [partId, setPartId] = useState('');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await api(`/assets/items/${item.id}/contents`)); }
    catch (e) { onToast(e.message); }
  }, [item.id, onToast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api('/stock/items').then((r) => setItems(r.filter((i) => i.id !== item.id && i.active))).catch(() => {});
  }, [item.id]);

  const add = async () => {
    if (busy || (!label.trim() && !partId)) return;
    setBusy(true);
    try {
      await api(`/assets/items/${item.id}/contents`, {
        method: 'POST',
        body: { label: label.trim() || undefined, partId: partId ? Number(partId) : undefined, quantity: int(qty) || 1 },
      });
      setLabel(''); setPartId(''); setQty('1');
      await load(); onChanged?.();
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };
  const remove = async (id) => {
    setBusy(true);
    try { await api(`/assets/contents/${id}`, { method: 'DELETE' }); await load(); onChanged?.(); }
    catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  return (
    <TitledSheet onClose={() => !busy && onClose()} title={`محتویاتِ «${item.name}»`}>
      <div className="iv-form">
        <p className="iv-hint">این فهرست «استاندارد»ِ هر ستِ سریالیِ این کالاست: تبِ «ست‌ها» داخلِ ست را با آن می‌سنجد و کسری را حساب می‌کند. قلمی که به کالای تعریف‌شده وصل باشد قابلِ تکمیل از انبار است.</p>
        <div className="iv-list iv-parts">
          {rows.length === 0 && <div className="iv-empty">هنوز قلمی تعریف نشده</div>}
          {rows.map((r) => (
            <article key={r.id} className="iv-row sm">
              <div className="iv-row-main">
                <b>{r.label}</b>
                <small>{num(r.quantity)} عدد · {r.partId ? 'کالای تعریف‌شده — ردیابی می‌شود' : 'فقط نام — ردیابی نمی‌شود'}</small>
              </div>
              <button type="button" className="iv-del" disabled={busy} onClick={() => remove(r.id)}>حذف</button>
            </article>
          ))}
        </div>
        <div className="iv-grid2">
          <label className="iv-field"><span>از کالاهای تعریف‌شده</span>
            <select value={partId} onChange={(e) => { setPartId(e.target.value); if (e.target.value) setLabel(''); }} disabled={busy}>
              <option value="">— انتخاب —</option>
              {items.map((i) => <option key={i.id} value={i.id}>{[i.name, i.size].filter(Boolean).join(' ')}</option>)}
            </select>
          </label>
          <label className="iv-field"><span>یا عنوانِ دستی</span>
            <input value={label} disabled={busy || !!partId} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="iv-field"><span>تعداد در هر ست</span>
            <input inputMode="numeric" dir="ltr" value={qty} onChange={(e) => setQty(e.target.value)} disabled={busy} />
          </label>
        </div>
      </div>
      <Foot busy={busy || (!label.trim() && !partId)} onClose={onClose} onSubmit={add} label="افزودنِ قلم" />
    </TitledSheet>
  );
}

/**
 * ست‌ها — هر ستِ سریالی یک بستهٔ موجودی (مالک، ۱۴۰۵/۰۷/۱۱).
 *
 * «استاندارد» از قالب، «داخلِ ست» از دفتر، «کسری» حساب‌شده. تکمیل از انبار (FEFO)، خرابی به
 * «خرابی‌ها»، برداشت به انبار — همه حرکتِ دفتری. پایینِ صفحه «خرابی‌ها» است: اسقاط یا تعمیر.
 */
function Sets({ onToast }) {
  const row = useStagger();
  const [rows, setRows] = useState(null);
  const [damaged, setDamaged] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null); // شناسهٔ ستِ در حالِ تکمیل
  const [move, setMove] = useState(null); // { set, line, mode: 'damage' | 'withdraw' }
  const [decide, setDecide] = useState(null); // { row, mode: 'scrap' | 'repair' }
  const [report, setReport] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = q.trim().length >= 2 ? `?q=${encodeURIComponent(q.trim())}` : '';
      const [s, d] = await Promise.all([api(`/stock/sets${p}`), api('/stock/damaged')]);
      setRows(s); setDamaged(d);
    } catch (e) { onToast(e.message); setRows([]); }
  }, [q, onToast]);
  useEffect(() => {
    const t = setTimeout(load, q.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const fill = async (set) => {
    setBusy(set.lotId);
    try {
      const r = await api(`/stock/sets/${set.lotId}/fill`, { method: 'POST', body: {} });
      const got = r.filled.reduce((a, x) => a + x.quantity, 0);
      onToast(r.short.length
        ? `${num(got)} قلم تکمیل شد؛ انبار برای ${r.short.map((x) => `${x.label} (${num(x.missing)})`).join('، ')} کم دارد`
        : `${num(got)} قلم از انبار تکمیل شد`);
      await load();
    } catch (e) { onToast(e.message); } finally { setBusy(null); }
  };

  const total = rows ?? [];
  const incomplete = total.filter((s) => !s.totals.complete && s.totals.lines > 0).length;

  return (
    <>
      <div className="iv-stats">
        <div><b>{num(total.length)}</b><span>ستِ سریالی</span></div>
        <div className={incomplete ? 'iv-warn' : ''}><b>{num(incomplete)}</b><span>ناقص</span></div>
        <div className={damaged.length ? 'iv-warn' : ''}><b>{num(damaged.reduce((a, d) => a + d.quantity, 0))}</b><span>در خرابی‌ها</span></div>
      </div>
      <div className="iv-toolbar">
        <input className="iv-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو: سریال یا نامِ ست" aria-label="جستجو در ست‌ها" />
        <button type="button" className="iv-ghost" onClick={() => setReport(true)}>گزارشِ کسری</button>
      </div>
      <p className="iv-note iv-tabnote">فقط ستی که سریال دارد محتویاتِ ردیابی‌شده دارد: هر ست یک محل در دفترِ انبار است و قلمی که داخلِ آن است در انبار «در دسترس» نیست.</p>

      <div className="iv-list">
        {rows === null && <div className="iv-empty">در حال بارگذاری…</div>}
        {rows !== null && rows.length === 0 && (
          <div className="iv-empty">{q.trim() ? 'ستی با این نام نیست' : 'هنوز ستِ سریالی ثبت نشده — در تبِ «لات‌ها» برای کالای نوعِ «ست» لاتی با شمارهٔ سریال بسازید'}</div>
        )}
        {rows !== null && rows.map((s, i) => (
          <motion.article key={s.lotId} {...row(i)} className={`iv-set${s.totals.complete ? ' ok' : s.totals.shortage ? ' warn' : ''}`}>
            <header className="iv-set-head">
              <b><Boxes width="15" height="15" /> {s.itemName} <bdi dir="ltr">{s.serialNo}</bdi></b>
              <span className={`iv-tag ${s.totals.lines === 0 ? '' : s.totals.complete ? 's-closed' : 's-received'}`}>
                {s.totals.lines === 0 ? 'بی‌قالب' : s.totals.complete ? 'کامل' : `${num(s.totals.shortage)} کسری`}
              </span>
              <small>{s.consignedTo ? `امانیِ ${s.consignedTo}` : s.atHome ? 'در انبار' : `الان در: ${s.at ?? '—'}`}</small>
            </header>
            {s.totals.lines === 0 ? (
              <p className="iv-note">قالبِ محتویات تعریف نشده — در تبِ «کالاها» روی «محتویات» بزنید.</p>
            ) : (
              <div className="iv-settbl">
                <div className="iv-setrow head"><span>قلم</span><span>استاندارد</span><span>داخلِ ست</span><span>کسری</span><span /></div>
                {s.contents.map((c) => (
                  <div key={c.componentId} className={`iv-setrow${(c.shortage ?? 0) > 0 ? ' short' : ''}${c.tracked ? '' : ' untracked'}`}>
                    <span className="iv-setlabel">{c.label}{!c.tracked && <i> (ردیابی نمی‌شود)</i>}{c.extra > 0 && <i> (+{num(c.extra)} بیش از استاندارد)</i>}</span>
                    <span>{num(c.standard)}</span>
                    <span>{c.tracked ? num(c.inside) : '—'}</span>
                    <span className={(c.shortage ?? 0) > 0 ? 'iv-setmiss' : ''}>{c.tracked ? (c.shortage ? num(c.shortage) : '—') : '—'}</span>
                    <span className="iv-setacts">
                      <button type="button" disabled={!c.tracked || !c.inside} onClick={() => setMove({ set: s, line: c, mode: 'damage' })}>خرابی</button>
                      <button type="button" disabled={!c.tracked || !c.inside} onClick={() => setMove({ set: s, line: c, mode: 'withdraw' })}>برداشت</button>
                    </span>
                  </div>
                ))}
                {s.extras.map((c) => (
                  <div key={`x${c.partId}`} className="iv-setrow extra">
                    <span className="iv-setlabel">{c.label}<i> (خارج از قالب)</i></span>
                    <span>—</span>
                    <span>{num(c.inside)}</span>
                    <span>—</span>
                    <span className="iv-setacts">
                      <button type="button" onClick={() => setMove({ set: s, line: { ...c, standard: 0, tracked: true }, mode: 'withdraw' })}>برداشت</button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <footer className="iv-set-foot">
              <button type="button" className="iv-mini" disabled={busy === s.lotId || !s.totals.shortage} onClick={() => fill(s)}>
                {busy === s.lotId ? 'در حال تکمیل…' : 'تکمیل از انبار'}
              </button>
              {s.totals.untracked > 0 && <small className="iv-none">{num(s.totals.untracked)} قلمِ فقط‌نام — برای ردیابی، در «محتویات» به کالای تعریف‌شده وصلش کنید</small>}
            </footer>
          </motion.article>
        ))}
      </div>

      <section className="iv-dmg">
        <h2><Alert width="15" height="15" /> خرابی‌ها</h2>
        <p className="iv-note">قلمِ خراب از ست یا انبار این‌جا می‌نشیند تا تصمیم گرفته شود: اسقاط (خروجِ قطعی) یا تعمیر و برگشت به انبار.</p>
        <div className="iv-list">
          {damaged.length === 0 && <div className="iv-empty">چیزی در خرابی‌ها نیست</div>}
          {damaged.map((d) => (
            <article key={d.lotId} className="iv-row">
              <div className="iv-qty"><b>{num(d.quantity)}</b><span>{d.unit}</span></div>
              <div className="iv-row-main">
                <b>{d.itemName}</b>
                <small>{d.serialNo ? <>سریال <span dir="ltr">{d.serialNo}</span></> : d.lotNo ? <>لات <span dir="ltr">{d.lotNo}</span></> : 'بدونِ شمارهٔ لات'}{d.reason ? ` · ${d.reason}` : ''}{d.since ? ` · ${faDate(d.since)}` : ''}</small>
              </div>
              <div className="iv-acts">
                <button type="button" onClick={() => setDecide({ row: d, mode: 'repair' })}>تعمیر و برگشت</button>
                <button type="button" className="iv-acts-del" onClick={() => setDecide({ row: d, mode: 'scrap' })}>اسقاط</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <AnimatePresence>
        {move && (
          <QtySheet
            title={move.mode === 'damage' ? `خرابی — ${move.line.label}` : `برداشت به انبار — ${move.line.label}`}
            hint={move.mode === 'damage' ? `از ${move.set.location} به «خرابی‌ها»` : `از ${move.set.location} به ${move.set.home}`}
            max={move.line.inside}
            lots={move.line.lots}
            onClose={() => setMove(null)}
            onSubmit={async ({ quantity, lotId, note }) => {
              await api(`/stock/sets/${move.set.lotId}/${move.mode}`, { method: 'POST', body: { partLotId: lotId, quantity, note } });
              onToast(move.mode === 'damage' ? 'به «خرابی‌ها» منتقل شد' : 'به انبار برگشت');
              setMove(null); await load();
            }}
            onError={onToast}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {decide && (
          <QtySheet
            title={decide.mode === 'scrap' ? `اسقاط — ${decide.row.itemName}` : `تعمیر و برگشت — ${decide.row.itemName}`}
            hint={decide.mode === 'scrap' ? 'خروجِ قطعی از «خرابی‌ها»؛ در دفتر با دلیلِ «اسقاط» می‌ماند' : 'به انبار برمی‌گردد و دوباره در دسترس است'}
            max={decide.row.quantity}
            onClose={() => setDecide(null)}
            onSubmit={async ({ quantity, note }) => {
              await api(`/stock/damaged/${decide.row.lotId}/${decide.mode}`, { method: 'POST', body: { quantity, note } });
              onToast(decide.mode === 'scrap' ? 'اسقاط ثبت شد' : 'به انبار برگشت');
              setDecide(null); await load();
            }}
            onError={onToast}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {report && <ShortageReport onClose={() => setReport(false)} onError={onToast} />}
      </AnimatePresence>
    </>
  );
}

/** تعداد (+ لاتِ مبدأ وقتی بیش از یکی است) + یادداشت — برای خرابی/برداشت/اسقاط/تعمیر. */
function QtySheet({ title, hint, max, lots, onClose, onSubmit, onError }) {
  const multi = Array.isArray(lots) && lots.length > 1;
  const [lotId, setLotId] = useState(() => (Array.isArray(lots) && lots.length ? String(lots[0].lotId) : ''));
  const cap = multi ? (lots.find((l) => String(l.lotId) === lotId)?.quantity ?? max) : max;
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    const n = int(qty);
    if (n <= 0) { onError('تعداد را وارد کنید'); return; }
    if (cap != null && n > cap) { onError(`بیشتر از ${num(cap)} عدد این‌جا نیست`); return; }
    setBusy(true);
    try { await onSubmit({ quantity: n, lotId: lotId ? Number(lotId) : undefined, note: note.trim() || undefined }); }
    catch (e) { onError(e.message); } finally { setBusy(false); }
  };
  return (
    <TitledSheet onClose={() => !busy && onClose()} title={title}>
      <div className="iv-form">
        {hint && <p className="iv-hint">{hint}</p>}
        {multi && (
          <label className="iv-field"><span>از کدام لات</span>
            <select value={lotId} onChange={(e) => { setLotId(e.target.value); setQty('1'); }}>
              {lots.map((l) => <option key={l.lotId} value={l.lotId}>{l.serialNo || l.lotNo || `#${l.lotId}`} — {num(l.quantity)} عدد</option>)}
            </select>
          </label>
        )}
        <label className="iv-field"><span>تعداد{cap != null ? ` (حداکثر ${num(cap)})` : ''}</span>
          <input dir="ltr" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </label>
        <label className="iv-field"><span>یادداشت (اختیاری)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً «کابل پاره بود»" />
        </label>
      </div>
      <Foot busy={busy} onClose={onClose} onSubmit={submit} label="ثبت" />
    </TitledSheet>
  );
}

/** گزارشِ کسری و خرابی — کدام ست، کدام بیمارستان، کِی و در کدام مرحله (تحویل یا برگشت). */
function ShortageReport({ onClose, onError }) {
  const [days, setDays] = useState(90);
  const [data, setData] = useState(null);
  useEffect(() => {
    const from = new Date(Date.now() - days * 864e5).toISOString();
    api(`/assets/shortages/report?from=${encodeURIComponent(from)}`).then(setData).catch((e) => onError(e.message));
  }, [days, onError]);
  const STAGE = { receipt: 'هنگامِ تحویل', return: 'هنگامِ برگشت' };
  const KIND = { missing: 'کسری', damaged: 'خرابی' };
  const csv = () => {
    if (!data) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['تاریخ', 'حواله', 'بیمارستان', 'ست', 'سریال', 'قلم', 'تعداد', 'نوع', 'مرحله', 'یادداشت'];
    const lines = data.rows.map((r) => [faDate(r.at), r.transferCode, r.hospital, r.itemName, r.serialNo, r.label, r.missing, KIND[r.kind] ?? r.kind, STAGE[r.stage] ?? r.stage, r.notes].map(esc).join(','));
    const blob = new Blob(['﻿' + [head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `kasri-${days}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <TitledSheet onClose={onClose} title="گزارشِ کسری و خرابی">
      <div className="iv-form">
        <div className="iv-filters">
          {[30, 90, 365].map((d) => <button key={d} type="button" className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{num(d)} روزِ اخیر</button>)}
        </div>
        {!data ? <div className="iv-empty">در حال بارگذاری…</div> : (
          <>
            <div className="iv-stats">
              <div><b>{num(data.total)}</b><span>قلم کم یا خراب</span></div>
              <div><b>{data.byItem[0]?.label ?? '—'}</b><span>بیشترین ست</span></div>
              <div><b>{data.byHospital[0]?.label ?? '—'}</b><span>بیشترین بیمارستان</span></div>
            </div>
            <div className="iv-list">
              {data.rows.length === 0 && <div className="iv-empty">در این بازه کسری ثبت نشده</div>}
              {data.rows.map((r) => (
                <article key={r.id} className="iv-row sm">
                  <div className="iv-qty"><b>{num(r.missing)}</b><span>{KIND[r.kind] ?? r.kind}</span></div>
                  <div className="iv-row-main">
                    <b>{r.label} — {r.itemName}{r.serialNo ? ` (${r.serialNo})` : ''}</b>
                    <small>{faDate(r.at)} · {r.hospital} · حوالهٔ <span dir="ltr">{r.transferCode}</span> · {STAGE[r.stage] ?? r.stage}{r.notes ? ` · ${r.notes}` : ''}</small>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
      <footer className="iv-foot">
        <button type="button" className="iv-ghost" onClick={onClose}>بستن</button>
        <button type="button" className="iv-save" disabled={!data?.rows?.length} onClick={csv}>خروجیِ CSV</button>
      </footer>
    </TitledSheet>
  );
}

/**
 * دارایی‌های برگشتی — ست و دستگاه.
 *
 * جدا از تبِ «لات‌ها» است چون سؤالش فرق می‌کند: آن‌جا «چند تا داریم»، این‌جا
 * «این دستگاه فلان روز آزاد است؟». همان دلیلی که تقویمِ چینش از فهرستِ
 * مراجعات جدا شد.
 */
function Assets({ onToast }) {
  const row = useStagger();
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
        {!loading && rows.map((r, i) => (
          <motion.article key={r.lotId} {...row(i)} className={`iv-row as-${r.state}`}>
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
          </motion.article>
        ))}
      </div>

      <AnimatePresence>
        {needsFor !== null && <Needs onClose={() => setNeedsFor(null)} onToast={onToast} />}
      </AnimatePresence>
      <AnimatePresence>
        {consignFor && (
          <Consign row={consignFor} onClose={() => setConsignFor(null)} onToast={onToast} onDone={load} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showConsigned && <Consignments onClose={() => setShowConsigned(false)} onToast={onToast} onDone={load} />}
      </AnimatePresence>
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
    <Overlay backdrop="iv-overlay" panel="iv-sheet sm" as="section" onClose={onClose}>
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
    </Overlay>
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
    <>
    <Overlay backdrop="iv-overlay" panel="iv-sheet" as="section" onClose={onClose}>
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
    </Overlay>
    {/* برگهٔ شمارش **خواهرِ** این شیت است نه فرزندش: پوششِ داخلی
        `position: fixed` است و اگر داخلِ پنلِ متحرک بنشیند، transformِ پنل
        مرجعش می‌شود و وسطِ انیمیشن کج می‌افتد. */}
    <AnimatePresence>
      {countFor && (
        <CountSheet
          row={countFor}
          onClose={() => setCountFor(null)}
          onToast={onToast}
          onDone={async () => { await load(); await onDone(); }}
        />
      )}
    </AnimatePresence>
    </>
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
    <Overlay backdrop="iv-overlay" panel="iv-sheet" as="section" onClose={onClose}>
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
    </Overlay>
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
    <Overlay backdrop="iv-overlay" panel="iv-sheet" as="section" onClose={onClose}>
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
    </Overlay>
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
                {t.receipt && ` · کارشناس ${t.receipt.issue ? 'با مغایرت ' : ''}تحویل گرفت`}
              </small>
            </div>
            <div className="iv-acts">
              <button type="button" onClick={() => setOpen(t.id)}>جزئیات</button>
            </div>
          </article>
        ))}
      </div>

      <AnimatePresence>
        {sending && (
          <TransferSheet
            onClose={() => setSending(false)}
            onSaved={async (msg) => { setSending(false); onToast(msg); await load(); onChanged?.(); }}
            onError={onToast}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <TransferDetail
            id={open}
            onClose={() => setOpen(null)}
            onChanged={async (msg) => { onToast(msg); await load(); onChanged?.(); }}
            onError={onToast}
          />
        )}
      </AnimatePresence>
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
      onSaved(`حوالهٔ ${t.code} صادر شد`);
    } catch (e) { onError(e.message); } finally { setBusy(false); }
  };

  return (
    <TitledSheet title="حوالهٔ جدید" onClose={onClose}>
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
    </TitledSheet>
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
  const [sets, setSets] = useState([]); // ست‌های سریالیِ همین حواله (بستهٔ ب: شمارشِ برگشت)
  const [cnt, setCnt] = useState({}); // `${lotId}:${partId}` → { counted, damaged }

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
  /* ستِ سریالی = بستهٔ موجودی: شمارشِ برگشتش ردیف‌به‌ردیف است (استاندارد / داخلِ ست / شمردم / خرابی)،
     نه «یک کسری ثبت کن». هر خطِ سریال‌دار پرسیده می‌شود؛ آنچه ست نیست `null` برمی‌گردد. */
  useEffect(() => {
    if (!t || t.status === 'planned') { setSets([]); return; }
    let on = true;
    Promise.all(t.lines.filter((l) => l.serialNo).map((l) => api(`/stock/sets/${l.lotId}`).catch(() => null)))
      .then((rs) => { if (on) setSets(rs.filter((x) => x && x.totals.lines > 0)); });
    return () => { on = false; };
  }, [t, id]);
  const refreshSets = async () => {
    const rs = await Promise.all(sets.map((x) => api(`/stock/sets/${x.lotId}`).catch(() => null)));
    setSets(rs.filter((x) => x && x.totals.lines > 0));
    setCnt({});
  };
  const cell = (lotId, partId, k, fallback) => {
    const v = cnt[`${lotId}:${partId}`]?.[k];
    return v === undefined ? String(fallback) : v;
  };
  const setCell = (lotId, partId, k, v) => setCnt((m) => ({ ...m, [`${lotId}:${partId}`]: { ...(m[`${lotId}:${partId}`] ?? {}), [k]: v } }));

  return (
    <TitledSheet title={t ? `حوالهٔ ${t.code}` : 'حواله'} onClose={onClose}>
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
                      'برگهٔ مصرف ثبت شد',
                    )}>
              ثبتِ برگهٔ مصرف
            </button>
          )}

          {/* دستِ دومِ تحویلِ دوطرفه — کنارِ رسیدِ CSR، نه به‌جایش: یکی امضای بیمارستان است، یکی امضای کارشناسِ خودمان. */}
          {t.receipt && (
            <p className={`iv-note ${t.receipt.issue ? 'warn' : 'ok'}`}>
              کارشناس {t.receipt.issue ? 'با مغایرت ' : ''}تحویل گرفت — {faDate(t.receipt.at)}{t.receipt.note ? ` · ${t.receipt.note}` : ''}
            </p>
          )}
          {t.receivedBy ? (
            <p className="iv-note">تحویلِ CSR: <b>{t.receivedBy}</b> — {faDate(t.receivedAt)}</p>
          ) : (
            <label className="iv-field"><span>رسیدِ تحویل به CSR</span>
              <input value={csr} onChange={(e) => setCsr(e.target.value)} placeholder="نامِ تحویل‌گیرنده" />
              <button type="button" className="iv-mini" disabled={busy}
                      onClick={() => act(`/stock/transfers/${id}/receive`, { receivedBy: csr.trim() }, 'رسیدِ CSR ثبت شد')}>
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
                        onClick={() => act(`/stock/transfers/${id}/release`, { note: rel.trim() }, 'پایانِ عمل اعلام شد')}>
                  اعلامِ پایان
                </button>
              </label>
            )
          )}

          {/* شمارشِ برگشتِ ستِ سریالی (بستهٔ ب): شمردم/خرابی را دفتر می‌زند؛ گم‌شده حساب می‌شود و از ست
              خارج می‌شود (نه مصرف — مصرف را کارشناس سرِ عمل زده)؛ بعد «تکمیل از انبار». */}
          {t.status !== 'closed' && sets.map((st) => {
            const tracked = st.contents.filter((c) => c.tracked);
            const lines = tracked.map((c) => {
              const counted = int(cell(st.lotId, c.partId, 'counted', c.inside));
              const damaged = int(cell(st.lotId, c.partId, 'damaged', 0));
              return { c, counted, damaged, lost: Math.max(0, (c.inside ?? 0) - counted - damaged), over: counted + damaged > (c.inside ?? 0) };
            });
            const totalLost = lines.reduce((a, l) => a + l.lost, 0);
            const totalDamaged = lines.reduce((a, l) => a + l.damaged, 0);
            const bad = lines.some((l) => l.over);
            return (
              <div key={st.lotId} className="iv-check iv-retcount">
                <b><Boxes width="14" height="14" /> شمارشِ برگشتِ {st.itemName} <bdi dir="ltr">{st.serialNo}</bdi></b>
                <div className="iv-settbl">
                  <div className="iv-setrow head cnt"><span>قلم</span><span>استاندارد</span><span>داخلِ ست</span><span>شمردم</span><span>خرابی</span><span>گم‌شده</span></div>
                  {lines.map(({ c, lost, over }) => (
                    <div key={c.componentId} className={`iv-setrow cnt${lost || over ? ' short' : ''}`}>
                      <span className="iv-setlabel">{c.label}</span>
                      <span>{num(c.standard)}</span>
                      <span>{num(c.inside)}</span>
                      <input dir="ltr" inputMode="numeric" aria-label={`شمردم — ${c.label}`} value={cell(st.lotId, c.partId, 'counted', c.inside)} onChange={(e) => setCell(st.lotId, c.partId, 'counted', e.target.value)} />
                      <input dir="ltr" inputMode="numeric" aria-label={`خرابی — ${c.label}`} value={cell(st.lotId, c.partId, 'damaged', 0)} onChange={(e) => setCell(st.lotId, c.partId, 'damaged', e.target.value)} />
                      <span className={lost ? 'iv-setmiss' : ''}>{over ? 'بیش از داخل' : lost ? num(lost) : '—'}</span>
                    </div>
                  ))}
                </div>
                <div className="iv-tracts">
                  <button type="button" className="iv-mini" disabled={busy || bad || !tracked.length}
                          onClick={() => act(
                            `/stock/transfers/${id}/return-count`,
                            { lines: lines.map((l) => ({ lotId: st.lotId, partId: l.c.partId, counted: l.counted, damaged: l.damaged })) },
                            totalLost || totalDamaged ? `شمارش ثبت شد — ${num(totalLost)} گم‌شده، ${num(totalDamaged)} خرابی` : 'شمارش ثبت شد — ست کامل است',
                            'POST',
                            () => refreshSets(),
                          )}>
                    ثبتِ شمارش{totalLost ? ` (${num(totalLost)} گم‌شده)` : ''}
                  </button>
                  <button type="button" className="iv-mini" disabled={busy || !st.totals.shortage}
                          onClick={() => act(`/stock/sets/${st.lotId}/fill`, {}, 'ست از انبار تکمیل شد', 'POST', () => refreshSets())}>
                    تکمیل از انبار{st.totals.shortage ? ` (${num(st.totals.shortage)} کسری)` : ''}
                  </button>
                </div>
              </div>
            );
          })}

          {/* چک‌لیستِ برگشت — فقط **کسری** ثبت می‌شود نه کلِ شمارش. ثبتِ ۲۰
              ردیفِ «سالم» یعنی هیچ‌کس این کار را نمی‌کند. */}
          {check && check.lots.filter((l) => !sets.some((x) => x.lotId === l.lotId)).length > 0 && (
            <div className="iv-check">
              <b>محتویاتِ ست هنگام برگشت</b>
              {check.lots.filter((l) => !sets.some((x) => x.lotId === l.lotId)).map((l) => (
                <div key={l.lotId} className="iv-checklot">
                  <span className="iv-checkname">{l.itemName}{l.serialNo ? ` (${l.serialNo})` : ''}</span>
                  {l.contents.length === 0
                    ? <em className="iv-none">فهرستِ محتویات تعریف نشده — از تبِ «کالاها» ← «محتویات» اضافه کنید</em>
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
                      onClick={() => act(`/stock/transfers/${id}/return`, undefined, 'ماندهٔ حواله برگشت خورد')}>
                برگشتِ مانده و بستنِ حواله
              </button>
            )}
          </div>
        </>
      )}
    </TitledSheet>
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
  const [searched, setSearched] = useState(false);   // «جست‌وجو شد و چیزی نبود»
  const [making, setMaking] = useState(false);
  const [form, setForm] = useState({ lotNo: '', serialNo: '', expiresJ: '', location: '', quantity: '1', reference: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (item || itemQ.trim().length < 2) { setHits([]); setSearched(false); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      api(`/items?q=${encodeURIComponent(itemQ.trim())}`)
        .then((rows) => { if (alive) { setHits(rows.filter((r) => r.active)); setSearched(true); } })
        .catch(() => { if (alive) { setHits([]); setSearched(true); } });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [itemQ, item]);

  /**
   * ساختِ کالای تازه از همین‌جا.
   *
   * ⚠️ بدونِ این، کاربری که کالایش هنوز در کاتالوگ نیست بن‌بست می‌خورد: باید
   * شیت را ببندد، به «تعاریفِ پایه» برود، کالا را بسازد و برگردد — و همان‌جا
   * است که نتیجه می‌گیرد «انبار کار نمی‌کند». کاتالوگ همچنان تک‌منبع می‌ماند؛
   * فقط درِ ساختنش این‌جا هم باز است.
   */
  const makeItem = async () => {
    const name = itemQ.trim();
    if (!name || making) return;
    setMaking(true);
    try {
      const fresh = await api('/items', { method: 'POST', body: { name } });
      setItem(fresh);
      setHits([]);
    } catch (e) { onError(e.message); } finally { setMaking(false); }
  };

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
      await onSaved('لات ثبت شد');
    } catch (e) { onError(e.message); } finally { setBusy(false); }
  };

  return (
    <TitledSheet onClose={() => !busy && onClose()} title="ثبتِ لاتِ جدید">
      <div className="iv-form">
        {/* ⚠️ div است نه label: در label، مرورگر کلیکِ روی نتیجه را به اولین
            کنترلِ داخلِ همان label می‌فرستد. با انتخابِ کالا، input جای خودش را
            به دکمهٔ «تغییر» می‌داد و همان کلیک بلافاصله انتخاب را پس می‌گرفت. */}
        <div className="iv-field iv-picker">
          <span>کالا *</span>
          {item ? (
            <div className="iv-picked">
              <b>{item.name}</b>
              <small>{[ASSET_FA[item.assetKind], item.brand, item.size, item.sku, item.unit].filter(Boolean).join(' · ') || 'بدونِ برند و اندازه'}</small>
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
                      <span>{[ASSET_FA[it.assetKind], it.brand, it.size, it.sku].filter(Boolean).join(' · ')}</span>
                    </button>
                  ))}
                </div>
              )}
              {searched && hits.length === 0 && (
                <div className="iv-nohit">
                  <span>کالایی با «{itemQ.trim()}» در کاتالوگ نیست.</span>
                  <button type="button" className="iv-mini" disabled={making} onClick={makeItem}>
                    {making ? 'در حال ساخت…' : `ساختِ کالای «${itemQ.trim()}»`}
                  </button>
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
    </TitledSheet>
  );
}

const MOVE_META = {
  in: { title: 'ورودِ کالا', label: 'تعدادِ ورودی', path: 'receive', ok: 'ورود ثبت شد' },
  out: { title: 'مصرف / خروج', label: 'تعدادِ مصرفی', path: 'consume', ok: 'مصرف ثبت شد' },
  adjust: { title: 'اصلاحِ شمارش', label: 'چند عدد شمردید؟', path: 'adjust', ok: 'موجودی اصلاح شد' },
  /* خرابی در خودِ انبار: به «خرابی‌ها» می‌رود تا همان‌جا اسقاط یا تعمیر شود (بستهٔ ب). */
  damage: { title: 'ثبتِ خرابی', label: 'چند عدد خراب شد؟', path: 'damage', ok: 'به «خرابی‌ها» منتقل شد' },
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
          : mode === 'damage'
            ? { quantity: n, note: reason.trim() || undefined }
            : { quantity: n, reason: reason.trim() || undefined },
      });
      await onSaved(meta.ok);
    } catch (e) { onError(e.message); } finally { setBusy(false); }
  };

  return (
    <TitledSheet onClose={() => !busy && onClose()} title={meta.title}>
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
        {mode === 'damage' && (
          <p className="iv-hint">قلمِ خراب به محلِ «خرابی‌ها» می‌رود و در تبِ «ست‌ها» همان‌جا اسقاط یا تعمیر می‌شود — از موجودیِ در دسترس کم می‌شود، گم نمی‌شود.</p>
        )}
      </div>
      <Foot busy={busy} onClose={onClose} onSubmit={submit} label="ثبت" />
    </TitledSheet>
  );
}

/** ردیابی — «این لات کجا رفت». جهتِ عکسِ فاکتور و کلِ دلیلِ وجودِ دفتر. */
function TraceSheet({ lotId, onClose, onError }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api(`/stock/lots/${lotId}/trace`).then(setData).catch((e) => { onError(e.message); onClose(); });
  }, [lotId, onClose, onError]);

  return (
    <TitledSheet onClose={onClose} title="ردیابیِ لات">
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
    </TitledSheet>
  );
}

/** شیتِ عنوان‌دارِ انبار — لایهٔ نازکی روی `Overlay`ِ مشترک، فقط برای سرتیترِ تکراری. */
function TitledSheet({ title, children, onClose }) {
  return (
    <Overlay backdrop="iv-overlay" panel="iv-sheet" as="section" onClose={onClose}>
      <header className="iv-sheet-head">
        <b>{title}</b>
        <button type="button" className="iv-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
      </header>
      {children}
    </Overlay>
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
