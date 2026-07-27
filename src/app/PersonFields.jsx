import { isValidIban, isValidNationalId, isValidPhone, toEnDigits } from '../lib/identity.js';

/**
 * فیلدهای هویتیِ یک «شخص» — تک‌منبعِ فرم.
 *
 * هر جا آدمی تعریف می‌شود (جراح، کارشناس، مدیر) همین کامپوننت استفاده می‌شود،
 * پس ترتیب، برچسب و قاعدهٔ اعتبارسنجی یک‌جا نوشته و همه‌جا یکسان است. اگر روزی
 * فیلدی اضافه شود، فقط این‌جا عوض می‌شود — این همان چیزی است که پراکندگی را می‌بندد.
 *
 * value: { firstName, lastName, phone, nationalId, email, city, address, iban, notes }
 */
export function personErrors(v) {
  const e = {};
  if (!v.firstName?.trim() || v.firstName.trim().length < 2) e.firstName = 'نام را کامل وارد کنید';
  if (!v.lastName?.trim() || v.lastName.trim().length < 2) e.lastName = 'نام خانوادگی را کامل وارد کنید';
  if (v.phone?.trim() && !isValidPhone(v.phone)) e.phone = 'شمارهٔ موبایل باید ۱۱ رقم و با ۰۹ باشد';
  if (v.nationalId?.trim() && !isValidNationalId(v.nationalId)) e.nationalId = 'کدِ ملی معتبر نیست';
  if (v.iban?.trim() && !isValidIban(v.iban)) e.iban = 'شمارهٔ شبا معتبر نیست';
  if (v.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email.trim())) e.email = 'ایمیل معتبر نیست';
  return e;
}

export default function PersonFields({ value, onChange, errors = {}, disabled }) {
  const set = (k) => (ev) => onChange({ ...value, [k]: ev.target.value });
  // فیلدهای عددی همان لحظه به رقمِ انگلیسی تبدیل می‌شوند تا کاربر بین دو کیبورد نماند.
  const setNum = (k) => (ev) => onChange({ ...value, [k]: toEnDigits(ev.target.value) });

  const field = (key, label, node, hint) => (
    <label className={`pf-field${errors[key] ? ' bad' : ''}`}>
      <span>{label}</span>
      {node}
      {errors[key] ? <em className="pf-err">{errors[key]}</em> : hint ? <em className="pf-hint">{hint}</em> : null}
    </label>
  );

  return (
    <div className="pf">
      <div className="pf-row2">
        {field('firstName', 'نام *', (
          <input type="text" value={value.firstName ?? ''} onChange={set('firstName')} disabled={disabled} autoComplete="given-name" />
        ))}
        {field('lastName', 'نام خانوادگی *', (
          <input type="text" value={value.lastName ?? ''} onChange={set('lastName')} disabled={disabled} autoComplete="family-name" />
        ))}
      </div>

      <div className="pf-row2">
        {field('phone', 'موبایل', (
          <input type="tel" inputMode="numeric" dir="ltr" placeholder="09…" value={value.phone ?? ''} onChange={setNum('phone')} disabled={disabled} />
        ))}
        {field('nationalId', 'کد ملی', (
          <input type="text" inputMode="numeric" dir="ltr" maxLength={10} placeholder="۱۰ رقم" value={value.nationalId ?? ''} onChange={setNum('nationalId')} disabled={disabled} />
        ))}
      </div>

      <div className="pf-row2">
        {field('email', 'ایمیل', (
          <input type="email" dir="ltr" value={value.email ?? ''} onChange={set('email')} disabled={disabled} autoComplete="email" />
        ))}
        {field('city', 'شهر', (
          <input type="text" value={value.city ?? ''} onChange={set('city')} disabled={disabled} />
        ))}
      </div>

      {field('address', 'آدرس', (
        <input type="text" value={value.address ?? ''} onChange={set('address')} disabled={disabled} />
      ))}

      {field('iban', 'شمارهٔ شبا', (
        <input type="text" dir="ltr" placeholder="IR…" value={value.iban ?? ''} onChange={setNum('iban')} disabled={disabled} />
      ), 'برای پرداختِ سهم — بدونِ IR هم بنویسید، خودش کامل می‌شود')}

      {field('notes', 'یادداشت', (
        <textarea rows={2} value={value.notes ?? ''} onChange={set('notes')} disabled={disabled} />
      ))}
    </div>
  );
}
