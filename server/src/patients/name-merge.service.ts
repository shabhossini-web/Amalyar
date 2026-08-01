import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { bestMatches, normalizeName } from '../common/name-match';

/**
 * یکسان‌سازیِ نامِ بیمارستان.
 *
 * فرمِ مراجعه و ایمپورتِ ملک‌طب نامِ آزاد می‌دهند: «لقمان»، «لقمان حکیم»،
 * «بیمارستان لقمان». تا وقتی این‌ها به یک موجودیت نرسند، گزارشِ «درآمد به
 * تفکیکِ بیمارستان» چند ردیفِ نصفه می‌دهد و هیچ‌کدام درست نیست.
 *
 * ⚠️ **هیچ ادغامی خودکار نیست.** ماشین فقط پیشنهاد می‌دهد؛ تأییدِ آدم به
 * «نامِ مستعار» تبدیل می‌شود تا دفعهٔ بعد نپرسد. ادغامِ خودکارِ اشتباه دو
 * بیمارستانِ واقعاً متفاوت را برای همیشه یکی می‌کند — و چون گزارش همچنان عدد
 * می‌دهد، کسی متوجه نمی‌شود.
 */
@Injectable()
export class NameMergeService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /**
   * نام‌های آزادِ بی‌صاحب، گروه‌بندی‌شده بر شکلِ کانونی، با پیشنهادِ تطبیق.
   *
   * گروه‌بندی روی **نرمال‌شده** است نه روی رشتهٔ خام: وگرنه «لقمان» و «لقمان »
   * دو ردیفِ جدا می‌شدند و کاربر باید دوبار همان تصمیم را می‌گرفت.
   */
  async pending() {
    const [rows, hospitals, aliases] = await Promise.all([
      this.prisma.visit.findMany({
        where: { hospitalId: null, NOT: { hospitalName: null } },
        select: { id: true, hospitalName: true, opDate: true },
      }),
      this.prisma.hospital.findMany({ select: { id: true, name: true, active: true } }),
      this.prisma.hospitalAlias.findMany({ select: { aliasNorm: true, hospitalId: true } }),
    ]);
    const known = new Map(aliases.map((a) => [a.aliasNorm, a.hospitalId]));

    const groups = new Map<string, { key: string; samples: Set<string>; visitIds: number[]; lastSeen: Date | null }>();
    for (const v of rows) {
      const key = normalizeName(v.hospitalName);
      if (!key) continue;
      // نامی که قبلاً تأیید شده دیگر «در انتظار» نیست — فقط هنوز اعمال نشده.
      const g = groups.get(key) ?? { key, samples: new Set<string>(), visitIds: [], lastSeen: null };
      g.samples.add(v.hospitalName!.trim());
      g.visitIds.push(v.id);
      if (!g.lastSeen || (v.opDate && v.opDate > g.lastSeen)) g.lastSeen = v.opDate;
      groups.set(key, g);
    }

    return [...groups.values()]
      .map((g) => {
        const sample = [...g.samples][0];
        const linked = known.get(g.key) ?? null;
        return {
          key: g.key,
          names: [...g.samples],
          count: g.visitIds.length,
          visitIds: g.visitIds,
          lastSeen: g.lastSeen,
          // نامی که قبلاً به نامِ مستعار تبدیل شده: فقط باید اعمال شود.
          resolvedHospitalId: linked,
          suggestions: linked ? [] : bestMatches(sample, hospitals.filter((h) => h.active)),
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  /**
   * تأییدِ یک نگاشت: نامِ آزاد → بیمارستانِ موجود.
   *
   * دو کار می‌کند و هر دو لازم است: مراجعاتِ موجود را وصل می‌کند (`back-fill`)
   * و نگاشت را به‌شکلِ نامِ مستعار ذخیره می‌کند تا **دفعهٔ بعد** خودکار حل شود.
   * بدونِ دومی، هر ایمپورتِ تازه همان سؤال را دوباره می‌پرسد.
   */
  async link(dto: { name: string; hospitalId: number }, user: any) {
    const norm = normalizeName(dto.name);
    if (!norm) throw new BadRequestException('نام خالی است');
    const h = await this.prisma.hospital.findUnique({ where: { id: Number(dto.hospitalId) } });
    if (!h) throw new NotFoundException('بیمارستان یافت نشد');

    const clash = await this.prisma.hospitalAlias.findUnique({ where: { aliasNorm: norm } });
    if (clash && clash.hospitalId !== h.id) {
      throw new BadRequestException('این نام قبلاً به بیمارستانِ دیگری نسبت داده شده است');
    }

    const linked = await this.prisma.$transaction(async (tx) => {
      if (!clash) {
        await tx.hospitalAlias.create({
          data: { hospitalId: h.id, alias: dto.name.trim(), aliasNorm: norm, createdById: user?.id ?? null },
        });
      }
      // فقط مراجعاتی که همین شکلِ کانونی را دارند. مقایسه در حافظه انجام
      // می‌شود چون نرمال‌سازی منطقِ ماست، نه تابعِ دیتابیس.
      const cands = await tx.visit.findMany({
        where: { hospitalId: null, NOT: { hospitalName: null } },
        select: { id: true, hospitalName: true },
      });
      const ids = cands.filter((v) => normalizeName(v.hospitalName) === norm).map((v) => v.id);
      if (ids.length) {
        await tx.visit.updateMany({
          where: { id: { in: ids } },
          // نامِ متنی هم به نامِ رسمی به‌روز می‌شود: عکسِ لحظهٔ ثبت وقتی معنا
          // دارد که رابطه نباشد؛ حالا رابطه هست و متنِ قدیمی فقط گمراه می‌کند.
          data: { hospitalId: h.id, hospitalName: h.name },
        });
      }
      return ids.length;
    });

    await this.audit.record({
      actorId: user?.id, action: 'hospital.alias.link', entityType: 'hospital', entityId: h.id,
      after: { alias: dto.name.trim(), aliasNorm: norm, visitsLinked: linked },
    });
    return { ok: true, hospitalId: h.id, hospitalName: h.name, visitsLinked: linked };
  }

  /**
   * ساختِ بیمارستانِ تازه از یک نامِ آزاد + وصل‌کردنِ همهٔ مراجعاتش.
   *
   * لازم است چون بخشی از نام‌های بی‌صاحب واقعاً بیمارستانِ تعریف‌نشده‌اند، و
   * مجبورکردنِ کاربر به رفتن و برگشتن از تعاریفِ پایه یعنی این صفحه نیمه‌کاره
   * رها می‌شود.
   */
  async createFrom(dto: { name: string }, user: any) {
    const name = dto.name?.trim();
    if (!name || name.length < 2) throw new BadRequestException('نام را کامل وارد کنید');
    const dup = await this.prisma.hospital.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    const h = dup ?? await this.prisma.hospital.create({ data: { name } });
    return this.link({ name, hospitalId: h.id }, user);
  }

  /** نام‌های مستعارِ ثبت‌شدهٔ یک بیمارستان. */
  async aliases(hospitalId: number) {
    return this.prisma.hospitalAlias.findMany({
      where: { hospitalId },
      orderBy: { id: 'asc' },
      select: { id: true, alias: true, aliasNorm: true, createdAt: true },
    });
  }

  async removeAlias(id: number, user: any) {
    const row = await this.prisma.hospitalAlias.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('نامِ مستعار یافت نشد');
    await this.prisma.hospitalAlias.delete({ where: { id } });
    await this.audit.record({
      actorId: user?.id, action: 'hospital.alias.remove', entityType: 'hospital', entityId: row.hospitalId, before: row,
    });
    return { ok: true };
  }

  /**
   * حلِ یک نامِ آزاد به بیمارستان — نقطهٔ ورودِ ایمپورت و فرمِ بیمار.
   *
   * ترتیب عمدی است: نامِ رسمی، بعد نامِ مستعارِ تأییدشده. **حدس این‌جا اعمال
   * نمی‌شود** — فقط برگردانده می‌شود تا کاربر تصمیم بگیرد.
   */
  async resolve(raw: string) {
    const norm = normalizeName(raw);
    if (!norm) return { hospitalId: null, matchedBy: null, suggestions: [] };

    const hospitals = await this.prisma.hospital.findMany({ select: { id: true, name: true, active: true } });
    const exact = hospitals.find((h) => normalizeName(h.name) === norm);
    if (exact) return { hospitalId: exact.id, hospitalName: exact.name, matchedBy: 'name', suggestions: [] };

    const alias = await this.prisma.hospitalAlias.findUnique({
      where: { aliasNorm: norm }, include: { hospital: { select: { id: true, name: true } } },
    });
    if (alias) return { hospitalId: alias.hospitalId, hospitalName: alias.hospital.name, matchedBy: 'alias', suggestions: [] };

    return { hospitalId: null, matchedBy: null, suggestions: bestMatches(raw, hospitals.filter((h) => h.active)) };
  }
}
