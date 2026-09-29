import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api, apiBlobUrl } from '../lib/api.js';
import { faDate, J_MONTHS } from '../lib/jalali.js';
import './crm.css';
import { Alert, Back, Chart, Star } from '../ui/icons.jsx';
import { useStagger } from '../ui/stagger.js';
import { useStatusMap, useTerms } from './config.jsx';

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

/** دانلودِ CSV با هدرِ ورود — لینکِ ساده توکن ندارد و ۴۰۱ می‌خورد. */
async function downloadCsv(path, fallbackName, onErr) {
  try {
    const url = await apiBlobUrl(path);
    const a = document.createElement('a');
    a.href = url;
    a.download = fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {
    onErr?.(e.message);
  }
}

/**
 * روندِ ماهانه — ۱۲ ماهِ شمسیِ اخیر: ستونِ حجمِ ثبت‌نام (کل + پرشده) و
 * میانگینِ رضایتِ همان ماه بالای ستون. همهٔ عددها از سرور می‌آیند (قاعدهٔ ۱۵)؛
 * این‌جا فقط ارتفاعِ نسبی حساب می‌شود که خاصیتِ رسم است نه داده.
 */
function TrendCard({ trend }) {
  const peak = Math.max(1, ...trend.map((m) => m.total));
  const any = trend.some((m) => m.total > 0);
  return (
    <>
      {!any && <div className="crm-empty">در ۱۲ ماهِ اخیر هنوز ثبت‌نامی نیست.</div>}
      {any && (
        <>
          <div className="crm-months">
            {trend.map((m) => (
              <div
                key={`${m.jy}-${m.jm}`} className="crm-mbar"
                title={`${J_MONTHS[m.jm - 1]} ${faNum(m.jy).replace(/٬/g, '')} — ${faNum(m.total)} ثبت‌نام، ${faNum(m.filled)} پرشده${m.ratingAvg !== null ? `، رضایت ${faNum(m.ratingAvg)}` : ''}`}
              >
                <em className="crm-mrt">
                  {m.ratingAvg !== null && <><Star width="8" height="8" /> {faNum(m.ratingAvg)}</>}
                </em>
                <div className="crm-mstack">
                  <i className="t" style={{ height: `${(m.total / peak) * 100}%` }} />
                  <i className="f" style={{ height: `${(m.filled / peak) * 100}%` }} />
                </div>
                {/* نامِ **کاملِ** ماه — سه‌حرفیِ قبلی «مرد»، «شهر»، «ارد» می‌ساخت (clinic-daily-23). روی
                    گوشی عمودی می‌نشیند تا جا شود، نه اینکه بریده شود. */}
                <span>{J_MONTHS[m.jm - 1]}</span>
              </div>
            ))}
          </div>
          <div className="crm-legend">
            <i className="t" /> ثبت‌نام <i className="f" /> پرشده
            <b className="crm-mrt"><Star width="9" height="9" /></b> میانگینِ رضایتِ ماه
          </div>
        </>
      )}
    </>
  );
}

const SMS_FA = { sent: 'پیامک رفته', pending: 'پیامک در صف', none: 'بی‌پیامک' };

/** فهرستِ عمل‌های انجام‌شده بدونِ فرمِ پیگیریِ پرشده — کارِ امروزِ منشی. */
function UnfollowedCard({ unf }) {
  if (!unf.enabled) {
    return (
      <div className="crm-empty">
        فرمِ پیگیری هنوز تعریف نشده — در فرم‌ساز به یک فرمِ زیرپرونده «نقشِ پیگیری» بدهید تا این فهرست روشن شود.
      </div>
    );
  }
  return (
    <>
      {unf.rows.length === 0 ? (
        <div className="crm-empty">
          هیچ موعدِ پیگیریِ رسیده‌ای بی‌پاسخ نمانده.
          {unf.waiting > 0 && ` (${faNum(unf.waiting)} عمل موعدِ پیگیری‌اش هنوز نرسیده.)`}
        </div>
      ) : (
        <div className="crm-unf">
          {unf.rows.map((r) => (
            <article key={r.visitId} className="crm-unf-row">
              <Link to={`/app/patients/${r.patientId}`} className="crm-unf-name">
                <b>{r.name}</b>
                {r.code && <span>{r.code}</span>}
              </Link>
              <span className="crm-unf-op">
                {faDate(r.opDate)} · {faNum(r.daysSince)} روز پیش{r.procedure ? ` · ${r.procedure}` : ''}
              </span>
              {/* W1.1: کدام موعد بی‌پاسخ است — بدونِ این، منشی نمی‌داند دربارهٔ چه تماس بگیرد. */}
              {r.pendingDays?.length > 0 && (
                <span className="crm-chip u-day">
                  موعدِ بی‌پاسخ: {r.pendingDays.map((d) => `روزِ ${faNum(d)}`).join('، ')}
                </span>
              )}
              {r.days?.length === 0 && <span className="crm-chip u-day">فرمِ پیگیری ساخته نشده</span>}
              {r.answeredDays?.length > 0 && (
                <span className="crm-chip u-done">پاسخ‌گرفته: {r.answeredDays.map((d) => `روزِ ${faNum(d)}`).join('، ')}</span>
              )}
              <span className={`crm-chip u-${r.sms}`}>{SMS_FA[r.sms] ?? r.sms}</span>
              {r.openForm && <span className="crm-chip u-open">فرمِ باز، بی‌پاسخ</span>}
            </article>
          ))}
        </div>
      )}
    </>
  );
}

/** نوارِ افقیِ یک گزینه — سهمش از کلِ پاسخ‌ها. */
function Bar({ label, count, total, tone }) {
  return (
    <div className="crm-bar">
      <span className="crm-bar-label">{label}</span>
      <span className="crm-bar-track">
        <span className={`crm-bar-fill${tone ? ` ${tone}` : ''}`} style={{ width: `${pct(count, total)}%` }} />
      </span>
      <span className="crm-bar-num">{faNum(count)} <em>(٪{faNum(pct(count, total))})</em></span>
    </div>
  );
}

/** یک فیلدِ تحلیل‌شده — بسته به نوع: توزیع، میانگین، یا متن‌ها. */
function FieldBlock({ f }) {
  const [open, setOpen] = useState(false);
  if (f.type === 'text' || f.type === 'textarea') {
    if (!f.answered) return null;
    return (
      <div className="crm-field">
        <button type="button" className="crm-field-head as-btn" onClick={() => setOpen(!open)}>
          <b>{f.label}</b>
          <small>{faNum(f.answered)} پاسخِ متنی {open ? '▴' : '▾'}</small>
        </button>
        {open && (
          <div className="crm-texts">
            {f.answers.map((a, i) => (
              <blockquote key={i}>
                <p>{a.text}</p>
                <footer>{a.patient ?? 'بی‌نام'}{a.code ? ` · ${a.code}` : ''} · {faDate(a.at)}</footer>
              </blockquote>
            ))}
          </div>
        )}
      </div>
    );
  }
  const total = f.dist?.reduce((s, d) => s + d.count, 0) ?? 0;
  if (!total) return null;
  return (
    <div className="crm-field">
      <div className="crm-field-head">
        <b>{f.label}</b>
        {f.type === 'rating' && f.avg !== null && (
          <small className="crm-avg"><Star width="12" height="12" /> میانگین {faNum(f.avg)}</small>
        )}
        {f.type !== 'rating' && <small>{faNum(f.answered)} پاسخ</small>}
      </div>
      <div className="crm-bars">
        {f.dist.map((d) => (
          <Bar
            key={d.value}
            label={f.type === 'rating' ? `${faNum(d.value)} ستاره` : d.label}
            count={d.count} total={total}
            tone={f.type === 'rating' ? (Number(d.value) >= 4 ? 'good' : Number(d.value) <= 2 ? 'bad' : '') : ''}
          />
        ))}
      </div>
    </div>
  );
}

/* ⚠️ نگاشتِ سومِ وضعیتِ ثبت‌نام برداشته شد: «منقضی» می‌گفت آن‌جا که سرور
   «رها‌شده» می‌گوید و تبِ ثبت‌نام «ناتمام» آن‌جا که سرور «در انتظارِ تکمیل».
   یک ردیف، سه واژه. حالا از `/config.statuses.intake`. */

/**
 * CRM — نسخهٔ اول: تحلیلِ فرم‌های زیرپرونده (نظرسنجی/پرسش‌نامه) + کانالِ آشنایی.
 *
 * ⚠️ هیچ محاسبه‌ای این‌جا نیست (قاعدهٔ ۱۵): سرور توزیع‌ها را ساخته و این صفحه
 * فقط نوار می‌کشد. هر چه صفحه «بداند»، فردا با گزارشِ چاپی/CSV دو نظر پیدا می‌کرد.
 */
export default function Crm() {
  const intakeFa = useStatusMap('intake');
  const t = useTerms();
  const [data, setData] = useState(null);
  const [unf, setUnf] = useState(null);
  const [err, setErr] = useState('');
  const row = useStagger();

  /* نام از واژه‌نامهٔ حوزه — کاشیِ لانچر همان `t.crm` را می‌خواند (قانونِ ۲۴؛ clinic-daily-23). */
  useEffect(() => { document.title = `عمل‌یار — ${t.crm}`; }, [t.crm]);
  useEffect(() => {
    api('/intake/analytics').then(setData).catch((e) => setErr(e.message));
    api('/intake/unfollowed').then(setUnf).catch((e) => setErr(e.message));
  }, []);

  return (
    <div className="crm">
      <div className="crm-bg" aria-hidden="true" />
      <header className="crm-head">
        <Link to="/app" className="crm-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1><Chart width="20" height="20" /> {t.crm}</h1>
          <p>نتیجهٔ نظرسنجی‌ها و پرسش‌نامه‌های زیرپرونده، و این‌که بیماران از کجا می‌آیند.</p>
        </div>
      </header>

      {err && <div className="crm-err"><Alert width="15" height="15" /> {err}</div>}
      {!data && !err && <div className="crm-empty">در حال بارگذاری…</div>}

      {data && (
        <>
          {/* کانالِ آشنایی — روی کلِ پرونده‌ها */}
          <motion.section {...row(0)} className="crm-card">
            <header className="crm-card-head">
              <b>کانالِ آشناییِ بیماران</b>
              <small>{faNum(data.patientsTotal)} پرونده</small>
            </header>
            {data.referrals.length === 0 && <div className="crm-empty">هنوز پرونده‌ای نیست</div>}
            <div className="crm-bars">
              {data.referrals.map((r) => (
                <Bar key={String(r.id)} label={r.name} count={r.count} total={data.patientsTotal} />
              ))}
            </div>
          </motion.section>

          {/* روندِ ماهانه — حجمِ ثبت‌نام و رضایت، ۱۲ ماهِ شمسیِ اخیر */}
          {Array.isArray(data.trend) && (
            <motion.section {...row(1)} className="crm-card">
              <header className="crm-card-head">
                <b>روندِ ماهانه</b>
                <small>۱۲ ماهِ اخیر — ثبت‌نام و رضایت</small>
              </header>
              <TrendCard trend={data.trend} />
            </motion.section>
          )}

          {/* پیگیریِ پس از عمل — عمل‌های انجام‌شده بدونِ فرمِ پرشده */}
          {unf && (
            <motion.section {...row(2)} className="crm-card">
              <header className="crm-card-head">
                <b>پیگیریِ پس از عمل — انجام‌نشده</b>
                {unf.enabled && (
                  <small>
                    {faNum(unf.rows.length)} بی‌پیگیری از {faNum(unf.checked)} عملِ انجام‌شدهٔ یک سالِ اخیر
                    {unf.followed > 0 && ` · ${faNum(unf.followed)} پیگیری‌شده`}
                    {unf.waiting > 0 && ` · ${faNum(unf.waiting)} موعدش نرسیده`}
                    {/* W1.1: سقف باید دیده شود — وگرنه «۳۰۰ عمل» مثلِ کلِ عمل‌ها خوانده می‌شود. */}
                    {unf.capped && ` — تازه‌ترین ${faNum(unf.limit)} از ${faNum(unf.total)}`}
                  </small>
                )}
                {unf.enabled && unf.rows.length > 0 && (
                  <button
                    type="button" className="crm-csv"
                    onClick={() => downloadCsv('/intake/unfollowed/csv', 'crm-unfollowed.csv', setErr)}
                  >
                    خروجیِ CSV
                  </button>
                )}
              </header>
              <UnfollowedCard unf={unf} />
            </motion.section>
          )}

          {data.forms.length === 0 && (
            <div className="crm-empty">
              هنوز فرمِ زیرپرونده‌ای (نظرسنجی/پرسش‌نامه) ساخته نشده — از فرم‌ساز یک فرم با محدودهٔ «زیرپرونده» بسازید.
            </div>
          )}

          {data.forms.map((f, i) => (
            <motion.section {...row(i + 3)} className="crm-card" key={f.id}>
              <header className="crm-card-head">
                <span className="crm-dot" style={{ background: f.color || 'var(--brand-2)' }} aria-hidden="true" />
                <b>{f.title}</b>
                {!f.active && <em className="crm-off">خاموش</em>}
                {f.filled > 0 && (
                  <button
                    type="button" className="crm-csv"
                    onClick={() => downloadCsv(`/intake/analytics/csv?formId=${f.id}`, `crm-${f.id}.csv`, setErr)}
                  >
                    CSV
                  </button>
                )}
                <small>
                  {faNum(f.filled)} پرشده از {faNum(f.total)} ارسال
                  {f.direct > 0 ? ` · ${faNum(f.direct)} ارسالِ مستقیم` : ''}
                  {f.lastAt ? ` · آخرین: ${faDate(f.lastAt)}` : ''}
                </small>
              </header>

              {f.total > 0 && (
                <div className="crm-statuses">
                  {Object.entries(f.statuses).map(([k, n]) => (
                    <span key={k} className={`crm-chip s-${k}`}>{intakeFa[k] ?? k}: {faNum(n)}</span>
                  ))}
                </div>
              )}

              {f.filled === 0
                ? <div className="crm-empty">هنوز پاسخِ کاملی نیامده</div>
                : f.fields.map((fd) => <FieldBlock key={fd.key} f={fd} />)}
            </motion.section>
          ))}
        </>
      )}
    </div>
  );
}
