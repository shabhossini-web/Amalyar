import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { DefinitionsService } from './definitions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';

/** جراح: هویت (نام/تلفن) به Person می‌رود، تخصص و نظام‌پزشکی روی خودِ نقش می‌مانَد. */
class SurgeonCreateDto {
  @IsString({ message: 'نام را وارد کنید' })
  @MinLength(2, { message: 'نام کوتاه است' })
  @MaxLength(60)
  firstName!: string;

  @IsString({ message: 'نام خانوادگی را وارد کنید' })
  @MinLength(2, { message: 'نام خانوادگی کوتاه است' })
  @MaxLength(60)
  lastName!: string;

  @IsOptional()
  @Matches(/^09\d{9}$/, { message: 'شمارهٔ موبایل نامعتبر است' })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  specialty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  licenseNo?: string;
}

class SurgeonPatchDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) firstName?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) lastName?: string;

  @IsOptional()
  @Matches(/^09\d{9}$|^$/, { message: 'شمارهٔ موبایل نامعتبر است' })
  phone?: string;

  @IsOptional() @IsString() @MaxLength(80) specialty?: string;
  @IsOptional() @IsString() @MaxLength(40) licenseNo?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** بیمارستان: سازمان است، پس Person ندارد — ولی پروفایلِ کامل دارد. */
class HospitalCreateDto {
  @IsString({ message: 'نام را وارد کنید' })
  @MinLength(2, { message: 'نام کوتاه است' })
  @MaxLength(80, { message: 'نام طولانی است' })
  name!: string;

  @IsOptional() @IsString() @MaxLength(40) city?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(60) contactName?: string;
  @IsOptional() @IsString() @MaxLength(20) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class HospitalPatchDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(40) city?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(60) contactName?: string;
  @IsOptional() @IsString() @MaxLength(20) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

// تعریف‌های ماژولِ بیماران (جراحان/بیمارستان‌ها/کارشناسان) — همان گاردِ dashboard
@Controller()
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('dashboard')
export class DefinitionsController {
  constructor(private defs: DefinitionsService) {}

  @RequirePermissions('definitions.read')
  @Get('surgeons')
  surgeons() {
    return this.defs.listSurgeons();
  }

  @RequirePermissions('definitions.manage')
  @Post('surgeons')
  addSurgeon(@Body() dto: SurgeonCreateDto) {
    return this.defs.createSurgeon(dto);
  }

  @RequirePermissions('definitions.manage')
  @Patch('surgeons/:id')
  patchSurgeon(@Param('id', ParseIntPipe) id: number, @Body() dto: SurgeonPatchDto) {
    return this.defs.updateSurgeon(id, dto);
  }

  @RequirePermissions('definitions.manage')
  @Delete('surgeons/:id')
  delSurgeon(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteSurgeon(id);
  }

  @RequirePermissions('definitions.read')
  @Get('hospitals')
  hospitals() {
    return this.defs.listHospitals();
  }

  @RequirePermissions('definitions.manage')
  @Post('hospitals')
  addHospital(@Body() dto: HospitalCreateDto) {
    return this.defs.createHospital(dto);
  }

  @RequirePermissions('definitions.manage')
  @Patch('hospitals/:id')
  patchHospital(@Param('id', ParseIntPipe) id: number, @Body() dto: HospitalPatchDto) {
    return this.defs.updateHospital(id, dto);
  }

  @RequirePermissions('definitions.manage')
  @Delete('hospitals/:id')
  delHospital(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteHospital(id);
  }

  /// کارشناسانِ قابلِ‌انتساب — حساب‌های فعالِ سطح ۲..۴
  @RequirePermissions('definitions.read')
  @Get('techs')
  techs() {
    return this.defs.listTechs();
  }
}
