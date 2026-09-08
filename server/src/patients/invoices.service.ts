import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../config/settings.service';
import { BillingService, summarize } from './billing.service';
import { ServiceCodesService } from './service-codes.service';
import { durationOf } from './patients.service';
import { LEVEL } from '../common/levels';

@Injectable()
export class InvoicesService {
  constructor(private prisma: PrismaService, private billing: BillingService, private codes: ServiceCodesService, private settings: SettingsService) {}

  private async visit(id: number, user: any) {
    const v = await this.prisma.visit.findFirst({ where: { id, ...((user?.level ?? 0) < LEVEL.SUPERVISOR ? { techId: user?.id ?? -1 } : {}) }, include: { hospital: true } });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    return v;
  }

  async list(id: number, user: any) {
    const v = await this.visit(id, user);
    const duration = durationOf(v.opStartTime, v.opEndTime);
    return {
      hours: duration ? Math.max(1, Math.round(duration / 60)) : null,
      year: new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', timeZone: 'UTC' }).format(v.opDate ?? new Date()).replace(/\D/g, ''),
      sector: v.hospital?.sector ?? 'private',
      documents: await this.prisma.invoiceDocument.findMany({ where: { visitId: id }, orderBy: { id: 'desc' }, select: { id: true, number: true, variant: true, createdAt: true, supersededAt: true } }),
    };
  }

  async price(id: number, dto: { code: string; hours: number; year: string; deviceOwner: string }, user: any) {
    const v = await this.visit(id, user);
    if (!Number.isInteger(dto.hours) || dto.hours < 1 || dto.hours > 72 || !/^\d{4}$/.test(dto.year) || !['company', 'hospital'].includes(dto.deviceOwner)) throw new BadRequestException('مدت، سال تعرفه یا مالک دستگاه نامعتبر است');
    const price = await this.codes.priceOf(dto.code, dto.year, v.hospital?.sector ?? 'private');
    if (price.price === null || !price.tariff || !price.coefficients || !price.factors) throw new BadRequestException('تعرفهٔ این سال و نوع بیمارستان در تعاریف پایه ثبت نشده است');
    const professional = Math.round(price.coefficients.professional * price.factors.professional * dto.hours);
    const technical = Math.round(price.coefficients.technical * price.factors.technical * dto.hours);
    const total = professional + technical;
    if (!Number.isSafeInteger(total) || total < 0 || total > 2147483647) throw new BadRequestException('مبلغ محاسبه‌شده از محدوده مجاز خارج است');
    return { code: dto.code, title: price.title, hours: dto.hours, deviceOwner: dto.deviceOwner,
      coefficients: price.coefficients, factors: price.factors, professional, technical, total, tariff: price.tariff };
  }

  async addService(id: number, dto: { code: string; hours: number; year: string; deviceOwner: string }, user: any) {
    // Never accept the preview's amounts from the browser. Resolve basic definitions again.
    const detail = await this.price(id, dto, user);
    return this.billing.addCharge(id, { kind: 'service', title: detail.title, serviceCode: detail.code, codeSystem: 'book', quantity: 1, unitPrice: detail.total }, user, detail);
  }

  async document(id: number, documentId: number, user: any) {
    await this.visit(id, user);
    const doc = await this.prisma.invoiceDocument.findFirst({ where: { id: documentId, visitId: id } });
    if (!doc) throw new NotFoundException('فاکتور پیدا نشد');
    return doc;
  }

  async issue(id: number, variant: string, user: any) {
    await this.visit(id, user);
    if (!['formal', 'informal'].includes(variant)) throw new BadRequestException('نوع فاکتور نامعتبر است');
    const template = await this.settings.invoiceTemplate(variant);
    if (!template.brand.legalName) throw new BadRequestException('نام صادرکننده را در تنظیمات ← قالب فاکتور شرکت وارد کنید');
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async tx => {
          // Serialize issuers and keep the complete financial snapshot on one DB revision.
          await tx.$queryRaw`SELECT id FROM visits WHERE id = ${id} FOR UPDATE`;
          const v = await tx.visit.findUniqueOrThrow({ where: { id }, include: { patient: true, hospital: true, payerHospital: true, surgeon: { include: { person: true } }, procedureType: true, invoiceBankAccount: true, charges: { orderBy: { id: 'asc' } }, payments: { orderBy: { id: 'asc' } } } });
          if (v.invoiceType !== variant || !v.invoiceBankAccount?.active || v.invoiceBankAccount.classification !== variant) throw new BadRequestException('ابتدا نوع فاکتور و حساب دریافت هم‌نوع را ثبت کنید');
          if (v.payments.some(p => p.bankAccountId !== null && p.bankAccountId !== v.invoiceBankAccountId)) throw new BadRequestException('حساب پرداخت‌های ثبت‌شده با حساب فاکتور یکسان نیست');
          if (!v.charges.length) throw new BadRequestException('ابتدا اقلام فاکتور را ثبت کنید');
          const totals = summarize(v.charges, v.payments, v);
          if (totals.total < 0) throw new BadRequestException('جمع فاکتور نباید منفی باشد');
          const recipient = {
            code: `${v.patient.code}-V${v.seq}`, fullName: `${v.patient.firstName} ${v.patient.lastName}`.trim(), nationalId: v.patient.nationalId, phone: v.patient.phone,
            hospitalName: v.hospital?.name ?? v.hospitalName, hospitalAddress: v.hospital?.address, payer: v.payer, payerHospitalName: v.payerHospital?.name, payerAddress: v.payerHospital?.address,
            surgeonName: v.surgeon ? `${v.surgeon.person.firstName} ${v.surgeon.person.lastName}`.trim() : v.surgeonName,
            procedureTypeName: v.procedureType?.name ?? v.opType, opDate: v.opDate, opStartTime: v.opStartTime, opEndTime: v.opEndTime,
          };
          const bank = v.invoiceBankAccount;
          const invoiceBankAccount = { id: bank.id, ownerName: bank.ownerName, bankName: bank.bankName, accountNumber: bank.accountNumber, iban: bank.iban };
          const snapshot = JSON.parse(JSON.stringify({ version: 1, template, visit: recipient,
            billing: { ...totals, pricingModel: v.pricingModel, globalAmount: v.globalAmount, invoiceType: variant, invoiceBankAccount, charges: v.charges, payments: v.payments } }));
          const fingerprint = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
          const latest = await tx.invoiceDocument.findFirst({ where: { visitId: id, variant, supersededAt: null }, orderBy: { id: 'desc' } });
          if (latest?.fingerprint === fingerprint) return latest;
          // A DB sequence is tenant-local and cannot reuse a number after a failed issue.
          const [serial] = await tx.$queryRaw<{ id: number }[]>`SELECT nextval(pg_get_serial_sequence('invoice_documents', 'id'))::integer AS id`;
          const number = `${template.prefix}${variant === 'formal' ? 'F' : 'U'}-${String(serial.id).padStart(6, '0')}`;
          const doc = await tx.invoiceDocument.create({ data: { id: serial.id, visitId: id, variant, number, fingerprint, snapshot, createdById: user?.id ?? null } });
          await tx.invoiceDocument.updateMany({ where: { visitId: id, variant, supersededAt: null, id: { not: doc.id } }, data: { supersededAt: doc.createdAt } });
          await tx.auditEvent.create({ data: { actorId: user?.id ?? null, action: 'invoice.issue', entityType: 'visit', entityId: String(id), afterJson: { invoiceId: doc.id, number, total: totals.total, replacedId: latest?.id ?? null } } });
          return doc;
        }, { isolationLevel: 'Serializable', timeout: 15000 });
      } catch (error) {
        if ((error as any)?.code === 'P2034' && attempt < 2) continue;
        throw error;
      }
    }
  }
}
