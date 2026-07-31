import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { CONTRACT_KINDS } from '../settlement.service';

export class ContractCreateDto {
  @Type(() => Number) @IsInt({ message: 'جراحِ انتخابی نامعتبر است' })
  surgeonId!: number;

  @IsIn(CONTRACT_KINDS as unknown as string[], { message: 'نوعِ قرارداد نامعتبر است' })
  kind!: string;

  /// فقط برای قراردادِ درصدی — و آن‌وقت اجباری، وگرنه سهم بی‌سروصدا صفر می‌شود.
  @ValidateIf((o) => o.kind === 'percent')
  @Type(() => Number) @IsInt({ message: 'درصد باید عددِ صحیح باشد' })
  @Min(0, { message: 'درصد نمی‌تواند منفی باشد' }) @Max(100, { message: 'درصد نمی‌تواند بیش از ۱۰۰ باشد' })
  percent?: number;

  @ValidateIf((o) => o.kind === 'fixed')
  @Type(() => Number) @IsInt({ message: 'مبلغ باید عددِ صحیح باشد' }) @Min(0, { message: 'مبلغ نمی‌تواند منفی باشد' })
  amount?: number;

  @IsOptional() @ValidateIf((o) => o.effectiveFrom !== '')
  @IsISO8601({}, { message: 'تاریخِ شروع نامعتبر است' })
  effectiveFrom?: string;

  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class PartnerDto {
  @IsString() @MinLength(2, { message: 'نامِ سهامدار کوتاه است' }) @MaxLength(60)
  name!: string;

  @Type(() => Number) @IsInt({ message: 'درصد باید عددِ صحیح باشد' })
  @Min(0, { message: 'درصد نمی‌تواند منفی باشد' }) @Max(100, { message: 'درصد نمی‌تواند بیش از ۱۰۰ باشد' })
  percent!: number;

  @IsOptional() @IsString() @MaxLength(20) color?: string;
}

/// فهرست یک‌جا جایگزین می‌شود: شرطِ «جمعاً ۱۰۰٪» فقط روی کلِ فهرست معنا دارد.
export class PartnersSetDto {
  @IsArray({ message: 'فهرستِ سهامداران نامعتبر است' })
  @ArrayMinSize(1, { message: 'حداقل یک سهامدار لازم است' })
  @ValidateNested({ each: true })
  @Type(() => PartnerDto)
  partners!: PartnerDto[];
}
