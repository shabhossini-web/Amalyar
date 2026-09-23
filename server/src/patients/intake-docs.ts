/**
 * **مدارکِ یک ثبت‌نام برای پاپ‌آپِ تأیید** — فیش‌ها و عکس‌های فرم (کارت ملی،
 * دستور پزشک، …). خالص، بی‌Prisma؛ `intake.service.ts → list()` با یک کوئری
 * نام و نوعِ فایل‌ها را کنارش می‌گذارد.
 *
 * ⚠️ چرا سمتِ سرور (قانون ۱۵): تا دیروز کارتِ صف فقط `receiptDocumentId`
 * (فیشِ **اول**) را نشان می‌داد و پاپ‌آپ دستورِ جراح را با کلیدِ ثابتِ
 * `prescription` از دادهٔ خام درمی‌آورد. بیماری که دو قسط واریز کرده بود فیشِ
 * دومش هرگز جلوی چشمِ تأییدکننده نمی‌آمد، و کارتِ ملی — فیلدِ تازه — اصلاً دیده
 * نمی‌شد. قاعدهٔ «کدام مقدار مدرک است» یک‌جا این‌جاست.
 */

/** شناسهٔ فیش‌ها — `receiptDocumentIds` (چندتایی) با سازگاریِ کلیدِ تکیِ قدیمی. */
export function receiptIdsOf(data: unknown): number[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const many = Array.isArray(d.receiptDocumentIds) ? d.receiptDocumentIds : [d.receiptDocumentId];
  return [...new Set(many.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

export interface ImageRef { id: number; field: string; label: string }

/**
 * عکس‌های فرم به ترتیبِ فیلدها — فقط کادرهایی که **واقعاً** از نوعِ عکس‌اند
 * (`fields`)، نه هر شیءِ `{id}`ی در داده: مقدارِ کادرِ لینک و انتخابِ بیمارستان
 * هم شیء دارند و مدرک نیستند.
 *
 * مقدارِ کادرِ عکس آرایهٔ `{id, name}` است؛ رکوردهای قدیمی یک شیءِ تکی‌اند.
 */
export function imageRefsOf(data: unknown, fields: readonly { key: string; label: string }[]): ImageRef[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const out: ImageRef[] = [];
  const seen = new Set<number>();
  for (const f of fields) {
    const v = d[f.key];
    const list = Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : [];
    for (const x of list as any[]) {
      const id = Number(x?.id);
      if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, field: f.key, label: f.label });
    }
  }
  return out;
}
