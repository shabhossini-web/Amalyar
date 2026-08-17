import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import './portal.css';

/**
 * پروندهٔ الکترونیکِ بیمار — `/p/<token>`، عمومی و دائمی.
 *
 * راهِ ارتباطیِ ثابتِ مطب با بیمار: مراجعاتِ آتی، تاریخچهٔ مراجعات و عمل‌ها،
 * و فیدِ همهٔ اطلاع‌رسانی‌ها. هر مراجعه به خلاصهٔ چاپی‌اش (`/v/…`) لینک دارد.
 */
const SECTIONS = [
  { key: 'upcoming', label: 'پیشِ‌رو' },
  { key: 'visits', label: 'مراجعات' },
  { key: 'surgeries', label: 'عمل‌ها' },
  { key: 'notices', label: 'پیام‌ها' },
];

const STATUS_FA = { pending: 'در انتظار', done: 'انجام شد', cancelled: 'لغو شد' };

export default function Portal() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('upcoming');

  useEffect(() => { document.title = 'پروندهٔ الکترونیک'; }, []);
  useEffect(() => {
    api(`/public/portal/${token}`, { auth: false })
      .then((d) => {
        setData(d);
        /* اگر چیزی پیشِ‌رو نیست، مستقیم برو سرِ مراجعات — تبِ خالی خوش‌آمد نیست. */
        if (!d.upcoming?.length) setTab('visits');
      })
      .catch((e) => setErr(e.message));
  }, [token]);

  if (err) return <div className="po-err">{err}</div>;
  if (!data) return <div className="po-err quiet">در حال بارگذاری…</div>;

  const VisitRow = (v) => (
    <a key={v.code} className="po-row" href={v.summaryUrl} target="_blank" rel="noopener noreferrer">
      <div className="po-row-main">
        <b>{v.kindTitle ?? 'مراجعه'}</b>
        <small>{[v.dateFa, v.doctorName, v.procedure ?? v.topicName].filter(Boolean).join(' · ')}</small>
      </div>
      <span className={`po-tag s-${v.status}`}>{STATUS_FA[v.status] ?? v.status}</span>
    </a>
  );

  return (
    <div className="po">
      <div className="po-bg" aria-hidden="true" />
      <header className="po-head">
        <small>{data.brand.name ?? 'پروندهٔ الکترونیک'}</small>
        <h1>{data.patient.fullName}</h1>
        <em dir="ltr">{data.patient.code}</em>
      </header>

      <nav className="po-tabs" role="radiogroup" aria-label="بخش‌های پرونده">
        {SECTIONS.map((s) => (
          <button
            key={s.key} type="button" role="radio" aria-checked={tab === s.key}
            className={tab === s.key ? 'on' : ''} onClick={() => setTab(s.key)}
          >
            {s.label}
            <i>{(data[s.key] ?? []).length.toLocaleString('fa-IR')}</i>
          </button>
        ))}
      </nav>

      {tab === 'upcoming' && (
        <section className="po-list">
          {data.upcoming.length === 0 && <div className="po-empty">فعلاً برنامهٔ پیشِ‌رویی ثبت نشده است</div>}
          {data.upcoming.map((u, i) => (
            <div key={i} className="po-row po-up">
              <div className="po-row-main">
                <b>{u.label}: {u.dateFa}</b>
                {u.detail && <small>{u.detail}</small>}
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === 'visits' && (
        <section className="po-list">
          {data.visits.length === 0 && <div className="po-empty">هنوز مراجعه‌ای ثبت نشده است</div>}
          {data.visits.map(VisitRow)}
          {data.visits.length > 0 && <p className="po-hint">با لمسِ هر مراجعه، خلاصهٔ آن باز می‌شود.</p>}
        </section>
      )}

      {tab === 'surgeries' && (
        <section className="po-list">
          {data.surgeries.length === 0 && <div className="po-empty">عملی ثبت نشده است</div>}
          {data.surgeries.map(VisitRow)}
        </section>
      )}

      {tab === 'notices' && (
        <section className="po-list">
          {data.notices.length === 0 && <div className="po-empty">هنوز پیامی فرستاده نشده است</div>}
          {data.notices.map((n, i) => (
            <div key={i} className={`po-notice${n.upcoming ? ' up' : ''}`}>
              <small>{n.upcoming ? `برنامه‌ریزی‌شده برای ${n.dateFa}` : n.dateFa}</small>
              <p>{n.text}</p>
            </div>
          ))}
        </section>
      )}

      <footer className="po-foot">
        {data.brand.phone && <a href={`tel:${data.brand.phone}`} dir="ltr">{data.brand.phone}</a>}
        {data.brand.address && <small>{data.brand.address}</small>}
      </footer>
    </div>
  );
}
