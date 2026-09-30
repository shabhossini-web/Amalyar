import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { faDate } from '../lib/jalali.js';
import Tabs from '../ui/Tabs.jsx';
import { ArrowDown, ArrowUp, Plus, Trash } from '../ui/icons.jsx';
import PageHeader from '../ui/PageHeader.jsx';
import './pathways.css';

const faNum = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/* نقش‌ها از `JOB_ROLES`ِ سرور می‌آیند ولی فهرستِ کوتاهِ «مسئولِ گام» این‌جاست،
   چون راننده و پیک مسئولِ مرحلهٔ درمان نیستند. */
const ROLES = [
  ['', '— هرکس برداشت —'], ['doctor', 'پزشک'], ['secretary', 'منشی'],
  ['nurse', 'پرستار'], ['assistant', 'دستیار'], ['technician', 'کارشناس'],
];

/**
 * شش مرحلهٔ ویزارد (سند، W4.2). هر مرحله **یک** تصمیم می‌گیرد؛ ریختنِ همه در
 * یک فرم همان چیزی است که سند «بدونِ کد نمی‌شود ساخت» می‌نامد.
 */
const STEPS = [
  ['pick', '۱ · انتخاب'],
  ['steps', '۲ · مرحله‌ها'],
  ['timing', '۳ · زمان'],
  ['notify', '۴ · اطلاع‌رسانی'],
  ['test', '۵ · آزمون'],
  ['apply', '۶ · اعمال'],
];

const blankStep = (key) => ({ key, title: '', offsetDays: 0, ownerRole: '', notify: '' });

/**
 * کلیدِ مرحلهٔ تازه — **یکتا نسبت به چیزی که الان هست**، نه `length + 1`.
 *
 * ⚠️ شمارشِ ساده یک دنبالهٔ کاملاً عادی را می‌شکند: افزودن، افزودن، حذفِ وسطی،
 * افزودن → دوباره همان کلید. سرور با «کلیدِ … تکراری است» ردش می‌کند و کاربر
 * هیچ راهی برای رفعش ندارد، چون کلید اصلاً در رابط دیده نمی‌شود.
 */
const nextKey = (d) => {
  const used = new Set(d.map((s) => s.key));
  let n = d.length + 1;
  while (used.has(`step-${n}`)) n += 1;
  return `step-${n}`;
};

/**
 * **مسیرِ درمان** — ویزاردِ ساختِ الگو (W4.2).
 *
 * معیارِ پذیرشِ سند: «مدیرِ مجاز **بدونِ کد** یک الگوی محدود بسازد، بیازماید،
 * اعمال کند». پس سه چیز حتمی است: ساختنِ گام‌ها، دیدنِ نتیجه پیش از اعمال، و
 * انتشار.
 *
 * ⚠️ «آزمون» مرحلهٔ جدا و **پیش از** اعمال است، نه یک دکمهٔ کناری: تاریخ‌های
 * نسبی و متنِ پیامک چیزی نیستند که بشود در ذهن حساب کرد، و اشتباهشان یعنی
 * پیامکِ غلط به بیمارِ واقعی.
 *
 * ⚠️ «عدمِ پاسخ» (`escalateDays`) این‌جا **هست** چون از W4.2 گامِ ۲ واقعاً کار
 * می‌کند (کارِ پیگیری می‌سازد). تا وقتی فقط ذخیره می‌شد عمداً نشان داده نمی‌شد
 * — فیلدی که پر شود و کاری نکند، بدترین نوعِ فیلد است.
 */
export default function Pathways() {
  const [templates, setTemplates] = useState(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [picked, setPicked] = useState(null);      // الگوی در دستِ ویرایش
  const [draft, setDraft] = useState([]);          // گام‌های پیش‌نویس
  const [at, setAt] = useState('pick');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () => api('/pathway/templates').then((r) => { setTemplates(r); setErr(''); })
      .catch((e) => { setTemplates([]); setErr(e?.message || 'فهرست باز نشد'); }),
    [],
  );
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  const choose = (t) => {
    setPicked(t);
    /* نسخهٔ منتشرشده نقطهٔ شروع است، نه صفحهٔ سفید — ویرایشِ یک مسیرِ موجود
       کارِ رایج‌تری است از ساختن از هیچ. */
    setDraft((t.publishedVersion?.steps ?? []).map((s) => ({ ...s, notify: s.notify ?? '', ownerRole: s.ownerRole ?? '' })));
    setPreview(null);
    setAt('steps');
  };

  const patch = (i, k, v) => setDraft((d) => d.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const remove = (i) => setDraft((d) => d.filter((_, j) => j !== i));
  const move = (i, by) => setDraft((d) => {
    const j = i + by;
    if (j < 0 || j >= d.length) return d;
    const out = d.slice();
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  });

  /* بدنه‌ای که هم «آزمون» و هم «اعمال» می‌فرستند — یک شکل، تا آنچه آزمودی
     همان چیزی باشد که منتشر می‌شود. */
  const payload = useMemo(() => draft.map((s) => ({
    key: s.key,
    title: s.title?.trim() ?? '',
    offsetDays: Number(s.offsetDays) || 0,
    ...(s.ownerRole ? { ownerRole: s.ownerRole } : {}),
    ...(s.notify?.trim() ? { notify: s.notify.trim() } : {}),
    ...(Number(s.escalateDays) ? { escalateDays: Number(s.escalateDays) } : {}),
  })), [draft]);

  const runTest = async () => {
    setBusy(true); setErr('');
    try {
      setPreview(await api('/pathway/preview', { method: 'POST', body: { steps: payload } }));
      setAt('test');
    } catch (e) { setErr(e?.message || 'آزمون انجام نشد'); } finally { setBusy(false); }
  };

  const apply = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api(`/pathway/templates/${picked.id}/publish`, { method: 'POST', body: { steps: payload } });
      setToast(`نسخهٔ ${faNum(r.version)} منتشر شد`);
      await load();
      setPicked(null); setDraft([]); setPreview(null); setAt('pick');
    } catch (e) { setErr(e?.message || 'انتشار انجام نشد'); } finally { setBusy(false); }
  };

  return (
    <div className="pw">
      <div className="pw-bg" aria-hidden="true" />
      <PageHeader tool="pathway" sub="دورهٔ خدمت را یک‌بار الگو کن — مرحله، مسئول، موعد و پیامِ بیمار. هر انتشار یک نسخهٔ تازه است و دوره‌های در جریان دست نمی‌خورند." />

      {err && <p className="pw-err" role="alert">{err}</p>}

      {!picked ? (
        <section className="pw-list" aria-label="الگوها">
          {templates === null && <p className="pw-empty">در حالِ بارگذاری…</p>}
          {templates?.length === 0 && <p className="pw-empty">هنوز الگویی نیست.</p>}
          {(templates ?? []).map((t) => (
            <article key={t.id} className="pw-card">
              <div className="pw-card-main">
                <b>{t.title}</b>
                {t.notes && <small>{t.notes}</small>}
                {/* هشدار: نقطهٔ وسط کنارِ رقمِ فارسی شبیهِ «۰» است: «نسخهٔ ۱ · ۴ مرحله» «۴۰۱ مرحله» خوانده
                    می‌شد (بازبینیِ UX، clinic-daily-16). جداکنندهٔ بلند و ویرگول، نه «·». */}
                <small className="pw-meta">
                  {t.publishedVersion
                    ? `نسخهٔ ${faNum(t.publishedVersion.version)} — ${faNum(t.publishedVersion.steps.length)} مرحله`
                    : 'بدونِ نسخهٔ منتشرشده'}
                  {t.episodes > 0 && `، ${faNum(t.episodes)} دورهٔ ساخته‌شده`}
                </small>
              </div>
              <button type="button" className="pw-btn" onClick={() => choose(t)}>ویرایش و انتشار</button>
            </article>
          ))}
        </section>
      ) : (
        <section className="pw-wiz" aria-label={`ویزاردِ ${picked.title}`}>
          <header className="pw-wiz-head">
            <b>{picked.title}</b>
            <button type="button" className="pw-ghost" onClick={() => { setPicked(null); setAt('pick'); }}>بازگشت به فهرست</button>
          </header>
          <Tabs label="مرحله‌های ساخت" variant="scroll" value={at} onChange={setAt}
                items={STEPS.map(([k, l]) => ({ key: k, label: l }))} />

          <div className="pw-wiz-body">
            {at === 'pick' && (
              <p className="pw-hint">الگو انتخاب شد. برای ادامه به «مرحله‌ها» بروید.</p>
            )}

            {(at === 'steps' || at === 'timing' || at === 'notify') && (
              <ol className="pw-steps">
                {draft.map((s, i) => (
                  <li key={s.key || i} className="pw-step">
                    <div className="pw-step-no">{faNum(i + 1)}</div>
                    <div className="pw-step-fields">
                      {at === 'steps' && (
                        <>
                          <label className="db-field"><span>عنوانِ مرحله</span>
                            <input value={s.title} maxLength={120}
                                   onChange={(e) => patch(i, 'title', e.target.value)} /></label>
                          <label className="db-field"><span>مسئول</span>
                            <select value={s.ownerRole} onChange={(e) => patch(i, 'ownerRole', e.target.value)}>
                              {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select></label>
                        </>
                      )}
                      {at === 'timing' && (
                        <>
                          <b className="pw-step-title">{s.title || '—'}</b>
                          <label className="db-field">
                            <span>روزِ نسبی از شروعِ دوره</span>
                            <input type="number" inputMode="numeric" value={s.offsetDays}
                                   onChange={(e) => patch(i, 'offsetDays', e.target.value)} />
                            {/* ⚠️ منفی معنی‌دار است و باید همین‌جا گفته شود،
                                وگرنه کسی «۷ روز پیش از عمل» را نمی‌سازد. */}
                            <small>منفی یعنی پیش از مبدأ — مثلاً ‎−۷‎ برای «یک هفته پیش از عمل».</small>
                          </label>
                        </>
                      )}
                      {at === 'notify' && (
                        <>
                          <b className="pw-step-title">{s.title || '—'}</b>
                          <label className="db-field">
                            <span>پیامکِ بیمار در موعدِ این مرحله</span>
                            <textarea rows={2} maxLength={400} value={s.notify}
                                      placeholder="خالی بگذارید تا پیامی نرود"
                                      onChange={(e) => patch(i, 'notify', e.target.value)} />
                            <small>{s.notify?.trim() ? `${faNum(s.notify.trim().length)} از ۴۰۰ نویسه — این متن به دستِ بیمار می‌رسد.` : 'پیامی فرستاده نمی‌شود.'}</small>
                          </label>
                          <label className="db-field">
                            <span>اگر این‌قدر روز بعد از موعد هنوز باز بود، پیگیری شود</span>
                            <input type="number" inputMode="numeric" min="0" max="365"
                                   value={s.escalateDays ?? ''} placeholder="۰ = بی‌خیال"
                                   onChange={(e) => patch(i, 'escalateDays', e.target.value)} />
                          </label>
                        </>
                      )}
                    </div>
                    {at === 'steps' && (
                      <div className="pw-step-acts">
                        <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="بالا">
                          <ArrowUp width="15" height="15" />
                        </button>
                        <button type="button" onClick={() => move(i, 1)} disabled={i === draft.length - 1} aria-label="پایین">
                          <ArrowDown width="15" height="15" />
                        </button>
                        <button type="button" className="danger" onClick={() => remove(i)} aria-label="حذفِ مرحله">
                          <Trash width="15" height="15" />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
                {at === 'steps' && (
                  <li>
                    <button type="button" className="pw-add"
                            onClick={() => setDraft((d) => [...d, blankStep(nextKey(d))])}>
                      <Plus size={14} /> مرحلهٔ تازه
                    </button>
                  </li>
                )}
              </ol>
            )}

            {at === 'test' && (
              <div className="pw-test">
                {!preview ? (
                  <p className="pw-hint">برای دیدنِ تاریخ‌ها و پیام‌ها، «آزمون با بیمارِ ساختگی» را بزنید.</p>
                ) : (
                  <>
                    <p className="pw-hint">
                      مبدأِ فرضی: <b>{faDate(preview.anchor)}</b> — هیچ‌چیز ثبت نشد و هیچ پیامی نرفت.
                    </p>
                    <ol className="pw-prev">
                      {preview.steps.map((s) => (
                        <li key={s.key}>
                          <div className="pw-prev-when">
                            <b>{faDate(s.dueAt)}</b>
                            <small>{s.ownerRoleFa || '—'}</small>
                          </div>
                          <div className="pw-prev-main">
                            <b>{s.title}</b>
                            {s.notify && (
                              <small className={s.notifySends ? 'sends' : 'silent'}>
                                {/* ⚠️ صریح می‌گوید کدام پیام **نمی‌رود** — همان
                                    قاعدهٔ موعدِ گذشته، جایی که کاربر می‌بیندش. */}
                                {s.notifySends ? 'پیامک می‌رود: ' : 'موعدش گذشته، نمی‌رود: '}{s.notify}
                              </small>
                            )}
                            {s.escalateDays > 0 && <small>پیگیری پس از {faNum(s.escalateDays)} روز</small>}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
              </div>
            )}

            {at === 'apply' && (
              <div className="pw-apply">
                <p className="pw-hint">
                  انتشار یک <b>نسخهٔ تازه</b> می‌سازد. دوره‌های در جریان با نسخهٔ خودشان ادامه می‌دهند و
                  ذره‌ای عوض نمی‌شوند؛ نسخهٔ تازه فقط برای دوره‌هایی است که از این به بعد شروع شوند.
                </p>
                {!preview && <p className="pw-warn">هنوز آزمون نگرفته‌اید — پیش از انتشار مرحلهٔ ۵ را ببینید.</p>}
                <button type="button" className="pw-btn primary" disabled={busy || !draft.length} onClick={apply}>
                  {busy ? 'در حالِ انتشار…' : `انتشارِ نسخهٔ ${faNum(picked.nextVersion)}`}
                </button>
              </div>
            )}
          </div>

          <footer className="pw-wiz-foot">
            <button type="button" className="pw-ghost" disabled={busy || at === STEPS[0][0]}
                    onClick={() => setAt(STEPS[Math.max(0, STEPS.findIndex(([k]) => k === at) - 1)][0])}>قبلی</button>
            {at === 'notify'
              ? <button type="button" className="pw-btn" disabled={busy || !draft.length} onClick={runTest}>
                  {busy ? 'در حالِ آزمون…' : 'آزمون با بیمارِ ساختگی'}
                </button>
              : <button type="button" className="pw-btn" disabled={busy || at === STEPS[STEPS.length - 1][0]}
                        onClick={() => setAt(STEPS[Math.min(STEPS.length - 1, STEPS.findIndex(([k]) => k === at) + 1)][0])}>بعدی</button>}
          </footer>
        </section>
      )}

      {/* ناحیهٔ زنده همیشه در DOM، محتوایش عوض می‌شود — `aria-live` روی عنصرِ تازه‌ساخته خوانده نمی‌شود (R15). */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {toast && <button type="button" className="pw-toast" onClick={() => setToast('')}>{toast}</button>}
      </div>
    </div>
  );
}
