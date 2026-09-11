import { ForbiddenException } from '@nestjs/common';
import { LEVEL } from '../common/levels';
export const TEST_ACCOUNTS_KEY = 'test_accounts_enabled';
export const isTestAccount = (a: any) => !!a?.person?.phoneScope && a.person.phoneScope !== 'primary';
export const testAccountsEnabled = async (db: any) => (await db.setting.findUnique({ where: { key: TEST_ACCOUNTS_KEY } }))?.value === 'true';
// Only the permanent administrator can open/close testing or create test identities.
export async function requireTestAdministrator(db: any, actorId: number) {
  const actor = await db.account.findUnique({ where: { id: actorId }, include: { person: true } });
  if (!actor || actor.status !== 'active' || actor.level !== LEVEL.SUPER_ADMIN || isTestAccount(actor)) throw new ForbiddenException('مدیریت حالت آزمایشی فقط با حساب اصلی سوپرادمین ممکن است');
}
