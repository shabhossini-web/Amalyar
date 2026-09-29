import {
  Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ChatService } from './chat.service';

class DmDto {
  @Type(() => Number) @IsInt({ message: 'همکار را انتخاب کنید' })
  accountId!: number;
}

class GroupDto {
  @IsString({ message: 'نامِ گروه را بنویسید' }) @MinLength(2, { message: 'نامِ گروه کوتاه است' }) @MaxLength(80)
  name!: string;

  @IsArray({ message: 'عضوها را انتخاب کنید' })
  memberIds!: number[];
}

class SendDto {
  @IsString({ message: 'پیام خالی است' }) @MinLength(1, { message: 'پیام خالی است' }) @MaxLength(4000)
  body!: string;
}

class ReadDto {
  @Type(() => Number) @IsInt()
  lastId!: number;
}

/** چتِ سازمانی — هر حسابِ فعالِ واردشده؛ عضویتِ کانال داخلِ سرویس چک می‌شود. */
@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('directory')
  directory(@CurrentUser() user: any) {
    return this.chat.directory(user);
  }

  @Get('channels')
  channels(@CurrentUser() user: any) {
    return this.chat.channels(user);
  }

  /** شمارِ نخوانده برای نشانِ پوسته — `{ total, channels }`. */
  @Get('unread')
  unread(@CurrentUser() user: any) {
    return this.chat.unread(user);
  }

  @Post('dm')
  dm(@Body() dto: DmDto, @CurrentUser() user: any) {
    return this.chat.dm(user, dto.accountId);
  }

  @Post('groups')
  group(@Body() dto: GroupDto, @CurrentUser() user: any) {
    return this.chat.createGroup(user, dto);
  }

  @Get('channels/:id/messages')
  messages(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Query('afterId') afterId?: string,
    @Query('beforeId') beforeId?: string,
  ) {
    return this.chat.messages(user, id, afterId ? Number(afterId) : undefined, beforeId ? Number(beforeId) : undefined);
  }

  @Post('channels/:id/messages')
  send(@Param('id', ParseIntPipe) id: number, @Body() dto: SendDto, @CurrentUser() user: any) {
    return this.chat.send(user, id, dto.body);
  }

  @HttpCode(200)
  @Post('channels/:id/read')
  read(@Param('id', ParseIntPipe) id: number, @Body() dto: ReadDto, @CurrentUser() user: any) {
    return this.chat.markRead(user, id, dto.lastId);
  }

  /** اتصالِ زنده (SSE) — با fetchِ توکن‌دار خوانده می‌شود، نه EventSource. */
  @Get('stream')
  stream(@CurrentUser() user: any, @Res() res: Response) {
    return this.chat.stream(user, res);
  }
}
