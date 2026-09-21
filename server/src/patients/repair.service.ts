import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { repairRun, repairScan } from './repair-core';

/**
 * W1.10 — نمای HTTPِ کشف/ترمیمِ دادهٔ ناقصِ تاریخی.
 *
 * ⚠️ خودِ منطق این‌جا نیست: در `repair-core.ts` است، **خالص روی هر clientِ
 * Prisma**. دلیلش یک بدهیِ واقعی بود — نسخهٔ اول فقط همین endpointِ دستی را
 * داشت و نتیجه‌اش این شد که **هیچ‌کس اجرایش نکرد**. حالا `RemindersWorkerService`
 * هم همان هسته را می‌دواند، و آن worker نه Nest دارد نه DIِ tenant-scoped.
 *
 * این کلاس فقط دو چیز اضافه می‌کند که کارِ **درخواستِ HTTP** است و نه کارِ
 * هسته: `PrismaService`ِ tenant-scoped، و ثبتِ ممیزی با شناسهٔ کاربرِ واقعی.
 *
 * ⚠️ `scan` و `run` عمداً جدا می‌مانند: گزارشِ سلامت معیارِ تصمیم است و اگر
 * خودش بنویسد، «ببینم چه خبر است» با «درستش کن» یکی می‌شود.
 */
@Injectable()
export class RepairService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** فقط می‌خواند. */
  scan(limit = 500) {
    return repairScan(this.prisma, limit);
  }

  async run(actorId: number | null, limit = 500) {
    const res = await repairRun(this.prisma, limit);
    await this.audit.record({
      actorId, action: 'repair.run', entityType: 'domain_event', entityId: 0, after: res,
    });
    return res;
  }
}
