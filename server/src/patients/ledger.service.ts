import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TreasuryService } from './treasury.service';

export const LEDGER_TYPES = ['profit_share', 'expense_paid', 'settlement'] as const;
export const LEDGER_LABELS: Record<string, string> = {
  profit_share: 'سهمِ سود',
  expense_paid: 'هزینهٔ پرداختی',
  settlement: 'تسویهٔ نقدی',
};

type Delta = { partnerId: number; name: string; delta: number };

/**
 * تبدیلِ «چه کسی چقدر بیش/کم از سهمش دارد» به بدهیِ دوطرفه.
 *
 * ورودی: اختلافِ هر شریک (مثبت = بیشتر از سهمش در دست دارد، منفی = طلبکار).
 * خروجی: کم‌ترین تعدادِ ردیفِ ممکن، با تطبیقِ طمعانه — بدهکارِ بزرگ به طلبکارِ
 * بزرگ. جمعِ مثبت‌ها همیشه برابرِ جمعِ منفی‌هاست، پس الگوریتم همیشه تمام می‌شود.
 *
 * خالص و بیرونِ کلاس، چون هم موقعِ نهایی‌شدنِ تسویه لازم است هم موقعِ ثبتِ هزینه،
 * و دو پیاده‌سازیِ متفاوت یعنی دو تعریفِ متفاوت از بدهی.
 */
export function pairDebts(deltas: Delta[]): { fromId: number; fromName: string; toId: number; toName: string; amount: number }[] {
  const debtors = deltas.filter((d) => d.delta > 0).map((d) => ({ ...d })).sort((a, b) => b.delta - a.delta);
  const creditors = deltas.filter((d) => d.delta < 0).map((d) => ({ ...d, delta: -d.delta })).sort((a, b) => b.delta - a.delta);
  const out: { fromId: number; fromName: string; toId: number; toName: string; amount: number }[] = [];
  let i = 0;
  let k = 0;
  while (i < debtors.length && k < creditors.length) {
    const amount = Math.min(debtors[i].delta, creditors[k].delta);
    if (amount > 0) {
      out.push({
        fromId: debtors[i].partnerId, fromName: debtors[i].name,
        toId: creditors[k].partnerId, toName: creditors[k].name,
        amount,
      });
    }
    debtors[i].delta -= amount;
    creditors[k].delta -= amount;
    if (debtors[i].delta === 0) i += 1;
    if (creditors[k].delta === 0) k += 1;
  }
  return out;
}

/**
 * هزینه‌ها، حساب‌های بانکی و دفترِ حسابِ جاریِ شرکا.
 *
 * چرا دفترِ جدا از `ShareEntry`: آن می‌گوید سهمِ هر شریک از یک عمل **چقدر
 * است**، این می‌گوید چون پول به حسابِ یکی رفت یا هزینه را یکی داد، **چه کسی
 * به چه کسی بدهکار شد**. شرکتی که دو حسابِ شخصی دارد بدونِ دومی قابلِ اداره
 * نیست — و ملک‌طب هم دقیقاً همین جدول را داشت.
 */
@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService, private audit: AuditService, private treasury: TreasuryService) {}

  // ─────────────── حساب‌های بانکی ───────────────

  accounts(all = false) {
    return this.prisma.bankAccount.findMany({
      where: all ? {} : { active: true },
      orderBy: { id: 'asc' },
      include: { partner: { select: { id: true, name: true } } },
    });
  }

  async addAccount(dto: any, user: any) {
    const ownerName = String(dto.ownerName ?? '').trim();
    if (ownerName.length < 2) throw new BadRequestException('نامِ صاحبِ حساب کوتاه است');
    const row = await this.prisma.bankAccount.create({
      data: {
        ownerName,
        bankName: text(dto.bankName), cardNumber: text(dto.cardNumber), iban: text(dto.iban),
        partnerId: dto.partnerId ? Number(dto.partnerId) : null,
        showOnIntake: !!dto.showOnIntake,
        notes: text(dto.notes),
      },
    });
    await this.audit.record({ actorId: user?.id, action: 'bank.create', entityType: 'bank_account', entityId: row.id, after: row });
    return row;
  }

  /**
   * تغییرِ «روی فرمِ ثبت‌نام نشان داده شود».
   *
   * ⚠️ جدا از ساخت و **در `audit`**: این کلید یک شمارهٔ حساب را روی نشانیِ
   * عمومی می‌برد؛ تغییری که رد نگذارد یعنی فردا کسی نداند چه کسی و کِی
   * حسابِ شخصی را عمومی کرد.
   */
  async setAccountPublic(id: number, showOnIntake: boolean, user: any) {
    const row = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('حساب یافت نشد');
    const next = await this.prisma.bankAccount.update({ where: { id }, data: { showOnIntake } });
    await this.audit.record({
      actorId: user?.id, action: 'bank.public', entityType: 'bank_account', entityId: id,
      before: { showOnIntake: row.showOnIntake }, after: { showOnIntake },
    });
    return next;
  }

  async disableAccount(id: number, user: any) {
    const row = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('حساب یافت نشد');
    // غیرفعال، نه حذف: پرداخت‌ها و هزینه‌های گذشته به آن ارجاع دارند.
    await this.prisma.bankAccount.update({ where: { id }, data: { active: false } });
    await this.audit.record({ actorId: user?.id, action: 'bank.disable', entityType: 'bank_account', entityId: id });
    return { ok: true };
  }

  // ─────────────── هزینه‌ها ───────────────

  async expenses(opts: { from?: Date; to?: Date; category?: string } = {}) {
    const where: any = {};
    if (opts.from || opts.to) where.spentAt = { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) };
    if (opts.category) where.category = opts.category;
    const rows = await this.prisma.expense.findMany({
      where, orderBy: [{ spentAt: 'desc' }, { id: 'desc' }], take: 500,
      include: { bankAccount: { select: { ownerName: true } }, paidBy: { select: { id: true, name: true } } },
    });
    return {
      rows: rows.map((e) => ({
        id: e.id, title: e.title, category: e.category, amount: e.amount, spentAt: e.spentAt,
        bankAccountName: e.bankAccount?.ownerName ?? null,
        paidById: e.paidById, paidByName: e.paidBy?.name ?? null,
        notes: e.notes,
      })),
      total: rows.reduce((s, e) => s + e.amount, 0),
    };
  }

  /**
   * ثبتِ هزینه.
   *
   * اگر شریکی از جیبِ خودش داده باشد، همین‌جا بدهیِ بقیه به او ثبت می‌شود —
   * وگرنه کاربر باید دستی یادش بماند و همان‌جاست که حسابِ جاری از دست می‌رود.
   */
  async addExpense(dto: any, user: any) {
    const title = String(dto.title ?? '').trim();
    if (title.length < 2) throw new BadRequestException('عنوانِ هزینه کوتاه است');
    const amount = Number(dto.amount);
    if (!Number.isInteger(amount) || amount <= 0) throw new BadRequestException('مبلغِ هزینه باید عددِ مثبت باشد');
    const spentAt = dto.spentAt ? new Date(dto.spentAt) : new Date();
    if (Number.isNaN(spentAt.getTime())) throw new BadRequestException('تاریخِ هزینه نامعتبر است');
    await this.treasury.assertOpen(spentAt);

    const created = await this.prisma.expense.create({
      data: {
        title, amount, spentAt,
        category: text(dto.category), notes: text(dto.notes),
        bankAccountId: dto.bankAccountId ? Number(dto.bankAccountId) : null,
        paidById: dto.paidById ? Number(dto.paidById) : null,
        createdById: user?.id ?? null,
      },
    });

    if (created.paidById) await this.ledgerForExpense(created, user);

    await this.audit.record({
      actorId: user?.id, action: 'expense.create', entityType: 'expense', entityId: created.id,
      after: { title, amount, paidById: created.paidById },
    });
    return created;
  }

  async removeExpense(id: number, user: any) {
    const row = await this.prisma.expense.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('هزینه یافت نشد');
    await this.treasury.assertOpen(row.spentAt);
    await this.prisma.$transaction(async (tx) => {
      // ردیف‌های دفتر باطل می‌شوند نه پاک — همان قاعدهٔ فقط‌افزودنی.
      await tx.partnerLedger.updateMany({
        where: { expenseId: id, voidedAt: null },
        data: { voidedAt: new Date() },
      });
      await tx.expense.delete({ where: { id } });
    });
    await this.audit.record({ actorId: user?.id, action: 'expense.delete', entityType: 'expense', entityId: id, before: row });
    return { ok: true };
  }

  /** هزینه‌ای که یک شریک داد → بقیه به‌اندازهٔ درصدشان به او بدهکارند. */
  private async ledgerForExpense(e: { id: number; title: string; amount: number; spentAt: Date; paidById: number | null }, user: any) {
    const partners = await this.prisma.partner.findMany({ where: { active: true }, orderBy: { id: 'asc' } });
    const payer = partners.find((p) => p.id === e.paidById);
    if (!payer) return;
    const rows = partners
      .filter((p) => p.id !== payer.id && p.percent > 0)
      .map((p) => ({
        entryType: 'expense_paid',
        fromPartnerId: p.id, fromName: p.name,
        toPartnerId: payer.id, toName: payer.name,
        amount: Math.round((e.amount * p.percent) / 100),
        expenseId: e.id,
        description: `سهمِ ${p.percent}٪ از «${e.title}»`,
        entryDate: e.spentAt,
        createdById: user?.id ?? null,
      }))
      .filter((r) => r.amount > 0);
    if (rows.length) await this.prisma.partnerLedger.createMany({ data: rows });
  }

  // ─────────────── دفترِ حسابِ جاری ───────────────

  /**
   * بدهیِ ناشی از یک تسویهٔ نهایی‌شده.
   *
   * منطق: نقدی که هر شریک **واقعاً** گرفته با سهمی که **استحقاق** دارد مقایسه
   * می‌شود. چون ممکن است بخشی از فاکتور هنوز وصول نشده باشد، سهمِ استحقاقی به
   * نسبتِ نقدِ وصول‌شده کوچک می‌شود — وگرنه شریکی که پولش را نگرفته بدهکار
   * شمرده می‌شود.
   */
  async ledgerForSettlement(settlementId: number, user: any) {
    const s = await this.prisma.settlement.findUnique({
      where: { id: settlementId },
      include: { entries: true, visit: { select: { id: true, seq: true, patient: { select: { code: true } } } } },
    });
    if (!s) return [];

    const payments = await this.prisma.payment.findMany({
      where: { visitId: s.visitId },
      select: { amount: true, receivedById: true },
    });
    const cash = payments.reduce((t, p) => t + p.amount, 0);
    if (!cash) return []; // هنوز پولی نیامده، بدهی‌ای هم بینِ شرکا نیست

    const shares = s.entries.filter((e) => e.party === 'partner' && e.partyId);
    const totalShare = shares.reduce((t, e) => t + e.amount, 0);
    if (totalShare <= 0) return [];

    const receivedOf = new Map<number, number>();
    for (const p of payments) {
      if (p.receivedById) receivedOf.set(p.receivedById, (receivedOf.get(p.receivedById) ?? 0) + p.amount);
    }
    // نقدی که به حسابِ مشترک رفته (receivedById خالی) بینِ شرکا بدهی نمی‌سازد،
    // پس از هر دو طرفِ مقایسه بیرون می‌ماند.
    const personal = [...receivedOf.values()].reduce((t, v) => t + v, 0);
    if (!personal) return [];

    const deltas: Delta[] = shares.map((e) => ({
      partnerId: e.partyId!,
      name: e.partyName,
      delta: (receivedOf.get(e.partyId!) ?? 0) - Math.round((personal * e.amount) / totalShare),
    }));

    const visitCode = `${s.visit.patient.code}-V${s.visit.seq}`;
    const rows = pairDebts(deltas).map((d) => ({
      entryType: 'profit_share',
      fromPartnerId: d.fromId, fromName: d.fromName,
      toPartnerId: d.toId, toName: d.toName,
      amount: d.amount,
      visitId: s.visitId, visitCode, settlementId: s.id,
      description: `مازادِ دریافتِ نقدیِ ${visitCode}`,
      entryDate: new Date(),
      createdById: user?.id ?? null,
    }));
    if (rows.length) await this.prisma.partnerLedger.createMany({ data: rows });
    return rows;
  }

  /** ابطالِ ردیف‌های یک تسویه — وقتی تسویه باطل یا دوباره محاسبه می‌شود. */
  async voidForSettlement(settlementId: number) {
    await this.prisma.partnerLedger.updateMany({
      where: { settlementId, voidedAt: null },
      data: { voidedAt: new Date() },
    });
  }

  /**
   * خلاصهٔ حسابِ جاری — خالصِ هر جفت شریک.
   *
   * ناخالصِ دو جهت جدا جمع می‌شود و بعد خالص می‌گیریم: نمایشِ «الف ۵ به ب
   * بدهکار، ب ۳ به الف بدهکار» برای کاربر بی‌معنی است؛ او می‌خواهد بداند
   * «الف ۲ به ب بدهکار است».
   */
  async summary() {
    const rows = await this.prisma.partnerLedger.findMany({
      where: { status: 'open', voidedAt: null },
      select: { fromPartnerId: true, fromName: true, toPartnerId: true, toName: true, amount: true },
    });
    const gross = new Map<string, number>();
    const names = new Map<number, string>();
    for (const r of rows) {
      names.set(r.fromPartnerId, r.fromName);
      names.set(r.toPartnerId, r.toName);
      const key = `${r.fromPartnerId}>${r.toPartnerId}`;
      gross.set(key, (gross.get(key) ?? 0) + r.amount);
    }
    const done = new Set<string>();
    const pairs: { fromId: number; fromName: string; toId: number; toName: string; amount: number }[] = [];
    for (const key of gross.keys()) {
      const [a, b] = key.split('>').map(Number);
      const rev = `${b}>${a}`;
      if (done.has(key) || done.has(rev)) continue;
      done.add(key); done.add(rev);
      const net = (gross.get(key) ?? 0) - (gross.get(rev) ?? 0);
      if (net === 0) continue;
      pairs.push(net > 0
        ? { fromId: a, fromName: names.get(a)!, toId: b, toName: names.get(b)!, amount: net }
        : { fromId: b, fromName: names.get(b)!, toId: a, toName: names.get(a)!, amount: -net });
    }
    return { pairs, openCount: rows.length };
  }

  async entries(opts: { status?: string } = {}) {
    const rows = await this.prisma.partnerLedger.findMany({
      where: { voidedAt: null, ...(opts.status ? { status: opts.status } : {}) },
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
      take: 300,
    });
    return rows.map((r) => ({ ...r, typeLabel: LEDGER_LABELS[r.entryType] ?? r.entryType }));
  }

  /**
   * ثبتِ تسویهٔ نقدیِ بینِ دو شریک.
   *
   * ردیفِ معکوس اضافه می‌شود (نه بستنِ ردیف‌های قبلی): ممکن است مبلغِ پرداختی
   * با بدهی برابر نباشد، و «نصفِ بدهی را دادم» باید همان‌طور در دفتر بماند.
   */
  async settle(dto: any, user: any) {
    const fromId = Number(dto.fromPartnerId);
    const toId = Number(dto.toPartnerId);
    const amount = Number(dto.amount);
    if (fromId === toId) throw new BadRequestException('پرداخت‌کننده و دریافت‌کننده یکی است');
    if (!Number.isInteger(amount) || amount <= 0) throw new BadRequestException('مبلغ باید عددِ مثبت باشد');

    const partners = await this.prisma.partner.findMany({ where: { id: { in: [fromId, toId] } } });
    const from = partners.find((p) => p.id === fromId);
    const to = partners.find((p) => p.id === toId);
    if (!from || !to) throw new NotFoundException('شریک یافت نشد');

    const row = await this.prisma.partnerLedger.create({
      data: {
        entryType: 'settlement',
        // جهت معکوسِ بدهی است: پرداخت‌کننده بستانکار می‌شود و بدهی خنثی می‌گردد.
        fromPartnerId: to.id, fromName: to.name,
        toPartnerId: from.id, toName: from.name,
        amount,
        description: text(dto.description) ?? `تسویهٔ نقدیِ ${from.name} به ${to.name}`,
        entryDate: dto.entryDate ? new Date(dto.entryDate) : new Date(),
        createdById: user?.id ?? null,
      },
    });
    await this.audit.record({
      actorId: user?.id, action: 'ledger.settle', entityType: 'partner_ledger', entityId: row.id,
      after: { fromId, toId, amount },
    });
    return row;
  }
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() || null : null);
