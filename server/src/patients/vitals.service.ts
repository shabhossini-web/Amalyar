import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { actorName } from '../common/person';
import { PatientsService } from './patients.service';
import { vitalsInput, vitalView } from './vitals';

/**
 * علائمِ حیاتیِ یک مراجعه — هر نوبتِ اندازه‌گیری یک ردیف (بستهٔ ۶ج).
 *
 * ⚠️ دامنه از همان `assertVisitAccess`ِ مراجعه‌ها می‌آید، نه کپیِ آن: کسی که
 * مراجعه را نمی‌بیند، علائمِ حیاتی‌اش را هم نباید ببیند.
 */
@Injectable()
export class VitalsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private patients: PatientsService) {}

  async list(visitId: number, user: any) {
    await this.patients.assertVisitAccess(visitId, user);
    const rows = await this.prisma.vitalSign.findMany({
      where: { visitId }, orderBy: [{ takenAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(vitalView);
  }

  async add(visitId: number, raw: any, user: any) {
    const v = await this.patients.assertVisitAccess(visitId, user);
    const row = vitalsInput(raw);
    if (!row) throw new BadRequestException('دستِ‌کم یکی از علائمِ حیاتی را وارد کنید');
    const created = await this.prisma.vitalSign.create({
      data: {
        ...row, visitId, patientId: v.patientId,
        recordedById: user?.id ?? null, recordedByName: actorName(user),
      },
    });
    await this.audit.record({
      actorId: user?.id, action: 'visit.vitals', entityType: 'visit', entityId: visitId, after: vitalView(created),
    });
    return vitalView(created);
  }

  /** «اشتباه ثبت شد» — حذف با ردِ ممیزی؛ اندازه‌گیریِ درست را ویرایش نمی‌کنیم، دوباره ثبت می‌کنیم. */
  async remove(visitId: number, id: number, user: any) {
    await this.patients.assertVisitAccess(visitId, user);
    const row = await this.prisma.vitalSign.findFirst({ where: { id, visitId } });
    if (!row) throw new NotFoundException('این اندازه‌گیری پیدا نشد');
    await this.prisma.vitalSign.delete({ where: { id } });
    await this.audit.record({
      actorId: user?.id, action: 'visit.vitals_delete', entityType: 'visit', entityId: visitId, before: vitalView(row),
    });
    return { ok: true };
  }
}
