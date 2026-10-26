import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CLINIC_TZ } from '../common/clinic-day';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { normalizeTime } from './patients.service';
import { syncCrew, currentMember } from './crew-sync';
import { AssetsService } from './assets.service';
import { reportTitle } from './report-title';
import { RecordService } from './record.service';
import { EventsService } from '../work/events.service';

const fullName = (p: any) => `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim();
const dayRange = (d: Date) => {
  const start = new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return { gte: start, lt: new Date(start.getTime() + 24 * 3600_000) };
};
const SOURCE_FA: Record<string, string> = { form: 'از فرم', dispatch: 'از چینش', claim: 'پذیرش از پنل', handover: 'تحویل', legacy: '' };
/** نمای تیم — همان شکل برای فرمِ خدمت و پنلِ کارشناس: ترتیب، ساعت‌ها، «از کجا آمد»، مسئولِ فعلی. */
export function crewView(rows: any[]) {
  const cur = currentMember(rows);
  const names = new Map(rows.map((r) => [r.accountId, fullName(r.account?.person)]));
  return rows.map((c) => ({
    accountId: c.accountId, name: fullName(c.account?.person), active: c.account?.status === 'active',
    fromTime: c.fromTime, toTime: c.toTime, current: c === cur, source: c.source,
    sourceFa: c.source === 'handover' && c.handedFromId ? `تحویل از ${names.get(c.handedFromId) ?? 'کارشناسِ قبلی'}` : (SOURCE_FA[c.source] ?? ''),
  }));
}

const MAX_CREW = 8;
/* «الان» به وقتِ مطب (نه کانتینرِ UTC) — همان قراردادِ `opStartTime`. */
const CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: CLINIC_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

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
    /* مراجعهٔ قدیمی که کارشناس دارد ولی ردیفِ تیم نه — همین حالا روی تیم می‌نشیند تا فرم «بی‌کارشناس» نگوید. */
    const bare = await this.prisma.visit.findFirst({ where: { id, techId: { not: null }, crew: { none: {} } }, select: { id: true } });
    if (bare) await this.prisma.$transaction((tx) => syncCrew(tx, id));
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
    const clash = v.deviceLotId && v.opDate ? await this.deviceClash(v.deviceLotId, v.opDate, v.id, v.hospitalId) : [];
    return {
      visitId: v.id,
      crew: crewView(v.crew),
      monitoring: { start: v.opStartTime, end: v.opEndTime },
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
    await this.visitOf(id);
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
      /* اعضای ماندگار «از کجا آمد»ِ خودشان را نگه می‌دارند (پذیرش/تحویل/چینش)؛ تازه‌ها «فرم». */
      const keep = new Map(before.map((b) => [b.accountId, b]));
      await tx.visitCrew.deleteMany({ where: { visitId: id } });
      if (clean.length) {
        await tx.visitCrew.createMany({ data: clean.map((c, i) => {
          const old = keep.get(c.accountId);
          return { visitId: id, ...c, sort: i, source: old?.source ?? 'form', handedFromId: old?.handedFromId ?? null };
        }) });
      }
      /* مسئولِ فعلی، حضور در چینش و ساعتِ شروع/پایانِ مانیتورینگ از همین تیم مشتق می‌شوند. */
      await syncCrew(tx, id, { times: 'crew' });
    });
    await this.audit.record({ actorId: user?.id, action: 'visit.crew', entityType: 'visit', entityId: id,
      before: before.map((b) => ({ accountId: b.accountId, fromTime: b.fromTime, toTime: b.toTime })), after: clean });
    return this.view(id);
  }

  /**
   * **تحویل به کارشناسِ بعدی** (تصمیمِ مالک ۱۴۰۵/۰۸/۰۴) — از پنلِ کارشناس، روی همان تیمِ پرونده.
   *
   * خروجِ مسئولِ فعلی و ورودِ نفرِ بعد **با یک ساعت** ثبت می‌شود؛ مسئولیت (و «مالِ من»ِ پنل) به نفرِ بعد
   * می‌رود و زنجیره در فرمِ خدمت «تحویل از …» دیده می‌شود. اگر نفرِ بعد از قبل در تیم بوده (برنامه‌ریزی‌شده)،
   * همان ردیف ادامه می‌یابد، نه ردیفِ دوم.
   *
   * فقط مسئولِ فعلی یا کارشناس‌ادمین به بالا — کارشناسِ دیگرِ تیم پرونده را از دستِ همکارش نمی‌گیرد.
   */
  async handover(id: number, dto: { toAccountId: number; at?: string | null }, user: any) {
    const toId = Number(dto?.toAccountId);
    if (!Number.isSafeInteger(toId) || toId <= 0) throw new BadRequestException('کارشناسِ بعدی را انتخاب کنید');
    const at = normalizeTime(dto?.at, 'ساعتِ تحویل') ?? CLOCK.format(new Date());
    const v = await this.visitOf(id);
    if (v.opStatus === 'cancelled') throw new BadRequestException('عملِ لغوشده تحویل ندارد');
    const to = await this.prisma.account.findFirst({ where: { id: toId, status: 'active', systemKey: null, level: { gte: 2, lte: 4 } }, select: { id: true } });
    if (!to) throw new NotFoundException('کارشناسِ بعدی پیدا نشد یا فعال نیست');
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.visitCrew.findMany({ where: { visitId: id }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
      const cur = currentMember(rows);
      if (!cur) throw new BadRequestException('این پرونده هنوز کارشناس ندارد — اول پذیرش یا چینش');
      if (cur.toTime) throw new BadRequestException('کارِ این پرونده تمام شده است؛ تحویلی نمانده');
      if (cur.accountId === toId) throw new BadRequestException('پرونده همین حالا دستِ همین کارشناس است');
      if (cur.accountId !== user?.id && (user?.level ?? 0) < 3) throw new ForbiddenException('فقط مسئولِ فعلیِ پرونده تحویل می‌دهد');
      const from = cur.fromTime ?? v.opStartTime ?? at;
      if (at < from) throw new BadRequestException(`ساعتِ تحویل پیش از ورودِ مسئولِ فعلی (${from}) است`);
      await tx.visitCrew.update({ where: { id: cur.id }, data: { fromTime: from, toTime: at } });
      const existing = rows.find((r) => r.accountId === toId);
      /* نفرِ بعد درست پشتِ مسئولِ فعلی می‌نشیند؛ بقیه یک خانه جلو می‌روند. */
      await tx.visitCrew.updateMany({ where: { visitId: id, sort: { gt: cur.sort }, ...(existing ? { id: { not: existing.id } } : {}) }, data: { sort: { increment: 1 } } });
      if (existing) {
        await tx.visitCrew.update({ where: { id: existing.id }, data: { fromTime: at, toTime: null, sort: cur.sort + 1, source: 'handover', handedFromId: cur.accountId } });
      } else {
        await tx.visitCrew.create({ data: { visitId: id, accountId: toId, fromTime: at, sort: cur.sort + 1, source: 'handover', handedFromId: cur.accountId } });
      }
      await syncCrew(tx, id, { times: 'crew' });
    });
    await this.audit.record({ actorId: user?.id, action: 'visit.handover', entityType: 'visit', entityId: id, after: { toAccountId: toId, at } });
    return this.view(id);
  }

  /**
   * نامزدهای تحویل: کارشناس‌های فعال، اول آن‌هایی که امروز در **همین بیمارستان** حضور دارند — همان برچسبِ
   * «امروز در همین بیمارستان» / «امروز در بیمارستانِ …» که شیتِ تحویل نشان می‌دهد.
   */
  async handoverCandidates(id: number) {
    const v = await this.visitOf(id);
    const [techs, duties, crew] = await Promise.all([
      this.prisma.account.findMany({ where: { status: 'active', systemKey: null, level: { gte: 2, lte: 4 } }, select: { id: true, person: { select: { firstName: true, lastName: true } } } }),
      v.opDate ? this.prisma.hospitalDuty.findMany({ where: { date: dayRange(v.opDate) }, select: { techId: true, hospitalId: true, arriveTime: true, hospital: { select: { name: true } } } }) : Promise.resolve([] as any[]),
      this.prisma.visitCrew.findMany({ where: { visitId: id }, select: { accountId: true, toTime: true } }),
    ]);
    const cur = currentMember(await this.prisma.visitCrew.findMany({ where: { visitId: id }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] }));
    return techs
      .filter((t) => t.id !== cur?.accountId && !crew.some((c) => c.accountId === t.id && c.toTime))
      .map((t) => {
        const d = duties.filter((x: any) => x.techId === t.id);
        const here = d.find((x: any) => x.hospitalId === v.hospitalId);
        return {
          accountId: t.id, name: fullName(t.person),
          where: here ? 'here' : d.length ? 'elsewhere' : 'none',
          note: here ? 'امروز در همین بیمارستان' : d.length ? `امروز در ${d[0].hospital.name}` : 'امروز برنامه ندارد',
        };
      })
      .sort((a, b) => ['here', 'elsewhere', 'none'].indexOf(a.where) - ['here', 'elsewhere', 'none'].indexOf(b.where) || a.name.localeCompare(b.name, 'fa'));
  }

  /** مراجعه‌های دیگرِ همان روز که همین دستگاه را دارند — تعارض دیده شود، نه بی‌صدا. */
  /* همان بیمارستان در همان روز تعارض نیست — یک دستگاه بیمارها را پشتِ هم مانیتور می‌کند؛ بیمارستانِ دیگر هست. */
  private async deviceClash(lotId: number, opDate: Date, exceptVisitId: number, hospitalId?: number | null) {
    const rows = await this.prisma.visit.findMany({
      where: { deviceLotId: lotId, id: { not: exceptVisitId }, opDate: dayRange(opDate), ...(hospitalId ? { NOT: { hospitalId } } : {}), opStatus: { not: 'cancelled' }, patient: { deletedAt: null } },
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
