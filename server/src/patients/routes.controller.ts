import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query,
  Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RoutesService } from './routes.service';
import { AttachDto, ReorderDto, RunCostDto, RunCreateDto, RunPatchDto, StopCreateDto, StopPatchDto } from './dto/routes.dto';

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

  /// ⚠️ پیش از `:id` ثبت شده، وگرنه «cost-report» شناسهٔ مسیر خوانده می‌شود.
  @RequirePermissions('accounting.read')
  @Get('cost-report')
  costReport(@Query('year') y?: string, @Query('month') m?: string) {
    return this.routes.costReport(Number(y), Number(m));
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

  // ── هزینهٔ حمل ───────────────────────────────────────────────

  /// هزینهٔ مسیر — ردیفِ دفتری همان‌جا ساخته می‌شود.
  @RequirePermissions('accounting.manage')
  @Patch(':id/cost')
  setCost(@Param('id', ParseIntPipe) id: number, @Body() dto: RunCostDto, @CurrentUser() user: any) {
    return this.routes.setCost(id, dto, user);
  }

  // ── رسیدِ تحویل ───────────────────────────────────────────────

  /// عکسِ رسید — سندِ عملیاتی، نه مدرکِ بالینیِ بیمار.
  @RequirePermissions('patients.update')
  @Post('stops/:id/proofs')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  addProof(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: any,
    @Body('caption') caption: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.routes.addProof(id, file, caption, user);
  }

  /**
   * دانلودِ رسید — زیرِ همان guardها و مستقیم از دیسک سرو نمی‌شود.
   * URLِ ثابتِ عمومی برای عکسِ تحویل یعنی نشتِ سند با یک لینکِ فوروارد‌شده.
   */
  @RequirePermissions('patients.read')
  @Get('proofs/:id/file')
  async proofFile(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const { proof, stream } = await this.routes.openProof(id);
    res.setHeader('Content-Type', proof.mimeType);
    res.setHeader('Content-Length', String(proof.size));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(proof.fileName)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    stream.pipe(res);
  }

  @RequirePermissions('patients.update')
  @Delete('proofs/:id')
  removeProof(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.routes.removeProof(id, user);
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

  /// کارهای بی‌راننده — جمع‌آوری‌هایی که کارشناس خواسته و هنوز مسیر ندارند.
  /// ⚠️ جدا از `GET /routes/unassigned` که **بارِ** بی‌مسیر را می‌دهد؛ این‌جا
  /// خودِ **توقف** ساخته شده و فقط راننده‌اش تعیین نشده.
  @RequirePermissions('patients.read')
  @Get('stops/unassigned')
  unassignedStops() {
    return this.routes.unassignedStops();
  }

  @RequirePermissions('patients.update')
  @Post('stops/:id/assign')
  assignStop(@Param('id', ParseIntPipe) id: number, @Body() dto: { runId: number }, @CurrentUser() user: any) {
    return this.routes.assignStop(id, Number(dto.runId), user);
  }
}
