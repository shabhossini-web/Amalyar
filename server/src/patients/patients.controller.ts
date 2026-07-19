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
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateVisitDto, UpdateVisitDto, VisitStatusDto } from './dto/visit.dto';

// مدیریتِ بیماران/مراجعات — دسترسی داینامیک از جدولِ features (کلیدِ dashboard)
@Controller()
@UseGuards(JwtAuthGuard, FeatureGuard)
@Feature('dashboard')
export class PatientsController {
  constructor(private patients: PatientsService) {}

  @Get('visits')
  list(@Query('q') q?: string, @Query('status') status?: string) {
    return this.patients.listVisits(q, status);
  }

  @Get('visits/:id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.patients.getVisit(id);
  }

  @Post('visits')
  create(@Body() dto: CreateVisitDto, @CurrentUser() user: any) {
    return this.patients.createVisit(dto, user?.id);
  }

  @Patch('visits/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateVisitDto) {
    return this.patients.updateVisit(id, dto);
  }

  @Patch('visits/:id/status')
  setStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: VisitStatusDto) {
    return this.patients.setStatus(id, dto.opStatus);
  }

  @Delete('visits/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.patients.deleteVisit(id);
  }

  @Get('patients')
  searchPatients(@Query('q') q?: string) {
    return this.patients.searchPatients(q);
  }
}
