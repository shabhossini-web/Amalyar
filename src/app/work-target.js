/**
 * **مقصدِ یک کار** — پاپ‌آپی که «خودِ کار» را انجام می‌دهد، نه فرمِ کلی.
 *
 * بازخوردِ مالک: «هر هشدار باید پاپ‌آپِ خودش را باز کند، نه فرمِ کلی». تا بازبینیِ UX
 * (company-01) کارِ «وضعیتِ عمل ثبت نشده» و «گزارشِ خدمت هنوز بارگذاری نشده» هر دو فرمِ
 * کلیِ ویرایشِ مراجعه را باز می‌کردند — که نه گزینهٔ انجام/موکول/لغو دارد نه جای
 * بارگذاریِ گزارش — و «بررسی و تأییدِ ثبت‌نام» اصلاً مقصدی نداشت.
 *
 * فایلِ سبک و جدا، نه داخلِ `thing-popups.jsx`: `WorkRow` برای برچسبِ دکمهٔ اصلی همین را
 * می‌خواند و `WorkRow` در زنگِ پوسته هم هست؛ import از `thing-popups.jsx` فرمِ مراجعه و
 * شیتِ سفارش را به باندلِ پوسته می‌کشید. `thing-popups.jsx` همین را دوباره صادر می‌کند.
 *
 * `spec`ها همان‌هایی‌اند که `useThings().open` می‌شناسد:
 *  - `opstatus` — پنجرهٔ سه‌گزینه‌ایِ پنلِ کارشناس (انجام شد / موکول / لغو)
 *  - `report`   — بارگذاریِ گزارشِ خدمت
 *  - `intake`   — پنجرهٔ تأییدِ همان ثبت‌نام
 *  - `order`    — شیتِ همان سفارش · `visit` — فرمِ همان مراجعه
 */

/**
 * مطب پنلِ کارشناس و «گزارشِ خدمت» ندارد: وضعیت و شرحِ عملش در همان فرمِ عمل است
 * (`VisitForm`)، پس آن‌جا مقصدِ این دو کار همان فرم می‌ماند.
 */
export function targetForKind(spec, kind) {
  if (kind === 'clinic' && spec && (spec.type === 'opstatus' || spec.type === 'report')) {
    return { type: 'visit', id: spec.id, patientId: spec.patientId };
  }
  return spec;
}

/**
 * @param {object} w ردیفِ کار از سرور (`/work`، `/work/today`)
 * @param {string} [kind] نوعِ نصب (`useConfig().kind`). صفحه‌ها بی‌آن صدا می‌زنند و
 *   `useThings().open` همان `targetForKind` را خودش می‌زند؛ `WorkRow` برای برچسب با آن.
 */
export function workTarget(w, kind) {
  const pid = w?.patientId ?? w?.patient?.id ?? null;
  const visitId = w?.visitId ?? (w?.refType === 'visit' ? w?.refId : null) ?? null;
  const about = { visit: w?.visit ?? null, patientName: w?.patient?.fullName ?? '' };
  if (w?.type === 'confirm_surgery_done' && visitId) {
    return targetForKind({ type: 'opstatus', id: visitId, patientId: pid, ...about }, kind);
  }
  if (w?.type === 'complete_report' && visitId) {
    return targetForKind({ type: 'report', id: visitId, patientId: pid, ...about }, kind);
  }
  if (w?.type === 'approve_intake' && w.refType === 'intake_submission' && w.refId) {
    return { type: 'intake', id: w.refId, patientId: pid };
  }
  const m = /^(lab|imaging|consult|referral)_order$/.exec(w?.refType ?? '');
  if (m && w.refId) return { type: 'order', kind: m[1], id: w.refId, patientId: pid };
  if (visitId) return { type: 'visit', id: visitId, patientId: pid };
  return null;
}
