import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsInt, IsString, MaxLength, Min, ValidateIf } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { Feature } from '../auth/feature.decorator';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { HospitalDutiesService } from './hospital-duties.service';
class DutyDto {
  @IsString() @MaxLength(10) date!: string;
  @IsInt() @Min(1) hospitalId!: number;
  @IsInt() @Min(1) techId!: number;
  @IsString() @MaxLength(8) arriveTime!: string;
}
class AssignDto { @ValidateIf((_o, value) => value !== null) @IsInt() @Min(1) techId!: number | null; }
class DayDto { @IsString() @MaxLength(10) date!: string; }
@Controller('dispatch/roster')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('dispatch')
export class HospitalDutiesController {
  constructor(private duties: HospitalDutiesService) {}
  @Get() @RequirePermissions('patients.read', 'patients.read_all')
  day(@Query('date') date: string) { return this.duties.day(date); }
  @Post() @RequirePermissions('patients.update', 'patients.read_all')
  save(@Body() dto: DutyDto, @CurrentUser() user: any) { return this.duties.save(dto, user); }
  @Delete(':id') @RequirePermissions('patients.update', 'patients.read_all')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) { return this.duties.remove(id, user); }
  @Patch('visits/:id') @RequirePermissions('patients.update', 'patients.read_all')
  assign(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignDto, @CurrentUser() user: any) { return this.duties.assign(id, dto.techId ?? null, user); }
  @Get('preview') @RequirePermissions('patients.read', 'patients.read_all')
  preview(@Query('date') date: string) { return this.duties.preview(date); }
  @Post('send') @RequirePermissions('patients.update', 'patients.read_all')
  send(@Body() dto: DayDto, @CurrentUser() user: any) { return this.duties.sendDay(dto.date, user); }
}
