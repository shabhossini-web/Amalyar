import { Module } from '@nestjs/common';
import { FeaturesController } from './features.controller';
import { FeaturesService } from './features.service';
import { LevelGuard } from '../auth/level.guard';

@Module({
  controllers: [FeaturesController],
  providers: [FeaturesService, LevelGuard],
  /* صفحهٔ «امروز» (W2.3) بخش‌هایش را با همین `forUser` گیت می‌کند — نه با محاسبهٔ دوبارهٔ سطح. */
  exports: [FeaturesService],
})
export class FeaturesModule {}
