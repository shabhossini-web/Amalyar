import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { api, apiBlobUrl, apiUpload } from '../lib/api.js';
import FileDrop from '../ui/FileDrop.jsx';
import { J_MONTHS, jStrToIso, jToday, toEnDigits } from '../lib/jalali.js';
import JGrid from './JGrid.jsx';
import './dispatch.css';
import { Alert, ArrowDown, ArrowUp, CheckCircle, ChevronEnd, Close, Copy, Money, Route, Send, User } from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import TimePick from '../ui/TimePick.jsx';
import HospitalRoster from './HospitalRoster.jsx';
import { badTime, normTime } from '../lib/time.js';
import { usePlaces } from '../lib/places.js';


const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');

/** ساعتِ HH:MM — همان قاعدهٔ سرور، تا پیش از رفت‌وبرگشت خطا معلوم شود. */
const timeOk = (v) => !badTime(v);

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
  const [orphan, setOrphan] = useState([]); // توقفِ جمع‌آوریِ ساخته‌شده ولی بی‌راننده
  const [newRun, setNewRun] = useState(''); // نیروی انتخاب‌شده برای مسیرِ تازه
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState(null); // {visitId, role, text}
  const [costFor, setCostFor] = useState(null); // مسیرِ در حالِ هزینه‌گذاری

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

  /* عکسِ رسید پشتِ هدرِ Authorization است و `<img src>` هدر نمی‌فرستد، پس
     blob URL می‌سازیم — و در پاک‌سازی آزادش می‌کنیم وگرنه حافظه نشت می‌کند. */
  const [proofUrls, setProofUrls] = useState({});
  useEffect(() => {
    const ids = runs.flatMap((r) => r.stops.flatMap((s) => s.proofs.map((p) => p.id)));
    const fresh = ids.filter((id) => !proofUrls[id]);
    if (!fresh.length) return undefined;
    let alive = true;
    const made = [];
    Promise.all(fresh.map((id) => apiBlobUrl(`/routes/proofs/${id}/file`).then((u) => { made.push(u); return [id, u]; }).catch(() => null)))
      .then((pairs) => {
        if (!alive) { made.forEach(URL.revokeObjectURL); return; }
        setProofUrls((m) => ({ ...m, ...Object.fromEntries(pairs.filter(Boolean)) }));
      });
    return () => { alive = false; };
  }, [runs, proofUrls]);

  /* روزِ انتخاب‌شده به میلادی — مسیرها با تاریخِ میلادی صدا زده می‌شوند تا
     تفسیرِ «روز» فقط یک جا (تقویمِ شمسی) انجام شود. */
  const onIso = useMemo(() => jStrToIso(`${ym.y}/${String(ym.m).padStart(2, '0')}/${String(day).padStart(2, '0')}`), [ym, day]);

  const loadRoutes = useCallback(async () => {
    if (!onIso) return;
    try {
      const [d, u, q, o] = await Promise.all([
        api(`/routes/day?on=${onIso}`),
        api(`/routes/unassigned?on=${onIso}`),
        api('/routes/pickup-queue'),
        // توقفی که خودِ اعلامِ پایانِ کارشناس ساخته و هنوز راننده ندارد.
        api('/routes/stops/unassigned'),
      ]);
      setRuns(d.runs);
      setLoose(u);
      setPickup(q);
      setOrphan(o);
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

  const createRun = () =>
    newRun && guard(async () => {
      await api('/routes', { method: 'POST', body: { staffId: Number(newRun), runDate: onIso } });
      setNewRun('');
    }, 'مسیر ساخته شد ✓');

  const addStop = (runId, body) =>
    guard(() => api(`/routes/${runId}/stops`, { method: 'POST', body }), 'توقف اضافه شد ✓');

  /** توقفِ بی‌راننده را به مسیرِ یک نیرو می‌سپارد. */
  const assignStop = (stopId, runId) =>
    guard(() => api(`/routes/stops/${stopId}/assign`, { method: 'POST', body: { runId: Number(runId) } }), 'به مسیر سپرده شد ✓');

  const patchStop = (id, body) => guard(() => api(`/routes/stops/${id}`, { method: 'PATCH', body }));
  /* ⚠️ ساعتِ توقف هم باید از همان دروازهٔ اعتبارسنجی رد شود؛ پیش از این متنِ
     نامعتبر مستقیم PATCH می‌شد و کاربر فقط یک خطای خامِ سرور می‌دید. */
  const setStopTime = (id, value) => {
    const v = normTime(value);
    if (!timeOk(v)) { setToast('ساعت باید به شکلِ ۰۸:۳۰ باشد'); return undefined; }
    return patchStop(id, { plannedAt: v });
  };
  const removeStop = (id) => guard(() => api(`/routes/stops/${id}`, { method: 'DELETE' }));
  const removeRun = (id) => guard(() => api(`/routes/${id}`, { method: 'DELETE' }), 'مسیر حذف شد');
  const detach = (stopId, tid) => guard(() => api(`/routes/stops/${stopId}/transfers/${tid}`, { method: 'DELETE' }));
  /* رسیدِ تحویل چندتاست (عکسِ بار، امضا، فاکتور) — صف را کادرِ مشترک می‌برد
     و خطا **پرتاب** می‌شود تا همان فایل در فهرست قرمز شود. */
  const addProof = async (stopId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    await apiUpload(`/routes/stops/${stopId}/proofs`, fd);
  };

  const addTo = (stopId, tid) => guard(() => api(`/routes/stops/${stopId}/transfers`, { method: 'POST', body: { transferIds: [tid] } }), 'بار به توقف اضافه شد ✓');
  const move = (run, i, dir) => {
    const ids = run.stops.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return undefined;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    return guard(() => api(`/routes/${run.id}/reorder`, { method: 'POST', body: { stopIds: ids } }));
  };

  /** ابلاغِ **کلِ مسیر** — یک پیام برای کلِ روزِ راننده، نه N پیامِ جدا. */
  const openRunBrief = async (run) => {
    setBrief({ role: 'run', text: '' });
    try {
      const d = await api(`/routes/${run.id}/briefing`);
      setBrief({ role: 'run', runId: run.id, text: d.text, roleLabel: `مسیرِ ${run.staff.name}` });
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
        <Link to="/app" className="dp-back"><ChevronEnd width="15" height="15" /> سامانه</Link>
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

      <Tabs
        label="نوعِ چینش"
        tone="amber"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'tech', label: 'کارشناس', icon: User },
          { key: 'transport', label: 'حمل و نقل', icon: Route },
        ]}
      />

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
        {tab === 'transport' && visits.length === 0 && <div className="dp-empty">عملی برای این روز ثبت نشده</div>}

        {tab === 'tech' && <HospitalRoster key={onIso} date={onIso} techs={techs} hospitals={hospitals} onChanged={refresh} />}

        {tab === 'transport' && (
          <div className="dp-routes">
            {/* ⚠️ «عملِ بی‌بار» بالاتر از همه‌چیز است، چون تنها خطای این صفحه
                است که **روزِ عمل** معلوم می‌شود: بیمارستانی که دستگاه یا ست
                نرسیده، عمل ندارد. `noCargo` یعنی هیچ حواله‌ای به نامِ این عمل
                نیست؛ `missingNeeds` یعنی حواله هست ولی الگوی نوعِ عمل کسری
                دارد (مثلاً نورومانیتورینگ بدونِ دستگاه). */}
            {visits.some((v) => v.noCargo || v.missingNeeds?.length) && (
              <div className="dp-nocargo">
                <b><Alert size={14} /> عمل‌های بی‌بار</b>
                {visits.filter((v) => v.noCargo || v.missingNeeds?.length).map((v) => (
                  <span key={v.id} className="dp-chip bad">
                    <em dir="ltr">{v.code}</em>
                    {v.hospital?.name || '—'}
                    {v.opStartTime ? ` · ${v.opStartTime}` : ''}
                    {' · '}
                    {v.noCargo
                      ? 'هیچ حواله‌ای ندارد'
                      : `کسری: ${v.missingNeeds.map((n) => n.name).join('، ')}`}
                  </span>
                ))}
              </div>
            )}

            {/* توقفی که خودِ اعلامِ پایانِ کارشناس ساخته و هنوز راننده ندارد —
                کارشناس گفته «ساعت ۱۷ بیایید CSR»، حالا باید کسی برود. */}
            {orphan.length > 0 && (
              <div className="dp-loose orphan has">
                <b>جمع‌آوریِ بی‌راننده <i>{faNum(orphan.length)}</i></b>
                {orphan.map((s) => (
                  <div key={s.id} className="dp-orphan">
                    <span className="dp-chip courier">
                      {s.plannedAt && <em dir="ltr">{s.plannedAt}</em>}
                      {s.hospitalName || s.locationName || '—'}
                      {s.transfers?.length ? ` · ${s.transfers.map((t) => t.code).join('، ')}` : ''}
                      {s.notes ? ` · ${s.notes}` : ''}
                    </span>
                    <select
                      defaultValue=""
                      disabled={busy || runs.length === 0}
                      onChange={(e) => e.target.value && assignStop(s.id, e.target.value)}
                    >
                      <option value="">— بسپار به مسیرِ —</option>
                      {runs.map((r) => <option key={r.id} value={r.id}>{r.staff.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}

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

            <EquipmentPlan hospitals={hospitals} onIso={onIso} onSaved={loadRoutes} />
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
                  {run.cost?.total > 0 && (
                    <span className="dp-runcost" title="هزینهٔ حملِ این مسیر">{faNum(run.cost.total)} تومان</span>
                  )}
                  <button type="button" className="dp-brief-btn" onClick={() => setCostFor(run)}><Money size={14} /> هزینه</button>
                  <button type="button" className="dp-brief-btn" onClick={() => openRunBrief(run)}><Send size={14} /> ابلاغِ مسیر</button>
                  <button type="button" className="dp-runx" disabled={busy} onClick={() => removeRun(run.id)} title="حذفِ مسیر"><Close size={14} /></button>
                </header>

                <ol className="dp-stops">
                  {run.stops.map((st, i) => (
                    <li key={st.id} className={st.doneAt ? 'done' : ''}>
                      <div className="dp-stophead">
                        <span className="dp-seq">{faNum(st.seq)}</span>
                        <b>{st.locationName}</b>
                        <i className={`dp-kind ${st.kind}`}>{st.kindLabel}</i>
                        <TimeBox label="ساعت" value={st.plannedAt} disabled={busy} onSave={(x) => setStopTime(st.id, x)} />
                        <button type="button" disabled={busy || i === 0} onClick={() => move(run, i, -1)} title="بالاتر"><ArrowUp size={13} /></button>
                        <button type="button" disabled={busy || i === run.stops.length - 1} onClick={() => move(run, i, 1)} title="پایین‌تر"><ArrowDown size={13} /></button>
                        <button
                          type="button"
                          className={st.doneAt ? 'dp-doneon' : ''}
                          disabled={busy}
                          onClick={() => patchStop(st.id, { done: !st.doneAt })}
                          title={st.doneAt ? 'برگرداندن به انجام‌نشده' : 'انجام شد'}
                        ><CheckCircle size={14} /></button>
                        <button type="button" className="x" disabled={busy} onClick={() => removeStop(st.id)} title="حذفِ توقف"><Close size={13} /></button>
                      </div>

                      {/* رسیدِ تحویل — سندِ عملیاتی، نه مدرکِ بالینی. بیشترین
                          اختلاف با بیمارستان همین‌جاست. */}
                      <div className="dp-proofs">
                        {st.proofs.map((pr) => (
                          <a
                            key={pr.id}
                            className="dp-proof"
                            href={proofUrls[pr.id] ?? '#'}
                            target="_blank"
                            rel="noreferrer"
                            title={pr.caption || pr.fileName}
                          >
                            {proofUrls[pr.id] ? <img src={proofUrls[pr.id]} alt="" /> : <i>…</i>}
                          </a>
                        ))}
                        <FileDrop
                          variant="button"
                          accept="image/*"
                          capture="environment"
                          disabled={busy}
                          label="+ رسیدِ تحویل"
                          onUpload={(file) => addProof(st.id, file)}
                          onAllDone={() => { refresh(); setToast("رسید ثبت شد ✓"); }}
                        />
                        {st.handedTo && <span className="dp-handed">تحویل به: {st.handedTo}</span>}
                      </div>

                      <div className="dp-cargo">
                        {st.transfers.length === 0 && <span className="none">بدونِ بار</span>}
                        {st.transfers.map((t) => (
                          <span key={t.id} className="dp-chip cargo">
                            <em dir="ltr">{t.code}</em>
                            {t.lines.map((l) => `${l.itemName}${l.serialNo ? ` (${l.serialNo})` : ''} × ${faNum(l.quantity)}`).join('، ') || 'بدونِ قلم'}
                            <button type="button" className="x" disabled={busy} onClick={() => detach(st.id, t.id)} title="جدا کردن"><Close size={12} /></button>
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
                  onAdd={(body) => addStop(run.id, body)}
                  onErr={setToast}
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

      <AnimatePresence>
        {brief && (
          <Overlay backdrop="dp-overlay" panel="dp-sheet" as="section" onClose={() => setBrief(null)}>
            <header>
              <b>متنِ ابلاغ — {brief.roleLabel ?? '…'}</b>
              <button type="button" onClick={() => setBrief(null)} aria-label="بستن"><Close size={16} /></button>
            </header>
            <pre className="dp-brief">{brief.text || 'در حال ساخت…'}</pre>
            <footer>
              {brief.role !== 'tech' && (
                <span className="dp-privacy">راننده و پیک هیچ اطلاعاتِ بیماری دریافت نمی‌کنند.</span>
              )}
              {brief.runId && <button type="button" className="dp-copy" disabled={busy || !brief.text} onClick={() => guard(async () => { const r = await api(`/routes/${brief.runId}/notify`, { method: 'POST', body: {} }); setToast(r.message); setBrief(null); })}>ارسال ابلاغ به پیامک و ربات</button>}
              <Link to="/app/reminders">وضعیت ارسال‌ها</Link>
              <button type="button" className="dp-copy" disabled={!brief.text} onClick={() => copy(brief.text)}>
                <Copy width="15" height="15" /> کپیِ متن
              </button>
            </footer>
          </Overlay>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {costFor && (
          <RunCost
            run={costFor}
            busy={busy}
            onClose={() => setCostFor(null)}
            onSave={async (body) => {
              await guard(() => api(`/routes/${costFor.id}/cost`, { method: 'PATCH', body }), 'هزینهٔ مسیر ثبت شد');
              setCostFor(null);
            }}
          />
        )}
      </AnimatePresence>

      <div className={`dp-toast${toast ? ' on' : ''}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}

/**
 * افزودنِ توقف به یک مسیر.
 *
 * مقصد یا بیمارستانِ تعریف‌شده است یا نامِ آزاد (انبار، دفتر) — هر دو لازم‌اند:
 * «برگشت به انبار» توقفِ واقعیِ آخرِ روز است و بیمارستان نیست.
 */
function AddStop({ run, hospitals, loose, busy, onAdd, onErr }) {
  const [hid, setHid] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('deliver');
  const [pick, setPick] = useState([]);
  const [at, setAt] = useState('');
  const [who, setWho] = useState('');
  const places = usePlaces();

  const submit = () => {
    if (!hid && !name.trim()) return;
    // ⚠️ ساعت همین‌جا نرمال و سنجیده می‌شود، وگرنه «۸:۵» خام به سرور می‌رود و
    //    کاربر فقط یک خطای خامِ اعتبارسنجی می‌بیند.
    const plannedAt = normTime(at);
    if (plannedAt && !timeOk(plannedAt)) { onErr('ساعت باید به شکلِ ۰۸:۳۰ باشد'); return; }
    onAdd({
      hospitalId: hid ? Number(hid) : undefined,
      locationName: name.trim() || undefined,
      kind,
      transferIds: pick,
      plannedAt: plannedAt || undefined,
      handedTo: who.trim() || undefined,
    });
    setHid(''); setName(''); setPick([]); setAt(''); setWho('');
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
      {/* «چه ساعتی» و «به چه کسی» از همان لحظهٔ چینش تعیین می‌شوند — نه بعداً
          با یک PATCH. راننده‌ای که فقط مقصد را دارد نمی‌داند کِی برود و
          به‌دستِ چه کسی بدهد، و همان جاست که بار پشتِ درِ بستهٔ CSR می‌ماند. */}
      <TimePick className="dp-timebox" label="ساعت" value={at} disabled={busy} onChange={setAt} />
      {/* ⚠️ `list` و نه `select`: «تحویل به» گاهی نامِ یک آدم است («آقای
          رضایی») که در هیچ فهرستی نیست. فهرست میان‌بُر است، نه قفل. */}
      <label>
        <span>تحویل به</span>
        <input
          type="text"
          list="dp-places"
          value={who}
          placeholder="کارشناسِ حاضر / CSR"
          disabled={busy}
          onChange={(e) => setWho(e.target.value)}
        />
        <datalist id="dp-places">
          {places.map((p) => <option key={p} value={p} />)}
        </datalist>
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
            {loose.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code} — {t.hospitalName}
                {t.lines?.length ? ` · ${t.lines.map((l) => l.itemName).join('، ')}` : ''}
              </option>
            ))}
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
 * ورودیِ ساعت که فقط هنگام **قطعی‌شدن** ذخیره می‌کند.
 *
 * ذخیره روی هر کلید یعنی «۰۸» به‌عنوان ساعتِ ناقص به سرور می‌رود و خطا می‌گیرد؛
 * ذخیره روی خروج از فیلد (یا انتخاب از فهرست) یعنی کاربر عدد را کامل می‌کند و
 * بعد یک درخواست می‌رود.
 *
 * ⚠️ حالتِ محلی می‌ماند چون این فیلد **بی‌فرم** است: تا وقتی درخواست ننشسته،
 * `value`ِ والد همان مقدارِ قدیمِ سرور است و اگر مستقیم به آن وصل می‌شد، هر
 * کلید بی‌درنگ پس زده می‌شد. مقایسه با `value` هم لازم است تا صرفِ tab‌زدن از
 * روی فیلد یک PATCHِ بی‌خود نفرستد.
 */
function TimeBox({ label, value, disabled, onSave }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  return (
    <TimePick
      className="dp-timebox"
      label={label}
      value={v}
      disabled={disabled}
      onChange={setV}
      onCommit={(next) => { if (next !== (value ?? '')) onSave(next); }}
    />
  );
}

/**
 * هزینهٔ یک مسیر.
 *
 * ⚠️ همین‌جا **ردیفِ هزینهٔ دفتر** ساخته می‌شود، نه عددی کنارِ مسیر: اگر هزینهٔ
 * حمل فقط روی مسیر می‌نشست، در گزارشِ مالی دیده نمی‌شد و سودِ ماه بیشتر از
 * واقعیت گزارش می‌شد.
 *
 * سرشکنِ per-visit نمایشی است و ذخیره نمی‌شود — وگرنه هزینه دو بار شمرده می‌شد.
 */
function RunCost({ run, busy, onClose, onSave }) {
  const [fuel, setFuel] = useState(run.cost?.fuelCost != null ? String(run.cost.fuelCost) : '');
  const [fee, setFee] = useState(run.cost?.driverFee != null ? String(run.cost.driverFee) : '');
  const [other, setOther] = useState(run.cost?.otherCost != null ? String(run.cost.otherCost) : '');
  const [note, setNote] = useState(run.cost?.costNote ?? '');

  const n = (v) => Math.max(0, Number(toEnDigits(String(v)).replace(/[^\d]/g, '')) || 0);
  const total = n(fuel) + n(fee) + n(other);
  const visits = [...new Set(run.stops.flatMap((s) => s.transfers.map((t) => t.visitCode).filter(Boolean)))];
  const per = visits.length ? Math.floor(total / visits.length) : 0;

  return (
    <Overlay backdrop="dp-overlay" panel="dp-sheet" as="section" onClose={onClose}>
      <header>
        <b>هزینهٔ مسیر — {run.staff.name}</b>
        <button type="button" onClick={onClose} aria-label="بستن"><Close size={16} /></button>
      </header>
      <div className="dp-costbody">
        <label><span>بنزین</span>
          <input type="text" inputMode="numeric" dir="ltr" value={fuel} onChange={(e) => setFuel(e.target.value)} /></label>
        <label><span>دستمزدِ راننده</span>
          <input type="text" inputMode="numeric" dir="ltr" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
        <label><span>هزینهٔ دیگر</span>
          <input type="text" inputMode="numeric" dir="ltr" value={other} onChange={(e) => setOther(e.target.value)} /></label>
        <label className="wide"><span>توضیح</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <p className="dp-costsum">
          جمع: <b>{faNum(total)}</b> تومان
          {visits.length > 0
            ? ` · سرشکن روی ${faNum(visits.length)} عمل ≈ ${faNum(per)} تومان`
            : ' · هیچ عملی روی این مسیر نیست؛ کلِ مبلغ هزینهٔ عمومیِ حمل می‌ماند'}
        </p>
      </div>
      <footer>
        <span className="dp-privacy">ردیفِ هزینه در دفترِ مالی با دستهٔ «حمل و نقل» ثبت می‌شود.</span>
        <button
          type="button"
          className="dp-copy"
          disabled={busy}
          onClick={() => onSave({ fuelCost: n(fuel), driverFee: n(fee), otherCost: n(other), costNote: note || undefined })}
        >
          ثبتِ هزینه
        </button>
      </footer>
    </Overlay>
  );
}

function EquipmentPlan({ hospitals, onIso, onSaved }) {
  const [hospitalId, setHospital] = useState(''), [q, setQ] = useState(''), [lots, setLots] = useState([]), [selected, setSelected] = useState({}), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return; let alive = true; const t = setTimeout(() => api(`/stock/lots?q=${encodeURIComponent(q)}&inStock=1`).then(rows => { if (alive) setLots(rows); }).catch(e => { if (alive) setMessage(e.message); }), 250); return () => { alive = false; clearTimeout(t); }; }, [q, open]);
  const plan = async () => {
    setBusy(true); setMessage('');
    try { const hospital = hospitals.find(h => String(h.id) === hospitalId);
      const lines = Object.entries(selected).map(([id, row]) => ({ lotId: Number(id), quantity: Number(row.quantity) }));
      if (lines.some(l => !Number.isInteger(l.quantity) || l.quantity < 1)) throw new Error('تعداد هر وسیله باید عدد صحیح مثبت باشد');
      const result = await api('/stock/transfers', { method: 'POST', body: { hospitalId: Number(hospitalId), toLocation: hospital.name, plannedFor: onIso, planOnly: true, lines } });
      setSelected({}); setMessage(`حواله ${result.code ?? ''} برنامه‌ریزی شد. اکنون در مسیر راننده، توقف همین بیمارستان را اضافه و این حواله را به بار آن وصل کنید. موجودی هنگام ارسال واقعی حواله جابه‌جا می‌شود.`); await onSaved();
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  return <section className="dp-newrun"><button className="dp-brief-btn" type="button" onClick={() => setOpen(v => !v)}>انتخاب تجهیزات برای بیمارستان</button>
    {open && <div><p>۱. بیمارستان و تجهیزات را انتخاب کنید. ۲. حواله را به توقف مسیر نیرو وصل کنید. ۳. متن برنامه را بازبینی و ابلاغ کنید.</p>
      <label>بیمارستان<select aria-label="بیمارستان" value={hospitalId} disabled={busy} onChange={e => setHospital(e.target.value)}><option value="">انتخاب بیمارستان</option>{hospitals.filter(h => h.active !== false).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
      <label>جستجوی وسیله یا سریال<input value={q} disabled={busy} onChange={e => setQ(e.target.value)} /></label>
      {lots.slice(0, 30).map(l => <label key={l.id}><input type="checkbox" checked={!!selected[l.id]} disabled={busy || l.expired} onChange={e => setSelected(prev => { const n = { ...prev }; if (e.target.checked) n[l.id] = { name: l.itemName, quantity: 1 }; else delete n[l.id]; return n; })} />{l.itemName} · {l.serialNo || l.lotNo} · موجودی {faNum(l.quantity)}</label>)}
      {Object.entries(selected).map(([id, row]) => <label key={id}>{row.name}<input inputMode="numeric" value={row.quantity} disabled={busy} onChange={e => setSelected(prev => ({ ...prev, [id]: { ...prev[id], quantity: toEnDigits(e.target.value) } }))} /><button type="button" disabled={busy} onClick={() => setSelected(prev => { const n = { ...prev }; delete n[id]; return n; })}>حذف</button></label>)}
      <button className="dp-brief-btn" disabled={busy || !hospitalId || !Object.keys(selected).length} onClick={plan}>ثبت حواله برنامه‌ریزی‌شده</button>
      <p role="status">{message}</p>
    </div>}
  </section>;
}
