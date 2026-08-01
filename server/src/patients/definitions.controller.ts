import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { DefinitionsService } from './definitions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';

/** جراح: هویت (نام/تلفن) به Person می‌رود، تخصص و نظام‌پزشکی روی خودِ نقش می‌مانَد. */
/** فیلدهای هویتیِ مشترک؛ جراح و (بعداً) کارشناس هر دو از این ارث می‌برند. */
class PersonFieldsDto {
  @IsOptional() @Matches(/^09\d{9}$|^$/, { message: 'شمارهٔ موبایل نامعتبر است' }) phone?: string;
  @IsOptional() @IsString() @MaxLength(20) nationalId?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(40) city?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(40) iban?: string;
  @IsOptional() @IsString() photo?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class SurgeonCreateDto extends PersonFieldsDto {
  @IsString({ message: 'نام را وارد کنید' })
  @MinLength(2, { message: 'نام کوتاه است' })
  @MaxLength(60)
  firstName!: string;

  @IsString({ message: 'نام خانوادگی را وارد کنید' })
  @MinLength(2, { message: 'نام خانوادگی کوتاه است' })
  @MaxLength(60)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  specialty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  licenseNo?: string;
}

class SurgeonPatchDto extends PersonFieldsDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) firstName?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) lastName?: string;
  @IsOptional() @IsString() @MaxLength(80) specialty?: string;
  @IsOptional() @IsString() @MaxLength(40) licenseNo?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** بیمارستان: سازمان است، پس Person ندارد — ولی پروفایلِ کامل دارد. */
class ProcedureCreateDto {
  @IsString({ message: 'عنوان را وارد کنید' })
  @MinLength(2, { message: 'عنوان کوتاه است' })
  @MaxLength(80)
  name!: string;

  @IsOptional() @IsString() @MaxLength(30) code?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class ProcedurePatchDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(30) code?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class DiagnosisCreateDto {
  @IsString({ message: 'عنوان را وارد کنید' })
  @MinLength(2, { message: 'عنوان کوتاه است' })
  @MaxLength(120)
  title!: string;

  @IsOptional() @IsString() @MaxLength(15) icdCode?: string;
}

class DiagnosisPatchDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(15) icdCode?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

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

/// نیروی حمل‌ونقل — راننده یا پیک. همان فیلدهای هویتیِ جراح + خودرو.
class StaffCreateDto extends PersonFieldsDto {
  @IsString({ message: 'نام را وارد کنید' }) @MinLength(2, { message: 'نام کوتاه است' }) @MaxLength(60)
  firstName!: string;

  @IsString({ message: 'نام خانوادگی را وارد کنید' }) @MinLength(2, { message: 'نام خانوادگی کوتاه است' }) @MaxLength(60)
  lastName!: string;

  @IsIn(['driver', 'courier'], { message: 'نقش باید راننده یا پیک باشد' })
  role!: string;

  @IsOptional() @IsString() @MaxLength(60) vehicle?: string;
}

class StaffPatchDto extends PersonFieldsDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) firstName?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) lastName?: string;
  @IsOptional() @IsIn(['driver', 'courier'], { message: 'نقش باید راننده یا پیک باشد' }) role?: string;
  @IsOptional() @IsString() @MaxLength(60) vehicle?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

// تعریف‌های ماژولِ بیماران (جراحان/بیمارستان‌ها/کارشناسان) — همان گاردِ dashboard

/** کالا — ست، پیچ، ایمپلنت، مصرفی. */
export class ItemCreateDto {
  @IsString() @MinLength(2, { message: 'نامِ کالا کوتاه است' }) @MaxLength(120)
  name!: string;

  @IsOptional() @IsString() @MaxLength(60) sku?: string;
  @IsOptional() @IsString() @MaxLength(40) irc?: string;
  @IsOptional() @IsString() @MaxLength(60) brand?: string;
  @IsOptional() @IsString() @MaxLength(60) size?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
  /// consumable | set | device — «برگشتی» بودن اینجا تعیین می‌شود.
  @IsOptional() @IsIn(['consumable', 'set', 'device'], { message: 'نوعِ کالا نامعتبر است' })
  assetKind?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0, { message: 'ساعتِ آماده‌سازی نمی‌تواند منفی باشد' })
  turnaroundHours?: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  // به‌شکلِ رشته هم پذیرفته می‌شود چون کاربر با جداکنندهٔ هزارگان تایپ می‌کند.
  @IsOptional() price?: string | number;
}

export class ItemPatchDto extends ItemCreateDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  declare name: string;

  @IsOptional() @IsBoolean() active?: boolean;
}

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

  @RequirePermissions('definitions.read')
  @Get('procedure-types')
  procedureTypes() {
    return this.defs.listProcedureTypes();
  }

  @RequirePermissions('definitions.manage')
  @Post('procedure-types')
  addProcedureType(@Body() dto: ProcedureCreateDto) {
    return this.defs.createProcedureType(dto);
  }

  @RequirePermissions('definitions.manage')
  @Patch('procedure-types/:id')
  patchProcedureType(@Param('id', ParseIntPipe) id: number, @Body() dto: ProcedurePatchDto) {
    return this.defs.updateProcedureType(id, dto);
  }

  @RequirePermissions('definitions.manage')
  @Delete('procedure-types/:id')
  delProcedureType(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteProcedureType(id);
  }

  @RequirePermissions('definitions.read')
  @Get('items')
  items(@Query('q') q?: string) {
    return this.defs.listItems(q);
  }

  @RequirePermissions('definitions.manage')
  @Post('items')
  addItem(@Body() dto: ItemCreateDto) {
    return this.defs.createItem(dto);
  }

  @RequirePermissions('definitions.manage')
  @Patch('items/:id')
  patchItem(@Param('id', ParseIntPipe) id: number, @Body() dto: ItemPatchDto) {
    return this.defs.updateItem(id, dto);
  }

  @RequirePermissions('definitions.manage')
  @Delete('items/:id')
  delItem(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteItem(id);
  }

  @RequirePermissions('definitions.read')
  @Get('diagnoses')
  diagnoses() {
    return this.defs.listDiagnoses();
  }

  @RequirePermissions('definitions.manage')
  @Post('diagnoses')
  addDiagnosis(@Body() dto: DiagnosisCreateDto) {
    return this.defs.createDiagnosis(dto);
  }

  @RequirePermissions('definitions.manage')
  @Patch('diagnoses/:id')
  patchDiagnosis(@Param('id', ParseIntPipe) id: number, @Body() dto: DiagnosisPatchDto) {
    return this.defs.updateDiagnosis(id, dto);
  }

  @RequirePermissions('definitions.manage')
  @Delete('diagnoses/:id')
  delDiagnosis(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteDiagnosis(id);
  }

  /// کارشناسانِ قابلِ‌انتساب — حساب‌های فعالِ سطح ۲..۴
  @RequirePermissions('definitions.read')
  @Get('techs')
  techs() {
    return this.defs.listTechs();
  }

  // ── نیروی حمل‌ونقل ────────────────────────────────────────────
  @RequirePermissions('definitions.read')
  @Get('transport-staff')
  staff() {
    return this.defs.listTransportStaff();
  }

  @RequirePermissions('definitions.manage')
  @Post('transport-staff')
  createStaff(@Body() dto: StaffCreateDto) {
    return this.defs.createTransportStaff(dto);
  }

  @RequirePermissions('definitions.manage')
  @Patch('transport-staff/:id')
  updateStaff(@Param('id', ParseIntPipe) id: number, @Body() dto: StaffPatchDto) {
    return this.defs.updateTransportStaff(id, dto);
  }

  @RequirePermissions('definitions.manage')
  @Delete('transport-staff/:id')
  deleteStaff(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteTransportStaff(id);
  }
}
