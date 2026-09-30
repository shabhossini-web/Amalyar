import { LEVEL } from '../common/levels';

export const verificationDeadline = () => new Date(Date.now() + 7 * 86400000);
export const isProvisional = (a: any) => !!a?.verificationDueAt && !a.phoneVerifiedAt;
/** مهلتِ تأییدِ شمارهٔ حسابِ موقت گذشته است؟ — مشتقِ سرور برای هشدارِ کلاینت (قانونِ ۱۵). */
export const isVerificationOverdue = (a: any) => isProvisional(a) && new Date(a.verificationDueAt) <= new Date();

/** قفلِ کوتاهِ همان ثبت‌نام (`auth.service.ts` completeSignup): تصمیم‌های «سوپرادمینِ دیگری هست؟» یکی‌یکی. */
const SUPER_ADMIN_LOCK = 73190521;

/**
 * **تنها سوپرادمینِ فعالِ واقعیِ** سامانه است؟ (بستهٔ PS، PS2)
 *
 * «واقعی» یعنی شمارهٔ اصلی (`phoneScope: 'primary'`) و نه حسابِ سیستمی: سوپرادمینِ آزمایشی با خاموش‌شدنِ حالتِ
 * آزمایشی بسته می‌شود و جای مدیرِ واقعی را نمی‌گیرد — همان شرطِ «آخرین سوپرادمین» در `accounts.service.ts`.
 */
export async function isSoleActiveSuperAdmin(db: any, id: number): Promise<boolean> {
  const self = await db.account.findUnique({ where: { id }, select: { level: true, status: true, systemKey: true, person: { select: { phoneScope: true } } } });
  if (!self || self.level < LEVEL.SUPER_ADMIN || self.status !== 'active' || self.systemKey || self.person?.phoneScope !== 'primary') return false;
  const others = await db.account.count({
    where: { id: { not: id }, level: { gte: LEVEL.SUPER_ADMIN }, status: 'active', systemKey: null, person: { phoneScope: 'primary' } },
  });
  return others === 0;
}

export async function expireProvisional(db: any, id?: number) { return db.$transaction((tx: any) => expireProvisionalInTransaction(tx, id)); }
export async function expireProvisionalInTransaction(tx: any, id?: number) {
    const where = { status: 'active', phoneVerifiedAt: null, verificationDueAt: { lte: new Date() }, ...(id ? { id } : {}) };
    const candidates = await tx.account.findMany({ where, select: { id: true, level: true, verificationDueAt: true }, orderBy: { id: 'asc' }, take: 100 });
    const ids: number[] = [];
    let locked = false;
    for (const row of candidates) {
      /* هشدار — **آخرین سوپرادمینِ فعال غیرفعال نمی‌شود** (بستهٔ PS، PS2). سوپرادمینِ تنها که شماره‌اش را در
         پروفایل عوض می‌کرد و هفت روز تأییدش نمی‌کرد، این‌جا غیرفعال می‌شد و سامانه بی‌مدیر می‌ماند — و تا
         دیروز همان یعنی «اولین ثبت‌نامِ عمومی سوپرادمینِ فعال می‌شود». حالا فقط هشدار (`verificationOverdue`)
         و یک ردِ ممیزی؛ تأییدِ شماره پس از مهلت هم باز است (`verifyPhone`). قفل: دو انقضای هم‌زمانِ دو
         سوپرادمین هر کدام دیگری را «هنوز فعال» نبینند و هر دو را نبندند. */
      if (row.level >= LEVEL.SUPER_ADMIN) {
        if (!locked) { await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${SUPER_ADMIN_LOCK})`); locked = true; }
        if (await isSoleActiveSuperAdmin(tx, row.id)) { await noteKept(tx, row); continue; }
      }
      // Conditional update locks the row; a concurrent successful verification wins without revocation.
      const changed = await tx.account.updateMany({ where: { ...where, id: row.id }, data: { status: 'disabled' } });
      if (changed.count) ids.push(row.id);
    }
    if (!ids.length) return 0;
    await tx.session.updateMany({ where: { accountId: { in: ids }, revokedAt: null }, data: { revokedAt: new Date() } });
    for (const accountId of ids) await tx.auditEvent.create({ data: { action: 'account.verification.expired', entityType: 'account', entityId: String(accountId) } });
    return ids.length;
}

/** ردِ ممیزیِ «مهلت گذشت ولی بسته نشد» — یک‌بار برای هر مهلت، نه یکی به‌ازای هر درخواستِ همان مدیر. */
async function noteKept(tx: any, row: { id: number; verificationDueAt: Date }) {
  const action = 'account.verification.overdue_kept';
  const seen = await tx.auditEvent.findFirst({ where: { action, entityType: 'account', entityId: String(row.id), createdAt: { gte: row.verificationDueAt } }, select: { id: true } });
  if (!seen) await tx.auditEvent.create({ data: { action, entityType: 'account', entityId: String(row.id), afterJson: { verificationDueAt: row.verificationDueAt, reason: 'sole-active-super-admin' } } });
}

/**
 * مهلتِ حسابِ موقت گذشته و حساب (پس از اعمالِ انقضا) دیگر فعال نیست؟ — جای الگوی «منقضی کن و رد کن» در
 * ورود/صدورِ نشست/اعتبارِ نشست (PS2): آخرین سوپرادمینِ فعال پس از انقضا هم فعال است و نباید بیرون بیفتد.
 */
export async function provisionalLapsed(db: any, account: any): Promise<boolean> {
  if (!isVerificationOverdue(account)) return false;
  if (await expireProvisional(db, account.id)) return true;
  const now = await db.account.findUnique({ where: { id: account.id }, select: { status: true } });
  return now?.status !== 'active';
}
