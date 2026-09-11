// مخزنِ چندحسابیِ استاندارد — لیستِ حساب‌های واردشده روی این دستگاه، **فقط برای نمایش**.
//
// ⚠️ توکنی این‌جا نیست. نشست‌ها در کوکیِ HttpOnlyِ سرور نگه داشته می‌شوند و
// سوییچ سمتِ سرور انجام می‌شود (`POST /auth/switch`). این لیست فقط نام/سلفی/سطح را
// برای رندرِ فوریِ منو (قبل از جوابِ سرور) نگه می‌دارد و با `GET /auth/accounts` تازه می‌شود.
// قانون: فقط ورودهای «مرا به خاطر بسپار» در لیست می‌مانند؛ ورودِ موقت ثبت نمی‌شود.
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
    // مهاجرت از نسخهٔ توکن‌دار: فیلدِ token اگر مانده باشد دور ریخته می‌شود.
    return Array.isArray(v) ? v.filter((a) => a?.user?.id).map((a) => ({ user: a.user })) : [];
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
      localStorage.setItem(KEY, JSON.stringify(list.map((a) => ({ user: { ...a.user, selfie: null } }))));
    } catch {
      /* — */
    }
  }
};

/** افزودن/به‌روزرسانیِ حساب؛ حسابِ جدید اولِ لیست (فعال) می‌نشیند */
export const upsertAccount = (user) => {
  const rest = getAccounts().filter((a) => a.user.id !== user.id);
  save([{ user: slim(user) }, ...rest]);
};

/** هم‌گام‌سازی با فهرستِ سرور — ترتیب: فعال اول، بقیه به ترتیبِ سرور. */
export const replaceAccounts = (users) =>
  save([...users].sort((a, b) => Number(!!b.active) - Number(!!a.active)).map((u) => ({ user: slim(u) })));

export const removeAccount = (id) => save(getAccounts().filter((a) => a.user.id !== id));

export const updateAccountUser = (id, user) =>
  save(getAccounts().map((a) => (a.user.id === id ? { user: slim(user) } : a)));

export const clearAccounts = () => localStorage.removeItem(KEY);
