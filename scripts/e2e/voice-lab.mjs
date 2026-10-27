/**
 * آزمایشگاهِ صدای منشی (تنظیمات ← دستیارِ هوشِ مصنوعی) — با سرویسِ ساختگیِ سازگار با OpenAI:
 *
 * - فهرستِ مدل‌ها جدا برای صدا و گفتگو، با پیش‌فرض‌های همین شرکت.
 * - «خواندن»: متن بی‌تغییر به `/audio/speech` می‌رود، با دستورِ لحن، صدا و سرعت.
 * - «جوابِ منشی»: مدلِ استدلال لحن و دستورِ منشی را در system می‌بیند و جوابش خوانده می‌شود.
 * - مدلی که دستورِ لحن را رد کند: یک بار بدونِ آن، و صادقانه در `notes`.
 * - سطحِ ۴ ۴۰۳ و بی‌توکن ۴۰۱؛ و در مرورگر کارتِ سطحِ ۴ اصلاً دیده نمی‌شود.
 * - مرورگر: ساختن، پخش‌کننده و «دانلودِ همین صدا»؛ عکسِ هر دو تم و موبایل.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { browserLogin } from './lib/browser-login.mjs';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const UI = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
const SHOTS = process.env.E2E_SHOTS;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const tag = 'vl' + randomBytes(3).toString('hex');
/* MP3ِ ساختگی — فقط باید از ۲۰۰ بایت بزرگ‌تر و غیرِ JSON باشد. */
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(600, 7)]);

const calls = [];
const mock = http.createServer((req, res) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    const body = data ? JSON.parse(data) : {};
    calls.push({ url: req.url, body, auth: req.headers.authorization });
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: ['gemini-x-tts', 'no-style-tts', 'chat-a', 'whisper-1', 'text-embedding-3'].map((id) => ({ id })) }));
    }
    if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { content: `**بله، فردا ساعتِ ده وقت داریم.** ${tag}` }, finish_reason: 'stop' }] }));
    }
    if (req.url === '/v1/audio/speech') {
      if (body.model === 'no-style-tts' && body.instructions) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'unknown parameter: instructions' } }));
      }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      return res.end(MP3);
    }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const MOCK = `http://127.0.0.1:${mock.address().port}/v1`;

const loginAs = (identifier, password) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }),
}).then((r) => r.json());
const login = await loginAs('admin', 'test1234');
if (!login.accessToken) { console.error('ورود نشد'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const send = (p, m, b, headers = A) => fetch(API + p, { method: m, headers, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const setAi = (values) => send('/settings', 'PATCH', { values });

try {
  await setAi({ ai_base_url: MOCK, ai_api_key: `key-${tag}`, ai_model: 'chat-a', ai_model_tts: 'gemini-x-tts' });

  console.log('۱) فهرستِ مدل‌ها');
  const m = await send('/ai/voice-lab/models', 'GET');
  ok(m.status === 200, `پاسخ ${m.status}`);
  ok(JSON.stringify(m.json?.tts) === JSON.stringify(['gemini-x-tts', 'no-style-tts']), 'مدل‌های صدا جدا شدند');
  ok(m.json?.chat?.includes('chat-a') && !m.json.chat.includes('whisper-1') && !m.json.chat.includes('text-embedding-3'), 'مدل‌های گفتگو بی‌ویسپر و بی‌embedding');
  ok(m.json?.defaults?.tts === 'gemini-x-tts' && m.json?.defaults?.chat === 'chat-a', 'پیش‌فرض‌ها از تنظیماتِ شرکت');
  ok(calls.some((c) => c.url === '/v1/models' && c.auth === `Bearer key-${tag}`), 'کلیدِ شرکت فرستاده شد');

  console.log('\n۲) خواندنِ همین متن');
  calls.length = 0;
  const r1 = await send('/ai/voice-lab/speak', 'POST', { mode: 'read', text: 'سلام، به مطب خوش آمدید.', voice: 'coral', speed: 1.2, style: `لحنِ گرم ${tag}` });
  ok(r1.status === 200, `پاسخ ${r1.status} ${r1.json?.message ?? ''}`);
  const sp1 = calls.find((c) => c.url === '/v1/audio/speech')?.body;
  ok(sp1?.input === 'سلام، به مطب خوش آمدید.' && sp1?.model === 'gemini-x-tts' && sp1?.voice === 'coral' && sp1?.speed === 1.2, 'متن، مدل، صدا و سرعت رسید');
  ok(sp1?.instructions === `لحنِ گرم ${tag}`, 'دستورِ لحن رسید');
  ok(!calls.some((c) => c.url === '/v1/chat/completions'), 'در حالتِ خواندن مدلِ استدلال صدا زده نمی‌شود');
  ok(Buffer.from(r1.json?.audio ?? '', 'base64').equals(MP3) && r1.json?.mime === 'audio/mpeg', 'صدای برگشتی همان بایت‌هاست');

  console.log('\n۳) جوابِ منشی');
  calls.length = 0;
  const r2 = await send('/ai/voice-lab/speak', 'POST', {
    mode: 'reply', text: 'برای فردا وقت دارید؟', chatModel: 'chat-a', style: `لحنِ آرام ${tag}`, persona: `ساعتِ کاری ۹ تا ۱۷ ${tag}`,
  });
  ok(r2.status === 200, `پاسخ ${r2.status} ${r2.json?.message ?? ''}`);
  const ch = calls.find((c) => c.url === '/v1/chat/completions')?.body;
  const sys = ch?.messages?.[0]?.content ?? '';
  ok(ch?.model === 'chat-a' && ch?.messages?.[1]?.content === 'برای فردا وقت دارید؟', 'سؤال به مدلِ استدلال رسید');
  ok(sys.includes(`لحنِ آرام ${tag}`) && sys.includes(`ساعتِ کاری ۹ تا ۱۷ ${tag}`), 'لحن و دستورِ منشی در system');
  ok(r2.json?.text === `بله، فردا ساعتِ ده وقت داریم. ${tag}`, 'علامتِ مارک‌داون از جواب پاک شد');
  ok(calls.find((c) => c.url === '/v1/audio/speech')?.body?.input === r2.json?.text, 'همان جواب خوانده شد');
  ok(typeof r2.json?.ms?.chat === 'number' && typeof r2.json?.ms?.tts === 'number', 'زمانِ هر بخش برگشت');

  console.log('\n۴) مدلی که دستورِ لحن را نمی‌پذیرد');
  calls.length = 0;
  const r3 = await send('/ai/voice-lab/speak', 'POST', { mode: 'read', text: 'آزمون', ttsModel: 'no-style-tts', style: 'گرم' });
  ok(r3.status === 200, `پاسخ ${r3.status}`);
  ok(calls.filter((c) => c.url === '/v1/audio/speech').length === 2, 'یک بار دوباره، بدونِ لحن');
  ok(r3.json?.notes?.some((n) => n.includes('دستورِ لحن')), 'یادداشتِ صادقانه برگشت');

  console.log('\n۵) دروازه‌ها');
  ok((await send('/ai/voice-lab/speak', 'POST', { mode: 'read', text: '' })).status === 400, 'متنِ خالی ۴۰۰');
  ok((await send('/ai/voice-lab/speak', 'POST', { mode: 'sing', text: 'x' })).status === 400, 'حالتِ نامعتبر ۴۰۰');
  const anon = await fetch(API + '/ai/voice-lab/models').then((r) => r.status);
  ok(anon === 401, `بی‌توکن ${anon}`);
  sql(`WITH pr AS (INSERT INTO people (first_name, last_name) VALUES ('سوپروایزرِ', '${tag}') RETURNING id)
       INSERT INTO accounts (username, password_hash, level, status, person_id)
       SELECT '${tag}u', '$2a$10$VFAPklsJPGax940crODU7O5vdzw2Pny43m/rNCXtTwnDx1YwjVOnu', 4, 'active', id FROM pr`);
  const low = await loginAs(`${tag}u`, 'test1234');
  const LH = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + low.accessToken };
  ok((await send('/ai/voice-lab/models', 'GET', null, LH)).status === 403, 'سطحِ ۴ فهرست را نمی‌گیرد');
  ok((await send('/ai/voice-lab/speak', 'POST', { mode: 'read', text: 'x' }, LH)).status === 403, 'سطحِ ۴ صدا نمی‌سازد');

  console.log('\n۶) مرورگر');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  try {
    for (const [theme, width] of [['dark', 1100], ['light', 1100], ['light', 390]]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
      await ctx.addInitScript((t) => { try { localStorage.setItem('amalyar_theme', t); localStorage.removeItem('amalyar.voiceLab'); } catch { /* حالتِ ناشناس */ } }, theme);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await browserLogin(page, login.accessToken, { ui: UI });
      await page.goto(UI + '/app/settings');
      const btn = page.locator('.vl > .st-aiguide-btn');
      await btn.waitFor({ timeout: 15000 });
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await page.locator('.vl-body').waitFor();
      ok(await page.locator('.vl-body input[list="vl-tts"]').inputValue() === 'gemini-x-tts', `${theme}/${width}: مدلِ پیش‌فرضِ شرکت در کادر`);
      await page.locator('.vl-mode button', { hasText: 'جوابِ منشی' }).click();
      ok(await page.locator('.vl-body input[list="vl-chat"]').isVisible(), `${theme}/${width}: کادرِ مدلِ استدلال در حالتِ جواب`);
      await page.locator('.vl-body textarea').last().fill('برای فردا وقت دارید؟');
      await page.locator('.vl-acts .df-save').click();
      await page.locator('.vl-out audio').waitFor({ timeout: 15000 });
      ok((await page.locator('.vl-said').innerText()).includes(tag), `${theme}/${width}: جوابِ منشی نشان داده شد`);
      const dl = page.locator('.vl-dl');
      ok((await dl.getAttribute('href'))?.startsWith('blob:') && (await dl.getAttribute('download'))?.endsWith('.mp3'), `${theme}/${width}: لینکِ دانلود با نامِ فایل`);
      const [down] = await Promise.all([page.waitForEvent('download'), dl.click()]);
      /* نامِ پیشنهادیِ کرومیومِ بی‌سر در محیطِ غیرِ UTF-8 «download» می‌شود؛ ملاک صفتِ `download` است. */
      ok((await dl.getAttribute('download')).startsWith('بله') && (await down.path()) !== null, `${theme}/${width}: فایل دانلود شد، نامش چند کلمهٔ اولِ متن`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(overflow <= 1, `${theme}/${width}: بی‌اسکرولِ افقی (${overflow})`);
      if (SHOTS) await page.locator('.vl').screenshot({ path: `${SHOTS}/voice-lab-${theme}-${width}.png` });
      ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : `${theme}/${width}: بدونِ خطای JS`);
      await ctx.close();
    }

    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await ctx.newPage();
    await browserLogin(page, low.accessToken, { ui: UI });
    const seen = page.waitForResponse((r) => r.url().includes('/ai/voice-lab/models'), { timeout: 15000 }).catch(() => null);
    await page.goto(UI + '/app/settings');
    await seen;
    await page.waitForFunction(() => !document.querySelector('.vl'), null, { timeout: 5000 }).catch(() => {});
    ok(await page.locator('.vl').count() === 0, 'سطحِ ۴ کارتِ آزمایشگاه را نمی‌بیند');
    await ctx.close();
  } finally {
    await browser.close();
  }
} finally {
  mock.close();
  await setAi({ ai_base_url: '', ai_api_key: '', ai_model: '', ai_model_tts: '' }).catch(() => {});
  sql(`DELETE FROM account_sessions WHERE account_id IN (SELECT id FROM accounts WHERE username='${tag}u')`);
  sql(`DELETE FROM accounts WHERE username='${tag}u'`);
  sql(`DELETE FROM people WHERE last_name='${tag}'`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
