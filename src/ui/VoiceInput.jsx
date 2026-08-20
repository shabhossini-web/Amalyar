/**
 * دستیارِ صوتی — ضبط با MediaRecorder و تبدیل سمتِ سرور (`/ai/transcribe`).
 *
 * ⚠️ عمداً «ضبط → آپلود → ویسپرِ گیت‌وی» است، نه SpeechRecognition مرورگر:
 * آن API روی iOS ناهمسان/غایب است، ولی MediaRecorder روی اندروید
 * (webm/opus) و آیفون (mp4/AAC) یک UX یکسان می‌دهد؛ mimeType با
 * isTypeSupported انتخاب می‌شود و سرور هر دو را می‌پذیرد.
 */
import { useEffect, useRef, useState } from 'react';
import { apiUpload } from '../lib/api.js';
import { Mic, StopRec } from './icons.jsx';
import './voice.css';

export default function VoiceInput({ onText, onErr, disabled, label = 'دیکته با میکروفون' }) {
  const [state, setState] = useState('idle'); // idle | rec | busy
  const recRef = useRef(null);
  const chunksRef = useRef([]);

  /* unmount وسطِ ضبط: ترک‌ها آزاد شوند تا چراغِ میکروفونِ سیستم روشن نماند. */
  useEffect(() => () => {
    try { recRef.current?.stream?.getTracks?.().forEach((t) => t.stop()); } catch { /* بسته بود */ }
  }, []);

  const start = async () => {
    if (state !== 'idle') return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onErr?.('دسترسی به میکروفون داده نشد — از تنظیماتِ مرورگر اجازه بدهید');
      return;
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
      .find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = rec.mimeType || mime || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      if (!blob.size) { setState('idle'); return; }
      setState('busy');
      try {
        const fd = new FormData();
        fd.append('audio', blob, type.includes('mp4') ? 'voice.m4a' : 'voice.webm');
        const r = await apiUpload('/ai/transcribe', fd);
        if (r?.text) onText(r.text);
      } catch (e) {
        onErr?.(e.message);
      } finally {
        setState('idle');
      }
    };
    recRef.current = rec;
    rec.start();
    setState('rec');
  };
  const stop = () => {
    try { recRef.current?.stop(); } catch { setState('idle'); }
  };

  return (
    <button
      type="button"
      className={`vc-btn${state === 'rec' ? ' vc-rec' : ''}`}
      disabled={disabled || state === 'busy'}
      aria-label={state === 'rec' ? 'پایانِ ضبط' : label}
      title={state === 'rec' ? 'پایانِ ضبط و تبدیل به متن' : label}
      onClick={state === 'rec' ? stop : start}
    >
      {state === 'busy' ? <span className="vc-spin" /> : state === 'rec' ? <StopRec size={15} /> : <Mic size={15} />}
      <span>{state === 'busy' ? 'در حالِ تبدیل…' : state === 'rec' ? 'پایانِ ضبط' : label}</span>
    </button>
  );
}
