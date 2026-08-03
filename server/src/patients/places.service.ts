import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_PLACES, placeKey } from '../common/place';

/**
 * محل‌های تحویل — «کجا گذاشتم / به کجا دادم».
 *
 * ⚠️ **کانونی‌سازی هنگامِ نوشتن انجام می‌شود، نه هنگامِ گزارش.** اگر متنِ خام
 * ذخیره شود و بعداً بخواهیم مرتبش کنیم، باید گذشته را حدس بزنیم — و گذشته
 * قابلِ بازسازی نیست. همان درسی که یکسان‌سازیِ نامِ بیمارستان داد، این‌بار
 * پیش از انباشتِ داده.
 *
 * ⚠️ **متنِ آزاد رد نمی‌شود.** کارشناسِ وسطِ عمل باید بتواند واقعیت را ثبت
 * کند حتی اگر جایی باشد که کسی از قبل تعریفش نکرده. فهرست فقط **پیشنهاد و
 * کلیدِ تطبیق** است، نه قفل.
 */
@Injectable()
export class PlacesService {
  constructor(private prisma: PrismaService) {}

  /**
   * فهرست — با کاشتِ تنبلِ پیش‌فرض‌ها.
   *
   * چرا تنبل و نه seed: نصب‌های موجود از قبل هستند و مهاجرتِ دادهٔ جدا لازم
   * می‌شد. اولین باری که کسی فهرست را می‌خواهد، پیش‌فرض‌ها هستند.
   */
  async list(all = false) {
    const count = await this.prisma.deliveryPlace.count();
    if (count === 0) {
      await this.prisma.deliveryPlace.createMany({
        data: DEFAULT_PLACES.map((p) => ({
          name: p.name,
          key: placeKey(p.name),
          aliasKeys: (p.aliases ?? []).map(placeKey).filter(Boolean),
        })),
        skipDuplicates: true,
      });
    }
    const rows = await this.prisma.deliveryPlace.findMany({
      where: all ? {} : { active: true },
      orderBy: { id: 'asc' },
    });
    return rows.map(shape);
  }

  async create(dto: { name: string; aliases?: string[] }) {
    const name = String(dto.name ?? '').trim();
    if (name.length < 2) throw new BadRequestException('نامِ محل را کامل وارد کنید');
    const key = placeKey(name);
    const dup = await this.findByKey(key);
    if (dup) throw new BadRequestException(`«${dup.name}» همین محل است — تکراری ثبت نمی‌شود`);
    return shape(await this.prisma.deliveryPlace.create({ data: { name, key, aliasKeys: this.aliasKeys(dto.aliases, key) } }));
  }

  async patch(id: number, dto: { name?: string; aliases?: string[]; active?: boolean }) {
    const row = await this.prisma.deliveryPlace.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('محل پیدا نشد');
    const data: Record<string, unknown> = {};
    let key = row.key;
    if (dto.name !== undefined) {
      const name = String(dto.name).trim();
      if (name.length < 2) throw new BadRequestException('نامِ محل را کامل وارد کنید');
      key = placeKey(name);
      const dup = await this.findByKey(key);
      if (dup && dup.id !== id) throw new BadRequestException(`«${dup.name}» همین محل است`);
      data.name = name;
      data.key = key;
    }
    if (dto.aliases !== undefined) data.aliasKeys = this.aliasKeys(dto.aliases, key);
    if (dto.active !== undefined) data.active = !!dto.active;
    return shape(await this.prisma.deliveryPlace.update({ where: { id }, data }));
  }

  /**
   * حذف نداریم، غیرفعال‌کردن داریم.
   *
   * محلی که در توقف‌های گذشته ثبت شده اگر پاک شود، آن رکوردها به نامی اشاره
   * می‌کنند که دیگر کلیدِ کانونی ندارد — یعنی دقیقاً همان بی‌نظمی‌ای که این
   * جدول برای حلش ساخته شد.
   */
  async remove(id: number) {
    const row = await this.prisma.deliveryPlace.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('محل پیدا نشد');
    await this.prisma.deliveryPlace.update({ where: { id }, data: { active: false } });
    return { ok: true, deactivated: true };
  }

  /**
   * شکلِ کانونیِ یک متنِ آزاد.
   *
   * اگر با محلِ تعریف‌شده‌ای یکی درآمد، **نامِ رسمیِ همان** برمی‌گردد؛ وگرنه
   * متنِ کاربر با فاصله‌های مرتب‌شده. `null` فقط برای ورودیِ خالی.
   */
  async canonical(raw?: string | null): Promise<string | null> {
    const text = String(raw ?? '').trim();
    if (!text) return null;
    const key = placeKey(text);
    if (!key) return text;
    const hit = await this.findByKey(key);
    return hit?.name ?? text;
  }

  /**
   * محلی که این کلید به آن اشاره می‌کند — نامِ اصلی **یا** یکی از املاها.
   *
   * ⚠️ املا هم باید در همین جست‌وجو باشد، وگرنه «سی اس آر» محلِ تازه‌ای ساخته
   * می‌شود و همان چندگانگی‌ای که این جدول برای حلش آمده برمی‌گردد.
   */
  private findByKey(key: string) {
    return this.prisma.deliveryPlace.findFirst({
      where: { OR: [{ key }, { aliasKeys: { has: key } }] },
    });
  }

  /** املاها → کلید؛ بدونِ تکرار و بدونِ کلیدی که خودِ نامِ اصلی است. */
  private aliasKeys(aliases: string[] | undefined, ownKey: string): string[] {
    const keys = (aliases ?? []).map((a) => placeKey(a)).filter((k) => k && k !== ownKey);
    return [...new Set(keys)];
  }
}

/**
 * ⚠️ `aliases` هم‌نامِ فیلدِ فرم برگردانده می‌شود، نه `aliasKeys`ِ خام: فرمِ
 * ویرایش با همان کلیدی پر می‌شود که با آن ذخیره می‌کند، وگرنه باز‌کردنِ یک
 * محل و زدنِ «ذخیره» املاهایش را پاک می‌کرد.
 */
function shape(r: any) {
  return { ...r, aliases: r.aliasKeys ?? [] };
}
