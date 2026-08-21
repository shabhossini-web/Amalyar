import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LevelGuard } from '../auth/level.guard';
import { MinLevel } from '../auth/min-level.decorator';
import { LEVEL } from '../common/levels';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrdersService, OrderKind } from './orders.service';

/**
 * سفارش‌های بالینی — آزمایش، تصویربرداری، مشاوره، ارجاع.
 *
 * سطحِ بالینی (TECH_ADMIN به بالا) مثلِ بقیهٔ کارهای پرونده: منشیِ سطحِ ۱
 * نباید برای بیمار آزمایش بنویسد.
 */
@Controller('orders')
@UseGuards(JwtAuthGuard, LevelGuard)
@MinLevel(LEVEL.TECH_ADMIN)
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Get()
  list(@Query('visitId') visitId?: string, @Query('patientId') patientId?: string) {
    if (visitId) return this.orders.listForVisit(Number(visitId));
    if (patientId) return this.orders.listForPatient(Number(patientId));
    return [];
  }

  @Post(':kind')
  create(@Param('kind') kind: OrderKind, @Body() dto: any, @CurrentUser() user: any) {
    return this.orders.create(kind, dto, user);
  }

  @Patch(':kind/:id')
  update(@Param('kind') kind: OrderKind, @Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: any) {
    return this.orders.update(kind, id, dto, user);
  }

  @Post(':kind/:id/send')
  send(@Param('kind') kind: OrderKind, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.orders.send(kind, id, user);
  }

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

  @Post(':token/answer')
  answer(@Param('token') token: string, @Body() dto: any) {
    return this.orders.publicAnswer(token, dto);
  }
}
