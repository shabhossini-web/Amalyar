import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { faDate } from '../lib/jalali.js';
import './transport.css';
import { Alert, Arrive, Back, Box, CheckCircle, Clock, Close, Hospital, Phone, Truck, User } from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import { faTime } from '../lib/time.js';
import { useStagger } from '../ui/stagger.js';
import { usePlaces } from '../lib/places.js';

const num = (n) => Number(n ?? 0).toLocaleString('fa-IR');
const time = (t) => (t ? faTime(t) : '—');

const SCOPES = [
  { key: 'today', label: 'امروز', icon: Arrive },
  { key: 'upcoming', label: 'پیشِ رو', icon: Clock },
  { key: 'past', label: 'گذشته', icon: CheckCircle },
];

/**
 * پرتالِ تیمِ حمل‌ونقل.
 *
 * ⚠️ این صفحه **تختهٔ چینش با فیلترِ راننده نیست**. سرور نمای جداگانه‌ای
 * می‌دهد که هیچ نام و کدِ بیماری در آن نیست؛ اگر روزی این‌جا نامِ بیمار دیده
 * شد، اشکال در `transport.service.ts` است نه در این فایل.
 *
 * ترتیبِ کارتِ هر توقف همان ترتیبِ کارِ راننده است: ساعت و مقصد، بعد «چه
 * چیزی» (بار با نامِ کالا و سریال)، بعد «به چه کسی» (برنامه)، بعد شمارهٔ
 * کارشناسِ حاضر برای وقتی زودتر رسید، و آخر دکمهٔ ثبتِ تحویل.
 */
export default function Transport() {
  const [scope, setScope] = useState('today');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [doneFor, setDoneFor] = useState(null); // stop
  const row = useStagger();

  useEffect(() => { document.title = 'عمل‌یار — پرتالِ حمل‌ونقل'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async (s) => {
    setErr('');
    try { setData(await api(`/transport/agenda?scope=${s}`)); }
    catch (e) { setErr(e.message); setData(null); }
  }, []);
  useEffect(() => { load(scope); }, [load, scope]);

  const runs = data?.runs ?? [];
  const stops = runs.flatMap((r) => (r.stops ?? []).map((s) => ({ ...s, runDate: r.runDate, vehicle: r.vehicle, staffName: r.staffName })));
  const left = stops.filter((s) => !s.doneAt).length;

  return (
    <div className="tr">
      <div className="tr-bg" aria-hidden="true" />
      <header className="tr-head">
        <Link to="/app" className="tr-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1>مسیرِ من</h1>
          <p>
            {data?.staff
              ? <>{data.staff.name}{data.staff.vehicle ? ` · ${data.staff.vehicle}` : ''} — چه چیزی، کجا، چه ساعتی، به چه کسی.</>
              : data ? 'نمای سرپرستی — همهٔ مسیرها و نیروها.' : 'چه چیزی، کجا، چه ساعتی، به چه کسی.'}
          </p>
        </div>
      </header>

      <Tabs label="بازهٔ کار" tone="brand" value={scope} onChange={setScope} items={SCOPES} />

      {err && <div className="tr-err"><Alert width="15" height="15" /> {err}</div>}

      {data && stops.length > 0 && (
        <div className="tr-sum">
          <div><b>{num(stops.length)}</b><span>توقف</span></div>
          <div className={left ? 'warn' : ''}><b>{num(left)}</b><span>مانده</span></div>
          <div><b>{num(stops.length - left)}</b><span>انجام‌شده</span></div>
        </div>
      )}

      <div className="tr-list">
        {!data && !err && <div className="tr-empty">در حال بارگذاری…</div>}
        {data && stops.length === 0 && (
          <div className="tr-empty">
            {scope === 'today' ? 'امروز توقفی به نامِ شما ثبت نشده' : scope === 'upcoming' ? 'برای دو هفتهٔ آینده توقفی ثبت نشده' : 'در دو هفتهٔ گذشته توقفی نبوده'}
          </div>
        )}
        {stops.map((s, i) => (
          <motion.article key={s.id} {...row(i)} className={`tr-card${s.doneAt ? ' done' : ''} k-${s.kind}`}>
            <header>
              <span className="tr-time" dir="ltr">{time(s.plannedAt)}</span>
              <div className="tr-title">
                <b><Hospital width="14" height="14" /> {s.hospitalName || '—'}</b>
                <small>
                  {s.kind === 'pickup' ? 'جمع‌آوری' : 'تحویل'}
                  {scope !== 'today' && s.runDate ? ` · ${faDate(s.runDate)}` : ''}
                  {s.staffName ? ` · ${s.staffName}` : ''}
                </small>
              </div>
              {s.doneAt
                ? <span className="tr-tag ok">تحویل شد</span>
                : <span className="tr-tag">مانده</span>}
            </header>

            {s.address && <p className="tr-addr">{s.address}</p>}

            {/* «چه چیزی» — بارِ این توقف با نامِ کالا و سریال، نه فقط شمارهٔ حواله. */}
            {s.cargo?.length > 0 ? (
              <div className="tr-cargo">
                {s.cargo.map((c) => (
                  <div key={c.id} className="tr-bag">
                    <div className="tr-bag-head">
                      <b><Box width="14" height="14" /> {c.code}</b>
                      <span dir="auto">{c.from} ← {c.to}</span>
                    </div>
                    <ul className="tr-items">
                      {c.items.map((it, k) => (
                        <li key={k}>
                          {it.name}
                          {it.serialNo && <em dir="ltr">{it.serialNo}</em>}
                          <span>{num(it.quantity)}</span>
                        </li>
                      ))}
                    </ul>
                    {c.leftAt && <p className="tr-left">کارشناس گذاشته در: <b>{c.leftAt}</b></p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="tr-none"><Alert width="13" height="13" /> برای این توقف باری ثبت نشده — با دفتر هماهنگ کنید</p>
            )}

            {/* «به چه کسی» — برنامه و واقعیت هر دو می‌مانند. */}
            <div className="tr-who">
              {s.handedTo && <span><User width="13" height="13" /> تحویل به: <b>{s.handedTo}</b></span>}
              {s.handedActual && <span className="act"><CheckCircle width="13" height="13" /> گرفت: <b>{s.handedActual}</b></span>}
            </div>

            {/* رانندهٔ زودرسیده باید بداند به چه کسی زنگ بزند. */}
            {(s.techs?.length > 0 || s.contactPhone || s.phone) && (
              <div className="tr-calls">
                {s.techs?.map((t) => (
                  t.phone
                    ? <a key={t.name} className="tr-call" href={`tel:${t.phone}`} dir="auto"><Phone width="13" height="13" /> {t.name}</a>
                    : <span key={t.name} className="tr-call off"><User width="13" height="13" /> {t.name}</span>
                ))}
                {(s.contactPhone || s.phone) && (
                  <a className="tr-call" href={`tel:${s.contactPhone || s.phone}`} dir="auto">
                    <Phone width="13" height="13" /> {s.contact || 'بیمارستان'}
                  </a>
                )}
              </div>
            )}

            {s.notes && <p className="tr-note">{s.notes}</p>}

            {!s.doneAt && (
              <button type="button" className="tr-do" onClick={() => setDoneFor(s)}>ثبتِ تحویل</button>
            )}
          </motion.article>
        ))}
      </div>

      {/* ⚠️ `AnimatePresence` باید در **والد** باشد، نه داخلِ خودِ شیت: اگر
          داخل بنشیند، با unmountِ شیت خودش هم می‌رود و انیمیشنِ خروج هرگز
          اجرا نمی‌شود — شیت به‌جای بسته‌شدن، می‌پرد. */}
      <AnimatePresence>
        {doneFor && (
          <DoneSheet
            stop={doneFor}
            onClose={() => setDoneFor(null)}
            onSaved={(m) => { setDoneFor(null); setToast(m); load(scope); }}
            onError={setErr}
          />
        )}
      </AnimatePresence>

      <div className={`tr-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}

/**
 * ثبتِ تحویل.
 *
 * ⚠️ «تحویل‌گیرندهٔ واقعی» جدا از برنامه ثبت می‌شود. برنامه گفته «بده به
 * کارشناس»، ولی راننده زودتر رسیده و به CSR داده — اگر همان فیلد بازنویسی
 * می‌شد، فردا معلوم نبود برنامه چه بود و واقعیت چه شد.
 */
function DoneSheet({ stop, onClose, onSaved, onError }) {
  const [who, setWho] = useState(stop.handedTo ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const places = usePlaces();

  const save = async () => {
    setBusy(true);
    try {
      await api(`/transport/stops/${stop.id}/done`, {
        method: 'POST',
        body: { handedActual: who.trim(), notes: notes.trim() },
      });
      onSaved('تحویل ثبت شد ✓');
    } catch (e) { onError(e.message); setBusy(false); }
  };

  return (
    <Overlay backdrop="tr-overlay" panel="tr-sheet" as="section" onClose={onClose} closable={!busy}>
      <header className="tr-sheet-head">
        <b>{stop.hospitalName} — {time(stop.plannedAt)}</b>
        <button type="button" className="tr-x" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>
      <div className="tr-sheet-body">
        {stop.handedTo && <p className="tr-hint">برنامه: تحویل به «{stop.handedTo}»</p>}
        <label className="tr-field">
          <span>به چه کسی تحویل دادید؟</span>
          <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="نام یا بخش" />
        </label>
        <div className="tr-chips">
          {places.map((r) => (
            <button key={r} type="button" className={`tr-chip${who === r ? ' on' : ''}`} onClick={() => setWho(r)}>{r}</button>
          ))}
        </div>
        <label className="tr-field">
          <span>توضیح (اختیاری)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثلاً ترافیک، تأخیر، …" />
        </label>
        <button type="button" className="tr-save" disabled={busy} onClick={save}>
          {busy ? 'در حال ثبت…' : 'ثبتِ تحویل'}
        </button>
      </div>
    </Overlay>
  );
}
