import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { fetchFace } from '../lib/public-face.js';
import DynForm, { dynErrors } from '../ui/DynForm.jsx';
import { CheckCircle, Alert } from '../ui/icons.jsx';
import '../app/definitions.css';
import './intake.css';
import './survey.css';

/**
 * نظرسنجیِ بیمار — صفحهٔ عمومی، بدونِ ورود.
 *
 * ⚠️ **سؤال‌ها از فرم‌ساز می‌آیند، نه از این فایل.** سوپرادمین سؤال اضافه یا
 * کم می‌کند و همین‌جا دیده می‌شود؛ اگر سؤال‌ها را این‌جا می‌نوشتیم، هر شرکت
 * برای یک سؤالِ متفاوت یک نسخهٔ جدا از محصول می‌خواست.
 *
 * ⚠️ صفحه **هیچ اطلاعاتی از بیمار نشان نمی‌دهد**، حتی نامش. لینک ممکن است
 * فوروارد شده باشد و نظرسنجی نباید به پنجره‌ای به پروندهٔ بیمار تبدیل شود.
 * به همین دلیل سرور هم چیزی جز سؤال‌ها برنمی‌گرداند.
 */
export default function Survey() {
  const { token } = useParams();
  const [view, setView] = useState(null);
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { document.title = 'نظرسنجی'; }, []);
  /* تم و رنگِ مطب (بازبینیِ UX، بندِ ۹۴): پاسخِ نظرسنجی عمداً جز سؤال‌ها چیزی ندارد، پس هویت از
     مسیرِ عمومیِ جدا می‌آید — هم‌زمان با خودِ سؤال‌ها، نه پشتِ سرشان. */
  useEffect(() => { fetchFace(); }, []);
  useEffect(() => {
    api(`/public/survey/${token}`, { auth: false })
      .then(setView)
      .catch((e) => setErr(e.message));
  }, [token]);

  const submit = async () => {
    if (busy) return;
    const e = dynErrors(view.fields, answers);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await api(`/public/survey/${token}`, { auth: false, method: 'POST', body: { answers } });
      setDone(true);
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  const shell = (body) => (
    <div className="ik sv">
      <div className="ik-bg" aria-hidden="true" />
      <div className="ik-card sv-card">{body}</div>
    </div>
  );

  if (err && !view) {
    return shell(
      <div className="sv-msg">
        <Alert width="34" height="34" />
        <b>{err}</b>
      </div>,
    );
  }
  if (!view) return shell(<p className="ik-loading">در حال بارگذاری…</p>);

  /* ⚠️ «قبلاً جواب داده‌اید» و «مهلت تمام شده» دو پیامِ متفاوت‌اند و عمداً
     یکی نشده‌اند: اولی خبرِ خوب است (کارت انجام شد) و دومی خبرِ بد. یک پیامِ
     مشترک، به بیمارِ خوش‌قول هم می‌گفت «دیر کردی». */
  if (done || view.status === 'answered') {
    return shell(
      <div className="sv-msg ok">
        <CheckCircle width="38" height="38" />
        <b>سپاس‌گزاریم</b>
        <p>نظرِ شما ثبت شد و در بهترکردنِ کارِ ما اثر می‌گذارد.</p>
      </div>,
    );
  }
  if (view.status === 'expired') {
    return shell(
      <div className="sv-msg">
        <Alert width="34" height="34" />
        <b>مهلتِ این نظرسنجی تمام شده</b>
        <p>اگر نکته‌ای دارید، با ما تماس بگیرید — خوشحال می‌شویم بشنویم.</p>
      </div>,
    );
  }

  return shell(
    <>
      <header className="sv-head">
        <h1>{view.title}</h1>
        {view.hint && <p>{view.hint}</p>}
      </header>

      {err && <div className="ik-bad" role="alert">{err}</div>}

      <DynForm fields={view.fields} values={answers} errors={errors} onChange={setAnswers} disabled={busy} />

      <button type="button" className="ik-submit" onClick={submit} disabled={busy}>
        {busy ? 'در حال ثبت…' : 'ثبتِ نظر'}
      </button>
      <p className="sv-foot">پاسخِ شما محرمانه است و فقط برای بهبودِ خدمات استفاده می‌شود.</p>
    </>,
  );
}
