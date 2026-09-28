import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { toEnDigits } from '../lib/jalali.js';
import { faTime } from '../lib/time.js';
import { usePlaces } from '../lib/places.js';
import TimePick from '../ui/TimePick.jsx';
import { Alert, Box, CheckCircle, Close, Hospital, Phone, Send, Truck, User } from '../ui/icons.jsx';
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
  if (hospitals.length === 0) return <div className="tb-empty">برای این روز عمل و بیمارستانی ثبت نشده</div>;

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
          drivers={drivers}
          runs={runs}
          busy={busy}
          isOpen={open === h.key}
          onOpen={() => setOpen(open === h.key ? null : h.key)}
          onSave={async (body) => { const ok = await apply(() => post({ hospitalId: h.hospitalId, ...body }), 'تحویل ثبت شد'); if (ok) setOpen(null); return ok; }}
          onPatch={(stopId, body) => apply(() => post({ hospitalId: h.hospitalId, stopId, ...body }))}
          onRemoveDelivery={removeDelivery}
          onRemoveTransfer={removeTransfer}
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

function Card({ h, drivers, runs, busy, isOpen, onOpen, onSave, onPatch, onRemoveDelivery, onRemoveTransfer, onPickup }) {
  const missing = h.visits.length > 0 && !h.hasCargo;
  return (
    <article className={`tb-card${missing ? ' missing' : ''}`}>
      <header>
        <div className="tb-title">
          <b><Hospital width="14" height="14" /> {h.name}</b>
          <small>
            {num(h.visits.length)} عمل
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
        ? <Editor h={h} drivers={drivers} busy={busy} onSave={onSave} onCancel={onOpen} />
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
function Editor({ h, drivers, busy, onSave, onCancel }) {
  const places = usePlaces();
  const [q, setQ] = useState('');
  const [lots, setLots] = useState([]);
  const [picked, setPicked] = useState({});
  const [at, setAt] = useState('');
  const [who, setWho] = useState(h.techs[0] ? 'کارشناسِ حاضر' : '');
  const [staffId, setStaffId] = useState(drivers.length === 1 ? String(drivers[0].id) : '');
  const [force, setForce] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api(`/stock/lots?q=${encodeURIComponent(q)}&inStock=1`)
        .then((rows) => { if (alive) setLots(rows); })
        .catch((e) => { if (alive) setMsg(e.message); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const chips = useMemo(() => {
    const seen = new Set();
    return ['کارشناسِ حاضر', ...h.techs.map((t) => t.name), ...places].filter((x) => x && !seen.has(x) && seen.add(x));
  }, [places, h.techs]);

  const lines = Object.entries(picked).map(([id, r]) => ({ lotId: Number(id), quantity: Number(toEnDigits(String(r.quantity))) }));
  const badQty = lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1);

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
        {lots.slice(0, 30).map((l) => (
          <label key={l.id} className={`tb-lot${picked[l.id] ? ' on' : ''}${l.expired ? ' off' : ''}`}>
            <input
              type="checkbox"
              checked={!!picked[l.id]}
              disabled={busy || l.expired}
              onChange={(e) => setPicked((p) => { const n = { ...p }; if (e.target.checked) n[l.id] = { name: l.itemName, quantity: 1 }; else delete n[l.id]; return n; })}
            />
            <span>{l.itemName}</span>
            <em dir="ltr">{l.serialNo || l.lotNo}</em>
            <small>موجودی {num(l.quantity)}</small>
          </label>
        ))}
        {lots.length === 0 && <span className="tb-none">موردی در انبار پیدا نشد</span>}
      </div>

      {Object.entries(picked).length > 0 && (
        <div className="tb-picked">
          {Object.entries(picked).map(([id, r]) => (
            <span key={id} className="tb-chip">
              {r.name}
              <input
                aria-label={`تعدادِ ${r.name}`} inputMode="numeric" value={r.quantity} disabled={busy}
                onChange={(e) => setPicked((p) => ({ ...p, [id]: { ...p[id], quantity: toEnDigits(e.target.value) } }))}
              />
              <button type="button" disabled={busy} onClick={() => setPicked((p) => { const n = { ...p }; delete n[id]; return n; })} aria-label="حذف"><Close width="12" height="12" /></button>
            </span>
          ))}
        </div>
      )}

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
        <button type="button" className="tb-btn primary" disabled={busy || badQty || (lines.length === 0 && !staffId)} onClick={submit}>ثبتِ تحویل</button>
        <button type="button" className="tb-btn ghost" disabled={busy} onClick={onCancel}>انصراف</button>
      </div>
    </div>
  );
}
