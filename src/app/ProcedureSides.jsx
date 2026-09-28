import { useState } from 'react';
import { useStatusList } from './config.jsx';
import { Plus } from '../ui/icons.jsx';

/**
 * **سمت و سطحِ هر عمل** (بستهٔ ۸) — زیرِ «نوعِ عمل»، برای هر عملِ این مراجعه جدا.
 *
 * پیش‌فرض بسته است (همان قاعدهٔ زیرفرم‌ها: «پیش‌فرض پنهان»): فقط یک «+ سمت و سطح» کوچک، و
 * ردیفی که مقدار دارد همیشه باز می‌ماند. سمت با یک لمس، دوباره‌لمس یعنی «پاک کن».
 * ⚠️ فهرستِ سمت‌ها از سرور (`/config.statuses.side`) می‌آید، نه این‌جا.
 */
export default function ProcedureSides({ items, value, onChange, disabled }) {
  const opts = useStatusList('side');
  const [opened, setOpened] = useState(() => new Set());
  if (!items.length || !opts.length) return null;
  const set = (id, patch) => onChange({ ...value, [id]: { side: '', level: '', ...value[id], ...patch } });
  return (
    <div className="ps" data-proc-sides>
      {items.map((p) => {
        const cur = value[p.id] ?? { side: '', level: '' };
        const name = items.length > 1 ? p.name : 'عمل';
        if (!cur.side && !cur.level && !opened.has(p.id)) {
          return (
            <button key={p.id} type="button" className="ps-add" disabled={disabled}
                    onClick={() => setOpened((s) => new Set(s).add(p.id))}>
              <Plus width="13" height="13" aria-hidden="true" /> سمت و سطحِ {name}
            </button>
          );
        }
        return (
          <div key={p.id} className="ps-row" data-proc-side={p.id}>
            <span className="ps-name">سمت و سطحِ {name}</span>
            <div className="ps-chips" role="radiogroup" aria-label={`سمتِ ${p.name}`}>
              {opts.map((o) => (
                <button key={o.key} type="button" role="radio" aria-checked={cur.side === o.key} disabled={disabled}
                        className={`ps-chip${cur.side === o.key ? ' on' : ''}`}
                        onClick={() => set(p.id, { side: cur.side === o.key ? '' : o.key })}>{o.label}</button>
              ))}
            </div>
            <input type="text" className="ps-level" value={cur.level} maxLength={60} disabled={disabled}
                   aria-label={`سطح یا ناحیهٔ ${p.name}`} placeholder="سطح یا ناحیه — مثلاً L4–L5"
                   onChange={(e) => set(p.id, { level: e.target.value })} />
          </div>
        );
      })}
    </div>
  );
}
