import {
  BadRequestException, Body, Controller, Delete, Get, NotFoundException, Patch, Post,
  Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { IsNotEmptyObject, IsObject } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LevelGuard } from '../auth/level.guard';
import { MinLevel } from '../auth/min-level.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { LEVEL } from '../common/levels';
import { StorageService } from '../storage/storage.service';
import { SettingsService } from './settings.service';

class SettingsPatchDto {
  /**
   * شکلِ آزاد است چون کلیدها در رجیستری‌اند نه در DTO — ولی **اعتبارسنجی
   * حذف نشده**، فقط جایش عوض شده: سرویس هر کلیدِ نااعلام را رد می‌کند و هر
   * مقدار را با نوعِ اعلام‌شده‌اش می‌سنجد.
   */
  @IsObject({ message: 'بدنهٔ درخواست نامعتبر است' })
  @IsNotEmptyObject({}, { message: 'چیزی برای ذخیره نیست' })
  values!: Record<string, unknown>;
}

/** سربرگ باید تصویر باشد — روی فاکتور و نامهٔ اداری به‌صورتِ پس‌زمینه چاپ می‌شود. */
const LETTERHEAD_MIME = /^image\/(png|jpeg|webp)$/;
const MAX_LETTERHEAD_BYTES = 4 * 1024 * 1024;

/** تنظیماتِ اختصاصیِ همین شرکت. */
@Controller('settings')
@UseGuards(JwtAuthGuard, LevelGuard)
export class SettingsController {
  constructor(
    private settings: SettingsService,
    private storage: StorageService,
  ) {}

  /// خواندن برای مدیر باز است: بیشترِ این‌ها روی اسنادِ چاپی دیده می‌شوند.
  @MinLevel(LEVEL.ADMIN)
  @Get()
  all() {
    return this.settings.all();
  }

  @MinLevel(LEVEL.SUPER_ADMIN)
  @Patch()
  update(@Body() dto: SettingsPatchDto, @CurrentUser() user: any) {
    return this.settings.update(dto.values, user);
  }

  // ── سربرگِ شرکت — تصویری که با آپلود پر می‌شود، نه با فرمِ متنی ──

  @MinLevel(LEVEL.SUPER_ADMIN)
  @Post('letterhead')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LETTERHEAD_BYTES } }))
  async uploadLetterhead(@UploadedFile() file: any, @CurrentUser() user: any) {
    if (!file?.buffer?.length) throw new BadRequestException('فایلی نرسید');
    if (!LETTERHEAD_MIME.test(String(file.mimetype))) {
      throw new BadRequestException('سربرگ باید تصویر باشد (PNG، JPEG یا WebP)');
    }
    const { sha256 } = await this.storage.save(file.buffer);
    await this.settings.update(
      { letterhead_sha: sha256, letterhead_mime: file.mimetype },
      user,
    );
    return { ok: true, sha256 };
  }

  /** خودِ تصویر — برای پیش‌نمایشِ تنظیمات و چاپِ فاکتور/نامه. */
  @MinLevel(LEVEL.ADMIN)
  @Get('letterhead')
  async letterhead(@Res() res: Response) {
    const lh = await this.settings.letterhead();
    if (!lh || !(await this.storage.exists(lh.sha256))) {
      throw new NotFoundException('سربرگی بارگذاری نشده');
    }
    res.setHeader('Content-Type', lh.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    this.storage.stream(lh.sha256).pipe(res);
  }

  @MinLevel(LEVEL.SUPER_ADMIN)
  @Delete('letterhead')
  async removeLetterhead(@CurrentUser() user: any) {
    const lh = await this.settings.letterhead();
    if (!lh) return { ok: true };
    await this.settings.update({ letterhead_sha: '', letterhead_mime: '' }, user);
    // Issued invoices retain their content-addressed letterhead. Removing the
    // current setting must not invalidate those historical documents.
    return { ok: true };
  }
}
