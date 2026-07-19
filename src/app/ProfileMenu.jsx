import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from './auth.jsx';
import { getAccounts } from '../lib/accountsStore.js';
import './profile-menu.css';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
const UserIc = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6.5 8-6.5s8 2.5 8 6.5" /></svg>);
const Caret = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="m6 9 6 6 6-6" /></svg>);
const Check = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M20 6 9 17l-5-5" /></svg>);
const Plus = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M12 5v14M5 12h14" /></svg>);
const Grid = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>);
const LogOut = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></svg>);
const Finger = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" /><path d="M14 13.12c0 2.38 0 6.38-1 8.88" /><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" /><path d="M2 12a10 10 0 0 1 18-6" /><path d="M2 16h.01" /><path d="M21.8 16c.2-2 .131-5.354 0-6" /><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" /><path d="M8.65 22c.21-.66.45-1.32.57-2" /><path d="M9 6.8a6 6 0 0 1 9 5.2v2" /></svg>);

const Avatar = ({ u, size = 32 }) => (
  <span className="pm-avatar" style={{ width: size, height: size }}>
    {u?.selfie ? <img src={u.selfie} alt="" /> : <UserIc width={size * 0.52} height={size * 0.52} />}
  </span>
);

/**
 * کامپوننتِ استانداردِ پروفایل — بالای هر صفحهٔ سامانه.
 * چیپ (سلفی + نام + سطح) → دراپ‌داون: حساب‌های فعال (سوییچ/خروجِ تکی)،
 * افزودن حساب، بازگشت به لانچر، اثر انگشت، خروج از همه.
 */
export default function ProfileMenu({ onToast }) {
  const { user, accountsVersion, switchAccount, logoutAccount, logoutAll, webauthnRegister } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const toast = (m) => onToast?.(m);

  const accounts = useMemo(() => {
    const list = getAccounts();
    // سشنِ موقت (بدونِ «به خاطر بسپار») در لیست نیست ولی باید دیده شود
    if (user && !list.some((a) => a.user.id === user.id)) {
      return [{ token: null, user, ephemeral: true }, ...list];
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, accountsVersion]);

  // بستن با کلیکِ بیرون و Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') toast(e.message || 'خطایی رخ داد');
    } finally {
      setBusy(false);
    }
  };

  const doSwitch = (id) =>
    run(async () => {
      if (id === user.id) return setOpen(false);
      const me = await switchAccount(id);
      toast(`سوییچ به «${me.displayName}»`);
      setOpen(false);
    });

  const doLogoutOne = (id, name) =>
    run(async () => {
      const nextId = await logoutAccount(id);
      toast(`«${name}» خارج شد`);
      if (nextId === null) navigate('/login', { replace: true });
    });

  const doLogoutAll = () =>
    run(async () => {
      await logoutAll();
      navigate('/login', { replace: true });
    });

  const doBio = () =>
    run(async () => {
      try {
        await webauthnRegister();
        toast('ورود با اثر انگشت فعال شد ✓');
      } catch (e) {
        if (e?.name === 'InvalidStateError') toast('اثر انگشتِ این دستگاه قبلاً فعال شده');
        else throw e;
      }
      setOpen(false);
    });

  const onLauncher = pathname === '/app';

  return (
    <div className="pm" ref={ref}>
      <button
        className="glass pm-chip"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="منوی پروفایل"
      >
        <Avatar u={user} size={34} />
        <span className="pm-chip-meta">
          <b>{user.displayName}</b>
          <small>{user.levelName}</small>
        </span>
        <span className={`pm-caret${open ? ' up' : ''}`}><Caret width="15" height="15" /></span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="glass pm-menu"
            role="menu"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <div className="pm-accounts">
              {accounts.map((a) => (
                <div key={a.user.id} className={`pm-acc${a.user.id === user.id ? ' active' : ''}`}>
                  <button
                    className="pm-acc-main"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => doSwitch(a.user.id)}
                    title={a.user.id === user.id ? 'حسابِ فعال' : 'ورود به این حساب'}
                  >
                    <Avatar u={a.user} size={36} />
                    <span className="pm-acc-meta">
                      <b>{a.user.displayName}</b>
                      <small>{a.user.levelName}{a.ephemeral ? ' · موقت' : ''}</small>
                    </span>
                    {a.user.id === user.id && <span className="pm-active-mark"><Check width="15" height="15" /></span>}
                  </button>
                  <button
                    className="pm-acc-out"
                    disabled={busy}
                    onClick={() => doLogoutOne(a.user.id, a.user.displayName)}
                    aria-label={`خروج از ${a.user.displayName}`}
                    title="خروج از این حساب"
                  >
                    <LogOut width="15" height="15" />
                  </button>
                </div>
              ))}
            </div>

            <div className="pm-sep" />

            <button className="pm-item" role="menuitem" disabled={busy}
              onClick={() => { setOpen(false); navigate('/login?add=1'); }}>
              <Plus width="17" height="17" /> افزودن حساب کاربری
            </button>

            {!onLauncher && (
              <button className="pm-item" role="menuitem" disabled={busy}
                onClick={() => { setOpen(false); navigate('/app'); }}>
                <Grid width="17" height="17" /> بازگشت به لانچر
              </button>
            )}

            {'PublicKeyCredential' in window && (
              <button className="pm-item" role="menuitem" disabled={busy} onClick={doBio}>
                <Finger width="17" height="17" /> فعال‌سازی ورود با اثر انگشت
              </button>
            )}

            <div className="pm-sep" />

            <button className="pm-item danger" role="menuitem" disabled={busy} onClick={doLogoutAll}>
              <LogOut width="17" height="17" /> خروج از همهٔ حساب‌ها
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
