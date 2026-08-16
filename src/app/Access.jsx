import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import './access.css';
import { Alert, Back, CheckCircle, Lock } from '../ui/icons.jsx';
import { useStagger } from '../ui/stagger.js';

/**
 * ماتریسِ سطوحِ دسترسی.
 *
 * ⚠️ صفحهٔ مستقل است، نه تبِ سومِ «کاربران». تنظیمِ ماژول‌ها تا امروز آن‌جا
 * قایم بود و مالکِ محصول می‌گفت «اصلاً همچین چیزی نداریم» — یعنی قابلیتی که
 * پیدا نشود وجود ندارد. جایش هم کنارِ «کاربران» است چون همان سؤال را جواب
 * می‌دهد از سمتِ دیگر: آن‌جا «این آدم چه سطحی دارد»، این‌جا «این سطح به چه
 * چیزی می‌رسد».
 *
 * ⚠️ دو لایه (ماژول و مجوز) در **یک** جدول‌اند، چون از دیدِ مدیر یک سؤال‌اند.
 * جداکردنشان یعنی مدیر باید دو جدول را در ذهنش روی هم بگذارد؛ همان‌جاست که
 * ماژولِ باز با مجوزِ بستهٔ متناظر ساخته می‌شود.
 */
export default function Access() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState('');
  const [lens, setLens] = useState(0); // ۰ = همه؛ وگرنه «از نگاهِ سطحِ N»
  const row = useStagger();

  useEffect(() => { document.title = 'عمل‌یار — سطوحِ دسترسی'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setErr('');
    try { setData(await api('/access/matrix')); }
    catch (e) { setErr(e.message); setData(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const patch = async (r, body, msg) => {
    setBusy(`${r.kind}:${r.key}`);
    try {
      await api(`/access/${r.kind === 'feature' ? 'features' : 'permissions'}/${r.key}`, { method: 'PATCH', body });
      setToast(msg);
      await load();
    } catch (e) { setToast(e.message); } finally { setBusy(''); }
  };

  const resetOne = async (r) => {
    setBusy(`${r.kind}:${r.key}`);
    try {
      await api(`/access/${r.kind === 'feature' ? 'features' : 'permissions'}/${r.key}/reset`, { method: 'POST' });
      setToast(`«${r.label}» به پیش‌فرض برگشت`);
      await load();
    } catch (e) { setToast(e.message); } finally { setBusy(''); }
  };

  const levels = data?.levels ?? [];

  return (
    <div className="ax">
      <div className="ax-bg" aria-hidden="true" />
      <header className="ax-head">
        <Link to="/app" className="ax-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1>سطوحِ دسترسی</h1>
          <p>
            هر ردیف یک در است و شش ستون شش سطح. ستونِ روشن یعنی آن سطح و
            بالاترش این در را باز می‌کنند.
          </p>
        </div>
      </header>

      {err && <div className="ax-err"><Alert width="15" height="15" /> {err}</div>}

      {/* ذره‌بینِ سطح: «سطح ۳ به چه چیزهایی دسترسی دارد» را یک‌نگاهی می‌کند. */}
      <nav className="ax-lens" aria-label="نمایش از نگاهِ یک سطح">
        <button type="button" className={lens === 0 ? 'on' : ''} onClick={() => setLens(0)}>همه</button>
        {levels.map((l) => (
          <button key={l.value} type="button" className={lens === l.value ? 'on' : ''} onClick={() => setLens(l.value)}>
            {l.value} — {l.label}
          </button>
        ))}
      </nav>
      {lens > 0 && (
        <p className="ax-lenshint">
          پررنگ‌ها آن‌هایی‌اند که <b>{levels.find((l) => l.value === lens)?.label}</b> به آن‌ها می‌رسد.
        </p>
      )}

      {!data && !err && <div className="ax-empty">در حال بارگذاری…</div>}

      {data?.groups.map((g) => (
        <section key={g.key} className="ax-group">
          <h2>{g.label}</h2>
          {g.hint && <p className="ax-ghint">{g.hint}</p>}
          <div className="ax-rows">
            {g.rows.map((r, i) => {
              const open = lens === 0 || (r.enabled && lens >= r.minLevel);
              return (
                <motion.article
                  key={`${r.kind}:${r.key}`} {...row(i)}
                  className={`ax-row${r.locked ? ' locked' : ''}${lens > 0 && !open ? ' dim' : ''}`}
                >
                  <div className="ax-name">
                    <b>
                      {r.label}
                      {r.locked && <Lock width="13" height="13" aria-label="قفل" />}
                      {!r.isDefault && <i className="ax-tag">دست‌کاری‌شده</i>}
                    </b>
                    {r.hint && <small>{r.hint}</small>}
                    <em className="ax-key" dir="ltr">{r.key}</em>
                  </div>

                  <div className="ax-cells" role="group" aria-label={`سطحِ لازم برای ${r.label}`}>
                    {levels.map((l) => (
                      <button
                        key={l.value} type="button"
                        title={`${l.value} — ${l.label}`}
                        aria-pressed={l.value >= r.minLevel}
                        disabled={r.locked || busy === `${r.kind}:${r.key}`}
                        className={`ax-cell${l.value >= r.minLevel ? ' on' : ''}${l.value === r.minLevel ? ' edge' : ''}`}
                        onClick={() => patch(r, { minLevel: l.value }, `«${r.label}» از سطحِ ${l.value} به بالا`)}
                      >
                        {l.value}
                      </button>
                    ))}
                  </div>

                  {/* نقش — شرطِ **دومِ** در، AND با سطح: دو نفرِ هم‌سطح
                      می‌توانند دسترسیِ متفاوت بگیرند. هیچ‌کدام روشن نباشد
                      یعنی «هر نقشی»؛ سوپرادمین همیشه بیرونِ قاعده است. */}
                  <div className="ax-roles" role="group" aria-label={`نقش‌های مجاز برای ${r.label}`}>
                    <em>نقش:</em>
                    {(data.roles ?? []).map((ro) => {
                      const on = r.roles.includes(ro.key);
                      return (
                        <button
                          key={ro.key} type="button"
                          aria-pressed={on}
                          disabled={r.locked || busy === `${r.kind}:${r.key}`}
                          className={`ax-role${on ? ' on' : ''}`}
                          onClick={() => patch(
                            r,
                            { roles: on ? r.roles.filter((x) => x !== ro.key) : [...r.roles, ro.key] },
                            on ? `«${r.label}» دیگر به ${ro.label} محدود نیست` : `«${r.label}» به نقشِ ${ro.label} محدود شد`,
                          )}
                        >
                          {ro.label}
                        </button>
                      );
                    })}
                    {r.roles.length === 0 && <small>هر نقشی</small>}
                  </div>

                  <div className="ax-acts">
                    <button
                      type="button"
                      className={`ax-sw${r.enabled ? ' on' : ''}`}
                      disabled={r.locked || busy === `${r.kind}:${r.key}`}
                      aria-pressed={r.enabled}
                      onClick={() => patch(r, { enabled: !r.enabled }, r.enabled ? `«${r.label}» خاموش شد` : `«${r.label}» روشن شد`)}
                    >
                      {r.enabled ? <CheckCircle width="14" height="14" /> : null}
                      {r.enabled ? 'روشن' : 'خاموش'}
                    </button>
                    {!r.isDefault && !r.locked && (
                      <button type="button" className="ax-reset" disabled={busy === `${r.kind}:${r.key}`}
                              onClick={() => resetOne(r)}>
                        بازگرداندن
                      </button>
                    )}
                  </div>
                </motion.article>
              );
            })}
          </div>
        </section>
      ))}

      <div className={`ax-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}
