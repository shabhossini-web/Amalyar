import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';

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
