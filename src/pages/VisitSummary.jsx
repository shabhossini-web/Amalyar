import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import './visit-summary.css';

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
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => { document.title = 'خلاصهٔ ویزیت'; }, []);
  useEffect(() => {
    api(`/public/visit-summary/${token}`, { auth: false })
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [token]);

  if (err) return <div className="vs-err">{err}</div>;
  if (!data) return <div className="vs-err quiet">در حال بارگذاری…</div>;

  const { brand, patient, visit, answers, nextVisitDateFa } = data;
  const facts = [
    ['تاریخِ ویزیت', visit.opDateFa],
    ['پزشک', visit.doctorName],
    ['موضوع', visit.topicName],
    ['مرکز', visit.hospitalName],
    ['تشخیص', visit.diagnosisTitle],
    ['اقدام', visit.procedure],
  ].filter(([, v]) => v);

  return (
    <div className="vs">
      <div className="vs-page">
        <header className="vs-head">
          <div>
            <h1>{brand.name ?? 'خلاصهٔ ویزیت'}</h1>
            {brand.phone && <small dir="ltr">{brand.phone}</small>}
          </div>
          <div className="vs-doc">
            <b>خلاصهٔ ویزیت</b>
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
        <button type="button" onClick={() => window.print()}>چاپ / ذخیرهٔ PDF</button>
      </div>
    </div>
  );
}
