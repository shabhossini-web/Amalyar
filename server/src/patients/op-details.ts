import { BadRequestException } from '@nestjs/common';
import { toEnDigits } from '../common/identity';
import { toDateValue } from '../common/jalali';
import { LEVEL } from '../common/levels';
import { fieldRoles, jobRoleLabel } from '../common/job-roles';
import { ANESTHESIA_LABELS, ANTICOAG_LABELS, ASA_LABELS, CLAVIEN_LABELS } from './labels';

/**
 * **جزئیاتِ ساخت‌یافتهٔ عمل** (بستهٔ ۸ — بندِ «د» گزارشِ HIS).
 *
 * خواستهٔ مالک: شرحِ عمل با بخش‌های جدا — تیم، ASA، رضایت‌نامه، ناشتایی، قطعِ
 * ضدانعقاد، خون‌ریزی، نمونهٔ پاتولوژی، ایمپلنت، درن، عارضه با درجه‌بندیِ
 * Clavien–Dindo و تأییدِ تشخیصِ پس از عمل. متنِ روایی (شرحِ عمل، یافته‌ها) همان
 * سندِ نسخه‌دار می‌ماند؛ این‌جا فقط چیزهایی که باید **شمرده** شوند.
 *
 * ⚠️ **تنها نویسنده** (`writeOpDetails`) — فرمِ عمل (`PATCH /visits/:id`) و میزِ
 * اتاقِ عمل هر دو از همین رد می‌شوند؛ دو نویسنده با دو قاعده یعنی روزی درجهٔ
 * عارضه بدونِ عارضه بنشیند. قیدهای CHECKِ مهاجرت پشتیبانِ آخرند.
 *
 * ⚠️ **فیلدِ فرم‌ساز نیستند** — مثلِ علائمِ حیاتی یک بلوکِ ثابت‌اند با ذخیره‌گاهِ
 * خودشان. کلیدِ builtin باید ستونِ `Visit` یا سندِ بالینی باشد (`split()` وگرنه
 * ستونِ ناموجود می‌نویسد)، و مالک برچسب/ستاره برای تک‌تکشان نخواسته بود.
 * مالکیتِ نقش از **فیلدِ مالکِ گروه** قرض گرفته می‌شود (`OP_DETAIL_OWNER`).
 *
 * سه‌حالته: `null` یعنی «ثبت نشده» — نه «خیر». بیمارِ «رضایت: ثبت نشده» با
 * «رضایت: خیر» دو وضعیتِ کاملاً متفاوت‌اند.
 */

type Spec =
  | { kind: 'bool' }
  | { kind: 'enum'; labels: Record<string, string> }
  | { kind: 'int'; min: number; max: number; label: string }
  | { kind: 'text'; max: number; label: string }
  | { kind: 'date'; label: string };

/** ارزیابیِ پیش از عمل — تبِ «قبل از عمل» در فرمِ عمل. */
export const OP_PRE_KEYS = ['asaClass', 'asaEmergency', 'consentSigned', 'npoConfirmed', 'anticoagulant', 'anticoagNote'] as const;
/** تیم و جزئیاتِ حینِ عمل — تبِ «حینِ عمل» و میزِ اتاقِ عمل. */
export const OP_INTRA_KEYS = [
  'assistantSurgeonName', 'anesthesiologistName', 'performedAsPlanned', 'bloodLossMl',
  'specimenSent', 'specimenNote', 'drainPlaced', 'drainNote', 'implantNote',
] as const;
/** بعد از عمل — عارضه تا ۳۰ روز بعد معلوم می‌شود، پس پس از ترخیص هم باز است. */
export const OP_POST_KEYS = ['complication', 'complicationNote', 'clavienGrade', 'complicationDate', 'postopDxConfirmed'] as const;
export const OP_DETAIL_KEYS: readonly string[] = [...OP_PRE_KEYS, ...OP_INTRA_KEYS, ...OP_POST_KEYS];

const SPEC: Record<string, Spec> = {
  asaClass: { kind: 'enum', labels: ASA_LABELS },
  asaEmergency: { kind: 'bool' },
  consentSigned: { kind: 'bool' },
  npoConfirmed: { kind: 'bool' },
  anticoagulant: { kind: 'enum', labels: ANTICOAG_LABELS },
  anticoagNote: { kind: 'text', max: 200, label: 'دارو و آخرین دوز' },
  assistantSurgeonName: { kind: 'text', max: 120, label: 'کمک‌جراح' },
  anesthesiologistName: { kind: 'text', max: 120, label: 'متخصصِ بیهوشی' },
  performedAsPlanned: { kind: 'bool' },
  bloodLossMl: { kind: 'int', min: 0, max: 20000, label: 'خون‌ریزیِ تخمینی (میلی‌لیتر)' },
  specimenSent: { kind: 'bool' },
  specimenNote: { kind: 'text', max: 500, label: 'شرحِ نمونه' },
  drainPlaced: { kind: 'bool' },
  drainNote: { kind: 'text', max: 500, label: 'شرحِ درن' },
  implantNote: { kind: 'text', max: 1000, label: 'ایمپلنت' },
  complication: { kind: 'bool' },
  complicationNote: { kind: 'text', max: 2000, label: 'شرحِ عارضه' },
  clavienGrade: { kind: 'enum', labels: CLAVIEN_LABELS },
  complicationDate: { kind: 'date', label: 'تاریخِ عارضه' },
  postopDxConfirmed: { kind: 'bool' },
};

/**
 * **مالکِ هر کلید = نقشِ کدام فیلدِ فرم.** پیش از عمل مالِ کسی است که بیهوشی را
 * می‌نویسد؛ تیم، حینِ عمل و عارضه مالِ نویسندهٔ شرحِ عمل (جراح).
 */
export const OP_DETAIL_OWNER: Record<string, string> = Object.fromEntries([
  ...OP_PRE_KEYS.map((k) => [k, 'anesthesia']),
  ...OP_INTRA_KEYS.map((k) => [k, 'opReport']),
  ...OP_POST_KEYS.map((k) => [k, 'opReport']),
]);

export type OpDetailsPatch = Record<string, boolean | string | number | Date | null>;

/**
 * ورودیِ `opDetails` → وصلهٔ نرمال‌شده، یا `undefined` (دست نزن).
 *
 * فقط کلیدهای **حاضر**؛ کلیدِ ناشناخته ۴۰۰ (نه دور ریختنِ بی‌صدا — بی‌صدا یعنی
 * «ذخیره شد ✓» روی داده‌ای که ننشست). `''` → `null`. ارقامِ فارسی پذیرفته.
 * @param allowed اگر داده شود، فقط همین کلیدها (میزِ اتاق فقط حینِ عمل را می‌نویسد).
 */
export function opDetailsInput(raw: unknown, allowed?: readonly string[]): OpDetailsPatch | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestException('جزئیاتِ عمل باید یک شیء باشد');
  }
  const out: OpDetailsPatch = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const spec = SPEC[k];
    if (!spec) throw new BadRequestException(`کلیدِ ناشناخته در جزئیاتِ عمل: ${k}`);
    if (allowed && !allowed.includes(k)) throw new BadRequestException('این بخش از جزئیاتِ عمل این‌جا نوشته نمی‌شود');
    if (v === undefined) continue;
    if (v === null || v === '') { out[k] = null; continue; }
    switch (spec.kind) {
      case 'bool':
        if (typeof v !== 'boolean') throw new BadRequestException('مقدارِ بله/خیر نامعتبر است');
        out[k] = v;
        break;
      case 'enum': {
        const key = String(v);
        if (!spec.labels[key]) throw new BadRequestException('گزینهٔ انتخاب‌شده در جزئیاتِ عمل نامعتبر است');
        out[k] = key;
        break;
      }
      case 'int': {
        const n = Number(toEnDigits(String(v)).trim());
        if (!Number.isInteger(n) || n < spec.min || n > spec.max) {
          throw new BadRequestException(`«${spec.label}» باید عددِ صحیح بین ${spec.min} و ${spec.max} باشد`);
        }
        out[k] = n;
        break;
      }
      case 'text': {
        if (typeof v !== 'string') throw new BadRequestException(`«${spec.label}» باید متن باشد`);
        const t = v.trim();
        if (t.length > spec.max) throw new BadRequestException(`«${spec.label}» حداکثر ${spec.max} نویسه است`);
        out[k] = t || null;
        break;
      }
      case 'date': {
        const d = toDateValue(String(v));
        if (!d) throw new BadRequestException(`«${spec.label}» تاریخِ معتبر نیست`);
        out[k] = d;
        break;
      }
    }
  }
  return out;
}

const eq = (a: unknown, b: unknown) => {
  const n = (x: unknown) => (x instanceof Date ? x.toISOString() : x ?? null);
  return n(a) === n(b);
};

/**
 * قاعده‌های میانِ کلیدها، روی **حاصلِ ادغام** (ردیفِ فعلی + وصله):
 * - «اورژانس (E)» بدونِ کلاسِ ASA معنا ندارد.
 * - درجهٔ عارضه و تاریخش فقط وقتی عارضه ثبت شده. اگر کسی عارضه را «خیر» یا
 *   «ثبت نشده» کند، درجه و تاریخ خودکار پاک می‌شوند؛ ولی فرستادنِ درجه
 *   بدونِ عارضه خطاست (نه پاک‌کردنِ بی‌صدا).
 */
function applyRules(cur: Record<string, any>, patch: OpDetailsPatch): Record<string, any> {
  const next = { ...cur, ...patch };
  if (!next.asaClass) {
    /* پاک‌کردنِ کلاس، «E»ِ باقی‌مانده را هم می‌برد؛ فقط فرستادنِ صریحِ E بی‌کلاس خطاست. */
    if (patch.asaEmergency === true) throw new BadRequestException('«اورژانس (E)» بدونِ کلاسِ ASA ثبت نمی‌شود');
    next.asaEmergency = null;
  }
  if (next.complication !== true) {
    if (patch.clavienGrade) throw new BadRequestException('درجهٔ عارضه فقط وقتی ثبت می‌شود که عارضه «بله» باشد');
    if (patch.complicationDate) throw new BadRequestException('تاریخِ عارضه فقط وقتی ثبت می‌شود که عارضه «بله» باشد');
    next.clavienGrade = null;
    next.complicationDate = null;
  }
  return next;
}

/** ستون‌های قابلِ‌نوشتنِ ردیف (بی‌visitId/زمان‌ها) — برای مقایسه و upsert. */
const pickRow = (r: any): Record<string, any> =>
  Object.fromEntries(OP_DETAIL_KEYS.map((k) => [k, r?.[k] ?? null]));

/**
 * **تنها نویسندهٔ** `visit_op_details`.
 *
 * زیرِ قفلِ ردیفِ مراجعه (همان قفلِ `writeOthers`)، ردیفِ فعلی را دوباره
 * می‌خواند، قاعده‌ها را روی حاصلِ ادغام می‌سنجد و upsert می‌کند. بدونِ قفل،
 * میز «عارضه: خیر» و فرم «درجه: IIIa» را هم‌زمان می‌نوشتند و هر دو قاعده را
 * روی ردیفِ کهنه می‌سنجیدند. نوشتنِ بی‌تغییر هیچ ردیفی نمی‌سازد/عوض نمی‌کند.
 */
export async function writeOpDetails(tx: any, visitId: number, patch: OpDetailsPatch) {
  await tx.$queryRaw`SELECT id FROM visits WHERE id = ${visitId} FOR UPDATE`;
  const row = await tx.visitOpDetail.findUnique({ where: { visitId } });
  const cur = pickRow(row);
  const next = applyRules(cur, patch);
  const changed = OP_DETAIL_KEYS.some((k) => !eq(cur[k], next[k]));
  if (!changed) return { changed: false, before: opDetailsView(row), after: opDetailsView(row) };
  const data = pickRow(next);
  const saved = row
    ? await tx.visitOpDetail.update({ where: { visitId }, data })
    : await tx.visitOpDetail.create({ data: { visitId, ...data } });
  return { changed: true, before: opDetailsView(row), after: opDetailsView(saved) };
}

/** نمای خواندنی — برچسب همراهِ کلید (کلاینت نگاشتِ فارسی ندارد). `null` = هنوز ردیفی نیست. */
export function opDetailsView(row: any): (Record<string, any> & { asaFa: string | null; anticoagulantFa: string | null; clavienGradeFa: string | null }) | null {
  if (!row) return null;
  const base = pickRow(row);
  return {
    ...base,
    complicationDate: row.complicationDate ? new Date(row.complicationDate).toISOString() : null,
    asaFa: row.asaClass ? `${ASA_LABELS[row.asaClass] ?? row.asaClass}${row.asaEmergency ? ' (اورژانس)' : ''}` : null,
    anticoagulantFa: row.anticoagulant ? ANTICOAG_LABELS[row.anticoagulant] ?? row.anticoagulant : null,
    clavienGradeFa: row.clavienGrade ? CLAVIEN_LABELS[row.clavienGrade] ?? row.clavienGrade : null,
    updatedAt: row.updatedAt ?? null,
  };
}

/**
 * **مالکیتِ نقش برای جزئیاتِ ساخت‌یافته** — همان قاعدهٔ `assertRoleOwnership`
 * (سوپرادمین و حسابِ بی‌نقش آزاد؛ فقط مقدارِ **تغییرکرده** رد می‌شود)، ولی
 * کلید‌به‌کلید و با مالکِ قرضی:
 *  - هر کلیدِ `opDetails` → فیلدِ `OP_DETAIL_OWNER[key]` (بیهوشی یا شرحِ عمل)؛
 *  - هر ردیفِ `procedureDetails` → فیلدِ `procedureTypeId` (همان مالکِ فهرستِ عمل‌ها).
 *
 * ⚠️ مقایسه کلید‌به‌کلید است، نه کلِ شیء: پرستاری که فقط خون‌ریزی را می‌نویسد و
 * بقیه را بی‌تغییر پس می‌فرستد نباید به‌خاطرِ ASAِ دست‌نخورده رد شود.
 * ⚠️ یک تابع برای دو مسیر (فرم و میزِ اتاق) — میز قبلاً هیچ قفلِ نقشی نداشت.
 */
export async function assertStructuredOwnership(
  prisma: any,
  kind: string | null | undefined,
  user: any,
  ops: {
    patch?: OpDetailsPatch; current?: any;
    procedure?: { next: { procedureTypeId: number; side: string | null; level: string | null }[]; current: any[] };
    /** فیلدهای فرم که مستقیم (نه از راهِ جزئیات) عوض می‌شوند — مثلاً «ویزیتِ بعدی» از پاپ‌آپِ ترخیص. */
    fields?: string[];
  },
) {
  if ((user?.level ?? 0) >= LEVEL.SUPER_ADMIN) return;
  const myRole: string | null = user?.jobRole ?? null;
  if (!myRole || !kind) return;
  const changedOwners = new Set<string>(ops.fields ?? []);
  const cur = pickRow(ops.current);
  for (const [k, v] of Object.entries(ops.patch ?? {})) {
    if (!eq(cur[k], v)) changedOwners.add(OP_DETAIL_OWNER[k]);
  }
  if (ops.procedure) {
    const by = new Map<number, any>((ops.procedure.current ?? []).map((d: any) => [d.procedureTypeId, d]));
    for (const d of ops.procedure.next) {
      const c = by.get(d.procedureTypeId);
      if ((c?.side ?? null) !== d.side || (c?.level ?? null) !== d.level) { changedOwners.add('procedureTypeId'); break; }
    }
  }
  if (!changedOwners.size) return;
  const form = await prisma.formDef.findFirst({
    where: { scope: 'visit', visitKind: kind },
    select: { fields: { select: { key: true, label: true, role: true, roles: true } } },
  });
  for (const owner of changedOwners) {
    const f = form?.fields?.find((x: any) => x.key === owner);
    if (!f) continue;
    const roles = fieldRoles(f);
    if (!roles.length || roles.includes(myRole)) continue;
    const what = owner === 'procedureTypeId' ? 'سمت و سطحِ عمل‌ها'
      : owner === 'anesthesia' ? 'ارزیابیِ پیش از عمل'
        : owner === 'opReport' ? 'جزئیاتِ عمل' : f.label;
    throw new BadRequestException(
      `«${what}» همراهِ «${f.label}» بخشِ ${roles.map(jobRoleLabel).join('، ')} است و با حسابِ ${jobRoleLabel(myRole)} ویرایش نمی‌شود`,
    );
  }
}

/** یک سطرِ خلاصهٔ پیش از عمل برای میز («ASA II · رضایت ✓ …») — فقط خواندنی. */
export function preOpSummary(view: ReturnType<typeof opDetailsView>, anesthesia?: string | null): string | null {
  const an = anesthesia ? ANESTHESIA_LABELS[anesthesia] ?? anesthesia : null;
  if (!view) return an;
  const yn = (b: boolean | null, yes: string, no: string) => (b === true ? yes : b === false ? no : null);
  const parts = [
    an,
    view.asaClass ? `ASA ${view.asaClass}${view.asaEmergency ? 'E' : ''}` : null,
    yn(view.consentSigned, 'رضایت‌نامه امضا شد', 'رضایت‌نامه امضا نشده'),
    yn(view.npoConfirmed, 'ناشتا', 'ناشتا نیست'),
    view.anticoagulantFa ? `ضدانعقاد: ${view.anticoagulantFa}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
