import { BadRequestException } from '@nestjs/common';
import { toEnDigits } from '../common/identity';
import { VITAL_LABELS } from './labels';
import { DOCUMENT_PHASES, DOCUMENT_PHASE_FA } from './document-categories';

/**
 * **علائمِ حیاتی — کاتالوگ و سنجه** (بستهٔ ۶ج).
 *
 * ⚠️ فایلِ خالص (بدونِ DI): هم `PatientsService` (ردیفِ اولِ لحظهٔ ثبتِ
 * مراجعه) و هم `VitalsService` لازمش دارند؛ اگر در سرویس بود، دو سرویس همدیگر
 * را ایمپورت می‌کردند و Nest در زمانِ decoration کلاسِ `undefined` می‌دید.
 *
 * ⚠️ بازه‌ها عمداً **گشاد**‌ند: هدفشان گرفتنِ غلطِ تایپی است («۱۲۰۰» به‌جای
 * «۱۲۰»، دمای ۳۷۰)، نه قضاوتِ بالینی. عددِ غیرطبیعی ولی ممکن (نبضِ ۱۸۰،
 * اکسیژنِ ۷۵٪) باید بنشیند — پرونده همان را لازم دارد.
 */
export const VITAL_FIELDS: {
  key: string; group: string; unit: string; min: number; max: number; int: boolean;
}[] = [
  { key: 'bpSys', group: 'bp', unit: 'mmHg', min: 40, max: 300, int: true },
  { key: 'bpDia', group: 'bp', unit: 'mmHg', min: 20, max: 200, int: true },
  { key: 'hr', group: 'hr', unit: 'در دقیقه', min: 20, max: 250, int: true },
  { key: 'rr', group: 'rr', unit: 'در دقیقه', min: 4, max: 80, int: true },
  { key: 'temp', group: 'temp', unit: '°C', min: 30, max: 45, int: false },
  { key: 'spo2', group: 'spo2', unit: '٪', min: 40, max: 100, int: true },
  { key: 'weight', group: 'weight', unit: 'kg', min: 0.5, max: 400, int: false },
  { key: 'height', group: 'height', unit: 'cm', min: 30, max: 250, int: false },
  { key: 'pain', group: 'pain', unit: 'از ۱۰', min: 0, max: 10, int: true },
];

/** کاتالوگی که کلاینت از `/config` می‌خواند — برچسب از `labels.ts`، نه این‌جا. */
export const vitalCatalog = () => VITAL_FIELDS.map((f) => ({
  key: f.key, group: f.group, label: VITAL_LABELS[f.group] ?? f.group,
  unit: f.unit, min: f.min, max: f.max, int: f.int,
}));

export type VitalsRow = {
  phase: string | null; takenAt?: Date;
  bpSys: number | null; bpDia: number | null; hr: number | null; rr: number | null;
  temp: number | null; spo2: number | null; weight: number | null; height: number | null;
  pain: number | null; note: string | null;
};

/**
 * ورودیِ کاربر → ردیفِ آمادهٔ نوشتن، یا `null` وقتی هیچ عددی نیامده.
 *
 * ⚠️ `null` و نه خطا برای ردیفِ خالی: فرمِ ثبتِ مراجعه بخشِ علائمِ حیاتی را
 * همیشه می‌فرستد و «بدونِ اجبار» (تصمیمِ مالک) یعنی خالی‌ماندنش عادی است.
 * ولی عددِ نامعتبر **خطاست**، نه نادیده‌گرفتن: فشارِ ۱۲۰۰ که بی‌صدا دور
 * ریخته شود، از فشارِ ثبت‌نشده بدتر است چون کاربر فکر می‌کند ثبت شد.
 */
export function vitalsInput(raw: any): VitalsRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: any = {};
  let any = false;
  for (const f of VITAL_FIELDS) {
    const v = raw[f.key];
    if (v === undefined || v === null || String(v).trim() === '') { out[f.key] = null; continue; }
    const n = Number(toEnDigits(String(v)).replace(/[٫,]/g, '.').trim());
    const label = VITAL_LABELS[f.group] ?? f.key;
    if (!Number.isFinite(n)) throw new BadRequestException(`${label}: عدد نیست`);
    if (f.int && !Number.isInteger(n)) throw new BadRequestException(`${label}: باید عددِ صحیح باشد`);
    if (n < f.min || n > f.max) {
      throw new BadRequestException(`${label}: ${n} خارج از بازهٔ ممکن است (${f.min} تا ${f.max} ${f.unit})`);
    }
    out[f.key] = n;
    any = true;
  }
  /* فشار دو عدد است: یکی بدونِ دیگری یعنی نیمه‌کاره تایپ شده، نه یک اندازه. */
  if ((out.bpSys == null) !== (out.bpDia == null)) {
    throw new BadRequestException('فشارِ خون را کامل بنویسید — هر دو عدد (مثلاً ۱۲۰ روی ۸۰)');
  }
  if (out.bpSys != null && out.bpSys <= out.bpDia) {
    throw new BadRequestException('فشارِ خون: عددِ اول (سیستولیک) باید از دومی بزرگ‌تر باشد');
  }
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 500) : '';
  if (!any && !note) return null;
  if (!any) throw new BadRequestException('دستِ‌کم یکی از علائمِ حیاتی را وارد کنید');

  const phase = raw.phase == null || raw.phase === '' ? null : String(raw.phase);
  if (phase !== null && !(DOCUMENT_PHASES as readonly string[]).includes(phase)) {
    throw new BadRequestException('مرحلهٔ اندازه‌گیری نامعتبر است');
  }
  let takenAt: Date | undefined;
  if (raw.takenAt) {
    const d = new Date(raw.takenAt);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('زمانِ اندازه‌گیری نامعتبر است');
    if (d.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('زمانِ اندازه‌گیری در آینده است');
    takenAt = d;
  }
  return { ...out, phase, ...(takenAt ? { takenAt } : {}), note: note || null };
}

/** در فرمِ عمل هر اندازه مالِ یک مرحله است — کارتِ هر مرحله فقط اندازه‌های خودش را نشان می‌دهد. */
export const VITALS_PHASE_REQUIRED = 'مرحلهٔ اندازه‌گیری را مشخص کنید — قبل، حین یا بعد از عمل';

/**
 * `vitals`ِ بدنهٔ ذخیرهٔ مراجعه — یک نوبت یا فهرستی تا سه نوبت (فرمِ عمل: یکی به‌ازای هر
 * مرحلهٔ الصاق‌شده؛ ویرایش: اندازه‌های تایپ‌شده ولی «ثبت»‌نخورده). ردیفِ خالی دور ریخته می‌شود.
 *
 * ⚠️ در عمل، اندازهٔ بی‌مرحله رد می‌شود: کارتِ علائمِ حیاتی در هر تب فقط اندازه‌های همان
 * مرحله را نشان می‌دهد، پس اندازهٔ بی‌مرحله در هیچ تبی دیده نمی‌شد.
 */
export function vitalsRowsFor(raw: unknown, kind: string | null | undefined): VitalsRow[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (list.length > 3) throw new BadRequestException('علائمِ حیاتیِ این درخواست بیش از اندازه است');
  if (list.some((x) => !x || typeof x !== 'object' || Array.isArray(x))) throw new BadRequestException('علائمِ حیاتی نامعتبر است');
  const rows = list.map((x) => vitalsInput(x)).filter((x): x is VitalsRow => !!x);
  if (kind === 'surgery' && rows.some((r) => !r.phase)) throw new BadRequestException(VITALS_PHASE_REQUIRED);
  return rows;
}

/**
 * ردیفِ خروجی — BMI و برچسبِ مرحله **مشتق**‌اند (قانونِ ۱۵)، نه ستون.
 * BMI فقط وقتی هر دو اندازه در **همان** نوبت ثبت شده باشند؛ ترکیبِ وزنِ
 * امروز با قدِ سالِ پیش عددی می‌سازد که هیچ‌کس اندازه نگرفته.
 */
export function vitalView(r: any) {
  const bmi = r.weight && r.height ? Math.round((r.weight / ((r.height / 100) ** 2)) * 10) / 10 : null;
  return {
    id: r.id, visitId: r.visitId, phase: r.phase ?? null,
    phaseFa: r.phase ? DOCUMENT_PHASE_FA[r.phase] ?? r.phase : null,
    takenAt: r.takenAt, bpSys: r.bpSys, bpDia: r.bpDia, hr: r.hr, rr: r.rr, temp: r.temp,
    spo2: r.spo2, weight: r.weight, height: r.height, pain: r.pain, bmi,
    note: r.note ?? null, recordedByName: r.recordedByName ?? null, createdAt: r.createdAt,
  };
}
