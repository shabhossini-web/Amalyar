import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import { BRAND } from '../data.jsx';
import { ArrowLeft, Check } from './icons.jsx';
import DashboardMock from './DashboardMock.jsx';
import Mark from './Mark.jsx';

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

export default function Hero() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const mockY = useTransform(scrollYProgress, [0, 1], [0, 90]);
  const mockScale = useTransform(scrollYProgress, [0, 1], [1, 0.94]);

  return (
    <header className="hero" id="top" ref={ref}>
      <div className="container">
        <motion.div variants={container} initial="hidden" animate="show">
          <motion.div className="hero-lockup" variants={item}>
            <Mark className="hero-lockup-mark" gradient draw aria-hidden="true" />
            <div className="hero-lockup-word">عمل<span className="grad-text">‌یار</span></div>
            <div className="hero-lockup-tag">هوشمند <em>عمل</em> کن</div>
          </motion.div>

          <motion.div className="hero-badge" variants={item}>
            <Check size={14} strokeWidth={2} />
            ساخته‌شده در اتاق عمل، برای اتاق عمل
          </motion.div>

          <motion.h1 variants={item}>
            تمام عملیاتِ شرکت خدمات جراحی‌ات<br />
            در <span className="grad-text">یک پلتفرم</span>
          </motion.h1>

          <motion.p className="lead" variants={item}>
            از پذیرش آنلاین بیمار و راستی‌آزماییِ فیش با هوش مصنوعی، تا حضور و غیابِ کارشناس با
            تشخیص چهره، دفتر کلِ دوطرفه و فاکتور رسمی مودیان — برای شرکت‌های نورومانیتورینگ،
            تجهیزات و ایمپلنت جراحی.
          </motion.p>

          <motion.div className="hero-ctas" variants={item}>
            <a className="btn-primary" href="#contact">
              درخواست دمو رایگان
              <ArrowLeft size={17} strokeWidth={2.2} />
            </a>
            <a className="btn-ghost" href="#pricing">مشاهدهٔ تعرفه‌ها</a>
          </motion.div>
        </motion.div>

        <motion.div
          className="mock-wrap"
          style={{ y: mockY, scale: mockScale }}
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <DashboardMock />
        </motion.div>
      </div>
    </header>
  );
}
