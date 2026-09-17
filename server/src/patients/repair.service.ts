import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { syncLinkDocuments } from './link-documents';
import { OrdersService, ORDER_KINDS, type OrderKind } from './orders.service';
import { upsertWork } from '../work/work-processor';

/**
 * W1.10 — کشفِ دادهٔ ناقصِ **تاریخی** و صفِ تطبیق.
 *
 * هر بستهٔ قبلیِ این لِین جلوی تکرارِ یک باگ را گرفت ولی ردیف‌هایی را که
 * پیش از آن ساخته شده بودند دست نزد، و هر بار همان یک جمله در STATUS نوشته
 * شد: «ترمیمِ دادهٔ گذشته کارِ W1.10 است». این همان بسته است.
 *
 * ## قاعدهٔ مرکزی: ترمیم = دوباره‌دواندنِ **همان تابعِ رو به جلو**
 *
 * وسوسه این است که برای هر ایراد یک `UPDATE` دستی نوشته شود. غلط است: آن
 * کدِ دومْ روزی از مسیرِ اصلی واگرا می‌شود و آن‌وقت ترمیم خودش منبعِ خرابی
 * است. خوشبختانه هر سه تابعِ لازم از قبل **idempotent**اند و همین را ممکن
 * می‌کند:
 *
 * | ترمیم | تابع | چرا دوباره‌دواندنش بی‌خطر است |
 * |---|---|---|
 * | لینکِ فرم → مدرک | `syncLinkDocuments` | روی `externalUrl` هر بیمار dedupe می‌کند |
 * | پاسخِ سفارش → مدرک | `answerDocuments` | روی محتوای متن/لینک dedupe می‌کند |
 * | صفِ تطبیق | `upsertWork` | `idempotencyKey` یکتاست |
 *
 * ## دو حالتِ جدا، و مرزشان یک تصمیم است نه یک محدودیت
 *
 * - **ترمیم‌پذیر** — همهٔ داده‌ها هست و فقط عارضهٔ جانبی اجرا نشده. خودکار.
 * - **نیازمندِ آدم** — چیزی که باید حدس زده شود. اینها **هرگز** حدس زده
 *   نمی‌شوند؛ یک کار در صف می‌نشیند. حدسی که مثلِ واقعیت ذخیره شود بدتر از
 *   دادهٔ ناقص است، چون دیگر معلوم نیست حدس بوده.
 *
 * ⚠️ `scan()` هیچ‌چیز نمی‌نویسد. گزارشِ سلامت معیارِ تصمیم است و اگر خودش
 * تغییر بدهد، دیدنِ گزارش با اجرای ترمیم یکی می‌شود.
 */

/** یک ایرادِ پیداشده. `fix` می‌گوید خودکار درست می‌شود یا آدم می‌خواهد. */
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

const CHECK_FA: Record<string, string> = {
  form_links_missing: 'لینکِ فرم که مدرکِ پرونده نشد',
  order_answer_no_document: 'پاسخِ سفارش بدونِ مدرک',
  followup_unattributed: 'پاسخِ پیگیری بدونِ موعدِ مشخص',
};

/** فیلدهای `links` یک ثبت‌نام — اول اسنپ‌شاتِ لحظهٔ پاسخ (قرارداد §۷)، بعد فرمِ زنده. */
function linkFieldsOf(sub: any): { key: string; label: string; type: string; docCategory?: string | null }[] {
  const snap = Array.isArray(sub.schemaSnapshot) ? sub.schemaSnapshot : null;
  const live = sub.form?.fields ?? [];
  const rows = snap ?? live;
  return rows
    .filter((f: any) => f?.type === 'links' && f?.key)
    .map((f: any) => ({ key: f.key, label: f.label ?? f.key, type: 'links', docCategory: f.docCategory ?? null }));
}

@Injectable()
export class RepairService {
  constructor(private prisma: PrismaService, private audit: AuditService, private orders: OrdersService) {}

  /** فقط می‌خواند. خروجی مرتب است تا دو اجرای پشت‌سرهم قابلِ مقایسه باشد. */
  async scan(limit = 500): Promise<{ findings: Finding[]; counts: Record<string, number>; auto: number; queue: number }> {
    const findings: Finding[] = [
      ...(await this.formLinksMissing(limit)),
      ...(await this.orderAnswersWithoutDocument(limit)),
      ...(await this.followupsUnattributed(limit)),
    ];
    const counts: Record<string, number> = {};
    for (const f of findings) counts[f.check] = (counts[f.check] ?? 0) + 1;
    return {
      findings,
      counts,
      auto: findings.filter((f) => f.fix === 'auto').length,
      queue: findings.filter((f) => f.fix === 'queue').length,
    };
  }

  /**
   * ترمیم + صف. هر ردیف تراکنشِ خودش را دارد: یک ردیفِ خرابِ تاریخی نباید
   * ترمیمِ بقیه را به هم بزند (مثلاً لینکی که اصلاً URL معتبر نیست).
   */
  async run(actorId: number | null, limit = 500) {
    const { findings } = await this.scan(limit);
    const res = { repaired: 0, queued: 0, failed: [] as { id: number; check: string; error: string }[] };
    for (const f of findings) {
      try {
        if (f.fix === 'auto') {
          const made = await this.prisma.$transaction((tx: any) => this.repair(f, tx));
          if (made) res.repaired += 1;
        } else {
          await this.enqueue(f);
          res.queued += 1;
        }
      } catch (e: any) {
        /* ⚠️ بلعیده نمی‌شود: ردیفی که خودکار درست نشد به صف می‌رود تا آدم ببیندش،
           وگرنه «۰ خطا» گزارش می‌شد در حالی که چیزی ترمیم نشده بود. */
        res.failed.push({ id: f.id, check: f.check, error: String(e?.message ?? e).slice(0, 300) });
        await this.enqueue(f, String(e?.message ?? e).slice(0, 300)).catch(() => {});
        res.queued += 1;
      }
    }
    await this.audit.record({ actorId, action: 'repair.run', entityType: 'domain_event', entityId: 0, after: res });
    return res;
  }

  /* ── چک ۱: لینکِ فرم که مدرک نشد (W1.3/D03a) ───────────────────────── */

  /**
   * شاخهٔ `direct` در `fill()` ردیف را مستقیم `approved` می‌کرد و
   * `syncLinkDocuments` را صدا نمی‌زد، پس MRI یا جوابِ آزمایشی که بیمار در
   * باکسِ `links` گذاشته بود هرگز در تبِ مدارک دیده نمی‌شد. و برگشت‌پذیر هم
   * نبود: `approve()` فقط `pending_approval` می‌پذیرد.
   */
  private async formLinksMissing(limit: number): Promise<Finding[]> {
    const subs = await this.prisma.intakeSubmission.findMany({
      where: { status: 'approved', patientId: { not: null } },
      include: { form: { include: { fields: true } } },
      orderBy: { id: 'asc' },
      take: limit,
    });
    const out: Finding[] = [];
    for (const sub of subs) {
      const fields = linkFieldsOf(sub);
      if (!fields.length) continue;
      const urls = this.urlsIn(sub.data as any, fields);
      if (!urls.length) continue;
      const have = await this.prisma.document.findMany({
        where: { patientId: sub.patientId!, externalUrl: { in: urls }, deletedAt: null },
        select: { externalUrl: true },
      });
      const seen = new Set(have.map((d) => d.externalUrl));
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

  /** نشانی‌های معتبرِ داخلِ باکس‌های `links` — مقدارِ خراب ردیف را حذف نمی‌کند. */
  private urlsIn(data: Record<string, any>, fields: { key: string }[]): string[] {
    const out: string[] = [];
    for (const f of fields) {
      const raw = data?.[f.key];
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const item of list) {
        const text = typeof item === 'string' ? item : item?.url;
        if (typeof text !== 'string' || !text.trim()) continue;
        try { out.push(new URL(text.trim()).toString().slice(0, 2000)); } catch { /* بی‌اعتبار — چک ۱ ادعایش نمی‌کند */ }
      }
    }
    return [...new Set(out)];
  }

  /* ── چک ۲: پاسخِ سفارش بدونِ مدرک (W1.2، صریحاً به W1.10 حواله شده) ─── */

  /**
   * سفارش‌هایی که پیش از W1.2 پاسخ گرفتند: متن یا لینکِ جواب روی خودِ ردیف
   * هست ولی `Document`ی ندارند، پس در تبِ مدارکِ پرونده نیستند و مسیرِ
   * «بررسیِ نتیجه» چیزی برای نشان‌دادن ندارد.
   */
  private async orderAnswersWithoutDocument(limit: number): Promise<Finding[]> {
    const out: Finding[] = [];
    for (const kind of ORDER_KINDS) {
      const rows = await (this.prisma as any)[this.delegate(kind)].findMany({
        where: { status: { in: ['answered', 'in_review', 'reviewed'] } },
        orderBy: { id: 'asc' }, take: limit,
      });
      for (const row of rows) {
        const text = row.resultText ?? row.answerText ?? null;
        const link = row.resultLink ?? row.answerLink ?? null;
        if (!text && !link) continue;
        const docs = await this.prisma.document.findMany({
          where: { refType: `${kind}_order`, refId: row.id, patientId: row.patientId, deletedAt: null },
          select: { contentText: true, externalUrl: true },
        });
        const missing = (text && !docs.some((d) => d.contentText === text))
          || (link && !docs.some((d) => d.externalUrl === link));
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

  private delegate(kind: OrderKind) {
    return { lab: 'labOrder', imaging: 'imagingOrder', consult: 'consultOrder', referral: 'referralOrder' }[kind];
  }

  /* ── چک ۳: پاسخِ پیگیریِ بی‌موعد (W1.1/D01) — صف، نه ترمیم ─────────── */

  /**
   * W1.1 تطبیقِ پیگیری را به `data.followUpVisitId` بست. پاسخ‌هایی که پیش از
   * آن ثبت شده‌اند این کلید را ندارند، پس گزارشِ «پیگیری‌نشده‌ها» نمی‌داند به
   * کدام عمل بخورند.
   *
   * ⚠️ **عمداً ترمیمِ خودکار ندارد.** «نزدیک‌ترین عملِ پیش از پاسخ» حدسِ خوبی
   * است و `unfollowed()` برای **نمایش** همان را می‌کند — ولی نوشتنش در
   * `data` حدس را به واقعیت تبدیل می‌کند و دیگر معلوم نیست کدام کلید را بیمار
   * آورده و کدام را ما ساخته‌ایم. پس کار در صف می‌نشیند.
   */
  private async followupsUnattributed(limit: number): Promise<Finding[]> {
    const subs = await this.prisma.intakeSubmission.findMany({
      where: {
        status: 'approved', patientId: { not: null },
        form: { followUp: { not: null } },
      },
      include: { form: { select: { title: true } } },
      orderBy: { id: 'asc' }, take: limit,
    });
    return subs
      .filter((s) => (s.data as any)?.followUpVisitId == null)
      .map((s) => ({
        check: 'followup_unattributed', fix: 'queue' as const, entity: 'intake_submission', id: s.id,
        patientId: s.patientId, visitId: s.visitId,
        title: CHECK_FA.followup_unattributed,
        detail: `پاسخِ «${s.form?.title ?? 'پیگیری'}» به هیچ موعدی وصل نیست — کدام عمل را پیگیری می‌کند؟`,
      }));
  }

  /* ── ترمیم و صف ─────────────────────────────────────────────────────── */

  /** همان تابعِ رو به جلو، دوباره. برمی‌گرداند که چیزی ساخته شد یا نه. */
  private async repair(f: Finding, tx: any): Promise<boolean> {
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
      const row = await (tx as any)[this.delegate(kind)].findUnique({ where: { id: f.id } });
      if (!row) return false;
      return (await this.orders.repairAnswerDocuments(kind, row, tx)) > 0;
    }
    return false;
  }

  /** کارِ تطبیق. `idempotencyKey` از خودِ ایراد ساخته می‌شود، پس اسکنِ دوباره صف را دوبرابر نمی‌کند. */
  private enqueue(f: Finding, error?: string) {
    return upsertWork(this.prisma, {
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
}
