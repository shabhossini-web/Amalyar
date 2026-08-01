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
import { CreateVisitDto, UpdateVisitDto, VisitStatusDto, VisitTimesDto } from './dto/visit.dto';

// مدیریتِ بیماران/مراجعات — دسترسی داینامیک از جدولِ features (کلیدِ dashboard)
@Controller()
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('dashboard')
export class PatientsController {
  constructor(private patients: PatientsService) {}

  /**
   * فهرستِ مراجعات. همهٔ پارامترها اختیاری‌اند، پس `/visits` خالی همان رفتارِ
   * قبلی را دارد و فیلترِ پیشرفته فقط چند پارامتر اضافه می‌کند.
   */
  @RequirePermissions('patients.read')
  @Get('visits')
  list(@CurrentUser() user: any, @Query() query: Record<string, string>) {
    return this.patients.listVisits(filterFrom(query), user);
  }

  /// خروجیِ کاملِ همان فیلتر (CSV/چاپ) — بدونِ صفحه‌بندی، با سقفِ صریح.
  @RequirePermissions('patients.read')
  @Get('visits/export')
  export(@CurrentUser() user: any, @Query() query: Record<string, string>) {
    return this.patients.exportVisits(filterFrom(query), user);
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

  /// ثبتِ ساعت‌ها مجوزِ سبک‌ترِ خودش را دارد: کارشناسی که سرِ عمل ساعت می‌زند
  /// نباید بتواند مبلغ و جراح را هم عوض کند.
  @RequirePermissions('visits.times')
  @Patch('visits/:id/times')
  setTimes(@Param('id', ParseIntPipe) id: number, @Body() dto: VisitTimesDto, @CurrentUser() user: any) {
    return this.patients.setTimes(id, dto, user);
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

/// خواندنِ فیلتر از query — یک جا، تا فهرست و خروجی همان پارامترها را بفهمند.
function filterFrom(query: Record<string, string>) {
  return {
    q: query.q,
    status: query.status,
    kind: query.kind,
    surgeonId: intOf(query.surgeonId),
    hospitalId: intOf(query.hospitalId),
    techId: intOf(query.techId),
    procedureTypeId: intOf(query.procedureTypeId),
    diagnosisId: intOf(query.diagnosisId),
    from: dateOf(query.from),
    to: dateOf(query.to),
    owing: query.owing === '1',
    sort: query.sort,
    dir: query.dir,
    page: intOf(query.page),
    pageSize: intOf(query.pageSize),
  };
}

/// پارامترِ عددیِ اختیاری. مقدارِ بی‌معنی نادیده گرفته می‌شود نه اینکه به خطا
/// تبدیل شود — فیلترِ خرابِ یک URLِ کپی‌شده نباید کلِ فهرست را بشکند.
function intOf(v?: string): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function dateOf(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
