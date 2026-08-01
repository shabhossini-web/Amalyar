import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toEnDigits } from '../common/identity';
import { LEVEL } from '../common/levels';
import { buildPersonPatch, PersonInput } from '../common/person';

const STAFF_ROLE_FA: Record<string, string> = { driver: 'راننده', courier: 'پیک' };

/**
 * تعریف‌های عملیاتیِ ماژولِ بیماران: جراحان و بیمارستان‌ها (+ فهرستِ کارشناسان).
 * موجودیتِ استفاده‌شده در مراجعه‌ها حذفِ سخت نمی‌شود — غیرفعال (active=false) می‌شود
 * تا دادهٔ تاریخی سالم بماند.
 */
@Injectable()
export class DefinitionsService {
  constructor(private prisma: PrismaService) {}

  private async hospitalDupCheck(name: string, exceptId?: number) {
    const row = await this.prisma.hospital.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (row) throw new BadRequestException('این نام قبلاً ثبت شده است');
  }

  /// جراح = نقش روی Person؛ نام و تلفن از همان‌جا می‌آیند، نه از خودِ رکوردِ جراح.
  private surgeonView(s: any) {
    const p = s.person;
    return {
      id: s.id,
      personId: s.personId,
      name: `${p.firstName} ${p.lastName}`.trim(),
      firstName: p.firstName,
      lastName: p.lastName,
      phone: p.phone,
      nationalId: p.nationalId,
      email: p.email,
      city: p.city,
      address: p.address,
      iban: p.iban,
      photo: p.photo,
      notes: p.notes,
      specialty: s.specialty,
      licenseNo: s.licenseNo,
      active: s.active,
      visitCount: s._count.visits,
    };
  }

  private static readonly SURGEON_INCLUDE = {
    person: true,
    _count: { select: { visits: true } },
  } as const;

  async listSurgeons() {
    const rows = await this.prisma.surgeon.findMany({
      orderBy: [{ active: 'desc' }, { person: { lastName: 'asc' } }],
      include: DefinitionsService.SURGEON_INCLUDE,
    });
    return rows.map((s) => this.surgeonView(s));
  }

  async createSurgeon(dto: PersonInput & { specialty?: string; licenseNo?: string }) {
    const row = await this.prisma.surgeon.create({
      data: {
        specialty: dto.specialty?.trim() || null,
        licenseNo: dto.licenseNo?.trim() || null,
        person: { create: buildPersonPatch(dto, true) as any },
      },
      include: DefinitionsService.SURGEON_INCLUDE,
    });
    return this.surgeonView(row);
  }

  async updateSurgeon(id: number, dto: PersonInput & { specialty?: string; licenseNo?: string; active?: boolean }) {
    const s = await this.prisma.surgeon.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('جراح یافت نشد');
    const personPatch = buildPersonPatch(dto, false);
    const updated = await this.prisma.surgeon.update({
      where: { id },
      data: {
        ...(dto.specialty !== undefined ? { specialty: dto.specialty?.trim() || null } : {}),
        ...(dto.licenseNo !== undefined ? { licenseNo: dto.licenseNo?.trim() || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(Object.keys(personPatch).length ? { person: { update: personPatch } } : {}),
      },
      include: DefinitionsService.SURGEON_INCLUDE,
    });
    // ⚠️ عمداً visit.surgeonName را به‌روز نمی‌کنیم: آن فیلد «عکسِ لحظهٔ ثبت» است و
    // فقط وقتی خوانده می‌شود که رابطه از بین رفته باشد. خواندن همیشه رابطه را
    // ترجیح می‌دهد، پس تغییرِ نام بلافاصله همه‌جا دیده می‌شود بدونِ هیچ همگام‌سازی.
    return this.surgeonView(updated);
  }

  async deleteSurgeon(id: number) {
    const s = await this.prisma.surgeon.findUnique({
      where: { id },
      include: { _count: { select: { visits: true } } },
    });
    if (!s) throw new NotFoundException('جراح یافت نشد');
    if (s._count.visits > 0) {
      await this.prisma.surgeon.update({ where: { id }, data: { active: false } });
      return { ok: true, deactivated: true };
    }
    await this.prisma.surgeon.delete({ where: { id } });
    return { ok: true, deactivated: false };
  }

  // ── نیروی حمل‌ونقل (راننده و پیک) ─────────────────────────────
  // ⚠️ این‌جا تعریف می‌شوند نه در «کاربران»: راننده به سامانه وارد نمی‌شود، پس
  // اجبار به ساختنِ حسابِ کاربری (با مسیرِ ثبت‌نامِ OTP) یعنی در عمل هیچ راننده‌ای
  // تعریف نمی‌شود. الگو همان جراح است: هویت در Person، نقش در جدولِ خودش.

  private static readonly STAFF_INCLUDE = {
    person: true,
    _count: { select: { assignments: true } },
  } as const;

  private staffView(s: any) {
    const p = s.person;
    return {
      id: s.id,
      personId: s.personId,
      name: `${p.firstName} ${p.lastName}`.trim(),
      firstName: p.firstName,
      lastName: p.lastName,
      phone: p.phone,
      nationalId: p.nationalId,
      city: p.city,
      address: p.address,
      iban: p.iban,
      photo: p.photo,
      notes: s.notes ?? p.notes,
      role: s.role,
      roleLabel: STAFF_ROLE_FA[s.role] ?? s.role,
      vehicle: s.vehicle,
      active: s.active,
      missionCount: s._count.assignments,
    };
  }

  async listTransportStaff() {
    const rows = await this.prisma.transportStaff.findMany({
      orderBy: [{ active: 'desc' }, { role: 'asc' }, { person: { lastName: 'asc' } }],
      include: DefinitionsService.STAFF_INCLUDE,
    });
    return rows.map((s) => this.staffView(s));
  }

  async createTransportStaff(dto: PersonInput & { role: string; vehicle?: string; notes?: string }) {
    const row = await this.prisma.transportStaff.create({
      data: {
        role: dto.role,
        vehicle: dto.vehicle?.trim() || null,
        notes: dto.notes?.trim() || null,
        person: { create: buildPersonPatch(dto, true) as any },
      },
      include: DefinitionsService.STAFF_INCLUDE,
    });
    return this.staffView(row);
  }

  async updateTransportStaff(id: number, dto: PersonInput & { role?: string; vehicle?: string; notes?: string; active?: boolean }) {
    const s = await this.prisma.transportStaff.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('نیرو یافت نشد');
    const personPatch = buildPersonPatch(dto, false);
    const updated = await this.prisma.transportStaff.update({
      where: { id },
      data: {
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.vehicle !== undefined ? { vehicle: dto.vehicle?.trim() || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(Object.keys(personPatch).length ? { person: { update: personPatch } } : {}),
      },
      include: DefinitionsService.STAFF_INCLUDE,
    });
    return this.staffView(updated);
  }

  /// نیرویی که مأموریت داشته غیرفعال می‌شود نه حذف — وگرنه چینشِ گذشته بی‌راننده می‌شود.
  async deleteTransportStaff(id: number) {
    const s = await this.prisma.transportStaff.findUnique({
      where: { id },
      include: { _count: { select: { assignments: true } } },
    });
    if (!s) throw new NotFoundException('نیرو یافت نشد');
    if (s._count.assignments > 0) {
      await this.prisma.transportStaff.update({ where: { id }, data: { active: false } });
      return { ok: true, deactivated: true };
    }
    await this.prisma.transportStaff.delete({ where: { id } });
    return { ok: true, deactivated: false };
  }

  async listHospitals() {
    const rows = await this.prisma.hospital.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { visits: true } } },
    });
    return rows.map((h) => ({
      id: h.id, name: h.name, city: h.city, address: h.address, phone: h.phone,
      contactName: h.contactName, contactPhone: h.contactPhone, notes: h.notes,
      active: h.active, visitCount: h._count.visits,
    }));
  }

  async createHospital(dto: { name: string; city?: string; address?: string; phone?: string; contactName?: string; contactPhone?: string; notes?: string }) {
    await this.hospitalDupCheck(dto.name);
    return this.prisma.hospital.create({
      data: {
        name: dto.name.trim(),
        city: dto.city?.trim() || null,
        address: dto.address?.trim() || null,
        phone: dto.phone?.trim() || null,
        contactName: dto.contactName?.trim() || null,
        contactPhone: dto.contactPhone?.trim() || null,
        notes: dto.notes?.trim() || null,
      },
    });
  }

  async updateHospital(
    id: number,
    dto: { name?: string; city?: string; address?: string; phone?: string; contactName?: string; contactPhone?: string; notes?: string; active?: boolean },
  ) {
    const h = await this.prisma.hospital.findUnique({ where: { id } });
    if (!h) throw new NotFoundException('بیمارستان یافت نشد');
    if (dto.name) await this.hospitalDupCheck(dto.name, id);
    const updated = await this.prisma.hospital.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.city !== undefined ? { city: dto.city?.trim() || null } : {}),
        ...(dto.address !== undefined ? { address: dto.address?.trim() || null } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
        ...(dto.contactName !== undefined ? { contactName: dto.contactName?.trim() || null } : {}),
        ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone?.trim() || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    // همان استدلالِ جراح: hospitalName عکسِ لحظه‌ای است و بازنویسی نمی‌شود.
    return updated;
  }

  async deleteHospital(id: number) {
    const h = await this.prisma.hospital.findUnique({
      where: { id },
      include: { _count: { select: { visits: true } } },
    });
    if (!h) throw new NotFoundException('بیمارستان یافت نشد');
    if (h._count.visits > 0) {
      await this.prisma.hospital.update({ where: { id }, data: { active: false } });
      return { ok: true, deactivated: true };
    }
    await this.prisma.hospital.delete({ where: { id } });
    return { ok: true, deactivated: false };
  }

  async listTechs() {
    const rows = await this.prisma.account.findMany({
      where: { status: 'active', level: { gte: LEVEL.TECH, lte: LEVEL.SUPERVISOR } },
      orderBy: { person: { lastName: 'asc' } },
      include: { person: true },
    });
    return rows.map((a) => ({
      id: a.id,
      displayName: `${a.person.firstName} ${a.person.lastName}`.trim() || a.username || a.person.phone,
    }));
  }

  // ── انواعِ عمل و تشخیص‌ها ────────────────────────────────────
  // موجودیت‌اند نه متنِ آزاد، تا گزارش‌گیری و تحلیل روی داده ممکن باشد.

  async listProcedureTypes() {
    const rows = await this.prisma.procedureType.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { visits: true } } },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, code: r.code, notes: r.notes, active: r.active, visitCount: r._count.visits }));
  }

  async createProcedureType(dto: { name: string; code?: string; notes?: string }) {
    await this.uniqueName('procedureType', 'name', dto.name);
    return this.prisma.procedureType.create({
      data: { name: dto.name.trim(), code: dto.code?.trim() || null, notes: dto.notes?.trim() || null },
    });
  }

  async updateProcedureType(id: number, dto: { name?: string; code?: string; notes?: string; active?: boolean }) {
    const row = await this.prisma.procedureType.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('نوعِ عمل یافت نشد');
    if (dto.name) await this.uniqueName('procedureType', 'name', dto.name, id);
    return this.prisma.procedureType.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.code !== undefined ? { code: dto.code?.trim() || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }

  async deleteProcedureType(id: number) {
    return this.deleteOrDeactivate('procedureType', id, 'نوعِ عمل یافت نشد');
  }

  async listDiagnoses() {
    const rows = await this.prisma.diagnosis.findMany({
      orderBy: [{ active: 'desc' }, { title: 'asc' }],
      include: { _count: { select: { visits: true } } },
    });
    return rows.map((r) => ({ id: r.id, title: r.title, icdCode: r.icdCode, active: r.active, visitCount: r._count.visits }));
  }

  async createDiagnosis(dto: { title: string; icdCode?: string }) {
    await this.uniqueName('diagnosis', 'title', dto.title);
    return this.prisma.diagnosis.create({
      data: { title: dto.title.trim(), icdCode: dto.icdCode?.trim() || null },
    });
  }

  async updateDiagnosis(id: number, dto: { title?: string; icdCode?: string; active?: boolean }) {
    const row = await this.prisma.diagnosis.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('تشخیص یافت نشد');
    if (dto.title) await this.uniqueName('diagnosis', 'title', dto.title, id);
    return this.prisma.diagnosis.update({
      where: { id },
      data: {
        ...(dto.title ? { title: dto.title.trim() } : {}),
        ...(dto.icdCode !== undefined ? { icdCode: dto.icdCode?.trim() || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }

  async deleteDiagnosis(id: number) {
    return this.deleteOrDeactivate('diagnosis', id, 'تشخیص یافت نشد');
  }


  // ───────────────────────── کالا ─────────────────────────

  /**
   * فهرست/جستجوی کالا.
   *
   * جستجو روی نام، SKU و برند است — انباردار معمولاً کد را می‌داند و کاربرِ
   * اتاقِ عمل نام را؛ هر دو باید به یک نتیجه برسند.
   */
  async listItems(q?: string) {
    const t = q?.trim();
    const rows = await this.prisma.item.findMany({
      where: t
        ? {
            OR: [
              { name: { contains: t, mode: 'insensitive' } },
              { sku: { contains: t, mode: 'insensitive' } },
              { brand: { contains: t, mode: 'insensitive' } },
              { irc: { contains: t } },
            ],
          }
        : {},
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      take: 200,
      include: { _count: { select: { charges: true } } },
    });
    return rows.map((r) => ({
      id: r.id, name: r.name, sku: r.sku, irc: r.irc, brand: r.brand, size: r.size,
      category: r.category, unit: r.unit, price: r.price, notes: r.notes, active: r.active,
      assetKind: r.assetKind, turnaroundHours: r.turnaroundHours,
      usedCount: r._count.charges,
    }));
  }

  async createItem(dto: any) {
    return this.prisma.item.create({ data: itemPatch(dto, true) as any });
  }

  async updateItem(id: number, dto: any) {
    const row = await this.prisma.item.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('کالا یافت نشد');
    return this.prisma.item.update({ where: { id }, data: itemPatch(dto, false) });
  }

  /// کالایی که در فاکتوری استفاده شده یا لاتِ انبار دارد حذفِ سخت نمی‌شود —
  /// همان قاعدهٔ بقیهٔ تعاریف. (لات هم FKِ RESTRICT دارد؛ این‌جا پیش از رسیدن
  /// به خطای خامِ دیتابیس، پیامِ درست داده می‌شود.)
  async deleteItem(id: number) {
    const row = await this.prisma.item.findUnique({
      where: { id },
      include: { _count: { select: { charges: true, lots: true } } },
    });
    if (!row) throw new NotFoundException('کالا یافت نشد');
    if (row._count.charges > 0 || row._count.lots > 0) {
      await this.prisma.item.update({ where: { id }, data: { active: false } });
      return { ok: true, deactivated: true };
    }
    await this.prisma.item.delete({ where: { id } });
    return { ok: true, deactivated: false };
  }

  private async uniqueName(model: 'procedureType' | 'diagnosis', field: 'name' | 'title', value: string, exceptId?: number) {
    const row = await (this.prisma[model] as any).findFirst({
      where: { [field]: { equals: value.trim(), mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (row) throw new BadRequestException('این عنوان قبلاً ثبت شده است');
  }

  /// موجودیتی که در مراجعه‌ای استفاده شده حذفِ سخت نمی‌شود — غیرفعال می‌شود تا
  /// دادهٔ تاریخی نشکند. همان قاعدهٔ جراح و بیمارستان.
  private async deleteOrDeactivate(model: 'procedureType' | 'diagnosis', id: number, notFound: string) {
    const row = await (this.prisma[model] as any).findUnique({
      where: { id },
      include: { _count: { select: { visits: true } } },
    });
    if (!row) throw new NotFoundException(notFound);
    if (row._count.visits > 0) {
      await (this.prisma[model] as any).update({ where: { id }, data: { active: false } });
      return { ok: true, deactivated: true };
    }
    await (this.prisma[model] as any).delete({ where: { id } });
    return { ok: true, deactivated: false };
  }
}


/**
 * نرمال‌سازیِ فیلدهای کالا — یک قاعده برای ساخت و ویرایش.
 * قیمت عددِ صحیحِ تومان است؛ ارقامِ فارسی و جداکنندهٔ هزارگان پذیرفته می‌شوند.
 */
function itemPatch(dto: any, forCreate: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() || null : null);

  if (forCreate || dto.name !== undefined) {
    const name = text(dto.name);
    if (forCreate && (!name || name.length < 2)) throw new BadRequestException('نامِ کالا را کامل وارد کنید');
    if (name !== null) out.name = name;
  }
  for (const key of ['sku', 'irc', 'brand', 'size', 'category', 'notes']) {
    if (dto[key] !== undefined) out[key] = text(dto[key]);
  }
  if (dto.unit !== undefined) out.unit = text(dto.unit) || 'عدد';
  if (dto.active !== undefined) out.active = !!dto.active;
  if (dto.assetKind !== undefined) out.assetKind = text(dto.assetKind) || 'consumable';
  if (dto.turnaroundHours !== undefined) {
    const h = dto.turnaroundHours === null || dto.turnaroundHours === '' ? null : Number(dto.turnaroundHours);
    if (h !== null && (!Number.isInteger(h) || h < 0)) throw new BadRequestException('ساعتِ آماده‌سازی باید عددِ صحیحِ نامنفی باشد');
    out.turnaroundHours = h;
  }

  if (dto.price !== undefined) {
    if (dto.price === null || dto.price === '') out.price = null;
    else {
      const n = Number(toEnDigits(String(dto.price)).replace(/[^0-9]/g, ''));
      if (!Number.isInteger(n) || n < 0) throw new BadRequestException('قیمت باید عددِ صحیحِ نامنفی باشد');
      out.price = n;
    }
  }
  return out;
}
