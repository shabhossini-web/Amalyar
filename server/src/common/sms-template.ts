/**
 * جای‌گیرهای متنِ پیامک — {date}، {time}، {topic}، {title}، {link}.
 * جای‌گیرِ بی‌مقدار حذف می‌شود؛ متنِ کاربر هرگز خطا نمی‌سازد.
 */
export function renderSms(tpl: string, vars: Record<string, string | null | undefined>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')).trim();
}
