import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { ASSIGN_ROLES } from '../dispatch.service';

export class AssignDto {
  @Type(() => Number) @IsInt({ message: 'نیروی انتخابی نامعتبر است' })
  staffId!: number;

  /// فقط راننده و پیک؛ کارشناس روی `Visit.techId` نوشته می‌شود.
  @IsIn(ASSIGN_ROLES as unknown as string[], {
    message: 'نقشِ تخصیص فقط راننده یا پیک است؛ کارشناس از تبِ کارشناسِ همین پنل انتخاب می‌شود',
  })
  role!: string;

  @IsOptional() @IsString() @MaxLength(200) note?: string;
}
