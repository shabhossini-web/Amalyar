import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useConfig } from './config.jsx';
import { termsFor } from '../lib/terms.js';
import { toEnDigits } from '../lib/identity.js';
import './launcher.css';
import './definitions.css';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Back = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5v6" /></svg>);
/** بخش‌های تعرفه‌ای — باید با SECTORS سمتِ سرور یکی بماند. */
const SECTORS = { private: 'خصوصی', public: 'دولتی', nonprofit: 'عمومی غیردولتی', charity: 'خیریه' };
const faNum = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

const Check = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="m4 12 5 5L20 6" /></svg>);

/**
 * تنظیماتِ شرکت — «همان یک تغییرِ کوچک».
 *
 * حوزهٔ کاری هم واژگانِ رابط را عوض می‌کند هم ماژول‌های فعال را. هیچ داده‌ای
 * تبدیل یا حذف نمی‌شود، پس برگشت هم بی‌خطر است — و همین را به کاربر می‌گوییم
 * تا از تغییرش نترسد.
 */
export default function Settings() {
  const { vertical, verticals, brandName, reload } = useConfig();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [brand, setBrand] = useState(brandName || '');

  const [tariffs, setTariffs] = useState([]);
  const [codes, setCodes] = useState({ total: 0, version: null });
  const [tf, setTf] = useState({ year: '', sector: 'private', professional: '', technical: '', anesthesia: '' });
  const setT = (k) => (e) => setTf((s) => ({ ...s, [k]: e.target.value }));

  const loadTariffs = useCallback(async () => {
    try {
      const [rows, status] = await Promise.all([api('/service-codes/tariffs'), api('/service-codes/status')]);
      setTariffs(rows);
      setCodes(status);
    } catch { /* بدونِ تعرفه هم صفحه باید کار کند */ }
  }, []);
  useEffect(() => { loadTariffs(); }, [loadTariffs]);

  const saveTariff = async () => {
    const num = (v) => Number(toEnDigits(String(v)).replace(/[^0-9]/g, '') || 0);
    const year = toEnDigits(tf.year).replace(/[^0-9]/g, '');
    if (!/^\d{4}$/.test(year)) { setToast('سال باید چهار رقم باشد (مثلاً ۱۴۰۵)'); return; }
    setBusy(true);
    try {
      await api('/service-codes/tariffs', {
        method: 'POST',
        body: {
          year, sector: tf.sector,
          professional: num(tf.professional), technical: num(tf.technical), anesthesia: num(tf.anesthesia),
        },
      });
      await loadTariffs();
      setToast('ضریبِ تعرفه ذخیره شد ✓');
    } catch (e) { setToast(e.message); } finally { setBusy(false); }
  };

  useEffect(() => { document.title = 'عمل‌یار — تنظیماتِ شرکت'; }, []);
  useEffect(() => { setBrand(brandName || ''); }, [brandName]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), toast.length > 40 ? 4500 : 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const pick = async (key) => {
    if (key === vertical || busy) return;
    setBusy(true);
    try {
      await api('/config/vertical', { method: 'PATCH', body: { vertical: key } });
      await reload();
      setToast('حوزهٔ کاری تغییر کرد ✓ واژگان و ماژول‌ها به‌روز شدند.');
    } catch (e) { setToast(e.message); } finally { setBusy(false); }
  };

  const saveBrand = async () => {
    setBusy(true);
    try {
      await api('/config/brand', { method: 'PATCH', body: { brandName: brand.trim() } });
      await reload();
      setToast('نامِ برند ذخیره شد ✓');
    } catch (e) { setToast(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="df">
      <div className="df-bg" />
      <header className="df-head">
        <Link className="df-back" to="/app"><Back width="14" height="14" /> لانچر</Link>
        <div>
          <h1>تنظیماتِ شرکت</h1>
          <p>حوزهٔ کاری تعیین می‌کند کاربر چه کلماتی ببیند و کدام ماژول‌ها فعال باشند.</p>
        </div>
      </header>

      <div className="df-note">
        تغییرِ حوزه هیچ داده‌ای را پاک یا تبدیل نمی‌کند؛ فقط واژگان و دسترسیِ ماژول‌ها عوض می‌شود.
        برگشت به حوزهٔ قبلی هم همین‌قدر بی‌خطر است.
      </div>

      <div className="df-list st-verticals">
        {verticals.map((v) => {
          const on = v.key === vertical;
          const sample = termsFor(v.key);
          return (
            <button
              key={v.key}
              type="button"
              className={`df-row st-vertical${on ? ' on' : ''}`}
              disabled={busy}
              onClick={() => pick(v.key)}
            >
              <span className={`st-check${on ? ' on' : ''}`}>{on && <Check width="14" height="14" />}</span>
              <span className="df-row-main">
                <b>{v.label}</b>
                {/* نمونهٔ واژگان، تا پیش از انتخاب معلوم باشد چه چیزی عوض می‌شود. */}
                <small>{sample.visitNew} · {sample.visits} · {sample.tech}</small>
              </span>
            </button>
          );
        })}
      </div>

      <h3 className="st-h3">ضریبِ ریالیِ تعرفه</h3>
      <div className="df-note st-tnote">
        فیِ هر خدمت = ارزشِ نسبی (از کتاب) × ضریبِ ریالی. هر جزء جدا ضرب می‌شود،
        پس ضریبِ حرفه‌ای و فنی را جدا وارد کنید. تا وقتی ضریب تعریف نشده، انتخابِ
        کد فقط عنوان را پر می‌کند و مبلغ دستِ شماست.
        {codes.total > 0 && <> فعلاً <b>{faNum(codes.total)}</b> کد از نسخهٔ <b>{faNum(codes.version)}</b> در سامانه است.</>}
      </div>

      <div className="st-brand st-tariff">
        <div className="pf-row2">
          <label className="pf-field"><span>سال</span>
            <input dir="ltr" inputMode="numeric" value={tf.year} onChange={setT('year')} placeholder="۱۴۰۵" />
          </label>
          <label className="pf-field"><span>بخش</span>
            <select value={tf.sector} onChange={setT('sector')}>
              {Object.entries(SECTORS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="pf-field"><span>ضریبِ جزء حرفه‌ای (تومان)</span>
            <input dir="ltr" inputMode="numeric" value={tf.professional} onChange={setT('professional')} />
          </label>
          <label className="pf-field"><span>ضریبِ جزء فنی (تومان)</span>
            <input dir="ltr" inputMode="numeric" value={tf.technical} onChange={setT('technical')} />
          </label>
          <label className="pf-field"><span>ضریبِ بیهوشی (تومان)</span>
            <input dir="ltr" inputMode="numeric" value={tf.anesthesia} onChange={setT('anesthesia')} />
          </label>
        </div>
        <button type="button" className="df-save" onClick={saveTariff} disabled={busy}>ذخیرهٔ ضریب</button>
      </div>

      {tariffs.length > 0 && (
        <div className="df-list st-tlist">
          {tariffs.map((t) => (
            <div key={t.id} className="df-row">
              <div className="df-row-main">
                <b>{faNum(t.year)} — {t.sectorLabel}</b>
                <small>
                  حرفه‌ای {faNum(t.professional)} · فنی {faNum(t.technical)} · بیهوشی {faNum(t.anesthesia)}
                </small>
              </div>
              <button type="button" className="st-load" onClick={() => setTf({
                year: t.year, sector: t.sector,
                professional: String(t.professional), technical: String(t.technical), anesthesia: String(t.anesthesia),
              })}>ویرایش</button>
            </div>
          ))}
        </div>
      )}

      <h3 className="st-h3">نامِ برند</h3>
      <div className="st-brand">
        <label className="pf-field">
          <span>نامی که در سربرگ‌ها و گزارش‌ها نشان داده می‌شود</span>
          <input value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={60} placeholder="نامِ شرکت" />
        </label>
        <button type="button" className="df-save" onClick={saveBrand} disabled={busy}>ذخیره</button>
      </div>

      <ImportPanel onToast={setToast} />

      {toast && <div className="df-toast">{toast}</div>}
    </div>
  );
}

/**
 * وارد کردنِ backupِ ملک‌طب.
 *
 * ⚠️ همیشه اول آزمایشی: کاربر گزارشِ «چه چیزی وارد می‌شود» را می‌بیند و بعد
 * تأیید می‌کند. ایمپورتِ کور روی دیتابیسِ واقعی، برگشت‌ناپذیرترین دکمهٔ سامانه
 * می‌شد. اجرای دوباره هم بی‌خطر است — رکوردِ تکراری ساخته نمی‌شود.
 */
function ImportPanel({ onToast }) {
  const [file, setFile] = useState(null);
  const [dump, setDump] = useState(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);

  const pickFile = async (ev) => {
    const f = ev.target.files?.[0];
    setReport(null); setDump(null); setFile(null);
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      if (!parsed?.tables) throw new Error('این فایل ساختارِ backupِ ملک‌طب را ندارد');
      setFile(f); setDump(parsed);
      onToast(`فایل خوانده شد: ${Object.keys(parsed.tables).length} جدول`);
    } catch (e) {
      onToast(e.message.startsWith('این فایل') ? e.message : 'فایل JSONِ معتبر نیست');
    }
  };

  const run = async (dryRun) => {
    if (!dump || busy) return;
    setBusy(true);
    try {
      const res = await api(`/import/malekteb${dryRun ? '?dryRun=1' : ''}`, { method: 'POST', body: dump });
      setReport(res);
      onToast(dryRun ? 'اجرای آزمایشی انجام شد — چیزی ذخیره نشد' : 'ایمپورت انجام شد ✓');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  const LABELS = {
    surgeons: 'جراحان', hospitals: 'بیمارستان‌ها', procedureTypes: 'انواعِ عمل',
    patients: 'پرونده‌های بیمار', visits: 'مراجعات', charges: 'اقلامِ صورت‌حساب', payments: 'پرداخت‌ها',
  };

  return (
    <>
      <h3 className="st-h3">وارد کردنِ دادهٔ ملک‌طب</h3>
      <div className="df-note">
        فایلِ backupِ JSON را انتخاب کنید. اول «اجرای آزمایشی» بزنید تا ببینید چه چیزی وارد می‌شود؛
        هیچ‌چیز ذخیره نمی‌شود. مبالغ از ریال به تومان تبدیل می‌شوند و اجرای دوباره رکوردِ تکراری نمی‌سازد.
      </div>

      <div className="st-import">
        <label className="st-file">
          <input type="file" accept="application/json,.json" onChange={pickFile} />
          <span>{file ? file.name : 'انتخابِ فایلِ backup…'}</span>
        </label>
        <button type="button" className="df-save st-dry" disabled={!dump || busy} onClick={() => run(true)}>
          اجرای آزمایشی
        </button>
        <button type="button" className="df-save" disabled={!report || busy} onClick={() => run(false)}>
          وارد کن
        </button>
      </div>

      {report && (
        <div className="df-list st-report">
          <div className="df-row st-report-head">
            <b>{report.dryRun ? 'نتیجهٔ اجرای آزمایشی (ذخیره نشد)' : 'ایمپورت انجام شد'}</b>
          </div>
          {Object.entries(report.counts).map(([k, v]) => (
            <div key={k} className="df-row">
              <div className="df-row-main">
                <b>{LABELS[k] ?? k}</b>
                <small>
                  ساخته {faNum(v.created)}
                  {v.existing > 0 && ` · از قبل موجود ${faNum(v.existing)}`}
                  {v.skipped > 0 && ` · ردشده ${faNum(v.skipped)}`}
                </small>
              </div>
            </div>
          ))}
          {report.skippedTables.length > 0 && (
            <div className="df-row st-skipped">
              <div className="df-row-main">
                <b>وارد نشد</b>
                {report.skippedTables.map((t) => (
                  <small key={t.table}>{t.table} ({faNum(t.rows)} ردیف) — {t.reason}</small>
                ))}
              </div>
            </div>
          )}
          {report.warnings.length > 0 && (
            <div className="df-row st-warn">
              <div className="df-row-main">
                <b>هشدارها</b>
                {report.warnings.map((w, i) => <small key={i}>{w}</small>)}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
