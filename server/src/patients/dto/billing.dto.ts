import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { CHARGE_KINDS, PAYMENT_METHODS, STOCK_EFFECTS } from '../billing.service';

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

  /** لاتِ انبار — فقط و فقط وقتی `stockEffect = consumed` باشد. */
  @IsOptional() @Type(() => Number) @IsInt({ message: 'لاتِ انتخابی نامعتبر است' })
  lotId?: number;

  /**
   * اثرِ قلم روی انبار: `consumed` (از انبارِ ما کم شود) · `virtual` (فقط روی
   * فاکتور) · `hospital` (کالای خودِ بیمارستان). فقط برای `kind = item` معنا
   * دارد؛ برای خدمت و تخفیف سرور خودش virtual می‌گذارد.
   */
  @IsOptional() @IsIn(STOCK_EFFECTS as unknown as string[], { message: 'اثرِ انبار نامعتبر است' })
  stockEffect?: string;

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

  @IsOptional() @Type(() => Number) @IsInt({ message: 'حسابِ انتخابی نامعتبر است' })
  bankAccountId?: number;

  /// اگر پول به حسابِ شخصیِ یک شریک رفت — مبنای دفترِ حسابِ جاری.
  @IsOptional() @Type(() => Number) @IsInt({ message: 'شریکِ انتخابی نامعتبر است' })
  receivedById?: number;

  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}
