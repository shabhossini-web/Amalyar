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
import { PatientsService } from './patients.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateVisitDto, UpdateVisitDto, VisitStatusDto } from './dto/visit.dto';

// مدیریتِ بیماران/مراجعات — دسترسی داینامیک از جدولِ features (کلیدِ dashboard)
@Controller()
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('dashboard')
export class PatientsController {
  constructor(private patients: PatientsService) {}

  @RequirePermissions('patients.read')
  @Get('visits')
  list(
    @CurrentUser() user: any,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
  ) {
    return this.patients.listVisits(q, status, user, kind);
  }

  @RequirePermissions('patients.read')
  @Get('visits/:id')
  get(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.patients.getVisit(id, user);
  }

  @RequirePermissions('patients.create')
  @Post('visits')
  create(@Body() dto: CreateVisitDto, @CurrentUser() user: any) {
    return this.patients.createVisit(dto, user);
  }

  @RequirePermissions('patients.update')
  @Patch('visits/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateVisitDto, @CurrentUser() user: any) {
    return this.patients.updateVisit(id, dto, user);
  }

  @RequirePermissions('patients.status')
  @Patch('visits/:id/status')
  setStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: VisitStatusDto, @CurrentUser() user: any) {
    return this.patients.setStatus(id, dto.opStatus, user);
  }

  @RequirePermissions('patients.delete')
  @Delete('visits/:id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.patients.deleteVisit(id, user);
  }

  @RequirePermissions('patients.read')
  @Get('patients')
  searchPatients(@CurrentUser() user: any, @Query('q') q?: string) {
    return this.patients.searchPatients(q, user);
  }
}
