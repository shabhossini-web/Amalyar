import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { MobileInput } from '../../common/validators';

export class RegisterDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  username?: string;

  @IsOptional()
  @MobileInput()
  @Matches(/^0\d{10}$/, { message: 'شمارهٔ موبایل باید ۱۱ رقم و با ۰ شروع شود' })
  phone?: string;

  @IsString()
  @MinLength(6, { message: 'رمز عبور حداقل ۶ کاراکتر' })
  @MaxLength(128)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;
}
