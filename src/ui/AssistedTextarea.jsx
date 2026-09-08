import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import VoiceInput from './VoiceInput.jsx';
import './assisted-textarea.css';

/** پیشنهاد جدا از مقدار ثبت‌شدنی است؛ فقط «اعمال» متن فرم را عوض می‌کند. */
export default function AssistedTextarea({ value = '', onChange, disabled, readOnly, purpose = 'شرح', ...props }) {
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
      const result = await api('/ai/text-draft', { method: 'POST', body: { text: source, mode, purpose } });
      if (typeof result?.text !== 'string' || !result.text.trim()) throw new Error('پاسخ دستیار خالی بود؛ متن شما حفظ شد');
      if (alive.current) setProposal({ source, text: mode === 'continue' ? `${source}\n${result.text}` : result.text });
    } catch (e) { if (alive.current) setError(e.message); }
    finally { if (alive.current) setBusy(false); }
  };
  const locked = disabled || readOnly;
  return <span className="assisted-text">
    <textarea {...props} value={value} onChange={onChange} disabled={disabled} readOnly={readOnly} />
    {!locked && (status?.enabled || status?.stt) && <span className="assisted-actions">
      {status.stt && <VoiceInput disabled={busy} onErr={setError} onText={(text) => change([current.current, text].filter(Boolean).join('\n'))} />}
      {status.enabled && <>
        <button type="button" disabled={busy || String(value).trim().length < 2} onClick={() => draft('structure')}>اصلاح و ساختاربندی</button>
        <button type="button" disabled={busy || String(value).trim().length < 2} onClick={() => draft('continue')}>ادامه با AI</button>
      </>}
      {busy && <small role="status">در حال آماده‌کردن پیشنهاد…</small>}
    </span>}
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
