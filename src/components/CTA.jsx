import { BRAND } from '../data.jsx';
import { Phone, Whatsapp } from './icons.jsx';
import Reveal from './Reveal.jsx';

export default function CTA() {
  return (
    <section className="cta-final" id="contact">
      <Reveal className="cta-box">
        <h2>یک دموی ۲۰ دقیقه‌ای،<br />با <span className="grad-text">دادهٔ واقعیِ خودت</span></h2>
        <p>در جلسهٔ دمو، جریانِ کاملِ یک کیسِ واقعی را از ثبت‌نامِ بیمار تا تسویهٔ شرکا با هم جلو می‌بریم — بدونِ تعهد.</p>
        <div className="hero-ctas">
          <a className="btn-primary" href={`tel:${BRAND.phoneTel}`}>
            <Phone size={17} strokeWidth={2} />
            تماس: {BRAND.phoneFa}
          </a>
          <a className="btn-ghost" href={BRAND.whatsapp} target="_blank" rel="noopener">
            <Whatsapp size={17} />
            پیام در واتساپ
          </a>
        </div>
      </Reveal>
    </section>
  );
}
