import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';
import { SettingsService } from '../config/settings.service';
import {
  SITE_BLOCKS, SITE_BLOCK_BY_KEY, SITE_PUBLISHED_KEY, SITE_SECTIONS, SITE_SECTION_BY_KEY,
  isSiteItemKind, sectionPlanFor,
} from './site.registry';

/** یک قلمِ محتوا، همان‌طور که صفحهٔ عمومی می‌بیندش. */
export interface PublicItem {
  id: number;
  title: string;
  subtitle: string | null;
  body: string | null;
  icon: string | null;
  /** نشانیِ تصویر، یا null. خودِ sha هرگز بیرون نمی‌رود — دلیلش در schema. */
  image: string | null;
  image2: string | null;
}

/**
 * نشانیِ تصویر — **بدونِ پیشوندِ `/api`**.
 *
 * ⚠️ کلاینت خودش با `apiUrl()` پیشوند می‌زند؛ در توسعه فرانت روی ۵۱۷۳ و API
 * روی ۳۰۰۹ است، پس نشانیِ نسبیِ آماده به سرورِ ویت می‌خورد نه به API و تصویر
 * ۴۰۴ می‌شود. همان قاعدهٔ `BASE` در `lib/api.js`.
 */
const itemUrl = (id: number, slot: 1 | 2) => `/public/site/items/${id}/image${slot === 2 ? '2' : ''}`;

@Injectable()
export class SiteService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private config: ConfigService,
    private settings: SettingsService,
  ) {}

  // ── خواندن ──────────────────────────────────────────────────────

  /** متن‌ها: پیش‌فرضِ کد، بازنویسی‌شده با آن‌چه شرکت نوشته. */
  private async blocks(): Promise<Record<string, string>> {
    const rows = await this.prisma.siteBlock.findMany();
    const saved = new Map(rows.map((r) => [r.key, r.value]));
    const out: Record<string, string> = {};
    for (const def of SITE_BLOCKS) out[def.key] = saved.get(def.key) ?? def.value;
    return out;
  }

  /** آیا شرکت سایتش را منتشر کرده؟ نبودِ ردیف = نه (پیش‌فرضِ خاموش). */
  private async published(): Promise<boolean> {
    const row = await this.prisma.siteBlock.findUnique({ where: { key: SITE_PUBLISHED_KEY } });
    return row?.value === '1';
  }

  /**
   * بخش‌ها: ترتیبِ رجیستری، روشن/خاموشِ ذخیره‌شده.
   *
   * ⚠️ بخشی که ردیف ندارد از **چیدمانِ حوزهٔ کاری** پیش‌فرض می‌گیرد، نه از
   * `true`ِ ثابت. بدونِ آن، شرکتِ نورومانیتورینگ سایتش را با «نظرِ مراجعان»ِ
   * خالی منتشر می‌کرد.
   */
  private async sections() {
    const [rows, vertical] = await Promise.all([
      this.prisma.siteSection.findMany(),
      this.config.vertical(),
    ]);
    const saved = new Map(rows.map((r) => [r.key, r]));
    const plan = new Set(sectionPlanFor(vertical));
    return SITE_SECTIONS.map((def, i) => {
      const row = saved.get(def.key);
      return {
        key: def.key,
        label: def.label,
        hint: def.hint ?? null,
        kind: def.kind ?? null,
        enabled: row?.enabled ?? plan.has(def.key),
        sort: row?.sort ?? i,
      };
    }).sort((a, b) => a.sort - b.sort);
  }

  private toPublic(r: any): PublicItem {
    return {
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      body: r.body,
      icon: r.icon,
      image: r.imageSha ? itemUrl(r.id, 1) : null,
      image2: r.image2Sha ? itemUrl(r.id, 2) : null,
    };
  }

  /**
   * صفحهٔ عمومی — **بدونِ احراز**.
   *
   * ⚠️ هویتِ شرکت این‌جا **گلچین** می‌شود، نه `settings.brand()`ِ کامل: آن
   * شناسهٔ ملی و کدِ اقتصادی هم دارد که مالِ فاکتورِ رسمی است، نه صفحه‌ای که
   * هر کسی بازش می‌کند.
   */
  async publicView() {
    const [blocks, sections, brand, published] = await Promise.all([
      this.blocks(), this.sections(), this.settings.brand(), this.published(),
    ]);
    const on = published ? sections.filter((s) => s.enabled) : [];
    const kinds = on.map((s) => s.kind).filter((k): k is string => !!k);

    const rows = kinds.length
      ? await this.prisma.siteItem.findMany({
        where: { kind: { in: kinds }, active: true },
        orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      })
      : [];

    const items: Record<string, PublicItem[]> = {};
    for (const k of kinds) items[k] = [];
    for (const r of rows) items[r.kind]?.push(this.toPublic(r));

    return {
      /* منتشرنشده یا بی‌بخش یعنی «این شرکت سایت ندارد» — کلاینت با همین
         تصمیم می‌گیرد ریشهٔ دامنه را مثلِ قبل به فرمِ ورود بفرستد. */
      enabled: on.length > 0,
      brand: {
        name: brand.name,
        legalName: brand.legalName,
        phone: brand.phone,
        address: brand.address,
        color: brand.color,
      },
      blocks,
      sections: on.map((s) => ({ key: s.key, kind: s.kind })),
      items,
    };
  }

  /** نمای ویرایشگر — شاملِ بخش‌های خاموش، قلم‌های غیرفعال و تعریفِ فیلدها. */
  async adminView() {
    const [blocks, sections, rows, published] = await Promise.all([
      this.blocks(),
      this.sections(),
      this.prisma.siteItem.findMany({ orderBy: [{ kind: 'asc' }, { sort: 'asc' }, { id: 'asc' }] }),
      this.published(),
    ]);
    const items: Record<string, any[]> = {};
    for (const r of rows) {
      (items[r.kind] ??= []).push({
        id: r.id, kind: r.kind, title: r.title, subtitle: r.subtitle, body: r.body,
        icon: r.icon, active: r.active, sort: r.sort,
        image: r.imageSha ? itemUrl(r.id, 1) : null,
        image2: r.image2Sha ? itemUrl(r.id, 2) : null,
      });
    }
    return {
      published,
      sections,
      blocks,
      blockDefs: SITE_BLOCKS.map((b) => ({
        key: b.key, label: b.label, section: b.section,
        multiline: !!b.multiline, hint: b.hint ?? null,
      })),
      items,
    };
  }

  // ── نوشتن ───────────────────────────────────────────────────────

  /** متنِ برابرِ پیش‌فرض ردیف نمی‌گیرد — همان قاعدهٔ `settings.update`. */
  async saveBlocks(values: Record<string, unknown>, user: any) {
    const changed: { key: string; from: string; to: string }[] = [];
    const current = await this.blocks();

    for (const [key, raw] of Object.entries(values)) {
      const def = SITE_BLOCK_BY_KEY.get(key);
      if (!def) throw new BadRequestException(`کلیدِ ناشناخته: ${key}`);
      if (typeof raw !== 'string') throw new BadRequestException(`مقدارِ «${def.label}» باید متن باشد`);
      const value = raw.trim();
      if (value.length > 4000) throw new BadRequestException(`متنِ «${def.label}» بلند است`);
      if (value === current[key]) continue;
      changed.push({ key, from: current[key], to: value });
      if (value === def.value) {
        await this.prisma.siteBlock.deleteMany({ where: { key } });
      } else {
        await this.prisma.siteBlock.upsert({
          where: { key }, create: { key, value }, update: { value },
        });
      }
    }

    for (const c of changed) {
      await this.audit.record({
        actorId: user?.id, action: 'site.block', entityType: 'site_block', entityId: 0,
        before: { key: c.key, value: c.from }, after: { key: c.key, value: c.to },
      });
    }
    return { changed: changed.length, blocks: await this.blocks() };
  }

  /**
   * انتشار / لغوِ انتشار.
   *
   * ⚠️ عمداً مسیرِ خودش را دارد و در `saveBlocks` نیست: انتشار تنها کاری در
   * این ماژول است که چیزی را **بیرونِ** دیوارِ لاگین می‌برد، و باید در
   * `audit` ردِ جدا داشته باشد تا بعداً بشود گفت چه کسی و کِی.
   */
  async setPublished(value: boolean, user: any) {
    const before = await this.published();
    await this.prisma.siteBlock.upsert({
      where: { key: SITE_PUBLISHED_KEY },
      create: { key: SITE_PUBLISHED_KEY, value: value ? '1' : '0' },
      update: { value: value ? '1' : '0' },
    });
    await this.audit.record({
      actorId: user?.id, action: value ? 'site.publish' : 'site.unpublish',
      entityType: 'site_block', entityId: 0,
      before: { published: before }, after: { published: value },
    });
    return { published: value };
  }

  async saveSections(rows: { key: string; enabled?: boolean; sort?: number }[], user: any) {
    const before = await this.sections();
    for (const row of rows) {
      const def = SITE_SECTION_BY_KEY.get(row.key);
      if (!def) throw new BadRequestException(`بخشِ ناشناخته: ${row.key}`);
      const prev = before.find((s) => s.key === row.key)!;
      const enabled = row.enabled ?? prev.enabled;
      const sort = row.sort ?? prev.sort;
      await this.prisma.siteSection.upsert({
        where: { key: row.key },
        create: { key: row.key, enabled, sort },
        update: { enabled, sort },
      });
    }
    await this.audit.record({
      actorId: user?.id, action: 'site.sections', entityType: 'site_section', entityId: 0,
      before: { sections: before.map((s) => ({ key: s.key, enabled: s.enabled, sort: s.sort })) },
      after: { sections: rows },
    });
    return this.sections();
  }

  async createItem(dto: any, user: any) {
    if (!isSiteItemKind(dto.kind)) throw new BadRequestException('نوعِ قلم نامعتبر است');
    const last = await this.prisma.siteItem.findFirst({
      where: { kind: dto.kind }, orderBy: { sort: 'desc' }, select: { sort: true },
    });
    const row = await this.prisma.siteItem.create({
      data: {
        kind: dto.kind,
        title: dto.title.trim(),
        subtitle: dto.subtitle?.trim() || null,
        body: dto.body?.trim() || null,
        icon: dto.icon?.trim() || null,
        active: dto.active ?? true,
        sort: dto.sort ?? (last ? last.sort + 1 : 0),
      },
    });
    await this.audit.record({
      actorId: user?.id, action: 'site.item.create', entityType: 'site_item', entityId: row.id,
      before: null, after: { kind: row.kind, title: row.title },
    });
    return row;
  }

  async patchItem(id: number, dto: any, user: any) {
    const before = await this.prisma.siteItem.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('این قلم پیدا نشد');
    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.subtitle !== undefined) data.subtitle = dto.subtitle?.trim() || null;
    if (dto.body !== undefined) data.body = dto.body?.trim() || null;
    if (dto.icon !== undefined) data.icon = dto.icon?.trim() || null;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.sort !== undefined) data.sort = dto.sort;
    const row = await this.prisma.siteItem.update({ where: { id }, data });
    await this.audit.record({
      actorId: user?.id, action: 'site.item.update', entityType: 'site_item', entityId: id,
      before: { title: before.title, active: before.active }, after: { title: row.title, active: row.active },
    });
    return row;
  }

  /**
   * حذفِ قلم.
   *
   * ⚠️ تصویرش پاک **نمی‌شود**: ذخیره‌سازی content-addressed است و اگر همان
   * فایل جای دیگری هم استفاده شده باشد، پاک‌کردنش آن یکی را می‌شکند. فایلِ
   * بی‌ارجاع فضای ناچیزی می‌گیرد؛ تصویرِ ناپدیدشدهٔ یک قلمِ دیگر گران است.
   */
  async removeItem(id: number, user: any) {
    const before = await this.prisma.siteItem.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('این قلم پیدا نشد');
    await this.prisma.siteItem.delete({ where: { id } });
    await this.audit.record({
      actorId: user?.id, action: 'site.item.delete', entityType: 'site_item', entityId: id,
      before: { kind: before.kind, title: before.title }, after: null,
    });
    return { ok: true };
  }

  async setItemImage(id: number, slot: 1 | 2, sha256: string, mime: string) {
    const data = slot === 2
      ? { image2Sha: sha256, image2Mime: mime }
      : { imageSha: sha256, imageMime: mime };
    await this.prisma.siteItem.update({ where: { id }, data });
    return { ok: true, url: itemUrl(id, slot) };
  }

  /** فراداده‌ی تصویر برای استریم — یا null اگر آن اسلات خالی است. */
  async itemImage(id: number, slot: 1 | 2): Promise<{ sha256: string; mime: string } | null> {
    const row = await this.prisma.siteItem.findUnique({ where: { id } });
    if (!row) return null;
    const sha = slot === 2 ? row.image2Sha : row.imageSha;
    const mime = slot === 2 ? row.image2Mime : row.imageMime;
    return sha && mime ? { sha256: sha, mime } : null;
  }

  /** آیا این قلم روی صفحهٔ عمومی دیده می‌شود؟ گاردِ استریمِ عمومی. */
  async isPubliclyVisible(id: number): Promise<boolean> {
    const row = await this.prisma.siteItem.findUnique({ where: { id }, select: { kind: true, active: true } });
    if (!row?.active) return false;
    const section = SITE_SECTIONS.find((s) => s.kind === row.kind);
    if (!section) return false;
    if (!(await this.published())) return false;
    return (await this.sections()).some((s) => s.key === section.key && s.enabled);
  }
}
