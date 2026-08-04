import {
  Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { IntakeService } from './intake.service';

class RegisterDto {
  @IsString() @MinLength(2, { message: 'نام را کامل وارد کنید' }) @MaxLength(80) firstName!: string;
  @IsString() @MinLength(2, { message: 'نامِ خانوادگی را کامل وارد کنید' }) @MaxLength(80) lastName!: string;
  @IsString() @MaxLength(15) nationalId!: string;
  @IsString() @MaxLength(20) phone!: string;
  @IsOptional() @IsString() @MaxLength(12) birthDate?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  /// کپچا: دو عددی که به بیمار نشان داده شد، به‌علاوهٔ پاسخش.
  @Type(() => Number) @IsInt() captchaA!: number;
  @Type(() => Number) @IsInt() captchaB!: number;
  @Type(() => Number) @IsInt() captchaAnswer!: number;
}

class FillDto {
  @IsOptional() @IsString() @MaxLength(200) procedure?: string;
  @IsOptional() @IsString() @MaxLength(100) surgeonName?: string;
  @IsOptional() @IsString() @MaxLength(150) hospitalName?: string;
  @IsOptional() @IsString() @MaxLength(12) opDate?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class DiscountApplyDto {
  @IsString() @MinLength(3) @MaxLength(40) code!: string;
}

class CodeCreateDto {
  @IsString() @MinLength(3, { message: 'کد را کامل وارد کنید' }) @MaxLength(40) code!: string;
  @IsOptional() @IsString() kind?: string;
  @Type(() => Number) @IsInt() @Min(1) value!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxAmount?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minAmount?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxUses?: number;
  @IsOptional() @IsString() @MaxLength(30) expiresAt?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

class CodePatchDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

class LinkCreateDto {
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) amount?: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

class LinkPatchDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) title?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) amount?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

class ApproveDto {
  @IsOptional() @Type(() => Number) @IsInt() surgeonId?: number;
  @IsOptional() @Type(() => Number) @IsInt() hospitalId?: number;
  @IsOptional() @Type(() => Number) @IsInt() techId?: number;
  @IsOptional() @Type(() => Number) @IsInt() procedureTypeId?: number;
  @IsOptional() @IsString() @MaxLength(12) opDate?: string;
  @IsOptional() @IsString() @MaxLength(5) opStartTime?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  /// ⚠️ باید در DTO باشند وگرنه ValidationPipe با whitelist بی‌صدا دورشان می‌ریزد.
  @IsOptional() @IsBoolean() registerPayment?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() bankAccountId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) paidAmount?: number;
}

class NoteDto {
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

/**
 * مسیرهای **عمومیِ** فرمِ بیمار — بدونِ ورود.
 *
 * ⚠️ کنترلرِ جدا و نه یک متدِ بی‌گارد داخلِ کنترلرِ ادمین: مسیرِ عمومی باید از
 * خودِ فایل پیدا باشد. متدِ بی‌گارد میانِ بیست متدِ محافظت‌شده چیزی است که در
 * بازبینی از چشم می‌افتد، و این‌جا نشانی‌ای است که هر کسی می‌تواند صدا بزند.
 *
 * ⚠️ هیچ‌کدام از این‌ها دادهٔ پرونده برنمی‌گردانند — فقط همان چیزی که خودِ
 * صاحبِ فرم پر کرده. توکنِ فرم در پیامک می‌رود و پیامک فوروارد می‌شود.
 */
@Controller('public/intake')
export class PublicIntakeController {
  constructor(private intake: IntakeService) {}

  @Get('link/:token')
  link(@Param('token') token: string) {
    return this.intake.publicLink(token);
  }

  @Post('link/:token/register')
  register(@Param('token') token: string, @Body() dto: RegisterDto) {
    return this.intake.register(token, dto);
  }

  @Get('form/:token')
  view(@Param('token') token: string) {
    return this.intake.publicView(token);
  }

  @Post('form/:token/fill')
  fill(@Param('token') token: string, @Body() dto: FillDto) {
    return this.intake.fill(token, dto);
  }

  /**
   * اعمالِ کدِ تخفیف.
   *
   * ⚠️ فقط **کد** فرستاده می‌شود، نه مبلغ. اگر مبلغ از کلاینت می‌آمد، هر کسی
   * با یک درخواستِ دستی صفر تومان می‌پرداخت.
   */
  @Post('form/:token/discount')
  discount(@Param('token') token: string, @Body() dto: DiscountApplyDto) {
    return this.intake.applyDiscount(token, dto.code);
  }

  @Post('form/:token/receipt')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  receipt(@Param('token') token: string, @UploadedFile() file: any) {
    return this.intake.attachReceipt(token, file);
  }
}

/** صفِ تأیید و مدیریتِ لینک‌ها — ماژولِ `formgen`. */
@Controller('intake')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('formgen')
export class IntakeController {
  constructor(private intake: IntakeService) {}

  @RequirePermissions('intake.read')
  @Get('links')
  links() {
    return this.intake.listLinks();
  }

  @RequirePermissions('intake.manage')
  @Post('links')
  addLink(@Body() dto: LinkCreateDto, @CurrentUser() user: any) {
    return this.intake.createLink(dto, user);
  }

  @RequirePermissions('intake.manage')
  @Patch('links/:id')
  patchLink(@Param('id', ParseIntPipe) id: number, @Body() dto: LinkPatchDto, @CurrentUser() user: any) {
    return this.intake.patchLink(id, dto, user);
  }

  @RequirePermissions('intake.read')
  @Get('codes')
  codes() {
    return this.intake.listCodes();
  }

  @RequirePermissions('intake.manage')
  @Post('codes')
  addCode(@Body() dto: CodeCreateDto, @CurrentUser() user: any) {
    return this.intake.createCode(dto, user);
  }

  @RequirePermissions('intake.manage')
  @Patch('codes/:id')
  patchCode(@Param('id', ParseIntPipe) id: number, @Body() dto: CodePatchDto, @CurrentUser() user: any) {
    return this.intake.patchCode(id, dto, user);
  }

  @RequirePermissions('intake.read')
  @Get('submissions')
  submissions(@Query('status') status?: string) {
    return this.intake.list(status);
  }

  @RequirePermissions('intake.review')
  @Post('submissions/:id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @Body() dto: ApproveDto, @CurrentUser() user: any) {
    return this.intake.approve(id, dto, user);
  }

  @RequirePermissions('intake.review')
  @Post('submissions/:id/reject')
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: NoteDto, @CurrentUser() user: any) {
    return this.intake.reject(id, dto, user);
  }

  @RequirePermissions('intake.review')
  @Post('submissions/:id/return')
  returnForFix(@Param('id', ParseIntPipe) id: number, @Body() dto: NoteDto, @CurrentUser() user: any) {
    return this.intake.returnForFix(id, dto, user);
  }
}
