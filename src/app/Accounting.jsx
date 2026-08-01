import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { faDate, jStrToIso, todayJStr, toEnDigits } from '../lib/jalali.js';
import JDate from './JDate.jsx';
import './accounting.css';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Back = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M9 6l6 6-6 6" /></svg>);
const Plus = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M12 5v14M5 12h14" /></svg>);

const num = (n) => Number(n ?? 0).toLocaleString('fa-IR');
const parseNum = (v) => {
  const d = toEnDigits(String(v ?? '')).replace(/[^0-9]/g, '');
  return d ? Number(d) : 0;
};

/**
 * حسابداری — قراردادِ جراح و سهامداران.
 *
 * تسویهٔ هر مراجعه عمداً این‌جا نیست: آن‌جا که پولِ یک بیمار است، یعنی داخلِ
 * صورت‌حسابِ همان مراجعه. این صفحه فقط **قواعد** را نگه می‌دارد.
 */
export default function Accounting() {
  const [tab, setTab] = useState('treasury');
  const [toast, setToast] = useState('');

  useEffect(() => { document.title = 'عمل‌یار — حسابداری'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="ac">
      <div className="ac-bg" aria-hidden="true" />
      <header className="ac-head">
        <Link to="/app" className="ac-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1>حسابداری</h1>
          <p>قاعده‌ها این‌جا تعریف می‌شوند؛ تقسیمِ سهمِ هر عمل در صورت‌حسابِ همان مراجعه است.</p>
        </div>
      </header>

      <div className="ac-tabs">
        {[['treasury', 'خزانه'], ['contracts', 'قراردادِ جراحان'], ['partners', 'سهامداران'], ['expenses', 'هزینه‌ها'], ['banks', 'حساب‌های بانکی'], ['ledger', 'حسابِ جاریِ شرکا'], ['cheques', 'چک‌ها'], ['fiscal', 'سالِ مالی']].map(([k, l]) => (
          <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'contracts' && <Contracts onToast={setToast} />}
      {tab === 'partners' && <Partners onToast={setToast} />}
      {tab === 'expenses' && <Expenses onToast={setToast} />}
      {tab === 'banks' && <Banks onToast={setToast} />}
      {tab === 'ledger' && <Ledger onToast={setToast} />}
      {tab === 'treasury' && <Treasury onToast={setToast} />}
      {tab === 'cheques' && <Cheques onToast={setToast} />}
      {tab === 'fiscal' && <Fiscal onToast={setToast} />}
      {toast && <div className="ac-toast" role="status">{toast}</div>}
    </div>
  );
}

/**
 * قراردادها.
 *
 * ⚠️ ردیفِ قدیمی ویرایش نمی‌شود؛ قراردادِ تازه با تاریخِ شروعِ تازه اضافه می‌شود.
 * دلیلش روی خودِ صفحه نوشته شده، وگرنه کاربر دنبالِ دکمهٔ «ویرایش» می‌گردد و
 * نبودنش را نقص می‌بیند نه تصمیم.
 */
function Contracts({ onToast }) {
  const [rows, setRows] = useState([]);
  const [surgeons, setSurgeons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ surgeonId: '', kind: 'percent', percent: '', amount: '', fromJ: todayJStr(), notes: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, s] = await Promise.all([api('/contracts'), api('/surgeons')]);
      setRows(c);
      setSurgeons(s.filter((x) => x.active !== false));
    } catch (e) { onToast(e.message); }
    finally { setLoading(false); }
  }, [onToast]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!f.surgeonId) { onToast('جراح را انتخاب کنید'); return; }
    const effectiveFrom = f.fromJ.trim() ? jStrToIso(f.fromJ) : undefined;
    if (f.fromJ.trim() && !effectiveFrom) { onToast('تاریخِ شروع نامعتبر است (مثال: ۱۴۰۵/۰۵/۰۹)'); return; }
    setBusy(true);
    try {
      await api('/contracts', {
        method: 'POST',
        body: {
          surgeonId: Number(f.surgeonId), kind: f.kind,
          ...(f.kind === 'percent' ? { percent: parseNum(f.percent) } : { amount: parseNum(f.amount) }),
          effectiveFrom, notes: f.notes.trim() || undefined,
        },
      });
      setF((s) => ({ ...s, percent: '', amount: '', notes: '' }));
      await load();
      onToast('قرارداد ثبت شد ✓');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  const drop = async (id) => {
    setBusy(true);
    try { await api(`/contracts/${id}`, { method: 'DELETE' }); await load(); onToast('قرارداد غیرفعال شد'); }
    catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="ac-add">
        <div className="ac-grid">
          <label className="ac-field"><span>جراح *</span>
            <select value={f.surgeonId} onChange={(e) => setF((s) => ({ ...s, surgeonId: e.target.value }))}>
              <option value="">— انتخاب —</option>
              {surgeons.map((s) => <option key={s.id} value={s.id}>{s.name ?? `${s.firstName} ${s.lastName}`}</option>)}
            </select>
          </label>
          <label className="ac-field"><span>نوع</span>
            <select value={f.kind} onChange={(e) => setF((s) => ({ ...s, kind: e.target.value }))}>
              <option value="percent">درصدی از فاکتور</option>
              <option value="fixed">مبلغِ ثابت</option>
            </select>
          </label>
          {f.kind === 'percent' ? (
            <label className="ac-field"><span>درصد</span>
              <input dir="ltr" inputMode="numeric" value={f.percent} onChange={(e) => setF((s) => ({ ...s, percent: e.target.value }))} placeholder="۳۰" />
            </label>
          ) : (
            <label className="ac-field"><span>مبلغ (تومان)</span>
              <input dir="ltr" inputMode="numeric" value={f.amount} onChange={(e) => setF((s) => ({ ...s, amount: e.target.value }))} placeholder="۰" />
            </label>
          )}
          <JDate label="معتبر از تاریخ" value={f.fromJ} onChange={(v) => setF((s) => ({ ...s, fromJ: v }))} />
        </div>
        <p className="ac-hint">
          قرارداد <b>تاریخ‌دار</b> است و ویرایش نمی‌شود: عملِ پارسال باید با قراردادِ پارسال حساب شود.
          برای تغییرِ شرایط، قراردادِ تازه با تاریخِ شروعِ تازه اضافه کنید.
        </p>
        <button type="button" className="ac-submit" onClick={submit} disabled={busy}>
          <Plus width="15" height="15" /> ثبتِ قرارداد
        </button>
      </div>

      <div className="ac-list">
        {loading && <div className="ac-empty">در حال بارگذاری…</div>}
        {!loading && rows.length === 0 && <div className="ac-empty">هنوز قراردادی ثبت نشده</div>}
        {!loading && rows.map((r) => (
          <article key={r.id} className={`ac-row${r.active ? '' : ' off'}`}>
            <div className="ac-val">
              <b>{r.kind === 'percent' ? `${num(r.percent)}٪` : num(r.amount)}</b>
              <span>{r.kind === 'percent' ? 'از فاکتور' : 'تومان'}</span>
            </div>
            <div className="ac-row-main">
              <b>{r.surgeonName}</b>
              <small>معتبر از {faDate(r.effectiveFrom)}{r.active ? '' : ' · غیرفعال'}</small>
              {r.notes && <small className="ac-note">{r.notes}</small>}
            </div>
            {r.active && (
              <button type="button" className="ac-off" disabled={busy} onClick={() => drop(r.id)}>غیرفعال</button>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

/**
 * سهامداران.
 *
 * فهرست یک‌جا ذخیره می‌شود چون شرطِ «جمعاً ۱۰۰٪» فقط روی کلِ فهرست معنا دارد؛
 * با ذخیرهٔ تکی، سامانه بینِ دو ذخیره در حالتِ نامعتبر می‌ماند.
 */
function Partners({ onToast }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await api('/partners');
      const active = all.filter((p) => p.active);
      setRows(active.length ? active.map((p) => ({ name: p.name, percent: String(p.percent), color: p.color ?? '' })) : [{ name: '', percent: '', color: '' }]);
    } catch (e) { onToast(e.message); }
    finally { setLoading(false); }
  }, [onToast]);
  useEffect(() => { load(); }, [load]);

  const total = rows.reduce((s, r) => s + parseNum(r.percent), 0);

  const save = async () => {
    setBusy(true);
    try {
      await api('/partners', {
        method: 'POST',
        body: { partners: rows.map((r) => ({ name: r.name.trim(), percent: parseNum(r.percent), color: r.color.trim() || undefined })) },
      });
      await load();
      onToast('سهامداران ذخیره شدند ✓');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  if (loading) return <div className="ac-empty">در حال بارگذاری…</div>;

  return (
    <div className="ac-add">
      {rows.map((r, i) => (
        <div key={i} className="ac-prow">
          <input className="ac-pname" value={r.name} placeholder="نامِ سهامدار"
                 onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input className="ac-ppct" dir="ltr" inputMode="numeric" value={r.percent} placeholder="۵۰"
                 onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} />
          <span className="ac-pc">٪</span>
          <input className="ac-pcolor" type="color" value={r.color || '#7c3aed'}
                 onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
          <button type="button" className="ac-prm" disabled={rows.length === 1}
                  onClick={() => setRows((s) => s.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="ac-padd" onClick={() => setRows((s) => [...s, { name: '', percent: '', color: '' }])}>
        <Plus width="14" height="14" /> سهامدارِ دیگر
      </button>

      <p className={`ac-total${total === 100 ? ' ok' : ''}`}>
        جمعِ درصدها: {num(total)}٪ {total === 100 ? '✓' : '— باید دقیقاً ۱۰۰ شود'}
      </p>
      <button type="button" className="ac-submit" onClick={save} disabled={busy || total !== 100}>ذخیرهٔ سهامداران</button>
    </div>
  );
}

/**
 * هزینه‌های شرکت.
 *
 * «پرداخت‌کننده» اختیاری است ولی مهم‌ترین فیلد است: اگر شریکی از جیبِ خودش داده
 * باشد، همان لحظه بدهیِ بقیه در دفترِ حسابِ جاری ثبت می‌شود. خالی‌گذاشتنش یعنی
 * از حسابِ مشترکِ شرکت رفته و بینِ شرکا بدهی نمی‌سازد.
 */
function Expenses({ onToast }) {
  const [d, setD] = useState(null);
  const [partners, setPartners] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [f, setF] = useState({ title: '', category: '', amount: '', dateJ: todayJStr(), paidById: '', bankAccountId: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [e, p, b] = await Promise.all([api('/expenses'), api('/partners'), api('/bank-accounts')]);
      setD(e); setPartners(p.filter((x) => x.active)); setAccounts(b);
    } catch (e) { onToast(e.message); }
  }, [onToast]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    const amount = parseNum(f.amount);
    if (f.title.trim().length < 2) { onToast('عنوانِ هزینه را وارد کنید'); return; }
    if (amount <= 0) { onToast('مبلغ را وارد کنید'); return; }
    const spentAt = f.dateJ.trim() ? jStrToIso(f.dateJ) : undefined;
    if (f.dateJ.trim() && !spentAt) { onToast('تاریخ نامعتبر است'); return; }
    setBusy(true);
    try {
      await api('/expenses', {
        method: 'POST',
        body: {
          title: f.title.trim(), amount, spentAt,
          category: f.category.trim() || undefined,
          paidById: f.paidById ? Number(f.paidById) : undefined,
          bankAccountId: f.bankAccountId ? Number(f.bankAccountId) : undefined,
        },
      });
      setF((s) => ({ ...s, title: '', category: '', amount: '' }));
      await load(); onToast('هزینه ثبت شد ✓');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  const drop = async (id) => {
    setBusy(true);
    try { await api(`/expenses/${id}`, { method: 'DELETE' }); await load(); onToast('هزینه حذف شد'); }
    catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  if (!d) return <div className="ac-empty">در حال بارگذاری…</div>;
  return (
    <>
      <div className="ac-add">
        <div className="ac-grid">
          <label className="ac-field"><span>عنوان *</span>
            <input value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} placeholder="مثلاً: اجارهٔ دفتر" />
          </label>
          <label className="ac-field"><span>دسته</span>
            <input value={f.category} onChange={(e) => setF((s) => ({ ...s, category: e.target.value }))} placeholder="اداری، حمل‌ونقل…" />
          </label>
          <label className="ac-field"><span>مبلغ (تومان) *</span>
            <input dir="ltr" inputMode="numeric" value={f.amount} onChange={(e) => setF((s) => ({ ...s, amount: e.target.value }))} placeholder="۰" />
          </label>
          <JDate label="تاریخ" value={f.dateJ} onChange={(v) => setF((s) => ({ ...s, dateJ: v }))} />
          <label className="ac-field"><span>پرداخت‌کننده (شریک)</span>
            <select value={f.paidById} onChange={(e) => setF((s) => ({ ...s, paidById: e.target.value }))}>
              <option value="">از حسابِ شرکت</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="ac-field"><span>حساب</span>
            <select value={f.bankAccountId} onChange={(e) => setF((s) => ({ ...s, bankAccountId: e.target.value }))}>
              <option value="">—</option>
              {accounts.map((b) => <option key={b.id} value={b.id}>{b.ownerName}{b.bankName ? ` · ${b.bankName}` : ''}</option>)}
            </select>
          </label>
        </div>
        <p className="ac-hint">
          اگر <b>شریکی از جیبِ خودش</b> داده، پرداخت‌کننده را انتخاب کنید — بدهیِ بقیه خودکار در حسابِ جاری ثبت می‌شود.
        </p>
        <button type="button" className="ac-submit" onClick={submit} disabled={busy}>
          <Plus width="15" height="15" /> ثبتِ هزینه
        </button>
      </div>

      <div className="ac-list">
        <p className="ac-total ok">جمعِ هزینه‌ها: {num(d.total)} تومان</p>
        {d.rows.length === 0 && <div className="ac-empty">هزینه‌ای ثبت نشده</div>}
        {d.rows.map((e) => (
          <article key={e.id} className="ac-row">
            <div className="ac-val"><b>{num(e.amount)}</b><span>تومان</span></div>
            <div className="ac-row-main">
              <b>{e.title}</b>
              <small>{faDate(e.spentAt)}{e.category ? ` · ${e.category}` : ''}{e.paidByName ? ` · پرداختِ ${e.paidByName}` : ''}</small>
            </div>
            <button type="button" className="ac-off" disabled={busy} onClick={() => drop(e.id)}>حذف</button>
          </article>
        ))}
      </div>
    </>
  );
}

/** حساب‌های بانکی — شرکت یا شخصیِ یک شریک. */
function Banks({ onToast }) {
  const [rows, setRows] = useState([]);
  const [partners, setPartners] = useState([]);
  const [f, setF] = useState({ ownerName: '', bankName: '', cardNumber: '', iban: '', partnerId: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, p] = await Promise.all([api('/bank-accounts?all=1'), api('/partners')]);
      setRows(b); setPartners(p.filter((x) => x.active));
    } catch (e) { onToast(e.message); }
  }, [onToast]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (f.ownerName.trim().length < 2) { onToast('نامِ صاحبِ حساب را وارد کنید'); return; }
    setBusy(true);
    try {
      await api('/bank-accounts', {
        method: 'POST',
        body: {
          ownerName: f.ownerName.trim(), bankName: f.bankName.trim() || undefined,
          cardNumber: f.cardNumber.trim() || undefined, iban: f.iban.trim() || undefined,
          partnerId: f.partnerId ? Number(f.partnerId) : undefined,
        },
      });
      setF({ ownerName: '', bankName: '', cardNumber: '', iban: '', partnerId: '' });
      await load(); onToast('حساب اضافه شد ✓');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="ac-add">
        <div className="ac-grid">
          <label className="ac-field"><span>صاحبِ حساب *</span>
            <input value={f.ownerName} onChange={(e) => setF((s) => ({ ...s, ownerName: e.target.value }))} />
          </label>
          <label className="ac-field"><span>بانک</span>
            <input value={f.bankName} onChange={(e) => setF((s) => ({ ...s, bankName: e.target.value }))} />
          </label>
          <label className="ac-field"><span>شمارهٔ کارت</span>
            <input dir="ltr" value={f.cardNumber} onChange={(e) => setF((s) => ({ ...s, cardNumber: e.target.value }))} />
          </label>
          <label className="ac-field"><span>شبا</span>
            <input dir="ltr" value={f.iban} onChange={(e) => setF((s) => ({ ...s, iban: e.target.value }))} placeholder="IR..." />
          </label>
          <label className="ac-field"><span>حسابِ شخصیِ کدام شریک</span>
            <select value={f.partnerId} onChange={(e) => setF((s) => ({ ...s, partnerId: e.target.value }))}>
              <option value="">حسابِ شرکت</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
        <button type="button" className="ac-submit" onClick={submit} disabled={busy}>
          <Plus width="15" height="15" /> افزودنِ حساب
        </button>
      </div>
      <div className="ac-list">
        {rows.length === 0 && <div className="ac-empty">حسابی ثبت نشده</div>}
        {rows.map((b) => (
          <article key={b.id} className={`ac-row${b.active ? '' : ' off'}`}>
            <div className="ac-row-main">
              <b>{b.ownerName}{b.bankName ? ` — ${b.bankName}` : ''}</b>
              <small dir="ltr">{b.iban || b.cardNumber || '—'}</small>
              {b.partner && <small>حسابِ شخصیِ {b.partner.name}</small>}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

/**
 * حسابِ جاریِ شرکا.
 *
 * فقط **خالص** نشان داده می‌شود: «الف ۵ به ب بدهکار، ب ۳ به الف بدهکار» برای
 * کاربر بی‌معنی است؛ او می‌خواهد بداند «الف ۲ به ب بدهکار است».
 */
function Ledger({ onToast }) {
  const [sum, setSum] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([api('/ledger/summary'), api('/ledger')]);
      setSum(s); setRows(e);
    } catch (e) { onToast(e.message); }
  }, [onToast]);
  useEffect(() => { load(); }, [load]);

  const settle = async (pair) => {
    setBusy(true);
    try {
      await api('/ledger/settle', {
        method: 'POST',
        body: { fromPartnerId: pair.fromId, toPartnerId: pair.toId, amount: pair.amount },
      });
      await load(); onToast('تسویه ثبت شد ✓');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  if (!sum) return <div className="ac-empty">در حال بارگذاری…</div>;
  return (
    <>
      <div className="ac-add">
        {sum.pairs.length === 0 ? (
          <p className="ac-total ok">حسابِ شرکا تسویه است ✓</p>
        ) : sum.pairs.map((p) => (
          <div key={`${p.fromId}-${p.toId}`} className="ac-pair">
            <b>{p.fromName}</b>
            <span>به</span>
            <b>{p.toName}</b>
            <i>{num(p.amount)} تومان</i>
            <button type="button" className="ac-mini" disabled={busy} onClick={() => settle(p)}>ثبتِ پرداختِ کامل</button>
          </div>
        ))}
      </div>
      <div className="ac-list">
        {rows.map((r) => (
          <article key={r.id} className="ac-row">
            <div className="ac-val"><b>{num(r.amount)}</b><span>{r.typeLabel}</span></div>
            <div className="ac-row-main">
              <b>{r.fromName} → {r.toName}</b>
              <small>{faDate(r.entryDate)}{r.description ? ` · ${r.description}` : ''}</small>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

/**
 * خزانه — موجودیِ هر حساب.
 *
 * ⚠️ چکِ در جریان عمداً **بیرونِ** موجودی گزارش می‌شود: پولی که هنوز وصول نشده
 * پول نیست، و ریختنش در موجودی یعنی خزانه رقمی نشان بدهد که در حساب نیست.
 */
function Treasury({ onToast }) {
  const [d, setD] = useState(null);
  useEffect(() => { api('/treasury').then(setD).catch((e) => onToast(e.message)); }, [onToast]);
  if (!d) return <div className="ac-empty">در حال بارگذاری…</div>;
  return (
    <>
      <div className="ac-add">
        <div className="ac-tre">
          <div className="big"><b>{num(d.total)}</b><span>جمعِ موجودی (تومان)</span></div>
          <div><b className="in">{num(d.chequesPendingIn)}</b><span>چکِ دریافتیِ در جریان</span></div>
          <div><b className="out">{num(d.chequesPendingOut)}</b><span>چکِ صادرهٔ در جریان</span></div>
        </div>
        <p className="ac-hint">
          موجودی <b>مشتق</b> است: دریافتِ بیمار منهای هزینه و پرداختِ سهم. چکِ در جریان تا وصول‌نشدن در موجودی نمی‌آید.
        </p>
      </div>
      <div className="ac-list">
        {d.accounts.map((a) => (
          <article key={a.id} className="ac-row">
            <div className="ac-val"><b>{num(a.balance)}</b><span>تومان</span></div>
            <div className="ac-row-main">
              <b>{a.ownerName}{a.bankName ? ` — ${a.bankName}` : ''}</b>
              <small>دریافت {num(a.in)} · پرداخت {num(a.out)}</small>
            </div>
          </article>
        ))}
        {(d.unassigned.in !== 0 || d.unassigned.out !== 0) && (
          <article className="ac-row off">
            <div className="ac-val"><b>{num(d.unassigned.balance)}</b><span>تومان</span></div>
            <div className="ac-row-main">
              <b>بدونِ حسابِ ثبت‌شده</b>
              <small>اسنادی که حسابشان انتخاب نشده — در جمع می‌آیند ولی به حسابی نسبت داده نشده‌اند</small>
            </div>
          </article>
        )}
      </div>
    </>
  );
}

/** چک‌ها — سررسید و سرنوشت. */
function Cheques({ onToast }) {
  const [d, setD] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [f, setF] = useState({ number: '', direction: 'in', partyName: '', amount: '', dueJ: todayJStr(), bankName: '', bankAccountId: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, b] = await Promise.all([api('/cheques'), api('/bank-accounts')]);
      setD(c); setAccounts(b);
    } catch (e) { onToast(e.message); }
  }, [onToast]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    const amount = parseNum(f.amount);
    if (f.number.trim().length < 2) { onToast('شمارهٔ چک را وارد کنید'); return; }
    if (f.partyName.trim().length < 2) { onToast('طرفِ چک را وارد کنید'); return; }
    if (amount <= 0) { onToast('مبلغ را وارد کنید'); return; }
    const dueAt = jStrToIso(f.dueJ);
    if (!dueAt) { onToast('تاریخِ سررسید نامعتبر است'); return; }
    setBusy(true);
    try {
      await api('/cheques', {
        method: 'POST',
        body: {
          number: f.number.trim(), direction: f.direction, partyName: f.partyName.trim(),
          amount, dueAt, bankName: f.bankName.trim() || undefined,
          bankAccountId: f.bankAccountId ? Number(f.bankAccountId) : undefined,
        },
      });
      setF((s) => ({ ...s, number: '', partyName: '', amount: '' }));
      await load(); onToast('چک ثبت شد ✓');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  const setStatus = async (id, status) => {
    setBusy(true);
    try { await api(`/cheques/${id}`, { method: 'PATCH', body: { status } }); await load(); onToast('وضعیتِ چک ثبت شد ✓'); }
    catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  if (!d) return <div className="ac-empty">در حال بارگذاری…</div>;
  return (
    <>
      <div className="ac-add">
        <div className="ac-grid">
          <label className="ac-field"><span>جهت</span>
            <select value={f.direction} onChange={(e) => setF((s) => ({ ...s, direction: e.target.value }))}>
              <option value="in">دریافتی (از بیمار/بیمارستان)</option>
              <option value="out">صادره (به جراح/تأمین‌کننده)</option>
            </select>
          </label>
          <label className="ac-field"><span>شمارهٔ چک *</span>
            <input dir="ltr" value={f.number} onChange={(e) => setF((s) => ({ ...s, number: e.target.value }))} />
          </label>
          <label className="ac-field"><span>طرفِ چک *</span>
            <input value={f.partyName} onChange={(e) => setF((s) => ({ ...s, partyName: e.target.value }))} />
          </label>
          <label className="ac-field"><span>مبلغ (تومان) *</span>
            <input dir="ltr" inputMode="numeric" value={f.amount} onChange={(e) => setF((s) => ({ ...s, amount: e.target.value }))} />
          </label>
          <JDate label="سررسید *" value={f.dueJ} onChange={(v) => setF((s) => ({ ...s, dueJ: v }))} />
          <label className="ac-field"><span>بانک</span>
            <input value={f.bankName} onChange={(e) => setF((s) => ({ ...s, bankName: e.target.value }))} />
          </label>
        </div>
        <button type="button" className="ac-submit" onClick={submit} disabled={busy}>
          <Plus width="15" height="15" /> ثبتِ چک
        </button>
      </div>
      <div className="ac-list">
        <p className="ac-total">در جریان — دریافتی {num(d.pendingIn)} · صادره {num(d.pendingOut)}</p>
        {d.rows.length === 0 && <div className="ac-empty">چکی ثبت نشده</div>}
        {d.rows.map((c) => (
          <article key={c.id} className={`ac-row${c.status === 'pending' ? '' : ' off'}`}>
            <div className="ac-val"><b>{num(c.amount)}</b><span>{c.direction === 'in' ? 'دریافتی' : 'صادره'}</span></div>
            <div className="ac-row-main">
              <b><span dir="ltr">{c.number}</span> — {c.partyName}</b>
              <small>
                سررسید {faDate(c.dueAt)} · {c.statusLabel}
                {c.dueSoon && <em className="ac-soon"> ⚠️ نزدیکِ سررسید</em>}
              </small>
            </div>
            {c.status === 'pending' && (
              <div className="ac-chq">
                <button type="button" disabled={busy} onClick={() => setStatus(c.id, 'cashed')}>وصول</button>
                <button type="button" className="warn" disabled={busy} onClick={() => setStatus(c.id, 'bounced')}>برگشت</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

/**
 * سالِ مالی و قفلِ دوره.
 *
 * بستنِ دوره یعنی هیچ سندی با تاریخِ داخلِ آن نوشته یا حذف نشود — وگرنه اصلاحِ
 * یک هزینهٔ پارسال گزارشِ بسته‌شدهٔ پارسال را بی‌سروصدا عوض می‌کند.
 */
function Fiscal({ onToast }) {
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ title: '', fromJ: '', toJ: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await api('/fiscal-years')); } catch (e) { onToast(e.message); }
  }, [onToast]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    const startsAt = jStrToIso(f.fromJ);
    const endsAt = jStrToIso(f.toJ);
    if (f.title.trim().length < 2) { onToast('عنوانِ سال را وارد کنید'); return; }
    if (!startsAt || !endsAt) { onToast('تاریخِ شروع و پایان را درست وارد کنید'); return; }
    setBusy(true);
    try {
      await api('/fiscal-years', { method: 'POST', body: { title: f.title.trim(), startsAt, endsAt } });
      setF({ title: '', fromJ: '', toJ: '' });
      await load(); onToast('سالِ مالی ثبت شد ✓');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  const toggle = async (y) => {
    setBusy(true);
    try {
      await api(`/fiscal-years/${y.id}/${y.closedAt ? 'reopen' : 'close'}`, { method: 'POST' });
      await load(); onToast(y.closedAt ? 'دوره باز شد' : 'دوره بسته شد ✓');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="ac-add">
        <div className="ac-grid">
          <label className="ac-field"><span>عنوان *</span>
            <input value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} placeholder="۱۴۰۵" />
          </label>
          <JDate label="از تاریخ *" value={f.fromJ} onChange={(v) => setF((s) => ({ ...s, fromJ: v }))} />
          <JDate label="تا تاریخ *" value={f.toJ} onChange={(v) => setF((s) => ({ ...s, toJ: v }))} />
        </div>
        <p className="ac-hint">
          بستنِ دوره یعنی هیچ هزینه، پرداخت یا پرداختِ سهمی با تاریخِ داخلِ آن ثبت یا حذف نشود.
        </p>
        <button type="button" className="ac-submit" onClick={submit} disabled={busy}>
          <Plus width="15" height="15" /> افزودنِ سالِ مالی
        </button>
      </div>
      <div className="ac-list">
        {rows.length === 0 && <div className="ac-empty">سالِ مالی تعریف نشده</div>}
        {rows.map((y) => (
          <article key={y.id} className={`ac-row${y.closedAt ? ' off' : ''}`}>
            <div className="ac-val"><b>{y.title}</b><span>{y.closedAt ? 'بسته' : 'باز'}</span></div>
            <div className="ac-row-main">
              <b>{faDate(y.startsAt)} تا {faDate(y.endsAt)}</b>
              {y.closedAt && <small>بسته‌شده در {faDate(y.closedAt)}</small>}
            </div>
            <button type="button" className={y.closedAt ? 'ac-mini' : 'ac-off'} disabled={busy} onClick={() => toggle(y)}>
              {y.closedAt ? 'بازکردن' : 'بستنِ دوره'}
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
