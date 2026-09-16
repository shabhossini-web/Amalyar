import Background from '../components/Background.jsx';
import Nav from '../components/Nav.jsx';
import Hero from '../components/Hero.jsx';
import Marquee from '../components/Marquee.jsx';
import Features from '../components/Features.jsx';
import Stats from '../components/Stats.jsx';
import Pricing from '../components/Pricing.jsx';
import Faq from '../components/Faq.jsx';
import CTA from '../components/CTA.jsx';
import Footer from '../components/Footer.jsx';

export default function Landing() {
  /* ⚠️ لفافِ `theme-dark`: لندینگ ویترینِ محصول است و باید در هر تمی همان
     شیشه و نئونِ طراحی‌شده را نشان دهد (§۴.۸). کاربری که در اپ تمِ روشن را
     انتخاب کرده و «بازگشت به صفحهٔ نخست» می‌زند نباید لندینگِ سفیدِ نیم‌کاره ببیند. */
  return (
    <div className="theme-dark">
      <Background />
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Features />
        <Stats />
        <Pricing />
        <Faq />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
