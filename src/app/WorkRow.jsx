import { Link } from 'react-router-dom';
import { faDate } from '../lib/jalali.js';

/** برچسبِ فارسیِ نوعِ کار — کلیدها همان `work-rules.ts`. */
export const TYPE_FA = {
  review_result: 'بررسیِ نتیجه', review_form: 'بررسیِ فرم', approve_intake: 'تأییدِ ثبت‌نام', repair_intake: 'تأییدِ نیمه‌کاره',
  call_patient: 'تماس با بیمار', confirm_appointment: 'تأییدِ نوبت', confirm_surgery_done: 'وضعیتِ عمل',
  complete_report: 'گزارشِ عمل', confirm_usage: 'تأییدِ مصرف', issue_invoice: 'صدورِ فاکتور', resend_sms: 'پیامک',
  follow_up_unanswered: 'پیگیریِ بی‌پاسخ', fill_form: 'فرم', upload_result: 'ارسالِ نتیجه', pick_slot: 'انتخابِ زمان', manual: 'یادداشت',
};

const tomorrow9 = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
};

/**
 * یک ردیفِ کار — در زنگِ اعلان و صفحهٔ «کارهای من» یکی است.
 * `overdue` و نامِ بیمار از سرور می‌آید (قانونِ ۱۵)؛ این‌جا فقط رندر.
 */
export default function WorkRow({ w, onAct, busy, compact = false }) {
  const due = w.dueAt ? faDate(w.dueAt) : '';
  return (
    <li className={`wk-row${w.overdue ? ' overdue' : ''}${w.state === 'blocked' ? ' blocked' : ''}`} data-work-id={w.id}>
      <div className="wk-main">
        <span className="wk-type">{TYPE_FA[w.type] ?? w.type}</span>
        <span className="wk-title">{w.title}</span>
        <span className="wk-meta">
          {w.patient && <Link to={`/app/patients/${w.patient.id}`} className="wk-patient">{w.patient.fullName}</Link>}
          {due && <span className={`wk-due${w.overdue ? ' hot' : ''}`}>{w.overdue ? 'عقب‌افتاده · ' : 'تا '}{due}</span>}
          {w.state === 'blocked' && <span className="wk-blocked">متوقف{w.blockedReason ? `: ${w.blockedReason}` : ''}</span>}
        </span>
        {!compact && w.note && <span className="wk-note">{w.note}</span>}
      </div>
      <div className="wk-actions">
        <button type="button" className="wk-btn primary" disabled={busy === w.id} onClick={() => onAct(w, 'done')}>انجام شد</button>
        <button type="button" className="wk-btn" disabled={busy === w.id} onClick={() => onAct(w, 'snooze', { until: tomorrow9() })}>فردا</button>
      </div>
    </li>
  );
}
