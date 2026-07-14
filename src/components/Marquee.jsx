import { motion } from 'framer-motion';
import { HOSPITALS } from '../data.jsx';
import { Hospital } from './icons.jsx';

export default function Marquee() {
  const list = [...HOSPITALS, ...HOSPITALS];
  return (
    <section className="trust" aria-label="مورد اعتماد">
      <p className="trust-label">در جریانِ صدها عمل جراحی، در بیمارستان‌های سراسر کشور</p>
      <div className="marquee-mask">
        <motion.div
          className="marquee-track"
          animate={{ x: ['0%', '-50%'] }}
          transition={{ duration: 32, repeat: Infinity, ease: 'linear' }}
          aria-hidden="true"
        >
          {list.map((h, i) => (
            <span key={i}><Hospital size={16} strokeWidth={2} />{h}</span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
