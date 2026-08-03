import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { jalaliMonthRange, toJalali } from '../common/jalali';

const DAY = 24 * 60 * 60 * 1000;

function dayBounds(at: Date): [Date, Date] {
  const [jy, jm, jd] = toJalali(at);
  const [monthStart] = jalaliMonthRange(jy, jm);
  const from = new Date(monthStart.getTime() + (jd - 1) * DAY);
  return [from, new Date(from.getTime() + DAY)];
}

/**
 * پرتالِ تیمِ حمل‌ونقل — مسیرِ امروزِ راننده/پیک.
 *
 * ⚠️ **هویت از شخصِ مشترک می‌آید، نه از یک ستونِ تازه.** راننده در تعاریفِ
 * پایه یک `TransportStaff` است و حسابِ کاربری‌اش یک `Account`؛ هر دو به یک
 * `Person` وصل‌اند. پس رانندهٔ بی‌حساب مثلِ امروز کار می‌کند و هرکه حساب
 * گرفت، پرتالش باز می‌شود — بدونِ مهاجرتِ داده و بدونِ دو منبعِ حقیقت برای
 * «این کاربر کدام راننده است».
 *
 * ⚠️ **هیچ اطلاعاتی از بیمار.** همان قاعدهٔ ابلاغِ راننده در فازِ ۳: راننده
 * برای رساندنِ ست به نامِ بیمار احتیاج ندارد. ولی **نام و شمارهٔ کارشناسِ
 * حاضر** را می‌بیند — راننده‌ای که زودتر رسیده باید بداند به چه کسی زنگ بزند.
 */
@Injectable()
export class TransportService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** رکوردِ نیرویِ حمل‌ونقلِ همین کاربر — از روی شخصِ مشترک. */
  private async me(user: any) {
    const account = await this.prisma.account.findUnique({
      where: { id: user?.id ?? -1 },
      select: { personId: true },
    });
    if (!account) throw new NotFoundException('حساب پیدا نشد');
    const staff = await this.prisma.transportStaff.findFirst({
      where: { personId: account.personId },
      include: { person: { select: { firstName: true, lastName: true, phone: true } } },
    });
    if (!staff) {
      throw new NotFoundException('این حساب به هیچ رانندهٔ ثبت‌شده‌ای وصل نیست — در تعاریفِ پایه نیرو را با همین شخص بسازید');
    }
    return staff;
  }

  async agenda(user: any, scope: 'today' | 'upcoming' | 'past' = 'today') {
    const staff = await this.me(user);
    const [start, end] = dayBounds(new Date());
    const [from, to] =
      scope === 'upcoming' ? [end, new Date(end.getTime() + 14 * DAY)]
        : scope === 'past' ? [new Date(start.getTime() - 14 * DAY), start]
          : [start, end];

    const runs = await this.prisma.transportRun.findMany({
      where: { staffId: staff.id, runDate: { gte: from, lt: to } },
      orderBy: { runDate: scope === 'past' ? 'desc' : 'asc' },
      include: {
        stops: {
          orderBy: { seq: 'asc' },
          include: {
            hospital: { select: { name: true, address: true, phone: true, contactName: true, contactPhone: true } },
            proofs: { select: { id: true } },
            transfers: {
              select: {
                id: true, code: true, status: true, toLocation: true, fromLocation: true,
                releasedAt: true, pickupAt: true, leftAt: true,
                // ⚠️ فقط عنوانِ کالا و تعداد. نه بیمار، نه مبلغ.
                movements: {
                  where: { kind: 'transfer', quantity: { gt: 0 } },
                  select: { quantity: true, lot: { select: { serialNo: true, lotNo: true, item: { select: { name: true, size: true } } } } },
                },
                visit: { select: { techArriveTime: true, opStartTime: true, tech: { select: { person: { select: { firstName: true, lastName: true, phone: true } } } } } },
              },
            },
          },
        },
      },
    });

    return {
      scope,
      staff: {
        id: staff.id, role: staff.role, vehicle: staff.vehicle,
        name: `${staff.person.firstName} ${staff.person.lastName}`.trim(),
      },
      runs: runs.map((r) => ({
        id: r.id, runDate: r.runDate, status: r.status, vehicle: r.vehicle ?? staff.vehicle,
        stops: r.stops.map((s) => this.shapeStop(s)),
      })),
    };
  }

  private shapeStop(s: any) {
    const techs = new Map<string, string | null>();
    for (const t of s.transfers) {
      const p = t.visit?.tech?.person;
      if (p) techs.set(`${p.firstName} ${p.lastName}`.trim(), p.phone ?? null);
    }
    return {
      id: s.id,
      seq: s.seq,
      kind: s.kind,
      plannedAt: s.plannedAt,
      doneAt: s.doneAt,
      handedTo: s.handedTo,
      handedActual: s.handedActual,
      notes: s.notes,
      hospitalName: s.hospital?.name ?? s.locationName,
      address: s.hospital?.address ?? null,
      phone: s.hospital?.phone ?? null,
      contact: s.hospital?.contactName ?? null,
      contactPhone: s.hospital?.contactPhone ?? null,
      proofs: s.proofs.length,
      /// کارشناسِ حاضر — تا رانندهٔ زودرسیده بداند به چه کسی زنگ بزند.
      techs: [...techs].map(([name, phone]) => ({ name, phone })),
      cargo: s.transfers.map((t: any) => ({
        id: t.id, code: t.code, status: t.status,
        from: t.fromLocation, to: t.toLocation,
        pickupAt: t.pickupAt, leftAt: t.leftAt, releasedAt: t.releasedAt,
        items: t.movements.map((m: any) => ({
          name: [m.lot?.item?.name, m.lot?.item?.size].filter(Boolean).join(' '),
          serialNo: m.lot?.serialNo ?? m.lot?.lotNo ?? null,
          quantity: m.quantity,
        })),
      })),
    };
  }

  /**
   * ثبتِ انجامِ توقف.
   *
   * ⚠️ `handedActual` جدا از `handedTo` می‌نشیند: برنامه گفته «بده به
   * کارشناس»، ولی راننده زودتر رسیده و به CSR داده. اگر همان فیلد بازنویسی
   * می‌شد، فردا معلوم نبود برنامه چه بود و واقعیت چه شد.
   */
  async markDone(stopId: number, dto: { handedActual?: string; notes?: string }, user: any) {
    const staff = await this.me(user);
    const stop = await this.prisma.transportStop.findFirst({
      where: { id: stopId, run: { staffId: staff.id } },
      select: { id: true, doneAt: true },
    });
    if (!stop) throw new NotFoundException('این توقف در مسیرِ شما نیست');
    if (stop.doneAt) throw new BadRequestException('این توقف قبلاً انجام‌شده ثبت شده است');

    await this.prisma.transportStop.update({
      where: { id: stopId },
      data: {
        doneAt: new Date(),
        ...(dto.handedActual?.trim() ? { handedActual: dto.handedActual.trim() } : {}),
        ...(dto.notes?.trim() ? { notes: dto.notes.trim() } : {}),
      },
    });
    await this.audit.record({
      actorId: user?.id, action: 'transport.stop.done', entityType: 'transport_stop', entityId: stopId,
      after: { handedActual: dto.handedActual?.trim() ?? null },
    });
    return this.agenda(user, 'today');
  }
}
