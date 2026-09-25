/** Browser regression: real app/components, deterministic API fixtures; no production data. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const base = 'http://127.0.0.1:5199';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5199', '--strictPort'], { stdio: 'ignore' });
let browser;
let pass = 0;
const check = (condition, message) => { assert.ok(condition, message); console.log(`PASS ${++pass}: ${message}`); };
/* از بستهٔ زیرفرم‌ها (۱۴۰۵/۰۷/۰۳) درخواست‌ها زیرفرمِ «درخواستِ پاراکلینیک» اند نه چیپِ تصمیم؛
   مراجعهٔ ماک آن را الصاق‌شده دارد و کاتالوگ فقط همان را. */
const ORDERS_SUB = { key: 'orders', builtin: true, formId: null, implicit: false, title: 'فرم درخواستِ پاراکلینیک و مشاوره', hasData: false, count: 0, data: null, derived: {}, attachedAt: null, updatedAt: null };
const visit = { id: 1, patientId: 1, kind: 'clinic', firstName: 'بیمار', lastName: 'آزمایشی', fullName: 'بیمار آزمایشی', phone: '09120000000', code: 'AM-001', seq: 1, decisions: [], opReport: 'متن اولیه پزشک', amount: 0, paid: 0, due: 0, opStatus: 'pending', subforms: [ORDERS_SUB] };
const subformCatalog = {
  groups: [{ key: 'common', label: 'پرکاربرد' }],
  items: [{ key: 'orders', title: ORDERS_SUB.title, short: 'درخواستِ پاراکلینیک', hint: null, group: 'common', builtin: true, nonSurgery: true, active: true, color: null, fields: [] }],
};
const record = { ...visit, clinicalVisible: true, visits: [visit], notes: [], clinicalNotes: [], documents: [], forms: [], visitTexts: [], counts: { visits: 1, notes: 0, documents: 0, forms: 0, notesByKind: {} } };
let reply = 'data: {"d":"شرح ساخت‌یافته"}\r\n\r\ndata: [DONE]\r\n\r\n';
const writes = [];
/* ⚠️ از بستهٔ ۶الف ردیفِ تصمیم از `/config.statuses.decision` رندر می‌شود، نه از
   فهرستِ کلاینت. فهرست از خودِ `labels.ts` خوانده می‌شود تا ماکِ این آزمون
   کپیِ دومی نشود که روزی با سرور نخواند. */
const decisionBody = readFileSync('server/src/patients/labels.ts', 'utf8')
  .match(/DECISION_LABELS: Record<string, string> = \{([^}]*)\}/)?.[1] ?? '';
const decisions = [...decisionBody.matchAll(/(\w+): '([^']+)'/g)].map((m) => ({ key: m[1], label: m[2] }));
assert.ok(decisions.length >= 6, 'DECISION_LABELS از labels.ts خوانده نشد');
try {
  for (let i = 0; i < 80; i++) { if (await fetch(base).then((r) => r.ok).catch(() => false)) break; await delay(100); }
  browser = await chromium.launch({ executablePath: process.env.E2E_CHROME ?? '/tmp/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const context = await browser.newContext({ viewport, locale: 'fa-IR', serviceWorkers: 'block' });
    await context.route('**/api/**', async (route) => {
      const req = route.request(), path = new URL(req.url()).pathname.replace(/^\/api/, '');
      if (req.method() !== 'GET') writes.push({ path, body: req.postData() });
      if (path === '/ai/note-draft/stream') {
        await delay(100);
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: reply });
      }
      let body = [];
      if (path === '/auth/me') body = { id: 1, firstName: 'تست', lastName: 'محلی', level: 6, status: 'active' };
      else if (path === '/config') body = { vertical: 'clinic', brand: {}, statuses: { decision: decisions } };
      else if (path === '/features') body = [{ key: 'dashboard', allowed: true }];
      else if (path === '/forms/subforms') body = subformCatalog;
      else if (path === '/auth/prefs') body = { subformPins: [null, null, null], todayPins: [null, null, null] };
      else if (path === '/visits/1') body = visit;
      else if (path === '/visits') body = { rows: [visit], total: 1, pages: 1, stats: { total: 1, pending: 1, today: 0, due: 0, kinds: [] } };
      else if (path === '/forms/visit-kinds') body = [{ key: 'clinic', title: 'ویزیت' }, { key: 'surgery', title: 'عمل' }];
      else if (path.startsWith('/forms/visit.')) body = { fields: [{ key: 'opReport', builtin: true, active: true, label: 'شرحِ عمل' }] };
      else if (path === '/ai/status') body = { enabled: true, stt: false };
      else if (path === '/patients/1/record') body = record;
      else if (path === '/care-plan/timing') body = {};
      else if (path.startsWith('/orders/') && req.method() === 'POST') body = { id: 2, ...JSON.parse(req.postData()) };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(15000);
    const errors = [];
    page.on('pageerror', (e) => { errors.push(e.message); console.error('BROWSER', e.message); });
    await page.goto(`${base}/app/dashboard?patient=1`);
    await page.locator('.db-sheet').waitFor();
    for (const kind of ['lab', 'imaging', 'consult', 'referral']) {
      await page.locator(`[data-subform="orders"] [data-order-new="${kind}"]`).click();
      const sheet = page.locator('.od-sheet');
      await sheet.waitFor();
      await delay(450);
      const geometry = await sheet.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, overflow: getComputedStyle(el).overflowY, parent: !!el.closest('.db-sheet') };
      });
      check(geometry.x >= 0 && geometry.y >= 0 && geometry.right <= viewport.width && geometry.bottom <= viewport.height, `${kind} fits viewport ${viewport.width}: ${JSON.stringify(geometry)}`);
      check(!geometry.parent && geometry.overflow === 'auto', `${kind} escapes clipped parent and can scroll`);
      for (const input of await sheet.locator('input:not([type=file]),textarea').all()) {
        await input.scrollIntoViewIfNeeded();
        const accessible = await input.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el;
        });
        check(accessible, `${kind} field receives pointer events`);
        await input.fill('متن تست');
        check(await input.inputValue() === 'متن تست', `${kind} field accepts typing`);
      }
      await sheet.locator('.od-save').scrollIntoViewIfNeeded();
      check(await sheet.locator('.od-save').isVisible(), `${kind} bottom action reachable`);
      await sheet.getByRole('button', { name: 'بستن', exact: true }).click();
      await sheet.waitFor({ state: 'detached' });
      check(await page.locator('.od-bg').count() === 0 && await page.locator('.db-sheet').count() === 1, `${kind} closes fully and preserves visit form`);
    }
    // Smaller viewport while a long form is open (landscape / less room with a keyboard).
    await page.locator('[data-subform="orders"] [data-order-new="lab"]').click();
    await page.setViewportSize({ width: viewport.width, height: 420 });
    await page.locator('.od-save').scrollIntoViewIfNeeded();
    const bottom = await page.locator('.od-save').boundingBox();
    check(bottom.y >= 0 && bottom.y + bottom.height <= 420, 'bottom action reachable after viewport shrinks');
    await page.locator('.od-sheet .db-x').click();
    await page.locator('.od-bg').waitFor({ state: 'detached' });
    await page.setViewportSize(viewport);
    // Real report editor: valid response, empty response, abrupt EOF, provider error.
    for (const [name, response, expected] of [
      ['CRLF response', 'data:{"d":"شرح ساخت‌یافته"}\r\n\r\ndata:[DONE]\r\n\r\n', 'شرح ساخت‌یافته'],
      ['empty response', 'data: [DONE]\n\n', 'متن اولیه پزشک'],
      ['truncated response', 'data: {"d":"نیمه"}\n\n', 'متن اولیه پزشک'],
      ['provider error', 'data: {"error":"پاسخ سرویس نامعتبر است"}\n\n', 'متن اولیه پزشک'],
    ]) {
      reply = response;
      const input = page.locator('.db-report textarea');
      await input.fill('متن اولیه پزشک');
      await page.locator('.db-report .db-aibtn').first().click();
      await page.waitForFunction(() => !document.querySelector('.db-report .db-aibtn')?.disabled);
      check(await input.inputValue() === expected, `visit editor: ${name}`);
    }
    console.log('Opening patient record');
    await page.goto(`${base}/app/patients/1`, { waitUntil: 'domcontentloaded' });
    console.log('Patient record loaded');
    await page.getByRole('tab').filter({ hasText: 'شرح‌ها' }).click();
    const note = page.locator('.rc-upload textarea');
    await note.fill('متن اولیه پزشک');
    reply = 'data: [DONE]\n\n';
    await page.locator('.rc-ai:not(.rc-ai-cont)').click();
    await page.waitForFunction(() => !document.querySelector('.rc-ai')?.disabled);
    check(await note.inputValue() === 'متن اولیه پزشک', 'record editor preserves original on empty AI response');
    reply = 'data: {"d":"ادامه شرح"}\n\ndata: [DONE]\n\n';
    await page.locator('.rc-ai-cont').click();
    await page.waitForFunction(() => !document.querySelector('.rc-ai-cont')?.disabled);
    check(await note.inputValue() === 'متن اولیه پزشک\nادامه شرح', 'record editor appends AI continuation');
    await page.locator('.rc-ai-undo').click();
    check(await note.inputValue() === 'متن اولیه پزشک', 'undo restores original');
    check(errors.length === 0, `no browser errors: ${errors.join('; ')}`);
    await context.close();
  }
  check(!writes.some((x) => /^\/visits/.test(x.path)), 'editing child forms never submits parent visit');
  console.log(`${pass} UI checks passed`);
} finally {
  await browser?.close();
  vite.kill();
}
