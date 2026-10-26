import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { normalizeTime } from './patients.service';
import { syncVisitDuty } from './hospital-duties.service';
import { AssetsService } from './assets.service';
import { reportTitle } from './tech.service';
import { RecordService } from './record.service';
import { EventsService } from '../work/events.service';

const fullName = (p: any) => `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim();
const dayRange = (d: Date) => {
  const start = new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return { gte: start, lt: new Date(start.getTime() + 24 * 3600_000) };
};
const MAX_CREW = 8;

/**
 * **فرمِ خدمتِ شرکتی** — آنچه فرمِ عمل نداشت (تصمیمِ مالک ۱۴۰۵/۰۸/۰۴):
 * - تیمِ کارشناسی: هر کارشناس با ساعتِ ورود/خروجِ خودش (`VisitCrew`)؛
 * - دستگاهِ سرِ خدمت: یک لاتِ داراییِ انبار با `assetKind=device` (`Visit.deviceLotId`)؛
 * - گزارشِ کارشناس (دستهٔ `report`) و مصرفی‌ها (همان `/stock/visits/:id/usage`) فقط خوانده/نشان داده می‌شوند.
 *
 * ⚠️ `Visit.techId` آینهٔ **اولین** عضوِ تیم است: چینش، پنلِ کارشناسی، ساعتِ حضور، گزارش‌ها و
 * دسترسیِ «مالِ خودم» همه روی آن ساخته شده‌اند. پس هر نوشتنِ تیم همان را هم‌گام می‌کند.
 */
@Injectable()
export class ServiceCrewService {
  constructor(
    private prisma: PrismaService, private audit: AuditService, private assets: AssetsService,
    private record: RecordService, private events: EventsService,
  ) {}

  private async visitOf(id: number) {
    const v = await this.prisma.visit.findFirst({ where: { id, patient: { deletedAt: null } } });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    return v;
  }

  /** همهٔ بخش‌های خدمت برای فرم — یک درخواست. */
  async view(id: number) {
    const v = await this.prisma.visit.findFirst({
      where: { id, patient: { deletedAt: null } },
      include: {
        crew: { orderBy: [{ sort: 'asc' }, { id: 'asc' }], include: { account: { select: { id: true, status: true, person: { select: { firstName: true, lastName: true } } } } } },
        deviceLot: { include: { item: { select: { id: true, name: true, size: true, assetKind: true } } } },
        documents: { where: { category: 'report', deletedAt: null }, orderBy: { id: 'asc' },
          select: { id: true, title: true, fileName: true, mimeType: true, createdAt: true, uploadedById: true } },
      },
    });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    const clash = v.deviceLotId && v.opDate ? await this.deviceClash(v.deviceLotId, v.opDate, v.id) : [];
    return {
      visitId: v.id,
      crew: v.crew.map((c) => ({ accountId: c.accountId, name: fullName(c.account.person), active: c.account.status === 'active', fromTime: c.fromTime, toTime: c.toTime })),
      device: v.deviceLot ? {
        lotId: v.deviceLot.id,
        name: [v.deviceLot.item.name, v.deviceLot.item.size].filter(Boolean).join(' '),
        serialNo: v.deviceLot.serialNo,
        clash,
      } : null,
      reports: v.documents,
      reportLabel: reportTitle(v.service),
    };
  }

  /**
   * جایگزینیِ کاملِ تیم. ترتیبِ ورودی = ترتیبِ نمایش؛ اولی «کارشناسِ اصلی» (`Visit.techId`).
   * فهرستِ خالی یعنی «بی‌کارشناس» و `techId` هم پاک می‌شود.
   */
  async setCrew(id: number, rows: { accountId: number; fromTime?: string | null; toTime?: string | null }[], user: any) {
    const v = await this.visitOf(id);
    if (!Array.isArray(rows)) throw new BadRequestException('فهرستِ کارشناسان نامعتبر است');
    if (rows.length > MAX_CREW) throw new BadRequestException(`حداکثر ${MAX_CREW} کارشناس`);
    const seen = new Set<number>();
    const clean = [] as { accountId: number; fromTime: string | null; toTime: string | null }[];
    for (const r of rows) {
      const accountId = Number(r?.accountId);
      if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new BadRequestException('کارشناس انتخاب نشده');
      if (seen.has(accountId)) throw new BadRequestException('یک کارشناس دو بار آمده است');
      seen.add(accountId);
      const fromTime = normalizeTime(r?.fromTime, 'ساعتِ ورود');
      const toTime = normalizeTime(r?.toTime, 'ساعتِ خروج');
      if (fromTime && toTime && toTime < fromTime) throw new BadRequestException('ساعتِ خروج پیش از ساعتِ ورود است');
      clean.push({ accountId, fromTime, toTime });
    }
    const accounts = clean.length ? await this.prisma.account.findMany({ where: { id: { in: clean.map((c) => c.accountId) } }, select: { id: true, status: true } }) : [];
    const before = await this.prisma.visitCrew.findMany({ where: { visitId: id } });
    const oldIds = new Set(before.map((b) => b.accountId));
    for (const c of clean) {
      const a = accounts.find((x) => x.id === c.accountId);
      /* کارشناسِ غیرفعالی که از قبل در تیم بوده می‌ماند (سندِ همان روز است)؛ افزودنِ تازهٔ غیرفعال نه. */
      if (!a || (a.status !== 'active' && !oldIds.has(c.accountId))) throw new NotFoundException('کارشناس یافت نشد');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.visitCrew.deleteMany({ where: { visitId: id } });
      if (clean.length) await tx.visitCrew.createMany({ data: clean.map((c, i) => ({ visitId: id, ...c, sort: i })) });
      const techId = clean[0]?.accountId ?? null;
      const techArriveTime = await syncVisitDuty(tx, { id, techId, hospitalId: v.hospitalId, opDate: v.opDate, opStartTime: v.opStartTime });
      await tx.visit.update({ where: { id }, data: { techId, techArriveTime } });
    });
    await this.audit.record({ actorId: user?.id, action: 'visit.crew', entityType: 'visit', entityId: id,
      before: before.map((b) => ({ accountId: b.accountId, fromTime: b.fromTime, toTime: b.toTime })), after: clean });
    return this.view(id);
  }

  /** مراجعه‌های دیگرِ همان روز که همین دستگاه را دارند — تعارض دیده شود، نه بی‌صدا. */
  private async deviceClash(lotId: number, opDate: Date, exceptVisitId: number) {
    const rows = await this.prisma.visit.findMany({
      where: { deviceLotId: lotId, id: { not: exceptVisitId }, opDate: dayRange(opDate), opStatus: { not: 'cancelled' }, patient: { deletedAt: null } },
      select: { id: true, seq: true, opStartTime: true, hospitalName: true, hospital: { select: { name: true } }, patient: { select: { code: true } } },
    });
    return rows.map((r) => ({ visitId: r.id, code: `${r.patient.code}-V${r.seq}`, hospital: r.hospital?.name ?? r.hospitalName, opStartTime: r.opStartTime }));
  }

  /**
   * دستگاه‌های انبار برای روزِ همین خدمت — با وضعیتِ همان روز (آزاد/رزرو/بیرون/سرویس/امانی)
   * از `AssetsService` (تنها جای تصمیمِ وضعیت) و مراجعه‌های دیگرِ همان روز که همان دستگاه را دارند.
   */
  async deviceOptions(id: number) {
    const v = await this.visitOf(id);
    const pool = (await this.assets.assets(v.opDate ?? new Date())).filter((a: any) => a.assetKind === 'device');
    const day = v.opDate ? dayRange(v.opDate) : null;
    const used = day ? await this.prisma.visit.findMany({
      where: { deviceLotId: { in: pool.map((a: any) => a.lotId) }, id: { not: id }, opDate: day, opStatus: { not: 'cancelled' }, patient: { deletedAt: null } },
      select: { id: true, deviceLotId: true, seq: true, opStartTime: true, hospitalName: true, hospital: { select: { name: true } }, patient: { select: { code: true } } },
    }) : [];
    return pool.map((a: any) => ({
      lotId: a.lotId, name: a.itemName, serialNo: a.serialNo, state: a.state, stateLabel: a.stateLabel, at: a.at,
      usedBy: used.filter((u) => u.deviceLotId === a.lotId).map((u) => ({ visitId: u.id, code: `${u.patient.code}-V${u.seq}`, hospital: u.hospital?.name ?? u.hospitalName, opStartTime: u.opStartTime })),
    }));
  }

  async setDevice(id: number, lotId: number | null, user: any) {
    const v = await this.visitOf(id);
    if (lotId !== null) {
      if (!Number.isSafeInteger(lotId) || lotId <= 0) throw new BadRequestException('دستگاه نامعتبر است');
      const lot = await this.prisma.stockLot.findUnique({ where: { id: lotId }, include: { item: { select: { assetKind: true } } } });
      if (!lot || lot.item.assetKind !== 'device') throw new NotFoundException('دستگاه در انبار پیدا نشد');
    }
    await this.prisma.visit.update({ where: { id }, data: { deviceLotId: lotId } });
    await this.audit.record({ actorId: user?.id, action: 'visit.device', entityType: 'visit', entityId: id,
      before: { deviceLotId: v.deviceLotId }, after: { deviceLotId: lotId } });
    return this.view(id);
  }

  /** گزارشِ خدمت از فرمِ خدمت — همان مسیرِ پنلِ کارشناسی (دستهٔ `report` + رویدادِ بستنِ کارِ «گزارش نیامده»). */
  async uploadReport(id: number, file: any, user: any) {
    const v = await this.visitOf(id);
    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    await this.record.addDocument(v.patientId, file, { category: 'report', visitId: id, title: reportTitle(v.service) }, user);
    await this.events.emit({ type: 'report.uploaded', visitId: id, patientId: v.patientId, actorId: user?.id ?? null });
    return this.view(id);
  }
}
