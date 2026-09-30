import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../work/events.service';
import { SettingsService } from '../config/settings.service';
import { BillingService, summarize, withPayState } from './billing.service';
import { SECTOR_LABELS, ServiceCodesService } from './service-codes.service';
import { durationOf } from './patients.service';
import { InventoryService } from './inventory.service';
import { canAccess } from '../auth/access-check';
import { scopedVisitWhere } from '../common/own-scope';
import { OTHER_PX, principalProcedureName, procedureNames } from './visit-coding';

/**
 * فهرستِ خدماتِ نورومانیتورینگ — همان جدولِ ملک‌طب (کدِ کتابِ ارزش نسبی + نامِ رایج).
 *
 * ⚠️ `id` = «کد:نام» است نه کد، چون SEP و VEP یک کد دارند (۹۰۱۳۲۰) و باید جدا
 * تیک بخورند. عنوانِ رسمیِ هر کد از کتاب می‌آید؛ نامِ رایج (EMG، MEP…) چیزی است
 * که کارشناس می‌شناسد و روی فاکتور هم همان را می‌خواهد ببیند.
 */
export const NEURO_CATALOG: { id: string; code: string; label: string }[] = [
  { code: '901275', label: 'EMG' },
  { code: '901290', label: 'EMG' },
  { code: '901325', label: 'MEP' },
  { code: '901320', label: 'SEP' },
  { code: '901320', label: 'VEP' },
  { code: '901365', label: 'EEG' },
  { code: '901385', label: 'MAPPING' },
  { code: '901300', label: 'Monitoring' },
].map((s) => ({ ...s, id: `${s.code}:${s.label}` }));
const NEURO_BY_ID = new Map(NEURO_CATALOG.map((s) => [s.id, s]));

type NeuroBulk = { items: unknown; hours: number; year: string; deviceOwner: string };

/**
 * **قلمِ مبلغِ کلِ مراجعه** — همان که سامانه هنگامِ ساختِ مراجعه از «مبلغ» می‌سازد (تأییدِ ثبت‌نام، فرمِ
 * مراجعه، ورود از ملک‌طب): خدمتِ بی‌کد، بی‌جزئیاتِ نورو و بی‌سازنده (`createdById` خالی؛ قلمِ دستی سازنده دارد).
 *
 * هشدار (بازبینیِ UX، company-14): این قلم **همان خدمتی** است که خدماتِ نوروی کتاب ریزش می‌کنند. `apply`
 * تا امروز فقط خطوطِ نوروی قبلی را جایگزین می‌کرد و این یکی کنارشان می‌ماند — جمع = مبلغِ ثبت‌نام + جمعِ
 * تعرفه، یعنی یک خدمت دو بار (سنجه: `scripts/e2e/neuromonitoring-invoice.mjs`). حالا پنجرهٔ خدمات صریح
 * می‌پرسد «جایگزین یا کنارش» و `apply` فقط همین قلم‌ها را با `replace` برمی‌دارد — نه هیچ قلمِ دیگری.
 */
const lumpLinesOf = <T extends { kind: string; neuroDetail: unknown; serviceCode: string | null; createdById: number | null }>(charges: T[]) =>
  charges.filter((c) => c.kind === 'service' && !c.neuroDetail && !c.serviceCode && c.createdById === null);

/**
 * قلمِ مبلغِ کل **فقط روی مراجعهٔ نورومانیتورینگ** همان خدمتی است که خدماتِ کتاب ریزش می‌کنند (بستهٔ DF، DF1).
 *
 * ⚠️ در شرکتِ دوخدمته قلمِ مبلغِ کلِ مراجعهٔ **ایمپلنت** (۱۲۰ میلیونِ ست) هم همین شکل را دارد — خدمتِ بی‌کد و
 * بی‌سازنده. تا دیروز `list` آن را به پنجرهٔ خدمات می‌داد و «جایگزین» با یک کلیک قلمِ ایمپلنت را برمی‌داشت و
 * خدماتِ نورو را جایش می‌نشاند. `Visit.service` خالی (ردیفِ قدیمی، شرکتِ تک‌خدمته) همان رفتارِ دیروز است.
 */
const isOtherService = (v: { service?: string | null }) => !!v.service && v.service !== 'ionm';
const lumpOf = <T extends { kind: string; neuroDetail: unknown; serviceCode: string | null; createdById: number | null }>(v: { service?: string | null }, charges: T[]) =>
  (isOtherService(v) ? [] : lumpLinesOf(charges));
/** خطوطِ خدمتِ نورو (نه مصرفی). */
const neuroLinesOf = <T extends { neuroDetail: unknown }>(charges: T[]) => charges.filter((c) => c.neuroDetail && !(c.neuroDetail as any).consumable);

/**
 * **صورت‌حسابِ پس از ثبت** — همان کاری که `apply` با ردیف‌ها می‌کند، بی‌نوشتن (بستهٔ DF، DF2؛ قانون ۱۵):
 * همهٔ خطوطِ نورو (خدمت و مصرفی) می‌روند، قلم‌های جایگزین‌شده می‌روند و خدماتِ تازه با مبلغِ سرور می‌نشینند؛
 * مصرفی‌ها بی‌مبلغ‌اند و پرداخت‌ها دست نمی‌خورند. فرمول فقط همین‌جاست — پنجره جمع و مانده را حساب نمی‌کند.
 */
function billingAfter(
  charges: { id: number; amount: number; neuroDetail: unknown }[], payments: { amount: number }[],
  pricing: { pricingModel?: string | null; globalAmount?: number | null }, serviceTotals: number[], replace: Set<number>,
) {
  const kept = charges.filter((c) => !c.neuroDetail && !replace.has(c.id));
  return withPayState(summarize([...kept, ...serviceTotals.map((amount) => ({ amount }))], payments, pricing));
}

/** شناسه‌های قلم از بدنهٔ درخواست — آرایهٔ عددِ صحیحِ مثبت، بی‌تکرار. */
function lumpIdsOf(raw: unknown): number[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new BadRequestException('فهرستِ قلم‌های مبلغِ کل نامعتبر است');
  const ids = [...new Set(raw.map(Number))];
  if (ids.some((x) => !Number.isSafeInteger(x) || x < 1)) throw new BadRequestException('قلمِ جایگزین‌شونده نامعتبر است');
  return ids;
}

/**
 * «با قلمِ مبلغِ کل چه شود؟» — سنجیده و **صریح** (DF2/DF3).
 *
 * `replace` = برداشته شود، `keep` = کاربر صریحاً گفت «کنارش بماند». هر قلمِ مبلغِ کلِ این مراجعه باید در یکی
 * از این دو باشد: ثبتِ خدمات بی‌تصمیم همان دوبارشماریِ خاموشِ دیروز بود (قلمِ ثبت‌نام کنارِ خدماتِ ریزشده).
 * `keep` روی خطوطِ نوروی تازه ماندگار می‌شود (`neuroDetail.keptLumpIds`) تا پنجره بارِ بعد «کنار» را پیش‌فرض
 * بگذارد و پنل هشدارِ دوبارشماری ندهد — فقط برای همین تصمیم، نه برای خطوطی که بی‌آن ساخته شده‌اند.
 */
function lumpDecision(lump: { id: number }[], replace: number[], keep: number[], requireAll: boolean) {
  const ids = new Set(lump.map((c) => c.id));
  if ([...replace, ...keep].some((x) => !ids.has(x))) throw new BadRequestException('فقط قلمِ مبلغِ کلِ همین مراجعه جایگزین می‌شود؛ صورت‌حساب را دوباره باز کنید');
  if (replace.some((x) => keep.includes(x))) throw new BadRequestException('یک قلم نمی‌تواند هم جایگزین شود هم کنارِ خدمات بماند');
  if (requireAll && [...ids].some((x) => !replace.includes(x) && !keep.includes(x))) {
    throw new BadRequestException('با قلمِ مبلغِ کلِ این مراجعه چه شود؟ «جایگزینِ همین قلم شود» یا «کنارش بماند» را انتخاب کنید');
  }
}
type Consumable = { name: string; irc: string; qty: number; itemId?: number; lotId?: number; chargeId?: number; stockEffect?: 'virtual' | 'consumed' };

/** تنظیمِ «مصرفی‌های پرتکرار»: هر خط `نام | IRC | تعداد`. خطِ خراب نادیده می‌شود، نه خطا. */
function parseConsumables(text: string): Consumable[] {
  if (text.trim().startsWith('[')) { try { return normalizeConsumables(JSON.parse(text)); } catch { return []; } }
  return text.split('\n').map((line) => line.split('|').map((s) => s.trim()))
    .filter((p) => p[0])
    .map((p) => ({ name: p[0].slice(0, 120), irc: (p[1] ?? '').replace(/\D/g, '').slice(0, 40), qty: Math.max(1, Math.min(999, parseInt(p[2] ?? '1', 10) || 1)) }));
}

/** مصرفی‌های ارسالیِ پاپ‌آپ — ورودیِ کاربر، پس سخت‌گیر. */
function normalizeConsumables(input: unknown): Consumable[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 50) throw new BadRequestException('فهرستِ مصرفی‌ها نامعتبر است');
  return input.map((raw: any) => {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    const irc = typeof raw?.irc === 'string' ? raw.irc.replace(/\D/g, '') : '';
    const qty = Number(raw?.qty);
    if (!name || name.length > 120) throw new BadRequestException('نامِ کالای مصرفی خالی یا بلند است');
    if (irc.length > 40) throw new BadRequestException('کد IRC بلندتر از حد است');
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw new BadRequestException(`تعدادِ «${name}» باید عددِ صحیحِ ۱ تا ۹۹۹ باشد`);
    const ids: any = {};
    for (const key of ['itemId', 'lotId', 'chargeId']) if (raw[key] != null) { if (!Number.isInteger(raw[key]) || raw[key] < 1) throw new BadRequestException('شناسه کالای مصرفی نامعتبر است'); ids[key] = raw[key]; }
    if (raw.stockEffect != null && !['virtual', 'consumed'].includes(raw.stockEffect)) throw new BadRequestException('نوع اثر انبار نامعتبر است');
    return { name, irc, qty, ...ids, stockEffect: raw.stockEffect ?? 'virtual' };
  });
}

const NOT_NEURO = 'این مراجعه نورومانیتورینگ نیست؛ قلمِ مبلغِ کلِ آن با خدماتِ نورو جایگزین نمی‌شود';

@Injectable()
export class InvoicesService {
  constructor(private prisma: PrismaService, private billing: BillingService, private codes: ServiceCodesService, private settings: SettingsService, private inventory: InventoryService, private events: EventsService) {}

  private async visit(id: number, user: any) {
    const v = await this.prisma.visit.findFirst({ where: { id, ...scopedVisitWhere(user) }, include: { hospital: true } });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    return v;
  }

  async list(id: number, user: any) {
    const v = await this.visit(id, user);
    const duration = durationOf(v.opStartTime, v.opEndTime);
    const [charges, payments] = await Promise.all([
      this.prisma.charge.findMany({ where: { visitId: id }, orderBy: { id: 'asc' } }),
      this.prisma.payment.findMany({ where: { visitId: id }, select: { amount: true } }),
    ]);
    const lump = lumpOf(v, charges);
    const neuro = neuroLinesOf(charges);
    const keptIds = new Set(neuro.flatMap((c) => ((c.neuroDetail as any)?.keptLumpIds ?? []) as number[]));
    /* DF3: قلمِ مبلغِ کل و خدماتِ نوروی ریزشده هر دو روی صورت‌حساب‌اند — یعنی یک خدمت دو بار، مگر کاربر
       صریحاً «کنارش بماند» را انتخاب کرده باشد (خطوطِ پیش از 5d3d2f2 این انتخاب را هرگز نداشتند). */
    const lumpBesideNeuro = lump.length > 0 && neuro.length > 0;
    const lumpKept = lumpBesideNeuro && lump.every((c) => keptIds.has(c.id));
    const { paid } = summarize(charges, payments, v);
    const global = v.pricingModel === 'global' && v.globalAmount != null;
    /* پیش‌فرضِ پنجرهٔ خدمات (DF2/DF3): «کنار» فقط وقتی کاربر قبلاً صریحاً گفته؛ وقتی پول گرفته شده هیچ — جمع
       و مانده عوض می‌شوند و کاربر باید پیش‌نمایش را ببیند و خودش انتخاب کند؛ وگرنه «جایگزین». در مدلِ گلوبال
       جمع از مبلغِ توافقی است، پس جایگزینیِ قلم جمع و مانده را عوض نمی‌کند. */
    const lumpDefault = !lump.length ? null : lumpKept ? 'keep' : paid > 0 && !global ? null : 'replace';
    return {
      /* قلمِ مبلغِ کل — پنجرهٔ خدمات می‌پرسد با آن چه کند (company-14). */
      lumpLines: lump.map((c) => ({ id: c.id, title: c.title, amount: c.amount })),
      lumpBesideNeuro, lumpKept, lumpDefault,
      hours: duration ? Math.max(1, Math.round(duration / 60)) : null,
      year: new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', timeZone: 'UTC' }).format(v.opDate ?? new Date()).replace(/\D/g, ''),
      sector: v.hospital?.sector ?? 'private',
      documents: await this.prisma.invoiceDocument.findMany({ where: { visitId: id }, orderBy: { id: 'desc' }, select: { id: true, number: true, variant: true, createdAt: true, supersededAt: true } }),
    };
  }

  async price(id: number, dto: { code: string; hours: number; year: string; deviceOwner: string }, user: any) {
    const v = await this.visit(id, user);
    if (!Number.isInteger(dto.hours) || dto.hours < 1 || dto.hours > 72 || !/^\d{4}$/.test(dto.year) || !['company', 'hospital'].includes(dto.deviceOwner)) throw new BadRequestException('مدت، سال تعرفه یا مالک دستگاه نامعتبر است');
    const price = await this.codes.priceOf(dto.code, dto.year, v.hospital?.sector ?? 'private');
    /* جای درستِ رفع را بگوید (company-14): ضریبِ تعرفه در «تنظیماتِ شرکت» است و نوعِ بیمارستان در تعاریفِ پایه —
       متنِ قبلی هر دو را «تعاریف پایه» می‌نامید و پنجره راهی به تعریفِ تعرفه نشان نمی‌داد. */
    if (price.price === null || !price.tariff || !price.coefficients || !price.factors) {
      throw new BadRequestException(`ضریبِ تعرفهٔ سالِ ${dto.year.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])} برای بیمارستانِ ${SECTOR_LABELS[v.hospital?.sector ?? 'private'] ?? 'این نوع'} ثبت نشده است — «تنظیماتِ شرکت ← ضریبِ ریالیِ تعرفه»`);
    }
    const professional = Math.round(price.coefficients.professional * price.factors.professional * dto.hours);
    const technical = Math.round(price.coefficients.technical * price.factors.technical * dto.hours);
    const total = professional + technical;
    if (!Number.isSafeInteger(total) || total < 0 || total > 2147483647) throw new BadRequestException('مبلغ محاسبه‌شده از محدوده مجاز خارج است');
    return { code: dto.code, title: price.title, hours: dto.hours, deviceOwner: dto.deviceOwner,
      coefficients: price.coefficients, factors: price.factors, professional, technical, total, tariff: price.tariff };
  }

  async addService(id: number, dto: { code: string; hours: number; year: string; deviceOwner: string }, user: any) {
    // Never accept the preview's amounts from the browser. Resolve basic definitions again.
    const detail = await this.price(id, dto, user);
    return this.billing.addCharge(id, { kind: 'service', title: detail.title, serviceCode: detail.code, codeSystem: 'book', quantity: 1, unitPrice: detail.total }, user, detail);
  }

  // ── فاکتورِ نورومانیتورینگ در یک پاپ‌آپ (الگوی ملک‌طب) ────────────────────
  //
  // تا پیش از این هر خدمت جداگانه «جستجو → محاسبه → افزودن» می‌شد؛ چهار خدمت
  // یعنی دوازده کلیک و چهار بار منتظرِ سرور. ملک‌طب همه را در یک پاپ‌آپ با
  // تیکِ پیش‌فرض دارد. این سه متد همان را می‌دهند و `price/addService` را
  // برای سازگاری دست‌نخورده می‌گذارند.

  /** فهرستِ خدمات + پیش‌فرض‌های این شرکت + مصرفی‌های پرتکرار + مقادیرِ پیشنهادیِ مراجعه. */
  async catalog(id: number, user: any) {
    const base = await this.list(id, user);
    const defaults = new Set((await this.settings.text('invoice_neuro_defaults')).split(',').map((s) => s.trim()).filter(Boolean));
    const services: { id: string; code: string; label: string; title: string | null; defaultOn: boolean }[] = [];
    for (const s of NEURO_CATALOG) {
      let title: string | null = null;
      // نبودِ کد در کتاب/تعرفه این‌جا خطا نیست — فقط عنوانِ رسمی ندارد؛ خطا موقعِ قیمت‌گیری روشن گفته می‌شود.
      try { title = (await this.codes.priceOf(s.code, base.year, base.sector)).title ?? null; } catch { title = null; }
      services.push({ id: s.id, code: s.code, label: s.label, title, defaultOn: defaults.has(s.id) });
    }
    return { ...base, deviceOwner: 'company', services, consumables: parseConsumables(await this.settings.text('invoice_neuro_consumables')) };
  }

  private pick(ids: unknown) {
    if (!Array.isArray(ids) || !ids.length) throw new BadRequestException('دستِ‌کم یک خدمت انتخاب کنید');
    const out: typeof NEURO_CATALOG = [];
    for (const raw of ids) {
      const s = NEURO_BY_ID.get(String(raw));
      if (!s) throw new BadRequestException('خدمتِ ناشناخته در فهرستِ نورومانیتورینگ');
      if (!out.includes(s)) out.push(s);
    }
    return out;
  }

  /** قیمتِ همهٔ خدماتِ انتخاب‌شده با یک مدت/سال/مالک. مبلغ‌ها فقط این‌جا ساخته می‌شوند. */
  private async priced(id: number, dto: NeuroBulk, user: any) {
    const items: any[] = [];
    for (const s of this.pick(dto.items)) {
      const d = await this.price(id, { code: s.code, hours: dto.hours, year: dto.year, deviceOwner: dto.deviceOwner }, user);
      items.push({ ...d, id: s.id, label: s.label });
    }
    return { items, total: items.reduce((sum, it) => sum + it.total, 0) };
  }

  /**
   * جمعِ زندهٔ پاپ‌آپ **و صورت‌حسابِ پس از ثبت** (بستهٔ DF، DF2).
   *
   * `billing.before` همین حالا؛ `billing.after` با همین انتخاب و همین `replace`؛ و وقتی قلمِ مبلغِ کل هست
   * `billing.options` هر دو راه («جایگزین» / «کنار») — تا پنجره **پیش از ثبت** بگوید جمع و مانده (یا
   * اضافه‌پرداخت) چه می‌شود. تا دیروز فقط «جمعِ خدمات» را می‌گفت و ثبتِ پیش‌فرض قلمِ ۴۰ میلیونیِ پرداخت‌شده
   * را بی‌صدا با ۸٬۹۹۸ عوض می‌کرد — ماندهٔ منفیِ ۳۹٬۹۹۱٬۰۰۲. هر سه با `payState*` می‌آیند؛ پنجره فرمولی ندارد.
   */
  async quote(id: number, dto: NeuroBulk & { replace?: unknown }, user: any) {
    const q = await this.priced(id, dto, user);
    const v = await this.visit(id, user);
    const replace = lumpIdsOf(dto.replace);
    if (replace.length && isOtherService(v)) throw new BadRequestException(NOT_NEURO);
    const [charges, payments] = await Promise.all([
      this.prisma.charge.findMany({ where: { visitId: id }, select: { id: true, amount: true, kind: true, neuroDetail: true, serviceCode: true, createdById: true } }),
      this.prisma.payment.findMany({ where: { visitId: id }, select: { amount: true } }),
    ]);
    const lump = lumpOf(v, charges);
    lumpDecision(lump, replace, [], false);
    const totals = q.items.map((it) => it.total);
    const after = (ids: number[]) => billingAfter(charges, payments, v, totals, new Set(ids));
    return {
      ...q,
      billing: {
        before: withPayState(summarize(charges, payments, v)),
        after: after(replace),
        ...(lump.length ? { options: { replace: after(lump.map((c) => c.id)), keep: after([]) } } : {}),
      },
    };
  }

  /**
   * اعمالِ انتخاب روی صورت‌حساب — **جایگزینی**، نه افزودن.
   *
   * پاپ‌آپ حالتِ کاملِ بخشِ نوروی فاکتور را می‌گوید (همان معناییِ ملک‌طب):
   * خدمات و مصرفی‌های نوروی قبلی می‌روند و انتخابِ تازه می‌نشیند. اقلامِ
   * غیرنورو (کالای انبار، تخفیف، خدمتِ دستی) دست‌نخورده می‌مانند.
   * قیمت‌گیری **پیش از هر حذفی** است تا خطای تعرفه فاکتور را نیمه‌کاره نکند.
   * مصرفی‌ها بدون مبلغ‌اند (هزینه در خدمت است)؛ اثر انبار انتخابی و مصرف هر قلم تجمعی است.
   */
  async apply(id: number, dto: NeuroBulk & { consumables?: unknown; returnUnusedStock?: boolean; replace?: unknown; keep?: unknown }, user: any) {
    const v = await this.visit(id, user);
    /* قلم‌های مبلغِ کلی که کاربر صریحاً گفته «جایگزین شوند» یا «کنارش بمانند» (company-14، DF2/DF3) — فقط
       شناسه، و داخلِ تراکنش سنجیده می‌شود که واقعاً قلمِ مبلغِ کلِ **همین** مراجعه‌اند و هیچ‌کدام بی‌تصمیم
       نمانده؛ هیچ قلمِ دیگری از این راه پاک نمی‌شود. */
    const replace = lumpIdsOf(dto.replace), keep = lumpIdsOf(dto.keep);
    /* DF1: قلمِ مبلغِ کلِ مراجعهٔ ایمپلنت (یا هر خدمتِ غیرِ نورو) با خدماتِ نورو جایگزین نمی‌شود. */
    if (replace.length && isOtherService(v)) throw new BadRequestException(NOT_NEURO);
    const q = await this.priced(id, dto, user);
    const consumables = normalizeConsumables(dto.consumables);
    const selectedLots = consumables.flatMap(c => c.lotId ? [c.lotId] : []);
    if (new Set(selectedLots).size !== selectedLots.length) throw new BadRequestException('هر لات را یک بار انتخاب و تعداد آن را اصلاح کنید');
    const mayConsume = await canAccess(this.prisma, user, 'inventory', ['inventory.write']);
    if ((consumables.some(c => c.stockEffect === 'consumed') || dto.returnUnusedStock) && !mayConsume) throw new ForbiddenException('اجازه ثبت مصرف یا برگشت انبار ندارید');
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM visits WHERE id = ${id} FOR UPDATE`;
      const locked = await tx.visit.findUniqueOrThrow({ where: { id }, select: { service: true } });
      const existing = await tx.charge.findMany({ where: { visitId: id } });
      const previousCons = existing.filter(c => (c.neuroDetail as any)?.consumable);
      const oldIds = neuroLinesOf(existing).map(c => c.id);
      lumpDecision(lumpOf(locked, existing), replace, keep, true);
      await tx.charge.deleteMany({ where: { id: { in: [...oldIds, ...replace] } } });
      for (const it of q.items) {
        const { id: _serviceId, label, ...detail } = it;
        const title = detail.title && detail.title !== label ? `${label} — ${detail.title}` : label;
        /* «کنار» ماندگار روی همین خطوط (DF3) — بارِ بعد پیش‌فرضِ پنجره و بی‌هشداریِ پنل از همین است. */
        await tx.charge.create({ data: { visitId: id, kind: 'service', title, serviceCode: detail.code, codeSystem: 'book', quantity: 1, unitPrice: detail.total, amount: detail.total, stockEffect: 'virtual', createdById: user.id, neuroDetail: { ...detail, label, ...(keep.length ? { keptLumpIds: keep } : {}) } } });
      }
      const retained = new Set<number>();
      for (const c of consumables) {
        const before = c.chargeId ? previousCons.find(x => x.id === c.chargeId) : c.lotId ? previousCons.find(x => !retained.has(x.id) && (x.neuroDetail as any)?.lotId === c.lotId) : undefined;
        if (c.chargeId && (!before || retained.has(c.chargeId))) throw new BadRequestException('قلم فاکتور تغییر کرده؛ صورت‌حساب را دوباره باز کنید');
        let itemId = c.itemId ?? null, name = c.name;
        if (itemId) { const item = await tx.item.findFirst({ where: { id: itemId, active: true } }); if (!item) throw new BadRequestException('کالای انتخابی فعال نیست'); name = [item.name, item.size].filter(Boolean).join(' '); }
        if (c.stockEffect === 'consumed' && !c.lotId) throw new BadRequestException(`لات انبار «${name}» را انتخاب کنید`);
        if (c.lotId) { const lot = await tx.stockLot.findFirst({ where: { id: c.lotId, item: { active: true } } }); if (!lot || (itemId && lot.itemId !== itemId)) throw new BadRequestException('لات با کالای انتخابی یکسان نیست'); itemId = lot.itemId; }
        const data = { kind: 'item', title: name, quantity: c.qty, unitPrice: 0, amount: 0, itemId, stockEffect: c.stockEffect ?? 'virtual', notes: c.irc || null, neuroDetail: { consumable: true, irc: c.irc, qty: c.qty, lotId: c.lotId ?? null } };
        const row = before ? await tx.charge.update({ where: { id: before.id }, data }) : await tx.charge.create({ data: { ...data, visitId: id, createdById: user.id } });
        retained.add(row.id);
        if (c.stockEffect === 'consumed' || dto.returnUnusedStock) await this.inventory.setChargeConsumption(tx, c.lotId ?? null, c.stockEffect === 'consumed' ? c.qty : 0, id, row.id, user, dto.returnUnusedStock === true);
      }
      for (const old of previousCons.filter(c => !retained.has(c.id))) {
        if (dto.returnUnusedStock) await this.inventory.setChargeConsumption(tx, null, 0, id, old.id, user, true);
        await tx.charge.delete({ where: { id: old.id } });
      }
      await tx.auditEvent.create({ data: { actorId: user.id, action: 'invoice.neuro.apply', entityType: 'visit', entityId: String(id), beforeJson: { chargeIds: oldIds, replaced: existing.filter(c => replace.includes(c.id)).map(c => ({ id: c.id, title: c.title, amount: c.amount })), kept: existing.filter(c => keep.includes(c.id)).map(c => ({ id: c.id, title: c.title, amount: c.amount })) }, afterJson: { services: q.items.map(it => it.id), consumables, total: q.total } } });
    }, { timeout: 15000 });
    return { applied: q.items.length, consumables: consumables.length, total: q.total, billing: await this.billing.get(id, user) };
  }

  async document(id: number, documentId: number, user: any) {
    await this.visit(id, user);
    const doc = await this.prisma.invoiceDocument.findFirst({ where: { id: documentId, visitId: id } });
    if (!doc) throw new NotFoundException('فاکتور پیدا نشد');
    return doc;
  }

  async issue(id: number, variant: string, user: any) {
    await this.visit(id, user);
    if (!['formal', 'informal'].includes(variant)) throw new BadRequestException('نوع فاکتور نامعتبر است');
    const template = await this.settings.invoiceTemplate(variant);
    if (!template.brand.legalName) throw new BadRequestException('نام صادرکننده را در تنظیمات ← قالب فاکتور شرکت وارد کنید');
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async tx => {
          // Serialize issuers and keep the complete financial snapshot on one DB revision.
          await tx.$queryRaw`SELECT id FROM visits WHERE id = ${id} FOR UPDATE`;
          const v = await tx.visit.findUniqueOrThrow({ where: { id }, include: { patient: true, hospital: true, payerHospital: true, surgeon: { include: { person: true } }, procedureType: true, otherProcedures: OTHER_PX, invoiceBankAccount: true, charges: { orderBy: { id: 'asc' } }, payments: { orderBy: { id: 'asc' } } } });
          if (v.invoiceType !== variant || !v.invoiceBankAccount?.active || v.invoiceBankAccount.classification !== variant) throw new BadRequestException('ابتدا نوع فاکتور و حساب دریافت هم‌نوع را ثبت کنید');
          if (v.payments.some(p => p.bankAccountId !== null && p.bankAccountId !== v.invoiceBankAccountId)) throw new BadRequestException('حساب پرداخت‌های ثبت‌شده با حساب فاکتور یکسان نیست');
          if (!v.charges.length) throw new BadRequestException('ابتدا اقلام فاکتور را ثبت کنید');
          const totals = summarize(v.charges, v.payments, v);
          if (totals.total < 0) throw new BadRequestException('جمع فاکتور نباید منفی باشد');
          /* بستهٔ ۷ج — چند عمل در یک جلسه.
             ⚠️ `procedureTypeName` همان عملِ **اصلی** می‌ماند (معنای snapshotهای قدیمی
             عوض نمی‌شود) و `procedureNames` فقط از دو عمل به بالا می‌آید: `undefined`
             در رفت‌وبرگشتِ JSONِ پایین حذف می‌شود، پس اثرانگشتِ فاکتورِ تک‌عملی
             بایت‌به‌بایت همان دیروز است و صدورِ دوباره شمارهٔ رسمیِ تازه نمی‌سوزاند.
             برای همین `version` هم ۱ می‌ماند. */
          const names = procedureNames(v);
          const recipient = {
            code: `${v.patient.code}-V${v.seq}`, fullName: `${v.patient.firstName} ${v.patient.lastName}`.trim(), nationalId: v.patient.nationalId, phone: v.patient.phone,
            hospitalName: v.hospital?.name ?? v.hospitalName, hospitalAddress: v.hospital?.address, payer: v.payer, payerHospitalName: v.payerHospital?.name, payerAddress: v.payerHospital?.address,
            surgeonName: v.surgeon ? `${v.surgeon.person.firstName} ${v.surgeon.person.lastName}`.trim() : v.surgeonName,
            procedureTypeName: principalProcedureName(v), procedureNames: names.length >= 2 ? names : undefined, opDate: v.opDate, opStartTime: v.opStartTime, opEndTime: v.opEndTime,
          };
          const bank = v.invoiceBankAccount;
          const invoiceBankAccount = { id: bank.id, ownerName: bank.ownerName, bankName: bank.bankName, accountNumber: bank.accountNumber, iban: bank.iban };
          const snapshot = JSON.parse(JSON.stringify({ version: 1, template, visit: recipient,
            billing: { ...totals, pricingModel: v.pricingModel, globalAmount: v.globalAmount, invoiceType: variant, invoiceBankAccount, charges: v.charges, payments: v.payments } }));
          const fingerprint = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
          const latest = await tx.invoiceDocument.findFirst({ where: { visitId: id, variant, supersededAt: null }, orderBy: { id: 'desc' } });
          if (latest?.fingerprint === fingerprint) return latest;
          // A DB sequence is tenant-local and cannot reuse a number after a failed issue.
          const [serial] = await tx.$queryRaw<{ id: number }[]>`SELECT nextval(pg_get_serial_sequence('invoice_documents', 'id'))::integer AS id`;
          const number = `${template.prefix}${variant === 'formal' ? 'F' : 'U'}-${String(serial.id).padStart(6, '0')}`;
          const doc = await tx.invoiceDocument.create({ data: { id: serial.id, visitId: id, variant, number, fingerprint, snapshot, createdById: user?.id ?? null } });
          await tx.invoiceDocument.updateMany({ where: { visitId: id, variant, supersededAt: null, id: { not: doc.id } }, data: { supersededAt: doc.createdAt } });
          await tx.auditEvent.create({ data: { actorId: user?.id ?? null, action: 'invoice.issue', entityType: 'visit', entityId: String(id), afterJson: { invoiceId: doc.id, number, total: totals.total, replacedId: latest?.id ?? null } } });
          /* W2.2: صدور ← بستنِ «صدورِ فاکتور» (work-rules: invoice.issued). refِ رویداد = مراجعه، مثلِ invoice.ready. */
          await this.events.emit({ type: 'invoice.issued', visitId: id, patientId: v.patientId, actorId: user?.id ?? null,
            payload: { invoiceId: doc.id, number, total: totals.total, variant } }, tx);
          return doc;
        }, { isolationLevel: 'Serializable', timeout: 15000 });
      } catch (error) {
        if ((error as any)?.code === 'P2034' && attempt < 2) continue;
        throw error;
      }
    }
  }
}
