import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { AssetsService } from './assets.service';
import { HospitalNeedDto } from './dto/assets.dto';

/** داراییِ برگشتی (ست و دستگاه) + نیازِ استانداردِ بیمارستان. */
@Controller('assets')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('inventory')
export class AssetsController {
  constructor(private assets: AssetsService) {}

  @RequirePermissions('inventory.read')
  @Get()
  list(@Query('on') on?: string, @Query('item') item?: string) {
    return this.assets.assets(on ? new Date(on) : undefined, item ? Number(item) : undefined);
  }

  @RequirePermissions('inventory.read')
  @Get('month')
  month(@Query('year') y?: string, @Query('month') m?: string) {
    return this.assets.month(Number(y), Number(m));
  }

  @RequirePermissions('inventory.read')
  @Get('visits/:id/suggest')
  suggest(@Param('id', ParseIntPipe) id: number) {
    return this.assets.suggestFor(id);
  }

  @RequirePermissions('inventory.read')
  @Get('hospitals/:id/needs')
  needs(@Param('id', ParseIntPipe) id: number) {
    return this.assets.needs(id);
  }

  @RequirePermissions('definitions.manage')
  @Post('hospitals/:id/needs')
  setNeed(@Param('id', ParseIntPipe) id: number, @Body() dto: HospitalNeedDto) {
    return this.assets.setNeed(id, dto);
  }

  @RequirePermissions('definitions.manage')
  @Delete('needs/:id')
  removeNeed(@Param('id', ParseIntPipe) id: number) {
    return this.assets.removeNeed(id);
  }
}
