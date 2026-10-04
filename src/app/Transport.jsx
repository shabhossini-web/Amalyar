import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { faDate } from '../lib/jalali.js';
import './transport.css';
import { Alert, Arrive, Box, CheckCircle, Clock, Close, Hospital, Phone, Truck, User, Users } from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import PageHeader from '../ui/PageHeader.jsx';
import Overlay from '../ui/Overlay.jsx';
import Stepper from '../ui/Stepper.jsx';
import { faTime, minToTime } from '../lib/time.js';
import { useStagger } from '../ui/stagger.js';
import { usePlaces } from '../lib/places.js';

const num = (n) => Number(n ?? 0).toLocaleString('fa-IR');
const time = (t) => (t ? faTime(t) : '—');
/* ساعتِ رسیدِ کارشناس با همان شکلِ فارسیِ بقیهٔ ساعت‌ها. */
const clock = (iso) => { const d = new Date(iso); return faTime(minToTime(d.getHours() * 60 + d.getMinutes())); };

/* برچسبِ دستِ دومِ تحویل — وضعیت از سرور (`handover.ts`)؛ راننده باید بداند کارشناس گرفت یا نه. */
const DELIVERY_TAG = {
  awaiting: ['warn', 'منتظرِ تأییدِ کارشناس'],
  received: ['ok', 'کارشناس تحویل گرفت'],
  received_issue: ['warn', 'تحویل با مغایرت'],
};

const SCOPES = [
  { key: 'today', label: 'امروز', icon: Arrive },
  { key: 'upcoming', label: 'پیشِ رو', icon: Clock },
  { key: 'past', label: 'گذشته', icon: CheckCircle },
];

/** برچسبِ فیلتر با شمارِ توقف — نام و عددِ پررنگ، همان شکلِ فیلترِ «امروز» و دفترِ کار. */
const counted = (label, n) => (n ? <>{label} <b className="tr-own-n">{num(n)}</b></> : label);

/**
 * نیروهای نمای سرپرستی، به ترتیبِ نام — از خودِ توقف‌ها.
 * «مالِ کیست» (`ownerId` + `staffName`) را سرور روی هر مسیر می‌گذارد؛ این‌جا فقط گروه می‌شوند.
 */
function peopleOf(stops) {
  const by = new Map();
  for (const s of stops) {
    if (s.ownerId == null) continue;
    const key = String(s.ownerId);
    const p = by.get(key) ?? { key, name: s.staffName || '—', n: 0 };
    p.n += 1;
    by.set(key, p);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
}

/**
 * پرتالِ تیمِ حمل‌ونقل.
 *
 * این صفحه **تختهٔ چینش با فیلترِ راننده نیست**. سرور نمای جداگانه‌ای
 * می‌دهد که هیچ نام و کدِ بیماری در آن نیست؛ اگر روزی این‌جا نامِ بیمار دیده
 * شد، اشکال در `transport.service.ts` است نه در این فایل.
 *
 * ترتیبِ کارتِ هر توقف همان ترتیبِ کارِ راننده است: ساعت و مقصد، بعد «چه
 * چیزی» (بار با نامِ کالا و سریال)، بعد «به چه کسی» (برنامه)، بعد شمارهٔ
 * کارشناسِ حاضر برای وقتی زودتر رسید، و آخر دکمهٔ ثبتِ تحویل.
 *
 * نمای سرپرستی (سوپرادمین، `data.team` از سرور — قانونِ ۲۹): مسیرِ **همهٔ**
 * نیروها، با نامِ نیرو روی هر توقف و فیلترِ نیرو؛ «ثبتِ تحویل» همان دکمه است
 * و از طرفِ نیروی همان مسیر ثبت می‌کند.
 */
export default function Transport() {
  const [scope, setScope] = useState('today');
  const [who, setWho] = useState('all');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [doneFor, setDoneFor] = useState(null); // stop
  const row = useStagger();

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

  const team = !!data?.team;
  const runs = data?.runs ?? [];
  const allStops = runs.flatMap((r) => (r.stops ?? []).map((s) => ({ ...s, runDate: r.runDate, vehicle: r.vehicle, staffName: r.staffName, ownerId: r.ownerId })));
  const people = team ? peopleOf(allStops) : [];
  /* نیروی انتخاب‌شده ممکن است در بازهٔ تازه توقفی نداشته باشد؛ آن‌وقت «همه». */
  const pick = people.some((p) => p.key === who) ? who : 'all';
  const stops = pick === 'all' ? allStops : allStops.filter((s) => String(s.ownerId) === pick);
  const left = stops.filter((s) => !s.doneAt).length;

  return (
    <div className="tr">
      <div className="tr-bg" aria-hidden="true" />
      {/* عنوان همان نامِ کاشی است (قانونِ ۲۴) و «مالِ کیست» (قانونِ ۲۹) اولِ زیرعنوان می‌آید — مثلِ
          «پنل کارشناسی». `tr-head` قلابِ آزمون است (superadmin-field). تا پاسخ نیامده زیرعنوانِ خنثی —
          وگرنه سوپرادمین یک لحظه «مسیرِ من» را می‌دید. */}
      <PageHeader
        className="tr-head" tool="transport"
        sub={team
          ? <><b>همهٔ مسیرها</b> · نمای سرپرستی؛ نامِ نیرو روی هر توقف است و تحویل را این‌جا از طرفِ همان نیرو ثبت می‌کنید.</>
          : data?.staff
            ? <><b>مسیرِ من</b> · {data.staff.name}{data.staff.vehicle ? ` · ${data.staff.vehicle}` : ''} — چه چیزی، کجا، چه ساعتی، به چه کسی.</>
            : 'چه چیزی، کجا، چه ساعتی، به چه کسی.'}
      />

      <Tabs label="بازهٔ کار" tone="brand" value={scope} onChange={setScope} items={SCOPES} />

      {/* فیلترِ نیرو فقط وقتی بیش از یک نیرو در کار است. شمارشِ خلاصهٔ زیرش هم
          همان نیروی انتخاب‌شده را می‌شمارد. */}
      {people.length > 1 && (
        <Tabs
          label="نیروها"
          variant="scroll"
          className="tr-people"
          value={pick}
          onChange={setWho}
          items={[
            { key: 'all', label: counted('همه', allStops.length), icon: Users },
            ...people.map((p) => ({ key: p.key, label: counted(p.name, p.n) })),
          ]}
        />
      )}

      {err && <div className="tr-err" role="alert"><Alert width="15" height="15" /> {err}</div>}

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
            {scope === 'today'
              ? (team ? 'امروز برای هیچ نیرویی توقفی ثبت نشده' : 'امروز توقفی به نامِ شما ثبت نشده')
              : scope === 'upcoming' ? 'برای دو هفتهٔ آینده توقفی ثبت نشده' : 'در دو هفتهٔ گذشته توقفی نبوده'}
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
                  {!team && s.staffName ? ` · ${s.staffName}` : ''}
                </small>
              </div>
              {s.doneAt
                ? <span className="tr-tag ok">{s.kind === 'pickup' ? 'جمع‌آوری شد' : 'تحویل شد'}</span>
                : <span className="tr-tag">مانده</span>}
            </header>

            {/* نمای سرپرستی — «مسیرِ کیست» و با کدام خودرو. */}
            {team && (
              <p className="tr-owner">
                <Truck width="14" height="14" /> مسیرِ <b>{s.staffName || '—'}</b>{s.vehicle ? ` · ${s.vehicle}` : ''}
              </p>
            )}

            {s.address && <p className="tr-addr">{s.address}</p>}

            {/* «چه چیزی» — بارِ این توقف با نامِ کالا و سریال، نه فقط شمارهٔ حواله. */}
            {s.cargo?.length > 0 ? (
              <div className="tr-cargo">
                {s.cargo.map((c) => (
                  <div key={c.id} className="tr-bag">
                    <div className="tr-bag-head">
                      <b><Box width="14" height="14" /> {c.code}</b>
                      <span dir="auto">{c.from} ← {c.to}</span>
                      {DELIVERY_TAG[c.delivery] && <i className={`tr-tag ${DELIVERY_TAG[c.delivery][0]}`}>{DELIVERY_TAG[c.delivery][1]}</i>}
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
                    {c.receipt && (
                      <p className={`tr-recv${c.receipt.issue ? ' warn' : ''}`}>
                        کارشناس ساعتِ {clock(c.receipt.at)} تحویل گرفت{c.receipt.issue ? ' — با مغایرت' : ''}
                      </p>
                    )}
                    {/* شمارشِ راننده هنگامِ جمع‌آوری (بستهٔ ج) — امضای راننده، نه جابه‌جاییِ موجودی. */}
                    {c.pickup && (
                      <p className={`tr-recv${c.pickup.issue ? ' warn' : ''}`}>
                        ساعتِ {clock(c.pickup.at)} شمرده و تحویل گرفته شد{c.pickup.issue ? ' — با کسری' : ''}
                        {c.pickup.sealIntact === true ? ' · پلمب سالم' : c.pickup.sealIntact === false ? ' · پلمب باز' : ''}
                        {c.pickup.note ? ` · ${c.pickup.note}` : ''}
                      </p>
                    )}
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
              <button type="button" className="tr-do" onClick={() => setDoneFor(s)}>{s.kind === 'pickup' ? 'ثبتِ جمع‌آوری' : 'ثبتِ تحویل'}</button>
            )}
          </motion.article>
        ))}
      </div>

      {/* `AnimatePresence` باید در **والد** باشد، نه داخلِ خودِ شیت: اگر
          داخل بنشیند، با unmountِ شیت خودش هم می‌رود و انیمیشنِ خروج هرگز
          اجرا نمی‌شود — شیت به‌جای بسته‌شدن، می‌پرد. */}
      <AnimatePresence>
        {doneFor && (
          <DoneSheet
            stop={doneFor}
            team={team}
            onClose={() => setDoneFor(null)}
            onSaved={(m) => { setDoneFor(null); setToast(m); load(scope); }}
            onError={setErr}
          />
        )}
      </AnimatePresence>

      <div className={`tr-toast${toast ? ' on' : ''}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}

/**
 * ثبتِ تحویل.
 *
 * «تحویل‌گیرندهٔ واقعی» جدا از برنامه ثبت می‌شود. برنامه گفته «بده به
 * کارشناس»، ولی راننده زودتر رسیده و به CSR داده — اگر همان فیلد بازنویسی
 * می‌شد، فردا معلوم نبود برنامه چه بود و واقعیت چه شد.
 *
 * در نمای سرپرستی شیت می‌گوید **از طرفِ کدام نیرو** ثبت می‌شود و پرسش را
 * بی‌«شما» می‌پرسد — ناظر خودش چیزی تحویل نداده است.
 */
function DoneSheet({ stop, team, onClose, onSaved, onError }) {
  const pickup = stop.kind === 'pickup';
  const [who, setWho] = useState(stop.handedTo ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const places = usePlaces();
  /* شمارشِ جمع‌آوری (مالک، بستهٔ ج): «موقعِ تحویل‌گرفتن از کارشناس بشمرد؛ موقعِ تحویل‌دادن که استریل است،
     نه». هر بسته با ارسالیِ همان حواله شروع می‌شود؛ کمتر = کسری (ردیفِ کسریِ انبار)، بیشتر را سرور رد می‌کند. */
  const bags = pickup ? (stop.cargo ?? []).filter((c) => c.status !== 'planned' && c.status !== 'closed' && c.items?.some((it) => it.lotId)) : [];
  const expect = (it) => (it.remaining ?? it.quantity);
  const [counts, setCounts] = useState(() => Object.fromEntries(bags.flatMap((c) => c.items.filter((it) => it.lotId).map((it) => [`${c.id}:${it.lotId}`, expect(it)]))));
  const [seal, setSeal] = useState(null); // true = پلمب سالم (باز نشده) · false = باز است · null = نگفته
  const missing = bags.reduce((a, c) => a + c.items.filter((it) => it.lotId).reduce((b, it) => b + Math.max(0, expect(it) - (counts[`${c.id}:${it.lotId}`] ?? expect(it))), 0), 0);

  const save = async () => {
    setBusy(true);
    try {
      await api(`/transport/stops/${stop.id}/done`, {
        method: 'POST',
        body: {
          handedActual: who.trim(), notes: notes.trim(),
          ...(pickup && bags.length ? {
            counts: bags.flatMap((c) => c.items.filter((it) => it.lotId).map((it) => ({ transferId: c.id, lotId: it.lotId, counted: counts[`${c.id}:${it.lotId}`] ?? expect(it) }))),
            ...(seal === null ? {} : { sealIntact: seal }),
          } : {}),
        },
      });
      /* تحویلِ دوطرفه: ثبتِ راننده بار را ارسال می‌کند و دستِ دوم با کارشناس است. */
      onSaved(pickup ? (missing ? `جمع‌آوری ثبت شد — ${num(missing)} قلم کسری` : 'جمع‌آوری ثبت شد') : stop.cargo?.length ? 'تحویل ثبت شد — منتظرِ تأییدِ کارشناس' : 'تحویل ثبت شد');
    } catch (e) { onError(e.message); setBusy(false); }
  };

  return (
    <Overlay backdrop="tr-overlay" panel="tr-sheet" as="section" onClose={onClose} closable={!busy}>
      <header className="tr-sheet-head">
        <b>{stop.hospitalName} — {time(stop.plannedAt)}</b>
        <button type="button" className="tr-x" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>
      <div className="tr-sheet-body">
        {team && <p className="tr-owner"><Truck width="14" height="14" /> ثبت از طرفِ <b>{stop.staffName || '—'}</b></p>}
        {stop.handedTo && <p className="tr-hint">{pickup ? `برنامه: تحویل از «${stop.handedTo}»` : `برنامه: تحویل به «${stop.handedTo}»`}</p>}
        {pickup && stop.cargo?.some((c) => c.leftAt) && (
          <p className="tr-hint">کارشناس گذاشته در: <b>{stop.cargo.filter((c) => c.leftAt).map((c) => c.leftAt).join('، ')}</b></p>
        )}
        {pickup && bags.length > 0 && (
          <div className="tr-bag tr-count">
            <div className="tr-bag-head"><b><Box width="14" height="14" /> چه تحویل گرفتید؟</b><span>هر بسته را بشمارید؛ کسری خودش حساب می‌شود</span></div>
            <ul className="tr-items tr-count-items">
              {bags.flatMap((c) => c.items.filter((it) => it.lotId).map((it) => {
                const k = `${c.id}:${it.lotId}`;
                const want = expect(it);
                const got = counts[k] ?? want;
                return (
                  <li key={k} className={got < want ? 'short' : ''}>
                    <div className="tr-count-name">
                      {it.name}{it.serialNo && <em dir="ltr">{it.serialNo}</em>}
                      <small>
                        حوالهٔ <bdi dir="ltr">{c.code}</bdi> · باید برگردد {num(want)}
                        {want !== it.quantity ? ` (ارسالی ${num(it.quantity)}، مصرف ${num(it.quantity - want)})` : ''}
                        {got < want ? ` · کسری ${num(want - got)}` : ''}
                      </small>
                    </div>
                    <Stepper value={got} onChange={(n) => setCounts((st) => ({ ...st, [k]: n }))} max={want} label={it.name} />
                  </li>
                );
              }))}
            </ul>
            <div className="tr-chips">
              <button type="button" className={`tr-chip${seal === false ? ' on' : ''}`} onClick={() => setSeal(seal === false ? null : false)}>پلمبِ ست باز است</button>
              <button type="button" className={`tr-chip${seal === true ? ' on' : ''}`} onClick={() => setSeal(seal === true ? null : true)}>پلمب سالم است</button>
            </div>
            <p className="tr-hint">شمارشِ داخلِ ست کارِ انبار است، نه راننده — فقط بسته‌ها شمرده می‌شوند.</p>
          </div>
        )}
        <label className="tr-field">
          <span>{pickup ? (team ? 'از چه کسی تحویل گرفته شد؟' : 'از چه کسی تحویل گرفتید؟') : team ? 'به چه کسی تحویل داده شد؟' : 'به چه کسی تحویل دادید؟'}</span>
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
          {busy ? 'در حال ثبت…' : pickup ? (missing ? `ثبتِ جمع‌آوری با ${num(missing)} کسری` : 'ثبتِ جمع‌آوری') : 'ثبتِ تحویل'}
        </button>
      </div>
    </Overlay>
  );
}
