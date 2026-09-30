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
 *   - FF2: نشستِ مرده (۴۰۱ روی «ذخیره») پیش‌نویس را پاک **نمی‌کند** و ورودِ دوبارهٔ همان کاربر برش می‌گرداند
 *   - FF3: «برگرداندن» فقط ساعتی را برمی‌دارد که همین لمس نوشت (`expect`)؛ ۴۰۹ کارت را تازه می‌کند
 *   - FF4: «برگشت»ِ گوشی روی کارتِ دست‌خورده همان پرسشِ «فهرستِ روز» را می‌آورد؛ «برگشت» روی پرسش = ادامه
 *   - FF4: تعویضِ حساب با نوشتهٔ ذخیره‌نشده اول پرسیده می‌شود
 *   - FF14: ورودیِ جامانده از پنجره «فهرستِ روز» را دوضربه‌ای نمی‌کند
 *   - FF16: «اصلاحِ ساعت»ی که مدت را بیش از ۱۲ ساعت می‌کند پیش از ذخیره با عددِ مدت پرسیده می‌شود
 *   - FF13: روی تبلتِ لمسیِ پهن «اصلاحِ ساعت» و «بازکردنِ فرمِ عمل» کفِ لمسِ ۴۴px دارند
 *  نباید بیفتد:
 *   - FF1: شرحِ تازه‌ترِ پرونده با پیش‌نویسِ کهنه جایگزین شود — نه از «ذخیره»ِ کارت، نه از پرسشِ «فهرستِ روز»
 *   - FF1: پیش‌نویسِ بی‌پایه (نسخهٔ پیشین) بی‌صدا برگردد
 *   - FF2: نوشتهٔ یک کاربر پس از تعویضِ حساب زیرِ کلیدِ کاربرِ بعدی بنشیند
 *   - FF3: لمسی که ساعتی ننوشت (کسِ دیگری پیش‌تر زده بود) نوارِ «برگرداندن» بگیرد
 *   - FF3: «برگرداندن» ساعتی را پاک کند که در این فاصله کسِ دیگری عوض کرده
 *   - FF4: ژستِ برگشت فرمِ حینِ عملِ نیمه‌پر را بی‌پرسش دور بریزد
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
  items: [], documents: [], clinical: true,
  subforms: S.subforms ?? [],
  can: { subforms: !!S.subforms, followup: false, times: true, form: false }, locks: { followup: null }, checklist: [],
});
/** زیرفرمِ «حینِ عمل» — همان شکلِ `subformView`ِ سرور. */
const INTRA_FORM = {
  key: 'intra-detail', phase: 'intra', title: 'فرمِ آزمونیِ حینِ عمل', inactive: false,
  fields: [{ key: 'bleed', label: 'خون‌ریزی', type: 'text', required: false, options: [], active: true, roles: [] }],
  data: {}, summary: [],
};

/**
 * APIِ ساختگیِ stateful. `S` وضعیتِ «سرور» است و آزمون وسطِ راه عوضش می‌کند — همان کاری که
 * فرمِ عمل یا دستگاهِ دیگر با پرونده می‌کند. `S.onReport` پاسخِ ذخیرهٔ شرح را تعیین می‌کند.
 */
const ME = { id: UID, level: 6, status: 'active', firstName: 'جراحِ', lastName: 'آزمونی', displayName: 'جراحِ آزمونی', levelName: 'سوپرادمین' };
const NURSE = { id: 8, level: 2, status: 'active', firstName: 'پرستارِ', lastName: 'آزمونی', displayName: 'پرستارِ آزمونی', levelName: 'کارشناس' };
const DEAD = { status: 401, body: { message: 'نشست منقضی شده است' } };
const makeServer = (S) => ({ path, method, body }) => {
  /* `S.dead`: نشستِ همین مرورگر همین حالا باطل شد (ادمین شماره را عوض کرد، «خروج از همه» از دستگاهِ دیگر). */
  if (S.dead && (path === '/auth/me' || path === '/auth/accounts' || method !== 'GET')) return DEAD;
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
  /* همان قراردادِ سرور: ساعتِ موجود بازنویسی نمی‌شود و `stamped` می‌گوید این درخواست نوشت یا نه. */
  if (path === `/theatre/visits/${VID}/start` && method === 'POST') {
    const stamped = !S.start;
    if (!S.start) S.start = '10:15';
    return { ...cardOf(S), stamped };
  }
  if (path === `/theatre/visits/${VID}/finish` && method === 'POST') {
    const stamped = !S.end;
    if (!S.end) S.end = '11:40';
    return { ...cardOf(S), stamped };
  }
  /* `expect`: ساعتی که میز دید؛ اگر فرق کند ۴۰۹ — نیامدنش یعنی رفتارِ قدیم (بی‌سنجش). */
  if (path === `/theatre/visits/${VID}/times` && method === 'POST') {
    for (const [k, f] of [['opStartTime', 'start'], ['opEndTime', 'end']]) {
      if (body?.expect && k in body.expect && (S[f] ?? null) !== (body.expect[k] ?? null)) {
        return { status: 409, body: { message: 'ساعت را کسِ دیگری ثبت یا عوض کرده است — کارت تازه شد؛ اگر هنوز لازم است، دوباره اصلاحش کنید.' } };
      }
    }
    if (body && 'opStartTime' in body) S.start = body.opStartTime || null;
    if (body && 'opEndTime' in body) S.end = body.opEndTime || null;
    S.timesWrites = (S.timesWrites ?? 0) + 1;
    return cardOf(S);
  }
  if (method === 'GET') return [];
  return undefined;
};

const vite = await startVite(5231);
const browser = await launch();
/** یک مرورگرِ تازه — `seed` پیش‌نویس‌هایی است که پیش از بارگذاریِ صفحه روی «دستگاه» می‌نشینند.
 *  `fromList`: اول فهرستِ روز و بعد لمسِ ردیف — همان مسیری که کارت ورودیِ تاریخچهٔ خودش را می‌گیرد. */
const open = async (S, { seed = {}, viewport = { width: 390, height: 844 }, fromList = false, ...ctx } = {}) => {
  const c = await mockContext(browser, makeServer(S), { viewport, ...ctx });
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
  if (fromList) {
    await page.goto(`${vite.base}/app/theatre`, { waitUntil: 'networkidle' });
    await page.locator(`[data-visit-id="${VID}"]`).click();
  } else {
    await page.goto(`${vite.base}/app/theatre?visit=${VID}`, { waitUntil: 'networkidle' });
  }
  await page.locator('[data-note="opReport"]').waitFor();
  return { ...c, page };
};
const draftOf = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), DKEY);
const draftKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('amalyar_draft:')).sort());
const reportWrites = (w) => w.filter((x) => x.path === `/theatre/visits/${VID}/report`);
/** هر سناریو شکستِ خودش را ثبت می‌کند و بقیه ادامه می‌دهند — کدِ قدیمی باید **همهٔ** سنجه‌هایش را قرمز نشان دهد، نه اولی را. */
const scene = async (title, fn) => {
  console.log(title);
  try { await fn(); } catch (e) { fail++; console.log(`  ✘ ${title.trim()} — ${String(e?.message ?? e).split('\n')[0]}`); }
  finally { for (const c of browser.contexts()) await c.close().catch(() => {}); }
};

try {
  await scene('۱) FF1 — پرونده زیرِ دستِ کاربر عوض شد', async () => {
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
  });

  await scene('\n۲) FF1 — پیش‌نویسِ هم‌پایه برمی‌گردد؛ «ذخیره» پایه را هم می‌فرستد', async () => {
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
  });

  await scene('\n۳) FF1 — پیش‌نویسِ بی‌پایه (نسخهٔ پیشین) و «ادامه با نوشتهٔ من»', async () => {
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
  });

  await scene('\n۴) FF1 — سرور پایه را رد کرد (۴۰۹): کارت تازه و پرسش', async () => {
    const S = { report: 'شرحِ ب', start: null, end: null };
    S.onReport = () => { S.report = 'شرحِ ج — دستگاهِ دیگر'; return { status: 409, body: { message: 'متنِ پرونده از جای دیگری عوض شده است' } }; };
    const { page, context } = await open(S);
    await page.locator('[data-report]').fill('شرحِ ب — اصلاحِ من');
    await page.locator('[data-act="save-report"]').click();
    await page.locator('[data-note-conflict]').waitFor();
    ok((await page.locator('[data-note-conflict]').innerText()).includes('شرحِ ج — دستگاهِ دیگر'), '**باید بیفتد:** ۴۰۹ کارت را تازه کرد و متنِ واقعیِ پرونده در پرسش است');
    ok((await page.locator('.th-toast').innerText()).includes('عوض شده'), 'پیامِ فارسیِ سرور دیده شد');
    await context.close();
  });

  await scene('\n۵) FF2 — جارو هنگامِ بارگذاری', async () => {
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
  });

  await scene('\n۶) FF2 — تعویضِ حساب روی تبلتِ مشترک', async () => {
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
  });

  await scene('\n۷) FF2 — خروج', async () => {
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
  });

  await scene('\n۷ب) FF2 — نشستِ مرده پیش‌نویس را پاک نمی‌کند؛ ورودِ دوباره برش می‌گرداند', async () => {
    const S = { report: null, start: null, end: null };
    const { page, context } = await open(S);
    await page.locator('[data-report]').fill('شرحِ جراح پیش از باطل‌شدنِ نشست');
    await page.waitForFunction((k) => !!localStorage.getItem(k), DKEY);
    /* «ذخیره» ۴۰۱ می‌خورد ← `amalyar:unauthorized` ← `/auth/me` هم ۴۰۱ ← حسابِ دیگری نیست ← صفحهٔ ورود. */
    S.dead = true;
    await page.locator('[data-act="save-report"]').click();
    await page.waitForURL(/\/login/);
    ok((await draftOf(page))?.text === 'شرحِ جراح پیش از باطل‌شدنِ نشست',
      '**نباید بیفتد:** نشستِ مرده شرحِ ذخیره‌نشده را از دستگاه پاک کند', JSON.stringify(await draftOf(page)));
    /* همان کاربر دوباره وارد می‌شود و کارت را باز می‌کند. */
    S.dead = false;
    await page.goto(`${vite.base}/app/theatre?visit=${VID}`, { waitUntil: 'networkidle' });
    await page.locator('[data-report]').waitFor();
    ok(await page.locator('[data-report]').inputValue() === 'شرحِ جراح پیش از باطل‌شدنِ نشست'
      && (await page.locator('[data-note-state]').innerText()).includes('همین دستگاه'),
    '**باید بیفتد:** پس از ورودِ دوباره همان شرح روی کارت برگشت («ذخیره‌نشدهٔ همین دستگاه»)');
    await context.close();
  });

  await scene('\n۸) FF3 — «برگرداندن» فقط ساعتِ خودِ همین لمس', async () => {
    const S = { report: null, start: null, end: null };
    const { page, writes, context } = await open(S);
    const timesW = () => writes.filter((w) => w.path === `/theatre/visits/${VID}/times`);
    await page.locator('[data-act="start"]').click();
    await page.locator('[data-act="undo"]').waitFor();
    ok((await page.locator('.th-undo').innerText()).includes('۱۰:۱۵'), 'لمسی که نوشت نوارِ برگرداندن با همان ساعت گرفت');
    await page.locator('[data-act="undo"]').click();
    await page.locator('[data-act="start"]').waitFor();
    ok(JSON.stringify(timesW().at(-1)?.body) === '{"opStartTime":null,"expect":{"opStartTime":"10:15"}}',
      '**باید بیفتد:** «برگرداندن» مقدارِ دیده‌شده را می‌فرستد', JSON.stringify(timesW().at(-1)?.body));
    ok(S.start === null, 'و ساعت برداشته شد');

    /* دستگاهِ دیگر پیش‌تر «شروع» زده بود و این کارت هنوز نمی‌داند. */
    S.start = '09:00';
    await page.locator('[data-act="start"]').click();
    await page.locator('.th-step[data-step="start"][data-state="done"]').waitFor();
    ok(await page.locator('[data-act="undo"]').count() === 0, '**نباید بیفتد:** لمسی که چیزی ننوشت نوارِ «برگرداندن» نمی‌گیرد');
    ok((await page.locator('.th-toast').innerText()).includes('از پیش'), 'و گفته می‌شود که ساعت از پیش ثبت شده بود');
    ok(S.start === '09:00', 'ساعتِ دیگری سرِ جایش ماند');

    /* «پایان» را همین لمس می‌نویسد؛ پیش از «برگرداندن» دستگاهِ دیگر آن را اصلاح می‌کند. */
    await page.locator('[data-act="finish"]').click();
    await page.locator('[data-act="undo"]').waitFor();
    S.end = '11:55';
    const before = timesW().length;
    await page.locator('[data-act="undo"]').click();
    await page.locator('.th-toast', { hasText: 'کسِ دیگری' }).waitFor();
    ok(timesW().length === before + 1 && S.end === '11:55', '**نباید بیفتد:** «برگرداندن» ساعتِ اصلاح‌شدهٔ دیگری را پاک نکرد', `end=${S.end}`);
    await page.locator('.th-step[data-step="end"] .th-step-at', { hasText: '۱۱:۵۵' }).waitFor();
    ok(true, '۴۰۹ کارت را تازه کرد و ساعتِ واقعی دیده می‌شود');
    await context.close();
  });

  await scene('\n۹) FF4 — «برگشت»ِ گوشی روی کارتِ دست‌خورده', async () => {
    const S = { report: null, start: null, end: null, subforms: [INTRA_FORM] };
    const { page, writes, errors, context } = await open(S, { fromList: true });
    await page.locator('[data-act="desk-subform-edit"]').click();
    const len = await page.evaluate(() => history.length);
    await page.getByLabel('خون‌ریزی').fill('۲۰۰ سی‌سی — آزمونی');
    await page.waitForFunction((n) => history.length === n + 1, len);
    await page.goBack();
    await page.locator('[data-unsaved="keep"]').waitFor();
    ok((await page.locator('.ov-ask').innerText()).includes('فرمِ آزمونیِ حینِ عمل'),
      '**باید بیفتد:** برگشتِ گوشی همان پرسشِ «ذخیره نشده» را آورد، با نامِ فرم');
    ok(await page.getByLabel('خون‌ریزی').inputValue() === '۲۰۰ سی‌سی — آزمونی', '**نباید بیفتد:** فرمِ نیمه‌پر دور ریخته شود');
    /* «برگشت» روی پرسشِ باز = «ادامهٔ ویرایش» — همان قاعدهٔ پنجره‌ها. */
    await page.goBack();
    await page.locator('.ov-ask').waitFor({ state: 'detached' });
    ok(await page.getByLabel('خون‌ریزی').inputValue() === '۲۰۰ سی‌سی — آزمونی', 'برگشت روی پرسش = ادامهٔ ویرایش؛ کارت سرِ جایش');
    await page.goBack();
    await page.locator('[data-unsaved="discard"]').click();
    await page.locator('.th-list').waitFor();
    ok(!new URL(page.url()).searchParams.get('visit') && !writes.some((w) => w.path.endsWith('/subforms')),
      '«دور ریختن» ← فهرستِ روز، بی‌آنکه چیزی ذخیره شود');
    ok(errors.length === 0, 'بدونِ خطای JS', errors[0]);
    await context.close();
  });

  await scene('۹ب) FF4 — «ذخیره»ِ پرسشِ برگشت', async () => {
    const S = { report: null, start: null, end: null };
    const { page, writes, context } = await open(S, { fromList: true });
    const len = await page.evaluate(() => history.length);
    await page.locator('[data-report]').fill('شرحِ آزمونی برای ذخیره از پرسشِ برگشت');
    await page.waitForFunction((n) => history.length === n + 1, len);
    await page.goBack();
    await page.locator('[data-unsaved="save"]').click();
    await page.locator('.th-list').waitFor();
    await page.waitForFunction(() => !new URLSearchParams(location.search).get('visit'));
    ok(reportWrites(writes).length === 1 && reportWrites(writes)[0].body?.body === 'شرحِ آزمونی برای ذخیره از پرسشِ برگشت',
      '«ذخیره»ِ پرسشِ برگشت: یک ذخیره و یک بار بسته شد', JSON.stringify(reportWrites(writes).map((w) => w.body)));
    await page.locator(`[data-visit-id="${VID}"]`).waitFor();
    await context.close();
  });

  await scene('\n۱۰) FF14 — ورودیِ جامانده «فهرستِ روز» را دوضربه‌ای نمی‌کند', async () => {
    const S = { report: null, start: null, end: null };
    const { page, context } = await open(S, { fromList: true });
    /* پنجره‌ای که با ناوبری رفت ورودی‌اش را جا گذاشته — همان نشانیِ کارت، با نشانهٔ پنجرهٔ مرده. */
    await page.evaluate(() => history.pushState({ ...history.state, amalyarOverlay: 'ov-dead-test' }, ''));
    await page.getByRole('button', { name: 'فهرستِ روز' }).click();
    await page.locator('.th-list').waitFor();
    ok(!new URL(page.url()).searchParams.get('visit'), '**باید بیفتد:** یک لمس کافی بود');
    await context.close();
  });

  await scene('\n۱۱) FF4 — تعویضِ حساب با نوشتهٔ ذخیره‌نشده', async () => {
    const S = { report: null, start: null, end: null, accounts: [{ ...ME, active: true }, NURSE] };
    const { page, writes, context } = await open(S);
    await page.locator('[data-report]').fill('شرحِ نیمه‌کارهٔ آزمونی');
    let asked = '';
    page.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
    await page.locator('.pm-chip').click();
    await page.locator('.pm-acc-main', { hasText: 'پرستارِ آزمونی' }).click();
    await page.waitForFunction(() => true);
    ok(asked.includes('ذخیره نشده') && !writes.some((w) => w.path === '/auth/switch'),
      '**باید بیفتد:** پیش از تعویضِ حساب پرسیده شد و «نه» یعنی ماندن', asked);
    ok(await page.locator('[data-report]').inputValue() === 'شرحِ نیمه‌کارهٔ آزمونی', 'نوشته سرِ جایش ماند');
    await context.close();
  });

  await scene('\n۱۲) FF16 — مدتِ بیش از ۱۲ ساعت پیش از ذخیره پرسیده می‌شود', async () => {
    const S = { report: null, start: '10:00', end: '11:00' };
    const { page, writes, context } = await open(S);
    const timesW = () => writes.filter((w) => w.path === `/theatre/visits/${VID}/times`);
    await page.locator('[data-act="fix-start"]').click();
    await page.locator('.th-fix input[type="text"]').fill('13:10');
    await page.locator('[data-act="fix-save"]').click();
    await page.locator('[data-fix-long]').waitFor();
    ok((await page.locator('[data-fix-long]').innerText()).includes('۲۱ ساعت و ۵۰ دقیقه') && timesW().length === 0,
      '**باید بیفتد:** «۲۱ ساعت و ۵۰ دقیقه؟» پیش از ذخیره، و هنوز چیزی نرفته');
    await page.locator('[data-act="fix-recheck"]').click();
    ok(await page.locator('[data-fix-long]').count() === 0 && timesW().length === 0, '«اصلاح می‌کنم» ← کادرِ ساعت می‌ماند و چیزی ذخیره نمی‌شود');
    await page.locator('[data-act="fix-save"]').click();
    await page.locator('[data-act="fix-confirm"]').click();
    await page.locator('.th-toast', { hasText: 'ساعت اصلاح شد' }).waitFor();
    ok(JSON.stringify(timesW().at(-1)?.body) === '{"opStartTime":"13:10","expect":{"opStartTime":"10:00"}}',
      'تأییدِ صریح ← ذخیره، با ساعتِ دیده‌شده', JSON.stringify(timesW().at(-1)?.body));
    /* مدتِ عادی بی‌پرسش می‌رود. */
    await page.locator('[data-act="fix-end"]').click();
    await page.locator('.th-fix input[type="text"]').fill('14:00');
    await page.locator('[data-act="fix-save"]').click();
    await page.locator('.th-toast', { hasText: 'ساعت اصلاح شد' }).waitFor();
    ok(await page.locator('[data-fix-long]').count() === 0 && timesW().length === 2, 'مدتِ عادی (۵۰ دقیقه) بی‌پرسش ذخیره شد');
    await context.close();
  });

  await scene('\n۱۳) FF13 — کفِ لمسِ ۴۴px روی تبلتِ پهن', async () => {
    const S = { report: null, start: '10:00', end: null };
    const h = async (page) => page.evaluate(() => ['[data-act="fix-start"]', '[data-act="open-form"]']
      .map((q) => document.querySelector(q)?.getBoundingClientRect().height ?? 0));
    const tab = await open(S, { viewport: { width: 1024, height: 768 }, hasTouch: true });
    const coarse = await tab.page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    const [fix] = await h(tab.page);
    ok(coarse && fix >= 44, '**باید بیفتد:** «اصلاحِ ساعت» روی تبلتِ لمسیِ ۱۰۲۴px دست‌کم ۴۴px است', `coarse=${coarse} fix=${fix}`);
    await tab.context.close();
    const desk = await open(S, { viewport: { width: 1280, height: 800 } });
    const [fixDesk] = await h(desk.page);
    ok(fixDesk < 44, 'روی دسکتاپِ ماوس‌دار همان پیوندِ جمع‌وجور می‌ماند', `h=${fixDesk}`);
    await desk.context.close();
  });
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\n${pass} پاس، ${fail} شکست`);
process.exit(fail ? 1 : 0);
