import { SetMetadata } from '@nestjs/common';

export const MIN_LEVEL_KEY = 'minLevel';
/** حداقل سطحِ دسترسیِ لازم برای این مسیر (۱..۶) */
export const MinLevel = (level: number) => SetMetadata(MIN_LEVEL_KEY, level);
