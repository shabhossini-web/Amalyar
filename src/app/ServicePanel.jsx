/**
 * زبانهٔ «خدمت» در فرمِ مراجعهٔ **شرکتی** (تصمیمِ مالک ۱۴۰۵/۰۸/۰۴) — به‌جای قبل/حین/بعدِ فرمِ عمل.
 *
 * پنج بخش، به همان ترتیبی که کارِ یک خدمت پیش می‌رود:
 * ۱. جراح، عمل و بیمارستان (همان فیلدهای فرم، از والد می‌آیند)؛
 * ۲. تیمِ کارشناسی — هر کارشناس با ساعتِ ورود/خروجِ خودش (`PUT /visits/:id/service/crew`)؛
 * ۳. دستگاه — از دارایی‌های انبار با وضعیتِ همان روز و تعارض با مراجعه‌های دیگر؛
 * ۴. مصرفی‌ها — همان برگهٔ ثبتِ مصرفیِ پنلِ کارشناسی؛
 * ۵. گزارشِ کارشناس — عکس/PDF، همان مسیری که کارِ «گزارش نیامده» را می‌بندد.
 *
 * ⚠️ تیم پیش از ساختِ مراجعه هم پر می‌شود (در `crew`ِ والد می‌ماند و بعد از ذخیره می‌رود)؛
 * دستگاه/مصرفی/گزارش به خودِ مراجعه گره‌اند و فقط بعد از ذخیره باز می‌شوند.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, apiUpload } from '../lib/api.js';
import { faDate } from '../lib/jalali.js';
import { badTime, normTime } from '../lib/time.js';
import { DocThumb, isImageDoc, openDoc } from '../ui/DocThumb.jsx';
import FileDrop from '../ui/FileDrop.jsx';
import Pick from '../ui/Pick.jsx';
import TimePick from '../ui/TimePick.jsx';
import { Box, Boxes, Plus, Trash, Users, Wave } from '../ui/icons.jsx';
import { ConsumeSheet } from './Tech.jsx';
import './service-panel.css';

const faNum = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

export default function ServicePanel({ visitId, patientName, visitCode, crew, onCrew, crewDirty, onCrewSaved, techs = [], head, onToast, disabled }) {
  const [view, setView] = useState(null);
  const [devices, setDevices] = useState(null);
  const [usage, setUsage] = useState(null);
  const [consume, setConsume] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!visitId) return;
    try {
      const v = await api(`/visits/${visitId}/service`);
      setView(v);
      if (!crewDirty && Array.isArray(v?.crew)) onCrew(v.crew.map((c) => ({ accountId: c.accountId, name: c.name, fromTime: c.fromTime ?? '', toTime: c.toTime ?? '' })), true);
    } catch (e) { onToast?.(e.message); }
  }, [visitId]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadDevices = useCallback(() => {
    if (!visitId) return;
    api(`/visits/${visitId}/service/devices`).then((d) => setDevices(Array.isArray(d) ? d : [])).catch(() => setDevices([]));
  }, [visitId]);
  const loadUsage = useCallback(() => {
    if (!visitId) return;
    api(`/stock/visits/${visitId}/usage`).then((u) => setUsage(u?.sets ? u : null)).catch(() => setUsage(null));
  }, [visitId]);
  useEffect(() => { load(); loadDevices(); loadUsage(); }, [load, loadDevices, loadUsage]);

  /* ── تیم ── */
  const used = new Set(crew.map((c) => c.accountId));
  const setRow = (i, patch) => onCrew(crew.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const addRow = () => onCrew([...crew, { accountId: null, fromTime: '', toTime: '' }]);
  const dropRow = (i) => onCrew(crew.filter((_, k) => k !== i));
  const crewErr = crew.some((c) => !c.accountId) ? 'برای هر ردیف یک کارشناس انتخاب کنید'
    : crew.some((c) => badTime(normTime(c.fromTime)) || badTime(normTime(c.toTime))) ? 'ساعت باید به شکلِ ۰۸:۳۰ باشد'
      : crew.some((c) => c.fromTime && c.toTime && normTime(c.toTime) < normTime(c.fromTime)) ? 'ساعتِ خروج پیش از ساعتِ ورود است' : '';
  const saveCrew = async () => {
    if (crewErr) { onToast?.(crewErr); return; }
    setBusy(true);
    try {
      const v = await api(`/visits/${visitId}/service/crew`, { method: 'PUT', body: { crew: crew.map((c) => ({ accountId: c.accountId, fromTime: normTime(c.fromTime) || null, toTime: normTime(c.toTime) || null })) } });
      setView(v);
      onCrewSaved?.();
      onToast?.('تیمِ کارشناسی ثبت شد');
    } catch (e) { onToast?.(e.message); } finally { setBusy(false); }
  };

  /* ── دستگاه ── */
  const pickDevice = async (lotId) => {
    setBusy(true);
    try {
      const v = await api(`/visits/${visitId}/service/device`, { method: 'PUT', body: { lotId: lotId ?? null } });
      setView(v);
      onToast?.(lotId ? 'دستگاه ثبت شد' : 'دستگاه برداشته شد');
      loadDevices();
    } catch (e) { onToast?.(e.message); } finally { setBusy(false); }
  };
  const deviceLabel = (d) => [d.name, d.serialNo ? `سریال ${d.serialNo}` : null, d.stateLabel,
    d.usedBy?.length ? `سرِ ${d.usedBy.map((u) => u.code).join('، ')}` : null].filter(Boolean).join(' · ');

  const usageLines = usage ? [...usage.sets.flatMap((b) => b.lines), ...usage.transfers.flatMap((b) => b.lines), ...usage.warehouse].filter((l) => l.quantity > 0) : [];
  const off = disabled || busy;

  return (
    <div className="sv-panel" data-service-panel>
      <section className="sv-card" aria-label="جراح، عمل و بیمارستان">{head}</section>

      <section className="sv-card" data-sv="crew">
        <header className="sv-head"><Users width="16" height="16" aria-hidden="true" /><b>تیمِ کارشناسی</b><small>اولی کارشناسِ اصلی است (چینش و پنلِ کارشناسی)</small></header>
        {crew.length === 0 && <p className="sv-empty">هنوز کارشناسی ثبت نشده.</p>}
        {crew.map((c, i) => (
          <div key={i} className="sv-crew-row" data-crew-row={i}>
            <div className="sv-crew-who">
              <span className="sv-mini">{i === 0 ? 'کارشناسِ اصلی' : `کارشناسِ ${faNum(i + 1)}`}</span>
              <Pick label="کارشناس" value={c.accountId} disabled={off}
                options={techs.filter((t) => t.id === c.accountId || !used.has(t.id))}
                onChange={(id) => setRow(i, { accountId: id })} clearable={false} />
            </div>
            <TimePick label="از ساعت" value={c.fromTime} disabled={off} onChange={(v) => setRow(i, { fromTime: v })} onCommit={(v) => setRow(i, { fromTime: v })} />
            <TimePick label="تا ساعت" value={c.toTime} disabled={off} onChange={(v) => setRow(i, { toTime: v })} onCommit={(v) => setRow(i, { toTime: v })} />
            <button type="button" className="sv-x" disabled={off} onClick={() => dropRow(i)} aria-label="برداشتنِ این کارشناس"><Trash width="15" height="15" /></button>
          </div>
        ))}
        {crewErr && crew.length > 0 && <small className="sv-err" role="alert">{crewErr}</small>}
        <div className="sv-actions">
          <button type="button" className="sv-ghost" disabled={off || crew.length >= 8} onClick={addRow}><Plus width="14" height="14" /> افزودنِ کارشناس</button>
          {visitId
            ? <button type="button" className="sv-save" disabled={off || !crewDirty || !!crewErr} onClick={saveCrew}>{crewDirty ? 'ثبتِ تیم' : 'ثبت شده'}</button>
            : <small className="sv-note">با «ذخیره»ی همین فرم ثبت می‌شود.</small>}
        </div>
      </section>

      <section className="sv-card" data-sv="device">
        <header className="sv-head"><Box width="16" height="16" aria-hidden="true" /><b>دستگاه</b><small>از دارایی‌های انبار، با وضعیتِ روزِ همین خدمت</small></header>
        {!visitId ? <p className="sv-empty">بعد از ذخیرهٔ همین مراجعه انتخاب می‌شود.</p>
          : devices === null ? <p className="sv-empty">در حالِ بارگذاری…</p>
            : devices.length === 0 ? <p className="sv-empty">در انبار دستگاهی تعریف نشده (کالا با نوعِ «دستگاه»).</p>
              : (
                <>
                  <Pick label="دستگاهِ سرِ خدمت" value={view?.device?.lotId ?? null} disabled={off}
                    options={devices.map((d) => ({ id: d.lotId, name: deviceLabel(d) }))} onChange={pickDevice} placeholder="— دستگاه انتخاب نشده —" />
                  {view?.device?.clash?.length > 0 && (
                    <p className="sv-warn" role="alert">
                      همین دستگاه همان روز سرِ {view.device.clash.map((c) => `${c.code}${c.hospital ? ` (${c.hospital}${c.opStartTime ? `، ساعتِ ${faNum(c.opStartTime)}` : ''})` : ''}`).join('، ')} هم ثبت شده — برنامهٔ چینش و حمل را بررسی کنید.
                    </p>
                  )}
                </>
              )}
      </section>

      <section className="sv-card" data-sv="usage">
        <header className="sv-head"><Boxes width="16" height="16" aria-hidden="true" /><b>مصرفی‌های عمل</b></header>
        {!visitId ? <p className="sv-empty">بعد از ذخیرهٔ همین مراجعه ثبت می‌شود.</p> : (
          <>
            {usageLines.length > 0
              ? <ul className="sv-list">{usageLines.map((l) => <li key={l.key}><span>{l.name}</span><b>{faNum(l.quantity)} {l.mode === 'use' ? 'بار' : l.unit}</b></li>)}</ul>
              : <p className="sv-empty">{usage ? 'هنوز مصرفی‌ای ثبت نشده.' : 'ثبتِ مصرفی برای این نصب در دسترس نیست.'}</p>}
            {usage && <button type="button" className="sv-ghost" disabled={off} onClick={() => setConsume(true)}>{usageLines.length ? 'ویرایشِ مصرفی' : 'ثبتِ مصرفی'}</button>}
          </>
        )}
      </section>

      <section className="sv-card" data-sv="report">
        <header className="sv-head"><Wave width="16" height="16" aria-hidden="true" /><b>{view?.reportLabel ?? 'گزارشِ خدمت'}</b><small>عکس یا PDFِ گزارشی که کارشناس می‌گذارد</small></header>
        {!visitId ? <p className="sv-empty">بعد از ذخیرهٔ همین مراجعه بارگذاری می‌شود.</p> : (
          <>
            {(view?.reports ?? []).length > 0 ? (
              <ul className="sv-docs">
                {view.reports.map((d) => (
                  <li key={d.id}>
                    {isImageDoc(d)
                      ? <button type="button" className="sv-thumb" onClick={() => openDoc(d, onToast)} title="بازکردن"><DocThumb id={d.id} alt={d.title || d.fileName} /></button>
                      : <button type="button" className="sv-file" onClick={() => openDoc(d, onToast)}>{d.fileName}</button>}
                    <small>{faDate(d.createdAt)}</small>
                  </li>
                ))}
              </ul>
            ) : <p className="sv-empty">هنوز گزارشی بارگذاری نشده.</p>}
            <FileDrop variant="button" accept="image/*,.pdf" maxMb={25} disabled={off} label="بارگذاریِ گزارش"
              onUpload={async (file) => { const fd = new FormData(); fd.append('file', file); setView(await apiUpload(`/visits/${visitId}/service/report`, fd)); }}
              onAllDone={({ ok = 0, failed = 0 } = {}) => { if (ok && !failed) onToast?.('گزارش ثبت شد'); }} />
          </>
        )}
      </section>

      {consume && (
        <ConsumeSheet visit={{ id: visitId, patientName, code: visitCode }} onClose={() => setConsume(false)} onToast={onToast}
          onDone={(msg) => { setConsume(false); onToast?.(msg); loadUsage(); }} />
      )}
    </div>
  );
}
