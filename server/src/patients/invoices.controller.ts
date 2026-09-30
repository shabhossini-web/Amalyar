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

/* پیامِ هر decorator فارسی است (DF16، قانون ۸) — پیش‌فرضِ class-validator انگلیسی است و همان متن به کاربر می‌رسید. */
const HOURS = { int: { message: 'مدتِ قابلِ صورتحساب باید عددِ صحیحِ ساعت باشد' }, min: { message: 'مدتِ قابلِ صورتحساب دستِ‌کم ۱ ساعت است' }, max: { message: 'مدتِ قابلِ صورتحساب حداکثر ۷۲ ساعت است' } };
const YEAR = { str: { message: 'سالِ تعرفه نامعتبر است' }, re: { message: 'سالِ تعرفه باید چهاررقمی باشد (مثلاً ۱۴۰۵)' } };
const OWNER = { message: 'مالکِ دستگاه باید «شرکت» یا «بیمارستان» باشد' };
class NeuroServiceDto {
  @IsString({ message: 'کدِ خدمت نامعتبر است' }) @Matches(/^\d{4,8}$/, { message: 'کدِ خدمت باید ۴ تا ۸ رقم باشد' }) code!: string;
  @IsInt(HOURS.int) @Min(1, HOURS.min) @Max(72, HOURS.max) hours!: number;
  @IsString(YEAR.str) @Matches(/^\d{4}$/, YEAR.re) year!: string;
  @IsIn(['company', 'hospital'], OWNER) deviceOwner!: string;
}
/** پاپ‌آپِ یک‌جا: چند خدمت با یک مدت/سال/مالک. `items` = شناسه‌های «کد:نام» از neuro-catalog. */
class NeuroQuoteDto {
  @IsArray({ message: 'فهرستِ خدمات نامعتبر است' }) @ArrayMinSize(1, { message: 'دستِ‌کم یک خدمت انتخاب کنید' })
  @IsString({ each: true, message: 'شناسهٔ خدمت نامعتبر است' }) items!: string[];
  @IsInt(HOURS.int) @Min(1, HOURS.min) @Max(72, HOURS.max) hours!: number;
  @IsString(YEAR.str) @Matches(/^\d{4}$/, YEAR.re) year!: string;
  @IsIn(['company', 'hospital'], OWNER) deviceOwner!: string;
  /** شناسهٔ قلم‌های مبلغِ کلِ مراجعه که با این خدمات جایگزین می‌شوند (company-14) — سرویس می‌سنجد.
   *  در `neuro-quote` هم هست تا پیش‌نمایشِ «صورت‌حسابِ پس از ثبت» همان جایگزینی را بسنجد (DF2). */
  @IsOptional() @IsArray({ message: 'فهرستِ قلم‌های جایگزین‌شونده باید آرایه باشد' }) replace?: unknown[];
}
class NeuroApplyDto extends NeuroQuoteDto {
  @IsOptional() @IsBoolean({ message: 'گزینهٔ «برگشت به موجودی» نامعتبر است' }) returnUnusedStock?: boolean;
  /** `{name, irc?, qty}` — شکلِ دقیق در سرویس سنجیده می‌شود. */
  @IsOptional() @IsArray({ message: 'فهرستِ مصرفی‌ها نامعتبر است' }) consumables?: unknown[];
  /** شناسهٔ قلم‌های مبلغِ کلی که کاربر صریحاً گفت «کنارش بماند» (DF3) — ماندگار روی خطوطِ نوروی تازه. */
  @IsOptional() @IsArray({ message: 'فهرستِ قلم‌های نگه‌داشته باید آرایه باشد' }) keep?: unknown[];
}
class IssueInvoiceDto { @IsIn(['formal', 'informal'], { message: 'نوعِ فاکتور باید رسمی یا غیررسمی باشد' }) variant!: string; }

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
