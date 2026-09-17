import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import FileDrop from '../ui/FileDrop.jsx';
import { api, apiUpload } from '../lib/api.js';
import { faDate, toEnDigits } from '../lib/jalali.js';
import './tech.css';
import { Alert, Arrive, Back, CheckCircle, Clock, Close, Hospital, Doctor, Box, Wave } from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import TimePick from '../ui/TimePick.jsx';
import { badTime, faTime, normTime } from '../lib/time.js';
import { useStagger } from '../ui/stagger.js';
import { usePlaces } from '../lib/places.js';

const num = (n) => Number(n ?? 0).toLocaleString('fa-IR');
/* نمایشِ فارسیِ ساعت از `lib/time` می‌آید — همان تبدیلی که خودِ ورودی به کار
   می‌برد، تا آنچه کارشناس ثبت می‌کند و آنچه بعداً روی کارت می‌بیند یکی باشد. */
const time = (t) => (t ? faTime(t) : '—');

const SCOPES = [
  { key: 'today', label: 'امروز', icon: Arrive },
  { key: 'upcoming', label: 'پیشِ رو', icon: Clock },
  { key: 'past', label: 'گذشته', icon: CheckCircle },
];

/**
 * دفترِ کارِ کارشناس.
 *
 * ⚠️ این صفحه عمداً **فهرستِ داشبورد نیست با یک فیلتر**. سرور نمای جداگانه‌ای
 * می‌دهد که هیچ عددِ مالی در آن نیست؛ اگر روزی این‌جا مبلغ دیده شد، اشکال در
 * `tech.service.ts` است نه در این فایل.
 *
 * ترتیبِ کارتِ هر عمل همان ترتیبِ روزِ کارشناس است: کجا و کِی، بعد چه ستی
 * همراهش می‌رود، بعد کاری که باید بکند (ساعت، مصرف، پایان، گزارش).
 */
export default function Tech() {
  const [scope, setScope] = useState('today');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [usageFor, setUsageFor] = useState(null); // {visit, transfer}
  const [timesFor, setTimesFor] = useState(null); // visit
  const [claiming, setClaiming] = useState(null);
  const row = useStagger();

  useEffect(() => { document.title = 'عمل‌یار — پنلِ کارشناسی'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async (s) => {
    setErr('');
    try { setData(await api(`/tech/agenda?scope=${s}`)); }
    catch (e) { setErr(e.message); setData(null); }
  }, []);
  useEffect(() => { load(scope); }, [load, scope]);

  const visits = data?.visits ?? [];
  const claim = async (id) => {
    setClaiming(id);
    try { await api(`/tech/visits/${id}/claim`, { method: 'POST' }); setToast('مراجعه به نام شما ثبت شد'); }
    catch (e) { setToast(e.message); }
    finally { await load(scope); setClaiming(null); }
  };

  return (
    <div className="tk">
      <div className="tk-bg" aria-hidden="true" />
      <header className="tk-head">
        <Link to="/app" className="tk-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1>دفترِ کار</h1>
          <p>عمل‌هایی که کارشناسشان شما هستید — ساعت، ست، مصرف و گزارش.</p>
        </div>
      </header>

      <Tabs label="بازهٔ کار" tone="brand" value={scope} onChange={setScope} items={SCOPES} />

      {err && <div className="tk-err"><Alert width="15" height="15" /> {err}</div>}

      <div className="tk-list">
        {(data?.hospitals ?? []).map(h => <section className="tk-card" key={h.id}>
          <header><div className="tk-title"><b>{h.name}</b><small>{faDate(h.date)} · حضور شما: {time(h.arriveTime)}</small></div></header>
          <p>بیماران احتمالی — هنوز به کارشناس تخصیص داده نشده‌اند</p>
          {h.openVisits.length === 0 && <p>مراجعه آزادی در این بیمارستان نیست.</p>}
          {h.openVisits.map(v => <div className="tk-open-visit" key={v.id}><div><b>{v.name}</b><small>{v.procedure || ''} · {time(v.opStartTime)}</small></div><button className="tk-ghost" disabled={claiming !== null} onClick={() => claim(v.id)}>{claiming === v.id ? 'در حال ثبت…' : 'پذیرش این مراجعه'}</button></div>)}
        </section>)}
        {!data && !err && <div className="tk-empty">در حال بارگذاری…</div>}
        {data && visits.length === 0 && (
          <div className="tk-empty">
            {scope === 'today' ? 'امروز عملی به نامِ شما ثبت نشده' : scope === 'upcoming' ? 'برای سه هفتهٔ آینده عملی ثبت نشده' : 'در سی روزِ گذشته عملی نبوده'}
          </div>
        )}
        {visits.map((v, i) => (
          <motion.article key={v.id} {...row(i)} className={`tk-card st-${v.status}`}>
            <header>
              <span className="tk-time" dir="ltr">{time(v.opStartTime)}</span>
              <div className="tk-title">
                <b>{v.patientName}</b>
                <small>{v.code} · {faDate(v.opDate)}</small>
              </div>
              {v.status === 'done' && <span className="tk-tag ok">انجام‌شده</span>}
              {v.status === 'cancelled' && <span className="tk-tag no">لغو</span>}
            </header>

            <div className="tk-facts">
              <span><Hospital width="14" height="14" /> {v.hospitalName || '—'}</span>
              <span><Doctor width="14" height="14" /> {v.surgeonName || '—'}</span>
              {v.techName && <span className="tk-tech">{v.techName}</span>}
              {v.procedure && <span><Wave width="14" height="14" /> {v.procedure}</span>}
              {v.techArriveTime && <span><Clock width="14" height="14" /> حضور {time(v.techArriveTime)}</span>}
            </div>

            {v.transfers.length > 0 && (
              <div className="tk-sets">
                {v.transfers.map((t) => (
                  <div key={t.id} className="tk-set">
                    <div className="tk-set-head">
                      <b><Box width="14" height="14" /> {t.code}</b>
                      <span>{t.toLocation}</span>
                      {t.releasedAt
                        ? <i className="tk-tag ok">پایان اعلام شد</i>
                        : t.status === 'planned' ? <i className="tk-tag">هنوز ارسال نشده</i> : null}
                    </div>
                    <ul className="tk-items">
                      {t.items.map((it, k) => (
                        <li key={k}>
                          {it.name}
                          {it.serialNo && <em dir="ltr">{it.serialNo}</em>}
                          <span>{num(it.quantity)}</span>
                        </li>
                      ))}
                    </ul>
                    {t.status !== 'planned' && (
                      <button type="button" className="tk-mini" onClick={() => setUsageFor({ visit: v, transfer: t })}>
                        برگهٔ مصرف و پایانِ عمل
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <footer className="tk-acts">
              <button type="button" className="tk-ghost" onClick={() => setTimesFor(v)}>ثبتِ ساعت</button>
              <ReportButton visit={v} onDone={(msg) => { setToast(msg); load(scope); }} onError={setErr} />
            </footer>
          </motion.article>
        ))}
      </div>

      {/* ⚠️ `AnimatePresence` باید در **والد** باشد، نه داخلِ خودِ شیت: اگر
          داخل بنشیند، با unmountِ شیت خودش هم می‌رود و انیمیشنِ خروج هرگز
          اجرا نمی‌شود — شیت به‌جای بسته‌شدن، می‌پرد. */}
      <AnimatePresence>
        {usageFor && (
          <UsageSheet
            transferId={usageFor.transfer.id}
            onClose={() => setUsageFor(null)}
            onToast={(m) => { setToast(m); load(scope); }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {timesFor && (
          <TimesSheet
            visit={timesFor}
            onClose={() => setTimesFor(null)}
            onSaved={(m) => { setTimesFor(null); setToast(m); load(scope); }}
          />
        )}
      </AnimatePresence>

      <div className={`tk-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}

/** آپلودِ گزارشِ عمل — یک دکمه، بدونِ شیت: کارشناس فایل را همان‌جا می‌دهد. */
function ReportButton({ visit, onDone, onError }) {
  /* ⚠️ گزارشِ عمل معمولاً **چند صفحه** است؛ تا دیروز هر صفحه یک رفت‌وبرگشتِ
     کامل بود. حالا همان کادرِ مشترک صف را می‌گرداند. */
  const send = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    await apiUpload(`/tech/visits/${visit.id}/report`, fd);
  };
  return (
    <FileDrop
      variant="button"
      accept="image/*,application/pdf"
      label={visit.reportAt ? `گزارش ثبت شده — ${faDate(visit.reportAt)} · افزودنِ صفحه` : 'آپلودِ گزارشِ عمل'}
      onUpload={send}
      onAllDone={() => onDone('گزارشِ عمل ثبت شد ✓')}
    />
  );
}

/**
 * برگهٔ مصرف + اعلامِ پایان.
 *
 * ⚠️ عدد «جمعِ مصرف‌شده» است نه «چقدر کم کن» — کارشناسِ وسطِ عمل حسابِ ثبتِ
 * قبلی را نگه نمی‌دارد. همان قراردادی که صفحهٔ انبار دارد؛ دو معنیِ متفاوت
 * برای یک فیلد یعنی موجودیِ غلط.
 */
function UsageSheet({ transferId, onClose, onToast }) {
  const [t, setT] = useState(null);
  const [used, setUsed] = useState({});
  const [note, setNote] = useState('');
  const [pickupAt, setPickupAt] = useState('');
  const [leftAt, setLeftAt] = useState('');
  const [busy, setBusy] = useState(false);
  /* میان‌بُرهای محل از تعاریفِ پایه می‌آیند، نه از آرایهٔ ثابتِ این فایل. */
  const places = usePlaces();

  const load = useCallback(async () => {
    try { setT(await api(`/stock/transfers/${transferId}`)); }
    catch (e) { onToast(e.message); }
  }, [transferId, onToast]);
  useEffect(() => { load(); }, [load]);

  const act = async (path, body, msg) => {
    setBusy(true);
    try {
      await api(path, { method: 'POST', body });
      onToast(msg);
      await load();
    } catch (e) { onToast(e.message); } finally { setBusy(false); }
  };

  return (
    <Overlay backdrop="tk-overlay" panel="tk-sheet" as="section" onClose={onClose} closable={!busy}>
      <header className="tk-sheet-head">
        <b>{t ? `حوالهٔ ${t.code}` : 'حواله'}</b>
        <button type="button" className="tk-x" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>

      {!t ? <div className="tk-empty">در حال بارگذاری…</div> : (
        <div className="tk-sheet-body">
          <div className="tk-tot">
            <div><b>{num(t.totals.sent)}</b><span>ارسال</span></div>
            <div><b>{num(t.totals.used)}</b><span>مصرف</span></div>
            <div className={t.totals.remaining ? 'warn' : ''}><b>{num(t.totals.remaining)}</b><span>مانده</span></div>
          </div>

          {t.lines.map((l) => (
            <div key={l.movementId} className="tk-line">
              <b>{l.itemName}{l.itemSize ? ` — ${l.itemSize}` : ''}</b>
              <small dir="ltr">{l.serialNo || l.lotNo || `#${l.lotId}`}</small>
              {t.status === 'closed' ? (
                <span>ارسال {num(l.sent)} · مصرف {num(l.used)}</span>
              ) : (
                <label>
                  <span>ارسال {num(l.sent)}</span>
                  مصرف شد
                  <input dir="ltr" inputMode="numeric"
                         value={used[l.lotId] ?? String(l.used)}
                         onChange={(e) => setUsed((s) => ({ ...s, [l.lotId]: e.target.value }))} />
                </label>
              )}
            </div>
          ))}

          {t.status !== 'closed' && (
            <button type="button" className="tk-save" disabled={busy}
                    onClick={() => act(
                      `/stock/transfers/${transferId}/usage`,
                      { lines: t.lines.map((l) => ({ lotId: l.lotId, used: Number(toEnDigits(used[l.lotId] ?? String(l.used))) || 0 })) },
                      'برگهٔ مصرف ثبت شد ✓',
                    )}>
              ثبتِ برگهٔ مصرف
            </button>
          )}

          {/* اعلامِ پایان هم دارایی را آزاد می‌کند هم صفِ جمع‌آوری را می‌سازد —
              دفتر خودش نمی‌داند عمل کِی واقعاً تمام شد. */}
          {t.status !== 'planned' && t.status !== 'closed' && (
            t.releasedAt ? (
              <p className="tk-note ok">
                پایان اعلام شد — {faDate(t.releasedAt)}
                {t.pickupAt ? ` · ساعتِ ${faTime(t.pickupAt)}` : ''}
                {t.leftAt ? ` · ${t.leftAt}` : ''} · آمادهٔ جمع‌آوری
              </p>
            ) : (
              <div className="tk-rel">
                {/* ⚠️ «تمام شد» به‌تنهایی برای تیمِ حمل‌ونقل تکلیف نمی‌سازد: راننده
                    باید بداند **کِی** برود و **از کجا** بردارد. همین دو فیلد
                    توقفِ جمع‌آوری را در تختهٔ چینش می‌سازد. */}
                <TimePick
                  className="tk-field"
                  label="کِی بیایند ببرند؟"
                  value={pickupAt}
                  onChange={setPickupAt}
                />
                <label className="tk-field">
                  <span>کجا گذاشتید؟</span>
                  <input value={leftAt} onChange={(e) => setLeftAt(e.target.value)} placeholder="مثلاً CSR" />
                </label>
                <div className="tk-chips">
                  {places.map((p) => (
                    <button key={p} type="button" className={`tk-chip${leftAt === p ? ' on' : ''}`}
                            onClick={() => setLeftAt(p)}>{p}</button>
                  ))}
                </div>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت (اختیاری)" />
                <button type="button" className="tk-save" disabled={busy}
                        onClick={() => {
                          const at = normTime(pickupAt);
                          if (badTime(at)) { onToast('ساعت باید به شکلِ ۰۸:۳۰ باشد'); return; }
                          act(
                            `/stock/transfers/${transferId}/release`,
                            { note: note.trim(), pickupAt: at, leftAt: leftAt.trim() },
                            'پایانِ عمل اعلام شد ✓',
                          );
                        }}>
                  اعلامِ پایانِ عمل
                </button>
              </div>
            )
          )}
        </div>
      )}
    </Overlay>
  );
}

/**
 * ساعتِ واقعیِ عمل — شروع و پایان.
 *
 * ⚠️ «ساعتِ حضورِ شما» عمداً این‌جا نیست (W3.8/U7، تصمیمِ مالک ۱۴۰۵/۰۶/۲۶):
 * حضور مالِ «کارشناس در آن بیمارستان در آن روز» است، نه مالِ یک بیمار، و از
 * برنامهٔ چینش می‌آید. وقتی سه جا می‌نوشتندش، سه جا واگرا می‌شد.
 */
function TimesSheet({ visit, onClose, onSaved }) {
  const [f, setF] = useState({
    opStartTime: visit.opStartTime ?? '',
    opEndTime: visit.opEndTime ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    // ⚠️ نرمال‌سازی پیش از ارسال، چون کاربر ممکن است بدونِ خروج از فیلد
    //    مستقیم «ذخیره» را بزند و «۸:۵» خام به سرور برسد.
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, normTime(v)]));
    if (Object.values(body).some(badTime)) { setErr('ساعت باید به شکلِ ۰۸:۳۰ باشد'); return; }
    setBusy(true); setErr('');
    try {
      await api(`/tech/visits/${visit.id}/times`, { method: 'PATCH', body });
      onSaved('ساعت ثبت شد ✓');
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Overlay backdrop="tk-overlay" panel="tk-sheet sm" as="section" onClose={onClose} closable={!busy}>
      <header className="tk-sheet-head">
        <b>ساعتِ عمل — {visit.patientName}</b>
        <button type="button" className="tk-x" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>
      <div className="tk-sheet-body">
        {[['opStartTime', 'شروعِ عمل'], ['opEndTime', 'پایانِ عمل']].map(([k, label]) => (
          <TimePick
            key={k}
            className="tk-field"
            label={label}
            value={f[k]}
            onChange={(v) => setF((s) => ({ ...s, [k]: v }))}
          />
        ))}
        {err && <p className="tk-note no">{err}</p>}
        <button type="button" className="tk-save" disabled={busy} onClick={save}>
          {busy ? 'در حال ذخیره…' : 'ذخیرهٔ ساعت'}
        </button>
      </div>
    </Overlay>
  );
}
