/**
 * W2.2 — آشکارسازِ حالت‌های بیات (`docs/plan/CONTRACTS.md` §۲).
 *
 * چهار کارِ لایهٔ کار «رویدادِ تراکنشی» ندارند: هیچ‌کس روی «عملی که وضعیتش
 * ثبت نشد» کلیک نمی‌کند. این‌ها را زمان می‌سازد، پس همان sweepِ workerِ
 * یادآوری‌ها (و `POST /work/process`) این تابع را قبل از پردازشِ رویدادها
 * صدا می‌زند:
 *
 * | حالت | رویداد | شرط |
 * |---|---|---|
 * | عملِ جراحیِ گذشته، هنوز `pending` | `visit.unconfirmed` | `opDate` قبل از امروز |
 * | عملِ `done` بدونِ سندِ `report` | `report.missing` | همان |
 * | حوالهٔ `sent/received` روی عملِ گذشته | `usage.unconfirmed` | یک رویداد به‌ازای هر مراجعه |
 * | دعوتِ فرمِ پیگیری، ۳ روز بی‌پاسخ | `form.unanswered` | هنوز منقضی نشده |
 * | کارِ «گزارش» باز ولی سند رسیده | `report.uploaded` | از هر مسیری که آپلود شده باشد |
 *
 * قواعد:
 * - **هفته‌ای یک‌بار** به‌ازای هر ref (نه هر sweep): کلیدِ idempotency همان
 *   کارِ باز را نگه می‌دارد، ولی سیلِ رویداد جدولِ analytics را بی‌معنا می‌کند.
 * - **کفِ ۶۰ روز**: نصبِ قدیمی با صدها عملِ بی‌وضعیت نباید در اولین sweep
 *   صدها کار بسازد — این کارها برای «امروز» است، نه ممیزیِ تاریخ.
 * - فقط `kind = 'surgery'`: مطب (`clinic`) گزارشِ عمل و مصرفِ سرِ عمل ندارد.
 * - جدولِ نبوده (tenantِ migrate‌نشده) هر آشکارساز را جداگانه خاموش می‌کند،
 *   نه کلِ sweep را.
 */
const DAY = 864e5;

type Row = { patientId?: number | null; visitId?: number | null; refType?: string; refId?: number; payload?: Record<string, unknown> };

const keyOf = (r: { refType?: string | null; refId?: number | null; visitId?: number | null }) =>
  r.refType && r.refId ? `${r.refType}:${r.refId}` : `visit:${r.visitId}`;

/** رویداد فقط برای refهایی که در بازهٔ `since` همین رویداد را نگرفته‌اند. */
async function emitOnce(client: any, type: string, rows: Row[], since: Date): Promise<number> {
  if (!rows.length) return 0;
  const prior = await client.domainEvent.findMany({
    where: { type, at: { gte: since } }, select: { visitId: true, refType: true, refId: true },
  });
  const seen = new Set(prior.map(keyOf));
  const fresh = rows.filter((r) => !seen.has(keyOf(r)));
  if (!fresh.length) return 0;
  await client.domainEvent.createMany({
    data: fresh.map((r) => ({
      type, patientId: r.patientId ?? null, visitId: r.visitId ?? null,
      refType: r.refType ?? null, refId: r.refId ?? null, payload: r.payload ?? undefined,
    })),
  });
  return fresh.length;
}

const missingTable = (e: any) =>
  ['P2021', 'P2022'].includes(e?.code) || e?.meta?.code === '42P01' || /does not exist/i.test(String(e?.message ?? ''));

async function guard(fn: () => Promise<number>): Promise<number> {
  try { return await fn(); } catch (e) { if (missingTable(e)) return 0; throw e; }
}

export type DetectResult = {
  unconfirmed: number; reportMissing: number; usageUnconfirmed: number; formUnanswered: number; reportUploaded: number;
  pathwayOverdue: number;
};

export async function detectStaleWork(client: any, now: Date = new Date()): Promise<DetectResult> {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const floor = new Date(today.getTime() - 60 * DAY);
  const since = new Date(now.getTime() - 7 * DAY);
  const live = { patient: { deletedAt: null } };

  const unconfirmed = await guard(async () => {
    const rows = await client.visit.findMany({
      where: { kind: 'surgery', opStatus: 'pending', opDate: { lt: today, gte: floor }, ...live },
      select: { id: true, patientId: true, techId: true }, orderBy: { opDate: 'asc' }, take: 200,
    });
    return emitOnce(client, 'visit.unconfirmed',
      rows.map((v: any) => ({ patientId: v.patientId, visitId: v.id, payload: { techId: v.techId ?? null } })), since);
  });

  const reportMissing = await guard(async () => {
    const rows = await client.visit.findMany({
      where: {
        kind: 'surgery', opStatus: 'done', opDate: { lt: today, gte: floor }, ...live,
        documents: { none: { category: 'report', deletedAt: null } },
      },
      select: { id: true, patientId: true, techId: true }, orderBy: { opDate: 'asc' }, take: 200,
    });
    return emitOnce(client, 'report.missing',
      rows.map((v: any) => ({ patientId: v.patientId, visitId: v.id, payload: { techId: v.techId ?? null } })), since);
  });

  const usageUnconfirmed = await guard(async () => {
    const rows = await client.stockTransfer.findMany({
      where: {
        status: { in: ['sent', 'received'] }, visitId: { not: null },
        visit: { is: { opDate: { lt: today, gte: floor }, opStatus: { not: 'cancelled' }, ...live } },
      },
      select: { id: true, visitId: true, visit: { select: { patientId: true, techId: true } } }, take: 200,
    });
    const byVisit = new Map<number, Row>();
    for (const t of rows) {
      const cur = byVisit.get(t.visitId) ?? { patientId: t.visit.patientId, visitId: t.visitId, payload: { techId: t.visit.techId ?? null, transferIds: [] as number[] } };
      (cur.payload!.transferIds as number[]).push(t.id);
      byVisit.set(t.visitId, cur);
    }
    return emitOnce(client, 'usage.unconfirmed', [...byVisit.values()], since);
  });

  const formUnanswered = await guard(async () => {
    const rows = await client.surveyInvite.findMany({
      where: { status: 'pending', sentAt: { lt: new Date(now.getTime() - 3 * DAY), gte: floor }, expiresAt: { gt: now } },
      select: { id: true, patientId: true, visitId: true }, take: 200,
    });
    return emitOnce(client, 'form.unanswered',
      rows.map((i: any) => ({ patientId: i.patientId, visitId: i.visitId ?? null, refType: 'survey_invite', refId: i.id })), since);
  });

  /* بستن از هر مسیر: گزارشی که از پروندهٔ ادمین (نه پنلِ کارشناس) آپلود شده باشد هم کار را می‌بندد. */
  const reportUploaded = await guard(async () => {
    const open = await client.workItem.findMany({
      where: { type: 'complete_report', state: 'open', visitId: { not: null } },
      select: { visitId: true, patientId: true }, take: 200,
    });
    if (!open.length) return 0;
    const docs = await client.document.findMany({
      where: { visitId: { in: open.map((w: any) => w.visitId) }, category: 'report', deletedAt: null },
      select: { visitId: true }, distinct: ['visitId'],
    });
    const has = new Set(docs.map((d: any) => d.visitId));
    const rows = open.filter((w: any) => has.has(w.visitId)).map((w: any) => ({ patientId: w.patientId, visitId: w.visitId }));
    if (!rows.length) return 0;
    await client.domainEvent.createMany({
      data: rows.map((r: Row) => ({ type: 'report.uploaded', patientId: r.patientId ?? null, visitId: r.visitId ?? null, payload: { by: 'detector' } })),
    });
    return rows.length;
  });

  /**
   * «عدمِ پاسخ»ِ مسیرِ درمان (W4.2): گامی که `escalate_days` روز از موعدش
   * گذشته و هنوز باز است.
   *
   * ⚠️ کفِ ۶۰ روزه این‌جا هم اعمال می‌شود (`floor`): نصبی که دوره‌های قدیمیِ
   * نیمه‌کاره دارد نباید در اولین sweep صدها کارِ پیگیری بسازد.
   * ⚠️ فقط دورهٔ **فعال**: گامِ بازِ دوره‌ای که بسته شده، عمداً باز مانده و
   * کارِ پیگیری ندارد (قاعدهٔ «بستنِ دوره گام‌ها را انجام‌شده نمی‌کند»).
   */
  const pathwayOverdue = await guard(async () => {
    const rows = await client.episodeStep.findMany({
      where: {
        status: 'pending',
        escalateDays: { not: null, gt: 0 },
        dueAt: { lt: today, gte: floor },
        episode: { status: 'active', patient: { deletedAt: null } },
      },
      select: {
        id: true, title: true, ownerRole: true, dueAt: true, escalateDays: true,
        episode: { select: { patientId: true, visitId: true } },
      },
      orderBy: { dueAt: 'asc' }, take: 200,
    });
    const ripe = rows.filter((s: any) =>
      s.dueAt.getTime() + s.escalateDays * DAY <= now.getTime());
    return emitOnce(client, 'pathway.step_overdue', ripe.map((s: any) => ({
      patientId: s.episode.patientId, visitId: s.episode.visitId ?? null,
      refType: 'pathway_step', refId: s.id,
      payload: { title: s.title, ownerRole: s.ownerRole ?? null },
    })), since);
  });

  return { unconfirmed, reportMissing, usageUnconfirmed, formUnanswered, reportUploaded, pathwayOverdue };
}
