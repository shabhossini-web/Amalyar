import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { faDate } from '../lib/jalali.js';
import Pick from '../ui/Pick.jsx';
import { useStagger } from '../ui/stagger.js';
import './launcher.css'; /* lx-toast */
import './notes-search.css';
import { Alert, Back, Book, Search } from '../ui/icons.jsx';
import VoiceInput from '../ui/VoiceInput.jsx';
import { useStatusList } from './config.jsx';

/* ⚠️ فهرستِ نوع‌ها از `/config.statuses.note` می‌آید — تنها خانه‌اش
   `server/src/patients/labels.ts` است. کپیِ ثابتِ قبلی با افزودنِ هر نوعِ
   تازه بی‌صدا کهنه می‌شد. */

/**
 * جستجوی بالینی (#48) — بینِ **همهٔ** پرونده‌ها: «همهٔ شرح‌عمل‌های فلان عمل»،
 * «هر جا فلان دارو در متن آمده»، … . فیلترها و متن با هم ترکیب می‌شوند و
 * همهٔ استخراج سمتِ سرور است؛ این صفحه فقط فیلتر می‌فرستد و کارت می‌کشد.
 */
export default function NotesSearch() {
  /* فهرستِ کاملِ نوع‌ها برای کشویِ فیلتر (برچسبِ هر ردیف را خودش می‌آورد). */
  const noteKinds = useStatusList('note');
  const kindOptions = noteKinds.map((k) => ({ id: k.key, name: k.label }));
  const kindFa = Object.fromEntries(noteKinds.map((k) => [k.key, k.label]));
  const [f, setF] = useState({ kind: null, procedureTypeId: null, diagnosisId: null, topicId: null, t: '' });
  const [defs, setDefs] = useState({ procedures: [], diagnoses: [], topics: [] });
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const row = useStagger();
  const tRef = useRef(0);
  const reqRef = useRef(0);
  /* دستیارِ AI — پرسشِ زبانِ طبیعی روی همهٔ شرح‌ها (+ آمار). */
  const [aiOn, setAiOn] = useState(false);
  const [sttOn, setSttOn] = useState(false);
  const [q, setQ] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiRes, setAiRes] = useState(null);
  const [aiErr, setAiErr] = useState('');

  useEffect(() => {
    let on = true;
    api('/ai/status').then((r) => { if (on) { setAiOn(!!r?.enabled); setSttOn(!!r?.stt); } }).catch(() => {});
    return () => { on = false; };
  }, []);

  const ask = async () => {
    if (!q.trim() || aiBusy) return;
    setAiBusy(true); setAiErr(''); setAiRes(null);
    try {
      setAiRes(await api('/ai/notes-query', { method: 'POST', body: { question: q.trim() } }));
    } catch (e) { setAiErr(e.message); } finally { setAiBusy(false); }
  };

  useEffect(() => { document.title = 'عمل‌یار — جستجوی بالینی'; }, []);
  useEffect(() => {
    Promise.all([
      api('/procedure-types').catch(() => []),
      api('/diagnoses').catch(() => []),
      api('/visit-topics').catch(() => []),
    ]).then(([procedures, diagnoses, topics]) => setDefs({
      procedures,
      diagnoses: (diagnoses ?? []).map((d) => ({ ...d, name: d.title ?? d.name })),
      topics,
    }));
  }, []);

  const load = (filters) => {
    const req = ++reqRef.current;
    const qs = Object.entries({
      kind: filters.kind ?? '',
      procedureTypeId: filters.procedureTypeId ?? '',
      diagnosisId: filters.diagnosisId ?? '',
      topicId: filters.topicId ?? '',
      t: filters.t.trim(),
    }).filter(([, v]) => v !== '' && v !== null)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    api(`/patients/notes/search${qs ? `?${qs}` : ''}`)
      .then((r) => { if (req === reqRef.current) { setRows(r); setErr(''); } })
      .catch((e) => { if (req === reqRef.current) setErr(e.message); });
  };

  useEffect(() => { load(f); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (patch) => {
    const next = { ...f, ...patch };
    setF(next);
    clearTimeout(tRef.current);
    /* فیلترهای انتخابی بلافاصله؛ تایپ با تأخیرِ کوتاه — هر دو از یک مسیر. */
    tRef.current = setTimeout(() => load(next), patch.t !== undefined ? 350 : 0);
  };

  return (
    <div className="ns">
      <div className="ns-bg" aria-hidden="true" />
      <header className="ns-head">
        <Link to="/app" className="ns-back"><Back width="15" height="15" /> سامانه</Link>
        <h1><Book width="20" height="20" /> جستجوی بالینی</h1>
        <p>جستجو در همهٔ شرح‌های پرونده‌ها — با نوعِ شرح، نوعِ عمل، تشخیص، موضوع و متن.</p>
      </header>

      {aiOn && (
        <section className="ns-ai" aria-label="دستیارِ جستجوی بالینی">
          <div className="ns-ai-row">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
              placeholder="از دستیار بپرسید… مثلاً: چند درصدِ بیماران گرسپر داشتند؟"
              aria-label="پرسش از دستیار"
            />
            {sttOn && (
              <VoiceInput
                label="بپرس با صدا"
                disabled={aiBusy}
                onText={(t2) => setQ((cur) => (cur.trim() ? `${cur} ${t2}` : t2))}
                onErr={(m) => setAiErr(m)}
              />
            )}
            <button type="button" className="ns-ai-ask" onClick={ask} disabled={aiBusy || !q.trim()}>
              {aiBusy ? 'دستیار در حالِ گشتن…' : 'بپرس'}
            </button>
          </div>
          {aiErr && <div className="ns-err"><Alert width="15" height="15" /> {aiErr}</div>}
          {aiRes && (
            <div className="ns-ai-out">
              <p className="ns-ai-answer">{aiRes.answer}</p>
              {aiRes.stats && aiRes.stats.total > 0 && (
                <div className="ns-ai-meter" role="img" aria-label={`${aiRes.stats.percent}٪`}>
                  <i style={{ width: `${Math.min(100, aiRes.stats.percent)}%` }} />
                </div>
              )}
              {(aiRes.matches ?? []).map((m) => (
                <article className="ns-card ns-ai-hit" key={m.noteId}>
                  <header className="ns-card-head">
                    <span className="ns-kind">{m.kindFa ?? kindFa[m.kind] ?? m.kind}</span>
                    <Link to={`/app/patients/${m.patientId}`} className="ns-patient">
                      <b>{m.patientName ?? 'بی‌نام'}</b>
                      {m.patientCode && <span>{m.patientCode}</span>}
                    </Link>
                    {m.visitCode && <small>{m.visitCode}</small>}
                  </header>
                  <p className="ns-body">{m.snippet}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="ns-filters">
        <Pick label="نوعِ شرح" placeholder="نوعِ شرح: همه" value={f.kind} options={kindOptions} onChange={(v) => change({ kind: v })} />
        <Pick label="نوعِ عمل" placeholder="نوعِ عمل: همه" value={f.procedureTypeId} options={defs.procedures} onChange={(v) => change({ procedureTypeId: v })} />
        <Pick label="تشخیص" placeholder="تشخیص: همه" value={f.diagnosisId} options={defs.diagnoses} onChange={(v) => change({ diagnosisId: v })} />
        <Pick label="موضوعِ ویزیت" placeholder="موضوع: همه" value={f.topicId} options={defs.topics} onChange={(v) => change({ topicId: v })} />
        <div className="ns-q">
          <Search width="15" height="15" aria-hidden="true" />
          <input
            value={f.t}
            onChange={(e) => change({ t: e.target.value })}
            placeholder="جستجو در متنِ شرح‌ها…"
            aria-label="جستجو در متن"
          />
        </div>
      </div>

      {err && <div className="ns-err"><Alert width="15" height="15" /> {err}</div>}
      {!rows && !err && <div className="ns-empty">در حال بارگذاری…</div>}
      {rows && rows.length === 0 && <div className="ns-empty">شرحی با این فیلترها پیدا نشد.</div>}

      {rows && rows.map((n, i) => (
        <motion.article {...row(i)} className="ns-card" key={n.id}>
          <header className="ns-card-head">
            <span className="ns-kind">{n.kindFa ?? kindFa[n.kind] ?? n.kind}</span>
            <Link to={`/app/patients/${n.patientId}`} className="ns-patient">
              <b>{n.patientName ?? 'بی‌نام'}</b>
              {n.patientCode && <span>{n.patientCode}</span>}
            </Link>
            <small>
              {n.visitCode ? `${n.visitCode} · ` : ''}
              {n.opDate ? `${faDate(n.opDate)} · ` : ''}
              {faDate(n.createdAt)}
              {n.authorName ? ` · ${n.authorName}` : ''}
            </small>
          </header>
          {/* ⚠️ `procedureName` از سرور همین حالا برچسبِ ترکیبی («A + B») است؛
              تشخیص هم برچسبِ کاملش (همهٔ تشخیص‌ها، اصلی اول) — نتیجه‌ای که
              به‌خاطرِ تشخیصِ دوم پیدا شده باید همان تشخیص را هم نشان بدهد. */}
          {(n.procedureName || n.diagnosisLabel || n.diagnosisTitle || n.topicName) && (
            <div className="ns-tags">
              {n.procedureName && <i>{n.procedureName}</i>}
              {(n.diagnosisLabel ?? n.diagnosisTitle) && <i>{n.diagnosisLabel ?? n.diagnosisTitle}</i>}
              {n.topicName && <i>{n.topicName}</i>}
            </div>
          )}
          <p className="ns-body">{n.snippet}</p>
        </motion.article>
      ))}
    </div>
  );
}
