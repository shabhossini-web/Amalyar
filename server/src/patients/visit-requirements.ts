import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type RequiredItemInput = { itemId: number; quantity: number; notes?: string };

/**
 * Resolve identities at the write boundary; never trust a submitted product name or price.
 *
 * ردیف‌های اقلامِ یک مراجعه — کالا، تعدادِ **برنامه‌ریزی‌شده** (`quantity`) و تعدادِ **طبقِ نسخه**
 * (`prescribedQuantity`).
 *
 * ⚠️ تصمیمِ مالک (۱۴۰۵/۰۷/۰۱): تعدادِ اصلی طبقِ نسخه روی مراجعه ثبت می‌شود و به اتاقِ عمل
 * می‌رود، و **پس از تأیید قفل است**. پس دو عدد لازم است نه یکی: برنامه (چقدر می‌بریم —
 * مثلاً یک پیچِ یدک) می‌تواند عوض شود، نسخه نه. تا دیروز یک `quantity` بود و اولین ویرایشِ
 * پرتالِ جراح عددِ نسخه را بی‌صدا بازنویسی می‌کرد.
 *
 * @param opts.prescribe تأییدِ ثبت‌نام — همین تعدادها «طبقِ نسخه» ثبت و قفل می‌شوند.
 * @param opts.previous ردیف‌های فعلیِ مراجعه — «طبقِ نسخه»ِ هر کالا از آن‌ها **حمل** می‌شود، و
 *   ردیفِ نسخه‌دار حذف نمی‌شود (برنامه‌اش عوض می‌شود، خودش می‌ماند).
 */
export async function resolveRequirements(prisma: PrismaService, rows: RequiredItemInput[], opts: { prescribe?: boolean; previous?: unknown } = {}) {
  if (!Array.isArray(rows) || rows.length > 100) throw new BadRequestException('فهرست اقلام موردنیاز نامعتبر است');
  const ids = new Set<number>();
  for (const row of rows) {
    if (!row || !Number.isInteger(row.itemId) || row.itemId < 1 || !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 10000 || (row.notes !== undefined && (typeof row.notes !== 'string' || row.notes.length > 1000))) throw new BadRequestException('کالا و تعداد صحیحِ مثبت را وارد کنید');
    if (ids.has(row.itemId)) throw new BadRequestException('کالا تکراری است؛ تعداد همان ردیف را اصلاح کنید');
    ids.add(row.itemId);
  }
  const prescribed = prescribedOf(opts.previous);
  for (const [itemId, row] of prescribed) {
    if (!ids.has(itemId)) throw new BadRequestException(`«${row.name ?? 'کالا'}» طبقِ نسخه است و حذف نمی‌شود؛ تعدادِ برنامه‌ریزی‌شده‌اش را عوض کنید`);
  }
  /* ⚠️ کالای نسخه‌دار از فعال‌بودن معاف است: اگر بعد از تأیید در تعاریف غیرفعال شد، ویرایشِ
     بعدیِ همان مراجعه نباید به‌خاطرِ ردیفی که حذف‌شدنی نیست برای همیشه قفل شود. */
  const items = await prisma.item.findMany({ where: { id: { in: [...ids] }, OR: [{ active: true }, { id: { in: [...prescribed.keys()] } }] }, select: { id: true, name: true, size: true } });
  if (items.length !== ids.size) throw new BadRequestException('یکی از کالاها در تعاریف پایه موجود یا فعال نیست');
  return rows.map(row => {
    const item = items.find(i => i.id === row.itemId)!;
    return {
      itemId: item.id, name: [item.name, item.size].filter(Boolean).join(' '), quantity: row.quantity,
      prescribedQuantity: opts.prescribe ? row.quantity : prescribed.get(item.id)?.quantity ?? null,
      notes: row.notes?.trim() || null,
    };
  });
}

/** «طبقِ نسخه»ِ ردیف‌های فعلی، به تفکیکِ کالا — ردیفِ بی‌نسخه (افزوده‌شده بعد از تأیید) این‌جا نیست. */
function prescribedOf(previous: unknown): Map<number, { quantity: number; name: string | null }> {
  const out = new Map<number, { quantity: number; name: string | null }>();
  for (const r of Array.isArray(previous) ? previous : []) {
    const itemId = Number(r?.itemId), quantity = Number(r?.prescribedQuantity);
    if (Number.isInteger(itemId) && itemId > 0 && Number.isInteger(quantity) && quantity > 0) out.set(itemId, { quantity, name: r?.name ?? null });
  }
  return out;
}

export async function procedureRequirements(prisma: PrismaService, procedureTypeId?: number | null, opts: { prescribe?: boolean } = {}) {
  if (!procedureTypeId) return [];
  const needs = await prisma.procedureTypeItem.findMany({ where: { procedureTypeId, item: { active: true } }, select: { itemId: true, quantity: true, notes: true } });
  return resolveRequirements(prisma, needs.map(n => ({ ...n, notes: n.notes ?? undefined })), opts);
}
