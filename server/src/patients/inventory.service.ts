import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

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

/// محلِ پیش‌فرض وقتی لات محلی ثبت‌نشده دارد — تا موجودی زیرِ کلیدِ `null` گم نشود.
export const HOME_FALLBACK = 'انبارِ مرکزی';

/** وضعیتِ حواله. `closed` یعنی ماندهٔ مصرف‌نشده برگشته و پرونده بسته است. */
export const TRANSFER_STATUSES = ['sent', 'received', 'closed'] as const;
export const TRANSFER_LABELS: Record<string, string> = {
  sent: 'ارسال‌شده',
  received: 'تحویلِ CSR',
  closed: 'بسته (مانده برگشت)',
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
 * موجودیِ تفکیک‌شده به محل — همان `balanceOf`، فقط گروه‌بندی‌شده.
 *
 * لازم است چون یک لاتِ ۲۰تایی می‌تواند ۱۲ عددش در ستِ بیمارستانِ الف باشد و ۸
 * عددش در انبار. «موجودی» هر دو را می‌شمارد ولی فقط ۸ تا **در دسترس** است، و
 * چینشی که این تفاوت را نبیند ستِ رفته را دوباره تعهد می‌کند.
 */
export function balanceByLocation(
  movements: { quantity: number; location: string | null }[],
  home: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of movements) {
    const key = m.location ?? home;
    map.set(key, (map.get(key) ?? 0) + m.quantity);
  }
  return map;
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

    const rows = lots.map((l) => this.shapeLot(l, byLot.get(l.id) ?? []));
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
    return this.shapeLot(row, rows);
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
    const run = async (db: any) => {
      const locked = await db.$queryRaw<{ id: number; serial_no: string | null; expires_at: Date | null; location: string | null }[]>`
        SELECT id, serial_no, expires_at, location FROM stock_lots WHERE id = ${lotId} FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('لات یافت نشد');
      const lot = locked[0];
      const home = lot.location ?? HOME_FALLBACK;
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

    await this.audit.record({
      actorId: user?.id, action: `stock.${kind}`, entityType: 'stock_movement', entityId: row.id,
      after: { lotId, quantity: signedQty, location: row.location, visitId: extra.visitId ?? null, chargeId: extra.chargeId ?? null, transferId: extra.transferId ?? null },
    });
    return { ok: true, movementId: row.id, quantity: await this.balance(lotId) };
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
    dto: { toLocation?: string; fromLocation?: string; hospitalId?: number; visitId?: number; notes?: string; lines?: { lotId: number; quantity: number }[] },
    user: any,
  ) {
    const to = text(dto.toLocation);
    if (!to) throw new BadRequestException('مقصد را وارد کنید');
    const lines = (dto.lines ?? []).filter((l) => l && l.lotId);
    if (!lines.length) throw new BadRequestException('حواله بدونِ قلم معنا ندارد');

    let visitCode: string | null = null;
    if (dto.visitId) {
      const v = await this.prisma.visit.findUnique({
        where: { id: dto.visitId },
        select: { seq: true, patient: { select: { code: true } } },
      });
      if (!v) throw new NotFoundException('مراجعه یافت نشد');
      visitCode = `${v.patient.code}-V${v.seq}`;
    }

    // مبدأ اگر داده نشده، محلِ خانهٔ اولین لات است — همان جایی که کالا واقعاً هست.
    const first = await this.prisma.stockLot.findUnique({ where: { id: lines[0].lotId }, select: { location: true } });
    if (!first) throw new NotFoundException('لات یافت نشد');
    const from = text(dto.fromLocation) ?? first.location ?? HOME_FALLBACK;
    if (from === to) throw new BadRequestException('مبدأ و مقصد یکی است');

    const transfer = await this.prisma.$transaction(async (tx) => {
      const last = await tx.stockTransfer.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
      const t = await tx.stockTransfer.create({
        data: {
          code: `HV-${String((last?.id ?? 0) + 1).padStart(4, '0')}`,
          fromLocation: from, toLocation: to,
          hospitalId: dto.hospitalId ?? null,
          visitId: dto.visitId ?? null,
          notes: text(dto.notes),
          createdById: user?.id ?? null,
        },
      });
      for (const l of lines) {
        const qty = positiveInt(l.quantity, 'تعداد');
        const meta = { visitId: dto.visitId ?? null, visitCode, transferId: t.id, reason: `حوالهٔ ${t.code}` };
        await this.move(l.lotId, 'transfer', -qty, { ...meta, location: from }, user, tx);
        await this.move(l.lotId, 'transfer', qty, { ...meta, location: to }, user, tx);
      }
      return t;
    });

    await this.audit.record({
      actorId: user?.id, action: 'stock.transfer.send', entityType: 'stock_transfer', entityId: transfer.id,
      after: { code: transfer.code, from, to, lines: lines.length },
    });
    return this.transfer(transfer.id);
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
    const receivedBy = text(dto.receivedBy);
    if (!receivedBy) throw new BadRequestException('نامِ تحویل‌گیرنده را وارد کنید');

    await this.prisma.stockTransfer.update({
      where: { id }, data: { status: 'received', receivedAt: new Date(), receivedBy },
    });
    await this.audit.record({
      actorId: user?.id, action: 'stock.transfer.receive', entityType: 'stock_transfer', entityId: id,
      before: { status: t.status }, after: { receivedBy },
    });
    return this.transfer(id);
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

    const lotIds = [...new Set(t.movements.map((m) => m.lotId))];
    const returned: { lotId: number; quantity: number }[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const lotId of lotIds) {
        const rows = await tx.stockMovement.findMany({ where: { lotId }, select: { quantity: true, location: true } });
        const lot = await tx.stockLot.findUnique({ where: { id: lotId }, select: { location: true } });
        const atDest = balanceByLocation(rows, lot?.location ?? HOME_FALLBACK).get(t.toLocation) ?? 0;
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
    return this.transfer(id);
  }

  async listTransfers(opts: { status?: string; visitId?: number } = {}) {
    const where: any = {};
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
      sentAt: t.sentAt, receivedAt: t.receivedAt, receivedBy: t.receivedBy, notes: t.notes,
      lineCount: new Set(t.movements.map((m) => m.lotId)).size,
    }));
  }

  /** یک حواله با قلم‌هایش و ماندهٔ هر قلم در مقصد — همان چیزی که برگهٔ چاپ لازم دارد. */
  async transfer(id: number) {
    const t = await this.prisma.stockTransfer.findUnique({
      where: { id },
      include: {
        hospital: { select: { id: true, name: true } },
        movements: {
          where: { quantity: { gt: 0 } }, // فقط پایهٔ ورود، وگرنه هر قلم دوبار می‌آید
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
    const homeOf = new Map(lots.map((l) => [l.id, l.location ?? HOME_FALLBACK]));

    // ⚠️ «مصرف» از تفریقِ ارسال و مانده درنمی‌آید: پس از برگشتِ مانده، مانده صفر
    // می‌شود و آن تفریق کلِ ارسال را مصرف می‌شمارد. مصرف باید از حرکت‌های `out`
    // که به همین حواله گره خورده‌اند بیاید.
    const used = await this.prisma.stockMovement.groupBy({
      by: ['lotId'],
      where: { transferId: t.id, kind: 'out' },
      _sum: { quantity: true },
    });
    const usedOf = new Map(used.map((u) => [u.lotId, -(u._sum.quantity ?? 0)]));

    const lines = t.movements
      .filter((m) => m.location === t.toLocation)
      .map((m) => {
        const rows = all.filter((r) => r.lotId === m.lotId);
        const atDest = balanceByLocation(rows, homeOf.get(m.lotId) ?? HOME_FALLBACK).get(t.toLocation) ?? 0;
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
    const atDest = balanceByLocation(rows, lot?.location ?? HOME_FALLBACK).get(open.toLocation) ?? 0;
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
  private shapeLot(lot: any, rows: { quantity: number; location: string | null }[]) {
    const home = lot.location ?? HOME_FALLBACK;
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
