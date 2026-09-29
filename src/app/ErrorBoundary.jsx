import { Component } from 'react';
import { Alert, Check, Phone, Refresh } from '../ui/icons.jsx';
import { fetchFace, lastFace } from '../lib/public-face.js';

/// در build تزریق می‌شود (vite `define`)؛ در dev تعریف نشده است.
const BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/**
 * صفحه‌های **بی‌احرازِ بیمار** — ثبت‌نام، فرم، نظرسنجی، خلاصه، پرونده، سفارش.
 * ⚠️ بیمار حسابی ندارد؛ «تلاشِ دوباره» برای او یعنی **همین نشانی** (بازبینیِ UX، بندِ ۱۰۱).
 */
const isPatientPath = (path) => /^\/(r|f|s|v|p|o)\//.test(path);

/**
 * شکستِ بارگذاریِ یک چانک (اینترنتِ کند، یا دیپلویی که چانکِ قدیمی را برداشته) — در کروم، فایرفاکس و
 * سافاری سه متنِ متفاوت دارد.
 */
const CHUNK_FAIL = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\w-]+ failed|ChunkLoadError/i;

/* یک‌بار بارگذاریِ خودکار برای هر نشانی در هر ۳۰ ثانیه — وگرنه چانکِ واقعاً گم‌شده حلقهٔ بی‌پایانِ
   reload می‌ساخت. `sessionStorage` ممکن است پرتاب کند (حالتِ ناشناس) — آن‌وقت فقط دکمه می‌ماند. */
const RELOAD_KEY = 'amalyar_chunk_reload';
function reloadOnce() {
  try {
    const last = JSON.parse(sessionStorage.getItem(RELOAD_KEY) || 'null');
    if (last && last.path === window.location.pathname && Date.now() - last.at < 30_000) return false;
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ path: window.location.pathname, at: Date.now() }));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

const telHref = (phone) => `tel:${String(phone ?? '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^0-9+]/g, '')}`;
const faDigits = (t) => String(t ?? '').replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/**
 * مرزِ خطای سراسری — هر کرشِ render به‌جای صفحهٔ سفیدِ PWA،
 * پیامِ فارسی + دکمهٔ «تلاش دوباره» نشان می‌دهد.
 *
 * ⚠️ **متنِ واقعیِ خطا و شمارهٔ نسخه هم نشان داده می‌شوند.** نسخهٔ اول فقط
 * «خطای غیرمنتظره‌ای رخ داد» می‌گفت و پیام را در کنسول دفن می‌کرد — روی
 * گوشیِ کاربر عملاً یعنی هیچ. وقتی صفحهٔ «مدیریت کاربران» روی نصبِ مشتری
 * ترکید، از اسکرین‌شات هیچ نمی‌شد فهمید؛ علت (`STATUS_FA`/`faDate` تعریف‌نشده)
 * فقط با بازتولیدِ محلی پیدا شد و برای بازتولید هم باید حدس می‌زدیم داده باید
 * چه شکلی باشد.
 *
 * ⚠️ شمارهٔ نسخه به همان اندازه مهم است: پرتکرارترین سؤال بعد از هر رفعِ باگ
 * این است که «نسخهٔ تازه رسیده یا هنوز کشِ قدیمی؟». حالا یک عکس جواب می‌دهد.
 *
 * ⚠️ جزئیات پیش‌فرض **بسته** است — کاربرِ عادی نباید با stack روبه‌رو شود —
 * ولی یک کلیک تا باز شدن و یک کلیک تا کپی فاصله دارد.
 *
 * ⚠️ **دو مخاطب، دو متن** (بازبینیِ UX، بندِ ۱۰۱): روی صفحهٔ بیمار، «از خروج از همهٔ حساب‌ها و
 * ورودِ دوباره استفاده کنید» و «تلاشِ دوباره» ← `/app` یعنی بیمارِ بی‌حساب به ورودِ کارکنان
 * می‌رفت و چون `replace` بود لینکِ فرمش هم گم می‌شد. حالا بیمار همان نشانی را دوباره بار می‌کند،
 * تلفنِ مطب را می‌بیند، و شکستِ دانلودِ چانک یک‌بار خودکار جبران می‌شود.
 *
 * رنگ‌ها از توکن‌های تم‌اند (قانونِ ۲۳): صفحهٔ خطای مطبِ روشن تیرهٔ ثابت نبود که بشکند.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, copied: false, stack: '', face: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // برای دیباگِ ریموت در کنسول بماند
    console.error('amalyar crash:', error, info?.componentStack);
    this.setState({ stack: info?.componentStack ?? '' });
    if (!isPatientPath(window.location.pathname)) return;
    /* چانکِ جاماندهٔ صفحهٔ بیمار: یک‌بار خودکار دوباره، بی‌آنکه بیمار چیزی ببیند. */
    if (CHUNK_FAIL.test(`${error?.name ?? ''} ${error?.message ?? ''}`) && reloadOnce()) return;
    /* تلفنِ مطب: از داده‌ای که همین صفحه پیش از کرش گرفته، وگرنه یک تلاشِ کوتاه (شکستش بی‌صداست). */
    const known = lastFace();
    if (known) this.setState({ face: known });
    else fetchFace().then((f) => { if (f) this.setState({ face: f }); });
  }

  /**
   * متنی که کاربر کپی می‌کند و برای ما می‌فرستد.
   *
   * ⚠️ عمداً **نشانیِ صفحه و نسخه** هم داخلش هست: بدونِ این دو، پیامِ خطا
   * نصفِ ماجراست — نه معلوم است کجا افتاده، نه روی کدام باندل.
   */
  report() {
    const e = this.state.error;
    return [
      `نسخه: ${BUILD}`,
      `صفحه: ${window.location.pathname}`,
      `خطا: ${e?.name ?? 'Error'}: ${e?.message ?? String(e)}`,
      this.state.stack ? `\n${this.state.stack.trim().split('\n').slice(0, 6).join('\n')}` : '',
    ].filter(Boolean).join('\n');
  }

  render() {
    if (!this.state.error) return this.props.children;
    const patient = isPatientPath(window.location.pathname);
    const brand = this.state.face?.brand;
    const btn = {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46,
      fontFamily: 'inherit', fontSize: 15, fontWeight: 800, cursor: 'pointer', borderRadius: 999,
      padding: '11px 24px', textDecoration: 'none',
    };
    return (
      <div
        dir="rtl"
        role="alert"
        style={{
          minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center',
          background: 'var(--bg)', color: 'var(--text1)', fontFamily: "'Vazirmatn', system-ui, sans-serif",
        }}
      >
        <div aria-hidden="true" style={{ color: 'var(--amber-text)' }}><Alert width={40} height={40} strokeWidth={1.6} /></div>
        <b style={{ fontSize: 18 }}>{patient ? 'صفحه کامل باز نشد' : 'مشکلی پیش آمد'}</b>
        <p style={{ fontSize: patient ? 15 : 13, color: 'var(--text2)', maxWidth: 320, lineHeight: 1.9, margin: 0 }}>
          {patient
            ? 'اتصال ضعیف بود؛ دوباره تلاش کنید. اطلاعاتِ ذخیره‌شدهٔ شما سرِ جایش است.'
            : 'خطای غیرمنتظره‌ای رخ داد. اگر تکرار شد، از «خروج از همهٔ حساب‌ها» و ورودِ دوباره استفاده کنید.'}
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => {
              /* بیمار: همین نشانی (لینکِ فرمش گم نشود). کارکنان: خانهٔ اپ، مثلِ قبل. */
              if (patient) { window.location.reload(); return; }
              this.setState({ error: null });
              window.location.replace('/app');
            }}
            style={{ ...btn, color: '#fff', border: 'none', background: 'linear-gradient(135deg,var(--brand-2),var(--brand-dark))' }}
          >
            <Refresh width={17} height={17} aria-hidden="true" /> تلاشِ دوباره
          </button>
          {patient && brand?.phone && (
            <a
              href={telHref(brand.phone)}
              style={{ ...btn, color: 'var(--brand-text)', background: 'rgba(var(--brand-rgb), .08)', border: '1px solid rgba(var(--brand-2-rgb), .45)' }}
            >
              <Phone width={17} height={17} aria-hidden="true" />
              {brand.name ? `تماس با ${brand.name}` : 'تماس'}
              <bdi dir="ltr">{faDigits(brand.phone)}</bdi>
            </a>
          )}
        </div>

        <details style={{ maxWidth: 340, width: '100%', textAlign: 'start' }}>
          <summary style={{ fontSize: 12.5, color: 'var(--text3)', cursor: 'pointer', listStyle: 'none' }}>
            جزئیاتِ فنی (برای گزارشِ خطا)
          </summary>
          {/* ⚠️ هر خط `dir="auto"` جدا دارد، نه یک بلوکِ `dir="ltr"`: برچسب
              فارسی است و مقدار لاتین، و در یک بلوکِ تک‌جهته الگوریتمِ دوجهتهٔ
              یونیکد «نسخه:» را به انتهای خط پرت می‌کرد. با جهتِ خودکارِ
              هر خط، هر کدام بر پایهٔ اولین حرفِ خودش تصمیم می‌گیرد. */}
          <div
            style={{
              marginTop: 8, padding: 10, borderRadius: 10, background: 'rgba(var(--veil-rgb), .05)',
              border: '1px solid rgba(var(--veil-rgb), .1)', color: 'var(--text2)', fontSize: 11,
              lineHeight: 1.8, maxHeight: 220, overflow: 'auto',
              fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
            }}
          >
            {this.report().split('\n').map((line, i) => (
              <div key={i} dir="auto" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {line || ' '}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(this.report()).then(
              () => this.setState({ copied: true }),
              () => {},
            )}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text2)', cursor: 'pointer', marginTop: 8,
              background: 'transparent', border: '1px solid rgba(var(--veil-rgb), .16)',
              borderRadius: 9, padding: '8px 14px', minHeight: 40,
            }}
          >
            {this.state.copied ? <><Check width={14} height={14} aria-hidden="true" /> کپی شد</> : 'کپیِ متنِ خطا'}
          </button>
        </details>

        <small style={{ fontSize: 12, color: 'var(--text3)' }}>نسخهٔ <bdi dir="ltr">{BUILD}</bdi></small>
      </div>
    );
  }
}
