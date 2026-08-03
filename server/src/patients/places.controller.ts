import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { PlacesService } from './places.service';

/** محلِ تحویل — فقط یک نام؛ کلیدِ کانونی را سرور می‌سازد. */
class PlaceCreateDto {
  @IsString({ message: 'نامِ محل را وارد کنید' })
  @MinLength(2, { message: 'نامِ محل کوتاه است' })
  @MaxLength(60)
  name!: string;

  /// املاهای دیگر — بدونِ این، «سی اس آر» محلِ دوم می‌شود.
  @IsOptional() @IsArray() aliases?: string[];
}

class PlacePatchDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) name?: string;
  @IsOptional() @IsArray() aliases?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}

/**
 * محل‌های تحویل — کنترلرِ **جدا**، عمداً.
 *
 * ⚠️ اگر این مسیرها زیرِ `DefinitionsController` می‌ماندند، `@Feature('dashboard')`ِ
 * کلاس (سطح ۵) کارشناسِ سطح ۲ و رانندهٔ سطح ۲ را رد می‌کرد — یعنی چیپ‌های
 * فرمِ دقیقاً همان دو نفری که این فهرست برایشان است خالی می‌ماند. اولین
 * نسخه همان اشتباه را داشت.
 *
 * پس **خواندن** فقط ورود می‌خواهد (فهرستی از «CSR» و «اتاقِ عمل» راز نیست) و
 * **نوشتن** همان دروازهٔ صفحهٔ تعاریفِ پایه را: ماژولِ `dashboard` به‌علاوهٔ
 * مجوزِ `definitions.manage`. (کلیدِ ماژولِ جدا برای تعاریف نداریم و ساختنش
 * این‌جا یعنی یک ردیفِ تازه در ماتریسِ دسترسی که هیچ صفحه‌ای ازش استفاده
 * نمی‌کند.)
 */
@Controller('delivery-places')
export class PlacesController {
  constructor(private places: PlacesService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@Query('all') all?: string) {
    return this.places.list(all === '1');
  }

  @UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
  @Feature('dashboard')
  @RequirePermissions('definitions.manage')
  @Post()
  create(@Body() dto: PlaceCreateDto) {
    return this.places.create(dto);
  }

  @UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
  @Feature('dashboard')
  @RequirePermissions('definitions.manage')
  @Patch(':id')
  patch(@Param('id', ParseIntPipe) id: number, @Body() dto: PlacePatchDto) {
    return this.places.patch(id, dto);
  }

  @UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
  @Feature('dashboard')
  @RequirePermissions('definitions.manage')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.places.remove(id);
  }
}
