import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min } from 'class-validator';
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
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @IsOptional() @IsArray() transferIds?: number[];
}

export class StopPatchDto {
  @IsOptional() @IsString() @MaxLength(5, { message: 'ساعت باید به شکلِ ۰۸:۳۰ باشد' }) plannedAt?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @IsOptional() @IsString() @MaxLength(80) handedTo?: string;
  @IsOptional() @IsBoolean() done?: boolean;
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
