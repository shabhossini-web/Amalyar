import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LEVEL } from '../common/levels';
import { detectStaleWork } from './work-detectors';
import { closeWork, processDomainEvents, upsertWork } from './work-processor';
import type { WorkUpsert } from './work-rules';

export type WorkScope = 'inbox' | 'mine' | 'role' | 'patient' | 'all';
export type WorkAction = 'done' | 'block' | 'assign' | 'snooze' | 'cancel' | 'reopen';

const OPEN = ['open', 'blocked'];
/* ⚠️ تلهٔ NULL در SQL: `owner_role <> 'patient'` برای ردیفِ بدونِ نقش NULL می‌دهد و
   ردیف حذف می‌شود — کارِ دستیِ ادمینِ بی‌نقش از صفِ خودش غیب شد. پس صریح. */
const NOT_PATIENT = { OR: [{ ownerRole: null }, { ownerRole: { not: 'patient' } }] };

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
 */
@Injectable()
export class WorkService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private isSupervisor(user: any) {
    return (user?.level ?? 0) >= LEVEL.SUPERVISOR;
  }

  private async canSeePatient(user: any, patientId: number) {
    if ((user?.level ?? 0) >= LEVEL.TECH_ADMIN) return true;
    const own = await this.prisma.visit.count({ where: { patientId, techId: user?.id ?? -1 } });
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
      default: return { OR: [mine, role] };
    }
  }

  async list(user: any, q: { scope?: WorkScope; patientId?: number; state?: string; type?: string; due?: string; limit?: number }) {
    const scope: WorkScope = q.scope ?? 'inbox';
    if (scope === 'all' && !this.isSupervisor(user)) throw new ForbiddenException('دیدنِ همهٔ کارها برای سوپروایزر و بالاتر است');
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
    const rows = await this.prisma.workItem.findMany({
      where: {
        AND: [
          this.scopeWhere(user, scope, q.patientId),
          { state: q.state ? q.state : { in: OPEN } },
          q.type ? { type: q.type } : {},
          dueWhere,
          /* کارِ خودِ بیمار در صفِ کارکنان نمی‌آید. */
          scope === 'inbox' || scope === 'mine' || scope === 'role' ? NOT_PATIENT : {},
        ],
      },
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { id: 'asc' }],
      take: Math.min(Math.max(q.limit ?? 100, 1), 300),
    });
    return this.enrich(rows);
  }

  /** بیمار/مراجعه را سمتِ سرور ضمیمه می‌کند (قانونِ ۱۵ — render فرمول ندارد). */
  private async enrich(rows: any[]) {
    const pids = [...new Set(rows.map((r) => r.patientId).filter(Boolean))] as number[];
    const patients = pids.length
      ? await this.prisma.patient.findMany({ where: { id: { in: pids } }, select: { id: true, code: true, firstName: true, lastName: true, phone: true } })
      : [];
    const byId = new Map(patients.map((p) => [p.id, { ...p, fullName: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() }]));
    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      patient: r.patientId ? byId.get(r.patientId) ?? null : null,
      overdue: !!r.dueAt && OPEN.includes(r.state) && new Date(r.dueAt).getTime() < now,
    }));
  }

  async counts(user: any) {
    const now = new Date();
    const base = { state: { in: OPEN } };
    const [mine, role, overdue] = await Promise.all([
      this.prisma.workItem.count({ where: { AND: [base, NOT_PATIENT, { ownerAccountId: user.id }] } }),
      this.prisma.workItem.count({ where: { AND: [base, { ownerRole: user.jobRole ?? '__none__', ownerAccountId: null }] } }),
      this.prisma.workItem.count({ where: { AND: [base, NOT_PATIENT, this.scopeWhere(user, 'inbox'), { dueAt: { lt: now } }] } }),
    ]);
    return { mine, role, overdue, total: mine + role };
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
    return (await this.enrich([row]))[0];
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

  async act(user: any, id: number, action: WorkAction, body: { outcome?: any; reason?: string; accountId?: number; until?: string }) {
    const row = await this.ownedOrVisible(user, id);
    let data: any;
    switch (action) {
      case 'done':
        if (!OPEN.includes(row.state)) throw new BadRequestException('این کار باز نیست');
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
    return (await this.enrich([updated]))[0];
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
