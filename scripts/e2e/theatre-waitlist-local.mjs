/**
 * **تختهٔ اتاقِ عمل و فهرستِ انتظار — «امروز»، «انجام شد» و سقفِ فهرست** (بازبینیِ خصمانهٔ بستهٔ F ← بستهٔ FF).
 *
 * بی‌سرور و بی‌دیتابیس: خودِ سرویس‌های کامپایل‌شده (`server/dist`) روی یک Prismaِ درون‌حافظه‌ای که
 * `where`/`orderBy`/`take`ِ واقعیِ کوئری‌ها را اجرا می‌کند، با ساعتِ یخ‌زده — چون هر سه باگ فقط در
 * «لحظهٔ» خاص یا «حجمِ» خاص دیده می‌شوند و سوییتِ زنده هیچ‌کدام را نمی‌تواند بسازد.
 *
 *  باید بیفتد:
 *   - FF6: ساعتِ ۰۱:۰۰ِ تهران (۲۱:۳۰ UTCِ دیروز) عملِ «دیروزِ تهران»ِ بی‌شروع «انجام‌نشده» است و عملِ
 *     امروزِ شروع‌شده «در جریان» — «امروز» روزِ مطب است نه روزِ کانتینر
 *   - FF8: عملی که «انجام شد» خورده ولی ساعتش سرِ میز زده نشد روی تخته «انجام شد» است
 *   - FF5: ۴۰۰ عملِ موعدگذشتهٔ قدیمی عملِ رزروشده و بی‌تاریخ را از فهرست بیرون نمی‌اندازند؛ از
 *     موعدگذشته‌ها تازه‌ترین‌ها می‌مانند و `truncated` گفته می‌شود
 *  نباید بیفتد:
 *   - FF8: همان عمل «در انتظار» بماند
 *
 * اجرا (پس از `cd server && npx nest build`):  node scripts/e2e/theatre-waitlist-local.mjs
 */
import { createRequire } from 'node:module';

/* ⚠️ منطقه و ساعت **پیش از** بارگذاریِ سرویس‌ها: `CLINIC_TZ` هنگامِ import خوانده می‌شود و `CLINIC_CLOCK`
   ساعتِ دیوار را از `new Date()` می‌گیرد. CI عمداً `CLINIC_TZ=UTC` می‌دهد؛ این آزمون دربارهٔ تهران است. */
process.env.CLINIC_TZ = 'Asia/Tehran';
const NOW = Date.parse('2026-09-22T21:30:00.000Z'); // ۰۱:۰۰ِ ۲۳ سپتامبر به وقتِ تهران
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [NOW])); }
  static now() { return NOW; }
};

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { TheatreService } = require('./dist/patients/theatre.service.js');
const { WaitlistService } = require('./dist/patients/waitlist.service.js');

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m + (d ? ' — ' + d : '')); } };

/* ── Prismaِ درون‌حافظه‌ای: همان شکل‌هایی که این دو سرویس می‌سازند ── */
const match = (w, r) => !w || Object.entries(w).every(([k, v]) => {
  if (k === 'AND') return v.every((x) => match(x, r));
  if (k === 'OR') return v.some((x) => match(x, r));
  if (k === 'NOT') return !match(v, r);
  if (k === 'patient' || k === 'decided') return true; // بیمارِ زنده؛ رابطه‌ای در این داده نیست
  const val = r[k];
  if (v === null) return val == null;
  if (typeof v !== 'object' || v instanceof RealDate) return +val === +v || val === v;
  if ('has' in v) return Array.isArray(val) && val.includes(v.has);
  if ('in' in v) return v.in.includes(val);
  return Object.entries(v).every(([op, x]) => {
    if (op === 'not') return x === null ? val != null : val !== x;
    if (val == null) return false;
    if (op === 'lt') return +val < +x;
    if (op === 'lte') return +val <= +x;
    if (op === 'gte') return +val >= +x;
    if (op === 'gt') return +val > +x;
    throw new Error(`عملگرِ پشتیبانی‌نشده: ${k}.${op}`);
  });
});
const order = (orderBy) => (a, b) => {
  for (const o of [].concat(orderBy ?? [])) {
    const [k, spec] = Object.entries(o)[0];
    const dir = typeof spec === 'string' ? spec : spec.sort;
    /* پیش‌فرضِ Postgres: صعودی ← تهیِ آخر، نزولی ← تهیِ اول. */
    const nulls = typeof spec === 'object' && spec.nulls ? spec.nulls : dir === 'asc' ? 'last' : 'first';
    const av = a[k]; const bv = b[k];
    if (av == null || bv == null) {
      if (av == null && bv == null) continue;
      return (av == null) === (nulls === 'first') ? -1 : 1;
    }
    const d = +av - +bv;
    if (d) return dir === 'asc' ? d : -d;
  }
  return 0;
};
const fakeDb = (rows, calls = []) => ({
  visit: {
    findMany: async (args) => {
      calls.push(args);
      const out = rows.filter((r) => match(args.where, r)).sort(order(args.orderBy));
      return args.take ? out.slice(0, args.take) : out;
    },
  },
});
const day = (iso) => new RealDate(`${iso}T00:00:00.000Z`);
const addDays = (iso, n) => new RealDate(+day(iso) + n * 864e5);
const SUPER = { id: 1, level: 6 };
const base = (id, over) => ({
  id, seq: 1, kind: 'surgery', decisions: [], opType: null, opStatus: 'pending', opDate: null, plannedDate: null,
  opStartTime: null, opEndTime: null, dischargeAt: null, chiefComplaint: null, decidedIn: null, decidedInVisitId: null,
  createdAt: addDays('2026-09-01', 0), hospitalName: null, hospital: null, surgeonName: null, surgeon: null, surgeonId: null,
  procedureTypeId: 1, procedureType: { name: 'عملِ آزمونی' }, otherProcedures: [], techId: null, tech: null,
  patient: { id: id, code: `AM-${id}`, firstName: 'بیمارِ', lastName: `آزمونی ${id}`, phone: null },
  ...over,
});

try {
  console.log('۱) FF6 — «امروز»ِ تختهٔ اتاقِ عمل روزِ مطب است، نه روزِ کانتینر');
  const theatre = (rows) => new TheatreService(fakeDb(rows), {}, {}, {}, {});
  const yesterdayTehran = base(11, { opDate: day('2026-09-22') });
  const todayRunning = base(12, { opDate: day('2026-09-23'), opStartTime: '00:30' });
  const r1 = await theatre([yesterdayTehran]).day('2026-09-22', SUPER);
  ok(r1.visits[0]?.state === 'missed', '**باید بیفتد:** ساعتِ ۰۱:۰۰ِ تهران، عملِ بی‌شروعِ دیروز «انجام‌نشده» است (نه «در انتظار»)',
    JSON.stringify([r1.visits[0]?.state, r1.visits[0]?.stateFa]));
  const r2 = await theatre([todayRunning]).day('2026-09-23', SUPER);
  ok(r2.visits[0]?.state === 'running', '**باید بیفتد:** عملِ امروزِ تهران که ۰۰:۳۰ شروع شد «در جریان» است',
    JSON.stringify([r2.visits[0]?.state, r2.visits[0]?.stateFa]));

  console.log('\n۲) FF8 — «انجام شد» از فهرستِ انتظار روی تخته «در انتظار» نمی‌ماند');
  const doneNoTimes = base(21, { opDate: day('2026-09-23'), opStatus: 'done' });
  const r3 = await theatre([doneNoTimes]).day('2026-09-23', SUPER);
  ok(r3.visits[0]?.state === 'finished' && r3.visits[0]?.stateFa === 'انجام شد',
    '**نباید بیفتد:** عملِ «انجام شد»ِ بی‌ساعت «در انتظار» بماند', JSON.stringify([r3.visits[0]?.state, r3.visits[0]?.stateFa]));
  const doneEnded = base(22, { opDate: day('2026-09-23'), opStatus: 'done', opStartTime: '00:10', opEndTime: '00:40' });
  ok((await theatre([doneEnded]).day('2026-09-23', SUPER)).visits[0]?.stateFa === 'در ریکاوری',
    'عملِ «انجام شد» با پایانِ ثبت‌شده همان «در ریکاوری» است — ساعتِ واقعی مقدم است');
  const cancelled = base(23, { opDate: day('2026-09-23'), opStatus: 'cancelled' });
  ok((await theatre([cancelled]).day('2026-09-23', SUPER)).visits[0]?.state === 'cancelled', 'لغو همچنان لغو است');

  console.log('\n۳) FF5 — سقفِ فهرستِ انتظار: موعدگذشته‌های قدیمی کارِ جاری را بیرون نمی‌اندازند');
  const rows = [];
  for (let i = 1; i <= 400; i++) rows.push(base(1000 + i, { opDate: addDays('2026-09-23', -i) })); // دیروز تا ۴۰۰ روز پیش
  rows.push(base(2001, { opDate: addDays('2026-09-23', 10) })); // رزروشده
  rows.push(base(2002, { opDate: null })); // بی‌تاریخ
  const calls = [];
  const wl = new WaitlistService(fakeDb(rows, calls), { profile: async () => ({ kind: 'clinic' }) }, {});
  const res = await wl.list(SUPER);
  const keys = new Set(res.rows.map((r) => r.key));
  ok(keys.has('surgery:2001') && keys.has('surgery:2002'),
    '**باید بیفتد:** عملِ رزروشده و بی‌تاریخ در فهرست‌اند، با وجودِ ۴۰۰ موعدگذشته', `rows=${res.rows.length}`);
  ok(keys.has('surgery:1001') && !keys.has('surgery:1400'),
    '**باید بیفتد:** از موعدگذشته‌ها تازه‌ترین (دیروز) مانده و کهنه‌ترین (۴۰۰ روز پیش) بیرون است');
  ok(res.truncated === true && res.stats.overdue === 300, '`truncated` گفته شد و موعدگذشته‌ها سقفِ خودشان را دارند',
    JSON.stringify({ truncated: res.truncated, overdue: res.stats.overdue }));
  ok(res.rows[0]?.state === 'overdue', 'موعدگذشته همچنان بالای فهرست است');
} catch (e) {
  fail++;
  console.log('  ✘ اجرا متوقف شد — ' + (e?.stack ?? e));
}

console.log('\n' + '─'.repeat(50));
console.log(`قبول: ${pass}   رد: ${fail}`);
process.exit(fail ? 1 : 0);
