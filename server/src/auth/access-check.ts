import { PERMISSION_DEFAULT_LEVELS, FEATURE_DEFAULT_LEVELS } from './access-registry';

export async function canAccess(db: any, user: any, feature: string, permissions: string[]) {
  if ((user?.level ?? 0) >= 6) return true;
  const f = await db.feature.findUnique({ where: { key: feature } });
  const allowed = (r: any, fallback: number) => r?.enabled !== false && user.level >= (r?.minLevel ?? fallback) && (!Array.isArray(r?.roles) || !r.roles.length || r.roles.includes(user.jobRole));
  if (!allowed(f, FEATURE_DEFAULT_LEVELS[feature]?.minLevel ?? 6)) return false;
  for (const key of permissions) {
    if (!PERMISSION_DEFAULT_LEVELS[key] || !allowed(await db.permission.findUnique({ where: { key } }), PERMISSION_DEFAULT_LEVELS[key])) return false;
  }
  return true;
}
