import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { isUnrestricted } from '../common/own-scope';
import { clinicDateIso, dayUtc } from '../common/clinic-day';
import { PlacesService } from './places.service';
import { RoutesService } from './routes.service';
import { InventoryService } from './inventory.service';
import { deliveryState, receiptOf, pickupOf } from './handover';

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
  /* `routes` اختیاری است چون سوییتِ e2e این سرویس را ممکن است مستقیم بسازد؛ Nest همیشه پاسش
     می‌دهد. بی‌آن، حوالهٔ برنامه‌ریزی‌شده فقط شماره‌اش را نشان می‌دهد (رفتارِ پیش از ۱۴۰۵/۰۷/۰۹). */
  constructor(
    private prisma: PrismaService, private audit: AuditService, private places: PlacesService,
    private routes?: RoutesService,
    /* «ثبتِ تحویل» حوالهٔ برنامه‌ریزی‌شده را از همین‌جا ارسال می‌کند (`InventoryService.ship`). اختیاری به
       همان دلیلِ `routes`؛ Nest همیشه پاسش می‌دهد. */
    private inventory?: InventoryService,
  ) {}

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
      throw new NotFoundException('این حساب هنوز راننده یا پیک نیست — در «کاربران» نقشِ این حساب را «راننده» یا «پیک» بگذارید');
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
                // دستِ دومِ تحویل — راننده باید ببیند کارشناس «تحویل گرفتم» زده یا نه.
                techReceivedAt: true, techReceiptIssue: true, techReceiptNote: true,
                // شمارشِ راننده هنگامِ جمع‌آوری (بستهٔ ج) — تا توقفِ انجام‌شده بگوید چه شمرده شد.
                driverCountedAt: true, driverCountIssue: true, driverSealIntact: true, driverCountNote: true,
                // حوالهٔ برنامه‌ریزی‌شده (تختهٔ روز) هنوز حرکتی ندارد؛ قلم‌هایش این‌جاست.
                plannedLines: true,
                // ⚠️ فقط عنوانِ کالا و تعداد. نه بیمار، نه مبلغ. همهٔ حرکت‌ها می‌آیند تا «چقدر باید برگردد»
                //    (ارسالی − مصرفِ سرِ عمل) برای شمارشِ جمع‌آوری حساب شود.
                movements: {
                  select: { kind: true, lotId: true, quantity: true, location: true, lot: { select: { serialNo: true, lotNo: true, item: { select: { name: true, size: true } } } } },
                },
                visit: { select: { techArriveTime: true, opStartTime: true, tech: { select: { person: { select: { firstName: true, lastName: true, phone: true } } } } } },
              },
            },
          },
        },
      },
    });
    /* نامِ کالای حوالهٔ برنامه‌ریزی‌شده — یک کوئری برای همهٔ توقف‌ها (`RoutesService.linesOf`). */
    await this.routes?.withPlannedLots(runs.flatMap((r: any) => r.stops.flatMap((s: any) => s.transfers)));

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

  /** قلم‌های حوالهٔ ارسال‌شده + «چقدر باید برگردد» (ارسالی − مصرفِ سرِ عمل) — پیش‌فرضِ شمارشِ جمع‌آوری. */
  private cargoItems(t: any) {
    const usedOf = new Map<number, number>();
    for (const m of t.movements) if (m.kind === 'out' || m.kind === 'return') usedOf.set(m.lotId, (usedOf.get(m.lotId) ?? 0) - m.quantity);
    return t.movements
      .filter((m: any) => m.kind === 'transfer' && m.quantity > 0 && m.location === t.toLocation)
      .map((m: any) => ({
        lotId: m.lotId,
        name: [m.lot?.item?.name, m.lot?.item?.size].filter(Boolean).join(' '),
        serialNo: m.lot?.serialNo ?? m.lot?.lotNo ?? null,
        quantity: m.quantity,
        remaining: Math.max(0, m.quantity - (usedOf.get(m.lotId) ?? 0)),
      }));
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
        /* تحویلِ دوطرفه: `awaiting` تا کارشناس تأیید کند، بعد `received` یا `received_issue` —
           ردِ «من دادم، او می‌گوید نگرفتم» (`handover.ts`، یک منبع برای سه پنل). */
        delivery: deliveryState(t, s),
        receipt: receiptOf(t),
        pickup: pickupOf(t),
        /* ⚠️ تختهٔ روز همهٔ تحویل‌ها را **planned** می‌سازد و حوالهٔ planned حرکتی ندارد؛ تا
           ۱۴۰۵/۰۷/۰۹ راننده فقط شمارهٔ حواله را می‌دید، نه اینکه چه چیزی ببرد. */
        items: t.status === 'planned' && this.routes
          ? this.routes.linesOf(t).map((l: any) => ({ lotId: l.lotId, name: l.itemName, serialNo: l.serialNo, quantity: l.quantity }))
          : this.cargoItems(t),
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
  async markDone(
    stopId: number,
    dto: { handedActual?: string; notes?: string; counts?: { transferId: number; lotId: number; counted: number }[]; sealIntact?: boolean },
    user: any,
  ) {
    /* سوپرادمین توقفِ **هر مسیری** را از طرفِ نیروی همان مسیر ثبت می‌کند — بی‌آنکه
       پروفایل عوض کند یا از راننده بخواهد وارد شود. ردِ ممیزی بازیگر را خودِ
       سوپرادمین و صاحبِ مسیر را `staffId` نگه می‌دارد. توقفِ بی‌مسیر (صفِ
       جمع‌آوریِ چینش) در هیچ پرتالی نیست، پس این‌جا هم پذیرفته نمی‌شود. */
    const team = isUnrestricted(user);
    const staff = team ? null : await this.me(user);
    const stop = await this.prisma.transportStop.findFirst({
      where: { id: stopId, ...(staff ? { run: { staffId: staff.id } } : { runId: { not: null } }) },
      select: {
        id: true, kind: true, doneAt: true, run: { select: { staffId: true } },
        transfers: {
          select: {
            id: true, code: true, status: true, toLocation: true,
            // همهٔ حرکت‌های حواله: ارسالی (transfer) و مصرفِ سرِ عمل (out/return) — «چقدر باید برگردد» = ارسالی − مصرف.
            movements: {
              select: { kind: true, lotId: true, quantity: true, location: true, lot: { select: { serialNo: true, lotNo: true, item: { select: { name: true, size: true } } } } },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!stop) throw new NotFoundException(team ? 'این توقف در هیچ مسیری نیست' : 'این توقف در مسیرِ شما نیست');
    if (stop.doneAt) throw new BadRequestException('این توقف قبلاً انجام‌شده ثبت شده است');

    // ⚠️ همان کانونی‌سازیِ کارشناس، این‌بار روی حرفِ راننده — وگرنه یک طرفِ
    //    مقایسه مرتب می‌شد و طرفِ دیگر نه، و «برنامه در برابر واقعیت» بی‌معنا.
    const handedActual = await this.places.canonical(dto.handedActual);

    /* ⚠️ «تحویل دادم»ِ راننده همان ارسالِ حواله است — ریشهٔ باگِ «راننده زده تحویل داده شد ولی
       پنلِ کارشناسی می‌گوید فرستاده نشد» (مالک، ۱۴۰۵/۰۷/۱۱): تختهٔ روز حواله را `planned`
       می‌سازد و تا امروز هیچ دکمه‌ای `ship` را صدا نمی‌زد، پس دفترِ انبار هرگز نمی‌خورد و ست
       روی کاغذ در انبار می‌ماند. ارسال **پیش از** مهرِ انجام است: اگر موجودی کم باشد
       (`InventoryService.move`) توقف انجام‌شده ثبت نمی‌شود و راننده همان خطای فارسی را
       می‌بیند تا با دفتر هماهنگ کند — نه اینکه بار «رفته» باشد و دفتر از چیزی که نیست کم کند. */
    const shipped: { id: number; code: string }[] = [];
    if (stop.kind === 'deliver' && this.inventory) {
      for (const t of stop.transfers) {
        if (t.status !== 'planned') continue;
        await this.inventory.ship(t.id, user);
        shipped.push({ id: t.id, code: t.code });
      }
    }

    /* **شمارشِ راننده هنگامِ جمع‌آوری** (مالک، بستهٔ ج): «موقعِ تحویل‌گرفتن از کارشناس بشمرد؛ موقعِ
       تحویل‌دادن که استریل است، نه». هر بسته‌ای که شمرده شد با ارسالیِ همان حواله سنجیده می‌شود؛ کمتر =
       ردیفِ کسری با `stage = pickup` (در گزارشِ کسریِ انبار دیده می‌شود)، بیشتر = خطا. موجودی جابه‌جا
       نمی‌شود — این امضای راننده است؛ شمارشِ داخلِ ست و تکمیلش کارِ انبار است (بستهٔ ب). */
    let pickup: { lines: number; missing: number; issue: boolean } | null = null;
    if (stop.kind === 'pickup' && dto.counts) {
      const counted = new Map(dto.counts.map((c) => [`${Number(c.transferId)}:${Number(c.lotId)}`, c]));
      pickup = { lines: 0, missing: 0, issue: false };
      const note = dto.notes?.trim() || null;
      for (const t of stop.transfers) {
        if (t.status === 'planned' || t.status === 'closed') continue;
        const rows: { transferId: number; lotId: number; label: string; missing: number; kind: string; stage: string; notes: string | null; reportedById: number | null }[] = [];
        let touched = false;
        /* مصرفِ سرِ عمل از همین حواله کم شده؛ راننده «آنچه باید برگردد» را می‌شمارد، نه ارسالی را. */
        const usedOf = new Map<number, number>();
        for (const m of t.movements) if (m.kind === 'out' || m.kind === 'return') usedOf.set(m.lotId, (usedOf.get(m.lotId) ?? 0) - m.quantity);
        for (const m of t.movements) {
          if (m.kind !== 'transfer' || m.quantity <= 0 || m.location !== t.toLocation) continue;
          const c = counted.get(`${t.id}:${m.lotId}`);
          if (!c) continue;
          const label = [[m.lot?.item?.name, m.lot?.item?.size].filter(Boolean).join(' '), m.lot?.serialNo ?? m.lot?.lotNo].filter(Boolean).join(' ');
          const expected = Math.max(0, m.quantity - (usedOf.get(m.lotId) ?? 0));
          const n = Math.trunc(Number(c.counted));
          if (!Number.isInteger(n) || n < 0) throw new BadRequestException(`«${label}»: تعدادِ شمرده‌شده نامعتبر است`);
          if (n > expected) throw new BadRequestException(`«${label}»: بیشتر از آنچه باید برگردد شمرده شد (باید ${expected} عدد باشد)`);
          touched = true;
          pickup.lines += 1;
          if (n < expected) {
            rows.push({ transferId: t.id, lotId: m.lotId, label, missing: expected - n, kind: 'missing', stage: 'pickup', notes: note, reportedById: user?.id ?? null });
            pickup.missing += expected - n;
          }
        }
        if (!touched) continue;
        if (rows.length) await this.prisma.setShortage.createMany({ data: rows });
        await this.prisma.stockTransfer.update({
          where: { id: t.id },
          data: {
            driverCountedAt: new Date(), driverCountedById: user?.id ?? null, driverCountIssue: rows.length > 0,
            driverSealIntact: typeof dto.sealIntact === 'boolean' ? dto.sealIntact : null, driverCountNote: note,
          },
        });
        if (rows.length) pickup.issue = true;
      }
    }

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
      after: { handedActual, shipped, pickup, ...(team ? { staffId: stop.run?.staffId ?? null } : {}) },
    });
    return this.agenda(user, 'today');
  }
}
