import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LEVEL } from '../common/levels';
import { isUnrestricted, ownVisitWhere } from '../common/own-scope';
import { jobRoleLabel } from '../common/job-roles';
import { canAccess } from '../auth/access-check';
import { detectStaleWork } from './work-detectors';
import { closeWork, processDomainEvents, upsertWork } from './work-processor';
import type { WorkUpsert } from './work-rules';
import { OWNER_ROLE_FA } from './work-rules';

export type WorkScope = 'inbox' | 'mine' | 'role' | 'patient' | 'all';
export type WorkAction = 'done' | 'block' | 'assign' | 'snooze' | 'cancel' | 'reopen';
/** فیلترِ «مسئولِ شخص»: شناسهٔ حساب، یا `none` = کاری که به نامِ هیچ شخصی نیست. */
export type OwnerFilter = number | 'none';
/** فیلترِ «نقشِ مسئول»: کلیدِ نقش، یا `none` = کاری که نقش هم ندارد. */
export type OwnerRoleFilter = string;

const OPEN = ['open', 'blocked'];
/* ⚠️ تلهٔ NULL در SQL: `owner_role <> 'patient'` برای ردیفِ بدونِ نقش NULL می‌دهد و
   ردیف حذف می‌شود — کارِ دستیِ ادمینِ بی‌نقش از صفِ خودش غیب شد. پس صریح. */
const NOT_PATIENT = { OR: [{ ownerRole: null }, { ownerRole: { not: 'patient' } }] };
/* کاری که به یک سفارشِ بالینی گره خورده — فقط این‌ها ضمیمهٔ عکس دارند. */
const ORDER_REF = /^(lab|imaging|consult|referral)_order$/;
/* سقفِ عکس‌های ضمیمه در هر ردیف؛ شمارِ کامل جدا می‌آید تا «۴ تا» با «۱۴ تا» اشتباه نشود. */
const ATTACH_MAX = 4;
const ORDER = [{ priority: 'desc' as const }, { dueAt: 'asc' as const }, { id: 'asc' as const }];

/**
 * برچسبِ فارسیِ نقشِ مالک. `OWNER_ROLE_FA` نقش‌هایی را دارد که لایهٔ کار **صادر**
 * می‌کند (مدیر، خودِ بیمار…)؛ ولی گامِ مسیرِ درمان نقشِ خودِ گام را می‌گیرد
 * (پرستار، دستیار…) و آن‌ها فقط در `JOB_ROLES` هستند. بی‌این دومی، صفِ پرستار
 * روی صفحه کلیدِ خامِ `nurse` چاپ می‌کرد.
 */
const roleFa = (key: string | null | undefined): string | null => (key ? OWNER_ROLE_FA[key] ?? jobRoleLabel(key) ?? key : null);

/**
 * حسابی که کار به نامش بنشیند باید بتواند وارد شود: فعال، نه حسابِ سیستمی، و نه حسابِ
 * موقتی که مهلتِ تأییدِ شماره‌اش گذشته (ورودش بسته است تا worker غیرفعالش کند).
 * ⚠️ با `OR`ِ صریح، نه `NOT`ِ دوشرطی — `verification_due_at` برای حسابِ عادی NULL
 * است و `NOT (… AND NULL)` در SQL خودش NULL می‌شود و همهٔ حساب‌های عادی را حذف می‌کرد.
 */
const assignableWhere = () => ({
  status: 'active',
  systemKey: null,
  OR: [{ phoneVerifiedAt: { not: null } }, { verificationDueAt: null }, { verificationDueAt: { gt: new Date() } }],
});

type NamedAccount = { id: number; username: string | null; person: { firstName: string | null; lastName: string | null; phone: string | null } | null };
/* همان قاعدهٔ `publicUser`: نام، وگرنه نامِ کاربری، وگرنه شماره — یک شخص همه‌جا یک نام دارد. */
const nameOf = (a: NamedAccount) =>
  [a.person?.firstName, a.person?.lastName].filter(Boolean).join(' ').trim() || a.username || a.person?.phone || 'کاربر';

/**
 * لایهٔ کار — `docs/plan/CONTRACTS.md` §۱.
 *
 * دامنهٔ دید (object-authz، قانونِ ۴):
 *  - `mine`  = کارهایی که به نامِ خودِ من است
 *  - `role`  = صفِ نقشِ شغلیِ من که هنوز کسی برنداشته
 *  - `inbox` = هر دو (پیش‌فرضِ صفحهٔ «امروز» و زنگِ اعلان)
 *  - `patient` = کارهای یک بیمار — از سطحِ کارشناس‌ادمین، یا کارشناسی که مراجعه‌ای از او دارد
 *  - `all`   = همه — `work.assign` (سوپروایزر و بالاتر)
 * کارِ خودِ بیمار (`ownerRole='patient'`) در صفِ کارکنان نمی‌آید مگر با `patient`/`all`.
 *
 * ⚠️ **سوپرادمین (قانونِ ۲۹):** `inbox`ِ او **صفِ تیم** است — هر کارِ بازِ کارکنان،
 * مالِ هر شخص یا هر صف یا هیچ‌کس. سوپرادمین نقشِ شغلی ندارد؛ با قاعدهٔ «من + صفِ
 * نقشِ من» صفحهٔ «امروز»ش خالی بود و برای دیدنِ کارِ دیگران باید پروفایل عوض می‌کرد.
 * هر ردیف می‌گوید مالِ کیست (`ownerLabel`) و او همان عملیاتِ صاحبش را دارد. برای
 * سطوحِ پایین‌تر هیچ دامنه‌ای باز نمی‌شود.
 */
@Injectable()
export class WorkService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private isSupervisor(user: any) {
    return (user?.level ?? 0) >= LEVEL.SUPERVISOR;
  }

  private async canSeePatient(user: any, patientId: number) {
    if ((user?.level ?? 0) >= LEVEL.TECH_ADMIN) return true;
    const own = await this.prisma.visit.count({ where: { patientId, ...ownVisitWhere(user) } });
    return own > 0;
  }

  private scopeWhere(user: any, scope: WorkScope, patientId?: number) {
    const mine = { ownerAccountId: user.id };
    const role = { ownerRole: user.jobRole ?? '__none__', ownerAccountId: null };
    switch (scope) {
      case 'mine': return mine;
      case 'role': return role;
      case 'all': return {};
      case 'patient': return { patientId: patientId ?? -1 };
      /* صفِ تیم: بی‌قیدِ مالک. «نه کارِ خودِ بیمار» جدا (`NOT_PATIENT`) اعمال می‌شود. */
      default: return isUnrestricted(user) ? {} : { OR: [mine, role] };
    }
  }

  async list(user: any, q: {
    scope?: WorkScope; patientId?: number; state?: string; type?: string; due?: string; limit?: number;
    owner?: OwnerFilter; ownerRole?: OwnerRoleFilter; sort?: 'overdue';
  }) {
    const scope: WorkScope = q.scope ?? 'inbox';
    if (scope === 'all' && !this.isSupervisor(user)) throw new ForbiddenException('دیدنِ همهٔ کارها برای سوپروایزر و بالاتر است');
    /* فیلترِ مسئول (نمای تیم، قانونِ ۲۹). شناسهٔ **شخصِ دیگر** یا صفِ نقشی که مالِ
       من نیست فقط برای سوپرادمین است — همان کسی که دسته‌های `owners` را می‌گیرد؛
       سطحِ پایین‌تر ۴۰۳ می‌گیرد، حتی سوپروایزر با `scope=all` (شناسهٔ بیگانه‌ای که
       تا امروز نادیده گرفته می‌شد، نباید بی‌صدا معنی پیدا کند). «خودم»، نقشِ خودم و
       `none` فقط دامنهٔ خودِ کاربر را باریک می‌کنند، پس برای همه آزادند. فیلتر همیشه
       با دامنه AND می‌شود — هرگز دامنه را باز نمی‌کند. */
    const foreignOwner = typeof q.owner === 'number' && q.owner !== user.id;
    const foreignRole = q.ownerRole !== undefined && q.ownerRole !== 'none' && q.ownerRole !== (user.jobRole ?? null);
    if ((foreignOwner || foreignRole) && !isUnrestricted(user)) {
      throw new ForbiddenException('فیلترِ کارهای دیگران فقط برای سوپرادمین است');
    }
    if (scope === 'patient') {
      if (!q.patientId) throw new BadRequestException('شناسهٔ بیمار لازم است');
      if (!(await this.canSeePatient(user, q.patientId))) throw new ForbiddenException('به پروندهٔ این بیمار دسترسی ندارید');
    }
    const now = new Date();
    const dueWhere =
      q.due === 'overdue' ? { dueAt: { lt: now } }
        : q.due === 'today' ? { dueAt: { lt: new Date(now.getTime() + 24 * 3600 * 1000) } }
          : q.due === 'week' ? { dueAt: { lt: new Date(now.getTime() + 7 * 24 * 3600 * 1000) } }
            : {};
    const where = [
      this.scopeWhere(user, scope, q.patientId),
      { state: q.state ? q.state : { in: OPEN } },
      q.type ? { type: q.type } : {},
      dueWhere,
      /* کارِ خودِ بیمار در صفِ کارکنان نمی‌آید. */
      scope === 'inbox' || scope === 'mine' || scope === 'role' ? NOT_PATIENT : {},
      q.owner === undefined ? {} : { ownerAccountId: q.owner === 'none' ? null : q.owner },
      q.ownerRole === undefined ? {} : { ownerRole: q.ownerRole === 'none' ? null : q.ownerRole },
    ];
    /* `limit=abc` از کوئری NaN می‌شود و `take: NaN` خطای ۵۰۰ِ Prisma می‌داد. */
    const take = Math.min(Math.max(Number.isFinite(q.limit) ? Math.trunc(q.limit as number) : 100, 1), 300);
    if (q.sort !== 'overdue') {
      return this.enrich(user, await this.prisma.workItem.findMany({ where: { AND: where }, orderBy: ORDER, take }));
    }
    /* «عقب‌افتاده اول» (زنگِ نمای تیم): هر چه موعدش گذشته — دیرترینش اول — و بعد بقیه
       به همان ترتیبِ همیشگی. ترتیبِ پیش‌فرض اولویت را جلو می‌گذارد و کارِ کم‌اولویتِ
       سه‌روز‌عقب‌افتاده زیرِ کارِ پراولویتِ فردا گم می‌شد. */
    const late = await this.prisma.workItem.findMany({
      where: { AND: [...where, { dueAt: { lt: now } }] }, orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }, { id: 'asc' }], take,
    });
    const rest = late.length < take
      ? await this.prisma.workItem.findMany({
        where: { AND: [...where, { OR: [{ dueAt: null }, { dueAt: { gte: now } }] }] }, orderBy: ORDER, take: take - late.length,
      })
      : [];
    return this.enrich(user, [...late, ...rest]);
  }

  /** نامِ نمایشیِ چند حساب با **یک** کوئری — نه یکی به‌ازای هر ردیف. */
  private async accountNames(ids: (number | null | undefined)[]) {
    const uniq = [...new Set(ids.filter((x): x is number => !!x))];
    if (!uniq.length) return new Map<number, string>();
    const rows = await this.prisma.account.findMany({
      where: { id: { in: uniq } },
      select: { id: true, username: true, person: { select: { firstName: true, lastName: true, phone: true } } },
    });
    return new Map(rows.map((a) => [a.id, nameOf(a)]));
  }

  /** بیمار/مراجعه را سمتِ سرور ضمیمه می‌کند (قانونِ ۱۵ — render فرمول ندارد). */
  private async enrich(user: any, rows: any[]) {
    const pids = [...new Set(rows.map((r) => r.patientId).filter(Boolean))] as number[];
    /* نمای تیم فقط برای سوپرادمین (قانونِ ۲۹). «مالِ کیست» (`ownerName`/`ownerLabel`)
       برای بقیه `null` می‌ماند: ردیف‌هایشان در هیچ صفحه‌ای عوض نمی‌شود، و کارشناسی که
       کارهای یک بیمار را می‌بیند (`scope=patient`) نامِ هم‌تیمی‌ها را تازه نمی‌گیرد. */
    const team = isUnrestricted(user);
    /* نامِ مالک‌ها هم‌زمان با بیمارها — یک کوئری برای همهٔ ردیف‌ها، و فقط وقتی لازم است. */
    const [patients, names] = await Promise.all([
      pids.length
        ? this.prisma.patient.findMany({ where: { id: { in: pids } }, select: { id: true, code: true, firstName: true, lastName: true, phone: true } })
        : Promise.resolve([] as { id: number; code: string; firstName: string; lastName: string; phone: string | null }[]),
      team ? this.accountNames(rows.map((r) => r.ownerAccountId)) : Promise.resolve(new Map<number, string>()),
    ]);
    const byId = new Map(patients.map((p) => [p.id, { ...p, fullName: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() }]));
    /* عکس‌هایی که بیمار برای سفارشِ همین کار فرستاده (W0.8) کنارِ ردیف می‌آیند —
       یک کوئری برای همهٔ ردیف‌ها، نه یکی به‌ازای هر کار. تا دیروز کارِ «بررسیِ
       نتیجهٔ مشاوره» فقط یک عنوان بود و عکسِ بیمار پشتِ دو کلیک پنهان می‌ماند؛
       مالک خواست همان‌جا در صفحهٔ «امروز» دیده و از همان‌جا باز شود. */
    const refKey = (r: any) => `${r.refType}:${r.refId}`;
    const refs = new Map<string, { refType: string; refId: number }>();
    for (const r of rows) if (r.refId && ORDER_REF.test(r.refType ?? '')) refs.set(refKey(r), { refType: r.refType, refId: r.refId });
    const docs = refs.size
      ? await this.prisma.document.findMany({
        where: { deletedAt: null, mimeType: { startsWith: 'image/' }, OR: [...refs.values()] },
        orderBy: { id: 'asc' },
        select: { id: true, refType: true, refId: true, title: true, fileName: true, mimeType: true, createdAt: true },
      })
      : [];
    const docsByRef = new Map<string, any[]>();
    for (const d of docs) docsByRef.set(refKey(d), [...(docsByRef.get(refKey(d)) ?? []), d]);
    const now = Date.now();
    return rows.map((r) => {
      const mine = !!r.ownerAccountId && r.ownerAccountId === user?.id;
      const ownerName = r.ownerAccountId ? names.get(r.ownerAccountId) ?? null : null;
      const ownerRoleFa = roleFa(r.ownerRole);
      const ownerKind = r.ownerAccountId ? 'person' : r.ownerRole ? 'role' : 'none';
      return {
        ...r,
        patient: r.patientId ? byId.get(r.patientId) ?? null : null,
        attachments: (docsByRef.get(refKey(r)) ?? []).slice(0, ATTACH_MAX),
        attachmentCount: (docsByRef.get(refKey(r)) ?? []).length,
        overdue: !!r.dueAt && OPEN.includes(r.state) && new Date(r.dueAt).getTime() < now,
        /* برچسبِ مالک هم مشتقِ سرور است (قانون ۱۵): هر رابطی که خودش نگاشت
           داشته باشد، روزی که نقشِ تازه‌ای صادر شود کلیدِ خامِ انگلیسی چاپ می‌کند. */
        ownerRoleFa,
        ownerName,
        ownerKind,
        mine,
        ownerLabel: !team ? null
          : mine ? 'خودم'
            : ownerKind === 'person' ? ownerName ?? 'حسابِ ناشناخته'
              : r.ownerRole === 'patient' ? 'خودِ بیمار'
                : ownerKind === 'role' ? `صفِ ${ownerRoleFa}` : 'بی‌مسئول',
        /* «واگذاری» روی ردیف — سرور می‌گوید، رابط سطح را حساب نمی‌کند (قانونِ ۳).
           کارِ خودِ بیمار واگذارشدنی نیست (همان قاعدهٔ `act`). */
        canAssign: team && OPEN.includes(r.state) && r.ownerRole !== 'patient',
      };
    });
  }

  async counts(user: any, opts: { owners?: boolean } = {}) {
    const now = new Date();
    const base = { state: { in: OPEN } };
    const team = isUnrestricted(user);
    const [mine, role, overdue, teamTotal, owners] = await Promise.all([
      this.prisma.workItem.count({ where: { AND: [base, NOT_PATIENT, { ownerAccountId: user.id }] } }),
      this.prisma.workItem.count({ where: { AND: [base, { ownerRole: user.jobRole ?? '__none__', ownerAccountId: null }] } }),
      /* `inbox`ِ سوپرادمین صفِ تیم است، پس عقب‌افتادهٔ او هم عقب‌افتادهٔ تیم. */
      this.prisma.workItem.count({ where: { AND: [base, NOT_PATIENT, this.scopeWhere(user, 'inbox'), { dueAt: { lt: now } }] } }),
      team ? this.prisma.workItem.count({ where: { AND: [base, NOT_PATIENT] } }) : Promise.resolve(0),
      team && opts.owners ? this.ownerFacets(user) : Promise.resolve(undefined),
    ]);
    if (!team) return { mine, role, overdue, total: mine + role, team: false as const };
    /* `total` همان عددِ چیپِ «امروز» و نشانِ زنگ است — هر دو یک تعریف دارند.
       `owners` فقط وقتی خواسته شده باشد (`undefined` در JSON نمی‌آید). */
    return { mine, role, overdue, total: teamTotal, team: true as const, owners };
  }

  /**
   * «مالِ کیست» — تفکیکِ صفِ تیم برای فیلترِ «امروز» و «کارهای من» (فقط سوپرادمین).
   *
   * سه دسته که هم‌پوشانی ندارند و جمعشان همان «کارِ بازِ تیم» است: هر **شخص** (کارِ
   * به نامش، از هر نقشی)، هر **صفِ نقش** (هنوز کسی برنداشته)، و **بی‌مسئول** (نه
   * شخص، نه نقش). هر دسته `filter`ِ آماده دارد تا رابط همان را به `GET /work` بدهد —
   * نگاشتِ «کلید ← پارامتر» در کلاینت نیست.
   */
  async ownerFacets(user: any) {
    if (!isUnrestricted(user)) return [];
    const groups = await this.prisma.workItem.groupBy({
      by: ['ownerAccountId', 'ownerRole'],
      where: { AND: [{ state: { in: OPEN } }, NOT_PATIENT] },
      _count: { _all: true },
    });
    const people = new Map<number, number>();
    const roles = new Map<string, number>();
    let none = 0;
    for (const g of groups) {
      const n = g._count._all;
      if (g.ownerAccountId) people.set(g.ownerAccountId, (people.get(g.ownerAccountId) ?? 0) + n);
      else if (g.ownerRole) roles.set(g.ownerRole, (roles.get(g.ownerRole) ?? 0) + n);
      else none += n;
    }
    const names = await this.accountNames([...people.keys()]);
    const facets = [
      ...[...people].map(([id, count]) => ({
        key: `p:${id}`, kind: 'person', count, filter: { owner: id } as Record<string, string | number>,
        label: id === user.id ? 'خودم' : names.get(id) ?? 'حسابِ ناشناخته',
      })),
      ...[...roles].map(([role, count]) => ({
        key: `r:${role}`, kind: 'role', count, filter: { owner: 'none', ownerRole: role } as Record<string, string | number>,
        label: `صفِ ${roleFa(role)}`,
      })),
      ...(none ? [{ key: 'none', kind: 'none', count: none, filter: { owner: 'none', ownerRole: 'none' } as Record<string, string | number>, label: 'بی‌مسئول' }] : []),
    ];
    return facets.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fa'));
  }

  /**
   * «به چه کسی واگذار شود» — حساب‌های فعالی که صفِ کار را می‌بینند و می‌توانند کار
   * را ببندند. فقط برای سوپرادمین (همان کسی که `canAssign` می‌گیرد).
   *
   * ⚠️ چرا `/techs` نه: فقط سطح ۲..۴ را می‌دهد، پس کارِ «صفِ مدیر» (فاکتور، تأییدِ
   * نیمه‌کاره) به هیچ مدیری واگذار نمی‌شد. و چرا `/accounts` نه: سلفیِ همه را
   * می‌فرستد و حسابِ «بازدید» را هم — که رابط نباید با حسابِ سطح کنارش بگذارد (قانونِ ۳).
   * دسترسی از جدولِ features/permissions همین tenant خوانده می‌شود، و دو ردیفِ آن
   * یک‌بار — نه به‌ازای هر حساب.
   */
  async assignees(user: any) {
    if (!isUnrestricted(user)) throw new ForbiddenException('فهرستِ واگذاری فقط برای سوپرادمین است');
    const rows = await this.prisma.account.findMany({
      where: assignableWhere(),
      select: { id: true, username: true, level: true, jobRole: true, person: { select: { firstName: true, lastName: true, phone: true } } },
    });
    const memo = new Map<string, Promise<unknown>>();
    const once = (table: 'feature' | 'permission') => ({
      findUnique: (args: { where: { key: string } }) => {
        const k = `${table}:${args.where.key}`;
        if (!memo.has(k)) memo.set(k, (this.prisma as any)[table].findUnique(args));
        return memo.get(k);
      },
    });
    const db = { feature: once('feature'), permission: once('permission') };
    const allowed = await Promise.all(rows.map((a) => canAccess(db, a, 'work', ['work.read', 'work.write']).catch(() => false)));
    return rows
      .filter((_, i) => allowed[i])
      .map((a) => {
        const me = a.id === user.id;
        const displayName = nameOf(a);
        const roleName = jobRoleLabel(a.jobRole);
        return { id: a.id, displayName, roleFa: roleName, me, label: me ? `${displayName} (خودم)` : roleName ? `${displayName} · ${roleName}` : displayName };
      })
      .sort((x, y) => Number(y.me) - Number(x.me) || x.displayName.localeCompare(y.displayName, 'fa'));
  }

  /** کارِ دستی — «یادداشتِ کاری» برای خود یا هم‌تیمی. کلیدش یکتا به‌ازای هر ساخت است (dedupe ندارد). */
  async create(user: any, dto: {
    title: string; type?: string; note?: string | null; patientId?: number | null; visitId?: number | null; appointmentId?: number | null;
    ownerRole?: string | null; ownerAccountId?: number | null; dueAt?: string | null; priority?: number;
  }) {
    if (dto.ownerAccountId && dto.ownerAccountId !== user.id && !this.isSupervisor(user)) {
      throw new ForbiddenException('واگذاریِ کار به دیگران برای سوپروایزر و بالاتر است');
    }
    if (dto.patientId && !(await this.canSeePatient(user, dto.patientId))) throw new ForbiddenException('به پروندهٔ این بیمار دسترسی ندارید');
    const u: WorkUpsert = {
      type: dto.type ?? 'manual',
      title: dto.title,
      note: dto.note ?? null,
      patientId: dto.patientId ?? null,
      visitId: dto.visitId ?? null,
      appointmentId: dto.appointmentId ?? null,
      ownerRole: dto.ownerRole ?? (dto.ownerAccountId ? null : user.jobRole ?? null),
      ownerAccountId: dto.ownerAccountId ?? (dto.ownerRole ? null : user.id),
      dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      priority: dto.priority ?? 0,
      idempotencyKey: `manual:account:${user.id}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    };
    const row = await this.prisma.workItem.create({ data: { ...u, createdById: user.id } });
    await this.audit.record({ actorId: user.id, action: 'work.create', entityType: 'work_item', entityId: row.id, after: { type: row.type, title: row.title, ownerRole: row.ownerRole, ownerAccountId: row.ownerAccountId } });
    return (await this.enrich(user, [row]))[0];
  }

  private async ownedOrVisible(user: any, id: number) {
    const row = await this.prisma.workItem.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('کار پیدا نشد');
    if (this.isSupervisor(user)) return row;
    const mine = row.ownerAccountId === user.id;
    const myRole = !row.ownerAccountId && row.ownerRole && row.ownerRole === user.jobRole;
    const creator = row.createdById === user.id;
    if (!mine && !myRole && !creator) throw new ForbiddenException('این کار به شما واگذار نشده است');
    return row;
  }

  /**
   * مقصدِ واگذاری باید حسابی زنده باشد. بی‌این، شناسهٔ اشتباه کار را به نامِ «هیچ‌کس»
   * می‌نوشت: از صفِ نقش بیرون می‌رفت و در صفِ هیچ شخصی هم نمی‌نشست — گم.
   */
  private async assertAssignee(accountId: number) {
    const target = await this.prisma.account.findFirst({ where: { id: accountId, ...assignableWhere() }, select: { id: true } });
    if (!target) throw new BadRequestException('حسابِ مقصد پیدا نشد یا فعال نیست');
  }

  async act(user: any, id: number, action: WorkAction, body: { outcome?: any; reason?: string; accountId?: number; until?: string }) {
    const row = await this.ownedOrVisible(user, id);
    let data: any;
    switch (action) {
      case 'done':
        if (!OPEN.includes(row.state)) throw new BadRequestException('این کار باز نیست');
        /* مالک همان می‌ماند (کارِ سارا که سوپرادمین بست، هنوز «کارِ سارا» است)؛ «چه کسی بست» در `completedById`. */
        data = { state: 'done', completedAt: new Date(), completedById: user.id, outcome: body.outcome ?? undefined, ownerAccountId: row.ownerAccountId ?? user.id };
        break;
      case 'block':
        if (!body.reason) throw new BadRequestException('دلیلِ توقف لازم است');
        data = { state: 'blocked', blockedReason: body.reason };
        break;
      case 'snooze':
        if (!body.until) throw new BadRequestException('زمانِ بعدی لازم است');
        data = { dueAt: new Date(body.until), state: 'open', blockedReason: null };
        break;
      case 'assign':
        if (!this.isSupervisor(user) && body.accountId !== user.id) throw new ForbiddenException('واگذاری به دیگران برای سوپروایزر و بالاتر است');
        /* کارِ خودِ بیمار (`ownerRole='patient'`) با `NOT_PATIENT` از هر صفِ کارکنان بیرون
           است؛ به نامِ یک کارمند نوشتنش یعنی کاری که نه او می‌بیند نه بیمار — گم. */
        if (row.ownerRole === 'patient') throw new BadRequestException('کارِ خودِ بیمار به کارکنان واگذار نمی‌شود');
        if (body.accountId && body.accountId !== user.id) await this.assertAssignee(body.accountId);
        data = { ownerAccountId: body.accountId ?? null, state: row.state === 'blocked' ? 'blocked' : 'open' };
        break;
      case 'cancel':
        if (!this.isSupervisor(user) && row.createdById !== user.id) throw new ForbiddenException('لغوِ کار برای سازنده یا سوپروایزر است');
        data = { state: 'cancelled', outcome: { reason: body.reason ?? null } };
        break;
      case 'reopen':
        data = { state: 'open', completedAt: null, completedById: null };
        break;
      default:
        throw new BadRequestException('اقدامِ ناشناخته');
    }
    const updated = await this.prisma.workItem.update({ where: { id }, data });
    await this.audit.record({ actorId: user.id, action: `work.${action}`, entityType: 'work_item', entityId: id, before: { state: row.state, ownerAccountId: row.ownerAccountId }, after: { state: updated.state, ownerAccountId: updated.ownerAccountId, reason: body.reason ?? null } });
    return (await this.enrich(user, [updated]))[0];
  }

  /** برای سرویس‌های دیگر (W1.2، W2.2): کارِ idempotent از داخلِ کد، بدونِ HTTP. */
  upsert(u: WorkUpsert, tx?: any, opts?: { reopen?: boolean }) {
    return upsertWork(tx ?? this.prisma, u, opts);
  }

  closeByRef(ref: { refType: string; refId: number; type?: string }, actorId: number | null = null, tx?: any) {
    return closeWork(tx ?? this.prisma, ref, actorId);
  }

  async process(user: any) {
    const detected = await detectStaleWork(this.prisma);
    const res = { ...(await processDomainEvents(this.prisma)), detected };
    await this.audit.record({ actorId: user?.id ?? null, action: 'work.process', entityType: 'domain_event', entityId: 0, after: res });
    return res;
  }
}
