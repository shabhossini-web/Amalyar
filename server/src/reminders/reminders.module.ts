import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { SmsModule } from '../sms/sms.module';
import { RemindersWorkerService } from './reminders-worker.service';

/** workerِ سراسریِ یادآوری‌ها — جدا از ماژولِ بیماران چون tenant-scoped نیست. */
@Module({
  imports: [TenantModule, SmsModule],
  providers: [RemindersWorkerService],
})
export class RemindersModule {}
