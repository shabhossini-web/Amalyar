import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { CHARGE_KINDS, PAYMENT_METHODS } from '../billing.service';

export class ChargeCreateDto {
  @IsOptional() @IsIn(CHARGE_KINDS as unknown as string[], { message: 'نوعِ قلم نامعتبر است' })
  kind?: string;

  @IsString() @MinLength(2, { message: 'عنوانِ قلم کوتاه است' }) @MaxLength(120, { message: 'عنوانِ قلم طولانی است' })
  title!: string;

  @IsOptional() @IsInt({ message: 'تعداد باید عدد باشد' }) @Min(1, { message: 'تعداد حداقل ۱ است' })
  quantity?: number;

  // سقف عمداً بالاست: فاکتورِ یک ستِ ایمپلنت به‌راحتی چند صد میلیون تومان می‌شود.
  @IsInt({ message: 'مبلغ باید عددِ صحیح باشد' }) @Min(0, { message: 'مبلغ نمی‌تواند منفی باشد' })
  unitPrice!: number;

  /** کدِ ملیِ خدمت — اگر از کتابِ ارزش نسبی انتخاب شده باشد. */
  @IsOptional() @Matches(/^\d{4,8}$/, { message: 'کدِ خدمت نامعتبر است' })
  serviceCode?: string;

  /** کالای مصرف‌شده از کاتالوگ. */
  @IsOptional() @Type(() => Number) @IsInt({ message: 'کالای انتخابی نامعتبر است' })
  itemId?: number;

  /** لاتِ انبار — اگر بیاید، همین قلم موجودی را کم می‌کند و مصرف ردیابی می‌شود. */
  @IsOptional() @Type(() => Number) @IsInt({ message: 'لاتِ انتخابی نامعتبر است' })
  lotId?: number;

  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class PaymentCreateDto {
  @IsInt({ message: 'مبلغ باید عددِ صحیح باشد' }) @Min(1, { message: 'مبلغِ پرداخت باید بیشتر از صفر باشد' })
  amount!: number;

  @IsOptional() @IsIn(PAYMENT_METHODS as unknown as string[], { message: 'روشِ پرداخت نامعتبر است' })
  method?: string;

  @IsOptional() @ValidateIf((o) => o.paidAt !== '')
  @IsISO8601({}, { message: 'تاریخِ پرداخت نامعتبر است' })
  paidAt?: string;

  @IsOptional() @IsString() @MaxLength(60, { message: 'شمارهٔ پیگیری طولانی است' })
  reference?: string;

  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}
