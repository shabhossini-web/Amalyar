import { BRAND, NAV_LINKS } from '../data.jsx';
import Mark from './Mark.jsx';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="brandline">
          <Mark style={{ width: 38, color: 'var(--text2)' }} />
          عمل‌یار
        </div>
        <div className="row">
          {NAV_LINKS.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
          <a href={`tel:${BRAND.phoneTel}`}>تماس</a>
        </div>
        <p>© ۱۴۰۵ عمل‌یار — نرم‌افزار مدیریت شرکت‌های خدمات و تجهیزات جراحی</p>
      </div>
    </footer>
  );
}
