/**
 * **عکس‌برداری + سنجه‌های ماشینیِ UX از همهٔ صفحه‌های `/app`** — اسکیلِ `ux-audit`.
 *
 * هر صفحه × دو تم (تیره/روشن) × دو اندازه (۱۲۸۰ دسکتاپ، ۳۹۰ موبایل) × تا سه بُرشِ اسکرول،
 * و برای هرکدام سنجه‌های ماشینی: سرریزِ افقی، هدفِ لمسیِ کوچک، دکمهٔ بی‌نام، ورودیِ بی‌برچسب،
 * قلمِ ریزتر از ۱۲px، کنتراستِ زیرِ AA (تخمینی — روی شیشه/گرادیان نویز دارد؛ با چشم تأیید شود)،
 * ایموجی و خطای کنسول/API.
 *
 *   UX_UI=http://127.0.0.1:5600 UX_API=http://127.0.0.1:3502/api UX_TAG=clinic \
 *   node scripts/ux/capture.mjs [filter]
 *
 * ورود: `UX_TOKEN` (کوکیِ نشست، بی‌تماس با `/auth/login` که محدودیتِ نرخ دارد) یا
 * `UX_USER`/`UX_PASS` (پیش‌فرض admin/test1234). خروجی: `$UX_OUT/shots/<tag>/…jpg` و
 * `$UX_OUT/metrics-<tag>.json`.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const UI = process.env.UX_UI ?? 'http://127.0.0.1:5199';
const API = process.env.UX_API ?? 'http://localhost:3101/api';
const which = process.env.UX_TAG ?? 'app';
const ROOT = process.env.UX_OUT ?? '/tmp/ux-audit';
const filter = process.argv[2] ?? '';
const OUT = `${ROOT}/shots/${which}`;
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ['today', '/app', null], ['tools', '/app/tools', null], ['dashboard', '/app/dashboard', 'dashboard'],
  ['frontdesk', '/app/frontdesk', 'frontdesk'], ['calendar', '/app/calendar', 'calendar'], ['schedule', '/app/schedule', 'calendar'],
  ['theatre', '/app/theatre', 'theatre'], ['waitlist', '/app/waitlist', 'waitlist'], ['surgeon', '/app/surgeon', 'surgeon'],
  ['tech', '/app/tech', 'tech'], ['dispatch', '/app/dispatch', 'dispatch'], ['transport', '/app/transport', 'transport'],
  ['intake', '/app/intake', 'formgen'], ['crm', '/app/crm', 'formgen'], ['reminders', '/app/reminders', 'dashboard'],
  ['notes', '/app/notes', 'dashboard'], ['work', '/app/work', 'work'], ['pathways', '/app/pathways', 'pathway'],
  ['inventory', '/app/inventory', 'inventory'], ['accounting', '/app/accounting', 'accounting'],
  ['letters', '/app/letters', null], ['assistant', '/app/assistant', null], ['chat', '/app/chat', null],
  ['definitions', '/app/definitions', null], ['forms', '/app/forms', null], ['users', '/app/users', 'users'],
  ['access', '/app/access', 'access'], ['site', '/app/site', 'site'], ['settings', '/app/settings', null],
  ['profile', '/app/profile', null], ['record', '/app/patients/:first', null],
];
const VPS = [['d', { width: 1280, height: 800 }], ['m', { width: 390, height: 844 }]];
const THEMES = ['dark', 'light'];

const login = process.env.UX_TOKEN ? { accessToken: process.env.UX_TOKEN } : await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.UX_USER ?? 'admin', password: process.env.UX_PASS ?? 'test1234' }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد', login); process.exit(1); }
const auth = { Authorization: 'Bearer ' + login.accessToken };
const features = await fetch(API + '/features', { headers: auth }).then((r) => r.json()).catch(() => []);
const enabled = new Set((features ?? []).filter((f) => f.enabled !== false && f.allowed !== false).map((f) => f.key));
const pats = await fetch(API + '/patients?limit=5', { headers: auth }).then((r) => r.json()).catch(() => null);
const firstPatient = (pats?.rows ?? pats?.items ?? pats ?? [])[0]?.id ?? (pats?.[0]?.patientId);

function audit() {
  const vw = innerWidth;
  const out = { overflowX: Math.max(0, document.documentElement.scrollWidth - vw), height: document.documentElement.scrollHeight, title: document.title,
    h1: [...document.querySelectorAll('h1')].map((h) => h.innerText.trim()).filter(Boolean).slice(0, 3) };
  const visible = (el) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const nm = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const tag = (el) => el.tagName.toLowerCase() + (el.classList[0] ? '.' + el.classList[0] : '');
  const inter = [...document.querySelectorAll('a[href],button,[role=button],input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"]),summary')].filter(visible);
  out.interactive = inter.length;
  out.small = inter.filter((el) => { const r = el.getBoundingClientRect(); return (r.width < 44 || r.height < 44) && !['checkbox', 'radio'].includes(el.type); })
    .map((el) => { const r = el.getBoundingClientRect(); return `${tag(el)} ${Math.round(r.width)}×${Math.round(r.height)} «${nm(el)}»`; });
  out.tiny = inter.filter((el) => { const r = el.getBoundingClientRect(); return (r.width < 32 || r.height < 28) && !['checkbox', 'radio'].includes(el.type); })
    .map((el) => { const r = el.getBoundingClientRect(); return `${tag(el)} ${Math.round(r.width)}×${Math.round(r.height)} «${nm(el)}»`; });
  out.unnamed = inter.filter((el) => el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button')
    .filter((el) => !nm(el) && !el.getAttribute('aria-labelledby')).map((el) => el.outerHTML.slice(0, 140));
  out.unlabeled = inter.filter((el) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)).filter((el) => {
    if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
    if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false;
    return !el.closest('label');
  }).map((el) => `${tag(el)}[${el.type || ''}] ph=«${el.placeholder || ''}»`);
  out.imgNoAlt = [...document.images].filter(visible).filter((i) => !i.hasAttribute('alt')).map((i) => i.src.slice(-60));

  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const rootBg = parse(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1];
  const base = rootBg[3] > 0 ? rootBg : (parse(getComputedStyle(document.documentElement).backgroundColor) ?? [255, 255, 255, 1]);
  const bgOf = (el) => {
    const chain = [];
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !cs.backgroundImage.startsWith('url')) return null; // گرادیان: نامعلوم
      const c = parse(cs.backgroundColor); if (c && c[3] > 0) chain.push(c);
    }
    let bg = [base[0], base[1], base[2], 1];
    for (let i = chain.length - 1; i >= 0; i--) bg = blend(chain[i], bg);
    return bg;
  };
  const small = [], lowc = [], emoji = [];
  const seen = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const EMO = /\p{Extended_Pictographic}/u;
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = n.nodeValue.trim(); if (!t) continue;
    const el = n.parentElement; if (!el || seen.has(el) || !visible(el)) continue;
    seen.add(el);
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
    const cs = getComputedStyle(el); const fs = parseFloat(cs.fontSize);
    if (fs < 12) small.push(`${fs}px «${t.slice(0, 30)}»`);
    if (EMO.test(t)) emoji.push(t.slice(0, 30));
    const fg = parse(cs.color); const bg = bgOf(el);
    if (fg && bg) {
      const f = fg[3] < 1 ? blend(fg, bg) : fg;
      const L1 = lum(f), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const bold = Number(cs.fontWeight) >= 700; const large = fs >= 24 || (fs >= 18.66 && bold);
      if (ratio < (large ? 3 : 4.5)) lowc.push(`${ratio.toFixed(2)} ${fs}px «${t.slice(0, 30)}»`);
    }
  }
  out.smallFont = small; out.lowContrast = lowc; out.emoji = emoji;
  return out;
}

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium' });
const metrics = [];
for (const [vpName, viewport] of VPS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce', locale: 'fa-IR', deviceScaleFactor: 1, isMobile: vpName === 'm', hasTouch: vpName === 'm' });
    const apiUrl = new URL(API); apiUrl.pathname = '/';
    await ctx.addCookies([
      { name: 'amalyar_session', value: login.accessToken, url: apiUrl.toString(), httpOnly: true, sameSite: 'Lax' },
      { name: 'amalyar_csrf', value: 'ux-' + Date.now().toString(36), url: apiUrl.toString(), httpOnly: false, sameSite: 'Lax' },
    ]);
    await ctx.addInitScript((t) => { try { localStorage.setItem('amalyar_theme', t); } catch {} }, theme);
    const page = await ctx.newPage();
    let errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
    page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) errs.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 90)}`); });
    for (const [slug, path0, feat] of ROUTES) {
      if (filter && !slug.includes(filter)) continue;
      if (feat && enabled.size && !enabled.has(feat)) { if (vpName === 'd' && theme === 'dark') metrics.push({ slug, skipped: 'feature-off:' + feat }); continue; }
      const path = path0.replace(':first', String(firstPatient ?? 1));
      errs = [];
      try {
        await page.goto(UI + path, { waitUntil: 'networkidle', timeout: 30000 });
      } catch (e) { errs.push('goto: ' + e.message.slice(0, 100)); }
      await page.waitForTimeout(900);
      let m = {};
      try { m = await page.evaluate(audit); } catch (e) { m = { auditError: e.message.slice(0, 120) }; }
      const H = m.height ?? viewport.height;
      const segs = Math.min(3, Math.max(1, Math.ceil(H / viewport.height)));
      for (let i = 0; i < segs; i++) {
        await page.evaluate((y) => window.scrollTo(0, y), i * (viewport.height - 80));
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${OUT}/${slug}__${vpName}__${theme}__${i + 1}.jpg`, type: 'jpeg', quality: 72 });
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      metrics.push({ slug, vp: vpName, theme, url: page.url().replace(UI, ''), segs, errors: [...new Set(errs)].slice(0, 12), ...m });
      process.stdout.write(`${slug}:${vpName}:${theme} `);
    }
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${ROOT}/metrics-${which}${filter ? '-' + filter : ''}.json`, JSON.stringify({ tenant: which, features: [...enabled], metrics }, null, 1));
console.log('\nOK', metrics.length);
