import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { SurgeonPortalService } from './surgeon-portal.service';
import { StorageService } from '../storage/storage.service';

class ItemDto {
  @IsInt() @Min(1) itemId!: number;
  @IsInt() @Min(1) @Max(10000) quantity!: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
class InstructionsDto {
  @IsString() @MaxLength(10000) instructions!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ItemDto) requiredItems?: ItemDto[];
}

@Controller('surgeon')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('surgeon')
export class SurgeonPortalController {
  constructor(private portal: SurgeonPortalService, private storage: StorageService) {}
  @Get('visits') @RequirePermissions('surgeon.read')
  list(@CurrentUser() user: any, @Query('q') q?: string, @Query('page') page?: string) { return this.portal.list(user, q, Number(page)); }
  @Get('finances') @RequirePermissions('surgeon.read')
  finances(@CurrentUser() user: any, @Query('surgeonId') surgeonId?: string, @Query('page') page?: string) { return this.portal.finances(user, Number(surgeonId), Number(page) || 1); }
  @Get('items') @RequirePermissions('surgeon.read')
  items(@CurrentUser() user: any, @Query('q') q?: string) { return this.portal.items(user, q); }
  @Patch('visits/:id/instructions') @RequirePermissions('surgeon.write')
  save(@Param('id', ParseIntPipe) id: number, @Body() dto: InstructionsDto, @CurrentUser() user: any) { return this.portal.saveInstructions(id, dto, user); }
  @Get('visits/:id/documents/:documentId') @RequirePermissions('surgeon.read')
  async document(@Param('id', ParseIntPipe) id: number, @Param('documentId', ParseIntPipe) documentId: number, @CurrentUser() user: any, @Res() res: Response) {
    const doc = await this.portal.document(id, documentId, user);
    res.setHeader('Content-Type', doc.mimeType); res.setHeader('Cache-Control', 'private, no-store');
    this.storage.stream(doc.sha256).pipe(res);
  }
  @Post('accounts/:surgeonId') @RequirePermissions('users.manage')
  account(@Param('surgeonId', ParseIntPipe) id: number, @CurrentUser() user: any) { return this.portal.grantAccount(id, user); }
}
