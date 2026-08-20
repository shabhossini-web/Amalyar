/**
 * دستیارِ صوتی — ضبطِ PCM با Web Audio و ساختِ **WAV استاندارد** سمتِ
 * کلاینت، بعد آپلود به `/ai/transcribe`.
 *
 * ⚠️ چرا WAV و نه MediaRecorder/webm؟ خروجیِ استریمیِ MediaRecorder هدرِ
 * duration ندارد و بعضی گیت‌وی‌های ویسپر همان‌جا 400 می‌دهند («webm
 * duration parsing requires full EBML parser» — گزارشِ کاربر از سرورِ
 * واقعی). WAVِ خام هدرِ کامل دارد، هر گیت‌وی‌ای می‌پذیرد، و مسیرِ اندروید
 * و آیفون **عیناً یکی** می‌شود — نه SpeechRecognition مرورگر، نه فرمتِ
 * متفاوت به‌ازای هر سیستم‌عامل.
 *
 * حجم: ۱۶کیلوهرتز × ۱۶بیت × مونو ≈ ۳۲KB/ثانیه — دیکتهٔ چنددقیقه‌ای زیرِ
 * چند مگابایت می‌ماند (سقفِ سرور ۱۵MB ≈ ۷ دقیقه؛ ضبط خودش می‌ایستد).
 */
import { useEffect, useRef, useState } from 'react';
import { apiUpload } from '../lib/api.js';
import { Mic, StopRec } from './icons.jsx';
import './voice.css';

const TARGET_RATE = 16000;
const MAX_SECONDS = 420;

/** میانگین‌گیریِ بازه‌ای — کاهشِ نرخِ نمونه به ۱۶کیلوهرتز برای ویسپر. */
function downsample(buf, fromRate, toRate) {
  if (fromRate === toRate) return buf;
  const ratio = fromRate / toRate;
  const len = Math.floor(buf.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(Math.floor((i + 1) * ratio), buf.length);
    let sum = 0;
    for (let j = a; j < b; j++) sum += buf[j];
    out[i] = b > a ? sum / (b - a) : 0;
  }
  return out;
}

/** PCM float ‎[-1..1]‎ → WAV ۱۶بیتِ مونو با هدرِ RIFF کامل. */
function wavEncode(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export default function VoiceInput({ onText, onErr, disabled, label = 'دیکته با میکروفون' }) {
  const [state, setState] = useState('idle'); // idle | rec | busy
  const recRef = useRef(null); // {stream, ctx, src, proc, chunks, rate, samples}

  const teardown = () => {
    const r = recRef.current;
    if (!r) return null;
    recRef.current = null;
    try { r.proc.disconnect(); r.src.disconnect(); } catch { /* از قبل قطع بود */ }
    try { r.ctx.close(); } catch { /* بسته بود */ }
    r.stream.getTracks().forEach((t) => t.stop());
    return r;
  };
  /* unmount وسطِ ضبط: میکروفون آزاد شود تا چراغِ سیستم روشن نماند. */
  useEffect(() => () => { teardown(); }, []);

  const stop = async () => {
    const r = teardown();
    if (!r) { setState('idle'); return; }
    const total = new Float32Array(r.samples);
    let o = 0;
    for (const c of r.chunks) { total.set(c, o); o += c.length; }
    if (!total.length) { setState('idle'); return; }
    setState('busy');
    try {
      const wav = wavEncode(downsample(total, r.rate, TARGET_RATE), TARGET_RATE);
      const fd = new FormData();
      fd.append('audio', wav, 'voice.wav');
      const res = await apiUpload('/ai/transcribe', fd);
      if (res?.text) onText(res.text);
    } catch (e) {
      onErr?.(e.message);
    } finally {
      setState('idle');
    }
  };

  const start = async () => {
    if (state !== 'idle') return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onErr?.('دسترسی به میکروفون داده نشد — از تنظیماتِ مرورگر اجازه بدهید');
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      /* iOS تا اشارهٔ کاربر suspended است — همین کلیک همان اجازه است. */
      await ctx.resume().catch(() => {});
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const rec = { stream, ctx, src, proc, chunks: [], rate: ctx.sampleRate, samples: 0 };
      proc.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        rec.chunks.push(new Float32Array(ch));
        rec.samples += ch.length;
        if (rec.samples / rec.rate > MAX_SECONDS) stop(); // سقفِ زمان/حجم
      };
      src.connect(proc);
      /* خروجیِ proc سکوت است (بافرِ خروجی پر نمی‌شود) — اتصال فقط برای فعال‌ماندنِ گره. */
      proc.connect(ctx.destination);
      recRef.current = rec;
      setState('rec');
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      onErr?.('ضبطِ صدا در این مرورگر ممکن نشد');
    }
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
