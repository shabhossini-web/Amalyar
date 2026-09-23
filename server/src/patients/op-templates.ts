import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/**
 * **پیش‌فرض‌های شرحِ عمل** — همان `NoteTemplate`ِ نوعِ `op`، از جایی که شرح
 * نوشته می‌شود (فرمِ عمل، میزِ اتاقِ عمل، پرونده).
 *
 * درخواستِ مالک (۱۴۰۵/۰۷/۰۱): «زیرِ شرحِ عمل وقتی تایپ کردند یک "افزودن به
 * پیش‌فرض" بگذار، که شرحی که نوشته‌اند را همان‌جا به شرح‌عمل‌های آن عمل اضافه
 * کنند». تا امروز قالب را فقط از «تعاریفِ پایه» می‌شد ساخت و فقط در کامپوزرِ
 * پرونده پیشنهاد می‌شد — یعنی جراحی که در اتاق یک شرحِ خوب می‌نوشت، برای بارِ
 * بعد باید از صفحهٔ دیگری با سطحِ ادمین دوباره تایپش می‌کرد.
 *
 * ⚠️ یک تابع برای هر کار، مشترکِ دو مسیر (`/op-templates` زیرِ ماژولِ داشبورد و
 * `/theatre/visits/:id/op-templates` زیرِ ماژولِ اتاقِ عمل): اگر هرکدام رتبه‌بندی
 * یا قاعدهٔ تکراری را خودش می‌نوشت، روزی جراح در اتاق و منشی در فرم برای یک
 * عمل دو فهرستِ متفاوت می‌دیدند.
 *
 * ⚠️ فقط **می‌افزاید**. ویرایش/غیرفعال/حذف همچنان مالِ «تعاریفِ پایه» است
 * (`definitions.manage`)؛ پس این مسیر با مجوزِ پایین‌ترِ `templates.add` امن است.
 */

/** کوتاه‌تر از این «شرح» نیست، یک تکه‌متن است؛ پیش‌فرضِ یک‌کلمه‌ای فقط چیپِ بی‌فایده می‌سازد. */
export const OP_TEMPLATE_MIN = 10;
/** همان سقفِ متنِ شرح‌های بالینی — قالبی بلندتر از خودِ شرح معنا ندارد. */
export const OP_TEMPLATE_MAX = 20000;
export const OP_TEMPLATE_TITLE_MAX = 120;
/** سقفِ پیش‌فرضِ فعالِ هر عمل — فهرستِ چیپ باید قابلِ‌خواندن بماند و افزودنِ انبوه ممکن نباشد. */
export const OP_TEMPLATE_CAP = 30;
/** کنترل‌های جهتِ متن (نه ZWNJ): عنوانِ دو قالب نباید فقط با نویسهٔ نامرئی متفاوت باشد. */
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** مقایسهٔ «همان متن»: فاصله‌ها و خط‌شکنی‌های اضافه تفاوت نیستند. */
const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

const faNum = (n: number) => n.toLocaleString('fa-IR');

export type OpTemplateItem = { id: number; title: string; body: string; procedureTypeId: number | null; specific: boolean };

/**
 * پیش‌فرض‌های شرحِ عمل برای فهرستی از انواعِ عمل — **اولی اصلی** (همان ترتیبِ
 * `procedureIds`ِ visit-coding).
 *
 * ترتیب: پیش‌فرض‌های عملِ اصلی، بعد عمل‌های همزمان به ترتیبِ رتبه، بعد
 * پیش‌فرض‌های عمومی (بی‌هدف). همان رتبه‌بندیِ `record.noteTemplates`، فقط
 * محدود به محورِ عمل — قالبی که به تشخیص یا موضوع گره خورده این‌جا نمی‌آید،
 * چون این فهرست زیرِ «شرحِ عمل» است نه کامپوزرِ عمومیِ پرونده.
 */
export async function listOpTemplates(prisma: any, procedureTypeIds: number[]): Promise<OpTemplateItem[]> {
  const ids = [...new Set(procedureTypeIds.filter((x) => Number.isInteger(x) && x > 0))];
  const rows: any[] = await prisma.noteTemplate.findMany({
    where: {
      kind: 'op', active: true,
      OR: [
        { procedureTypeId: null, diagnosisId: null, topicId: null },
        ...(ids.length ? [{ procedureTypeId: { in: ids } }] : []),
      ],
    },
    orderBy: [{ title: 'asc' }, { id: 'asc' }],
    select: { id: true, title: true, body: true, procedureTypeId: true },
    take: OP_TEMPLATE_CAP * 3,
  });
  /* عمومی‌ها بعد از همهٔ اختصاصی‌ها؛ `sort` پایدار است، پس ترتیبِ عنوان داخلِ هر گروه می‌ماند. */
  const rank = (t: any) => (t.procedureTypeId == null ? ids.length : ids.indexOf(t.procedureTypeId));
  return rows
    .sort((a, b) => rank(a) - rank(b))
    .map((t) => ({ id: t.id, title: t.title, body: t.body, procedureTypeId: t.procedureTypeId, specific: t.procedureTypeId != null }));
}

/**
 * افزودنِ متنِ نوشته‌شده به پیش‌فرض‌های شرحِ یک نوعِ عمل.
 *
 * - **تکراری ساخته نمی‌شود:** اگر همین متن (با فاصله‌های نرمال‌شده) از قبل
 *   پیش‌فرضِ فعالِ همین عمل است، همان برمی‌گردد با `duplicate: true` — حالتِ
 *   دلخواه از قبل برقرار است، پس خطا نیست.
 * - اگر همان متن پیش‌تر بوده و **مدیر غیرفعالش کرده**، دوباره زنده نمی‌شود:
 *   ۴۰۹ با پیامِ روشن. تصمیمِ مدیر با یک کلیکِ دیگران بی‌صدا برنمی‌گردد.
 * - عنوان: همان که کاربر داده، وگرنه نامِ عمل — و اگر آن نام گرفته شده،
 *   «نام (۲)»، «نام (۳)»… تا چیپ‌ها از هم تشخیص داده شوند.
 */
export async function addOpTemplate(
  prisma: any,
  input: { procedureTypeId: number; body: string; title?: string | null },
): Promise<{ created: boolean; duplicate: boolean; template: OpTemplateItem; procedureName: string }> {
  const body = String(input.body ?? '').trim();
  if (body.length < OP_TEMPLATE_MIN) throw new BadRequestException('متن کوتاه‌تر از آن است که پیش‌فرض شود');
  if (body.length > OP_TEMPLATE_MAX) throw new BadRequestException('متن بلندتر از سقفِ یک قالب است');
  const pt = await prisma.procedureType.findUnique({ where: { id: input.procedureTypeId }, select: { id: true, name: true } });
  if (!pt) throw new NotFoundException('نوعِ عمل یافت نشد');

  const siblings: any[] = await prisma.noteTemplate.findMany({
    where: { kind: 'op', procedureTypeId: pt.id },
    select: { id: true, title: true, body: true, procedureTypeId: true, active: true },
    orderBy: { id: 'asc' },
  });
  /* فعالِ هم‌متن مقدم است: غیرفعالِ قدیمی نباید قالبِ فعالِ هم‌متن را بپوشاند و ۴۰۹ِ دروغ بدهد. */
  const twin = siblings.find((t) => t.active && same(t.body, body)) ?? siblings.find((t) => same(t.body, body));
  const item = (t: any): OpTemplateItem => ({ id: t.id, title: t.title, body: t.body, procedureTypeId: t.procedureTypeId, specific: true });
  if (twin?.active) return { created: false, duplicate: true, template: item(twin), procedureName: pt.name };
  if (twin) {
    throw new ConflictException(`همین متن پیش‌تر پیش‌فرضِ «${pt.name}» بوده و غیرفعال شده است — فعال‌کردنش از «تعاریفِ پایه» است`);
  }

  if (siblings.filter((t) => t.active).length >= OP_TEMPLATE_CAP) {
    throw new ConflictException(`«${pt.name}» ${faNum(OP_TEMPLATE_CAP)} پیش‌فرضِ فعال دارد — اول یکی را از «تعاریفِ پایه» بردارید`);
  }
  /* عنوانِ دستی هم یکتا می‌شود: دو چیپِ هم‌نام یعنی جراح نمی‌داند کدام قالبِ تأییدشده است. */
  const wanted = String(input.title ?? '').replace(BIDI, '').trim().slice(0, OP_TEMPLATE_TITLE_MAX) || pt.name;
  const taken = new Set(siblings.map((t) => t.title));
  let title = wanted;
  for (let n = 2; taken.has(title); n++) title = `${wanted} (${faNum(n)})`;
  const t = await prisma.noteTemplate.create({
    data: { kind: 'op', title, body, procedureTypeId: pt.id },
    select: { id: true, title: true, body: true, procedureTypeId: true },
  });
  return { created: true, duplicate: false, template: item(t), procedureName: pt.name };
}
