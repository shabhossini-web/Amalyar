import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';

/** همهٔ مجوزهای اعلام‌شده باید برقرار باشند. نبود decorator روی route حساس مجاز نیست. */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
