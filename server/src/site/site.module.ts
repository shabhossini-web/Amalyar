import { Module } from '@nestjs/common';
import { PublicSiteController, SiteController } from './site.controller';
import { SiteService } from './site.service';

/* Prisma، Audit، Storage و پیکربندی همگی `@Global` اند — importِ دوباره‌شان
   این‌جا فقط یک وابستگیِ حلقوی بالقوه اضافه می‌کرد. */
@Module({
  controllers: [PublicSiteController, SiteController],
  providers: [SiteService],
  exports: [SiteService],
})
export class SiteModule {}
