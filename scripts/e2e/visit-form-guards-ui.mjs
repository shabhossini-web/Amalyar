/**
 * **فرمِ مراجعه/عمل — نگهبان‌ها و راهنمایی به فیلدِ خطادار** (بازبینیِ خصمانهٔ بستهٔ F ← بستهٔ FF).
 * مرورگرِ واقعی، APIِ ساختگی (`lib/mock-ui.mjs`). فرم از «بازکردنِ فرمِ عمل»ِ میزِ اتاقِ عمل باز می‌شود —
 * همان مسیرِ واقعیِ ویرایش (`useThings` ← `GET /visits/:id`).
 *
 *  باید بیفتد:
 *   - FF15: نوشته‌ای که پیش از رسیدنِ زیرفرم‌ها تایپ شد «ذخیره‌نشده» است؛ و اگر خواندنشان شکست خورد، نگهبان باز هم کار می‌کند
 *   - FF7: لینکِ نامعتبر در زبانهٔ پنهانِ «مشخصات» ذخیره را بی‌صدا نمی‌بندد — فرم به همان زبانه و فیلد می‌رود (شرکت)
 *   - FF9: خطای «ویزیتِ بعدی» در فرمِ عمل به زبانهٔ «بعد از عمل» می‌رود و کنارِ خودِ کادر دیده می‌شود
 *   - FF10: ستارهٔ منتخبِ سربرگ روی زبانهٔ «مشخصات» فرم را به مرحلهٔ خودش (حین) می‌چسباند
 *  نباید بیفتد:
 *   - FF11: فرمِ ویرایش پرونده جست‌وجو کند (`/patients?q=`)
 *   - FF12: «برگشت به شکایتِ …» داخلِ `<label>`ِ کادرِ شکایت بماند (نامِ دسترس‌پذیر و HTMLِ معتبر)
 */
import { startVite, launch, mockContext } from './lib/mock-ui.mjs';

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

const VID = 19;
const ME = { id: 7, level: 6, status: 'active', firstName: 'جراحِ', lastName: 'آزمونی', displayName: 'جراحِ آزمونی', levelName: 'سوپرادمین' };
const CLINIC = { vertical: 'clinic', kind: 'clinic', services: [], brand: {}, defaultKind: 'clinic' };
const COMPANY = { vertical: 'ionm', kind: 'company', services: ['ionm'], serviceCatalog: [{ key: 'ionm', label: 'نورومانیتورینگ' }], brand: {}, defaultKind: 'surgery' };
const BUILTINS = ['opDate', 'chiefComplaint', 'history', 'nextVisitDate', 'opStartTime', 'opEndTime', 'opReport', 'notes']
  .map((key) => ({ key, builtin: true, active: true }));
const INTRA_ITEM = {
  key: 'intra-detail', title: 'فرمِ آزمونیِ جزئیاتِ حینِ عمل', short: 'جزئیات', defaultPhase: 'intra', active: true, group: 'custom',
  fields: [{ key: 'bleed', label: 'خون‌ریزی', type: 'text', active: true }],
};

/** مراجعهٔ کامل (`GET /visits/:id`) — عملِ ۵ روزِ آینده، پس فرم روی مرحلهٔ «قبل» باز می‌شود. */
const visitOf = (o) => ({
  id: VID, patientId: 5, kind: 'surgery', seq: 2, code: 'AM-0001-V2', fullName: 'بیمارِ آزمونی',
  firstName: 'بیمارِ', lastName: 'آزمونی', phone: '09120000000', nationalId: '', birthDate: null,
  opDate: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) + 'T00:00:00.000Z', opStatus: 'pending', undated: false,
  surgeonId: null, hospitalId: null, techId: null, procedureTypeId: null, otherProcedureTypeIds: [], diagnosisId: null, otherDiagnosisIds: [],
  topicId: null, opType: '', chiefComplaintOwn: '', chiefComplaint: o.cc ?? null, chiefComplaintFrom: o.cc ? { kind: 'clinic', opDate: '2026-09-01T00:00:00.000Z' } : null,
  opReport: '', history: '', findings: '', exam: '', planNote: '', prescription: '', anesthesia: '',
  nextVisitDate: null, plannedDate: null, postOpCare: '', followUpDays: '', postOpImmediate: false, preOpCare: '', preOpImmediate: false,
  decisions: [], opStartTime: '', opEndTime: '', notes: '', extra: o.extra ?? {},
  ...(o.light ? {} : { subforms: [] }),
});
const cardOf = () => ({
  visit: {
    id: VID, code: 'AM-0001-V2', kind: 'surgery', opDate: '2026-10-05T00:00:00.000Z', opStatus: 'pending', state: 'waiting', stateFa: 'در انتظار',
    procedure: 'عملِ آزمونی', procedures: [], hospital: null, surgeon: null, tech: null, opStartTime: null, opEndTime: null, dischargeAt: null,
    chiefComplaint: null, diagnoses: [], opReport: null, findings: null,
  },
  patient: { id: 5, code: 'AM-0001', fullName: 'بیمارِ آزمونی' },
  decided: null, vitals: [], alerts: {}, items: [], documents: [], subforms: [], clinical: true,
  can: { form: true, times: true, subforms: false }, locks: {},
});

/**
 * `o.visitGet(n)`: پاسخِ nامین `GET /visits/:id` (اولی را `useThings` برای بازکردنِ فرم می‌خوانَد، دومی را خودِ
 * فرم وقتی ردیفِ سبک است) — `undefined` یعنی پاسخِ عادی.
 */
const makeServer = (o) => async ({ path, method, body }) => {
  if (path === '/auth/me') return ME;
  if (path === '/config') return o.company ? COMPANY : CLINIC;
  if (path === '/features') return ['theatre', 'dashboard'].map((key) => ({ key, allowed: true }));
  if (path === '/auth/accounts') return [];
  if (path === '/auth/prefs') return { subformPins: o.pins ?? [null, null, null], todayPins: [null, null, null] };
  if (path.startsWith('/theatre/day')) return { date: '2026-09-30', team: false, visits: [] };
  if (path.startsWith('/theatre/month')) return { days: [] };
  if (path.endsWith('/op-templates') || path.startsWith('/op-templates')) return { items: [], canAdd: false, procedure: null };
  if (path === `/theatre/visits/${VID}`) return cardOf();
  if (path === `/visits/${VID}` && method === 'GET') {
    o.gets = (o.gets ?? 0) + 1;
    const r = await o.visitGet?.(o.gets);
    return r ?? visitOf(o);
  }
  if (path === `/visits/${VID}` && method === 'PATCH') { (o.patches ??= []).push(body); return visitOf(o); }
  if (path === '/forms/visit-kinds') return [{ kind: 'surgery', title: 'عمل', color: 'violet' }];
  if (path === '/forms/visit.surgery') return { fields: [...BUILTINS, ...(o.custom ?? [])] };
  if (path === '/forms/subforms') return { groups: [], items: o.catalog ?? [] };
  if (path === '/ai/status') return { enabled: false, stt: false };
  if (path === '/care-plan/timing') return { preOpDays: 1, hour: 9, nextVisitDays: 1, followUpFormReady: true };
  if (path === `/visits/${VID}/prep`) return {};
  /* جست‌وجوی پرونده `GET /patients?q=` است — `mockContext` فقط مسیر را می‌دهد، نه کوئری را. */
  if (path === '/patients' && method === 'GET') { (o.searches ??= []).push(path); return []; }
  if (method === 'GET') return [];
  return {};
};

const vite = await startVite(5233);
const browser = await launch();
const scene = async (title, fn) => {
  console.log(title);
  try { await fn(); } catch (e) { fail++; console.log(`  ✘ ${title.trim()} — ${String(e?.message ?? e).split('\n')[0]}`); }
  finally { for (const c of browser.contexts()) await c.close().catch(() => {}); }
};
/** میزِ اتاقِ عمل ← «بازکردنِ فرمِ عمل». */
const openForm = async (o, { viewport = { width: 1280, height: 900 }, waitReady = true } = {}) => {
  const c = await mockContext(browser, makeServer(o), { viewport });
  const page = await c.context.newPage();
  page.setDefaultTimeout(9000);
  /* GETها را `mockContext` نگه نمی‌دارد — جست‌وجوی پرونده از همین فهرست سنجیده می‌شود. */
  await page.goto(`${vite.base}/app/theatre?visit=${VID}`, { waitUntil: 'networkidle' });
  await page.locator('[data-act="open-form"]').click();
  await page.locator('.db-sheet').waitFor();
  if (waitReady) await page.locator('.db-sheet [data-visit-bar]').waitFor();
  return { ...c, page };
};
const sheetOpen = (page) => page.locator('.db-sheet').count().then((n) => n === 1);

try {
  await scene('۱) FF15 — نوشتهٔ پیش از رسیدنِ زیرفرم‌ها «ذخیره‌نشده» است', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    /* ردیفِ سبک (بی‌`subforms`): فرم خودش زیرفرم‌ها را می‌خوانَد — و این خواندن تا `release` معطل است.
       ⚠️ «هر خواندنِ بعد از اولی»، نه فقط دومی: حالتِ توسعهٔ React (StrictMode) افکت را دوبار سوار می‌کند و
       خواندنِ دوم بی‌معطلی می‌رسید — سنجه روی کدِ قدیمی هم سبز می‌شد. */
    const o = { light: true, visitGet: async (n) => { if (n >= 2) { await gate; return { ...visitOf({}), subforms: [] }; } return undefined; } };
    const { page, errors } = await openForm(o, { waitReady: false });
    await page.getByRole('tab', { name: /مشخصات/ }).click();
    await page.locator('.db-sheet textarea').first().fill('شرحِ حالِ آزمونی، پیش از رسیدنِ زیرفرم‌ها');
    release();
    await page.waitForFunction(() => !document.querySelector('.db-sheet [data-act="attach-open"][disabled]'), null, { timeout: 4000 }).catch(() => {});
    await page.locator('.db-sheet-head [aria-label="بستن"]').first().click();
    await page.locator('[data-unsaved]').first().waitFor({ timeout: 4000 }).catch(() => {});
    ok(await page.locator('[data-unsaved="keep"]').count() === 1 && await sheetOpen(page),
      '**باید بیفتد:** بستن پرسید — نوشته جزوِ مبنا نشد');
    ok(errors.length === 0, 'بدونِ خطای JS', errors[0]);
  });

  await scene('\n۲) FF15 — خواندنِ زیرفرم‌ها شکست خورد؛ نگهبانِ بستن همچنان کار می‌کند', async () => {
    const o = { light: true, visitGet: async (n) => (n >= 2 ? { status: 500, body: { message: 'خطای آزمونی' } } : undefined) };
    const { page } = await openForm(o, { waitReady: false });
    await page.waitForFunction(() => true);
    await page.waitForTimeout(400);
    await page.getByRole('tab', { name: /مشخصات/ }).click();
    await page.locator('.db-sheet textarea').first().fill('نوشتهٔ آزمونی پس از شکستِ خواندن');
    await page.locator('.db-sheet-head [aria-label="بستن"]').first().click();
    await page.locator('[data-unsaved]').first().waitFor({ timeout: 4000 }).catch(() => {});
    ok(await page.locator('[data-unsaved="keep"]').count() === 1 && await sheetOpen(page),
      '**باید بیفتد:** بستن پرسید — نگهبان با شکستِ خواندن خاموش نماند');
  });

  await scene('\n۳) FF11 — فرمِ ویرایش پرونده جست‌وجو نمی‌کند', async () => {
    const o = {};
    const { page } = await openForm(o);
    await page.waitForTimeout(700);
    ok(!(o.searches ?? []).length, '**نباید بیفتد:** `/patients?q=` از فرمِ ویرایش', JSON.stringify(o.searches));
    ok(await sheetOpen(page), 'فرم باز است');
  });

  await scene('\n۴) FF12 — «برگشت به شکایتِ …» بیرون از برچسبِ کادر', async () => {
    const o = { cc: 'ضعفِ پای چپِ آزمونی' };
    const { page } = await openForm(o);
    await page.getByRole('tab', { name: /مشخصات/ }).click();
    await page.locator('[data-act="complaint-own"]').click();
    const box = page.locator('.db-sheet [data-act="complaint-inherit"]');
    await box.waitFor();
    const shape = await page.evaluate(() => {
      const back = document.querySelector('.db-sheet [data-act="complaint-inherit"]');
      const ta = back?.closest('.vf-cc-col, .vf-cc, [data-core="chiefComplaint"]')?.querySelector('textarea');
      const label = ta?.closest('label');
      return {
        backInLabel: !!back?.closest('label'),
        labelHasButton: !!label?.querySelector('button'),
        labelText: label?.textContent?.trim() ?? '',
        described: !!(ta?.getAttribute('aria-describedby') && document.getElementById(ta.getAttribute('aria-describedby'))),
      };
    });
    ok(!shape.backInLabel && !shape.labelHasButton, '**نباید بیفتد:** دکمهٔ «برگشت» داخلِ `<label>`ِ کادرِ شکایت', JSON.stringify(shape));
    ok(!shape.labelText.includes('برگشت') && !shape.labelText.includes('ضعفِ پای'), 'نامِ کادر فقط عنوانِ خودش است', shape.labelText);
    ok(shape.described, 'توضیحِ «خالی بماند تا …» با aria-describedby به کادر وصل است');
  });

  await scene('\n۵) FF9 — خطای «ویزیتِ بعدی» به زبانهٔ «بعد از عمل» می‌رود', async () => {
    const o = {};
    const { page } = await openForm(o);
    await page.getByRole('tab', { name: 'بعد از عمل' }).click();
    const next = page.locator('.jd-next input').first();
    await next.fill('1405/13/40');
    await page.getByRole('tab', { name: /مشخصات/ }).click();
    await page.locator('.db-sheet .db-submit').last().click();
    await page.locator('[data-core="nextVisitDate"].vf-bad').waitFor({ timeout: 5000 }).catch(() => {});
    const sel = await page.getByRole('tab', { name: 'بعد از عمل' }).getAttribute('aria-selected');
    ok(sel === 'true', '**باید بیفتد:** فرم به زبانهٔ «بعد از عمل» رفت', String(sel));
    ok(await page.locator('[data-core="nextVisitDate"].vf-bad .vf-core-err').count() === 1, 'خطا کنارِ خودِ کادرِ «ویزیتِ بعدی» است');
    ok(!(o.patches ?? []).length, 'چیزی ذخیره نشد');
  });

  await scene('\n۶) FF10 — ستارهٔ منتخب روی «مشخصات» فرم را به مرحلهٔ خودش می‌چسباند', async () => {
    const o = { pins: ['intra-detail', null, null], catalog: [INTRA_ITEM] };
    const { page } = await openForm(o);
    ok(await page.getByRole('tab', { name: 'قبل از عمل' }).getAttribute('aria-selected') === 'true', 'پیش‌شرط: فرم روی مرحلهٔ «قبل» باز شد');
    await page.getByRole('tab', { name: /مشخصات/ }).click();
    const pin = page.locator('.vf-pin[data-pin="intra-detail"]');
    ok((await pin.getAttribute('title'))?.includes('حین عمل'), 'راهنمای ستاره مرحلهٔ مقصدِ واقعی را می‌گوید', await pin.getAttribute('title'));
    await pin.click();
    await page.locator('[data-subform="intra-detail"]').first().waitFor();
    const phases = await page.$$eval('[data-subform="intra-detail"]', (els) => els.map((e) => e.dataset.subformPhase));
    ok(phases.join() === 'intra', '**باید بیفتد:** الصاق به «حین عمل»، نه به «قبل از عمل»', phases.join());
    ok(await pin.evaluate((b) => b.classList.contains('is-attached')), 'ستاره حالا «الصاق شده» است');
  });

  await scene('\n۷) FF7 — لینکِ نامعتبرِ زبانهٔ پنهان ذخیره را بی‌صدا نمی‌بندد (شرکت)', async () => {
    const o = { company: true, custom: [{ key: 'refs', label: 'لینک‌های آزمونی', type: 'links', active: true }] };
    const { page } = await openForm(o);
    await page.getByRole('tab', { name: /مشخصات/ }).click();
    /* دکمه لبهٔ پایینِ شیت است و نوارِ چسبانِ «ذخیره» رویش می‌افتد — اول وسطِ دید. */
    const add = page.locator('.db-sheet .dyn-links .dyn-img-pick').first();
    await add.evaluate((b) => b.scrollIntoView({ block: 'center' }));
    await add.click();
    await page.locator('.db-sheet input[type="url"]').first().fill('example.com/بی‌پروتکل');
    await page.getByRole('tab', { name: 'حین عمل' }).click();
    await page.locator('.db-sheet .db-submit').last().click();
    await page.waitForFunction(() => document.querySelector('.db-sheet [data-tab="info"]')?.hidden === false, null, { timeout: 5000 }).catch(() => {});
    ok(await page.locator('.db-sheet [data-tab="info"]').evaluate((e) => !e.hidden), '**باید بیفتد:** فرم به زبانهٔ «مشخصات» رفت');
    const err = await page.locator('.db-sheet').innerText();
    ok(/http/.test(err) && err.includes('لینک‌های آزمونی'), 'خطای «نشانی باید با http شروع شود» دیده می‌شود');
    ok(!(o.patches ?? []).length, 'چیزی ذخیره نشد');
    ok(await page.locator('.db-sheet form, form.db-sheet').first().evaluate((f) => f.noValidate), 'فرم `noValidate` است');
  });
} finally {
  await browser.close();
  vite.stop();
}
console.log(`\n${pass} پاس، ${fail} شکست`);
process.exit(fail ? 1 : 0);
