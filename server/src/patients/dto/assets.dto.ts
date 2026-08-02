import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class HospitalNeedDto {
  @Type(() => Number) @IsInt({ message: 'کالا را انتخاب کنید' })
  itemId!: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1, { message: 'تعداد باید دستِ‌کم ۱ باشد' })
  quantity?: number;

  @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

/** قلمِ داخلِ ست — یا کالای تعریف‌شده است یا فقط یک نام. */
export class ComponentDto {
  @IsOptional() @IsString() @MaxLength(120) label?: string;
  @IsOptional() @Type(() => Number) @IsInt() partId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1, { message: 'تعداد باید دستِ‌کم ۱ باشد' }) quantity?: number;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

/** کسریِ ست هنگام برگشت. */
export class ShortageDto {
  @Type(() => Number) @IsInt({ message: 'لاتِ انتخابی نامعتبر است' }) lotId!: number;
  @IsString() @MinLength(1, { message: 'عنوانِ قلم را وارد کنید' }) @MaxLength(120) label!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) missing?: number;
  @IsOptional() @IsIn(['missing', 'damaged'], { message: 'نوعِ کسری نامعتبر است' }) kind?: string;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
}
