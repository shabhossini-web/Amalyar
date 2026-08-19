import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { api, apiEvents } from '../lib/api.js';
import { faDate } from '../lib/jalali.js';
import Overlay from '../ui/Overlay.jsx';
import './launcher.css';
import './chat.css';
import { Back, Chat as ChatIcon, Close, Plus, Send, Users } from '../ui/icons.jsx';

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');

/**
 * چتِ سازمانی (#54) — گفتگوی دونفره و گروهی بینِ حساب‌های همین شرکت.
 *
 * بلادرنگ با SSE: رویدادِ هر پیامِ تازه می‌آید؛ اگر گفتگوی باز همان باشد
 * پیام‌های تازه واکشی و «خوانده» می‌شوند، وگرنه شمارِ نخوانده در فهرست بالا
 * می‌رود. همهٔ شمارش‌ها (نخوانده، پیشنما) از سرور می‌آیند — قانون ۱۵.
 */
export default function Chat() {
  const [channels, setChannels] = useState(null);
  const [dir, setDir] = useState([]);
  const [cur, setCur] = useState(null); // {id, kind, title, members}
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false); // شروعِ گفتگو/گروه
  const [err, setErr] = useState('');
  const curRef = useRef(null);
  const msgsRef = useRef([]);
  const endRef = useRef(null);
  curRef.current = cur;
  msgsRef.current = msgs;

  useEffect(() => { document.title = 'عمل‌یار — پیام‌رسان'; }, []);

  const loadChannels = () => api('/chat/channels').then((r) => { setChannels(r); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { loadChannels(); api('/chat/directory').then(setDir).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** پیام‌های تازهٔ گفتگوی باز — بعد از رویدادِ SSE یا بازکردن. */
  const pullNew = async (chId) => {
    const last = msgsRef.current[msgsRef.current.length - 1]?.id ?? 0;
    const fresh = await api(`/chat/channels/${chId}/messages${last ? `?afterId=${last}` : ''}`);
    if (curRef.current?.id !== chId) return;
    if (fresh.length) {
      setMsgs((m) => [...m, ...fresh.filter((x) => !m.some((y) => y.id === x.id))]);
      await api(`/chat/channels/${chId}/read`, { method: 'POST', body: { lastId: fresh[fresh.length - 1].id } }).catch(() => {});
      loadChannels();
    }
  };

  useEffect(() => {
    const stop = apiEvents('/chat/stream', (ev) => {
      if (!ev?.channelId) return;
      if (curRef.current?.id === ev.channelId) pullNew(ev.channelId);
      else loadChannels();
    });
    return stop;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs]);

  const open = async (ch) => {
    setCur(ch);
    setMsgs([]);
    try {
      const rows = await api(`/chat/channels/${ch.id}/messages`);
      setMsgs(rows);
      const last = rows[rows.length - 1]?.id ?? 0;
      if (last) await api(`/chat/channels/${ch.id}/read`, { method: 'POST', body: { lastId: last } }).catch(() => {});
      loadChannels();
    } catch (e) { setErr(e.message); }
  };

  const send = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || !cur || busy) return;
    setBusy(true);
    try {
      const m = await api(`/chat/channels/${cur.id}/messages`, { method: 'POST', body: { body: text } });
      setInput('');
      setMsgs((old) => [...old, m]);
      loadChannels();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  const startDm = async (accountId) => {
    try {
      const ch = await api('/chat/dm', { method: 'POST', body: { accountId } });
      setSheet(false);
      await loadChannels();
      const row = (await api('/chat/channels')).find((x) => x.id === ch.id);
      open(row ?? { id: ch.id, kind: 'dm', title: dir.find((d) => d.id === accountId)?.name ?? 'گفتگو' });
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className={`ch${cur ? ' has-open' : ''}`}>
      <div className="ch-bg" aria-hidden="true" />
      <aside className="ch-side">
        <header className="ch-side-head">
          <Link to="/app" className="ch-back"><Back width="15" height="15" /> سامانه</Link>
          <h1><ChatIcon width="18" height="18" /> پیام‌رسان</h1>
          <button type="button" className="ch-new" onClick={() => setSheet(true)} aria-label="گفتگوی تازه">
            <Plus width="15" height="15" />
          </button>
        </header>
        {err && <div className="ch-err">{err}</div>}
        {!channels && !err && <div className="ch-empty">در حال بارگذاری…</div>}
        {channels && channels.length === 0 && (
          <div className="ch-empty">هنوز گفتگویی نیست — با «+» شروع کنید.</div>
        )}
        {channels && channels.map((c) => (
          <button
            type="button" key={c.id}
            className={`ch-row${cur?.id === c.id ? ' on' : ''}`}
            onClick={() => open(c)}
          >
            <span className={`ch-avatar${c.kind === 'group' ? ' grp' : ''}`}>
              {c.kind === 'group' ? <Users width="15" height="15" /> : (c.title ?? '؟').slice(0, 1)}
            </span>
            <span className="ch-row-main">
              <b>{c.title}</b>
              <small>{c.lastBody ?? 'بدونِ پیام'}</small>
            </span>
            {c.unread > 0 && <i className="ch-unread">{faNum(c.unread)}</i>}
          </button>
        ))}
      </aside>

      <main className="ch-main">
        {!cur ? (
          <div className="ch-none">یک گفتگو را انتخاب کنید یا با «+» گفتگوی تازه بسازید.</div>
        ) : (
          <>
            <header className="ch-main-head">
              <button type="button" className="ch-back-mob" onClick={() => setCur(null)} aria-label="بازگشت به فهرست">
                <Back width="15" height="15" />
              </button>
              <b>{cur.title}</b>
              {cur.kind === 'group' && cur.members?.length > 0 && (
                <small>{cur.members.join('، ')}</small>
              )}
            </header>
            <div className="ch-msgs">
              {msgs.map((m) => (
                <div key={m.id} className={`ch-msg${m.mine ? ' mine' : ''}`}>
                  <div className="ch-bubble">
                    {!m.mine && cur.kind === 'group' && <em className="ch-author">{m.authorName}</em>}
                    <p>{m.body}</p>
                    <small>{faDate(m.createdAt)}</small>
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <form className="ch-inputbar" onSubmit={send}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="پیام…"
                aria-label="پیام"
              />
              <button type="submit" disabled={busy || !input.trim()} aria-label="ارسال"><Send width="15" height="15" /></button>
            </form>
          </>
        )}
      </main>

      <AnimatePresence>
        {sheet && (
          <NewChatSheet
            dir={dir}
            onClose={() => setSheet(false)}
            onDm={startDm}
            onGroup={async (name, ids) => {
              try {
                const g = await api('/chat/groups', { method: 'POST', body: { name, memberIds: ids } });
                setSheet(false);
                await loadChannels();
                open({ id: g.id, kind: 'group', title: g.name, members: [] });
              } catch (e) { setErr(e.message); }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** شروعِ گفتگو — دونفره با یک کلیک، یا گروه با نام و چند عضو. */
function NewChatSheet({ dir, onClose, onDm, onGroup }) {
  const [mode, setMode] = useState('dm'); // dm | group
  const [name, setName] = useState('');
  const [picked, setPicked] = useState({});
  const ids = Object.keys(picked).filter((k) => picked[k]).map(Number);

  return (
    <Overlay backdrop="ch-sheet-bg" panel="glass ch-sheet" as="section" onClose={onClose} role="dialog" aria-label="گفتگوی تازه">
      <header className="ch-sheet-head">
        <b>گفتگوی تازه</b>
        <button type="button" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>
      <div className="ch-modes" role="radiogroup" aria-label="نوعِ گفتگو">
        <button type="button" role="radio" aria-checked={mode === 'dm'} className={mode === 'dm' ? 'on' : ''} onClick={() => setMode('dm')}>دونفره</button>
        <button type="button" role="radio" aria-checked={mode === 'group'} className={mode === 'group' ? 'on' : ''} onClick={() => setMode('group')}>گروه</button>
      </div>
      {mode === 'group' && (
        <label className="ch-gname">
          <span>نامِ گروه</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً تیمِ پذیرش" />
        </label>
      )}
      <div className="ch-dir">
        {dir.length === 0 && <div className="ch-empty">همکارِ فعالِ دیگری نیست.</div>}
        {dir.map((d) => (
          mode === 'dm' ? (
            <button type="button" key={d.id} className="ch-dir-row" onClick={() => onDm(d.id)}>
              <b>{d.name}</b>
              {d.jobRole && <small>{({ doctor: 'پزشک', secretary: 'منشی', nurse: 'پرستار', assistant: 'دستیار' })[d.jobRole] ?? d.jobRole}</small>}
            </button>
          ) : (
            <label key={d.id} className="ch-dir-row as-check">
              <input
                type="checkbox"
                checked={!!picked[d.id]}
                onChange={(e) => setPicked((s) => ({ ...s, [d.id]: e.target.checked }))}
              />
              <b>{d.name}</b>
            </label>
          )
        ))}
      </div>
      {mode === 'group' && (
        <button
          type="button" className="ch-gsave"
          disabled={name.trim().length < 2 || ids.length === 0}
          onClick={() => onGroup(name.trim(), ids)}
        >
          ساختِ گروه ({faNum(ids.length)} عضو)
        </button>
      )}
    </Overlay>
  );
}
