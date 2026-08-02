import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RoutesService } from './routes.service';
import { AttachDto, ReorderDto, RunCreateDto, RunPatchDto, StopCreateDto, StopPatchDto } from './dto/routes.dto';

/** مسیرهای حمل — یک نیرو، یک روز، چند توقفِ مرتب. */
@Controller('routes')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('dispatch')
export class RoutesController {
  constructor(private routes: RoutesService) {}

  @RequirePermissions('patients.read')
  @Get('month')
  month(@Query('year') y?: string, @Query('month') m?: string) {
    return this.routes.month(Number(y), Number(m));
  }

  @RequirePermissions('patients.read')
  @Get('day')
  day(@Query('on') on?: string) {
    return this.routes.day(on ? new Date(on) : new Date());
  }

  /// حواله‌های همان روز که هنوز به مسیری وصل نشده‌اند — کارِ باقی‌ماندهٔ چینش.
  @RequirePermissions('patients.read')
  @Get('unassigned')
  unassigned(@Query('on') on?: string) {
    return this.routes.unassigned(on ? new Date(on) : new Date());
  }

  /// صفِ جمع‌آوری — آنچه کارشناس «تمام شد» اعلام کرده و هنوز برنگشته.
  @RequirePermissions('patients.read')
  @Get('pickup-queue')
  pickupQueue() {
    return this.routes.pickupQueue();
  }

  @RequirePermissions('patients.read')
  @Get(':id')
  run(@Param('id', ParseIntPipe) id: number) {
    return this.routes.run(id);
  }

  @RequirePermissions('patients.read')
  @Get(':id/briefing')
  briefing(@Param('id', ParseIntPipe) id: number) {
    return this.routes.briefing(id);
  }

  @RequirePermissions('patients.update')
  @Post()
  create(@Body() dto: RunCreateDto, @CurrentUser() user: any) {
    return this.routes.createRun(dto, user);
  }

  @RequirePermissions('patients.update')
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: RunPatchDto, @CurrentUser() user: any) {
    return this.routes.updateRun(id, dto, user);
  }

  @RequirePermissions('patients.update')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.routes.deleteRun(id, user);
  }

  @RequirePermissions('patients.update')
  @Post(':id/stops')
  addStop(@Param('id', ParseIntPipe) id: number, @Body() dto: StopCreateDto, @CurrentUser() user: any) {
    return this.routes.addStop(id, dto, user);
  }

  @RequirePermissions('patients.update')
  @Post(':id/reorder')
  reorder(@Param('id', ParseIntPipe) id: number, @Body() dto: ReorderDto, @CurrentUser() user: any) {
    return this.routes.reorder(id, dto.stopIds, user);
  }

  @RequirePermissions('patients.update')
  @Patch('stops/:id')
  patchStop(@Param('id', ParseIntPipe) id: number, @Body() dto: StopPatchDto, @CurrentUser() user: any) {
    return this.routes.updateStop(id, dto, user);
  }

  @RequirePermissions('patients.update')
  @Delete('stops/:id')
  removeStop(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.routes.removeStop(id, user);
  }

  @RequirePermissions('patients.update')
  @Post('stops/:id/transfers')
  attach(@Param('id', ParseIntPipe) id: number, @Body() dto: AttachDto, @CurrentUser() user: any) {
    return this.routes.attach(id, dto.transferIds, user);
  }

  @RequirePermissions('patients.update')
  @Delete('stops/:id/transfers/:tid')
  detach(
    @Param('id', ParseIntPipe) id: number,
    @Param('tid', ParseIntPipe) tid: number,
    @CurrentUser() user: any,
  ) {
    return this.routes.detach(id, tid, user);
  }
}
