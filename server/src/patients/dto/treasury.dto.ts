import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { CHEQUE_DIRECTIONS, CHEQUE_STATUSES, PAYOUT_PARTIES } from '../treasury.service';

export class PayoutCreateDto {
  @IsIn(PAYOUT_PARTIES as unknown as string[], { message: 'طرفِ پرداخت نامعتبر است' })
  party!: string;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'شناسهٔ طرف نامعتبر است' })
  partyId?: number;

  @IsString() @MinLength(1) @MaxLength(80) partyName!: string;

  @Type(() => Number) @IsInt({ message: 'مبلغ باید عددِ صحیح باشد' }) @Min(1, { message: 'مبلغ باید بیشتر از صفر باشد' })
  amount!: number;

  @IsOptional() @IsISO8601({}, { message: 'تاریخِ پرداخت نامعتبر است' }) paidAt?: string;
  @IsOptional() @Type(() => Number) @IsInt() bankAccountId?: number;
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class ChequeCreateDto {
  @IsString() @MinLength(2, { message: 'شمارهٔ چک را وارد کنید' }) @MaxLength(40)
  number!: string;

  @IsIn(CHEQUE_DIRECTIONS as unknown as string[], { message: 'جهتِ چک نامعتبر است' })
  direction!: string;

  @IsString() @MinLength(2, { message: 'طرفِ چک را وارد کنید' }) @MaxLength(80)
  partyName!: string;

  @Type(() => Number) @IsInt({ message: 'مبلغ باید عددِ صحیح باشد' }) @Min(1, { message: 'مبلغ باید بیشتر از صفر باشد' })
  amount!: number;

  @IsISO8601({}, { message: 'تاریخِ سررسید نامعتبر است' }) dueAt!: string;

  @IsOptional() @IsString() @MaxLength(60) bankName?: string;
  @IsOptional() @Type(() => Number) @IsInt() bankAccountId?: number;
  @IsOptional() @Type(() => Number) @IsInt() visitId?: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class ChequeStatusDto {
  @IsIn(CHEQUE_STATUSES as unknown as string[], { message: 'وضعیتِ چک نامعتبر است' })
  status!: string;
}

export class FiscalYearDto {
  @IsString() @MinLength(2) @MaxLength(20) title!: string;
  @IsISO8601({}, { message: 'تاریخِ شروع نامعتبر است' }) startsAt!: string;
  @IsISO8601({}, { message: 'تاریخِ پایان نامعتبر است' }) endsAt!: string;
}
