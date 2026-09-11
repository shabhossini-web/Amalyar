import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiUrl } from '../lib/api.js';
import { applyBrand } from '../lib/brand-palette.js';
import {
  ArrowEnd, Calendar, Camera, Caret, Chart, Check, Clock, Diagnosis, Doctor, Hospital,
  Mail, Phone, Route, Scalpel, Star, User,
} from '../ui/icons.jsx';
import './tenant-landing.css';

/**
 * صفحهٔ عمومیِ شرکت — چیزی که مراجعه‌کننده روی دامنهٔ خودِ شرکت می‌بیند.
 *
 * ⚠️ **هیچ فراخوانیِ احرازشده‌ای این‌جا نیست.** همه‌چیز از `GET /public/site`
 * می‌آید که گارد ندارد؛ tenant از Host حل می‌شود (قانونِ ۱۸). اگر روزی کسی
 * `api('/config')` را این‌جا اضافه کند، صفحه برای بازدیدکنندهٔ بی‌حساب ۴۰۱
 * می‌گیرد و بی‌سروصدا خالی می‌ماند.
 */

/* نگاشتِ کلیدِ آیکون → کامپوننت. کلیدِ ناشناخته → آیکونِ عمومی، نه صفحهٔ خطا. */
const ICONS = {
  scalpel: Scalpel, doctor: Doctor, hospital: Hospital, diagnosis: Diagnosis,
  calendar: Calendar, clock: Clock, chart: Chart, route: Route, camera: Camera,
  phone: Phone, star: Star, user: User, check: Check,
};
export const SITE_ICON_KEYS = Object.keys(ICONS);
const iconFor = (key) => ICONS[key] ?? Diagnosis;

/** ظاهرشدنِ نرمِ هر بخش هنگامِ رسیدن به دید. */
function useReveal(deps) {
  const root = useRef(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    /* کلاسِ `tl-js` قفلِ پنهان‌شدن را باز می‌کند — پیش از آن هیچ‌چیز مخفی
       نیست. پس اگر این افکت اصلاً اجرا نشود، صفحه کامل دیده می‌شود. */
    el.classList.add('tl-js');
    const nodes = el.querySelectorAll('.tl-reveal');
    /* ⚠️ نشانهٔ «ظاهر شد» یک **صفتِ data** است نه یک کلاس — و این از یک باگِ
       واقعی درآمد: کلاس را ناظر به‌صورتِ دستی می‌گذاشت، ولی `className` در
       propهای React است؛ اولین رندرِ دوباره‌ی همان گره کلاس را کامل بازنویسی
       می‌کرد و `tl-in` را می‌برد. نتیجه: کاربر روی یک پرسش می‌زد و همان
       پرسش **محو می‌شد**. React صفتی را که خودش نگذاشته دست نمی‌زند. */
    const show = (n) => n.setAttribute('data-tl-in', '');
    if (!('IntersectionObserver' in window)) {
      nodes.forEach(show);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && show(e.target)),
      { rootMargin: '0px 0px -12% 0px' },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, deps);
  return root;
}

/**
 * اسلایدرِ قبل/بعد.
 *
 * ⚠️ درصدِ برش با **مختصاتِ فیزیکی** حساب می‌شود (`clientX - rect.left`) نه
 * منطقی: در RTL جهتِ منطقی برعکس می‌شود و دسته با انگشت جابه‌جا می‌شد.
 */
function BeforeAfter({ before, after, alt }) {
  const [pct, setPct] = useState(50);
  const box = useRef(null);
  const move = useCallback((clientX) => {
    const r = box.current?.getBoundingClientRect();
    if (!r?.width) return;
    setPct(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  }, []);
  const onPointer = (e) => {
    if (e.buttons === 0 && e.type === 'pointermove') return;
    move(e.clientX);
  };
  return (
    <div
      className="tl-ba"
      ref={box}
      onPointerDown={(e) => move(e.clientX)}
      onPointerMove={onPointer}
      role="img"
      aria-label={alt}
    >
      <img src={before} alt="" />
      <div className="tl-ba-after" style={{ clipPath: `inset(0 0 0 ${pct}%)` }}>
        <img src={after} alt="" />
      </div>
      <span className="tl-ba-tag tl-before">قبل</span>
      <span className="tl-ba-tag tl-after">بعد</span>
      <div className="tl-ba-handle" style={{ left: `${pct}%` }}><i /></div>
    </div>
  );
}

function Faq({ items }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="tl-faq">
      {items.map((f, i) => (
        <div key={f.id} className={`tl-glass tl-faq-item tl-reveal${open === i ? ' tl-open' : ''}`}>
          <button type="button" className="tl-faq-q" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
            <span>{f.title}</span>
            <Caret className="tl-chev" />
          </button>
          <div className="tl-faq-a"><div><p>{f.body}</p></div></div>
        </div>
      ))}
    </div>
  );
}

export default function TenantLanding({ site }) {
  const { brand, blocks, sections, items } = site;
  const [scrolled, setScrolled] = useState(false);
  const root = useReveal([site]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const name = brand.name || brand.legalName || '';
  useEffect(() => {
    document.title = name || 'معرفی';
    const desc = (blocks.seo_description || blocks.hero_sub || '').slice(0, 300);
    let tag = document.querySelector('meta[name="description"]');
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute('name', 'description');
      document.head.appendChild(tag);
    }
    tag.setAttribute('content', desc);
  }, [name, blocks.seo_description, blocks.hero_sub]);

  const has = useMemo(() => new Set(sections.map((s) => s.key)), [sections]);
  const list = (kind) => items[kind] ?? [];

  /* واژهٔ برجستهٔ تیتر — اگر در تیتر نبود، تیتر دست‌نخورده می‌ماند. */
  const title = blocks.hero_title || '';
  const accent = (blocks.hero_title_accent || '').trim();
  const at = accent ? title.indexOf(accent) : -1;

  const marquee = (blocks.marquee_items || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const services = list('service');
  const gallery = list('gallery');
  const process = list('process');
  const doctors = list('doctor');
  const testis = list('testimonial');
  const faqs = list('faq');
  const stats = list('stat');

  return (
    <div className="tl" ref={root}>
      <div className="tl-bg" aria-hidden="true">
        <span className="tl-orb tl-o1" /><span className="tl-orb tl-o2" /><span className="tl-orb tl-o3" />
      </div>

      <header className={`tl-header${scrolled ? ' tl-scrolled' : ''}`}>
        <div className="tl-container">
          <span className="tl-logo">{name}</span>
          <nav className="tl-nav">
            {has.has('services') && services.length > 0 && <a href="#services">خدمات</a>}
            {has.has('doctors') && doctors.length > 0 && <a href="#doctors">تیمِ درمان</a>}
            {has.has('faq') && faqs.length > 0 && <a href="#faq">پرسش‌ها</a>}
            {has.has('contact') && <a href="#contact">تماس</a>}
          </nav>
          {/* ورودِ کارکنان — همان صفحه‌ای که تا دیروز ریشهٔ دامنه بود. */}
          <Link className="tl-btn tl-sm tl-ghost" to="/login">ورود</Link>
        </div>
      </header>

      <main className="tl-main">
        {has.has('hero') && (
          <section className="tl-section tl-hero">
            <div className="tl-container tl-hero-grid">
              <div>
                {blocks.hero_badge && <span className="tl-eyebrow tl-reveal"><i />{blocks.hero_badge}</span>}
                <h1 className="tl-reveal tl-d1">
                  {at >= 0 ? (<>
                    {title.slice(0, at)}
                    <span className="tl-grad-text">{accent}</span>
                    {title.slice(at + accent.length)}
                  </>) : title}
                </h1>
                <p className="tl-sub tl-reveal tl-d2">{blocks.hero_sub}</p>
                <div className="tl-cta tl-reveal tl-d3">
                  {brand.phone && blocks.hero_cta && (
                    <a className="tl-btn tl-lg" href={`tel:${brand.phone}`}><Phone />{blocks.hero_cta}</a>
                  )}
                  {blocks.hero_cta2 && <a className="tl-btn tl-lg tl-ghost" href="#contact"><Mail />{blocks.hero_cta2}</a>}
                </div>
              </div>
              <div className="tl-glass tl-hero-card tl-reveal tl-d2">
                {gallery[0]?.image && gallery[0]?.image2
                  ? <BeforeAfter before={apiUrl(gallery[0].image)} after={apiUrl(gallery[0].image2)} alt={gallery[0].title} />
                  : gallery[0]?.image
                    ? <img src={apiUrl(gallery[0].image)} alt={gallery[0].title} />
                    : <div className="tl-hero-ph"><Hospital /></div>}
              </div>
            </div>
          </section>
        )}

        {has.has('marquee') && marquee.length > 0 && (
          <div className="tl-marquee">
            {/* دو بار: حلقه باید بی‌درز باشد و انیمیشن ۵۰٪ جابه‌جا می‌کند. */}
            <div className="tl-marquee-track">
              {[...marquee, ...marquee].map((m, i) => <span key={i}><Check />{m}</span>)}
            </div>
          </div>
        )}

        {has.has('stats') && stats.length > 0 && (
          <section className="tl-section">
            <div className="tl-container tl-stats">
              {stats.map((s, i) => (
                <div key={s.id} className={`tl-glass tl-stat tl-reveal tl-d${(i % 4) + 1}`}>
                  <b>{s.title}</b>
                  <span>{s.subtitle}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {has.has('services') && services.length > 0 && (
          <section className="tl-section" id="services">
            <div className="tl-container">
              <div className="tl-head tl-reveal">
                <h2>{blocks.services_title}</h2>
                <p>{blocks.services_sub}</p>
              </div>
              <div className="tl-bento">
                {services.map((s, i) => {
                  const Ic = iconFor(s.icon);
                  return (
                    <article key={s.id} className={`tl-glass tl-svc tl-reveal tl-d${(i % 4) + 1}`}>
                      <span className="tl-svc-ic"><Ic /></span>
                      <h3>{s.title}</h3>
                      <p>{s.body}</p>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {has.has('gallery') && gallery.length > 0 && (
          <section className="tl-section" id="gallery">
            <div className="tl-container">
              <div className="tl-head tl-reveal">
                <h2>{blocks.gallery_title}</h2>
                <p>{blocks.gallery_sub}</p>
              </div>
              <div className="tl-gal">
                {gallery.map((g, i) => (
                  <figure key={g.id} className={`tl-glass tl-gal-item tl-reveal tl-d${(i % 4) + 1}`} style={{ margin: 0 }}>
                    {g.image && g.image2
                      ? <BeforeAfter before={apiUrl(g.image)} after={apiUrl(g.image2)} alt={g.title} />
                      : g.image
                        ? <img src={apiUrl(g.image)} alt={g.title} />
                        : <div className="tl-hero-ph"><Camera /></div>}
                    {g.title && <figcaption className="tl-gal-cap">{g.title}</figcaption>}
                  </figure>
                ))}
              </div>
            </div>
          </section>
        )}

        {has.has('process') && process.length > 0 && (
          <section className="tl-section" id="process">
            <div className="tl-container">
              <div className="tl-head tl-reveal">
                <h2>{blocks.process_title}</h2>
                <p>{blocks.process_sub}</p>
              </div>
              <div className="tl-timeline">
                {process.map((p, i) => (
                  <div key={p.id} className="tl-tl-item tl-reveal">
                    <span className="tl-tl-num">{i + 1}</span>
                    <div className="tl-glass tl-tl-body">
                      <h3>{p.title}</h3>
                      <p>{p.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {has.has('doctors') && doctors.length > 0 && (
          <section className="tl-section" id="doctors">
            <div className="tl-container">
              <div className="tl-head tl-reveal"><h2>{blocks.doctors_title}</h2></div>
              <div className="tl-docs">
                {doctors.map((d, i) => (
                  <article key={d.id} className={`tl-glass tl-doc tl-reveal tl-d${(i % 4) + 1}`}>
                    <div className="tl-doc-photo">
                      {d.image
                        ? <img src={apiUrl(d.image)} alt={d.title} />
                        : <span className="tl-doc-ph">{d.title.trim().charAt(0)}</span>}
                    </div>
                    <h3>{d.title}</h3>
                    {d.subtitle && <div className="tl-role">{d.subtitle}</div>}
                    <p>{d.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {has.has('testimonials') && testis.length > 0 && (
          <section className="tl-section">
            <div className="tl-container">
              <div className="tl-head tl-reveal"><h2>{blocks.testimonials_title}</h2></div>
              <div className="tl-testis">
                {testis.map((t, i) => (
                  <article key={t.id} className={`tl-glass tl-testi tl-reveal tl-d${(i % 4) + 1}`}>
                    <p>{t.body}</p>
                    <div className="tl-testi-who">
                      <span className="tl-avatar">{t.title.trim().charAt(0)}</span>
                      <span>
                        <b>{t.title}</b>
                        {t.subtitle && <small>{t.subtitle}</small>}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {has.has('faq') && faqs.length > 0 && (
          <section className="tl-section" id="faq">
            <div className="tl-container">
              <div className="tl-head tl-reveal"><h2>{blocks.faq_title}</h2></div>
              <Faq items={faqs} />
            </div>
          </section>
        )}

        {has.has('contact') && (
          <section className="tl-section" id="contact">
            <div className="tl-container">
              <div className="tl-glass tl-contact tl-reveal">
                <h2>{blocks.contact_title}</h2>
                <p>{blocks.contact_sub}</p>
                <div className="tl-contact-rows">
                  {brand.phone && <a href={`tel:${brand.phone}`}><Phone /><b dir="ltr">{brand.phone}</b></a>}
                  {brand.address && <span><Hospital />{brand.address}</span>}
                </div>
                {brand.phone && (
                  <a className="tl-btn tl-lg" href={`tel:${brand.phone}`}>{blocks.hero_cta}<ArrowEnd /></a>
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="tl-footer">
        <div className="tl-container tl-footer-in">
          <p>{brand.legalName || name}</p>
          <Link to="/login">ورودِ کارکنان</Link>
        </div>
      </footer>
    </div>
  );
}

/**
 * بارگذارِ صفحهٔ عمومی.
 *
 * ⚠️ سه حالتِ متفاوت که نباید یکی شوند:
 *   • در حالِ خواندن  → هیچ‌چیز (نه صفحهٔ ورود، نه صفحهٔ خالی) — پرشِ لحظه‌ایِ
 *     لندینگ↔ورود بدتر از یک لحظه سکوت است.
 *   • سایت خاموش/خطا → `fallback` (رفتنِ ریشهٔ دامنه به فرمِ ورود، مثلِ قبل).
 *   • سایت روشن      → خودِ صفحه.
 */
export function TenantSite({ fallback }) {
  const [state, setState] = useState({ loading: true, site: null });

  useEffect(() => {
    let alive = true;
    api('/public/site', { auth: false })
      .then((site) => {
        if (!alive) return;
        /* رنگِ برند پیش از اولین رنگ‌آمیزی می‌نشیند — همان دلیلِ `ConfigProvider`. */
        if (site?.brand?.color) applyBrand(site.brand.color);
        setState({ loading: false, site: site?.enabled ? site : null });
      })
      .catch(() => alive && setState({ loading: false, site: null }));
    return () => { alive = false; };
  }, []);

  if (state.loading) return null;
  if (!state.site) return fallback;
  return <TenantLanding site={state.site} />;
}
