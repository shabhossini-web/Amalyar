import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../work/events.service';
import { AssetsService, windowOf } from './assets.service';
import { balanceByLocation, balanceOf, HOME_FALLBACK } from './stock-math';
import { SettingsService } from '../config/settings.service';
import { RoutesService, normalizeTime } from './routes.service';
import { PlacesService } from './places.service';

// فرمول‌های موجودی در `stock-math` هستند؛ این‌جا فقط دوباره صادر می‌شوند تا
// فراخوان‌های موجود نشکنند.
export { balanceByLocation, balanceOf, HOME_FALLBACK };
import { LEVEL } from '../common/levels';
import { digitVariants, textSearchOr } from '../common/search';

/** نوعِ حرکتِ انبار. علامت را سرویس تعیین می‌کند، نه کاربر. */
export const MOVEMENT_KINDS = ['in', 'out', 'return', 'adjust', 'transfer'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const MOVEMENT_LABELS: Record<string, string> = {
  in: 'ورود',
  out: 'مصرف',
  return: 'برگشت',
  adjust: 'اصلاحِ شمارش',
  transfer: 'انتقال',
};


/**
 * وضعیتِ حواله. `closed` یعنی ماندهٔ مصرف‌نشده برگشته و پرونده بسته است.
 *
 * ⚠️ **`planned` تعهد است، نه حرکت.** حوالهٔ فردا امروز صادر می‌شود در حالی که
 * همان دستگاه هنوز در بیمارستانِ دیروز است؛ اگر صدورِ حواله فوراً از انبار کم
 * کند، برنامه‌ریزیِ فردا با «موجود نیست» رد می‌شود — دقیقاً همان کاری که
 * راننده هر روز می‌کند. پس دفترِ انبار وقتی می‌خورد که بار **واقعاً** برود
 * (`ship`)، و تا آن لحظه حواله فقط تقویمِ دارایی را اشغال می‌کند.
 */
export const TRANSFER_STATUSES = ['planned', 'sent', 'received', 'closed'] as const;
export const TRANSFER_LABELS: Record<string, string> = {
  planned: 'برنامه‌ریزی‌شده',
  sent: 'ارسال‌شده',
  received: 'تحویلِ CSR',
  closed: 'بسته (مانده برگشت)',
};

/** روزِ محلی (بدونِ ساعت) — برای مقایسهٔ «امروز است یا آینده». */
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
/** «۰۸:۳۰» از یک لحظه — برای پیامِ تداخل. */
const hhmm = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

/**
 * انبارِ لات‌محور.
 *
 * چرا اصلاً وجود دارد: برای شرکتی که ست و پیچ می‌دهد، سؤالِ حیاتی «چند تا
 * داریم» نیست — «لاتِ A-4471 که سازنده فراخوان داده، در بدنِ کدام بیمارها
 * است» است. جواب‌دادن به آن، نه از کاتالوگ برمی‌آید نه از فاکتور؛ دفترِ حرکت
 * لازم دارد که هر مصرف را به مراجعه گره بزند.
 */
@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private assets: AssetsService,
    private settings: SettingsService,
    private places: PlacesService,
    private events: EventsService,
    // ⚠️ حلقهٔ وابستگی: مسیرها هم انبار را می‌خواهند. `forwardRef` در ماژول
    //    حلش می‌کند — بدونِ آن Nest هنگامِ بالا آمدن گیر می‌کند.
    @Inject(forwardRef(() => RoutesService)) private routes: RoutesService,
  ) {}

  /**
   * نامِ انبارِ پیش‌فرضِ همین شرکت.
   *
   * ⚠️ `HOME_FALLBACK` فقط **پیش‌فرضِ کد** است، نه مقدارِ نهایی: شرکتی که
   * انبارش «انبارِ شرکت» نام دارد نباید در همهٔ صفحه‌ها «انبارِ مرکزی» ببیند.
   * هر جا لات محلِ صریح ندارد، این خوانده می‌شود نه آن ثابت.
   */
  private home(): Promise<string> {
    return this.settings.textOr('home_location', HOME_FALLBACK);
  }

  // ───────────────────────── لات‌ها ─────────────────────────

  /**
   * فهرستِ لات‌ها با موجودیِ محاسبه‌شده.
   *
   * موجودی با یک groupBy می‌آید نه با N کوئری — انبارِ چند هزار لاتی وگرنه
   * صفحهٔ فهرست را می‌خواباند.
   */
  async listLots(opts: { q?: string; itemId?: number; inStock?: boolean; expiringDays?: number } = {}) {
    const term = opts.q?.trim();
    const where: any = {};
    if (opts.itemId) where.itemId = opts.itemId;
    if (term) {
      // ⚠️ شمارهٔ لات و سریال را کاربر با کیبوردِ فارسی هم تایپ می‌کند و هم
      //    وارد کرده است؛ پس هر دو صورتِ رقمی جست‌وجو می‌شود (`common/search.ts`).
      where.OR = [
        ...textSearchOr(term, ['lotNo', 'serialNo', 'location']),
        ...digitVariants(term).flatMap((v) => [
          { item: { name: { contains: v, mode: 'insensitive' } } },
          { item: { sku: { contains: v, mode: 'insensitive' } } },
          { item: { brand: { contains: v, mode: 'insensitive' } } },
        ]),
      ];
    }
    if (opts.expiringDays !== undefined) {
      const until = new Date();
      until.setDate(until.getDate() + opts.expiringDays);
      where.expiresAt = { not: null, lte: until };
    }

    const lots = await this.prisma.stockLot.findMany({
      where,
      include: { item: { select: { id: true, name: true, brand: true, size: true, sku: true, unit: true, price: true } } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'desc' }],
      take: 300,
    });
    if (!lots.length) return [];

    // یک groupBy روی (لات، محل) — هم جمعِ کل می‌دهد هم تفکیکِ محل، بدونِ N کوئری.
    const sums = await this.prisma.stockMovement.groupBy({
      by: ['lotId', 'location'],
      where: { lotId: { in: lots.map((l) => l.id) } },
      _sum: { quantity: true },
    });
    const byLot = new Map<number, { quantity: number; location: string | null }[]>();
    for (const s of sums) {
      const arr = byLot.get(s.lotId) ?? [];
      arr.push({ quantity: s._sum.quantity ?? 0, location: s.location });
      byLot.set(s.lotId, arr);
    }

    const home = await this.home();
    const rows = lots.map((l) => this.shapeLot(l, byLot.get(l.id) ?? [], home));
    return opts.inStock ? rows.filter((r) => r.quantity > 0) : rows;
  }

  /** لات‌های قابلِ مصرفِ یک کالا — ورودیِ انتخابگرِ فاکتور. */
  async availableFor(itemId: number) {
    const rows = await this.listLots({ itemId, inStock: true });
    // منقضی‌ها می‌آیند ولی علامت‌دار: پنهان‌کردنشان یعنی کاربر نمی‌فهمد چرا
    // موجودی‌اش را نمی‌بیند. مصرفشان در `consume` مسدود است.
    return rows.sort((a, b) => Number(a.expired) - Number(b.expired));
  }

  async createLot(dto: any, user: any) {
    const item = await this.prisma.item.findUnique({ where: { id: Number(dto.itemId) } });
    if (!item) throw new NotFoundException('کالا یافت نشد');

    const serialNo = text(dto.serialNo);
    const initial = intOrZero(dto.quantity, 'تعدادِ اولیه');
    if (serialNo && initial > 1) throw new BadRequestException('لاتِ سریالی فقط یک عدد دارد');

    const expiresAt = dateOrNull(dto.expiresAt, 'تاریخِ انقضا');

    if (serialNo) {
      const dup = await this.prisma.stockLot.findUnique({ where: { serialNo } });
      if (dup) throw new BadRequestException('این شمارهٔ سریال قبلاً ثبت شده است');
    }

    // محلِ نداده‌شده = انبارِ پیش‌فرضِ همین شرکت، و **صریح ذخیره می‌شود** نه
    // به‌صورتِ null: لاتِ بی‌محل هر بار به fallback تکیه می‌کند و اگر شرکت
    // بعداً نامِ انبارش را عوض کند، تاریخچه‌اش هم بی‌سروصدا جابه‌جا می‌شود.
    const location = text(dto.location) ?? (await this.home());

    const lot = await this.prisma.$transaction(async (tx) => {
      const created = await tx.stockLot.create({
        data: {
          itemId: item.id,
          lotNo: text(dto.lotNo),
          serialNo,
          expiresAt,
          nextServiceAt: dateOrNull(dto.nextServiceAt, 'تاریخِ سرویسِ بعدی'),
          location,
          notes: text(dto.notes),
        },
      });
      if (initial > 0) {
        await tx.stockMovement.create({
          data: {
            lotId: created.id, kind: 'in', quantity: initial,
            location: created.location, // ورودِ اولیه در محلِ خانه رخ می‌دهد
            reason: text(dto.reason) ?? 'ثبتِ اولیه',
            reference: text(dto.reference),
            createdById: user?.id ?? null,
          },
        });
      }
      return created;
    });

    await this.audit.record({
      actorId: user?.id, action: 'stock.lot.create', entityType: 'stock_lot', entityId: lot.id,
      after: { itemId: item.id, lotNo: lot.lotNo, serialNo: lot.serialNo, quantity: initial },
    });
    return this.lot(lot.id);
  }

  async updateLot(id: number, dto: any, user: any) {
    const before = await this.prisma.stockLot.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('لات یافت نشد');

    const data: any = {};
    for (const key of ['lotNo', 'location', 'notes']) if (dto[key] !== undefined) data[key] = text(dto[key]);
    if (dto.expiresAt !== undefined) data.expiresAt = dateOrNull(dto.expiresAt, 'تاریخِ انقضا');
    if (dto.nextServiceAt !== undefined) data.nextServiceAt = dateOrNull(dto.nextServiceAt, 'تاریخِ سرویسِ بعدی');
    if (dto.serialNo !== undefined) {
      const serialNo = text(dto.serialNo);
      if (serialNo && serialNo !== before.serialNo) {
        const dup = await this.prisma.stockLot.findUnique({ where: { serialNo } });
        if (dup) throw new BadRequestException('این شمارهٔ سریال قبلاً ثبت شده است');
      }
      data.serialNo = serialNo;
    }

    await this.prisma.stockLot.update({ where: { id }, data });
    await this.audit.record({
      actorId: user?.id, action: 'stock.lot.update', entityType: 'stock_lot', entityId: id, before, after: data,
    });
    return this.lot(id);
  }

  /** لاتی که دفتر دارد پاک نمی‌شود — سابقهٔ مصرف حذف‌شدنی نیست. */
  async deleteLot(id: number, user: any) {
    const lot = await this.prisma.stockLot.findUnique({
      where: { id },
      include: { _count: { select: { movements: true } } },
    });
    if (!lot) throw new NotFoundException('لات یافت نشد');
    if (lot._count.movements > 0) {
      throw new BadRequestException('این لات سابقهٔ حرکت دارد و حذف نمی‌شود؛ موجودی را با «اصلاحِ شمارش» صفر کنید');
    }
    await this.prisma.stockLot.delete({ where: { id } });
    await this.audit.record({ actorId: user?.id, action: 'stock.lot.delete', entityType: 'stock_lot', entityId: id, before: lot });
    return { ok: true };
  }

  async lot(id: number) {
    const row = await this.prisma.stockLot.findUnique({
      where: { id },
      include: { item: { select: { id: true, name: true, brand: true, size: true, sku: true, unit: true, price: true } } },
    });
    if (!row) throw new NotFoundException('لات یافت نشد');
    const rows = await this.prisma.stockMovement.findMany({ where: { lotId: id }, select: { quantity: true, location: true } });
    return this.shapeLot(row, rows, await this.home());
  }

  // ───────────────────────── حرکت ─────────────────────────

  /** ورودِ کالا — خرید، رسید، یا اضافه‌کردن به لاتِ موجود. */
  async receive(lotId: number, dto: any, user: any) {
    const quantity = positiveInt(dto.quantity, 'تعداد');
    return this.move(lotId, 'in', quantity, { reason: text(dto.reason), reference: text(dto.reference) }, user);
  }

  /**
   * مصرف — با گره‌زدن به مراجعه، که تمامِ نکتهٔ این ماژول است.
   *
   * دو چیز مسدود می‌شود: مصرفِ بیش از موجودی، و مصرف از لاتِ منقضی. دومی
   * سخت‌گیرانه است و عمداً: ایمپلنتِ استریلِ تاریخ‌گذشته را نباید با یک هشدارِ
   * قابلِ رد کردن گذشت. اگر تاریخ اشتباه وارد شده، همان را اصلاح می‌کنند.
   */
  async consume(
    dto: { lotId: number; quantity: number; visitId?: number; chargeId?: number; reason?: string; location?: string },
    user: any,
  ) {
    const quantity = positiveInt(dto.quantity, 'تعداد');
    let visitCode: string | null = null;
    if (dto.visitId) {
      const visit = await this.prisma.visit.findUnique({
        where: { id: dto.visitId },
        select: { id: true, seq: true, patient: { select: { code: true } } },
      });
      if (!visit) throw new NotFoundException('مراجعه یافت نشد');
      visitCode = `${visit.patient.code}-V${visit.seq}`;
    }
    // محل را کاربر معمولاً نمی‌داند و نباید بداند: اگر ستِ همین عمل جایی رفته،
    // مصرف از همان‌جاست. صریح‌بودنِ `dto.location` فقط برای اصلاحِ دستی است.
    const at = text(dto.location) ? { location: text(dto.location)!, transferId: null } : await this.consumeLocationFor(dto.lotId, dto.visitId);
    return this.move(
      dto.lotId, 'out', -quantity,
      { visitId: dto.visitId ?? null, visitCode, chargeId: dto.chargeId ?? null, reason: text(dto.reason), location: at?.location ?? null, transferId: at?.transferId ?? null },
      user,
    );
  }

  /** برگشت به انبار — جبرانِ مصرفِ اشتباه یا کالای مصرف‌نشده. */
  async returnToStock(
    dto: { lotId: number; quantity: number; visitId?: number; chargeId?: number; reason?: string; location?: string },
    user: any,
  ) {
    const quantity = positiveInt(dto.quantity, 'تعداد');
    // برگشت به همان‌جایی که مصرف از آن بود؛ وگرنه کالا از بیمارستان مصرف می‌شود
    // و به انبار برمی‌گردد، یعنی یک قلم از هوا در انبار پیدا می‌شود.
    const at = text(dto.location) ? { location: text(dto.location)!, transferId: null } : await this.consumeLocationFor(dto.lotId, dto.visitId);
    return this.move(
      dto.lotId, 'return', quantity,
      { visitId: dto.visitId ?? null, chargeId: dto.chargeId ?? null, reason: text(dto.reason), location: at?.location ?? null, transferId: at?.transferId ?? null },
      user,
    );
  }

  /**
   * انبارگردانی — کاربر «چند تا شمردم» را می‌دهد، اختلاف را ما حساب می‌کنیم.
   *
   * پرسیدنِ «چقدر کم/زیاد کن» یعنی کاربر باید تفریق کند و سرِ همان تفریق است
   * که موجودی خراب می‌شود.
   */
  async adjust(lotId: number, counted: number, reason: string | undefined, user: any) {
    const target = intOrZero(counted, 'تعدادِ شمارش‌شده');
    if (target < 0) throw new BadRequestException('تعدادِ شمارش‌شده نمی‌تواند منفی باشد');
    const current = await this.balance(lotId);
    const delta = target - current;
    if (delta === 0) return { ok: true, unchanged: true, quantity: current };
    return this.move(lotId, 'adjust', delta, { reason: text(reason) ?? 'انبارگردانی' }, user);
  }

  /**
   * هستهٔ نوشتن — همهٔ حرکت‌ها از این‌جا رد می‌شوند.
   *
   * قفلِ ردیفِ لات (`FOR UPDATE`) لازم است: بدونش دو مصرفِ همزمان هر دو موجودی
   * را کافی می‌بینند و انبار منفی می‌شود.
   */
  private async move(
    lotId: number,
    kind: MovementKind,
    signedQty: number,
    extra: { visitId?: number | null; visitCode?: string | null; chargeId?: number | null; reason?: string | null; reference?: string | null; location?: string | null; transferId?: number | null },
    user: any,
    tx?: any,
  ) {
    const homeName = tx ? (await tx.setting.findUnique({ where: { key: 'home_location' } }))?.value?.trim() || HOME_FALLBACK : await this.home();
    const run = async (db: any) => {
      const locked = await db.$queryRaw<{ id: number; serial_no: string | null; expires_at: Date | null; location: string | null }[]>`
        SELECT id, serial_no, expires_at, location FROM stock_lots WHERE id = ${lotId} FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('لات یافت نشد');
      const lot = locked[0];
      const home = lot.location ?? homeName;
      const where = extra.location ?? home;

      if (kind === 'out' && lot.expires_at && lot.expires_at.getTime() < Date.now()) {
        throw new BadRequestException('این لات منقضی شده و قابلِ مصرف نیست');
      }

      const all = await db.stockMovement.findMany({ where: { lotId }, select: { quantity: true, location: true } });
      const total = balanceOf(all) + signedQty;
      if (total < 0) throw new BadRequestException(`موجودیِ کافی نیست — الان ${balanceOf(all)} عدد است`);
      if (lot.serial_no && total > 1) throw new BadRequestException('لاتِ سریالی نمی‌تواند بیش از یک عدد باشد');

      // ⚠️ کنترلِ per-location هم لازم است: جمعِ کل می‌تواند کافی باشد در حالی
      // که کالا آن‌جا نیست. بدونِ این، کارشناس می‌تواند از ستی که هنوز در انبار
      // است «سرِ عملِ بیمارستان» مصرف بزند و دفتر ظاهراً درست بماند.
      const here = (balanceByLocation(all, home).get(where) ?? 0) + signedQty;
      if (here < 0) {
        throw new BadRequestException(`در «${where}» به این تعداد موجود نیست — الان ${here - signedQty} عدد آن‌جاست`);
      }

      return db.stockMovement.create({
        data: {
          lotId, kind, quantity: signedQty, location: where,
          visitId: extra.visitId ?? null,
          visitCode: extra.visitCode ?? null,
          chargeId: extra.chargeId ?? null,
          transferId: extra.transferId ?? null,
          reason: extra.reason ?? null,
          reference: extra.reference ?? null,
          createdById: user?.id ?? null,
        },
      });
    };

    // در انتقال، هر دو پایه باید در یک تراکنش بنشینند وگرنه کالا لحظه‌ای «هیچ‌جا»
    // یا «دوجا» می‌شود؛ پس تراکنشِ بیرونی پذیرفته می‌شود.
    const row = tx ? await run(tx) : await this.prisma.$transaction(run);

    const after = { lotId, quantity: signedQty, location: row.location, visitId: extra.visitId ?? null, chargeId: extra.chargeId ?? null, transferId: extra.transferId ?? null };
    if (tx) await tx.auditEvent.create({ data: { actorId: user?.id, action: `stock.${kind}`, entityType: 'stock_movement', entityId: String(row.id), afterJson: after } });
    else await this.audit.record({ actorId: user?.id, action: `stock.${kind}`, entityType: 'stock_movement', entityId: row.id, after });
    const sum = await (tx ?? this.prisma).stockMovement.aggregate({ where: { lotId }, _sum: { quantity: true } });
    return { ok: true, movementId: row.id, quantity: sum._sum.quantity ?? 0 };
  }

  /** Set an invoice line's cumulative consumption, in the invoice transaction. Saving again consumes no more. */
  async setChargeConsumption(tx: any, lotId: number | null, quantity: number, visitId: number, chargeId: number, user: any, returnUnused: boolean) {
    const movements = await tx.stockMovement.findMany({ where: { chargeId, kind: { in: ['out', 'return'] } }, orderBy: { id: 'asc' } });
    const groups = new Map<string, any>();
    for (const m of movements) { const key = `${m.lotId}:${m.location ?? ''}:${m.transferId ?? ''}`; const g = groups.get(key) ?? { ...m, used: 0 }; g.used -= m.quantity; groups.set(key, g); }
    const previous = [...groups.values()].filter(g => g.used > 0);
    if (previous.some(g => g.lotId !== lotId) && lotId && quantity && !returnUnused) throw new BadRequestException('برای عوض کردن لات مصرف‌شده ابتدا برگشت کالای مصرف‌نشده را مشخص کنید');
    let remaining = previous.filter(g => g.lotId === lotId).reduce((n, g) => n + g.used, 0);
    for (const g of previous) {
      const extra = g.lotId === lotId ? Math.max(0, remaining - quantity) : g.used;
      if (returnUnused && extra > 0) {
        const amount = Math.min(g.used, extra);
        await this.move(g.lotId, 'return', amount, { visitId, chargeId, location: g.location, transferId: g.transferId, reason: 'برگشت کالای مصرف‌نشده از اصلاح فاکتور' }, user, tx);
        if (g.lotId === lotId) remaining -= amount;
      }
    }
    const delta = quantity - remaining;
    if (lotId && delta > 0) {
      const visit = await tx.visit.findUniqueOrThrow({ where: { id: visitId }, select: { seq: true, patient: { select: { code: true } } } });
      const transfer = await tx.stockTransfer.findFirst({ where: { visitId, status: { not: 'closed' }, movements: { some: { lotId } } }, orderBy: { id: 'desc' }, select: { id: true, toLocation: true } });
      await this.move(lotId, 'out', -delta, { visitId, chargeId, visitCode: `${visit.patient.code}-V${visit.seq}`, location: transfer?.toLocation, transferId: transfer?.id, reason: 'مصرف فاکتور نورومانیتورینگ' }, user, tx);
    }
  }

  async balance(lotId: number) {
    const agg = await this.prisma.stockMovement.aggregate({ where: { lotId }, _sum: { quantity: true } });
    return agg._sum.quantity ?? 0;
  }

  // ───────────────────────── سفرِ ست (حواله) ─────────────────────────

  /**
   * ارسالِ ست — یک سند، چند لات، همه در یک تراکنش.
   *
   * حرکت‌ها دوتایی‌اند: خروج از مبدأ و ورودِ همان تعداد به مقصد. جمعِ کلِ موجودی
   * دست‌نخورده می‌ماند (کالا از بین نرفته، جابه‌جا شده) ولی «در دسترس» کم می‌شود
   * — که همان چیزی است که چینش باید ببیند.
   */
  async sendTransfer(
    dto: {
      toLocation?: string; fromLocation?: string; hospitalId?: number; visitId?: number; notes?: string;
      plannedFor?: string; windowFrom?: string; windowTo?: string; force?: boolean; planOnly?: boolean;
      lines?: { lotId: number; quantity: number }[];
    },
    user: any,
  ) {
    const to = text(dto.toLocation);
    if (!to) throw new BadRequestException('مقصد را وارد کنید');
    const lines = (dto.lines ?? []).filter((l) => l && l.lotId);
    if (!lines.length) throw new BadRequestException('حواله بدونِ قلم معنا ندارد');

    let visitCode: string | null = null;
    let visit: any = null;
    if (dto.visitId) {
      visit = await this.prisma.visit.findUnique({
        where: { id: dto.visitId },
        select: { seq: true, opDate: true, opStartTime: true, opEndTime: true, cargoDueTime: true, patient: { select: { code: true } } },
      });
      if (!visit) throw new NotFoundException('مراجعه یافت نشد');
      visitCode = `${visit.patient.code}-V${visit.seq}`;
    }
    // روزِ تعهد: صریحِ کاربر، وگرنه روزِ عمل، وگرنه امروز.
    const plannedFor = dateOrNull(dto.plannedFor, 'تاریخِ حواله') ?? visit?.opDate ?? new Date();

    // بازهٔ تعهد از همان اطلاعاتی می‌آید که هست: ساعتِ تحویلِ بار تا ساعتِ
    // پایانِ عمل. نبودشان به «تمامِ روز» ترجمه می‌شود، نه به «آزاد».
    const want = windowOf(
      { plannedFor, windowFrom: dateOrNull(dto.windowFrom, 'شروعِ تعهد'), windowTo: dateOrNull(dto.windowTo, 'پایانِ تعهد'), visit },
      0,
    );

    // ⚠️ تعارض پیش از ساختِ حواله بررسی می‌شود، نه بعدش: حوالهٔ صادرشده سند
    // است و پس‌گرفتنش ردیفِ ابطال می‌خواهد. هشدار قابلِ عبور است ولی باید
    // **صریح** باشد (`force`)، وگرنه همان صبحِ عمل معلوم می‌شود.
    if (!dto.force) {
      const clash = await this.assets.conflicts(lines.map((l) => Number(l.lotId)), want);
      if (clash.length) {
        const first = clash[0];
        throw new BadRequestException(
          `«${first.itemName}»${first.serialNo ? ` (${first.serialNo})` : ''} در همین بازه ` +
          `(${hhmm(first.from)} تا ${hhmm(first.to)}) با حوالهٔ ${first.transferCode} برای ${first.hospital} تداخل دارد. ` +
          'اگر عمدی است، دوباره با تأیید بفرستید.',
        );
      }
      // امانیِ جای دیگر: تعارضِ زمانی ندارد ولی اشتباهِ رایجی است.
      const away = await this.assets.consignedElsewhere(lines.map((l) => Number(l.lotId)), dto.hospitalId ? Number(dto.hospitalId) : null);
      if (away.length) {
        throw new BadRequestException(
          `«${away[0].itemName}»${away[0].serialNo ? ` (${away[0].serialNo})` : ''} امانیِ ${away[0].hospitalName} است. ` +
          'اگر واقعاً جابه‌جا می‌شود، دوباره با تأیید بفرستید.',
        );
      }
    }

    // مبدأ اگر داده نشده، محلِ خانهٔ اولین لات است — همان جایی که کالا واقعاً هست.
    const first = await this.prisma.stockLot.findUnique({ where: { id: lines[0].lotId }, select: { location: true } });
    if (!first) throw new NotFoundException('لات یافت نشد');
    const from = text(dto.fromLocation) ?? first.location ?? (await this.home());
    if (from === to) throw new BadRequestException('مبدأ و مقصد یکی است');

    // حوالهٔ روزِ آینده فقط **تعهد** است؛ دفتر وقتی می‌خورد که بار برود.
    const future = dto.planOnly === true || startOfDay(plannedFor) > startOfDay(new Date());
    const status = future ? 'planned' : 'sent';

    const transfer = await this.prisma.$transaction(async (tx) => {
      const last = await tx.stockTransfer.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
      const t = await tx.stockTransfer.create({
        data: {
          code: `HV-${String((last?.id ?? 0) + 1).padStart(4, '0')}`,
          fromLocation: from, toLocation: to,
          plannedFor, status,
          windowFrom: want[0], windowTo: dateOrNull(dto.windowTo, 'پایانِ تعهد'),
          hospitalId: dto.hospitalId ?? null,
          visitId: dto.visitId ?? null,
          notes: text(dto.notes),
          createdById: user?.id ?? null,
        },
      });
      // قلم‌های حوالهٔ برنامه‌ریزی‌شده در `planned_lines` نگه داشته می‌شوند تا
      // موقعِ ارسال همان‌ها حرکت بخورند.
      if (future) {
        await tx.stockTransfer.update({
          where: { id: t.id },
          data: { plannedLines: lines.map((l) => ({ lotId: Number(l.lotId), quantity: positiveInt(l.quantity, 'تعداد') })) },
        });
      } else {
        for (const l of lines) {
          const qty = positiveInt(l.quantity, 'تعداد');
          const meta = { visitId: dto.visitId ?? null, visitCode, transferId: t.id, reason: `حوالهٔ ${t.code}` };
          await this.move(l.lotId, 'transfer', -qty, { ...meta, location: from }, user, tx);
          await this.move(l.lotId, 'transfer', qty, { ...meta, location: to }, user, tx);
        }
      }
      return t;
    });

    await this.audit.record({
      actorId: user?.id, action: future ? 'stock.transfer.plan' : 'stock.transfer.send',
      entityType: 'stock_transfer', entityId: transfer.id,
      after: { code: transfer.code, from, to, lines: lines.length, status },
    });
    return this.transfer(transfer.id, user);
  }

  /**
   * ارسالِ واقعیِ حوالهٔ برنامه‌ریزی‌شده — همین‌جا دفترِ انبار می‌خورد.
   *
   * موجودی **این‌جا** بررسی می‌شود نه موقعِ برنامه‌ریزی: دیروز که برنامه ریختیم
   * دستگاه هنوز بیرون بود و درست هم بود؛ اگر امروز هنوز برنگشته، همین‌جا باید
   * جلوی ارسال گرفته شود.
   */
  async shipTransfer(id: number, user: any) {
    const t = await this.prisma.stockTransfer.findUnique({
      where: { id },
      include: { visit: { select: { seq: true, patient: { select: { code: true } } } } },
    });
    if (!t) throw new NotFoundException('حواله یافت نشد');
    if (t.status !== 'planned') throw new BadRequestException('این حواله قبلاً ارسال شده است');
    const lines = (t.plannedLines as any[] | null) ?? [];
    if (!lines.length) throw new BadRequestException('این حواله قلمی ندارد');
    const visitCode = t.visit ? `${t.visit.patient.code}-V${t.visit.seq}` : null;

    await this.prisma.$transaction(async (tx) => {
      for (const l of lines) {
        const meta = { visitId: t.visitId, visitCode, transferId: t.id, reason: `حوالهٔ ${t.code}` };
        await this.move(l.lotId, 'transfer', -l.quantity, { ...meta, location: t.fromLocation }, user, tx);
        await this.move(l.lotId, 'transfer', l.quantity, { ...meta, location: t.toLocation }, user, tx);
      }
      await tx.stockTransfer.update({
        where: { id }, data: { status: 'sent', sentAt: new Date(), plannedLines: undefined },
      });
    });

    await this.audit.record({
      actorId: user?.id, action: 'stock.transfer.send', entityType: 'stock_transfer', entityId: id,
      before: { status: 'planned' }, after: { status: 'sent' },
    });
    return this.transfer(id, user);
  }

  /**
   * **اعلامِ پایانیِ کارشناس** — «عمل تمام شد، ست آمادهٔ جمع‌آوری است».
   *
   * ⚠️ آزادسازی از خودِ کارشناسِ سرِ عمل می‌آید، نه از ساعتِ حدسیِ دفتر. دفتر
   * نمی‌داند عمل کِی واقعاً تمام شد؛ اگر روی «ساعتِ پایانِ برنامه‌ریزی‌شده»
   * حساب کند، یا دستگاه را زودتر تعهد می‌کند (و راننده به ستِ هنوز-مشغول
   * می‌رسد) یا دیرتر (و دستگاه بی‌دلیل یک روز می‌خوابد).
   *
   * همین یک رویداد دو کار می‌کند: پایانِ بازهٔ تعهد را واقعی می‌کند، و حواله
   * را در صفِ جمع‌آوریِ راننده می‌گذارد.
   */
  async releaseTransfer(id: number, dto: { note?: string; pickupAt?: string; leftAt?: string }, user: any) {
    const t = await this.prisma.stockTransfer.findFirst({
      where: { id, ...this.transferScope(user) },
      select: { id: true, code: true, status: true, releasedAt: true, hospitalId: true, toLocation: true },
    });
    if (!t) throw new NotFoundException('حواله یافت نشد');
    if (t.status === 'planned') throw new BadRequestException('این حواله هنوز ارسال نشده است');
    if (t.status === 'closed') throw new BadRequestException('این حواله بسته شده است');
    if (t.releasedAt) throw new BadRequestException('این حواله قبلاً آزاد اعلام شده است');

    const now = new Date();
    const pickupAt = normalizeTime(dto.pickupAt);
    // ⚠️ محل **هنگامِ نوشتن** کانونی می‌شود، نه هنگامِ گزارش: «csr» و «سی اس
    //    آر» بعداً قابلِ یکی‌کردن نیستند چون نمی‌دانیم کاربر کدام را قصد کرده.
    const leftAt = await this.places.canonical(dto.leftAt);
    await this.prisma.stockTransfer.update({
      where: { id },
      data: {
        releasedAt: now, releasedById: user?.id ?? null, releaseNote: text(dto.note),
        windowTo: now, pickupAt, leftAt,
      },
    });

    /**
     * ⚠️ اعلامِ پایان خودش **توقفِ جمع‌آوری** می‌سازد.
     *
     * قبلاً فقط یک صفِ مشتق بود و مدیر باید از روی آن دستی توقف می‌ساخت —
     * یعنی حرفِ کارشناس («ساعت ۵ بیا ببر، گذاشتم CSR») تا وقتی کسی آن را
     * دوباره تایپ نمی‌کرد وجود نداشت. حالا کار ساخته می‌شود و فقط راننده‌اش
     * تعیین نشده؛ تصمیمِ «چه کسی برود» همچنان با مدیر است.
     */
    const already = await this.prisma.transportStop.findFirst({
      where: { kind: 'pickup', doneAt: null, transfers: { some: { id } } },
      select: { id: true },
    });
    if (!already) {
      await this.routes.createUnassignedStop({
        hospitalId: t.hospitalId ?? undefined,
        locationName: t.hospitalId ? undefined : t.toLocation,
        kind: 'pickup',
        plannedAt: pickupAt ?? undefined,
        notes: [leftAt && `محلِ تحویل: ${leftAt}`, text(dto.note)].filter(Boolean).join(' · ') || undefined,
        transferIds: [id],
      }, user);
    }

    await this.audit.record({
      actorId: user?.id, action: 'stock.transfer.release', entityType: 'stock_transfer', entityId: id,
      after: { releasedAt: now, note: text(dto.note), pickupAt, leftAt },
    });
    return this.transfer(id, user);
  }

  /**
   * رسیدِ تحویل به CSR.
   *
   * موجودی را جابه‌جا نمی‌کند — کالا با ارسال رفته بود. این‌جا فقط امضا و ساعت
   * ثبت می‌شود، که همان چیزی است که دعوای «یکی کم است» را حل می‌کند.
   */
  async receiveTransfer(id: number, dto: { receivedBy?: string }, user: any) {
    const t = await this.prisma.stockTransfer.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('حواله یافت نشد');
    if (t.status === 'closed') throw new BadRequestException('این حواله بسته شده است');
    if (t.status === 'planned') throw new BadRequestException('این حواله هنوز ارسال نشده است');
    const receivedBy = text(dto.receivedBy);
    if (!receivedBy) throw new BadRequestException('نامِ تحویل‌گیرنده را وارد کنید');

    await this.prisma.stockTransfer.update({
      where: { id }, data: { status: 'received', receivedAt: new Date(), receivedBy },
    });
    await this.audit.record({
      actorId: user?.id, action: 'stock.transfer.receive', entityType: 'stock_transfer', entityId: id,
      before: { status: t.status }, after: { receivedBy },
    });
    return this.transfer(id, user);
  }

  /**
   * برگشتِ مانده — آنچه مصرف نشد به انبار برمی‌گردد.
   *
   * تعدادها را کاربر نمی‌دهد و نباید بدهد: مانده = آنچه هنوز در مقصد است، و آن
   * را دفتر می‌داند. اگر کاربر عدد وارد کند، همان‌جاست که «۳۴ تا فرستادم، ۳۳ تا
   * زدم» به مغایرتِ دائمی تبدیل می‌شود.
   */
  async returnTransfer(id: number, user: any) {
    const t = await this.prisma.stockTransfer.findUnique({
      where: { id },
      include: { movements: { select: { lotId: true } } },
    });
    if (!t) throw new NotFoundException('حواله یافت نشد');
    if (t.status === 'closed') throw new BadRequestException('این حواله قبلاً بسته شده است');
    if (t.status === 'planned') throw new BadRequestException('حوالهٔ ارسال‌نشده برگشت ندارد');

    const lotIds = [...new Set(t.movements.map((m) => m.lotId))];
    const returned: { lotId: number; quantity: number }[] = [];
    const homeName = await this.home();

    await this.prisma.$transaction(async (tx) => {
      for (const lotId of lotIds) {
        const rows = await tx.stockMovement.findMany({ where: { lotId }, select: { quantity: true, location: true } });
        const lot = await tx.stockLot.findUnique({ where: { id: lotId }, select: { location: true } });
        const atDest = balanceByLocation(rows, lot?.location ?? homeName).get(t.toLocation) ?? 0;
        if (atDest <= 0) continue; // همه‌اش مصرف شد
        const meta = { transferId: t.id, visitId: t.visitId, reason: `برگشتِ حوالهٔ ${t.code}` };
        await this.move(lotId, 'transfer', -atDest, { ...meta, location: t.toLocation }, user, tx);
        await this.move(lotId, 'transfer', atDest, { ...meta, location: t.fromLocation }, user, tx);
        returned.push({ lotId, quantity: atDest });
      }
      await tx.stockTransfer.update({ where: { id }, data: { status: 'closed' } });
    });

    await this.audit.record({
      actorId: user?.id, action: 'stock.transfer.return', entityType: 'stock_transfer', entityId: id,
      after: { returned },
    });
    return this.transfer(id, user);
  }

  /**
   * برگهٔ مصرف — کارشناسِ سرِ عمل می‌گوید «چند تا مصرف شد».
   *
   * عمداً همان منطقِ انبارگردانی: کاربر **جمعِ مصرف‌شده** را می‌دهد نه «چقدر کم
   * کن»، و اختلاف را ما حساب می‌کنیم. کارشناس وسطِ کار حسابِ «قبلاً چند تا زده
   * بودم» را نگه نمی‌دارد؛ اگر مجبورش کنیم، همان‌جا دوباره‌شماری می‌شود.
   *
   * پس اصلاحِ رو به پایین هم کار می‌کند: اگر اول ۸ زد و بعد فهمید ۶ بوده،
   * حرکتِ جبرانیِ برگشت ثبت می‌شود، نه حذفِ حرکتِ قبلی.
   *
   * مانده و «چه چیزی باید برگردد» از همین‌جا خودکار درمی‌آید — کارشناس هیچ‌وقت
   * چیزی را که برمی‌گردد نمی‌شمارد.
   */
  async recordUsage(id: number, lines: { lotId: number; used: number }[], user: any) {
    const t = await this.assertTransfer(id, user);
    if (t.status === 'closed') throw new BadRequestException('این حواله بسته شده و مصرفش قابلِ تغییر نیست');

    const sent = await this.prisma.stockMovement.findMany({
      where: { transferId: id, kind: 'transfer', quantity: { gt: 0 }, location: t.toLocation },
      select: { lotId: true, quantity: true },
    });
    const sentOf = new Map(sent.map((s) => [s.lotId, s.quantity]));

    const changes: { lotId: number; from: number; to: number }[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const line of lines) {
        if (!sentOf.has(line.lotId)) throw new BadRequestException('این لات در حواله نیست');
        const target = intOrZero(line.used, 'تعدادِ مصرف‌شده');
        if (target < 0) throw new BadRequestException('تعدادِ مصرف‌شده نمی‌تواند منفی باشد');
        if (target > sentOf.get(line.lotId)!) {
          throw new BadRequestException(`بیشتر از ارسالی مصرف نمی‌شود — ${sentOf.get(line.lotId)} عدد فرستاده شده`);
        }

        const agg = await tx.stockMovement.aggregate({
          where: { transferId: id, lotId: line.lotId, kind: { in: ['out', 'return'] } },
          _sum: { quantity: true },
        });
        const already = -(agg._sum.quantity ?? 0); // خروج منفی است
        const delta = target - already;
        if (delta === 0) continue;

        const meta = { transferId: id, visitId: t.visitId, visitCode: t.visitCode, location: t.toLocation, reason: `برگهٔ مصرفِ ${t.code}` };
        if (delta > 0) await this.move(line.lotId, 'out', -delta, meta, user, tx);
        else await this.move(line.lotId, 'return', -delta, { ...meta, reason: `اصلاحِ برگهٔ مصرفِ ${t.code}` }, user, tx);
        changes.push({ lotId: line.lotId, from: already, to: target });
      }
    });

    await this.audit.record({
      actorId: user?.id, action: 'stock.transfer.usage', entityType: 'stock_transfer', entityId: id,
      after: { changes },
    });
    /* W2.2: ثبتِ مصرف ← بستنِ «تأییدِ مصرفِ سرِ عمل» (work-rules: usage.confirmed؛ ref = مراجعه). */
    if (t.visitId) {
      await this.events.emit({ type: 'usage.confirmed', visitId: t.visitId, actorId: user?.id ?? null, payload: { transferId: id, changes } });
    }
    return this.transfer(id, user);
  }

  /**
   * دامنهٔ حواله برای کارشناس.
   *
   * کارشناس فقط حواله‌ای را می‌بیند که به عملِ خودش گره خورده. حوالهٔ بینِ دو
   * انبار (بدونِ مراجعه) کارِ دفتر است و اصلاً به او مربوط نیست.
   */
  private transferScope(user: any) {
    if ((user?.level ?? 0) >= LEVEL.SUPERVISOR) return {};
    return { visit: { techId: user?.id ?? -1 } };
  }

  private async assertTransfer(id: number, user: any) {
    const t = await this.prisma.stockTransfer.findFirst({
      where: { id, ...this.transferScope(user) },
      include: { visit: { select: { seq: true, patient: { select: { code: true } } } } },
    });
    if (!t) throw new NotFoundException('حواله یافت نشد');
    return { ...t, visitCode: t.visit ? `${t.visit.patient.code}-V${t.visit.seq}` : null };
  }

  async listTransfers(opts: { status?: string; visitId?: number } = {}, user?: any) {
    const where: any = { ...this.transferScope(user) };
    if (opts.status) where.status = opts.status;
    if (opts.visitId) where.visitId = opts.visitId;
    const rows = await this.prisma.stockTransfer.findMany({
      where, orderBy: { id: 'desc' }, take: 200,
      include: {
        hospital: { select: { name: true } },
        // ⚠️ تعدادِ قلم از شمارشِ حرکت درنمی‌آید: هر قلم موقعِ ارسال دو حرکت
        // می‌سازد و موقعِ برگشت دو تای دیگر. لاتِ یکتا شمرده می‌شود.
        movements: { select: { lotId: true } },
      },
    });
    return rows.map((t) => ({
      id: t.id, code: t.code, fromLocation: t.fromLocation, toLocation: t.toLocation,
      hospitalName: t.hospital?.name ?? null, visitId: t.visitId,
      status: t.status, statusLabel: TRANSFER_LABELS[t.status] ?? t.status,
      plannedFor: t.plannedFor,
      sentAt: t.sentAt, receivedAt: t.receivedAt, receivedBy: t.receivedBy, notes: t.notes,
      lineCount: t.status === 'planned'
        ? new Set(((t.plannedLines as any[] | null) ?? []).map((l) => l.lotId)).size
        : new Set(t.movements.map((m) => m.lotId)).size,
    }));
  }

  /** یک حواله با قلم‌هایش و ماندهٔ هر قلم در مقصد — همان چیزی که برگهٔ چاپ لازم دارد. */
  async transfer(id: number, user?: any) {
    const t = await this.prisma.stockTransfer.findFirst({
      where: { id, ...this.transferScope(user) },
      include: {
        hospital: { select: { id: true, name: true } },
        movements: {
          // ⚠️ `kind: 'transfer'` هم لازم است، نه فقط مثبت‌بودن: اصلاحِ رو به
          // پایینِ برگهٔ مصرف یک حرکتِ `return` مثبت روی همین حواله می‌سازد و
          // بدونِ این شرط، آن هم یک «قلمِ حواله» شمرده می‌شد و جمع‌ها دو برابر
          // می‌شدند.
          where: { quantity: { gt: 0 }, kind: 'transfer' },
          orderBy: { id: 'asc' },
          include: { lot: { include: { item: { select: { name: true, brand: true, size: true, unit: true } } } } },
        },
      },
    });
    if (!t) throw new NotFoundException('حواله یافت نشد');

    const lotIds = [...new Set(t.movements.map((m) => m.lotId))];
    const all = lotIds.length
      ? await this.prisma.stockMovement.findMany({ where: { lotId: { in: lotIds } }, select: { lotId: true, quantity: true, location: true } })
      : [];
    const lots = lotIds.length
      ? await this.prisma.stockLot.findMany({ where: { id: { in: lotIds } }, select: { id: true, location: true } })
      : [];
    const homeName = await this.home();
    const homeOf = new Map(lots.map((l) => [l.id, l.location ?? homeName]));

    // ⚠️ «مصرف» از تفریقِ ارسال و مانده درنمی‌آید: پس از برگشتِ مانده، مانده صفر
    // می‌شود و آن تفریق کلِ ارسال را مصرف می‌شمارد. مصرف باید از حرکت‌های `out`
    // که به همین حواله گره خورده‌اند بیاید.
    // مصرفِ **خالص**: اصلاحِ رو به پایین یک `return` می‌سازد، پس شمردنِ فقط
    // `out` عددِ قبل از اصلاح را نشان می‌داد.
    const used = await this.prisma.stockMovement.groupBy({
      by: ['lotId'],
      where: { transferId: t.id, kind: { in: ['out', 'return'] } },
      _sum: { quantity: true },
    });
    const usedOf = new Map(used.map((u) => [u.lotId, -(u._sum.quantity ?? 0)]));

    // حوالهٔ برنامه‌ریزی‌شده هنوز حرکتی ندارد؛ قلم‌هایش را از `plannedLines`
    // می‌سازیم تا برگهٔ چاپ و صفحه با حوالهٔ ارسال‌شده یک شکل باشند.
    const planned = (t.plannedLines as any[] | null) ?? [];
    const plannedLots = planned.length
      ? await this.prisma.stockLot.findMany({
          where: { id: { in: planned.map((l) => Number(l.lotId)) } },
          include: { item: { select: { name: true, brand: true, size: true, unit: true } } },
        })
      : [];
    const lines = t.status === 'planned'
      ? planned.map((l) => {
          const lot = plannedLots.find((x) => x.id === Number(l.lotId));
          return {
            movementId: null, lotId: Number(l.lotId),
            lotNo: lot?.lotNo ?? null, serialNo: lot?.serialNo ?? null, expiresAt: lot?.expiresAt ?? null,
            itemName: lot?.item.name ?? '—', itemBrand: lot?.item.brand ?? null, itemSize: lot?.item.size ?? null,
            unit: lot?.item.unit ?? 'عدد',
            sent: Number(l.quantity), remaining: 0, used: 0,
          };
        })
      : t.movements
      .filter((m) => m.location === t.toLocation)
      .map((m) => {
        const rows = all.filter((r) => r.lotId === m.lotId);
        const atDest = balanceByLocation(rows, homeOf.get(m.lotId) ?? homeName).get(t.toLocation) ?? 0;
        return {
          movementId: m.id, lotId: m.lotId,
          lotNo: m.lot.lotNo, serialNo: m.lot.serialNo, expiresAt: m.lot.expiresAt,
          itemName: m.lot.item.name, itemBrand: m.lot.item.brand, itemSize: m.lot.item.size,
          unit: m.lot.item.unit,
          sent: m.quantity,
          /// هنوز در مقصد است — یعنی هنوز مصرف نشده و باید برگردد.
          remaining: Math.max(0, atDest),
          used: usedOf.get(m.lotId) ?? 0,
        };
      });

    return {
      id: t.id, code: t.code, fromLocation: t.fromLocation, toLocation: t.toLocation,
      hospital: t.hospital, visitId: t.visitId,
      status: t.status, statusLabel: TRANSFER_LABELS[t.status] ?? t.status,
      plannedFor: t.plannedFor, windowFrom: t.windowFrom, windowTo: t.windowTo,
      // ساعت و محلی که کارشناس هنگامِ اعلامِ پایان گفت — همان که توقفِ
      // جمع‌آوری از رویش ساخته شد؛ بی این دو کارت فقط «تمام شد» می‌گوید.
      releasedAt: t.releasedAt, releaseNote: t.releaseNote, pickupAt: t.pickupAt, leftAt: t.leftAt,
      sentAt: t.sentAt, receivedAt: t.receivedAt, receivedBy: t.receivedBy, notes: t.notes,
      lines,
      totals: {
        sent: lines.reduce((s, l) => s + l.sent, 0),
        used: lines.reduce((s, l) => s + l.used, 0),
        remaining: lines.reduce((s, l) => s + l.remaining, 0),
      },
    };
  }

  /**
   * محلِ درستِ مصرف برای یک عمل.
   *
   * اگر ستی برای همین مراجعه فرستاده شده و هنوز موجودی آن‌جا دارد، مصرف باید از
   * همان‌جا کم شود نه از انبار. وگرنه دفتر می‌گوید کالا هم در بیمارستان است هم
   * مصرف شده — و «چند تا برگردد» غلط درمی‌آید.
   */
  async consumeLocationFor(lotId: number, visitId?: number | null): Promise<{ location: string; transferId: number } | null> {
    if (!visitId) return null;
    const open = await this.prisma.stockTransfer.findFirst({
      where: { visitId, status: { not: 'closed' }, movements: { some: { lotId } } },
      orderBy: { id: 'desc' },
      select: { id: true, toLocation: true },
    });
    if (!open) return null;
    const rows = await this.prisma.stockMovement.findMany({ where: { lotId }, select: { quantity: true, location: true } });
    const lot = await this.prisma.stockLot.findUnique({ where: { id: lotId }, select: { location: true } });
    const atDest = balanceByLocation(rows, lot?.location ?? (await this.home())).get(open.toLocation) ?? 0;
    // مصرف به خودِ حواله گره می‌خورد، وگرنه «چقدرش مصرف شد» فقط از تفریقِ
    // ارسال و مانده درمی‌آید — که پس از برگشتِ مانده، برگشتی‌ها را هم مصرف
    // می‌شمارد و عددِ حواله بعد از بسته‌شدن غلط می‌شود.
    return atDest > 0 ? { location: open.toLocation, transferId: open.id } : null;
  }

  // ───────────────────────── ردیابی ─────────────────────────

  /**
   * «این لات کجا رفت» — پاسخِ فراخوانِ سازنده.
   *
   * جهتِ عکسِ گزارشِ مصرف است و همان چیزی که هیچ فاکتوری نمی‌تواند بدهد.
   */
  async trace(lotId: number) {
    const lot = await this.lot(lotId);
    const movements = await this.prisma.stockMovement.findMany({
      where: { lotId },
      orderBy: { id: 'desc' },
      include: {
        visit: {
          select: {
            id: true, seq: true, opDate: true,
            patient: { select: { id: true, code: true, firstName: true, lastName: true } },
          },
        },
      },
    });
    return {
      lot,
      movements: movements.map((m) => ({
        id: m.id,
        kind: m.kind,
        kindLabel: MOVEMENT_LABELS[m.kind] ?? m.kind,
        quantity: m.quantity,
        location: m.location,
        reason: m.reason,
        reference: m.reference,
        createdAt: m.createdAt,
        // کدِ زندهٔ مراجعه اگر هست، وگرنه عکسِ لحظهٔ مصرف.
        visitCode: m.visit ? `${m.visit.patient.code}-V${m.visit.seq}` : m.visitCode,
        visitId: m.visit?.id ?? null,
        patient: m.visit ? { id: m.visit.patient.id, code: m.visit.patient.code, name: `${m.visit.patient.firstName} ${m.visit.patient.lastName}`.trim() } : null,
        opDate: m.visit?.opDate ?? null,
      })),
    };
  }

  /** «در این عمل چه چیزی مصرف شد» — با لات و سریال، نه فقط نامِ کالا. */
  async visitUsage(visitId: number) {
    const rows = await this.prisma.stockMovement.findMany({
      where: { visitId },
      orderBy: { id: 'asc' },
      include: { lot: { include: { item: { select: { name: true, brand: true, size: true, unit: true } } } } },
    });
    return rows.map((m) => ({
      id: m.id,
      kind: m.kind,
      kindLabel: MOVEMENT_LABELS[m.kind] ?? m.kind,
      quantity: m.quantity,
      lotId: m.lotId,
      lotNo: m.lot.lotNo,
      serialNo: m.lot.serialNo,
      expiresAt: m.lot.expiresAt,
      itemName: m.lot.item.name,
      itemBrand: m.lot.item.brand,
      itemSize: m.lot.item.size,
      unit: m.lot.item.unit,
      chargeId: m.chargeId,
      createdAt: m.createdAt,
    }));
  }

  /**
   * ⚠️ ورودی دیگر یک عدد نیست، ردیف‌های (محل، تعداد) است.
   *
   * عمداً: `quantity` (کل) و `available` (در انبارِ خودمان) باید از یک منبع
   * بیرون بیایند، وگرنه دو تابع دو تعریفِ متفاوت از موجودی پیدا می‌کنند.
   */
  private shapeLot(lot: any, rows: { quantity: number; location: string | null }[], homeName: string) {
    const home = lot.location ?? homeName;
    const byLoc = balanceByLocation(rows, home);
    const quantity = balanceOf(rows);
    const available = byLoc.get(home) ?? 0;
    const outside = [...byLoc.entries()]
      .filter(([loc, q]) => loc !== home && q !== 0)
      .map(([location, q]) => ({ location, quantity: q }));
    const expired = !!lot.expiresAt && lot.expiresAt.getTime() < Date.now();
    return {
      /// موجودیِ کل شامل کالایی است که بیرون است؛ «در دسترس» فقط انبارِ خودمان.
      available,
      outside,
      home,
      id: lot.id,
      itemId: lot.itemId,
      itemName: lot.item?.name ?? null,
      itemBrand: lot.item?.brand ?? null,
      itemSize: lot.item?.size ?? null,
      itemSku: lot.item?.sku ?? null,
      itemPrice: lot.item?.price ?? null,
      unit: lot.item?.unit ?? 'عدد',
      lotNo: lot.lotNo,
      serialNo: lot.serialNo,
      expiresAt: lot.expiresAt,
      location: lot.location,
      notes: lot.notes,
      quantity,
      expired,
      createdAt: lot.createdAt,
    };
  }
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() || null : null);

function intOrZero(v: unknown, label: string): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new BadRequestException(`${label} باید عددِ صحیح باشد`);
  return n;
}

function positiveInt(v: unknown, label: string): number {
  const n = intOrZero(v, label);
  if (n <= 0) throw new BadRequestException(`${label} باید بیشتر از صفر باشد`);
  return n;
}

function dateOrNull(v: unknown, label: string): Date | null {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} معتبر نیست`);
  return d;
}
