import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BRAND, NAV_LINKS } from '../data.jsx';
import { Pulse, Menu } from './icons.jsx';

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <div className="nav-wrap">
        <nav className={`nav${scrolled ? ' scrolled' : ''}`} aria-label="ناوبری اصلی">
          <a className="nav-logo" href="#top" aria-label={`${BRAND.name} — صفحهٔ اصلی`}>
            <span className="mark" aria-hidden="true"><Pulse size={19} strokeWidth={2.3} /></span>
            <span>عمل<span className="grad-text">‌یار</span></span>
          </a>

          <div className="nav-center">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href}>{l.label}</a>
            ))}
          </div>

          <div className="nav-right">
            <a className="nav-cta" href="#contact">درخواست دمو</a>
            <button
              className="nav-burger"
              aria-label="باز/بستن منو"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <Menu size={24} strokeWidth={2} />
            </button>
          </div>
        </nav>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="mobile-menu"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.22 }}
          >
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</a>
            ))}
            <a href="#contact" onClick={() => setOpen(false)}>درخواست دمو</a>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
