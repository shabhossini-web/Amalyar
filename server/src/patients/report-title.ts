import { SERVICES, isServiceKey } from '../config/tenant-profile';

/** نامِ سندِ گزارش — «گزارشِ نورومانیتورینگ» یا «گزارشِ خدمت»، هرگز «گزارشِ عمل» (`uploadReport`). */
export const reportTitle = (service?: string | null) =>
  (isServiceKey(service) ? `گزارشِ ${SERVICES[service].label}` : 'گزارشِ خدمت');

/** نامِ «کار» روی کارت و ساعت‌ها — «نورومانیتورینگ» برای خدمتِ شرکتی، وگرنه «عمل» («شروعِ نورومانیتورینگ»). */
export const workLabel = (service?: string | null) => (isServiceKey(service) ? SERVICES[service].label : 'عمل');
