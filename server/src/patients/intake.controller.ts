import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { clientIp } from '../common/client-ip';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { IntakeService } from './intake.service';

class RegisterDto {
  @IsString() @MinLength(2, { message: 'نام را کامل وارد کنید' }) @MaxLength(80) firstName!: string;
  @IsString() @MinLength(2, { message: 'نامِ خانوادگی را کامل وارد کنید' }) @MaxLength(80) lastName!: string;
  @IsString() @MaxLength(15) nationalId!: string;
  @IsString() @MaxLength(20) phone!: string;
  @IsOptional() @IsString() @MaxLength(12) birthDate?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  /// کانالِ آشنایی — شناسه از فهرستِ عمومیِ `/public/referral-sources`.
  @IsOptional() @Type(() => Number) @IsInt() referralSourceId?: number;
  /// نامِ معرف، وقتی کانال «معرفیِ پزشک/بیمار» باشد.
  @IsOptional() @IsString() @MaxLength(120) referralNote?: string;
  /// پرسشِ امنیتی: نشانی که سرور همراهِ تصویر داد (`GET link/:token/captcha`) + پاسخِ بیمار.
  /// ⚠️ صفحهٔ قدیمیِ کش‌شده هنوز `captchaA/B` می‌فرستد — `whitelist` آن‌ها را دور می‌ریزد و همین پیام می‌رسد.
  @IsString({ message: 'پرسشِ امنیتی را دوباره بگیرید — صفحه را تازه کنید' }) @MaxLength(512) captchaToken!: string;
  @Type(() => Number) @IsInt({ message: 'پاسخِ پرسشِ امنیتی را به عدد بنویسید' }) captchaAnswer!: number;
}

class ResumeRequestDto {
  @IsString({ message: 'شمارهٔ موبایل را بنویسید' }) @MaxLength(20) phone!: string;
}
class ResumeVerifyDto {
  @IsString({ message: 'شمارهٔ موبایل را بنویسید' }) @MaxLength(20) phone!: string;
  @IsString({ message: 'کدِ تأیید را بنویسید' }) @MaxLength(12) code!: string;
}

/**
 * پیش‌نویسِ فرم — عمداً هیچ فیلدِ ثابتی ندارد (نه `opDate`، نه `hospitalId`…):
 * آن‌ها را `fill` سرِ ثبتِ نهایی می‌گیرد. این‌جا فقط پاسخِ کادرهای فرم و
 * شمارهٔ صفحه‌ای که بیمار رویش بوده.
 */
class DraftDto {
  @IsOptional() @IsObject({ message: 'پاسخ‌های فرم نامعتبر است' }) values?: Record<string, any>;
  /**
   * شمارهٔ آخرین صفحهٔ دیده‌شده. **در `values` نمی‌آید** چون سرویس فقط کلیدهای
   * خودِ فرم را می‌نویسد و `_page` کلیدِ فرم نیست؛ ورودیِ typed جداگانه هم
   * یعنی عددِ بی‌معنی (منفی، رشته، ۱۰۰۰) اصلاً به سرویس نمی‌رسد.
   */
  @IsOptional() @IsInt() @Min(1) @Max(50) page?: number;
  /**
   * نسخهٔ این ذخیره (عددِ صعودیِ مرورگر) — پیش‌نویسِ دیررس روی ذخیرهٔ تازه‌تر
   * نمی‌نشیند (`SAVE_REV` در سرویس). بی‌اعلامش `whitelist` بی‌صدا دورش می‌ریخت.
   */
  @IsOptional() @IsInt() @Min(1) rev?: number;
}

class FillDto {
  @IsOptional() @IsInt() @Min(0) hospitalId?: number;
  @IsOptional() @IsString() @MaxLength(200) procedure?: string;
  @IsOptional() @IsString() @MaxLength(100) surgeonName?: string;
  @IsOptional() @IsString() @MaxLength(150) hospitalName?: string;
  @IsOptional() @IsString() @MaxLength(12) opDate?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  /**
   * پاسخِ فیلدهای **دلخواهِ** فرم — شکلش را کاربر در فرم‌ساز تعیین می‌کند، پس
   * در زمانِ کامپایل دانستنی نیست.
   *
   * ⚠️ عمداً `@IsObject` و بدونِ شکلِ ثابت، ولی **بی‌قید نیست**: سرویس فقط
   * کلیدهای همان فرم را می‌نویسد و بقیه را دور می‌ریزد. بدونِ آن، یک POSTِ
   * دست‌ساز می‌توانست هر کلیدی را در `data` بنشاند.
   * ⚠️ باید این‌جا اعلام شود وگرنه `ValidationPipe` با `whitelist` بی‌صدا
   * دورش می‌ریزد و فرم «ذخیره شد» می‌گوید بی‌آنکه چیزی ذخیره شود.
   */
  @IsOptional() @IsObject({ message: 'پاسخ‌های فرم نامعتبر است' }) values?: Record<string, any>;
  /** همان نسخهٔ `DraftDto.rev` — ثبتِ نهایی هم پیش‌نویس‌های قدیمی‌ترِ در راه را کنار می‌زند. */
  @IsOptional() @IsInt() @Min(1) rev?: number;
}

/** رزروِ نوبت توسطِ بیمار — `docs/BOOKING.md` مرحلهٔ ۳. */
class BookDto {
  @IsString({ message: 'روزِ نوبت را انتخاب کنید' }) date!: string;
  @IsOptional() @IsInt({ message: 'ساعتِ نوبت نامعتبر است' }) startMin?: number;
  @IsOptional() @IsInt({ message: 'موضوعِ ویزیت نامعتبر است' }) topicId?: number;
}

class DiscountApplyDto {
  @IsString() @MinLength(3) @MaxLength(40) code!: string;
}

class CodeCreateDto {
  @IsString() @MinLength(3, { message: 'کد را کامل وارد کنید' }) @MaxLength(40) code!: string;
  @IsOptional() @IsString() kind?: string;
  @Type(() => Number) @IsInt() @Min(1) value!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxAmount?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minAmount?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxUses?: number;
  @IsOptional() @IsString() @MaxLength(30) expiresAt?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

class CodePatchDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

/**
 * ⚠️ `formId` و `bankAccountId` **باید** این‌جا اعلام شوند وگرنه
 * `ValidationPipe({ whitelist: true })` در `main.ts:25` بی‌صدا دورشان می‌ریزد و
 * POST با ۲۰۱ برمی‌گردد در حالی که ستون خالی مانده. همان تلهٔ `ApproveDto`
 * (خطِ ۸۱ پایین‌تر) — دستِ‌کم دو بار در همین مخزن رخ داده.
 *
 * ⚠️ `@Min(0)` و نه `@Min(1)`: صفر یعنی «پاکش کن» و سرویس همان را `null`
 * می‌کند. بدونِ آن، ادمین می‌توانست فرم را انتخاب کند ولی هرگز برندارد.
 */
class LinkCreateDto {
  @IsString() @MinLength(2, { message: 'عنوانِ لینک کوتاه است' }) @MaxLength(120) title!: string;
  @IsOptional() @Type(() => Number) @IsInt({ message: 'مبلغ باید عدد باشد' }) @Min(0) amount?: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @IsOptional() @Type(() => Number) @IsInt({ message: 'فرمِ انتخاب‌شده نامعتبر است' }) @Min(0) formId?: number;
  @IsOptional() @Type(() => Number) @IsInt({ message: 'حسابِ انتخاب‌شده نامعتبر است' }) @Min(0) bankAccountId?: number;
}

class LinkPatchDto {
  @IsOptional() @IsString() @MinLength(2, { message: 'عنوانِ لینک کوتاه است' }) @MaxLength(120) title?: string;
  @IsOptional() @Type(() => Number) @IsInt({ message: 'مبلغ باید عدد باشد' }) @Min(0) amount?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @IsOptional() @Type(() => Number) @IsInt({ message: 'فرمِ انتخاب‌شده نامعتبر است' }) @Min(0) formId?: number;
  @IsOptional() @Type(() => Number) @IsInt({ message: 'حسابِ انتخاب‌شده نامعتبر است' }) @Min(0) bankAccountId?: number;
}

/**
 * ⚠️ شماره **باید** در DTO اعلام شود، وگرنه `ValidationPipe({whitelist:true})`
 * بی‌صدا دورش می‌ریزد و سرویس با `undefined` روبه‌رو می‌شود — همان تلهٔ
 * تکرارشوندهٔ این مخزن.
 */
class LinkSmsDto {
  @IsString({ message: 'شمارهٔ موبایل را وارد کنید' })
  @MaxLength(20)
  phone!: string;
}

/** ارسالِ مستقیمِ فرم از کارتِ مراجعه. */
class SendFormDto {
  @Type(() => Number) @IsInt({ message: 'پرونده را انتخاب کنید' })
  patientId!: number;

  @Type(() => Number) @IsInt({ message: 'فرم را انتخاب کنید' })
  formId!: number;
}

class RequiredItemDto {
  @IsInt() @Min(1) itemId!: number;
  @IsInt() @Min(1) @Max(10000) quantity!: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
class ApproveDto {
  /** فقط برای فرمِ دلخواه در شرکتِ دوخدمته — فرمِ پیش‌فرض خدمتش را خودش می‌گوید. */
  @IsOptional() @IsIn(['ionm', 'implant'], { message: 'خدمتِ انتخاب‌شده نامعتبر است' }) service?: string;
  @IsOptional() @IsString({ message: 'کلید تکرار درخواست باید متن باشد' }) @MaxLength(120, { message: 'کلید تکرار درخواست بیش از حد طولانی است' }) idempotencyKey?: string;
  @IsOptional() @IsObject() extra?: Record<string, any>;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => RequiredItemDto) requiredItems?: RequiredItemDto[];
  @IsOptional() @Type(() => Number) @IsInt() surgeonId?: number;
  @IsOptional() @Type(() => Number) @IsInt() hospitalId?: number;
  @IsOptional() @Type(() => Number) @IsInt() techId?: number;
  @IsOptional() @Type(() => Number) @IsInt() procedureTypeId?: number;
  @IsOptional() @IsString() @MaxLength(12) opDate?: string;
  @IsOptional() @IsString() @MaxLength(5) opStartTime?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  /// ⚠️ باید در DTO باشند وگرنه ValidationPipe با whitelist بی‌صدا دورشان می‌ریزد.
  @IsOptional() @IsBoolean() registerPayment?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() bankAccountId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) paidAmount?: number;
}

class NoteDto {
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

/** برگشت برای اصلاح: مرحله و دلیل هر دو لازم‌اند (مالک، ۱۴۰۵/۰۷/۰۱) — بیمار هر دو را می‌بیند. */
class ReturnDto {
  @IsIn(['service', 'documents', 'receipt', 'all'], { message: 'مرحله‌ای را که بیمار باید اصلاح کند انتخاب کنید' }) stage!: string;
  @IsString({ message: 'بنویسید چه چیزی باید اصلاح شود' }) @MaxLength(300) note!: string;
}

/**
 * مسیرهای **عمومیِ** فرمِ بیمار — بدونِ ورود.
 *
 * ⚠️ کنترلرِ جدا و نه یک متدِ بی‌گارد داخلِ کنترلرِ ادمین: مسیرِ عمومی باید از
 * خودِ فایل پیدا باشد. متدِ بی‌گارد میانِ بیست متدِ محافظت‌شده چیزی است که در
 * بازبینی از چشم می‌افتد، و این‌جا نشانی‌ای است که هر کسی می‌تواند صدا بزند.
 *
 * ⚠️ هیچ‌کدام از این‌ها دادهٔ پرونده برنمی‌گردانند — فقط همان چیزی که خودِ
 * صاحبِ فرم پر کرده. توکنِ فرم در پیامک می‌رود و پیامک فوروارد می‌شود.
 */
@Controller('public/intake')
export class PublicIntakeController {
  constructor(private intake: IntakeService) {}
  @Get('form/:token/hospitals')
  hospitals(@Param('token') token: string, @Query('q') q?: string) { return this.intake.publicHospitals(token, q); }

  /** هویتِ عمومیِ شرکت (نام، تلفن، نشانی، رنگ، حوزه) — برای صفحهٔ خطای بیمار. */
  @Get('brand')
  brand() {
    return this.intake.publicFace();
  }

  @Get('link/:token')
  link(@Param('token') token: string) {
    return this.intake.publicLink(token);
  }

  /** پرسشِ امنیتیِ تازه (تصویر + نشان) — `intake-captcha.ts`. */
  @Get('link/:token/captcha')
  captcha(@Param('token') token: string, @Req() req: Request) {
    return this.intake.captcha(token, clientIp(req));
  }

  @Post('link/:token/register')
  register(@Param('token') token: string, @Body() dto: RegisterDto, @Req() req: Request) {
    return this.intake.register(token, dto, clientIp(req));
  }

  /** «قبلاً ثبت‌نام کرده‌اید؟» — کدِ پیامکی برای ثبت‌نامِ بازِ همین شماره روی همین لینک (بی‌شمارش). */
  @Post('link/:token/resume/request')
  resumeRequest(@Param('token') token: string, @Body() dto: ResumeRequestDto, @Req() req: Request) {
    return this.intake.resumeRequest(token, dto.phone, clientIp(req));
  }

  /** کدِ درست ← توکنِ فرمِ باز (`/f/…`). */
  @Post('link/:token/resume/verify')
  resumeVerify(@Param('token') token: string, @Body() dto: ResumeVerifyDto, @Req() req: Request) {
    return this.intake.resumeVerify(token, dto.phone, dto.code, clientIp(req));
  }

  @Get('form/:token')
  view(@Param('token') token: string) {
    return this.intake.publicView(token);
  }

  @Post('form/:token/fill')
  fill(@Param('token') token: string, @Body() dto: FillDto) {
    return this.intake.fill(token, dto);
  }

  /** پیش‌نویس — `data` را merge می‌کند و `status` را دست نمی‌زند (W1.8، قرارداد §۶). */
  @Post('form/:token/draft')
  draft(@Param('token') token: string, @Body() dto: DraftDto) {
    return this.intake.draft(token, dto);
  }

  /* ── نوبت‌دهی: عمومی و فقط با توکن، چون بیمار حساب ندارد ── */

  @Get('form/:token/slots')
  slots(
    @Param('token') token: string,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('topicId') topicId?: string,
  ) {
    return this.intake.publicSlots(token, Number(year), Number(month), topicId ? Number(topicId) : undefined);
  }

  @Get('form/:token/topics')
  topics(@Param('token') token: string) {
    return this.intake.publicTopics(token);
  }

  @Post('form/:token/book')
  book(@Param('token') token: string, @Body() dto: BookDto) {
    return this.intake.book(token, dto);
  }

  /**
   * اعمالِ کدِ تخفیف.
   *
   * ⚠️ فقط **کد** فرستاده می‌شود، نه مبلغ. اگر مبلغ از کلاینت می‌آمد، هر کسی
   * با یک درخواستِ دستی صفر تومان می‌پرداخت.
   */
  @Post('form/:token/discount')
  discount(@Param('token') token: string, @Body() dto: DiscountApplyDto) {
    return this.intake.applyDiscount(token, dto.code);
  }

  @Post('form/:token/receipt')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  receipt(@Param('token') token: string, @UploadedFile() file: any) {
    return this.intake.attachReceipt(token, file);
  }

  /**
   * عکسِ یک **باکسِ عکسِ** فرم — جدا از فیشِ واریزی.
   *
   * ⚠️ `field` از نشانی می‌آید ولی آزاد نیست: سرویس می‌سنجد که واقعاً یک
   * فیلدِ `image`ِ همین فرم باشد. بدونِ آن، این نشانیِ عمومی یک آپلودرِ آزاد
   * روی دیسکِ ما بود.
   */
  @Post('form/:token/image/:field')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  image(@Param('token') token: string, @Param('field') field: string, @UploadedFile() file: any) {
    return this.intake.attachImage(token, field, file);
  }

  /** توضیحِ صوتیِ یک ردیفِ **باکسِ لینک** (بستهٔ ۶د) — فقط WAV، همان سقفِ ۸ مگابایت. */
  @Post('form/:token/voice/:field')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  voice(@Param('token') token: string, @Param('field') field: string, @UploadedFile() file: any) {
    return this.intake.attachVoice(token, field, file);
  }

  /** برداشتنِ یک عکس از همان کادر — بیمار عکسِ اشتباه را بردارد. */
  @Delete('form/:token/image/:field/:docId')
  unimage(
    @Param('token') token: string,
    @Param('field') field: string,
    @Param('docId', ParseIntPipe) docId: number,
  ) {
    return this.intake.detachImage(token, field, docId);
  }

  /** برداشتنِ یکی از فیش‌های واریزی. */
  @Delete('form/:token/receipt/:docId')
  unreceipt(@Param('token') token: string, @Param('docId', ParseIntPipe) docId: number) {
    return this.intake.detachReceipt(token, docId);
  }
}

/** صفِ تأیید و مدیریتِ لینک‌ها — ماژولِ `formgen`. */
@Controller('intake')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('formgen')
export class IntakeController {
  constructor(private intake: IntakeService) {}

  @RequirePermissions('intake.read')
  @Get('links')
  links() {
    return this.intake.listLinks();
  }

  /**
   * فرم‌ها و حساب‌های قابلِ انتخاب برای یک لینک.
   *
   * ⚠️ عمداً زیرِ `@Feature('formgen')` و مجوزِ `intake.read` است، نه
   * `forms.read`/`accounting.read`: نصبی که پلنِ حسابداری ندارد از
   * `GET /bank-accounts` ۴۰۳ می‌گیرد و انتخابگر برای همیشه خالی می‌ماند —
   * بدونِ هیچ پیامی. حساب‌ها هم فقط **نام** برمی‌گردانند، نه شماره.
   */
  @RequirePermissions('intake.read')
  @Get('link-options')
  async linkOptions() {
    const [forms, banks] = await Promise.all([this.intake.formsForLinks(), this.intake.banksForLinks()]);
    return { forms, banks };
  }

  @RequirePermissions('intake.manage')
  @Post('links')
  addLink(@Body() dto: LinkCreateDto, @CurrentUser() user: any) {
    return this.intake.createLink(dto, user);
  }

  @RequirePermissions('intake.manage')
  @Patch('links/:id')
  patchLink(@Param('id', ParseIntPipe) id: number, @Body() dto: LinkPatchDto, @CurrentUser() user: any) {
    return this.intake.patchLink(id, dto, user);
  }

  /**
   * فرستادنِ لینک با پیامک.
   *
   * ⚠️ زیرِ `intake.manage` و نه `intake.read`: این یک **کنشِ بیرونی** است که
   * به شمارهٔ یک آدمِ واقعی پیام می‌فرستد، نه خواندنِ یک فهرست.
   */
  @RequirePermissions('intake.manage')
  @Post('links/:id/sms')
  sendLinkSms(@Param('id', ParseIntPipe) id: number, @Body() dto: LinkSmsDto, @CurrentUser() user: any) {
    return this.intake.sendLinkSms(id, dto.phone, user);
  }

  /** حذفِ لینک — ثبت‌نام‌های موجود می‌مانند (SetNull)؛ فقط نشانی بسته می‌شود. */
  @RequirePermissions('intake.manage')
  @Delete('links/:id')
  deleteLink(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.intake.deleteLink(id, user);
  }

  /** ارسالِ مستقیمِ فرمِ زیرپرونده به بیمارِ یک مراجعه — بدونِ صفحهٔ مشخصات. */
  @RequirePermissions('intake.manage')
  @Post('send')
  sendForm(@Body() dto: SendFormDto, @CurrentUser() user: any) {
    return this.intake.sendToPatient(dto.patientId, dto.formId, user);
  }

  /** تحلیلِ فرم‌های زیرپرونده + کانالِ آشنایی + روندِ ماهانه — خوراکِ صفحهٔ CRM. */
  @RequirePermissions('intake.read')
  @Get('analytics')
  analytics() {
    return this.intake.analytics();
  }

  /** CSVِ پاسخ‌های پرشدهٔ یک فرمِ زیرپرونده. */
  @RequirePermissions('intake.read')
  @Get('analytics/csv')
  async analyticsCsv(@Query('formId', ParseIntPipe) formId: number, @Res() res: Response) {
    const { filename, csv } = await this.intake.analyticsCsv(formId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  /** ارجاع‌دهنده‌ها — عمل‌های هر جراح و بیمارستان در شش ماهِ اخیر (company-25). */
  @RequirePermissions('intake.read')
  @Get('referrers')
  referrers() {
    return this.intake.referrers();
  }

  /** بیمارانِ عمل‌شده‌ای که فرمِ پیگیریِ پرشده ندارند. */
  @RequirePermissions('intake.read')
  @Get('unfollowed')
  unfollowed() {
    return this.intake.unfollowed();
  }

  /** همان فهرست، CSV. */
  @RequirePermissions('intake.read')
  @Get('unfollowed/csv')
  async unfollowedCsv(@Res() res: Response) {
    const { filename, csv } = await this.intake.unfollowedCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  @RequirePermissions('intake.read')
  @Get('codes')
  codes() {
    return this.intake.listCodes();
  }

  @RequirePermissions('intake.manage')
  @Post('codes')
  addCode(@Body() dto: CodeCreateDto, @CurrentUser() user: any) {
    return this.intake.createCode(dto, user);
  }

  @RequirePermissions('intake.manage')
  @Patch('codes/:id')
  patchCode(@Param('id', ParseIntPipe) id: number, @Body() dto: CodePatchDto, @CurrentUser() user: any) {
    return this.intake.patchCode(id, dto, user);
  }

  @RequirePermissions('intake.read')
  @Get('submissions')
  submissions(@Query('status') status?: string) {
    return this.intake.list(status);
  }

  /** شمارِ هر وضعیت — روی زبانه‌های صفِ پذیرش (بازبینیِ UX، company-19). */
  @RequirePermissions('intake.read')
  @Get('submissions/counts')
  submissionCounts() {
    return this.intake.counts();
  }

  @RequirePermissions('intake.manage')
  @Delete('submissions/:id')
  deleteSubmission(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.intake.deleteSubmission(id, user);
  }

  /// ارجاع‌های پیشنهادی از روی متنی که بیمار نوشته — بیمارستان، جراح، نوعِ عمل.
  @RequirePermissions('intake.review')
  @Get('submissions/:id/refs')
  refs(@Param('id', ParseIntPipe) id: number) { return this.intake.approvalRefs(id); }

  @RequirePermissions('intake.review')
  @Post('submissions/:id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @Body() dto: ApproveDto, @CurrentUser() user: any) {
    return this.intake.approve(id, dto, user);
  }

  @RequirePermissions('intake.review')
  @Post('submissions/:id/reject')
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: NoteDto, @CurrentUser() user: any) {
    return this.intake.reject(id, dto, user);
  }

  @RequirePermissions('intake.review')
  @Post('submissions/:id/return')
  returnForFix(@Param('id', ParseIntPipe) id: number, @Body() dto: ReturnDto, @CurrentUser() user: any) {
    return this.intake.returnForFix(id, dto, user);
  }
}
