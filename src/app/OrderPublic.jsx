/**
 * صفحهٔ عمومیِ سفارش — چیزی که بیمار با کلیک روی لینکِ پیامک می‌بیند.
 *
 * عمداً کم‌حرف و بی‌ورود: بیمار می‌بیند چه خواسته شده، تا کِی، و اگر جواب
 * دارد همان‌جا می‌گذارد. هیچ اطلاعاتِ پرسنلی یا شمارهٔ تماسی این‌جا نیست —
 * لینک ممکن است دستِ چند نفر بچرخد.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, apiBlobUrl, apiUpload } from '../lib/api.js';
import { fetchFace } from '../lib/public-face.js';
import { faDate } from '../lib/jalali.js';
import { PATIENT } from '../lib/terms.js';
import { Alert, CheckCircle, Clock } from '../ui/icons.jsx';
import FileDrop from '../ui/FileDrop.jsx';
import VoiceNote, { VoiceClip } from '../ui/VoiceNote.jsx';
import './orders.css';
import './launcher.css';

const T = PATIENT.order;
/** قرارداد §۵ — همان سقف‌هایی که سرور می‌سنجد. کاربر باید **پیش** از آپلود بفهمد. */
const MAX_MB = 10;
const MAX_FILES = 5;
const faNum = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/**
 * وضعیتِ مسیرِ سفارش از دیدِ بیمار — از `status`ِ سرور (CONTRACTS §۴)، نه از یک
 * پرچمِ «تمام شد» در مرورگر.
 *
 * ⚠️ تا دیروز بعد از ثبت می‌نوشت «لازم نیست کارِ دیگری بکنید» — در حالی که هنوز
 * هیچ‌کس پاسخ را ندیده بود و اگر ناخوانا بود، همین بیمار باید دوباره می‌فرستاد
 * (B4, D10c).
 */
const routeState = (row, justSent) => {
  if (justSent) return justSent;
  if (row.status && T[row.status]) return row.status;
  return row.answered ? 'answered' : null;
};

export default function OrderPublic() {
  const { token } = useParams();
  const [row, setRow] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ text: '', link: '', user: '', pass: '' });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const [files, setFiles] = useState(0);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');

  const reload = () => api(`/public/order/${token}`).then(setRow);
  useEffect(() => {
    document.title = 'عمل‌یار — درخواستِ پزشک';
    fetchFace(); // تم و رنگِ مطب — این صفحه بیرونِ ConfigProvider است (بازبینیِ UX، بندِ ۹۴)
    reload().catch((e) => setErr(e.message));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ⚠️ هر فایل همان لحظه می‌رود و به سفارش وصل می‌شود، ولی وضعیت را جلو
   * نمی‌برد (W0.8): بیمار سه صفحهٔ جواب را جدا می‌فرستد و یک‌بار «ثبت» می‌زند.
   */
  const upload = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    await apiUpload(`/public/order/${token}/files`, fd);
    setFiles((n) => n + 1);
    setErr('');
  };

  const submit = async (append = false) => {
    /* ⚠️ فایل خودش یک پاسخِ کامل است — جوابِ آزمایش معمولاً فقط یک عکس است.
       تا دیروز همین‌جا «متن یا لینکِ پاسخ را وارد کنید» می‌گرفت و بیمار مجبور
       بود چیزی بنویسد. سرور در W0.8 بازش کرد؛ این شرط هم باید همان را بگوید. */
    if (!f.text.trim() && !f.link.trim() && !files && !(row?.drafts > 0)) {
      setErr('متن، لینک یا فایلِ پاسخ را بفرستید'); return;
    }
    setBusy(true); setErr('');
    try {
      const res = await api(`/public/order/${token}/answer`, {
        method: 'POST', body: append ? { ...f, append: true } : f,
      });
      setSent(res?.status && T[res.status] ? res.status : 'answered');
      /* تأییدِ صریح — بیمار باید بداند فرستاده‌اش رسید، نه اینکه با خطا دوباره بفرستد. */
      /* «هر ارسال، پاسخِ جدا»: ارسالِ دوباره پاسخِ تازه‌ای با تاریخِ خودش می‌سازد، نه بازنویسیِ قبلی. */
      setNotice(append ? 'ثبتِ مجدد انجام شد — پاسخِ تازه برای پزشک رفت' : 'پاسخ ثبت شد و برای پزشک رفت');
      reload().catch(() => {});
      setF({ text: '', link: '', user: '', pass: '' });
      setFiles(0);
      setAdding(false);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  if (err && !row) return <div className="op-wrap"><div className="op-card op-err">{err}</div></div>;
  if (!row) return <div className="op-wrap"><div className="op-card">در حال بارگذاری…</div></div>;

  const state = routeState(row, sent);
  /* پاسخِ تازه فقط وقتی پذیرفته می‌شود که هنوز پاسخی نیست، یا خودِ تیمِ درمان
     «دوباره بفرست» گفته (CONTRACTS §۵) — نه اینکه پاسخِ قبلی بی‌صدا بازنویسی شود. */
  const canAnswer = state === null || state === 'needs_action';
  /* و اگر پاسخ رفته، بیمار باز هم باید بتواند **اضافه** کند: صفحهٔ دومِ جواب،
     یا عکسِ خواناتر. مسیرش `append` است که وضعیت و تصمیمِ بررسی را دست نمی‌زند. */
  const canAppend = !canAnswer && state !== null;
  const open = canAnswer || adding;
  const StateIcon = state === 'needs_action' ? Alert : state === 'reviewed' ? CheckCircle : Clock;

  return (
    <div className="op-wrap">
      <div className="op-card">
        {row.clinic && <small className="op-clinic">{row.clinic}</small>}
        <h1>{row.kindFa}</h1>
        <p className="op-summary">{row.summary}</p>
        {row.note && <p className="op-note">{row.note}</p>}
        {row.dueDate && <p className="op-due">مهلتِ انجام: <b>{faDate(row.dueDate)}</b></p>}
        {/* توضیحِ صوتیِ پزشک برای همین درخواست — تا ۱۴۰۵/۰۸/۰۴ ثبت می‌شد ولی به بیمار نمی‌رسید. */}
        {(row.voices ?? []).length > 0 && (
          <div className="op-voices">
            {row.voices.map((v) => (
              <VoiceClip key={v.id} name={v.title || 'توضیحِ صوتیِ پزشک'}
                load={() => apiBlobUrl(`/public/order/${token}/voice/${v.id}`)} />
            ))}
          </div>
        )}

        {row.kind !== 'referral' && (
          <>
            {state && (
              <p className={`op-ok st-${state}`}><StateIcon width="15" height="15" /> {T[state]}</p>
            )}
            {state === 'needs_action' && row.reviewNote && <p className="op-note op-review">{row.reviewNote}</p>}
            {notice && <p className="op-notice" role="status"><CheckCircle width="15" height="15" /> {notice}</p>}
            {/* چک‌لیستِ درخواست — پزشک هنگامِ بررسی «رسید» می‌زند؛ بیمار می‌بیند چه مانده. */}
            {(row.items ?? []).length > 1 && (
              <ul className="op-check" aria-label="موردهای درخواستی">
                {row.items.map((it) => {
                  /* پیش از اولین بررسی «نرسیده» دروغ است — شاید همه را فرستاده باشد و هنوز کسی ندیده. */
                  const reviewed = state === 'reviewed' || state === 'needs_action';
                  const got = (row.receivedItems ?? []).includes(it);
                  return <li key={it} className={got ? 'ok' : ''}>{got ? <CheckCircle width="14" height="14" /> : <Clock width="14" height="14" />}<bdi>{it}</bdi><small>{got ? 'رسید' : reviewed ? 'هنوز نرسیده' : 'منتظرِ بررسی'}</small></li>;
                })}
              </ul>
            )}
            {(row.responses ?? []).length > 0 && (
              <div className="op-history">
                <small className="op-hint">پاسخ‌هایی که فرستاده‌اید</small>
                <ul>
                  {row.responses.map((r) => (
                    <li key={r.seq} className={`st-${r.status}`}>
                      <b>پاسخِ {faNum(r.seq)}</b>
                      <span>{faDate(r.createdAt)}{r.files ? ` · ${faNum(r.files)} فایل` : ''}{r.hasText ? ' · توضیح' : ''}{r.hasLink ? ' · لینک' : ''}</span>
                      <i>{r.statusFa}</i>
                      {r.reviewNote && <em>{r.reviewNote}</em>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {canAppend && !adding && (
              <button type="button" className="op-more" onClick={() => setAdding(true)}>
                فرستادنِ پاسخِ تازه (فایل یا توضیح)
              </button>
            )}
            {open && (
              <div className="op-answer">
                <h2>{canAnswer ? 'ثبتِ پاسخ' : 'پاسخِ تازه'}</h2>
                <p className="op-hint">
                  عکسِ برگهٔ جواب را بفرستید، یا اگر جوابتان روی سایتِ آزمایشگاه است لینکش را بگذارید.
                </p>

                <FileDrop
                  onUpload={upload}
                  label="عکس یا PDFِ جواب"
                  hint={`عکسِ برگه یا فایلِ PDF — تا ${faNum(MAX_MB)} مگابایت، حداکثر ${faNum(MAX_FILES)} فایل`}
                  accept="image/*,.pdf"
                  maxMb={MAX_MB}
                  capture="environment"
                  disabled={busy}
                />

                <label className="db-field"><span>لینکِ جواب (اگر آنلاین است)</span>
                  <input dir="ltr" value={f.link} onChange={(e) => setF((s) => ({ ...s, link: e.target.value }))} placeholder="https://…" />
                </label>
                <div className="db-grid2">
                  <label className="db-field"><span>نامِ کاربری (اگر لازم است)</span>
                    <input dir="ltr" value={f.user} onChange={(e) => setF((s) => ({ ...s, user: e.target.value }))} />
                  </label>
                  <label className="db-field"><span>رمز</span>
                    <input dir="ltr" value={f.pass} onChange={(e) => setF((s) => ({ ...s, pass: e.target.value }))} />
                  </label>
                </div>
                {/* توضیحِ صوتی (بستهٔ ۶د) — «رادیولوژیست گفت …» را بیمار با صدا
                    می‌گوید، نه با تایپ. همان مسیرِ فایل‌ها (یکی از ۵ فایلِ سفارش). */}
                <div className="db-field op-voice"><span>توضیحِ صوتی (اختیاری)</span>
                  <VoiceNote
                    disabled={busy}
                    onSave={async (file) => { await upload(file); }}
                  />
                  {(files > 0 || row.drafts > 0) && (
                    <small className="op-hint op-drafts">{faNum(Math.max(files, row.drafts ?? 0))} فایل آمادهٔ ارسال است — تا «ارسال» را نزنید برای پزشک نمی‌رود.</small>
                  )}
                </div>
                <label className="db-field"><span>توضیح (اختیاری)</span>
                  <textarea rows={3} value={f.text} onChange={(e) => setF((s) => ({ ...s, text: e.target.value }))} />
                </label>
                {err && <p className="op-err-line">{err}</p>}
                <button type="button" className="op-send" disabled={busy} onClick={() => submit(!canAnswer)}>
                  {busy ? 'در حالِ ارسال…' : canAnswer ? 'ارسالِ پاسخ' : 'ارسالِ پاسخِ تازه'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
