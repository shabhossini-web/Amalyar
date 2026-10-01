import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { faDate, toEnDigits } from '../lib/jalali.js';
import { faTime } from '../lib/time.js';
import { usePlaces } from '../lib/places.js';
import { useTerms } from './config.jsx';
import TimePick from '../ui/TimePick.jsx';
import { Alert, ArrowDown, ArrowUp, Box, CheckCircle, Close, Hospital, Phone, Send, Truck, User } from '../ui/icons.jsx';
import './transport-board.css';

const num = (n) => Number(n ?? 0).toLocaleString('fa-IR');
const linesText = (lines) => (lines ?? []).map((l) => `${l.itemName}${l.serialNo ? ` (${l.serialNo})` : ''}${l.quantity > 1 ? ` × ${num(l.quantity)}` : ''}`).join('، ') || 'بدونِ قلم';

/**
 * تختهٔ روزِ حمل‌ونقل.
 *
 * ورودی فقط «روز» است: بیمارستان‌های همان روز با عمل‌ها و کارشناسِ حاضرشان خودکار
 * می‌آیند و کاربر روی هر کارت می‌گوید **چه چیزی، چه ساعتی، به چه کسی، با چه راننده‌ای**.
 * «ثبتِ تحویل» حواله، مسیرِ راننده و توقف را یک‌جا می‌سازد (`POST /routes/board/delivery`)؛
 * هیچ فرمِ جداگانه‌ای برای حواله یا مسیر نمی‌ماند.
 */
export default function TransportBoard({ on, onChanged, onToast }) {
  const terms = useTerms();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null); // کلیدِ کارتِ در حالِ ثبتِ تحویل

  const load = useCallback(async () => {
    if (!on) return;
    setErr('');
    try { setData(await api(`/routes/board?on=${on}`)); }
    catch (e) { setErr(e.message); setData(null); }
  }, [on]);
  useEffect(() => { load(); }, [load]);

  const apply = async (fn, okMsg) => {
    if (busy) return false;
    setBusy(true);
    try {
      const next = await fn();
      if (next?.hospitals) setData(next); else await load();
      onChanged?.();
      if (okMsg) onToast?.(okMsg);
      return true;
    } catch (e) { onToast?.(e.message); return false; } finally { setBusy(false); }
  };

  const post = (body) => api('/routes/board/delivery', { method: 'POST', body: { on, ...body } });
  const removeDelivery = (id) => apply(() => api(`/routes/board/delivery/${id}`, { method: 'DELETE' }), 'تحویل حذف شد');
  const removeTransfer = (id) => apply(() => api(`/routes/board/transfer/${id}`, { method: 'DELETE' }), 'قلم برداشته شد');
  /* رزروِ جامانده (حوالهٔ ارسال‌نشدهٔ بی‌توقف) از فرمِ تحویل لغو می‌شود. هشدار: همین روز دوباره خوانده
     می‌شود، نه تختهٔ روزِ آن حواله که پاسخِ سرور است — حواله ممکن است مالِ روزِ دیگری باشد. */
  const cancelHold = (id) => apply(async () => { await api(`/routes/board/transfer/${id}`, { method: 'DELETE' }); return null; }, 'رزرو لغو شد و به انبار برگشت');

  /** ابلاغِ برنامهٔ **همهٔ** راننده‌های روز — یک پیام برای هر راننده، بدونِ اطلاعاتِ بیمار. */
  const notifyAll = () => apply(async () => {
    const runs = data?.runs ?? [];
    let ok = 0; const bad = [];
    for (const r of runs) {
      try { await api(`/routes/${r.id}/notify`, { method: 'POST' }); ok += 1; } catch (e) { bad.push(`${r.staffName}: ${e.message}`); }
    }
    if (bad.length) throw new Error(`ارسال برای ${num(bad.length)} راننده انجام نشد — ${bad.join('؛ ')}`);
    onToast?.(`برنامه برای ${num(ok)} راننده ارسال شد`);
    return null;
  });

  if (err) return <div className="tb-err" role="alert"><Alert width="14" height="14" /> {err}</div>;
  if (!data) return <div className="tb-empty">در حال بارگذاری…</div>;

  const { hospitals, drivers, runs, summary } = data;
  if (hospitals.length === 0) return <div className="tb-empty">برای این روز {terms.surgery}ی ثبت نشده</div>;

  return (
    <div className="tb">
      <div className="tb-sum">
        <span><b>{num(summary.hospitals)}</b> بیمارستان</span>
        <span className={summary.noCargo ? 'bad' : 'ok'}><b>{num(summary.noCargo)}</b> بدونِ بار</span>
        <span className={summary.noDriver ? 'warn' : 'ok'}><b>{num(summary.noDriver)}</b> بدونِ راننده</span>
        <button type="button" className="tb-btn ghost" disabled={busy || runs.length === 0} onClick={notifyAll}>
          <Send width="14" height="14" /> ارسالِ برنامه به راننده‌ها
        </button>
      </div>

      {drivers.length === 0 && (
        <p className="tb-note">راننده‌ای تعریف نشده — از تعاریفِ پایه › راننده و پیک اضافه کنید.</p>
      )}

      {hospitals.map((h) => (
        <Card
          key={h.key}
          h={h}
          on={on}
          terms={terms}
          drivers={drivers}
          runs={runs}
          busy={busy}
          isOpen={open === h.key}
          onOpen={() => setOpen(open === h.key ? null : h.key)}
          onSave={async (body) => { const ok = await apply(() => post({ hospitalId: h.hospitalId, ...body }), 'تحویل ثبت شد'); if (ok) setOpen(null); return ok; }}
          onPatch={(stopId, body) => apply(() => post({ hospitalId: h.hospitalId, stopId, ...body }))}
          onRemoveDelivery={removeDelivery}
          onRemoveTransfer={removeTransfer}
          onCancelHold={cancelHold}
          onPickup={(body) => apply(async () => {
            const run = runs.find((r) => r.staffId === Number(body.staffId))
              ?? await api('/routes', { method: 'POST', body: { staffId: Number(body.staffId), runDate: on } });
            await api(`/routes/${run.id}/stops`, { method: 'POST', body: { hospitalId: h.hospitalId, kind: 'pickup', plannedAt: body.plannedAt || undefined, transferIds: body.transferIds } });
            return null;
          }, 'جمع‌آوری ثبت شد')}
        />
      ))}
    </div>
  );
}

function Card({ h, on, terms, drivers, runs, busy, isOpen, onOpen, onSave, onPatch, onRemoveDelivery, onRemoveTransfer, onCancelHold, onPickup }) {
  const missing = h.visits.length > 0 && !h.hasCargo;
  return (
    <article className={`tb-card${missing ? ' missing' : ''}`}>
      <header>
        <div className="tb-title">
          <b><Hospital width="14" height="14" /> {h.name}</b>
          <small>
            {num(h.visits.length)} {terms.surgery}
            {h.firstTime ? ` · از ساعت ${faTime(h.firstTime)}` : ''}
          </small>
        </div>
        {missing ? <span className="tb-tag bad">بدونِ بار</span> : h.hasCargo ? <span className="tb-tag ok">بار دارد</span> : null}
      </header>

      <div className="tb-people">
        {h.techs.length === 0
          ? <span className="tb-tech off"><User width="12" height="12" /> کارشناسی چیده نشده</span>
          : h.techs.map((t) => (
            <span key={t.id} className="tb-tech">
              <User width="12" height="12" /> {t.name}{t.arriveTime ? ` · حضور ${faTime(t.arriveTime)}` : ''}
              {t.phone && <a href={`tel:${t.phone}`} aria-label={`تماس با ${t.name}`}><Phone width="12" height="12" /></a>}
            </span>
          ))}
      </div>

      {h.deliveries.map((d) => (
        <div key={d.id} className={`tb-row${d.doneAt ? ' done' : ''}`}>
          <div className="tb-row-head">
            <i className="tb-kind">تحویل</i>
            <b dir="ltr">{d.plannedAt ? faTime(d.plannedAt) : 'بدونِ ساعت'}</b>
            {d.handedTo && <span className="tb-handed"><User width="12" height="12" /> {d.handedTo}</span>}
            {d.doneAt && <span className="tb-tag ok"><CheckCircle width="12" height="12" /> تحویل شد</span>}
            {!d.doneAt && (
              <>
                <label className="tb-drv">
                  <Truck width="13" height="13" />
                  <select
                    value={d.staffId ?? ''}
                    disabled={busy}
                    aria-label="راننده"
                    onChange={(e) => onPatch(d.id, { staffId: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">راننده انتخاب نشده</option>
                    {drivers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.vehicle ? ` — ${s.vehicle}` : ''}</option>)}
                  </select>
                </label>
                <button type="button" className="tb-x" disabled={busy} onClick={() => onRemoveDelivery(d.id)} aria-label="حذفِ تحویل"><Close width="14" height="14" /></button>
              </>
            )}
          </div>
          <div className="tb-cargo">
            {d.transfers.length === 0 && <span className="tb-none"><Alert width="12" height="12" /> بدونِ قلم</span>}
            {d.transfers.map((t) => (
              <span key={t.id} className="tb-chip">
                <Box width="12" height="12" /> <em dir="ltr">{t.code}</em> {linesText(t.lines)}
                {!d.doneAt && t.status === 'planned' && (
                  <button type="button" disabled={busy} onClick={() => onRemoveTransfer(t.id)} aria-label={`برداشتنِ ${t.code}`}><Close width="12" height="12" /></button>
                )}
              </span>
            ))}
          </div>
        </div>
      ))}

      {(h.pickupQueue.length > 0 || h.pickupStops.length > 0) && (
        <Pickup h={h} drivers={drivers} runs={runs} busy={busy} onPickup={onPickup} />
      )}

      {isOpen
        ? <Editor h={h} on={on} drivers={drivers} busy={busy} onSave={onSave} onCancel={onOpen} onCancelHold={onCancelHold} />
        : <button type="button" className="tb-btn" disabled={busy} onClick={onOpen}>+ تحویلِ تازه</button>}
    </article>
  );
}

/** بارِ آزادشدهٔ همین بیمارستان که هنوز راننده‌ای برای برگشتش تعیین نشده. */
function Pickup({ h, drivers, busy, onPickup }) {
  const [staffId, setStaffId] = useState('');
  const [at, setAt] = useState('');
  return (
    <div className="tb-row pickup">
      <div className="tb-row-head"><i className="tb-kind pick">جمع‌آوری</i></div>
      {h.pickupStops.map((p) => (
        <div key={p.id} className="tb-cargo">
          <span className="tb-chip">
            {p.plannedAt ? <b dir="ltr">{faTime(p.plannedAt)}</b> : null}
            {p.staffName ? ` ${p.staffName}` : ' بدونِ راننده'}{p.doneAt ? ' — انجام شد' : ''}
          </span>
        </div>
      ))}
      {h.pickupQueue.length > 0 && (
        <>
          <div className="tb-cargo">
            {h.pickupQueue.map((q) => (
              <span key={q.id} className="tb-chip"><Box width="12" height="12" /> <em dir="ltr">{q.code}</em> {linesText(q.lines)}{q.releaseNote ? ` — ${q.releaseNote}` : ''}</span>
            ))}
          </div>
          <div className="tb-form inline">
            <TimePick label="ساعتِ جمع‌آوری" value={at} onChange={setAt} disabled={busy} />
            <label className="tb-drv">
              <Truck width="13" height="13" />
              <select value={staffId} disabled={busy} onChange={(e) => setStaffId(e.target.value)} aria-label="راننده">
                <option value="">راننده</option>
                {drivers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="tb-btn"
              disabled={busy || !staffId}
              onClick={() => onPickup({ staffId, plannedAt: at, transferIds: h.pickupQueue.map((q) => q.id) })}
            >ثبتِ جمع‌آوری</button>
          </div>
        </>
      )}
    </div>
  );
}

/** فرمِ یک تحویل: قلم‌ها از انبار، ساعت، تحویل‌گیرنده و راننده. */
/**
 * چرا این قلم آزاد نیست — هر رزرو یا هر عددِ بیرون از انبار، با حواله‌اش (`Hold`ِ سرور).
 *
 * گزارشِ مالک (۱۴۰۵/۰۷/۰۹): «دستگاه و دو ست هنوز گیرند و هیچ‌جا حواله‌ای نشان نمی‌دهد که حذفش
 * کنم.» تا امروز این‌جا فقط «آزاد نیست» بود. هر رزرو همین‌جا لغو می‌شود — همان «برداشتنِ قلم»ِ
 * کارتِ تحویل؛ رزروِ **بی‌توقف** (جامانده از توقفی که پاک شده، یا مالِ روزِ دیگری که در «بارِ
 * بی‌مسیر»ِ امروز نیست) با «بی‌توقف» علامت می‌خورد. عددِ «بیرون» واقعاً از انبار رفته و فقط با
 * برگشتِ انبار برمی‌گردد، پس دکمه ندارد. ردیف‌هایی که «جابجایی» (inUse) از قبل توضیح می‌دهد
 * تکرار نمی‌شوند.
 */
function Holds({ l, busy, onCancel }) {
  /* وقتی قلم آزاد است، رزروهای عادیِ تحویل‌های دیگر فقط شلوغی‌اند؛ فقط رزروِ جامانده (بی‌توقف) دیده شود. */
  const rows = (l.holds ?? [])
    .filter((x) => !(l.inUse ?? []).some((u) => u.transferId && u.transferId === x.transferId))
    .filter((x) => l.free < 1 || (x.kind === 'planned' && !x.stopId));
  if (!rows.length) return null;
  return (
    <ul className="tb-holds">
      {rows.map((x, i) => (
        <li key={`${x.kind}-${x.transferId ?? x.place}-${i}`}>
          <span>
            {x.kind === 'out'
              ? <>{num(x.quantity)} عدد بیرون از انبار: {x.place}{x.code ? <> (<bdi dir="ltr">{x.code}</bdi>)</> : ''} — برگشتش از «انبار»</>
              : <>
                  {num(x.quantity)} عدد رزروِ <bdi dir="ltr">{x.code}</bdi> · {x.place}{x.plannedFor ? ` · ${faDate(x.plannedFor)}` : ''}
                  {x.plannedAt ? <> · <bdi dir="ltr">{faTime(x.plannedAt)}</bdi></> : ''}
                  {x.stopId ? '' : ' — بی‌توقف'}
                </>}
          </span>
          {x.kind === 'planned' && (
            /* لغو کلِ حواله است (همهٔ اقلامش)، پس دکمه نامِ حواله را می‌گوید نه نامِ این قلم را. */
            <button
              type="button" className="tb-hold-x" disabled={busy} onClick={() => onCancel(x.transferId)}
              aria-label={`لغوِ حوالهٔ ${x.code} و برگشتِ همهٔ اقلامش به انبار`}
            >
              <Close width="12" height="12" aria-hidden="true" /> لغوِ <bdi dir="ltr">{x.code}</bdi>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Editor({ h, on, drivers, busy, onSave, onCancel, onCancelHold }) {
  const places = usePlaces();
  const [q, setQ] = useState('');
  const [lots, setLots] = useState([]);
  const [picked, setPicked] = useState({}); // lotId → { name, quantity, max, move }
  const [at, setAt] = useState('');
  const [who, setWho] = useState(h.techs[0] ? 'کارشناسِ حاضر' : '');
  const [staffId, setStaffId] = useState(drivers.length === 1 ? String(drivers[0].id) : '');
  const [force, setForce] = useState(false);
  const [msg, setMsg] = useState('');
  const [reload, setReload] = useState(0); // پس از لغوِ یک رزرو، موجودی دوباره خوانده شود

  /* موجودیِ **آزادِ همان روز** از سرور — همان عددی که «ثبت» با آن سنجیده می‌شود. */
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api(`/routes/board/lots?on=${on}&q=${encodeURIComponent(q)}${h.hospitalId ? `&hospitalId=${h.hospitalId}` : ''}`)
        .then((rows) => { if (alive) setLots(rows); })
        .catch((e) => { if (alive) setMsg(e.message); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, on, h.hospitalId, reload]);

  const cancelHold = async (id) => { if (await onCancelHold(id)) setReload((n) => n + 1); };

  const chips = useMemo(() => {
    const seen = new Set();
    return ['کارشناسِ حاضر', ...h.techs.map((t) => t.name), ...places].filter((x) => x && !seen.has(x) && seen.add(x));
  }, [places, h.techs]);

  /* سقفِ هر قلم: موجودیِ آزاد؛ با «جابجایی» تعدادی که در بیمارستانِ مبدأ هست. */
  const capOf = (l, move) => (move ? Math.max(0, ...l.inUse.map((u) => u.quantity)) : l.free);
  const pick = (l, on2, move = false) => setPicked((p) => {
    const n = { ...p };
    if (on2) n[l.id] = { name: [l.itemName, l.itemSize].filter(Boolean).join(' '), quantity: 1, max: capOf(l, move), move };
    else delete n[l.id];
    return n;
  });
  const setQty = (id, v) => setPicked((p) => {
    const r = p[id];
    const raw = toEnDigits(String(v)).replace(/[^\d]/g, '');
    return { ...p, [id]: { ...r, quantity: raw === '' ? '' : Math.min(Number(raw), r.max) } };
  });
  const step = (id, d) => setPicked((p) => {
    const r = p[id];
    const n = Math.max(1, Math.min(r.max, (Number(r.quantity) || 0) + d));
    return { ...p, [id]: { ...r, quantity: n } };
  });

  const lines = Object.entries(picked).map(([id, r]) => ({ lotId: Number(id), quantity: Number(r.quantity), ...(r.move ? { move: true } : {}) }));
  const badQty = Object.values(picked).some((r) => !Number.isInteger(Number(r.quantity)) || Number(r.quantity) < 1 || Number(r.quantity) > r.max);
  const needsDriver = Object.values(picked).some((r) => r.move) && !staffId;

  const submit = async () => {
    setMsg('');
    const ok = await onSave({ plannedAt: at || undefined, handedTo: who || undefined, staffId: staffId ? Number(staffId) : null, lines, force });
    if (!ok) setForce(true); // پیامِ تعارض در toast آمده؛ بار دوم با تأییدِ صریح
  };

  return (
    <div className="tb-form">
      <label className="tb-field">
        <span>جستجوی دستگاه، ست یا سریال</span>
        <input value={q} disabled={busy} onChange={(e) => setQ(e.target.value)} placeholder="مثلاً ۱۲۳۴۵ یا ست کامل" />
      </label>
      <div className="tb-lots">
        {lots.slice(0, 30).map((l) => {
          const away = l.free < 1 && l.returnable && l.inUse.length > 0;
          const none = l.free < 1 && !away;
          const sel = picked[l.id];
          return (
            <div key={l.id} className={`tb-lot-wrap${sel ? ' on' : ''}`}>
              <label className={`tb-lot${sel ? ' on' : ''}${none || (away && !sel) ? ' off' : ''}`}>
                <input
                  type="checkbox"
                  checked={!!sel}
                  disabled={busy || none || (away && !sel)}
                  onChange={(e) => pick(l, e.target.checked)}
                />
                <span>{[l.itemName, l.itemSize].filter(Boolean).join(' ')}</span>
                <em dir="ltr">{l.serialNo || l.lotNo}</em>
                <small className={l.free < 1 ? 'tb-out' : ''}>{l.free < 1 ? 'آزاد نیست' : `آزاد ${num(l.free)}`}</small>
              </label>
              <Holds l={l} busy={busy} onCancel={cancelHold} />
              {away && (
                <div className="tb-away">
                  <p><Alert width="12" height="12" /> این روز در {l.inUse.map((u) => `${u.hospitalName}${u.plannedAt ? ` (${faTime(u.plannedAt)})` : ''}`).join('، ')} است</p>
                  <label className="tb-move">
                    <input type="checkbox" checked={!!sel?.move} disabled={busy} onChange={(e) => pick(l, e.target.checked, true)} />
                    <span>جابجایی بین بیمارستان‌ها — جمع‌آوری از {l.inUse[0].hospitalName} و تحویل به {h.name}</span>
                  </label>
                </div>
              )}
            </div>
          );
        })}
        {lots.length === 0 && <span className="tb-none">موردی در انبار پیدا نشد</span>}
      </div>

      {Object.entries(picked).length > 0 && (
        <div className="tb-picked">
          {Object.entries(picked).map(([id, r]) => (
            <span key={id} className="tb-chip">
              {r.name}{r.move ? ' (جابجایی)' : ''}
              <span className="tb-qty">
                <button type="button" disabled={busy || Number(r.quantity) >= r.max} onClick={() => step(id, 1)} aria-label={`یکی بیشتر از ${r.name}`}><ArrowUp width="13" height="13" /></button>
                <input
                  aria-label={`تعدادِ ${r.name}`} inputMode="numeric" value={r.quantity} disabled={busy}
                  onChange={(e) => setQty(id, e.target.value)}
                  onBlur={() => { if (!Number(r.quantity)) setQty(id, 1); }}
                />
                <button type="button" disabled={busy || Number(r.quantity) <= 1} onClick={() => step(id, -1)} aria-label={`یکی کمتر از ${r.name}`}><ArrowDown width="13" height="13" /></button>
              </span>
              <small>از {num(r.max)}</small>
              <button type="button" disabled={busy} onClick={() => setPicked((p) => { const n = { ...p }; delete n[id]; return n; })} aria-label="حذف"><Close width="12" height="12" /></button>
            </span>
          ))}
        </div>
      )}
      {needsDriver && <p className="tb-msg">برای جابجایی بین بیمارستان‌ها راننده را انتخاب کنید.</p>}

      <div className="tb-form inline">
        <TimePick label="ساعتِ تحویل" value={at} onChange={setAt} disabled={busy} />
        <label className="tb-field">
          <span>راننده</span>
          <select value={staffId} disabled={busy} aria-label="راننده" onChange={(e) => setStaffId(e.target.value)}>
            <option value="">هنوز مشخص نیست</option>
            {drivers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.vehicle ? ` — ${s.vehicle}` : ''}</option>)}
          </select>
        </label>
      </div>

      <div className="tb-field">
        <span>تحویل به</span>
        <input value={who} disabled={busy} onChange={(e) => setWho(e.target.value)} placeholder="نام یا بخش" />
        <div className="tb-chips">
          {chips.map((c) => (
            <button key={c} type="button" className={`tb-pill${who === c ? ' on' : ''}`} onClick={() => setWho(c)}>{c}</button>
          ))}
        </div>
      </div>

      {msg && <p className="tb-msg" role="alert">{msg}</p>}
      {force && <p className="tb-msg">اگر خطای بالا تعارضِ دستگاه است و عمدی است، دوباره «ثبتِ تحویل» را بزنید تا با تأییدِ صریح ثبت شود.</p>}

      <div className="tb-actions">
        <button type="button" className="tb-btn primary" disabled={busy || badQty || needsDriver || (lines.length === 0 && !staffId)} onClick={submit}>ثبتِ تحویل</button>
        <button type="button" className="tb-btn ghost" disabled={busy} onClick={onCancel}>انصراف</button>
      </div>
    </div>
  );
}
