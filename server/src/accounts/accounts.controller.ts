import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LevelGuard } from '../auth/level.guard';
import { MinLevel } from '../auth/min-level.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { LEVEL } from '../common/levels';
import { ApproveDto } from './dto/approve.dto';

// مدیریتِ کاربران — فقط سوپرادمین (سطح ۶)
@Controller('accounts')
@UseGuards(JwtAuthGuard, LevelGuard)
@MinLevel(LEVEL.SUPER_ADMIN)
export class AccountsController {
  constructor(private accounts: AccountsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.accounts.list(status);
  }

  @Get('pending')
  pending() {
    return this.accounts.list('pending');
  }

  @Post(':id/approve')
  approve(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveDto,
    @CurrentUser() user: any,
  ) {
    return this.accounts.approve(id, dto.level, user.id);
  }

  @Post(':id/reject')
  reject(@Param('id', ParseIntPipe) id: number) {
    return this.accounts.reject(id);
  }

  @Post(':id/level')
  setLevel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveDto,
    @CurrentUser() user: any,
  ) {
    return this.accounts.setLevel(id, dto.level, user?.id);
  }
}
