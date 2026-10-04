import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { RUN_STATUSES, STOP_KINDS } from '../routes.service';

export class RunCreateDto {
  @Type(() => Number) @IsInt({ message: 'نیروی انتخابی نامعتبر است' })
  staffId!: number;

  @IsISO8601({}, { message: 'تاریخِ مسیر نامعتبر است' })
  runDate!: string;

  @IsOptional() @IsString() @MaxLength(60) vehicle?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class RunPatchDto {
  @IsOptional() @IsString() @MaxLength(60) vehicle?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @IsOptional() @IsIn(RUN_STATUSES as unknown as string[], { message: 'وضعیتِ مسیر نامعتبر است' }) status?: string;
}

export class StopCreateDto {
  @IsOptional() @Type(() => Number) @IsInt() hospitalId?: number;
  @IsOptional() @IsString() @MaxLength(80) locationName?: string;

  @IsIn(STOP_KINDS as unknown as string[], { message: 'نوعِ توقف باید تحویل یا جمع‌آوری باشد' })
  kind!: string;

  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' }) plannedAt?: string;
  /// ⚠️ «به چه کسی تحویل داده شود» از همان لحظهٔ چینش. بدونِ این فیلد در
  /// DTO، ValidationPipe مقدارِ ارسالی را بی‌صدا دور می‌ریخت.
  @IsOptional() @IsString() @MaxLength(80) handedTo?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @IsOptional() @IsArray() transferIds?: number[];
}

export class StopPatchDto {
  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' }) plannedAt?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @IsOptional() @IsString() @MaxLength(80) handedTo?: string;
  /// آن‌که واقعاً تحویل گرفت — جدا از برنامه می‌ماند.
  @IsOptional() @IsString() @MaxLength(80) handedActual?: string;
  @IsOptional() @IsBoolean() done?: boolean;
}

/** ثبتِ تحویل توسط خودِ راننده در پرتال. */
/** یک بستهٔ شمرده‌شده هنگامِ جمع‌آوری (بستهٔ ج): این حواله، این لات، چند تا تحویل گرفتم. */
export class PickupCountLineDto {
  @Type(() => Number) @IsInt({ message: 'حوالهٔ قلم نامعتبر است' }) @Min(1)
  transferId!: number;

  @Type(() => Number) @IsInt({ message: 'لاتِ قلم نامعتبر است' }) @Min(1)
  lotId!: number;

  @Type(() => Number) @IsInt({ message: 'تعدادِ شمرده‌شده باید عدد باشد' }) @Min(0, { message: 'تعدادِ شمرده‌شده نمی‌تواند منفی باشد' })
  counted!: number;
}

export class StopDoneDto {
  @IsOptional() @IsString() @MaxLength(80) handedActual?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  /** شمارشِ راننده — فقط روی توقفِ جمع‌آوری معنا دارد؛ روی تحویل نادیده گرفته می‌شود (ستِ استریل شمرده نمی‌شود). */
  @IsOptional() @IsArray({ message: 'شمارش نامعتبر است' }) @ValidateNested({ each: true }) @Type(() => PickupCountLineDto)
  counts?: PickupCountLineDto[];
  @IsOptional() @IsBoolean({ message: 'وضعِ پلمب نامعتبر است' })
  sealIntact?: boolean;
}

export class ReorderDto {
  @IsArray() @ArrayMinSize(1, { message: 'ترتیبِ خالی معنا ندارد' })
  stopIds!: number[];
}

export class AttachDto {
  @IsArray() @ArrayMinSize(1, { message: 'حواله‌ای انتخاب نشده است' })
  transferIds!: number[];
}

/** هزینهٔ یک مسیر — تومان. */
export class RunCostDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0, { message: 'بنزین باید عددِ نامنفی باشد' }) fuelCost?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0, { message: 'دستمزدِ راننده باید عددِ نامنفی باشد' }) driverFee?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0, { message: 'هزینهٔ دیگر باید عددِ نامنفی باشد' }) otherCost?: number;
  @IsOptional() @IsString() @MaxLength(200) costNote?: string;
  /// اگر شریکی از جیبِ خودش داد — همان‌جا بدهیِ بقیه ثبت می‌شود.
  @IsOptional() @Type(() => Number) @IsInt() paidById?: number;
  @IsOptional() @Type(() => Number) @IsInt() bankAccountId?: number;
}
