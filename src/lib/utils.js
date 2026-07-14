import { useEffect, useRef, useState } from 'react';

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function toFa(input) {
  return String(input).replace(/\d/g, (d) => FA_DIGITS[d]);
}

export function faGroup(n) {
  return toFa(Number(n).toLocaleString('en-US'));
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useCountUp(target, { duration = 1500, start = false } = {}) {
  const [value, setValue] = useState(0);
  const raf = useRef(null);

  useEffect(() => {
    if (!start) return undefined;
    if (prefersReducedMotion()) {
      setValue(target);
      return undefined;
    }
    let t0 = null;
    const tick = (ts) => {
      if (t0 === null) t0 = ts;
      const p = Math.min((ts - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => raf.current && cancelAnimationFrame(raf.current);
  }, [target, duration, start]);

  return value;
}
