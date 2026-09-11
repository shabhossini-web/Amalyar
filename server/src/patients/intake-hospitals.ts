import { bestMatches, normalizeName } from '../common/name-match';

export async function hospitalOptions(prisma: any, query: string) {
  const hospitals = await prisma.hospital.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 2000 });
  const q = String(query ?? '').trim().slice(0, 150);
  if (!q) return hospitals.slice(0, 30);
  return bestMatches(q, hospitals, 8);
}

export async function matchIntakeHospital(prisma: any, data: any) {
  if (Number.isInteger(data?.hospitalId)) {
    const selected = await prisma.hospital.findFirst({ where: { id: data.hospitalId, active: true }, select: { id: true, name: true } });
    if (selected) return { ...selected, source: 'selected' };
  }
  const name = String(data?.hospitalName ?? '').trim();
  if (!name) return null;
  const rows = await hospitalOptions(prisma, name);
  const exact = rows.filter((r: any) => normalizeName(r.name) === normalizeName(name));
  if (exact.length === 1) return { ...exact[0], source: 'exact' };
  const alias = await prisma.hospitalAlias.findFirst({ where: { aliasNorm: normalizeName(name), hospital: { active: true } }, include: { hospital: { select: { id: true, name: true } } } });
  if (alias) return { ...alias.hospital, source: 'alias' };
  if (rows[0]?.score >= 0.8 && (rows.length < 2 || rows[0].score - rows[1].score >= 0.1)) return { ...rows[0], source: 'suggested' };
  return null;
}
