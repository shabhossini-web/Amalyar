import {
  BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseIntPipe,
  Patch, Post, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  IsArray, IsBoolean, IsInt, IsObject, IsNotEmptyObject, IsOptional, IsString, MaxLength, MinLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { StorageService } from '../storage/storage.service';
import { SiteService } from './site.service';

const IMAGE_MIME = /^image\/(png|jpeg|webp|avif)$/;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

class BlocksDto {
  @IsObject({ message: 'بدنهٔ درخواست نامعتبر است' })
  @IsNotEmptyObject({}, { message: 'چیزی برای ذخیره نیست' })
  values!: Record<string, unknown>;
}
class SectionRowDto {
  @IsString() key!: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() sort?: number;
}
class PublishDto {
  @IsBoolean({ message: 'مقدارِ انتشار نامعتبر است' }) published!: boolean;
}
class SectionsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => SectionRowDto)
  sections!: SectionRowDto[];
}
class ItemCreateDto {
  @IsString({ message: 'نوعِ قلم لازم است' }) kind!: string;
  @IsString() @MinLength(1, { message: 'عنوان لازم است' }) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(200) subtitle?: string;
  @IsOptional() @IsString() @MaxLength(4000) body?: string;
  @IsOptional() @IsString() @MaxLength(40) icon?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() sort?: number;
}
class ItemPatchDto {
  @IsOptional() @IsString() @MinLength(1, { message: 'عنوان نمی‌تواند خالی باشد' }) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(200) subtitle?: string;
  @IsOptional() @IsString() @MaxLength(4000) body?: string;
  @IsOptional() @IsString() @MaxLength(40) icon?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() sort?: number;
}

/**
 * صفحهٔ عمومیِ شرکت — **بدونِ ورود**.
 *
 * ⚠️ عمداً کنترلرِ جدا و بی‌گارد، مثلِ `PublicSurveyController`. اگر با
 * مسیرهای ویرایش در یک کلاس بود، یک `@UseGuards` روی کلاس کافی بود تا صفحهٔ
 * معرفیِ شرکت پشتِ دیوارِ لاگین برود — و کسی تا شکایتِ مشتری نفهمد.
 *
 * tenant از **Host** حل می‌شود (قانونِ ۱۸)، پس هر دامنه سایتِ خودش را
 * می‌گیرد بی‌آنکه کلاینت چیزی دربارهٔ شرکت بفرستد.
 */
@Controller('public/site')
export class PublicSiteController {
  constructor(private site: SiteService, private storage: StorageService) {}

  @Get()
  view() {
    return this.site.publicView();
  }

  @Get('items/:id/image')
  image(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    return this.stream(id, 1, res);
  }

  @Get('items/:id/image2')
  image2(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    return this.stream(id, 2, res);
  }

  /**
   * ⚠️ **دیده‌شدنِ عمومی پیش از استریم سنجیده می‌شود.** قلمی که غیرفعال شده
   * یا بخشش خاموش است، تصویرش هم نباید از این مسیر بیرون برود؛ وگرنه
   * «خاموش‌کردن» فقط یعنی «از صفحه بردار»، نه «منتشر نکن».
   */
  private async stream(id: number, slot: 1 | 2, res: Response) {
    if (!(await this.site.isPubliclyVisible(id))) throw new NotFoundException('تصویری نیست');
    const img = await this.site.itemImage(id, slot);
    if (!img || !(await this.storage.exists(img.sha256))) throw new NotFoundException('تصویری نیست');
    res.setHeader('Content-Type', img.mime);
    /* عمومی است و می‌تواند کش شود، ولی نشانی به **شناسهٔ قلم** است نه به
       hash — پس عمرِ کوتاه تا ویرایشِ تصویر ساعت‌ها بعد دیده نشود. */
    res.setHeader('Cache-Control', 'public, max-age=300');
    this.storage.stream(img.sha256).pipe(res);
  }
}

/** ویرایشِ سایت — پشتِ هر سه گارد. */
@Controller('site')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('site')
export class SiteController {
  constructor(private site: SiteService, private storage: StorageService) {}

  @RequirePermissions('site.read')
  @Get()
  view() {
    return this.site.adminView();
  }

  @RequirePermissions('site.manage')
  @Patch('publish')
  publish(@Body() dto: PublishDto, @CurrentUser() user: any) {
    return this.site.setPublished(dto.published, user);
  }

  @RequirePermissions('site.manage')
  @Patch('blocks')
  saveBlocks(@Body() dto: BlocksDto, @CurrentUser() user: any) {
    return this.site.saveBlocks(dto.values, user);
  }

  @RequirePermissions('site.manage')
  @Patch('sections')
  saveSections(@Body() dto: SectionsDto, @CurrentUser() user: any) {
    return this.site.saveSections(dto.sections ?? [], user);
  }

  @RequirePermissions('site.manage')
  @Post('items')
  createItem(@Body() dto: ItemCreateDto, @CurrentUser() user: any) {
    return this.site.createItem(dto, user);
  }

  @RequirePermissions('site.manage')
  @Patch('items/:id')
  patchItem(@Param('id', ParseIntPipe) id: number, @Body() dto: ItemPatchDto, @CurrentUser() user: any) {
    return this.site.patchItem(id, dto, user);
  }

  @RequirePermissions('site.manage')
  @Delete('items/:id')
  removeItem(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.site.removeItem(id, user);
  }

  @RequirePermissions('site.manage')
  @Post('items/:id/image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  uploadImage(@Param('id', ParseIntPipe) id: number, @UploadedFile() file: any) {
    return this.upload(id, 1, file);
  }

  @RequirePermissions('site.manage')
  @Post('items/:id/image2')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  uploadImage2(@Param('id', ParseIntPipe) id: number, @UploadedFile() file: any) {
    return this.upload(id, 2, file);
  }

  private async upload(id: number, slot: 1 | 2, file: any) {
    if (!file?.buffer?.length) throw new BadRequestException('فایلی نرسید');
    if (!IMAGE_MIME.test(String(file.mimetype))) {
      throw new BadRequestException('تصویر باید PNG، JPEG، WebP یا AVIF باشد');
    }
    const { sha256 } = await this.storage.save(file.buffer);
    return this.site.setItemImage(id, slot, sha256, file.mimetype);
  }
}
