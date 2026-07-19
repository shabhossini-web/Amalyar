// مخزنِ چندحسابیِ استاندارد — لیستِ حساب‌های واردشده روی این دستگاه.
// قانون: فقط ورودهای «مرا به خاطر بسپار» در لیست می‌مانند؛ ورودِ موقت (sessionStorage) ثبت نمی‌شود.
const KEY = 'amalyar_accounts';

const slim = (u) => ({
  id: u.id,
  displayName: u.displayName,
  username: u.username,
  phone: u.phone,
  level: u.level,
  levelName: u.levelName,
  selfie: u.selfie ?? null,
});

export const getAccounts = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const save = (list) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Quota پر (سلفی‌های بزرگ) → بدونِ سلفی ذخیره کن تا اپ کرش نکند
    try {
      localStorage.setItem(KEY, JSON.stringify(list.map((a) => ({ ...a, user: { ...a.user, selfie: null } }))));
    } catch {
      /* — */
    }
  }
};

/** افزودن/به‌روزرسانیِ حساب؛ حسابِ جدید اولِ لیست (فعال) می‌نشیند */
export const upsertAccount = (token, user) => {
  const rest = getAccounts().filter((a) => a.user.id !== user.id);
  save([{ token, user: slim(user) }, ...rest]);
};

export const removeAccount = (id) => save(getAccounts().filter((a) => a.user.id !== id));

export const updateAccountUser = (id, user) =>
  save(getAccounts().map((a) => (a.user.id === id ? { ...a, user: slim(user) } : a)));

export const clearAccounts = () => localStorage.removeItem(KEY);
