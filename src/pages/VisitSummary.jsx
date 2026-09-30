import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import './visit-summary.css';
import { adoptFace } from '../lib/public-face.js';
import { BrandMark, PublicErrorPage, faPhone, telHref, useFallbackFace } from './PublicBits.jsx';
import { Back, Print } from '../ui/icons.jsx';

/**
 * خلاصهٔ ویزیت — سندی که به دستِ بیمار می‌رسد (`/v/<token>`، عمومی).
 *
 * ⚠️ برخلافِ بقیهٔ اپ، **روشن** است: این صفحه برای چاپ/PDF ساخته شده و سندِ
 * کاغذی روی زمینهٔ سفید معنا دارد؛ همان چیزی که روی صفحه دیده می‌شود، بی‌کم
 * و کاست چاپ می‌شود. دکمهٔ «چاپ / ذخیرهٔ PDF» فقط window.print است — خروجیِ
 * PDF را خودِ مرورگر می‌سازد (اندروید/iOS/دسکتاپ، بدونِ هیچ وابستگی).
 */
export default function VisitSummary() {
  const { token } = useParams();
  /* «بازگشت به پروندهٔ من» فقط وقتی بیمار **از پرونده آمده** (پرتال با `state` باز می‌کند): پیوندِ
     پرونده عمداً در پاسخِ خلاصه نیست — خلاصه ممکن است برای پزشکِ دیگری فرستاده شود و نباید درِ کلِ
     پرونده را باز کند. */
  const back = useLocation().state?.back;
  const fromPortal = typeof back === 'string' && back.startsWith('/p/');
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  const isSurgery = data?.visit?.kind === 'surgery';
  /* هشدار: عنوان و برچسب‌ها از **نوعِ مراجعه** (بازبینیِ UX، بندِ ۱۱۲): سندِ کرانیوتومی تا دیروز «خلاصهٔ
     ویزیت / تاریخِ ویزیت / پزشک» چاپ می‌شد. */
  const docTitle = isSurgery ? 'خلاصهٔ عمل' : 'خلاصهٔ ویزیت';
  useEffect(() => {
    document.title = data?.brand?.name ? `${docTitle} — ${data.brand.name}` : docTitle;
  }, [docTitle, data?.brand?.name]);
  useEffect(() => {
    api(`/public/visit-summary/${token}`, { auth: false })
      /* خودِ سند رنگِ کاغذ دارد و از تم نمی‌گیرد (`visit-summary.css`)؛ تم و رنگِ مطب برای قابِ
         صفحه و صفحهٔ خطاست — این صفحه `/config` نمی‌خوانَد (بیرونِ Providerها). */
      .then((d) => { adoptFace(d); setData(d); })
      .catch((e) => setErr(e));
  }, [token]);
  const fallback = useFallbackFace(!!err);

  /* خطا صفحهٔ کاغذی نیست: الگوی «چه شد + چرا + چه کنید» با نام و تلفنِ مطب (بازبینیِ UX، بندِ ۱۱۰). */
  if (err) return <PublicErrorPage brand={fallback?.brand} err={err} />;
  if (!data) return <div className="vs-err quiet">در حال بارگذاری…</div>;

  const { brand, patient, visit, answers, nextVisitDateFa } = data;
  /* ⚠️ چند تشخیص (بستهٔ ۷): برچسبِ کامل از سرور می‌آید (اصلی اول) — سندی که
     به دستِ بیمار می‌رسد نباید تشخیصِ دوم را بیندازد. `diagnosisTitle` فقط
     fallbackِ سرورِ قدیمی است. `procedure` همین حالا برچسبِ ترکیبی است. */
  const manyDx = (visit.diagnoses ?? []).length > 1;
  const facts = [
    [isSurgery ? 'تاریخِ عمل' : 'تاریخِ ویزیت', visit.opDateFa],
    [isSurgery ? 'جراح' : 'پزشک', visit.doctorName],
    ['موضوع', visit.topicName],
    ['مرکز', visit.hospitalName],
    [manyDx ? 'تشخیص‌ها' : 'تشخیص', visit.diagnosisLabel ?? visit.diagnosisTitle],
    ['اقدام', visit.procedure],
  ].filter(([, v]) => v);

  return (
    <div className="vs">
      <div className="vs-page">
        <header className="vs-head">
          <div className="vs-brand">
            <BrandMark brand={brand} className="vs-logo" />
            <div>
              <h1>{brand.name ?? docTitle}</h1>
              {/* تلفن لمس‌شدنی — روی کاغذ همان متن است. */}
              {brand.phone && <a className="vs-tel" href={telHref(brand.phone)} dir="ltr">{faPhone(brand.phone)}</a>}
            </div>
          </div>
          <div className="vs-doc">
            <b>{docTitle}</b>
            <small dir="ltr">{visit.code}</small>
          </div>
        </header>

        <section className="vs-patient">
          <b>{patient.fullName}</b>
          <small dir="ltr">{patient.code}</small>
        </section>

        <dl className="vs-facts">
          {facts.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>

        {answers.map((a) => (
          <section key={a.label} className="vs-block">
            <h2>{a.label}</h2>
            <p>{a.body}</p>
          </section>
        ))}

        {nextVisitDateFa && (
          <section className="vs-next">
            <b>ویزیتِ بعدی: {nextVisitDateFa}</b>
            <small>لطفاً در تاریخِ بالا مراجعه فرمایید.</small>
          </section>
        )}

        <footer className="vs-foot">
          {brand.address && <small>{brand.address}</small>}
        </footer>
      </div>

      {/* فقط روی صفحه؛ در چاپ پنهان است. */}
      <div className="vs-actions">
        {/* برگشت = همان صفحهٔ قبلیِ تاریخچه (پرونده، با همان زبانه)، نه یک ورودیِ تازه که «بازگشت»ِ
            مرورگر را دوباره به خلاصه برگرداند. */}
        {fromPortal && (
          <button type="button" className="vs-back" onClick={() => navigate(-1)}>
            <Back width="16" height="16" aria-hidden="true" /> بازگشت به پروندهٔ من
          </button>
        )}
        <button type="button" className="vs-print" onClick={() => window.print()}>
          <Print width="16" height="16" aria-hidden="true" /> چاپ / ذخیرهٔ PDF
        </button>
      </div>
    </div>
  );
}
