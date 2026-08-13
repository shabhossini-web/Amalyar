/**
 * **برنامهٔ کاری و روزهای آزاد** — `docs/BOOKING.md` مرحلهٔ ۲.
 *
 * دو حالت سنجیده می‌شود، چون کاربر هر دو را خواست:
 *  • `slot`     — «شنبه ۱۶ تا ۲۰، هر نوبت ۱۵ دقیقه» → بیمار ساعتِ دقیق می‌گیرد
 *  • `capacity` — «سه‌شنبه ۱۷ تا ۲۲، ۴۰ نفر»       → بیمار روز می‌گیرد
 *
 * ⚠️ ادعای مرکزی: «باز» یعنی **جای آزاد دارد**، نه «قاعده دارد». روزی که
 * ظرفیتش پر شده باید از دیدِ بیمار بسته باشد؛ وگرنه تا لحظهٔ ردشدنِ رزرو
 * نمی‌فهمد و این بدترین جای فهمیدن است.
 */
const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS ?? 'test1234';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ' + m); } };

const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: PASS }),
}).then((r) => r.json());
if (!login.accessToken) { console.error('ورود نشد — سرور را ری‌استارت کنید'); process.exit(1); }
const A = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.accessToken };
const get = (p) => fetch(API + p, { headers: A }).then((r) => r.json());
const send = (p, method, body) => fetch(API + p, { method, headers: A, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

/* ماهِ **آینده**: قاعده‌ها روی روزِ گذشته اثر ندارند و اگر ماهِ جاری را
   بگیریم، نیمی از ادعاها به «past» می‌خورند و آزمون بسته به روزِ اجرا
   نتیجهٔ متفاوت می‌دهد. */
const now = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: 'numeric', timeZone: 'UTC' })
  .formatToParts(new Date());
const jyNow = Number(now.find((p) => p.type === 'year').value.replace(/[^\d]/g, ''));
const jmNow = Number(now.find((p) => p.type === 'month').value);
const JY = jmNow === 12 ? jyNow + 1 : jyNow;
const JM = jmNow === 12 ? 1 : jmNow + 1;
console.log(`ماهِ هدف: ${JY}/${JM}`);

const tag = Math.random().toString(36).slice(2, 7);
const trash = { rules: [], topics: [], exceptions: [], appts: [] };

const { execSync } = await import('node:child_process');
const DB = process.env.E2E_DB ?? 'postgresql://amal:amal@localhost:5432/amalyar_uitest';
/* `-q` لازم است: بدونِ آن psql برچسبِ «INSERT 0 1» را هم چاپ می‌کند و
   شناسه با یک خطِ اضافه برمی‌گردد. */
const q = (sql) => execSync(`psql "${DB}" -qtAc ${JSON.stringify(sql)}`).toString().trim().split('\n')[0];

/* ⚠️ `try/finally` عمدی است. اجرای قبلی وسطِ راه کرش کرد و قاعده‌هایش در
   دیتابیس ماند؛ اجرای بعدی «شنبه ۳۰ جای آزاد دارد» دید و ادعاها بی‌دلیل
   قرمز شدند. قاعدهٔ README: هر آزمون باید بارِ دوم هم سبز باشد. */
try {

console.log('\n۱) قاعدهٔ اسلاتی — شنبه ۱۶:۰۰ تا ۲۰:۰۰، هر نوبت ۱۵ دقیقه');
const topic = (await send('/visit-topics', 'POST', { name: `اولیهٔ ${tag}` })).json;
trash.topics.push(topic.id);
const slotRule = (await send('/availability/rules', 'POST', {
  weekday: 0, startMin: 16 * 60, endMin: 20 * 60, mode: 'slot', slotMinutes: 15, topicIds: [topic.id],
})).json;
if (!slotRule?.id) { console.error('قاعده ساخته نشد:', JSON.stringify(slotRule)); process.exit(1); }
trash.rules.push(slotRule.id);
ok(slotRule.slotsPerDay === 16, `۴ ساعت ÷ ۱۵ دقیقه = ۱۶ نوبت (${slotRule.slotsPerDay})`);
ok(slotRule.start === '16:00' && slotRule.end === '20:00', `ساعت‌ها خوانا برمی‌گردند (${slotRule.start}–${slotRule.end})`);
ok(slotRule.topics?.[0]?.id === topic.id, 'موضوعِ روز به قاعده وصل شد');

console.log('\n۲) قاعدهٔ ظرفیتی — سه‌شنبه ۱۷:۰۰ تا ۲۲:۰۰، ۴۰ نفر');
const capRule = (await send('/availability/rules', 'POST', {
  weekday: 3, startMin: 17 * 60, endMin: 22 * 60, mode: 'capacity', capacity: 40,
})).json;
trash.rules.push(capRule.id);
ok(capRule.mode === 'capacity' && capRule.slotsPerDay === 40, `ظرفیت ۴۰ نفر (${capRule.slotsPerDay})`);
ok(capRule.slotMinutes === null, 'حالتِ ظرفیتی طولِ نوبت ندارد — دو مفهوم قاطی نمی‌شوند');

console.log('\n۳) قاعدهٔ بی‌معنی رد می‌شود');
const bad1 = await send('/availability/rules', 'POST', { weekday: 0, startMin: 1200, endMin: 1200, mode: 'slot', slotMinutes: 15 });
ok(bad1.status >= 400, `بازهٔ صفر رد شد (${bad1.status})`);
const bad2 = await send('/availability/rules', 'POST', { weekday: 0, startMin: 960, endMin: 1000, mode: 'slot', slotMinutes: 60 });
ok(bad2.status >= 400, `بازهٔ کوتاه‌تر از یک نوبت رد شد (${bad2.status})`);
const bad3 = await send('/availability/rules', 'POST', { weekday: 0, startMin: 960, endMin: 1200, mode: 'capacity', capacity: 0 });
ok(bad3.status >= 400, `ظرفیتِ صفر رد شد (${bad3.status})`);
const bad4 = await send('/availability/rules', 'POST', { weekday: 9, startMin: 960, endMin: 1200, mode: 'capacity', capacity: 5 });
ok(bad4.status >= 400, `روزِ هفتهٔ نامعتبر رد شد (${bad4.status})`);

console.log('\n۴) تقویمِ ماه — روزِ هفته شمسی است، نه میلادی');
const cal = await get(`/availability/month?year=${JY}&month=${JM}`);
const sat = cal.days.filter((d) => d.weekday === 0);
const tue = cal.days.filter((d) => d.weekday === 3);
ok(cal.days.length >= 29 && cal.days.length <= 31, `ماه ${cal.days.length} روز دارد`);
ok(sat.length >= 4, `${sat.length} شنبه در ماه`);
ok(sat.every((d) => d.windows.some((w) => w.mode === 'slot')), '**همهٔ شنبه‌ها بازهٔ اسلاتی دارند**');
ok(tue.every((d) => d.windows.some((w) => w.mode === 'capacity')), 'و همهٔ سه‌شنبه‌ها بازهٔ ظرفیتی');
const otherDay = cal.days.find((d) => d.weekday !== 0 && d.weekday !== 3);
ok(otherDay.windows.length === 0 && otherDay.open === false, `روزِ بی‌قاعده بسته است (${otherDay.date})`);
const s0 = sat[0];
ok(s0.free === 16, `شنبهٔ اول ۱۶ جای آزاد دارد (${s0.free})`);
ok(s0.windows[0].slots[0].time === '16:00', `اولین نوبت ۱۶:۰۰ است (${s0.windows[0].slots[0].time})`);
ok(s0.windows[0].slots.at(-1).time === '19:45', `آخرین نوبت ۱۹:۴۵ است (${s0.windows[0].slots.at(-1).time})`);

console.log('\n۵) نوبتِ گرفته‌شده جای آزاد را کم می‌کند');
const takenAt = 17 * 60;
/* مرحلهٔ ۳ هنوز مسیرِ رزرو ندارد، پس رکورد را از همان API نمی‌شود ساخت.
   این بند با درجِ مستقیم در دیتابیس سنجیده می‌شود تا محاسبهٔ «جای آزاد»
   بی‌آزمون نماند — همان چیزی که کلِ نوبت‌دهی روی آن سوار است. */
const apptId = q(`INSERT INTO appointments (date, start_min, status) VALUES ('${s0.date}', ${takenAt}, 'confirmed') RETURNING id`);
trash.appts.push(apptId);
const cal2 = await get(`/availability/month?year=${JY}&month=${JM}`);
const s0b = cal2.days.find((d) => d.date === s0.date);
ok(s0b.free === 15, `جای آزاد از ۱۶ به ۱۵ رسید (${s0b.free})`);
ok(s0b.windows[0].slots.find((x) => x.startMin === takenAt)?.taken === true, '**همان ۱۷:۰۰ اشغال علامت خورد**');
ok(s0b.open === true, 'و روز هنوز باز است');

console.log('\n۶) نوبتِ کنسل‌شده جا را آزاد می‌کند');
q(`UPDATE appointments SET status='cancelled' WHERE id=${apptId}`);
const cal3 = await get(`/availability/month?year=${JY}&month=${JM}`);
ok(cal3.days.find((d) => d.date === s0.date).free === 16, 'با کنسل، جا برگشت — کنسلی جای سوخته نمی‌سازد');
q(`UPDATE appointments SET status='confirmed' WHERE id=${apptId}`);

console.log('\n۷) روزِ تعطیل با استثنا بسته می‌شود، بدونِ بردنِ بقیهٔ شنبه‌ها');
const exc = (await send('/availability/exceptions', 'POST', { date: sat[1].date, closed: true, note: 'تعطیل' })).json;
trash.exceptions.push(exc.id);
const cal4 = await get(`/availability/month?year=${JY}&month=${JM}`);
const closed = cal4.days.find((d) => d.date === sat[1].date);
ok(closed.closed === true && closed.open === false && closed.free === 0, 'آن شنبه بسته شد');
ok(cal4.days.find((d) => d.date === sat[0].date).open === true, '**و شنبه‌های دیگر دست‌نخورده باز ماندند**');

console.log('\n۸) روزِ پر از دیدِ بیمار بسته است');
/* ظرفیتِ سه‌شنبه را ۱ می‌کنیم و یک نوبت می‌گیریم: قاعده هست ولی جا نیست. */
await send(`/availability/rules/${capRule.id}`, 'PATCH', { capacity: 1 });
const t0 = tue[0];
trash.appts.push(q(`INSERT INTO appointments (date, status) VALUES ('${t0.date}', 'held') RETURNING id`));
const cal5 = await get(`/availability/month?year=${JY}&month=${JM}`);
const full = cal5.days.find((d) => d.date === t0.date);
ok(full.windows.length === 1, 'قاعده هنوز روی روز هست');
ok(full.free === 0, 'ولی جای آزاد صفر است');
ok(full.open === false, '**پس روز «باز» نیست — «قاعده دارد» با «جا دارد» یکی نیست**');

console.log('\n۹) فیلترِ موضوع فقط روزهای همان موضوع را می‌دهد');
const other = (await send('/visit-topics', 'POST', { name: `زیباییِ ${tag}` })).json;
trash.topics.push(other.id);
const byTopic = await get(`/availability/month?year=${JY}&month=${JM}&topicId=${other.id}`);
ok(byTopic.days.filter((d) => d.weekday === 0).every((d) => d.windows.length === 0),
  'شنبه که فقط «اولیه» دارد، برای «زیبایی» بسته است');
ok(byTopic.days.filter((d) => d.weekday === 3).some((d) => d.windows.length > 0),
  'سه‌شنبه که موضوعِ خاصی ندارد، برای همه باز است');

console.log('\n۱۰) قاعدهٔ خاموش دیگر روز نمی‌سازد');
await send(`/availability/rules/${slotRule.id}`, 'PATCH', { active: false });
const cal6 = await get(`/availability/month?year=${JY}&month=${JM}`);
ok(cal6.days.filter((d) => d.weekday === 0).every((d) => d.windows.length === 0), 'شنبه‌ها خالی شدند');

} finally {
  console.log('\n' + '─'.repeat(50));
  console.log(`قبول: ${pass}   رد: ${fail}`);
  for (const id of trash.appts) q(`DELETE FROM appointments WHERE id=${id}`);
  for (const id of trash.exceptions) await fetch(API + `/availability/exceptions/${id}`, { method: 'DELETE', headers: A });
  for (const id of trash.rules) await fetch(API + `/availability/rules/${id}`, { method: 'DELETE', headers: A });
  for (const id of trash.topics) await fetch(API + `/visit-topics/${id}`, { method: 'DELETE', headers: A });
}
process.exit(fail ? 1 : 0);
