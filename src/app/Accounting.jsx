import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { faDate, jStrToIso, todayJStr, toEnDigits } from '../lib/jalali.js';
import JDate from './JDate.jsx';
import './accounting.css';
import { Alert, Bank, Book, Calendar, Chart, ChevronEnd, Doctor, Money, Pencil, Plus, Users } from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import { useStagger } from '../ui/stagger.js';


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
  const [tab, setTab] = useState('report');
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
        <Link to="/app" className="ac-back"><ChevronEnd width="15" height="15" /> سامانه</Link>
        <div>
          <h1>حسابداری</h1>
          <p>قاعده‌ها این‌جا تعریف می‌شوند؛ تقسیمِ سهمِ هر عمل در صورت‌حسابِ همان مراجعه است.</p>
        </div>
      </header>

      <Tabs
        label="بخش‌های حسابداری"
        variant="scroll"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'report', label: 'گزارشِ مالی', icon: Chart },
          { key: 'treasury', label: 'خزانه', icon: Bank },
          { key: 'contracts', label: 'قراردادِ جراحان', icon: Doctor },
          { key: 'partners', label: 'سهامداران', icon: Users },
          { key: 'expenses', label: 'هزینه‌ها', icon: Money },
          { key: 'banks', label: 'حساب‌های بانکی', icon: Bank },
          { key: 'ledger', label: 'حسابِ جاریِ شرکا', icon: Book },
          { key: 'cheques', label: 'چک‌ها', icon: Money },
          { key: 'fiscal', label: 'سالِ مالی', icon: Calendar },
        ]}
      />

      {tab === 'contracts' && <Contracts onToast={setToast} />}
      {tab === 'partners' && <Partners onToast={setToast} />}
      {tab === 'expenses' && <Expenses onToast={setToast} />}
      {tab === 'banks' && <Banks onToast={setToast} />}
      {tab === 'ledger' && <Ledger onToast={setToast} />}
      {tab === 'treasury' && <Treasury onToast={setToast} />}
      {tab === 'cheques' && <Cheques onToast={setToast} />}
      {tab === 'fiscal' && <Fiscal onToast={setToast} />}
      {tab === 'report' && <Report onToast={setToast} />}
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
  const row = useStagger();
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
        {!loading && rows.map((r, i) => (
          <motion.article key={r.id} {...row(i)} className={`ac-row${r.active ? '' : ' off'}`}>
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
          </motion.article>
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
  const [f, setF] = useState({ ownerName: '', bankName: '', cardNumber: '', accountNumber: '', iban: '', partnerId: '', classification: 'unclassified', showOnIntake: false });
  const [busy, setBusy] = useState(false);
  /* شناسهٔ حسابی که شماره‌هایش در حالِ ویرایش است — تا امروز هیچ راهی برای
     اصلاحِ یک حسابِ ثبت‌شده نبود و کاربر با ساختنِ حسابِ تکراری «درستش می‌کرد». */
  const [editing, setEditing] = useState(null);

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
          accountNumber: f.accountNumber.trim() || undefined,
          partnerId: f.partnerId ? Number(f.partnerId) : undefined,
          classification: f.classification,
          showOnIntake: f.showOnIntake,
        },
      });
      setF({ ownerName: '', bankName: '', cardNumber: '', accountNumber: '', iban: '', partnerId: '', classification: 'unclassified', showOnIntake: false });
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
          {/* ⚠️ شمارهٔ حساب سومین شمارهٔ متفاوت است، نه هم‌معنیِ کارت یا شبا:
              بیمارِ شعبه‌رو فقط با همین می‌تواند واریز کند. */}
          <label className="ac-field"><span>شمارهٔ حساب</span>
            <input dir="ltr" value={f.accountNumber} onChange={(e) => setF((s) => ({ ...s, accountNumber: e.target.value }))} />
          </label>
          <label className="ac-field"><span>شبا</span>
            <input dir="ltr" value={f.iban} onChange={(e) => setF((s) => ({ ...s, iban: e.target.value }))} placeholder="IR..." />
          </label>
          <label className="ac-field"><span>مالک حساب: شرکت یا شریک</span>
            <select value={f.partnerId} onChange={(e) => setF((s) => ({ ...s, partnerId: e.target.value }))}>
              <option value="">حسابِ شرکت</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <AccountClassification value={f.classification} onChange={(v) => setF((s) => ({ ...s, classification: v }))} disabled={busy} />
        </div>
        {/* ⚠️ تنها کلیدی که یک شمارهٔ حساب را روی نشانیِ **عمومی** می‌برد.
            پیش‌فرض خاموش است تا حسابِ شخصیِ شریک اتفاقی بیرون نرود. */}
        <label className="ac-pub">
          <input type="checkbox" checked={f.showOnIntake}
                 onChange={(e) => setF((s) => ({ ...s, showOnIntake: e.target.checked }))} />
          <span>روی فرمِ ثبت‌نامِ بیمار نشان داده شود</span>
        </label>
        <button type="button" className="ac-submit" onClick={submit} disabled={busy}>
          <Plus width="15" height="15" /> افزودنِ حساب
        </button>
      </div>
      <div className="ac-list">
        {rows.length === 0 && <div className="ac-empty">حسابی ثبت نشده</div>}
        {rows.map((b) => (
          <article key={b.id} className={`ac-row${b.active ? '' : ' off'}${editing === b.id ? ' editing' : ''}`}>
            <div className="ac-row-main">
              <b>{b.ownerName}{b.bankName ? ` — ${b.bankName}` : ''}</b>
              {/* هر سه شماره، چون هر کدام کاربردِ متفاوتی دارد و «یکی‌شان کافی
                  است» یعنی ادمین نمی‌فهمد کدام یکی جا مانده. */}
              <small dir="ltr">{[b.accountNumber, b.cardNumber, b.iban].filter(Boolean).join(' · ') || '—'}</small>
              <small>{b.partner ? `حساب شریک: ${b.partner.name}` : 'حساب شرکت'} · {ACCOUNT_CLASS[b.classification] ?? ACCOUNT_CLASS.unclassified}</small>
            </div>

            {editing === b.id ? (
              <AccountEdit
                row={b} partners={partners}
                busy={busy}
                onCancel={() => setEditing(null)}
                onSave={async (body) => {
                  setBusy(true);
                  try {
                    await api(`/bank-accounts/${b.id}`, { method: 'PATCH', body });
                    setEditing(null);
                    await load();
                    onToast('حساب به‌روز شد ✓');
                  } catch (err) { onToast(err.message); } finally { setBusy(false); }
                }}
              />
            ) : (
              <button type="button" className="ac-edit" disabled={busy} onClick={() => setEditing(b.id)}>
                <Pencil width="14" height="14" /> ویرایشِ شماره‌ها
              </button>
            )}

            {/* حساب‌های موجود هم باید بتوانند عمومی شوند — وگرنه فقط حسابِ
                تازه‌ساخته روی فرمِ بیمار می‌رفت. */}
            <label className="ac-pub row" title="روی فرمِ ثبت‌نامِ بیمار">
              <input type="checkbox" checked={!!b.showOnIntake} disabled={busy}
                     onChange={async (e) => {
                       setBusy(true);
                       try {
                         await api(`/bank-accounts/${b.id}/public`, { method: 'PATCH', body: { showOnIntake: e.target.checked } });
                         await load();
                       } catch (err) { onToast(err.message); } finally { setBusy(false); }
                     }} />
              <span>روی فرمِ بیمار</span>
            </label>
          </article>
        ))}
      </div>
    </>
  );
}

/**
 * ویرایشِ درجای شماره‌های یک حساب.
 *
 * ⚠️ کامپوننتِ **بیرونی** و نه تعریف‌شده داخلِ `Banks`: کامپوننتی که در بدنهٔ
 * render تعریف شود هویتش هر بار عوض می‌شود و React به‌جای به‌روزرسانی،
 * ورودی‌ها را از نو mount می‌کند — یعنی با هر حرفِ تایپ‌شده فوکوس می‌پرد.
 * (`ApproveSheet.Sel` در `Intake.jsx` دقیقاً همین اشتباه را دارد.)
 *
 * ⚠️ «نمایش روی فرمِ بیمار» عمداً این‌جا نیست: آن دروازهٔ افشای عمومی است و
 * endpointِ ممیزی‌شدهٔ خودش را دارد.
 */
function AccountEdit({ row, partners, busy, onCancel, onSave }) {
  const [e, setE] = useState({
    partnerId: row.partnerId ?? '',
    classification: row.classification ?? 'unclassified',
    ownerName: row.ownerName ?? '',
    bankName: row.bankName ?? '',
    cardNumber: row.cardNumber ?? '',
    accountNumber: row.accountNumber ?? '',
    iban: row.iban ?? '',
  });
  const set = (k) => (ev) => setE((s) => ({ ...s, [k]: ev.target.value }));

  return (
    <div className="ac-editbox">
      <div className="ac-grid">
        <label className="ac-field"><span>صاحبِ حساب</span>
          <input value={e.ownerName} onChange={set('ownerName')} disabled={busy} />
        </label>
        <label className="ac-field"><span>بانک</span>
          <input value={e.bankName} onChange={set('bankName')} disabled={busy} />
        </label>
        <label className="ac-field"><span>شمارهٔ کارت</span>
          <input dir="ltr" value={e.cardNumber} onChange={set('cardNumber')} disabled={busy} />
        </label>
        <label className="ac-field"><span>شمارهٔ حساب</span>
          <input dir="ltr" value={e.accountNumber} onChange={set('accountNumber')} disabled={busy} />
        </label>
        <label className="ac-field"><span>شبا</span>
          <input dir="ltr" value={e.iban} onChange={set('iban')} disabled={busy} placeholder="IR..." />
        </label>
        <label className="ac-field"><span>مالک حساب: شرکت یا شریک</span>
          <select value={e.partnerId} onChange={set('partnerId')} disabled={busy}>
            <option value="">حساب شرکت</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <AccountClassification value={e.classification} onChange={(v) => setE((s) => ({ ...s, classification: v }))} disabled={busy} />
      </div>
      <div className="ac-editacts">
        <button type="button" className="ac-submit" disabled={busy} onClick={() => onSave({
          partnerId: e.partnerId ? Number(e.partnerId) : null,
          classification: e.classification,
          ownerName: e.ownerName.trim(),
          /* رشته‌ی خالی فرستاده می‌شود نه حذف‌شده: «پاکش کن» یک خواستهٔ واقعی
             است و سرور `text()` آن را به `null` تبدیل می‌کند. */
          bankName: e.bankName.trim(),
          cardNumber: e.cardNumber.trim(),
          accountNumber: e.accountNumber.trim(),
          iban: e.iban.trim(),
        })}>ذخیره</button>
        <button type="button" className="ac-ghost" disabled={busy} onClick={onCancel}>انصراف</button>
      </div>
    </div>
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
                {c.dueSoon && <em className="ac-soon"><Alert size={12} /> نزدیکِ سررسید</em>}
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

/**
 * گزارشِ مالی.
 *
 * ⚠️ **درآمد و وصولی کنارِ هم و جدا نشان داده می‌شوند** و این تصمیمِ اصلیِ این
 * صفحه است: فاکتورِ صادره درآمدِ شناسایی‌شده است، پرداخت پولِ رسیده. یکی‌کردنشان
 * همان اشتباهی است که شرکتِ سودده را بی‌نقدینگی می‌کند.
 */
function Report({ onToast }) {
  const [d, setD] = useState(null);
  const [r, setR] = useState({ fromJ: '', toJ: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (from, to) => {
    setBusy(true);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      setD(await api(`/reports/financial${qs.toString() ? `?${qs}` : ''}`));
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  }, [onToast]);
  useEffect(() => { load(); }, [load]);

  const apply = () => {
    const from = r.fromJ.trim() ? jStrToIso(r.fromJ) : undefined;
    const to = r.toJ.trim() ? jStrToIso(r.toJ) : undefined;
    if ((r.fromJ.trim() && !from) || (r.toJ.trim() && !to)) { onToast('تاریخ نامعتبر است'); return; }
    load(from, to);
  };

  if (!d) return <div className="ac-empty">در حال بارگذاری…</div>;
  const t = d.totals;
  const peak = Math.max(1, ...d.byMonth.map((m) => Math.max(m.revenue, m.expenses)));

  return (
    <>
      <div className="ac-add">
        <div className="ac-grid">
          <JDate label="از تاریخ" value={r.fromJ} onChange={(v) => setR((s) => ({ ...s, fromJ: v }))} />
          <JDate label="تا تاریخ" value={r.toJ} onChange={(v) => setR((s) => ({ ...s, toJ: v }))} />
        </div>
        <button type="button" className="ac-submit" onClick={apply} disabled={busy}>اعمالِ بازه</button>

        {/* ⚠️ سه عددِ متفاوت که قبلاً یکی بودند. «درآمد» تا دیروز جمعِ فاکتورها
            بود، پس عملِ هفتهٔ بعد هم در سود می‌نشست. حالا شناسایی‌شده، در جریان،
            و پیش‌دریافت از هم جدایند — و کاربر باید هر سه را ببیند وگرنه فکر
            می‌کند درآمدش کم شده. */}
        <div className="ac-tre ac-rep">
          <div className="big"><b>{num(t.revenue)}</b><span>درآمدِ شناسایی‌شده</span></div>
          <div><b className="in">{num(t.collected)}</b><span>وصولی</span></div>
          <div><b className="wait">{num(t.deferred)}</b><span>پیش‌دریافت</span></div>
          <div><b>{num(t.contracted)}</b><span>در جریان</span></div>
          <div><b className="due">{num(t.due)}</b><span>مانده</span></div>
          <div><b className="out">{num(t.expenses)}</b><span>هزینه</span></div>
          <div><b className={t.profit >= 0 ? 'in' : 'due'}>{num(t.profit)}</b><span>سودِ ناخالص</span></div>
          <div><b>{num(t.visits)}</b><span>مراجعه</span></div>
        </div>
        <p className="ac-hint">
          <b>درآمدِ شناسایی‌شده</b> فقط عمل‌های <b>انجام‌شده</b> است و سود با همان حساب می‌شود.
          پولی که رسیده ولی عملش نشده <b>پیش‌دریافت</b> است — در صندوق هست، ولی هنوز
          بدهیِ شرکت به بیمار است و تقسیم نمی‌شود. <b>در جریان</b> جمعِ فاکتورها صرف‌نظر از انجام.
        </p>
      </div>

      {d.byMonth.length > 0 && (
        <div className="ac-add">
          <b className="ac-secttl">روندِ ماهانه</b>
          <div className="ac-chart">
            {d.byMonth.map((m) => (
              <div key={m.month} className="ac-bar" title={`${m.month} — درآمد ${num(m.revenue)} · هزینه ${num(m.expenses)}`}>
                <div className="ac-bar-stack">
                  <i className="rev" style={{ height: `${(m.revenue / peak) * 100}%` }} />
                  <i className="exp" style={{ height: `${(m.expenses / peak) * 100}%` }} />
                </div>
                <span>{m.month.replace(/^\d{4}\//, '')}</span>
              </div>
            ))}
          </div>
          <div className="ac-legend"><i className="rev" /> درآمد <i className="exp" /> هزینه</div>
        </div>
      )}

      <Breakdown title="به تفکیکِ جراح" rows={d.bySurgeon} />
      <Breakdown title="به تفکیکِ بیمارستان" rows={d.byHospital} />
      {/* ⚠️ بستهٔ ۷ج: مراجعهٔ چندعملی فقط زیرِ عملِ **اصلی** شمرده می‌شود (سرور،
          `principalProcedureName`) تا جمعِ این تفکیک با جمعِ کل بخواند — عنوان همین را می‌گوید. */}
      <Breakdown title="به تفکیکِ عملِ اصلی" rows={d.byProcedure} />
      {d.byExpenseCategory.length > 0 && (
        <div className="ac-list">
          <b className="ac-secttl">هزینه به تفکیکِ دسته</b>
          {d.byExpenseCategory.map((x) => (
            <article key={x.label} className="ac-row">
              <div className="ac-val"><b>{num(x.amount)}</b><span>تومان</span></div>
              <div className="ac-row-main"><b>{x.label}</b></div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function Breakdown({ title, rows }) {
  if (!rows?.length) return null;
  return (
    <div className="ac-list">
      <b className="ac-secttl">{title}</b>
      {rows.map((x) => (
        <article key={x.label} className="ac-row">
          <div className="ac-val"><b>{num(x.revenue)}</b><span>درآمد</span></div>
          <div className="ac-row-main">
            <b>{x.label}</b>
            <small>وصولی {num(x.collected)} · مانده {num(x.due)} · {num(x.visits)} مراجعه</small>
          </div>
        </article>
      ))}
    </div>
  );
}

const ACCOUNT_CLASS = { unclassified: 'تعیین‌نشده', formal: 'رسمی', informal: 'غیررسمی' };
function AccountClassification({ value, onChange, disabled }) {
  return <label className="ac-field"><span>نوع حساب برای فاکتور</span>
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {Object.entries(ACCOUNT_CLASS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>;
}
