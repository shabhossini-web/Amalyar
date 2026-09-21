import { syncLinkDocuments } from './link-documents';
import { answerDocuments, ORDER_DELEGATE, ORDER_KINDS, type OrderKind } from './orders.service';
import { upsertWork } from '../work/work-processor';

/**
 * W1.10 — هستهٔ کشفِ دادهٔ ناقصِ تاریخی و ترمیمش، **خالص روی هر clientِ Prisma**.
 *
 * ⚠️ چرا از `RepairService` بیرون آمد: نسخهٔ اولِ W1.10 فقط یک endpointِ
 * دستی بود و نتیجه‌اش این شد که **هیچ‌کس اجرایش نکرد** — ابزار ساخته شد،
 * ردیف‌های خراب سرِ جایشان ماندند. ابزاری که به یادِ کسی بند باشد، اجرا
 * نمی‌شود. حالا `RemindersWorkerService` هم می‌تواند صدایش بزند، و آن worker
 * نه Nest دارد نه DIِ tenant-scoped — فقط یک `PrismaClient`ِ کوتاه‌عمر.
 * پس هسته باید مثلِ `sendReminders` و `processDomainEvents` خالص باشد.
 *
 * قاعدهٔ مرکزی دست‌نخورده می‌ماند: **ترمیم = دوباره‌دواندنِ همان تابعِ رو به
 * جلو.** هر سه از قبل idempotentاند — `syncLinkDocuments` روی `externalUrl`،
 * `answerDocuments` روی محتوا، `upsertWork` روی `idempotencyKey`.
 */

export interface Finding {
  check: string;
  fix: 'auto' | 'queue';
  entity: string;
  id: number;
  patientId: number | null;
  visitId: number | null;
  title: string;
  detail: string;
}

export interface RepairResult {
  repaired: number;
  queued: number;
  failed: { id: number; check: string; error: string }[];
}

const CHECK_FA: Record<string, string> = {
  form_links_missing: 'لینکِ فرم که مدرکِ پرونده نشد',
  order_answer_no_document: 'پاسخِ سفارش بدونِ مدرک',
  followup_unattributed: 'پاسخِ پیگیری بدونِ موعدِ مشخص',
};

/** فیلدهای `links` یک ثبت‌نام — اول اسنپ‌شاتِ لحظهٔ پاسخ (قرارداد §۷)، بعد فرمِ زنده. */
function linkFieldsOf(sub: any): { key: string; label: string; type: string; docCategory?: string | null }[] {
  const snap = Array.isArray(sub.schemaSnapshot) ? sub.schemaSnapshot : null;
  const rows = snap ?? (sub.form?.fields ?? []);
  return rows
    .filter((f: any) => f?.type === 'links' && f?.key)
    .map((f: any) => ({ key: f.key, label: f.label ?? f.key, type: 'links', docCategory: f.docCategory ?? null }));
}

/** نشانی‌های معتبرِ داخلِ باکس‌های `links` — مقدارِ خراب ردیف را حذف نمی‌کند. */
function urlsIn(data: Record<string, any>, fields: { key: string }[]): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const raw = data?.[f.key];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const item of list) {
      const text = typeof item === 'string' ? item : item?.url;
      if (typeof text !== 'string' || !text.trim()) continue;
      try { out.push(new URL(text.trim()).toString().slice(0, 2000)); } catch { /* بی‌اعتبار */ }
    }
  }
  return [...new Set(out)];
}

/* ── چک ۱: لینکِ فرم که مدرک نشد (W1.3/D03a) ───────────────────────────── */
async function formLinksMissing(db: any, limit: number): Promise<Finding[]> {
  const subs = await db.intakeSubmission.findMany({
    where: { status: 'approved', patientId: { not: null } },
    include: { form: { include: { fields: true } } },
    orderBy: { id: 'asc' }, take: limit,
  });
  const out: Finding[] = [];
  for (const sub of subs) {
    const fields = linkFieldsOf(sub);
    if (!fields.length) continue;
    const urls = urlsIn(sub.data as any, fields);
    if (!urls.length) continue;
    const have = await db.document.findMany({
      where: { patientId: sub.patientId, externalUrl: { in: urls }, deletedAt: null },
      select: { externalUrl: true },
    });
    const seen = new Set(have.map((d: any) => d.externalUrl));
    const missing = urls.filter((u) => !seen.has(u));
    if (!missing.length) continue;
    out.push({
      check: 'form_links_missing', fix: 'auto', entity: 'intake_submission', id: sub.id,
      patientId: sub.patientId, visitId: sub.visitId,
      title: CHECK_FA.form_links_missing,
      detail: `${missing.length} لینک از این فرم مدرکِ پرونده نشده`,
    });
  }
  return out;
}

/* ── چک ۲: پاسخِ سفارش بدونِ مدرک (W1.2، صریحاً به W1.10 حواله شده) ────── */
async function orderAnswersWithoutDocument(db: any, limit: number): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const kind of ORDER_KINDS) {
    const rows = await db[ORDER_DELEGATE[kind]].findMany({
      where: { status: { in: ['answered', 'in_review', 'reviewed'] } },
      orderBy: { id: 'asc' }, take: limit,
    });
    for (const row of rows) {
      const text = row.resultText ?? row.answerText ?? null;
      const link = row.resultLink ?? row.answerLink ?? null;
      if (!text && !link) continue;
      const docs = await db.document.findMany({
        where: { refType: `${kind}_order`, refId: row.id, patientId: row.patientId, deletedAt: null },
        select: { contentText: true, externalUrl: true },
      });
      const missing = (text && !docs.some((d: any) => d.contentText === text))
        || (link && !docs.some((d: any) => d.externalUrl === link));
      if (!missing) continue;
      out.push({
        check: 'order_answer_no_document', fix: 'auto', entity: `${kind}_order`, id: row.id,
        patientId: row.patientId, visitId: row.visitId,
        title: CHECK_FA.order_answer_no_document,
        detail: `پاسخِ ثبت‌شده مدرکِ پرونده ندارد (${[text ? 'متن' : null, link ? 'لینک' : null].filter(Boolean).join(' و ')})`,
      });
    }
  }
  return out;
}

/* ── چک ۳: پاسخِ پیگیریِ بی‌موعد (W1.1/D01) — صف، نه حدس ───────────────── */
async function followupsUnattributed(db: any, limit: number): Promise<Finding[]> {
  const subs = await db.intakeSubmission.findMany({
    where: { status: 'approved', patientId: { not: null }, form: { followUp: { not: null } } },
    include: { form: { select: { title: true } } },
    orderBy: { id: 'asc' }, take: limit,
  });
  return subs
    .filter((s: any) => (s.data as any)?.followUpVisitId == null)
    .map((s: any) => ({
      check: 'followup_unattributed', fix: 'queue' as const, entity: 'intake_submission', id: s.id,
      patientId: s.patientId, visitId: s.visitId,
      title: CHECK_FA.followup_unattributed,
      detail: `پاسخِ «${s.form?.title ?? 'پیگیری'}» به هیچ موعدی وصل نیست — کدام عمل را پیگیری می‌کند؟`,
    }));
}

/** فقط می‌خواند. خروجی مرتب است تا دو اجرای پشت‌سرهم قابلِ مقایسه باشد. */
export async function repairScan(db: any, limit = 500) {
  const findings: Finding[] = [
    ...(await formLinksMissing(db, limit)),
    ...(await orderAnswersWithoutDocument(db, limit)),
    ...(await followupsUnattributed(db, limit)),
  ];
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.check] = (counts[f.check] ?? 0) + 1;
  return {
    findings, counts,
    auto: findings.filter((f) => f.fix === 'auto').length,
    queue: findings.filter((f) => f.fix === 'queue').length,
  };
}

/** همان تابعِ رو به جلو، دوباره. برمی‌گرداند که چیزی ساخته شد یا نه. */
async function repairOne(f: Finding, tx: any): Promise<boolean> {
  if (f.check === 'form_links_missing') {
    const sub = await tx.intakeSubmission.findUnique({
      where: { id: f.id }, include: { form: { include: { fields: true } } },
    });
    if (!sub?.patientId) return false;
    const before = await tx.document.count({ where: { patientId: sub.patientId, deletedAt: null } });
    await syncLinkDocuments(tx, {
      patientId: sub.patientId, visitId: sub.visitId,
      fields: linkFieldsOf(sub), values: (sub.data as any) ?? {}, actorId: null,
    });
    return (await tx.document.count({ where: { patientId: sub.patientId, deletedAt: null } })) > before;
  }
  if (f.check === 'order_answer_no_document') {
    const kind = f.entity.replace(/_order$/, '') as OrderKind;
    const row = await tx[ORDER_DELEGATE[kind]].findUnique({ where: { id: f.id } });
    if (!row) return false;
    const data = kind === 'consult' || kind === 'referral'
      ? { answerText: row.answerText ?? null, answerLink: row.answerLink ?? null }
      : { resultText: row.resultText ?? null, resultLink: row.resultLink ?? null,
        resultUser: row.resultUser ?? null, resultPass: row.resultPass ?? null };
    return (await answerDocuments(kind, row, data, tx, null)) > 0;
  }
  return false;
}

/** کارِ تطبیق. `idempotencyKey` از خودِ ایراد ساخته می‌شود، پس اسکنِ دوباره صف را دوبرابر نمی‌کند. */
function enqueue(db: any, f: Finding, error?: string) {
  return upsertWork(db, {
    idempotencyKey: `repair:${f.check}:${f.entity}:${f.id}`,
    type: 'repair_data',
    title: f.title,
    note: [f.detail, error ? `ترمیمِ خودکار نشد: ${error}` : null].filter(Boolean).join(' — '),
    ownerRole: 'admin',
    patientId: f.patientId ?? undefined,
    visitId: f.visitId ?? undefined,
    refType: f.entity,
    refId: f.id,
    dueAt: new Date(),
    priority: 1,
  });
}

/**
 * ترمیم + صف. هر ردیف تراکنشِ خودش را دارد: یک ردیفِ خرابِ تاریخی نباید
 * ترمیمِ بقیه را به هم بزند (مثلاً لینکی که اصلاً URL معتبر نیست).
 *
 * `tx(fn)` را صدا می‌زند تا هم `PrismaService` (که `$transaction` دارد) و هم
 * `PrismaClient`ِ workerی یکی کار کنند.
 */
export async function repairRun(db: any, limit = 500): Promise<RepairResult> {
  const { findings } = await repairScan(db, limit);
  const res: RepairResult = { repaired: 0, queued: 0, failed: [] };
  for (const f of findings) {
    try {
      if (f.fix === 'auto') {
        const made = await db.$transaction((tx: any) => repairOne(f, tx));
        if (made) res.repaired += 1;
      } else {
        await enqueue(db, f);
        res.queued += 1;
      }
    } catch (e: any) {
      /* ⚠️ بلعیده نمی‌شود: ردیفی که خودکار درست نشد به صف می‌رود تا آدم ببیندش،
         وگرنه «۰ خطا» گزارش می‌شد در حالی که چیزی ترمیم نشده بود. */
      const msg = String(e?.message ?? e).slice(0, 300);
      res.failed.push({ id: f.id, check: f.check, error: msg });
      await enqueue(db, f, msg).catch(() => {});
      res.queued += 1;
    }
  }
  return res;
}
