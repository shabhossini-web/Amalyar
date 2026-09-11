import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { AccountsService } from './accounts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LevelGuard } from '../auth/level.guard';
import { MinLevel } from '../auth/min-level.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { LEVEL } from '../common/levels';
import { ApproveDto } from './dto/approve.dto';

/** همان فیلدهای هویتیِ جراح — تا شکلِ «شخص» همه‌جا یکی بماند. */
class JobRoleDto {
  /// `null` = برداشتنِ نقش. اعتبارسنجیِ مقدار در سرویس است تا پیامش فارسی باشد.
  @IsOptional() @IsString() jobRole?: string | null;
}

class StaffProfileDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) firstName?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) lastName?: string;
  @IsOptional() @Matches(/^09\d{9}$|^$/, { message: 'شمارهٔ موبایل نامعتبر است' }) phone?: string;
  @IsOptional() @IsString() @MaxLength(20) nationalId?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(40) city?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(40) iban?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  /** دستمزدِ کارشناس (تومان) — مالیِ سبک؛ قراردادِ کامل در ماژولِ حسابداری. */
  @IsOptional() @IsInt({ message: 'دستمزد باید عدد باشد' }) @Min(0) fee?: number;
}

class TestingModeDto { @IsBoolean() enabled!: boolean; }

class TemporaryAccountDto extends StaffProfileDto {
  @IsOptional() @IsBoolean() testAccount?: boolean;
  @IsInt() level!: number;
  @IsString() @MaxLength(30) jobRole!: string;
  @IsOptional() @Matches(/^[a-zA-Z0-9_.-]{3,40}$/, { message: 'نام کاربری ۳ تا ۴۰ حرف لاتین یا عدد باشد' }) username?: string;
}

// مدیریتِ کاربران — فقط سوپرادمین (سطح ۶)
@Controller('accounts')
@UseGuards(JwtAuthGuard, LevelGuard)
@MinLevel(LEVEL.SUPER_ADMIN)
export class AccountsController {
  constructor(private accounts: AccountsService) {}
  @Get('testing-mode')
  testingMode() { return this.accounts.testingMode(); }

  @Post('testing-mode')
  setTestingMode(@Body() dto: TestingModeDto, @CurrentUser() user: any) { return this.accounts.setTestingMode(dto.enabled, user.id); }

  @Post('temporary')
  temporary(@Body() dto: TemporaryAccountDto, @CurrentUser() user: any) { return this.accounts.createTemporary(dto, user.id); }

  @Post('technicians')
  createTechnician(@Body() dto: StaffProfileDto, @CurrentUser() user: any) {
    return this.accounts.createTechnician(dto, user.id);
  }

  @Get()
  list(@Query('status') status?: string) {
    return this.accounts.list(status);
  }

  @Get('pending')
  pending() {
    return this.accounts.list('pending');
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.accounts.get(id);
  }

  @Patch(':id')
  updateProfile(@Param('id', ParseIntPipe) id: number, @Body() dto: StaffProfileDto) {
    return this.accounts.updateProfile(id, dto);
  }

  @Post(':id/approve')
  approve(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveDto,
    @CurrentUser() user: any,
  ) {
    return this.accounts.approve(id, dto.level, user.id);
  }

  @Post(':id/reject')
  reject(@Param('id', ParseIntPipe) id: number) {
    return this.accounts.reject(id);
  }

  /** نقشِ شغلی — پزشک/منشی/… («هر کس قسمتِ خودش را پر کند»). */
  @Post(':id/job-role')
  setJobRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: JobRoleDto,
    @CurrentUser() user: any,
  ) {
    return this.accounts.setJobRole(id, dto.jobRole ?? null, user?.id);
  }

  @Post(':id/level')
  setLevel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveDto,
    @CurrentUser() user: any,
  ) {
    return this.accounts.setLevel(id, dto.level, user?.id);
  }
}
