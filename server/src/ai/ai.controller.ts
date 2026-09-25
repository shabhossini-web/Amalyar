import { Body, Controller, Get, HttpCode, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AiService } from './ai.service';
import { NOTE_KINDS } from '../patients/record.service';

/** بافتارِ فرم برای دستیار — شناسهٔ تعریف‌ها (نوعِ عمل، تشخیص)، نه دادهٔ بیمار. */
class CodingCtxDto {
  @IsOptional() @IsArray() @ArrayMaxSize(10) @Type(() => Number) @IsInt({ each: true, message: 'نوعِ عمل نامعتبر است' })
  procedureTypeIds?: number[];

  @IsOptional() @IsArray() @ArrayMaxSize(10) @Type(() => Number) @IsInt({ each: true, message: 'تشخیص نامعتبر است' })
  diagnosisIds?: number[];
}

class TextCtxDto extends CodingCtxDto {
  /// متنِ مراقبتِ این مرحله برای پیامک به بیمار — توصیهٔ استانداردِ همان عمل مجاز است.
  @IsOptional() @IsIn(['pre', 'post'], { message: 'مرحلهٔ مراقبت نامعتبر است' }) care?: string;
}

class TextDraftDto {
  @IsString() @MinLength(2) @MaxLength(12000) text!: string;
  @IsIn(['structure', 'continue']) mode!: string;
  @IsOptional() @IsString() @MaxLength(160) purpose?: string;
  @IsOptional() @ValidateNested() @Type(() => TextCtxDto) context?: TextCtxDto;
}

class CareDraftDto extends CodingCtxDto {
  @IsOptional() @Type(() => Number) @IsInt({ message: 'مراجعهٔ انتخابی نامعتبر است' }) visitId?: number;
  @IsOptional() @IsIn(['pre', 'post'], { message: 'مرحلهٔ مراقبت نامعتبر است' }) phase?: string;
  @IsOptional() @IsString() @MaxLength(12000, { message: 'شرحِ عمل طولانی است' }) opReport?: string;
  @IsOptional() @IsString() @MaxLength(4000, { message: 'متنِ مراقبت طولانی است' }) text?: string;
}

class NoteDraftDto {
  @Type(() => Number) @IsInt({ message: 'پرونده را انتخاب کنید' })
  patientId!: number;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'مراجعهٔ انتخابی نامعتبر است' })
  visitId?: number;

  @IsString({ message: 'نوعِ شرح نامعتبر است' }) @MaxLength(20)
  kind!: string;

  /// structure = تایپِ خام → ساخت‌یافته؛ continue = «ادامه بنویس»
  @IsOptional() @IsIn(['structure', 'continue'], { message: 'حالتِ دستیار نامعتبر است' })
  mode?: string;

  @IsString({ message: 'متنی برای دستیار نیست' })
  @MinLength(2, { message: 'متن کوتاه است' }) @MaxLength(12000, { message: 'متن طولانی است' })
  text!: string;

  /// نوعِ عمل و تشخیصِ **فرمِ باز** (شاید ذخیره‌نشده) — مقدم بر مقدارِ ذخیره‌شدهٔ مراجعه.
  @IsOptional() @IsArray() @ArrayMaxSize(10) @Type(() => Number) @IsInt({ each: true, message: 'نوعِ عمل نامعتبر است' })
  procedureTypeIds?: number[];

  @IsOptional() @IsArray() @ArrayMaxSize(10) @Type(() => Number) @IsInt({ each: true, message: 'تشخیص نامعتبر است' })
  diagnosisIds?: number[];
}

class TemplateDraftDto {
  @IsIn(NOTE_KINDS as unknown as string[], { message: 'نوعِ شرح نامعتبر است' })
  kind!: string;

  /// «۰» = بی‌هدف — همان قراردادِ Min(0)ِ مخزن.
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) procedureTypeId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) diagnosisId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) topicId?: number;
}

/** دستیارِ هوشِ مصنوعی — سطحِ دسترسیِ بالینی داخلِ سرویس چک می‌شود. */
@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('status')
  status(@CurrentUser() user: any) {
    return this.ai.status(user);
  }

  @Post('text-draft')
  textDraft(@Body() dto: TextDraftDto, @CurrentUser() user: any) {
    return this.ai.textDraft(user, dto);
  }

  @Post('note-draft')
  noteDraft(@Body() dto: NoteDraftDto, @CurrentUser() user: any) {
    return this.ai.noteDraft(user, dto);
  }

  /** همان پیش‌نویس، زنده (SSE) — رویدادها: {d}، {error}، و [DONE].
      ⚠️ SSE باید 200 باشد؛ پیش‌فرضِ POSTِ Nest (۲۰۱) بعضی کلاینت‌های
      event-stream را می‌رنجاند. */
  @HttpCode(200)
  @Post('note-draft/stream')
  noteDraftStream(@Body() dto: NoteDraftDto, @CurrentUser() user: any, @Res() res: Response) {
    return this.ai.noteDraftStream(user, dto, res);
  }

  /** دستیارِ مدیریت — چتِ استریمی؛ سطحِ ۵+ داخلِ سرویس چک می‌شود. */
  @HttpCode(200)
  @Post('assistant')
  assistant(@Body() dto: any, @CurrentUser() user: any, @Res() res: Response) {
    return this.ai.assistantStream(user, dto?.messages, res);
  }

  /** پیش‌نویسِ مراقبتِ پیش/پس از عمل — با بافتارِ نوعِ عمل و تشخیصِ همان فرم. */
  @Post('care-draft')
  careDraft(@Body() dto: CareDraftDto, @CurrentUser() user: any) {
    return this.ai.careDraft(user, dto);
  }

  /** خلاصهٔ پرونده برای ارجاع — متن برمی‌گردد؛ ثبتش با خودِ پزشک. */
  @Post('record-summary')
  recordSummary(@Body() dto: { patientId?: number }, @CurrentUser() user: any) {
    const pid = Number(dto?.patientId ?? 0);
    return this.ai.recordSummary(user, pid);
  }

  /** پیشنهادِ کدِ خدمت از شرحِ همین مراجعه — فقط کدهای واقعاً موجود. */
  @Post('suggest-codes')
  suggestCodes(@Body() dto: { visitId?: number }, @CurrentUser() user: any) {
    const vid = Number(dto?.visitId ?? 0);
    return this.ai.suggestCodes(user, vid);
  }

  /** ساختِ خودکارِ قالبِ شرح از روی شرح‌های موجودِ مطب. */
  @Post('template-draft')
  templateDraft(@Body() dto: TemplateDraftDto, @CurrentUser() user: any) {
    return this.ai.templateDraft(user, {
      kind: dto.kind,
      procedureTypeId: dto.procedureTypeId || undefined,
      diagnosisId: dto.diagnosisId || undefined,
      topicId: dto.topicId || undefined,
    });
  }

  /** گفتار → متن (ویسپر). فایلِ ضبطِ MediaRecorder — حداکثر ۱۵MB. */
  @HttpCode(200)
  @Post('transcribe')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 15 * 1024 * 1024 } }))
  transcribe(@UploadedFile() file: any, @CurrentUser() user: any) {
    return this.ai.transcribe(user, file);
  }

  /** دستیارِ جستجوی بالینی — پرسشِ زبانِ طبیعی روی شرح‌ها (+آمار). */
  @HttpCode(200)
  @Post('notes-query')
  notesQuery(@Body() dto: { question?: string }, @CurrentUser() user: any) {
    return this.ai.notesQuery(user, dto ?? {});
  }

  /** تحلیلِ دیکتهٔ ثبتِ بیمارِ جدید → فیلدهای پیشنهادی. */
  @HttpCode(200)
  @Post('parse-patient')
  parsePatient(@Body() dto: { text?: string }, @CurrentUser() user: any) {
    return this.ai.parsePatient(user, dto ?? {});
  }

  /** ثبتِ اصلاحِ دستیِ کاربر روی پیش‌نویسِ دستیار (یادگیریِ retrieval). */
  @HttpCode(200)
  @Post('feedback')
  feedback(@Body() dto: { kind?: string; draft?: string; final?: string }, @CurrentUser() user: any) {
    return this.ai.feedback(user, dto ?? {});
  }
}
