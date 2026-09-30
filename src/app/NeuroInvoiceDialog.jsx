import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { fmtMoney } from '../lib/money.js';
import { toEnDigits } from '../lib/identity.js';
import { useAuth } from './auth.jsx';
import Overlay from '../ui/Overlay.jsx';
import { Close, External, Plus, Trash } from '../ui/icons.jsx';

const int = (v, lo, hi) => {
  const n = parseInt(toEnDigits(String(v ?? '')).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
};
const fa = (n) => Number(n || 0).toLocaleString('fa-IR');
const SECTOR_FA = { public: 'دولتی', private: 'خصوصی', nonprofit: 'غیرانتفاعی', charity: 'خیریه' };

/**
 * پاپ‌آپِ صدورِ فاکتورِ نورومانیتورینگ — الگوی ملک‌طب.
 *
 * تا پیش از این هر خدمت جداگانه «جستجو → محاسبه → افزودن» می‌شد؛ چهار خدمت
 * یعنی دوازده کلیک. حالا همهٔ خدماتِ IONM یک‌جا با تیکِ پیش‌فرضِ **همین شرکت**
 * می‌آیند، مدت و سال از خودِ مراجعه پر می‌شود، مصرفی‌های پرتکرار با شمارنده
 * زیرش‌اند، و یک دکمه همه را روی صورت‌حساب می‌نشاند (و اگر خواستی صادر و چاپ
 * می‌کند). هیچ مبلغی این‌جا حساب نمی‌شود — همه از `neuro-quote` سرور (قانون ۱۵).
 */
export default function NeuroInvoiceDialog({ visit, billing, onClose, onToast, reload, onIssue }) {
  const { user } = useAuth();
  const root = `/visits/${visit.id}/invoices`;
  const [cat, setCat] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [hours, setHours] = useState('');
  const [year, setYear] = useState('');
  const [owner, setOwner] = useState('company');
  const [cons, setCons] = useState([]);
  const [stockQuery, setStockQuery] = useState(''), [stock, setStock] = useState([]), [stockError, setStockError] = useState(''), [stockOpen, setStockOpen] = useState(false), [returnUnusedStock, setReturnUnusedStock] = useState(false);
  useEffect(() => { if (!stockOpen) return; let alive = true; const t = setTimeout(() => api(`/stock/lots?q=${encodeURIComponent(stockQuery)}`).then(d => { if (alive) { setStock(d); setStockError(''); } }).catch(e => { if (alive) setStockError(e.message); }), 250); return () => { alive = false; clearTimeout(t); }; }, [stockQuery, stockOpen]);
  const [draft, setDraft] = useState({ name: '', irc: '', qty: '1' });
  const [quote, setQuote] = useState(null);
  /* قلمِ مبلغِ کلِ مراجعه (مبلغِ ثبت‌نام) جایگزین شود یا کنارِ خدمات بماند — صریح، نه ضمنی (company-14). */
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  /* وضعیتِ صورت‌حساب در لحظهٔ بازشدن — بازخوانی‌های بعدی انتخابِ کاربر را نمی‌پرانند. */
  const openedWith = useRef(billing);

  useEffect(() => {
    setQuote(null);
    let live = true;
    api(`${root}/neuro-catalog`)
      .then((c) => {
        if (!live) return;
        const charges = openedWith.current?.charges ?? [];
        const existing = charges.filter((x) => x.neuroDetail && !x.neuroDetail.consumable);
        // مراجعه‌ای که قبلاً خدمتِ نورو دارد، همان‌ها را نشان می‌دهد نه پیش‌فرضِ شرکت.
        const fromVisit = existing
          .map((x) => `${x.serviceCode}:${x.neuroDetail.label ?? ''}`)
          .filter((id) => c.services.some((s) => s.id === id));
        setSel(new Set(fromVisit.length ? fromVisit : c.services.filter((s) => s.defaultOn).map((s) => s.id)));
        /* خدماتِ نورو که از قبل هست و قلمِ کل هنوز کنارش است یعنی بارِ قبل «کنارش بماند» انتخاب شده بود. */
        setReplace(!existing.length);
        setHours(String(existing[0]?.neuroDetail?.hours ?? c.hours ?? ''));
        setYear(String(c.year ?? ''));
        setOwner(existing[0]?.neuroDetail?.deviceOwner ?? c.deviceOwner ?? 'company');
        const used = charges.filter((x) => x.neuroDetail?.consumable).map((x) => ({ name: x.title, irc: x.neuroDetail.irc ?? '', qty: x.quantity, chargeId: x.id, itemId: x.itemId ?? undefined, lotId: x.neuroDetail.lotId ?? undefined, stockEffect: x.stockEffect ?? 'virtual' }));
        setCons(used.length ? used : c.consumables ?? []);
        setCat(c);
      })
      .catch((e) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [root]);

  const h = int(hours, 0, 72);
  const y = toEnDigits(year).replace(/\D/g, '');
  const ids = useMemo(() => (cat ? cat.services.filter((s) => sel.has(s.id)).map((s) => s.id) : []), [cat, sel]);

  /* جمعِ زنده — با هر تغییرِ تیک/مدت/سال/مالک، از سرور (debounce). */
  useEffect(() => {
    setQuote(null);
    if (!cat || !ids.length || h < 1 || !/^\d{4}$/.test(y)) { setQuote(null); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      api(`${root}/neuro-quote`, { method: 'POST', body: { items: ids, hours: h, year: y, deviceOwner: owner } })
        .then((q) => { if (live) { setQuote(q); setErr(''); } })
        .catch((e) => { if (live) { setQuote(null); setErr(e.message); } });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [cat, ids, h, y, owner, root]);

  const toggle = (id) => setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setQty = (i, qty) => setCons((l) => l.map((x, j) => (j === i ? { ...x, qty } : x)));
  const payloadCons = () => cons.map((c) => ({ ...c, name: c.name, irc: c.irc || '', qty: int(c.qty, 1, 999) }));

  const apply = async (thenIssue) => {
    if (!ids.length) { onToast('دستِ‌کم یک خدمت انتخاب کنید'); return; }
    if (h < 1) { onToast('مدتِ قابلِ صورتحساب را وارد کنید'); return; }
    const printWindow = thenIssue ? window.open('', '_blank') : null;
    if (thenIssue && !printWindow) { setErr('برای چاپ، اجازهٔ بازشدن پنجره را بدهید'); return; }
    if (printWindow) printWindow.document.body.textContent = 'در حال آماده‌سازی فاکتور…';
    setBusy(true); setErr('');
    try {
      await api(`${root}/neuro-apply`, { method: 'POST', body: { items: ids, hours: h, year: y, deviceOwner: owner, consumables: payloadCons(), returnUnusedStock, replace: replace ? lump.map((c) => c.id) : [] } });
      await reload();
      onToast(`${fa(ids.length)} خدمت و ${fa(cons.length)} مصرفی روی صورت‌حساب نشست`);
      onClose();
      if (thenIssue) onIssue?.(printWindow);
    } catch (e) { printWindow?.close(); setErr(e.message); } finally { setBusy(false); }
  };

  /** پیش‌فرضِ شرکت = همین انتخاب. فقط سوپرادمین (تنظیماتِ شرکت). */
  const saveDefaults = async () => {
    setBusy(true);
    try {
      await api('/settings', { method: 'PATCH', body: { values: {
        invoice_neuro_defaults: ids.join(','),
        invoice_neuro_consumables: JSON.stringify(payloadCons().map(({ chargeId, lotId, ...c }) => c)),
      } } });
      onToast('پیش‌فرضِ شرکت ذخیره شد — از این به بعد همین‌ها تیک دارند');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  const canIssue = !!billing?.invoiceType && !!billing?.invoiceBankAccount;
  const lump = cat?.lumpLines ?? [];
  /* چرا دکمه‌های ثبت خاموش‌اند — کنارِ خودِ دکمه‌ها، نه فقط خطِ خطای بالای پنجره (company-14). */
  const whyNot = !cat ? '' : !ids.length ? 'دستِ‌کم یک خدمت انتخاب کنید.'
    : h < 1 ? 'مدتِ قابلِ صورتحساب را وارد کنید.'
      : !/^\d{4}$/.test(y) ? 'سالِ تعرفه را چهاررقمی وارد کنید.'
        : !quote ? (err || 'در حالِ محاسبهٔ جمع…') : '';
  const tariffMissing = /تعرفه/.test(err);

  return (
    <Overlay backdrop="db-overlay" panel="glass db-sheet nv-sheet" from="bottom" onClose={onClose} closable={!busy} role="dialog" aria-label="صدور فاکتور نورومانیتورینگ">
      <header className="db-sheet-head">
        <b>فاکتورِ نورومانیتورینگ · {visit.code}</b>
        <button type="button" className="db-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
      </header>
      {err && (
        <p className="bl-error" role="alert">
          {err}
          {/* خطای تعرفه راهِ رفع را هم نشان می‌دهد (company-14) — تبِ تازه تا این پنجره سرِ جایش بماند. */}
          {tariffMissing && (user?.level >= 6
            ? <> <Link className="nv-fixlink" to="/app/settings" target="_blank" rel="noopener noreferrer">تعریفِ تعرفه <External width="12" height="12" /></Link></>
            : <> از مدیرِ سامانه بخواهید ضریب را در «تنظیماتِ شرکت» ثبت کند.</>)}
        </p>
      )}
      {!cat ? <div className="us-empty">در حال بارگذاری…</div> : (
        <>
          <div className="nv-params">
            <label className="db-field"><span>مدت قابل صورتحساب (ساعت)</span>
              <span className="nv-step">
                <button type="button" aria-label="یک ساعت کمتر" disabled={busy} onClick={() => setHours(String(Math.max(1, h - 1)))}>−</button>
                <input dir="ltr" inputMode="numeric" aria-label="مدت قابل صورتحساب" value={hours} onChange={(e) => setHours(e.target.value)} />
                <button type="button" aria-label="یک ساعت بیشتر" disabled={busy} onClick={() => setHours(String(Math.min(72, h + 1)))}>+</button>
              </span>
            </label>
            <label className="db-field"><span>سال تعرفه (شمسی)</span>
              <input dir="ltr" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
            </label>
            <div className="db-field"><span>مالک دستگاه</span>
              <div className="bl-pricing-tabs" role="radiogroup" aria-label="مالک دستگاه">
                <button type="button" role="radio" aria-checked={owner === 'company'} className={owner === 'company' ? 'on' : ''} onClick={() => setOwner('company')}>شرکت</button>
                <button type="button" role="radio" aria-checked={owner === 'hospital'} className={owner === 'hospital' ? 'on' : ''} onClick={() => setOwner('hospital')}>بیمارستان</button>
              </div>
            </div>
          </div>
          <p className="db-hint">مدت از ساعتِ شروع و پایانِ عمل پیشنهاد شده و قابلِ اصلاح است؛ تعرفه از نوعِ بیمارستان ({SECTOR_FA[cat.sector] ?? cat.sector}) و سالِ انتخابی خوانده می‌شود.</p>

          <h4 className="nv-h">خدمات <small>{fa(ids.length)} انتخاب‌شده</small></h4>
          <div className="nv-grid" role="group" aria-label="خدمات نورومانیتورینگ">
            {cat.services.map((s) => {
              const on = sel.has(s.id);
              const q = quote?.items.find((i) => i.id === s.id);
              return (
                <label key={s.id} className={`nv-svc${on ? ' on' : ''}`} title={s.title ?? s.label}>
                  <input type="checkbox" checked={on} disabled={busy} onChange={() => toggle(s.id)} aria-label={`${s.label} ${s.code}`} />
                  <b>{s.label}</b>
                  <small dir="ltr">{s.code}</small>
                  {on && <i>{q ? `${fmtMoney(q.total)} تومان` : '…'}</i>}
                </label>
              );
            })}
          </div>

          {lump.length > 0 && (
            <section className="nv-lump" aria-labelledby="nv-lump-h">
              <h4 className="nv-h" id="nv-lump-h">قلمِ مبلغِ کلِ مراجعه <small>همین خدمت، پیش از ریزشدن</small></h4>
              {lump.map((c) => (
                <div key={c.id} className="nv-lump-row"><b>{c.title}</b><span>{fmtMoney(c.amount)} تومان</span></div>
              ))}
              <div className="bl-pricing-tabs" role="radiogroup" aria-label="با قلمِ مبلغِ کل چه شود؟">
                <button type="button" role="radio" aria-checked={replace} className={replace ? 'on' : ''} disabled={busy} onClick={() => setReplace(true)}>جایگزینِ همین قلم شود</button>
                <button type="button" role="radio" aria-checked={!replace} className={!replace ? 'on' : ''} disabled={busy} onClick={() => setReplace(false)}>کنارش بماند</button>
              </div>
              <p className="db-hint">
                {replace
                  ? 'با ثبت، این قلم برداشته می‌شود و خدماتِ بالا جایش می‌نشینند؛ پرداخت‌ها دست نمی‌خورند.'
                  : 'هر دو در جمعِ صورت‌حساب می‌آیند — فقط وقتی درست است که این قلم خدمتِ دیگری باشد، وگرنه یک خدمت دو بار حساب می‌شود.'}
              </p>
            </section>
          )}

          <h4 className="nv-h">اقلامِ مصرفی <small>روی فاکتور چاپ می‌شود، بدونِ مبلغ</small></h4>
          <p className="db-hint">برای اقلام انبار، «فقط فاکتور» یا «کاهش موجودی» را انتخاب کنید. پیش‌فرض مصرفی از کاتالوگ حفظ می‌شود؛ لات مصرف را برای هر مراجعه انتخاب کنید.</p>
          <button type="button" className="bl-mini" onClick={() => setStockOpen(v => !v)} disabled={busy}>انتخاب مصرفی از انبار</button>
          {stockOpen && <div className="nv-cons"><label>جستجوی نام، لات یا سریال<input value={stockQuery} onChange={e => setStockQuery(e.target.value)} /></label>
            {stockError && <p role="alert">{stockError}</p>}
            {stock.slice(0, 30).map(l => <button className="bl-mini" type="button" disabled={busy} key={l.id} onClick={() => {
              setCons(rows => { const same = rows.findIndex(c => c.lotId === l.id); if (same >= 0) return rows.map((c, i) => i === same ? { ...c, qty: int(c.qty, 1, 999) + 1 } : c); const at = rows.findIndex(c => c.itemId === l.itemId && !c.lotId); return at >= 0 ? rows.map((c, i) => i === at ? { ...c, lotId: l.id } : c) : [...rows, { name: l.itemName, itemId: l.itemId, lotId: l.id, qty: 1, irc: '', stockEffect: 'virtual' }]; });
            }}>{l.itemName} · {l.lotNo || l.serialNo || `لات ${l.id}`} · موجودی {fa(l.quantity)} — انتخاب</button>)}
          </div>}
          <div className="nv-cons">
            {cons.map((c, i) => (
              <div key={`${c.name}-${i}`} className="nv-con">
                <div><b>{c.name}</b>{c.irc && <small dir="ltr">IRC {c.irc}</small>}</div>
                {c.itemId && <label>اثر انبار<select aria-label={`اثر انبار ${c.name}`} disabled={busy} value={c.stockEffect ?? 'virtual'} onChange={e => setCons(rows => rows.map((x, j) => j === i ? { ...x, stockEffect: e.target.value } : x))}><option value="virtual">فقط درج در فاکتور</option><option value="consumed">کاهش موجودی انبار</option></select><small>{c.lotId ? `لات انتخابی: ${c.lotId}` : 'لات را از انتخاب مصرفی انبار مشخص کنید'}</small></label>}
                <span className="nv-step">
                  <button type="button" aria-label={`کمتر ${c.name}`} disabled={busy} onClick={() => setQty(i, Math.max(1, int(c.qty, 1, 999) - 1))}>−</button>
                  <input dir="ltr" inputMode="numeric" aria-label={`تعداد ${c.name}`} value={c.qty} onChange={(e) => setQty(i, e.target.value)} />
                  <button type="button" aria-label={`بیشتر ${c.name}`} disabled={busy} onClick={() => setQty(i, Math.min(999, int(c.qty, 1, 999) + 1))}>+</button>
                </span>
                <button type="button" className="bl-del" aria-label={`حذف ${c.name}`} disabled={busy} onClick={() => setCons((l) => l.filter((_, j) => j !== i))}><Trash width="14" height="14" /></button>
              </div>
            ))}
            <div className="nv-con nv-add">
              <input placeholder="نام کالا — مثلاً Electrode" aria-label="نام کالای مصرفی" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              <input dir="ltr" inputMode="numeric" placeholder="کد IRC (اختیاری)" aria-label="کد IRC" value={draft.irc} onChange={(e) => setDraft((d) => ({ ...d, irc: e.target.value }))} />
              <input dir="ltr" inputMode="numeric" placeholder="تعداد" aria-label="تعداد کالای مصرفی" value={draft.qty} onChange={(e) => setDraft((d) => ({ ...d, qty: e.target.value }))} />
              <button type="button" className="bl-mini" disabled={busy || !draft.name.trim()} onClick={() => {
                setCons((l) => [...l, { name: draft.name.trim(), irc: toEnDigits(draft.irc).replace(/\D/g, ''), qty: int(draft.qty, 1, 999) }]);
                setDraft({ name: '', irc: '', qty: '1' });
              }}><Plus width="14" height="14" /> افزودنِ مصرفی</button>
            </div>
          </div>

          <label className="db-hint"><input type="checkbox" checked={returnUnusedStock} disabled={busy} onChange={e => setReturnUnusedStock(e.target.checked)} /> مقدار حذف‌شده یا کاهش‌یافته واقعاً مصرف نشده و به موجودی برگردد</label>
          <p className="db-hint">بدون این انتخاب، حذف یا کاهش قلم فقط فاکتور را اصلاح می‌کند و مصرف قبلی در دفتر انبار باقی می‌ماند.</p>
          <p className="db-hint">اقلامِ دیگرِ صورت‌حساب — کالای انبار، تخفیف، خدمتِ دستی — دست نمی‌خورند.</p>
          {whyNot && <p className="db-hint nv-why" aria-live="polite">{whyNot}</p>}
          <div className="nv-foot">
            <div className="nv-total"><span>جمعِ خدمات</span><b>{quote ? `${fmtMoney(quote.total)} تومان` : '—'}</b></div>
            {user?.level >= 6 && (
              <button type="button" className="bl-mini" disabled={busy || !ids.length} onClick={saveDefaults}>ذخیره به‌عنوانِ پیش‌فرضِ شرکت</button>
            )}
            <button type="button" className="bl-mini" disabled={busy || !quote} onClick={() => apply(false)}>ثبتِ خدمات روی صورت‌حساب</button>
            <button type="button" className="db-submit bl-btn" disabled={busy || !quote || !canIssue} onClick={() => apply(true)}>ثبت، صدور و چاپ فاکتور</button>
          </div>
          {!canIssue && <p className="db-hint">برای صدور، نوعِ فاکتور و حسابِ دریافت باید ثبت شده باشد؛ ثبتِ خدمات بدونِ آن هم ممکن است.</p>}
        </>
      )}
    </Overlay>
  );
}
