import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';

export class LotCreateDto {
  @Type(() => Number) @IsInt({ message: 'کالای انتخابی نامعتبر است' })
  itemId!: number;

  @IsOptional() @IsString() @MaxLength(60, { message: 'شمارهٔ لات طولانی است' })
  lotNo?: string;

  @IsOptional() @IsString() @MaxLength(60, { message: 'شمارهٔ سریال طولانی است' })
  serialNo?: string;

  @IsOptional() @ValidateIf((o) => o.expiresAt !== '')
  @IsISO8601({}, { message: 'تاریخِ انقضا نامعتبر است' })
  expiresAt?: string;

  @IsOptional() @ValidateIf((o) => o.nextServiceAt !== '')
  @IsISO8601({}, { message: 'تاریخِ سرویسِ بعدی نامعتبر است' })
  nextServiceAt?: string;

  @IsOptional() @IsString() @MaxLength(80) location?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;

  /** تعدادِ اولیه — اگر صفر باشد لات بدونِ حرکت ساخته می‌شود. */
  @IsOptional() @Type(() => Number) @IsInt({ message: 'تعداد باید عدد باشد' }) @Min(0, { message: 'تعداد نمی‌تواند منفی باشد' })
  quantity?: number;

  @IsOptional() @IsString() @MaxLength(120) reason?: string;
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
}

export class LotPatchDto {
  @IsOptional() @IsString() @MaxLength(60) lotNo?: string;
  @IsOptional() @IsString() @MaxLength(60) serialNo?: string;
  @IsOptional() @ValidateIf((o) => o.expiresAt !== '')
  @IsISO8601({}, { message: 'تاریخِ انقضا نامعتبر است' })
  expiresAt?: string;
  @IsOptional() @ValidateIf((o) => o.nextServiceAt !== '')
  @IsISO8601({}, { message: 'تاریخِ سرویسِ بعدی نامعتبر است' })
  nextServiceAt?: string;
  @IsOptional() @IsString() @MaxLength(80) location?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class MovementDto {
  @Type(() => Number) @IsInt({ message: 'تعداد باید عدد باشد' }) @Min(1, { message: 'تعداد باید بیشتر از صفر باشد' })
  quantity!: number;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'مراجعهٔ انتخابی نامعتبر است' })
  visitId?: number;

  @IsOptional() @IsString() @MaxLength(120) reason?: string;
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
}

/** انبارگردانی: کاربر «چند تا شمردم» می‌دهد، نه «چقدر کم کن». */
export class AdjustDto {
  @Type(() => Number) @IsInt({ message: 'تعداد باید عدد باشد' }) @Min(0, { message: 'تعداد نمی‌تواند منفی باشد' })
  counted!: number;

  @IsOptional() @IsString() @MaxLength(120) reason?: string;
}

/** یک قلمِ حواله: کدام لات، چند تا. */
export class TransferLineDto {
  @Type(() => Number) @IsInt({ message: 'لاتِ انتخابی نامعتبر است' })
  lotId!: number;

  @Type(() => Number) @IsInt({ message: 'تعداد باید عدد باشد' }) @Min(1, { message: 'تعداد باید بیشتر از صفر باشد' })
  quantity!: number;
}

/**
 * ارسالِ ست.
 *
 * `fromLocation` اختیاری است و پیش‌فرضش محلِ خانهٔ لات — کاربری که ست را از
 * انبارِ همیشگی می‌فرستد نباید مجبور باشد اسمش را تایپ کند.
 */
export class TransferSendDto {
  @IsOptional() @IsBoolean() planOnly?: boolean;
  @IsString() @MinLength(2, { message: 'مقصد را وارد کنید' }) @MaxLength(80, { message: 'نامِ مقصد طولانی است' })
  toLocation!: string;

  @IsOptional() @IsString() @MaxLength(80) fromLocation?: string;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'بیمارستانِ انتخابی نامعتبر است' })
  hospitalId?: number;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'مراجعهٔ انتخابی نامعتبر است' })
  visitId?: number;

  /// روزی که این حواله برای آن است؛ نیامده باشد از تاریخِ عمل برداشته می‌شود.
  @IsOptional() @ValidateIf((o) => o.plannedFor !== '')
  @IsISO8601({}, { message: 'تاریخِ حواله نامعتبر است' })
  plannedFor?: string;

  /// تأییدِ صریحِ کاربر برای صدور با وجودِ تعارضِ رزرو.
  @IsOptional() @IsBoolean() force?: boolean;

  @IsArray({ message: 'قلم‌های حواله نامعتبر است' })
  @ArrayMinSize(1, { message: 'حواله بدونِ قلم معنا ندارد' })
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  lines!: TransferLineDto[];

  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

/** رسیدِ CSR — نامِ تحویل‌گیرنده اجباری است، چون همان چیزی است که سند را سند می‌کند. */
export class TransferReceiveDto {
  @IsString() @MinLength(2, { message: 'نامِ تحویل‌گیرنده را وارد کنید' }) @MaxLength(80)
  receivedBy!: string;
}

/** یک قلمِ برگهٔ مصرف: از این لات، **جمعاً** چند تا مصرف شد. */
export class UsageLineDto {
  @Type(() => Number) @IsInt({ message: 'لاتِ انتخابی نامعتبر است' })
  lotId!: number;

  /// عمداً «جمعِ مصرف‌شده» است نه «چقدر کم کن» — همان قاعدهٔ انبارگردانی.
  @Type(() => Number) @IsInt({ message: 'تعداد باید عدد باشد' }) @Min(0, { message: 'تعداد نمی‌تواند منفی باشد' })
  used!: number;
}

export class TransferUsageDto {
  @IsArray({ message: 'قلم‌های مصرف نامعتبر است' })
  @ArrayMinSize(1, { message: 'حداقل یک قلم لازم است' })
  @ValidateNested({ each: true })
  @Type(() => UsageLineDto)
  lines!: UsageLineDto[];
}

/** اعلامِ پایانیِ کارشناس — یادداشت اختیاری است، خودِ رویداد مهم است. */
export class ReleaseDto {
  @IsOptional() @IsString() @MaxLength(200) note?: string;

  /// ⚠️ این دو باید در DTO باشند وگرنه ValidationPipe با whitelist آن‌ها را
  /// بی‌صدا دور می‌ریزد: کارشناس «ساعت ۵، گذاشتم CSR» می‌فرستد و سرور فقط
  /// یادداشت را می‌بیند — دقیقاً همان چیزی که در آزمونِ چرخه لو رفت.
  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۱۷:۰۰ باشد' })
  pickupAt?: string;

  @IsOptional() @IsString() @MaxLength(60) leftAt?: string;
}

/** یک ردیفِ کسری/خرابیِ برگهٔ شمارشِ تحویل (کارشناس، تحویلِ دوطرفه). */
export class ReceiptLineDto {
  @Type(() => Number) @IsInt({ message: 'لاتِ انتخابی نامعتبر است' })
  lotId!: number;

  @IsString() @MinLength(1, { message: 'عنوانِ قلم را وارد کنید' }) @MaxLength(120, { message: 'عنوانِ قلم طولانی است' })
  label!: string;

  /// کسری یا خرابی — **حساب‌شدهٔ** رابط از «استاندارد − شمردم»، نه عددی که کارشناس تایپ کند.
  @Type(() => Number) @IsInt({ message: 'تعداد باید عدد باشد' }) @Min(0, { message: 'تعداد نمی‌تواند منفی باشد' })
  missing!: number;

  @IsOptional() @IsIn(['missing', 'damaged'], { message: 'نوعِ کسری نامعتبر است' })
  kind?: string;
}

/** «تحویل گرفتم» — بی‌ردیف یعنی سالم؛ با ردیفِ کسری/خرابی یعنی «با مغایرت». */
export class TransferReceiptDto {
  @IsOptional() @IsString() @MaxLength(300, { message: 'یادداشت طولانی است' })
  note?: string;

  @IsOptional() @IsArray({ message: 'ردیف‌های شمارش نامعتبر است' }) @ValidateNested({ each: true }) @Type(() => ReceiptLineDto)
  lines?: ReceiptLineDto[];
}

// ───────────────────────── بستهٔ ب: ست به‌عنوانِ بستهٔ موجودی ─────────────────────────

/** یک قلمِ تکمیل: از این کالا این‌قدر از انبار به ست. */
export class SetFillLineDto {
  @Type(() => Number) @IsInt({ message: 'کالای قلم نامعتبر است' }) @Min(1)
  partId!: number;

  @Type(() => Number) @IsInt({ message: 'تعداد باید عدد باشد' }) @Min(1, { message: 'تعداد باید دستِ‌کم ۱ باشد' })
  quantity!: number;
}

/** تکمیل از انبار — بی‌ردیف یعنی همهٔ کسری‌ها. */
export class SetFillDto {
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SetFillLineDto)
  lines?: SetFillLineDto[];
}

/** خرابی یا برداشتِ یک قلمِ داخلِ ست — از کدام لات، چند تا. */
export class SetMoveDto {
  @Type(() => Number) @IsInt({ message: 'لاتِ قلم نامعتبر است' }) @Min(1)
  partLotId!: number;

  @Type(() => Number) @IsInt({ message: 'تعداد باید عدد باشد' }) @Min(1, { message: 'تعداد باید دستِ‌کم ۱ باشد' })
  quantity!: number;

  @IsOptional() @IsString() @MaxLength(200, { message: 'یادداشت طولانی است' })
  note?: string;
}

/** خرابی در خودِ انبار، اسقاط، تعمیر — تعداد و یادداشت. */
export class QuantityNoteDto {
  @Type(() => Number) @IsInt({ message: 'تعداد باید عدد باشد' }) @Min(1, { message: 'تعداد باید دستِ‌کم ۱ باشد' })
  quantity!: number;

  @IsOptional() @IsString() @MaxLength(200, { message: 'یادداشت طولانی است' })
  note?: string;
}

/** یک ردیفِ شمارشِ برگشتِ ست: این ست، این قلم، چند تا شمردم، چند تا خراب. */
export class ReturnCountLineDto {
  @Type(() => Number) @IsInt({ message: 'ستِ انتخابی نامعتبر است' }) @Min(1)
  lotId!: number;

  @Type(() => Number) @IsInt({ message: 'کالای قلم نامعتبر است' }) @Min(1)
  partId!: number;

  @Type(() => Number) @IsInt({ message: 'تعدادِ شمرده‌شده باید عدد باشد' }) @Min(0, { message: 'تعدادِ شمرده‌شده نمی‌تواند منفی باشد' })
  counted!: number;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'تعدادِ خرابی باید عدد باشد' }) @Min(0, { message: 'تعدادِ خرابی نمی‌تواند منفی باشد' })
  damaged?: number;
}

export class ReturnCountDto {
  @IsOptional() @IsString() @MaxLength(300, { message: 'یادداشت طولانی است' })
  note?: string;

  @IsArray({ message: 'ردیف‌های شمارش نامعتبر است' }) @ArrayMinSize(1, { message: 'دستِ‌کم یک ردیف لازم است' })
  @ValidateNested({ each: true }) @Type(() => ReturnCountLineDto)
  lines!: ReturnCountLineDto[];
}
