import { useState } from 'react';
import { Eye, EyeOff } from '../ui/icons.jsx';


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
