import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { faDate } from '../lib/jalali.js';
import { useAuth } from './auth.jsx';
import { useTerms } from './config.jsx';
import VisitForm from './VisitForm.jsx';
import OrderSheet from './OrderSheet.jsx';
import { useVisitDefs } from './visit-defs.js';
import Overlay from '../ui/Overlay.jsx';
import { Calendar, Close, Send } from '../ui/icons.jsx';
import './thing-popups.css';

/**
 * پاپ‌آپِ «همان چیز» — مراجعه، سفارش، یادآوری، نوبت — از هر صفحه‌ای.
 *
 * بازخوردِ مالک (۱۴۰۵/۰۶/۲۹): «وقتی روی این‌ها کلیک می‌کنیم باید پاپ‌آپِ خودشان
 * باز شود، نه اینکه برود توی فرمِ کلی» و «هر جا هشدار می‌زنیم باید معلوم باشد
 * مالِ چیست و با پاپ‌آپ باز شود که بشود انجامش داد». پرونده (بستهٔ ۲) این را
 * داشت؛ صفحهٔ «امروز» و «کارهای من» همان را می‌خواستند. یک نسخه، سه صفحه —
 * وگرنه فردا «بررسی شد» در یکی کار می‌کرد و در دیگری نه.
 *
 * دو تکه:
 *  - `useThings()` — وضعیتِ پاپ‌آپِ جاری و `open(spec)` که دادهٔ **کامل** را
 *    همین‌جا می‌خواند (شیتِ سفارش مدرک‌های پاسخ را می‌خواهد، فرمِ مراجعه کلِ
 *    رکورد را) — نه از ردیفِ خلاصه‌ای که رویش کلیک شده.
 *  - `<ThingPopups things={…} />` — میزبانِ خودِ پاپ‌آپ‌ها، یک‌بار پایینِ صفحه.
 *
 * `spec`: `{ type: 'visit', id }` · `{ type: 'order', kind, id, patientId }` ·
 * `{ type: 'reminder', id, patientId, item }` · `{ type: 'appointment', id, item }`.
 */

/** مقصدِ یک کار: سفارشِ زیرِ بررسی یا مراجعه‌ای که کار به آن گره خورده. */
export const workTarget = (w) => {
  const pid = w?.patientId ?? w?.patient?.id ?? null;
  const m = /^(lab|imaging|consult|referral)_order$/.exec(w?.refType ?? '');
  if (m && w.refId) return { type: 'order', kind: m[1], id: w.refId, patientId: pid };
  if (w?.refType === 'visit' && w.refId) return { type: 'visit', id: w.refId, patientId: pid };
  if (w?.visitId) return { type: 'visit', id: w.visitId, patientId: pid };
  return null;
};

/**
 * @param {object} o
 * @param {number|null} [o.patientId] بیمارِ پیش‌فرض (صفحهٔ پرونده)؛ صفحه‌های چندبیماره آن را در `spec` می‌دهند
 * @param {() => any} [o.onChanged] بعد از هر تغییری که پاپ‌آپ ثبت کرد (بازخوانیِ صفحه)
 * @param {(text: string, bad?: boolean) => void} [o.toast]
 */
export function useThings({ patientId = null, onChanged, toast } = {}) {
  const [pop, setPop] = useState(null);
  /* ref، تا `open` با هر رندرِ صفحه (که toast/onChanged را inline می‌سازد) عوض نشود. */
  const cb = useRef({ onChanged, toast });
  useEffect(() => { cb.current = { onChanged, toast }; });

  const open = useCallback(async (spec) => {
    const pid = spec?.patientId ?? patientId;
    try {
      if (spec.type === 'visit') {
        setPop({ type: 'visit', visit: await api(`/visits/${spec.id}`), patientId: pid });
      } else if (spec.type === 'order') {
        if (!pid) throw new Error('بیمارِ این سفارش مشخص نیست');
        const list = await api(`/orders?patientId=${pid}`);
        const o = (Array.isArray(list) ? list : []).find((x) => x.kind === spec.kind && x.id === spec.id);
        if (!o) throw new Error('سفارش پیدا نشد');
        setPop({ type: 'order', kind: spec.kind, order: o, patientId: pid });
      } else if (spec.type === 'reminder') {
        const rows = pid ? await api(`/reminders?patientId=${pid}`).catch(() => []) : [];
        setPop({ type: 'reminder', row: (Array.isArray(rows) ? rows : []).find((x) => x.id === spec.id) ?? null, item: spec.item, patientId: pid });
      } else if (spec.type === 'appointment') {
        setPop({ type: 'appointment', id: spec.id, item: spec.item, patientId: pid });
      }
    } catch (e) { cb.current.toast?.(e.message, true); }
  }, [patientId]);
  const close = useCallback(() => setPop(null), []);
  const changed = useCallback(() => cb.current.onChanged?.(), []);
  const say = useCallback((m, bad) => cb.current.toast?.(m, bad), []);

  return { pop, open, close, show: setPop, changed, say, patientId };
}

/**
 * میزبانِ پاپ‌آپ‌ها. `onVisitSaved` اختیاری است — پرونده با آن رفتارِ خودش
 * (بازخوانیِ کامل + «کاندیدای جراحی») را می‌گذارد؛ بقیه پیش‌فرض را می‌گیرند.
 */
export function ThingPopups({ things, onVisitSaved }) {
  const { pop, close, changed, say, patientId } = things;
  const { user } = useAuth();
  const t = useTerms();
  /* تعریف‌های فرمِ مراجعه تنبل‌اند: تا فرم باز نشود شش فهرست خوانده نمی‌شود. */
  const { defs, reload: loadDefs } = useVisitDefs(pop?.type === 'visit', user?.id);

  return (
    <>
      <AnimatePresence>
        {pop?.type === 'visit' && (
          <VisitForm
            initial={pop.visit}
            prefill={pop.prefill}
            defs={defs}
            onDefsChanged={loadDefs}
            onClose={close}
            onSaved={(saved, wasEdit, opts) => {
              close();
              if (onVisitSaved) { onVisitSaved(saved, wasEdit, opts); return; }
              changed();
              say(wasEdit ? `${t.visit} ویرایش شد ✓` : `${t.visit} ثبت شد ✓`);
            }}
            onToast={(m) => say(m)}
          />
        )}
      </AnimatePresence>
      {/* میزبانِ شیتِ سفارش همیشه سوار است و خودش presence را می‌گرداند. */}
      <OrderSheet
        open={pop?.type === 'order'}
        kind={pop?.kind}
        order={pop?.order}
        patientId={pop?.patientId ?? pop?.order?.patientId ?? patientId ?? undefined}
        visitId={pop?.order?.visitId ?? undefined}
        onClose={close}
        onSaved={changed}
        onToast={(m) => say(m)}
      />
      <AnimatePresence>
        {pop?.type === 'reminder' && <ReminderPop row={pop.row} item={pop.item} onClose={close} onActed={changed} toast={say} />}
        {pop?.type === 'appointment' && <ApptPop id={pop.id} item={pop.item} onClose={close} onActed={changed} toast={say} />}
      </AnimatePresence>
    </>
  );
}

const faNum = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/* ══════════════ یادآوری ══════════════ */
const REM_KIND_FA = {
  next_visit: 'ویزیتِ بعدی', surgery: 'عملِ پیشِ رو', pre_op_care: 'مراقبتِ قبل از عمل', post_op_care: 'مراقبتِ بعد از عمل',
  follow_up: 'فرمِ پیگیری', notice: 'اطلاعیه', dispatch: 'ابلاغِ کارشناس', appointment: 'نوبت',
};
const REM_STATUS_FA = {
  pending: 'در صف', sending: 'در حالِ ارسال', sent: 'فرستاده شد', simulated: 'آزمایشی — فرستاده نشد',
  failed: 'ناموفق', uncertain: 'نتیجه نامعلوم', cancelled: 'لغو شد',
};
/* همان دو فهرستِ صفحهٔ یادآوری‌ها (W0.7): فرستاده‌شده نه دوباره می‌رود نه لغو می‌شود. */
const REM_RETRYABLE = ['failed', 'uncertain', 'simulated'];
const REM_CANCELLABLE = ['pending', 'uncertain', 'failed'];

/**
 * پاپ‌آپِ یک یادآوری — متنِ کامل، وضعیت، علتِ نرفتن، و همان دو اقدامِ دفترِ
 * یادآوری‌ها (ارسالِ دوباره / لغو). `row` از `/reminders?patientId=` می‌آید؛ اگر
 * نیامد (دسترسی)، ردیفِ خلاصهٔ خطِ زمان کافی است تا پاپ‌آپ خالی نماند.
 */
function ReminderPop({ row, item, onClose, onActed, toast }) {
  const [busy, setBusy] = useState(false);
  const r = row ?? { id: item?.refId, status: item?.state, text: item?.detail, dueAt: item?.at, sentAt: null, kind: null, phone: null, error: null };
  const act = async (what) => {
    setBusy(true);
    try {
      await api(`/reminders/${r.id}/${what}`, { method: 'POST', ...(what === 'cancel' ? { body: { reason: 'لغو از پروندهٔ بیمار' } } : {}) });
      toast(what === 'retry' ? 'دوباره در صف نشست ✓' : 'پیام لغو شد ✓');
      await onActed();
      onClose();
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (
    <Overlay backdrop="rc-pop-bg" panel="glass rc-pop rc-pop-reminder" as="section" onClose={onClose} closable={!busy} role="dialog" aria-modal="true" aria-label="یادآوری">
      <header>
        <Send width="15" height="15" />
        <b>یادآوری{r.kind ? ` — ${REM_KIND_FA[r.kind] ?? r.kind}` : ''}</b>
        <button type="button" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>
      <p className="rc-pop-text">{r.text || '—'}</p>
      <dl>
        <dt>وضعیت</dt><dd><em className={`rc-pop-state is-${r.status ?? 'none'}`}>{REM_STATUS_FA[r.status] ?? r.status ?? '—'}</em></dd>
        {(r.sentAt || r.dueAt) && <><dt>{r.status === 'pending' ? 'موعد' : 'زمان'}</dt><dd>{faDate(r.sentAt ?? r.dueAt)}</dd></>}
        {r.phone && <><dt>گیرنده</dt><dd dir="ltr">{faNum(r.phone)}</dd></>}
        {r.error && <><dt>علت</dt><dd className="rc-pop-err">{r.error}</dd></>}
      </dl>
      {(REM_RETRYABLE.includes(r.status) || REM_CANCELLABLE.includes(r.status)) && (
        <div className="rc-pop-acts">
          {REM_RETRYABLE.includes(r.status) && <button type="button" className="rc-pop-main" disabled={busy} onClick={() => act('retry')}>ارسالِ دوباره</button>}
          {REM_CANCELLABLE.includes(r.status) && <button type="button" className="rc-pop-ghost" disabled={busy} onClick={() => act('cancel')}>لغوِ این پیام</button>}
        </div>
      )}
    </Overlay>
  );
}

/* ══════════════ نوبت ══════════════ */
const APPT_STATUS_FA = { held: 'در انتظارِ پرداخت', confirmed: 'قطعی', arrived: 'در مطب', done: 'انجام شد', noshow: 'نیامد', cancelled: 'لغو شد' };
/* همان کلیدهای `CANCEL_REASONS` سرور — دلیلِ لغو به بیمار پیامک می‌شود. */
const APPT_CANCEL = { doctor: 'تعویقِ پزشک', patient: 'درخواستِ بیمار', clinical: 'شرایطِ بالینی', hospital: 'مشکلِ بیمارستان', other: 'سایر' };

/** پاپ‌آپِ یک نوبت — جزئیات + تغییرِ وضعیت (همان `POST /appointments/:id/status` میزِ پذیرش). */
function ApptPop({ id, item, onClose, onActed, toast }) {
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('patient');
  const st = item?.state;
  const open = !['done', 'cancelled', 'noshow'].includes(st);
  const set = async (status, extra = {}) => {
    setBusy(true);
    try {
      await api(`/appointments/${id}/status`, { method: 'POST', body: { status, ...extra } });
      toast('وضعیتِ نوبت ثبت شد ✓');
      await onActed();
      onClose();
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (
    <Overlay backdrop="rc-pop-bg" panel="glass rc-pop rc-pop-appt" as="section" onClose={onClose} closable={!busy} role="dialog" aria-modal="true" aria-label="نوبت">
      <header>
        <Calendar width="15" height="15" />
        <b>{item?.title ?? 'نوبت'}</b>
        <button type="button" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>
      <dl>
        {item?.at && <><dt>تاریخ</dt><dd>{faDate(item.at)}{item.detail ? ` · ${faNum(item.detail)}` : ''}</dd></>}
        <dt>وضعیت</dt><dd><em className={`rc-pop-state is-${st ?? 'none'}`}>{APPT_STATUS_FA[st] ?? item?.stateFa ?? '—'}</em></dd>
      </dl>
      {open && !cancelling && (
        <div className="rc-pop-acts">
          {st !== 'confirmed' && st !== 'arrived' && <button type="button" className="rc-pop-ghost" disabled={busy} onClick={() => set('confirmed')}>قطعی شد</button>}
          {st !== 'arrived' && <button type="button" className="rc-pop-main" disabled={busy} onClick={() => set('arrived')}>بیمار رسید</button>}
          <button type="button" className="rc-pop-ghost" disabled={busy} onClick={() => set('noshow')}>نیامد</button>
          <button type="button" className="rc-pop-ghost" disabled={busy} onClick={() => setCancelling(true)}>لغوِ نوبت…</button>
        </div>
      )}
      {open && cancelling && (
        <div className="rc-pop-field">
          <span>دلیلِ لغو — به بیمار پیامک می‌شود</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy}>
            {Object.entries(APPT_CANCEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <div className="rc-pop-acts">
            <button type="button" className="rc-pop-main" disabled={busy} onClick={() => set('cancelled', { cancelReason: reason })}>لغوِ نوبت</button>
            <button type="button" className="rc-pop-ghost" disabled={busy} onClick={() => setCancelling(false)}>انصراف</button>
          </div>
        </div>
      )}
      <Link to="/app/schedule" className="rc-pop-link">بازکردن در برنامهٔ نوبت‌ها</Link>
    </Overlay>
  );
}
