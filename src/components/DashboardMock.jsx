import { useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { faGroup } from '../lib/utils.js';

const BARS = [34, 52, 44, 70, 58, 82, 95];
const CYAN = new Set([2, 5]);

const ATTEND = [
  { name: 'کارشناس ۱ — بیمارستان میلاد', time: '۰۷:۴۵' },
  { name: 'کارشناس ۲ — بیمارستان پارس', time: '۰۸:۱۰' },
  { name: 'کارشناس ۳ — بیمارستان فجر', time: '۰۸:۳۲' },
];

export default function DashboardMock() {
  const ref = useRef(null);
  const [rowIdx, setRowIdx] = useState(0);

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [6, -6]), { stiffness: 150, damping: 18 });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-6, 6]), { stiffness: 150, damping: 18 });

  const onMove = (e) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };
  const onLeave = () => { mx.set(0); my.set(0); };

  return (
    <motion.div
      ref={ref}
      className="mock"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onViewportEnter={() => {
        let i = 0;
        setInterval(() => { i = (i + 1) % ATTEND.length; setRowIdx(i); }, 2600);
      }}
      style={{ rotateX: rx, rotateY: ry }}
      role="img"
      aria-label="نمای داشبورد مدیریتی پلتفرم عمل‌یار"
    >
      <div className="mock-bar" aria-hidden="true">
        <span className="mock-dot" style={{ background: '#ff5f57' }} />
        <span className="mock-dot" style={{ background: '#febc2e' }} />
        <span className="mock-dot" style={{ background: '#28c840' }} />
        <span style={{ marginRight: 'auto', fontSize: 11, color: 'var(--text3)' }}>داشبورد مدیریت</span>
      </div>

      <div className="mock-body" aria-hidden="true">
        <div className="mock-col">
          <div className="mock-card">
            <h4>درآمد وصول‌شدهٔ این ماه</h4>
            <div className="mock-num">{faGroup(842500000)} <small>+۱۸٪</small></div>
            <div className="mock-chart">
              {BARS.map((h, i) => (
                <motion.i
                  key={i}
                  className={CYAN.has(i) ? 'c' : ''}
                  initial={{ scaleY: 0 }}
                  whileInView={{ scaleY: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: 0.15 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>

          <div className="mock-card">
            <h4>حضور و غیاب امروز</h4>
            {ATTEND.map((a, i) => (
              <div className="mock-row" key={i} style={{ opacity: i === rowIdx ? 1 : 0.62, transition: 'opacity .5s' }}>
                <span className="mock-ava" style={i % 2 ? { background: 'linear-gradient(135deg,var(--cyan),var(--brand))' } : undefined} />
                {a.name}
                <span className="mock-pill" style={{ background: 'rgba(52,211,153,.12)', color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {i === rowIdx && (
                    <motion.span
                      className="live-dot"
                      animate={{ boxShadow: ['0 0 0 0 rgba(52,211,153,.6)', '0 0 0 6px rgba(52,211,153,0)'] }}
                      transition={{ duration: 1.4, repeat: Infinity }}
                    />
                  )}
                  حاضر {a.time}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mock-col">
          <div className="mock-card">
            <h4>فرم‌های در انتظار تأیید</h4>
            <div className="mock-num">۳</div>
            <div className="mock-row">فیش واریزی — تأیید خودکار AI
              <span className="mock-pill" style={{ background: 'rgba(0,229,255,.1)', color: 'var(--cyan)' }}>✓ معتبر</span>
            </div>
          </div>
          <div className="mock-card">
            <h4>تقسیم سهم این عمل</h4>
            <div className="mock-row">سهم جراح <span className="mock-pill" style={{ background: 'rgba(124,58,237,.16)', color: '#c4b5fd' }}>{faGroup(24000000)}</span></div>
            <div className="mock-row">سهم کارشناس <span className="mock-pill" style={{ background: 'rgba(124,58,237,.16)', color: '#c4b5fd' }}>{faGroup(6000000)}</span></div>
            <div className="mock-row">سهم شرکا <span className="mock-pill" style={{ background: 'rgba(0,229,255,.1)', color: 'var(--cyan)' }}>خودکار</span></div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
