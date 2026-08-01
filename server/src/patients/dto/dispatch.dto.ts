import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { ASSIGN_ROLES, JOB_ROLES } from '../dispatch.service';

export class AssignDto {
  @Type(() => Number) @IsInt({ message: 'کاربرِ انتخابی نامعتبر است' })
  accountId!: number;

  /// فقط راننده و پیک؛ کارشناس روی خودِ مراجعه انتخاب می‌شود.
  @IsIn(ASSIGN_ROLES as unknown as string[], {
    message: 'نقشِ تخصیص فقط راننده یا پیک است؛ کارشناس از فرمِ خودِ مراجعه انتخاب می‌شود',
  })
  role!: string;

  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class JobRoleDto {
  /// رشتهٔ خالی یعنی «نقشِ شغلی ندارد».
  @IsOptional() @IsIn([...JOB_ROLES, ''] as unknown as string[], { message: 'نقشِ شغلی نامعتبر است' })
  jobRole?: string | null;
}
