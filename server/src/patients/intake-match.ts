import { bestMatches, foldText, normalizeName } from '../common/name-match';

export async function hospitalOptions(prisma: any, query: string) {
  const hospitals = await prisma.hospital.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 2000 });
  const q = String(query ?? '').trim().slice(0, 150);
  if (!q) return hospitals.slice(0, 30);
  return bestMatches(q, hospitals, 8);
}

/**
 * پیشنهادِ **هم‌زمان با تایپ** برای کادرِ بیمارستانِ فرمِ بیمار — جدا از `hospitalOptions`.
 *
 * ⚠️ `bestMatches` برای تطبیقِ **نامِ کامل** ساخته شده: شباهت ≥ ۰٫۶ روی کلیدی که «بیمارستان»،
 * «امام»، «شهید»… از آن حذف شده. پس بخشی از یک نام — «امام»، «الب» — هیچ پیشنهادی نمی‌گرفت و
 * کادر عملاً فقط با نامِ کامل کار می‌کرد (مالک، ۱۴۰۵/۰۷/۰۴: «وقتی تایپ می‌شود گزینه‌ها زیرش
 * بیایند»). این‌جا هر واژهٔ تایپ‌شده باید آغازِ واژه‌ای از نام باشد — نامی که با همان عبارت
 * شروع می‌شود اول — و اگر کم آمد، تطبیقِ فازی برای غلطِ تایپی پشتش می‌آید.
 *
 * `matchIntakeHospital` عمداً همان `hospitalOptions` را می‌خواند: امتیازِ شباهت مبنای
 * «پیشنهادِ یکتا» در تأیید است و این رتبه‌بندی امتیاز ندارد.
 */
export async function hospitalTypeahead(prisma: any, query: string, limit = 8) {
  const hospitals = await prisma.hospital.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 2000 });
  const q = String(query ?? '').trim().slice(0, 150);
  if (!q) return hospitals.slice(0, 30);
  const typed = foldText(q);
  const words = typed.split(' ');
  const rank = (name: string) => {
    const n = foldText(name);
    if (n.startsWith(typed)) return 3;
    const parts = n.split(' ');
    if (words.every((w) => parts.some((p) => p.startsWith(w)))) return n.includes(typed) ? 2 : 1;
    return 0;
  };
  const hits = hospitals
    .map((h: { id: number; name: string }) => ({ id: h.id, name: h.name, r: rank(h.name) }))
    .filter((h: { r: number }) => h.r > 0)
    .sort((a: any, b: any) => b.r - a.r || a.name.localeCompare(b.name, 'fa'))
    .slice(0, limit)
    .map(({ id, name }: { id: number; name: string }) => ({ id, name }));
  if (hits.length >= limit) return hits;
  const seen = new Set(hits.map((h: { id: number }) => h.id));
  const fuzzy = bestMatches(q, hospitals, limit).filter((m) => !seen.has(m.id)).map(({ id, name }) => ({ id, name }));
  return [...hits, ...fuzzy].slice(0, limit);
}

/**
 * **تنها جایی که «یکتا بودن» تعریف می‌شود** — بیمارستان، جراح و نوعِ عمل از
 * همین یکی می‌خوانند.
 *
 * ⚠️ تا امروز این شرط فقط در `matchIntakeHospital` inline بود؛ با آمدنِ دو
 * تطبیقِ تازه، کپیِ دوم یعنی روزی که کسی آستانه را عوض کند و یکی از سه‌تا جا
 * بماند. بهترین گزینه باید هم امتیازِ بالایی داشته باشد (≥۰٫۸) و هم **فاصله**
 * از دومی (≥۰٫۱) — وگرنه دو نامِ نزدیک یکی‌شان خودسرانه برنده می‌شود.
 */
function uniqueSuggestion(rows: any[]) {
  if (rows[0]?.score >= 0.8 && (rows.length < 2 || rows[0].score - rows[1].score >= 0.1)) return rows[0];
  return null;
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
  const suggested = uniqueSuggestion(rows);
  return suggested ? { id: suggested.id, name: suggested.name, source: 'suggested' } : null;
}

/* ────────────────────────────────────────────────────────────────────────
   جراح و نوعِ عمل — همان الگوی بیمارستان (W3.8 / U3)

   تا امروز فقط بیمارستان تطبیق داده می‌شد. بیمار در فرمِ ثبت‌نام نامِ جراح و
   نوعِ عمل را هم **متن** می‌نوشت، و ادمین هنگامِ تأیید هر دو را از کشویی
   **دوباره** انتخاب می‌کرد؛ اگر انتخاب نمی‌کرد، متنِ آزاد روی `Visit.opType`
   می‌ماند و بعداً ابزارِ «یکسان‌سازیِ نام‌ها» لازم می‌شد. یک فرم، دو بار ورود.

   ⚠️ قاعدهٔ `name-match.ts` این‌جا هم حاکم است: **پیشنهاد، نه ادغام.** مقدار
   فقط وقتی برمی‌گردد که یکتا باشد (مساویِ دقیق، یا امتیازِ ≥۰٫۸ که دستِ‌کم
   ۰٫۱ از دومی جلوتر است) و رابط آن را به‌شکلِ «پیشنهادی — بررسی کنید» نشان
   می‌دهد. تصمیم با آدم است.

   ⚠️ و برخلافِ بیمارستان، نتیجهٔ این دو در سرور **خودکار اعمال نمی‌شود**:
   جراحِ اشتباه روی یک سندِ پزشکی از نبودِ جراح بدتر است، و مسیرِ API (بدونِ
   آدم) نباید بی‌سروصدا یکی را بچسباند. اعمالش فقط از راهِ رابط است، جایی که
   کاربر مقدارِ پرشده را می‌بیند.
   ──────────────────────────────────────────────────────────────────────── */

function pickExactOrSuggested(name: string, pool: { id: number; name: string }[]) {
  const exact = pool.filter((r) => normalizeName(r.name) === normalizeName(name));
  if (exact.length === 1) return { ...exact[0], source: 'exact' as const };
  const suggested = uniqueSuggestion(bestMatches(name, pool, 8));
  return suggested ? { id: suggested.id, name: suggested.name, source: 'suggested' as const } : null;
}

export async function matchIntakeSurgeon(prisma: any, data: any) {
  if (Number.isInteger(data?.surgeonId)) {
    const picked = await prisma.surgeon.findFirst({
      where: { id: data.surgeonId, active: true },
      select: { id: true, person: { select: { firstName: true, lastName: true } } },
    });
    if (picked) return { id: picked.id, name: `${picked.person.firstName} ${picked.person.lastName}`.trim(), source: 'selected' as const };
  }
  const name = String(data?.surgeonName ?? '').trim().slice(0, 150);
  if (!name) return null;
  const rows = await prisma.surgeon.findMany({
    where: { active: true },
    select: { id: true, person: { select: { firstName: true, lastName: true } } },
    take: 2000,
  });
  return pickExactOrSuggested(name, rows.map((s: any) => ({ id: s.id, name: `${s.person.firstName} ${s.person.lastName}`.trim() })));
}

export async function matchIntakeProcedure(prisma: any, data: any) {
  if (Number.isInteger(data?.procedureTypeId)) {
    const picked = await prisma.procedureType.findFirst({ where: { id: data.procedureTypeId }, select: { id: true, name: true } });
    if (picked) return { ...picked, source: 'selected' as const };
  }
  const name = String(data?.procedure ?? '').trim().slice(0, 150);
  if (!name) return null;
  const rows = await prisma.procedureType.findMany({ select: { id: true, name: true }, take: 2000 });
  return pickExactOrSuggested(name, rows);
}

/** هر سه ارجاعِ یک ثبت‌نام در یک رفت‌وبرگشت — رابط هر سه را با هم می‌خواهد. */
export async function matchIntakeRefs(prisma: any, data: any) {
  const [hospital, surgeon, procedure] = await Promise.all([
    matchIntakeHospital(prisma, data),
    matchIntakeSurgeon(prisma, data),
    matchIntakeProcedure(prisma, data),
  ]);
  return { hospital, surgeon, procedure };
}
