import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

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

/** سپردنِ دارایی به بیمارستان. */
export class ConsignDto {
  @Type(() => Number) @IsInt({ message: 'بیمارستان را انتخاب کنید' }) hospitalId!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1, { message: 'دورهٔ صورت‌برداری باید دستِ‌کم ۱ روز باشد' }) countEveryDays?: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class CountLineDto {
  @IsString() @MinLength(1, { message: 'عنوانِ قلم را وارد کنید' }) @MaxLength(120) label!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) expected?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) counted?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) used?: number;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

/** یک صورت‌برداریِ دوره‌ای. */
export class CountDto {
  @IsOptional() @IsISO8601({}, { message: 'تاریخِ صورت‌برداری نامعتبر است' }) countedAt?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @IsArray() @ArrayMaxSize(300, { message: 'تعدادِ قلم‌ها زیاد است' })
  @ValidateNested({ each: true }) @Type(() => CountLineDto)
  lines!: CountLineDto[];
}
