import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * بازیابیِ رمز با کدِ پیامکی (بازبینیِ UX، بندِ ۱۹) — همان «نام کاربری یا موبایل»ِ صفحهٔ ورود.
 * پیام‌ها فارسی (قانونِ ۸)؛ رقمِ فارسی را سرویس لاتین می‌کند.
 */
export class PasswordResetRequestDto {
  @IsString({ message: 'نام کاربری یا شمارهٔ موبایل را بنویسید' })
  @MinLength(3, { message: 'نام کاربری یا شمارهٔ موبایل را کامل بنویسید' })
  @MaxLength(64, { message: 'نام کاربری یا شمارهٔ موبایل بیش از حد بلند است' })
  identifier: string;
}

export class PasswordResetDto extends PasswordResetRequestDto {
  @IsString({ message: 'کدِ تأیید را بنویسید' })
  @Matches(/^[0-9۰-۹]{6}$/, { message: 'کدِ تأیید ۶ رقم است' })
  code: string;

  @IsString({ message: 'رمزِ تازه را بنویسید' })
  @MinLength(6, { message: 'رمزِ تازه دستِ‌کم ۶ نویسه باشد' })
  @MaxLength(128, { message: 'رمزِ تازه بیش از حد بلند است' })
  password: string;
}
