import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, rename, rm, stat } from 'fs/promises';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { TenantContext } from '../tenant/tenant-context';

/**
 * ذخیره‌سازیِ فایل روی دیسک، جدا به‌ازای هر شرکت.
 *
 * سه تصمیمِ عمدی:
 *
 * ۱. مسیر **فقط** از TenantContext ساخته می‌شود، هرگز از ورودیِ کاربر. همان
 *    مرزی که برای DB داریم اینجا هم برقرار است، وگرنه یک `../` در نامِ فایل
 *    یعنی خواندنِ مدارکِ شرکتِ دیگر.
 *
 * ۲. نامِ فایل روی دیسک sha256ِ محتواست، نه نامِ کاربر. نامِ کاربر ممکن است
 *    «/» یا «..» یا کاراکترِ نامعتبرِ سیستمِ فایل داشته باشد؛ ضمناً دو آپلودِ
 *    یکسان یک فایل می‌شوند.
 *
 * ۳. نوشتن اول در فایلِ موقت و بعد rename اتمیک است. اگر وسطِ آپلود اتصال قطع
 *    شود، فایلِ نصفه‌ای با نامِ hashِ درست باقی نمی‌ماند که بعداً «سالم» خوانده شود.
 */
@Injectable()
export class StorageService {
  private readonly root = process.env.STORAGE_ROOT || join(process.cwd(), 'storage');

  constructor(private readonly tenantContext: TenantContext) {}

  /** ریشهٔ فایل‌های همین شرکت. tenantId یک UUID است، پس امنِ مسیر است. */
  private tenantRoot(): string {
    const { tenantId } = this.tenantContext.require();
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) {
      throw new InternalServerErrorException('شناسهٔ شرکت برای ذخیره‌سازی نامعتبر است');
    }
    return join(this.root, tenantId);
  }

  /** پخشِ فایل‌ها در زیرشاخه‌های دوحرفی — هزاران فایل در یک پوشه سیستمِ فایل را کند می‌کند. */
  private pathFor(sha256: string): string {
    return join(this.tenantRoot(), sha256.slice(0, 2), sha256);
  }

  /**
   * بافرِ آپلادشده را ذخیره می‌کند و sha256 را برمی‌گرداند.
   * اگر فایلی با همان محتوا از قبل باشد، دوباره نوشته نمی‌شود.
   */
  async save(buffer: Buffer): Promise<{ sha256: string; size: number }> {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const target = this.pathFor(sha256);

    try {
      const existing = await stat(target);
      return { sha256, size: existing.size };
    } catch {
      /* نبود؛ می‌نویسیم */
    }

    await mkdir(join(this.tenantRoot(), sha256.slice(0, 2)), { recursive: true });
    const tmp = `${target}.${randomUUID()}.part`;
    try {
      await pipeline([buffer], createWriteStream(tmp));
      await rename(tmp, target);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
    return { sha256, size: buffer.length };
  }

  /** استریمِ خواندن برای دانلود — کلِ فایل هرگز در حافظه بارگذاری نمی‌شود. */
  stream(sha256: string) {
    return createReadStream(this.pathFor(sha256));
  }

  async exists(sha256: string): Promise<boolean> {
    try {
      await stat(this.pathFor(sha256));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * حذفِ فیزیکی — فقط وقتی صدا زده می‌شود که هیچ رکوردِ دیگری همان sha را نبرد.
   * تصمیمِ «آیا کسِ دیگری استفاده می‌کند» با سرویسِ مدارک است، نه اینجا.
   */
  async remove(sha256: string): Promise<void> {
    await rm(this.pathFor(sha256), { force: true });
  }
}
