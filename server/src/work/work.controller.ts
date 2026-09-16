import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { Feature } from '../auth/feature.decorator';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { WorkService, type WorkAction, type WorkScope } from './work.service';

class CreateWorkDto {
  @IsString() @MaxLength(160) title!: string;
  @IsOptional() @IsString() @MaxLength(40) type?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsInt() @Min(1) patientId?: number;
  @IsOptional() @IsInt() @Min(1) visitId?: number;
  @IsOptional() @IsInt() @Min(1) appointmentId?: number;
  @IsOptional() @IsString() @MaxLength(20) ownerRole?: string;
  @IsOptional() @IsInt() @Min(1) ownerAccountId?: number;
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @IsInt() @Min(0) @Max(3) priority?: number;
}

class PatchWorkDto {
  @IsIn(['done', 'block', 'assign', 'snooze', 'cancel', 'reopen']) action!: WorkAction;
  @IsOptional() outcome?: any;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @IsOptional() @IsInt() @Min(1) accountId?: number;
  @IsOptional() @IsDateString() until?: string;
}

const SCOPES: WorkScope[] = ['inbox', 'mine', 'role', 'patient', 'all'];

@Controller('work')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('work')
export class WorkController {
  constructor(private work: WorkService) {}

  @Get() @RequirePermissions('work.read')
  list(
    @CurrentUser() user: any,
    @Query('scope') scope?: string,
    @Query('patientId') patientId?: string,
    @Query('state') state?: string,
    @Query('type') type?: string,
    @Query('due') due?: string,
    @Query('limit') limit?: string,
  ) {
    return this.work.list(user, {
      scope: SCOPES.includes(scope as WorkScope) ? (scope as WorkScope) : 'inbox',
      patientId: patientId ? Number(patientId) : undefined,
      state: state || undefined,
      type: type || undefined,
      due: due || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('counts') @RequirePermissions('work.read')
  counts(@CurrentUser() user: any) { return this.work.counts(user); }

  @Post() @RequirePermissions('work.write')
  create(@Body() dto: CreateWorkDto, @CurrentUser() user: any) { return this.work.create(user, dto); }

  @Patch(':id') @RequirePermissions('work.write')
  act(@Param('id', ParseIntPipe) id: number, @Body() dto: PatchWorkDto, @CurrentUser() user: any) {
    return this.work.act(user, id, dto.action, dto);
  }

  /** فقط آزمون/عیب‌یابی — worker همین را خودکار می‌زند. */
  @Post('process') @RequirePermissions('work.process')
  process(@CurrentUser() user: any) { return this.work.process(user); }
}
