/**
 * نگهبانِ کلیمِ ایجنت‌ها — ایستا، بی‌سرور، برای CI.
 *
 * پروتکل در `AGENTS.md`. این‌جا فقط دو چیزِ ماشین‌سنجیدنی چک می‌شود:
 *
 *  ۱. **هم‌پوشانیِ مسیر بینِ دو کلیمِ فعال** — یعنی دو ایجنت هم‌زمان یک فایل را
 *     می‌نویسند. این همان چیزی است که به مرجِ دستی و کارِ دوباره ختم می‌شود.
 *  ۲. **کلیمِ بیات** — `active`ی که هفته‌ها مانده یعنی هیچ‌کس دیگر رویش حساب
 *     نمی‌کند و فایل به یک تشریفاتِ بی‌اثر تبدیل شده.
 *
 * ⚠️ نبودِ کلیم خطا نیست: ایجنتی که هنوز چیزی ننوشته نباید CI را قرمز کند.
 *
 * اجرا از ریشهٔ مخزن:  node scripts/verify-claims.js
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.sync';
const STALE_DAYS = 7;
const die = (m) => { console.error(m); process.exit(1); };

if (!fs.existsSync(DIR)) die(`پوشهٔ ${DIR} نیست — پروتکلِ AGENTS.md را ببین`);

const claims = [];
for (const file of fs.readdirSync(DIR).sort()) {
  if (!file.endsWith('.md') || file === 'README.md') continue;
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
  const m = raw.match(/<!--\s*claim:begin\s*-->([\s\S]*?)<!--\s*claim:end\s*-->/);
  if (!m) die(`${DIR}/${file}: بلوکِ claim:begin…claim:end ندارد`);

  const body = m[1];
  const field = (k) => (body.match(new RegExp('^\\s*' + k + ':\\s*(.*)$', 'm'))?.[1] ?? '').trim();
  /* مسیرها یک فهرستِ تودرتوست: از خطِ `paths:` تا اولین خطی که با `-` شروع
     نمی‌شود. فهرستِ خالی کاملاً مجاز است (ایجنتِ بی‌کار). */
  const after = body.slice(body.indexOf('paths:') + 'paths:'.length);
  const paths = after.split('\n').slice(1)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);

  const agent = field('agent');
  const expected = file.replace(/\.md$/, '');
  if (agent !== expected) die(`${DIR}/${file}: مقدارِ agent «${agent}» با نامِ فایل «${expected}» یکی نیست`);
  const status = field('status');
  if (!['active', 'idle'].includes(status)) die(`${DIR}/${file}: status باید active یا idle باشد، نه «${status}»`);
  const since = field('since');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) die(`${DIR}/${file}: since باید YYYY-MM-DD باشد، نه «${since}»`);

  claims.push({ file, agent, status, since, paths, branch: field('branch') });
}
if (!claims.length) die(`${DIR} هیچ کلیمی ندارد`);

/* هم‌پوشانی: مسیرِ پوشه‌ای (با `/` در انتها) پیشوندِ زیرمسیرهایش است. */
const overlaps = (a, b) => a === b
  || (a.endsWith('/') && b.startsWith(a))
  || (b.endsWith('/') && a.startsWith(b));

const active = claims.filter((c) => c.status === 'active');
for (let i = 0; i < active.length; i++) {
  for (let j = i + 1; j < active.length; j++) {
    for (const p of active[i].paths) {
      for (const q of active[j].paths) {
        if (overlaps(p, q)) {
          die(`هم‌پوشانیِ کلیم: «${active[i].agent}» و «${active[j].agent}» هر دو روی «${p}» / «${q}»\n`
            + `یکی باید صبر کند یا مسیرش را تنگ‌تر کند — AGENTS.md بندِ ۲`);
        }
      }
    }
  }
}

const today = new Date();
for (const c of active) {
  const age = Math.floor((today - new Date(c.since + 'T00:00:00Z')) / 86400000);
  if (age > STALE_DAYS) {
    die(`کلیمِ بیات: ${DIR}/${c.file} از ${c.since} فعال مانده (${age} روز).\n`
      + `یا تاریخِ since را تازه کن یا status را idle بگذار — AGENTS.md بندِ ۶`);
  }
}

const shown = claims.map((c) => `${c.agent}:${c.status}${c.paths.length ? `(${c.paths.length})` : ''}`).join(' · ');
console.log(`agent claims ok — ${shown}`);
