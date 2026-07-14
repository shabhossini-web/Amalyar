import { PLANS } from '../data.jsx';
import { Check, XMark } from './icons.jsx';
import Reveal from './Reveal.jsx';

function Plan({ p, i }) {
  return (
    <Reveal className={`plan${p.hot ? ' hot' : ''}`} delay={i * 0.08}>
      {p.flag && <div className="plan-flag">{p.flag}</div>}
      <h3>{p.name}</h3>
      <div className="for">{p.for}</div>
      <div className="price">
        {p.priceLead && `${p.priceLead} `}<b>{p.price}</b>{p.priceUnit && ` ${p.priceUnit}`}
      </div>
      <div className="per">{p.per}</div>
      <ul>
        {p.items.map((it, k) => (
          <li key={k} className={it.ok ? '' : 'no'}>
            <span className="ic">{it.ok ? <Check size={15} /> : <XMark size={15} />}</span>
            {it.t}
          </li>
        ))}
      </ul>
      <a className={`cta ${p.ctaStyle}`} href="#contact">{p.cta}</a>
    </Reveal>
  );
}

export default function Pricing() {
  return (
    <section className="section" id="pricing">
      <div className="container">
        <Reveal as="h2" className="section-title">
          تعرفه‌ای که با <span className="grad-text">یک عمل</span> جبران می‌شود
        </Reveal>
        <Reveal as="p" className="section-sub" delay={0.05}>
          هزینهٔ سالانهٔ پلتفرم حدودِ درآمدِ یک تا دو کیسِ شماست — در عوض، هیچ فیشِ جعلی، سهمِ
          گم‌شده و حضورِ صوری‌ای از دستت در نمی‌رود.
        </Reveal>

        <div className="plans">
          {PLANS.map((p, i) => <Plan key={i} p={p} i={i} />)}
        </div>

        <p className="pricing-note">
          پرداختِ سالانه شامل ۲ ماه تخفیف است · قیمت‌ها بدونِ هزینهٔ APIِ هوش مصنوعی (با کلیدِ
          خودتان) · دورهٔ پایلوتِ ۱ ماهه با نصفِ قیمت
        </p>
      </div>
    </section>
  );
}
