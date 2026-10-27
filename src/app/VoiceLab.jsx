import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

const STORE = 'amalyar.voiceLab';
const DEFAULT_STYLE = 'Persian, Tehrani accent. Warm, calm and friendly clinic receptionist on the phone; '
  + 'clear, natural conversational pace. Read the text exactly as written.';
const faNum = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; }
}

/**
 * آزمایشگاهِ صدای منشی — داخلِ گروهِ «دستیارِ هوشِ مصنوعی» در تنظیمات.
 *
 * مدلِ صدا، صدا، سرعت، پرامپتِ لحن و (در حالتِ «جوابِ منشی») مدلِ استدلال را انتخاب
 * می‌کنید؛ خروجی متنِ گفته‌شده + صدای پخش‌شدنی + دانلود است. هیچ چیزی در تنظیمات ذخیره
 * نمی‌شود — انتخاب‌ها فقط در همین مرورگر می‌مانند تا آزمونِ بعدی از همان‌جا شروع شود.
 * دسترسی را سرور می‌سنجد؛ کاربرِ بی‌اجازه این کارت را اصلاً نمی‌بیند.
 */
export default function VoiceLab({ onToast }) {
  const saved = useRef(loadSaved()).current;
  const [meta, setMeta] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(!!saved.open);
  const [f, setF] = useState({
    mode: saved.mode === 'reply' ? 'reply' : 'read',
    ttsModel: saved.ttsModel ?? '', chatModel: saved.chatModel ?? '',
    voice: saved.voice ?? 'nova', speed: saved.speed ?? 1,
    style: saved.style ?? DEFAULT_STYLE, persona: saved.persona ?? '', text: saved.text ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState('');
  const urlRef = useRef('');

  useEffect(() => {
    let live = true;
    api('/ai/voice-lab/models').then((d) => {
      if (!live) return;
      setMeta(d);
      setF((x) => ({ ...x, ttsModel: x.ttsModel || d.defaults?.tts || '', chatModel: x.chatModel || d.defaults?.chat || '' }));
    }).catch((e) => {
      if (!live) return;
      if (e?.status === 403) setHidden(true);
      else setMeta({ tts: [], chat: [], voices: ['nova'], error: e.message });
    });
    return () => { live = false; if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ ...f, open })); } catch { /* حافظهٔ مرورگر بسته است */ }
  }, [f, open]);

  if (hidden) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const run = async () => {
    if (busy || !f.text.trim()) return;
    setBusy(true); setErr('');
    try {
      const d = await api('/ai/voice-lab/speak', { method: 'POST', body: { ...f, speed: Number(f.speed) || 1 } });
      const bin = atob(d.audio);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(new Blob([buf], { type: d.mime || 'audio/mpeg' }));
      const ext = /wav/.test(d.mime) ? 'wav' : /ogg/.test(d.mime) ? 'ogg' : 'mp3';
      const name = (d.text || 'صدا').replace(/[\\/:*?"<>|]+/g, ' ').trim().split(/\s+/).slice(0, 5).join('-').slice(0, 60);
      setOut({ ...d, url: urlRef.current, file: `${name}.${ext}` });
    } catch (e) {
      setErr(e.message); setOut(null); onToast?.(e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="vl">
      <button type="button" className="vl-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        آزمایشگاهِ صدای منشی — {open ? 'بستن' : 'بازکردن'}
      </button>
      {open && (
        <div className="vl-body">
          <p className="vl-note">
            مدل‌ها و لحن را امتحان کنید و صدای ساخته‌شده را دانلود کنید. چیزی ذخیره نمی‌شود و هیچ دادهٔ بیماری به
            سرویس نمی‌رود — فقط متنی که همین‌جا می‌نویسید.
          </p>
          {meta?.error && <p className="vl-warn">{meta.error}</p>}

          <div className="vl-mode" role="radiogroup" aria-label="حالت">
            {[['read', 'خواندنِ همین متن'], ['reply', 'جوابِ منشی']].map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={f.mode === k}
                className={f.mode === k ? 'on' : ''} onClick={() => setF((x) => ({ ...x, mode: k }))}>{l}</button>
            ))}
          </div>
          <small className="vl-hint">
            {f.mode === 'read'
              ? 'متن همان‌طور که نوشته شده با مدلِ صدا خوانده می‌شود.'
              : 'متن سؤالِ بیمار است؛ مدلِ استدلال با همین لحن جواب می‌دهد و جوابش خوانده می‌شود.'}
          </small>

          <div className="vl-grid">
            <label className="pf-field">
              <span>مدلِ صدا</span>
              <input dir="ltr" list="vl-tts" value={f.ttsModel} onChange={set('ttsModel')} placeholder="gemini-2.5-flash-tts" />
              <datalist id="vl-tts">{(meta?.tts ?? []).map((m) => <option key={m} value={m} />)}</datalist>
            </label>
            {f.mode === 'reply' && (
              <label className="pf-field">
                <span>مدلِ استدلال</span>
                <input dir="ltr" list="vl-chat" value={f.chatModel} onChange={set('chatModel')} placeholder="claude-sonnet-4-6" />
                <datalist id="vl-chat">{(meta?.chat ?? []).map((m) => <option key={m} value={m} />)}</datalist>
              </label>
            )}
            <label className="pf-field">
              <span>صدا</span>
              <select dir="ltr" value={f.voice} onChange={set('voice')}>
                {(meta?.voices ?? ['nova']).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="pf-field">
              <span>سرعت: {faNum(Number(f.speed).toFixed(2))}</span>
              <input type="range" min="0.5" max="2" step="0.05" value={f.speed} onChange={set('speed')} />
            </label>
          </div>

          <label className="pf-field">
            <span>پرامپتِ لحن</span>
            <textarea dir="auto" rows={3} value={f.style} onChange={set('style')} />
            <i className="pf-hint">
              به مدلِ صدا فرستاده می‌شود (مدل‌های Gemini و gpt-4o-tts می‌فهمند؛ tts-1 نه).{' '}
              <button type="button" className="vl-link" onClick={() => setF((x) => ({ ...x, style: DEFAULT_STYLE }))}>بازگشت به پیش‌فرض</button>
            </i>
          </label>
          {f.mode === 'reply' && (
            <label className="pf-field">
              <span>دستورِ منشی (اختیاری)</span>
              <textarea rows={3} value={f.persona} onChange={set('persona')}
                placeholder="مثلاً: ساعتِ کاری شنبه تا چهارشنبه ۹ تا ۱۷ است؛ هزینهٔ ویزیت را تلفنی نگو." />
            </label>
          )}
          <label className="pf-field">
            <span>{f.mode === 'read' ? 'متن' : 'سؤالِ بیمار'}</span>
            <textarea rows={4} value={f.text} onChange={set('text')} maxLength={2000}
              placeholder={f.mode === 'read' ? 'متنی که باید خوانده شود…' : 'مثلاً: برای فردا صبح وقت دارید؟'} />
          </label>

          <div className="vl-acts">
            <button type="button" className="df-save" disabled={busy || !f.text.trim()} onClick={run}>
              {busy ? 'در حالِ ساختن…' : 'ساختنِ صدا'}
            </button>
          </div>
          {err && <p className="vl-warn" role="alert">{err}</p>}

          {out && (
            <div className="vl-out" aria-live="polite">
              {f.mode === 'reply' && <p className="vl-said"><b>جوابِ منشی:</b> {out.text}</p>}
              <audio controls autoPlay src={out.url} />
              <div className="vl-meta">
                <a className="df-ghost vl-dl" href={out.url} download={out.file}>دانلودِ همین صدا</a>
                <small dir="rtl">
                  <bdi dir="ltr">{out.ttsModel}</bdi> · <bdi dir="ltr">{out.voice}</bdi> · {faNum(Math.max(1, Math.round(out.bytes / 1024)))} کیلوبایت
                  {out.ms?.chat != null && <> · استدلال {faNum((out.ms.chat / 1000).toFixed(1))} ثانیه</>}
                  {' '}· صدا {faNum((out.ms.tts / 1000).toFixed(1))} ثانیه
                </small>
              </div>
              {out.notes?.map((n) => <p key={n} className="vl-warn">{n}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
