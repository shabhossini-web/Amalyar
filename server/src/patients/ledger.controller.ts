import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureGuard } from '../auth/feature.guard';
import { Feature } from '../auth/feature.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permission.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { LedgerService } from './ledger.service';
import { BankAccountDto, ExpenseCreateDto, SettleDto } from './dto/ledger.dto';

/** هزینه‌ها، حساب‌های بانکی و دفترِ حسابِ جاریِ شرکا. */
@Controller()
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionGuard)
@Feature('accounting')
export class LedgerController {
  constructor(private led: LedgerService) {}

  @RequirePermissions('accounting.read')
  @Get('bank-accounts')
  accounts(@Query('all') all?: string) {
    return this.led.accounts(all === '1');
  }

  @RequirePermissions('accounting.manage')
  @Post('bank-accounts')
  addAccount(@Body() dto: BankAccountDto, @CurrentUser() user: any) {
    return this.led.addAccount(dto, user);
  }

  @RequirePermissions('accounting.manage')
  @Patch('bank-accounts/:id/public')
  setPublic(@Param('id', ParseIntPipe) id: number, @Body() dto: { showOnIntake?: boolean }, @CurrentUser() user: any) {
    return this.led.setAccountPublic(id, !!dto.showOnIntake, user);
  }

  @RequirePermissions('accounting.manage')
  @Delete('bank-accounts/:id')
  dropAccount(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.led.disableAccount(id, user);
  }

  @RequirePermissions('accounting.read')
  @Get('expenses')
  expenses(@Query('from') from?: string, @Query('to') to?: string, @Query('category') category?: string) {
    return this.led.expenses({ from: dateOf(from), to: dateOf(to), category });
  }

  @RequirePermissions('accounting.manage')
  @Post('expenses')
  addExpense(@Body() dto: ExpenseCreateDto, @CurrentUser() user: any) {
    return this.led.addExpense(dto, user);
  }

  @RequirePermissions('accounting.manage')
  @Delete('expenses/:id')
  dropExpense(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.led.removeExpense(id, user);
  }

  /// خالصِ هر جفت شریک — «الف چقدر به ب بدهکار است».
  @RequirePermissions('accounting.read')
  @Get('ledger/summary')
  summary() {
    return this.led.summary();
  }

  @RequirePermissions('accounting.read')
  @Get('ledger')
  entries(@Query('status') status?: string) {
    return this.led.entries({ status });
  }

  @RequirePermissions('accounting.manage')
  @Post('ledger/settle')
  settle(@Body() dto: SettleDto, @CurrentUser() user: any) {
    return this.led.settle(dto, user);
  }
}

function dateOf(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
