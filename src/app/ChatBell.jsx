import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAllowedTools } from './tools.jsx';
import { Chat } from '../ui/icons.jsx';
/* همان پوستهٔ دکمهٔ زنگ (`.wb-btn`/`.wb-badge`) — قانونِ ۲۱: صریح ایمپورت می‌شود. */
import './work.css';

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');

/** رویدادی که پیام‌رسان بعد از «خوانده شد» می‌فرستد تا نشانِ پوسته همان لحظه صفر شود. */
export const CHAT_READ = 'amalyar:chat-read';

/**
 * شمارِ پیام‌های نخواندهٔ پیام‌رسان (`GET /chat/unread`). `poll` فقط برای نوارِ پوسته که همیشه
 * روی صفحه است؛ «امروز» با بازشدن و با رویدادِ بالا تازه می‌شود.
 */
export function useChatUnread(enabled, { poll = 0 } = {}) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) { setCount(0); return undefined; }
    let alive = true;
    const load = () => api('/chat/unread')
      .then((r) => { if (alive) setCount(Number(r?.total) || 0); })
      .catch(() => {});
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    load();
    window.addEventListener(CHAT_READ, load);
    if (poll) document.addEventListener('visibilitychange', onVis);
    const t = poll ? setInterval(load, poll) : null;
    return () => {
      alive = false;
      window.removeEventListener(CHAT_READ, load);
      if (poll) document.removeEventListener('visibilitychange', onVis);
      if (t) clearInterval(t);
    };
  }, [enabled, poll]);
  return count;
}

/**
 * دکمهٔ پیام‌رسان کنارِ زنگ، با نشانِ نخوانده (بازبینیِ UX ۱۴۰۵/۰۷): شمارِ نخوانده فقط داخلِ خودِ
 * صفحهٔ پیام‌رسان بود و زنگ — که کاربران «اعلان» می‌خوانندش — فقط کارها را می‌شمرد؛ پزشکی که به
 * منشی پیام می‌داد نمی‌دانست دیده می‌شود یا نه. فقط برای کسی که کاشیِ «پیام‌رسان» را دارد.
 */
export default function ChatBell() {
  const { daily } = useAllowedTools();
  const can = daily.some((x) => x.key === 'messenger');
  const n = useChatUnread(can, { poll: 30_000 });
  if (!can) return null;
  return (
    <Link to="/app/chat" id="ch-btn" className="wb-btn ch-btn" title="پیام‌رسان"
      aria-label={n ? `پیام‌رسان: ${faNum(n)} پیامِ نخوانده` : 'پیام‌رسان'}>
      <Chat width="20" height="20" aria-hidden="true" />
      {n > 0 && <span className="wb-badge ch-badge" data-count={n}>{faNum(n)}</span>}
    </Link>
  );
}
