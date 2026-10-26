import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LevelGuard } from '../auth/level.guard';
import { MinLevel } from '../auth/min-level.decorator';
import { LEVEL } from '../common/levels';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrdersService, OrderKind } from './orders.service';

/**
 * سفارش‌های بالینی — آزمایش، تصویربرداری، مشاوره، ارجاع.
 *
 * سطحِ بالینی (TECH_ADMIN به بالا) مثلِ بقیهٔ کارهای پرونده: منشیِ سطحِ ۱
 * نباید برای بیمار آزمایش بنویسد.
 */
@Controller('orders')
@UseGuards(JwtAuthGuard, LevelGuard, FeatureGuard, PermissionGuard)
@Feature('dashboard')
@MinLevel(LEVEL.TECH_ADMIN)
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @RequirePermissions('patients.read')
  @Get()
  list(@CurrentUser() user: any, @Query('visitId') visitId?: string, @Query('patientId') patientId?: string) {
    if (visitId) return this.orders.listForVisit(Number(visitId), user);
    if (patientId) return this.orders.listForPatient(Number(patientId), user);
    return [];
  }

  @RequirePermissions('patients.update')
  @Post(':kind/:id/review')
  review(@Param('kind') kind: OrderKind, @Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: any) {
    return this.orders.review(kind, id, dto, user);
  }

  @RequirePermissions('patients.update')
  @Post(':kind')
  create(@Param('kind') kind: OrderKind, @Body() dto: any, @CurrentUser() user: any) {
    return this.orders.create(kind, dto, user);
  }

  @RequirePermissions('patients.update')
  @Patch(':kind/:id')
  update(@Param('kind') kind: OrderKind, @Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: any) {
    return this.orders.update(kind, id, dto, user);
  }

  @RequirePermissions('patients.update')
  @Post(':kind/:id/send')
  send(@Param('kind') kind: OrderKind, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.orders.send(kind, id, user);
  }

  @RequirePermissions('patients.update')
  @Delete(':kind/:id')
  remove(@Param('kind') kind: OrderKind, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.orders.remove(kind, id, user);
  }
}

/** صفحهٔ عمومیِ بیمار — بدونِ ورود، فقط با توکنِ همان سفارش. */
@Controller('public/order')
export class PublicOrdersController {
  constructor(private orders: OrdersService) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.orders.publicView(token);
  }

  /** توضیحِ صوتیِ پزشک برای همین درخواست. */
  @Get(':token/voice/:id')
  async voice(@Param('token') token: string, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const v = await this.orders.publicVoice(token, id);
    res.setHeader('Content-Type', v.mimeType); res.setHeader('Cache-Control', 'private, no-store');
    v.stream.pipe(res);
  }

  @Post(':token/answer')
  answer(@Param('token') token: string, @Body() dto: any) {
    return this.orders.publicAnswer(token, dto);
  }

  /**
   * فایلِ جوابِ بیمار (قرارداد §۵). جوابِ آزمایش معمولاً یک عکس یا PDF است و
   * تا امروز هیچ راهی نداشت جز اینکه بیمار جایی آپلود کند و **لینکش** را
   * بفرستد — یعنی مدرکِ پزشکی روی سرورِ یک غریبه.
   *
   * ⚠️ سقفِ `fileSize` این‌جا فقط ترمزِ زودهنگامِ multipart است تا بافرِ بزرگ
   * اصلاً ساخته نشود؛ سنجهٔ واقعیِ حجم و نوع در سرویس است، چون کنترلر
   * تنها لایه نیست و نباید باشد.
   */
  @Post(':token/files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@Param('token') token: string, @UploadedFile() file: any) {
    return this.orders.publicUpload(token, file);
  }
}
