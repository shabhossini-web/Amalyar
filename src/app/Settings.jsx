import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiBlobUrl, apiUpload } from '../lib/api.js';
import { useConfig, useTerms } from './config.jsx';
import { termsFor } from '../lib/terms.js';
import { useToolTitle } from './tools.jsx';
import { randomNationalId, toEnDigits } from '../lib/identity.js';
import { jToFa, todayJStr } from '../lib/jalali.js';
import { useAuth } from './auth.jsx';
import './launcher.css';
import './definitions.css';
import './settings.css';
import { Back, Check } from '../ui/icons.jsx';
import Toast, { useToast } from '../ui/Toast.jsx';


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
  const { kind, services, kinds = [], serviceCatalog = [], error: configError, reload, brandName } = useConfig();
  const { user: me } = useAuth();
  /* «تنظیماتِ مطب» / «تنظیماتِ شرکت» — نامِ کاشی از کاتالوگ، واژهٔ سازمان از حوزه (بازبینیِ UX). */
  const { label: title } = useToolTitle('settings');
  const { org } = useTerms();
  /* گروه‌های تنظیم از `Knobs` می‌آیند (رجیستریِ سرور) تا فهرستِ پرشِ بالای صفحه همان‌ها را بشناسد. */
  const [knobGroups, setKnobGroups] = useState([]);
  const [busy, setBusy] = useState(false);
  const { msg: toast, show: setToast } = useToast(2200);

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
      setToast('ضریبِ تعرفه ذخیره شد');
    } catch (e) { setToast(e.message); } finally { setBusy(false); }
  };

  /**
   * **نوعِ نصب و بستهٔ خدمات** (مالک، ۱۴۰۵/۰۷/۰۱): مطب/کلینیک یا شرکتی، و شرکت
   * خودش خدماتش را می‌چیند. انتخاب اول پیش‌نویس است؛ ذخیره یک **پیش‌نمایش** از
   * سرور می‌گیرد (کدام ماژول روشن/خاموش می‌شود، لینک‌های زندهٔ خدمتِ برداشته‌شده،
   * عوض‌شدنِ واژگان) و فقط بعد از تأیید می‌نویسد — تغییرِ ماژول‌ها تصمیمی نیست
   * که کسی باید بعداً از روی لانچرِ عوض‌شده کشفش کند.
   */
  const current = { kind, services: services ?? [] };
  const [draft, setDraft] = useState(current);
  const [preview, setPreview] = useState(null);
  const currentKey = `${kind}:${(services ?? []).join(',')}`;
  useEffect(() => { setDraft({ kind, services: services ?? [] }); setPreview(null); }, [currentKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const draftKey = `${draft.kind}:${draft.services.join(',')}`;
  const dirty = draftKey !== currentKey;
  const draftOk = draft.kind === 'clinic' || draft.services.length > 0;
  const toggleService = (key) => setDraft((d) => ({
    ...d,
    services: serviceCatalog.map((x) => x.key).filter((k) => (k === key ? !d.services.includes(k) : d.services.includes(k))),
  }));
  const pickKind = (k) => setDraft((d) => ({ kind: k, services: k === 'clinic' ? [] : (d.services.length ? d.services : (services?.length ? services : [serviceCatalog[0]?.key].filter(Boolean))) }));
  const body = () => ({ kind: draft.kind, services: draft.kind === 'clinic' ? [] : draft.services });
  const askPreview = async () => {
    if (!dirty || !draftOk || busy) return;
    setBusy(true);
    try { setPreview(await api('/config/profile/preview', { method: 'POST', body: body() })); }
    catch (e) { setToast(e.message); } finally { setBusy(false); }
  };
  const saveProfile = async () => {
    setBusy(true);
    try {
      await api('/config/profile', { method: 'PATCH', body: body() });
      await reload();
      setPreview(null);
      setToast(`نوع و خدماتِ ${org} ذخیره شد`);
    } catch (e) { setToast(e.message); } finally { setBusy(false); }
  };
  const ACTION = { create: 'روشن می‌شود', enable: 'روشن می‌شود', disable: 'خاموش می‌شود', relevel: 'سطحِ پیش‌فرضش عوض می‌شود' };

  return (
    <div className="df">
      <div className="df-bg" />
      <header className="df-head">
        <Link className="df-back" to="/app"><Back width="14" height="14" /> سامانه</Link>
        <div>
          <h1>{title}</h1>
          <p>نوعِ نصب و خدماتِ {org} تعیین می‌کند کدام ماژول‌ها و فرم‌های ثبت‌نام فعال باشند و کاربر چه کلماتی ببیند.</p>
        </div>
      </header>

      <SectionNav items={[
        { id: 'st-kind', label: 'نوعِ نصب' },
        { id: 'st-tariff', label: 'ضریبِ تعرفه' },
        ...knobGroups.map((g) => ({ id: `st-g-${g.key}`, label: g.label })),
        { id: 'st-letterhead', label: 'سربرگ' },
        { id: 'st-import', label: 'ورودِ داده' },
        ...(me?.level >= 6 ? [{ id: 'st-test', label: 'دادهٔ آزمایشی' }] : []),
      ]} />

      <h3 className="st-h3" id="st-kind" tabIndex={-1}>نوعِ نصب{draft.kind === 'company' ? ' و خدمات' : ''}</h3>
      <div className="df-note">
        نصب یا <b>مطب / کلینیک</b> است یا <b>شرکتی</b>؛ شرکت خودش انتخاب می‌کند چه خدماتی می‌دهد.
        این تغییر هیچ داده‌ای را پاک یا تبدیل نمی‌کند — فقط ماژول‌ها، فرم‌های ثبت‌نام و واژگان.
        سطح‌هایی که خودتان در «دسترسی‌ها» عوض کرده‌اید دست نمی‌خورند.
      </div>

      {configError && (
        <div className="st-fail">
          <b>پیکربندیِ {org} خوانده نشد</b>
          <small>{configError}</small>
          <small>حوزهٔ کاری و نامِ برند تا وقتی این خطا هست نمایش داده نمی‌شوند. بقیهٔ سامانه با واژگانِ پیش‌فرض کار می‌کند.</small>
          <button type="button" onClick={() => reload()}>تلاشِ دوباره</button>
        </div>
      )}

      <div className="df-list st-verticals" role="radiogroup" aria-label="نوعِ نصب">
        {kinds.map((k) => {
          const on = k.key === draft.kind;
          const sample = termsFor(k.key === 'clinic' ? 'clinic' : (draft.services[0] ?? services?.[0] ?? 'ionm'));
          return (
            <button key={k.key} type="button" role="radio" aria-checked={on}
                    className={`df-row st-vertical${on ? ' on' : ''}`} disabled={busy} onClick={() => pickKind(k.key)}>
              <span className={`st-check${on ? ' on' : ''}`}>{on && <Check width="14" height="14" />}</span>
              <span className="df-row-main">
                <b>{k.label}</b>
                {/* نمونهٔ واژگان، تا پیش از انتخاب معلوم باشد چه چیزی عوض می‌شود. */}
                <small>{sample.visitNew} · {sample.visits} · {sample.tech}</small>
              </span>
            </button>
          );
        })}
      </div>

      {draft.kind === 'company' && (
        <>
          <h3 className="st-h3">خدماتِ شرکت</h3>
          <div className="df-list st-services" role="group" aria-label="خدماتِ شرکت">
            {serviceCatalog.map((x) => {
              const on = draft.services.includes(x.key);
              return (
                <button key={x.key} type="button" role="checkbox" aria-checked={on}
                        className={`df-row st-vertical${on ? ' on' : ''}`} disabled={busy} onClick={() => toggleService(x.key)}>
                  <span className={`st-check${on ? ' on' : ''}`}>{on && <Check width="14" height="14" />}</span>
                  <span className="df-row-main"><b>{x.label}</b><small>فرمِ ثبت‌نام و لینکِ جدای همین خدمت</small></span>
                </button>
              );
            })}
          </div>
          {!draftOk && <div className="st-fail"><small>دست‌کم یک خدمت انتخاب کنید.</small></div>}
        </>
      )}

      {dirty && !preview && (
        <div className="st-profile-acts">
          <button type="button" className="df-add" disabled={busy || !draftOk} onClick={askPreview}>بررسیِ تغییرات</button>
          <button type="button" className="df-ghost" disabled={busy} onClick={() => setDraft(current)}>انصراف</button>
        </div>
      )}

      {preview && (
        <div className="st-preview" role="region" aria-label="پیش‌نمایشِ تغییرِ نوع و خدمات">
          <b>{preview.before.label} ← {preview.after.label}</b>
          {preview.changes.length ? (
            <ul>{preview.changes.map((c) => <li key={c.key}>{c.label}: {ACTION[c.action]}</li>)}</ul>
          ) : <p>هیچ ماژولی عوض نمی‌شود.</p>}
          {preview.vocabularyChanges && <p>واژه‌های رابط هم عوض می‌شود (مثلاً «{termsFor(preview.after.kind === 'clinic' ? 'clinic' : preview.after.services[0]).visits}»).</p>}
          {preview.removed.filter((r) => r.links || r.open).map((r) => (
            <p key={r.service} className="warn">
              خدمتِ «{r.label}» برداشته می‌شود ولی {faNum(r.links)} لینکِ فعال و {faNum(r.open)} ثبت‌نامِ باز دارد؛
              لینک‌ها کار می‌کنند و ثبت‌نام‌ها تأییدشدنی می‌مانند، فقط لینکِ تازه‌ای برایش پیشنهاد نمی‌شود.
            </p>
          ))}
          <div className="st-profile-acts">
            <button type="button" className="df-add" disabled={busy} onClick={saveProfile}>تأیید و ذخیره</button>
            <button type="button" className="df-ghost" disabled={busy} onClick={() => setPreview(null)}>بازگشت</button>
          </div>
        </div>
      )}

      <h3 className="st-h3" id="st-tariff" tabIndex={-1}>ضریبِ ریالیِ تعرفه</h3>
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
                    {t.source === 'local' ? `اختصاصیِ ${org}` : 'سراسری'}
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

      <Knobs onToast={setToast} onSaved={reload} org={org} brand={brandName} onGroups={setKnobGroups} />

      <LetterheadPanel onToast={setToast} org={org} />

      <ImportPanel onToast={setToast} />

      {me?.level >= 6 && <TestDataPanel onToast={setToast} />}

      <Toast msg={toast} />
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
    try { await navigator.clipboard.writeText(nid); onToast('کپی شد'); } catch { onToast(nid); }
  };
  return (
    <div className="st-brand st-testdata">
      <h3 className="st-h3" id="st-test" tabIndex={-1}>دادهٔ آزمایشی (موقت)</h3>
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
function Knobs({ onToast, onSaved, org, brand, onGroups }) {
  const [groups, setGroups] = useState(null);
  const [draft, setDraft] = useState({});     // فقط فیلدهای دست‌خورده
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api('/settings');
      setGroups(d.groups);
      onGroups?.(d.groups);
      setDraft({});
      setError(null);
    } catch (e) {
      setError(e?.status ? `${e.message} (کد ${e.status})` : e?.message || 'ارتباط با سرور برقرار نشد');
    }
  }, [onGroups]);
  useEffect(() => { load(); }, [load]);

  const items = (groups ?? []).flatMap((g) => g.items);
  const valueOf = (it) => (it.key in draft ? draft[it.key] : it.value);
  const dirty = Object.keys(draft).filter((k) => {
    const it = items.find((i) => i.key === k);
    return it && String(draft[k]) !== String(it.value);
  });

  const set = (key, v) => setDraft((d) => ({ ...d, [key]: v }));
  const reset = (it) => set(it.key, it.default);
  /* ترکِ صفحه با تغییرِ ذخیره‌نشده هشدار می‌دهد (بازبینیِ UX ۱۴۰۵/۰۷): هم بستن/تازه‌کردنِ زبانه،
     هم لینک‌های داخلِ خودِ سامانه (نوارِ بالا، «سامانه») که `beforeunload` نمی‌بیندشان. */
  useUnsavedGuard(dirty.length > 0);

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
      onToast(`${faNum(d.changed)} تنظیم ذخیره شد`);
    } catch (e) {
      // پیام‌های گروهی را خودِ لایهٔ api به هم چسبانده؛ همه را نشان می‌دهیم نه فقط اولی.
      onToast(e.message);
    } finally { setBusy(false); }
  };

  return (
    <>
      <h3 className="st-h3" id="st-knobs" tabIndex={-1}>تنظیماتِ {org}</h3>
      <div className="df-note">
        این‌ها فقط برای همین {org}‌اند و روی نصبِ بقیه اثری ندارند. «پیش‌فرض» یعنی
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
        <div key={g.key} className="st-group" id={`st-g-${g.key}`} tabIndex={-1}>
          <div className="st-group-head">
            <b>{g.label}</b>
            {g.hint && <small>{g.hint}</small>}
          </div>
          {g.key === 'ai' && <AiGuide org={org} />}
          <div className="st-knobs">
            {g.items.map((it) => {
              const v = valueOf(it);
              const touched = String(v) !== String(it.default);
              return (
                /* متنِ پیامک دکمه و پیش‌نمایش دارد — داخلِ <label> نمی‌نشیند (نامِ دسترس‌پذیرِ کادر
                   همهٔ آن‌ها را می‌خواند)؛ آن‌جا عنوان با `aria-labelledby` به کادر وصل است. */
                <Wrap key={it.key} kind={it.type === 'textarea' && g.key === 'sms' ? 'div' : 'label'}
                  className={`pf-field st-knob${it.type === 'textarea' ? ' wide' : ''}`}>
                  <span id={`st-l-${it.key}`}>
                    {it.label}
                    {!touched && <i className="st-tag">پیش‌فرض</i>}
                    {touched && <button type="button" className="st-reset" onClick={() => reset(it)}>بازگرداندن</button>}
                  </span>
                  {it.type === 'textarea' && g.key === 'sms' ? (
                    <SmsText it={it} value={v} brand={brand} onChange={(x) => set(it.key, x)} />
                  ) : it.type === 'textarea' ? (
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
                </Wrap>
              );
            })}
          </div>
        </div>
      ))}

      {/* نوارِ ذخیره: تا تغییری هست **چسبانِ پایینِ صفحه** است — متنِ پیامک پنج صفحه بالاتر از
          تنها دکمهٔ ذخیره بود و کاربر نمی‌دانست ذخیره شده یا نه (بازبینیِ UX ۱۴۰۵/۰۷). */}
      {groups && (
        <div className={`st-savebar${dirty.length ? ' on' : ''}`} role="region" aria-label="ذخیرهٔ تنظیمات">
          {dirty.length > 0 && <span className="st-savebar-t">{faNum(dirty.length)} تغییرِ ذخیره‌نشده</span>}
          <button type="button" className="df-save" disabled={busy || !dirty.length} onClick={save}>
            {busy ? 'در حالِ ذخیره…' : dirty.length ? `ذخیرهٔ ${faNum(dirty.length)} تغییر` : 'تغییری نداده‌اید'}
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
function LetterheadPanel({ onToast, org }) {
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
      onToast('سربرگ ذخیره شد');
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
      <h3 className="st-h3" id="st-letterhead" tabIndex={-1}>سربرگِ {org}</h3>
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
      onToast(dryRun ? 'اجرای آزمایشی انجام شد — چیزی ذخیره نشد' : 'ایمپورت انجام شد');
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  const LABELS = {
    surgeons: 'جراحان', hospitals: 'بیمارستان‌ها', procedureTypes: 'انواعِ عمل',
    patients: 'پرونده‌های بیمار', visits: 'مراجعات', charges: 'اقلامِ صورت‌حساب', payments: 'پرداخت‌ها',
  };

  return (
    <>
      <h3 className="st-h3" id="st-import" tabIndex={-1}>وارد کردنِ دادهٔ سامانهٔ قبلی</h3>
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
function AiGuide({ org }) {
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
          لازم نیست این‌جا چیزی پر کنید. اگر می‌خواهید سرویس/کلیدِ خودِ {org} را داشته باشید، «نشانیِ پایه» و
          «کلید» را از ارائه‌دهنده (AvalAI، GapGPT، …) بگیرید و این‌جا بگذارید — تنظیمِ شما بر مرکزی مقدم است.</p>
          <p><b>دستورِ اختصاصی:</b> اگر می‌خواهید دستیار همیشه قاعده‌ای را رعایت کند (مثلاً «توصیه‌های پس از
          عمل را جدا بیاور»)، آن را در فیلدهای «دستورِ اختصاصیِ {org}» بنویسید.</p>
        </div>
      )}
    </div>
  );
}

/** پوستهٔ هر تنظیم: `<label>` برای فیلدِ ساده، `<div>` برای فیلدی که کنترل‌های دیگری هم دارد. */
function Wrap({ kind, children, ...rest }) {
  return kind === 'div' ? <div {...rest}>{children}</div> : <label {...rest}>{children}</label>;
}

/**
 * فهرستِ پرش به بخش‌ها — بالای صفحه و چسبان زیرِ نوارِ پوسته. «تنظیمات» شش تا نُه هزار پیکسل
 * است و پیش از این راهی برای رسیدن به «پیامک‌ها» یا «سربرگ» جز اسکرولِ طولانی نبود. بخشِ
 * جاری با `aria-current` علامت می‌خورد؛ پرش فوکوس را هم به سرتیترِ همان بخش می‌برد.
 */
function SectionNav({ items }) {
  const [active, setActive] = useState(items[0]?.id ?? '');
  const ids = items.map((x) => x.id).join('|');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const els = ids.split('|').map((id) => document.getElementById(id)).filter(Boolean);
    const io = new IntersectionObserver((entries) => {
      const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (hit) setActive(hit.target.id);
    }, { rootMargin: '-120px 0px -60% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ids]);
  const go = (e, id) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
    setActive(id);
  };
  return (
    <nav className="st-nav" aria-label="بخش‌های تنظیمات">
      {items.map((x) => (
        <a key={x.id} href={`#${x.id}`} className={active === x.id ? 'on' : ''} aria-current={active === x.id ? 'location' : undefined}
          onClick={(e) => go(e, x.id)}>{x.label}</a>
      ))}
    </nav>
  );
}

/**
 * هشدارِ ترکِ صفحه با تغییرِ ذخیره‌نشده. `beforeunload` فقط بستن/تازه‌کردنِ زبانه را می‌گیرد؛
 * لینک‌های داخلِ سامانه (react-router) در فازِ capture گرفته می‌شوند — پیش از آنکه `Link`
 * ناوبری کند.
 */
function useUnsavedGuard(on) {
  useEffect(() => {
    if (!on) return undefined;
    const unload = (e) => { e.preventDefault(); e.returnValue = ''; };
    const click = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm('تغییراتِ ذخیره‌نشدهٔ تنظیمات از دست می‌رود. صفحه را ترک می‌کنید؟')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); };
  }, [on]);
}

/* جای‌گیرهای پیامک به فارسی — همان کلیدهای `renderSms`ِ سرور (`common/sms-template.ts`). */
const SMS_VARS = {
  date: 'تاریخ', time: 'ساعت', topic: 'موضوع', title: 'نامِ فرم', link: 'لینک', reason: 'دلیل', stage: 'مرحله', care: 'متنِ مراقبت',
};

/**
 * متنِ پیامک با دکمه‌های «+ تاریخ»، «+ لینک»، … و پیش‌نمایشِ زنده.
 *
 * بازبینیِ UX (۱۴۰۵/۰۷): متن با جای‌گیرهای انگلیسیِ `{date}` و `{link}` و بی‌پیش‌نمایش نوشته
 * می‌شد و کاربر نمی‌دانست پیامکش چند قسمت می‌شود. جای‌گیرهای هر متن از **پیش‌فرضِ همان متن**
 * خوانده می‌شوند (سرور فقط همان‌ها را پر می‌کند)؛ پیش‌نمایش مثلِ سرور نامِ برند را اولِ پیامک
 * می‌گذارد و ساعت و موضوع را با جداکنندهٔ خودشان.
 */
function SmsText({ it, value, brand, onChange }) {
  const ref = useRef(null);
  const vars = [...new Set(String(it.default ?? '').match(/\{(\w+)\}/g) ?? [])].map((x) => x.slice(1, -1)).filter((k) => SMS_VARS[k]);
  const sample = {
    date: jToFa(todayJStr()), time: '، ساعتِ 10:30', topic: ' (ویزیتِ عمومی)', title: 'فرمِ پیگیری',
    link: `https://${window.location.host}/f/k3Jd9sQa`, reason: 'تصویرِ فیش خوانا نیست', stage: 'فیشِ واریزی',
    care: 'تا دو روز پانسمان را خشک نگه دارید.',
  };
  const body = String(value ?? '').replace(/\{(\w+)\}/g, (_, k) => sample[k] ?? '').trim();
  const text = `${brand ? `${brand}\n` : ''}${body}`;
  /* پیامکِ فارسی UCS-2 است: تک‌پیامک ۷۰ نویسه، چندتکه‌ای هر تکه ۶۷. */
  const ucs = /[^\x00-\x7F]/.test(text);
  const len = [...text].length;
  const parts = len === 0 ? 0 : len <= (ucs ? 70 : 160) ? 1 : Math.ceil(len / (ucs ? 67 : 153));
  const insert = (k) => {
    const el = ref.current;
    const token = `{${k}}`;
    const v = String(value ?? '');
    const at = el ? el.selectionStart ?? v.length : v.length;
    const end = el ? el.selectionEnd ?? at : at;
    onChange(v.slice(0, at) + token + v.slice(end));
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(at + token.length, at + token.length); } });
  };
  const pid = `st-sms-${it.key}`;
  return (
    <div className="st-sms">
      <textarea ref={ref} rows={3} maxLength={it.maxLength ?? undefined} value={value}
        aria-labelledby={`st-l-${it.key}`} aria-describedby={pid} onChange={(e) => onChange(e.target.value)} />
      {vars.length > 0 && (
        <div className="st-vars" role="group" aria-label={`افزودنِ جای‌گیر به «${it.label}»`}>
          {vars.map((k) => (
            <button key={k} type="button" className="st-var" onClick={() => insert(k)}>+ {SMS_VARS[k]}</button>
          ))}
        </div>
      )}
      <div className="st-sms-preview" id={pid}>
        <b>پیش‌نمایش</b>
        <p className="st-sms-body" dir="auto">{text || '—'}</p>
        <small>{faNum(len)} نویسه · {parts > 1 ? `${faNum(parts)} پیامک` : 'یک پیامک'}</small>
      </div>
    </div>
  );
}
