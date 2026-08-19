import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { TenantConfigModule } from '../config/config.module';
import { PatientsModule } from '../patients/patients.module';

@Module({
  imports: [TenantConfigModule, PatientsModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
