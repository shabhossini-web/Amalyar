import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ControlPrismaService } from '../tenant/control-prisma.service';
import { decryptDatabaseUrl } from '../tenant/tenant-crypto';
import { SmsService } from '../sms/sms.service';
import { sendReminders } from './send-reminders';
import { expireProvisional } from '../accounts/provisional';
import { processDomainEvents } from '../work/work-processor';

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
 */
@Injectable()
export class RemindersWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('RemindersWorker');
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

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
      const work = await processDomainEvents(client);
      if (work.events) this.log.log(`${slug}: ${work.events} رویداد ← ${work.created} کارِ تازه، ${work.closed} بسته`);
    } catch (e: any) {
      // جدولِ reminders هنوز migrate نشده (شرکتِ عقب‌مانده) — sweep بعدی.
      const msg = String(e?.message ?? '');
      if (['P2021', 'P2022'].includes(e?.code) || e?.meta?.code === '42P01' || /does not exist/i.test(msg)) return;
      throw e;
    } finally {
      await client.$disconnect().catch(() => undefined);
    }
  }
}
