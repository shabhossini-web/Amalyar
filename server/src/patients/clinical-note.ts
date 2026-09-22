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
