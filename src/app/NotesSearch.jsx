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

const KINDS = [
  { id: 'history', name: 'شرحِ حال' },
  { id: 'visit', name: 'شرحِ ویزیت' },
  { id: 'op', name: 'شرحِ عمل' },
  { id: 'progress', name: 'سیرِ بیماری' },
  { id: 'discharge', name: 'خلاصهٔ ترخیص' },
  { id: 'consult', name: 'مشاوره' },
];
const KIND_FA = Object.fromEntries(KINDS.map((k) => [k.id, k.name]));

/**
 * جستجوی بالینی (#48) — بینِ **همهٔ** پرونده‌ها: «همهٔ شرح‌عمل‌های فلان عمل»،
 * «هر جا فلان دارو در متن آمده»، … . فیلترها و متن با هم ترکیب می‌شوند و
 * همهٔ استخراج سمتِ سرور است؛ این صفحه فقط فیلتر می‌فرستد و کارت می‌کشد.
 */
export default function NotesSearch() {
  const [f, setF] = useState({ kind: null, procedureTypeId: null, diagnosisId: null, topicId: null, t: '' });
  const [defs, setDefs] = useState({ procedures: [], diagnoses: [], topics: [] });
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const row = useStagger();
  const tRef = useRef(0);
  const reqRef = useRef(0);

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

      <div className="ns-filters">
        <Pick label="نوعِ شرح" placeholder="نوعِ شرح: همه" value={f.kind} options={KINDS} onChange={(v) => change({ kind: v })} />
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
            <span className="ns-kind">{KIND_FA[n.kind] ?? n.kind}</span>
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
          {(n.procedureName || n.diagnosisTitle || n.topicName) && (
            <div className="ns-tags">
              {n.procedureName && <i>{n.procedureName}</i>}
              {n.diagnosisTitle && <i>{n.diagnosisTitle}</i>}
              {n.topicName && <i>{n.topicName}</i>}
            </div>
          )}
          <p className="ns-body">{n.snippet}</p>
        </motion.article>
      ))}
    </div>
  );
}
