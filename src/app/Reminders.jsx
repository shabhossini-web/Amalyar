import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import { faDate } from '../lib/jalali.js';
import './reminders.css';
import { Alert, Send } from '../ui/icons.jsx';
import PageHeader from '../ui/PageHeader.jsx';
import { useStagger } from '../ui/stagger.js';
import { useStatusMap } from './config.jsx';

/* ⚠️ «رسیدن به گوشی» **خانوادهٔ جداست** و در سرور همتا ندارد: وضعیتِ یادآوری
   می‌گوید ما چه کردیم، این می‌گوید اپراتور چه گزارش داد. تنها مصرف‌کننده‌اش
   همین صفحه است، پس این‌جا می‌ماند. */
const DELIVERY_FA = { unknown: 'رسیدن به گوشی هنوز تأیید نشده', delivered: 'رسیده به گوشی', not_delivered: 'نرسیده به گوشی', not_sent: 'ارسال نشده', stored: 'در پیام‌رسان ثبت شده؛ هنوز خوانده نشده', read: 'خوانده شده' };
/* ⚠️ کلیدِ خام هرگز روی صفحه نمی‌آید (W0.2): `follow_up` ماه‌ها به‌شکلِ «follow_up»
   دیده می‌شد چون این نگاشت جا مانده بود. حالا نگاشت از `/config` می‌آید (نوعِ
   تازهٔ سرور خودبه‌خود فارسی می‌شود) و اگر کلیدی نبود، برچسبِ عام + خودِ کلید
   در title — تا نه دروغ بگوید نه کد نشان دهد.
   و نسخهٔ قبلیِ همین‌جا `cancelled` را نداشت: یادآوریِ لغوشده «وضعیتِ نامشخص»
   می‌شد، در حالی که پاپ‌آپش در پروندهٔ همان بیمار «لغو شد» می‌گفت. */
/* اقدامِ تک‌ردیفی (W0.7/U10) — همان فهرستی که سرور هم گارد می‌کند.
   ⚠️ `sent` در هیچ‌کدام نیست: پیام واقعاً به گوشیِ بیمار رفته، پس «دوباره»
   یعنی پیامکِ دومِ سردرگم‌کننده و «لغو» یعنی دفتر دربارهٔ چیزی که رخ داده
   دروغ بگوید. `sending` هم نیست چون همین حالا دستِ سرور است. */
const RETRYABLE = ['failed', 'uncertain', 'simulated'];
const CANCELLABLE = ['pending', 'uncertain', 'failed'];
/* هشدار: جمعِ تب‌ها باید با «همه» بخواند (بازبینیِ UX، clinic-daily-17): «آزمایشی — ارسال نشده» تبِ
   خودش را نداشت و «همه ۱۵» در برابرِ جمعِ ۸ بقیه می‌ایستاد؛ «در حالِ ارسال» هم جزوِ «در صف» است. */
const TABS = [
  { key: 'all', label: 'همه' },
  { key: 'pending', label: 'در صف', has: ['pending', 'sending'] },
  { key: 'sent', label: 'رفته' },
  { key: 'failed', label: 'نرفته' },
  { key: 'uncertain', label: 'نامشخص' },
  { key: 'simulated', label: 'آزمایشی' },
];
const inTab = (r, key) => key === 'all' || (TABS.find((x) => x.key === key)?.has ?? [key]).includes(r.status);
/* متنِ پیامک دو خط، با «بیشتر» — کارتِ هر پیام متنِ کاملِ پیامک را داشت و صفحه ۲۶۰۰ پیکسل می‌شد. */
const LONG_TEXT = 110;

/**
 * دفترِ یادآوری‌ها — چه پیامی، به چه کسی، کی می‌رود / رفت / نرفت.
 * workerِ سراسری هر چند دقیقه سررسیده‌ها را می‌فرستد؛ «همین حالا بفرست»
 * برای مدیری است که نمی‌خواهد منتظرِ چرخهٔ بعدی بماند.
 */
export default function Reminders() {
  /* ⚠️ **برچسب از خودِ ردیف** (`r.kindFa`/`r.statusFa`)، و کاتالوگ فقط
     پشتیبان. نسخهٔ اولِ این تغییر فقط `/config` را می‌خواند و یک مسابقه
     ساخت: صفحه پیش از رسیدنِ پیکربندی رندر می‌شود، پس هر ردیف یک لحظه
     برچسبِ عامِ «یادآوری» می‌گرفت (و اگر `/config` نمی‌آمد، برای همیشه). */
  const kindMap = useStatusMap('reminderKind');
  const statusMap = useStatusMap('reminder');
  const kindFa = (r) => r?.kindFa ?? kindMap[r?.kind] ?? 'یادآوری';
  const statusFa = (st) => statusMap[st] ?? 'وضعیتِ نامشخص';
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [tab, setTab] = useState('all');
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const row = useStagger();

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setErr('');
    try { setRows(await api('/reminders')); }
    catch (e) { setErr(e.message); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const sweep = async () => {
    setBusy(true);
    try {
      const r = await api('/reminders/sweep', { method: 'POST' });
      setToast(r.due ? `${Number(r.sent).toLocaleString('fa-IR')} پیام فرستاده شد` : 'چیزی سررسید نشده');
      await load();
    } catch (e) { setToast(e.message); } finally { setBusy(false); }
  };

  /**
   * ⚠️ `rowBusy` به‌ازای **هر ردیف** است، نه یک `busy`ِ مشترک: با فلگِ مشترک
   * کلیک روی یک ردیف همهٔ دکمه‌های صفحه را خاکستری می‌کرد و کاربر نمی‌فهمید
   * کدام کار در جریان است.
   */
  const [rowBusy, setRowBusy] = useState(0);
  /* هشدار: «لغوِ این پیام» **می‌پرسد** (بازبینیِ UX، clinic-daily-15 / company-10): با یک لمس یادآوریِ
     مراقبتِ بیمار لغو می‌شد، بی‌پرسش و بی‌برگشت — و روی گوشی دکمه درست زیرِ متنِ پیام است. پرسش
     همان‌جا روی ردیف باز می‌شود، با نامِ بیمار و پیامد؛ فوکوس روی «نگه‌داشتن». */
  const [askCancel, setAskCancel] = useState(0);
  const act = async (r, what) => {
    setAskCancel(0);
    setRowBusy(r.id);
    try {
      const fresh = await api(`/reminders/${r.id}/${what}`, { method: 'POST' });
      /* ارسالِ دوباره همان لحظه امتحان می‌شود؛ اگر باز رد شد «در صف نشست» گمراه‌کننده است.
         ردِ ملی‌پیامک خودش چند دقیقهٔ بعد دوباره امتحان می‌شود و علتِ کامل زیرِ خودِ ردیف
         می‌آید — جایش توستِ دوثانیه‌ای نیست. */
      setToast(what === 'retry'
        ? (fresh?.status === 'sent' ? 'فرستاده شد'
          : fresh?.status === 'failed' ? 'باز هم نرفت — علتش زیرِ همان ردیف آمده است'
          : fresh?.error ? 'این بار نرفت — خودش چند دقیقهٔ دیگر دوباره امتحان می‌کند'
          : `دوباره در صف نشست (${fresh?.statusFa ?? statusFa(fresh?.status)})`)
        : 'یادآوری لغو شد — دیگر فرستاده نمی‌شود');
      await load();
    } catch (e) { setToast(e.message); } finally { setRowBusy(0); }
  };

  const shown = (rows ?? []).filter((r) => inTab(r, tab));
  const count = (k) => (rows ?? []).filter((r) => inTab(r, k)).length;
  const [openText, setOpenText] = useState(() => new Set());
  const toggleText = (id) => setOpenText((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="rm">
      <div className="rm-bg" aria-hidden="true" />
      {/* `rm-head` فقط قلابِ آزمون است؛ ظاهر از `PageHeader`. */}
      <PageHeader className="rm-head" tool="reminders" sub="پیام‌های بیماران و ابلاغ کارشناسان؛ پیامک و ربات اطلاع‌رسانی. پذیرش پیامک توسط سرویس به معنی رسیدن آن به گوشی نیست." />

      {err && <div className="rm-err"><Alert width="15" height="15" /> {err}</div>}

      <div className="rm-bar">
        <nav className="rm-tabs" role="radiogroup" aria-label="وضعیت">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="radio" aria-checked={tab === t.key}
                    className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
              {t.label}<i>{count(t.key).toLocaleString('fa-IR')}</i>
            </button>
          ))}
        </nav>
        {(user?.level ?? 0) >= 6 && (
          <button type="button" className="rm-sweep" disabled={busy} onClick={sweep}>
            <Send width="14" height="14" /> ارسالِ سررسیده‌ها
          </button>
        )}
      </div>

      {/* پیامِ آزمایشی به بیمار نرفته است — نباید در میانِ «رفته»ها گم شود. */}
      {count('simulated') > 0 && tab !== 'simulated' && (
        <p className="rm-warn" role="note">
          <Alert width="14" height="14" aria-hidden="true" /> {count('simulated').toLocaleString('fa-IR')} پیام «آزمایشی» است و به گوشیِ بیمار نرفته.{' '}
          <button type="button" onClick={() => setTab('simulated')}>دیدنِ آن‌ها</button>
        </p>
      )}

      {rows === null && !err && <div className="rm-empty">در حال بارگذاری…</div>}
      {rows !== null && shown.length === 0 && (
        <div className="rm-empty">در این وضعیت یادآوری‌ای نیست</div>
      )}

      <div className="rm-list">
        {shown.map((r, i) => (
          <motion.article key={r.id} {...row(i)} className={`rm-row st-${r.status}`}>
            <div className="rm-row-head">
              <b title={r.kind}>{kindFa(r)}</b>
              {r.patientName && <span>{r.patientName}</span>}
              {r.recipientName && <span>{r.recipientName}</span>}
              <span>{r.channel === 'chat' ? 'پیام‌رسان داخلی' : 'پیامک'}</span>
              {r.visitCode && <em dir="ltr">{r.visitCode}</em>}
              {/* «امروز / عقب‌افتاده» از سرور (`dueState`) — کارِ امروز در یک نگاه (clinic-daily-17). */}
              {r.dueState === 'overdue' && <span className="rm-due late">عقب‌افتاده</span>}
              {r.dueState === 'today' && <span className="rm-due today">امروز</span>}
              <small>
                {r.status === 'pending' ? `موعد: ${faDate(r.dueAt)}` : faDate(r.sentAt ?? r.dueAt)}
                {r.phone ? ` · ${String(r.phone).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])}` : ''}
              </small>
              <i className={`rm-tag s-${r.status}`} title={r.status}>{r.statusFa ?? statusFa(r.status)}</i>
            </div>
            {(() => {
              const long = (r.text ?? '').length > LONG_TEXT || (r.text ?? '').split('\n').length > 2;
              const open = openText.has(r.id);
              return (
                <>
                  <p className={`rm-text${long && !open ? ' clamp' : ''}`} id={`rm-text-${r.id}`}>{r.text}</p>
                  {long && (
                    <button type="button" className="rm-more" aria-expanded={open} aria-controls={`rm-text-${r.id}`}
                            onClick={() => toggleText(r.id)}>
                      {open ? 'کمتر' : 'بیشتر'}
                    </button>
                  )}
                </>
              );
            })()}
            {r.status === 'sent' && <p>{DELIVERY_FA[r.deliveryStatus ?? 'unknown'] ?? 'وضعیت تحویل نامشخص'}{r.providerId && <small> · شناسه پیگیری: <span dir="ltr">{r.providerId}</span></small>}</p>}
            {r.error && <p className="rm-fail">علت: {r.error}</p>}
            {/* «کدام کلمه؟» — حدسِ سرور از پیام‌های رفتهٔ همین مطب (`filterHint`، قانونِ ۱۵) + راهِ اصلاح. */}
            {r.filterHint && (
              <div className="rm-filter" role="note">
                {r.filterHint.words?.length > 0 && (
                  <p>
                    کلمهٔ احتمالی:{' '}
                    {r.filterHint.words.map((w, k) => <b key={k}>«{w}»</b>)}
                    <small> — در هیچ پیامِ رفتهٔ این مطب نبوده؛ حدس است، نه قطعی</small>
                  </p>
                )}
                <p>{r.filterHint.how}</p>
              </div>
            )}
            {(RETRYABLE.includes(r.status) || CANCELLABLE.includes(r.status)) && (
              <div className="rm-acts">
                {RETRYABLE.includes(r.status) && (
                  <button type="button" className="rm-act" disabled={rowBusy === r.id}
                          onClick={() => act(r, 'retry')}>
                    <Send width="13" height="13" /> ارسالِ دوباره
                  </button>
                )}
                {CANCELLABLE.includes(r.status) && askCancel !== r.id && (
                  <button type="button" className="rm-act rm-act-off" disabled={rowBusy === r.id}
                          onClick={() => setAskCancel(r.id)}>
                    لغوِ این پیام
                  </button>
                )}
              </div>
            )}
            {askCancel === r.id && (
              <div className="rm-ask" role="group" aria-label="تأییدِ لغوِ یادآوری">
                <p>
                  یادآوریِ «{kindFa(r)}»{(r.patientName || r.recipientName) ? ` برای ${r.patientName || r.recipientName}` : ''} لغو
                  شود؟ این پیام دیگر فرستاده نمی‌شود و برگشت ندارد.
                </p>
                <div>
                  <button type="button" className="rm-act rm-ask-yes" disabled={rowBusy === r.id} onClick={() => act(r, 'cancel')}>
                    لغوِ یادآوری
                  </button>
                  {/* فوکوس روی گزینهٔ امن، همان لحظه که پرسش باز شد. */}
                  <button type="button" className="rm-act" autoFocus onClick={() => setAskCancel(0)}>نگه‌داشتن</button>
                </div>
              </div>
            )}
          </motion.article>
        ))}
      </div>

      {/* توست برای صفحه‌خوان هم اعلام می‌شود (company-10). */}
      <div className={`rm-toast${toast ? ' on' : ''}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}
