import { FEATURES } from '../data.jsx';
import Reveal from './Reveal.jsx';

function Card({ f, i }) {
  const Icon = f.icon;
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  return (
    <Reveal
      className={`bento-card${f.wide ? ' wide' : ''}`}
      delay={(i % 3) * 0.08}
      onMouseMove={onMove}
    >
      {f.tag && <span className="bento-tag">{f.tag}</span>}
      <div className="bento-ico"><Icon size={24} /></div>
      <h3>{f.title}</h3>
      <p>{f.body}</p>
    </Reveal>
  );
}

export default function Features() {
  return (
    <section className="section" id="features">
      <div className="container">
        <Reveal as="h2" className="section-title">
          هر ماژولی که عملیاتت لازم دارد،<br />
          <span className="grad-text">از قبل به هم وصل است</span>
        </Reveal>
        <Reveal as="p" className="section-sub" delay={0.05}>
          به‌جای پنج نرم‌افزارِ جدا و اکسل‌های پراکنده، یک پلتفرمِ یکپارچه که برای جریانِ واقعیِ
          کارِ شرکت‌های خدمات جراحی طراحی شده.
        </Reveal>

        <div className="bento">
          {FEATURES.map((f, i) => <Card key={i} f={f} i={i} />)}
        </div>
      </div>
    </section>
  );
}
