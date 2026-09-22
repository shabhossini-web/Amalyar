import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toEnDigits } from '../common/identity';
import { textSearchOr } from '../common/search';
import { LEVEL } from '../common/levels';
import { buildPersonPatch, PersonInput } from '../common/person';
import { NOTE_KINDS } from './record.service';
import { NOTE_KIND_LABELS } from './labels';

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
    _count: { select: { runs: true } },
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
      missionCount: s._count.runs,
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

  /// نیرویی که مسیر داشته غیرفعال می‌شود نه حذف — وگرنه چینشِ گذشته بی‌راننده می‌شود.
  async deleteTransportStaff(id: number) {
    const s = await this.prisma.transportStaff.findUnique({
      where: { id },
      include: { _count: { select: { runs: true } } },
    });
    if (!s) throw new NotFoundException('نیرو یافت نشد');
    if (s._count.runs > 0) {
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
      id: h.id, centralId: h.centralId, province: h.province, sector: h.sector, name: h.name, city: h.city, address: h.address, phone: h.phone,
      contactName: h.contactName, contactPhone: h.contactPhone, notes: h.notes,
      active: h.active, visitCount: h._count.visits,
    }));
  }

  async createHospital(dto: { province?: string; sector?: string; name: string; city?: string; address?: string; phone?: string; contactName?: string; contactPhone?: string; notes?: string }) {
    await this.hospitalDupCheck(dto.name);
    return this.prisma.hospital.create({
      data: {
        name: dto.name.trim(),
        sector: dto.sector ?? 'private',
        province: dto.province?.trim() || null,
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
    dto: { province?: string; sector?: string; name?: string; city?: string; address?: string; phone?: string; contactName?: string; contactPhone?: string; notes?: string; active?: boolean },
  ) {
    const h = await this.prisma.hospital.findUnique({ where: { id } });
    if (!h) throw new NotFoundException('بیمارستان یافت نشد');
    if (dto.name) await this.hospitalDupCheck(dto.name, id);
    const updated = await this.prisma.hospital.update({
      where: { id },
      data: {
        ...(dto.sector !== undefined ? { sector: dto.sector } : {}),
        ...(dto.province !== undefined ? { province: dto.province?.trim() || null } : {}),
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
    /* قالبِ مراقبت و روزهای پیگیری هم برمی‌گردند: فرمِ عمل باید **پیش‌فرضِ
       همین نوعِ عمل** را به جراح نشان دهد، نه اینکه خالی بماند و او حدس بزند. */
    return rows.map((r) => ({
      id: r.id, name: r.name, code: r.code, notes: r.notes, active: r.active, visitCount: r._count.visits,
      preOpCare: r.preOpCare, postOpCare: r.postOpCare, followUpDays: r.followUpDays,
    }));
  }

  /**
   * الگوی اقلامِ یک نوعِ عمل — «نورومانیتورینگ دستگاه می‌خواهد».
   *
   * ⚠️ نیاز است نه تعهد: هیچ لاتی رزرو نمی‌شود. چینش از روی همین، بار را
   * پیشنهاد می‌دهد و کسری را قرمز می‌کند؛ تصمیم با چینش‌کننده می‌ماند.
   */
  async listNeeds(procedureTypeId: number) {
    const rows = await this.prisma.procedureTypeItem.findMany({
      where: { procedureTypeId },
      orderBy: { id: 'asc' },
      include: { item: { select: { id: true, name: true, brand: true, size: true, unit: true, assetKind: true } } },
    });
    return rows.map((r) => ({
      id: r.id, itemId: r.itemId, quantity: r.quantity, notes: r.notes,
      name: r.item.name, brand: r.item.brand, size: r.item.size, unit: r.item.unit, assetKind: r.item.assetKind,
    }));
  }

  async addNeed(procedureTypeId: number, dto: { itemId: number; quantity?: number; notes?: string }) {
    const type = await this.prisma.procedureType.findUnique({ where: { id: procedureTypeId } });
    if (!type) throw new NotFoundException('نوعِ عمل پیدا نشد');
    const item = await this.prisma.item.findUnique({ where: { id: Number(dto.itemId) } });
    if (!item) throw new NotFoundException('کالا پیدا نشد');
    const quantity = Math.max(1, Number(dto.quantity) || 1);
    await this.prisma.procedureTypeItem.upsert({
      where: { procedureTypeId_itemId: { procedureTypeId, itemId: item.id } },
      create: { procedureTypeId, itemId: item.id, quantity, notes: dto.notes?.trim() || null },
      update: { quantity, notes: dto.notes?.trim() || null },
    });
    return this.listNeeds(procedureTypeId);
  }

  async removeNeed(procedureTypeId: number, id: number) {
    await this.prisma.procedureTypeItem.deleteMany({ where: { id, procedureTypeId } });
    return this.listNeeds(procedureTypeId);
  }

  /* ────────────── موضوعِ ویزیت (ویزیتِ اولیه / پست‌آپ / زیبایی) ──────────────
     مرحلهٔ ۱ از `docs/BOOKING.md`. عمداً جدا از `Visit.kind`: آن یکی تعیین
     می‌کند کدام فرم رندر شود، این یکی دسته‌بندیِ داخلِ همان فرم است. */

  async listVisitTopics() {
    const rows = await this.prisma.visitTopic.findMany({
      orderBy: [{ active: 'desc' }, { sort: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { visits: true } } },
    });
    return rows.map((r) => ({
      id: r.id, name: r.name, color: r.color, notes: r.notes,
      active: r.active, sort: r.sort, visitCount: r._count.visits,
    }));
  }

  async createVisitTopic(dto: { name: string; color?: string; notes?: string; sort?: number }) {
    await this.uniqueName('visitTopic', 'name', dto.name);
    return this.prisma.visitTopic.create({
      data: {
        name: dto.name.trim(),
        color: dto.color?.trim() || null,
        notes: dto.notes?.trim() || null,
        sort: dto.sort ?? 0,
      },
    });
  }

  async updateVisitTopic(id: number, dto: { name?: string; color?: string; notes?: string; active?: boolean; sort?: number }) {
    const row = await this.prisma.visitTopic.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('موضوعِ ویزیت یافت نشد');
    if (dto.name) await this.uniqueName('visitTopic', 'name', dto.name, id);
    return this.prisma.visitTopic.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.color !== undefined ? { color: dto.color?.trim() || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.sort !== undefined ? { sort: dto.sort } : {}),
      },
    });
  }

  /**
   * حذفِ موضوع — **فقط وقتی هیچ مراجعه‌ای نگرفته باشدش**، وگرنه خاموش می‌شود.
   *
   * ⚠️ FK روی `SetNull` است، پس حذفِ سخت مراجعه را نمی‌بَرد ولی موضوعش را
   * بی‌صدا پاک می‌کند — و «این ویزیتِ اولیه بود یا پست‌آپ؟» دیگر جواب ندارد.
   * خاموش‌کردن همان کارِ فهرست‌ها را می‌کند بدونِ ازدست‌دادنِ تاریخ.
   */
  async deleteVisitTopic(id: number) {
    const used = await this.prisma.visit.count({ where: { topicId: id } });
    if (used > 0) {
      await this.prisma.visitTopic.update({ where: { id }, data: { active: false } });
      return { ok: true, deactivated: true, visitCount: used };
    }
    await this.prisma.visitTopic.delete({ where: { id } });
    return { ok: true, deactivated: false, visitCount: 0 };
  }

  /** آیا فرمی با نقشِ پیگیری تعریف شده؟ بدونِ آن، موجِ پیگیری لینکی ندارد و نمی‌رود. */
  async followUpFormReady() {
    const row = await this.prisma.formDef.findFirst({
      where: { followUp: { not: null }, active: true }, select: { id: true },
    });
    return !!row;
  }

  async createProcedureType(dto: { name: string; code?: string; notes?: string; preOpCare?: string; postOpCare?: string; followUpDays?: string }) {
    await this.uniqueName('procedureType', 'name', dto.name);
    return this.prisma.procedureType.create({
      data: {
        name: dto.name.trim(), code: dto.code?.trim() || null, notes: dto.notes?.trim() || null,
        preOpCare: dto.preOpCare?.trim() || null, postOpCare: dto.postOpCare?.trim() || null,
        followUpDays: dto.followUpDays?.trim() || null,
      },
    });
  }

  async updateProcedureType(id: number, dto: { name?: string; code?: string; notes?: string; active?: boolean; preOpCare?: string; postOpCare?: string; followUpDays?: string }) {
    const row = await this.prisma.procedureType.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('نوعِ عمل یافت نشد');
    if (dto.name) await this.uniqueName('procedureType', 'name', dto.name, id);
    return this.prisma.procedureType.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.code !== undefined ? { code: dto.code?.trim() || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
        ...(dto.preOpCare !== undefined ? { preOpCare: dto.preOpCare?.trim() || null } : {}),
        ...(dto.postOpCare !== undefined ? { postOpCare: dto.postOpCare?.trim() || null } : {}),
        ...(dto.followUpDays !== undefined ? { followUpDays: dto.followUpDays?.trim() || null } : {}),
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

  // ─────────────── کدهای داخلیِ مطب (جراحیِ داخلِ مطب) ───────────────

  /** فهرست/جستجو — با کد یا نام؛ برای فاکتورِ «با کد» و صفحهٔ تعاریف. */
  async listInternalCodes(q?: string) {
    const t = q?.trim();
    const rows = await this.prisma.internalCode.findMany({
      // هر دو صورتِ رقمی («۱۲» و «12») پیدا می‌شوند — توضیح در `common/search.ts`.
      where: t ? { OR: textSearchOr(t, ['code', 'name']) } : {},
      orderBy: [{ active: 'desc' }, { code: 'asc' }],
      take: 200,
    });
    // شمارِ استفاده از روی عکسِ کد در قلم‌ها — رابطه نیست، چون فاکتورِ صادرشده
    // نباید با ویرایشِ بعدیِ تعریف عوض شود.
    const used = await this.prisma.charge.groupBy({
      by: ['serviceCode'],
      where: { codeSystem: 'internal', serviceCode: { in: rows.map((r) => r.code) } },
      _count: { _all: true },
    });
    const usedOf = new Map(used.map((u) => [u.serviceCode, u._count._all]));
    return rows.map((r) => ({ ...r, usedCount: usedOf.get(r.code) ?? 0 }));
  }

  async createInternalCode(dto: { code: string; name: string; price: number; notes?: string }) {
    const code = dto.code.trim().toUpperCase();
    const dup = await this.prisma.internalCode.findFirst({ where: { code: { equals: code, mode: 'insensitive' } } });
    if (dup) throw new BadRequestException('این کد قبلاً ثبت شده است');
    return this.prisma.internalCode.create({
      data: { code, name: dto.name.trim(), price: dto.price, notes: dto.notes?.trim() || null },
    });
  }

  async updateInternalCode(id: number, dto: { code?: string; name?: string; price?: number; notes?: string; active?: boolean }) {
    const row = await this.prisma.internalCode.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('کدِ داخلی یافت نشد');
    const code = dto.code?.trim().toUpperCase();
    if (code && code !== row.code) {
      const dup = await this.prisma.internalCode.findFirst({
        where: { code: { equals: code, mode: 'insensitive' }, id: { not: id } },
      });
      if (dup) throw new BadRequestException('این کد قبلاً ثبت شده است');
    }
    return this.prisma.internalCode.update({
      where: { id },
      data: {
        ...(code ? { code } : {}),
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }

  /** کدِ استفاده‌شده در فاکتور حذف نمی‌شود — غیرفعال می‌شود؛ همان قاعدهٔ بقیه. */
  async deleteInternalCode(id: number) {
    const row = await this.prisma.internalCode.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('کدِ داخلی یافت نشد');
    const used = await this.prisma.charge.count({ where: { codeSystem: 'internal', serviceCode: row.code } });
    if (used > 0) {
      await this.prisma.internalCode.update({ where: { id }, data: { active: false } });
      return { ok: true, deactivated: true };
    }
    await this.prisma.internalCode.delete({ where: { id } });
    return { ok: true, deactivated: false };
  }


  // ────────────────────── قالب‌های شرحِ بالینی ──────────────────────

  /** فهرستِ قالب‌ها — با نامِ هدف‌ها تا فهرستِ تعریف‌ها خوانا باشد. */
  async listNoteTemplates() {
    const rows = await this.prisma.noteTemplate.findMany({
      orderBy: [{ kind: 'asc' }, { title: 'asc' }],
      include: {
        procedureType: { select: { name: true } },
        diagnosis: { select: { title: true } },
        topic: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id, kind: r.kind, kindFa: NOTE_KIND_LABELS[r.kind] ?? r.kind,
      title: r.title, body: r.body, active: r.active,
      procedureTypeId: r.procedureTypeId, diagnosisId: r.diagnosisId, topicId: r.topicId,
      procedureTypeName: r.procedureType?.name ?? null,
      diagnosisTitle: r.diagnosis?.title ?? null,
      topicName: r.topic?.name ?? null,
    }));
  }

  /** «۰» یعنی بی‌هدف (عمومی) — همان قراردادِ Min(0)ِ بقیهٔ DTOها. */
  private async noteTemplateRefs(dto: { procedureTypeId?: number; diagnosisId?: number; topicId?: number }) {
    const out: any = {};
    if (dto.procedureTypeId !== undefined) {
      if (dto.procedureTypeId > 0
        && !(await this.prisma.procedureType.findUnique({ where: { id: dto.procedureTypeId }, select: { id: true } }))) {
        throw new BadRequestException('نوعِ عملِ انتخابی یافت نشد');
      }
      out.procedureTypeId = dto.procedureTypeId > 0 ? dto.procedureTypeId : null;
    }
    if (dto.diagnosisId !== undefined) {
      if (dto.diagnosisId > 0
        && !(await this.prisma.diagnosis.findUnique({ where: { id: dto.diagnosisId }, select: { id: true } }))) {
        throw new BadRequestException('تشخیصِ انتخابی یافت نشد');
      }
      out.diagnosisId = dto.diagnosisId > 0 ? dto.diagnosisId : null;
    }
    if (dto.topicId !== undefined) {
      if (dto.topicId > 0
        && !(await this.prisma.visitTopic.findUnique({ where: { id: dto.topicId }, select: { id: true } }))) {
        throw new BadRequestException('موضوعِ انتخابی یافت نشد');
      }
      out.topicId = dto.topicId > 0 ? dto.topicId : null;
    }
    return out;
  }

  async createNoteTemplate(dto: {
    kind: string; title: string; body: string;
    procedureTypeId?: number; diagnosisId?: number; topicId?: number;
  }) {
    if (!NOTE_KINDS.includes(dto.kind as any)) throw new BadRequestException('نوعِ شرح نامعتبر است');
    const refs = await this.noteTemplateRefs(dto);
    return this.prisma.noteTemplate.create({
      data: { kind: dto.kind, title: dto.title.trim(), body: dto.body, ...refs },
    });
  }

  async updateNoteTemplate(id: number, dto: {
    kind?: string; title?: string; body?: string; active?: boolean;
    procedureTypeId?: number; diagnosisId?: number; topicId?: number;
  }) {
    const row = await this.prisma.noteTemplate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('قالب یافت نشد');
    if (dto.kind !== undefined && !NOTE_KINDS.includes(dto.kind as any)) {
      throw new BadRequestException('نوعِ شرح نامعتبر است');
    }
    const refs = await this.noteTemplateRefs(dto);
    return this.prisma.noteTemplate.update({
      where: { id },
      data: {
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...refs,
      },
    });
  }

  /** قالب سند نیست — حذفِ سخت مجاز است؛ شرح‌های نوشته‌شده متنِ خودشان را دارند. */
  async deleteNoteTemplate(id: number) {
    const row = await this.prisma.noteTemplate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('قالب یافت نشد');
    await this.prisma.noteTemplate.delete({ where: { id } });
    return { ok: true };
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
      // ⚠️ جستجو با هر دو صورتِ رقمی — «۱۶» و «16» یک کالا را پیدا می‌کنند.
      //    توضیحِ کامل در `common/search.ts`.
      where: t ? { OR: textSearchOr(t, ['name', 'sku', 'brand', 'irc']) } : {},
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

  private async uniqueName(model: 'procedureType' | 'diagnosis' | 'visitTopic', field: 'name' | 'title', value: string, exceptId?: number) {
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
