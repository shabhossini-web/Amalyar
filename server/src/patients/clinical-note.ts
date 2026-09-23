import { actorName } from '../common/person';

/**
 * سندهای بالینی‌ای که روی **خودِ آبجکتِ مراجعه** برمی‌گردند.
 *
 * ⚠️ عمداً `string[]`ِ ساده و نه `as const`: این فهرست داخلِ `VISIT_INCLUDE`
 * (که `as const` است) مصرف می‌شود و آرایهٔ readonly را Prisma قبول نمی‌کند.
 *
 * ⚠️ بقیهٔ انواع (`history`, `visit`, `progress`, `consult`) عمداً این‌جا
 * نیستند: آن‌ها به **پرونده** تعلق دارند نه به یک مراجعه، و آوردنشان یعنی
 * هر فهرستِ ۵۰۰تاییِ مراجعه چند برابر سنگین‌تر شود. مسیرِ دیدنشان تبِ
 * شرح‌های پرونده است.
 */
export const VISIT_NOTE_KINDS: string[] = ['op', 'discharge'];

/**
 * **بخش‌های متنیِ هستهٔ ثابتِ مراجعه** — کلیدِ فرم → نوعِ سندِ بالینی.
 *
 * 🔴 چرا (بستهٔ ۶الف): شرحِ معاینه، طرحِ درمان و نسخه فیلدِ **دلخواهِ** قالبِ
 * مطب بودند و در `Visit.extra` می‌نشستند — دقیقاً همان تله‌ای که شکایتِ اولیه
 * داشت: میزِ اتاقِ عمل معاینهٔ ویزیتِ تصمیم را نمی‌دید، تبِ شرح‌های پرونده از
 * آن بی‌خبر بود، و فرم‌ساز می‌توانست خاموشش کند. حالا هر بخش یک سندِ
 * نسخه‌دار با نامِ نویسنده است (همان `setVisitNote`ِ شرحِ عمل و ترخیص).
 *
 * ⚠️ کلیدِ فرم عمداً **همان کلیدِ قدیمیِ فیلدِ دلخواه** است (`exam`,
 * `planNote`, `prescription`): `backfillVisitBuiltins` ردیفِ دلخواهِ هم‌نام را
 * به builtin ارتقا می‌دهد، پس برچسب و نقش و ستاره و جایی که مطب برای این
 * فیلدها چیده بود دست‌نخورده می‌ماند.
 *
 * ⚠️ `opReport` هم این‌جاست چون همین جنس است؛ تا دیروز تنها عضوِ این خانواده
 * بود و مسیرِ جدای خودش را داشت.
 */
export const SECTION_NOTES: Record<string, string> = {
  history: 'history',
  exam: 'exam',
  findings: 'findings',
  planNote: 'plan',
  prescription: 'rx',
  opReport: 'op',
};
export const SECTION_KEYS = Object.keys(SECTION_NOTES);

/** اسنادِ ترخیص — کلیدِ پاسخ → نوع (بستهٔ ۶ب). */
export const DISCHARGE_NOTES: Record<string, string> = {
  dischargeNote: 'discharge',
  dischargeSummary: 'discharge_summary',
  dischargeRemark: 'discharge_note',
};

/**
 * همهٔ انواعی که **نمای کاملِ یک مراجعه** (فرمِ ویرایش، میزِ اتاقِ عمل،
 * خلاصه) لازم دارد.
 *
 * ⚠️ جدا از `VISIT_NOTE_KINDS`: فهرستِ ۵۰۰تاییِ داشبورد متنِ معاینه و نسخه
 * را لازم ندارد و آوردنشان یعنی چند مگابایت متنِ بالینی در هر جستجو. فهرست
 * همان دو نوعِ قبلی را می‌خواند؛ `GET /visits/:id` و ذخیره، همه را.
 */
export const VISIT_FULL_NOTE_KINDS: string[] = [
  ...new Set([...Object.values(SECTION_NOTES), ...Object.values(DISCHARGE_NOTES)]),
];

/**
 * «نسخهٔ جاریِ هر نوع» — یک سند به‌ازای هر نوع.
 *
 * ⚠️ `distinct` و نه `take: N`: `record.addNote` سندِ دستیِ مستقل می‌سازد
 * (جایگزین نمی‌کند)، پس یک مراجعه ممکن است دو «شرحِ عملِ» جاری داشته باشد.
 * با `take` دومی جای یک نوعِ دیگر را می‌گرفت و مثلاً ترخیص بی‌صدا از پاسخ
 * می‌افتاد؛ `distinct` برای هر نوع تازه‌ترین را نگه می‌دارد.
 */
export const currentNotes = (kinds: string[]) => ({
  where: { kind: { in: kinds }, replacedAt: null },
  orderBy: { createdAt: 'desc' as const },
  distinct: ['kind' as const],
});

/** بدنهٔ سندِ جاریِ یک نوع روی آرایهٔ `clinicalNotes`ِ مراجعه. */
export const noteBody = (notes: any[] | undefined, kind: string): string | null =>
  notes?.find((n: any) => n.kind === kind)?.body ?? null;

/**
 * بخش‌های متنیِ یک مراجعه برای پاسخ — `{ exam, planNote, … }`.
 *
 * ⚠️ `undefined` برای نوعی که اصلاً خوانده نشده (فهرستِ سبک) و `null` برای
 * «خوانده شد و خالی است»: فرمِ ویرایش باید این دو را از هم تشخیص دهد، وگرنه
 * باز کردنِ ردیفِ فهرست بخش‌ها را خالی نشان می‌داد و ذخیره پاکشان می‌کرد.
 */
export function sectionsOf(notes: any[] | undefined, loaded: string[]) {
  const out: Record<string, string | null | undefined> = {};
  for (const [key, kind] of Object.entries({ ...SECTION_NOTES, ...DISCHARGE_NOTES })) {
    out[key] = loaded.includes(kind) ? noteBody(notes, kind) : undefined;
  }
  return out;
}

/**
 * نوشتنِ یک **سندِ بالینیِ نسخه‌دار** روی یک مراجعه.
 *
 * ⚠️ سند بازنویسی نمی‌شود: متنِ تازه رکوردِ جدید می‌سازد و قبلی `replacedAt`
 * می‌گیرد و با `replacesId` به آن وصل می‌ماند. پروندهٔ پزشکی تاریخچه دارد؛
 * `UPDATE` روی متنِ سند یعنی پاک‌کردنِ چیزی که یک‌بار امضا شده.
 *
 * ⚠️ خالی‌کردن یعنی «این سند دیگر جاری نیست»، نه «هیچ‌وقت نوشته نشده بود» —
 * پس نسخهٔ قبلی `replacedAt` می‌گیرد ولی نسخهٔ تازه‌ای ساخته نمی‌شود.
 *
 * ⚠️ چرا تابعِ مشترک و نه یک کپی در هر سرویس: شرحِ عمل (`patients.service`) و
 * شرحِ ترخیص (`theatre.service`) هر دو همین معنا را می‌خواهند. کپیِ دوم یعنی
 * روزی یکی‌شان `replacesId` را جا می‌اندازد و زنجیرهٔ نسخه‌ها بی‌صدا پاره
 * می‌شود — چیزی که تا وقتِ ممیزی معلوم نمی‌شود.
 */
export async function setVisitNote(
  tx: any,
  visit: { id: number; patientId: number },
  kind: string,
  body: string | null,
  user: any,
) {
  const current = await tx.clinicalNote.findFirst({
    where: { visitId: visit.id, kind, replacedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  const text = body?.trim() || null;
  if (current?.body === text) return;
  if (!text && !current) return;

  if (current) await tx.clinicalNote.update({ where: { id: current.id }, data: { replacedAt: new Date() } });
  if (text) {
    await tx.clinicalNote.create({
      data: {
        patientId: visit.patientId,
        visitId: visit.id,
        kind,
        body: text,
        authorId: user?.id ?? null,
        authorName: actorName(user),
        replacesId: current?.id ?? null,
      },
    });
  }
}
