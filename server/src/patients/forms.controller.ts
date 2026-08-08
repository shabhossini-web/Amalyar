import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { FormsService, FIELD_TYPES } from './forms.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { LevelGuard } from '../auth/level.guard';
import { MinLevel } from '../auth/min-level.decorator';
import { LEVEL } from '../common/levels';

class FormPatchDto {
  @IsOptional() @IsString() @MinLength(2, { message: 'عنوان کوتاه است' }) @MaxLength(80) title?: string;
  @IsOptional() @IsString() @MaxLength(200) hint?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

/**
 * ⚠️ `options` عمداً `any` است و در سرویس نرمال می‌شود: کاربر می‌تواند
 * چندخطی تایپ کند («yes=بله») یا کلاینت آرایه‌ی آماده بفرستد. تحمیلِ یک شکل در
 * DTO یعنی یا فرمِ ویرایش سخت‌تر می‌شود یا API بدقلق.
 */
class FieldCreateDto {
  @IsString() @MinLength(1) key!: string;
  @IsString() @MinLength(2, { message: 'برچسب کوتاه است' }) @MaxLength(80) label!: string;
  @IsOptional() @IsIn(FIELD_TYPES as unknown as string[], { message: 'نوعِ فیلد نامعتبر است' }) type?: string;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() options?: any;
  @IsOptional() @IsString() @MaxLength(160) hint?: string;
  @IsOptional() @IsString() @MaxLength(80) placeholder?: string;
}

class FieldPatchDto {
  @IsOptional() @IsString() @MinLength(2, { message: 'برچسب کوتاه است' }) @MaxLength(80) label?: string;
  @IsOptional() @IsIn(FIELD_TYPES as unknown as string[], { message: 'نوعِ فیلد نامعتبر است' }) type?: string;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() options?: any;
  @IsOptional() @IsString() @MaxLength(160) hint?: string;
  @IsOptional() @IsString() @MaxLength(80) placeholder?: string;
  @IsOptional() @IsInt() sort?: number;
}

class ReorderDto {
  @IsArray() ids!: number[];
}

/**
 * تعریفِ فرم‌ها.
 *
 * ⚠️ **خواندن و نوشتن دو سطحِ خیلی متفاوت دارند** و این عمدی است: هر کسی که
 * مراجعه ثبت می‌کند باید تعریفِ فرم را بخواند (وگرنه فرمی برای پرکردن ندارد)،
 * ولی عوض‌کردنش کارِ سوپرادمین است — یک فیلدِ اجباریِ تازه فوراً روی کارِ همه‌ی
 * کاربران اثر می‌گذارد.
 *
 * ⚠️ عمداً زیرِ `@Feature('dashboard')` نرفت. تعاریفِ پایه آن اشتباه را دارد و
 * نتیجه‌اش این است که کارشناسِ سطح ۲ نمی‌تواند تعریف را بخواند هرچند مجوزش را
 * دارد (کامنتِ `PlacesController` همین را توضیح می‌دهد). فرم را حتی کارشناس هم
 * باید بتواند بخواند.
 *
 * ⚠️ ترتیبِ اعلانِ مسیرها مهم است: `forms/visit-kinds` **قبل از** `forms/:key`
 * می‌آید، وگرنه `:key` آن را می‌بلعد و «visit-kinds» به‌عنوان کلیدِ فرم جستجو
 * می‌شود. Nest به ترتیبِ اعلان تطبیق می‌دهد، نه به اختصاصی‌بودن.
 */
@Controller()
@UseGuards(JwtAuthGuard, PermissionGuard)
export class FormsController {
  constructor(private forms: FormsService) {}

  @RequirePermissions('forms.read')
  @Get('forms')
  list() {
    return this.forms.list();
  }

  @RequirePermissions('forms.read')
  @Get('forms/visit-kinds')
  kinds() {
    return this.forms.visitKinds();
  }

  @RequirePermissions('forms.read')
  @Get('forms/:key')
  byKey(@Param('key') key: string) {
    return this.forms.byKey(key);
  }

  @RequirePermissions('forms.manage')
  @Patch('forms/:id')
  patch(@Param('id', ParseIntPipe) id: number, @Body() dto: FormPatchDto) {
    return this.forms.patchForm(id, dto);
  }

  @RequirePermissions('forms.manage')
  @Post('forms/:id/fields')
  addField(@Param('id', ParseIntPipe) id: number, @Body() dto: FieldCreateDto) {
    return this.forms.addField(id, dto);
  }

  @RequirePermissions('forms.manage')
  @Patch('forms/fields/:fieldId')
  patchField(@Param('fieldId', ParseIntPipe) fieldId: number, @Body() dto: FieldPatchDto) {
    return this.forms.patchField(fieldId, dto);
  }

  @RequirePermissions('forms.manage')
  @Delete('forms/fields/:fieldId')
  removeField(@Param('fieldId', ParseIntPipe) fieldId: number) {
    return this.forms.removeField(fieldId);
  }

  @RequirePermissions('forms.manage')
  @Post('forms/:id/reorder')
  reorder(@Param('id', ParseIntPipe) id: number, @Body() dto: ReorderDto) {
    return this.forms.reorder(id, dto.ids ?? []);
  }

  /**
   * بازگرداندن به قالبِ حوزه — **همه‌ی فرم‌ها را می‌ریزد و از نو می‌سازد.**
   *
   * ⚠️ برخلافِ بقیه‌ی نوشتن‌ها با `LevelGuard` و سطحِ سوپرادمین قفل شده، نه با
   * مجوزِ `forms.manage`: مجوزها را می‌شود به سطحِ پایین‌تر داد، و این عملیات
   * آن‌قدر ویرانگر هست که نباید با یک تنظیمِ اشتباهِ ماتریسِ دسترسی در دسترسِ
   * ادمینِ معمولی بیفتد.
   */
  @UseGuards(LevelGuard)
  @MinLevel(LEVEL.SUPER_ADMIN)
  @Post('forms/reset')
  reset(@Body() dto: { vertical?: string }) {
    return this.forms.resetToPreset(dto?.vertical);
  }
}
