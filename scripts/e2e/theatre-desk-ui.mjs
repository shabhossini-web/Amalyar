/**
 * **میزِ اتاقِ عمل — دادهٔ بالینی و هم‌زمانی** (بازبینیِ خصمانهٔ بستهٔ F ← بستهٔ FF).
 * مرورگرِ واقعی، APIِ ساختگی (`lib/mock-ui.mjs`)؛ قراردادِ سرور را `theatre.mjs` می‌سنجد.
 *
 *  باید بیفتد:
 *   - FF1: شرحِ ذخیره‌نشدهٔ میز وقتی پرونده از جای دیگری عوض شد → پرسشِ «کدام بماند؟» با هر دو متن
 *   - FF1: همان پرسش پس از بستن و بازکردنِ کارت (پیش‌نویسِ دستگاه پایه‌اش را دارد)
 *   - FF1: پیش‌نویسِ هم‌پایه با پرونده بی‌پرسش برمی‌گردد و «ذخیره» پایه را هم می‌فرستد
 *   - FF1: «ادامه با نوشتهٔ من» فقط با «ذخیره»ِ صریح جایگزین می‌کند؛ ۴۰۹ِ سرور کارت را تازه می‌کند
 *   - FF2: بارگذاریِ برنامه پیش‌نویسِ کهنه و خراب را جارو می‌کند
 *   - FF2: خروج و تعویضِ حساب پیش‌نویس‌های همان کاربر را پاک می‌کنند
 *  نباید بیفتد:
 *   - FF1: شرحِ تازه‌ترِ پرونده با پیش‌نویسِ کهنه جایگزین شود — نه از «ذخیره»ِ کارت، نه از پرسشِ «فهرستِ روز»
 *   - FF1: پیش‌نویسِ بی‌پایه (نسخهٔ پیشین) بی‌صدا برگردد
 *   - FF2: نوشتهٔ یک کاربر پس از تعویضِ حساب زیرِ کلیدِ کاربرِ بعدی بنشیند
 */
import { startVite, launch, mockContext } from './lib/mock-ui.mjs';

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

const UID = 7;
const VID = 19;
const DKEY = `amalyar_draft:${UID}:${VID}:opReport`;

/** کارتِ حینِ عمل — همان شکلِ `TheatreService.card()`، فقط آنچه میز می‌خوانَد. */
const cardOf = (S) => ({
  visit: {
    id: VID, code: 'AM-0001-V2', kind: 'surgery', opDate: '2026-09-30T00:00:00.000Z', opStatus: 'pending',
    state: S.start ? 'running' : 'waiting', stateFa: S.start ? 'در جریان' : 'در انتظار',
    procedure: 'عملِ آزمونی', procedures: [], hospital: 'بیمارستانِ آزمونی', surgeon: 'دکتر آزمونی', tech: null,
    opStartTime: S.start, opEndTime: S.end, techArriveTime: null, dischargeAt: null,
    chiefComplaint: 'دردِ آزمونی', diagnosis: null, diagnoses: [], anesthesia: null, anesthesiaFa: null,
    opReport: S.report, findings: null, dischargeNote: null, dischargeSummary: null, dischargeRemark: null,
    dischargeDisposition: null, dischargeDispositionFa: null, dischargeRx: null, nextVisitDate: null, instructions: null, notes: null,
  },
  patient: { id: 5, code: 'AM-0001', fullName: 'بیمارِ آزمونی', age: 40, gender: 'male', bloodType: 'O+' },
  decided: null, vitals: [], alerts: { allergies: null, chronicConditions: null, medications: null },
  items: [], documents: [], subforms: [], clinical: true,
  can: { subforms: false, followup: false, times: true, form: false }, locks: { followup: null }, checklist: [],
});

/**
 * APIِ ساختگیِ stateful. `S` وضعیتِ «سرور» است و آزمون وسطِ راه عوضش می‌کند — همان کاری که
 * فرمِ عمل یا دستگاهِ دیگر با پرونده می‌کند. `S.onReport` پاسخِ ذخیرهٔ شرح را تعیین می‌کند.
 */
const ME = { id: UID, level: 6, status: 'active', firstName: 'جراحِ', lastName: 'آزمونی', displayName: 'جراحِ آزمونی', levelName: 'سوپرادمین' };
const NURSE = { id: 8, level: 2, status: 'active', firstName: 'پرستارِ', lastName: 'آزمونی', displayName: 'پرستارِ آزمونی', levelName: 'کارشناس' };
const makeServer = (S) => ({ path, method, body }) => {
  if (path === '/auth/me') return S.me ?? ME;
  if (path === '/config') return { vertical: 'clinic', kind: 'clinic', services: [], brand: {} };
  if (path === '/features') return ['theatre', 'dashboard'].map((key) => ({ key, allowed: true }));
  if (path === '/auth/accounts') return S.accounts ?? [];
  if (path === '/auth/switch' && method === 'POST') { S.me = [ME, NURSE].find((u) => u.id === body?.accountId) ?? ME; return S.me; }
  if (path === '/auth/logout' && method === 'POST') return { next: null };
  if (path.startsWith('/theatre/day')) {
    return { date: '2026-09-30', team: false, visits: [{ id: VID, code: 'AM-0001-V2', patientId: 5, patient: 'بیمارِ آزمونی', opStartTime: S.start, opEndTime: S.end, opStatus: 'pending', dischargeAt: null, state: 'waiting', stateFa: 'در انتظار', chiefComplaint: null, procedure: 'عملِ آزمونی', hospital: null, surgeon: null }] };
  }
  if (path.startsWith('/theatre/month')) return { days: [] };
  if (path === `/theatre/visits/${VID}/op-templates`) return { items: [], canAdd: false, procedure: null };
  if (path === `/theatre/visits/${VID}` && method === 'GET') return cardOf(S);
  if (path === `/theatre/visits/${VID}/report` && method === 'POST') {
    const r = S.onReport?.(body);
    if (r) return r;
    S.report = (body?.body ?? '').trim() || null;
    return cardOf(S);
  }
  if (path === `/theatre/visits/${VID}/start` && method === 'POST') {
    const stamped = !S.start;
    if (!S.start) S.start = '10:15';
    return { ...cardOf(S), stamped };
  }
  if (method === 'GET') return [];
  return undefined;
};

const vite = await startVite(5231);
const browser = await launch();
/** یک مرورگرِ تازه — `seed` پیش‌نویس‌هایی است که پیش از بارگذاریِ صفحه روی «دستگاه» می‌نشینند. */
const open = async (S, { seed = {}, viewport = { width: 390, height: 844 } } = {}) => {
  const c = await mockContext(browser, makeServer(S), { viewport });
  /* فقط یک بار (نه در هر بارگذاری) و فقط روی سندی که ذخیره‌سازی دارد — `about:blank` ندارد. */
  await c.context.addInitScript((kv) => {
    try {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    } catch { /* سندِ بی‌ذخیره‌سازی */ }
  }, seed);
  const page = await c.context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(`${vite.base}/app/theatre?visit=${VID}`, { waitUntil: 'networkidle' });
  await page.locator('[data-note="opReport"]').waitFor();
  return { ...c, page };
};
const draftOf = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), DKEY);
const draftKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('amalyar_draft:')).sort());
const reportWrites = (w) => w.filter((x) => x.path === `/theatre/visits/${VID}/report`);

try {
  console.log('۱) FF1 — پرونده زیرِ دستِ کاربر عوض شد');
  {
    const S = { report: null, start: null, end: null };
    const { page, writes, errors, context } = await open(S);
    const box = page.locator('[data-report]');
    await box.fill('شرحِ الف — نوشتهٔ سرِ میز');
    await page.locator('[data-note-state="unsaved"]').waitFor();
    const d0 = await draftOf(page);
    ok(d0?.text === 'شرحِ الف — نوشتهٔ سرِ میز' && d0?.base === '', 'پیش‌نویس با پایه‌اش روی دستگاه نشست', JSON.stringify(d0));
    /* «بازکردنِ فرمِ عمل» ← «ب» ذخیره شد: سرور حالا «ب» دارد و هر تازه‌سازیِ کارت همان را می‌آورد. */
    S.report = 'شرحِ ب — از فرمِ عمل';
    await page.locator('[data-act="start"]').click();
    await page.locator('[data-note-conflict]').waitFor();
    const txt = await page.locator('[data-note-conflict]').innerText();
    ok(txt.includes('شرحِ ب — از فرمِ عمل') && txt.includes('شرحِ الف — نوشتهٔ سرِ میز'),
      '**باید بیفتد:** پرسشِ «کدام بماند؟» با هر دو متن');
    ok(await page.locator('[data-report]').count() === 0, 'کادرِ ویرایش تا انتخاب پنهان است (نه ذخیرهٔ کور)');
    ok(await page.locator('[data-conflict="record"]').evaluate((b) => !b.classList.contains('primary'))
      && await page.locator('[data-conflict="device"]').evaluate((b) => !b.classList.contains('primary')),
    'هیچ‌کدام از دو گزینه دکمهٔ اصلیِ از پیش انتخاب‌شده نیست');
    /* «فهرستِ روز» — تا دیروز پرسشِ «ذخیره نشده» می‌آمد و «ذخیره»اش «الف» را روی «ب» می‌نوشت. */
    await page.getByRole('button', { name: 'فهرستِ روز' }).click();
    await page.locator('.th-list').waitFor();
    ok(await page.locator('[data-unsaved]').count() === 0 && reportWrites(writes).length === 0,
      '**نباید بیفتد:** «فهرستِ روز» شرحِ در تعارض را نه می‌پرسد نه ذخیره می‌کند', JSON.stringify(reportWrites(writes)));
    ok((await draftOf(page))?.text === 'شرحِ الف — نوشتهٔ سرِ میز', 'نوشتهٔ کاربر روی دستگاه ماند');
    /* نشستِ بعد: کارت دوباره باز شود — همان پرسش، نه بازگشتِ بی‌صدای «الف». */
    await page.locator(`[data-visit-id="${VID}"]`).click();
    await page.locator('[data-note-conflict]').waitFor();
    ok(true, '**باید بیفتد:** بازکردنِ دوبارهٔ کارت همان پرسش را می‌آورد');
    await page.locator('[data-conflict="record"]').click();
    ok(await page.locator('[data-report]').inputValue() === 'شرحِ ب — از فرمِ عمل', '«نگه‌داشتنِ متنِ پرونده» ← متنِ پرونده');
    ok(await draftOf(page) === null && reportWrites(writes).length === 0, 'پیش‌نویسِ دستگاه پاک شد و چیزی به پرونده نرفت');
    ok(errors.length === 0, 'بدونِ خطای JS', errors[0]);
    await context.close();
  }

  console.log('\n۲) FF1 — پیش‌نویسِ هم‌پایه برمی‌گردد؛ «ذخیره» پایه را هم می‌فرستد');
  {
    const S = { report: 'شرحِ ب', start: null, end: null };
    const { page, writes, context } = await open(S, { seed: { [DKEY]: { text: 'شرحِ ب + ادامه', base: 'شرحِ ب', at: Date.now() - 60e3 } } });
    ok(await page.locator('[data-report]').inputValue() === 'شرحِ ب + ادامه', 'پیش‌نویس بی‌پرسش برگشت');
    ok((await page.locator('[data-note-state]').innerText()).includes('همین دستگاه'), 'و گفته می‌شود که هنوز در پرونده نیست');
    await page.locator('[data-act="save-report"]').click();
    await page.locator('[data-note-state="saved"]').waitFor();
    const w = reportWrites(writes).at(-1)?.body;
    ok(w?.body === 'شرحِ ب + ادامه' && w?.base === 'شرحِ ب', '«ذخیره» متن و پایه‌اش را می‌فرستد', JSON.stringify(w));
    ok(await draftOf(page) === null, 'پس از ذخیره پیش‌نویسِ دستگاه پاک شد');
    await context.close();
  }

  console.log('\n۳) FF1 — پیش‌نویسِ بی‌پایه (نسخهٔ پیشین) و «ادامه با نوشتهٔ من»');
  {
    const S = { report: 'شرحِ ب', start: null, end: null };
    const { page, writes, context } = await open(S, { seed: { [DKEY]: { text: 'شرحِ کهنه', at: Date.now() - 60e3 } } });
    ok(await page.locator('[data-note-conflict]').count() === 1, '**نباید بیفتد:** پیش‌نویسِ بی‌پایه بی‌صدا برنمی‌گردد — پرسیده می‌شود');
    await page.locator('[data-conflict="device"]').click();
    ok(await page.locator('[data-report]').inputValue() === 'شرحِ کهنه', '«ادامه با نوشتهٔ من» ← نوشتهٔ دستگاه در کادر');
    ok(reportWrites(writes).length === 0, 'انتخاب خودش چیزی ذخیره نمی‌کند');
    ok((await page.locator('[data-note-state]').innerText()).includes('جای متنِ فعلیِ پرونده'), 'راهنما می‌گوید «ذخیره» جای متنِ پرونده را می‌گیرد');
    ok((await draftOf(page))?.base === 'شرحِ ب', 'پایهٔ پیش‌نویس حالا همان متنی است که کاربر دید');
    await page.locator('[data-act="save-report"]').click();
    await page.locator('[data-note-state="saved"]').waitFor();
    const w = reportWrites(writes).at(-1)?.body;
    ok(w?.body === 'شرحِ کهنه' && w?.base === 'شرحِ ب', 'جایگزینی فقط با «ذخیره»ِ صریح، با پایهٔ درست', JSON.stringify(w));
    await context.close();
  }

  console.log('\n۴) FF1 — سرور پایه را رد کرد (۴۰۹): کارت تازه و پرسش');
  {
    const S = { report: 'شرحِ ب', start: null, end: null };
    S.onReport = () => { S.report = 'شرحِ ج — دستگاهِ دیگر'; return { status: 409, body: { message: 'متنِ پرونده از جای دیگری عوض شده است' } }; };
    const { page, context } = await open(S);
    await page.locator('[data-report]').fill('شرحِ ب — اصلاحِ من');
    await page.locator('[data-act="save-report"]').click();
    await page.locator('[data-note-conflict]').waitFor();
    ok((await page.locator('[data-note-conflict]').innerText()).includes('شرحِ ج — دستگاهِ دیگر'), '**باید بیفتد:** ۴۰۹ کارت را تازه کرد و متنِ واقعیِ پرونده در پرسش است');
    ok((await page.locator('.th-toast').innerText()).includes('عوض شده'), 'پیامِ فارسیِ سرور دیده شد');
    await context.close();
  }

  console.log('\n۵) FF2 — جارو هنگامِ بارگذاری');
  {
    const S = { report: null, start: null, end: null };
    const now = Date.now();
    const { page, context } = await open(S, {
      seed: {
        [`amalyar_draft:${UID}:99:opReport`]: { text: 'متنِ یک روز و یک ساعت پیش', base: '', at: now - 25 * 3600e3 },
        'amalyar_draft:8:98:findings': 'خراب{',
        [`amalyar_draft:${UID}:97:opReport`]: { text: 'متنِ یک ساعت پیش', base: '', at: now - 3600e3 },
        amalyar_unrelated: 'x',
      },
    });
    const keys = await draftKeys(page);
    ok(!keys.includes(`amalyar_draft:${UID}:99:opReport`) && !keys.includes('amalyar_draft:8:98:findings'),
      '**باید بیفتد:** پیش‌نویسِ کهنه و خراب بی‌آنکه کارتش باز شود جارو شد', keys.join(' '));
    ok(keys.includes(`amalyar_draft:${UID}:97:opReport`) && await page.evaluate(() => localStorage.getItem('amalyar_unrelated') === 'x'),
      'پیش‌نویسِ تازه و کلیدِ بی‌ربط سرِ جایشان‌اند');
    await context.close();
  }

  console.log('\n۶) FF2 — تعویضِ حساب روی تبلتِ مشترک');
  {
    const S = { report: null, start: null, end: null, accounts: [{ ...ME, active: true }, NURSE] };
    const { page, context } = await open(S, {
      seed: {
        [DKEY]: { text: 'شرحِ ذخیره‌نشدهٔ جراح', base: '', at: Date.now() - 60e3 },
        'amalyar_draft:8:50:opReport': { text: 'پیش‌نویسِ خودِ پرستار', base: '', at: Date.now() - 60e3 },
      },
    });
    page.on('dialog', (d) => d.accept());
    ok(await page.locator('[data-report]').inputValue() === 'شرحِ ذخیره‌نشدهٔ جراح', 'پیش‌نویسِ جراح روی کارتش برگشت');
    await page.locator('.pm-chip').click();
    await page.locator('.pm-acc-main', { hasText: 'پرستارِ آزمونی' }).click();
    await page.locator('.pm-chip', { hasText: 'پرستارِ آزمونی' }).waitFor();
    await page.waitForFunction((k) => !localStorage.getItem(k), DKEY);
    const keys = await draftKeys(page);
    ok(!keys.some((k) => k.startsWith(`amalyar_draft:${UID}:`)), '**باید بیفتد:** پیش‌نویس‌های جراح با تعویضِ حساب پاک شد', keys.join(' '));
    ok(keys.includes('amalyar_draft:8:50:opReport'), 'پیش‌نویسِ کاربرِ تازه دست نخورد');
    ok(!keys.includes(`amalyar_draft:8:${VID}:opReport`), '**نباید بیفتد:** نوشتهٔ جراح زیرِ کلیدِ پرستار ننشست', keys.join(' '));
    ok(!(await page.locator('[data-report]').inputValue()).includes('جراح'), 'کارت برای کاربرِ تازه از نو ساخته شد');
    await context.close();
  }

  console.log('\n۷) FF2 — خروج');
  {
    const S = { report: null, start: null, end: null };
    const { page, context } = await open(S, {
      seed: {
        [`amalyar_draft:${UID}:61:opReport`]: { text: 'شرحِ عملِ دیگرِ جراح', base: '', at: Date.now() - 60e3 },
        'amalyar_draft:8:50:opReport': { text: 'پیش‌نویسِ پرستار', base: '', at: Date.now() - 60e3 },
      },
    });
    page.on('dialog', (d) => d.accept());
    await page.locator('.pm-chip').click();
    await page.locator('.pm-item', { hasText: /^\s*خروج\s*$/ }).click();
    await page.waitForURL(/\/login/);
    const keys = await draftKeys(page);
    ok(!keys.some((k) => k.startsWith(`amalyar_draft:${UID}:`)), '**باید بیفتد:** خروج پیش‌نویس‌های همان کاربر را پاک کرد', keys.join(' '));
    ok(keys.includes('amalyar_draft:8:50:opReport'), 'پیش‌نویسِ کاربرِ دیگرِ دستگاه دست نخورد (خروجِ او پاکش می‌کند)');
    await context.close();
  }
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\n${pass} پاس، ${fail} شکست`);
process.exit(fail ? 1 : 0);
