/**
 * «جایگزینیِ کلمه» در پیامک‌ها — برای وقتی ملی‌پیامک می‌گوید «متن حاوی کلمهٔ فیلترشده است» و کلمه پیدا شده.
 *
 * فهرست یک تنظیمِ متنیِ ساده است (`sms_word_replacements`)، هر خط `کلمه = جایگزین`، تا ادمین بدونِ هیچ
 * رابطِ ویژه‌ای هم ببیندش، ویرایشش کند و حذفش کند. **هنگامِ ارسال** اعمال می‌شود، نه هنگامِ ساختِ ردیف:
 * متنِ ثبت‌شده در دفتر دست‌نخورده می‌ماند و کلیدِ یکتای یادآوری (`reminderKey`، شاملِ هشِ متن) عوض نمی‌شود —
 * وگرنه برداشتنِ یک جایگزینی همان پیامِ رفته را «تازه» می‌دید و دوباره می‌فرستاد.
 *
 * خالص و بی‌Prisma، تا سنجه‌اش یک `node` باشد. تطبیق مثلِ `filter-suspects`: بی‌اعراب، بی‌نیم‌فاصله،
 * «ي/ك» عربی = فارسی.
 */
import { WORD, wordKey } from './filter-suspects';

export interface WordRule { from: string; to: string }

export const MAX_RULES = 40;
export const MAX_RULE_CHARS = 40;
/** لینک و نشانی داخلِ متن کلمهٔ نویسنده نیستند — جایگزینی نباید لینکِ فرم را بشکند. */
const URL_PART = /(https?:\/\/\S+|\S+\.(?:com|ir|net|org)\S*)/gi;
const SINGLE_WORD = new RegExp(`^${WORD.source}$`, 'u');

/** فهرست از متنِ تنظیم. خطِ بی‌«=»، بی‌جایگزین، چندکلمه‌ای یا تکراری بی‌صدا کنار گذاشته می‌شود. */
export function parseWordReplacements(raw: string | null | undefined): WordRule[] {
  const seen = new Set<string>();
  const out: WordRule[] = [];
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    const from = line.slice(0, i).trim();
    const to = line.slice(i + 1).trim();
    if (!from || !to || !SINGLE_WORD.test(from)) continue;
    const key = wordKey(from);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to });
    if (out.length >= MAX_RULES) break;
  }
  return out;
}

const replaceWords = (part: string, map: Map<string, string>) => part.replace(WORD, (m) => map.get(wordKey(m)) ?? m);

/** متنِ نهایی که باید برود. یک گذر است؛ جایگزین دوباره جایگزین نمی‌شود (حلقه ندارد). */
export function applyWordReplacements(text: string, rules: WordRule[]): string {
  if (!text || !rules.length) return text;
  const map = new Map(rules.map((r) => [wordKey(r.from), r.to]));
  return text.split(URL_PART).map((p, i) => (i % 2 ? p : replaceWords(p, map))).join('');
}

/** کدام جایگزینی‌ها روی این متن اثر می‌کنند — برای نشان‌دادنِ «هنگامِ ارسال: الف ← ب» در دفتر. */
export function appliedRules(text: string, rules: WordRule[]): WordRule[] {
  if (!text || !rules.length) return [];
  const byKey = new Map(rules.map((r) => [wordKey(r.from), r]));
  const hit = new Map<string, WordRule>();
  for (const [i, part] of text.split(URL_PART).entries()) {
    if (i % 2) continue;
    for (const m of part.matchAll(WORD)) {
      const r = byKey.get(wordKey(m[0]));
      if (r) hit.set(wordKey(r.from), r);
    }
  }
  return [...hit.values()];
}

/** خطای فارسی برای ورودیِ نامعتبر، یا `null`. */
export function validateWordRule(from: unknown, to: unknown): string | null {
  const f = typeof from === 'string' ? from.trim() : '';
  const t = typeof to === 'string' ? to.trim() : '';
  if (!f || !SINGLE_WORD.test(f)) return 'کلمهٔ فیلترشده باید یک کلمهٔ تنها (فقط حرف) باشد';
  if (f.length > MAX_RULE_CHARS) return `کلمه حداکثر ${MAX_RULE_CHARS} نویسه است`;
  if (!t) return 'جایگزین را بنویسید';
  if (t.length > MAX_RULE_CHARS) return `جایگزین حداکثر ${MAX_RULE_CHARS} نویسه است`;
  if (/[=\r\n]/.test(t)) return 'جایگزین نباید «=» یا خطِ تازه داشته باشد';
  if (wordKey(t) === wordKey(f)) return 'جایگزین باید با خودِ کلمه فرق کند';
  return null;
}

/**
 * یک قاعده را به متنِ تنظیم اضافه یا همان کلمه را عوض می‌کند. خط‌هایی که قاعده نیستند (یادداشتِ ادمین)
 * دست نمی‌خورند. سقفِ تعداد: اگر پر بود خطا — بی‌صدا قدیمی‌ترین را دور نمی‌اندازیم.
 */
export function upsertWordRule(raw: string | null | undefined, from: string, to: string): { value: string; replaced: boolean } {
  const key = wordKey(from);
  let replaced = false;
  const lines = String(raw ?? '').split(/\r?\n/).filter((line) => {
    const i = line.indexOf('=');
    if (i < 0) return true;
    if (wordKey(line.slice(0, i).trim()) !== key) return true;
    replaced = true;
    return false;
  });
  const rule = `${from.trim()} = ${to.trim()}`;
  if (!replaced && parseWordReplacements(lines.join('\n')).length >= MAX_RULES) {
    throw new Error(`فهرستِ جایگزینی پر است (حداکثر ${MAX_RULES} کلمه)؛ از تنظیماتِ پیامک یکی را حذف کنید`);
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return { value: [...lines, rule].join('\n'), replaced };
}

/** تکه‌های متن برای جستجوی دوبخشی — همان تقسیمی که هم سرور هم رابط می‌شناسد. */
export const PROBE_MAX_TOKENS = 128;
export const probeTokens = (text: string): string[] => String(text ?? '').split(/\s+/).filter(Boolean);
