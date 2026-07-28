import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';

/** بخش‌های تعرفه‌ای — ضریبِ ریالی برای هرکدام جدا تعیین می‌شود. */
export const SECTORS = ['private', 'public', 'nonprofit', 'charity'] as const;
export const SECTOR_LABELS: Record<string, string> = {
  private: 'خصوصی',
  public: 'دولتی',
  nonprofit: 'عمومی غیردولتی',
  charity: 'خیریه',
};

type SeedFile = { version: string; fields: string[]; rows: any[][] };

/**
 * کتابِ ارزش نسبیِ خدماتِ سلامت.
 *
 * فایلِ seed محصولِ استخراج از اکسلِ رسمی است و در repo commit شده
 * (`prisma/seed-data/extract-service-codes.py`). خودِ اکسل commit نمی‌شود چون
 * سالی یک‌بار عوض می‌شود و آنچه باید در diff قابلِ بازبینی باشد نتیجهٔ استخراج است.
 */
@Injectable()
export class ServiceCodesService {
  private readonly log = new Logger(ServiceCodesService.name);
  private seed: SeedFile | null = null;

  constructor(private prisma: PrismaService) {}

  /** فایل یک‌بار خوانده و در حافظه می‌ماند — ۶۰۰۰ ردیف، چند مگابایت. */
  private load(): SeedFile {
    if (this.seed) return this.seed;
    // dist کنارِ prisma نیست؛ مسیر از ریشهٔ پروژه ساخته می‌شود.
    const path = join(process.cwd(), 'prisma', 'seed-data', 'service-codes.json');
    this.seed = JSON.parse(readFileSync(path, 'utf8')) as SeedFile;
    return this.seed;
  }

  /**
   * وارد کردن/به‌روزرسانیِ کتاب.
   *
   * upsert است نه delete+insert: کدهای محلیِ شرکت و اتصال‌های ProcedureType
   * نباید با هر بار وارد کردن از بین بروند.
   */
  async importCatalog(): Promise<{ version: string; imported: number }> {
    const { version, fields, rows } = this.load();
    const idx = Object.fromEntries(fields.map((f, i) => [f, i]));

    const data = rows.map((r) => ({
      code: String(r[idx.code]),
      title: String(r[idx.title]),
      notes: r[idx.notes] ?? null,
      modifier: r[idx.modifier] ?? null,
      rvuTotal: r[idx.rvuTotal] ?? null,
      rvuProfessional: r[idx.rvuProfessional] ?? null,
      rvuTechnical: r[idx.rvuTechnical] ?? null,
      rvuAnesthesia: r[idx.rvuAnesthesia] ?? null,
      anesthesiaFlat: !!r[idx.anesthesiaFlat],
      version,
    }));

    // createMany + skipDuplicates اول (سریع برای نصبِ خالی)، بعد به‌روزرسانیِ
    // آن‌هایی که نسخه‌شان عوض شده. با ۶۰۰۰ upsert تکی چند دقیقه طول می‌کشید.
    await this.prisma.serviceCode.createMany({ data, skipDuplicates: true });
    const stale = await this.prisma.serviceCode.findMany({
      where: { version: { not: version } },
      select: { code: true },
    });
    if (stale.length) {
      const staleSet = new Set(stale.map((s) => s.code));
      for (const row of data.filter((d) => staleSet.has(d.code))) {
        await this.prisma.serviceCode.update({ where: { code: row.code }, data: row });
      }
    }
    this.log.log(`کتابِ ارزش نسبی نسخهٔ ${version}: ${data.length} کد`);
    return { version, imported: data.length };
  }

  async count() {
    const [total, version] = await Promise.all([
      this.prisma.serviceCode.count(),
      this.prisma.serviceCode.findFirst({ select: { version: true }, orderBy: { code: 'asc' } }),
    ]);
    return { total, version: version?.version ?? null };
  }

  /**
   * جستجو — هم با کد هم با شرح.
   *
   * عددِ محض ابتدا به‌عنوان کد جستجو می‌شود چون کاربری که «۹۰۱۳۰۰» می‌زند
   * دنبالِ همان کد است، نه شرحی که این عدد در متنش آمده.
   */
  async search(q?: string, limit = 25) {
    const term = (q ?? '').trim();
    if (term.length < 2) return [];
    const numeric = /^\d+$/.test(term);

    const rows = await this.prisma.serviceCode.findMany({
      where: {
        active: true,
        ...(numeric
          ? { code: { startsWith: term } }
          : { title: { contains: term, mode: 'insensitive' } }),
      },
      take: Math.min(limit, 50),
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => ({
      code: r.code,
      title: r.title,
      modifier: r.modifier,
      rvuTotal: r.rvuTotal,
      rvuProfessional: r.rvuProfessional,
      rvuTechnical: r.rvuTechnical,
    }));
  }

  // ───────────────────────── تعرفه ─────────────────────────

  async tariffs() {
    const rows = await this.prisma.tariff.findMany({ orderBy: [{ year: 'desc' }, { sector: 'asc' }] });
    return rows.map((t) => ({ ...t, sectorLabel: SECTOR_LABELS[t.sector] ?? t.sector }));
  }

  async setTariff(dto: { year: string; sector: string; professional: number; technical: number; anesthesia: number }) {
    if (!SECTORS.includes(dto.sector as any)) throw new BadRequestException('بخشِ تعرفه نامعتبر است');
    if (!/^\d{4}$/.test(dto.year)) throw new BadRequestException('سال باید چهار رقم باشد');
    for (const [key, value] of Object.entries({ professional: dto.professional, technical: dto.technical, anesthesia: dto.anesthesia })) {
      if (!Number.isInteger(value) || value < 0) throw new BadRequestException(`ضریبِ ${key} باید عددِ صحیحِ نامنفی باشد`);
    }
    const where = { year_sector: { year: dto.year, sector: dto.sector } };
    return this.prisma.tariff.upsert({
      where,
      create: dto,
      update: { professional: dto.professional, technical: dto.technical, anesthesia: dto.anesthesia },
    });
  }

  /**
   * فیِ یک خدمت بر اساسِ کتاب و ضریبِ سال.
   *
   * ⚠️ هر جزء جدا ضرب و بعد گرد می‌شود، نه اینکه ارزشِ کل در یک ضریب برود:
   * ضریبِ حرفه‌ای و فنی متفاوت‌اند و جمع‌کردنشان پیش از ضرب، جواب را غلط می‌کند.
   */
  async priceOf(code: string, year?: string, sector = 'private') {
    const service = await this.prisma.serviceCode.findUnique({ where: { code } });
    if (!service) throw new BadRequestException('کدِ خدمت پیدا نشد');

    const tariff = await this.prisma.tariff.findFirst({
      where: { sector, active: true, ...(year ? { year } : {}) },
      orderBy: { year: 'desc' },
    });
    if (!tariff) return { code, title: service.title, price: null, tariff: null };

    // هزارم‌واحد × تومان‌به‌ازای‌واحد ÷ ۱۰۰۰
    const part = (rvu: number | null, factor: number) => (rvu ? Math.round((rvu * factor) / 1000) : 0);
    const price = part(service.rvuProfessional, tariff.professional) + part(service.rvuTechnical, tariff.technical);

    return {
      code,
      title: service.title,
      price,
      breakdown: {
        professional: part(service.rvuProfessional, tariff.professional),
        technical: part(service.rvuTechnical, tariff.technical),
        anesthesia: part(service.rvuAnesthesia, tariff.anesthesia),
      },
      tariff: { year: tariff.year, sector: tariff.sector, sectorLabel: SECTOR_LABELS[tariff.sector] },
    };
  }
}
