import { rulesFor, type WorkUpsert } from './work-rules';

/**
 * پردازشگرِ رویداد ← کار. مثلِ `send-reminders.ts` یک تابعِ خالص روی هر
 * clientِ Prisma (هم `PrismaService` داخلِ درخواست، هم `PrismaClient` کوتاه‌عمرِ
 * worker) تا از هر دو جا اجرا شود.
 *
 * ⚠️ idempotent: `idempotencyKey` یکتاست و رویدادِ تکراری کارِ دوم نمی‌سازد؛
 * نشانه‌گذاریِ `processedAt` جداگانه است تا اگر وسطِ کار بمیرد، sweepِ بعدی از
 * همان رویداد ادامه دهد (بدترین حالت: upsertِ بی‌اثر).
 */
export async function upsertWork(client: any, u: WorkUpsert, opts: { reopen?: boolean } = {}) {
  const existing = await client.workItem.findUnique({ where: { idempotencyKey: u.idempotencyKey } });
  const fields = {
    type: u.type,
    title: u.title,
    ownerRole: u.ownerRole ?? null,
    ownerAccountId: u.ownerAccountId ?? null,
    patientId: u.patientId ?? null,
    visitId: u.visitId ?? null,
    appointmentId: u.appointmentId ?? null,
    refType: u.refType ?? null,
    refId: u.refId ?? null,
    dueAt: u.dueAt ?? null,
    priority: u.priority ?? 0,
    note: u.note ?? null,
    sourceEventId: u.sourceEventId ?? null,
  };
  if (!existing) {
    try {
      return { row: await client.workItem.create({ data: { ...fields, idempotencyKey: u.idempotencyKey } }), created: true };
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e; // مسابقهٔ دو sweep — ردیف را دوباره بخوان
      return { row: await client.workItem.findUnique({ where: { idempotencyKey: u.idempotencyKey } }), created: false };
    }
  }
  // A replay of the same (or an older) event must not reopen a completed task.
  /* ⚠️ و کاری که آدم با «انجام شد» بسته (`closedBy: 'hand'` — تماس گرفته شد، `work.service.ts`)
     هم باز نمی‌شود: آشکارساز هفتهٔ بعد همان «فرمِ بی‌پاسخ» را دوباره می‌بیند چون بیمار هنوز پر
     نکرده، ولی کارِ منشی — تماس — انجام شده است. «بستن بدونِ اقدام» همچنان باز می‌شود. */
  const handled = existing.outcome?.closedBy === 'hand';
  const reopen = opts.reopen && !handled && (!u.sourceEventId || !existing.sourceEventId || u.sourceEventId > existing.sourceEventId);
  if (u.sourceEventId && existing.sourceEventId && u.sourceEventId < existing.sourceEventId) return { row: existing, created: false };
  if (['done', 'cancelled', 'expired'].includes(existing.state) && !reopen) return { row: existing, created: false };
  const row = await client.workItem.update({
    where: { id: existing.id },
    data: { ...fields, ...(reopen ? { state: 'open', completedAt: null, completedById: null, outcome: null } : {}) },
  });
  return { row, created: false };
}

export async function closeWork(client: any, ref: { refType: string; refId: number; type?: string }, actorId: number | null = null) {
  const res = await client.workItem.updateMany({
    where: { refType: ref.refType, refId: ref.refId, ...(ref.type ? { type: ref.type } : {}), state: { in: ['open', 'blocked'] } },
    data: { state: 'done', completedAt: new Date(), completedById: actorId, outcome: { closedBy: 'event' } },
  });
  return res.count as number;
}

export async function processDomainEvents(client: any, opts: { limit?: number } = {}) {
  const limit = opts.limit ?? 200;
  const events = await client.domainEvent.findMany({
    where: { processedAt: null },
    orderBy: { id: 'asc' },
    take: limit,
  });
  let created = 0, closed = 0, touched = 0;
  for (const e of events) {
    const out = rulesFor(e);
    for (const c of out.closes) closed += await closeWork(client, c, e.actorId ?? null);
    for (const u of out.upserts) {
      const r = await upsertWork(client, u, { reopen: u.reopen });
      if (r.created) created++; else touched++;
    }
    await client.domainEvent.update({ where: { id: e.id }, data: { processedAt: new Date() } });
  }
  return { events: events.length, created, touched, closed };
}
