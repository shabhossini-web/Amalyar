import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import './portal.css';
import { ChevronEnd } from '../ui/icons.jsx';
import { adoptFace } from '../lib/public-face.js';
import { PublicErrorPage, PublicFoot, useFallbackFace } from './PublicBits.jsx';

/**
 * پروندهٔ الکترونیکِ بیمار — `/p/<token>`، عمومی و دائمی.
 *
 * راهِ ارتباطیِ ثابتِ مطب با بیمار: مراجعاتِ آتی، تاریخچهٔ مراجعات و عمل‌ها،
 * و فیدِ همهٔ اطلاع‌رسانی‌ها. هر مراجعه به خلاصهٔ چاپی‌اش (`/v/…`) لینک دارد.
 */
const SECTIONS = [
  { key: 'tasks', label: 'کارهای شما' },
  { key: 'upcoming', label: 'پیشِ‌رو' },
  { key: 'visits', label: 'مراجعات' },
  { key: 'surgeries', label: 'عمل‌ها' },
  { key: 'notices', label: 'پیام‌ها' },
];

/* ⚠️ برچسبِ وضعیت از سرور می‌آید (`statusFa`) — این پرتال `/config` را
   نمی‌خواند، پس سرور همراهِ ردیف می‌فرستدش. نسخهٔ قبلی «لغو شد» می‌نوشت و
   کارکنان «لغو» می‌دیدند. */

/**
 * متنِ پیام با لینک‌های کلیک‌پذیر (نیمهٔ UIِ W0.3؛ یافتهٔ D08).
 *
 * ⚠️ عمداً **بدونِ `dangerouslySetInnerHTML`**: متنِ پیامک از قالبی می‌آید که
 * ادمین می‌نویسد و نامِ بیمار در آن درج می‌شود — یعنی ورودیِ غیرِقابل‌اعتماد.
 * ساختنِ HTML از آن یعنی XSS روی صفحه‌ای که هیچ احرازی ندارد. این‌جا رشته
 * تکه می‌شود و هر تکه یک **المانِ React** است، پس مرورگر هرگز چیزی را به‌عنوانِ
 * نشانه‌گذاری تفسیر نمی‌کند.
 */
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
const linkify = (text) =>
  String(text ?? '').split(URL_RE).map((part, i) =>
    (i % 2 === 1
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" dir="ltr">{part}</a>
      : part),
  );

export default function Portal() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  /* خودِ خطا (status + message)، نه فقط متن — صفحهٔ خطا از status می‌گوید چه شد و چه کنید. */
  const [err, setErr] = useState(null);
  const [tab, setTabState] = useState('tasks');
  /* زبانه در نشانی (`?tab=`) هم می‌نشیند تا «بازگشت» از خلاصه به همان زبانه برگردد، نه به پیش‌فرض. */
  const [params, setParams] = useSearchParams();
  const setTab = (k) => { setTabState(k); setParams({ tab: k }, { replace: true }); };

  useEffect(() => { document.title = 'پروندهٔ الکترونیک'; }, []);
  useEffect(() => {
    api(`/public/portal/${token}`, { auth: false })
      .then((d) => {
        /* تم و رنگِ مطب از همین پاسخ — این صفحه `/config` نمی‌خوانَد (بیرونِ Providerها). */
        adoptFace(d);
        setData(d);
        /* تبِ خالی خوش‌آمد نیست. ترتیبِ اهمیت: کاری که از بیمار خواسته شده ←
           برنامهٔ پیشِ‌رو ← تاریخچه. زبانهٔ نشانی (بازگشت از خلاصه) مقدم است اگر خالی نباشد. */
        const want = params.get('tab');
        setTabState(want && SECTIONS.some((x) => x.key === want) && (d[want] ?? []).length
          ? want
          : d.tasks?.length ? 'tasks' : d.upcoming?.length ? 'upcoming' : 'visits');
      })
      .catch((e) => setErr(e));
  }, [token]);
  /* پرونده باز نشد ← تم و هویتِ مطب از مسیرِ عمومیِ جدا. */
  const fallback = useFallbackFace(!!err);

  /* «چه شد + چرا + چه کنید» با نام و تلفنِ مطب — نه یک خطِ صورتی روی صفحهٔ خالی (بازبینیِ UX، بندِ ۱۱۰). */
  if (err) return <PublicErrorPage brand={fallback?.brand} err={err} />;
  if (!data) return <div className="po-err quiet">در حال بارگذاری…</div>;

  /* هشدار: فقط مراجعهٔ **انجام‌شده** خلاصه دارد (سرور `summaryUrl` را برای بقیه تهی می‌فرستد): تا دیروز
     لمسِ نوبتِ فردا «خلاصهٔ ویزیت»ِ کاری را باز می‌کرد که هنوز انجام نشده (بازبینیِ UX، بندِ ۱۰۰). */
  const VisitRow = (v) => {
    const body = (
      <>
        <div className="po-row-main">
          <b>{v.kindTitle ?? 'مراجعه'}</b>
          <small>{[v.dateFa, v.doctorName, v.procedure ?? v.topicName].filter(Boolean).join(' · ')}</small>
        </div>
        <span className={`po-tag s-${v.status}`}>{v.statusFa ?? v.status}</span>
      </>
    );
    /* هشدار: همان زبانه، نه زبانهٔ تازه (بازبینیِ UX، بندِ ۱۱۵): بیمارِ مسن از زبانهٔ تازه راهِ برگشت را پیدا
       نمی‌کرد. `state.back` دکمهٔ «بازگشت به پروندهٔ من» را در خلاصه روشن می‌کند. */
    return v.summaryUrl
      ? (
        <Link key={v.code} className="po-row" to={v.summaryUrl} state={{ back: `/p/${token}` }}>
          {body}
          <ChevronEnd className="po-go" width="15" height="15" aria-hidden="true" />
        </Link>
      )
      : <div key={v.code} className="po-row po-row-plain">{body}</div>;
  };

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

      {tab === 'tasks' && (
        <section className="po-list">
          {data.tasks.length === 0 && <div className="po-empty">کارِ بازی ندارید — همه چیز تکمیل است</div>}
          {/* ⚠️ هر کار **لینکِ همان صفحه** است (`/f`, `/o`, `/s`): کلِ معیارِ
              پذیرشِ §۴.۶ همین است که بیمار برای یک نتیجه بینِ لینک‌های
              پیامک‌شده نگردد. */}
          {data.tasks.map((t, i) => (
            /* ⚠️ `Link` نه `href`: `/f` و `/o` و `/s` صفحه‌های همین اپ‌اند و
               `href` کلِ باندل را دوباره بار می‌کند — روی موبایلِ کندی که این
               صفحه برایش نوشته شده، یعنی چند ثانیه صفحهٔ سفید. */
            <Link key={i} className={`po-row po-task${t.urgent ? ' urgent' : ''}`} to={t.url}>
              <div className="po-row-main">
                <b>{t.label}</b>
                {t.detail && <small>{t.detail}</small>}
              </div>
              {/* قانونِ ۷: آیکونِ SVG، نه گلیفِ متنی. */}
              <ChevronEnd className="po-go" width="15" height="15" />
            </Link>
          ))}
          {data.tasks.length > 0 && <p className="po-hint">با لمسِ هر مورد، همان صفحه باز می‌شود.</p>}
        </section>
      )}

      {tab === 'upcoming' && (
        <section className="po-list">
          {data.upcoming.length === 0 && <div className="po-empty">فعلاً برنامهٔ پیشِ‌رویی ثبت نشده است</div>}
          {/* یک مرحله = یک کارت (DECISIONS.md #۵): وقتی نوبتِ قطعی برای همان
              «ویزیتِ بعدی» گرفته شده، سرور یک ردیفِ `booked` می‌دهد و توصیهٔ
              پزشک زیرش توضیح می‌شود — نه دو ردیفِ رقیب با دو تاریخ. */}
          {/* «کِی بیایم؟» اولین سؤالِ بیمار است: روزِ هفته + تاریخ + ساعت درشت، بعد پزشک و «کجا»
              (بازبینیِ UX، بندِ ۱۰۰). پاسخِ سرورِ قدیمی (فقط `dateFa`) هم همان کارت را می‌سازد. */}
          {data.upcoming.map((u, i) => (
            <div key={i} className={`po-row po-up${u.booked ? ' booked' : ''}`}>
              <div className="po-row-main">
                <b>{u.label}</b>
                <span className="po-when">
                  {u.whenFa ?? u.dateFa}
                  {u.timeFa && <>، ساعتِ <bdi dir="ltr">{u.timeFa}</bdi></>}
                </span>
                {u.doctorName && <small>پزشک: {u.doctorName}</small>}
                {(u.place || u.address) && <small>{[u.place, u.address].filter(Boolean).join(' — ')}</small>}
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
          {data.visits.some((v) => v.summaryUrl) && <p className="po-hint">با لمسِ مراجعهٔ انجام‌شده، خلاصهٔ آن باز می‌شود.</p>}
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
              <p>{linkify(n.text)}</p>
            </div>
          ))}
        </section>
      )}

      {/* «تماس با مطب» دکمه با آیکون و رقمِ فارسی (بازبینیِ UX، بندِ ۱۱۴) — نه متنِ ۲۴ پیکسلیِ لاتین. */}
      <PublicFoot brand={data.brand} />
    </div>
  );
}
