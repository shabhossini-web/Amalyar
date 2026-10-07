import { TenantHospitalDirectoryService } from './hospital-directory.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { SECTORS } from './service-codes.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { MobileInput } from '../common/validators';
import { DefinitionsService } from './definitions.service';
import { SettingsService } from '../config/settings.service';
import { NOTE_KINDS } from './record.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';

/** جراح: هویت (نام/تلفن) به Person می‌رود، تخصص و نظام‌پزشکی روی خودِ نقش می‌مانَد. */
/** فیلدهای هویتیِ مشترک؛ جراح و (بعداً) کارشناس هر دو از این ارث می‌برند. */
class PersonFieldsDto {
  @IsOptional() @MobileInput() @Matches(/^09\d{9}$|^$/, { message: 'شمارهٔ موبایل نامعتبر است' }) phone?: string;
  @IsOptional() @IsString() @MaxLength(20) nationalId?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(40) city?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(40) iban?: string;
  @IsOptional() @IsString() photo?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class SurgeonCreateDto extends PersonFieldsDto {
  @IsString({ message: 'نام را وارد کنید' })
  @MinLength(2, { message: 'نام کوتاه است' })
  @MaxLength(60)
  firstName!: string;

  @IsString({ message: 'نام خانوادگی را وارد کنید' })
  @MinLength(2, { message: 'نام خانوادگی کوتاه است' })
  @MaxLength(60)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  specialty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  licenseNo?: string;
}

class SurgeonPatchDto extends PersonFieldsDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) firstName?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) lastName?: string;
  @IsOptional() @IsString() @MaxLength(80) specialty?: string;
  @IsOptional() @IsString() @MaxLength(40) licenseNo?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** بیمارستان: سازمان است، پس Person ندارد — ولی پروفایلِ کامل دارد. */
class ProcedureCreateDto {
  @IsString({ message: 'عنوان را وارد کنید' })
  @MinLength(2, { message: 'عنوان کوتاه است' })
  @MaxLength(80)
  name!: string;

  @IsOptional() @IsString() @MaxLength(30) code?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  /// قالبِ مراقبت — باید در DTO اعلام شود وگرنه whitelist بی‌صدا دورش می‌ریزد.
  @IsOptional() @IsString() @MaxLength(900) preOpCare?: string;
  @IsOptional() @IsString() @MaxLength(900) postOpCare?: string;
  /// روزهای فرمِ پیگیریِ پس از عمل — «۷,۳۰,۹۰».
  @IsOptional() @IsString() @MaxLength(60) followUpDays?: string;
}

class ProcedurePatchDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(30) code?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsString() @MaxLength(900) preOpCare?: string;
  @IsOptional() @IsString() @MaxLength(900) postOpCare?: string;
  @IsOptional() @IsString() @MaxLength(60) followUpDays?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** موضوعِ ویزیت — ویزیتِ اولیه / پست‌آپ / زیبایی. `docs/BOOKING.md` مرحلهٔ ۱. */
class TopicCreateDto {
  @IsString({ message: 'عنوان را وارد کنید' })
  @MinLength(2, { message: 'عنوان کوتاه است' })
  @MaxLength(60)
  name!: string;

  /// توکنِ رنگ، نه هگز — همان قرارِ `FormDef.color`.
  @IsOptional() @IsString() @MaxLength(30) color?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsInt() sort?: number;

  /** بستهٔ ۹الف — کلیدِ زیرفرم‌هایی که با این موضوع خودکار الصاق می‌شوند؛ سرویس وجودشان را می‌سنجد. */
  @IsOptional() @IsArray({ message: 'فرم‌های خودکار نامعتبر است' }) @ArrayMaxSize(12, { message: 'حداکثر ۱۲ فرمِ خودکار برای یک موضوع' })
  @IsString({ each: true, message: 'فرم‌های خودکار نامعتبر است' }) @MaxLength(80, { each: true, message: 'کلیدِ زیرفرم نامعتبر است' })
  defaultSubforms?: string[];
}

class TopicPatchDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(30) color?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() sort?: number;

  @IsOptional() @IsArray({ message: 'فرم‌های خودکار نامعتبر است' }) @ArrayMaxSize(12, { message: 'حداکثر ۱۲ فرمِ خودکار برای یک موضوع' })
  @IsString({ each: true, message: 'فرم‌های خودکار نامعتبر است' }) @MaxLength(80, { each: true, message: 'کلیدِ زیرفرم نامعتبر است' })
  defaultSubforms?: string[];
}

/** کدِ داخلیِ مطب — جراحی/خدمتِ داخلِ مطب با کد و مبلغِ خودِ مطب. */
class NoteTemplateCreateDto {
  @IsIn(NOTE_KINDS as unknown as string[], { message: 'نوعِ شرح نامعتبر است' })
  kind!: string;

  @IsString({ message: 'عنوان را وارد کنید' }) @MinLength(2, { message: 'عنوان کوتاه است' }) @MaxLength(120)
  title!: string;

  @IsString({ message: 'متنِ قالب خالی است' }) @MinLength(2, { message: 'متنِ قالب کوتاه است' }) @MaxLength(20000)
  body!: string;

  /// «۰» = بی‌هدف (عمومی) — قراردادِ Min(0)ِ همین مخزن.
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) procedureTypeId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) diagnosisId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) topicId?: number;
}

/**
 * «افزودن به پیش‌فرض» زیرِ شرحِ عمل (درخواستِ مالک ۱۴۰۵/۰۷/۰۱) — متنی که همین
 * حالا نوشته شده، برای **یک** نوعِ عمل. عنوان اختیاری است (پیش‌فرض: نامِ عمل).
 * سقف‌ها همان `op-templates.ts`؛ کمینه را خودِ آن‌جا با پیامِ روشن می‌سنجد.
 */
class OpTemplateAddDto {
  @Type(() => Number) @IsInt({ message: 'نوعِ عمل نامعتبر است' }) @Min(1, { message: 'اول نوعِ عمل را انتخاب کنید' })
  procedureTypeId!: number;

  @IsString({ message: 'متنِ شرح نامعتبر است' }) @MaxLength(20000, { message: 'متن بلندتر از سقفِ یک قالب است' })
  body!: string;

  @IsOptional() @IsString({ message: 'عنوان نامعتبر است' }) @MaxLength(120, { message: 'عنوان بلند است' })
  title?: string;

  /* فقط برای ممیزی: از کدام صفحه و کدام مراجعه. */
  @IsOptional() @IsIn(['form', 'record'], { message: 'منبعِ نامعتبر' }) source?: string;
  @IsOptional() @Type(() => Number) @IsInt({ message: 'مراجعه نامعتبر است' }) @Min(1) visitId?: number;
}

class NoteTemplatePatchDto {
  @IsOptional() @IsIn(NOTE_KINDS as unknown as string[], { message: 'نوعِ شرح نامعتبر است' })
  kind?: string;

  @IsOptional() @IsString() @MinLength(2, { message: 'عنوان کوتاه است' }) @MaxLength(120)
  title?: string;

  @IsOptional() @IsString() @MinLength(2, { message: 'متنِ قالب کوتاه است' }) @MaxLength(20000)
  body?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) procedureTypeId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) diagnosisId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) topicId?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class InternalCodeCreateDto {
  @Matches(/^[A-Za-z0-9-]{1,20}$/, { message: 'کد فقط حرف/رقمِ لاتین و خط تیره (حداکثر ۲۰)' })
  code!: string;

  @IsString({ message: 'نام را وارد کنید' })
  @MinLength(2, { message: 'نام کوتاه است' })
  @MaxLength(120)
  name!: string;

  @Type(() => Number)
  @IsInt({ message: 'مبلغ باید عددِ صحیح باشد (تومان)' })
  @Min(0)
  price!: number;

  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

class InternalCodePatchDto {
  @IsOptional() @Matches(/^[A-Za-z0-9-]{1,20}$/, { message: 'کد فقط حرف/رقمِ لاتین و خط تیره (حداکثر ۲۰)' })
  code?: string;

  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) price?: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class DiagnosisCreateDto {
  @IsString({ message: 'عنوان را وارد کنید' })
  @MinLength(2, { message: 'عنوان کوتاه است' })
  @MaxLength(120)
  title!: string;

  @IsOptional() @IsString() @MaxLength(15) icdCode?: string;
}

class DiagnosisPatchDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(15) icdCode?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class HospitalCreateDto {
  @IsOptional() @IsString() @MaxLength(80) province?: string;
  @IsOptional() @IsIn(SECTORS, { message: 'نوع بیمارستان نامعتبر است' }) sector?: string;
  @IsString({ message: 'نام را وارد کنید' })
  @MinLength(2, { message: 'نام کوتاه است' })
  @MaxLength(180, { message: 'نام طولانی است' })
  name!: string;

  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(600) address?: string;
  @IsOptional() @IsString() @MaxLength(100) phone?: string;
  @IsOptional() @IsString() @MaxLength(60) contactName?: string;
  @IsOptional() @IsString() @MaxLength(20) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class HospitalPatchDto {
  @IsOptional() @IsString() @MaxLength(80) province?: string;
  @IsOptional() @IsIn(SECTORS, { message: 'نوع بیمارستان نامعتبر است' }) sector?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(180) name?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(600) address?: string;
  @IsOptional() @IsString() @MaxLength(100) phone?: string;
  @IsOptional() @IsString() @MaxLength(60) contactName?: string;
  @IsOptional() @IsString() @MaxLength(20) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

/// نیروی حمل‌ونقل — راننده یا پیک. همان فیلدهای هویتیِ جراح + خودرو.
class StaffCreateDto extends PersonFieldsDto {
  @IsString({ message: 'نام را وارد کنید' }) @MinLength(2, { message: 'نام کوتاه است' }) @MaxLength(60)
  firstName!: string;

  @IsString({ message: 'نام خانوادگی را وارد کنید' }) @MinLength(2, { message: 'نام خانوادگی کوتاه است' }) @MaxLength(60)
  lastName!: string;

  @IsIn(['driver', 'courier'], { message: 'نقش باید راننده یا پیک باشد' })
  role!: string;

  @IsOptional() @IsString() @MaxLength(60) vehicle?: string;
}

class StaffPatchDto extends PersonFieldsDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) firstName?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) lastName?: string;
  @IsOptional() @IsIn(['driver', 'courier'], { message: 'نقش باید راننده یا پیک باشد' }) role?: string;
  @IsOptional() @IsString() @MaxLength(60) vehicle?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

// تعریف‌های ماژولِ بیماران (جراحان/بیمارستان‌ها/کارشناسان) — همان گاردِ dashboard

/** کالا — ست، پیچ، ایمپلنت، مصرفی. */
export class ItemCreateDto {
  @IsString() @MinLength(2, { message: 'نامِ کالا کوتاه است' }) @MaxLength(120)
  name!: string;

  @IsOptional() @IsString() @MaxLength(60) sku?: string;
  @IsOptional() @IsString() @MaxLength(40) irc?: string;
  @IsOptional() @IsString() @MaxLength(60) brand?: string;
  @IsOptional() @IsString() @MaxLength(60) size?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
  /// consumable | set | device — «برگشتی» بودن اینجا تعیین می‌شود.
  @IsOptional() @IsIn(['consumable', 'set', 'device'], { message: 'نوعِ کالا نامعتبر است' })
  assetKind?: string;
  /// دو تیکِ کالا (بستهٔ ب): نمایش در بلوکِ «ثبتِ مصرفی»ِ پنلِ کارشناسی، و یک‌بار/چندبارمصرف.
  @IsOptional() @IsBoolean({ message: 'تیکِ نمایش نامعتبر است' }) showInTechPanel?: boolean;
  @IsOptional() @IsIn(['single', 'multi'], { message: 'نوعِ مصرف نامعتبر است' }) usageMode?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0, { message: 'ساعتِ آماده‌سازی نمی‌تواند منفی باشد' })
  turnaroundHours?: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  // به‌شکلِ رشته هم پذیرفته می‌شود چون کاربر با جداکنندهٔ هزارگان تایپ می‌کند.
  @IsOptional() price?: string | number;
}

export class ItemPatchDto extends ItemCreateDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  declare name: string;

  @IsOptional() @IsBoolean() active?: boolean;
}

class HospitalDirectoryImportDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({ each: true }) ids!: string[];
  @IsOptional() @IsIn(SECTORS) sector?: string;
  @IsOptional() @IsInt() @Min(1) localId?: number;
  @IsOptional() @IsBoolean() fillMissing?: boolean;
  @IsOptional() @IsBoolean() applySector?: boolean;
}

@Controller()
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('dashboard')
export class DefinitionsController {
  constructor(private defs: DefinitionsService, private settings: SettingsService, private directory: TenantHospitalDirectoryService) {}

  /**
   * زمان‌بندیِ پیام‌های مراقبت/پیگیری — فرمِ عمل باید **صریح بگوید** هر
   * پیام کِی می‌رود («یک روز قبل از عمل، ساعتِ ۱۰»)، نه اینکه جراح حدس بزند
   * یا مجبور شود تنظیماتِ شرکت را باز کند. فقط زمان‌بندی است، نه متن.
   */
  @RequirePermissions('definitions.read')
  @Get('care-plan/timing')
  async carePlanTiming() {
    const sms = await this.settings.sms();
    return {
      preOpDays: sms.preOpDays,
      postOpDays: sms.postOpDays,
      nextVisitDays: sms.nextVisitDays,
      hour: sms.reminderHour,
      /* بدونِ فرمِ پیگیری، روزهای انتخابی بی‌اثرند — فرم باید صریح بگوید. */
      followUpFormReady: await this.defs.followUpFormReady(),
    };
  }

  @RequirePermissions('definitions.read')
  @Get('surgeons')
  surgeons() {
    return this.defs.listSurgeons();
  }

  @RequirePermissions('definitions.manage')
  @Post('surgeons')
  addSurgeon(@Body() dto: SurgeonCreateDto) {
    return this.defs.createSurgeon(dto);
  }

  @RequirePermissions('definitions.manage')
  @Patch('surgeons/:id')
  patchSurgeon(@Param('id', ParseIntPipe) id: number, @Body() dto: SurgeonPatchDto, @CurrentUser() user: any) {
    return this.defs.updateSurgeon(id, dto, user);
  }

  @RequirePermissions('definitions.manage')
  @Delete('surgeons/:id')
  delSurgeon(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteSurgeon(id);
  }

  @RequirePermissions('definitions.read')
  @Get('hospitals/directory')
  directoryList(@Query() query: any) { return this.directory.list(query); }

  @RequirePermissions('definitions.manage')
  @Post('hospitals/directory/import')
  directoryImport(@Body() dto: HospitalDirectoryImportDto, @CurrentUser() user: any) { return this.directory.load(dto, user.id); }

  @RequirePermissions('definitions.read')
  @Get('hospitals')
  hospitals() {
    return this.defs.listHospitals();
  }

  @RequirePermissions('definitions.manage')
  @Post('hospitals')
  addHospital(@Body() dto: HospitalCreateDto) {
    return this.defs.createHospital(dto);
  }

  @RequirePermissions('definitions.manage')
  @Patch('hospitals/:id')
  patchHospital(@Param('id', ParseIntPipe) id: number, @Body() dto: HospitalPatchDto) {
    return this.defs.updateHospital(id, dto);
  }

  @RequirePermissions('definitions.manage')
  @Delete('hospitals/:id')
  delHospital(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteHospital(id);
  }

  /* ── موضوعِ ویزیت — مرحلهٔ ۱ از `docs/BOOKING.md` ── */

  @RequirePermissions('definitions.read')
  @Get('visit-topics')
  visitTopics() {
    return this.defs.listVisitTopics();
  }

  @RequirePermissions('definitions.manage')
  @Post('visit-topics')
  addVisitTopic(@Body() dto: TopicCreateDto) {
    return this.defs.createVisitTopic(dto);
  }

  @RequirePermissions('definitions.manage')
  @Patch('visit-topics/:id')
  patchVisitTopic(@Param('id', ParseIntPipe) id: number, @Body() dto: TopicPatchDto) {
    return this.defs.updateVisitTopic(id, dto);
  }

  @RequirePermissions('definitions.manage')
  @Delete('visit-topics/:id')
  delVisitTopic(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteVisitTopic(id);
  }

  @RequirePermissions('definitions.read')
  @Get('procedure-types')
  procedureTypes() {
    return this.defs.listProcedureTypes();
  }

  @RequirePermissions('definitions.manage')
  @Post('procedure-types')
  addProcedureType(@Body() dto: ProcedureCreateDto) {
    return this.defs.createProcedureType(dto);
  }

  @RequirePermissions('definitions.manage')
  @Patch('procedure-types/:id')
  patchProcedureType(@Param('id', ParseIntPipe) id: number, @Body() dto: ProcedurePatchDto) {
    return this.defs.updateProcedureType(id, dto);
  }

  @RequirePermissions('definitions.manage')
  @Delete('procedure-types/:id')
  delProcedureType(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteProcedureType(id);
  }

  @RequirePermissions('definitions.read')
  @Get('items')
  items(@Query('q') q?: string) {
    return this.defs.listItems(q);
  }

  @RequirePermissions('definitions.manage')
  @Post('items')
  addItem(@Body() dto: ItemCreateDto) {
    return this.defs.createItem(dto);
  }

  @RequirePermissions('definitions.manage')
  @Patch('items/:id')
  patchItem(@Param('id', ParseIntPipe) id: number, @Body() dto: ItemPatchDto) {
    return this.defs.updateItem(id, dto);
  }

  @RequirePermissions('definitions.manage')
  @Delete('items/:id')
  delItem(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteItem(id);
  }

  /// کدهای داخلیِ مطب — جستجو با ?q= برای انتخاب در فاکتورِ «با کد».
  @RequirePermissions('definitions.read')
  @Get('internal-codes')
  internalCodes(@Query('q') q?: string) {
    return this.defs.listInternalCodes(q);
  }

  @RequirePermissions('definitions.manage')
  @Post('internal-codes')
  addInternalCode(@Body() dto: InternalCodeCreateDto) {
    return this.defs.createInternalCode(dto);
  }

  @RequirePermissions('definitions.manage')
  @Patch('internal-codes/:id')
  patchInternalCode(@Param('id', ParseIntPipe) id: number, @Body() dto: InternalCodePatchDto) {
    return this.defs.updateInternalCode(id, dto);
  }

  @RequirePermissions('definitions.manage')
  @Delete('internal-codes/:id')
  delInternalCode(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteInternalCode(id);
  }

  /// قالب‌های شرحِ بالینی — تبِ «قالب‌های شرح» در تعریف‌های پایه.
  @RequirePermissions('definitions.read')
  @Get('note-templates')
  noteTemplates() {
    return this.defs.listNoteTemplates();
  }

  @RequirePermissions('definitions.manage')
  @Post('note-templates')
  addNoteTemplate(@Body() dto: NoteTemplateCreateDto) {
    return this.defs.createNoteTemplate(dto);
  }

  @RequirePermissions('definitions.manage')
  @Patch('note-templates/:id')
  patchNoteTemplate(@Param('id', ParseIntPipe) id: number, @Body() dto: NoteTemplatePatchDto) {
    return this.defs.updateNoteTemplate(id, dto);
  }

  @RequirePermissions('definitions.manage')
  @Delete('note-templates/:id')
  delNoteTemplate(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteNoteTemplate(id);
  }

  /* ── پیش‌فرض‌های شرحِ عمل — برای فرمِ عمل (همین ماژول) ──
     همتای میزِ اتاقِ عمل: `theatre/visits/:id/op-templates`. هر دو از
     `op-templates.ts` می‌خوانند و می‌نویسند. */
  @RequirePermissions('definitions.read')
  @Get('op-templates')
  opTemplates(@Query('procedureTypeIds') ids: string | undefined, @CurrentUser() user: any) {
    return this.defs.opTemplates(ids, user);
  }

  /* ⚠️ مجوزِ جدای `templates.add` و نه `definitions.manage`: افزودن کارِ
     نویسندهٔ شرح است، مدیریتِ فهرست کارِ ادمین (شرحِ کامل در access-registry). */
  @RequirePermissions('templates.add')
  @Post('op-templates')
  addOpTemplate(@Body() dto: OpTemplateAddDto, @CurrentUser() user: any) {
    return this.defs.addOpTemplate(dto, user);
  }

  @RequirePermissions('definitions.read')
  @Get('diagnoses')
  diagnoses() {
    return this.defs.listDiagnoses();
  }

  @RequirePermissions('definitions.manage')
  @Post('diagnoses')
  addDiagnosis(@Body() dto: DiagnosisCreateDto) {
    return this.defs.createDiagnosis(dto);
  }

  @RequirePermissions('definitions.manage')
  @Patch('diagnoses/:id')
  patchDiagnosis(@Param('id', ParseIntPipe) id: number, @Body() dto: DiagnosisPatchDto) {
    return this.defs.updateDiagnosis(id, dto);
  }

  @RequirePermissions('definitions.manage')
  @Delete('diagnoses/:id')
  delDiagnosis(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteDiagnosis(id);
  }

  /// کارشناسانِ قابلِ‌انتساب — حساب‌های فعالِ سطح ۲..۴
  @RequirePermissions('definitions.read')
  @Get('techs')
  techs() {
    return this.defs.listTechs();
  }

  // ── نیروی حمل‌ونقل ────────────────────────────────────────────
  @RequirePermissions('definitions.read')
  @Get('transport-staff')
  staff() {
    return this.defs.listTransportStaff();
  }

  @RequirePermissions('definitions.manage')
  @Post('transport-staff')
  createStaff(@Body() dto: StaffCreateDto) {
    return this.defs.createTransportStaff(dto);
  }

  @RequirePermissions('definitions.manage')
  @Patch('transport-staff/:id')
  updateStaff(@Param('id', ParseIntPipe) id: number, @Body() dto: StaffPatchDto, @CurrentUser() user: any) {
    return this.defs.updateTransportStaff(id, dto, user);
  }

  @RequirePermissions('definitions.manage')
  @Delete('transport-staff/:id')
  deleteStaff(@Param('id', ParseIntPipe) id: number) {
    return this.defs.deleteTransportStaff(id);
  }
}
