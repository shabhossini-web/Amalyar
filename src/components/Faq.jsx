import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FAQS } from '../data.jsx';
import { Chevron } from './icons.jsx';
import Reveal from './Reveal.jsx';

function Item({ f, open, onToggle }) {
  return (
    <div className={`faq-item${open ? ' open' : ''}`}>
      <button className="faq-q" aria-expanded={open} onClick={onToggle}>
        {f.q}
        <span className="chev"><Chevron size={18} strokeWidth={2.2} /></span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="a"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="faq-a-inner">{f.a}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Faq() {
  const [openIdx, setOpenIdx] = useState(-1);
  return (
    <section className="section" id="faq" style={{ paddingTop: 0 }}>
      <div className="container">
        <Reveal as="h2" className="section-title">سوالات پرتکرار</Reveal>
        <div className="faq">
          {FAQS.map((f, i) => (
            <Reveal key={i} delay={(i % 3) * 0.05}>
              <Item f={f} open={openIdx === i} onToggle={() => setOpenIdx(openIdx === i ? -1 : i)} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
