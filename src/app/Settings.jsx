import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiBlobUrl, apiUpload } from '../lib/api.js';
import { useConfig } from './config.jsx';
import { termsFor } from '../lib/terms.js';
import { randomNationalId, toEnDigits } from '../lib/identity.js';
import { useAuth } from './auth.jsx';
import './launcher.css';
import './definitions.css';
import './settings.css';
import { Back, Check } from '../ui/icons.jsx';


/** بخش‌های تعرفه‌ای — باید با SECTORS سمتِ سرور یکی بماند. */
const SECTORS = { private: 'خصوصی', public: 'دولتی', nonprofit: 'عمومی غیردولتی', charity: 'خیریه', military: 'نیروهای مسلح' };
const faNum = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);


/**
 * تنظیماتِ شرکت — «همان یک تغییرِ کوچک».
 *
 * حوزهٔ کاری هم واژگانِ رابط را عوض می‌کند هم ماژول‌های فعال را. هیچ داده‌ای
 * تبدیل یا حذف نمی‌شود، پس برگشت هم بی‌خطر است — و همین را به کاربر می‌گوییم
 * تا از تغییرش نترسد.
 */
export default function Settings() {
  const { vertical, verticals, error: configError, reload } = useConfig();
  const { user: me } = useAuth();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const [tariffs, setTariffs] = useState([]);
  const [codes, setCodes] = useState({ total: 0, version: null });
  const [tf, setTf] = useState({ year: '', sector: 'private', professional: '', technical: '', anesthesia: '' });
  const setT = (k) => (e) => setTf((s) => ({ ...s, [k]: e.target.value }));

  const [codesError, setCodesError] = useState(null);
  const loadTariffs = useCallback(async () => {
    try {
      const [rows, status] = await Promise.all([api('/service-codes/tariffs'), api('/service-codes/status')]);
      setTariffs(rows);
      setCodes(status);
      setCodesError(null);
    } catch (e) {
      // بلعیدنِ خطا یعنی کاربر بخشِ خالی می‌بیند و نمی‌داند چرا.
      setCodesError(e?.status ? `${e.message} (کد ${e.status})` : e?.message || 'ارتباط با سرور برقرار نشد');
    }
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

  return (
    <div className="df">
      <div className="df-bg" />
      <header className="df-head">
        <Link className="df-back" to="/app"><Back width="14" height="14" /> سامانه</Link>
        <div>
          <h1>تنظیماتِ شرکت</h1>
          <p>حوزهٔ کاری تعیین می‌کند کاربر چه کلماتی ببیند و کدام ماژول‌ها فعال باشند.</p>
        </div>
      </header>

      <div className="df-note">
        تغییرِ حوزه هیچ داده‌ای را پاک یا تبدیل نمی‌کند؛ فقط واژگان و دسترسیِ ماژول‌ها عوض می‌شود.
        برگشت به حوزهٔ قبلی هم همین‌قدر بی‌خطر است.
      </div>

      {configError && (
        <div className="st-fail">
          <b>پیکربندیِ شرکت خوانده نشد</b>
          <small>{configError}</small>
          <small>حوزهٔ کاری و نامِ برند تا وقتی این خطا هست نمایش داده نمی‌شوند. بقیهٔ سامانه با واژگانِ پیش‌فرض کار می‌کند.</small>
          <button type="button" onClick={() => reload()}>تلاشِ دوباره</button>
        </div>
      )}

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
        فیِ هر خدمت = ارزشِ نسبی (از کتاب) × ضریبِ ریالی. ضریب‌های <b>سراسری</b> سالی
        یک‌بار مرکزی اعلام می‌شوند و لازم نیست چیزی وارد کنید؛ اگر قراردادِ خاصی
        دارید، ضریبِ اختصاصیِ خودتان را ثبت کنید — برای همان سال و بخش، مقدم است.
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

      {codesError && (
        <div className="st-fail">
          <b>کتابِ ارزش نسبی و تعرفه‌ها خوانده نشدند</b>
          <small>{codesError}</small>
          <button type="button" onClick={() => loadTariffs()}>تلاشِ دوباره</button>
        </div>
      )}

      {tariffs.length > 0 && (
        <div className="df-list st-tlist">
          {tariffs.map((t) => (
            <div key={`${t.source}-${t.id}`} className="df-row">
              <div className="df-row-main">
                <b>
                  {faNum(t.year)} — {t.sectorLabel}
                  {/* منبعِ ضریب: سراسری از مرکز می‌آید، اختصاصی را خودِ شرکت گذاشته و مقدم است. */}
                  <i className={`st-tsrc${t.source === 'local' ? ' own' : ''}`}>
                    {t.source === 'local' ? 'اختصاصیِ شرکت' : 'سراسری'}
                  </i>
                </b>
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

      <Knobs onToast={setToast} onSaved={reload} />

      <LetterheadPanel onToast={setToast} />

      <ImportPanel onToast={setToast} />

      {me?.level >= 6 && <TestDataPanel onToast={setToast} />}

      {toast && <div className="df-toast">{toast}</div>}
    </div>
  );
}

/**
 * دادهٔ آزمایشی — **موقت** (خواستهٔ مالک، ۱۴۰۵/۰۶/۲۹): برای ثبتِ بیمارِ تستی
 * کدِ ملیِ تصادفیِ معتبر می‌دهد تا اعتبارسنجیِ فرم‌ها رد شود. فقط سوپرادمین.
 * همان مولد در فرمِ مراجعه هم کنارِ کدِ ملی هست (`db-nidtest`).
 */
function TestDataPanel({ onToast }) {
  const [nid, setNid] = useState('');
  const copy = async () => {
    try { await navigator.clipboard.writeText(nid); onToast('کپی شد ✓'); } catch { onToast(nid); }
  };
  return (
    <div className="st-brand st-testdata">
      <h3 className="st-h3">دادهٔ آزمایشی (موقت)</h3>
      <div className="df-note">
        فقط برای ثبتِ بیمارِ تستی. کد تصادفی و از نظرِ رقمِ کنترلی معتبر است؛ متعلق به کسی نیست
        ولی ممکن است تصادفاً با یک کدِ واقعی یکی باشد — روی بیمارِ واقعی استفاده نکنید.
      </div>
      <div className="st-testrow">
        <button type="button" className="df-save" onClick={() => setNid(randomNationalId())}>تولیدِ کدِ ملیِ آزمایشی</button>
        {nid && (
          <>
            <code dir="ltr" className="st-nid">{nid}</code>
            <button type="button" className="st-load" onClick={copy}>کپی</button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * تنظیماتِ اختصاصیِ شرکت.
 *
 * ⚠️ این صفحه **از رجیستریِ سرور ساخته می‌شود**، نه از فهرستی که این‌جا نوشته
 * شده باشد. افزودنِ تنظیمِ تازه یعنی یک ردیف در `settings-registry.ts` و
 * همین‌جا خودش ظاهر می‌شود — وگرنه هر تنظیمِ جدید دو تغییر لازم داشت و دیر یا
 * زود یکی‌شان جا می‌ماند.
 */
function Knobs({ onToast, onSaved }) {
  const [groups, setGroups] = useState(null);
  const [draft, setDraft] = useState({});     // فقط فیلدهای دست‌خورده
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api('/settings');
      setGroups(d.groups);
      setDraft({});
      setError(null);
    } catch (e) {
      setError(e?.status ? `${e.message} (کد ${e.status})` : e?.message || 'ارتباط با سرور برقرار نشد');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const items = (groups ?? []).flatMap((g) => g.items);
  const valueOf = (it) => (it.key in draft ? draft[it.key] : it.value);
  const dirty = Object.keys(draft).filter((k) => {
    const it = items.find((i) => i.key === k);
    return it && String(draft[k]) !== String(it.value);
  });

  const set = (key, v) => setDraft((d) => ({ ...d, [key]: v }));
  const reset = (it) => set(it.key, it.default);

  const save = async () => {
    if (!dirty.length || busy) return;
    setBusy(true);
    try {
      const values = Object.fromEntries(dirty.map((k) => [k, draft[k]]));
      const d = await api('/settings', { method: 'PATCH', body: { values } });
      setGroups(d.groups);
      setDraft({});
      // پیکربندی دوباره خوانده می‌شود تا نامِ برند در همین لحظه در رابط عوض شود.
      await onSaved?.();
      onToast(`${faNum(d.changed)} تنظیم ذخیره شد ✓`);
    } catch (e) {
      // پیام‌های گروهی را خودِ لایهٔ api به هم چسبانده؛ همه را نشان می‌دهیم نه فقط اولی.
      onToast(e.message);
    } finally { setBusy(false); }
  };

  return (
    <>
      <h3 className="st-h3">تنظیماتِ شرکت</h3>
      <div className="df-note">
        این‌ها فقط برای همین شرکت‌اند و روی نصبِ بقیه اثری ندارند. «پیش‌فرض» یعنی
        هنوز دست نخورده — و اگر روزی پیش‌فرضِ سامانه بهتر شود، همین‌ها خودشان به‌روز می‌شوند.
      </div>

      {error && (
        <div className="st-fail">
          <b>تنظیمات خوانده نشد</b>
          <small>{error}</small>
          <button type="button" onClick={load}>تلاشِ دوباره</button>
        </div>
      )}

      {(groups ?? []).map((g) => (
        <div key={g.key} className="st-group">
          <div className="st-group-head">
            <b>{g.label}</b>
            {g.hint && <small>{g.hint}</small>}
          </div>
          {g.key === 'ai' && <AiGuide />}
          <div className="st-knobs">
            {g.items.map((it) => {
              const v = valueOf(it);
              const touched = String(v) !== String(it.default);
              return (
                <label key={it.key} className={`pf-field st-knob${it.type === 'textarea' ? ' wide' : ''}`}>
                  <span>
                    {it.label}
                    {!touched && <i className="st-tag">پیش‌فرض</i>}
                    {touched && <button type="button" className="st-reset" onClick={() => reset(it)}>بازگرداندن</button>}
                  </span>
                  {it.type === 'textarea' ? (
                    <textarea rows={2} maxLength={it.maxLength ?? undefined} value={v}
                      onChange={(e) => set(it.key, e.target.value)} />
                  ) : it.type === 'bool' ? (
                    <select value={v ? 'true' : 'false'} onChange={(e) => set(it.key, e.target.value === 'true')}>
                      <option value="true">بله</option>
                      <option value="false">خیر</option>
                    </select>
                  ) : it.type === 'color' ? (
                    /* هم انتخابگرِ رنگ هم متن: انتخابگر برای کسی که رنگ را
                       می‌بیند، متن برای کسی که کدِ رنگِ برندش را دارد. */
                    <span className="st-color">
                      <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(v) ? v : '#7c3aed'}
                        onChange={(e) => set(it.key, e.target.value)} aria-label={it.label} />
                      <input dir="ltr" maxLength={7} value={v} placeholder={String(it.default)}
                        onChange={(e) => set(it.key, e.target.value)} />
                    </span>
                  ) : (
                    <input
                      dir={it.ltr || it.type === 'number' ? 'ltr' : undefined}
                      inputMode={it.type === 'number' ? 'numeric' : undefined}
                      maxLength={it.maxLength ?? undefined}
                      value={v}
                      placeholder={String(it.default) || undefined}
                      onChange={(e) => set(it.key, e.target.value)}
                    />
                  )}
                  {it.hint && <em className="st-hint">{it.hint}</em>}
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {groups && (
        <div className="st-knobsave">
          <button type="button" className="df-save" disabled={busy || !dirty.length} onClick={save}>
            {dirty.length ? `ذخیرهٔ ${faNum(dirty.length)} تغییر` : 'تغییری نداده‌اید'}
          </button>
          {dirty.length > 0 && (
            <button type="button" className="st-load" disabled={busy} onClick={() => setDraft({})}>انصراف</button>
          )}
        </div>
      )}
    </>
  );
}

/**
 * سربرگِ شرکت — تصویری که پشتِ فاکتورِ رسمی و نامهٔ اداری چاپ می‌شود.
 *
 * فایل پشتِ Authorization است، پس پیش‌نمایش با blob URL می‌آید نه `<img src>`ِ
 * مستقیم — همان الگوی مدارکِ پرونده.
 */
function LetterheadPanel({ onToast }) {
  const [preview, setPreview] = useState(null); // blob URL یا null = سربرگی نیست
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const url = await apiBlobUrl('/settings/letterhead');
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return url; });
    } catch {
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return null; });
    }
  }, []);
  useEffect(() => {
    load();
    return () => setPreview((old) => { if (old) URL.revokeObjectURL(old); return null; });
  }, [load]);

  const pick = async (ev) => {
    const f = ev.target.files?.[0];
    ev.target.value = '';
    if (!f || busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      await apiUpload('/settings/letterhead', fd);
      await load();
      onToast('سربرگ ذخیره شد ✓');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api('/settings/letterhead', { method: 'DELETE' });
      await load();
      onToast('سربرگ حذف شد');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <h3 className="st-h3">سربرگِ شرکت</h3>
      <div className="df-note">
        تصویرِ سربرگِ رسمی (PNG، JPEG یا WebP — ترجیحاً اندازهٔ A4). روی فاکتورِ رسمی
        و نامهٔ اداری همین چاپ می‌شود؛ تا وقتی سربرگی نگذاشته‌اید، اسناد بدونِ سربرگ چاپ می‌شوند.
      </div>
      <div className="st-import st-letterhead">
        <label className="st-file">
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} disabled={busy} />
          <span>{preview ? 'تعویضِ سربرگ…' : 'انتخابِ تصویرِ سربرگ…'}</span>
        </label>
        {preview && (
          <button type="button" className="st-load" disabled={busy} onClick={remove}>حذفِ سربرگ</button>
        )}
      </div>
      {preview && (
        <div className="st-letterhead-preview">
          <img src={preview} alt="پیش‌نمایشِ سربرگ" />
        </div>
      )}
    </>
  );
}

/**
 * وارد کردنِ backupِ سامانهٔ قبلی (نامِ محصولِ دیگر در UI نمی‌آید — white-label).
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
      if (!parsed?.tables) throw new Error('این فایل ساختارِ backupِ سامانهٔ قبلی را ندارد');
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
      <h3 className="st-h3">وارد کردنِ دادهٔ سامانهٔ قبلی</h3>
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


/**
 * متنِ آموزشیِ دستیارِ هوشمند — داخلِ همان گروهِ تنظیمات، تاشو، تا صفحهٔ
 * تنظیمات را بلند نکند ولی همیشه دمِ دست باشد.
 */
function AiGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="st-aiguide">
      <button type="button" className="st-aiguide-btn" onClick={() => setOpen(!open)}>
        راهنمای استفاده از دستیارِ هوشمند — {open ? 'بستن' : 'بازکردن'}
      </button>
      {open && (
        <div className="st-aiguide-body">
          <p><b>دستیار چه می‌کند؟</b> سه کار: (۱) در پروندهٔ بیمار، تبِ «شرح‌ها»، تایپِ خامِ شما را با دکمهٔ
          «ساخت‌یافته کن» به شرحِ تمیزِ سرفصل‌دار تبدیل می‌کند و زنده می‌نویسد؛ (۲) با «ادامه بنویس» شرحِ
          نیمه‌کاره را با سبکِ خودتان ادامه می‌دهد؛ (۳) در تعریف‌های پایه، تبِ «قالب‌های شرح»، از روی
          شرح‌های قبلیِ خودتان قالبِ آماده می‌سازد.</p>
          <p><b>دستیارِ صوتی:</b> با تنظیمِ «مدلِ گفتار به متن (ویسپر)»، دکمهٔ میکروفون کنارِ شرح‌ها و فرمِ
          عمل ظاهر می‌شود: ضبط کنید، متن خودش می‌نشیند — روی اندروید و آیفون یکسان. در ثبتِ بیمارِ جدید هم
          «دیکتهٔ بیمارِ جدید» نام/موبایل/کد ملی را از حرف‌هایتان پر می‌کند (دستورِ اختصاصی‌اش فیلدِ
          «دستیارِ صوتی» است).</p>
          <p><b>یادگیریِ تدریجی:</b> هر بار چند شرحِ قبلیِ همان نوع و همان عمل از خودِ مطب به‌عنوانِ نمونهٔ
          سبک به مدل داده می‌شود — هر چه بیشتر بنویسید، پیش‌نویس‌ها شبیه‌ترِ سبکِ خودتان می‌شوند. به‌علاوه،
          وقتی پیش‌نویسِ دستیار را پیش از ثبت دستی اصلاح می‌کنید، همان اصلاح به‌عنوانِ نمونهٔ سلیقه به
          درخواست‌های بعدی ضمیمه می‌شود تا کم‌کم مطابقِ ویرایش‌های شما بنویسد.</p>
          <p><b>حریمِ بیمار:</b> نام و شمارهٔ بیمار هرگز به سرویسِ بیرونی نمی‌رود — فقط بافتارِ بالینی
          (نوعِ عمل/تشخیص/موضوع) و متنی که خودتان نوشته‌اید. هیچ پیش‌نویسی هم تا «ثبت» نزنید در پرونده نمی‌نشیند.</p>
          <p><b>راه‌اندازی:</b> اگر مدیرِ سامانه پیکربندیِ مرکزی را روشن کرده باشد، همین حالا کار می‌کند و
          لازم نیست این‌جا چیزی پر کنید. اگر می‌خواهید سرویس/کلیدِ خودِ شرکت را داشته باشید، «نشانیِ پایه» و
          «کلید» را از ارائه‌دهنده (AvalAI، GapGPT، …) بگیرید و این‌جا بگذارید — تنظیمِ شما بر مرکزی مقدم است.</p>
          <p><b>دستورِ اختصاصی:</b> اگر می‌خواهید دستیار همیشه قاعده‌ای را رعایت کند (مثلاً «توصیه‌های پس از
          عمل را جدا بیاور»)، آن را در فیلدهای «دستورِ اختصاصیِ شرکت» بنویسید.</p>
        </div>
      )}
    </div>
  );
}
