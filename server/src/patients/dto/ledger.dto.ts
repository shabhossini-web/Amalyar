import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class BankAccountDto {
  @IsString() @MinLength(2, { message: 'نامِ صاحبِ حساب کوتاه است' }) @MaxLength(80)
  ownerName!: string;

  /// روی فرمِ عمومیِ ثبت‌نام دیده شود؟
  /// ⚠️ باید در DTO باشد وگرنه ValidationPipe با whitelist بی‌صدا دورش می‌ریزد.
  @IsOptional() @IsBoolean() showOnIntake?: boolean;

  @IsOptional() @IsString() @MaxLength(60) bankName?: string;
  @IsOptional() @IsString() @MaxLength(24) cardNumber?: string;
  @IsOptional() @IsString() @MaxLength(34) iban?: string;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;

  /// اگر حسابِ شخصیِ یک شریک است.
  @IsOptional() @Type(() => Number) @IsInt({ message: 'شریکِ انتخابی نامعتبر است' })
  partnerId?: number;
}

export class ExpenseCreateDto {
  @IsString() @MinLength(2, { message: 'عنوانِ هزینه کوتاه است' }) @MaxLength(120)
  title!: string;

  @Type(() => Number) @IsInt({ message: 'مبلغ باید عددِ صحیح باشد' }) @Min(1, { message: 'مبلغ باید بیشتر از صفر باشد' })
  amount!: number;

  @IsOptional() @ValidateIf((o) => o.spentAt !== '')
  @IsISO8601({}, { message: 'تاریخِ هزینه نامعتبر است' })
  spentAt?: string;

  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'حسابِ انتخابی نامعتبر است' })
  bankAccountId?: number;

  /// ⚠️ اگر شریکی از جیبِ خودش داده، همین‌جا ثبت شود؛ بدهیِ بقیه خودکار می‌آید.
  @IsOptional() @Type(() => Number) @IsInt({ message: 'شریکِ انتخابی نامعتبر است' })
  paidById?: number;
}

export class SettleDto {
  @Type(() => Number) @IsInt({ message: 'پرداخت‌کننده نامعتبر است' })
  fromPartnerId!: number;

  @Type(() => Number) @IsInt({ message: 'دریافت‌کننده نامعتبر است' })
  toPartnerId!: number;

  @Type(() => Number) @IsInt({ message: 'مبلغ باید عددِ صحیح باشد' }) @Min(1, { message: 'مبلغ باید بیشتر از صفر باشد' })
  amount!: number;

  @IsOptional() @ValidateIf((o) => o.entryDate !== '')
  @IsISO8601({}, { message: 'تاریخ نامعتبر است' })
  entryDate?: string;

  @IsOptional() @IsString() @MaxLength(200) description?: string;
}
