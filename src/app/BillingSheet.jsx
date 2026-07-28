import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { faDate, jStrToIso, todayJStr } from '../lib/jalali.js';
import { toEnDigits } from '../lib/identity.js';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
const XIc = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>);
const Trash = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>);
const Plus = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M12 5v14M5 12h14" /></svg>);

const CHARGE_KINDS = { service: 'خدمت', item: 'کالا', discount: 'تخفیف' };
const METHODS = { cash: 'نقدی', card: 'کارت‌خوان', transfer: 'انتقال', cheque: 'چک', insurance: 'بیمه' };

const money = (n) => Number(n || 0).toLocaleString('fa-IR');
/** ورودیِ مبلغ: ارقامِ فارسی و جداکنندهٔ هزارگان را می‌پذیرد. */
const parseMoney = (v) => {
  const digits = toEnDigits(String(v ?? '')).replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
};

export default function BillingSheet({ visit, onClose, onChanged, onToast }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('charges');

  const [c, setC] = useState({ kind: 'service', title: '', quantity: '1', unitPrice: '' });
  const [p, setP] = useState({ amount: '', method: 'cash', dateJ: todayJStr(), reference: '' });

  const load = useCallback(async () => {
    try { setData(await api(`/visits/${visit.id}/billing`)); }
    catch (e) { onToast(e.message); onClose(); }
  }, [visit.id, onClose, onToast]);
  useEffect(() => { load(); }, [load]);

  const addCharge = async () => {
    const unitPrice = parseMoney(c.unitPrice);
    if (c.title.trim().length < 2) { onToast('عنوانِ قلم را وارد کنید'); return; }
    if (unitPrice <= 0) { onToast('مبلغ را وارد کنید'); return; }
    setBusy(true);
    try {
      await api(`/visits/${visit.id}/charges`, {
        method: 'POST',
        body: { kind: c.kind, title: c.title.trim(), quantity: Math.max(1, parseMoney(c.quantity) || 1), unitPrice },
      });
      setC({ kind: 'service', title: '', quantity: '1', unitPrice: '' });
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
        body: { amount, method: p.method, paidAt, reference: p.reference.trim() || undefined },
      });
      setP({ amount: '', method: 'cash', dateJ: todayJStr(), reference: '' });
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
    <div className="db-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass db-sheet bl-sheet">
        <header className="db-sheet-head">
          <b>صورت‌حسابِ {visit.code}</b>
          <button type="button" className="db-x" onClick={onClose} aria-label="بستن"><XIc width="18" height="18" /></button>
        </header>

        {!data ? <div className="us-empty">در حال بارگذاری…</div> : (
          <>
            {/* سه عددِ اصلی همیشه بالا — کاربر برای «چقدر مانده» نباید اسکرول کند. */}
            <div className="bl-summary">
              <div><b>{money(data.total)}</b><span>جمعِ کل</span></div>
              <div><b>{money(data.paid)}</b><span>پرداخت‌شده</span></div>
              <div className={data.due > 0 ? 'bl-due' : data.due < 0 ? 'bl-over' : ''}>
                <b>{money(Math.abs(data.due))}</b>
                <span>{data.due > 0 ? 'مانده' : data.due < 0 ? 'اضافه‌پرداخت' : 'تسویه'}</span>
              </div>
            </div>

            <div className="lg-tabs db-modetabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'charges'} className={tab === 'charges' ? 'on' : ''} onClick={() => setTab('charges')}>
                اقلام ({data.charges.length.toLocaleString('fa-IR')})
              </button>
              <button type="button" role="tab" aria-selected={tab === 'payments'} className={tab === 'payments' ? 'on' : ''} onClick={() => setTab('payments')}>
                پرداخت‌ها ({data.payments.length.toLocaleString('fa-IR')})
              </button>
            </div>

            {tab === 'charges' ? (
              <>
                <div className="bl-add">
                  <div className="db-grid2">
                    <label className="db-field"><span>نوع</span>
                      <select value={c.kind} onChange={(e) => setC((s) => ({ ...s, kind: e.target.value }))}>
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
                      <input dir="ltr" inputMode="numeric" value={c.unitPrice} onChange={(e) => setC((s) => ({ ...s, unitPrice: e.target.value }))} placeholder="۰" />
                    </label>
                  </div>
                  {c.kind === 'discount' && <p className="db-hint">تخفیف را مثبت وارد کنید؛ خودش از جمع کم می‌شود.</p>}
                  <button type="button" className="db-submit bl-btn" onClick={addCharge} disabled={busy}>
                    <Plus width="15" height="15" /> افزودنِ قلم
                  </button>
                </div>

                {data.charges.length === 0 ? <div className="us-empty">قلمی ثبت نشده است</div> : (
                  <div className="bl-list">
                    {data.charges.map((row) => (
                      <div key={row.id} className="bl-row">
                        <span className={`bl-tag t-${row.kind}`}>{CHARGE_KINDS[row.kind] ?? row.kind}</span>
                        <div className="bl-row-main">
                          <b>{row.title}</b>
                          {row.quantity > 1 && <small>{money(row.quantity)} × {money(row.unitPrice)}</small>}
                        </div>
                        <b className={`bl-amount${row.amount < 0 ? ' neg' : ''}`}>{money(row.amount)}</b>
                        <button type="button" className="bl-del" disabled={busy} onClick={() => remove(`/visits/charges/${row.id}`, 'قلم')}>
                          <Trash width="14" height="14" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="bl-add">
                  <div className="db-grid2">
                    <label className="db-field"><span>مبلغ (تومان)</span>
                      <input dir="ltr" inputMode="numeric" value={p.amount} onChange={(e) => setP((s) => ({ ...s, amount: e.target.value }))} placeholder="۰" />
                    </label>
                    <label className="db-field"><span>روش</span>
                      <select value={p.method} onChange={(e) => setP((s) => ({ ...s, method: e.target.value }))}>
                        {Object.entries(METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </label>
                    <label className="db-field"><span>تاریخ (شمسی)</span>
                      <input dir="ltr" inputMode="numeric" value={p.dateJ} onChange={(e) => setP((s) => ({ ...s, dateJ: e.target.value }))} />
                    </label>
                    <label className="db-field"><span>شمارهٔ پیگیری</span>
                      <input dir="ltr" value={p.reference} onChange={(e) => setP((s) => ({ ...s, reference: e.target.value }))} placeholder="اختیاری" />
                    </label>
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
      </div>
    </div>
  );
}
