import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * **خودسنجیِ ماندگاریِ فایل‌ها** — جوابِ «فایل‌های آپلودی بعد از دیپلوی می‌مانند؟» بدونِ آزمونِ دستی.
 *
 * زمینه (گزارشِ آمادگیِ فروش، بندِ ۱): `StorageService` روی `STORAGE_ROOT || cwd/storage` می‌نویسد و ایمیج
 * `VOLUME` ندارد؛ ماندگاری فقط به volumeای بستگی دارد که در Coolify سوار شده. اگر مسیر درست سوار نشده باشد
 * هر دیپلوی کانتینر را عوض می‌کند و **همهٔ** عکس‌ها و مدارکِ بیماران بی‌صدا از بین می‌رود — بدونِ هیچ خطایی.
 *
 * دو شاهد، چون هیچ‌کدام تنها کافی نیست:
 *  ۱. **سوارشدنِ جدا** (`/proc/self/mountinfo`): ریشه روی mountای غیر از `/` است؟ (یعنی volume/bind-mount.)
 *     فوری است ولی «اثبات» نیست — ممکن است volume اشتباهی سوار شده باشد.
 *  ۲. **دفترِ کانتینرها** (`<root>/.ledger/containers.json`): هر کانتینر در بوت نامِ میزبانِ خودش
 *     (Docker برای هر کانتینرِ تازه یکی می‌دهد) را به دفتری که **روی همین ریشه** است اضافه می‌کند. اگر دفترِ
 *     یک کانتینرِ قبلی هنوز آن‌جاست، یعنی ریشه از یک دیپلوی به دیپلوی بعد زنده مانده — **اثبات**. دو کانتینر یا
 *     بیشتر در دفتر = ماندگار.
 *
 * ⚠️ دفتر **روی خودِ ریشه** نوشته می‌شود، نه در دیتابیس: دیتابیس از volume فایل‌ها جداست و اگر volume فایل‌ها عوض
 * شود دیتابیس همچنان «سالم» می‌گفت. دفترِ همراهِ فایل‌ها با آن‌ها می‌ماند یا با آن‌ها می‌رود.
 */

export const storageRoot = () => process.env.STORAGE_ROOT || join(process.cwd(), 'storage');

const LEDGER_DIR = '.ledger';
const LEDGER_FILE = 'containers.json';
const MAX_SEEN = 50;

export interface LedgerEntry { id: string; at: string }
export interface Ledger { v: 1; first: string; seen: LedgerEntry[] }

/** شناسهٔ این پروسه — نامِ میزبانِ کانتینر؛ هر دیپلوی کانتینرِ تازه و نامِ تازه دارد. */
export const bootId = () => hostname();

/** دفترِ خوانده‌شده؛ فایلِ نبود یا خراب = دفترِ تازه (هرگز خطا نمی‌دهد). */
export function parseLedger(raw: string | null, now: Date): Ledger {
  try {
    const j = raw ? JSON.parse(raw) : null;
    if (j && j.v === 1 && Array.isArray(j.seen) && typeof j.first === 'string') {
      const seen = j.seen
        .filter((e: any) => e && typeof e.id === 'string' && e.id && typeof e.at === 'string')
        .slice(-MAX_SEEN);
      return { v: 1, first: j.first, seen };
    }
  } catch { /* دفترِ خراب = تازه */ }
  return { v: 1, first: now.toISOString(), seen: [] };
}

/** `id` را به دفتر اضافه می‌کند (تکراری نه). */
export function withBoot(ledger: Ledger, id: string, now: Date): Ledger {
  if (ledger.seen.some((e) => e.id === id)) return ledger;
  return { ...ledger, seen: [...ledger.seen, { id, at: now.toISOString() }].slice(-MAX_SEEN) };
}

/**
 * mountِ حاوی `path`: طولانی‌ترین `mount point`ی که پیشوندِ آن است. `mountinfo` یک خط به‌ازای هر mount:
 * `id parent major:minor root mountpoint opts [optional…] - fstype source superopts`.
 */
export function mountFor(path: string, mountinfo: string): { mountPoint: string; fsType: string } | null {
  let best: { mountPoint: string; fsType: string } | null = null;
  for (const line of mountinfo.split('\n')) {
    const parts = line.split(' ');
    const dash = parts.indexOf('-');
    if (parts.length < 10 || dash < 6) continue;
    /* فاصله و کاراکترهای ویژهٔ مسیر در mountinfo به‌صورت \040 و … escape می‌شوند. */
    const mountPoint = parts[4].replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
    const fsType = parts[dash + 1] ?? '';
    const covers = mountPoint === '/' || path === mountPoint || path.startsWith(mountPoint.endsWith('/') ? mountPoint : `${mountPoint}/`);
    if (covers && (!best || mountPoint.length >= best.mountPoint.length)) best = { mountPoint, fsType };
  }
  return best;
}

export type StorageVerdict = 'ok' | 'unproven' | 'ephemeral' | 'broken' | 'dev';

export interface StorageHealth {
  verdict: StorageVerdict;
  /** برای پنلِ پلتفرم (فقط مدیرِ پلتفرم می‌بیند). */
  root: string;
  writable: boolean;
  /** `null` = نشد تشخیص داد (غیرِ لینوکس). */
  separateMount: boolean | null;
  mountPoint: string | null;
  fsType: string | null;
  deploys: number;
  firstSeenAt: string | null;
  lastDeployAt: string | null;
  message: string;
}

/**
 * حکم از روی شواهد — **خالص** تا سنجه هر ترکیب را بی‌دیسک بسنجد.
 *
 *  - قابل‌نوشتن نیست ← `broken` (هر آپلود شکست می‌خورد).
 *  - دو کانتینر یا بیشتر در دفتر ← `ok` (اثبات: ریشه از دیپلوی گذشته است).
 *  - جدا سوار است ولی هنوز یک کانتینر ← `unproven` (volume هست؛ اثبات با دیپلوی بعدی).
 *  - جدا سوار نیست و یک کانتینر ← در production `ephemeral` (فایل‌ها با دیپلوی بعدی پاک می‌شوند)،
 *    بیرون از production `dev` (سندباکس/توسعه — نگرانی نیست).
 */
export function judgeStorage(e: {
  writable: boolean; separateMount: boolean | null; deploys: number; production: boolean;
}): { verdict: StorageVerdict; message: string } {
  if (!e.writable) return { verdict: 'broken', message: 'ریشهٔ ذخیره‌سازی قابلِ نوشتن نیست؛ هیچ آپلودی ذخیره نمی‌شود' };
  if (e.deploys >= 2) {
    return { verdict: 'ok', message: `فایل‌ها پس از دیپلوی ماندگارند (${e.deploys} کانتینرِ متفاوت این پوشه را دیده‌اند)` };
  }
  if (e.separateMount) {
    return { verdict: 'unproven', message: 'پوشهٔ فایل‌ها روی volume جداست؛ ماندگاری با دیپلوی بعدی اثبات می‌شود' };
  }
  if (e.production) {
    return {
      verdict: 'ephemeral',
      message: e.separateMount === null
        ? 'سوارشدنِ پوشهٔ فایل‌ها قابل‌تشخیص نبود و دیپلویی هنوز آن را اثبات نکرده — volumeِ /app/storage را در Coolify بررسی کنید'
        : 'پوشهٔ فایل‌ها روی volume نیست؛ با دیپلوی بعدی همهٔ فایل‌های آپلودی پاک می‌شود — در Coolify یک volume روی /app/storage سوار کنید',
    };
  }
  return { verdict: 'dev', message: 'محیطِ توسعه — ماندگاری سنجیده نمی‌شود' };
}

async function readMountinfo(): Promise<string> {
  try { return await readFile('/proc/self/mountinfo', 'utf8'); } catch { return ''; }
}

async function writeLedger(root: string, ledger: Ledger) {
  const dir = join(root, LEDGER_DIR);
  await mkdir(dir, { recursive: true });
  const target = join(dir, LEDGER_FILE);
  const tmp = `${target}.${randomUUID()}.part`;
  try {
    await writeFile(tmp, JSON.stringify(ledger));
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

async function readLedgerRaw(root: string): Promise<string | null> {
  try { return await readFile(join(root, LEDGER_DIR, LEDGER_FILE), 'utf8'); } catch { return null; }
}

/** در بوت صدا زده می‌شود: کانتینرِ جاری را در دفتر ثبت می‌کند. **هرگز بوت را نمی‌شکند.** */
export async function touchStorageLedger(root = storageRoot(), now = new Date(), id = bootId()): Promise<Ledger | null> {
  try {
    const ledger = withBoot(parseLedger(await readLedgerRaw(root), now), id, now);
    await writeLedger(root, ledger);
    return ledger;
  } catch {
    return null;
  }
}

/** یک نوشتنِ آزمایشی و خواندنِ دوباره — «قابلِ نوشتن» یعنی واقعاً برگشت، نه فقط `access()`. */
async function probeWritable(root: string): Promise<boolean> {
  const file = join(root, LEDGER_DIR, `probe-${randomUUID()}.tmp`);
  try {
    await mkdir(join(root, LEDGER_DIR), { recursive: true });
    const token = randomUUID();
    await writeFile(file, token);
    return (await readFile(file, 'utf8')) === token;
  } catch {
    return false;
  } finally {
    await rm(file, { force: true }).catch(() => undefined);
  }
}

export async function storageHealth(root = storageRoot(), now = new Date()): Promise<StorageHealth> {
  const writable = await probeWritable(root);
  const ledger = parseLedger(await readLedgerRaw(root), now);
  /* ریشه ممکن است symlink باشد؛ mount را برای مسیرِ واقعی می‌خواهیم. */
  const real = await realpath(root).catch(() => root);
  const mountinfo = await readMountinfo();
  const mount = mountinfo ? mountFor(real, mountinfo) : null;
  const separateMount = mount ? mount.mountPoint !== '/' : null;
  const deploys = ledger.seen.length;
  const { verdict, message } = judgeStorage({
    writable, separateMount, deploys, production: process.env.NODE_ENV === 'production',
  });
  return {
    verdict, root, writable, separateMount,
    mountPoint: mount?.mountPoint ?? null, fsType: mount?.fsType ?? null,
    deploys, firstSeenAt: deploys ? ledger.first : null,
    lastDeployAt: deploys ? ledger.seen[deploys - 1].at : null,
    message,
  };
}
