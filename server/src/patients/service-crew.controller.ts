import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_DOCUMENT_BYTES } from './record.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PatientsService } from './patients.service';
import { ServiceCrewService } from './service-crew.service';

/** فرمِ خدمتِ شرکتی: تیمِ کارشناسی با ساعت + دستگاهِ سرِ خدمت. دسترسی همان دسترسیِ مراجعه. */
@Controller('visits/:id/service')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('dashboard')
export class ServiceCrewController {
  constructor(private crew: ServiceCrewService, private patients: PatientsService) {}

  @Get() @RequirePermissions('patients.read')
  async view(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    await this.patients.assertVisitAccess(id, user);
    return this.crew.view(id);
  }

  @Get('devices') @RequirePermissions('patients.read')
  async devices(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    await this.patients.assertVisitAccess(id, user);
    return this.crew.deviceOptions(id);
  }

  @Put('crew') @RequirePermissions('patients.update')
  async setCrew(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: any) {
    await this.patients.assertVisitAccess(id, user);
    return this.crew.setCrew(id, dto?.crew, user);
  }

  @Put('device') @RequirePermissions('patients.update')
  async setDevice(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: any) {
    await this.patients.assertVisitAccess(id, user);
    const lotId = dto?.lotId === null || dto?.lotId === undefined || dto?.lotId === '' ? null : Number(dto.lotId);
    return this.crew.setDevice(id, lotId, user);
  }

  @Post('report') @RequirePermissions('documents.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  async report(@Param('id', ParseIntPipe) id: number, @UploadedFile() file: any, @CurrentUser() user: any) {
    await this.patients.assertVisitAccess(id, user);
    return this.crew.uploadReport(id, file, user);
  }
}
