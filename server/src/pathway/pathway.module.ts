import { Module } from '@nestjs/common';
import { PathwayController } from './pathway.controller';
import { PathwayService } from './pathway.service';
import { AuditModule } from '../audit/audit.module';
import { WorkModule } from '../work/work.module';

@Module({
  imports: [AuditModule, WorkModule],
  controllers: [PathwayController],
  providers: [PathwayService],
  exports: [PathwayService],
})
export class PathwayModule {}
