import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HospitalDirectoryService, hospitalSnapshot, hospitalText } from '../catalog/hospital-directory.service';
import { SECTORS } from './service-codes.service';
const matchName = (s: string) => hospitalText(s).replace(/بیمارستان/g, '').trim();
@Injectable()
export class TenantHospitalDirectoryService {
  constructor(private prisma: PrismaService, private directory: HospitalDirectoryService) {}
  async list(query: any) {
    const result = await this.directory.list(query);
    const local = await this.prisma.hospital.findMany({ select: { id: true, centralId: true, name: true, city: true, sector: true } });
    return { ...result, rows: result.rows.map(h => ({ ...h, localId: local.find(l => l.centralId === h.id)?.id ?? null, localSector: local.find(l => l.centralId === h.id)?.sector ?? null, candidates: local.filter(l => !l.centralId && matchName(l.name) === matchName(h.name) && (!l.city || !h.city || hospitalText(l.city) === hospitalText(h.city))) })) };
  }
  async load(dto: { ids: string[]; sector?: string; localId?: number; fillMissing?: boolean; applySector?: boolean }, actorId: number) {
    if (!Array.isArray(dto.ids) || !dto.ids.length || dto.ids.length > 200 || dto.ids.some(id => typeof id !== 'string' || id.length > 100)) throw new BadRequestException('بین یک تا ۲۰۰ بیمارستان را انتخاب کنید');
    if (dto.localId && dto.ids.length !== 1) throw new BadRequestException('اتصال به مورد موجود باید تکی انجام شود');
    if (dto.sector && !(SECTORS as readonly string[]).includes(dto.sector)) throw new BadRequestException('نوع تعرفه نامعتبر است');
    const rows = await Promise.all([...new Set(dto.ids)].map(id => this.directory.get(id)));
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(73190523)');
      const results: any[] = [];
      for (const h of rows) {
        let local = await tx.hospital.findUnique({ where: { centralId: h.id } });
        if (dto.localId) {
          const target = await tx.hospital.findUnique({ where: { id: dto.localId } });
          if (!target || (target.centralId && target.centralId !== h.id) || (local && local.id !== target.id)) throw new BadRequestException('اتصال انتخابی با سابقه بیمارستان سازگار نیست');
          local = target;
        }
        if (local) {
          const patch: any = { centralId: h.id, centralSnapshot: hospitalSnapshot(h) };
          if (dto.applySector) {
            const review = h.sectorReview as any;
            const sector = review?.requiresConfirmation ? dto.sector : h.sector;
            if (!sector) throw new BadRequestException('نوع تعرفه این بیمارستان نیازمند تأیید است؛ گروه مورد قرارداد را انتخاب کنید');
            patch.sector = sector;
          }
          if (dto.fillMissing) for (const key of ['province', 'city', 'address', 'phone']) if (!local[key] && h[key]) patch[key] = h[key];
          await tx.hospital.update({ where: { id: local.id }, data: patch });
          results.push({ centralId: h.id, localId: local.id, status: 'linked', name: local.name });
          await tx.auditEvent.create({ data: { actorId, action: 'hospital.directory.link', entityType: 'hospital', entityId: String(local.id), afterJson: { centralId: h.id, fillMissing: !!dto.fillMissing, applySector: !!dto.applySector, sectorBefore: local.sector, sectorAfter: patch.sector ?? local.sector } } });
          continue;
        }
        const matches = (await tx.hospital.findMany({ select: { id: true, name: true, city: true } })).filter(l => matchName(l.name) === matchName(h.name) && (!l.city || !h.city || hospitalText(l.city) === hospitalText(h.city)));
        if (matches.length) { results.push({ centralId: h.id, status: 'needs_link', name: h.name, candidates: matches }); continue; }
        const sector = (h.sectorReview as any)?.requiresConfirmation ? dto.sector : h.sector || dto.sector;
        if (!sector) { results.push({ centralId: h.id, status: 'needs_sector', name: h.name }); continue; }
        const added = await tx.hospital.create({ data: { name: h.name, province: h.province, city: h.city, address: h.address, phone: h.phone, sector, centralId: h.id, centralSnapshot: hospitalSnapshot(h) } });
        results.push({ centralId: h.id, localId: added.id, status: 'created', name: h.name });
        await tx.auditEvent.create({ data: { actorId, action: 'hospital.directory.import', entityType: 'hospital', entityId: String(added.id), afterJson: { centralId: h.id, sourceUrl: h.sourceUrl } } });
      }
      return { results, created: results.filter(r => r.status === 'created').length, linked: results.filter(r => r.status === 'linked').length, pending: results.filter(r => r.status.startsWith('needs_')).length };
    }, { timeout: 30000 });
  }
}
