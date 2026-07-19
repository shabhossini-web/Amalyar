import { Module } from '@nestjs/common';
import { FeaturesController } from './features.controller';
import { FeaturesService } from './features.service';
import { LevelGuard } from '../auth/level.guard';

@Module({
  controllers: [FeaturesController],
  providers: [FeaturesService, LevelGuard],
})
export class FeaturesModule {}
