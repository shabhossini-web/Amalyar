import { BRAND, NAV_LINKS } from '../data.jsx';
import { Pulse } from './icons.jsx';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="brandline">
          <Pulse size={17} strokeWidth={2.2} />
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
