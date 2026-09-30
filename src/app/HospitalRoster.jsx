import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { badTime, faTime, normTime } from '../lib/time.js';
import TimePick from '../ui/TimePick.jsx';
import { Send } from '../ui/icons.jsx';
import { useTerms } from './config.jsx';

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');

/**
 * برنامهٔ حضورِ روز — کارشناسِ هر بیمارستان و ساعتِ حضورش، و تخصیصِ بیماران.
 *
 * واژهٔ «عمل/مراجعه» از `useTerms()` (قانونِ ۲۴) — همان واژه‌ای که سرِ صفحهٔ چینش و
 * خانه‌های تقویم می‌گویند؛ تا دیروز بالای صفحه «۹ عمل» بود و این‌جا «۲ مراجعه» (company-18).
 * رقم و ساعت فارسی (`faNum`، `faTime`).
 */
export default function HospitalRoster({ date, techs, hospitals, onChanged }) {
  const t = useTerms();
  const [data, setData] = useState(null);
  const [extra, setExtra] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const result = await api(`/dispatch/roster?date=${date}`);
    setData(result);
  }, [date]);
  useEffect(() => {
    let alive = true;
    setData(null); setPreview(null); setMessage(''); setExtra('');
    api(`/dispatch/roster?date=${date}`).then(d => { if (alive) setData(d); }).catch(e => { if (alive) setMessage(e.message); });
    return () => { alive = false; };
  }, [date]);
  /** `true` یعنی نشست — ردیفِ «افزودنِ حضور» فقط آن‌وقت خالی می‌شود. */
  const act = async (path, method, body) => {
    if (busy) return false;
    setBusy(true); setMessage('');
    try {
      await api(path, { method, body });
      setPreview(null);
      await load(); onChanged();
      return true;
    } catch (e) { setMessage(e.message); return false; }
    finally { setBusy(false); }
  };
  const showPreview = async () => {
    setBusy(true); setMessage('');
    try { setPreview(await api(`/dispatch/roster/preview?date=${date}`)); }
    catch (e) { setMessage(e.message); }
    finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setMessage('');
    try {
      const r = await api('/dispatch/roster/send', { method: 'POST', body: { date } });
      setMessage(`برنامه برای ${r.recipients} کارشناس در پیام‌رسان ثبت شد. ${r.sent} پیامک پذیرفته شد؛ وضعیت نهایی را در یادآوری‌ها ببینید. ارسال دوبارهٔ همین متن، پیام تکراری نمی‌سازد.`);
      setPreview(null);
    } catch (e) { setMessage(e.message); }
    finally { setBusy(false); }
  };
  const groups = [...(data?.hospitals ?? [])];
  const added = hospitals.find(h => h.id === Number(extra));
  if (added && !groups.some(h => h.hospitalId === added.id)) groups.push({ hospitalId: added.id, name: added.name, duties: [], visits: [] });
  return <div className="hospital-roster">
    <p>برای هر بیمارستان کارشناس و ساعت حضور تعیین کنید؛ سپس بیماران را تخصیص دهید. بیماران بدون کارشناس در همان روز برای کارشناسان آن بیمارستان قابل پذیرش‌اند.</p>
    {message && <div className="dp-err" role="status">{message}</div>}
    {!data && !message && <p>در حال بارگذاری برنامه…</p>}
    {data && <>
      <label className="roster-extra">افزودن بیمارستان به برنامه
        <select aria-label="افزودن بیمارستان به برنامه" value={extra} disabled={busy} onChange={e => setExtra(e.target.value)}><option value="">انتخاب بیمارستان</option>{hospitals.filter(h => h.active !== false).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
      </label>
      {groups.map(h => <section className="dp-card roster-hospital" key={`${date}:${h.hospitalId ?? 'unknown'}`}>
        <h2>{h.name} <small>({faNum(h.visits.length)} {t.surgery})</small></h2>
        {h.hospitalId ? <>
          <div className="roster-duty-list">{h.duties.map(d => <Duty key={d.id} duty={d} busy={busy} onSave={time => act('/dispatch/roster', 'POST', { date, hospitalId: h.hospitalId, techId: d.techId, arriveTime: time })} onRemove={() => act(`/dispatch/roster/${d.id}`, 'DELETE')} />)}</div>
          <NewDuty techs={techs} disabled={busy} onSave={(techId, arriveTime) => act('/dispatch/roster', 'POST', { date, hospitalId: h.hospitalId, techId, arriveTime })} />
        </> : <p>برای این {t.surgery}‌ها بیمارستان را در ویرایشِ {t.surgery} از تعاریفِ پایه انتخاب کنید. <Link to="/app/dashboard">رفتن به {t.surgery}‌ها</Link></p>}
        <div className="roster-visits">{h.visits.map(v => <div className="roster-visit" key={v.id}>
          <div><b>{v.name}</b><small>{v.opStartTime ? faTime(v.opStartTime) : 'بدون ساعت'} · <bdi dir="ltr">{v.code}</bdi></small>{v.hospitalText && !h.hospitalId && <small>{v.hospitalText}</small>}{v.instructions && <small>دستور: {v.instructions}</small>}{Array.isArray(v.requiredItems) && v.requiredItems.length > 0 && <small>اقلام: {v.requiredItems.map(r => `${r.name ?? r.itemId} × ${faNum(r.quantity)}`).join('، ')}</small>}</div>
          <label>کارشناسِ {t.surgery}<select aria-label={`کارشناس ${v.name}`} value={v.techId ?? ''} disabled={busy || !h.hospitalId} onChange={e => act(`/dispatch/roster/visits/${v.id}`, 'PATCH', { techId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">آزاد؛ قابل پذیرش توسط کارشناس بیمارستان</option>
            {v.techId && !h.duties.some(d => d.techId === v.techId) && <option value={v.techId}>{v.techName} — هنوز در برنامه حضور نیست</option>}
            {h.duties.filter(d => d.active).map(d => <option key={d.techId} value={d.techId}>{d.name} · حضور {faTime(d.arriveTime)}</option>)}
          </select></label>
        </div>)}</div>
      </section>)}
      {/* «ابلاغِ برنامهٔ روز» اصلی‌ترین کارِ این صفحه است: دکمهٔ اصلیِ درشتِ پایینِ روز (company-02).
          اول پیش‌نمایش، بعد ارسال — پیامک به دستِ کارشناس می‌رسد و پس‌گرفتنی نیست. */}
      <div className="roster-send">
        {preview
          ? <button type="button" className="dp-brief-btn" disabled={busy} onClick={() => setPreview(null)}>بستنِ پیش‌نمایش</button>
          : <button type="button" className="roster-send-main" disabled={busy} onClick={showPreview}><Send width="17" height="17" aria-hidden="true" /> ابلاغِ برنامهٔ روز</button>}
        <Link to="/app/reminders">وضعیتِ پیام‌ها</Link>
        {!preview && <p className="roster-send-hint">اول پیامِ هر کارشناس را می‌بینید؛ ارسال فقط با تأییدِ شما.</p>}
      </div>
      {preview && <section className="dp-card roster-preview"><h2>ابلاغِ برنامهٔ روز</h2>
        {!preview.programs.length && <p>هنوز کارشناس و ساعت حضور ثبت نشده است.</p>}
        {preview.programs.map(p => <details key={p.techId} open><summary>{p.name}</summary><p style={{ whiteSpace: 'pre-wrap' }}>{p.text}</p></details>)}
        {!!preview.programs.length && <button type="button" className="roster-send-main" disabled={busy} onClick={send}><Send width="17" height="17" aria-hidden="true" /> ارسالِ برنامهٔ روز با پیامک و ربات</button>}
      </section>}
    </>}
  </div>;
}

function Duty({ duty, busy, onSave, onRemove }) {
  const [value, setValue] = useState(duty.arriveTime);
  useEffect(() => setValue(duty.arriveTime), [duty.arriveTime]);
  return <div className="roster-duty"><b>{duty.name}{!duty.active && ' (غیرفعال)'}</b><label>ساعت حضور<TimePick value={value} onChange={setValue} disabled={busy} /></label><button type="button" disabled={busy || !value || badTime(value) || normTime(value) === duty.arriveTime} onClick={() => onSave(normTime(value))}>ثبت ساعت</button><button type="button" disabled={busy} onClick={onRemove}>حذف حضور</button></div>;
}
/**
 * ردیفِ «افزودنِ حضور». پس از ثبتِ موفق **خالی** می‌شود (company-18): تا دیروز همان
 * کارشناس انتخاب‌شده می‌ماند و دکمه دوباره فعال بود — انگار ذخیره نشده بود.
 */
function NewDuty({ techs, disabled, onSave }) {
  const [tech, setTech] = useState('');
  const [time, setTime] = useState('08:00');
  const save = async () => {
    if (await onSave(Number(tech), normTime(time))) { setTech(''); setTime('08:00'); }
  };
  return <div className="roster-duty roster-new"><label>کارشناس بیمارستان<select value={tech} disabled={disabled} onChange={e => setTech(e.target.value)}><option value="">انتخاب کارشناس</option>{techs.map(t => <option key={t.id} value={t.id}>{t.displayName}</option>)}</select></label><label>ساعت حضور<TimePick value={time} onChange={setTime} disabled={disabled} /></label><button type="button" disabled={disabled || !tech || !time || badTime(time)} onClick={save}>ثبت حضور کارشناس</button></div>;
}
