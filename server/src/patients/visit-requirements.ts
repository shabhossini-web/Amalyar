import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { mergeNeeds } from './visit-coding';

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

/**
 * عکسِ کیتِ پیش‌فرض از روی **همهٔ** عمل‌های مراجعه (اصلی اول) — مسیرِ تأییدِ پذیرش.
 * یک شناسه یا آرایه (اصلی اول).
 *
 * ⚠️ ادغام (`mergeNeeds`) **پیش از** `resolveRequirements`: آن تابع کالای تکراری
 * را ۴۰۰ می‌کند، پس الحاقِ سادهٔ قالبِ دو عمل که هر دو گاز می‌خواهند تأیید را
 * می‌شکست. همان قاعدهٔ اجتماعِ کیتِ میزِ اتاقِ عمل و چینش — مصرفی جمع، ست و
 * دستگاه بیشینه. تک‌عمل از مسیرِ سریعِ `mergeNeeds` می‌گذرد و همان فهرستِ دیروز
 * است (فقط حالا ترتیبش صریحاً `id` است، نه ترتیبِ دلخواهِ دیتابیس).
 */
export async function procedureRequirements(
  prisma: PrismaService,
  ids: number | null | undefined | (number | null | undefined)[],
  opts: { prescribe?: boolean } = {},
) {
  const order = [...new Set((Array.isArray(ids) ? ids : [ids]).filter((x): x is number => Number.isInteger(x) && (x as number) > 0))];
  if (!order.length) return [];
  const rows = await prisma.procedureTypeItem.findMany({
    where: { procedureTypeId: { in: order }, item: { active: true } },
    orderBy: { id: 'asc' },
    select: { procedureTypeId: true, itemId: true, quantity: true, notes: true, item: { select: { assetKind: true } } },
  });
  const needs = mergeNeeds(order.map((id) => rows.filter((r) => r.procedureTypeId === id)));
  return resolveRequirements(prisma, needs.map(n => ({ itemId: n.itemId, quantity: n.quantity, notes: n.notes ?? undefined })), opts);
}

/**
 * **فهرستِ تأییدشده + نیازِ عمل‌های دیگرِ همان مراجعه** — تأییدِ پذیرش روی
 * مراجعهٔ **موجود** (بازبینیِ بستهٔ ۷).
 *
 * ادغام در مراجعهٔ هدف عملِ تأییدشده را اصلی می‌کند و عمل‌های همزمانِ ثبت‌شده‌اش
 * را نگه می‌دارد؛ ولی عکسِ کیت (`requiredItems`) فقط از فهرستِ همان عملِ
 * تأییدشده ساخته می‌شد، و چون عکسِ صریح بر قالب (`kitTemplate`) مقدم است،
 * اقلامِ عمل‌های نگه‌داشته‌شده از میزِ اتاق، چینش و پرتالِ جراح غیب می‌شدند.
 * همان اجتماعِ `mergeNeeds` (مصرفی جمع، ست/دستگاه بیشینه)؛ فهرستِ تأییدشده اول.
 *
 * ⚠️ سقف‌های `resolveRequirements` (یادداشت ۱۰۰۰، تعداد ۱۰۰۰۰) پس از ادغام
 * رعایت می‌شوند — جمعِ دو فهرستِ مجاز نباید تأیید را ۴۰۰ کند.
 * ⚠️ «طبقِ نسخه»: اگر فهرستِ تأییدشده نسخه‌دار است (لحظهٔ تأیید = لحظهٔ نسخه)،
 * کیتِ ادغام‌شده هم همان لحظه نسخه می‌شود — نه نیمی قفل و نیمی آزاد.
 */
export async function withOtherProcedureNeeds(
  prisma: PrismaService,
  approved: { itemId: number; quantity: number; notes?: string | null; prescribedQuantity?: number | null }[],
  otherIds: (number | null | undefined)[],
) {
  const ids = [...new Set(otherIds.filter((x): x is number => Number.isInteger(x) && (x as number) > 0))];
  if (!ids.length || !approved?.length) return approved;
  const [rows, kinds] = await Promise.all([
    prisma.procedureTypeItem.findMany({
      where: { procedureTypeId: { in: ids }, item: { active: true } },
      orderBy: { id: 'asc' },
      select: { procedureTypeId: true, itemId: true, quantity: true, notes: true, item: { select: { assetKind: true } } },
    }),
    prisma.item.findMany({ where: { id: { in: approved.map((r) => r.itemId) } }, select: { id: true, assetKind: true } }),
  ]);
  if (!rows.length) return approved;
  const kindOf = new Map(kinds.map((k) => [k.id, k.assetKind]));
  const first = approved.map((r) => ({
    itemId: r.itemId, quantity: r.quantity, notes: r.notes ?? null, item: { assetKind: kindOf.get(r.itemId) ?? undefined },
  }));
  const merged = mergeNeeds([first, ...ids.map((id) => rows.filter((r) => r.procedureTypeId === id))]);
  return resolveRequirements(prisma, merged.map((n) => ({
    itemId: n.itemId,
    quantity: Math.min(n.quantity, 10000),
    notes: n.notes ? n.notes.slice(0, 1000) : undefined,
  })), { prescribe: approved.some((r) => Number.isInteger(r.prescribedQuantity)) });
}
