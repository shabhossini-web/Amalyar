import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export const PAYOUT_PARTIES = ['surgeon', 'tech', 'partner'] as const;
export const CHEQUE_DIRECTIONS = ['in', 'out'] as const;
export const CHEQUE_STATUSES = ['pending', 'cashed', 'bounced', 'cancelled'] as const;

export const CHEQUE_LABELS: Record<string, string> = {
  pending: 'در جریان',
  cashed: 'وصول شد',
  bounced: 'برگشت خورد',
  cancelled: 'باطل',
};

/**
 * خزانه، پرداختِ سهم، چک و قفلِ سالِ مالی.
 *
 * ⚠️ **دفترکلِ دوطرفه (double-entry) عمداً ساخته نشده.** برای شرکتی در این
 * اندازه، هر سؤالی که کاربر واقعاً می‌پرسد — «چقدر در هر حساب داریم»، «به چه
 * کسی چقدر بدهکاریم»، «سهمِ جراح پرداخت شد؟» — از همین جدول‌های مشتق جواب
 * می‌گیرد. دفترکلِ واقعی یک ماژولِ بزرگ با کدینگِ حساب و سندِ حسابداری است که
 * تا وقتی مشتری اظهارنامهٔ رسمی نخواهد، فقط پیچیدگی اضافه می‌کند.
 */
@Injectable()
export class TreasuryService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ─────────────── قفلِ سالِ مالی ───────────────

  years() {
    return this.prisma.fiscalYear.findMany({ orderBy: { startsAt: 'desc' } });
  }

  async addYear(dto: any, user: any) {
    const title = String(dto.title ?? '').trim();
    if (title.length < 2) throw new BadRequestException('عنوانِ سال را وارد کنید');
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('تاریخِ شروع/پایان نامعتبر است');
    }
    if (endsAt <= startsAt) throw new BadRequestException('پایانِ سال باید بعد از شروعش باشد');
    // همپوشانی مسدود می‌شود: دو سالِ مالیِ همپوشان یعنی یک سند در دو دوره
    // می‌افتد و بستنِ یکی، سندِ دیگری را هم قفل می‌کند.
    const clash = await this.prisma.fiscalYear.findFirst({
      where: { startsAt: { lte: endsAt }, endsAt: { gte: startsAt } },
      select: { title: true },
    });
    if (clash) throw new BadRequestException(`با سالِ «${clash.title}» همپوشانی دارد`);

    const row = await this.prisma.fiscalYear.create({ data: { title, startsAt, endsAt } });
    await this.audit.record({ actorId: user?.id, action: 'fiscal.create', entityType: 'fiscal_year', entityId: row.id, after: row });
    return row;
  }

  async setYearClosed(id: number, closed: boolean, user: any) {
    const row = await this.prisma.fiscalYear.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('سالِ مالی یافت نشد');
    const updated = await this.prisma.fiscalYear.update({
      where: { id },
      data: { closedAt: closed ? new Date() : null, closedById: closed ? user?.id ?? null : null },
    });
    await this.audit.record({
      actorId: user?.id, action: closed ? 'fiscal.close' : 'fiscal.reopen',
      entityType: 'fiscal_year', entityId: id, after: { closedAt: updated.closedAt },
    });
    return updated;
  }

  /**
   * نگهبانِ دوره — قبل از هر نوشتنِ مالی صدا زده می‌شود.
   *
   * بی‌سروصدا رد نمی‌کند بلکه خطای گویا می‌دهد: کاربری که تاریخِ اشتباه زده باید
   * بفهمد چرا، وگرنه فکر می‌کند سامانه خراب است.
   */
  async assertOpen(when: Date | null | undefined, db: any = this.prisma) {
    if (!when) return;
    const closed = await db.fiscalYear.findFirst({
      where: { closedAt: { not: null }, startsAt: { lte: when }, endsAt: { gte: when } },
      select: { title: true },
    });
    if (closed) {
      throw new BadRequestException(`سالِ مالیِ «${closed.title}» بسته شده است؛ سندی با این تاریخ ثبت یا حذف نمی‌شود`);
    }
  }

  // ─────────────── پرداختِ سهم ───────────────

  /**
   * وضعیتِ پرداختِ سهم‌های یک مراجعه.
   *
   * «استحقاق» از تسویهٔ **جاری** می‌آید و «پرداخت‌شده» از دفترِ پرداخت‌ها؛ مانده
   * مشتق است. عمداً روی ShareEntry ذخیره نمی‌شود: تسویه با هر محاسبهٔ دوباره
   * نسخهٔ تازه می‌گیرد و آن‌وقت «پرداخت‌شده» با آن پاک می‌شد.
   */
  async payoutsFor(visitId: number) {
    const [settlement, payouts] = await Promise.all([
      this.prisma.settlement.findFirst({
        where: { visitId, supersededAt: null },
        orderBy: { version: 'desc' },
        include: { entries: true },
      }),
      this.prisma.payout.findMany({
        where: { visitId }, orderBy: { paidAt: 'desc' },
        include: { bankAccount: { select: { ownerName: true } } },
      }),
    ]);

    const key = (party: string, id: number | null) => `${party}:${id ?? 0}`;
    const paidOf = new Map<string, number>();
    for (const p of payouts) paidOf.set(key(p.party, p.partyId), (paidOf.get(key(p.party, p.partyId)) ?? 0) + p.amount);

    const rows = (settlement?.entries ?? [])
      .filter((e) => e.party !== 'cost')
      .map((e) => {
        const paid = paidOf.get(key(e.party, e.partyId)) ?? 0;
        return {
          party: e.party, partyId: e.partyId, partyName: e.partyName,
          entitled: e.amount, paid, remaining: e.amount - paid,
        };
      });

    return {
      settlementStatus: settlement?.status ?? null,
      rows,
      payouts: payouts.map((p) => ({
        id: p.id, party: p.party, partyName: p.partyName, amount: p.amount,
        paidAt: p.paidAt, reference: p.reference,
        bankAccountName: p.bankAccount?.ownerName ?? null,
      })),
      totals: {
        entitled: rows.reduce((s, r) => s + r.entitled, 0),
        paid: rows.reduce((s, r) => s + r.paid, 0),
        remaining: rows.reduce((s, r) => s + r.remaining, 0),
      },
    };
  }

  async addPayout(visitId: number, dto: any, user: any) {
    const visit = await this.prisma.visit.findUnique({ where: { id: visitId }, select: { id: true } });
    if (!visit) throw new NotFoundException('مراجعه پیدا نشد');
    if (!PAYOUT_PARTIES.includes(dto.party)) throw new BadRequestException('طرفِ پرداخت نامعتبر است');
    const amount = Number(dto.amount);
    if (!Number.isInteger(amount) || amount <= 0) throw new BadRequestException('مبلغ باید عددِ مثبت باشد');

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) throw new BadRequestException('تاریخِ پرداخت نامعتبر است');
    await this.assertOpen(paidAt);

    // ⚠️ تسویهٔ نهایی‌نشده یعنی عددِ سهم هنوز قطعی نیست؛ پرداخت روی عددِ موقت
    // بعداً به مغایرتِ دائمی تبدیل می‌شود.
    const s = await this.prisma.settlement.findFirst({
      where: { visitId, supersededAt: null }, select: { status: true },
    });
    if (s?.status !== 'final') {
      throw new BadRequestException('تا تسویهٔ این مراجعه نهایی نشده، پرداختِ سهم ثبت نمی‌شود');
    }

    const row = await this.prisma.payout.create({
      data: {
        visitId, party: dto.party,
        partyId: dto.partyId ? Number(dto.partyId) : null,
        partyName: String(dto.partyName ?? '').trim() || '—',
        amount, paidAt,
        bankAccountId: dto.bankAccountId ? Number(dto.bankAccountId) : null,
        reference: text(dto.reference), notes: text(dto.notes),
        createdById: user?.id ?? null,
      },
    });
    await this.audit.record({
      actorId: user?.id, action: 'payout.create', entityType: 'payout', entityId: row.id,
      after: { visitId, party: dto.party, amount },
    });
    return this.payoutsFor(visitId);
  }

  async removePayout(id: number, user: any) {
    const row = await this.prisma.payout.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('پرداخت یافت نشد');
    await this.assertOpen(row.paidAt);
    await this.prisma.payout.delete({ where: { id } });
    await this.audit.record({ actorId: user?.id, action: 'payout.delete', entityType: 'payout', entityId: id, before: row });
    return this.payoutsFor(row.visitId);
  }

  // ─────────────── چک ───────────────

  async cheques(opts: { status?: string; direction?: string } = {}) {
    const rows = await this.prisma.cheque.findMany({
      where: { ...(opts.status ? { status: opts.status } : {}), ...(opts.direction ? { direction: opts.direction } : {}) },
      orderBy: [{ dueAt: 'asc' }, { id: 'desc' }],
      take: 300,
      include: { bankAccount: { select: { ownerName: true } } },
    });
    const soon = new Date();
    soon.setDate(soon.getDate() + 7);
    return {
      rows: rows.map((c) => ({
        id: c.id, number: c.number, bankName: c.bankName, amount: c.amount, dueAt: c.dueAt,
        direction: c.direction, partyName: c.partyName,
        status: c.status, statusLabel: CHEQUE_LABELS[c.status] ?? c.status,
        bankAccountName: c.bankAccount?.ownerName ?? null,
        /// «نزدیکِ سررسید» مشتق است نه ستون — وگرنه هر روز باید به‌روز شود.
        dueSoon: c.status === 'pending' && c.dueAt <= soon,
        notes: c.notes,
      })),
      // جمع‌ها فقط روی چکِ در جریان: چکِ وصول‌شده دیگر تعهد نیست.
      pendingIn: rows.filter((c) => c.status === 'pending' && c.direction === 'in').reduce((s, c) => s + c.amount, 0),
      pendingOut: rows.filter((c) => c.status === 'pending' && c.direction === 'out').reduce((s, c) => s + c.amount, 0),
    };
  }

  async addCheque(dto: any, user: any) {
    const number = String(dto.number ?? '').trim();
    if (number.length < 2) throw new BadRequestException('شمارهٔ چک را وارد کنید');
    if (!CHEQUE_DIRECTIONS.includes(dto.direction)) throw new BadRequestException('جهتِ چک نامعتبر است');
    const amount = Number(dto.amount);
    if (!Number.isInteger(amount) || amount <= 0) throw new BadRequestException('مبلغ باید عددِ مثبت باشد');
    const dueAt = new Date(dto.dueAt);
    if (Number.isNaN(dueAt.getTime())) throw new BadRequestException('تاریخِ سررسید نامعتبر است');

    const row = await this.prisma.cheque.create({
      data: {
        number, amount, dueAt, direction: dto.direction,
        bankName: text(dto.bankName),
        partyName: String(dto.partyName ?? '').trim() || '—',
        bankAccountId: dto.bankAccountId ? Number(dto.bankAccountId) : null,
        visitId: dto.visitId ? Number(dto.visitId) : null,
        notes: text(dto.notes),
        createdById: user?.id ?? null,
      },
    });
    await this.audit.record({ actorId: user?.id, action: 'cheque.create', entityType: 'cheque', entityId: row.id, after: row });
    return row;
  }

  async setChequeStatus(id: number, status: string, user: any) {
    if (!CHEQUE_STATUSES.includes(status as any)) throw new BadRequestException('وضعیتِ چک نامعتبر است');
    const row = await this.prisma.cheque.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('چک یافت نشد');
    const updated = await this.prisma.cheque.update({ where: { id }, data: { status, statusAt: new Date() } });
    await this.audit.record({
      actorId: user?.id, action: 'cheque.status', entityType: 'cheque', entityId: id,
      before: { status: row.status }, after: { status },
    });
    return updated;
  }

  // ─────────────── خزانه ───────────────

  /**
   * موجودیِ هر حساب — **مشتق**، نه ستونِ ذخیره‌شده.
   *
   * همان استدلالِ `balanceOf` انبار: عددِ ذخیره‌شده دیر یا زود از ردیف‌هایش جدا
   * می‌افتد. ورودی = پرداختِ بیمار؛ خروجی = هزینه و پرداختِ سهم.
   *
   * ⚠️ چکِ در جریان **در موجودی نمی‌آید** و جدا گزارش می‌شود: پولی که هنوز
   * وصول نشده، پول نیست.
   */
  async treasury() {
    const [accounts, payIn, expOut, payoutOut, chq] = await Promise.all([
      this.prisma.bankAccount.findMany({ where: { active: true }, orderBy: { id: 'asc' } }),
      this.prisma.payment.groupBy({ by: ['bankAccountId'], _sum: { amount: true } }),
      this.prisma.expense.groupBy({ by: ['bankAccountId'], _sum: { amount: true } }),
      this.prisma.payout.groupBy({ by: ['bankAccountId'], _sum: { amount: true } }),
      this.cheques({ status: 'pending' }),
    ]);
    const sum = (rows: any[], id: number | null) => rows.find((r) => r.bankAccountId === id)?._sum.amount ?? 0;

    const rows = accounts.map((a) => {
      const inAmt = sum(payIn, a.id);
      const outAmt = sum(expOut, a.id) + sum(payoutOut, a.id);
      return { id: a.id, ownerName: a.ownerName, bankName: a.bankName, in: inAmt, out: outAmt, balance: inAmt - outAmt };
    });
    // اسنادی که حسابشان ثبت نشده: پنهان‌کردنشان یعنی جمعِ خزانه با واقعیت
    // نمی‌خواند و کسی نمی‌فهمد چرا.
    const unassigned = {
      in: sum(payIn, null),
      out: sum(expOut, null) + sum(payoutOut, null),
    };
    return {
      accounts: rows,
      unassigned: { ...unassigned, balance: unassigned.in - unassigned.out },
      total: rows.reduce((s, r) => s + r.balance, 0) + (unassigned.in - unassigned.out),
      chequesPendingIn: chq.pendingIn,
      chequesPendingOut: chq.pendingOut,
    };
  }
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() || null : null);
