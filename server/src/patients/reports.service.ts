import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toJalali } from '../common/jalali';
import { recognize } from './revenue';
import { principalProcedureName } from './visit-coding';

/**
 * گزارشِ مالی.
 *
 * ⚠️ **قاعدهٔ حاکم:** هیچ عددی این‌جا از نو تعریف نمی‌شود. درآمد جمعِ همان
 * `Charge.amount` است، وصولی جمعِ همان `Payment.amount`، هزینه جمعِ همان
 * `Expense.amount`. اگر گزارش تعریفِ خودش را بسازد، عددِ گزارش با عددِ صفحهٔ
 * مراجعه فرق می‌کند و کاربر به هر دو بی‌اعتماد می‌شود.
 *
 * ⚠️ **درآمد و وصولی یکی نیستند** و عمداً کنارِ هم گزارش می‌شوند: سودِ حسابداری
 * با اولی حساب می‌شود و نقدینگی با دومی، و قاطی‌کردنشان همان اشتباهی است که
 * شرکت‌های کوچک را ورشکسته می‌کند.
 *
 * ⚠️ **و درآمد با «فاکتورِ صادره» هم یکی نیست.** قرارِ شناسایی در `revenue.ts`
 * است: تا وقتی عمل انجام نشده، پولِ رسیده **پیش‌دریافت** است نه درآمد. این‌جا
 * فقط مصرف می‌شود؛ اگر گزارش قاعدهٔ خودش را بسازد، همان دوپارگی‌ای پیش می‌آید
 * که این فایل از اولش برای جلوگیری از آن نوشته شد.
 */
@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /**
   * خلاصهٔ یک بازه + تفکیک‌ها.
   *
   * مرزِ بازه روی **تاریخِ عمل** است نه تاریخِ ثبت: کاربر «کارکردِ مرداد» را
   * می‌پرسد، یعنی عمل‌هایی که مرداد انجام شدند، نه آن‌هایی که مرداد در سامانه
   * وارد شدند. مراجعهٔ بدونِ تاریخِ عمل با تاریخِ ثبتش حساب می‌شود، وگرنه از
   * همهٔ گزارش‌ها می‌افتد و جمعِ کل با فهرست نمی‌خواند.
   */
  async financial(opts: { from?: Date; to?: Date } = {}) {
    const range = opts.from || opts.to
      ? { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) }
      : undefined;
    const visitWhere: any = { opStatus: { not: 'cancelled' } };
    if (range) visitWhere.OR = [{ opDate: range }, { opDate: null, createdAt: range }];

    const [visits, charges, payments, expenses] = await Promise.all([
      this.prisma.visit.findMany({
        where: visitWhere,
        select: {
          id: true, opDate: true, createdAt: true, payer: true, opStatus: true,
          pricingModel: true, globalAmount: true,
          surgeonId: true, surgeonName: true,
          hospitalId: true, hospitalName: true,
          procedureTypeId: true, opType: true,
          surgeon: { include: { person: { select: { firstName: true, lastName: true } } } },
          hospital: { select: { name: true } },
          procedureType: { select: { name: true } },
        },
      }),
      this.prisma.charge.groupBy({ by: ['visitId'], _sum: { amount: true } }),
      this.prisma.payment.groupBy({ by: ['visitId'], _sum: { amount: true } }),
      this.prisma.expense.findMany({
        where: range ? { spentAt: range } : {},
        select: { amount: true, category: true, spentAt: true },
      }),
    ]);

    const ids = new Set(visits.map((v) => v.id));
    const chargeOf = new Map(charges.filter((c) => ids.has(c.visitId)).map((c) => [c.visitId, c._sum.amount ?? 0]));
    const payOf = new Map(payments.filter((p) => ids.has(p.visitId)).map((p) => [p.visitId, p._sum.amount ?? 0]));

    const rows = visits.map((v) => {
      // مدلِ گلوبال: قراردادِ مراجعه همان مبلغِ توافقی است، نه جمعِ اقلامِ نمایشی.
      const contracted = v.pricingModel === 'global' && v.globalAmount != null
        ? v.globalAmount
        : chargeOf.get(v.id) ?? 0;
      const collected = payOf.get(v.id) ?? 0;
      const m = recognize({ contracted, collected, opStatus: v.opStatus });
      return {
        ...v,
        /// ⚠️ `revenue` عمداً **شناسایی‌شده** است، نه جمعِ فاکتور: هرجا این کلمه
        ///    در گزارش می‌آید باید همان چیزی باشد که سود با آن حساب می‌شود.
        revenue: m.recognized,
        contracted,
        deferred: m.deferred,
        collected,
        due: m.due,
        month: monthKey(v.opDate ?? v.createdAt),
        surgeon: v.surgeon ? `${v.surgeon.person.firstName} ${v.surgeon.person.lastName}`.trim() : v.surgeonName ?? '—',
        hospitalLabel: v.hospital?.name ?? v.hospitalName ?? '—',
        /// ⚠️ **فقط عملِ اصلی** (بستهٔ ۷ج): درآمد مالِ مراجعه است و یک‌بار شمرده
        ///    می‌شود؛ پخش‌کردنش روی چند عمل یعنی ساختنِ عددی که هیچ‌جا ثبت نشده، و
        ///    گروه‌بندی با برچسبِ ترکیبی («A + B») جمعِ تفکیک را از جمعِ کل جدا می‌کرد.
        ///    نامِ کلید عمداً `procedureLabel` نیست — آن در همهٔ endpointها برچسبِ ترکیبی است.
        principalProcedure: principalProcedureName(v) ?? '—',
      };
    });

    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const contracted = rows.reduce((s, r) => s + r.contracted, 0);
    const deferred = rows.reduce((s, r) => s + r.deferred, 0);
    const collected = rows.reduce((s, r) => s + r.collected, 0);
    const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);

    return {
      range: { from: opts.from ?? null, to: opts.to ?? null },
      totals: {
        visits: rows.length,
        /// درآمدِ **شناسایی‌شده** — فقط عمل‌های انجام‌شده.
        revenue,
        /// جمعِ فاکتورها صرف‌نظر از انجام — «چقدر کار در جریان است».
        contracted,
        /// پیش‌دریافت: پولِ رسیده بابتِ عملِ انجام‌نشده. **بدهی است، نه درآمد.**
        deferred,
        collected,
        due: rows.reduce((s, r) => s + r.due, 0),
        expenses: expenseTotal,
        /// سودِ ناخالص بر مبنای **درآمدِ شناسایی‌شده**، نه وصولی و نه فاکتور.
        profit: revenue - expenseTotal,
      },
      byMonth: byMonth(rows, expenses),
      bySurgeon: groupBy(rows, (r) => r.surgeon),
      byHospital: groupBy(rows, (r) => r.hospitalLabel),
      /// Σ byProcedure == totals — هر مراجعه دقیقاً در یک گروه (عملِ اصلی).
      byProcedure: groupBy(rows, (r) => r.principalProcedure),
      byExpenseCategory: expenseGroups(expenses),
    };
  }
}

/** «۱۴۰۵/۰۵» — کلیدِ ماهِ شمسی، تا نمودار با تقویمِ کاربر بخواند نه میلادی. */
function monthKey(d: Date): string {
  const [y, m] = toJalali(d);
  return `${y}/${String(m).padStart(2, '0')}`;
}

type Row = { revenue: number; contracted: number; deferred: number; collected: number; due: number; month: string };

function byMonth(rows: Row[], expenses: { amount: number; spentAt: Date }[]) {
  const map = new Map<string, { month: string; revenue: number; deferred: number; collected: number; expenses: number; visits: number }>();
  const at = (k: string) => {
    if (!map.has(k)) map.set(k, { month: k, revenue: 0, deferred: 0, collected: 0, expenses: 0, visits: 0 });
    return map.get(k)!;
  };
  for (const r of rows) {
    const m = at(r.month);
    m.revenue += r.revenue; m.deferred += r.deferred; m.collected += r.collected; m.visits += 1;
  }
  for (const e of expenses) at(monthKey(e.spentAt)).expenses += e.amount;
  return [...map.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({ ...m, profit: m.revenue - m.expenses }));
}

/**
 * تفکیک بر اساسِ یک برچسب.
 *
 * خالص و مشترک، تا «به تفکیکِ جراح» و «به تفکیکِ بیمارستان» دو منطقِ متفاوت
 * پیدا نکنند — همان دلیلِ `summarize` و `balanceOf`.
 */
function groupBy(rows: (Row & Record<string, any>)[], key: (r: any) => string) {
  const map = new Map<string, { label: string; revenue: number; deferred: number; collected: number; due: number; visits: number }>();
  for (const r of rows) {
    const k = key(r);
    const cur = map.get(k) ?? { label: k, revenue: 0, deferred: 0, collected: 0, due: 0, visits: 0 };
    cur.revenue += r.revenue; cur.deferred += r.deferred; cur.collected += r.collected; cur.due += r.due; cur.visits += 1;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

function expenseGroups(rows: { amount: number; category: string | null }[]) {
  const map = new Map<string, number>();
  for (const e of rows) map.set(e.category ?? 'بدونِ دسته', (map.get(e.category ?? 'بدونِ دسته') ?? 0) + e.amount);
  return [...map.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
}
