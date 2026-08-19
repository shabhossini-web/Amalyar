import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LevelGuard } from '../auth/level.guard';
import { MinLevel } from '../auth/min-level.decorator';
import { LEVEL } from '../common/levels';
import { CurrentUser } from '../auth/current-user.decorator';
import { LettersService } from './letters.service';

class LetterCreateDto {
  @IsString({ message: 'گیرنده را بنویسید' }) @MinLength(2, { message: 'گیرنده کوتاه است' }) @MaxLength(200) recipient!: string;
  @IsString({ message: 'موضوع را بنویسید' }) @MinLength(2, { message: 'موضوع کوتاه است' }) @MaxLength(300) subject!: string;
  @IsString({ message: 'متنِ نامه خالی است' }) @MinLength(2, { message: 'متنِ نامه کوتاه است' }) body!: string;
  @IsOptional() @IsString() @MaxLength(300) attachment?: string;
}

class LetterPatchDto {
  @IsOptional() @IsString() @MinLength(2, { message: 'گیرنده کوتاه است' }) @MaxLength(200) recipient?: string;
  @IsOptional() @IsString() @MinLength(2, { message: 'موضوع کوتاه است' }) @MaxLength(300) subject?: string;
  @IsOptional() @IsString() @MinLength(2, { message: 'متنِ نامه کوتاه است' }) body?: string;
  @IsOptional() @IsString() @MaxLength(300) attachment?: string | null;
}

/**
 * نامهٔ اداری — سندِ رسمیِ شرکت؛ همان سطحی که فاکتورِ رسمی می‌زند (ادمین، ۵+).
 * چاپ سمتِ کلاینت روی سربرگِ آپلودشدهٔ تنظیمات انجام می‌شود.
 */
@Controller('letters')
@UseGuards(JwtAuthGuard, LevelGuard)
@MinLevel(LEVEL.ADMIN)
export class LettersController {
  constructor(private readonly svc: LettersService) {}

  @Get()
  list(@Query('t') t?: string) {
    return this.svc.list(t);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.svc.get(id);
  }

  @Post()
  create(@Body() dto: LetterCreateDto, @CurrentUser() user: any) {
    return this.svc.create(dto, user);
  }

  @Patch(':id')
  patch(@Param('id', ParseIntPipe) id: number, @Body() dto: LetterPatchDto, @CurrentUser() user: any) {
    return this.svc.patch(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.svc.remove(id, user);
  }
}
