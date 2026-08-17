import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ControlPrismaService } from '../tenant/control-prisma.service';
import { decryptDatabaseUrl } from '../tenant/tenant-crypto';
import { SmsService } from '../sms/sms.service';

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
      const due = await client.$queryRawUnsafe<{ id: number; phone: string | null; text: string }[]>(
        `SELECT id, phone, text FROM reminders
         WHERE status = 'pending' AND due_at <= now()
         ORDER BY due_at ASC LIMIT 25`,
      );
      if (!due.length) return;
      let sent = 0;
      for (const r of due) {
        const claimed = await client.$executeRawUnsafe(
          `UPDATE reminders SET status='sent', sent_at=now(), updated_at=now()
           WHERE id = ${Number(r.id)} AND status='pending'`,
        );
        if (!claimed) continue;
        try {
          if (!r.phone) throw new Error('شماره‌ای ثبت نشده');
          const res = await this.sms.send(r.phone, r.text);
          if (!res.sent && !res.stub) throw new Error('سرویسِ پیامک نپذیرفت');
          sent += 1;
        } catch (e) {
          await client.$executeRawUnsafe(
            `UPDATE reminders SET status='failed', error=$1, updated_at=now() WHERE id = ${Number(r.id)}`,
            String(e instanceof Error ? e.message : e).slice(0, 300),
          ).catch(() => undefined);
        }
      }
      this.log.log(`${slug}: ${sent}/${due.length} یادآوری فرستاده شد`);
    } catch (e: any) {
      // جدولِ reminders هنوز migrate نشده (شرکتِ عقب‌مانده) — sweep بعدی.
      const msg = String(e?.message ?? '');
      if (e?.meta?.code === '42P01' || /does not exist/i.test(msg)) return;
      throw e;
    } finally {
      await client.$disconnect().catch(() => undefined);
    }
  }
}
