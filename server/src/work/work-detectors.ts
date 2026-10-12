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
 * | توقفِ تحویلِ راننده انجام‌شده، کارشناس «تحویل گرفتم» نزده | `delivery.unconfirmed` | روزِ تحویل گذشته؛ یک رویداد به‌ازای هر حواله |
 * | دعوتِ فرمِ پیگیری، ۳ روز بی‌پاسخ | `form.unanswered` | هنوز منقضی نشده |
 * | کارِ «گزارش» باز ولی سند رسیده | `report.uploaded` | از هر مسیری که آپلود شده باشد |
 *
 * قواعد:
 * - **هفته‌ای یک‌بار** به‌ازای هر ref (نه هر sweep): کلیدِ idempotency همان
 *   کارِ باز را نگه می‌دارد، ولی سیلِ رویداد جدولِ analytics را بی‌معنا می‌کند.
 * - **کفِ ۶۰ روز**: نصبِ قدیمی با صدها عملِ بی‌وضعیت نباید در اولین sweep
 *   صدها کار بسازد — این کارها برای «امروز» است، نه ممیزیِ تاریخ.
 * - فقط `kind = 'surgery'`.
 * - ⚠️ **در مطب، «گزارشِ عمل» همان شرحِ عملِ نوشته‌شده است** (سندِ بالینیِ `op`)، نه
 *   فایلِ آپلودیِ دستهٔ `report` (آن گزارشِ مانیتورینگِ کارشناسِ شرکت است). نسخهٔ قبلی
 *   فقط فایل را می‌دید و هر عملِ مطب — حتی با شرحِ کامل — «گزارشِ عمل بارگذاری نشده»
 *   در صفِ کارشناس می‌گرفت (گزارشِ مالک ۱۴۰۵/۰۷/۰۱، ۱۷ کارِ دروغین). حالا در مطب
 *   هر کدام از این دو کافی است، کار مالِ پزشک است و عنوانش «شرحِ عمل نوشته نشده».
 * - جدولِ نبوده (tenantِ migrate‌نشده) هر آشکارساز را جداگانه خاموش می‌کند،
 *   نه کلِ sweep را.
 */
import { stat } from 'fs/promises';
import { join } from 'path';
import { clinicDayStart, todayRangeUtc } from '../common/clinic-day';
import { storageRoot } from '../storage/storage-health';

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

/** حوزهٔ همین نصب — همان ردیفِ `settings.vertical` که `ConfigService` می‌خواند. */
async function isClinic(client: any): Promise<boolean> {
  try { return (await client.setting.findUnique({ where: { key: 'vertical' } }))?.value === 'clinic'; } catch { return false; }
}

async function guard(fn: () => Promise<number>): Promise<number> {
  try { return await fn(); } catch (e) { if (missingTable(e)) return 0; throw e; }
}

export type DetectResult = {
  unconfirmed: number; reportMissing: number; usageUnconfirmed: number; formUnanswered: number; reportUploaded: number;
  pathwayOverdue: number; deliveryUnconfirmed: number;
};

export async function detectStaleWork(client: any, now: Date = new Date()): Promise<DetectResult> {
  const [today] = todayRangeUtc(now);
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

  const clinic = await isClinic(client);
  const reportMissing = await guard(async () => {
    const rows = await client.visit.findMany({
      where: {
        kind: 'surgery', opStatus: 'done', opDate: { lt: today, gte: floor }, ...live,
        documents: { none: { category: 'report', deletedAt: null } },
        /* مطب: شرحِ عملِ جاری هم «گزارش» است (بالا). */
        ...(clinic ? { clinicalNotes: { none: { kind: 'op', replacedAt: null } } } : {}),
      },
      select: {
        id: true, patientId: true, techId: true,
        ...(clinic ? { surgeon: { select: { person: { select: { account: { select: { id: true, status: true } } } } } } } : {}),
      },
      orderBy: { opDate: 'asc' }, take: 200,
    });
    return emitOnce(client, 'report.missing', rows.map((v: any) => {
      const doctor = v.surgeon?.person?.account;
      return {
        patientId: v.patientId, visitId: v.id,
        payload: clinic
          ? { clinic: true, doctorId: doctor?.status === 'active' ? doctor.id : null }
          : { techId: v.techId ?? null },
      };
    }), since);
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

  /**
   * تحویلِ دوطرفه (مالک، ۱۴۰۵/۰۷/۱۱): راننده روی توقفِ تحویل «تحویل دادم» زده — حواله ارسال
   * شده — ولی کارشناس تا پایانِ **روزِ مطبِ** تحویل «تحویل گرفتم» نزده. کارِ دفتر، با ref =
   * خودِ حواله (`stock_transfer`) تا «تحویل گرفتم»ِ بعدی (`delivery.confirmed`) همان را ببندد.
   * حوالهٔ بی‌مراجعه (بارِ آزادِ تخته) هم شمرده می‌شود؛ مراجعهٔ بیمارِ حذف‌شده نه.
   */
  const deliveryUnconfirmed = await guard(async () => {
    /* `doneAt` زمان‌مهرِ واقعی است، نه تاریخِ نیمه‌شبِ UTC — مرزِ روز هم باید لحظهٔ واقعی باشد. */
    const dayStart = clinicDayStart(now);
    const rows = await client.stockTransfer.findMany({
      where: {
        status: { in: ['sent', 'received'] }, techReceivedAt: null,
        stop: { is: { kind: 'deliver', doneAt: { lt: dayStart, gte: new Date(dayStart.getTime() - 60 * DAY) } } },
        OR: [{ visitId: null }, { visit: { is: live } }],
      },
      select: {
        id: true, code: true, visitId: true, toLocation: true,
        visit: { select: { patientId: true, techId: true, tech: { select: { person: { select: { firstName: true, lastName: true } } } } } },
      },
      orderBy: { id: 'asc' }, take: 200,
    });
    return emitOnce(client, 'delivery.unconfirmed', rows.map((t: any) => {
      const p = t.visit?.tech?.person;
      return {
        patientId: t.visit?.patientId ?? null, visitId: t.visitId ?? null,
        refType: 'stock_transfer', refId: t.id,
        payload: {
          code: t.code, place: t.toLocation, techId: t.visit?.techId ?? null,
          techName: p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || null : null,
        },
      };
    }), since);
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
    const ids = open.map((w: any) => w.visitId);
    const docs = await client.document.findMany({
      where: { visitId: { in: ids }, category: 'report', deletedAt: null },
      select: { visitId: true }, distinct: ['visitId'],
    });
    /* مطب: شرحِ عملِ نوشته‌شده هم کار را می‌بندد — کارهای دروغینِ قبل از این اصلاح
       هم با همین sweep (هر ۵ دقیقه) خودشان بسته می‌شوند. */
    const notes = clinic ? await client.clinicalNote.findMany({
      where: { visitId: { in: ids }, kind: 'op', replacedAt: null },
      select: { visitId: true }, distinct: ['visitId'],
    }) : [];
    const has = new Set([...docs, ...notes].map((d: any) => d.visitId));
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

  return { unconfirmed, reportMissing, usageUnconfirmed, formUnanswered, reportUploaded, pathwayOverdue, deliveryUnconfirmed };
}

/**
 * گیتِ `detectLostFiles`: ذخیره‌سازی‌ای که می‌شود به «فایل نیست»ش اعتماد کرد. در production فقط وقتی ماندگاری
 * **اثبات** شده (`ok` — دو کانتینر یا بیشتر همین پوشه را دیده‌اند)؛ `unproven` یعنی volumeای سوار است که شاید
 * اشتباهی باشد. بیرونِ production (سندباکس، CI) هر ریشهٔ قابل‌نوشتن.
 */
export const storageTrusted = (h: { writable: boolean; verdict: string } | null) =>
  !!h?.writable && (h.verdict === 'ok' || process.env.NODE_ENV !== 'production');

/** کلیدِ `settings` که شمارِ آخرین سنجشِ «مدرکِ بی‌فایل» را نگه می‌دارد — پنلِ پلتفرم همین را می‌خواند. */
export const FILES_MISSING_KEY = 'files_missing';

export type LostFilesResult = { missing: number; emitted: number; restored: number };

/**
 * **مدرکِ بی‌فایل** (مالک، ۱۴۰۵/۰۷/۲۰): ردیفِ `documents` هست ولی خودِ فایل روی دیسکِ این شرکت نیست.
 *
 * زمینه: پیش از سوارشدنِ volumeِ ماندگار (حدودِ ۱۴۰۵/۰۷/۰۱) هر دیپلوی پوشهٔ فایل‌ها را عوض می‌کرد؛ اولین تمرینِ
 * بازگردانی ۲۴ مدرک در هفت شرکت پیدا کرد که ردیفشان مانده و فایلشان رفته. پرونده آن‌ها را مثلِ مدرکِ سالم نشان
 * می‌داد و «دانلود» فقط خطای «فایلِ این مدرک روی سرور نیست» می‌داد — کسی نمی‌دانست کدام‌ها باید دوباره گرفته شوند.
 *
 * هر مدرکِ بی‌فایل یک رویدادِ `document.file_missing` ← کارِ منشی «دوباره آپلود کنید» (کِی دوباره: پایین).
 * کارِ بازی که مدرکش دیگر بی‌فایل نیست (دوباره آپلود شد، یا خودِ ردیف حذف شد) با `document.file_restored`
 * بسته می‌شود — از هر مسیری که درست شده باشد.
 *
 * ⚠️ مسیرِ فایل **همان** `StorageService.pathFor` است (`<ریشه>/<شناسهٔ شرکت>/<دو حرفِ اول>/<sha>`) ولی بی‌آنکه
 * به TenantContext نیاز داشته باشد — worker بیرونِ درخواست است و شناسهٔ شرکت را خودش می‌دهد.
 *
 * ⚠️ **فقط وقتی ذخیره‌سازی قابلِ اعتماد است صدا زده شود** (`storageTrusted(storageHealth())`؛ گیتش با صدازننده است).
 * ریشه‌ای که اشتباه سوار شده یعنی «همهٔ فایل‌ها نیستند» — آن‌وقت این تابع برای هر مدرکِ هر شرکت یک کار می‌ساخت،
 * در حالی که مشکل یکی است و کارتِ ذخیره‌سازیِ پنلِ پلتفرم همان را نشان می‌دهد.
 *
 * مدرکِ لینکی (`externalUrl`) و پاسخِ متنیِ سفارش (`contentText`) فایلی ندارند و شمرده نمی‌شوند.
 */
export async function detectLostFiles(
  client: any, tenantId: string, opts: { root?: string } = {},
): Promise<LostFilesResult> {
  const none: LostFilesResult = { missing: 0, emitted: 0, restored: 0 };
  /* همان قاعدهٔ `StorageService.tenantRoot` — شناسه بخشی از مسیر است. */
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return none;
  const dir = join(opts.root ?? storageRoot(), tenantId);
  try {
    const docs: { id: number; patientId: number; visitId: number | null; sha256: string; title: string | null; fileName: string }[] =
      await client.document.findMany({
        where: { deletedAt: null, externalUrl: null, contentText: null, sha256: { not: '' }, patient: { deletedAt: null } },
        select: { id: true, patientId: true, visitId: true, sha256: true, title: true, fileName: true },
        orderBy: { id: 'asc' },
      });
    const present = new Map<string, boolean>();
    for (const d of docs) {
      if (present.has(d.sha256) || !/^[0-9a-f]{64}$/.test(d.sha256)) continue;
      present.set(d.sha256, await stat(join(dir, d.sha256.slice(0, 2), d.sha256)).then(() => true, () => false));
    }
    const lost = docs.filter((d) => present.get(d.sha256) === false);
    const lostIds = new Set(lost.map((d) => d.id));

    /* چه کسی رویداد بگیرد — نه «هفته‌ای یک‌بار» مثلِ بقیهٔ آشکارسازها، بلکه از روی **خودِ کار**:
       - کاری نیست ← رویداد.
       - کارِ باز، یا رویدادِ پردازش‌نشده‌ای در صف ← هیچ (تکرار نمی‌سازیم).
       - کاری که آدم کنار گذاشت («بستن بدونِ اقدام»/لغو — بیمار مدرک را ندارد) ← هیچ؛ هر هفته دوباره
         همان را جلوی منشی نمی‌گذاریم. ردیفِ قرمزِ پرونده و شمارِ پنلِ پلتفرم حقیقت را نگه می‌دارند.
       - کاری که با رویداد بسته شد (دوباره آپلود شد) و فایل **دوباره** نیست ← رویداد، که کار را باز کند.
         با پنجرهٔ هفت‌روزه همین حالت تا یک هفته بی‌کار می‌ماند (در سنجه دیده شد). */
    const ids = [...lostIds];
    const items: { refId: number; state: string; outcome: any }[] = ids.length ? await client.workItem.findMany({
      where: { type: 'reupload_doc', refType: 'document', refId: { in: ids } },
      select: { refId: true, state: true, outcome: true },
    }) : [];
    const queued: { refId: number }[] = ids.length ? await client.domainEvent.findMany({
      where: { type: 'document.file_missing', processedAt: null, refType: 'document', refId: { in: ids } },
      select: { refId: true },
    }) : [];
    const item = new Map(items.map((w) => [w.refId, w]));
    const waiting = new Set(queued.map((e) => e.refId));
    const fresh = lost.filter((d) => {
      if (waiting.has(d.id)) return false;
      const w = item.get(d.id);
      return !w || (w.state === 'done' && w.outcome?.closedBy === 'event');
    }).slice(0, 200);
    if (fresh.length) {
      await client.domainEvent.createMany({
        data: fresh.map((d) => ({
          type: 'document.file_missing', patientId: d.patientId, visitId: d.visitId ?? null,
          refType: 'document', refId: d.id, payload: { title: d.title || d.fileName },
        })),
      });
    }
    const emitted = fresh.length;

    const open = await client.workItem.findMany({
      where: { type: 'reupload_doc', refType: 'document', state: { in: ['open', 'blocked'] } },
      select: { refId: true, patientId: true, visitId: true },
    });
    const healed = open.filter((w: any) => !lostIds.has(w.refId));
    if (healed.length) {
      await client.domainEvent.createMany({
        data: healed.map((w: any) => ({
          type: 'document.file_restored', patientId: w.patientId ?? null, visitId: w.visitId ?? null,
          refType: 'document', refId: w.refId, payload: { by: 'detector' },
        })),
      });
    }
    await client.setting.upsert({
      where: { key: FILES_MISSING_KEY },
      create: { key: FILES_MISSING_KEY, value: String(lost.length) },
      update: { value: String(lost.length) },
    });
    return { missing: lost.length, emitted, restored: healed.length };
  } catch (e) {
    if (missingTable(e)) return none;
    throw e;
  }
}
