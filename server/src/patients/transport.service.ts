import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { isUnrestricted } from '../common/own-scope';
import { clinicDateIso, dayUtc } from '../common/clinic-day';
import { PlacesService } from './places.service';

const DAY = 24 * 60 * 60 * 1000;

/**
 * بازهٔ «روزِ مطب»ِ حاوی `at` — همان تعریفِ `common/clinic-day.ts` که پذیرش (`assign`)،
 * «امروز» و میزِ پذیرش دارند.
 *
 * ⚠️ نسخهٔ قبلی روز را از **تاریخِ UTC** می‌ساخت. بینِ نیمه‌شب تا ۳:۳۰ صبحِ تهران
 * «امروز»ِ این پنل روزِ **قبل** بود، در حالی که پذیرشِ همان ردیف روزِ گذشته را رد
 * می‌کرد — کارشناسِ شب‌کار عملِ امروزش را نمی‌دید و عملِ دیروز را نمی‌توانست بپذیرد.
 */
function dayBounds(at: Date): [Date, Date] {
  const from = dayUtc(clinicDateIso(at));
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
  constructor(private prisma: PrismaService, private audit: AuditService, private places: PlacesService) {}

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
    /* ⚠️ سوپرادمین بی‌محدودیت است (`isUnrestricted`، خواستهٔ مالک ۱۴۰۵/۰۷/۰۳):
       **همهٔ** مسیرهای بازه را با نامِ نیروی هر مسیر می‌بیند و تحویل را از طرفِ
       همان نیرو ثبت می‌کند (`markDone`). حتی اگر خودش هم رکوردِ نیرو داشته
       باشد، نمایش «همه» است نه «مالِ من» — تا امروز همان رکورد او را به مسیرِ
       خودش محدود می‌کرد. برای بقیه دامنه همچنان نیروی خودِ کاربر است. */
    const team = isUnrestricted(user);
    const staff = team
      ? await (async () => { try { return await this.me(user); } catch { return null; } })()
      : await this.me(user);
    const [start, end] = dayBounds(new Date());
    const [from, to] =
      scope === 'upcoming' ? [end, new Date(end.getTime() + 14 * DAY)]
        : scope === 'past' ? [new Date(start.getTime() - 14 * DAY), start]
          : [start, end];

    const runs = await this.prisma.transportRun.findMany({
      where: { ...(team ? {} : { staffId: staff?.id ?? -1 }), runDate: { gte: from, lt: to } },
      // ⚠️ `id` به‌عنوانِ دومین کلید: در نمای سرپرستی چند مسیرِ هم‌روز هست و
      //    ترتیبشان نباید با هر بارگذاری جابه‌جا شود.
      orderBy: [{ runDate: scope === 'past' ? 'desc' : 'asc' }, { id: 'asc' }],
      include: {
        staff: { include: { person: { select: { firstName: true, lastName: true } } } },
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
      /* نمای سرپرستی را **همین پرچم** می‌گوید، نه نبودنِ `staff`: سوپرادمینی که
         خودش هم نیرو است `staff` دارد و باز هم همه را می‌بیند. رابط سطح را حساب
         نمی‌کند (قانونِ ۳). */
      team,
      /* بدونِ رکوردِ نیرو (سوپرادمینِ ناظر) `staff: null`. */
      staff: staff ? {
        id: staff.id, role: staff.role, vehicle: staff.vehicle,
        name: `${staff.person.firstName} ${staff.person.lastName}`.trim(),
      } : null,
      runs: runs.map((r: any) => ({
        // خودروی همیشگیِ **نیروی همان مسیر**، نه نیروی بیننده: در نمای سرپرستی
        // خودروی ناظر روی مسیرِ دیگری می‌نشست.
        id: r.id, runDate: r.runDate, status: r.status, vehicle: r.vehicle ?? r.staff?.vehicle ?? null,
        staffName: r.staff?.person
          ? `${r.staff.person.firstName} ${r.staff.person.lastName}`.trim()
          : null,
        // کلیدِ «مالِ کیست» برای فیلترِ نیرو — فقط در نمای سرپرستی.
        ...(team ? { ownerId: r.staffId } : {}),
        stops: r.stops.map((s: any) => this.shapeStop(s)),
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
    /* سوپرادمین توقفِ **هر مسیری** را از طرفِ نیروی همان مسیر ثبت می‌کند — بی‌آنکه
       پروفایل عوض کند یا از راننده بخواهد وارد شود. ردِ ممیزی بازیگر را خودِ
       سوپرادمین و صاحبِ مسیر را `staffId` نگه می‌دارد. توقفِ بی‌مسیر (صفِ
       جمع‌آوریِ چینش) در هیچ پرتالی نیست، پس این‌جا هم پذیرفته نمی‌شود. */
    const team = isUnrestricted(user);
    const staff = team ? null : await this.me(user);
    const stop = await this.prisma.transportStop.findFirst({
      where: { id: stopId, ...(staff ? { run: { staffId: staff.id } } : { runId: { not: null } }) },
      select: { id: true, doneAt: true, run: { select: { staffId: true } } },
    });
    if (!stop) throw new NotFoundException(team ? 'این توقف در هیچ مسیری نیست' : 'این توقف در مسیرِ شما نیست');
    if (stop.doneAt) throw new BadRequestException('این توقف قبلاً انجام‌شده ثبت شده است');

    // ⚠️ همان کانونی‌سازیِ کارشناس، این‌بار روی حرفِ راننده — وگرنه یک طرفِ
    //    مقایسه مرتب می‌شد و طرفِ دیگر نه، و «برنامه در برابر واقعیت» بی‌معنا.
    const handedActual = await this.places.canonical(dto.handedActual);
    await this.prisma.transportStop.update({
      where: { id: stopId },
      data: {
        doneAt: new Date(),
        ...(handedActual ? { handedActual } : {}),
        ...(dto.notes?.trim() ? { notes: dto.notes.trim() } : {}),
      },
    });
    await this.audit.record({
      actorId: user?.id, action: 'transport.stop.done', entityType: 'transport_stop', entityId: stopId,
      after: { handedActual, ...(team ? { staffId: stop.run?.staffId ?? null } : {}) },
    });
    return this.agenda(user, 'today');
  }
}
