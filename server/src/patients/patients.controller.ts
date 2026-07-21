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
  list(@Query('q') q?: string, @Query('status') status?: string) {
    return this.patients.listVisits(q, status);
  }

  @RequirePermissions('patients.read')
  @Get('visits/:id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.patients.getVisit(id);
  }

  @RequirePermissions('patients.create')
  @Post('visits')
  create(@Body() dto: CreateVisitDto, @CurrentUser() user: any) {
    return this.patients.createVisit(dto, user?.id);
  }

  @RequirePermissions('patients.update')
  @Patch('visits/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateVisitDto) {
    return this.patients.updateVisit(id, dto);
  }

  @RequirePermissions('patients.status')
  @Patch('visits/:id/status')
  setStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: VisitStatusDto) {
    return this.patients.setStatus(id, dto.opStatus);
  }

  @RequirePermissions('patients.delete')
  @Delete('visits/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.patients.deleteVisit(id);
  }

  @RequirePermissions('patients.read')
  @Get('patients')
  searchPatients(@Query('q') q?: string) {
    return this.patients.searchPatients(q);
  }
}
