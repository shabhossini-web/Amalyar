import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { StorageService } from '../storage/storage.service';
import { ArrayMinSize, IsBoolean, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { InvoicesService } from './invoices.service';

class NeuroServiceDto {
  @IsString() @Matches(/^\d{4,8}$/) code!: string;
  @IsInt() @Min(1) @Max(72) hours!: number;
  @IsString() @Matches(/^\d{4}$/) year!: string;
  @IsIn(['company', 'hospital']) deviceOwner!: string;
}
/** پاپ‌آپِ یک‌جا: چند خدمت با یک مدت/سال/مالک. `items` = شناسه‌های «کد:نام» از neuro-catalog. */
class NeuroQuoteDto {
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) items!: string[];
  @IsInt() @Min(1) @Max(72) hours!: number;
  @IsString() @Matches(/^\d{4}$/) year!: string;
  @IsIn(['company', 'hospital']) deviceOwner!: string;
}
class NeuroApplyDto extends NeuroQuoteDto {
  @IsOptional() @IsBoolean() returnUnusedStock?: boolean;
  /** `{name, irc?, qty}` — شکلِ دقیق در سرویس سنجیده می‌شود. */
  @IsOptional() @IsArray() consumables?: unknown[];
}
class IssueInvoiceDto { @IsIn(['formal', 'informal']) variant!: string; }

@Controller('visits/:id/invoices')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('dashboard')
export class InvoicesController {
  constructor(private invoices: InvoicesService, private storage: StorageService) {}
  @Get() @RequirePermissions('billing.read')
  list(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) { return this.invoices.list(id, user); }
  // ⚠️ پیش از `:documentId` اعلام شده؛ وگرنه ParseIntPipe روی «neuro-catalog» ۴۰۰ می‌داد.
  @Get('neuro-catalog') @RequirePermissions('billing.read')
  catalog(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) { return this.invoices.catalog(id, user); }
  @Post('neuro-quote') @RequirePermissions('billing.read')
  quote(@Param('id', ParseIntPipe) id: number, @Body() dto: NeuroQuoteDto, @CurrentUser() user: any) { return this.invoices.quote(id, dto, user); }
  @Post('neuro-apply') @RequirePermissions('billing.write')
  apply(@Param('id', ParseIntPipe) id: number, @Body() dto: NeuroApplyDto, @CurrentUser() user: any) { return this.invoices.apply(id, dto, user); }
  @Post('neuro-preview') @RequirePermissions('billing.read')
  price(@Param('id', ParseIntPipe) id: number, @Body() dto: NeuroServiceDto, @CurrentUser() user: any) { return this.invoices.price(id, dto, user); }
  @Post('neuro-service') @RequirePermissions('billing.write')
  add(@Param('id', ParseIntPipe) id: number, @Body() dto: NeuroServiceDto, @CurrentUser() user: any) { return this.invoices.addService(id, dto, user); }
  @Post() @RequirePermissions('billing.write')
  issue(@Param('id', ParseIntPipe) id: number, @Body() dto: IssueInvoiceDto, @CurrentUser() user: any) { return this.invoices.issue(id, dto.variant, user); }
  @Get(':documentId') @RequirePermissions('billing.read')
  document(@Param('id', ParseIntPipe) id: number, @Param('documentId', ParseIntPipe) documentId: number, @CurrentUser() user: any) { return this.invoices.document(id, documentId, user); }
  @Get(':documentId/letterhead') @RequirePermissions('billing.read')
  async letterhead(@Param('id', ParseIntPipe) id: number, @Param('documentId', ParseIntPipe) documentId: number, @CurrentUser() user: any, @Res() res: Response) {
    const doc = await this.invoices.document(id, documentId, user);
    const lh = (doc.snapshot as any)?.template?.letterhead;
    if (!lh || !(await this.storage.exists(lh.sha256))) throw new NotFoundException('سربرگ فاکتور پیدا نشد');
    res.setHeader('Content-Type', lh.mime); res.setHeader('Cache-Control', 'private, no-store');
    this.storage.stream(lh.sha256).pipe(res);
  }
}
