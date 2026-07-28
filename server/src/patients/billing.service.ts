import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from './inventory.service';
import { LEVEL } from '../common/levels';

/** نوعِ قلمِ صورت‌حساب. discount همیشه مبلغِ منفی می‌سازد. */
export const CHARGE_KINDS = ['service', 'item', 'discount'] as const;

/** روشِ پرداخت — فهرستِ بسته تا گزارشِ روشِ دریافت معنا داشته باشد. */
export const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'cheque', 'insurance'] as const;

/**
 * مالیِ مراجعه.
 *
 * قانونِ واحد: مبالغ همه «تومان» و عددِ صحیح‌اند. هیچ جا اعشار نداریم چون
 * جمع‌زدنِ اعشارِ شناور روی صدها ردیف، فاکتور را یک ریال جابه‌جا می‌کند.
 */
@Injectable()
export class BillingService {
  constructor(private prisma: PrismaService, private audit: AuditService, private inventory: InventoryService) {}

  /** همان قاعدهٔ scope که برای مراجعه داریم؛ کارشناس فقط مراجعاتِ خودش. */
  private async assertVisit(visitId: number, user: any) {
    const scoped = (user?.level ?? 0) < LEVEL.SUPERVISOR;
    const visit = await this.prisma.visit.findFirst({
      where: { id: visitId, ...(scoped ? { techId: user?.id ?? -1 } : {}) },
      select: { id: true, patientId: true },
    });
    if (!visit) throw new NotFoundException('مراجعه پیدا نشد');
    return visit;
  }

  /**
   * صورت‌حسابِ یک مراجعه — ردیف‌ها به‌همراه جمع‌های مشتق.
   *
   * فیلدهای مشتق (total/paid/due) فقط این‌جا ساخته می‌شوند؛ هیچ render ای اجازهٔ
   * جمع‌زدن ندارد، وگرنه همان پراکندگیِ فرمول که در ملک‌طب داشتیم برمی‌گردد.
   */
  async get(visitId: number, user: any) {
    await this.assertVisit(visitId, user);
    const [charges, payments, moves] = await Promise.all([
      this.prisma.charge.findMany({ where: { visitId }, orderBy: { id: 'asc' } }),
      this.prisma.payment.findMany({ where: { visitId }, orderBy: [{ paidAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.stockMovement.findMany({
        where: { visitId, chargeId: { not: null }, kind: 'out' },
        include: { lot: { select: { lotNo: true, serialNo: true } } },
      }),
    ]);
    // لاتِ مصرف‌شده روی خودِ قلم دیده می‌شود؛ وگرنه کاربر برای فهمیدنِ «کدام
    // سریال روی این فاکتور رفت» باید صفحهٔ انبار را جدا باز کند.
    const lotOf = new Map(moves.map((m) => [m.chargeId, { lotId: m.lotId, lotNo: m.lot.lotNo, serialNo: m.lot.serialNo }]));
    return {
      ...summarize(charges, payments),
      charges: charges.map((c) => ({ ...c, lot: lotOf.get(c.id) ?? null })),
      payments,
    };
  }

  async addCharge(
    visitId: number,
    dto: { kind?: string; title?: string; quantity?: number; unitPrice?: number; notes?: string; serviceCode?: string; itemId?: number; lotId?: number },
    user: any,
  ) {
    await this.assertVisit(visitId, user);
    const kind = dto.kind ?? 'service';
    if (!CHARGE_KINDS.includes(kind as any)) throw new BadRequestException('نوعِ قلم نامعتبر است');

    const title = dto.title?.trim();
    if (!title) throw new BadRequestException('عنوانِ قلم را وارد کنید');

    const quantity = dto.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) throw new BadRequestException('تعداد باید عددِ مثبت باشد');

    const unitPrice = dto.unitPrice ?? 0;
    if (!Number.isInteger(unitPrice) || unitPrice < 0) throw new BadRequestException('مبلغ باید عددِ صحیحِ نامنفی باشد');

    // کاربر تخفیف را مثبت وارد می‌کند؛ علامت را ما می‌گذاریم تا در UI منطقِ
    // علامت تکرار نشود و کسی یادش نرود منفی بزند.
    const magnitude = quantity * unitPrice;
    const amount = kind === 'discount' ? -magnitude : magnitude;

    const row = await this.prisma.charge.create({
      data: {
        visitId, kind, title, quantity, unitPrice, amount,
        serviceCode: dto.serviceCode?.trim() || null,
        itemId: dto.itemId ?? null,
        notes: dto.notes?.trim() || null,
        createdById: user?.id ?? null,
      },
    });

    // مصرف از انبار بعد از ساختِ قلم انجام می‌شود تا شمارهٔ قلم در دفتر بنشیند
    // و ردیابی دوطرفه شود. اگر موجودی کم بود، قلمِ تازه‌ساخته پس گرفته می‌شود:
    // فاکتوری که کالایش از انبار در نیامده، فاکتورِ غلط است.
    if (dto.lotId) {
      try {
        await this.inventory.consume(
          { lotId: dto.lotId, quantity, visitId, chargeId: row.id, reason: `فاکتورِ ${title}` },
          user,
        );
      } catch (err) {
        await this.prisma.charge.delete({ where: { id: row.id } });
        throw err;
      }
    }

    await this.audit.record({
      actorId: user?.id, action: 'charge.create', entityType: 'charge', entityId: row.id,
      after: { visitId, title, amount, serviceCode: dto.serviceCode ?? null },
    });
    return row;
  }

  async removeCharge(chargeId: number, user: any) {
    const row = await this.prisma.charge.findUnique({ where: { id: chargeId } });
    if (!row) throw new NotFoundException('قلمِ صورت‌حساب پیدا نشد');
    await this.assertVisit(row.visitId, user);

    // کالای مصرف‌شده با حرکتِ جبرانی برمی‌گردد، نه با پاک‌کردنِ حرکتِ مصرف:
    // دفترِ انبار فقط اضافه می‌شود، وگرنه «چه وقت چه شد» از بین می‌رود.
    const consumed = await this.prisma.stockMovement.findMany({
      where: { chargeId, kind: 'out' },
    });
    for (const m of consumed) {
      await this.inventory.returnToStock(
        { lotId: m.lotId, quantity: Math.abs(m.quantity), visitId: row.visitId, chargeId, reason: 'حذفِ قلمِ فاکتور' },
        user,
      );
    }

    await this.prisma.charge.delete({ where: { id: chargeId } });
    await this.audit.record({
      actorId: user?.id, action: 'charge.delete', entityType: 'charge', entityId: chargeId, before: row,
    });
    return { ok: true };
  }

  async addPayment(
    visitId: number,
    dto: { amount?: number; method?: string; paidAt?: string; reference?: string; notes?: string },
    user: any,
  ) {
    await this.assertVisit(visitId, user);
    const method = dto.method ?? 'cash';
    if (!PAYMENT_METHODS.includes(method as any)) throw new BadRequestException('روشِ پرداخت نامعتبر است');

    const amount = dto.amount ?? 0;
    if (!Number.isInteger(amount) || amount <= 0) throw new BadRequestException('مبلغِ پرداخت باید عددِ مثبت باشد');

    let paidAt = new Date();
    if (dto.paidAt) {
      const d = new Date(dto.paidAt);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخِ پرداخت معتبر نیست');
      paidAt = d;
    }

    const row = await this.prisma.payment.create({
      data: {
        visitId, amount, method, paidAt,
        reference: dto.reference?.trim() || null,
        notes: dto.notes?.trim() || null,
        createdById: user?.id ?? null,
      },
    });
    await this.audit.record({
      actorId: user?.id, action: 'payment.create', entityType: 'payment', entityId: row.id,
      after: { visitId, amount, method },
    });
    return row;
  }

  async removePayment(paymentId: number, user: any) {
    const row = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!row) throw new NotFoundException('پرداخت پیدا نشد');
    await this.assertVisit(row.visitId, user);
    await this.prisma.payment.delete({ where: { id: paymentId } });
    await this.audit.record({
      actorId: user?.id, action: 'payment.delete', entityType: 'payment', entityId: paymentId, before: row,
    });
    return { ok: true };
  }
}

/**
 * جمع‌های مشتق. بیرونِ کلاس و خالص است تا هم `enrich` مراجعه بتواند از آن
 * استفاده کند هم سرویس — یک فرمول، یک جا.
 */
export function summarize(
  charges: { amount: number }[],
  payments: { amount: number }[],
) {
  const total = charges.reduce((s, c) => s + c.amount, 0);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  return { total, paid, due: total - paid };
}
