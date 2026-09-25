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
import { downsample, TARGET_RATE, wavEncode } from './wav-recorder.js';
import './voice.css';

const MAX_SECONDS = 420;

/**
 * @param compact آیکون در گوشهٔ کادر (بازخوردِ ۱۴۰۵/۰۷/۰۳: دکمه‌های دستیار داخلِ گوشهٔ کادر، نه ردیفی
 *   زیرِ هر کادر). نامِ دسترس‌پذیر همان `label` می‌ماند — صفحه‌خوان و آزمون‌ها با همان پیدایش می‌کنند.
 * @param caption توضیحِ کوتاهِ زیرِ آیکونِ فشرده (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳، دورِ دوم: «فقط آیکون
 *   گیج‌کننده است؛ زیرش یک توضیحِ کوچک بنویس»). در حالِ ضبط/تبدیل، خودِ حالت را می‌گوید.
 */
export default function VoiceInput({ onText, onErr, disabled, label = 'دیکته با میکروفون', compact = false, caption = null }) {
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
      className={`vc-btn${compact ? ' vc-compact' : ''}${state === 'rec' ? ' vc-rec' : ''}`}
      disabled={disabled || state === 'busy'}
      aria-label={state === 'rec' ? 'پایانِ ضبط' : label}
      title={state === 'rec' ? 'پایانِ ضبط و تبدیل به متن' : label}
      onClick={state === 'rec' ? stop : start}
    >
      {state === 'busy' ? <span className="vc-spin" /> : state === 'rec' ? <StopRec size={15} /> : <Mic size={15} />}
      {!compact && <span>{state === 'busy' ? 'در حالِ تبدیل…' : state === 'rec' ? 'پایانِ ضبط' : label}</span>}
      {compact && caption && (
        <span className="at-cap" aria-hidden="true">{state === 'busy' ? 'تبدیل…' : state === 'rec' ? 'توقف' : caption}</span>
      )}
    </button>
  );
}
