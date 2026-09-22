import { useEffect, useRef, useState } from 'react';
import { Check, Close, Mic, StopRec, Trash } from './icons.jsx';
import { startWavRecording } from './wav-recorder.js';
import './voice.css';

/**
 * **یادداشتِ صوتی** — ضبط، گوش‌دادنِ دوباره، پیوست (بستهٔ ۶د).
 *
 * خواستهٔ مالک: «زیرِ جاهایی که لینک وارد می‌کنند امکانِ ثبتِ صدا هم باشد» —
 * توضیحِ رادیولوژیست پشتِ تلفن، شرحِ بیمار از علامتش، نکتهٔ پزشک روی یک عکس.
 *
 * ⚠️ فرقش با `VoiceInput`: آن یکی صدا را **متن** می‌کند و خودِ صدا را دور
 * می‌ریزد؛ این یکی خودِ صدا را نگه می‌دارد و مدرکِ پرونده می‌کند. ضبط‌کننده
 * مشترک است (`wav-recorder.js`) تا اندروید و آیفون یک مسیر داشته باشند.
 *
 * ⚠️ آپلود کارِ والد است (`onSave(file, seconds)`): مسیرِ ذخیره در داشبورد،
 * صفحهٔ عمومیِ سفارش و فرمِ ثبت‌نام سه چیزِ متفاوت با سه مجوزِ متفاوت است —
 * همان قاعدهٔ `onUpload`ِ `DynForm`.
 *
 * ⚠️ «پیوست» تا گوش‌دادن نیامده غیرفعال نیست، ولی پخش همیشه در دسترس است:
 * صدای ضبط‌شدهٔ اشتباه (میکروفونِ بسته، سکوت) باید پیش از رفتن به پرونده
 * دیده شود.
 */
const FA = '۰۱۲۳۴۵۶۷۸۹';
const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`.replace(/\d/g, (d) => FA[d]);
};

export default function VoiceNote({ onSave, disabled, label = 'ضبطِ توضیحِ صوتی', maxSeconds = 180 }) {
  const [state, setState] = useState('idle'); // idle | rec | review | saving
  const [sec, setSec] = useState(0);
  const [clip, setClip] = useState(null); // { blob, seconds, url }
  const [err, setErr] = useState('');
  const session = useRef(null);

  /* unmount وسطِ ضبط یا با پیش‌نمایشِ باز: میکروفون و blob آزاد شوند. */
  useEffect(() => () => {
    session.current?.cancel();
    session.current = null;
  }, []);
  useEffect(() => () => { if (clip?.url) URL.revokeObjectURL(clip.url); }, [clip]);

  const stop = () => {
    const s = session.current;
    session.current = null;
    const out = s?.stop();
    if (!out) { setState('idle'); setErr('صدایی ضبط نشد — دوباره امتحان کنید'); return; }
    setClip({ ...out, url: URL.createObjectURL(out.blob) });
    setState('review');
  };

  const start = async () => {
    setErr('');
    setSec(0);
    try {
      session.current = await startWavRecording({
        maxSeconds,
        onTick: (t) => setSec(t),
        /* سقفِ زمان خودش ضبط را می‌بندد — فایلِ ۲۰ مگابایتی روی اینترنتِ
           کندِ موبایل هیچ‌وقت آپلود نمی‌شود. */
        onLimit: () => setTimeout(stop, 0),
      });
      setState('rec');
    } catch (e) {
      setErr(e.message);
    }
  };

  const discard = () => { setClip(null); setState('idle'); setSec(0); };

  const save = async () => {
    if (!clip) return;
    setState('saving');
    setErr('');
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      const file = new File([clip.blob], `voice-${stamp}.wav`, { type: 'audio/wav' });
      await onSave(file, clip.seconds);
      discard();
    } catch (e) {
      setErr(e.message || 'ثبتِ صدا انجام نشد');
      setState('review');
    }
  };

  return (
    <span className="vn" data-voice-note={state}>
      {state === 'idle' && (
        <button type="button" className="vc-btn" disabled={disabled} onClick={start} aria-label={label}>
          <Mic size={15} /><span>{label}</span>
        </button>
      )}
      {state === 'rec' && (
        <span className="vn-rec">
          <button type="button" className="vc-btn vc-rec" onClick={stop} aria-label="پایانِ ضبط">
            <StopRec size={15} /><span>پایانِ ضبط</span>
          </button>
          <time dir="ltr">{mmss(sec)} / {mmss(maxSeconds)}</time>
        </span>
      )}
      {(state === 'review' || state === 'saving') && clip && (
        <span className="vn-review">
          {/* ⚠️ `<audio>` بومی: روی آیفون و اندروید کنترلِ آشنای خودِ سیستم را
              دارد و WAV همه‌جا پخش می‌شود — پخش‌کنندهٔ سفارشی چیزی اضافه نمی‌کرد. */}
          <audio controls src={clip.url} preload="metadata" />
          <span className="vn-acts">
            <button type="button" className="vc-btn" disabled={state === 'saving'} onClick={save} data-voice-save>
              <Check width="14" height="14" /><span>{state === 'saving' ? 'در حالِ ثبت…' : `پیوست (${mmss(clip.seconds)})`}</span>
            </button>
            <button type="button" className="vn-ghost" disabled={state === 'saving'} onClick={() => { discard(); start(); }} aria-label="ضبطِ دوباره">
              <Mic size={14} /><span>دوباره</span>
            </button>
            <button type="button" className="vn-ghost" disabled={state === 'saving'} onClick={discard} aria-label="کنار گذاشتن">
              <Close width="14" height="14" />
            </button>
          </span>
        </span>
      )}
      {err && <small className="vn-err" role="alert">{err}</small>}
    </span>
  );
}

/**
 * پخشِ یک صدای ثبت‌شده — فایل پشتِ احراز است، پس با `fetch` گرفته می‌شود
 * (مثلِ `DocThumb`) و **فقط وقتی کاربر خواست**: فهرستِ ده صدای دو‌مگابایتی
 * نباید با بازشدنِ صفحه بیست مگابایت بکشد.
 */
export function VoiceClip({ load, name, onDelete, disabled }) {
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const play = async () => {
    setBusy(true); setErr('');
    try { setUrl(await load()); } catch (e) { setErr(e.message || 'پخش ممکن نشد'); } finally { setBusy(false); }
  };
  return (
    <span className="vn-clip" data-voice-clip>
      {url ? (
        <audio controls autoPlay src={url} preload="auto" />
      ) : (
        <button type="button" className="vn-ghost" disabled={busy || disabled} onClick={play} aria-label={`پخشِ ${name || 'صدا'}`}>
          <Mic size={14} /><span>{busy ? 'در حالِ بارگیری…' : (name || 'توضیحِ صوتی')}</span>
        </button>
      )}
      {onDelete && (
        <button type="button" className="vn-ghost" disabled={disabled} onClick={onDelete} aria-label="حذفِ صدا">
          <Trash width="14" height="14" />
        </button>
      )}
      {err && <small className="vn-err" role="alert">{err}</small>}
    </span>
  );
}
