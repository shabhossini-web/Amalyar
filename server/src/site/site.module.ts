import { Module } from '@nestjs/common';
import { PublicSiteController, SiteController } from './site.controller';
import { SiteService } from './site.service';
import { SeoService } from './seo.service';

/* Prisma، Audit، Storage و پیکربندی همگی `@Global` اند — importِ دوباره‌شان
   این‌جا فقط یک وابستگیِ حلقوی بالقوه اضافه می‌کرد. */
@Module({
  controllers: [PublicSiteController, SiteController],
  providers: [SiteService, SeoService],
  exports: [SiteService, SeoService],
})
export class SiteModule {}
