import { useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

/**
 * ورودیِ استانداردِ کدِ یکبارمصرف — ۶ باکس با انیمیشن.
 * status: idle | busy | success | error
 *  - تایپ: هر رقم با پاپِ فنری می‌نشیند
 *  - busy: موجِ انتظار روی باکس‌ها
 *  - success/error: باکس‌ها به مرکز جمع می‌شوند و تیکِ سبز / ضربدرِ قرمز کشیده می‌شود
 */
const SPRING = { type: 'spring', stiffness: 500, damping: 28 };
const STEP_W = 52; // عرضِ باکس + فاصله (برای محاسبهٔ جمع‌شدن به مرکز)

export default function OtpInput({ length = 6, value = '', onChange, status = 'idle' }) {
  const inputRef = useRef(null);
  const reduce = useReducedMotion();
  const digits = value.split('').slice(0, length);
  const collapsing = status === 'success' || status === 'error';
  const center = (length - 1) / 2;

  return (
    <div className="otp" onClick={() => inputRef.current?.focus()}>
      <div className="otp-row" dir="ltr">
        {/* ورودیِ نامرئی روی کلِ ردیف — کیبوردِ عددی + WebOTP/autocomplete */}
        <input
          ref={inputRef}
          className="otp-hidden"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          name="otp"
          aria-label="کد تأیید"
          value={value}
          onChange={(e) =>
            onChange(
              e.target.value
                .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
                .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
                .replace(/[^0-9]/g, '')
                .slice(0, length),
            )
          }
          disabled={collapsing || status === 'busy'}
          autoFocus
        />

        {Array.from({ length }).map((_, i) => (
          <motion.div
            key={i}
            className={`otp-box${i === digits.length && status === 'idle' ? ' focus' : ''}${digits[i] ? ' filled' : ''}`}
            animate={
              collapsing
                ? reduce
                  ? { opacity: 0 }
                  : { x: (center - i) * STEP_W, scale: 0.2, opacity: 0 }
                : status === 'busy' && !reduce
                  ? { y: [0, -7, 0], transition: { repeat: Infinity, duration: 0.85, delay: i * 0.09 } }
                  : { x: 0, y: 0, scale: 1, opacity: 1 }
            }
            transition={collapsing ? { delay: i * 0.035, ...SPRING } : undefined}
          >
            <AnimatePresence mode="popLayout">
              {digits[i] && (
                <motion.span
                  key={`${i}-${digits[i]}`}
                  initial={reduce ? { opacity: 0 } : { scale: 1.7, opacity: 0, y: -10 }}
                  animate={{ scale: 1, opacity: 1, y: 0, transition: SPRING }}
                  exit={{ scale: 0.4, opacity: 0, transition: { duration: 0.12 } }}
                >
                  {digits[i]}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
        ))}

        <AnimatePresence>
          {collapsing && (
            <motion.div
              className={`otp-result ${status}`}
              initial={{ scale: 0.2, opacity: 0 }}
              animate={{
                scale: 1,
                opacity: 1,
                transition: { delay: 0.22, type: 'spring', stiffness: 320, damping: 17 },
              }}
              exit={{ scale: 0.2, opacity: 0 }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {status === 'success' ? (
                  <motion.path
                    d="M5 12.5l4.5 4.5L19 7.5"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1, transition: { delay: 0.38, duration: 0.4, ease: 'easeOut' } }}
                  />
                ) : (
                  <>
                    <motion.path d="M6.5 6.5l11 11" initial={{ pathLength: 0 }} animate={{ pathLength: 1, transition: { delay: 0.38, duration: 0.28 } }} />
                    <motion.path d="M17.5 6.5l-11 11" initial={{ pathLength: 0 }} animate={{ pathLength: 1, transition: { delay: 0.58, duration: 0.28 } }} />
                  </>
                )}
              </svg>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
