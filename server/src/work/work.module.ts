import { Module } from '@nestjs/common';
import { WorkController } from './work.controller';
import { WorkService } from './work.service';
import { EventsService } from './events.service';

/** لایهٔ کار (W2.1) — `docs/plan/CONTRACTS.md` §۱–۲. Prisma و Audit سراسری‌اند. */
@Module({
  controllers: [WorkController],
  providers: [WorkService, EventsService],
  exports: [WorkService, EventsService],
})
export class WorkModule {}
