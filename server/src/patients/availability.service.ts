import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { jalaliMonthRange, toJalali } from '../common/jalali';
import { CLINIC_TZ, clinicTodayIso, dayUtc } from '../common/clinic-day';

/**
 * حاشیهٔ رزروِ همان روز برای **بیمار**: ساعتی که تا این‌قدر دیگر شروع می‌شود دیگر گرفتنی نیست
 * (بازبینیِ UX، بندِ ۹۷). بیمار باید برسد، و نوبتِ آنلاین تا تأییدِ مطب «موقت» است.
 */
export const PATIENT_LEAD_MIN = 30;

/** فرمتِ «ساعت:دقیقه»ِ اکنون به وقتِ مطب — یک‌بار ساخته می‌شود (ساختنِ `Intl` گران است). */
const HHMM = new Intl.DateTimeFormat('en-GB', { timeZone: CLINIC_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** دقیقه از نیمه‌شبِ **مطب** — نه کانتینر (UTC). */
export function clinicMinuteOfDay(at: Date = new Date()): number {
  const [h, m] = HHMM.format(at).split(':').map(Number);
  return h * 60 + m;
}

/**
 * **برنامهٔ کاری و روزهای آزاد** — `docs/BOOKING.md` مرحلهٔ ۲.
 *
 * ⚠️ همهٔ محاسبه این‌جاست، نه در کلاینت (قانون ۱۵). «چند جا خالی مانده» یک
 * عددِ مشتق است و اگر کلاینت هم حسابش کند، دو تعریف پیدا می‌کند: بیمار
 * ظرفیتِ آزاد می‌بیند و سرور رد می‌کند — یا بدتر، برعکس.
 *
 * ⚠️ روزِ هفته **شمسی** است (شنبه = ۰). `Date.getDay()` میلادی است و یکشنبه
 * را صفر می‌گیرد؛ استفادهٔ مستقیمش یعنی «شنبه‌ها ویزیتِ اولیه» روی یکشنبه
 * بیفتد و هیچ‌کس تا اولین بیمارِ سرگردان متوجه نشود.
 */
@Injectable()
export class AvailabilityService {
  constructor(private prisma: PrismaService) {}

  /** شنبه = ۰ … جمعه = ۶. مبنا: ۱۹۷۰/۰۱/۰۱ میلادی پنجشنبه بوده. */
  static jalaliWeekday(d: Date): number {
    return (d.getUTCDay() + 1) % 7;
  }

  /** «۱۷:۰۰» ← 1020. برای نمایش و برعکسش برای ذخیره. */
  static minToHHMM(min: number): string {
    return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  }

  private static dayKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /** نیمه‌شبِ UTCِ همان روز — ستونِ `date` از نوعِ `DATE` است. */
  private static midnight(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  private assertWindow(dto: any) {
    const s = Number(dto.startMin);
    const e = Number(dto.endMin);
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > 24 * 60 || s >= e) {
      throw new BadRequestException('بازهٔ ساعت نامعتبر است — پایان باید بعد از شروع باشد');
    }
    if (dto.mode === 'capacity') {
      if (!Number.isInteger(dto.capacity) || dto.capacity < 1) {
        throw new BadRequestException('ظرفیت را وارد کنید (دستِ‌کم ۱ نفر)');
      }
    } else {
      const m = Number(dto.slotMinutes);
      if (!Number.isInteger(m) || m < 5 || m > 480) {
        throw new BadRequestException('طولِ نوبت را وارد کنید (۵ تا ۴۸۰ دقیقه)');
      }
      /* ⚠️ بازه‌ای که به طولِ نوبت بخش‌پذیر نیست، آخرین نوبتِ ناقص می‌سازد.
         به‌جای ردکردنِ کاربر، فقط نوبت‌های کاملِ داخلِ بازه ساخته می‌شوند —
         ولی اگر حتی یکی هم جا نشود، این یک قاعدهٔ بی‌اثر است و باید گفت. */
      if (e - s < m) throw new BadRequestException('بازه از طولِ یک نوبت کوتاه‌تر است');
    }
  }

  // ──────────────────────── قاعده‌های برنامهٔ کاری ────────────────────────

  private ruleView(r: any) {
    return {
      id: r.id,
      doctorId: r.doctorId,
      doctorName: r.doctor ? `${r.doctor.person.firstName} ${r.doctor.person.lastName}`.trim() : null,
      weekday: r.weekday,
      startMin: r.startMin,
      endMin: r.endMin,
      start: AvailabilityService.minToHHMM(r.startMin),
      end: AvailabilityService.minToHHMM(r.endMin),
      mode: r.mode,
      slotMinutes: r.slotMinutes,
      capacity: r.capacity,
      /* ظرفیتِ نظری هم مشتقِ سمتِ سرور است: «شنبه چند نفر جا دارد» نباید در
         دو جا دو جور حساب شود. */
      slotsPerDay: r.mode === 'slot' && r.slotMinutes
        ? Math.floor((r.endMin - r.startMin) / r.slotMinutes)
        : (r.capacity ?? 0),
      topics: (r.topics ?? []).map((t: any) => ({ id: t.topic.id, name: t.topic.name })),
      activeFrom: r.activeFrom,
      activeTo: r.activeTo,
      active: r.active,
    };
  }

  private static readonly RULE_INCLUDE = {
    doctor: { include: { person: { select: { firstName: true, lastName: true } } } },
    topics: { include: { topic: { select: { id: true, name: true } } } },
  } as const;

  async listRules() {
    const rows = await this.prisma.availabilityRule.findMany({
      orderBy: [{ active: 'desc' }, { weekday: 'asc' }, { startMin: 'asc' }],
      include: AvailabilityService.RULE_INCLUDE,
    });
    return rows.map((r) => this.ruleView(r));
  }

  async createRule(dto: any) {
    if (!Number.isInteger(dto.weekday) || dto.weekday < 0 || dto.weekday > 6) {
      throw new BadRequestException('روزِ هفته نامعتبر است');
    }
    this.assertWindow(dto);
    const row = await this.prisma.availabilityRule.create({
      data: {
        doctorId: dto.doctorId ?? null,
        weekday: dto.weekday,
        startMin: dto.startMin,
        endMin: dto.endMin,
        mode: dto.mode === 'capacity' ? 'capacity' : 'slot',
        slotMinutes: dto.mode === 'capacity' ? null : dto.slotMinutes,
        capacity: dto.mode === 'capacity' ? dto.capacity : null,
        ...(dto.activeFrom ? { activeFrom: new Date(dto.activeFrom) } : {}),
        ...(dto.activeTo ? { activeTo: new Date(dto.activeTo) } : {}),
        ...(dto.topicIds?.length
          ? { topics: { create: dto.topicIds.map((id: number) => ({ topicId: id })) } }
          : {}),
      },
      include: AvailabilityService.RULE_INCLUDE,
    });
    return this.ruleView(row);
  }

  async updateRule(id: number, dto: any) {
    const row = await this.prisma.availabilityRule.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('قاعدهٔ برنامهٔ کاری پیدا نشد');
    /* اعتبارسنجی روی مقدارِ **مؤثر** (موجود + پچ)، نه فقط پچ: وگرنه یک
       ویرایشِ جزئی می‌تواند قاعده‌ای بسازد که هیچ نوبتی در آن جا نمی‌شود. */
    const merged = { ...row, ...dto };
    if (merged.weekday < 0 || merged.weekday > 6) throw new BadRequestException('روزِ هفته نامعتبر است');
    this.assertWindow(merged);
    const updated = await this.prisma.availabilityRule.update({
      where: { id },
      data: {
        ...(dto.doctorId !== undefined ? { doctorId: dto.doctorId ?? null } : {}),
        ...(dto.weekday !== undefined ? { weekday: dto.weekday } : {}),
        ...(dto.startMin !== undefined ? { startMin: dto.startMin } : {}),
        ...(dto.endMin !== undefined ? { endMin: dto.endMin } : {}),
        ...(dto.mode !== undefined ? { mode: dto.mode } : {}),
        ...(dto.slotMinutes !== undefined ? { slotMinutes: merged.mode === 'capacity' ? null : dto.slotMinutes } : {}),
        ...(dto.capacity !== undefined ? { capacity: merged.mode === 'capacity' ? dto.capacity : null } : {}),
        ...(dto.activeTo !== undefined ? { activeTo: dto.activeTo ? new Date(dto.activeTo) : null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.topicIds !== undefined
          ? { topics: { deleteMany: {}, create: dto.topicIds.map((tid: number) => ({ topicId: tid })) } }
          : {}),
      },
      include: AvailabilityService.RULE_INCLUDE,
    });
    return this.ruleView(updated);
  }

  async deleteRule(id: number) {
    await this.prisma.availabilityRule.delete({ where: { id } });
    return { ok: true };
  }

  // ──────────────────────────── استثناها ────────────────────────────

  async listExceptions(from?: Date, to?: Date) {
    return this.prisma.availabilityException.findMany({
      where: from && to ? { date: { gte: from, lt: to } } : {},
      orderBy: { date: 'asc' },
    });
  }

  async createException(dto: any) {
    const date = new Date(dto.date);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('تاریخ نامعتبر است');
    if (!dto.closed) this.assertWindow(dto);
    return this.prisma.availabilityException.create({
      data: {
        date: AvailabilityService.midnight(date),
        doctorId: dto.doctorId ?? null,
        closed: dto.closed !== false,
        startMin: dto.closed === false ? dto.startMin : null,
        endMin: dto.closed === false ? dto.endMin : null,
        mode: dto.closed === false ? (dto.mode ?? 'slot') : null,
        slotMinutes: dto.closed === false && dto.mode !== 'capacity' ? dto.slotMinutes : null,
        capacity: dto.closed === false && dto.mode === 'capacity' ? dto.capacity : null,
        note: dto.note?.trim() || null,
      },
    });
  }

  async deleteException(id: number) {
    await this.prisma.availabilityException.delete({ where: { id } });
    return { ok: true };
  }

  // ─────────────────────── محاسبهٔ روزها و جاهای آزاد ───────────────────────

  /**
   * تقویمِ آزادِ یک ماهِ شمسی.
   *
   * برای هر روز می‌گوید باز است یا نه، چه موضوع‌هایی مجازند، و **چقدر جا
   * مانده** — با کم‌کردنِ نوبت‌های گرفته‌شده. روزِ گذشته هرگز باز نیست.
   */
  /**
   * `patient`: نمای بیمار — ساعت‌های امروز که شروعشان از «اکنون + حاشیه» گذشته گرفتنی نیستند.
   * کارکنان (میزِ پذیرش، تقویم) عمداً همان نمای قبلی را می‌گیرند: منشی بیمارِ حاضرِ دیرآمده را
   * آگاهانه در اسلاتِ جاری می‌نشاند.
   */
  async month(jy: number, jm: number, opts: { doctorId?: number; topicId?: number; patient?: boolean } = {}) {
    if (!Number.isInteger(jy) || jy < 1300 || jy > 1500) throw new BadRequestException('سالِ نامعتبر');
    if (!Number.isInteger(jm) || jm < 1 || jm > 12) throw new BadRequestException('ماهِ نامعتبر');
    const [from, to] = jalaliMonthRange(jy, jm);

    const doctorWhere = opts.doctorId
      ? { OR: [{ doctorId: opts.doctorId }, { doctorId: null }] }
      : {};

    const [rules, exceptions, booked] = await Promise.all([
      this.prisma.availabilityRule.findMany({
        where: {
          active: true,
          ...doctorWhere,
          activeFrom: { lt: to },
          OR: [{ activeTo: null }, { activeTo: { gte: from } }],
        },
        include: AvailabilityService.RULE_INCLUDE,
      }),
      this.prisma.availabilityException.findMany({ where: { date: { gte: from, lt: to } } }),
      /* نوبت‌های زنده. `cancelled` و `noshow` جا اشغال نمی‌کنند — وگرنه هر
         کنسلی یک جای سوخته می‌ساخت. ⚠️ `arrived` حتماً باید باشد: بیماری که
         در مطب نشسته اگر جا آزاد کند، نفرِ بعدی روی همان اسلات می‌نشیند. */
      this.prisma.appointment.findMany({
        where: { date: { gte: from, lt: to }, status: { in: ['held', 'confirmed', 'arrived', 'done'] } },
        select: { date: true, startMin: true, doctorId: true },
      }),
    ]);

    const takenByDay = new Map<string, { count: number; mins: Set<number> }>();
    for (const a of booked) {
      const k = AvailabilityService.dayKey(a.date);
      if (!takenByDay.has(k)) takenByDay.set(k, { count: 0, mins: new Set() });
      const slot = takenByDay.get(k)!;
      slot.count += 1;
      if (a.startMin != null) slot.mins.add(a.startMin);
    }

    const closedDays = new Set(exceptions.filter((e) => e.closed).map((e) => AvailabilityService.dayKey(e.date)));
    const extraByDay = new Map<string, any>();
    for (const e of exceptions.filter((x) => !x.closed)) extraByDay.set(AvailabilityService.dayKey(e.date), e);

    /* «امروز» = **روزِ تقویمیِ مطب** (`clinic-day.ts`)، به‌شکلِ همان نیمه‌شبِ UTCِ ستونِ `DATE`.
       ⚠️ تا دیروز نیمه‌شبِ UTCِ ساعتِ کانتینر بود: از ۰۰:۰۰ تا ۰۳:۳۰ِ تهران «امروز» هنوز دیروز بود و
       ساعت‌های عصرِ دیروز باز می‌ماند — در آزمون، ۰۰:۰۲ِ ۷ مهر رزروِ ۱۶:۰۰ِ ۶ مهر پذیرفته شد
       (بازبینیِ UX، بندِ ۹۷). */
    const todayIso = clinicTodayIso();
    const today = dayUtc(todayIso);
    /* ساعتِ برش فقط برای امروز و فقط در نمای بیمار؛ ‎-1 یعنی «هیچ ساعتی گذشته نیست». */
    const cutoffMin = opts.patient ? clinicMinuteOfDay() + PATIENT_LEAD_MIN : -1;

    const days: any[] = [];
    for (let d = new Date(from); d < to; d = new Date(d.getTime() + 86400000)) {
      const key = AvailabilityService.dayKey(d);
      const [, , jd] = toJalali(d);
      const past = d < today;
      const isToday = key === todayIso;
      const weekday = AvailabilityService.jalaliWeekday(d);

      const extra = extraByDay.get(key);
      const applicable = extra
        ? [{ ...extra, topics: [] as any[] }]
        /* 🔴 **بازهٔ اعتبارِ قاعده روزشمار است، نه ساعت‌شمار.**
           `activeFrom` پیش‌فرضش `now()` است، یعنی قاعده‌ای که امروز ساعتِ ۱۰:۳۵
           ساخته می‌شود همان مهر را می‌خورد — و `d` نیمه‌شبِ همان روز است. با
           مقایسهٔ خام (`10:35 <= 00:00`) **قاعده‌ای که امروز تعریف شود امروز
           اثر ندارد**، خلافِ نیتی که چند خط بالاتر صریح نوشته شده («روزِ جاری
           تا آخرِ شب قابلِ رزرو بماند»).

           معمولاً کسی نمی‌فهمید چون فردا کار می‌کرد؛ ۳۱ شهریورِ ۱۴۰۵ رویش را
           باز کرد: آخرین روزِ ماه، پس هیچ «فردایی» در همان ماه نبود و نمای ماه
           **هیچ روزِ بازی** نداشت — مطبی که صبح برنامه‌اش را تعریف می‌کند،
           صفحهٔ نوبت‌دهی‌اش تا اولِ ماهِ بعد خالی می‌مانْد. */
        : rules.filter((r) => r.weekday === weekday
            && AvailabilityService.midnight(r.activeFrom) <= d
            && (!r.activeTo || AvailabilityService.midnight(r.activeTo) >= d)
            && (!opts.topicId || r.topics.length === 0 || r.topics.some((t) => t.topicId === opts.topicId)));

      const taken = takenByDay.get(key) ?? { count: 0, mins: new Set<number>() };
      const windows: any[] = [];
      let free = 0;

      if (!closedDays.has(key) && !past) {
        for (const r of applicable as any[]) {
          if (r.mode === 'capacity') {
            /* پنجرهٔ ظرفیتی تا وقتی تمام نشده گرفتنی است — بیمار در طولِ پنجره می‌رسد. */
            const gone = isToday && r.endMin <= cutoffMin;
            const left = gone ? 0 : Math.max(0, (r.capacity ?? 0) - taken.count);
            free += left;
            windows.push({
              ruleId: r.id ?? null, mode: 'capacity',
              start: AvailabilityService.minToHHMM(r.startMin),
              end: AvailabilityService.minToHHMM(r.endMin),
              capacity: r.capacity ?? 0, left, ...(gone ? { past: true } : {}),
              topics: (r.topics ?? []).map((t: any) => ({ id: t.topic.id, name: t.topic.name })),
            });
          } else {
            const step = r.slotMinutes ?? 0;
            const slots: any[] = [];
            for (let m = r.startMin; step > 0 && m + step <= r.endMin; m += step) {
              const busy = taken.mins.has(m);
              /* گذشته = گرفتنی نیست؛ همان شکلِ «پر» به‌اضافهٔ `past` تا پیامِ رزرو بتواند بگوید چرا. */
              const gone = isToday && m < cutoffMin;
              if (!busy && !gone) free += 1;
              slots.push({ startMin: m, time: AvailabilityService.minToHHMM(m), taken: busy || gone, ...(gone ? { past: true } : {}) });
            }
            windows.push({
              ruleId: r.id ?? null, mode: 'slot',
              start: AvailabilityService.minToHHMM(r.startMin),
              end: AvailabilityService.minToHHMM(r.endMin),
              slotMinutes: step, slots,
              topics: (r.topics ?? []).map((t: any) => ({ id: t.topic.id, name: t.topic.name })),
            });
          }
        }
      }

      days.push({
        day: jd,
        date: key,
        weekday,
        past,
        closed: closedDays.has(key),
        /* ⚠️ «باز» یعنی **جای آزاد دارد**، نه «قاعده دارد». روزی که ظرفیتش پر
           شده از دیدِ بیمار بسته است و اگر باز نشانش بدهیم، تا لحظهٔ رد‌شدنِ
           رزرو نمی‌فهمد. */
        open: !past && !closedDays.has(key) && free > 0,
        free,
        windows,
      });
    }

    return { jy, jm, days };
  }
}
