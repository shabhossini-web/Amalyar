/**
 * **ضبطِ صدا به WAV** — مشترکِ دیکته (`VoiceInput`) و یادداشتِ صوتی (`VoiceNote`).
 *
 * ⚠️ چرا WAV و نه MediaRecorder: اندروید webm/opus می‌سازد و آیفون mp4/aac، و
 * فایلی که روی یکی ضبط شده ممکن است روی دیگری پخش نشود؛ بعضی گیت‌وی‌های
 * گفتار-به-متن هم webmِ استریمی را رد می‌کنند (گزارشِ کاربر). WAVِ خام همه‌جا
 * پخش می‌شود و مسیرِ اندروید و آیفون عیناً یکی است. بهایش حجم است:
 * ۱۶کیلوهرتز × ۱۶بیت × مونو ≈ ۳۲KB در ثانیه (هر دقیقه حدودِ ۲ مگابایت).
 */
export const TARGET_RATE = 16000;

/** میانگین‌گیریِ بازه‌ای — کاهشِ نرخِ نمونه به ۱۶کیلوهرتز. */
export function downsample(buf, fromRate, toRate) {
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
export function wavEncode(samples, rate) {
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

/**
 * یک نشستِ ضبط. `onTick(ثانیه)` هر بافر صدا زده می‌شود؛ رسیدن به `maxSeconds`
 * خودش `onLimit()` را صدا می‌زند تا صداکننده «پایان» را بزند.
 *
 * ⚠️ خطای «اجازهٔ میکروفون» پیامِ فارسیِ خودش را دارد: کاربر باید بداند مشکل
 * از تنظیماتِ مرورگر است، نه از برنامه.
 */
export async function startWavRecording({ maxSeconds = 180, onTick, onLimit } = {}) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error('دسترسی به میکروفون داده نشد — از تنظیماتِ مرورگر اجازه بدهید');
  }
  let ctx;
  let src;
  let proc;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctx();
    /* iOS تا اشارهٔ کاربر suspended است — همین کلیک همان اجازه است. */
    await ctx.resume().catch(() => {});
    src = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(4096, 1, 1);
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('ضبطِ صدا در این مرورگر ممکن نشد');
  }
  const rec = { chunks: [], samples: 0, rate: ctx.sampleRate, limited: false };
  proc.onaudioprocess = (e) => {
    const ch = e.inputBuffer.getChannelData(0);
    rec.chunks.push(new Float32Array(ch));
    rec.samples += ch.length;
    const sec = rec.samples / rec.rate;
    onTick?.(sec);
    if (sec > maxSeconds && !rec.limited) { rec.limited = true; onLimit?.(); }
  };
  src.connect(proc);
  /* خروجیِ proc سکوت است — اتصال فقط برای فعال‌ماندنِ گره. */
  proc.connect(ctx.destination);

  const teardown = () => {
    try { proc.disconnect(); src.disconnect(); } catch { /* از قبل قطع بود */ }
    try { ctx.close(); } catch { /* بسته بود */ }
    stream.getTracks().forEach((t) => t.stop());
  };
  return {
    /** پایان → `{ blob, seconds }`، یا `null` اگر چیزی ضبط نشد. */
    stop() {
      teardown();
      if (!rec.samples) return null;
      const total = new Float32Array(rec.samples);
      let o = 0;
      for (const c of rec.chunks) { total.set(c, o); o += c.length; }
      return { blob: wavEncode(downsample(total, rec.rate, TARGET_RATE), TARGET_RATE), seconds: rec.samples / rec.rate };
    },
    /** لغو بدونِ خروجی — میکروفون آزاد می‌شود تا چراغِ سیستم روشن نماند. */
    cancel() { teardown(); },
  };
}
