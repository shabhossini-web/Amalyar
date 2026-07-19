import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  lastName?: string;

  // dataURL سلفیِ جدید
  @IsOptional()
  @IsString()
  @MinLength(30)
  @MaxLength(3_500_000)
  selfie?: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  current: string;

  @IsString()
  @MinLength(6, { message: 'رمزِ جدید حداقل ۶ کاراکتر' })
  @MaxLength(128)
  next: string;
}
