import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import './access.css';
import { Alert, Back, Caret, CheckCircle, Lock, Search } from '../ui/icons.jsx';
import { useConfirm } from '../ui/Confirm.jsx';
import { useStagger } from '../ui/stagger.js';
import Toast, { useToast } from '../ui/Toast.jsx';
import { useConfig, useTerms } from './config.jsx';
import { roleShown } from '../lib/terms.js';
import { allTools, toolsOfFeature, useToolTitle } from './tools.jsx';

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');

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
  const { msg: toast, action: toastAction, show: setToast } = useToast(2400);
  const [busy, setBusy] = useState('');
  const [lens, setLens] = useState(0); // ۰ = همه؛ وگرنه «از نگاهِ سطحِ N»
  const [q, setQ] = useState('');
  const [openGroups, setOpenGroups] = useState(() => new Set(['modules']));
  const [confirmNode, confirm] = useConfirm();
  const row = useStagger();

  const { label: title } = useToolTitle('access');
  const t = useTerms();
  const { vertical } = useConfig();

  const load = useCallback(async () => {
    setErr('');
    try { setData(await api('/access/matrix')); }
    catch (e) { setErr(e.message); setData(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  /* کارکنان — برای گفتنِ **اثرِ** هر تغییر پیش از اعمال: «۴ نفر دیگر به حسابداری دسترسی ندارند».
     `false` یعنی نیامد؛ آن‌وقت پرسش بی‌نام می‌آید ولی باز هم می‌آید. */
  const [people, setPeople] = useState(null);
  useEffect(() => {
    let live = true;
    api('/accounts').then((r) => { if (live) setPeople(Array.isArray(r) ? r : []); }).catch(() => { if (live) setPeople(false); });
    return () => { live = false; };
  }, []);
  /* چه کسی از این در رد می‌شود — همان قاعدهٔ گارد: روشن، سطح ≥ حداقل، و اگر نقشی قید شده
     همان نقش. سوپرادمین همیشه عبور می‌کند، پس شمرده نمی‌شود. */
  const reach = (st) => (people ? people.filter((a) => a.status === 'active' && (a.level ?? 0) < 6 && st.enabled
    && (a.level ?? 0) >= st.minLevel && (!st.roles.length || st.roles.includes(a.jobRole))) : null);
  const names = (list) => `${list.slice(0, 5).map((a) => a.displayName).join('، ')}${list.length > 5 ? ` و ${faNum(list.length - 5)} نفرِ دیگر` : ''}`;

  const url = (r) => `/access/${r.kind === 'feature' ? 'features' : 'permissions'}/${r.key}`;
  const write = async (r, body, msg, undo) => {
    setBusy(`${r.kind}:${r.key}`);
    try {
      await api(url(r), { method: 'PATCH', body });
      /* «واگرد» در خودِ توست — تغییرِ دسترسی فوراً روی سرور می‌نشیند و تا بازبینیِ UX تنها
         بازخوردش توستی ۲٫۴ ثانیه‌ای بود. */
      setToast(msg, undo ? { ms: 7000, action: { label: 'واگرد', run: () => write(r, undo, `«${r.label}» به حالتِ قبل برگشت`, null) } } : {});
      await load();
    } catch (e) { setToast(e.message); } finally { setBusy(''); }
  };

  /**
   * هر تغییر اول **اثرش** را می‌گوید (بازبینیِ UX ۱۴۰۵/۰۷: هر لمس بی‌پرسش دسترسیِ همهٔ کارکنان را
   * عوض می‌کرد). خاموش‌کردن یا بستنِ در به روی کسی پرسشِ قرمز دارد؛ بازکردنِ در به روی کسانِ
   * تازه هم پرسیده می‌شود — آن هم تغییرِ دسترسی است. تغییری که روی هیچ‌کس اثر ندارد بی‌پرسش
   * اعمال می‌شود؛ همه «واگرد» دارند.
   */
  const change = async (r, patch, msg) => {
    const before = { minLevel: r.minLevel, enabled: r.enabled, roles: r.roles };
    const after = { ...before, ...patch };
    const was = reach(before);
    const will = reach(after);
    let ask = null;
    if (was && will) {
      const lost = was.filter((a) => !will.includes(a));
      const gained = will.filter((a) => !was.includes(a));
      if (lost.length) {
        ask = {
          title: patch.enabled === false ? `«${r.label}» خاموش شود؟` : `«${r.label}» برای ${faNum(lost.length)} نفر بسته شود؟`,
          body: `${faNum(lost.length)} نفر دیگر به «${r.label}» دسترسی ندارند: ${names(lost)}. سوپرادمین همیشه دسترسی دارد.`,
          ok: patch.enabled === false ? 'خاموش کن' : 'ببند', danger: true,
        };
      } else if (gained.length) {
        ask = {
          title: `«${r.label}» برای ${faNum(gained.length)} نفرِ دیگر باز شود؟`,
          body: `این افراد به «${r.label}» دسترسی پیدا می‌کنند: ${names(gained)}.`,
          ok: 'باز کن',
        };
      } else if (patch.enabled === false) {
        ask = { title: `«${r.label}» خاموش شود؟`, body: 'فعلاً جز سوپرادمین کسی به آن نمی‌رسد؛ خاموش که شود، برای سطح‌های دیگر دیده نمی‌شود.', ok: 'خاموش کن', danger: true };
      }
    } else if (patch.enabled === false || (patch.minLevel != null && patch.minLevel > r.minLevel) || patch.roles) {
      ask = { title: `دسترسیِ «${r.label}» عوض شود؟`, body: 'این تغییر همین حالا برای همهٔ کارکنان اعمال می‌شود؛ سوپرادمین همیشه دسترسی دارد.', ok: 'تأیید', danger: true };
    }
    if (ask && !(await confirm(ask))) return;
    await write(r, patch, msg, before);
  };

  const resetOne = async (r) => {
    setBusy(`${r.kind}:${r.key}`);
    try {
      await api(`${url(r)}/reset`, { method: 'POST' });
      setToast(`«${r.label}» به پیش‌فرض برگشت`);
      await load();
    } catch (e) { setToast(e.message); } finally { setBusy(''); }
  };

  const levels = data?.levels ?? [];

  /* نامِ هر ردیفِ ماژول **از کاتالوگِ کاشی‌ها** می‌آید، نه از برچسبِ سرور: مدیر در لانچر
     «بیماران» می‌بیند و این‌جا باید همان را پیدا کند، نه «داشبورد مدیریت». کلیدی که چند
     کاشی را با هم باز و بسته می‌کند (مثلِ «بیماران» که «یادآوری‌ها» و «جستجوی بالینی» را هم
     می‌برد) زیرِ نامش فهرستِ همان کاشی‌ها را می‌گوید. */
  const shown = (r) => {
    if (r.kind !== 'feature') return { ...r, tiles: [] };
    const tiles = toolsOfFeature(r.key, t);
    const own = tiles.find((x) => x.key === r.key);
    const label = own?.label ?? r.label;
    const listed = tiles.length > 1 || (tiles.length === 1 && tiles[0].label !== label) ? tiles : [];
    return { ...r, label, tiles: listed };
  };
  /* کاشی‌هایی که کلیدِ ماژولِ خودشان را ندارند — تا امروز در این صفحه اصلاً ردیفی نداشتند و
     مدیر نمی‌دانست چرا «تنظیمات» یا «دستیار» را نمی‌تواند خاموش کند. */
  const featureKeys = new Set((data?.groups ?? []).flatMap((g) => g.rows).filter((r) => r.kind === 'feature').map((r) => r.key));
  const permLabel = new Map((data?.groups ?? []).flatMap((g) => g.rows).filter((r) => r.kind === 'permission').map((r) => [r.key, r.label]));
  const keyless = data ? allTools(t).filter((x) => !featureKeys.has(x.feature ?? x.key)) : [];
  const levelName = (v) => levels.find((l) => l.value === v)?.label ?? '';

  /* جستجو روی نام، راهنما و کاشی‌ها — صفحه روی گوشی ۲۱ هزار پیکسل و بیش از هزار دکمه بود. */
  const needle = q.trim();
  const match = (r) => !needle || [r.label, r.hint, ...r.tiles.map((x) => x.label)].some((v) => String(v ?? '').includes(needle));
  const groups = (data?.groups ?? []).map((g) => ({ ...g, rows: g.rows.map(shown).filter(match) }))
    .filter((g) => g.rows.length > 0 || (!needle && g.key === 'modules'));
  const isOpen = (g) => !!needle || openGroups.has(g.key);
  const toggle = (key) => setOpenGroups((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <div className="ax">
      <div className="ax-bg" aria-hidden="true" />
      <header className="ax-head">
        <Link to="/app" className="ax-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1>{title}</h1>
          <p>
            هر ردیف یک در است و شش ستون شش سطح. ستونِ روشن یعنی آن سطح و
            بالاترش این در را باز می‌کنند. هر تغییر پیش از اعمال می‌گوید روی چه کسانی اثر دارد.
          </p>
        </div>
      </header>

      {err && <div className="ax-err"><Alert width="15" height="15" /> {err}</div>}

      <label className="ax-search">
        <Search width="16" height="16" aria-hidden="true" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی ماژول یا مجوز…" aria-label="جستجو در سطوحِ دسترسی" autoComplete="off" />
      </label>

      {/* ذره‌بینِ سطح: «سطح ۳ به چه چیزهایی دسترسی دارد» را یک‌نگاهی می‌کند. */}
      <nav className="ax-lens" aria-label="نمایش از نگاهِ یک سطح">
        <button type="button" className={lens === 0 ? 'on' : ''} aria-pressed={lens === 0} onClick={() => setLens(0)}>همه</button>
        {levels.map((l) => (
          <button key={l.value} type="button" className={lens === l.value ? 'on' : ''} aria-pressed={lens === l.value} onClick={() => setLens(l.value)}>
            {faNum(l.value)} — {l.label}
          </button>
        ))}
      </nav>
      {lens > 0 && (
        <p className="ax-lenshint">
          پررنگ‌ها آن‌هایی‌اند که <b>{levels.find((l) => l.value === lens)?.label}</b> به آن‌ها می‌رسد.
        </p>
      )}

      {!data && !err && <div className="ax-empty">در حال بارگذاری…</div>}
      {data && needle && groups.length === 0 && <div className="ax-empty">ردیفی با «{needle}» پیدا نشد.</div>}

      {groups.map((g) => (
        <section key={g.key} className="ax-group">
          {/* گروه‌ها تاشو‌اند (پیش‌فرض فقط «ماژول‌ها» باز)؛ جستجو همه را باز می‌کند. */}
          <h2>
            <button type="button" className="ax-gtoggle" aria-expanded={isOpen(g)} aria-controls={`ax-g-${g.key}`} onClick={() => toggle(g.key)}>
              <span>{g.label}</span>
              <small>{faNum(g.rows.length)} ردیف</small>
              <Caret className="ax-caret" width="16" height="16" aria-hidden="true" />
            </button>
          </h2>
          <div id={`ax-g-${g.key}`} hidden={!isOpen(g)}>
          {g.hint && <p className="ax-ghint">{g.hint}</p>}
          <div className="ax-rows">
            {g.rows.map((r, i) => {
              const open = lens === 0 || (r.enabled && lens >= r.minLevel);
              const lock = r.locked || busy === `${r.kind}:${r.key}`;
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
                    {r.tiles.length > 0 && (
                      <small className="ax-tiles">کاشی‌های تحتِ این کلید: {r.tiles.map((x) => x.label).join('، ')}</small>
                    )}
                    {/* کلیدِ انگلیسی (`surgeon`، `formgen`) دیگر چاپ نمی‌شود — فقط برای ابزار و آزمون. */}
                  </div>

                  <div className="ax-cells" role="group" aria-label={`سطحِ لازم برای ${r.label}`} data-key={r.key}>
                    {levels.map((l) => (
                      <button
                        key={l.value} type="button"
                        title={`${faNum(l.value)} — ${l.label}`}
                        aria-label={`از سطحِ ${faNum(l.value)} (${l.label}) به بالا`}
                        aria-pressed={l.value >= r.minLevel}
                        disabled={lock}
                        className={`ax-cell${l.value >= r.minLevel ? ' on' : ''}${l.value === r.minLevel ? ' edge' : ''}`}
                        onClick={() => l.value !== r.minLevel && change(r, { minLevel: l.value }, `«${r.label}» از سطحِ ${faNum(l.value)} به بالا`)}
                      >
                        {faNum(l.value)}
                      </button>
                    ))}
                  </div>

                  <div className="ax-acts">
                    <button
                      type="button"
                      className={`ax-sw${r.enabled ? ' on' : ''}`}
                      disabled={lock}
                      aria-pressed={r.enabled}
                      onClick={() => change(r, { enabled: !r.enabled }, r.enabled ? `«${r.label}» خاموش شد` : `«${r.label}» روشن شد`)}
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

                  {/* نقش — شرطِ **دومِ** در، AND با سطح: دو نفرِ هم‌سطح
                      می‌توانند دسترسیِ متفاوت بگیرند. هیچ‌کدام روشن نباشد
                      یعنی «هر نقشی»؛ سوپرادمین همیشه بیرونِ قاعده است. */}
                  <div className="ax-roles" role="group" aria-label={`نقش‌های مجاز برای ${r.label}`}>
                    <em>نقش:</em>
                    {/* نقشِ بی‌ربط به حوزه (راننده و پیکِ مطب) پنهان است — مگر همین ردیف از قبل آن را دارد. */}
                    {(data.roles ?? []).filter((ro) => roleShown(vertical, ro.key) || r.roles.includes(ro.key)).map((ro) => {
                      const on = r.roles.includes(ro.key);
                      return (
                        <button
                          key={ro.key} type="button"
                          aria-pressed={on}
                          disabled={lock}
                          className={`ax-role${on ? ' on' : ''}`}
                          onClick={() => change(
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
                </motion.article>
              );
            })}
          </div>
          {g.key === 'modules' && !needle && keyless.length > 0 && (
            <div className="ax-keyless" aria-label="کاشی‌هایی که کلیدِ جدا ندارند">
              <b>کاشی‌هایی که کلیدِ جدا ندارند</b>
              <small>روشن/خاموش ندارند و فقط با سطح دیده می‌شوند؛ اگر مجوزی داده‌شان را باز می‌کند، همان ردیف را پایین‌تر عوض کنید.</small>
              <ul>
                {keyless.map((x) => (
                  <li key={x.key}>
                    <span>{x.label}</span>
                    <small>
                      از سطحِ {faNum(x.min)} ({levelName(x.min)}) به بالا
                      {x.perm && permLabel.get(x.perm) && <> · داده‌اش با «{permLabel.get(x.perm)}»</>}
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          )}
          </div>
        </section>
      ))}

      {confirmNode}
      <Toast msg={toast} action={toastAction} />
    </div>
  );
}
