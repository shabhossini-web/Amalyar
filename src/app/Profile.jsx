import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import SelfieCapture from './SelfieCapture.jsx';
import PasswordInput from './PasswordInput.jsx';
import './launcher.css';
import './users.css';
import './login.css';
import './profile.css';
import { api } from '../lib/api.js';
import { toEnDigits } from '../lib/identity.js';
import { faDate } from '../lib/jalali.js';
import { Back, User } from '../ui/icons.jsx';
import Toast, { useToast } from '../ui/Toast.jsx';


export default function Profile() {
  const { user, updateProfile, changePassword, setUser } = useAuth();
  const { msg: toast, show: setToast } = useToast(1800);
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [selfie, setSelfie] = useState(''); // فقط وقتی عکسِ جدید گرفته شود
  const [retaking, setRetaking] = useState(false);
  const [savingP, setSavingP] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwErr, setPwErr] = useState('');
  const [phoneCode, setPhoneCode] = useState(''), [phoneBusy, setPhoneBusy] = useState(false), [phoneMessage, setPhoneMessage] = useState('');
  const verifyPhone = async (confirm) => {
    setPhoneBusy(true); setPhoneMessage('');
    try { if (confirm) { const me = await api('/auth/phone/verify-otp', { method: 'POST', body: { phone: user.phone, code: phoneCode } }); setUser(me); setPhoneMessage('شماره تأیید شد؛ مشخصات و رمز خود را هم تکمیل کنید'); }
      else { await api('/auth/phone/request-otp', { method: 'POST', body: {} }); setPhoneMessage('کد به شماره حساب شما ارسال شد'); }
    } catch (e) { setPhoneMessage(e.message); } finally { setPhoneBusy(false); }
  };

  useEffect(() => { document.title = 'عمل‌یار — پروفایل من'; }, []);
  useEffect(() => {
    setFirstName(user?.firstName || '');
    setLastName(user?.lastName || '');
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return null;

  const dirty =
    firstName.trim() !== (user.firstName || '') ||
    lastName.trim() !== (user.lastName || '') ||
    !!selfie;

  const saveProfile = async (e) => {
    e.preventDefault();
    setSavingP(true);
    try {
      await updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        ...(selfie ? { selfie } : {}),
      });
      setSelfie('');
      setRetaking(false);
      setToast('پروفایل ذخیره شد');
    } catch (e2) {
      setToast(e2.message);
    } finally {
      setSavingP(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setPwErr('');
    setSavingPw(true);
    try {
      await changePassword(curPw, newPw);
      setCurPw('');
      setNewPw('');
      setToast('رمز عبور تغییر کرد');
    } catch (e2) {
      setPwErr(e2.message);
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="lx pf">
      <div className="lx-bg" aria-hidden="true" />
      <div className="lx-grid" aria-hidden="true" />

      <div className="lx-shell us-shell">
        <header className="us-head">
          <Link to="/app" className="lx-back" aria-label="بازگشت به صفحهٔ امروز"><Back width="15" height="15" /> سامانه</Link>
          <h1>پروفایل من</h1>
        </header>

        {user.verificationDueAt && !user.phoneVerifiedAt && <section className="glass us-card pf-card"><h2 className="pf-h2">تأیید حساب موقت</h2>
          <p>شماره {user.phone} را تا {faDate(user.verificationDueAt)} تأیید کنید. حساب تأییدنشده بعد از مهلت غیرفعال می‌شود.</p>
          <button className="us-btn" disabled={phoneBusy} onClick={() => verifyPhone(false)}>دریافت کد پیامکی</button>
          <label className="lg-field"><span>کد تأیید</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={phoneCode} onChange={e => setPhoneCode(toEnDigits(e.target.value).replace(/[^0-9]/g, ''))} /></label>
          <button className="lg-btn" disabled={phoneBusy || phoneCode.length < 5} onClick={() => verifyPhone(true)}>تأیید شماره</button>
        </section>}
        {phoneMessage && <p role="status">{phoneMessage}</p>}
        {/* ── مشخصات ── */}
        <form className="glass us-card pf-card" onSubmit={saveProfile}>
          <div className="pf-avatar-wrap">
            {retaking ? (
              <SelfieCapture value={selfie} onCapture={setSelfie} />
            ) : (
              <span className="pf-avatar">
                {selfie || user.selfie
                  ? <img src={selfie || user.selfie} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  : <User width="48" height="48" />}
              </span>
            )}
            <button type="button" className="selfie-link" onClick={() => { setRetaking((v) => !v); if (retaking) setSelfie(''); }}>
              {retaking ? 'انصراف از تغییرِ عکس' : 'تغییرِ عکسِ پروفایل'}
            </button>
          </div>

          <div className="lg-row2">
            <label className="lg-field"><span>نام</span>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required minLength={2} />
            </label>
            <label className="lg-field"><span>نام خانوادگی</span>
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required minLength={2} />
            </label>
          </div>

          <div className="pf-facts">
            {user.isTestAccount && <p>حساب آزمایشی با پروفایل مستقل؛ برای ورود از نام کاربری استفاده کنید. کد تأیید این حساب فقط در همین پروفایل معتبر است.</p>}
            <div className="pf-fact"><span>نام کاربری</span><b dir="ltr">@{user.username}</b></div>
            <div className="pf-fact"><span>موبایل</span><b dir="ltr">{user.phone}</b></div>
            <div className="pf-fact"><span>سطحِ دسترسی</span><b>{user.levelName}</b></div>
          </div>

          <button className="lg-btn" type="submit" disabled={savingP || !dirty}>
            {savingP ? '…' : 'ذخیرهٔ تغییرات'}
          </button>
        </form>

        {/* ── تغییر رمز ── */}
        <form className="glass us-card pf-card" onSubmit={savePassword}>
          <h2 className="pf-h2">تغییرِ رمز عبور</h2>
          {pwErr && <div className="lg-err" role="alert">{pwErr}</div>}
          <label className="lg-field"><span>رمزِ فعلی</span>
            <PasswordInput value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" required />
          </label>
          <label className="lg-field"><span>رمزِ جدید</span>
            <PasswordInput value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="حداقل ۶ کاراکتر" autoComplete="new-password" required minLength={6} />
          </label>
          <button className="lg-btn" type="submit" disabled={savingPw || !curPw || newPw.length < 6}>
            {savingPw ? '…' : 'تغییرِ رمز'}
          </button>
        </form>
      </div>

      <Toast msg={toast} />
    </div>
  );
}
