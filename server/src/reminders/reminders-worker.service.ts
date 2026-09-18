import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ControlPrismaService } from '../tenant/control-prisma.service';
import { decryptDatabaseUrl } from '../tenant/tenant-crypto';
import { SmsService } from '../sms/sms.service';
import { sendReminders } from './send-reminders';
import { expireProvisional } from '../accounts/provisional';
import { processDomainEvents } from '../work/work-processor';
import { detectStaleWork } from '../work/work-detectors';
import { repairRun } from '../patients/repair-core';

/**
 * workerِ یادآوری‌ها — هر چند دقیقه، pendingهای سررسیدهٔ **همهٔ شرکت‌ها**.
 *
 * ⚠️ چرا این‌جا و نه داخلِ RemindersServiceِ ماژولِ بیماران: آن سرویس
 * tenant-scoped است و بیرونِ درخواست، شرکتی ندارد. این‌جا مثلِ
 * TenantMigratorService از دیتابیسِ کنترل فهرستِ شرکت‌ها گرفته می‌شود و
 * برای هر کدام یک کلاینتِ کوتاه‌عمر باز می‌شود.
 *
 * ⚠️ **ادعای اتمی** با `UPDATE … WHERE status='pending'`: دو نمونهٔ سرویس
 * (دیپلویِ چرخشی) نمی‌توانند یک یادآوری را دوبار بفرستند — هر ردیف را فقط
 * یکی صاحب می‌شود.
 *
 * خاموش‌کردن: REMINDERS_DISABLED=1 (محیطِ آزمون/CI که پیامک معنا ندارد).
 *
 * ⚠️ **ترمیمِ دادهٔ تاریخی (W1.10) هم همین‌جا می‌دود، یک‌بار در هر پروسه.**
 * نسخهٔ اولِ W1.10 فقط یک endpointِ دستی داشت و نتیجه‌اش این شد که هیچ‌کس
 * اجرایش نکرد: ابزار ساخته شد و ردیف‌های خراب سرِ جایشان ماندند. ابزاری که
 * به یادِ کسی بند باشد اجرا نمی‌شود.
 *
 * چرا **یک‌بار در هر پروسه** و نه هر sweep: اسکن روی هر شرکت چند کوئریِ
 * `findMany` است و بعد از اولین پاس چیزی پیدا نمی‌کند — تکرارش هر پنج دقیقه
 * تا ابد بارِ بی‌دلیل است. با هر دیپلوی/ری‌استارت دوباره می‌دود که همان‌هم
 * مطلوب است (idempotent است و هر چیزی که تازه لغزیده باشد را می‌گیرد).
 * خاموش‌کردن: REPAIR_DISABLED=1.
 */
@Injectable()
export class RemindersWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('RemindersWorker');
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** شرکت‌هایی که ترمیمشان در همین پروسه یک‌بار دویده. */
  private repaired = new Set<string>();

  constructor(private control: ControlPrismaService, private sms: SmsService) {}

  onModuleInit() {
    if (process.env.REMINDERS_DISABLED === '1') {
      this.log.log('workerِ یادآوری خاموش است (REMINDERS_DISABLED=1)');
      return;
    }
    const every = Math.max(60_000, parseInt(process.env.REMINDERS_INTERVAL_MS || '300000', 10) || 300_000);
    this.timer = setInterval(() => { this.sweepAll().catch(() => undefined); }, every);
    /* ⚠️ unref: تایمر نباید جلوی خاموشیِ تمیزِ پروسه را بگیرد. */
    (this.timer as any).unref?.();
    this.log.log(`workerِ یادآوری هر ${Math.round(every / 60000)} دقیقه sweep می‌کند`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweepAll() {
    if (this.running) return; // sweep قبلی هنوز تمام نشده — روی هم سوار نشوند
    this.running = true;
    try {
      const tenants = await this.control.tenant.findMany({
        where: { status: 'active' },
        select: { slug: true, databaseUrlEncrypted: true },
      });
      for (const t of tenants) {
        try {
          await this.sweepTenant(decryptDatabaseUrl(t.databaseUrlEncrypted), t.slug);
        } catch (e) {
          this.log.error(`sweep(${t.slug}) شکست خورد: ${e instanceof Error ? e.message : e}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async sweepTenant(url: string, slug: string) {
    const client = new PrismaClient({ datasources: { db: { url } }, log: [] });
    try {
      await expireProvisional(client);
      const result = await sendReminders(client, this.sms);
      if (result.due) this.log.log(`${slug}: ${result.sent}/${result.due} یادآوری فرستاده شد`);
      /* لایهٔ کار (W2.1): رویدادهای پردازش‌نشده ← کار. همان sweep، همان client. */
      /* W2.2: حالت‌های بیات (عملِ بی‌وضعیت، گزارشِ نیامده، مصرفِ تأییدنشده، فرمِ بی‌پاسخ) ← رویداد. */
      await detectStaleWork(client);
      const work = await processDomainEvents(client);
      if (work.events) this.log.log(`${slug}: ${work.events} رویداد ← ${work.created} کارِ تازه، ${work.closed} بسته`);
      await this.repairOnce(client, slug);
    } catch (e: any) {
      // جدولِ reminders هنوز migrate نشده (شرکتِ عقب‌مانده) — sweep بعدی.
      const msg = String(e?.message ?? '');
      if (['P2021', 'P2022'].includes(e?.code) || e?.meta?.code === '42P01' || /does not exist/i.test(msg)) return;
      throw e;
    } finally {
      await client.$disconnect().catch(() => undefined);
    }
  }

  /**
   * ترمیمِ دادهٔ ناقصِ تاریخی (W1.10) — یک‌بار در هر پروسه، به‌ازای هر شرکت.
   *
   * ⚠️ شکستش **sweep را نمی‌شکند**: یادآوری‌ها کارِ رو به جلو و حساس به زمان‌اند،
   * ترمیمِ داده‌ٔ گذشته نیست. خطا لاگ می‌شود و شرکت علامت می‌خورد تا در همین
   * پروسه دوباره تلاش نشود (وگرنه یک شرکتِ خراب هر sweep یک خطا می‌ریزد).
   *
   * ⚠️ **همیشه لاگ می‌کند وقتی چیزی کرد.** بدهیِ اصلی «اجرا نشد» بود؛ اگر
   * بی‌صدا اجرا شود، فقط جایش را با «اجرا شد و کسی نفهمید» عوض کرده‌ایم.
   */
  private async repairOnce(client: PrismaClient, slug: string) {
    if (process.env.REPAIR_DISABLED === '1' || this.repaired.has(slug)) return;
    this.repaired.add(slug);
    try {
      const res = await repairRun(client);
      if (res.repaired || res.queued) {
        this.log.log(`${slug}: ترمیمِ دادهٔ تاریخی — ${res.repaired} ردیف ترمیم شد، ${res.queued} به صفِ تطبیق رفت`);
      }
      if (res.failed.length) {
        this.log.warn(`${slug}: ${res.failed.length} ردیف خودکار ترمیم نشد و به صف رفت — ${res.failed[0].error}`);
      }
    } catch (e) {
      this.log.error(`ترمیمِ (${slug}) شکست خورد: ${e instanceof Error ? e.message : e}`);
    }
  }
}
