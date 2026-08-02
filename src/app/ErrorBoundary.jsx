import { Component } from 'react';
import { Alert } from '../ui/icons.jsx';

/**
 * مرزِ خطای سراسری — هر کرشِ render به‌جای صفحهٔ سفیدِ PWA،
 * پیامِ فارسی + دکمهٔ «تلاش دوباره» نشان می‌دهد.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // برای دیباگِ ریموت در کنسول بماند
    console.error('amalyar crash:', error, info?.componentStack);
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
        <button
          onClick={() => { this.setState({ error: null }); window.location.replace('/app'); }}
          style={{
            fontFamily: 'inherit', fontSize: 14, fontWeight: 800, color: '#fff', cursor: 'pointer',
            background: 'linear-gradient(135deg,#a855f7,#4c1d95)', border: 'none',
            borderRadius: 12, padding: '12px 28px',
          }}
        >
          تلاش دوباره
        </button>
      </div>
    );
  }
}
