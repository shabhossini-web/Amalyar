import { normalizeLinks } from './forms.service';

/**
 * لینک‌های باکسِ `links`ِ یک فرم → **مدرکِ لینکیِ** پرونده (تبِ مدارک).
 *
 * ⚠️ چرا این‌جا و نه فقط در `Visit.extra`: پزشک لینکِ MRI را در فرمِ ویزیت
 * می‌گرفت و بعد در پرونده باید لای پاسخ‌های همان یک مراجعه دنبالش می‌گشت؛
 * تبِ «مدارک» که همهٔ MRI/آزمایش‌ها را یک‌جا دارد، از آن بی‌خبر بود. حالا هر
 * لینک یک ردیفِ `Document` با `externalUrl` می‌شود — همان چیزی که «ثبتِ لینک»
 * دستیِ خودِ پرونده می‌سازد — با نامِ کاربری/رمزِ پورتال کنارش.
 *
 * ⚠️ فقط **اضافه** می‌کند، هرگز حذف نمی‌کند: مدرکی که در پرونده نشسته ممکن
 * است بعداً دسته/عنوانش ویرایش شده باشد؛ برداشتنِ لینک از فرم نباید مدرکِ
 * پرونده را پاک کند. تکراری‌ها با خودِ نشانی (روی همان بیمار) شناخته می‌شوند.
 *
 * `db` یا `PrismaService` است یا کلاینتِ تراکنش — تا داخلِ همان تراکنشِ ساختِ
 * مراجعه بنشیند و مراجعهٔ بی‌مدرک یا مدرکِ بی‌مراجعه نماند.
 */
export async function syncLinkDocuments(
  db: any,
  opts: {
    patientId: number;
    visitId: number | null;
    fields: { key: string; type?: string | null; label: string; docCategory?: string | null }[];
    values: Record<string, any>;
    actorId: number | null;
  },
) {
  const linkFields = (opts.fields ?? []).filter((f) => f.type === 'links');
  if (!linkFields.length) return;
  for (const f of linkFields) {
    const raw = opts.values?.[f.key];
    if (raw === undefined || raw === null) continue;
    /* نرمال‌سازی پیش از این انجام شده (`normalizeExtra` / `fill`)؛ این‌جا فقط
       دفاعی است — مقدارِ خراب مدرک نمی‌سازد ولی ذخیرهٔ مراجعه را هم نمی‌شکند. */
    let items: ReturnType<typeof normalizeLinks>;
    try { items = normalizeLinks(raw, f.label); } catch { continue; }
    if (!items.length) continue;

    const existing = await db.document.findMany({
      where: { patientId: opts.patientId, externalUrl: { in: items.map((i) => i.url) }, deletedAt: null },
      select: { id: true, externalUrl: true },
    });
    const have = new Map<string, number>(existing.map((e: any) => [e.externalUrl, e.id]));
    for (const it of items) {
      if (have.has(it.url)) { await attachVoice(db, opts, it, have.get(it.url)!); continue; }
      const created = await db.document.create({
        data: {
          patientId: opts.patientId,
          visitId: opts.visitId,
          category: it.kind ?? f.docCategory ?? 'other',
          title: (it.title || f.label).slice(0, 120),
          /* همان قراردادِ `addDocumentLink`: عنوان اگر هست، وگرنه دامنه. */
          fileName: (it.title || new URL(it.url).hostname).slice(0, 200),
          mimeType: 'text/uri-list',
          size: 0,
          sha256: '',
          externalUrl: it.url,
          externalUser: it.user,
          externalPass: it.pass,
          uploadedById: opts.actorId,
        },
      });
      have.set(it.url, created.id);
      await attachVoice(db, opts, it, created.id);
    }
  }
}

/**
 * توضیحِ صوتیِ یک لینک → زیرِ همان مدرکِ لینکی (بستهٔ ۶د).
 *
 * صدا پیش از ذخیرهٔ فرم آپلود شده (مدرکِ مستقلِ همان بیمار)؛ این‌جا فقط
 * «مالِ کدام لینک است» نوشته می‌شود (`refType='document'`) و اگر هنوز به
 * مراجعه‌ای وصل نبود، به همین مراجعه.
 *
 * ⚠️ شرطِ `patientId` و `audio/*` عمداً در خودِ `WHERE` است: شناسه از کلاینت
 * می‌آید و بدونِ آن، هر کس می‌توانست صدای بیمارِ دیگری را زیرِ لینکِ خودش
 * بکشد. `updateMany` یعنی شناسهٔ نامعتبر بی‌صدا هیچ کاری نمی‌کند.
 */
async function attachVoice(db: any, opts: { patientId: number; visitId: number | null }, it: any, linkDocId: number) {
  const vid = it?.voice?.id;
  if (!vid) return;
  await db.document.updateMany({
    where: { id: vid, patientId: opts.patientId, deletedAt: null, mimeType: { startsWith: 'audio/' } },
    data: { refType: 'document', refId: linkDocId },
  });
  if (opts.visitId) {
    await db.document.updateMany({
      where: { id: vid, patientId: opts.patientId, visitId: null },
      data: { visitId: opts.visitId },
    });
  }
}
