import { SetMetadata } from '@nestjs/common';

export const FEATURE_KEY = 'feature_key';

/// دسترسیِ ماژول از جدولِ features خوانده می‌شود (بدونِ هاردکد) — @Feature('dashboard')
export const Feature = (key: string) => SetMetadata(FEATURE_KEY, key);
