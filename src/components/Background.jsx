import { motion } from 'framer-motion';

const float = (dx, dy, dur) => ({
  animate: { x: [0, dx, 0], y: [0, dy, 0] },
  transition: { duration: dur, repeat: Infinity, ease: 'easeInOut' },
});

export default function Background() {
  return (
    <>
      <div className="bg-layer" aria-hidden="true">
        <motion.div className="aurora a1" style={{ translateX: '-50%' }} {...float(-40, 30, 16)} />
        <motion.div className="aurora a2" {...float(50, -40, 20)} />
        <motion.div className="aurora a3" {...float(40, -30, 22)} />
      </div>
      <div className="bg-grid" aria-hidden="true" />
    </>
  );
}
