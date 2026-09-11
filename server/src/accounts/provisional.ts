export const verificationDeadline = () => new Date(Date.now() + 7 * 86400000);
export const isProvisional = (a: any) => !!a?.verificationDueAt && !a.phoneVerifiedAt;
export async function expireProvisional(db: any, id?: number) { return db.$transaction((tx: any) => expireProvisionalInTransaction(tx, id)); }
export async function expireProvisionalInTransaction(tx: any, id?: number) {
    const where = { status: 'active', phoneVerifiedAt: null, verificationDueAt: { lte: new Date() }, ...(id ? { id } : {}) };
    const candidates = await tx.account.findMany({ where, select: { id: true }, orderBy: { id: 'asc' }, take: 100 });
    const ids: number[] = [];
    for (const row of candidates) {
      // Conditional update locks the row; a concurrent successful verification wins without revocation.
      const changed = await tx.account.updateMany({ where: { ...where, id: row.id }, data: { status: 'disabled' } });
      if (changed.count) ids.push(row.id);
    }
    if (!ids.length) return 0;
    await tx.session.updateMany({ where: { accountId: { in: ids }, revokedAt: null }, data: { revokedAt: new Date() } });
    for (const accountId of ids) await tx.auditEvent.create({ data: { action: 'account.verification.expired', entityType: 'account', entityId: String(accountId) } });
    return ids.length;
}
