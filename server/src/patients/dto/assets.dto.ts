import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class HospitalNeedDto {
  @Type(() => Number) @IsInt({ message: 'کالا را انتخاب کنید' })
  itemId!: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1, { message: 'تعداد باید دستِ‌کم ۱ باشد' })
  quantity?: number;

  @IsOptional() @IsString() @MaxLength(200) notes?: string;
}
