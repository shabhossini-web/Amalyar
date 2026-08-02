import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { J_MONTHS, jStrToIso, jToday, toEnDigits } from '../lib/jalali.js';
import JGrid from './JGrid.jsx';
import './dispatch.css';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Back = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M9 6l6 6-6 6" /></svg>);
const Copy = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>);

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');

/** ساعتِ HH:MM — همان قاعدهٔ سرور، تا پیش از رفت‌وبرگشت خطا معلوم شود. */
const timeOk = (v) => v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/**
 * پنلِ چینش — دو تب، چون دو کارِ متفاوت‌اند با دو سؤالِ متفاوت.
 *
 * **کارشناس:** چه کسی سرِ کدام عمل می‌رود و کِی باید آن‌جا باشد.
 * **حمل‌ونقل:** چه دستگاه/ستی، چه ساعتی، به کدام بیمارستان، با چه راننده‌ای.
 *
 * هر دو تب از **یک** endpointِ روز تغذیه می‌شوند و فقط رندرشان فرق می‌کند؛ دو
 * منبعِ داده یعنی دو تعریفِ متفاوت از «عمل‌های امروز» — همان اشتباهی که یک‌بار
 * در آمارِ داشبورد کردیم.
 *
 * ⚠️ متنِ ابلاغ از سرور می‌آید، نه از این‌جا: قاعدهٔ «راننده اطلاعاتِ بیمار
 * نمی‌گیرد» باید یک‌جا اعمال شود تا کانالِ بعدی (بله/پیامک) دورش نزند.
 */
export default function Dispatch() {
  const [ty, tm, td] = jToday();
  const [tab, setTab] = useState('tech');
  const [ym, setYm] = useState({ y: ty, m: tm });
  const [day, setDay] = useState(td);
  const [month, setMonth] = useState(null);
  const [board, setBoard] = useState(null);
  const [staff, setStaff] = useState([]);
  const [techs, setTechs] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loose, setLoose] = useState([]);   // حواله‌های بی‌مسیرِ همان روز
  const [pickup, setPickup] = useState([]); // آنچه کارشناس «تمام شد» اعلام کرده
  const [newRun, setNewRun] = useState(''); // نیروی انتخاب‌شده برای مسیرِ تازه
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState(null); // {visitId, role, text}

  useEffect(() => { document.title = 'عمل‌یار — چینش'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const [hospitals, setHospitals] = useState([]);
  useEffect(() => {
    api('/dispatch/staff').then(setStaff).catch((e) => setErr(e.message));
    api('/techs').then(setTechs).catch(() => {});
    api('/hospitals').then(setHospitals).catch(() => {});
  }, []);

  const loadMonth = useCallback(
    () => api(`/dispatch/month?year=${ym.y}&month=${ym.m}`).then(setMonth).catch((e) => { setErr(e.message); setMonth(null); }),
    [ym],
  );
  useEffect(() => { loadMonth(); }, [loadMonth]);

  const loadDay = useCallback(async () => {
    setErr('');
    try { setBoard(await api(`/dispatch/day?year=${ym.y}&month=${ym.m}&day=${day}`)); }
    catch (e) { setErr(e.message); setBoard(null); }
  }, [ym, day]);
  useEffect(() => { loadDay(); }, [loadDay]);

  const refresh = async () => { await loadDay(); loadMonth(); if (tab === 'transport') await loadRoutes(); };

  const byDay = useMemo(() => new Map((month?.days ?? []).map((d) => [d.day, d])), [month]);

  /* روزِ انتخاب‌شده به میلادی — مسیرها با تاریخِ میلادی صدا زده می‌شوند تا
     تفسیرِ «روز» فقط یک جا (تقویمِ شمسی) انجام شود. */
  const onIso = useMemo(() => jStrToIso(`${ym.y}/${String(ym.m).padStart(2, '0')}/${String(day).padStart(2, '0')}`), [ym, day]);

  const loadRoutes = useCallback(async () => {
    if (!onIso) return;
    try {
      const [d, u, q] = await Promise.all([
        api(`/routes/day?on=${onIso}`),
        api(`/routes/unassigned?on=${onIso}`),
        api('/routes/pickup-queue'),
      ]);
      setRuns(d.runs);
      setLoose(u);
      setPickup(q);
    } catch (e) { setErr(e.message); }
  }, [onIso]);
  useEffect(() => { if (tab === 'transport') loadRoutes(); }, [tab, loadRoutes]);

  const guard = async (fn, okMsg) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (okMsg) setToast(okMsg);
    } catch (e) { setToast(e.message); } finally { setBusy(false); }
  };

  /* کارشناس روی خودِ مراجعه نوشته می‌شود (`Visit.techId`) نه در جدولِ تخصیص —
     همان ستونی که تسویه، گزارش و دامنهٔ دسترسیِ کارشناس از آن می‌خوانند. */
  const setTech = (visitId, techId) =>
    guard(() => api(`/visits/${visitId}`, { method: 'PATCH', body: { techId: techId ? Number(techId) : null } }),
      techId ? 'کارشناس ثبت شد ✓' : 'کارشناس برداشته شد');

  const setTime = (visitId, field, value) => {
    const v = toEnDigits(String(value ?? '')).trim();
    if (!timeOk(v)) { setToast('ساعت باید به شکلِ ۰۸:۳۰ باشد'); return undefined; }
    return guard(() => api(`/visits/${visitId}/times`, { method: 'PATCH', body: { [field]: v } }), 'ساعت ثبت شد ✓');
  };

  const createRun = () =>
    newRun && guard(async () => {
      await api('/routes', { method: 'POST', body: { staffId: Number(newRun), runDate: onIso } });
      setNewRun('');
    }, 'مسیر ساخته شد ✓');

  const addStop = (runId, hospitalId, locationName, kind, transferIds) =>
    guard(() => api(`/routes/${runId}/stops`, { method: 'POST', body: { hospitalId, locationName, kind, transferIds } }), 'توقف اضافه شد ✓');

  const patchStop = (id, body) => guard(() => api(`/routes/stops/${id}`, { method: 'PATCH', body }));
  const removeStop = (id) => guard(() => api(`/routes/stops/${id}`, { method: 'DELETE' }));
  const removeRun = (id) => guard(() => api(`/routes/${id}`, { method: 'DELETE' }), 'مسیر حذف شد');
  const detach = (stopId, tid) => guard(() => api(`/routes/stops/${stopId}/transfers/${tid}`, { method: 'DELETE' }));
  const addTo = (stopId, tid) => guard(() => api(`/routes/stops/${stopId}/transfers`, { method: 'POST', body: { transferIds: [tid] } }), 'بار به توقف اضافه شد ✓');
  const move = (run, i, dir) => {
    const ids = run.stops.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return undefined;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    return guard(() => api(`/routes/${run.id}/reorder`, { method: 'POST', body: { stopIds: ids } }));
  };

  const openBrief = async (visitId, role) => {
    setBrief({ role, text: '' });
    try {
      const d = await api(`/dispatch/visits/${visitId}/briefing?role=${role}`);
      setBrief({ role, text: d.text, roleLabel: d.roleLabel });
    } catch (e) { setToast(e.message); setBrief(null); }
  };

  /** ابلاغِ **کلِ مسیر** — یک پیام برای کلِ روزِ راننده، نه N پیامِ جدا. */
  const openRunBrief = async (run) => {
    setBrief({ role: 'run', text: '' });
    try {
      const d = await api(`/routes/${run.id}/briefing`);
      setBrief({ role: 'run', text: d.text, roleLabel: `مسیرِ ${run.staff.name}` });
    } catch (e) { setToast(e.message); setBrief(null); }
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast('متن کپی شد ✓');
    } catch {
      // Safariِ قدیمی و بسترهای بدونِ clipboard API: کاربر خودش انتخاب کند
      setToast('کپیِ خودکار ممکن نشد — متن را دستی انتخاب کنید');
    }
  };

  const visits = board?.visits ?? [];
  const gaps = (month?.days ?? []).reduce(
    (a, d) => ({ tech: a.tech + d.noTech, driver: a.driver + d.noDriver }), { tech: 0, driver: 0 },
  );
  const gapNow = tab === 'tech' ? gaps.tech : gaps.driver;

  return (
    <div className="dp">
      <div className="dp-bg" aria-hidden="true" />
      <header className="dp-head">
        <Link to="/app" className="dp-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1>چینشِ نیروها</h1>
          <p>
            {month ? `${faNum(month.total)} عمل در ${J_MONTHS[ym.m - 1]}` : 'در حال بارگذاری…'}
            {gapNow > 0 && (
              <em className="dp-gapnote">
                {' — '}{faNum(gapNow)} عمل بدونِ {tab === 'tech' ? 'کارشناس' : 'راننده'}
              </em>
            )}
          </p>
        </div>
      </header>

      <nav className="dp-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'tech'} className={tab === 'tech' ? 'on' : ''} onClick={() => setTab('tech')}>
          کارشناس
        </button>
        <button type="button" role="tab" aria-selected={tab === 'transport'} className={tab === 'transport' ? 'on' : ''} onClick={() => setTab('transport')}>
          حمل و نقل
        </button>
      </nav>

      {err && <div className="dp-err">{err}</div>}

      <JGrid
        year={ym.y}
        month={ym.m}
        selected={day}
        onNav={(y, m) => { setYm({ y, m }); setDay(1); }}
        onPickDay={setDay}
        renderDay={(d) => {
          const cell = byDay.get(d);
          if (!cell) return null;
          const gap = tab === 'tech' ? cell.noTech : cell.noDriver;
          return (
            <div className="dp-cell">
              <i className="t">{faNum(cell.total)} عمل</i>
              {gap > 0 && (
                <i className="g" title={tab === 'tech' ? 'بدونِ کارشناس' : 'بار دارد ولی راننده ندارد'}>
                  {faNum(gap)} بدونِ {tab === 'tech' ? 'کارشناس' : 'راننده'}
                </i>
              )}
            </div>
          );
        }}
      />

      <section className="dp-day">
        <b>{faNum(day)} {J_MONTHS[ym.m - 1]}</b>
        {visits.length === 0 && <div className="dp-empty">عملی برای این روز ثبت نشده</div>}

        {tab === 'tech' && visits.map((v) => (
          <article key={v.id} className={`dp-card${v.tech ? '' : ' gap'}`}>
            <header>
              <span className="dp-time" dir="ltr">{v.opStartTime || '—'}</span>
              <div className="dp-title">
                <b>{v.fullName} <i dir="ltr">{v.code}</i></b>
                <small>{[v.hospital?.name, v.procedureName, v.surgeonName].filter(Boolean).join(' · ') || '—'}</small>
              </div>
            </header>

            <div className="dp-pick">
              <label>
                <span>کارشناس</span>
                <select value={v.tech?.id ?? ''} disabled={busy} onChange={(e) => setTech(v.id, e.target.value)}>
                  <option value="">— تعیین‌نشده —</option>
                  {techs.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
                </select>
              </label>
              <TimeBox label="ساعتِ حضور" value={v.techArriveTime} disabled={busy} onSave={(x) => setTime(v.id, 'techArriveTime', x)} />
              {v.tech && (
                <button type="button" className="dp-brief-btn" onClick={() => openBrief(v.id, 'tech')}>✉ متنِ ابلاغ</button>
              )}
            </div>
          </article>
        ))}

        {tab === 'transport' && (
          <div className="dp-routes">
            {/* حواله‌های بی‌مسیر = کارِ باقی‌ماندهٔ چینش. بالای صفحه است چون
                همان چیزی است که چینش‌کننده دنبالش آمده. */}
            <div className={`dp-loose${loose.length ? ' has' : ''}`}>
              <b>بارِ بی‌مسیر {loose.length > 0 && <i>{faNum(loose.length)}</i>}</b>
              {loose.length === 0
                ? <span className="dp-none ok">همهٔ بارِ امروز روی مسیر است ✓</span>
                : loose.map((t) => (
                  <span key={t.id} className="dp-chip cargo" title={t.lines.map((l) => l.itemName).join('، ')}>
                    <em dir="ltr">{t.code}</em>
                    {t.hospitalName}
                    {t.opStartTime ? ` · ${t.opStartTime}` : ''}
                    {' · '}{t.lines.map((l) => `${l.itemName}${l.serialNo ? ` (${l.serialNo})` : ''}`).join('، ') || 'بدونِ قلم'}
                  </span>
                ))}
            </div>

            {/* صفِ جمع‌آوری: آنچه کارشناس «تمام شد» اعلام کرده و هنوز برنگشته.
                عمداً به روزِ انتخاب‌شده مقید نیست — ستی که دیروز آزاد شد و کسی
                جمعش نکرد باید امروز هم دیده شود. */}
            {pickup.length > 0 && (
              <div className="dp-loose pickup">
                <b>آمادهٔ جمع‌آوری <i>{faNum(pickup.length)}</i></b>
                {pickup.map((t) => (
                  <span key={t.id} className="dp-chip courier">
                    <em dir="ltr">{t.code}</em>
                    {t.hospitalName}
                    {' · '}{t.lines.map((l) => `${l.itemName}${l.serialNo ? ` (${l.serialNo})` : ''}`).join('، ') || 'بدونِ قلم'}
                    {t.releaseNote && <em title={t.releaseNote}>یادداشت</em>}
                  </span>
                ))}
              </div>
            )}

            <div className="dp-newrun">
              <label>
                <span>مسیرِ تازه برای</span>
                <select value={newRun} disabled={busy} onChange={(e) => setNewRun(e.target.value)}>
                  <option value="">— نیرو —</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.roleLabel}){s.vehicle ? ` — ${s.vehicle}` : ''}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="dp-brief-btn" disabled={busy || !newRun} onClick={createRun}>+ ساختِ مسیر</button>
            </div>

            {runs.length === 0 && <div className="dp-empty">مسیری برای این روز ساخته نشده</div>}

            {runs.map((run) => (
              <article key={run.id} className="dp-run">
                <header>
                  <b>
                    {run.staff.name}
                    <i className="dp-runrole">{run.staff.role === 'driver' ? 'راننده' : 'پیک'}</i>
                    {run.vehicle && <em>{run.vehicle}</em>}
                  </b>
                  <span className="dp-runmeta">{faNum(run.stops.length)} توقف</span>
                  <button type="button" className="dp-brief-btn" onClick={() => openRunBrief(run)}>✉ ابلاغِ مسیر</button>
                  <button type="button" className="dp-runx" disabled={busy} onClick={() => removeRun(run.id)} title="حذفِ مسیر">✕</button>
                </header>

                <ol className="dp-stops">
                  {run.stops.map((st, i) => (
                    <li key={st.id} className={st.doneAt ? 'done' : ''}>
                      <div className="dp-stophead">
                        <span className="dp-seq">{faNum(st.seq)}</span>
                        <b>{st.locationName}</b>
                        <i className={`dp-kind ${st.kind}`}>{st.kindLabel}</i>
                        <TimeBox label="ساعت" value={st.plannedAt} disabled={busy} onSave={(x) => patchStop(st.id, { plannedAt: x })} />
                        <button type="button" disabled={busy || i === 0} onClick={() => move(run, i, -1)} title="بالاتر">▲</button>
                        <button type="button" disabled={busy || i === run.stops.length - 1} onClick={() => move(run, i, 1)} title="پایین‌تر">▼</button>
                        <button
                          type="button"
                          className={st.doneAt ? 'dp-doneon' : ''}
                          disabled={busy}
                          onClick={() => patchStop(st.id, { done: !st.doneAt })}
                          title={st.doneAt ? 'برگرداندن به انجام‌نشده' : 'انجام شد'}
                        >✔</button>
                        <button type="button" className="x" disabled={busy} onClick={() => removeStop(st.id)} title="حذفِ توقف">✕</button>
                      </div>

                      <div className="dp-cargo">
                        {st.transfers.length === 0 && <span className="none">بدونِ بار</span>}
                        {st.transfers.map((t) => (
                          <span key={t.id} className="dp-chip cargo">
                            <em dir="ltr">{t.code}</em>
                            {t.lines.map((l) => `${l.itemName}${l.serialNo ? ` (${l.serialNo})` : ''} × ${faNum(l.quantity)}`).join('، ') || 'بدونِ قلم'}
                            <button type="button" className="x" disabled={busy} onClick={() => detach(st.id, t.id)} title="جدا کردن">✕</button>
                          </span>
                        ))}
                        {/* توقفِ جمع‌آوری از صفِ آزادشده‌ها تغذیه می‌شود، توقفِ
                            تحویل از بارِ بی‌مسیر — دو کارِ متفاوت با دو منبع. */}
                        {(st.kind === 'pickup' ? pickup : loose).length > 0 && (
                          <select
                            className="dp-attach"
                            value=""
                            disabled={busy}
                            onChange={(e) => e.target.value && addTo(st.id, Number(e.target.value))}
                          >
                            <option value="">{st.kind === 'pickup' ? 'افزودن از صفِ جمع‌آوری…' : 'افزودنِ بار…'}</option>
                            {(st.kind === 'pickup' ? pickup : loose).map((t) => (
                              <option key={t.id} value={t.id}>{t.code} — {t.hospitalName}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>

                <AddStop
                  run={run}
                  hospitals={hospitals}
                  loose={loose}
                  busy={busy}
                  onAdd={(hid, name, kind, ids) => addStop(run.id, hid, name, kind, ids)}
                />
              </article>
            ))}

            {staff.length === 0 && (
              <p className="dp-nopool">
                هنوز راننده یا پیکی تعریف نشده — از <Link to="/app/definitions">تعاریفِ پایه › راننده و پیک</Link> اضافه کنید.
              </p>
            )}
          </div>
        )}
      </section>

      {brief && (
        <div className="dp-overlay" onClick={(e) => { if (e.target === e.currentTarget) setBrief(null); }}>
          <section className="dp-sheet">
            <header>
              <b>متنِ ابلاغ — {brief.roleLabel ?? '…'}</b>
              <button type="button" onClick={() => setBrief(null)} aria-label="بستن">✕</button>
            </header>
            <pre className="dp-brief">{brief.text || 'در حال ساخت…'}</pre>
            <footer>
              {brief.role !== 'tech' && (
                <span className="dp-privacy">راننده و پیک هیچ اطلاعاتِ بیماری دریافت نمی‌کنند.</span>
              )}
              <button type="button" className="dp-copy" disabled={!brief.text} onClick={() => copy(brief.text)}>
                <Copy width="15" height="15" /> کپیِ متن
              </button>
            </footer>
          </section>
        </div>
      )}

      <div className={`dp-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}

/**
 * افزودنِ توقف به یک مسیر.
 *
 * مقصد یا بیمارستانِ تعریف‌شده است یا نامِ آزاد (انبار، دفتر) — هر دو لازم‌اند:
 * «برگشت به انبار» توقفِ واقعیِ آخرِ روز است و بیمارستان نیست.
 */
function AddStop({ run, hospitals, loose, busy, onAdd }) {
  const [hid, setHid] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('deliver');
  const [pick, setPick] = useState([]);

  const submit = () => {
    if (!hid && !name.trim()) return;
    onAdd(hid ? Number(hid) : undefined, name.trim() || undefined, kind, pick);
    setHid(''); setName(''); setPick([]);
  };

  return (
    <div className="dp-addstop">
      <label>
        <span>مقصد</span>
        <select value={hid} onChange={(e) => { setHid(e.target.value); if (e.target.value) setName(''); }} disabled={busy}>
          <option value="">— بیمارستان —</option>
          {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </label>
      <label>
        <span>یا جای دیگر</span>
        <input
          type="text"
          value={name}
          placeholder="انبارِ مرکزی"
          disabled={busy || !!hid}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        <span>نوع</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={busy}>
          <option value="deliver">تحویل</option>
          <option value="pickup">جمع‌آوری</option>
        </select>
      </label>
      {loose.length > 0 && (
        <label>
          <span>بار</span>
          <select
            multiple
            size={Math.min(3, loose.length)}
            value={pick.map(String)}
            disabled={busy}
            onChange={(e) => setPick([...e.target.selectedOptions].map((o) => Number(o.value)))}
          >
            {loose.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.hospitalName}</option>)}
          </select>
        </label>
      )}
      <button type="button" className="dp-brief-btn" disabled={busy || (!hid && !name.trim())} onClick={submit}>
        + توقف
      </button>
    </div>
  );
}

/**
 * ورودیِ ساعت که فقط هنگام خروج از فیلد ذخیره می‌کند.
 *
 * ذخیره روی هر کلید یعنی «۰۸» به‌عنوان ساعتِ ناقص به سرور می‌رود و خطا می‌گیرد؛
 * ذخیره روی blur یعنی کاربر عدد را کامل می‌کند و بعد یک درخواست می‌رود.
 */
function TimeBox({ label, value, disabled, onSave }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  return (
    <label className="dp-timebox">
      <span>{label}</span>
      <input
        type="text"
        inputMode="numeric"
        dir="ltr"
        placeholder="۰۸:۳۰"
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if ((v ?? '') !== (value ?? '')) onSave(v); }}
      />
    </label>
  );
}
