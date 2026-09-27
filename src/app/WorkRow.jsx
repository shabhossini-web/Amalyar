import { Link } from 'react-router-dom';
import { faDate } from '../lib/jalali.js';
import { DocThumb, openDoc } from '../ui/DocThumb.jsx';
import Pick from '../ui/Pick.jsx';
import { User, Users } from '../ui/icons.jsx';
import { useTerms } from './config.jsx';

/**
 * برچسبِ فارسیِ نوعِ کار — کلیدها همان `work-rules.ts`.
 *
 * هشدار: `repair_data` تنها کلیدی است که از `work-rules.ts` نمی‌آید: اسکنِ W1.10
 * مستقیم `upsertWork` را صدا می‌زند (رویدادی در کار نیست). اگر روزی قاعده‌اش
 * هم اضافه شد، همین کلید می‌ماند.
 */
export const TYPE_FA = {
  review_result: 'بررسیِ نتیجه', review_form: 'بررسیِ فرم', approve_intake: 'تأییدِ ثبت‌نام', repair_intake: 'تأییدِ نیمه‌کاره',
  call_patient: 'تماس با بیمار', confirm_appointment: 'تأییدِ نوبت', confirm_surgery_done: 'وضعیتِ عمل',
  complete_report: 'گزارشِ خدمت', confirm_usage: 'تأییدِ مصرف', issue_invoice: 'صدورِ فاکتور', resend_sms: 'پیامک',
  follow_up_unanswered: 'پیگیریِ بی‌پاسخ', fill_form: 'فرم', upload_result: 'ارسالِ نتیجه', pick_slot: 'انتخابِ زمان', manual: 'یادداشت',
  repair_data: 'تطبیقِ دادهٔ ناقص',
};

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');
const tomorrow9 = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
};

/**
 * یک ردیفِ کار — در زنگِ اعلان و صفحهٔ «کارهای من» یکی است.
 * `overdue` و نامِ بیمار از سرور می‌آید (قانونِ ۱۵)؛ این‌جا فقط رندر.
 *
 * **«مالِ کیست»** (نمای تیمِ سوپرادمین، قانونِ ۲۹): سرور روی هر ردیف `ownerLabel`
 * می‌گذارد — نامِ شخص، «صفِ منشی»، یا «بی‌مسئول» — و برای بقیهٔ کاربران `null`،
 * پس ردیفِ آن‌ها در هیچ صفحه‌ای عوض نمی‌شود. برچسب فقط وقتی دیده می‌شود که کار
 * مالِ خودِ کاربر نیست. اگر صفحه `onAssign` بدهد و سرور `canAssign`، همان برچسب
 * دکمهٔ «واگذاری» است (روی ردیفِ خودِ او: «واگذاری» به‌تنهایی) — یک جا برای «مالِ
 * کیست» و «به چه کسی بدهم»، نه دکمهٔ سومی کنارِ «انجام شد» که ردیف را بلند کند.
 * فهرستِ افراد (`assignees`) را صفحه یک‌بار از `GET /work/assignees` می‌گیرد.
 */
export default function WorkRow({ w, onAct, busy, compact = false, onOpen, onAssign, assignees }) {
  const t = useTerms();
  const due = w.dueAt ? faDate(w.dueAt) : '';
  /* «گزارشِ خدمت» در شرکت، «شرحِ عمل» در مطب — همان کار، دو مفهوم (واژگانِ حوزه). */
  const typeFa = w.type === 'complete_report' ? t.workReport ?? TYPE_FA.complete_report : TYPE_FA[w.type] ?? w.type;
  /* عکس‌هایی که بیمار برای سفارشِ همین کار فرستاده (`attachments` از سرور، W0.8):
     خودِ ردیف نشانشان می‌دهد تا کاربر برای دیدنِ «چه آمده» دو کلیک نرود
     (بازخوردِ مالک: عکسِ مشاوره باید در صفحهٔ «امروز» بیاید و از همان‌جا باز شود). */
  const maxDocs = compact ? 3 : 4;
  const docs = (w.attachments ?? []).slice(0, maxDocs);
  const more = Math.max(0, (w.attachmentCount ?? docs.length) - docs.length);
  const showOwner = !w.mine && !!w.ownerLabel;
  const assignable = !!onAssign && w.canAssign && Array.isArray(assignees);
  /* شخص: آدمک؛ صفِ نقش: چند آدمک؛ «بی‌مسئول» بی‌آیکون — آدمک برای «هیچ‌کس» دروغ است (خط‌چینِ قرص می‌گویدش). */
  const OwnerIcon = w.ownerKind === 'role' ? Users : w.ownerKind === 'person' ? User : null;
  return (
    <li className={`wk-row${w.overdue ? ' overdue' : ''}${w.state === 'blocked' ? ' blocked' : ''}`} data-work-id={w.id}>
      <div className="wk-main">
        <span className="wk-type">{typeFa}</span>
        {/* عنوانِ کار وقتی **مقصد** دارد (سفارش، مراجعه) دکمه است و پاپ‌آپِ خودش را
            باز می‌کند — «انجام شد» بدونِ دیدنِ خودِ چیز، امضای کور است (بازخوردِ
            مالک: هر هشدار باید بگوید مالِ چیست و با کلیک بازِ شود). */}
        {onOpen
          ? <button type="button" className="wk-title wk-open" onClick={() => onOpen(w)}>{w.title}</button>
          : <span className="wk-title">{w.title}</span>}
        <span className="wk-meta">
          {w.patient && <Link to={`/app/patients/${w.patient.id}`} className="wk-patient">{w.patient.fullName}</Link>}
          {due && <span className={`wk-due${w.overdue ? ' hot' : ''}`}>{w.overdue ? 'عقب‌افتاده · ' : 'تا '}{due}</span>}
          {w.state === 'blocked' && <span className="wk-blocked">متوقف{w.blockedReason ? `: ${w.blockedReason}` : ''}</span>}
          {assignable ? (
            /* `Pick` صفتِ اضافه را به دکمه‌اش نمی‌دهد؛ `title` و کلاسِ حالت روی پوسته‌اند
               و پوسته دقیقاً هم‌اندازهٔ دکمه است. `value` همیشه خالی: این دکمه «واگذاری»
               است، نه فیلدی که مقدارش مسئولِ فعلی باشد — مسئولِ فعلی از فهرست بیرون است. */
            <span
              className={`wk-owner wk-assign is-${showOwner ? w.ownerKind : 'self'}`}
              title={showOwner ? `${OwnerIcon ? 'مسئول: ' : ''}${w.ownerLabel} — واگذاری به یک هم‌تیمی` : 'واگذاری به یک هم‌تیمی'}
              data-owner={showOwner ? w.ownerLabel : undefined}
            >
              <Pick
                label="واگذاری به…"
                value={null}
                clearable={false}
                disabled={busy === w.id}
                options={assignees.filter((a) => a.id !== w.ownerAccountId)}
                labelOf={(a) => a.label}
                placeholder={showOwner
                  ? <>{OwnerIcon && <OwnerIcon size={13} />}{OwnerIcon && <span className="wk-sr">مسئول: </span>}{w.ownerLabel}<span className="wk-sr"> — واگذاری</span></>
                  : <>واگذاری</>}
                onChange={(id) => { if (id != null) onAssign(w, id); }}
              />
            </span>
          ) : showOwner && (
            <span className={`wk-owner is-${w.ownerKind}`} data-owner={w.ownerLabel}>
              {OwnerIcon && <OwnerIcon size={13} />}{OwnerIcon && <span className="wk-sr">مسئول: </span>}{w.ownerLabel}
            </span>
          )}
        </span>
        {!compact && w.note && <span className="wk-note">{w.note}</span>}
        {docs.length > 0 && (
          <ul className="wk-docs" aria-label="پاسخِ بیمار">
            {docs.map((d) => (
              <li key={d.id}>
                {/* با مقصد: خودِ سفارش باز می‌شود (همان‌جا بررسی می‌شود)؛ بی‌مقصد: خودِ عکس. */}
                <button
                  type="button"
                  className="wk-doc"
                  title={onOpen ? 'بازکردنِ سفارش' : (d.title || d.fileName)}
                  onClick={() => (onOpen ? onOpen(w) : openDoc(d))}
                >
                  <DocThumb id={d.id} alt={d.title || d.fileName || 'عکسِ بیمار'} className="wk-thumb" />
                </button>
              </li>
            ))}
            {more > 0 && <li className="wk-doc-more">+{faNum(more)}</li>}
          </ul>
        )}
      </div>
      <div className="wk-actions">
        <button type="button" className="wk-btn primary" disabled={busy === w.id} onClick={() => onAct(w, 'done')}>انجام شد</button>
        <button type="button" className="wk-btn" disabled={busy === w.id} onClick={() => onAct(w, 'snooze', { until: tomorrow9() })}>فردا</button>
      </div>
    </li>
  );
}
