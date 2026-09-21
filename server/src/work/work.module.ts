import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features/features.module';
import { WorkController } from './work.controller';
import { WorkService } from './work.service';
import { EventsService } from './events.service';
import { TodayService } from './today.service';

/** لایهٔ کار (W2.1) — `docs/plan/CONTRACTS.md` §۱–۲. Prisma و Audit سراسری‌اند. */
@Module({
  imports: [FeaturesModule],
  controllers: [WorkController],
  providers: [WorkService, EventsService, TodayService],
  exports: [WorkService, EventsService],
})
export class WorkModule {}
