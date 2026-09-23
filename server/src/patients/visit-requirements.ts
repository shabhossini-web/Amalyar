import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { mergeNeeds } from './visit-coding';

export type RequiredItemInput = { itemId: number; quantity: number; notes?: string };

/** Resolve identities at the write boundary; never trust a submitted product name or price. */
export async function resolveRequirements(prisma: PrismaService, rows: RequiredItemInput[]) {
  if (!Array.isArray(rows) || rows.length > 100) throw new BadRequestException('فهرست اقلام موردنیاز نامعتبر است');
  const ids = new Set<number>();
  for (const row of rows) {
    if (!row || !Number.isInteger(row.itemId) || row.itemId < 1 || !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 10000 || (row.notes !== undefined && (typeof row.notes !== 'string' || row.notes.length > 1000))) throw new BadRequestException('کالا و تعداد صحیحِ مثبت را وارد کنید');
    if (ids.has(row.itemId)) throw new BadRequestException('کالا تکراری است؛ تعداد همان ردیف را اصلاح کنید');
    ids.add(row.itemId);
  }
  const items = await prisma.item.findMany({ where: { id: { in: [...ids] }, active: true }, select: { id: true, name: true, size: true } });
  if (items.length !== ids.size) throw new BadRequestException('یکی از کالاها در تعاریف پایه موجود یا فعال نیست');
  return rows.map(row => { const item = items.find(i => i.id === row.itemId)!; return { itemId: item.id, name: [item.name, item.size].filter(Boolean).join(' '), quantity: row.quantity, notes: row.notes?.trim() || null }; });
}

/**
 * عکسِ کیتِ پیش‌فرض از روی **همهٔ** عمل‌های مراجعه (اصلی اول) — مسیرِ تأییدِ پذیرش.
 *
 * ⚠️ ادغام (`mergeNeeds`) **پیش از** `resolveRequirements`: آن تابع کالای تکراری
 * را ۴۰۰ می‌کند، پس الحاقِ سادهٔ قالبِ دو عمل که هر دو گاز می‌خواهند تأیید را
 * می‌شکست. همان قاعدهٔ اجتماعِ کیتِ میزِ اتاقِ عمل و چینش — مصرفی جمع، ست و
 * دستگاه بیشینه. تک‌عمل از مسیرِ سریعِ `mergeNeeds` می‌گذرد و همان فهرستِ دیروز
 * است (فقط حالا ترتیبش صریحاً `id` است، نه ترتیبِ دلخواهِ دیتابیس).
 */
export async function procedureRequirements(prisma: PrismaService, ids: (number | null | undefined)[]) {
  const order = [...new Set(ids.filter((x): x is number => Number.isInteger(x) && (x as number) > 0))];
  if (!order.length) return [];
  const rows = await prisma.procedureTypeItem.findMany({
    where: { procedureTypeId: { in: order }, item: { active: true } },
    orderBy: { id: 'asc' },
    select: { procedureTypeId: true, itemId: true, quantity: true, notes: true, item: { select: { assetKind: true } } },
  });
  const needs = mergeNeeds(order.map((id) => rows.filter((r) => r.procedureTypeId === id)));
  return resolveRequirements(prisma, needs.map(n => ({ itemId: n.itemId, quantity: n.quantity, notes: n.notes ?? undefined })));
}
