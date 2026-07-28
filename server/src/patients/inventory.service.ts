import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** نوعِ حرکتِ انبار. علامت را سرویس تعیین می‌کند، نه کاربر. */
export const MOVEMENT_KINDS = ['in', 'out', 'return', 'adjust'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const MOVEMENT_LABELS: Record<string, string> = {
  in: 'ورود',
  out: 'مصرف',
  return: 'برگشت',
  adjust: 'اصلاحِ شمارش',
};

/**
 * موجودیِ لات = جمعِ دفتر.
 *
 * خالص و بیرونِ کلاس، دقیقاً به همان دلیلِ `summarize` در مالی: هرجا موجودی
 * لازم شد از همین یک فرمول می‌آید، پس دو نقطه از برنامه نمی‌توانند دو عددِ
 * متفاوت بگویند.
 */
export function balanceOf(movements: { quantity: number }[]): number {
  return movements.reduce((sum, m) => sum + m.quantity, 0);
}

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
  constructor(private prisma: PrismaService, private audit: AuditService) {}

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
      where.OR = [
        { lotNo: { contains: term, mode: 'insensitive' } },
        { serialNo: { contains: term, mode: 'insensitive' } },
        { location: { contains: term, mode: 'insensitive' } },
        { item: { name: { contains: term, mode: 'insensitive' } } },
        { item: { sku: { contains: term, mode: 'insensitive' } } },
        { item: { brand: { contains: term, mode: 'insensitive' } } },
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

    const sums = await this.prisma.stockMovement.groupBy({
      by: ['lotId'],
      where: { lotId: { in: lots.map((l) => l.id) } },
      _sum: { quantity: true },
    });
    const qtyOf = new Map(sums.map((s) => [s.lotId, s._sum.quantity ?? 0]));

    const rows = lots.map((l) => this.shapeLot(l, qtyOf.get(l.id) ?? 0));
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

    const lot = await this.prisma.$transaction(async (tx) => {
      const created = await tx.stockLot.create({
        data: {
          itemId: item.id,
          lotNo: text(dto.lotNo),
          serialNo,
          expiresAt,
          location: text(dto.location),
          notes: text(dto.notes),
        },
      });
      if (initial > 0) {
        await tx.stockMovement.create({
          data: {
            lotId: created.id, kind: 'in', quantity: initial,
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
    const agg = await this.prisma.stockMovement.aggregate({ where: { lotId: id }, _sum: { quantity: true } });
    return this.shapeLot(row, agg._sum.quantity ?? 0);
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
    dto: { lotId: number; quantity: number; visitId?: number; chargeId?: number; reason?: string },
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
    return this.move(
      dto.lotId, 'out', -quantity,
      { visitId: dto.visitId ?? null, visitCode, chargeId: dto.chargeId ?? null, reason: text(dto.reason) },
      user,
    );
  }

  /** برگشت به انبار — جبرانِ مصرفِ اشتباه یا کالای مصرف‌نشده. */
  async returnToStock(
    dto: { lotId: number; quantity: number; visitId?: number; chargeId?: number; reason?: string },
    user: any,
  ) {
    const quantity = positiveInt(dto.quantity, 'تعداد');
    return this.move(
      dto.lotId, 'return', quantity,
      { visitId: dto.visitId ?? null, chargeId: dto.chargeId ?? null, reason: text(dto.reason) },
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
    extra: { visitId?: number | null; visitCode?: string | null; chargeId?: number | null; reason?: string | null; reference?: string | null },
    user: any,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: number; serial_no: string | null; expires_at: Date | null }[]>`
        SELECT id, serial_no, expires_at FROM stock_lots WHERE id = ${lotId} FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('لات یافت نشد');
      const lot = locked[0];

      if (kind === 'out' && lot.expires_at && lot.expires_at.getTime() < Date.now()) {
        throw new BadRequestException('این لات منقضی شده و قابلِ مصرف نیست');
      }

      const agg = await tx.stockMovement.aggregate({ where: { lotId }, _sum: { quantity: true } });
      const next = (agg._sum.quantity ?? 0) + signedQty;
      if (next < 0) throw new BadRequestException(`موجودیِ کافی نیست — الان ${agg._sum.quantity ?? 0} عدد است`);
      if (lot.serial_no && next > 1) throw new BadRequestException('لاتِ سریالی نمی‌تواند بیش از یک عدد باشد');

      return tx.stockMovement.create({
        data: {
          lotId, kind, quantity: signedQty,
          visitId: extra.visitId ?? null,
          visitCode: extra.visitCode ?? null,
          chargeId: extra.chargeId ?? null,
          reason: extra.reason ?? null,
          reference: extra.reference ?? null,
          createdById: user?.id ?? null,
        },
      });
    });

    await this.audit.record({
      actorId: user?.id, action: `stock.${kind}`, entityType: 'stock_movement', entityId: row.id,
      after: { lotId, quantity: signedQty, visitId: extra.visitId ?? null, chargeId: extra.chargeId ?? null },
    });
    return { ok: true, movementId: row.id, quantity: await this.balance(lotId) };
  }

  async balance(lotId: number) {
    const agg = await this.prisma.stockMovement.aggregate({ where: { lotId }, _sum: { quantity: true } });
    return agg._sum.quantity ?? 0;
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

  private shapeLot(lot: any, quantity: number) {
    const expired = !!lot.expiresAt && lot.expiresAt.getTime() < Date.now();
    return {
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
