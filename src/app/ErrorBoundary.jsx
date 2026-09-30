import { Component } from 'react';
import { Alert } from '../ui/icons.jsx';

/// در build تزریق می‌شود (vite `define`)؛ در dev تعریف نشده است.
const BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

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
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, copied: false, stack: '' };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // برای دیباگِ ریموت در کنسول بماند
    console.error('amalyar crash:', error, info?.componentStack);
    this.setState({ stack: info?.componentStack ?? '' });
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
    return (
      <div
        dir="rtl"
        style={{
          minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center',
          background: '#0b0620', color: '#f2f0fc', fontFamily: "'Vazirmatn', system-ui, sans-serif",
        }}
      >
        <div aria-hidden="true"><Alert size={40} strokeWidth={1.6} /></div>
        <b style={{ fontSize: 17 }}>مشکلی پیش آمد</b>
        <p style={{ fontSize: 13, color: '#b7b0d8', maxWidth: 300, lineHeight: 1.9 }}>
          خطای غیرمنتظره‌ای رخ داد. اگر تکرار شد، از «خروج از همهٔ حساب‌ها» و ورودِ دوباره استفاده کنید.
        </p>

        <details style={{ maxWidth: 340, width: '100%', textAlign: 'start' }}>
          <summary style={{ fontSize: 12, color: '#8f88b5', cursor: 'pointer', listStyle: 'none' }}>
            جزئیاتِ فنی (برای گزارشِ خطا)
          </summary>
          {/* ⚠️ هر خط `dir="auto"` جدا دارد، نه یک بلوکِ `dir="ltr"`: برچسب
              فارسی است و مقدار لاتین، و در یک بلوکِ تک‌جهته الگوریتمِ دوجهتهٔ
              یونیکد «نسخه:» را به انتهای خط پرت می‌کرد. با جهتِ خودکارِ
              هر خط، هر کدام بر پایهٔ اولین حرفِ خودش تصمیم می‌گیرد. */}
          <div
            style={{
              marginTop: 8, padding: 10, borderRadius: 10, background: 'rgba(255,255,255,.05)',
              border: '1px solid rgba(255,255,255,.09)', color: '#cfc9ea', fontSize: 11,
              lineHeight: 1.8, maxHeight: 220, overflow: 'auto',
              fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
            }}
          >
            {this.report().split('\n').map((line, i) => (
              <div key={i} dir="auto" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {line || '\u00a0'}
              </div>
            ))}
          </div>
          <button
            onClick={() => navigator.clipboard?.writeText(this.report()).then(
              () => this.setState({ copied: true }),
              () => {},
            )}
            style={{
              fontFamily: 'inherit', fontSize: 12, color: '#b7b0d8', cursor: 'pointer', marginTop: 8,
              background: 'transparent', border: '1px solid rgba(255,255,255,.16)',
              borderRadius: 9, padding: '6px 14px',
            }}
          >
            {this.state.copied ? 'کپی شد' : 'کپیِ متنِ خطا'}
          </button>
        </details>

        <small style={{ fontSize: 11, color: '#6f679a' }} dir="ltr">نسخهٔ {BUILD}</small>
        <button
          onClick={() => { this.setState({ error: null }); window.location.replace('/app'); }}
          style={{
            fontFamily: 'inherit', fontSize: 14, fontWeight: 800, color: '#fff', cursor: 'pointer',
            background: 'linear-gradient(135deg,var(--brand-2),var(--brand-dark))', border: 'none',
            borderRadius: 12, padding: '12px 28px',
          }}
        >
          تلاش دوباره
        </button>
      </div>
    );
  }
}
