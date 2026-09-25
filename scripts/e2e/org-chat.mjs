/**
 * چتِ سازمانی (#54):
 *
 * - dm یکتا: هر دو جهت همان یک کانال؛ گفتگو با خود/حسابِ غیرفعال 400.
 * - پیام/نخوانده/خوانده: مشتقِ lastReadId؛ پیشنمای آخرین پیام در فهرست.
 * - گروه: ساخت با عضو، پیامِ عضو، نخوانده برای بقیه؛ غیرعضو 404.
 * - SSE: عضوِ وصل، رویدادِ پیامِ تازه را زنده می‌گیرد.
 * - مرورگر: از کاشیِ لانچر — گفتگوی تازه، ارسال، حباب، جوابِ طرفِ مقابل
 *   بدونِ رفرش می‌نشیند (بلادرنگِ واقعی).
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const BASE = process.env.E2E_UI ?? 'http://127.0.0.1:5199';
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };
const sql = (q) => execSync(`psql "${DB}" -qtA`, { input: q }).toString().trim().split('\n')[0];

const tag = 'oc' + randomBytes(3).toString('hex');

const loginAs = (identifier, password) => fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier, password }),
}).then((r) => r.json());

/* همکارِ دوم — سطحِ ۲، فعال. */
sql(`WITH pr AS (INSERT INTO people (first_name, last_name) VALUES ('همکارِ', 'چتی') RETURNING id)
     INSERT INTO accounts (username, password_hash, level, status, person_id)
     SELECT '${tag}b', '$2a$10$VFAPklsJPGax940crODU7O5vdzw2Pny43m/rNCXtTwnDx1YwjVOnu', 2, 'active', id FROM pr`);

const la = await loginAs('admin', 'test1234');
const lb = await loginAs(`${tag}b`, 'test1234');
if (!la.accessToken || !lb.accessToken) { console.error('ورود نشد'); process.exit(1); }
const H = (t) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + t });
const A = H(la.accessToken);
const B = H(lb.accessToken);
const send = (p, m, b, h = A) => fetch(API + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const bId = Number(sql(`SELECT id FROM accounts WHERE username='${tag}b'`));
const aId = Number(sql(`SELECT id FROM accounts WHERE username='admin'`));

const madeChannels = [];

try {
  console.log('۱) گفتگوی دونفرهٔ یکتا');
  const d1 = (await send('/chat/dm', 'POST', { accountId: bId })).json;
  madeChannels.push(d1.id);
  const d2 = (await send('/chat/dm', 'POST', { accountId: aId }, B)).json;
  ok(d1.id === d2.id, `**هر دو جهت همان یک کانال (${d1.id})**`);
  ok((await send('/chat/dm', 'POST', { accountId: aId })).status === 400, 'گفتگو با خودت 400');
  const dirB = (await send('/chat/directory', 'GET', null, B)).json;
  ok(dirB.some((x) => x.id === aId) && !dirB.some((x) => x.id === bId), 'دفترچه بدونِ خودِ کاربر');

  console.log('\n۲) پیام و نخوانده/خوانده');
  const m1 = (await send(`/chat/channels/${d1.id}/messages`, 'POST', { body: `سلام از ادمین ${tag}` })).json;
  ok(m1?.id > 0 && m1.mine === true, 'پیام رفت');
  let chB = (await send('/chat/channels', 'GET', null, B)).json;
  let row = chB.find((x) => x.id === d1.id);
  ok(row?.unread === 1 && row.lastBody.includes('سلام از ادمین'), '**نخوانده=۱ با پیشنمای آخرین پیام**');
  const msgsB = (await send(`/chat/channels/${d1.id}/messages`, 'GET', null, B)).json;
  ok(msgsB.length === 1 && msgsB[0].mine === false && msgsB[0].authorName.length > 1, 'پیام با نامِ نویسنده خوانده شد');
  await send(`/chat/channels/${d1.id}/read`, 'POST', { lastId: m1.id }, B);
  chB = (await send('/chat/channels', 'GET', null, B)).json;
  ok(chB.find((x) => x.id === d1.id)?.unread === 0, '**بعد از خواندن، نخوانده=۰**');

  console.log('\n۳) گروه');
  const g = (await send('/chat/groups', 'POST', { name: `تیمِ ${tag}`, memberIds: [bId] })).json;
  madeChannels.push(g.id);
  ok(g?.id > 0 && g.kind === 'group', `گروه ساخته شد (#${g.id})`);
  const gm = (await send(`/chat/channels/${g.id}/messages`, 'POST', { body: `پیامِ گروهی ${tag}` }, B)).json;
  ok(gm?.id > 0, 'عضوِ گروه پیام داد');
  const chA = (await send('/chat/channels', 'GET', null, A)).json;
  const gRow = chA.find((x) => x.id === g.id);
  ok(gRow?.unread === 1 && gRow.title === `تیمِ ${tag}`, 'برای سازنده نخوانده=۱ با نامِ گروه');
  /* غیرعضو */
  sql(`WITH pr AS (INSERT INTO people (first_name, last_name) VALUES ('غریبهٔ', 'چت') RETURNING id)
       INSERT INTO accounts (username, password_hash, level, status, person_id)
       SELECT '${tag}c', '$2a$10$VFAPklsJPGax940crODU7O5vdzw2Pny43m/rNCXtTwnDx1YwjVOnu', 2, 'active', id FROM pr`);
  const lc = await loginAs(`${tag}c`, 'test1234');
  const denied = await send(`/chat/channels/${g.id}/messages`, 'GET', null, H(lc.accessToken));
  ok(denied.status === 404, `غیرعضو ${denied.status}`);

  console.log('\n۴) SSE — رویدادِ زنده');
  const events = [];
  const ctl = new AbortController();
  const streamDone = (async () => {
    const res = await fetch(API + '/chat/stream', { headers: B, signal: ctl.signal });
    const dec = new TextDecoder();
    let buf = '';
    for await (const c of res.body) {
      buf += dec.decode(c, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const evt = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = evt.split('\n').find((l) => l.startsWith('data: '));
        if (line) { try { events.push(JSON.parse(line.slice(6))); } catch { /* ضربان */ } }
      }
    }
  })().catch(() => {});
  await new Promise((r) => setTimeout(r, 700));
  const m2 = (await send(`/chat/channels/${d1.id}/messages`, 'POST', { body: `زنده ${tag}` })).json;
  await new Promise((r) => setTimeout(r, 1200));
  ok(events.some((e) => e.channelId === d1.id && e.id === m2.id), '**رویدادِ SSE برای عضوِ وصل رسید**');
  ctl.abort();
  await streamDone;

  console.log('\n۵) مرورگر — دو طرفِ واقعی');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(BASE + '/login');
    await page.waitForTimeout(900);
    await page.fill('input[name="identifier"], input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/app**', { timeout: 15000 });

    /* W3.7: `/app` صفحهٔ «امروز» است و لانچرِ کاشی‌ها به `/app/tools` رفت. */
    await page.goto(BASE + '/app/tools');
    await page.waitForTimeout(1500);
    const tile = page.locator('a:has-text("پیام‌رسان"), button:has-text("پیام‌رسان")').first();
    ok(await tile.count() === 1, '**کاشیِ پیام‌رسان روشن شد**');
    await tile.click();
    await page.waitForURL('**/app/chat**', { timeout: 10000 });
    await page.waitForTimeout(1800);

    const dmRow = page.locator('.ch-row', { has: page.locator('b:has-text("همکارِ چتی")') });
    ok(await dmRow.count() === 1, 'گفتگوی دونفره در فهرست است');
    await dmRow.click();
    await page.waitForTimeout(1200);
    ok(await page.locator('.ch-msg').count() >= 2, 'تاریخچهٔ پیام‌ها آمد');
    await page.fill('.ch-inputbar input', `از مرورگر ${tag}`);
    await page.locator('.ch-inputbar button[type="submit"]').click();
    await page.waitForTimeout(1000);
    ok(await page.locator(`.ch-msg.mine:has-text("از مرورگر ${tag}")`).count() === 1, '**پیامِ فرستاده حباب شد**');

    /* طرفِ مقابل از API جواب می‌دهد — باید بدونِ رفرش بیاید (SSE). */
    await send(`/chat/channels/${d1.id}/messages`, 'POST', { body: `جوابِ زندهٔ ${tag}` }, B);
    await page.waitForTimeout(2500);
    ok(await page.locator(`.ch-msg:not(.mine):has-text("جوابِ زندهٔ ${tag}")`).count() === 1,
      '**جوابِ طرفِ مقابل بدونِ رفرش نشست (بلادرنگ)**');

    /* گروهِ تازه از خودِ UI */
    await page.locator('.ch-new').click();
    await page.waitForTimeout(700);
    await page.locator('.ch-modes button:has-text("گروه")').click();
    await page.fill('.ch-gname input', `گروهِ مرورگریِ ${tag}`);
    await page.locator('.ch-dir-row.as-check', { hasText: 'همکارِ چتی' }).locator('input').check();
    await page.locator('.ch-gsave').click();
    await page.waitForTimeout(1500);
    ok((await page.locator('.ch-main-head b').innerText()).includes(`گروهِ مرورگریِ ${tag}`),
      '**گروه از UI ساخته و باز شد**');
    ok(errors.length === 0, errors.length ? 'خطای JS: ' + errors[0] : 'بدونِ خطای JS');
  } finally {
    await browser.close();
  }
} finally {
  sql(`DELETE FROM chat_channels WHERE id IN (SELECT channel_id FROM chat_members WHERE account_id IN (SELECT id FROM accounts WHERE username IN ('${tag}b','${tag}c')))`);
  sql(`DELETE FROM account_sessions WHERE account_id IN (SELECT id FROM accounts WHERE username IN ('${tag}b','${tag}c'))`);
  sql(`DELETE FROM accounts WHERE username IN ('${tag}b','${tag}c')`);
  sql(`DELETE FROM people WHERE (first_name='همکارِ' AND last_name='چتی') OR (first_name='غریبهٔ' AND last_name='چت')`);
}

console.log(`\nنتیجه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
