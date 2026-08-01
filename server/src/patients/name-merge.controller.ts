import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsInt, IsString, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { NameMergeService } from './name-merge.service';

class LinkDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @Type(() => Number) @IsInt({ message: 'بیمارستانِ انتخابی نامعتبر است' }) hospitalId!: number;
}

class CreateFromDto {
  @IsString() @MinLength(2, { message: 'نام کوتاه است' }) @MaxLength(120) name!: string;
}

/** یکسان‌سازیِ نامِ بیمارستان — نام‌های آزادِ بی‌صاحب به موجودیت وصل می‌شوند. */
@Controller('name-merge')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('dashboard')
export class NameMergeController {
  constructor(private merge: NameMergeService) {}

  @RequirePermissions('definitions.read')
  @Get('hospitals/pending')
  pending() {
    return this.merge.pending();
  }

  @RequirePermissions('definitions.read')
  @Get('hospitals/resolve')
  resolve(@Query('name') name = '') {
    return this.merge.resolve(name);
  }

  @RequirePermissions('definitions.read')
  @Get('hospitals/:id/aliases')
  aliases(@Param('id', ParseIntPipe) id: number) {
    return this.merge.aliases(id);
  }

  @RequirePermissions('definitions.manage')
  @Post('hospitals/link')
  link(@Body() dto: LinkDto, @CurrentUser() user: any) {
    return this.merge.link(dto, user);
  }

  @RequirePermissions('definitions.manage')
  @Post('hospitals/create')
  createFrom(@Body() dto: CreateFromDto, @CurrentUser() user: any) {
    return this.merge.createFrom(dto, user);
  }

  @RequirePermissions('definitions.manage')
  @Delete('hospitals/aliases/:id')
  removeAlias(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.merge.removeAlias(id, user);
  }
}
