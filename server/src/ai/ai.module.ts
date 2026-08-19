import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { TenantConfigModule } from '../config/config.module';

@Module({
  imports: [TenantConfigModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
