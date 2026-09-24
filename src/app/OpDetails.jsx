import { useStatusList } from './config.jsx';
import { isoToJStr, jStrToIso, ymdToJStr } from '../lib/jalali.js';
import { toEnDigits } from '../lib/identity.js';
import JDate from './JDate.jsx';
import './op-details.css';

/**
 * **جزئیاتِ ساخت‌یافتهٔ عمل** (بستهٔ ۸) — سه بلوکِ ثابت برای سه تبِ فرمِ عمل،
 * به‌علاوهٔ سمت/سطحِ هر عمل.
 *
 * ⚠️ فیلدِ فرم‌ساز نیستند: کلید، نوع و قاعده‌شان در `server/src/patients/op-details.ts`
 * است و برچسبِ گزینه‌ها از `/config.statuses` (asa / anticoag / side / clavien).
 * این فایل فقط رابط است — هیچ فهرستِ گزینه‌ای این‌جا هاردکد نمی‌شود.
 *
 * ⚠️ **سه‌حالته**: `null` یعنی «ثبت نشده»، نه «خیر». دو چیپِ «بله/خیر»؛ ضربهٔ
 * دوباره روی چیپِ روشن خاموشش می‌کند و به «ثبت نشده» برمی‌گردد.
 */

export const OP_PRE = ['asaClass', 'asaEmergency', 'consentSigned', 'npoConfirmed', 'anticoagulant', 'anticoagNote'];
export const OP_INTRA = [
  'assistantSurgeonName', 'anesthesiologistName', 'performedAsPlanned', 'bloodLossMl',
  'specimenSent', 'specimenNote', 'drainPlaced', 'drainNote', 'implantNote',
];
export const OP_POST = ['complication', 'complicationNote', 'clavienGrade', 'complicationDate', 'postopDxConfirmed'];

const BOOL = new Set(['asaEmergency', 'consentSigned', 'npoConfirmed', 'performedAsPlanned', 'specimenSent', 'drainPlaced', 'complication', 'postopDxConfirmed']);

/** نمای سرور → stateِ فرم. تاریخ از **جزءِ روز** خوانده می‌شود نه `new Date` (ستونِ DATE نیمه‌شبِ UTC است). */
export function opInit(view) {
  const v = view ?? {};
  const out = {};
  for (const k of [...OP_PRE, ...OP_INTRA, ...OP_POST]) {
    if (BOOL.has(k)) out[k] = v[k] ?? null;
    else if (k === 'complicationDate') out[k] = v[k] ? ymdToJStr(String(v[k]).slice(0, 10)) || isoToJStr(v[k]) : '';
    else out[k] = v[k] == null ? '' : String(v[k]);
  }
  return out;
}

/** مقدارِ نرمال‌شدهٔ یک کلید برای مقایسه و ارسال — `null` = «ثبت نشده». */
function norm(k, val) {
  if (BOOL.has(k)) return val ?? null;
  const raw = String(val ?? '').trim();
  if (!raw) return null;
  if (k === 'complicationDate') return jStrToIso(raw) ?? `bad:${raw}`;
  /* فقط عدد لاتین می‌شود؛ متنِ آزاد با همان ارقامی که کاربر نوشت می‌ماند (بازبینی). */
  return k === 'bloodLossMl' ? toEnDigits(raw) : raw;
}

/**
 * **وصلهٔ کلید‌به‌کلید** نسبت به نمای اولیه — هرگز کلِ شیء.
 *
 * ⚠️ کلِ شیء یعنی پرستاری که فقط خون‌ریزی را نوشت، ASAِ دست‌نخوردهٔ بخشِ
 * بیهوشی را هم پس بفرستد؛ سرور echoی بی‌تغییر را تحمل می‌کند، ولی کلاینتِ
 * ناهمگام (نمای کهنه) آن را بازنویسی می‌کرد. فقط کلیدِ تغییرکرده می‌رود.
 * @returns {{patch: object, bad: string|null}} `bad` = برچسبِ فیلدی که مقدارش نامعتبر است.
 */
export function opDiff(state, initialView, keys) {
  const base = opInit(initialView);
  const patch = {};
  let bad = null;
  for (const k of keys) {
    const a = norm(k, state[k]);
    const b = norm(k, base[k]);
    if (a === b) continue;
    if (typeof a === 'string' && a.startsWith('bad:')) { bad = 'تاریخِ عارضه'; continue; }
    patch[k] = a;
  }
  return { patch, bad };
}

/**
 * قاعده‌های میانِ کلیدها، همان‌که سرور دارد — این‌جا فقط تا کاربر پیش از ذخیره
 * ببیند: پاک‌کردنِ کلاسِ ASA «اورژانس» را می‌برد؛ عارضهٔ غیرِ «بله» درجه و تاریخ را.
 */
export function opSet(state, k, val) {
  const next = { ...state, [k]: val };
  if (k === 'asaClass' && !val) next.asaEmergency = null;
  if (k === 'complication' && val !== true) { next.clavienGrade = ''; next.complicationDate = ''; }
  return next;
}

/** «بله / خیر» با حالتِ سوم («ثبت نشده») — ضربهٔ دوباره پاک می‌کند. */
function YesNo({ k, label, value, onChange, yes = 'بله', no = 'خیر' }) {
  return (
    <div className="odx-row" data-od={k}>
      <span className="odx-label">{label}</span>
      <div className="odx-chips" role="radiogroup" aria-label={label}>
        {[[true, yes], [false, no]].map(([v, l]) => (
          <button
            key={l} type="button" role="radio" aria-checked={value === v}
            className={`odx-chip${value === v ? (v ? ' on' : ' on no') : ''}`}
            onClick={() => onChange(value === v ? null : v)}
          >{l}</button>
        ))}
        {value == null && <i className="odx-unset">ثبت نشده</i>}
      </div>
    </div>
  );
}

/**
 * انتخاب از یک خانوادهٔ وضعیت. `short`: چیپ فقط کلید را نشان می‌دهد («II»،
 * «IIIa») و برچسبِ کامل زیرش می‌آید — شش چیپِ جمله‌ای جا نمی‌شد.
 */
function Choice({ k, kind, label, value, onChange, short = false }) {
  const opts = useStatusList(kind);
  const cur = opts.find((o) => o.key === value);
  return (
    <div className="odx-row" data-od={k}>
      <span className="odx-label">{label}</span>
      <div className="odx-chips" role="radiogroup" aria-label={label}>
        {opts.map((o) => (
          <button
            key={o.key} type="button" role="radio" aria-checked={value === o.key}
            title={o.label}
            className={`odx-chip${value === o.key ? ' on' : ''}`}
            onClick={() => onChange(value === o.key ? '' : o.key)}
          >{short ? <span dir="ltr">{o.key}</span> : o.label}</button>
        ))}
      </div>
      {short && cur && <p className="odx-hint">{cur.label}</p>}
    </div>
  );
}

function Text({ k, label, value, onChange, placeholder, rows = 0, max }) {
  return (
    <label className="odx-row odx-text" data-od={k}>
      <span className="odx-label">{label}</span>
      {rows
        ? <textarea rows={rows} value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <input type="text" value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

/**
 * قابِ نقش — همان «بخشِ …»ِ فیلدهای هسته (`db-rolebox`) ولی برای بلوکی که
 * مالکش را از فیلدِ دیگری قرض می‌گیرد. `<fieldset disabled>` همه‌چیز را بومی قفل می‌کند.
 */
function Frame({ id, title, role, locked, note, children }) {
  return (
    <fieldset className={`odx${locked ? ' locked' : ''}`} data-opdetails={id} disabled={locked || undefined}>
      <legend>
        {title}
        {role && <i>بخشِ {role}{locked ? ' — فقط‌خواندنی' : ''}</i>}
      </legend>
      {note && <p className="odx-note">{note}</p>}
      {children}
    </fieldset>
  );
}

/** ارزیابیِ پیش از عمل — تبِ «قبل از عمل». مالک: فیلدِ «نوعِ بیهوشی». */
export function OpPreBlock({ ops, onSet, role, locked, note }) {
  const s = (k) => (v) => onSet(k, v);
  return (
    <Frame id="pre" title="ارزیابیِ پیش از عمل" role={role} locked={locked} note={note}>
      <Choice k="asaClass" kind="asa" label="کلاسِ ASA" value={ops.asaClass} onChange={s('asaClass')} short />
      {ops.asaClass && (
        <YesNo k="asaEmergency" label="اورژانس (E)" value={ops.asaEmergency} onChange={s('asaEmergency')} />
      )}
      <YesNo k="consentSigned" label="رضایت‌نامه امضا شده" value={ops.consentSigned} onChange={s('consentSigned')} />
      <YesNo k="npoConfirmed" label="ناشتایی تأیید شده" value={ops.npoConfirmed} onChange={s('npoConfirmed')} />
      <Choice k="anticoagulant" kind="anticoag" label="ضدانعقاد / ضدپلاکت" value={ops.anticoagulant} onChange={s('anticoagulant')} />
      {(ops.anticoagulant && ops.anticoagulant !== 'none') || ops.anticoagNote ? (
        <Text k="anticoagNote" label="دارو و آخرین دوز" value={ops.anticoagNote} onChange={s('anticoagNote')} max={200}
              placeholder="مثلاً آسپرین — آخرین دوز ۵ روز پیش" />
      ) : null}
    </Frame>
  );
}

/** تیم و جزئیاتِ حینِ عمل — تبِ «حینِ عمل» و میزِ اتاقِ عمل. مالک: «شرحِ عمل». */
export function OpIntraBlock({ ops, onSet, role, locked, note }) {
  const s = (k) => (v) => onSet(k, v);
  return (
    <Frame id="intra" title="تیم و جزئیاتِ عمل" role={role} locked={locked} note={note}>
      <div className="odx-pair">
        <Text k="assistantSurgeonName" label="کمک‌جراح" value={ops.assistantSurgeonName} onChange={s('assistantSurgeonName')} max={120} />
        <Text k="anesthesiologistName" label="متخصصِ بیهوشی" value={ops.anesthesiologistName} onChange={s('anesthesiologistName')} max={120} />
      </div>
      <YesNo k="performedAsPlanned" label="طبقِ برنامه انجام شد" value={ops.performedAsPlanned} onChange={s('performedAsPlanned')}
             no="خیر — تغییر کرد" />
      <label className="odx-row odx-text odx-num" data-od="bloodLossMl">
        <span className="odx-label">خون‌ریزیِ تخمینی (میلی‌لیتر)</span>
        <input dir="ltr" inputMode="numeric" value={ops.bloodLossMl} maxLength={6}
               onChange={(e) => onSet('bloodLossMl', e.target.value)} placeholder="۰ تا ۲۰۰۰۰" />
      </label>
      <YesNo k="specimenSent" label="نمونه به پاتولوژی رفت" value={ops.specimenSent} onChange={s('specimenSent')} />
      {(ops.specimenSent === true || ops.specimenNote) && (
        <Text k="specimenNote" label="شرحِ نمونه" value={ops.specimenNote} onChange={s('specimenNote')} max={500} />
      )}
      <YesNo k="drainPlaced" label="درن گذاشته شد" value={ops.drainPlaced} onChange={s('drainPlaced')} />
      {(ops.drainPlaced === true || ops.drainNote) && (
        <Text k="drainNote" label="شرحِ درن" value={ops.drainNote} onChange={s('drainNote')} max={500} />
      )}
      <Text k="implantNote" label="ایمپلنت / پروتز" value={ops.implantNote} onChange={s('implantNote')} max={1000} rows={2}
            placeholder="نام، سایز، شمارهٔ سریال یا لات…" />
    </Frame>
  );
}

/**
 * بعد از عمل — عارضه تا ۳۰ روز بعد معلوم می‌شود، پس پس از ترخیص هم باز است.
 * `dxLabel`: تشخیص‌های فعلیِ همین عمل تا «تأییدِ تشخیصِ پس از عمل» روی چیزِ دیدنی زده شود.
 */
export function OpPostBlock({ ops, onSet, role, locked, note, dxLabel }) {
  const s = (k) => (v) => onSet(k, v);
  return (
    <Frame id="post" title="پیامدِ عمل" role={role} locked={locked} note={note}>
      <div className="odx-row" data-od="postopDx">
        <span className="odx-label">تشخیصِ پس از عمل</span>
        <p className="odx-dx">{dxLabel || 'تشخیصی روی این عمل ثبت نشده — در بالای فرم انتخابش کنید'}</p>
      </div>
      <YesNo k="postopDxConfirmed" label="یافتهٔ عمل همین تشخیص را تأیید کرد" value={ops.postopDxConfirmed}
             onChange={s('postopDxConfirmed')} no="خیر — تشخیص عوض شد" />
      <YesNo k="complication" label="عارضه" value={ops.complication} onChange={s('complication')} yes="داشت" no="نداشت" />
      {ops.complication === true && (<>
        <Choice k="clavienGrade" kind="clavien" label="درجهٔ عارضه (Clavien–Dindo)" value={ops.clavienGrade} onChange={s('clavienGrade')} short />
        <div className="odx-row" data-od="complicationDate">
          <JDate label="تاریخِ عارضه" value={ops.complicationDate} onChange={s('complicationDate')} placeholder="۱۴۰۵/۰۵/۱۰" />
        </div>
      </>)}
      {/* شرحِ ذخیره‌شده بعد از «نداشت» هم دیدنی و پاک‌شدنی می‌ماند — مثلِ یادداشتِ نمونه و درن (بازبینی). */}
      {(ops.complication === true || !!ops.complicationNote) && (
        <Text k="complicationNote" label="شرحِ عارضه" value={ops.complicationNote} onChange={s('complicationNote')} max={2000} rows={2} />
      )}
    </Frame>
  );
}

/**
 * **سمت و سطحِ هر عمل** — داخلِ گرهِ «نوعِ عمل»، زیرِ چیپ‌ها.
 *
 * ⚠️ هر عمل سمتِ خودش را دارد نه کلِ مراجعه: «زانوی راست + زانوی چپ» دو عمل‌اند،
 * و یک سمتِ مشترک یعنی جراح دوباره «محلِ اشتباه» را از حافظه بخواند.
 * @param items `[{id, name}]` به ترتیبِ فهرستِ فرم (اصلی اول).
 * @param sides `{[id]: {side, level}}`
 */
export function ProcedureSides({ items, sides, onChange, disabled, note }) {
  const opts = useStatusList('side');
  if (!items.length) return null;
  const set = (id, patch) => onChange({ ...sides, [id]: { side: '', level: '', ...sides[id], ...patch } });
  return (
    <div className="odx-sides" data-proc-sides>
      <span className="odx-label">سمت و سطحِ عمل</span>
      {note && <p className="odx-note">{note}</p>}
      {items.map((p) => {
        const cur = sides[p.id] ?? { side: '', level: '' };
        return (
          <div key={p.id} className="odx-side" data-proc-side={p.id}>
            <b>{p.name}</b>
            <div className="odx-chips" role="radiogroup" aria-label={`سمتِ ${p.name}`}>
              {opts.map((o) => (
                <button
                  key={o.key} type="button" role="radio" aria-checked={cur.side === o.key} disabled={disabled}
                  className={`odx-chip${cur.side === o.key ? ' on' : ''}`}
                  onClick={() => set(p.id, { side: cur.side === o.key ? '' : o.key })}
                >{o.label}</button>
              ))}
            </div>
            <input
              type="text" className="odx-level" value={cur.level} maxLength={60} disabled={disabled}
              aria-label={`سطح یا ناحیهٔ ${p.name}`} placeholder="سطح / ناحیه — مثلاً L4–L5"
              onChange={(e) => set(p.id, { level: e.target.value })}
            />
          </div>
        );
      })}
    </div>
  );
}

/** نمای سرور (`procedures` با side/level) → `{[id]: {side, level}}`. */
export function sidesInit(procedures) {
  const out = {};
  for (const p of procedures ?? []) {
    if (p.id != null && (p.side || p.level)) out[p.id] = { side: p.side ?? '', level: p.level ?? '' };
  }
  return out;
}

/**
 * ردیف‌های تغییرکردهٔ سمت/سطح — فقط عمل‌های **حاضر** در فهرستِ فرم.
 * ردیفِ «هر دو خالی» یعنی «پاکش کن» (سرور حذفش می‌کند). عملِ برداشته‌شده
 * را سرور خودش هرس می‌کند؛ این‌جا فرستاده نمی‌شود.
 */
export function sidesDiff(sides, initialSides, ids) {
  const rows = [];
  for (const id of ids) {
    const a = sides[id] ?? {};
    const b = initialSides[id] ?? {};
    const side = a.side || null;
    const level = toEnDigits(String(a.level ?? '')).trim() || null;
    if (side === (b.side || null) && level === (toEnDigits(String(b.level ?? '')).trim() || null)) continue;
    rows.push({ procedureTypeId: id, side, level });
  }
  return rows;
}
