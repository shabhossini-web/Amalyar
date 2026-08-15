import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { faDate } from '../lib/jalali.js';
import './crm.css';
import { Alert, Back, Chart, Star } from '../ui/icons.jsx';
import { useStagger } from '../ui/stagger.js';

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

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

const STATUS_FA = {
  pending_fill: 'ناتمام', pending_payment: 'در انتظارِ فیش', pending_approval: 'در انتظارِ تأیید',
  approved: 'تأییدشده', rejected: 'ردشده', expired: 'منقضی',
};

/**
 * CRM — نسخهٔ اول: تحلیلِ فرم‌های زیرپرونده (نظرسنجی/پرسش‌نامه) + کانالِ آشنایی.
 *
 * ⚠️ هیچ محاسبه‌ای این‌جا نیست (قاعدهٔ ۱۵): سرور توزیع‌ها را ساخته و این صفحه
 * فقط نوار می‌کشد. هر چه صفحه «بداند»، فردا با گزارشِ چاپی/CSV دو نظر پیدا می‌کرد.
 */
export default function Crm() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const row = useStagger();

  useEffect(() => { document.title = 'عمل‌یار — تحلیل و CRM'; }, []);
  useEffect(() => {
    api('/intake/analytics').then(setData).catch((e) => setErr(e.message));
  }, []);

  return (
    <div className="crm">
      <div className="crm-bg" aria-hidden="true" />
      <header className="crm-head">
        <Link to="/app" className="crm-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1><Chart width="20" height="20" /> تحلیل و CRM</h1>
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

          {data.forms.length === 0 && (
            <div className="crm-empty">
              هنوز فرمِ زیرپرونده‌ای (نظرسنجی/پرسش‌نامه) ساخته نشده — از فرم‌ساز یک فرم با محدودهٔ «زیرپرونده» بسازید.
            </div>
          )}

          {data.forms.map((f, i) => (
            <motion.section {...row(i + 1)} className="crm-card" key={f.id}>
              <header className="crm-card-head">
                <span className="crm-dot" style={{ background: f.color || 'var(--brand-2)' }} aria-hidden="true" />
                <b>{f.title}</b>
                {!f.active && <em className="crm-off">خاموش</em>}
                <small>
                  {faNum(f.filled)} پرشده از {faNum(f.total)} ارسال
                  {f.direct > 0 ? ` · ${faNum(f.direct)} ارسالِ مستقیم` : ''}
                  {f.lastAt ? ` · آخرین: ${faDate(f.lastAt)}` : ''}
                </small>
              </header>

              {f.total > 0 && (
                <div className="crm-statuses">
                  {Object.entries(f.statuses).map(([k, n]) => (
                    <span key={k} className={`crm-chip s-${k}`}>{STATUS_FA[k] ?? k}: {faNum(n)}</span>
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
