import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVisitDto, UpdateVisitDto } from './dto/visit.dto';
import { randomUUID } from 'crypto';
import { LEVEL } from '../common/levels';
import { toEnDigits } from '../common/identity';
import { actorName } from '../common/person';
import { AuditService } from '../audit/audit.service';
import { summarize } from './billing.service';

/**
 * غنی‌سازیِ مراجعه — قانونِ computeVisit: فیلدهای مشتق فقط این‌جا ساخته می‌شوند
 * و کلاینت هیچ فرمولی در render ندارد. همهٔ مبالغ «تومان»اند.
 */
function enrich(v: any) {
  return {
    id: v.id,
    patientId: v.patientId,
    kind: v.kind,
    code: `${v.patient.code}-V${v.seq}`,
    patientCode: v.patient.code,
    firstName: v.patient.firstName,
    lastName: v.patient.lastName,
    fullName: `${v.patient.firstName} ${v.patient.lastName}`.trim(),
    phone: v.patient.phone,
    nationalId: v.patient.nationalId,
    birthDate: v.patient.birthDate,
    surgeonId: v.surgeonId,
    hospitalId: v.hospitalId,
    techId: v.techId,
    // نامِ رابطه اگر بود، وگرنه denormalized (رکوردهای قدیمی/موجودیتِ حذف‌شده)
    surgeonName: v.surgeon ? `${v.surgeon.person.firstName} ${v.surgeon.person.lastName}`.trim() : v.surgeonName,
    hospitalName: v.hospital?.name ?? v.hospitalName,
    techName: v.tech ? `${v.tech.person.firstName} ${v.tech.person.lastName}`.trim() : null,
    procedureTypeId: v.procedureTypeId,
    procedureTypeName: v.procedureType?.name ?? v.opType,
    diagnosisId: v.diagnosisId,
    diagnosisTitle: v.diagnosis?.title ?? null,
    // شرحِ عمل حالا یک ClinicalNote است (نسخه‌دار و تغییرناپذیر)، ولی فرمِ مراجعه
    // همان یک فیلد را می‌بیند — تنها نسخهٔ جاری.
    opReport: v.clinicalNotes?.[0]?.body ?? null,
    opType: v.opType,
    opDate: v.opDate,
    opStatus: v.opStatus,
    opStartTime: v.opStartTime,
    opEndTime: v.opEndTime,
    techArriveTime: v.techArriveTime,
    cargoDueTime: v.cargoDueTime,
    opTimesUpdatedAt: v.opTimesUpdatedAt,
    // مدتِ عمل مشتق است و فقط این‌جا حساب می‌شود — هیچ render ای اجازهٔ تفریقِ
    // ساعت ندارد، وگرنه عملِ نیمه‌شب در یک جا درست و در جای دیگر منفی می‌شود.
    durationMin: durationOf(v.opStartTime, v.opEndTime),
    // جمع‌های مالی از ردیف‌ها مشتق می‌شوند (قانونِ computeVisit)؛ هیچ render ای
    // اجازهٔ جمع‌زدن ندارد و هیچ ستونِ سرجمعی در DB نیست که از واقعیت عقب بماند.
    ...summarize(v.charges ?? [], v.payments ?? []),
    notes: v.notes,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

/** «HH:MM» بیست‌وچهارساعته — تنها شکلِ پذیرفته‌شدهٔ ساعت. */
export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * نرمال‌سازیِ ساعتِ ورودی.
 *
 * ارقامِ فارسی/عربی و «۸:۵» را می‌پذیرد و به «08:05» تبدیل می‌کند؛ رشتهٔ خالی
 * یعنی «پاک کن». هرچیزِ دیگر خطاست — ساعتِ نامعتبر که سکوت‌وار nullشود، یعنی
 * کاربر فکر می‌کند ثبت شده و نشده.
 */
export function normalizeTime(v: unknown, label: string): string | null {
  if (v === undefined || v === null) return null;
  const raw = toEnDigits(String(v)).trim();
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(raw);
  if (!m) throw new BadRequestException(`${label} باید به شکلِ ۰۸:۳۰ باشد`);
  const out = `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}`;
  if (!TIME_RE.test(out)) throw new BadRequestException(`${label} معتبر نیست`);
  return out;
}

/**
 * مدتِ عمل به دقیقه.
 *
 * پایانِ کوچک‌تر از شروع یعنی عمل از نیمه‌شب گذشته — که در جراحیِ طولانی
 * عادی است — پس ۲۴ ساعت اضافه می‌شود، نه اینکه عددِ منفی برگردد.
 */
export function durationOf(start?: string | null, end?: string | null): number | null {
  if (!start || !end || !TIME_RE.test(start) || !TIME_RE.test(end)) return null;
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const diff = mins(end) - mins(start);
  return diff < 0 ? diff + 24 * 60 : diff;
}

/**
 * تکهٔ ساعت‌ها برای patch — فقط کلیدهایی که واقعاً آمده‌اند.
 *
 * `undefined` یعنی «دست نزن» و رشتهٔ خالی یعنی «پاک کن»؛ تفاوتشان مهم است،
 * وگرنه هر ذخیرهٔ فرم، ساعتی را که کارشناس ثبت کرده پاک می‌کند.
 */
function timePatch(dto: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const map = {
    opStartTime: 'ساعتِ شروع',
    opEndTime: 'ساعتِ پایان',
    techArriveTime: 'ساعتِ حضورِ کارشناس',
    cargoDueTime: 'ساعتِ تحویلِ بار',
  } as const;
  for (const [key, label] of Object.entries(map)) {
    if (dto[key] !== undefined) out[key] = normalizeTime(dto[key], label);
  }
  if (Object.keys(out).length) out.opTimesUpdatedAt = new Date();
  return out;
}

/** فهرستِ بستهٔ سورت — رشتهٔ دلخواهِ کاربر مستقیم به orderBy نمی‌رود. */
/**
 * کلیدهای سورت.
 *
 * ⚠️ `due` و `total` **مشتق‌اند و ستونِ دیتابیس ندارند**، پس ORDER BY نمی‌گیرند.
 * تا فازِ حسابداری نداشتیم عمداً حذف شده بودند (ساختنِ ستونِ ذخیره‌شده ناقضِ
 * قانونِ computeVisit بود). حالا با aggregate واقعی می‌آیند: شناسه‌ها اول
 * مرتب و صفحه‌بندی می‌شوند، بعد ردیف‌ها خوانده می‌شوند — نه اینکه کلِ جدول در
 * حافظه بیاید.
 */
export const SORTS = ['date', 'created', 'name', 'code', 'due', 'total'] as const;
/// سورت‌هایی که از جمعِ مالی می‌آیند نه از ستونِ Visit.
export const MONEY_SORTS = ['due', 'total'] as const;
export type SortKey = (typeof SORTS)[number];
export const DEFAULT_SORT: SortKey = 'date';
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
/// سقفِ خروجی — بالا ولی صریح؛ فراتر از این، گزارش کارِ ماژولِ حسابداری است.
export const EXPORT_LIMIT = 5000;

export type VisitFilter = {
  q?: string;
  status?: string;
  kind?: string;
  surgeonId?: number;
  hospitalId?: number;
  techId?: number;
  procedureTypeId?: number;
  diagnosisId?: number;
  from?: Date;
  to?: Date;
  /// فقط مراجعاتی که هنوز بدهی دارند.
  owing?: boolean;
  sort?: string;
  dir?: string;
  page?: number;
  pageSize?: number;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * ترتیب — همیشه با `id` به‌عنوانِ شکنندهٔ تساوی تمام می‌شود.
 *
 * بدونِ آن، دو مراجعه با تاریخِ یکسان ترتیبِ ناپایدار می‌گیرند و همان رکورد در
 * صفحهٔ ۱ و ۲ ظاهر (یا از هر دو غایب) می‌شود — باگی که فقط با صفحه‌بندی دیده می‌شود.
 */
function orderFor(sort?: string, dir?: string): any[] {
  const d: 'asc' | 'desc' = dir === 'asc' ? 'asc' : 'desc';
  const key = (SORTS as readonly string[]).includes(sort ?? '') ? (sort as SortKey) : DEFAULT_SORT;
  const tail = [{ id: d }];
  switch (key) {
    case 'created': return [{ createdAt: d }, ...tail];
    case 'name': return [{ patient: { lastName: d } }, { patient: { firstName: d } }, ...tail];
    case 'code': return [{ patient: { code: d } }, { seq: d }, ...tail];
    // مراجعهٔ بدونِ تاریخ همیشه ته فهرست، چه صعودی چه نزولی.
    default: return [{ opDate: { sort: d, nulls: 'last' } }, ...tail];
  }
}

// جراح و کارشناس هویتشان در Person است، پس همیشه با آن خوانده می‌شوند.
const INCLUDE_PATIENT = {
  patient: true,
  hospital: true,
  procedureType: true,
  diagnosis: true,
  surgeon: { include: { person: true } },
  tech: { include: { person: true } },
  // فقط نسخهٔ جاریِ شرحِ عمل؛ تاریخچه از مسیرِ پروندهٔ بیمار خوانده می‌شود.
  clinicalNotes: {
    where: { kind: 'op', replacedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  // فقط مبلغ لازم است؛ کلِ ردیف‌ها را برای فهرستِ ۵۰۰تایی نمی‌کشیم.
  charges: { select: { amount: true } },
  payments: { select: { amount: true } },
} as const;

@Injectable()
export class PatientsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private scopedVisitWhere(user: any, where: any = {}) {
    if ((user?.level ?? 0) >= LEVEL.SUPERVISOR) return { ...where };
    return { ...where, techId: user?.id ?? -1 };
  }

  private async assertVisitAccess(id: number, user: any) {
    const v = await this.prisma.visit.findFirst({ where: this.scopedVisitWhere(user, { id }) });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    return v;
  }

  /**
   * لیستِ مراجعات — جستجوی آزاد + فیلترِ چندپارامتری + سورت + صفحه‌بندی.
   *
   * ⚠️ سورت و فیلتر فقط روی ستون‌های واقعیِ دیتابیس‌اند. «مانده» و «جمعِ کل»
   * مشتق‌اند (جمعِ ردیف‌های Charge/Payment) و ستونی ندارند که بشود روی آن
   * ORDER BY زد؛ ساختنِ چنین ستونی همان عددِ ذخیره‌شده‌ای است که از واقعیت عقب
   * می‌ماند و قانونِ computeVisit منعش می‌کند. سورت/فیلترِ مالی وقتی می‌آید که
   * ماژولِ حسابداری aggregate یا view واقعی بسازد.
   */
  /**
   * ساختِ شرطِ جستجو — **یک جا**، تا فهرست و خروجی هرگز از هم جدا نشوند.
   *
   * اگر خروجی شرطِ خودش را می‌ساخت، اولین فیلترِ تازه در یکی اضافه می‌شد و در
   * دیگری نه؛ کاربر «همین فهرست» را خروجی می‌گرفت و چیزِ دیگری تحویل می‌گرفت.
   */
  private visitWhere(f: VisitFilter, user?: any) {
    const { q, status, kind } = f;
    const where: any = {};
    if (status && status !== 'all') where.opStatus = status;
    if (kind && kind !== 'all') where.kind = kind;

    for (const key of ['surgeonId', 'hospitalId', 'techId', 'procedureTypeId', 'diagnosisId'] as const) {
      if (f[key]) where[key] = f[key];
    }

    // بازهٔ تاریخِ عمل. «تا» شاملِ خودِ روز است — کاربری که یک تاریخ را به‌عنوان
    // پایان می‌زند انتظار دارد عمل‌های همان روز را هم ببیند.
    if (f.from || f.to) {
      where.opDate = {};
      if (f.from) where.opDate.gte = f.from;
      if (f.to) {
        const end = new Date(f.to);
        end.setHours(23, 59, 59, 999);
        where.opDate.lte = end;
      }
    }

    if (q?.trim()) {
      const t = q.trim();
      where.OR = [
        { patient: { firstName: { contains: t, mode: 'insensitive' } } },
        { patient: { lastName: { contains: t, mode: 'insensitive' } } },
        { patient: { code: { contains: t, mode: 'insensitive' } } },
        { patient: { phone: { contains: t } } },
        { patient: { nationalId: { contains: t } } },
        { surgeonName: { contains: t, mode: 'insensitive' } },
        { hospitalName: { contains: t, mode: 'insensitive' } },
        { surgeon: { person: { OR: [
          { firstName: { contains: t, mode: 'insensitive' } },
          { lastName: { contains: t, mode: 'insensitive' } },
        ] } } },
        { procedureType: { name: { contains: t, mode: 'insensitive' } } },
        { diagnosis: { title: { contains: t, mode: 'insensitive' } } },
        { hospital: { name: { contains: t, mode: 'insensitive' } } },
        { opType: { contains: t, mode: 'insensitive' } },
        { tech: { person: { OR: [
          { firstName: { contains: t, mode: 'insensitive' } },
          { lastName: { contains: t, mode: 'insensitive' } },
        ] } } },
      ];
    }
    return this.scopedVisitWhere(user, { ...where, patient: { ...(where.patient ?? {}), deletedAt: null } });
  }

  async listVisits(f: VisitFilter = {}, user?: any) {
    const scoped = this.visitWhere(f, user);

    const pageSize = clamp(f.pageSize ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const page = Math.max(1, f.page ?? 1);
    const moneySort = (MONEY_SORTS as readonly string[]).includes(f.sort ?? '');

    // مسیرِ مالی: چون «مانده» ستون نیست، اول شناسه‌های مطابقِ فیلتر با جمعِ
    // مالی‌شان مرتب و بریده می‌شوند، بعد فقط همان صفحه از دیتابیس خوانده
    // می‌شود. مرتب‌کردنِ کلِ ردیف‌ها در حافظه با ۱۰هزار مراجعه می‌شکند.
    if (moneySort || f.owing) {
      const ids = await this.moneyOrderedIds(scoped, f);
      const total = ids.length;
      const pageIds = moneySort
        ? ids.slice((page - 1) * pageSize, page * pageSize)
        : ids.slice((page - 1) * pageSize, page * pageSize);
      const [found, stats] = await Promise.all([
        this.prisma.visit.findMany({ where: { id: { in: pageIds } }, include: INCLUDE_PATIENT }),
        this.visitStats({ ...scoped, AND: [...(scoped.AND ?? []), { id: { in: ids } }] }),
      ]);
      // ترتیبِ `IN` تضمین‌شده نیست، پس ردیف‌ها به ترتیبِ شناسه‌ها چیده می‌شوند.
      const byId = new Map(found.map((r) => [r.id, r]));
      return {
        rows: pageIds.map((id) => byId.get(id)).filter(Boolean).map(enrich),
        total, page, pageSize,
        pages: Math.max(1, Math.ceil(total / pageSize)),
        sort: moneySort ? f.sort : DEFAULT_SORT,
        dir: f.dir === 'asc' ? 'asc' : 'desc',
        stats,
      };
    }

    // total جدا شمرده می‌شود چون طولِ صفحه جوابِ «چند تا هست» را نمی‌دهد.
    const [total, rows, stats] = await Promise.all([
      this.prisma.visit.count({ where: scoped }),
      this.prisma.visit.findMany({
        where: scoped,
        include: INCLUDE_PATIENT,
        orderBy: orderFor(f.sort, f.dir),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.visitStats(scoped),
    ]);

    return {
      rows: rows.map(enrich),
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      sort: (SORTS as readonly string[]).includes(f.sort ?? '') ? f.sort : DEFAULT_SORT,
      dir: f.dir === 'asc' ? 'asc' : 'desc',
      stats,
    };
  }

  /**
   * شناسه‌های مطابقِ فیلتر، مرتب‌شده بر مبنای مالی.
   *
   * جمع‌ها با دو groupBy می‌آیند (نه N کوئری) و مرتب‌سازی روی همان شناسه‌ها
   * انجام می‌شود. مراجعهٔ بدونِ قلمِ فاکتور جمعِ صفر دارد، پس از فهرست نمی‌افتد —
   * وگرنه «سورت بر مانده» بی‌سروصدا بخشی از نتیجه را حذف می‌کرد.
   */
  private async moneyOrderedIds(scoped: any, f: VisitFilter): Promise<number[]> {
    const visits = await this.prisma.visit.findMany({ where: scoped, select: { id: true } });
    if (!visits.length) return [];
    const ids = visits.map((v) => v.id);
    const [charges, payments] = await Promise.all([
      this.prisma.charge.groupBy({ by: ['visitId'], where: { visitId: { in: ids } }, _sum: { amount: true } }),
      this.prisma.payment.groupBy({ by: ['visitId'], where: { visitId: { in: ids } }, _sum: { amount: true } }),
    ]);
    const totalOf = new Map(charges.map((c) => [c.visitId, c._sum.amount ?? 0]));
    const paidOf = new Map(payments.map((p) => [p.visitId, p._sum.amount ?? 0]));

    let rows = ids.map((id) => {
      const total = totalOf.get(id) ?? 0;
      return { id, total, due: Math.max(0, total - (paidOf.get(id) ?? 0)) };
    });
    if (f.owing) rows = rows.filter((r) => r.due > 0);

    const key = f.sort === 'total' ? 'total' : 'due';
    const asc = f.dir === 'asc';
    // شناسه tiebreaker است تا صفحه‌بندی پایدار بماند؛ بدونش ردیف‌های هم‌مبلغ
    // بین دو صفحه جابه‌جا می‌شوند و کاربر یکی را دوبار می‌بیند.
    if ((MONEY_SORTS as readonly string[]).includes(f.sort ?? '')) {
      rows.sort((a, b) => (asc ? a[key] - b[key] : b[key] - a[key]) || b.id - a.id);
    } else {
      rows.sort((a, b) => b.id - a.id);
    }
    return rows.map((r) => r.id);
  }

  /**
   * همهٔ ردیف‌های مطابقِ فیلتر — برای CSV و چاپ.
   *
   * صفحه‌بندی ندارد چون کاربر «همین فهرست» را می‌خواهد نه صفحهٔ جاری‌اش. ولی
   * بی‌سقف هم نیست: سقف صریح است و اگر خورد، `truncated` برمی‌گردد تا UI
   * بگوید — خروجیِ بی‌صدا بریده‌شده بدترین حالت است، چون کاربر آن را کامل
   * فرض می‌کند و رویش تصمیم می‌گیرد.
   */
  async exportVisits(f: VisitFilter = {}, user?: any) {
    const scoped = this.visitWhere(f, user);

    // ⚠️ خروجی باید **همان** فیلتر و سورتِ فهرست را بفهمد، از جمله مالی‌ها.
    // اگر این‌جا مسیرِ مالی نمی‌آمد، CSVِ «فقط بدهکار» همهٔ مراجعات را
    // برمی‌گرداند و کاربر بدونِ هیچ هشداری فایلِ اشتباه می‌گرفت.
    if ((MONEY_SORTS as readonly string[]).includes(f.sort ?? '') || f.owing) {
      const ids = await this.moneyOrderedIds(scoped, f);
      const take = ids.slice(0, EXPORT_LIMIT);
      const found = await this.prisma.visit.findMany({ where: { id: { in: take } }, include: INCLUDE_PATIENT });
      const byId = new Map(found.map((r) => [r.id, r]));
      return {
        rows: take.map((id) => byId.get(id)).filter(Boolean).map(enrich),
        truncated: ids.length > EXPORT_LIMIT,
        limit: EXPORT_LIMIT,
        stats: await this.visitStats({ ...scoped, AND: [...(scoped.AND ?? []), { id: { in: ids } }] }),
      };
    }

    const rows = await this.prisma.visit.findMany({
      where: scoped,
      include: INCLUDE_PATIENT,
      orderBy: orderFor(f.sort, f.dir),
      take: EXPORT_LIMIT + 1,
    });
    const truncated = rows.length > EXPORT_LIMIT;
    return {
      rows: rows.slice(0, EXPORT_LIMIT).map(enrich),
      truncated,
      limit: EXPORT_LIMIT,
      stats: await this.visitStats(scoped),
    };
  }

  /**
   * آمارِ کلِ نتیجهٔ فیلترشده — نه فقط صفحهٔ جاری.
   *
   * با آمدنِ صفحه‌بندی، جمع‌زدنِ سمتِ کلاینت غلط شد: کاربر «ماندهٔ کل» را
   * می‌خواند ولی فقط ماندهٔ ۵۰ ردیفِ روی صفحه را می‌دید. پس آمار به سرور آمد.
   */
  private async visitStats(scoped: any) {
    /**
     * ⚠️ شرطِ اضافه با AND ترکیب می‌شود، نه با بازنویسیِ کلید.
     *
     * قبلاً `{ ...scoped, opStatus: 'pending' }` بود؛ وقتی کاربر روی «تمام‌شده»
     * فیلتر کرده بود، همین spread شرطِ خودش را پاک می‌کرد و آمار از کلِ
     * دیتابیس حساب می‌شد — یعنی «ماندهٔ کل» و «در انتظار»ِ روی صفحه به فیلترِ
     * وضعیت اعتنا نمی‌کردند.
     */
    const and = (extra: any) => ({ ...scoped, AND: [...(scoped.AND ?? []), extra] });
    const live = and({ opStatus: { not: 'cancelled' } });
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const [total, pending, today, kinds, chargeRows, payRows] = await Promise.all([
      this.prisma.visit.count({ where: scoped }),
      this.prisma.visit.count({ where: and({ opStatus: 'pending' }) }),
      this.prisma.visit.count({ where: { ...live, AND: [...live.AND, { opDate: { gte: dayStart, lte: dayEnd } }] } }),
      // نوع‌های موجود در کلِ نتیجه — نه فقط صفحهٔ جاری، وگرنه چیپِ «ویزیت» با
      // ورق‌زدن ظاهر و ناپدید می‌شود.
      this.prisma.visit.groupBy({ by: ['kind'], where: scoped }),
      // به‌ازای هر مراجعه جمع می‌شود نه یک‌جا: مانده باید در سطحِ مراجعه صفر
      // شود، وگرنه اضافه‌پرداختِ یک بیمار بدهیِ بیمارِ دیگر را می‌پوشاند.
      this.prisma.charge.groupBy({ by: ['visitId'], where: { visit: live }, _sum: { amount: true } }),
      this.prisma.payment.groupBy({ by: ['visitId'], where: { visit: live }, _sum: { amount: true } }),
    ]);

    const paid = new Map(payRows.map((r) => [r.visitId, r._sum.amount ?? 0]));
    const dueOf = (visitId: number, charged: number) => Math.max(0, charged - (paid.get(visitId) ?? 0));
    const due = chargeRows.reduce((sum, r) => sum + dueOf(r.visitId, r._sum.amount ?? 0), 0);

    /**
     * ماندهٔ **به تفکیکِ طرفِ حساب**.
     *
     * «ماندهٔ کل» به‌تنهایی برای وصول بی‌فایده است: طلب از بیمار و طلب از
     * بیمارستانِ الف دو پرونده‌اند با دو تماس و دو زمان‌بندی. جمعِ سرجمعشان
     * فقط می‌گوید چقدر، نه از که.
     */
    const owing = chargeRows.filter((r) => dueOf(r.visitId, r._sum.amount ?? 0) > 0);
    let byPayer: { key: string; label: string; due: number; count: number }[] = [];
    if (owing.length) {
      const rows = await this.prisma.visit.findMany({
        where: { id: { in: owing.map((r) => r.visitId) } },
        select: { id: true, payer: true, payerHospitalId: true, payerHospital: { select: { name: true } } },
      });
      const chargedOf = new Map(owing.map((r) => [r.visitId, r._sum.amount ?? 0]));
      const acc = new Map<string, { label: string; due: number; count: number }>();
      for (const v of rows) {
        const key = v.payer === 'hospital' ? `hospital:${v.payerHospitalId ?? 0}` : 'patient';
        const label = v.payer === 'hospital' ? v.payerHospital?.name ?? 'بیمارستانِ نامشخص' : 'بیمار';
        const cur = acc.get(key) ?? { label, due: 0, count: 0 };
        cur.due += dueOf(v.id, chargedOf.get(v.id) ?? 0);
        cur.count += 1;
        acc.set(key, cur);
      }
      byPayer = [...acc.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.due - a.due);
    }

    return { total, pending, today, due, byPayer, kinds: kinds.map((k) => k.kind) };
  }

  async getVisit(id: number, user?: any) {
    await this.assertVisitAccess(id, user);
    const v = await this.prisma.visit.findUnique({ where: { id }, include: INCLUDE_PATIENT });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    return enrich(v);
  }

  /// جستجوی بیمارِ موجود (برای فرمِ «مراجعهٔ مجدد»)
  async searchPatients(q?: string, user?: any) {
    const t = q?.trim();
    const where: any = t
      ? {
          OR: [
            { firstName: { contains: t, mode: 'insensitive' } },
            { lastName: { contains: t, mode: 'insensitive' } },
            { code: { contains: t, mode: 'insensitive' } },
            { phone: { contains: toEnDigits(t) } },
            // کد ملی مطمئن‌ترین راهِ یافتنِ پروندهٔ قبلی است؛ نبودش یعنی کاربر
            // پروندهٔ موجود را پیدا نمی‌کرد و دوباره «بیمار جدید» می‌زد.
            { nationalId: { contains: toEnDigits(t) } },
          ],
        }
      : {};
    const rows = await this.prisma.patient.findMany({
      where: {
        ...where,
        deletedAt: null,
        ...((user?.level ?? 0) < LEVEL.SUPERVISOR ? { visits: { some: { techId: user?.id ?? -1 } } } : {}),
      },
      orderBy: { id: 'desc' },
      take: 20,
      include: { _count: { select: { visits: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      code: p.code,
      fullName: `${p.firstName} ${p.lastName}`.trim(),
      phone: p.phone,
      nationalId: p.nationalId,
      visitCount: p._count.visits,
    }));
  }

  /// نامِ denormalizedِ جراح/بیمارستان + اعتبارسنجیِ وجودِ موجودیت‌ها
  private async resolveRefs(
    tx: any,
    dto: {
      surgeonId?: number | null;
      hospitalId?: number | null;
      techId?: number | null;
      procedureTypeId?: number | null;
      diagnosisId?: number | null;
    },
  ) {
    const out: any = {};
    if (dto.surgeonId != null) {
      const s = await tx.surgeon.findUnique({ where: { id: dto.surgeonId }, include: { person: true } });
      if (!s) throw new NotFoundException('جراح یافت نشد');
      out.surgeonId = s.id;
      // عکسِ لحظهٔ ثبت — فقط اگر روزی جراح حذف شود خوانده می‌شود.
      out.surgeonName = `${s.person.firstName} ${s.person.lastName}`.trim();
    }
    if (dto.hospitalId != null) {
      const h = await tx.hospital.findUnique({ where: { id: dto.hospitalId } });
      if (!h) throw new NotFoundException('بیمارستان یافت نشد');
      out.hospitalId = h.id;
      out.hospitalName = h.name;
    }
    if (dto.techId != null) {
      const a = await tx.account.findUnique({ where: { id: dto.techId } });
      if (!a || a.status !== 'active') throw new NotFoundException('کارشناس یافت نشد');
      out.techId = a.id;
    }
    if (dto.procedureTypeId != null) {
      const pt = await tx.procedureType.findUnique({ where: { id: dto.procedureTypeId } });
      if (!pt) throw new NotFoundException('نوعِ عمل یافت نشد');
      out.procedureTypeId = pt.id;
      // opType آینهٔ متنیِ نوعِ عمل است تا گزارش‌های قدیمی نشکنند.
      out.opType = pt.name;
    }
    if (dto.diagnosisId != null) {
      const dg = await tx.diagnosis.findUnique({ where: { id: dto.diagnosisId } });
      if (!dg) throw new NotFoundException('تشخیص یافت نشد');
      out.diagnosisId = dg.id;
    }
    return out;
  }

  /**
   * نوشتنِ شرحِ عمل از فرمِ مراجعه.
   *
   * فرم یک textarea است ولی مقصد یک سندِ نسخه‌دار: متنِ تازه رکوردِ جدید می‌سازد و
   * قبلی `replacedAt` می‌گیرد، هرگز بازنویسی نمی‌شود. خالی‌کردنِ فیلد یعنی
   * «این شرح دیگر جاری نیست»، نه «هیچ‌وقت نوشته نشده بود».
   */
  private async setOpReport(tx: any, visit: { id: number; patientId: number }, body: string | null, user: any) {
    const current = await tx.clinicalNote.findFirst({
      where: { visitId: visit.id, kind: 'op', replacedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const text = body?.trim() || null;
    if (current?.body === text) return;
    if (!text && !current) return;

    if (current) await tx.clinicalNote.update({ where: { id: current.id }, data: { replacedAt: new Date() } });
    if (text) {
      await tx.clinicalNote.create({
        data: {
          patientId: visit.patientId,
          visitId: visit.id,
          kind: 'op',
          body: text,
          authorId: user?.id ?? null,
          authorName: actorName(user),
          replacesId: current?.id ?? null,
        },
      });
    }
  }

  /**
   * پیداکردنِ پروندهٔ بیمار بر اساسِ کدِ ملی — قلبِ قاعدهٔ «هر کد ملی، یک پرونده».
   *
   * سه حالت:
   *  • نبود                → پروندهٔ تازه
   *  • بود و نام‌خانوادگی یکی → همان پرونده، مراجعهٔ بعدی
   *  • بود و نام‌خانوادگی فرق داشت → توقف با ۴۰۹
   *
   * حالتِ سوم عمداً خودکار حل نمی‌شود: یا کدِ ملی اشتباه تایپ شده یا واقعاً دو
   * نفرند؛ هر دو حالت تصمیمِ انسانی می‌خواهد. این همان مرحلهٔ stewardship در MPI
   * است — ادغامِ خودکارِ هویت، خطایی است که بعداً قابلِ برگرداندن نیست.
   */
  private async findByNationalId(tx: any, nationalId: string, lastName: string) {
    const existing = await tx.patient.findUnique({ where: { nationalId } });
    if (!existing) return null;

    const same = existing.lastName.trim() === lastName.trim();
    if (!same) {
      throw new ConflictException(
        `این کد ملی به پروندهٔ «${existing.code} — ${existing.firstName} ${existing.lastName}» تعلق دارد.` +
          ' اگر همان بیمار است، از فهرست انتخابش کنید؛ وگرنه کد ملی را بررسی کنید.',
      );
    }

    // پرونده‌ای که soft-delete شده بود با مراجعهٔ جدید برمی‌گردد؛ ساختنِ پروندهٔ
    // دوم با همان کد ملی هم ممکن نیست (ایندکسِ یکتا) و هم غلط است.
    if (existing.deletedAt) {
      await tx.patient.update({
        where: { id: existing.id },
        data: { deletedAt: null, deletedById: null, deleteReason: null },
      });
      return { patient: existing, restored: true };
    }
    return { patient: existing, restored: false };
  }

  /**
   * ثبتِ مراجعه.
   *
   * سه مسیر دارد و هر سه به یک پرونده ختم می‌شوند:
   *  • patientId داده شده        → مراجعهٔ جدید روی همان پرونده
   *  • کد ملی به پرونده‌ای خورد → همان پرونده (بدونِ ساختنِ پروندهٔ دوم)
   *  • هیچ‌کدام                  → پروندهٔ تازه با کدِ AM-NNNN
   *
   * خروجی `patientStatus` را حمل می‌کند تا کلاینت در toast بگوید «پروندهٔ
   * AM-0012 — مراجعهٔ ۳» و کاربر بفهمد ثبتِ دوباره پروندهٔ تکراری نساخته است.
   */
  async createVisit(dto: CreateVisitDto, user?: any) {
    const userId: number | undefined = user?.id;
    const { visit: v, patientStatus } = await this.prisma.$transaction(async (tx) => {
      let patientId = dto.patientId;
      let patientStatus: 'existing' | 'matched' | 'restored' | 'new' = 'existing';
      if (patientId) {
        const p = await tx.patient.findUnique({ where: { id: patientId } });
        if (!p) throw new NotFoundException('بیمار پیدا نشد');
        // ویرایشِ ضمنیِ پرونده ممنوع است، ولی کدِ ملیِ خالی را کامل می‌کنیم.
        if (dto.nationalId && !p.nationalId) {
          await tx.patient.update({ where: { id: p.id }, data: { nationalId: dto.nationalId } });
        }
      } else {
        const match = dto.nationalId
          ? await this.findByNationalId(tx, dto.nationalId, dto.lastName!)
          : null;

        if (match) {
          patientId = match.patient.id;
          patientStatus = match.restored ? 'restored' : 'matched';
          // شماره و تاریخِ تولدِ تازه فقط جاهای خالی را پر می‌کنند، نه بازنویسی.
          const fill: any = {};
          if (dto.phone && !match.patient.phone) fill.phone = dto.phone;
          if (dto.birthDate && !match.patient.birthDate) fill.birthDate = new Date(dto.birthDate);
          if (Object.keys(fill).length) await tx.patient.update({ where: { id: patientId }, data: fill });
        } else {
          const p = await tx.patient.create({
            data: {
              code: `AM-PENDING-${randomUUID()}`,
              firstName: dto.firstName!,
              lastName: dto.lastName!,
              phone: dto.phone || null,
              nationalId: dto.nationalId || null,
              birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
            },
          });
          await tx.patient.update({
            where: { id: p.id },
            data: { code: `AM-${String(p.id).padStart(4, '0')}` },
          });
          patientId = p.id;
          patientStatus = 'new';
        }
      }
      const refs = await this.resolveRefs(tx, dto);
      const max = await tx.visit.aggregate({ where: { patientId }, _max: { seq: true } });
      const seq = (max._max.seq ?? 0) + 1;
      const visit = await tx.visit.create({
        data: {
          patientId,
          seq,
          kind: dto.kind || 'surgery',
          ...refs,
          // اگر نوعِ عمل انتخاب شده باشد، opType را resolveRefs گذاشته است.
          ...(refs.opType === undefined ? { opType: dto.opType?.trim() || null } : {}),
          opDate: dto.opDate ? new Date(dto.opDate) : null,
          ...timePatch(dto),
          notes: dto.notes || null,
          createdById: userId ?? null,
        },
        include: INCLUDE_PATIENT,
      });
      if (dto.opReport?.trim()) {
        await this.setOpReport(tx, visit, dto.opReport, user);
        visit.clinicalNotes = await tx.clinicalNote.findMany({
          where: { visitId: visit.id, kind: 'op', replacedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
        });
      }
      return { visit, patientStatus };
    });
    const result = { ...enrich(v), patientStatus };
    await this.audit.record({ actorId: userId, action: 'visit.create', entityType: 'visit', entityId: v.id, after: result });
    return result;
  }

  /**
   * ثبتِ ساعت‌ها بدونِ بازکردنِ کلِ فرمِ مراجعه.
   *
   * جدا از updateVisit است چون کسی که ساعت را ثبت می‌کند (کارشناسِ سرِ عمل،
   * یا پنلِ چینش) لازم نیست اجازهٔ ویرایشِ مبلغ و جراح و بیمار را داشته باشد.
   * دامنه‌اش همان scope مراجعه است: کارشناس فقط مراجعاتِ خودش.
   */
  async setTimes(id: number, dto: any, user?: any) {
    await this.assertVisitAccess(id, user);
    const patch = timePatch(dto);
    if (!Object.keys(patch).length) throw new BadRequestException('ساعتی برای ثبت نیامده است');

    const before = await this.prisma.visit.findUnique({ where: { id }, include: INCLUDE_PATIENT });
    const updated = await this.prisma.visit.update({ where: { id }, data: patch, include: INCLUDE_PATIENT });
    const result = enrich(updated);
    await this.audit.record({
      actorId: user?.id, action: 'visit.times', entityType: 'visit', entityId: id,
      before: { opStartTime: before?.opStartTime, opEndTime: before?.opEndTime, techArriveTime: before?.techArriveTime, cargoDueTime: before?.cargoDueTime },
      after: patch,
    });
    return result;
  }

  async updateVisit(id: number, dto: UpdateVisitDto, user?: any) {
    await this.assertVisitAccess(id, user);
    const v = await this.prisma.visit.findUnique({ where: { id }, include: INCLUDE_PATIENT });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');

    const patientPatch: any = {};
    if (dto.firstName !== undefined) patientPatch.firstName = dto.firstName;
    if (dto.lastName !== undefined) patientPatch.lastName = dto.lastName;
    if (dto.phone !== undefined) patientPatch.phone = dto.phone || null;
    if (dto.nationalId !== undefined) patientPatch.nationalId = dto.nationalId || null;
    if (dto.birthDate !== undefined) patientPatch.birthDate = dto.birthDate ? new Date(dto.birthDate) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const visitPatch: any = await this.resolveRefs(tx, dto);
      // null صریح یعنی «پاک کن» (SetNull + پاک‌شدنِ نامِ denormalized)
      if (dto.surgeonId === null) { visitPatch.surgeonId = null; visitPatch.surgeonName = null; }
      if (dto.hospitalId === null) { visitPatch.hospitalId = null; visitPatch.hospitalName = null; }
      if (dto.techId === null) visitPatch.techId = null;
      if (dto.procedureTypeId === null) { visitPatch.procedureTypeId = null; visitPatch.opType = null; }
      if (dto.diagnosisId === null) visitPatch.diagnosisId = null;
      // متنِ آزاد فقط وقتی خوانده می‌شود که نوعِ عمل انتخاب نشده باشد.
      if (dto.opType !== undefined && visitPatch.opType === undefined) {
        visitPatch.opType = dto.opType?.trim() || null;
      }
      if (dto.opDate !== undefined) visitPatch.opDate = dto.opDate ? new Date(dto.opDate) : null;
      if (dto.kind !== undefined) visitPatch.kind = dto.kind;
      // طرفِ حساب و استثنای سهمِ جراح — فیلدهای مالیِ سبک که روی خودِ مراجعه‌اند.
      if (dto.payer !== undefined) visitPatch.payer = dto.payer;
      if (dto.payerHospitalId !== undefined) visitPatch.payerHospitalId = dto.payerHospitalId ?? null;
      if (dto.caseCost !== undefined) visitPatch.caseCost = dto.caseCost ?? null;
      if (dto.surgeonShareKind !== undefined) {
        // پاک‌کردنِ نوع، مقدار را هم پاک می‌کند؛ وگرنه عددِ یتیم می‌ماند که هیچ
        // جا خوانده نمی‌شود ولی در ویرایشِ بعدی ناگهان دوباره اعمال می‌شود.
        visitPatch.surgeonShareKind = dto.surgeonShareKind || null;
        visitPatch.surgeonShareValue = dto.surgeonShareKind ? dto.surgeonShareValue ?? null : null;
      } else if (dto.surgeonShareValue !== undefined) {
        visitPatch.surgeonShareValue = dto.surgeonShareValue ?? null;
      }
      Object.assign(visitPatch, timePatch(dto));
      if (dto.notes !== undefined) visitPatch.notes = dto.notes || null;

      if (Object.keys(patientPatch).length) {
        await tx.patient.update({ where: { id: v.patientId }, data: patientPatch });
      }
      if (dto.opReport !== undefined) {
        await this.setOpReport(tx, { id, patientId: v.patientId }, dto.opReport, user);
      }
      return tx.visit.update({ where: { id }, data: visitPatch, include: INCLUDE_PATIENT });
    });
    const result = enrich(updated);
    await this.audit.record({ actorId: user?.id, action: 'visit.update', entityType: 'visit', entityId: id, before: enrich(v), after: result });
    return result;
  }

  async setStatus(id: number, opStatus: string, user?: any) {
    await this.assertVisitAccess(id, user);
    const v = await this.prisma.visit.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    const updated = await this.prisma.visit.update({
      where: { id },
      data: { opStatus },
      include: INCLUDE_PATIENT,
    });
    return enrich(updated);
  }

  /// حذفِ مراجعه؛ اگر آخرین مراجعهٔ بیمار بود، خودِ بیمار هم پاک می‌شود
  async deleteVisit(id: number, user?: any) {
    await this.assertVisitAccess(id, user);
    const v = await this.prisma.visit.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    await this.prisma.$transaction(async (tx) => {
      await tx.visit.delete({ where: { id } });
      const left = await tx.visit.count({ where: { patientId: v.patientId } });
      if (left === 0) {
        await tx.patient.update({
          where: { id: v.patientId },
          data: { deletedAt: new Date(), deletedById: user?.id ?? null, deleteReason: 'آخرین مراجعه حذف شد' },
        });
      }
    });
    await this.audit.record({ actorId: user?.id, action: 'visit.delete', entityType: 'visit', entityId: id, before: v });
    return { ok: true };
  }
}
