import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { jalaliStrToDate } from '../common/jalali';
import { toEnDigits } from '../common/identity';

/** جدول‌هایی که وارد می‌شوند. بقیه عمداً رد می‌شوند و در گزارش اعلام می‌گردند. */
const IMPORTED = ['surgeons', 'patient_profiles', 'patients', 'payments', 'bank_accounts', 'expenses', 'partner_ledger'] as const;

/**
 * چرا این‌ها وارد نمی‌شوند — هر کدام دلیلِ خودش را دارد و در گزارش برمی‌گردد
 * تا کاربر فکر نکند از قلم افتاده‌اند.
 */
const SKIP_REASONS: Record<string, string> = {
  accounts: 'کاربران باید در همین سامانه ثبت‌نام کنند؛ رمزِ سامانهٔ دیگر منتقل نمی‌شود',
  files: 'فایل‌ها روی دیسکِ سرورِ قبلی‌اند، نه داخلِ backup',
  settings: 'تنظیماتِ سامانهٔ قبلی با ساختارِ این سامانه یکی نیست',
  form_tokens: 'به ماژولِ فرم‌ساز تعلق دارد که هنوز ساخته نشده',
  message_templates: 'به ماژولِ پیام‌رسان تعلق دارد',
  surgeon_tokens: 'توکنِ سامانهٔ قبلی در این سامانه بی‌اعتبار است',
  push_subscriptions: 'اشتراکِ نوتیفیکیشن به مرورگرِ همان نصب گره خورده',
};

type Counter = { created: number; existing: number; skipped: number };
const counter = (): Counter => ({ created: 0, existing: 0, skipped: 0 });

/// نگاشتِ نوعِ ردیفِ دفترِ ملک‌طب به این سامانه. `visit_income` و
/// `case_cost_claim` هر دو در مدلِ ما «سهمِ سود»اند؛ تفکیکشان آن‌جا برای گزارش
/// بود، نه برای محاسبه.
const LEDGER_TYPE_MAP: Record<string, string> = {
  visit_income: 'profit_share',
  profit_share: 'profit_share',
  case_cost_claim: 'profit_share',
  expense_paid: 'expense_paid',
  settlement: 'settlement',
};

/**
 * وارد کردنِ backupِ JSONِ ملک‌طب.
 *
 * سه قاعده که کلِ این فایل را شکل می‌دهند:
 *
 * ۱. **ریال → تومان.** ملک‌طب همهٔ مبالغ را ریال نگه می‌داشت و این سامانه تومان.
 *    تقسیم بر ۱۰ در یک تابع (`toToman`) انجام می‌شود، نه پخش در کد.
 * ۲. **هر ردیفِ `patients` یک مراجعه است، نه یک بیمار.** نامِ جدول گمراه‌کننده
 *    است؛ پروندهٔ بیمار آن‌جا `patient_profiles` بود.
 * ۳. **قابلِ تکرار.** هر رکورد با `sourceRef` علامت می‌خورد؛ اجرای دوباره
 *    رکوردِ تکراری نمی‌سازد. بدونِ این، آزمودنِ ایمپورت یعنی هر بار دیتابیسِ نو.
 */
@Injectable()
export class ImportService {
  private readonly log = new Logger(ImportService.name);

  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async malekteb(dump: any, opts: { dryRun: boolean }, user: any) {
    const tables = dump?.tables;
    if (!tables || typeof tables !== 'object') {
      throw new BadRequestException('فایل ساختارِ backupِ ملک‌طب را ندارد (کلیدِ tables پیدا نشد)');
    }

    const report = {
      dryRun: opts.dryRun,
      version: dump.version ?? null,
      createdAt: dump.created_at ?? null,
      counts: {
        surgeons: counter(), hospitals: counter(), procedureTypes: counter(),
        patients: counter(), visits: counter(), charges: counter(), payments: counter(),
        bankAccounts: counter(), expenses: counter(), partnerLedger: counter(),
      } as Record<string, Counter>,
      skippedTables: [] as { table: string; rows: number; reason: string }[],
      warnings: [] as string[],
    };

    for (const [name, rows] of Object.entries(tables)) {
      if ((IMPORTED as readonly string[]).includes(name)) continue;
      report.skippedTables.push({
        table: name,
        rows: Array.isArray(rows) ? rows.length : 0,
        reason: SKIP_REASONS[name] ?? 'در این سامانه معادلی ندارد',
      });
    }

    // dry-run هم واقعاً می‌نویسد و بعد برمی‌گرداند: تنها راهِ صادقانهٔ گفتنِ
    // «چه اتفاقی می‌افتد» همین است — شبیه‌سازیِ جدا، رفتارِ جدا هم دارد.
    await this.prisma.$transaction(
      async (tx) => {
        await this.run(tx, tables, report);
        if (opts.dryRun) throw new DryRunRollback();
      },
      { timeout: 120_000, maxWait: 20_000 },
    ).catch((e) => {
      if (!(e instanceof DryRunRollback)) throw e;
    });

    await this.audit.record({
      actorId: user?.id,
      action: opts.dryRun ? 'import.dryrun' : 'import.malekteb',
      entityType: 'import',
      after: report.counts,
    });
    this.log.log(`ایمپورتِ ملک‌طب${opts.dryRun ? ' (آزمایشی)' : ''}: ${JSON.stringify(report.counts)}`);
    return report;
  }

  private async run(tx: any, tables: any, report: any) {
    const c = report.counts;

    // ── جراحان ──
    const surgeonByName = new Map<string, number>();
    for (const row of arr(tables.surgeons)) {
      const name = text(row.name);
      if (!name) { c.surgeons.skipped += 1; continue; }
      const found = await tx.surgeon.findFirst({
        where: { person: { firstName: firstOf(name), lastName: lastOf(name) } },
        select: { id: true },
      });
      if (found) { surgeonByName.set(name, found.id); c.surgeons.existing += 1; continue; }
      const person = await tx.person.create({
        data: { firstName: firstOf(name), lastName: lastOf(name) },
      });
      const s = await tx.surgeon.create({ data: { personId: person.id } });
      surgeonByName.set(name, s.id);
      c.surgeons.created += 1;
    }

    // ── بیمارستان‌ها و انواعِ عمل: در ملک‌طب متنِ آزاد روی هر مراجعه بودند،
    //    پس از نام‌های یکتای همان ستون ساخته می‌شوند.
    const hospitalByName = await this.upsertByName(
      tx, 'hospital', uniqueText(arr(tables.patients).map((r: any) => r.hospital)), c.hospitals,
    );
    const procByName = await this.upsertByName(
      tx, 'procedureType', uniqueText(arr(tables.patients).map((r: any) => r.op)), c.procedureTypes,
    );

    // ── پروندهٔ بیمار ──
    // کلیدِ تطبیق کد ملی است (همان اصلِ MPI). پروفایل‌ها اول وارد می‌شوند تا
    // مراجعه‌ها به پروندهٔ درست بچسبند نه پروندهٔ تازه‌ساخته.
    const patientByNid = new Map<string, number>();
    const patientByProfileId = new Map<string, number>();
    for (const row of arr(tables.patient_profiles)) {
      const nid = digits(row.national_id);
      const ref = `malekteb:patient_profiles:${row.id}`;
      const existing = await this.findPatient(tx, nid, ref);
      if (existing) {
        patientByProfileId.set(String(row.id), existing.id);
        if (nid) patientByNid.set(nid, existing.id);
        c.patients.existing += 1;
        continue;
      }
      const created = await tx.patient.create({
        data: {
          // کدِ اصلی حفظ می‌شود: کاربر پروندهٔ MT-0042 را با همان شماره می‌شناسد.
          code: text(row.patient_code) ?? `MT-P${row.id}`,
          firstName: text(row.first_name) ?? firstOf(text(row.full_name) ?? '—'),
          lastName: text(row.last_name) ?? lastOf(text(row.full_name) ?? '—'),
          phone: digits(row.phone) || null,
          nationalId: nid || null,
          birthDate: jalaliStrToDate(row.birth_date),
          address: text(row.address),
          sourceRef: ref,
        },
      });
      patientByProfileId.set(String(row.id), created.id);
      if (nid) patientByNid.set(nid, created.id);
      c.patients.created += 1;
    }

    // ── مراجعات (جدولِ patientsِ ملک‌طب) ──
    const visitByOldId = new Map<string, number>();
    for (const row of arr(tables.patients)) {
      const ref = `malekteb:patients:${row.id}`;
      const already = await tx.visit.findFirst({ where: { sourceRef: ref }, select: { id: true } });
      if (already) {
        visitByOldId.set(String(row.id), already.id);
        c.visits.existing += 1;
        if (toToman(row.amount) > 0) c.charges.existing += 1;
        continue;
      }

      const patientId = await this.patientFor(tx, row, patientByNid, patientByProfileId, c);
      const max = await tx.visit.aggregate({ where: { patientId }, _max: { seq: true } });
      const surgeonName = text(row.surgeon_name);
      const hospitalName = text(row.hospital);
      const opName = text(row.op);

      const visit = await tx.visit.create({
        data: {
          patientId,
          seq: (max._max.seq ?? 0) + 1,
          kind: 'surgery',
          sourceRef: ref,
          surgeonId: surgeonName ? surgeonByName.get(surgeonName) ?? null : null,
          hospitalId: hospitalName ? hospitalByName.get(hospitalName) ?? null : null,
          procedureTypeId: opName ? procByName.get(opName) ?? null : null,
          // عکسِ لحظه‌ای هم نگه داشته می‌شود تا اگر موجودیت پیدا نشد، متن نپرد.
          surgeonName, hospitalName, opType: opName,
          opDate: jalaliStrToDate(row.opdate),
          opStartTime: timeOf(row.op_start_time),
          opEndTime: timeOf(row.op_end_time),
          techArriveTime: timeOf(row.tech_arrive_time),
          opStatus: ['pending', 'done', 'cancelled'].includes(row.op_status) ? row.op_status : 'pending',
          notes: text(row.notes),
        },
      });
      visitByOldId.set(String(row.id), visit.id);
      c.visits.created += 1;

      // مبلغِ مراجعه در ملک‌طب یک ستون بود؛ این‌جا باید ردیفِ صورت‌حساب شود،
      // وگرنه جمعِ مشتقِ فاکتور صفر می‌ماند و مراجعهٔ وارد‌شده «رایگان» دیده می‌شود.
      const amount = toToman(row.amount);
      if (amount > 0) {
        await tx.charge.create({
          data: {
            visitId: visit.id, kind: 'service',
            title: opName || 'خدماتِ مراجعه (وارد‌شده)',
            quantity: 1, unitPrice: amount, amount,
            notes: 'وارد‌شده از ملک‌طب',
          },
        });
        c.charges.created += 1;
      }
    }

    // ── پرداخت‌ها ──
    const paidFromRows = new Set<string>();
    for (const row of arr(tables.payments)) {
      const visitId = visitByOldId.get(String(row.patient_id));
      if (!visitId) { c.payments.skipped += 1; continue; }
      const amount = toToman(row.amount);
      if (amount <= 0) { c.payments.skipped += 1; continue; }
      const ref = `malekteb:payments:${row.id}`;
      // ⚠️ پیش از بررسیِ تکراری‌بودن علامت می‌خورد، نه بعدش: در اجرای دوم همهٔ
      // ردیف‌ها تکراری‌اند و اگر این‌جا continue شود، مراجعه «بدونِ ردیفِ پرداخت»
      // دیده می‌شود و پایین‌تر ستونِ paid دوباره ثبت می‌گردد — پرداختِ دوبرابر.
      paidFromRows.add(String(row.patient_id));
      const dup = await tx.payment.findFirst({ where: { visitId, reference: ref }, select: { id: true } });
      if (dup) { c.payments.existing += 1; continue; }
      await tx.payment.create({
        data: {
          visitId, amount, method: 'cash',
          paidAt: jalaliStrToDate(row.date) ?? new Date(),
          reference: ref,
          notes: text(row.note),
        },
      });
      c.payments.created += 1;
    }

    // ستونِ paidِ مراجعه‌هایی که ردیفِ پرداخت ندارند، وگرنه مانده‌شان غلط می‌شود.
    for (const row of arr(tables.patients)) {
      if (paidFromRows.has(String(row.id))) continue;
      const paid = toToman(row.paid);
      if (paid <= 0) continue;
      const visitId = visitByOldId.get(String(row.id));
      if (!visitId) continue;
      const ref = `malekteb:patients:${row.id}:paid`;
      const dup = await tx.payment.findFirst({ where: { visitId, reference: ref }, select: { id: true } });
      if (dup) { c.payments.existing += 1; continue; }
      await tx.payment.create({
        data: {
          visitId, amount: paid, method: 'cash',
          paidAt: jalaliStrToDate(row.opdate) ?? new Date(),
          reference: ref, notes: 'جمعِ پرداختیِ وارد‌شده از ملک‌طب',
        },
      });
      c.payments.created += 1;
      report.warnings.push(`مراجعهٔ ${row.id}: ردیفِ پرداخت نداشت، ستونِ «پرداختی» به‌عنوان یک پرداخت ثبت شد`);
    }
    await this.runAccounting(tx, tables, c, report);

    if (report.warnings.length > 20) {
      const n = report.warnings.length;
      report.warnings = report.warnings.slice(0, 20);
      report.warnings.push(`… و ${n - 20} مورد دیگر`);
    }
  }

  /**
   * حساب‌های بانکی، هزینه‌ها و دفترِ حسابِ جاریِ شرکا.
   *
   * سه نکتهٔ نگاشت که بدونشان داده بی‌معنی وارد می‌شود:
   *  ۱) تاریخ‌های ملک‌طب رشتهٔ شمسی‌اند (`۱۴۰۵/۰۵/۰۹`)، پس از `jalaliStrToDate`.
   *  ۲) مبالغ ریال‌اند، مثلِ بقیهٔ ایمپورت → `toToman`.
   *  ۳) شرکا در ملک‌طب **نام** بودند نه شناسه (`partner_from`/`partner_to`)، پس
   *     نام به شریکِ تعریف‌شده در این سامانه نگاشت می‌شود؛ نامِ ناشناخته یعنی
   *     ردیف رد می‌شود، نه اینکه به شریکِ اشتباه بچسبد.
   */
  private async runAccounting(tx: any, tables: any, c: any, report: any) {
    for (const row of arr(tables.bank_accounts)) {
      const ownerName = text(row.owner_name);
      if (!ownerName) { c.bankAccounts.skipped += 1; continue; }
      const dup = await tx.bankAccount.findFirst({ where: { ownerName, iban: text(row.sheba) }, select: { id: true } });
      if (dup) { c.bankAccounts.existing += 1; continue; }
      await tx.bankAccount.create({
        data: {
          ownerName, cardNumber: text(row.card_number), iban: text(row.sheba),
          active: row.is_active === undefined ? true : !!Number(row.is_active),
        },
      });
      c.bankAccounts.created += 1;
    }

    const expenseIdMap = new Map<string, number>();
    for (const row of arr(tables.expenses)) {
      const amount = toToman(row.amount);
      const title = text(row.description) ?? text(row.title) ?? text(row.category) ?? 'هزینه';
      if (amount <= 0) { c.expenses.skipped += 1; continue; }
      const ref = `malekteb:expenses:${row.id}`;
      const dup = await tx.expense.findFirst({ where: { notes: ref }, select: { id: true } });
      if (dup) { expenseIdMap.set(String(row.id), dup.id); c.expenses.existing += 1; continue; }
      const created = await tx.expense.create({
        data: {
          title: title.slice(0, 120), category: text(row.category), amount,
          spentAt: jalaliStrToDate(row.date) ?? new Date(),
          // ⚠️ ارجاعِ منبع در notes می‌نشیند چون Expense ستونِ sourceRef ندارد؛
          // بدونِ آن، اجرای دوبارهٔ ایمپورت هزینه‌ها را دو برابر می‌کرد.
          notes: ref,
        },
      });
      expenseIdMap.set(String(row.id), created.id);
      c.expenses.created += 1;
    }

    const ledgerRows = arr(tables.partner_ledger);
    if (ledgerRows.length) {
      const partners = await tx.partner.findMany({ where: { active: true }, select: { id: true, name: true } });
      const byName = new Map<string, number>(partners.map((p: any) => [p.name, p.id]));
      let unknown = 0;
      for (const row of ledgerRows) {
        const from = byName.get(text(row.partner_from) ?? '');
        const to = byName.get(text(row.partner_to) ?? '');
        const amount = toToman(row.amount);
        if (!from || !to || from === to || amount <= 0) { c.partnerLedger.skipped += 1; if (!from || !to) unknown += 1; continue; }
        const ref = `malekteb:partner_ledger:${row.id}`;
        const dup = await tx.partnerLedger.findFirst({ where: { description: { endsWith: ref } }, select: { id: true } });
        if (dup) { c.partnerLedger.existing += 1; continue; }
        await tx.partnerLedger.create({
          data: {
            entryType: LEDGER_TYPE_MAP[row.entry_type] ?? 'settlement',
            fromPartnerId: from, fromName: text(row.partner_from)!,
            toPartnerId: to, toName: text(row.partner_to)!,
            amount,
            expenseId: row.expense_id ? expenseIdMap.get(String(row.expense_id)) ?? null : null,
            visitCode: text(row.visit_code),
            description: `${text(row.description) ?? ''} — ${ref}`.trim(),
            status: row.status === 'settled' ? 'settled' : 'open',
            entryDate: jalaliStrToDate(row.entry_date) ?? new Date(),
          },
        });
        c.partnerLedger.created += 1;
      }
      if (unknown) {
        report.warnings.push(`${unknown} ردیفِ دفترِ شرکا رد شد: نامِ شریک با سهامدارانِ تعریف‌شده در این سامانه یکی نبود — اول سهامداران را در حسابداری تعریف کنید`);
      }
    }
  }

  /** بیمارِ این مراجعه: پروفایل → کد ملی → ساختِ پروندهٔ تازه از خودِ ردیف. */
  private async patientFor(tx: any, row: any, byNid: Map<string, number>, byProfile: Map<string, number>, c: any) {
    const fromProfile = row.profile_id ? byProfile.get(String(row.profile_id)) : undefined;
    if (fromProfile) return fromProfile;

    const nid = digits(row.national_id);
    if (nid && byNid.has(nid)) return byNid.get(nid)!;

    const ref = `malekteb:patients:${row.id}:patient`;
    const existing = await this.findPatient(tx, nid, ref);
    if (existing) {
      if (nid) byNid.set(nid, existing.id);
      c.patients.existing += 1;
      return existing.id;
    }
    const name = text(row.name) ?? '—';
    const created = await tx.patient.create({
      data: {
        code: `MT-X${row.id}`,
        firstName: firstOf(name), lastName: lastOf(name),
        phone: digits(row.phone) || null,
        nationalId: nid || null,
        sourceRef: ref,
      },
    });
    if (nid) byNid.set(nid, created.id);
    c.patients.created += 1;
    return created.id;
  }

  private async findPatient(tx: any, nid: string, ref: string) {
    if (nid) {
      const byNid = await tx.patient.findUnique({ where: { nationalId: nid }, select: { id: true } });
      if (byNid) return byNid;
    }
    return tx.patient.findFirst({ where: { sourceRef: ref }, select: { id: true } });
  }

  /** موجودیت‌هایی که در ملک‌طب متنِ آزاد بودند: از نام‌های یکتا ساخته می‌شوند. */
  private async upsertByName(tx: any, model: 'hospital' | 'procedureType', names: string[], c: Counter) {
    const map = new Map<string, number>();
    for (const name of names) {
      const found = await tx[model].findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (found) { map.set(name, found.id); c.existing += 1; continue; }
      const created = await tx[model].create({ data: { name } });
      map.set(name, created.id);
      c.created += 1;
    }
    return map;
  }
}

/** خطای ساختگی برای برگرداندنِ تراکنشِ dry-run. */
class DryRunRollback extends Error {}

const arr = (v: any): any[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim();
  return s || null;
};
const digits = (v: unknown): string => toEnDigits(String(v ?? '')).replace(/[^0-9]/g, '');
/**
 * «رضا حسینی نژاد» → نام «رضا»، فامیل «حسینی نژاد».
 *
 * ملک‌طب فقط یک ستونِ `name` داشت و این سامانه نام و فامیل را جدا نگه می‌دارد.
 * تکه‌کردن از اولین فاصله است، نه آخرین: نامِ مرکب («امیرحسین») نادر و
 * فامیلِ دوکلمه‌ای («حسینی نژاد») رایج است.
 */
const firstOf = (full: string): string => (full.trim().split(/\s+/)[0] || '—');
const lastOf = (full: string): string => {
  const parts = full.trim().split(/\s+/);
  return parts.slice(1).join(' ') || '—';
};

const uniqueText = (list: any[]): string[] => [...new Set(list.map(text).filter(Boolean) as string[])];

/**
 * ریال → تومان.
 *
 * ⚠️ تنها جای تبدیل. ملک‌طب همه‌جا ریال بود و این سامانه همه‌جا تومان؛ اگر این
 * تقسیم در دو نقطه تکرار شود، بالاخره یکی‌شان جا می‌ماند و فاکتور ده برابر
 * می‌شود. باقی‌ماندهٔ تقسیم گرد می‌شود (ریالِ خرد در تومان معنا ندارد).
 */
function toToman(rial: unknown): number {
  const n = Number(String(rial ?? '0').replace(/[^0-9-]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n / 10);
}

/** «08:30:00» یا «08:30» → «08:30»؛ هرچیزِ دیگر null. */
function timeOf(v: unknown): string | null {
  const s = toEnDigits(String(v ?? '')).trim();
  const m = /^([01]\d|2[0-3]):([0-5]\d)/.exec(s);
  return m ? `${m[1]}:${m[2]}` : null;
}
