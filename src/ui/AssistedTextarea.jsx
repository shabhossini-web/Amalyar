import { useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { AiContext } from './ai-context.js';
import VoiceInput from './VoiceInput.jsx';
import { Pencil, Sparkle } from './icons.jsx';
import './assisted-textarea.css';

/**
 * پیشنهاد جدا از مقدار ثبت‌شدنی است؛ فقط «اعمال» متن فرم را عوض می‌کند.
 *
 * ⚠️ سه ابزار (دیکته، «اصلاح و ساختاربندی»، «ادامه با AI») **آیکونِ کوچک در گوشهٔ خودِ کادر**
 * هستند، نه ردیفی زیرِ هر کادر (طرحِ مصوبِ ۱۴۰۵/۰۷/۰۳ — «UI خیلی باز و شلخته»). نامِ دسترس‌پذیرِ
 * هر دکمه همان متنِ قبلی است، پس صفحه‌خوان و آزمون‌ها همان را پیدا می‌کنند. کادر به اندازهٔ
 * آیکون‌ها از آن سمت فاصله می‌گیرد تا متن زیرشان نرود.
 *
 * بافتار: نوعِ عمل و تشخیصِ فرمِ دربرگیرنده (`AiContext`) + `aiContext`ِ خودِ کادر (مثلاً
 * `{care: 'pre'}` برای متنِ مراقبتی که پیامک می‌شود) همراهِ متن به سرور می‌رود.
 */
export default function AssistedTextarea({ value = '', onChange, disabled, readOnly, purpose = 'شرح', aiContext, ...props }) {
  const shared = useContext(AiContext);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState(null);
  const [error, setError] = useState('');
  const current = useRef(value);
  const alive = useRef(true);
  useEffect(() => { current.current = value; }, [value]);
  useEffect(() => {
    alive.current = true;
    api('/ai/status').then((r) => { if (alive.current) setStatus(r); }).catch(() => {});
    return () => { alive.current = false; };
  }, []);
  const change = (text) => onChange({ target: { value: text } });
  const draft = async (mode) => {
    const source = String(value ?? '');
    setBusy(true); setError(''); setProposal(null);
    try {
      const context = shared || aiContext ? { ...(shared ?? {}), ...(aiContext ?? {}) } : null;
      const result = await api('/ai/text-draft', { method: 'POST', body: { text: source, mode, purpose, ...(context ? { context } : {}) } });
      if (typeof result?.text !== 'string' || !result.text.trim()) throw new Error('پاسخ دستیار خالی بود؛ متن شما حفظ شد');
      if (alive.current) setProposal({ source, text: mode === 'continue' ? `${source}\n${result.text}` : result.text });
    } catch (e) { if (alive.current) setError(e.message); }
    finally { if (alive.current) setBusy(false); }
  };
  const locked = disabled || readOnly;
  const tools = !locked && (status?.enabled || status?.stt);
  const count = (status?.stt ? 1 : 0) + (status?.enabled ? 2 : 0);
  const short = String(value).trim().length < 2;
  return <span className="assisted-text" style={tools ? { '--at-tools': count } : undefined}>
    <textarea {...props} value={value} onChange={onChange} disabled={disabled} readOnly={readOnly} />
    {tools && <span className="assisted-tools">
      {status.stt && <VoiceInput compact disabled={busy} onErr={setError} onText={(text) => change([current.current, text].filter(Boolean).join('\n'))} />}
      {status.enabled && <>
        <button type="button" className="at-ic" aria-label="اصلاح و ساختاربندی" title="اصلاح و ساختاربندی" disabled={busy || short} onClick={() => draft('structure')}>
          <Sparkle width="15" height="15" aria-hidden="true" />
        </button>
        <button type="button" className="at-ic" aria-label="ادامه با AI" title="ادامه با AI" disabled={busy || short} onClick={() => draft('continue')}>
          <Pencil width="14" height="14" aria-hidden="true" />
        </button>
      </>}
    </span>}
    {busy && <small role="status">در حال آماده‌کردن پیشنهاد…</small>}
    {error && <small role="alert">{error}</small>}
    {proposal && !locked && <span className="assisted-proposal">
      <small>پیشنهاد را بررسی کنید؛ با اعمال، وارد متن فرم می‌شود.</small>
      <textarea aria-label="پیشنهاد قابل ویرایش دستیار" rows={4} value={proposal.text} onChange={(e) => setProposal((p) => ({ ...p, text: e.target.value }))} />
      {value !== proposal.source && <small role="status">متن اصلی در این فاصله تغییر کرده؛ برای حفظ تغییرات، پیشنهاد تازه بگیرید.</small>}
      <span className="assisted-actions">
        <button type="button" disabled={value !== proposal.source} onClick={() => { change(proposal.text); setProposal(null); }}>اعمال پیشنهاد</button>
        <button type="button" onClick={() => setProposal(null)}>کنار گذاشتن</button>
      </span>
    </span>}
  </span>;
}
