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

class DefCreateDto {
  @IsString({ message: 'نام را وارد کنید' })
  @MinLength(2, { message: 'نام کوتاه است' })
  @MaxLength(80, { message: 'نام طولانی است' })
  name!: string;

  @IsOptional()
  @Matches(/^09\d{9}$/, { message: 'شمارهٔ موبایل نامعتبر است' })
  phone?: string;
}

class DefPatchDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'نام کوتاه است' })
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @Matches(/^09\d{9}$|^$/, { message: 'شمارهٔ موبایل نامعتبر است' })
  phone?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

// تعریف‌های ماژولِ بیماران (جراحان/بیمارستان‌ها/کارشناسان) — همان گاردِ dashboard
@Controller()
@UseGuards(JwtAuthGuard, FeatureGuard)
@Feature('dashboard')
export class DefinitionsController {
  constructor(private defs: DefinitionsService) {}

  @Get('surgeons')
  surgeons() {
    return this.defs.listSurgeons();
  }

  @Post('surgeons')
  addSurgeon(@Body() dto: DefCreateDto) {
    return this.defs.createSurgeon(dto);
  }

  @Patch('surgeons/:id')
  patchSurgeon(@Param('id', ParseIntPipe) id: number, @Body() dto: DefPatchDto) {
    return this.defs.updateSurgeon(id, dto);
  }

  @Delete('surgeons/:id')
  delSurgeon(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteSurgeon(id);
  }

  @Get('hospitals')
  hospitals() {
    return this.defs.listHospitals();
  }

  @Post('hospitals')
  addHospital(@Body() dto: DefCreateDto) {
    return this.defs.createHospital(dto.name);
  }

  @Patch('hospitals/:id')
  patchHospital(@Param('id', ParseIntPipe) id: number, @Body() dto: DefPatchDto) {
    return this.defs.updateHospital(id, dto);
  }

  @Delete('hospitals/:id')
  delHospital(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteHospital(id);
  }

  /// کارشناسانِ قابلِ‌انتساب — حساب‌های فعالِ سطح ۲..۴
  @Get('techs')
  techs() {
    return this.defs.listTechs();
  }
}
