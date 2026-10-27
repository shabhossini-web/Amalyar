import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { VoiceLabService } from './voice-lab.service';

class VoiceLabSpeakDto {
  @IsString({ message: 'متن را بنویسید' }) @MinLength(1, { message: 'متن را بنویسید' })
  @MaxLength(2000, { message: 'متن طولانی است (حداکثر ۲۰۰۰ نویسه)' })
  text!: string;

  @IsIn(['read', 'reply'], { message: 'حالت نامعتبر است' }) mode!: 'read' | 'reply';
  @IsOptional() @IsString() @MaxLength(120, { message: 'نامِ مدلِ صدا طولانی است' }) ttsModel?: string;
  @IsOptional() @IsString() @MaxLength(120, { message: 'نامِ مدلِ استدلال طولانی است' }) chatModel?: string;
  @IsOptional() @IsString() @MaxLength(20) voice?: string;
  @IsOptional() @Type(() => Number) @IsNumber({}, { message: 'سرعت نامعتبر است' }) @Min(0.5) @Max(2) speed?: number;
  @IsOptional() @IsString() @MaxLength(1500, { message: 'پرامپتِ لحن طولانی است' }) style?: string;
  @IsOptional() @IsString() @MaxLength(3000, { message: 'دستورِ منشی طولانی است' }) persona?: string;
}

/** آزمایشگاهِ صدای منشی — سطحِ ادمین داخلِ سرویس چک می‌شود؛ چیزی ذخیره نمی‌شود. */
@Controller('ai/voice-lab')
@UseGuards(JwtAuthGuard)
export class VoiceLabController {
  constructor(private readonly lab: VoiceLabService) {}

  @Get('models')
  models(@CurrentUser() user: any) {
    return this.lab.models(user);
  }

  @HttpCode(200)
  @Post('speak')
  speak(@Body() dto: VoiceLabSpeakDto, @CurrentUser() user: any) {
    return this.lab.speak(user, dto);
  }
}
