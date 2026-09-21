import type { Prisma } from '@prisma/client';
import { canAccess } from '../auth/access-check';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from './inventory.service';
import { TreasuryService } from './treasury.service';
import { LEVEL } from '../common/levels';
import { ownVisitWhere } from '../common/own-scope';

/** نوعِ قلمِ صورت‌حساب. discount همیشه مبلغِ منفی می‌سازد. */
export const CHARGE_KINDS = ['service', 'item', 'discount'] as const;

/**
 * اثرِ قلمِ فاکتور روی انبار.
 *
 * مدلِ مالیِ شرکت‌های تجهیزاتِ پزشکی دو بخش دارد و این دو **یکی نیستند**:
 * آنچه روی فاکتور می‌آید، و آنچه واقعاً از انبار خارج می‌شود. یک فاکتور
 * می‌تواند قلمی داشته باشد که از انبار کم نمی‌شود (قیمتِ توافقی، کالای خودِ
 * بیمارستان)، و کالایی مصرف شود که فاکتور نمی‌خورد (اضافه‌مصرف، شکست، هدیه).
 *
 * تا وقتی این نیت ثبت نشود، «قلمِ مجازیِ عمدی» و «کاربر یادش رفت لات را انتخاب
 * کند» در دیتابیس دقیقاً یک شکل دارند — و هیچ گزارشِ مغایرتی ممکن نیست.
 */
export const STOCK_EFFECTS = ['consumed', 'virtual', 'hospital'] as const;

/** روشِ پرداخت — فهرستِ بسته تا گزارشِ روشِ دریافت معنا داشته باشد. */
export const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'cheque', 'insurance'] as const;
/// روش‌هایی که پول واقعاً واردِ یک حسابِ بانکی می‌شود — فقط این‌ها به «حسابِ فاکتور» مقیدند.
export const BANK_ROUTED_METHODS = ['card', 'transfer', 'cheque'] as const;

/**
 * مالیِ مراجعه.
 *
 * قانونِ واحد: مبالغ همه «تومان» و عددِ صحیح‌اند. هیچ جا اعشار نداریم چون
 * جمع‌زدنِ اعشارِ شناور روی صدها ردیف، فاکتور را یک ریال جابه‌جا می‌کند.
 */
@Injectable()
export class BillingService {
  constructor(private prisma: PrismaService, private audit: AuditService, private inventory: InventoryService, private treasury: TreasuryService) {}

  /** همان قاعدهٔ scope که برای مراجعه داریم؛ کارشناس فقط مراجعاتِ خودش. */
  private async assertVisit(visitId: number, user: any, db: any = this.prisma) {
    const scoped = (user?.level ?? 0) < LEVEL.SUPERVISOR;
    const visit = await db.visit.findFirst({
      where: { id: visitId, ...(scoped ? ownVisitWhere(user) : {}) },
      select: {
        id: true, patientId: true, pricingModel: true, globalAmount: true,
        invoiceType: true, invoiceBankAccountId: true,
        /**
         * ⚠️ **فیلدها صریح انتخاب می‌شوند، نه `invoiceBankAccount: true`.**
         *
         * `true` کلِ ردیف را می‌آورد و `billing.get` عیناً برش می‌گرداند —
         * شاملِ `cardNumber`، `notes`، `partnerId` و `showOnIntake`. ولی این
         * پاسخ پشتِ `billing.read` (سطحِ سوپروایزر) است در حالی که خودِ
         * `/bank-accounts` پشتِ `accounting.read` (سطحِ ادمین) است: یعنی
         * سوپروایزری که ماژولِ حسابداری برایش بسته است، شمارهٔ کارت و شبا را
         * از این مسیر می‌گرفت.
         *
         * این پنج قلم همان‌هایی‌اند که کلاینت واقعاً مصرف می‌کند: شناسه برای
         * قفلِ سلکت، و چهارتای دیگر برای سربرگِ «حساب دریافت» روی فاکتورِ
         * چاپی (`exports.js`). قلمِ ششمی اضافه نکنید مگر مصرف‌کننده‌اش را
         * نشان دهید.
         */
        invoiceBankAccount: {
          select: { id: true, ownerName: true, bankName: true, accountNumber: true, iban: true },
        },
        hospital: { select: { sector: true } },
      },
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
    const visit = await this.assertVisit(visitId, user);
    const [charges, payments, moves] = await Promise.all([
      this.prisma.charge.findMany({ where: { visitId }, orderBy: { id: 'asc' } }),
      this.prisma.payment.findMany({ where: { visitId }, orderBy: [{ paidAt: 'desc' }, { id: 'desc' }] }),
      // ⚠️ همهٔ حرکت‌های این مراجعه، نه فقط آن‌هایی که قلمِ فاکتور دارند. فیلترِ
      // قبلی (`chargeId: { not: null }`) دقیقاً نیمهٔ دومِ مدلِ دوبخشی را نامرئی
      // می‌کرد: کالایی که سرِ عمل مصرف شد ولی فاکتور نخورد.
      this.prisma.stockMovement.findMany({
        where: { visitId },
        include: { lot: { select: { lotNo: true, serialNo: true, item: { select: { name: true } } } } },
        orderBy: { id: 'asc' },
      }),
    ]);
    // لاتِ مصرف‌شده روی خودِ قلم دیده می‌شود؛ وگرنه کاربر برای فهمیدنِ «کدام
    // سریال روی این فاکتور رفت» باید صفحهٔ انبار را جدا باز کند.
    const lotOf = new Map(
      moves
        .filter((m) => m.kind === 'out' && m.chargeId)
        .map((m) => [m.chargeId, { lotId: m.lotId, lotNo: m.lot.lotNo, serialNo: m.lot.serialNo }]),
    );
    return {
      ...summarize(charges, payments, visit),
      invoiceType: visit.invoiceType,
      invoiceBankAccount: visit.invoiceBankAccount,
      tariffSector: visit.hospital?.sector ?? 'private',
      pricingModel: visit.pricingModel,
      globalAmount: visit.globalAmount,
      charges: charges.map((c) => ({ ...c, lot: lotOf.get(c.id) ?? null })),
      payments,
      reconcile: reconcile(charges, moves),
    };
  }

  /**
   * تعیینِ مدلِ قیمت‌گذاریِ فاکتورِ یک مراجعه.
   *
   * «گلوبال» بدونِ مبلغ پذیرفته نمی‌شود: مدلی که مبنایش مبلغِ توافقی است ولی
   * مبلغ ندارد، در عمل همان coded است و فقط کاربر را گیج می‌کند.
   */
  async setInvoiceAccount(visitId: number, dto: { invoiceType: string; bankAccountId: number }, user: any) {
    const before = await this.assertVisit(visitId, user);
    if (!['formal', 'informal'].includes(dto.invoiceType)) throw new BadRequestException('نوع فاکتور نامعتبر است');
    const bank = await this.prisma.bankAccount.findFirst({ where: { id: dto.bankAccountId, active: true } });
    if (!bank || bank.classification !== dto.invoiceType) throw new BadRequestException('حساب باید فعال و هم‌نوع فاکتور باشد');
    const mismatched = await this.prisma.payment.count({ where: { visitId, bankAccountId: { not: bank.id } } });
    if (mismatched) throw new BadRequestException('پرداخت ثبت‌شده به حساب دیگری متصل است؛ ابتدا انتساب پرداخت را بررسی کنید');
    const after = { invoiceType: dto.invoiceType, invoiceBankAccountId: bank.id };
    await this.prisma.visit.update({ where: { id: visitId }, data: after });
    await this.audit.record({ actorId: user?.id, action: 'billing.invoice-account', entityType: 'visit', entityId: visitId,
      before: { invoiceType: before.invoiceType, invoiceBankAccountId: before.invoiceBankAccountId }, after });
    return this.get(visitId, user);
  }

  async setPricing(visitId: number, dto: { pricingModel?: string; globalAmount?: number | null }, user: any) {
    const before = await this.assertVisit(visitId, user);
    const model = dto.pricingModel ?? 'coded';
    if (!['coded', 'global'].includes(model)) throw new BadRequestException('مدلِ قیمت‌گذاری نامعتبر است');
    let globalAmount: number | null = null;
    if (model === 'global') {
      if (!Number.isInteger(dto.globalAmount) || (dto.globalAmount as number) < 0) {
        throw new BadRequestException('برای مدلِ گلوبال، مبلغِ کل (تومان، عددِ صحیحِ نامنفی) لازم است');
      }
      globalAmount = dto.globalAmount as number;
    }
    await this.prisma.visit.update({ where: { id: visitId }, data: { pricingModel: model, globalAmount } });
    await this.audit.record({
      actorId: user?.id, action: 'billing.pricing', entityType: 'visit', entityId: visitId,
      before: { pricingModel: before.pricingModel, globalAmount: before.globalAmount },
      after: { pricingModel: model, globalAmount },
    });
    return this.get(visitId, user);
  }

  async addCharge(
    visitId: number,
    dto: { kind?: string; title?: string; quantity?: number; unitPrice?: number; notes?: string; serviceCode?: string; codeSystem?: string; itemId?: number; lotId?: number; stockEffect?: string },
    user: any,
    neuroDetail?: Record<string, any>,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    if (tx && dto.lotId) throw new BadRequestException('مصرف انبار از این تراکنش پشتیبانی نمی‌شود');
    await this.assertVisit(visitId, user, db);
    const kind = dto.kind ?? 'service';
    if (!CHARGE_KINDS.includes(kind as any)) throw new BadRequestException('نوعِ قلم نامعتبر است');

    /* دو نظامِ کد روی فاکتورِ «با کد»: کتابِ ارزش نسبی (رقمی) و کدِ داخلیِ
       مطب (باید تعریف و فعال باشد). منبع روی خودِ قلم می‌ماند تا فاکتور و
       گزارش بدانند این کد را در کدام دفتر باید جست. */
    const serviceCode = dto.serviceCode?.trim() || null;
    let codeSystem: string | null = null;
    if (serviceCode) {
      codeSystem = dto.codeSystem ?? 'book';
      if (codeSystem === 'book' && !/^\d{4,8}$/.test(serviceCode)) {
        throw new BadRequestException('کدِ کتابِ ارزش نسبی باید ۴ تا ۸ رقم باشد');
      }
      if (codeSystem === 'internal') {
        const def = await db.internalCode.findFirst({
          where: { code: { equals: serviceCode, mode: 'insensitive' }, active: true },
        });
        if (!def) throw new BadRequestException('کدِ داخلی تعریف نشده یا غیرفعال است — اول در تعاریف پایه ثبتش کنید');
      }
    }

    // خدمت و تخفیف ذاتاً کالا نیستند، پس اثرِ انبار برایشان بی‌معنی است و
    // به‌جای «خطا بده» بی‌سروصدا virtual می‌شوند — این حالت اشتباهِ کاربر نیست.
    const stockEffect = kind === 'item' ? dto.stockEffect ?? 'virtual' : 'virtual';
    if (!STOCK_EFFECTS.includes(stockEffect as any)) throw new BadRequestException('اثرِ انبار نامعتبر است');

    // این دو شرط، هستهٔ تفکیکِ فاکتور از انبارند:
    // بدونِ اولی، «مصرفی» ثبت می‌شود بی‌آنکه چیزی از انبار کم شود (فاکتورِ
    // کالایی که هیچ‌وقت خارج نشد). بدونِ دومی، «مجازی» ثبت می‌شود ولی کالا
    // خارج می‌شود — و بعداً معلوم نیست کدام‌شان دروغ گفته.
    if (stockEffect === 'consumed' && !dto.lotId) {
      throw new BadRequestException('برای قلمِ مصرفی باید لاتِ انبار انتخاب شود؛ اگر از انبارِ ما خارج نمی‌شود، «مجازی» یا «کالای بیمارستان» را بزنید');
    }
    if (stockEffect !== 'consumed' && dto.lotId) {
      throw new BadRequestException('قلمی که از انبارِ ما کم نمی‌شود نباید لات داشته باشد');
    }

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

    const row = await db.charge.create({
      data: {
        visitId, kind, title, quantity, unitPrice, amount, stockEffect,
        serviceCode, codeSystem,
        itemId: dto.itemId ?? null,
        notes: dto.notes?.trim() || null,
        createdById: user?.id ?? null,
        ...(neuroDetail ? { neuroDetail } : {}),
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
        await db.charge.delete({ where: { id: row.id } });
        throw err;
      }
    }

    await this.audit.record({
      actorId: user?.id, action: 'charge.create', entityType: 'charge', entityId: row.id,
      after: { visitId, title, amount, serviceCode: dto.serviceCode ?? null },
    }, tx);
    return row;
  }

  /**
   * حذفِ قلمِ فاکتور.
   *
   * ⚠️ **حذفِ قلم به‌خودیِ‌خود کالا را به انبار برنمی‌گرداند.** این‌جا قبلاً
   * خودکار حرکتِ `return` زده می‌شد و باگ بود: پیچی که داخلِ بدنِ بیمار است با
   * اصلاحِ یک اشتباهِ تایپی در فاکتور، به موجودی برمی‌گشت.
   *
   * عدم‌تقارن با `addCharge` عمدی است و باید بماند: ساختنِ قلمِ مصرفی ادعا
   * می‌کند «این اتفاق افتاد» — ادعایی که کاربر همان لحظه دارد می‌کند. حذفِ قلمِ
   * فاکتور ادعا نمی‌کند «آن اتفاق نیفتاد»؛ فقط می‌گوید فاکتور غلط بود. برگشتِ
   * فیزیکی سؤالِ دیگری است که فقط کاربر جوابش را دارد، پس `returnStock` صریح
   * خواسته می‌شود و پیش‌فرضش خاموش است.
   *
   * حرکتِ مصرف پاک نمی‌شود (دفتر فقط‌افزودنی است) و `chargeId` روی آن باقی
   * می‌ماند؛ چون رابطهٔ FK ندارد، به قلمِ حذف‌شده اشاره می‌کند و در نمای مغایرت
   * به‌شکلِ «مصرف‌شده بدونِ قلمِ فاکتور» دیده می‌شود — دقیقاً همان چیزی که هست.
   */
  async removeCharge(chargeId: number, user: any, returnStock = false) {
    const row = await this.prisma.charge.findUnique({ where: { id: chargeId } });
    if (!row) throw new NotFoundException('قلمِ صورت‌حساب پیدا نشد');
    await this.assertVisit(row.visitId, user);

    if (returnStock && !await canAccess(this.prisma, user, 'inventory', ['inventory.write'])) throw new BadRequestException('اجازه برگشت موجودی انبار ندارید');
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM visits WHERE id = ${row.visitId} FOR UPDATE`;
      const current = await tx.charge.findUnique({ where: { id: chargeId } });
      if (!current) throw new NotFoundException('قلم قبلاً حذف شده است');
      if (returnStock) await this.inventory.setChargeConsumption(tx, null, 0, row.visitId, chargeId, user, true);
      await tx.charge.delete({ where: { id: chargeId } });
      await tx.auditEvent.create({ data: { actorId: user?.id, action: 'charge.delete', entityType: 'charge', entityId: String(chargeId), beforeJson: JSON.parse(JSON.stringify(current)), afterJson: { returnedToStock: returnStock } } });
    });
    return { ok: true, returnedToStock: returnStock };
  }

  async assertIntakePayment(dto: { amount: number; bankAccountId?: number }) {
    if (!Number.isInteger(dto.amount) || dto.amount <= 0) throw new BadRequestException('مبلغ پرداخت باید عدد صحیح مثبت باشد');
    if (dto.bankAccountId && !await this.prisma.bankAccount.findFirst({ where: { id: dto.bankAccountId, active: true } })) {
      throw new BadRequestException('حساب دریافت فعال نیست یا پیدا نشد');
    }
    await this.treasury.assertOpen(new Date());
  }

  async addPayment(
    visitId: number,
    dto: { amount?: number; method?: string; paidAt?: string; reference?: string; notes?: string; bankAccountId?: number; receivedById?: number },
    user: any,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const visit = await this.assertVisit(visitId, user, db);
    const method = dto.method ?? 'cash';
    if (!PAYMENT_METHODS.includes(method as any)) throw new BadRequestException('روشِ پرداخت نامعتبر است');
    /**
     * قیدِ «حسابِ فاکتور» فقط برای پولی معنا دارد که **از مسیرِ بانک** می‌آید
     * (کارت‌خوان/انتقال/چک): آن پول باید به همان حسابی برسد که فاکتور رویش
     * صادر شده. پرداختِ نقدی و بیمه اصلاً حسابِ بانکی ندارند — تا پیش از این
     * همان قید روی نقدی هم اعمال می‌شد و «حسابِ دریافت: —» با فاکتورِ متصل
     * ۴۰۰ می‌داد، یعنی ثبتِ پولِ نقدی برای فاکتورِ رسمی ناممکن بود.
     * حسابِ ناهم‌خوان اما با هر روشی رد می‌شود — نه فقط برای بانکی‌ها.
     */
    if (visit.invoiceBankAccountId) {
      const routed = BANK_ROUTED_METHODS.includes(method as any);
      if (routed && dto.bankAccountId !== visit.invoiceBankAccountId) {
        throw new BadRequestException('برای پرداختِ کارتی/انتقال/چک، حساب دریافت باید همان حساب متصل به فاکتور باشد');
      }
      if (!routed && dto.bankAccountId && dto.bankAccountId !== visit.invoiceBankAccountId) {
        throw new BadRequestException('حساب دریافت باید همان حساب متصل به فاکتور باشد');
      }
    }
    if (dto.bankAccountId) {
      const bank = await db.bankAccount.findFirst({ where: { id: dto.bankAccountId, active: true } });
      if (!bank || (visit.invoiceType && bank.classification !== visit.invoiceType)) throw new BadRequestException('حساب دریافت با نوع فاکتور سازگار نیست');
    }

    const amount = dto.amount ?? 0;
    if (!Number.isInteger(amount) || amount <= 0) throw new BadRequestException('مبلغِ پرداخت باید عددِ مثبت باشد');

    let paidAt = new Date();
    if (dto.paidAt) {
      const d = new Date(dto.paidAt);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخِ پرداخت معتبر نیست');
      paidAt = d;
    }
    // قفلِ دورهٔ مالی: سندی با تاریخِ داخلِ سالِ بسته‌شده نوشته نمی‌شود.
    await this.treasury.assertOpen(paidAt, tx);

    const row = await db.payment.create({
      data: {
        visitId, amount, method, paidAt,
        bankAccountId: dto.bankAccountId ?? null,
        // شریکِ دریافت‌کننده مبنای بدهیِ بینِ شرکاست؛ خالی یعنی به حسابِ مشترک رفته.
        receivedById: dto.receivedById ?? null,
        reference: dto.reference?.trim() || null,
        notes: dto.notes?.trim() || null,
        createdById: user?.id ?? null,
      },
    });
    await this.audit.record({
      actorId: user?.id, action: 'payment.create', entityType: 'payment', entityId: row.id,
      after: { visitId, amount, method },
    }, tx);
    return row;
  }

  async removePayment(paymentId: number, user: any) {
    const row = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!row) throw new NotFoundException('پرداخت پیدا نشد');
    await this.assertVisit(row.visitId, user);
    await this.treasury.assertOpen(row.paidAt);
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
  pricing?: { pricingModel?: string | null; globalAmount?: number | null },
) {
  const itemsTotal = charges.reduce((s, c) => s + c.amount, 0);
  /* مدلِ «گلوبال»: مبلغِ توافقیِ کل مبناست؛ اقلام فقط برای نمایش ثبت شده‌اند.
     جمعِ اقلام هم برمی‌گردد (`itemsTotal`) تا UI بتواند تفاوت را نشان دهد. */
  const global = pricing?.pricingModel === 'global' && pricing?.globalAmount != null;
  const total = global ? pricing!.globalAmount! : itemsTotal;
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  /* ⚠️ درصد هم **این‌جا** حساب می‌شود، نه در نوارِ پیشرفتِ کارت (قانون ۱۵).
     وسوسه این بود که کلاینت `paid/total*100` بزند — ولی آن‌وقت کارتِ داشبورد،
     صورت‌حساب و فاکتورِ چاپی هرکدام نسخهٔ خودشان را داشتند و تقسیم بر صفر هم
     در هر سه جا جدا باید مهار می‌شد.

     ⚠️ `total === 0` یعنی «هنوز صورت‌حسابی نیست»، نه «صددرصد وصول». صفر
     برمی‌گردد و کارت اصلاً نوار نشان نمی‌دهد؛ اگر ۱۰۰ می‌دادیم، مراجعهٔ
     بی‌فاکتور «تسویه‌شده» به‌نظر می‌رسید. */
  const paidPct = total > 0 ? Math.min(100, Math.max(0, Math.round((paid / total) * 100))) : 0;
  return { total, itemsTotal, paid, due: total - paid, paidPct };
}

type ChargeRow = { id: number; kind: string; title: string; quantity: number; stockEffect: string };
type MoveRow = {
  id: number; lotId: number; kind: string; quantity: number; chargeId: number | null; reason: string | null;
  lot: { lotNo: string | null; serialNo: string | null; item: { name: string } };
};

/**
 * مغایرتِ **فاکتور در برابر مصرف** — دو طرفِ مدلِ دوبخشی کنارِ هم.
 *
 * این نه گزارشِ خطا است نه هشدار؛ نمای واقعیتِ کار است. هر سه دسته می‌توانند
 * کاملاً درست باشند و تصمیم با کاربر است. چیزی که تا حالا نبود، *دیدنشان* بود.
 *
 * مشتق و خالص، مطابقِ قانونِ ۱۷: هیچ render ای اجازه ندارد این تطبیق را
 * دوباره حساب کند، وگرنه دو نسخهٔ واگرا از «مغایرت» خواهیم داشت.
 */
export function reconcile(charges: ChargeRow[], moves: MoveRow[]) {
  const chargeIds = new Set(charges.map((c) => c.id));

  /**
   * گروه‌بندیِ **خالص**، نه شمارشِ خام.
   *
   * خروج منفی است و برگشت مثبت، پس جمعِ صفر یعنی رفت و برگشت — عملاً چیزی
   * مصرف نشده. بدونِ این، قلمی که با «مصرف نشد، برگردد» حذف شده بود همچنان
   * «مصرف‌شده ولی بی‌فاکتور» گزارش می‌شد؛ یعنی گزارشِ مغایرت خودش مغایرتِ
   * جعلی می‌ساخت و کاربر یاد می‌گرفت نادیده‌اش بگیرد.
   *
   * کلیدِ گروه: قلمِ فاکتور اگر باشد، وگرنه خودِ لات — تا مصرف و برگشتِ
   * مستقیمِ انبار (بدونِ فاکتور) هم همدیگر را خنثی کنند.
   */
  const groups = new Map<string, { net: number; first: MoveRow; chargeId: number | null }>();
  for (const m of moves) {
    const key = m.chargeId != null ? `c${m.chargeId}` : `l${m.lotId}`;
    const g = groups.get(key);
    if (g) g.net += m.quantity;
    else groups.set(key, { net: m.quantity, first: m, chargeId: m.chargeId });
  }
  const netByCharge = new Map<number, number>();
  for (const [, g] of groups) if (g.chargeId != null) netByCharge.set(g.chargeId, g.net);

  return {
    /// قلمِ «مصرفی» که خالصِ خروجی ندارد — یا برگشت خورده یا هیچ‌وقت خارج نشد.
    billedNotConsumed: charges
      .filter((c) => c.stockEffect === 'consumed' && (netByCharge.get(c.id) ?? 0) >= 0)
      .map((c) => ({ chargeId: c.id, title: c.title, quantity: c.quantity })),

    /// کالایی که خالصاً از انبار بیرون است ولی قلمِ فاکتوری ندارد (یا قلمش حذف شده).
    consumedNotBilled: [...groups.values()]
      .filter((g) => g.net < 0 && (g.chargeId == null || !chargeIds.has(g.chargeId)))
      .map(({ net, first: m, chargeId }) => ({
        movementId: m.id, lotId: m.lotId, itemName: m.lot.item.name,
        lotNo: m.lot.lotNo, serialNo: m.lot.serialNo,
        quantity: -net, reason: m.reason,
        orphaned: chargeId != null, // قلمش بعداً حذف شده، از اول بی‌فاکتور نبوده
      })),

    /// قلمِ کالا که عمداً از انبارِ ما کم نمی‌شود — مغایرت نیست، تصمیم است.
    offStock: charges
      .filter((c) => c.kind === 'item' && c.stockEffect !== 'consumed')
      .map((c) => ({ chargeId: c.id, title: c.title, quantity: c.quantity, stockEffect: c.stockEffect })),
  };
}
