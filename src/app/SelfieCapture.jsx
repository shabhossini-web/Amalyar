import { useEffect, useRef, useState } from 'react';
import { Camera } from '../ui/icons.jsx';


export default function SelfieCapture({ value, onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  };
  useEffect(() => () => stop(), []);

  const start = async () => {
    setErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
        audio: false,
      });
      streamRef.current = stream;
      // ویدیو همیشه در DOM هست (نه شرطی) — وگرنه ref موقعِ اتصال null است
      const v = videoRef.current;
      v.srcObject = stream;
      await v.play().catch(() => {});
      setReady(true);
    } catch {
      setErr('دسترسی به دوربین ممکن نشد؛ اجازهٔ دوربین را بده.');
    }
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v) return;
    const size = 480;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const s = Math.min(v.videoWidth, v.videoHeight);
    const sx = (v.videoWidth - s) / 2;
    const sy = (v.videoHeight - s) / 2;
    ctx.translate(size, 0); // آینه‌ای (سلفی)
    ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, s, s, 0, 0, size, size);
    const dataURL = canvas.toDataURL('image/jpeg', 0.72);
    stop();
    onCapture(dataURL);
  };

  if (value) {
    return (
      <div className="selfie">
        <div className="selfie-frame"><img src={value} alt="سلفی" /></div>
        <button type="button" className="selfie-link" onClick={() => onCapture('')}>گرفتنِ دوباره</button>
      </div>
    );
  }

  return (
    <div className="selfie">
      <div className="selfie-frame">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="selfie-video"
          style={{ display: ready ? 'block' : 'none' }}
        />
        {!ready && (
          <button type="button" className="selfie-start" onClick={start} aria-label="روشن‌کردن دوربین">
            <Camera width="30" height="30" />
            <span>{err ? 'تلاش دوباره' : 'روشن‌کردن دوربین'}</span>
          </button>
        )}
      </div>
      {ready && (
        <button type="button" className="selfie-shot" onClick={capture} aria-label="ثبتِ سلفی">
          <span />
        </button>
      )}
      {err && <div className="selfie-err">{err}</div>}
    </div>
  );
}
