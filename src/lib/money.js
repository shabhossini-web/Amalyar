// ابزارهای مالی — قانونِ سراسری: همهٔ مبالغِ عمل‌یار «تومان» و عددِ صحیح‌اند
import { toEnDigits } from './jalali.js';

/// نمایشِ سه‌رقم‌سه‌رقم با ارقامِ فارسی: 30000000 → «۳۰٬۰۰۰٬۰۰۰»
export const fmtMoney = (n) => Number(n || 0).toLocaleString('fa-IR');

/// همان قالب با واحد: 40000000 → «۴۰٬۰۰۰٬۰۰۰ تومان» — عددِ بی‌واحد کنارِ ریالِ کارت‌خوان گمراه‌کننده است
export const fmtToman = (n) => `${fmtMoney(n)} تومان`;

/// رشتهٔ ورودی (با جداکننده/ارقامِ فارسی) → عددِ صحیح
export const parseMoney = (s) => {
  const digits = toEnDigits(s).replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : 0;
};

/// گروه‌بندیِ سه‌رقمی برای داخلِ input (ارقامِ انگلیسی تا کیبورد اندروید خراب نشود)
export const group3 = (s) => {
  const digits = toEnDigits(s).replace(/[^\d]/g, '');
  return digits ? Number(digits).toLocaleString('en-US') : '';
};

const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', ' هزار', ' میلیون', ' میلیارد', ' هزار میلیارد'];

function three(n) {
  const parts = [];
  const h = ~~(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10]);
  else {
    const t = ~~(rest / 10);
    const o = rest % 10;
    if (t) parts.push(TENS[t]);
    if (o) parts.push(ONES[o]);
  }
  return parts.join(' و ');
}

/// عدد → حروفِ فارسی: 30000000 → «سی میلیون»
export function numToWordsFa(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return 'صفر';
  const groups = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = ~~(n / 1000);
  }
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    if (!groups[i]) continue;
    parts.push(three(groups[i]) + (SCALES[i] || ''));
  }
  return parts.join(' و ');
}
