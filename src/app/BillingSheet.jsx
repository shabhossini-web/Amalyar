import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { faDate, jStrToIso, todayJStr } from '../lib/jalali.js';
import JDate from './JDate.jsx';
import { toEnDigits } from '../lib/identity.js';
import InvoicePanel from './InvoicePanel.jsx';
import { useConfig } from './config.jsx';
import { hasService } from '../lib/profile.js';
import { Alert, Close, Plus, Trash } from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import MoneyInput from '../ui/MoneyInput.jsx';


const CHARGE_KINDS = { service: 'خدمت', item: 'کالا', discount: 'تخفیف' };
/**
 * اثرِ قلمِ کالا روی انبار.
 *
 * فاکتور و انبار دو چیزند: قیمتِ توافقیِ یک ست روی فاکتور می‌آید بی‌آنکه چیزی
 * از انبار خارج شود، و کالای بیمارستان فاکتور می‌شود بی‌آنکه اصلاً مالِ ما باشد.
 */
const STOCK_EFFECTS = {
  consumed: 'از انبارِ ما کم شود',
  virtual: 'فقط روی فاکتور (از انبار کم نشود)',
  hospital: 'کالای خودِ بیمارستان',
};
const METHODS = { cash: 'نقدی', card: 'کارت‌خوان', transfer: 'انتقال', cheque: 'چک', insurance: 'بیمه' };

const money = (n) => Number(n || 0).toLocaleString('fa-IR');
/** ورودیِ مبلغ: ارقامِ فارسی و جداکنندهٔ هزارگان را می‌پذیرد. */
const parseMoney = (v) => {
  const digits = toEnDigits(String(v ?? '')).replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
};

export default function BillingSheet({ visit, onClose, onChanged, onToast }) {
  const cfg = useConfig();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('charges');

  const [c, setC] = useState({ kind: 'service', title: '', quantity: '1', unitPrice: '', serviceCode: '', codeSystem: '', itemId: null, lotId: null, stockEffect: 'virtual' });
  /// قلمی که کاربر دکمهٔ حذفش را زده و باید سؤالِ «کالا واقعاً مصرف شد؟» را جواب دهد.
  const [delRow, setDelRow] = useState(null);
  const [codeQ, setCodeQ] = useState('');
  const [codeHits, setCodeHits] = useState([]);
  const [itemHits, setItemHits] = useState([]);
  const [lots, setLots] = useState([]);
  const [p, setP] = useState({ amount: '', method: 'cash', dateJ: todayJStr(), reference: '', bankAccountId: '', receivedById: '' });
  /// حساب‌ها و شرکا فقط برای فرمِ پرداخت‌اند؛ اگر ماژولِ حسابداری خاموش باشد
  /// خطا نمی‌دهیم و فیلدها ساده پنهان می‌مانند.
  const [banks, setBanks] = useState([]);
  const [partners, setPartners] = useState([]);
  /* پیشنهادِ کد از شرح — فقط وقتی دستیارِ AI پیکربندی شده. */
  const [aiOn, setAiOn] = useState(false);
  const [sugg, setSugg] = useState(null); // null = هنوز نخواسته
  const [suggBusy, setSuggBusy] = useState(false);
  useEffect(() => {
    api('/bank-accounts').then(setBanks).catch(() => setBanks([]));
    api('/partners').then((r) => setPartners(r.filter((x) => x.active))).catch(() => setPartners([]));
    api('/ai/status').then((r) => setAiOn(!!r?.enabled)).catch(() => {});
  }, []);

  useEffect(() => {
    if (data?.invoiceBankAccount?.id) setP((s) => ({ ...s, bankAccountId: String(data.invoiceBankAccount.id) }));
  }, [data?.invoiceBankAccount?.id]);

  /**
   * پیشنهادِ کد از شرحِ همین مراجعه (#53) — سرور فقط کدهای واقعاً موجود را
   * برمی‌گرداند؛ کلیک روی پیشنهاد همان جستجوی همیشگی را با آن کد پر می‌کند
   * تا مسیرِ فی/تعرفه دست‌نخورده بماند — پیشنهاد میان‌بر است، نه مسیرِ دوم.
   */
  const suggest = async () => {
    setSuggBusy(true);
    try {
      const r = await api('/ai/suggest-codes', { method: 'POST', body: { visitId: visit.id } });
      setSugg(r.suggestions ?? []);
    } catch (e) { onToast(e.message); } finally { setSuggBusy(false); }
  };

  const load = useCallback(async () => {
    try { setData(await api(`/visits/${visit.id}/billing`)); }
    catch (e) { onToast(e.message); onClose(); }
  }, [visit.id, onClose, onToast]);
  useEffect(() => { load(); }, [load]);

  /** جستجوی کد — هم کتابِ ارزش نسبی هم کدهای داخلیِ مطب، با یک عبارت. */
  const [internalHits, setInternalHits] = useState([]);
  useEffect(() => {
    if (codeQ.trim().length < 2) { setCodeHits([]); setInternalHits([]); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      api(`/service-codes?q=${encodeURIComponent(codeQ.trim())}`)
        .then((rows) => { if (alive) setCodeHits(rows); })
        .catch(() => { if (alive) setCodeHits([]); });
      api(`/internal-codes?q=${encodeURIComponent(codeQ.trim())}`)
        .then((rows) => { if (alive) setInternalHits(rows.filter((r) => r.active)); })
        .catch(() => { if (alive) setInternalHits([]); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [codeQ]);

  /** جستجوی کاتالوگِ کالا — فقط وقتی نوعِ قلم «کالا» است. */
  useEffect(() => {
    if (c.kind !== 'item' || codeQ.trim().length < 2) { setItemHits([]); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      api(`/items?q=${encodeURIComponent(codeQ.trim())}`)
        .then((rows) => { if (alive) setItemHits(rows.filter((r) => r.active)); })
        .catch(() => { if (alive) setItemHits([]); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [codeQ, c.kind]);

  /**
   * انتخابِ کالا: نام و قیمتِ پایه پر می‌شوند و ارجاعِ کاتالوگ نگه داشته می‌شود.
   *
   * لات‌های موجود هم همین‌جا خوانده می‌شوند. پیش‌فرضِ «اثرِ انبار» از واقعیتِ
   * انبار می‌آید نه از یک ثابت: کالایی که لاتِ سالم دارد یعنی از انبارِ ماست
   * (`consumed`)، و کالایی که ندارد یعنی یا شرکت انبار ندارد یا کالا از جای
   * دیگری می‌آید (`virtual`). این‌طور کاربرِ عادی هیچ‌وقت با خطا روبه‌رو نمی‌شود
   * ولی نیت همچنان صریح ثبت می‌شود.
   */
  const pickItem = async (it) => {
    setCodeQ('');
    setItemHits([]);
    setC((s) => ({
      ...s,
      title: [it.name, it.size].filter(Boolean).join(' '),
      itemId: it.id,
      lotId: null,
      unitPrice: it.price != null ? String(it.price) : s.unitPrice,
    }));
    if (it.price == null) onToast('این کالا قیمتِ پایه ندارد — مبلغ را دستی وارد کنید');
    let rows = [];
    try { rows = await api(`/stock/items/${it.id}/lots`); }
    catch { rows = []; } // انبار ممکن است برای این شرکت خاموش باشد
    setLots(rows);
    const usable = rows.find((l) => !l.expired && l.quantity > 0);
    setC((s) => ({
      ...s,
      stockEffect: usable ? 'consumed' : 'virtual',
      lotId: usable ? usable.id : null,
    }));
  };

  /**
   * انتخابِ کد: عنوان و مبلغ خودکار پر می‌شوند.
   *
   * مبلغ فقط وقتی می‌آید که ضریبِ ریالیِ سال تعریف شده باشد؛ وگرنه عنوان و کد
   * پر می‌شود و مبلغ دستِ کاربر می‌ماند — بهتر از گذاشتنِ صفرِ گمراه‌کننده.
   */
  const pickCode = async (hit) => {
    setCodeQ('');
    setCodeHits([]);
    setInternalHits([]);
    setC((s) => ({ ...s, title: hit.title, serviceCode: hit.code, codeSystem: 'book' }));
    try {
      const priced = await api(`/service-codes/price?code=${hit.code}&sector=${data?.tariffSector ?? 'private'}`);
      if (priced.price != null) setC((s) => ({ ...s, unitPrice: String(priced.price) }));
      else onToast('ضریبِ ریالیِ تعرفه تعریف نشده — مبلغ را دستی وارد کنید');
    } catch { /* قیمت اختیاری است */ }
  };

  /** انتخابِ کدِ داخلیِ مطب: نام و مبلغِ مصوبِ خودِ مطب مستقیم می‌نشینند. */
  const pickInternal = (hit) => {
    setCodeQ('');
    setCodeHits([]);
    setInternalHits([]);
    setC((s) => ({ ...s, title: hit.name, serviceCode: hit.code, codeSystem: 'internal', unitPrice: String(hit.price ?? '') }));
  };

  const addCharge = async () => {
    const unitPrice = parseMoney(c.unitPrice);
    if (c.title.trim().length < 2) { onToast('عنوانِ قلم را وارد کنید'); return; }
    if (unitPrice <= 0) { onToast('مبلغ را وارد کنید'); return; }
    setBusy(true);
    try {
      await api(`/visits/${visit.id}/charges`, {
        method: 'POST',
        body: {
          kind: c.kind, title: c.title.trim(),
          quantity: Math.max(1, parseMoney(c.quantity) || 1), unitPrice,
          ...(c.serviceCode ? { serviceCode: c.serviceCode, codeSystem: c.codeSystem || 'book' } : {}),
          ...(c.itemId ? { itemId: c.itemId } : {}),
          ...(c.kind === 'item' ? { stockEffect: c.stockEffect } : {}),
          ...(c.stockEffect === 'consumed' && c.lotId ? { lotId: c.lotId } : {}),
        },
      });
      setC({ kind: 'service', title: '', quantity: '1', unitPrice: '', serviceCode: '', codeSystem: '', itemId: null, lotId: null, stockEffect: 'virtual' });
      setLots([]);
      await load(); onChanged?.();
      onToast('قلم اضافه شد ✓');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  const addPayment = async () => {
    const amount = parseMoney(p.amount);
    if (amount <= 0) { onToast('مبلغِ پرداخت را وارد کنید'); return; }
    let paidAt;
    if (p.dateJ.trim()) {
      paidAt = jStrToIso(p.dateJ);
      if (!paidAt) { onToast('تاریخِ پرداخت نامعتبر است (مثال: ۱۴۰۵/۰۴/۲۸)'); return; }
    }
    setBusy(true);
    try {
      await api(`/visits/${visit.id}/payments`, {
        method: 'POST',
        body: {
          amount, method: p.method, paidAt, reference: p.reference.trim() || undefined,
          bankAccountId: p.bankAccountId ? Number(p.bankAccountId) : undefined,
          receivedById: p.receivedById ? Number(p.receivedById) : undefined,
        },
      });
      setP({ amount: '', method: 'cash', dateJ: todayJStr(), reference: '', bankAccountId: '', receivedById: '' });
      await load(); onChanged?.();
      onToast('پرداخت ثبت شد ✓');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  const remove = async (path, label) => {
    setBusy(true);
    try {
      await api(path, { method: 'DELETE' });
      await load(); onChanged?.();
      onToast(`${label} حذف شد`);
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  return (
    <Overlay backdrop="db-overlay" panel="glass db-sheet bl-sheet" from="bottom" onClose={onClose}>
      <header className="db-sheet-head">
        <b>صورت‌حسابِ {visit.code}</b>
        <button type="button" className="db-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
      </header>

      {!data ? <div className="us-empty">در حال بارگذاری…</div> : (
        <>
          {/* سه عددِ اصلی همیشه بالا — کاربر برای «چقدر مانده» نباید اسکرول کند. */}
          <div className="bl-summary">
            <div>
              <b>{money(data.total)}</b>
              <span>{data.pricingModel === 'global' ? 'مبلغِ کل (گلوبال)' : 'جمعِ کل'}</span>
            </div>
            <div><b>{money(data.paid)}</b><span>پرداخت‌شده</span></div>
            <div className={data.due > 0 ? 'bl-due' : data.due < 0 ? 'bl-over' : ''}>
              <b>{money(Math.abs(data.due))}</b>
              <span>{data.due > 0 ? 'مانده' : data.due < 0 ? 'اضافه‌پرداخت' : 'تسویه'}</span>
            </div>
          </div>

          <PricingBar data={data} busy={busy} setBusy={setBusy} onToast={onToast}
            visitId={visit.id} reload={async () => { await load(); onChanged?.(); }} />

          <Tabs
            variant="inset"
            className="db-modetabs"
            label="بخش‌های صورت‌حساب"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'charges', label: `اقلام (${data.charges.length.toLocaleString('fa-IR')})` },
              { key: 'payments', label: `پرداخت‌ها (${data.payments.length.toLocaleString('fa-IR')})` },
              { key: 'invoice', label: 'صدور فاکتور' },
              /* تسویه همین‌جاست نه در صفحهٔ حسابداری: پولِ این بیمار است، و
                 کاربر برای دیدنِ تقسیمش نباید صفحه عوض کند. */
              { key: 'split', label: 'تسویه' },
            ]}
          />

          {tab === 'invoice' ? (
            <>
              <InvoiceAccount data={data} banks={banks} visitId={visit.id} onSaved={setData} onToast={onToast} />
              <InvoicePanel visit={visit} billing={data} neuro={hasService(cfg, 'ionm')} onToast={onToast} reload={async () => { await load(); onChanged?.(); }} />
            </>
          ) : tab === 'split' ? (
            <Settlement visitId={visit.id} onToast={onToast} onChanged={onChanged} />
          ) : tab === 'charges' ? (
            <>
              <h3 className="bl-section-title">اقلام ثبت‌شده · تومان</h3>
              {data.charges.length === 0 ? <div className="us-empty">قلمی ثبت نشده است</div> : (
                <div className="bl-list bl-charge-list">
                  {data.charges.map((row) => (
                    <div key={row.id} className="bl-row">
                      <span className={`bl-tag t-${row.kind}`}>{CHARGE_KINDS[row.kind] ?? row.kind}</span>
                      <div className="bl-row-main">
                        <b>{row.title}</b>
                        {(row.quantity > 1 || row.serviceCode || row.lot) && (
                          <small>
                            {row.serviceCode && <span dir="ltr">{row.serviceCode}</span>}
                            {row.codeSystem === 'internal' && <em className="bl-internal-tag"> داخلی</em>}
                            {row.quantity > 1 && `${row.serviceCode ? ' · ' : ''}${money(row.quantity)} × ${money(row.unitPrice)}`}
                            {row.lot && (
                              <i className="bl-lot">
                                {row.lot.serialNo ? 'سریال ' : 'لات '}
                                <span dir="ltr">{row.lot.serialNo || row.lot.lotNo || `#${row.lot.lotId}`}</span>
                              </i>
                            )}
                          </small>
                        )}
                      </div>
                      <b className={`bl-amount${row.amount < 0 ? ' neg' : ''}`}>{money(row.amount)}</b>
                      {/* قلمی که کالا از انبار برده، مستقیم حذف نمی‌شود: اول باید
                          معلوم شود کالا واقعاً مصرف شده یا نه. سرور هم بدونِ
                          پرچمِ صریح چیزی به انبار برنمی‌گرداند. */}
                      <button
                        type="button" className="bl-del bl-charge-del" aria-label={`حذف قلم ${row.title}`} disabled={busy}
                        onClick={() => (row.lot ? setDelRow(row) : remove(`/visits/charges/${row.id}`, 'قلم'))}
                      >
                        <Trash width="14" height="14" /> حذف قلم
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="bl-add">
                {/* جستجوی کتابِ ارزش نسبی: کد و عنوان و فی یک‌جا می‌آیند،
                    تا کاربر نه کد را حفظ کند نه فی را دستی حساب کند. */}
                {/* ⚠️ div است نه label: در label، مرورگر کلیکِ روی نتیجهٔ
                    جستجو را به اولین کنترلِ همان label هم می‌فرستد و انتخاب
                    بلافاصله پس گرفته می‌شود. */}
                <div className="db-field bl-codesearch">
                  <span>{c.kind === 'item' ? 'کالا (از کاتالوگ)' : 'کدِ خدمت (کتابِ ارزش نسبی یا کدِ داخلیِ مطب)'}</span>
                  <input
                    value={codeQ}
                    onChange={(e) => setCodeQ(e.target.value)}
                    placeholder={c.kind === 'item'
                      ? 'نام، برند یا کدِ کالا — مثلاً پیچ پدیکولار'
                      : 'کد یا شرحِ خدمت — مثلاً ۹۰۱۳۰۰ یا مانیتورینگ'}
                  />
                  {aiOn && c.kind !== 'item' && (
                    <div className="bl-ai">
                      <button type="button" className="bl-ai-btn" onClick={suggest} disabled={suggBusy}>
                        {suggBusy ? 'دستیار در حالِ خواندنِ شرح…' : 'پیشنهادِ کد از شرح (AI)'}
                      </button>
                      {sugg && sugg.length === 0 && <em className="bl-ai-none">پیشنهادی از شرح درنیامد</em>}
                      {sugg && sugg.map((g) => (
                        <button
                          type="button" key={`${g.codeSystem}-${g.code}`} className="bl-ai-chip"
                          title={g.title}
                          onClick={() => setCodeQ(g.code)}
                        >
                          <b dir="ltr">{g.code}</b>
                          {g.codeSystem === 'internal' && <em className="bl-internal-tag">داخلی</em>}
                          <span>{g.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {c.serviceCode && (
                    <i className="bl-picked">
                      کدِ انتخاب‌شده: <b dir="ltr">{c.serviceCode}</b>
                      {c.codeSystem === 'internal' && <em className="bl-internal-tag">داخلی</em>}
                      <button type="button" onClick={() => setC((s2) => ({ ...s2, serviceCode: '', codeSystem: '' }))}>حذفِ کد</button>
                    </i>
                  )}
                  {c.kind !== 'item' && (codeHits.length > 0 || internalHits.length > 0) && (
                    <div className="bl-hits">
                      {/* کدهای داخلیِ مطب اول — کم‌تعداد و مالِ خودِ مطب‌اند. */}
                      {internalHits.map((h) => (
                        <button type="button" key={`i${h.id}`} onClick={() => pickInternal(h)}>
                          <b dir="ltr">{h.code}</b>
                          <em className="bl-internal-tag">داخلی</em>
                          <span>{h.name} — {money(h.price)} تومان</span>
                        </button>
                      ))}
                      {codeHits.map((h) => (
                        <button type="button" key={h.code} onClick={() => pickCode(h)}>
                          <b dir="ltr">{h.code}</b>
                          <span>{h.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {c.kind === 'item' && itemHits.length > 0 && (
                    <div className="bl-hits">
                      {itemHits.map((it) => (
                        <button type="button" key={it.id} onClick={() => pickItem(it)}>
                          <b>{it.name}</b>
                          <span>
                            {[it.brand, it.size, it.sku].filter(Boolean).join(' · ')}
                            {it.price != null && ` — ${money(it.price)} تومان`}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* اثرِ انبار — نیمهٔ دومِ مدلِ دوبخشی. تا وقتی این انتخاب صریح
                    نبود، «قلمِ مجازیِ عمدی» و «یادم رفت لات بزنم» یک شکل داشتند. */}
                {c.kind === 'item' && c.itemId && (
                  <label className="db-field bl-lotpick">
                    <span>اثر روی انبار</span>
                    <select
                      value={c.stockEffect}
                      onChange={(e) => {
                        const v = e.target.value;
                        const usable = lots.find((l) => !l.expired && l.quantity > 0);
                        setC((s) => ({ ...s, stockEffect: v, lotId: v === 'consumed' ? s.lotId ?? usable?.id ?? null : null }));
                      }}
                    >
                      {Object.entries(STOCK_EFFECTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                )}

                {/* انتخابِ لات فقط برای قلمِ مصرفی. «بدونِ برداشت از انبار» دیگر
                    این‌جا نیست — آن حالت حالا اسم دارد و بالاتر انتخاب می‌شود. */}
                {c.kind === 'item' && c.itemId && c.stockEffect === 'consumed' && (
                  <label className="db-field bl-lotpick">
                    <span>لاتِ مصرفی (موجودی کم می‌شود و به بیمار گره می‌خورد)</span>
                    {lots.length === 0 ? (
                      <p className="db-hint bl-warn">برای این کالا لاتی در انبار نیست — «فقط روی فاکتور» یا «کالای بیمارستان» را انتخاب کنید.</p>
                    ) : (
                      <select value={c.lotId ?? ''} onChange={(e) => setC((s) => ({ ...s, lotId: e.target.value ? Number(e.target.value) : null }))}>
                        <option value="">— لات را انتخاب کنید —</option>
                        {lots.map((l) => (
                          <option key={l.id} value={l.id} disabled={l.expired}>
                            {(l.serialNo ? `سریال ${l.serialNo}` : l.lotNo ? `لات ${l.lotNo}` : `لات #${l.id}`)}
                            {` — ${money(l.quantity)} ${l.unit}`}
                            {l.expired ? ' (منقضی)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                )}

                <div className="db-grid2">
                  <label className="db-field"><span>نوع</span>
                    <select
                      value={c.kind}
                      onChange={(e) => {
                        // با تغییرِ نوع، ارجاعِ قبلی باید برود؛ کدِ خدمت روی
                        // قلمِ کالا (و برعکس) بی‌معنی و گمراه‌کننده است.
                        setCodeQ(''); setCodeHits([]); setItemHits([]); setLots([]);
                        setC((s) => ({ ...s, kind: e.target.value, serviceCode: '', itemId: null, lotId: null }));
                      }}
                    >
                      {Object.entries(CHARGE_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                  <label className="db-field"><span>عنوان</span>
                    <input value={c.title} onChange={(e) => setC((s) => ({ ...s, title: e.target.value }))} placeholder="مثلاً: مانیتورینگ حین عمل" />
                  </label>
                  <label className="db-field"><span>تعداد</span>
                    <input dir="ltr" inputMode="numeric" value={c.quantity} onChange={(e) => setC((s) => ({ ...s, quantity: e.target.value }))} />
                  </label>
                  <label className="db-field"><span>مبلغِ واحد (تومان)</span>
                    <MoneyInput value={c.unitPrice} onChange={(v) => setC((s) => ({ ...s, unitPrice: v }))} placeholder="۰" />
                  </label>
                </div>
                {c.kind === 'discount' && <p className="db-hint">تخفیف را مثبت وارد کنید؛ خودش از جمع کم می‌شود.</p>}
                <button type="button" className="db-submit bl-btn" onClick={addCharge} disabled={busy}>
                  <Plus width="15" height="15" /> افزودنِ قلم
                </button>
                <button type="button" className="bl-mini" onClick={() => setTab('invoice')}>ادامه به صدور فاکتور</button>
              </div>


              <Reconcile rec={data.reconcile} />
            </>
          ) : (
            <>
              <div className="bl-add">
                <div className="db-grid2">
                  <label className="db-field"><span>مبلغ (تومان)</span>
                    <MoneyInput value={p.amount} onChange={(v) => setP((s) => ({ ...s, amount: v }))} placeholder="۰" />
                  </label>
                  <label className="db-field"><span>روش</span>
                    <select value={p.method} onChange={(e) => setP((s) => ({ ...s, method: e.target.value }))}>
                      {Object.entries(METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                  <JDate label="تاریخ (شمسی)" value={p.dateJ}
                    onChange={(v) => setP((s) => ({ ...s, dateJ: v }))} />
                  <label className="db-field"><span>شمارهٔ پیگیری</span>
                    <input dir="ltr" value={p.reference} onChange={(e) => setP((s) => ({ ...s, reference: e.target.value }))} placeholder="اختیاری" />
                  </label>
                  {banks.length > 0 && (
                    <label className="db-field"><span>به کدام حساب</span>
                      <select value={p.bankAccountId} onChange={(e) => setP((s) => ({ ...s, bankAccountId: e.target.value }))}>
                        <option value="">—</option>
                        {banks.filter((b) => !data.invoiceBankAccount || b.id === data.invoiceBankAccount.id).map((b) => <option key={b.id} value={b.id}>{b.ownerName}{b.bankName ? ` · ${b.bankName}` : ''}</option>)}
                      </select>
                    </label>
                  )}
                  {/* ⚠️ اگر پول به حسابِ شخصیِ یک شریک برود، همان لحظه به بقیه
                      بدهکار می‌شود. خالی یعنی حسابِ مشترکِ شرکت و بدهی نمی‌سازد. */}
                  {partners.length > 1 && (
                    <label className="db-field"><span>دریافت‌کننده (شریک)</span>
                      <select value={p.receivedById} onChange={(e) => setP((s) => ({ ...s, receivedById: e.target.value }))}>
                        <option value="">حسابِ شرکت</option>
                        {partners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <button type="button" className="db-submit bl-btn" onClick={addPayment} disabled={busy}>
                  <Plus width="15" height="15" /> ثبتِ پرداخت
                </button>
              </div>

              {data.payments.length === 0 ? <div className="us-empty">پرداختی ثبت نشده است</div> : (
                <div className="bl-list">
                  {data.payments.map((row) => (
                    <div key={row.id} className="bl-row">
                      <span className="bl-tag t-pay">{METHODS[row.method] ?? row.method}</span>
                      <div className="bl-row-main">
                        <b>{faDate(row.paidAt)}</b>
                        {row.reference && <small dir="ltr">{row.reference}</small>}
                      </div>
                      <b className="bl-amount">{money(row.amount)}</b>
                      <button type="button" className="bl-del" disabled={busy} onClick={() => remove(`/visits/payments/${row.id}`, 'پرداخت')}>
                        <Trash width="14" height="14" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      <AnimatePresence>
        {delRow && (
          <DeleteAsk
            row={delRow} busy={busy}
            onClose={() => setDelRow(null)}
            onPick={async (returnStock) => {
              setDelRow(null);
              await remove(`/visits/charges/${delRow.id}${returnStock ? '?returnStock=1' : ''}`, 'قلم');
            }}
          />
        )}
      </AnimatePresence>
    </Overlay>
  );
}

/**
 * تسویهٔ مراجعه — تقسیمِ سهم.
 *
 * دو ستون کنارِ هم: نسخهٔ ذخیره‌شده و پیش‌نمایشِ وضعیتِ فعلی. اگر عددها فرق
 * داشته باشند یعنی از زمانِ محاسبه چیزی عوض شده (فاکتور، قرارداد، هزینه) و
 * تسویه کهنه است — بدونِ نشان‌دادنِ هر دو، کهنه‌بودن نامرئی است.
 */
/**
 * مدلِ قیمت‌گذاریِ فاکتور — «با کد» (جمعِ اقلام) یا «گلوبال» (مبلغِ کلِ توافقی).
 *
 * در گلوبال، اقلام و کدها همچنان ثبت و چاپ می‌شوند ولی جمعشان ملاک نیست؛
 * مبلغِ توافقی مبنای مانده، گزارش و تسویه است — همان مدلِ ملک‌طب.
 */
function PricingBar({ data, busy, setBusy, onToast, visitId, reload }) {
  const [amount, setAmount] = useState('');
  useEffect(() => {
    setAmount(data.globalAmount != null ? String(data.globalAmount) : '');
  }, [data.globalAmount]);

  const setModel = async (model, amountToman) => {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/visits/${visitId}/billing/pricing`, {
        method: 'POST',
        body: model === 'global' ? { pricingModel: 'global', globalAmount: amountToman } : { pricingModel: 'coded' },
      });
      await reload();
      onToast(model === 'global' ? 'مدلِ گلوبال با مبلغِ توافقی ذخیره شد ✓' : 'مدل به «با کد» برگشت — جمعِ اقلام ملاک است');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  const isGlobal = data.pricingModel === 'global';
  return (
    <div className="bl-pricing">
      <div className="bl-pricing-tabs" role="radiogroup" aria-label="مدلِ قیمت‌گذاری">
        <button type="button" role="radio" aria-checked={!isGlobal} className={!isGlobal ? 'on' : ''}
          disabled={busy} onClick={() => { if (isGlobal) setModel('coded'); }}>
          با کد
        </button>
        <button type="button" role="radio" aria-checked={isGlobal} className={isGlobal ? 'on' : ''}
          disabled={busy}
          onClick={() => {
            const v = parseMoney(amount);
            if (!v && !isGlobal) { onToast('اول مبلغِ کلِ توافقی را وارد کنید'); return; }
            if (!isGlobal) setModel('global', v);
          }}>
          گلوبال
        </button>
      </div>
      <MoneyInput value={amount} placeholder="مبلغِ کلِ توافقی (تومان)" aria-label="مبلغِ کلِ توافقی (تومان)"
        onChange={setAmount} />
      {isGlobal && parseMoney(amount) !== (data.globalAmount ?? 0) && (
        <button type="button" className="bl-mini" disabled={busy} onClick={() => setModel('global', parseMoney(amount))}>
          ذخیرهٔ مبلغ
        </button>
      )}
      {isGlobal && data.itemsTotal !== data.total && (
        <small className="bl-pricing-note">جمعِ اقلام {money(data.itemsTotal)} است؛ ملاکِ فاکتور مبلغِ توافقیِ {money(data.total)}.</small>
      )}
    </div>
  );
}

function Settlement({ visitId, onToast, onChanged }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setD(await api(`/visits/${visitId}/settlement`)); }
    catch (e) { onToast(e.message); }
  }, [visitId, onToast]);
  useEffect(() => { load(); }, [load]);

  const act = async (path, msg) => {
    setBusy(true);
    try { await api(path, { method: 'POST' }); await load(); onChanged?.(); onToast(msg); }
    catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  if (!d) return <div className="us-empty">در حال بارگذاری…</div>;
  const saved = d.settlement;
  const now = d.preview;
  const stale = saved && (saved.revenue !== now.revenue || saved.cost !== now.cost);

  return (
    <div className="bl-split">
      {now.warnings?.length > 0 && (
        <div className="bl-warns">{now.warnings.map((w) => <p key={w}><Alert size={12} /> {w}</p>)}</div>
      )}

      {saved ? (
        <>
          <div className="bl-splithead">
            <span className={`bl-vtag ${saved.status}`}>{saved.status === 'final' ? 'نهایی' : 'پیش‌نویس'}</span>
            نسخهٔ {money(saved.version)} · {faDate(saved.createdAt)}
          </div>
          <ShareList list={saved.entries} revenue={saved.revenue} />
          {stale && (
            <p className="bl-stale">
              از زمانِ محاسبه چیزی عوض شده — درآمدِ فعلی {money(now.revenue)} است، نه {money(saved.revenue)}.
              برای به‌روزرسانی دوباره محاسبه کنید.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="bl-splithead"><span className="bl-vtag draft">محاسبه‌نشده</span> پیش‌نمایش بر اساسِ وضعیتِ فعلی</div>
          <ShareList list={now.entries} revenue={now.revenue} />
        </>
      )}

      {saved?.status === 'final' && <Payouts visitId={visitId} onToast={onToast} />}

      <div className="bl-splitacts">
        {saved?.status === 'final' ? (
          <button type="button" className="bl-mini warn" disabled={busy}
                  onClick={() => act(`/visits/${visitId}/settlement/reopen`, 'تسویه باطل شد')}>
            باطل‌کردنِ تسویهٔ نهایی
          </button>
        ) : (
          <>
            <button type="button" className="db-submit" disabled={busy}
                    onClick={() => act(`/visits/${visitId}/settlement`, 'تسویه محاسبه شد ✓')}>
              {saved ? 'محاسبهٔ دوباره' : 'محاسبه و ذخیره'}
            </button>
            {saved && (
              <button type="button" className="bl-mini" disabled={busy}
                      onClick={() => act(`/visits/${visitId}/settlement/finalize`, 'تسویه نهایی شد ✓')}>
                نهایی‌کردن
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * پرداختِ سهم — فقط پس از نهایی‌شدنِ تسویه.
 *
 * «استحقاق» از تسویهٔ جاری می‌آید و «پرداخت‌شده» از دفترِ پرداخت‌ها؛ مانده مشتق
 * است. روی خودِ ShareEntry ذخیره نمی‌شود چون تسویه نسخه‌دار است و با محاسبهٔ
 * دوباره پاک می‌شد.
 */
function Payouts({ visitId, onToast }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [banks, setBanks] = useState([]);

  const load = useCallback(async () => {
    try { setD(await api(`/visits/${visitId}/payouts`)); } catch (e) { onToast(e.message); }
  }, [visitId, onToast]);
  useEffect(() => { load(); api('/bank-accounts').then(setBanks).catch(() => setBanks([])); }, [load]);

  const pay = async (row, bankAccountId) => {
    setBusy(true);
    try {
      await api(`/visits/${visitId}/payouts`, {
        method: 'POST',
        body: {
          party: row.party, partyId: row.partyId ?? undefined, partyName: row.partyName,
          amount: row.remaining, bankAccountId: bankAccountId || undefined,
        },
      });
      await load(); onToast('پرداختِ سهم ثبت شد ✓');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  if (!d) return null;
  return (
    <div className="bl-payouts">
      <b>پرداختِ سهم‌ها</b>
      {d.rows.map((r) => (
        <div key={`${r.party}-${r.partyId}`} className={`bl-po${r.remaining <= 0 ? ' done' : ''}`}>
          <span>{r.partyName}</span>
          <i>{money(r.paid)} از {money(r.entitled)}</i>
          {r.remaining > 0 ? (
            <button type="button" disabled={busy} onClick={() => pay(r, banks[0]?.id)}>
              پرداختِ {money(r.remaining)}
            </button>
          ) : <em>تسویه ✓</em>}
        </div>
      ))}
    </div>
  );
}

/** فهرستِ سهم‌ها با مبنای هر کدام — «چرا این عدد» باید روی صفحه باشد. */
function ShareList({ list, revenue }) {
  const why = (b) => {
    if (!b) return '';
    if (b.kind === 'percent') return `${money(b.percent)}٪ از ${money(b.of)}`;
    if (b.kind === 'fixed') return 'مبلغِ ثابت';
    return 'هزینهٔ مستقیم';
  };
  return (
    <div className="bl-shares">
      <div className="bl-share total"><b>درآمدِ کل</b><i>{money(revenue)}</i></div>
      {list.map((e, i) => (
        <div key={i} className={`bl-share p-${e.party}`}>
          <b>{e.partyLabel}<small>{e.partyName}</small></b>
          <span>{why(e.basis)}</span>
          <i>{money(e.amount)}</i>
        </div>
      ))}
    </div>
  );
}

/**
 * سؤالِ حذفِ قلمِ مصرفی.
 *
 * دو دکمه، چون واقعاً دو حالتِ متفاوتِ دنیای واقعی است و سیستم نمی‌تواند حدس
 * بزند کدام: پیچی که داخلِ بدنِ بیمار است هیچ‌وقت به انبار برنمی‌گردد، ولی
 * پیچی که از ست در آمد و باز نشد باید برگردد.
 */
function DeleteAsk({ row, busy, onClose, onPick }) {
  const lot = row.lot?.serialNo ? `سریال ${row.lot.serialNo}` : row.lot?.lotNo ? `لات ${row.lot.lotNo}` : `لات #${row.lot?.lotId}`;
  return (
    <Overlay backdrop="db-overlay bl-ask-wrap" panel="glass bl-ask" from="bottom" onClose={onClose}>
      <b>حذفِ «{row.title}»</b>
      <p>این قلم <span dir="ltr">{lot}</span> را از انبار خارج کرده است. کالا واقعاً مصرف شد؟</p>
      <button type="button" className="db-submit" disabled={busy} onClick={() => onPick(false)}>
        بله، مصرف شد — فقط قلمِ فاکتور حذف شود
      </button>
      <button type="button" className="bl-ask-alt" disabled={busy} onClick={() => onPick(true)}>
        نه، مصرف نشد — به انبار برگردد
      </button>
      <button type="button" className="bl-ask-cancel" onClick={onClose}>انصراف</button>
    </Overlay>
  );
}

/**
 * مغایرتِ فاکتور در برابر مصرف.
 *
 * هیچ‌کدام از این سه دسته «خطا» نیستند — واقعیتِ کارند و تصمیم با کاربر است.
 * چیزی که تا حالا نبود، دیدنشان بود. همه از سرور آماده می‌آیند (قانون ۱۷)؛
 * این‌جا فقط نمایش است.
 */
function Reconcile({ rec }) {
  if (!rec) return null;
  const { billedNotConsumed: nb = [], consumedNotBilled: cn = [], offStock: off = [] } = rec;
  if (!nb.length && !cn.length && !off.length) return null;
  return (
    <div className="bl-rec">
      <b>فاکتور در برابرِ مصرف</b>
      {cn.length > 0 && (
        <div className="bl-rec-g warn">
          <span>مصرف شد ولی روی فاکتور نیست</span>
          <ul>
            {cn.map((m) => (
              <li key={m.movementId}>
                {m.itemName} ×{money(m.quantity)}
                {(m.serialNo || m.lotNo) && <i dir="ltr"> {m.serialNo || m.lotNo}</i>}
                {m.orphaned && <em> — قلمش از فاکتور حذف شده</em>}
                {m.reason && <small> · {m.reason}</small>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {nb.length > 0 && (
        <div className="bl-rec-g warn">
          <span>روی فاکتور هست ولی از انبار خارج نشده</span>
          <ul>{nb.map((x) => <li key={x.chargeId}>{x.title} ×{money(x.quantity)}</li>)}</ul>
        </div>
      )}
      {off.length > 0 && (
        <div className="bl-rec-g">
          <span>عمداً خارج از انبارِ ما</span>
          <ul>
            {off.map((x) => <li key={x.chargeId}>{x.title} <i>{STOCK_EFFECTS[x.stockEffect]}</i></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function InvoiceAccount({ data, banks, visitId, onSaved, onToast }) {
  const [type, setType] = useState(data.invoiceType ?? '');
  const [bankId, setBankId] = useState(data.invoiceBankAccount?.id ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      onSaved(await api(`/visits/${visitId}/billing/invoice-account`, { method: 'POST', body: { invoiceType: type, bankAccountId: Number(bankId) } }));
      onToast('نوع فاکتور و حساب دریافت ذخیره شد');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };
  return <fieldset className="db-field" disabled={busy}>
    <legend>نوع فاکتور و حساب دریافت</legend>
    <select aria-label="نوع فاکتور" value={type} onChange={(e) => { setType(e.target.value); setBankId(''); }}>
      <option value="">انتخاب کنید</option><option value="formal">رسمی</option><option value="informal">غیررسمی</option>
    </select>
    <select aria-label="حساب فاکتور" value={bankId} onChange={(e) => setBankId(e.target.value)}>
      <option value="">حساب هم‌نوع فاکتور را انتخاب کنید</option>
      {banks.filter((b) => b.classification === type).map((b) => <option key={b.id} value={b.id}>{b.ownerName} · {b.bankName}</option>)}
    </select>
    <button type="button" className="bl-mini" disabled={!type || !bankId || busy} onClick={save}>ثبت اتصال حساب</button>
    {data.invoiceBankAccount && <small>حساب ثبت‌شده: {data.invoiceBankAccount.ownerName} · {data.invoiceType === 'formal' ? 'رسمی' : 'غیررسمی'}</small>}
  </fieldset>;
}
