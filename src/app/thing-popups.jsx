import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { api, apiUpload } from '../lib/api.js';
import { faDate } from '../lib/jalali.js';
import { useAuth } from './auth.jsx';
import { useConfig, useTerms, useStatusMap } from './config.jsx';
import VisitForm, { surgeryPrefill } from './VisitForm.jsx';
import OrderSheet from './OrderSheet.jsx';
import { useVisitDefs } from './visit-defs.js';
import { targetForKind } from './work-target.js';
import Overlay from '../ui/Overlay.jsx';
import FileDrop from '../ui/FileDrop.jsx';
import { Calendar, Close, Send, Upload } from '../ui/icons.jsx';
import './thing-popups.css';

/* پرونده همین سازنده را از همین‌جا می‌گیرد — هر دو فرمِ عمل را از یک میزبان باز می‌کنند. */
export { surgeryPrefill };
/* مقصدِ کار در فایلِ سبکِ خودش است (زنگِ پوسته هم می‌خواندش)؛ صفحه‌ها از همین‌جا می‌گیرند. */
export { workTarget } from './work-target.js';

/* پاپ‌آپ‌های «خودِ کار» که صفحهٔ دیگری صاحبشان است — **همان** پنجره، نه نسخهٔ دوم:
   وضعیتِ عمل از پنلِ کارشناس، تأییدِ ثبت‌نام از صفحهٔ پذیرش. تنبل، چون فقط وقتی
   کسی رویشان می‌زند لازم‌اند و CSSِ صفحهٔ صاحبشان هم با همان چانک می‌آید (قانونِ ۲۱). */
const StatusSheet = lazy(() => import('./Tech.jsx').then((m) => ({ default: m.StatusSheet })));
const ApproveSheet = lazy(() => import('./Intake.jsx').then((m) => ({ default: m.ApproveSheet })));
const ReceiptZoom = lazy(() => import('./Intake.jsx').then((m) => ({ default: m.ReceiptZoom })));

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
 * `{ type: 'reminder', id, patientId, item }` · `{ type: 'appointment', id, item }` ·
 * و سه مقصدِ «خودِ کار» (`work-target.js`، بازبینیِ UX company-01):
 * `{ type: 'opstatus', id, visit, patientName }` — انجام شد / موکول / لغو ·
 * `{ type: 'report', id, visit, patientName }` — بارگذاریِ گزارشِ خدمت ·
 * `{ type: 'intake', id }` — پنجرهٔ تأییدِ همان ثبت‌نام.
 */

/** خلاصهٔ مراجعه برای پنجرهٔ وضعیت/گزارش — همان شکلی که کارتِ پنلِ کارشناس دارد. */
const visitBrief = (spec) => ({
  id: spec.id,
  patientName: spec.patientName ?? '',
  code: spec.visit?.code ?? '',
  opDate: spec.visit?.opDate ?? null,
  procedure: spec.visit?.procedure ?? null,
});

/**
 * @param {object} o
 * @param {number|null} [o.patientId] بیمارِ پیش‌فرض (صفحهٔ پرونده)؛ صفحه‌های چندبیماره آن را در `spec` می‌دهند
 * @param {() => any} [o.onChanged] بعد از هر تغییری که پاپ‌آپ ثبت کرد (بازخوانیِ صفحه)
 * @param {(text: string, bad?: boolean) => void} [o.toast]
 */
export function useThings({ patientId = null, onChanged, toast } = {}) {
  const [pop, setPop] = useState(null);
  const { kind } = useConfig();
  /* ref، تا `open` با هر رندرِ صفحه (که toast/onChanged را inline می‌سازد) عوض نشود. */
  const cb = useRef({ onChanged, toast });
  useEffect(() => { cb.current = { onChanged, toast }; });

  const open = useCallback(async (raw) => {
    /* مطب پنلِ کارشناس و «گزارشِ خدمت» ندارد — وضعیت و شرحِ عملش در همان فرمِ عمل است. */
    const spec = targetForKind(raw, kind);
    const pid = spec?.patientId ?? patientId;
    try {
      if (spec.type === 'opstatus') {
        setPop({ type: 'opstatus', visit: visitBrief(spec) });
      } else if (spec.type === 'report') {
        setPop({ type: 'report', visit: visitBrief(spec) });
      } else if (spec.type === 'intake') {
        /* ردیفِ کاملِ همان ثبت‌نام — پنجرهٔ تأیید مدارک، فیش و پیشنهادِ ارجاع‌ها را از آن می‌خواند. */
        const find = async (status) => {
          const rows = await api(`/intake/submissions?status=${status}`);
          return (Array.isArray(rows) ? rows : []).find((x) => x.id === spec.id) ?? null;
        };
        const row = (await find('pending_approval')) ?? (await find('all'));
        if (!row) throw new Error('این ثبت‌نام پیدا نشد');
        if (row.status !== 'pending_approval') throw new Error('این ثبت‌نام دیگر منتظرِ تأیید نیست — در صفحهٔ «پذیرش» ببینید');
        setPop({ type: 'intake', row });
      } else if (spec.type === 'visit') {
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
  }, [patientId, kind]);
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
  const { pop, open, close, changed, say, patientId } = things;
  const { user } = useAuth();
  const t = useTerms();
  /* تعریف‌های فرمِ مراجعه تنبل‌اند: تا فرم باز نشود شش فهرست خوانده نمی‌شود. */
  const { defs, reload: loadDefs } = useVisitDefs(pop?.type === 'visit', user?.id);
  /* بزرگ‌نماییِ فیش از داخلِ پنجرهٔ تأییدِ ثبت‌نام — همان کاری که صفحهٔ پذیرش می‌کند. */
  const [zoom, setZoom] = useState(null);
  /* بعد از انجامِ خودِ کار: پنجره بسته، صفحه تازه (کار با رویدادِ واقعی‌اش از فهرست می‌رود). */
  const finished = (m) => { close(); changed(); if (m) say(m); };

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
              /* «کاندیدای جراحی» — همان قولِ فرم («بعد از ذخیره، فرمِ عملِ همین بیمار
                 باز می‌شود») که داشبورد و پرونده نگه می‌دارند. بی این، «+»ِ امروز ویزیتِ
                 تصمیم را می‌بست و عملِ بعدی به آن گره نمی‌خورد (`decidedInVisitId`
                 فقط از همین prefill می‌آید). مکث تا فرمِ قبلی پیاده شود و این یکی
                 با وضعیتِ تازه سوار شود. */
              if (opts?.openSurgery && saved?.id) {
                say('تصمیم ثبت شد ✓ حالا فرمِ عمل را برای همین بیمار پر کنید');
                setTimeout(() => things.show({ type: 'visit', prefill: surgeryPrefill(saved) }), 400);
                return;
              }
              const word = saved?.kind === 'surgery' ? t.surgery : t.visit;
              say(wasEdit ? `${word} ویرایش شد ✓` : `${word} ثبت شد ✓`);
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
      {/* «خودِ کار» — وضعیتِ عمل، گزارشِ خدمت، تأییدِ ثبت‌نام. */}
      <Suspense fallback={null}>
        <AnimatePresence>
          {pop?.type === 'opstatus' && (
            <StatusSheet key="opstatus" visit={pop.visit} onClose={close} onSaved={finished} />
          )}
          {pop?.type === 'intake' && (
            <ApproveSheet
              key="intake"
              row={pop.row}
              onClose={close}
              onDone={finished}
              onZoom={setZoom}
              onChanged={changed}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {zoom && <ReceiptZoom key="zoom" url={zoom} onClose={() => setZoom(null)} />}
        </AnimatePresence>
      </Suspense>
      <AnimatePresence>
        {pop?.type === 'report' && <ReportPop visit={pop.visit} onClose={close} onDone={finished} />}
      </AnimatePresence>
      <AnimatePresence>
        {pop?.type === 'reminder' && <ReminderPop row={pop.row} item={pop.item} onClose={close} onActed={changed} toast={say} />}
        {pop?.type === 'appointment' && (
          <ApptPop
            id={pop.id} item={pop.item} onClose={close} onActed={changed} toast={say}
            /* «شروعِ ویزیت» در همین پاپ‌آپ تمام می‌شود: فرمِ همان مراجعه
               بلافاصله باز می‌شود، نه اینکه کاربر به صفحهٔ دیگری پرت شود. */
            onStarted={(visitId, pid) => open({ type: 'visit', id: visitId, patientId: pid ?? patientId })}
          />
        )}
      </AnimatePresence>
    </>
  );
}

const faNum = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/* ══════════════ گزارشِ خدمت ══════════════ */
/**
 * **بارگذاریِ گزارشِ خدمت** از خودِ کارِ «گزارشِ خدمت هنوز بارگذاری نشده» — همان مسیرِ
 * دکمهٔ پنلِ کارشناس (`POST /tech/visits/:id/report`) و همان کادرِ مشترکِ `FileDrop`
 * (چندصفحه‌ای، با صف و تلاشِ دوباره). رویدادِ `report.uploaded` کار را می‌بندد؛ بعد از
 * آخرین فایل پنجره بسته و فهرست تازه می‌شود.
 */
function ReportPop({ visit, onClose, onDone }) {
  const t = useTerms();
  const [busy, setBusy] = useState(false);
  const send = async (file) => {
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    try { await apiUpload(`/tech/visits/${visit.id}/report`, fd); } finally { setBusy(false); }
  };
  return (
    <Overlay backdrop="rc-pop-bg" panel="glass rc-pop rc-pop-report" as="section" onClose={onClose} closable={!busy} role="dialog" aria-modal="true" aria-label={t.workReport}>
      <header>
        <Upload width="15" height="15" />
        <b>{t.workReport}{visit.patientName ? ` — ${visit.patientName}` : ''}</b>
        <button type="button" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>
      {(visit.code || visit.opDate) && (
        <dl>
          <dt>{t.surgery}</dt>
          <dd>
            {visit.opDate ? faDate(visit.opDate) : ''}
            {visit.code && <>{visit.opDate ? ' · ' : ''}<bdi dir="ltr">{visit.code}</bdi></>}
            {visit.procedure ? ` · ${visit.procedure}` : ''}
          </dd>
        </dl>
      )}
      <FileDrop
        accept="image/*,application/pdf"
        label={`انتخابِ فایلِ ${t.workReport}`}
        hint="عکس یا PDF؛ گزارشِ چندصفحه‌ای را یک‌جا انتخاب کنید."
        onUpload={send}
        onAllDone={() => onDone(`${t.workReport} ثبت شد`)}
      />
    </Overlay>
  );
}

/* ══════════════ یادآوری ══════════════ */
/* ⚠️ دو نگاشتِ فارسیِ یادآوری برداشته شدند. کپیِ دومِ دفترِ یادآوری‌ها بودند
   و **هر هفت کلید** فرق داشت («فرستاده شد» این‌جا، «ارسال ثبت شد» آن‌جا)؛
   نوعش هم («عملِ پیشِ رو» در برابرِ «عملِ پیشِ‌رو») با یک نیم‌فاصله واگرا
   شده بود. حالا هر دو از `/config.statuses.reminder{,Kind}` می‌آیند. */
/* همان دو فهرستِ صفحهٔ یادآوری‌ها (W0.7): فرستاده‌شده نه دوباره می‌رود نه لغو می‌شود. */
const REM_RETRYABLE = ['failed', 'uncertain', 'simulated'];
const REM_CANCELLABLE = ['pending', 'uncertain', 'failed'];

/**
 * پاپ‌آپِ یک یادآوری — متنِ کامل، وضعیت، علتِ نرفتن، و همان دو اقدامِ دفترِ
 * یادآوری‌ها (ارسالِ دوباره / لغو). `row` از `/reminders?patientId=` می‌آید؛ اگر
 * نیامد (دسترسی)، ردیفِ خلاصهٔ خطِ زمان کافی است تا پاپ‌آپ خالی نماند.
 */
function ReminderPop({ row, item, onClose, onActed, toast }) {
  const remFa = useStatusMap('reminder');
  const remKindFa = useStatusMap('reminderKind');
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
        <b>یادآوری{r.kind ? ` — ${r.kindFa ?? remKindFa[r.kind] ?? r.kind}` : ''}</b>
        <button type="button" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>
      <p className="rc-pop-text">{r.text || '—'}</p>
      <dl>
        <dt>وضعیت</dt><dd><em className={`rc-pop-state is-${r.status ?? 'none'}`}>{r.statusFa ?? remFa[r.status] ?? r.status ?? '—'}</em></dd>
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
/* ⚠️ نگاشتِ محلی برداشته شد: `item.stateFa` از قبل از سرور می‌آمد و همین‌جا
   fallback بود — یعنی کپی هیچ‌وقت لازم نبود، فقط می‌توانست واگرا شود. */
/* همان کلیدهای `CANCEL_REASONS` سرور — دلیلِ لغو به بیمار پیامک می‌شود. */
const APPT_CANCEL = { doctor: 'تعویقِ پزشک', patient: 'درخواستِ بیمار', clinical: 'شرایطِ بالینی', hospital: 'مشکلِ بیمارستان', other: 'سایر' };

/**
 * **پاپ‌آپِ یک نوبت** — جزئیات + همان دکمه‌هایی که میزِ پذیرش دارد.
 *
 * ⚠️ دو باگِ واقعی که این نسخه برایشان بازنویسی شد:
 *
 * ۱) **دکمه‌ها کپیِ کلاینتیِ ماشینِ وضعیت بودند** و با سرور یکی نبودند. بدتر
 *    از ناهماهنگی: `open = !['done','cancelled','noshow'].includes(st)` یعنی
 *    بیماری که منشی اشتباهی «نیامد» زده، از پروندهٔ بیمار و میزِ پزشک **هیچ
 *    راهِ برگشتی** نداشت — در حالی که `APPT_TRANSITIONS.noshow = ['confirmed']`
 *    سرور دقیقاً همان برگشت را مجاز می‌داند و میزِ پذیرش دکمه‌اش را دارد.
 *
 * ۲) **مسیرِ سرورش سطحِ سوپروایزر می‌خواست.** `POST /appointments/:id/status`
 *    زیرِ `@Feature('calendar')` است؛ ولی این پاپ‌آپ از **میزِ پزشک** و
 *    **پروندهٔ بیمار** هم باز می‌شود، جایی که کاربر سطحِ کارشناس دارد. یعنی
 *    دکمه را می‌دید و با زدنش ۴۰۳ می‌گرفت. حالا مسیر `frontdesk` است (سطحِ
 *    کارشناس) — همان دری که خودِ منشی از آن می‌رود.
 *
 * ⚠️ اگر خواندنِ نوبت نشد (نبودِ مجوز/شبکه)، **هیچ دکمه‌ای ساخته نمی‌شود** و
 * پاپ‌آپ فقط جزئیات را نشان می‌دهد. برگرداندنِ همان کپیِ کلاینتی به‌عنوان
 * fallback یعنی همان دو باگ از درِ پشتی برگردند.
 */
function ApptPop({ id, item, onClose, onActed, toast, onStarted }) {
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('patient');
  const [row, setRow] = useState(null);
  const t = useTerms();

  /* `false` یعنی «خوانده شد و نشد» و `null` یعنی «هنوز نیامده» — دو حالتِ
     متفاوت: اولی باید پیام بدهد، دومی باید ساکت بماند. */
  useEffect(() => {
    let alive = true;
    api(`/frontdesk/appointments/${id}`)
      .then((r) => { if (alive) setRow(r); })
      .catch(() => { if (alive) setRow(false); });
    return () => { alive = false; };
  }, [id]);

  const st = row?.status ?? item?.state;
  const stFa = row?.statusLabel ?? item?.stateFa ?? st ?? '—';
  const set = async (status, extra = {}) => {
    setBusy(true);
    try {
      await api(`/frontdesk/appointments/${id}/status`, { method: 'POST', body: { status, ...extra } });
      toast('وضعیتِ نوبت ثبت شد ✓');
      await onActed();
      onClose();
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  const start = async () => {
    setBusy(true);
    try {
      const r = await api(`/frontdesk/appointments/${id}/start`, { method: 'POST' });
      await onActed();
      onClose();
      onStarted?.(r.visitId, row?.patientId ?? null);
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
        <dt>وضعیت</dt><dd><em className={`rc-pop-state is-${st ?? 'none'}`}>{stFa}</em></dd>
      </dl>
      {row === false && <p className="rc-pop-note">تغییرِ وضعیتِ نوبت در دسترسِ شما نیست.</p>}
      {row && !cancelling && (
        <div className="rc-pop-acts">
          {/* ترتیب عمدی است: «شروعِ ویزیت» کارِ اصلی است، بقیه گذارِ وضعیت. */}
          {row.visitId ? (
            <button type="button" className="rc-pop-main" disabled={busy}
              onClick={() => { onClose(); onStarted?.(row.visitId, row.patientId); }}>{t.visitOpen}</button>
          ) : row.canStart ? (
            <button type="button" className="rc-pop-main" disabled={busy} onClick={start}>{t.visitStart}</button>
          ) : null}
          {(row.nextOptions ?? []).map((o) => (
            <button key={o.status} type="button" className="rc-pop-ghost" disabled={busy}
              onClick={() => (o.status === 'cancelled' ? setCancelling(true) : set(o.status))}>
              {o.label}
            </button>
          ))}
          {!row.visitId && !row.canStart && row.startHint && (
            <p className="rc-pop-note">{row.startHint}</p>
          )}
        </div>
      )}
      {row && cancelling && (
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
