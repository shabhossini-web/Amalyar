import { Body, Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AiService } from './ai.service';
import { NOTE_KINDS } from '../patients/record.service';

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
}
