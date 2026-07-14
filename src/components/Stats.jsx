import { useState } from 'react';
import { motion } from 'framer-motion';
import { STATS } from '../data.jsx';
import { toFa, useCountUp } from '../lib/utils.js';

function Stat({ s, start }) {
  const value = useCountUp(s.count || 0, { start });
  return (
    <div className="stat">
      <b>{s.literal ? s.literal : `${toFa(value)}${s.suffix}`}</b>
      <span>{s.label}</span>
    </div>
  );
}

export default function Stats() {
  const [start, setStart] = useState(false);
  return (
    <section className="section" style={{ paddingTop: 0 }} aria-label="آمار">
      <div className="container">
        <motion.div
          className="stats"
          onViewportEnter={() => setStart(true)}
          viewport={{ once: true, amount: 0.4 }}
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {STATS.map((s, i) => <Stat key={i} s={s} start={start} />)}
        </motion.div>
      </div>
    </section>
  );
}
