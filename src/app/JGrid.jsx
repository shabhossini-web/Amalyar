import { J_DAYS, J_MONTHS, jDayOfWeek, jMonthDays, jToday } from '../lib/jalali.js';
import './jgrid.css';
import { ChevronEnd } from '../ui/icons.jsx';


const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');

/**
 * گریدِ ماهانهٔ شمسی — **مشترک بینِ تقویمِ عمل‌ها و پنلِ چینش**.
 *
 * همین اشتراک دلیلِ ترتیبِ فازهاست: چینش دقیقاً همین گرید را می‌خواهد، و اگر
 * آن‌جا از نو نوشته می‌شد، دو تقویم با دو محاسبهٔ هفته و دو رفتارِ ناوبری
 * می‌داشتیم که با اولین اختلافِ کبیسه از هم جدا می‌شدند.
 *
 * چیزی دربارهٔ محتوای سلول نمی‌داند: `renderDay(day)` را صدا می‌زند و هرچه
 * برگردد داخلِ سلول می‌گذارد. پس چینش می‌تواند همان گرید را با کارشناس و ست
 * پر کند بدونِ اینکه این فایل عوض شود.
 *
 * ⚠️ هفته از **شنبه** شروع می‌شود و `jDayOfWeek` همین را برمی‌گرداند؛ استفاده
 * از `Date.getDay()` (که یکشنبه‌محور است) ستون‌ها را یک روز می‌چرخاند.
 */
export default function JGrid({ year, month, onNav, renderDay, onPickDay, selected }) {
  const [ty, tm, td] = jToday();
  const days = jMonthDays(year, month);
  // شمارِ سلول‌های خالیِ ابتدای ماه تا روزِ اول زیرِ ستونِ درستش بیفتد.
  const lead = jDayOfWeek(year, month, 1);
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

  const go = (delta) => {
    let y = year;
    let m = month + delta;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    onNav(y, m);
  };

  return (
    <div className="jg">
      <header className="jg-head">
        {/* در RTL، «ماهِ قبل» سمتِ راست است؛ آیکون هم باید به همان سمت اشاره کند. */}
        <button type="button" onClick={() => go(-1)} aria-label="ماهِ قبل"><ChevronEnd width="16" height="16" /></button>
        <b>{J_MONTHS[month - 1]} {faNum(year).replace(/٬/g, '')}</b>
        <button type="button" className="flip" onClick={() => go(1)} aria-label="ماهِ بعد"><ChevronEnd width="16" height="16" /></button>
        <button type="button" className="jg-today" onClick={() => onNav(ty, tm)}>امروز</button>
      </header>

      <div className="jg-dows">{J_DAYS.map((d) => <span key={d}>{d}</span>)}</div>

      <div className="jg-grid">
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} className="jg-cell empty" />;
          const isToday = year === ty && month === tm && day === td;
          const isSel = selected === day;
          return (
            <div
              key={day}
              className={`jg-cell${isToday ? ' today' : ''}${isSel ? ' sel' : ''}${onPickDay ? ' pick' : ''}`}
              onClick={onPickDay ? () => onPickDay(day) : undefined}
              role={onPickDay ? 'button' : undefined}
              tabIndex={onPickDay ? 0 : undefined}
              onKeyDown={onPickDay ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickDay(day); } } : undefined}
            >
              <span className="jg-num">{faNum(day)}</span>
              {renderDay?.(day)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
