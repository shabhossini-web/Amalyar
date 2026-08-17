import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isEarned } from './revenue';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from './ledger.service';

export const CONTRACT_KINDS = ['percent', 'fixed'] as const;
export const PAYERS = ['patient', 'hospital'] as const;

export const PARTY_LABELS: Record<string, string> = {
  surgeon: 'جراح',
  tech: 'کارشناس',
  partner: 'سهامدار',
  cost: 'هزینهٔ کیس',
};

type Contract = { kind: string; percent: number | null; amount: number | null };
type PartnerRow = { id: number; name: string; percent: number };

export type SettlementInput = {
  revenue: number;
  cost: number;
  surgeon: { id: number | null; name: string; contract: Contract | null } | null;
  tech: { id: number | null; name: string; fee: number | null } | null;
  partners: PartnerRow[];
};

export type ComputedEntry = {
  party: string;
  partyId: number | null;
  partyName: string;
  amount: number;
  basis: any;
};

/**
 * تقسیمِ سهمِ یک مراجعه — **تنها فرمولِ تقسیم در کلِ برنامه**.
 *
 * خالص و بیرونِ کلاس، همان دلیلِ `summarize` و `balanceOf`: پیش‌نمایشِ UI،
 * ذخیرهٔ تسویه و هر گزارشِ بعدی باید دقیقاً یک عدد بدهند. در ملک‌طب همین فرمول
 * در چند render تکرار شده بود و اضافه‌کردنِ یک شریکِ سوم یعنی پیداکردنِ همهٔ
 * تکرارها.
 *
 * ترتیب عمدی است و ترتیبِ واقعیِ پول است:
 *   ۱) سهمِ جراح از **درآمدِ ناخالص** برداشته می‌شود (قراردادش با کلِ فاکتور است،
 *      نه با آنچه از هزینه‌ها باقی می‌ماند).
 *   ۲) دستمزدِ کارشناس مبلغِ ثابتِ خودش است.
 *   ۳) هزینهٔ کیس کم می‌شود.
 *   ۴) هرچه ماند بینِ سهامداران به نسبتِ درصدشان.
 *
 * **ثابتِ نگهبان:** جمعِ همهٔ ردیف‌ها همیشه دقیقاً برابرِ `revenue` است. ردیف‌ها
 * «پول کجا رفت» را می‌گویند، پس هزینه هم مثبت است نه منفی — هزینه سهمی از
 * درآمد است که به تأمین‌کننده رفته، نه کسری از جمع. (اول منفی نوشته شده بود و
 * همان‌جا checksum برابرِ `revenue - 2×cost` می‌شد؛ یعنی خودِ ثابتِ نگهبان
 * می‌شکست و کسی متوجه نمی‌شد.)
 *
 * باقی‌ماندهٔ گِردکردن عمداً به آخرین شریک داده می‌شود تا هیچ ریالی گم نشود.
 */
export function computeShares(input: SettlementInput): ComputedEntry[] {
  const out: ComputedEntry[] = [];
  const revenue = input.revenue;

  let surgeonAmount = 0;
  if (input.surgeon?.contract) {
    const c = input.surgeon.contract;
    surgeonAmount = c.kind === 'percent'
      ? Math.round((revenue * (c.percent ?? 0)) / 100)
      : c.amount ?? 0;
    out.push({
      party: 'surgeon', partyId: input.surgeon.id, partyName: input.surgeon.name,
      amount: surgeonAmount,
      basis: c.kind === 'percent'
        ? { kind: 'percent', percent: c.percent, of: revenue }
        : { kind: 'fixed', amount: c.amount },
    });
  }

  let techAmount = 0;
  if (input.tech && input.tech.fee) {
    techAmount = input.tech.fee;
    out.push({
      party: 'tech', partyId: input.tech.id, partyName: input.tech.name,
      amount: techAmount, basis: { kind: 'fixed', amount: input.tech.fee },
    });
  }

  if (input.cost) {
    out.push({ party: 'cost', partyId: null, partyName: 'هزینهٔ کیس', amount: input.cost, basis: { kind: 'cost' } });
  }

  const remainder = revenue - surgeonAmount - techAmount - input.cost;
  const active = input.partners.filter((p) => p.percent > 0);
  let given = 0;
  active.forEach((p, i) => {
    // آخرین شریک باقی‌مانده را می‌گیرد؛ وگرنه گِردکردنِ درصدها چند تومان گم می‌کند.
    const amount = i === active.length - 1 ? remainder - given : Math.round((remainder * p.percent) / 100);
    given += amount;
    out.push({
      party: 'partner', partyId: p.id, partyName: p.name,
      amount, basis: { kind: 'percent', percent: p.percent, of: remainder },
    });
  });

  return out;
}

/**
 * حسابداری — تقسیمِ سهم.
 *
 * چرا ماژولِ جدا از `billing`: صورت‌حساب می‌گوید «بیمار چقدر بدهکار است»،
 * تسویه می‌گوید «این پول بینِ چه کسانی تقسیم می‌شود». دو سؤالِ متفاوت با دو
 * مخاطبِ متفاوت، و مجوزهایشان هم باید جدا باشد.
 */
@Injectable()
export class SettlementService {
  constructor(private prisma: PrismaService, private audit: AuditService, private ledger: LedgerService) {}

  // ─────────────── قراردادِ جراح ───────────────

  async contracts(surgeonId?: number) {
    return this.prisma.surgeonContract.findMany({
      where: surgeonId ? { surgeonId } : {},
      orderBy: [{ surgeonId: 'asc' }, { effectiveFrom: 'desc' }],
      include: { surgeon: { include: { person: { select: { firstName: true, lastName: true } } } } },
    }).then((rows) => rows.map((r) => ({
      id: r.id, surgeonId: r.surgeonId,
      surgeonName: `${r.surgeon.person.firstName} ${r.surgeon.person.lastName}`.trim(),
      kind: r.kind, percent: r.percent, amount: r.amount,
      effectiveFrom: r.effectiveFrom, active: r.active, notes: r.notes,
    })));
  }

  async addContract(dto: any, user: any) {
    const surgeon = await this.prisma.surgeon.findUnique({ where: { id: Number(dto.surgeonId) } });
    if (!surgeon) throw new NotFoundException('جراح یافت نشد');
    const kind = dto.kind;
    if (!CONTRACT_KINDS.includes(kind)) throw new BadRequestException('نوعِ قرارداد نامعتبر است');

    if (kind === 'percent') {
      const p = Number(dto.percent);
      if (!Number.isInteger(p) || p < 0 || p > 100) throw new BadRequestException('درصد باید عددِ صحیحِ بینِ ۰ تا ۱۰۰ باشد');
    } else {
      const a = Number(dto.amount);
      if (!Number.isInteger(a) || a < 0) throw new BadRequestException('مبلغ باید عددِ صحیحِ نامنفی باشد');
    }

    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();
    if (Number.isNaN(effectiveFrom.getTime())) throw new BadRequestException('تاریخِ شروع نامعتبر است');

    const row = await this.prisma.surgeonContract.create({
      data: {
        surgeonId: surgeon.id, kind,
        percent: kind === 'percent' ? Number(dto.percent) : null,
        amount: kind === 'fixed' ? Number(dto.amount) : null,
        effectiveFrom,
        notes: typeof dto.notes === 'string' ? dto.notes.trim() || null : null,
        createdById: user?.id ?? null,
      },
    });
    await this.audit.record({
      actorId: user?.id, action: 'contract.create', entityType: 'surgeon_contract', entityId: row.id,
      after: { surgeonId: surgeon.id, kind, percent: row.percent, amount: row.amount },
    });
    return row;
  }

  /**
   * قراردادِ معتبر در یک تاریخ.
   *
   * ⚠️ نزدیک‌ترین قراردادی که **قبل از** تاریخِ عمل شروع شده، نه آخرین قرارداد.
   * تفاوتشان همان تفاوتِ «عملِ پارسال با قراردادِ پارسال» و «با قراردادِ امسال» است.
   */
  async contractAt(surgeonId: number, when: Date): Promise<Contract | null> {
    const row = await this.prisma.surgeonContract.findFirst({
      where: { surgeonId, active: true, effectiveFrom: { lte: when } },
      orderBy: { effectiveFrom: 'desc' },
      select: { kind: true, percent: true, amount: true },
    });
    return row ?? null;
  }

  async removeContract(id: number, user: any) {
    const row = await this.prisma.surgeonContract.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('قرارداد یافت نشد');
    // غیرفعال می‌شود نه حذف: تسویه‌های گذشته به همین ردیف ارجاع منطقی دارند.
    await this.prisma.surgeonContract.update({ where: { id }, data: { active: false } });
    await this.audit.record({ actorId: user?.id, action: 'contract.disable', entityType: 'surgeon_contract', entityId: id, before: row });
    return { ok: true };
  }

  // ─────────────── سهامداران ───────────────

  partners() {
    return this.prisma.partner.findMany({ orderBy: { id: 'asc' } });
  }

  /**
   * جایگزینیِ کاملِ فهرستِ سهامداران.
   *
   * یک‌جا نوشته می‌شود نه ردیف‌به‌ردیف، چون شرطِ «جمعاً ۱۰۰٪» فقط روی کلِ فهرست
   * معنا دارد؛ با ویرایشِ تکی، سامانه بینِ دو ذخیره در حالتِ نامعتبر می‌ماند.
   */
  async setPartners(rows: { id?: number; name?: string; percent?: number; color?: string }[], user: any) {
    const clean = (rows ?? []).map((r) => ({
      name: String(r.name ?? '').trim(),
      percent: Number(r.percent),
      color: typeof r.color === 'string' ? r.color.trim() || null : null,
    }));
    if (!clean.length) throw new BadRequestException('حداقل یک سهامدار لازم است');
    for (const r of clean) {
      if (r.name.length < 2) throw new BadRequestException('نامِ سهامدار کوتاه است');
      if (!Number.isInteger(r.percent) || r.percent < 0 || r.percent > 100) {
        throw new BadRequestException('درصد باید عددِ صحیحِ بینِ ۰ تا ۱۰۰ باشد');
      }
    }
    const total = clean.reduce((s, r) => s + r.percent, 0);
    if (total !== 100) throw new BadRequestException(`جمعِ درصدها باید دقیقاً ۱۰۰ باشد — الان ${total} است`);

    await this.prisma.$transaction(async (tx) => {
      // ردیف‌های قبلی غیرفعال می‌شوند نه حذف: دفترِ تسویه به شناسه‌شان ارجاع دارد.
      await tx.partner.updateMany({ data: { active: false } });
      for (const r of clean) await tx.partner.create({ data: { ...r, active: true } });
    });
    await this.audit.record({ actorId: user?.id, action: 'partners.set', entityType: 'partner', after: { partners: clean } });
    return this.prisma.partner.findMany({ where: { active: true }, orderBy: { id: 'asc' } });
  }

  // ─────────────── تسویه ───────────────

  /** ورودی‌های محاسبه را از وضعیتِ فعلیِ مراجعه جمع می‌کند. */
  private async gather(visitId: number): Promise<SettlementInput & { visit: any }> {
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId },
      include: {
        surgeon: { include: { person: { select: { firstName: true, lastName: true } } } },
        tech: { include: { person: { select: { firstName: true, lastName: true } } } },
        charges: { select: { amount: true } },
      },
    });
    if (!visit) throw new NotFoundException('مراجعه پیدا نشد');

    // مدلِ گلوبال: درآمدِ تقسیم‌شدنی همان مبلغِ توافقیِ فاکتور است، نه جمعِ اقلامِ نمایشی.
    const revenue = visit.pricingModel === 'global' && visit.globalAmount != null
      ? visit.globalAmount
      : visit.charges.reduce((s: number, c: { amount: number }) => s + c.amount, 0);
    const when = visit.opDate ?? visit.createdAt;

    /// استثنای همین مراجعه بر قراردادِ جاری مقدم است — همان معنیِ «override».
    let contract: Contract | null = null;
    if (visit.surgeonShareKind) {
      contract = {
        kind: visit.surgeonShareKind,
        percent: visit.surgeonShareKind === 'percent' ? visit.surgeonShareValue : null,
        amount: visit.surgeonShareKind === 'fixed' ? visit.surgeonShareValue : null,
      };
    } else if (visit.surgeonId) {
      contract = await this.contractAt(visit.surgeonId, when);
    }

    const partners = await this.prisma.partner.findMany({ where: { active: true }, orderBy: { id: 'asc' } });

    return {
      visit,
      revenue,
      cost: visit.caseCost ?? 0,
      surgeon: visit.surgeon
        ? {
            id: visit.surgeonId,
            name: `${visit.surgeon.person.firstName} ${visit.surgeon.person.lastName}`.trim(),
            contract,
          }
        : null,
      tech: visit.tech
        ? {
            id: visit.techId,
            name: `${visit.tech.person.firstName} ${visit.tech.person.lastName}`.trim(),
            fee: visit.tech.fee,
          }
        : null,
      partners: partners.map((p) => ({ id: p.id, name: p.name, percent: p.percent })),
    };
  }

  /** پیش‌نمایش — بدونِ نوشتن. همان فرمول، تا عددِ روی صفحه با عددِ ذخیره‌شده یکی باشد. */
  async preview(visitId: number) {
    const input = await this.gather(visitId);
    return this.shape(input, computeShares(input));
  }

  /**
   * محاسبه و ذخیره — **نسخهٔ تازه**، نه ویرایشِ نسخهٔ قبل.
   *
   * تسویهٔ نهایی‌شده دوباره محاسبه نمی‌شود مگر صریحاً باطل شود: اگر اجازه بدهیم
   * عددِ نهایی بی‌سروصدا عوض شود، «نهایی» معنایی ندارد.
   */
  async compute(visitId: number, user: any) {
    const current = await this.currentRow(visitId);
    if (current?.status === 'final') {
      throw new BadRequestException('این تسویه نهایی شده است؛ برای محاسبهٔ دوباره اول آن را باطل کنید');
    }
    const input = await this.gather(visitId);
    /* ⚠️ **تسویه فقط روی عملِ انجام‌شده.** تا دیروز هر مراجعه‌ای قابلِ تسویه بود،
       حتی عملی که هفتهٔ بعد بود: پولِ بیمار در صندوق نشسته بود ولی هنوز بابتش
       کاری نشده، و تقسیمش یعنی اگر عمل لغو شود باید از جیبِ شریک پس گرفته شود.
       `preview` عمداً باز مانده تا ادمین بتواند عددِ آینده را ببیند — دیدن
       مشکلی ندارد، **نوشتن** دارد. */
    if (!isEarned(input.visit.opStatus)) {
      throw new BadRequestException(
        'این عمل هنوز «انجام‌شده» نیست؛ تا آن موقع پولش پیش‌دریافت است و تقسیم نمی‌شود',
      );
    }
    const entries = computeShares(input);

    const created = await this.prisma.$transaction(async (tx) => {
      const last = await tx.settlement.findFirst({ where: { visitId }, orderBy: { version: 'desc' }, select: { version: true } });
      if (current) await tx.settlement.update({ where: { id: current.id }, data: { supersededAt: new Date() } });
      return tx.settlement.create({
        data: {
          visitId, version: (last?.version ?? 0) + 1,
          revenue: input.revenue, cost: input.cost,
          createdById: user?.id ?? null,
          entries: { create: entries },
        },
      });
    });

    await this.audit.record({
      actorId: user?.id, action: 'settlement.compute', entityType: 'settlement', entityId: created.id,
      after: { visitId, version: created.version, revenue: input.revenue },
    });
    return this.get(visitId);
  }

  /** تسویهٔ جاری (نسخه‌ای که باطل نشده). */
  private currentRow(visitId: number) {
    return this.prisma.settlement.findFirst({
      where: { visitId, supersededAt: null },
      orderBy: { version: 'desc' },
    });
  }

  async get(visitId: number) {
    const row = await this.prisma.settlement.findFirst({
      where: { visitId, supersededAt: null },
      orderBy: { version: 'desc' },
      include: { entries: { orderBy: { id: 'asc' } } },
    });
    if (!row) return { settlement: null, preview: await this.preview(visitId) };
    return {
      settlement: {
        id: row.id, version: row.version, status: row.status,
        revenue: row.revenue, cost: row.cost,
        finalizedAt: row.finalizedAt, createdAt: row.createdAt,
        entries: row.entries.map((e) => ({ ...e, partyLabel: PARTY_LABELS[e.party] ?? e.party })),
        ...totals(row.entries),
      },
      // پیش‌نمایشِ وضعیتِ فعلی کنارِ نسخهٔ ذخیره‌شده می‌آید تا کاربر ببیند از
      // زمانِ محاسبه چه چیزی عوض شده — بدونِ این، «کهنه‌بودن» نامرئی است.
      preview: await this.preview(visitId),
    };
  }

  /** نهایی‌کردن — همان قاعده، چون نهایی‌کردن هم نوشتن است. */
  async finalize(visitId: number, user: any) {
    const row = await this.currentRow(visitId);
    if (!row) throw new NotFoundException('تسویه‌ای برای نهایی‌کردن نیست');
    if (row.status === 'final') throw new BadRequestException('این تسویه قبلاً نهایی شده است');
    await this.prisma.settlement.update({ where: { id: row.id }, data: { status: 'final', finalizedAt: new Date() } });
    // بدهیِ بینِ شرکا فقط با نهایی‌شدن ساخته می‌شود: پیش‌نویس نباید حسابِ جاری
    // را تکان بدهد، وگرنه هر بار محاسبهٔ آزمایشی یک بدهیِ ساختگی می‌سازد.
    await this.ledger.ledgerForSettlement(row.id, user);
    await this.audit.record({ actorId: user?.id, action: 'settlement.finalize', entityType: 'settlement', entityId: row.id });
    return this.get(visitId);
  }

  /// باطل‌کردن = نسخهٔ جاری superseded می‌شود؛ ردیف پاک نمی‌شود.
  async reopen(visitId: number, user: any) {
    const row = await this.currentRow(visitId);
    if (!row) throw new NotFoundException('تسویه‌ای وجود ندارد');
    await this.prisma.settlement.update({ where: { id: row.id }, data: { supersededAt: new Date() } });
    // ردیف‌های دفتر باطل می‌شوند نه پاک — همان قاعدهٔ فقط‌افزودنی.
    await this.ledger.voidForSettlement(row.id);
    await this.audit.record({ actorId: user?.id, action: 'settlement.reopen', entityType: 'settlement', entityId: row.id });
    return this.get(visitId);
  }

  async history(visitId: number) {
    const rows = await this.prisma.settlement.findMany({
      where: { visitId }, orderBy: { version: 'desc' },
      include: { entries: { orderBy: { id: 'asc' } } },
    });
    return rows.map((r) => ({
      id: r.id, version: r.version, status: r.status, revenue: r.revenue, cost: r.cost,
      supersededAt: r.supersededAt, finalizedAt: r.finalizedAt, createdAt: r.createdAt,
      entries: r.entries.map((e) => ({ ...e, partyLabel: PARTY_LABELS[e.party] ?? e.party })),
    }));
  }

  private shape(input: SettlementInput, entries: ComputedEntry[]) {
    return {
      revenue: input.revenue, cost: input.cost,
      entries: entries.map((e) => ({ ...e, partyLabel: PARTY_LABELS[e.party] ?? e.party })),
      ...totals(entries),
      /// هشدارهای پیکربندی — بی‌سروصدا صفر دادن بدترین حالت است.
      warnings: [
        ...(input.surgeon && !input.surgeon.contract ? [`برای ${input.surgeon.name} قراردادی ثبت نشده — سهمِ جراح صفر حساب شد`] : []),
        ...(input.tech && !input.tech.fee ? [`برای ${input.tech.name} دستمزدی ثبت نشده — سهمِ کارشناس صفر حساب شد`] : []),
        ...(input.partners.length === 0 ? ['هیچ سهامداری تعریف نشده — باقی‌ماندهٔ درآمد به کسی تخصیص نیافت'] : []),
      ],
    };
  }
}

/** جمع‌های مشتق — بیرونِ کلاس تا نسخهٔ ذخیره‌شده و پیش‌نمایش یک تعریف داشته باشند. */
export function totals(entries: { party: string; amount: number }[]) {
  const of = (p: string) => entries.filter((e) => e.party === p).reduce((s, e) => s + e.amount, 0);
  return {
    surgeonTotal: of('surgeon'),
    techTotal: of('tech'),
    costTotal: of('cost'),
    partnerTotal: of('partner'),
    /// باید همیشه برابرِ درآمد باشد؛ اگر نبود، فرمول شکسته است.
    checksum: entries.reduce((s, e) => s + e.amount, 0),
  };
}
