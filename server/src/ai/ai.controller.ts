import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AiService } from './ai.service';

class NoteDraftDto {
  @Type(() => Number) @IsInt({ message: 'پرونده را انتخاب کنید' })
  patientId!: number;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'مراجعهٔ انتخابی نامعتبر است' })
  visitId?: number;

  @IsString({ message: 'نوعِ شرح نامعتبر است' }) @MaxLength(20)
  kind!: string;

  @IsString({ message: 'متنی برای ساخت‌یافته‌کردن نیست' })
  @MinLength(2, { message: 'متن کوتاه است' }) @MaxLength(12000, { message: 'متن طولانی است' })
  text!: string;
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
}
