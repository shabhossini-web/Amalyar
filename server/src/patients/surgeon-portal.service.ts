import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { AuditService } from '../audit/audit.service';
import { verificationDeadline } from '../accounts/provisional';
import { LEVEL } from '../common/levels';
import { toEnDigits } from '../common/identity';
import { RequiredItemInput, resolveRequirements } from './visit-requirements';

@Injectable()
export class SurgeonPortalService {
  constructor(private prisma: PrismaService, private config: ConfigService, private audit: AuditService) {}

  private async scope(user: any) {
    const vertical = await this.config.vertical();
    if (!['ionm', 'implant'].includes(vertical)) throw new ForbiddenException('در مدل مطب، پزشک از داشبورد مطب استفاده می‌کند');
    if ((user?.level ?? 0) >= LEVEL.SUPER_ADMIN) return {};
    const account = await this.prisma.account.findUnique({ where: { id: user?.id ?? -1 }, select: { personId: true, status: true } });
    const surgeon = account?.status === 'active' ? await this.prisma.surgeon.findFirst({ where: { personId: account.personId, active: true }, select: { id: true } }) : null;
    if (!surgeon) throw new ForbiddenException('حساب شما به جراح فعال در تعاریف پایه متصل نیست');
    return { surgeonId: surgeon.id };
  }

  private async visit(id: number, user: any) {
    const scope = await this.scope(user);
    const row = await this.prisma.visit.findFirst({ where: { id, ...scope, patient: { deletedAt: null } } });
    if (!row) throw new NotFoundException('مراجعه پیدا نشد');
    return row;
  }

  async list(user: any, query = '', page = 1) {
    const scope = await this.scope(user);
    const q = query.trim().slice(0, 80), current = Number.isFinite(page) ? Math.min(100000, Math.max(1, Math.floor(page) || 1)) : 1;
    const where = { ...scope, patient: { deletedAt: null, ...(q ? { OR: [{ firstName: { contains: toEnDigits(q) } }, { lastName: { contains: toEnDigits(q) } }, { code: { contains: toEnDigits(q) } }] } : {}) } };
    const [rows, total] = await Promise.all([
      this.prisma.visit.findMany({ where, orderBy: [{ opDate: 'desc' }, { id: 'desc' }], take: 25, skip: (current - 1) * 25,
        select: { id: true, seq: true, opDate: true, opStartTime: true, opEndTime: true, opStatus: true, opType: true, hospitalName: true, surgeonName: true, requiredItems: true, surgeonInstructions: true,
          patient: { select: { code: true, firstName: true, lastName: true } }, hospital: { select: { name: true } }, procedureType: { select: { name: true, needs: { where: { item: { active: true } }, select: { itemId: true, quantity: true, notes: true, item: { select: { name: true, size: true } } } } } },
          surgeon: { select: { person: { select: { firstName: true, lastName: true } } } },
          clinicalNotes: { where: { kind: 'op', replacedAt: null }, select: { body: true, createdAt: true }, orderBy: { id: 'desc' }, take: 1 },
          documents: { where: { deletedAt: null, category: { in: ['report', 'op-report', 'other'] } }, select: { id: true, title: true, fileName: true }, orderBy: { id: 'desc' } },
        } }),
      this.prisma.visit.count({ where }),
    ]);
    return { rows: rows.map(v => ({ id: v.id, code: `${v.patient.code}-V${v.seq}`, fullName: `${v.patient.firstName} ${v.patient.lastName}`.trim(),
      opDate: v.opDate, opStartTime: v.opStartTime, opEndTime: v.opEndTime, opStatus: v.opStatus, procedure: v.procedureType?.name ?? v.opType,
      hospital: v.hospital?.name ?? v.hospitalName, surgeon: v.surgeon ? `${v.surgeon.person.firstName} ${v.surgeon.person.lastName}` : v.surgeonName,
      requiredItems: v.requiredItems ?? v.procedureType?.needs.map(n => ({ itemId: n.itemId, quantity: n.quantity, notes: n.notes ?? '', name: [n.item.name, n.item.size].filter(Boolean).join(' ') })) ?? [], instructions: v.surgeonInstructions ?? '', report: v.clinicalNotes[0]?.body ?? null, documents: v.documents,
    })), total, page: current, pages: Math.max(1, Math.ceil(total / 25)), workflow: await this.config.vertical() };
  }

  async finances(user: any, selectedId?: number, page = 1) {
    const scope = await this.scope(user);
    const surgeonId = scope.surgeonId ?? selectedId;
    if (!Number.isInteger(surgeonId) || !surgeonId || surgeonId < 1) return { selectionRequired: true, rows: [], total: 0 };
    const surgeon = await this.prisma.surgeon.findFirst({ where: { id: surgeonId, active: true }, select: { person: { select: { firstName: true, lastName: true } } } });
    if (!surgeon) throw new NotFoundException('جراح فعال پیدا نشد');
    const current = Number.isFinite(page) ? Math.max(1, Math.min(100000, Math.floor(page))) : 1;
    const visitScope = { surgeonId, patient: { deletedAt: null } };
    const shares = { party: 'surgeon', partyId: surgeonId, settlement: { status: 'final', supersededAt: null, visit: visitScope } };
    const payouts = { party: 'surgeon', partyId: surgeonId, visit: visitScope };
    return this.prisma.$transaction(async tx => {
      const [earned, paid, total, visits] = await Promise.all([
        tx.shareEntry.aggregate({ where: shares, _sum: { amount: true } }),
        tx.payout.aggregate({ where: payouts, _sum: { amount: true } }),
        tx.visit.count({ where: visitScope }),
        tx.visit.findMany({ where: visitScope, orderBy: [{ opDate: 'desc' }, { id: 'desc' }], take: 25, skip: (current - 1) * 25,
          select: { id: true, seq: true, opDate: true, hospitalName: true, hospital: { select: { name: true } }, patient: { select: { code: true, firstName: true, lastName: true } },
            settlements: { where: { status: 'final', supersededAt: null }, select: { entries: { where: { party: 'surgeon', partyId: surgeonId }, select: { amount: true } } } },
            payouts: { where: { party: 'surgeon', partyId: surgeonId }, select: { id: true, amount: true, paidAt: true, reference: true }, orderBy: { paidAt: 'desc' } },
          } }),
      ]);
      return { surgeon: `${surgeon.person.firstName} ${surgeon.person.lastName}`, currency: 'تومان', earned: earned._sum.amount ?? 0, paid: paid._sum.amount ?? 0,
        balance: (earned._sum.amount ?? 0) - (paid._sum.amount ?? 0), total, page: current, pages: Math.max(1, Math.ceil(total / 25)),
        rows: visits.map(v => { const due = v.settlements.flatMap(s => s.entries).reduce((n, e) => n + e.amount, 0), paid = v.payouts.reduce((n, p) => n + p.amount, 0);
          return { id: v.id, code: `${v.patient.code}-V${v.seq}`, patient: `${v.patient.firstName} ${v.patient.lastName}`, date: v.opDate, hospital: v.hospital?.name ?? v.hospitalName, finalized: v.settlements.length > 0, earned: due, paid, balance: due - paid, payments: v.payouts };
        }) };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async saveInstructions(id: number, dto: { instructions: string; requiredItems?: RequiredItemInput[] }, user: any) {
    const before = await this.visit(id, user);
    const scope = await this.scope(user);
    const requiredItems = dto.requiredItems === undefined ? undefined : await resolveRequirements(this.prisma, dto.requiredItems);
    const after = { surgeonInstructions: dto.instructions.trim(), ...(requiredItems !== undefined ? { requiredItems } : {}) };
    await this.prisma.$transaction(async tx => {
      const result = await tx.visit.updateMany({ where: { id, ...scope, patient: { deletedAt: null } }, data: after });
      if (!result.count) throw new NotFoundException('مراجعه پیدا نشد');
      await tx.auditEvent.create({ data: { actorId: user.id, action: 'surgeon.instructions', entityType: 'visit', entityId: String(id), beforeJson: { surgeonInstructions: before.surgeonInstructions, requiredItems: before.requiredItems }, afterJson: after } });
    });
    return { ok: true };
  }

  async document(id: number, documentId: number, user: any) {
    await this.visit(id, user);
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, visitId: id, deletedAt: null, category: { in: ['report', 'op-report', 'other'] } } });
    if (!doc) throw new NotFoundException('مدرک پیدا نشد');
    return doc;
  }

  async items(user: any, query = '') {
    await this.scope(user);
    return this.prisma.item.findMany({ where: { active: true, name: { contains: toEnDigits(query.trim().slice(0, 80)), mode: 'insensitive' } }, take: 100, orderBy: { name: 'asc' }, select: { id: true, name: true, size: true, unit: true } });
  }

  async grantAccount(surgeonId: number, user: any) {
    if ((user?.level ?? 0) < LEVEL.SUPER_ADMIN) throw new ForbiddenException('ایجاد حساب جراح فقط برای مدیر سامانه مجاز است');
    await this.scope(user);
    const surgeon = await this.prisma.surgeon.findFirst({ where: { id: surgeonId, active: true }, include: { person: { include: { account: true } } } });
    if (!surgeon) throw new NotFoundException('جراح پیدا نشد');
    if (!/^09\d{9}$/.test(surgeon.person.phone ?? '')) throw new BadRequestException('شماره موبایل جراح را در تعاریف پایه کامل کنید');
    if (surgeon.person.account) return { id: surgeon.person.account.id, existing: true, level: surgeon.person.account.level, status: surgeon.person.account.status };
    const account = await this.prisma.account.create({ data: { personId: surgeon.personId, passwordHash: '', level: LEVEL.TECH, status: 'active', verificationDueAt: verificationDeadline(), jobRole: 'doctor', approvedById: user.id, approvedAt: new Date() } });
    await this.audit.record({ actorId: user.id, action: 'surgeon.account.create', entityType: 'account', entityId: account.id, after: { surgeonId, personId: surgeon.personId } });
    return { id: account.id, existing: false, level: account.level, status: account.status };
  }
}
