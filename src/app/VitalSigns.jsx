import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { toEnDigits } from '../lib/identity.js';
import { useConfig } from './config.jsx';
import { Plus, Trash } from '../ui/icons.jsx';
import './vital-signs.css';

/**
 * **علائمِ حیاتی** — اختیاری، در ویزیت و در قبل/بعدِ عمل (بستهٔ ۶ج).
 *
 * دو حالت، یک ظاهر:
 * - **پیش‌نویس** (مراجعه هنوز ذخیره نشده): مقادیر در `draft`ِ والد می‌مانند و
 *   همراهِ ثبتِ مراجعه می‌روند — منشی‌ای که فشار را پیش از پزشک می‌گیرد نباید
 *   اول «ذخیره» بزند.
 * - **ذخیره‌شده**: هر «ثبت» یک نوبتِ اندازه‌گیریِ تازه است و فهرستِ نوبت‌های
 *   قبلی بالایش می‌ماند؛ اندازهٔ غلط حذف می‌شود، بازنویسی نه.
 *
 * ⚠️ واحد، بازه و برچسب از `/config.vitals` می‌آیند — همان کاتالوگی که سرور با
 * آن می‌سنجد (`vitals.ts`). بازهٔ این‌جا فقط راهنمای `placeholder` است؛ پیامِ
 * خطای واقعی از سرور می‌رسد تا دو قاعده از هم نیفتند.
 */
const FA = '۰۱۲۳۴۵۶۷۸۹';
const fa = (v) => (v == null ? '' : String(v).replace(/\d/g, (d) => FA[d]).replace('.', '٫'));
/* ساختنِ فرمتر گران است؛ یک‌بار در سطحِ ماژول. */
const TIME_FMT = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' });
const DATE_FMT = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: 'numeric', day: 'numeric' });

const EMPTY = { bpSys: '', bpDia: '', hr: '', rr: '', temp: '', spo2: '', weight: '', height: '', pain: '' };
const clean = (v) => toEnDigits(String(v ?? '')).replace(/[٫,]/g, '.').replace(/[^0-9.]/g, '');

/** خلاصهٔ یک نوبت برای ردیفِ فهرست — فقط اندازه‌های پرشده. */
function summary(r, byGroup) {
  const parts = [];
  if (r.bpSys != null) parts.push(`${byGroup.bp?.label ?? ''} ${fa(r.bpSys)}/${fa(r.bpDia)}`);
  for (const g of ['hr', 'rr', 'temp', 'spo2', 'weight', 'height', 'pain', 'bmi']) {
    if (r[g] == null) continue;
    const meta = byGroup[g];
    parts.push(`${meta?.label ?? g} ${fa(r[g])}${meta?.unit && g !== 'bmi' ? ` ${meta.unit}` : ''}`);
  }
  return parts;
}

/**
 * @param pending/onPending اندازه‌گیریِ **تایپ‌شده ولی «ثبت»‌نخورده** در مراجعهٔ ذخیره‌شده —
 *   کنترل‌شده از والد، تا «ذخیرهٔ تغییرات»ِ فرم همراهِ خودش ثبتش کند (بازبینیِ ۱۴۰۵/۰۷/۰۳:
 *   تا دیروز بی‌صدا دور ریخته می‌شد) و جابه‌جاییِ تبِ قبل/بعد از عمل پاکش نکند.
 */
export default function VitalSigns({ visitId, phase = null, draft, onDraft, pending, onPending, onCount, disabled, onToast }) {
  const { vitals: catalog = [] } = useConfig();
  const byKey = Object.fromEntries(catalog.map((c) => [c.key, c]));
  const byGroup = Object.fromEntries(catalog.map((c) => [c.group, c]));
  byGroup.bmi = { label: 'BMI', unit: '' };

  const saved = !!visitId;
  const [rows, setRows] = useState(null);
  const [ownEntry, setOwnEntry] = useState(EMPTY);
  const controlled = typeof onPending === 'function';
  const entry = controlled ? { ...EMPTY, ...(pending ?? {}) } : ownEntry;
  const setEntry = (fn) => {
    const next = typeof fn === 'function' ? fn(entry) : fn;
    if (!controlled) { setOwnEntry(next); return; }
    const any = Object.entries(next).some(([k, v]) => k !== 'phase' && String(v ?? '').trim() !== '');
    onPending(any ? { ...next, ...(phase ? { phase } : {}) } : null);
  };
  const [busy, setBusy] = useState(false);
  const values = saved ? entry : { ...EMPTY, ...(draft ?? {}) };

  const load = useCallback(() => {
    if (!visitId) return;
    api(`/visits/${visitId}/vitals`)
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch(() => setRows([]));
  }, [visitId]);
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => {
    const v = clean(e.target.value);
    if (saved) setEntry((s) => ({ ...s, [k]: v }));
    else onDraft?.({ ...values, [k]: v, ...(phase ? { phase } : {}) });
  };

  const add = async () => {
    const body = Object.fromEntries(Object.entries(entry).filter(([, v]) => String(v).trim() !== ''));
    if (!Object.keys(body).length) { onToast?.('دستِ‌کم یکی از اندازه‌ها را بنویسید'); return; }
    setBusy(true);
    try {
      await api(`/visits/${visitId}/vitals`, { method: 'POST', body: { ...body, ...(phase ? { phase } : {}) } });
      setEntry(EMPTY);
      load();
      onToast?.('علائمِ حیاتی ثبت شد');
    } catch (e) {
      onToast?.(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r) => {
    setBusy(true);
    try {
      await api(`/visits/${visitId}/vitals/${r.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      onToast?.(e.message);
    } finally {
      setBusy(false);
    }
  };

  const shown = (rows ?? []).filter((r) => (phase ? r.phase === phase : true));
  /* شمارِ اندازه‌گیری‌های ثبت‌شده به والد — «×»ِ کارتِ زیرفرم فقط وقتی خالی است. */
  const countRef = useRef(onCount);
  countRef.current = onCount;
  useEffect(() => { if (rows) countRef.current?.(shown.length); }, [rows, shown.length]);
  const num = (k, extra = {}) => {
    const c = byKey[k];
    return (
      <input
        type="text" inputMode="decimal" dir="ltr" autoComplete="off"
        value={values[k] ?? ''} onChange={set(k)} disabled={disabled || busy}
        placeholder={c ? `${fa(c.min)}–${fa(c.max)}` : ''}
        aria-label={c ? `${c.label}${k === 'bpDia' ? ' — دیاستولیک' : k === 'bpSys' ? ' — سیستولیک' : ''}` : k}
        data-vital={k}
        {...extra}
      />
    );
  };
  const cell = (group, keys) => {
    const c = byGroup[group];
    if (!c) return null;
    return (
      <label className="vs-cell" key={group}>
        <span>{c.label}</span>
        <span className="vs-in">
          {keys.length === 2 ? (<>{num(keys[0])}<i aria-hidden="true">/</i>{num(keys[1])}</>) : num(keys[0])}
          {c.unit && <em>{c.unit}</em>}
        </span>
      </label>
    );
  };

  return (
    <div className="vs-box" data-vitals={phase ?? 'visit'}>
      <div className="vs-head">
        <b>علائمِ حیاتی</b>
        <i>اختیاری</i>
      </div>
      {saved && shown.length > 0 && (
        <ul className="vs-rows">
          {shown.map((r) => (
            <li key={r.id} data-vital-row={r.id}>
              <time>{DATE_FMT.format(new Date(r.takenAt))} · {TIME_FMT.format(new Date(r.takenAt))}</time>
              <span>{summary(r, byGroup).join(' · ')}</span>
              {r.recordedByName && <small>{r.recordedByName}</small>}
              <button type="button" className="vs-del" disabled={disabled || busy} onClick={() => remove(r)} aria-label="حذفِ این اندازه‌گیری">
                <Trash width="14" height="14" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="vs-grid">
        {cell('bp', ['bpSys', 'bpDia'])}
        {cell('hr', ['hr'])}
        {cell('rr', ['rr'])}
        {cell('temp', ['temp'])}
        {cell('spo2', ['spo2'])}
        {cell('weight', ['weight'])}
        {cell('height', ['height'])}
        {cell('pain', ['pain'])}
      </div>
      {saved && (
        <button type="button" className="vs-add" disabled={disabled || busy} onClick={add}>
          <Plus width="14" height="14" /> ثبتِ اندازه‌گیری
        </button>
      )}
    </div>
  );
}
