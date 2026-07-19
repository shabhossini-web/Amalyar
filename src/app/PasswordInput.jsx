import { useState } from 'react';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Eye = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>);
const EyeOff = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M17.94 17.94A10.5 10.5 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.4 9.4 0 0 1 12 5c6.5 0 10 7 10 7a18.6 18.6 0 0 1-2.16 3.19" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><path d="M2 2l20 20" /></svg>);

/** ورودیِ استانداردِ رمز عبور با چشمِ نمایش/مخفی */
export default function PasswordInput({ value, onChange, ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input
        {...props}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        className="pw-input"
      />
      <button
        type="button"
        className="pw-eye"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'مخفی‌کردن رمز' : 'نمایشِ رمز'}
        tabIndex={-1}
      >
        {show ? <EyeOff width="19" height="19" /> : <Eye width="19" height="19" />}
      </button>
    </div>
  );
}
