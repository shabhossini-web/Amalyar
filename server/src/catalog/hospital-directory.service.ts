import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ControlPrismaService } from '../tenant/control-prisma.service';
import { SECTORS } from '../patients/service-codes.service';
import seed from './hospitals.seed.json';
import sectorReviews from './hospital-sector-review.json';
const reviews = new Map<string, any>(sectorReviews.map(r => [r.id, r]));
import { toEnDigits } from '../common/identity';

export const hospitalText = (s: any) => toEnDigits(String(s ?? '')).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\u064b-\u065f\u200c]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
export const hospitalSnapshot = (h: any) => ({ name: h.name, province: h.province, city: h.city, address: h.address, phone: h.phone, sector: h.sector, sectorReview: h.sectorReview ?? null, updatedAt: new Date(h.updatedAt).toISOString() });
const nullable = (v: any, max: number) => { if (v == null || v === '') return null; if (typeof v !== 'string' || v.length > max) throw new BadRequestException('متن فیلد نامعتبر یا بیش از حد طولانی است'); return v.trim() || null; };
export function directoryRow(dto: any) {
  const name = nullable(dto.name, 180); if (!name || name.length < 2) throw new BadRequestException('نام بیمارستان را کامل کنید');
  const sourceUrl = nullable(dto.sourceUrl, 500), website = nullable(dto.website, 500);
  for (const url of [sourceUrl, website]) if (url) { try { const u = new URL(url); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw Error(); } catch { throw new BadRequestException('نشانی وب باید http یا https معتبر باشد'); } }
  const data = { name, province: nullable(dto.province, 80), city: nullable(dto.city, 80), address: nullable(dto.address, 600), phone: nullable(dto.phone, 100), sector: nullable(dto.sector, 20), website, sourceUrl, sourceName: nullable(dto.sourceName, 180), verified: dto.verified === true, active: dto.active !== false };
  if (data.sector && !(SECTORS as readonly string[]).includes(data.sector)) throw new BadRequestException('نوع بیمارستان نامعتبر است');
  if (data.verified && (!sourceUrl || !data.phone || !data.address || !data.province || !data.city)) throw new BadRequestException('برای تأیید اطلاعات، منبع، استان، شهر، تلفن و آدرس لازم است');
  return { ...data, checkedAt: dto.checkedAt ? new Date(dto.checkedAt) : data.verified ? new Date() : null, searchText: hospitalText([name, data.province, data.city, data.address, data.phone].join(' ')) };
}

@Injectable()
export class HospitalDirectoryService implements OnModuleInit {
  constructor(private readonly control: ControlPrismaService) {}
  async onModuleInit() {
    // Bundled public facts are inserted once. Operator edits are never overwritten by deployment.
    if (!seed.length) return;
    await this.control.centralHospital.createMany({ data: seed.map((row: any) => ({ id: row.id, sourceKey: row.id, ...directoryRow(row), sectorReview: reviews.get(row.id), sectorRevision: reviews.get(row.id)?.revision ?? 0 })), skipDuplicates: true });
    // Upgrade deployed seeds once. Contacts and deliberate operator choices remain independent.
    const stale = await this.control.centralHospital.findMany({ where: { sourceKey: { in: [...reviews.keys()] }, sectorRevision: { lt: 1 } } });
    if (stale.length) await this.control.$transaction(async tx => {
      const applied: any[] = [];
      for (const old of stale) {
        const review = reviews.get(old.sourceKey);
        const sector = old.sector === review.previousSector ? review.sector : old.sector;
        const result = await tx.centralHospital.updateMany({ where: { id: old.id, updatedAt: old.updatedAt, sectorRevision: old.sectorRevision }, data: { sector, sectorReview: review, sectorRevision: review.revision } });
        if (result.count) applied.push({ id: old.id, before: old.sector, after: sector, suggested: review.sector });
      }
      if (applied.length) await tx.platformAuditEvent.create({ data: { actorHash: 'system:hospital-sector-review', ipHash: 'system', action: 'platform.hospital.sector_review', targetType: 'central_hospital', targetId: 'review:1', metadata: { revision: 1, applied } } });
    }, { timeout: 30000 });
  }
  async list(query: any = {}, admin = false) {
    const page = Math.max(1, Math.min(10000, Math.trunc(Number(query.page) || 1)));
    const take = 50, terms = hospitalText(query.q).slice(0, 180).split(' ').filter(Boolean);
    const where: any = { ...(admin && query.all === '1' ? {} : { active: true }), ...(query.province ? { province: String(query.province).slice(0, 80) } : {}), ...(query.city ? { city: String(query.city).slice(0, 80) } : {}), ...(query.sector === 'unknown' ? { sector: null } : (SECTORS as readonly string[]).includes(query.sector) ? { sector: query.sector } : {}), ...(query.incomplete === '1' ? { OR: [{ phone: null }, { address: null }, { verified: false }] } : {}), ...(terms.length ? { AND: terms.map(t => ({ searchText: { contains: toEnDigits(t) } })) } : {}) };
    const [rows, total, provinces, full, checked] = await Promise.all([
      this.control.centralHospital.findMany({ where, orderBy: [{ province: 'asc' }, { city: 'asc' }, { name: 'asc' }], skip: (page - 1) * take, take }),
      this.control.centralHospital.count({ where }),
      this.control.centralHospital.groupBy({ by: ['province'], where: { active: true }, _count: true, orderBy: { province: 'asc' } }),
      this.control.centralHospital.count({ where: { active: true } }),
      this.control.centralHospital.count({ where: { active: true, verified: true } }),
    ]);
    return { rows, total, page, pages: Math.max(1, Math.ceil(total / take)), provinces: provinces.map(p => ({ name: p.province, count: p._count })), coverage: { total: full, verified: checked, completeNationalRegistry: false } };
  }
  async get(id: string) { const row = await this.control.centralHospital.findUnique({ where: { id } }); if (!row || !row.active) throw new NotFoundException('بیمارستان مرکزی یافت نشد یا غیرفعال است'); return row; }
  async save(dto: any, actorHash: string, ipHash: string) {
    const data = directoryRow(dto);
    if (data.checkedAt && !Number.isFinite(data.checkedAt.getTime())) throw new BadRequestException('تاریخ بررسی نامعتبر است');
    return this.control.$transaction(async tx => {
      if (dto.id && dto.confirmSector === true) {
        const old = await tx.centralHospital.findUnique({ where: { id: dto.id } });
        if (!old || !data.sector) throw new BadRequestException('بیمارستان و نوع تعرفه را انتخاب کنید');
        if (old.sectorReview) (data as any).sectorReview = { ...(old.sectorReview as any), requiresConfirmation: false, confirmedSector: data.sector, confirmedAt: new Date().toISOString(), confirmedBy: actorHash };
      }
      const row = dto.id ? await tx.centralHospital.update({ where: { id: dto.id }, data }) : await tx.centralHospital.create({ data: { ...data, sourceKey: `manual:${randomUUID()}` } });
      await tx.platformAuditEvent.create({ data: { actorHash, ipHash, action: 'platform.hospital.save', targetType: 'central_hospital', targetId: row.id, metadata: { name: row.name, active: row.active, verified: row.verified, sector: row.sector, confirmSector: dto.confirmSector === true } } });
      return row;
    });
  }
}
