import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { Feature } from '../auth/feature.decorator';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PatientsService } from '../patients/patients.service';

/**
 * جستجوی سراسریِ بیمار — از هر صفحهٔ سامانه (W2.4، پوستهٔ سراسری).
 *
 * ⚠️ چرا endpointِ جدا و نه `GET /patients?q=`: آن یکی پشتِ Feature `dashboard`
 * (سطح ۵) است؛ کارشناسِ سطح ۲ باید بتواند بیمارِ خودش را از هر جا پیدا کند.
 * همان `searchPatients` صدا زده می‌شود، پس object-authz یکی است: زیرِ سوپروایزر
 * فقط بیمارانی که مراجعه‌ای به نامِ خودش دارند.
 */
@Controller('search')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('work')
export class SearchController {
  constructor(private patients: PatientsService) {}

  @Get('patients') @RequirePermissions('patients.read')
  async patients_(@CurrentUser() user: any, @Query('q') q?: string) {
    const t = (q ?? '').trim();
    if (t.length < 2) return [];
    const rows = await this.patients.searchPatients(t, user);
    return rows.slice(0, 10);
  }
}
