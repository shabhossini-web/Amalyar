/**
 * **نمودارِ خطیِ کوچک** (روندِ قد/وزن در زیرفرمِ «قد و وزن») — فقط هندسهٔ رسم، نه دادهٔ مشتق.
 *
 * ⚠️ در `src/ui` است چون هر `<svg>` جایش همین‌جاست (نگهبانِ «آیکون‌ها یک خانه دارند»)؛
 * رنگ از `currentColor` و ضخامت همان ۱٫۹ِ آیکون‌ها، تا در هر دو تم خوانا بماند.
 */
export default function Spark({ vals }) {
  const w = 110; const h = 30; const pad = 3;
  const lo = Math.min(...vals); const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const pts = vals.map((v, i) => [
    pad + (i * (w - 2 * pad)) / Math.max(1, vals.length - 1),
    h - pad - ((v - lo) * (h - 2 * pad)) / span,
  ]);
  const last = pts[pts.length - 1];
  return (
    <svg className="vf-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill="currentColor" />
    </svg>
  );
}
