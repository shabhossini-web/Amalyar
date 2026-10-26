/**
 * **پروندهٔ واحد** — چینش، پذیرش، فرمِ خدمت، پنلِ کارشناس، تحویل و دستگاه یک داده را می‌خوانند و می‌نویسند
 * (تصمیمِ مالک ۱۴۰۵/۰۸/۰۴: «ساعتِ شروع و پایان، مشخصاتِ فردی یا موارد داخلِ فرم همه واحدند و از هر جا خوانده
 * یا تغییر پیدا کنند، روی همه‌جا تأثیر دارند»).
 *
 *  باید بیفتد:
 *   - انتسابِ چینش روی تیمِ پرونده می‌نشیند («از چینش»)، و عضوی که فرمِ خدمت اضافه کند حضورِ همان روز را در
 *     چینش و پیش‌نمایشِ پیامک می‌گیرد
 *   - «شروع»ِ کارشناس = ورودِ اولین عضو؛ ثبتِ ساعت از فرم/داشبورد هم همان را عوض می‌کند
 *   - تحویل: خروجِ مسئولِ فعلی و ورودِ نفرِ بعد با یک ساعت، مسئولیت (techId) جابه‌جا، «تحویل از …»
 *   - «پایان»ِ نفرِ آخر = پایانِ خدمت در پرونده
 *   - دستگاهِ حملِ همین پرونده با «شروع» خودکار دستگاهِ پرونده می‌شود؛ انبار آن روز «رزرو» می‌بیند و
 *     فرستادنش به بیمارستانِ دیگر هشدار می‌دهد
 *   - گزارشِ حذف‌شده در پنلِ کارشناس «ثبت شده» نیست
 *  نباید بیفتد:
 *   - کارشناسِ غیرِمسئول پرونده را تحویل دهد؛ تحویل به خودِ مسئول؛ ساعتِ تحویل پیش از ورود
 *   - انتسابِ دوبارهٔ چینش پس از شروع، مسئولِ شروع‌کرده را از تیم بیرون بیندازد
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const API = process.env.E2E_API ?? 'http://localhost:3101/api';
const DB = process.env.E2E_DB;
if (!DB || ![API, DB].every((u) => ['localhost', '127.0.0.1'].includes(new URL(u).hostname))) throw new Error('فقط محیط محلی جداگانه');
const db = new PrismaClient({ datasources: { db: { url: DB } } });
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log(`  ✘ ${m}${d ? ` — ${d}` : ''}`); } };
const j = async (r) => ({ status: r.status, data: await r.json().catch(() => null) });
const call = (token, path, body, method = body ? 'POST' : 'GET') => fetch(API + path, { method,
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(j);
const login = async (identifier) => (await j(await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'test1234' }) }))).data?.accessToken;
const set = (key, value) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
const tag = randomBytes(3).toString('hex');

await set('vertical', 'ionm'); await set('services', JSON.stringify(['ionm']));
const admin = await login('admin');
if (!admin) throw new Error('ورود نشد');
const A = (p, b, m) => call(admin, p, b, m);
const hash = await bcrypt.hash('test1234', 4);
const mkTech = (n) => db.account.create({ data: { username: `${tag}u${n}`, passwordHash: hash, level: 2, status: 'active',
  person: { create: { firstName: `کارشناس${n}`, lastName: tag } } } });
const [t1, t2, t3] = [await mkTech(1), await mkTech(2), await mkTech(3)];
const [tok1, tok2, tok3] = [await login(`${tag}u1`), await login(`${tag}u2`), await login(`${tag}u3`)];
const hospital = await db.hospital.create({ data: { name: `بیمارستانِ واحد ${tag}` } });
const other = await db.hospital.create({ data: { name: `بیمارستانِ دیگر ${tag}` } });
const surgeon = await db.surgeon.create({ data: { person: { create: { firstName: 'دکتر', lastName: `واحد${tag}` } } } });
const item = await db.item.create({ data: { name: `دستگاهِ واحد ${tag}`, assetKind: 'device', unit: 'دستگاه' } });
const lot = await db.stockLot.create({ data: { itemId: item.id, serialNo: `UN-${tag}` } });

const day = new Date().toISOString().slice(0, 10);
const dayDate = new Date(`${day}T00:00:00.000Z`);
const crewOf = async (id) => db.visitCrew.findMany({ where: { visitId: id }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
const visitOf = (id) => db.visit.findUnique({ where: { id } });

try {
  const v = (await A('/visits', { kind: 'surgery', firstName: 'بیمارِ', lastName: `واحد${tag}`, opDate: dayDate.toISOString(), hospitalId: hospital.id, surgeonId: surgeon.id, opStartTime: '08:00' })).data;
  ok(!!v?.id, 'مراجعهٔ خدمتِ امروز ساخته شد', JSON.stringify(v).slice(0, 140));

  console.log('\n۱) چینش ← تیمِ پرونده');
  ok((await A('/dispatch/roster', { date: day, hospitalId: hospital.id, techId: t1.id, arriveTime: '07:30' })).status < 300, 'حضورِ کارشناس۱ در برنامهٔ چینش');
  const asg = await A(`/dispatch/roster/visits/${v.id}`, { techId: t1.id }, 'PATCH');
  ok(asg.status === 200, `انتسابِ چینش (${asg.status})`, JSON.stringify(asg.data).slice(0, 140));
  let crew = await crewOf(v.id);
  ok(crew.length === 1 && crew[0].accountId === t1.id && crew[0].source === 'dispatch', '**انتسابِ چینش روی تیمِ پرونده نشست («از چینش»)**', JSON.stringify(crew));
  let view = (await A(`/visits/${v.id}/service`)).data;
  ok(view?.crew?.[0]?.sourceFa === 'از چینش' && view.crew[0].current, 'فرمِ خدمت همان را با «از چینش» و «مسئولِ فعلی» نشان می‌دهد', JSON.stringify(view?.crew));

  console.log('\n۲) فرمِ خدمت ← چینش و پیامک');
  const put = await A(`/visits/${v.id}/service/crew`, { crew: [{ accountId: t1.id }, { accountId: t2.id }] }, 'PUT');
  ok(put.status === 200 && put.data?.crew?.length === 2, 'کارشناس۲ از فرمِ خدمت به تیم آمد');
  crew = await crewOf(v.id);
  ok(crew[0].source === 'dispatch' && crew[1].source === 'form', '«از کجا آمد»ِ عضوِ ماندگار عوض نشد');
  const roster = (await A(`/dispatch/roster?date=${day}`)).data;
  const hg = roster?.hospitals?.find((h) => h.hospitalId === hospital.id);
  ok(hg?.duties?.some((d) => d.techId === t2.id), '**عضوِ دومِ فرمِ خدمت در برنامهٔ چینشِ همان روز آمد**', JSON.stringify(hg?.duties));
  ok(hg?.visits?.find((x) => x.id === v.id)?.crew?.length === 2, 'تابلوی چینش تیمِ کامل را دارد');
  const prev = (await A(`/dispatch/roster/preview?date=${day}`)).data;
  ok(prev?.programs?.find((p) => p.techId === t2.id)?.text?.includes(`واحد${tag}`), '**پیش‌نمایشِ پیامکِ کارشناس۲ این بیمار را «قطعی» دارد**');
  ok((await visitOf(v.id)).techId === t1.id, 'مسئولِ فعلی هنوز کارشناس۱ (اولین عضوِ شروع‌نکرده)');

  console.log('\n۳) دستگاهِ حمل + شروعِ کارشناس');
  await db.stockTransfer.create({ data: { code: `HV-U${tag}`, fromLocation: 'انبار', toLocation: hospital.name, hospitalId: hospital.id, visitId: v.id,
    status: 'planned', plannedFor: dayDate, plannedLines: [{ lotId: lot.id, quantity: 1 }] } });
  const st = await call(tok1, `/tech/visits/${v.id}/times`, { opStartTime: '08:10' }, 'PATCH');
  ok(st.status === 200, `کارشناس۱ «شروع» زد (${st.status})`, JSON.stringify(st.data).slice(0, 140));
  crew = await crewOf(v.id);
  ok(crew[0].fromTime === '08:10', '**شروعِ کار = ورودِ اولین عضوِ تیم**', JSON.stringify(crew));
  ok((await visitOf(v.id)).deviceLotId === lot.id, '**دستگاهِ حملِ همین پرونده با «شروع» دستگاهِ پرونده شد**');
  ok(st.data?.device?.lotId === lot.id && st.data?.workLabel === 'نورومانیتورینگ', 'کارتِ پنل دستگاه و «نورومانیتورینگ» را دارد', JSON.stringify({ d: st.data?.device, w: st.data?.workLabel }));
  const assets = (await A(`/assets?on=${dayDate.toISOString()}`)).data ?? [];
  const a = assets.find((x) => x.lotId === lot.id);
  ok(a?.state === 'booked', `انبار دستگاه را آن روز «رزرو» می‌بیند (${a?.state})`);
  const away = await A('/stock/transfers', { toLocation: other.name, hospitalId: other.id, plannedFor: dayDate.toISOString(), planOnly: true, lines: [{ lotId: lot.id, quantity: 1 }] });
  ok(away.status === 400 && /پرونده|تداخل/.test(away.data?.message ?? ''), '**فرستادنِ همان دستگاه به بیمارستانِ دیگر هشدار می‌دهد**', `${away.status} ${away.data?.message}`);

  console.log('\n۴) ثبتِ ساعت از داشبورد ← تیم');
  ok((await A(`/visits/${v.id}/times`, { opStartTime: '08:05' }, 'PATCH')).status === 200, 'اصلاحِ شروع از داشبورد');
  ok((await crewOf(v.id))[0].fromTime === '08:05', '**ساعتِ داشبورد روی ورودِ اولین عضو هم نشست**');
  const re = await A(`/dispatch/roster/visits/${v.id}`, { techId: null }, 'PATCH');
  ok(re.status === 200 && (await crewOf(v.id)).some((c) => c.accountId === t1.id), 'برداشتنِ کارشناس در چینش، عضوِ شروع‌کرده را از سابقهٔ تیم پاک نمی‌کند', `${re.status}`);
  ok((await visitOf(v.id)).techId === t1.id, 'مسئولِ فعلی همان کارشناس۱ ماند');

  console.log('\n۵) تحویل به کارشناسِ بعدی');
  ok((await call(tok2, `/tech/visits/${v.id}/handover`, { toAccountId: t3.id, at: '10:00' })).status === 403, 'کارشناسِ غیرِمسئول تحویل نمی‌دهد (۴۰۳)');
  ok((await call(tok1, `/tech/visits/${v.id}/handover`, { toAccountId: t1.id, at: '10:00' })).status === 400, 'تحویل به خودِ مسئول رد می‌شود');
  ok((await call(tok1, `/tech/visits/${v.id}/handover`, { toAccountId: t2.id, at: '07:00' })).status === 400, 'ساعتِ تحویل پیش از ورود رد می‌شود');
  const cands = (await call(tok1, `/tech/visits/${v.id}/handover-candidates`)).data ?? [];
  ok(cands[0]?.where === 'here', `نامزدِ اول «امروز در همین بیمارستان» است (${cands[0]?.note})`);
  const ho = await call(tok1, `/tech/visits/${v.id}/handover`, { toAccountId: t2.id, at: '10:40' });
  ok(ho.status === 201 || ho.status === 200, `کارشناس۱ تحویل داد (${ho.status})`, JSON.stringify(ho.data).slice(0, 160));
  crew = await crewOf(v.id);
  ok(crew[0].accountId === t1.id && crew[0].toTime === '10:40' && crew[1].accountId === t2.id && crew[1].fromTime === '10:40'
    && crew[1].source === 'handover' && crew[1].handedFromId === t1.id, '**خروجِ کارشناس۱ و ورودِ کارشناس۲ با یک ساعت؛ «تحویل از کارشناس۱»**', JSON.stringify(crew));
  ok((await visitOf(v.id)).techId === t2.id, '**مسئولیت (techId) به کارشناس۲ رفت — چینش و حمل همین را می‌بینند**');
  const ag2 = (await call(tok2, '/tech/agenda?scope=today')).data;
  const card2 = ag2?.visits?.find((x) => x.id === v.id);
  ok(card2?.canHandover === true && card2?.crew?.find((c) => c.accountId === t2.id)?.mine, 'در پنلِ کارشناس۲ «شما — مسئولِ فعلی» و دکمهٔ تحویل');
  const ag1 = (await call(tok1, '/tech/agenda?scope=today')).data;
  ok(ag1?.visits?.find((x) => x.id === v.id)?.canHandover === false, 'کارشناس۱ پرونده را می‌بیند ولی دیگر تحویل نمی‌دهد');
  view = (await A(`/visits/${v.id}/service`)).data;
  ok(view?.crew?.[1]?.sourceFa === `تحویل از کارشناس1 ${tag}`, 'فرمِ خدمت «تحویل از کارشناس۱» را نشان می‌دهد', view?.crew?.[1]?.sourceFa);

  console.log('\n۶) پایان = خروجِ آخرین عضو');
  ok((await call(tok2, `/tech/visits/${v.id}/times`, { opEndTime: '12:25' }, 'PATCH')).status === 200, 'کارشناس۲ «پایان» زد');
  crew = await crewOf(v.id);
  ok(crew[crew.length - 1].toTime === '12:25' && crew[0].toTime === '10:40', '**پایانِ کار روی خروجِ آخرین عضو نشست؛ عضوِ اول دست نخورد**', JSON.stringify(crew.map((c) => [c.fromTime, c.toTime])));
  view = (await A(`/visits/${v.id}/service`)).data;
  ok(view?.monitoring?.start === '08:05' && view?.monitoring?.end === '12:25', 'فرمِ خدمت همان شروع/پایان را دارد', JSON.stringify(view?.monitoring));
  const fix = await A(`/visits/${v.id}/service/crew`, { crew: [{ accountId: t1.id, fromTime: '08:00', toTime: '10:40' }, { accountId: t2.id, fromTime: '10:40', toTime: '12:30' }] }, 'PUT');
  const vv = await visitOf(v.id);
  ok(fix.status === 200 && vv.opStartTime === '08:00' && vv.opEndTime === '12:30', '**اصلاحِ ساعتِ تیم در فرمِ خدمت ساعتِ پرونده را عوض کرد**', `${vv.opStartTime}-${vv.opEndTime}`);
  ok((await A(`/visits/${v.id}/service/crew`, { crew: [{ accountId: t1.id }] }, 'PUT')).status === 200
    && (await crewOf(v.id))[0].source === 'dispatch', 'ذخیرهٔ دوبارهٔ فرم «از کجا آمد»ِ عضو را از دست نمی‌دهد');

  console.log('\n۷) ستِ عمومیِ «بیمارستان + روز»');
  const v2 = (await A('/visits', { kind: 'surgery', firstName: 'بیمارِ', lastName: `دوم${tag}`, opDate: dayDate.toISOString(), hospitalId: hospital.id, surgeonId: surgeon.id, opStartTime: '13:00' })).data;
  await A(`/dispatch/roster/visits/${v2.id}`, { techId: t1.id }, 'PATCH');
  const setItem = await db.item.create({ data: { name: `ستِ عمومی ${tag}`, assetKind: 'consumable', unit: 'عدد' } });
  const setLot = await db.stockLot.create({ data: { itemId: setItem.id, lotNo: `S-${tag}` } });
  await db.stockTransfer.create({ data: { code: `HV-S${tag}`, fromLocation: 'انبار', toLocation: hospital.name, hospitalId: hospital.id, visitId: v.id, shared: true,
    status: 'planned', plannedFor: dayDate, plannedLines: [{ lotId: setLot.id, quantity: 5 }] } });
  const agS = (await call(tok1, '/tech/agenda?scope=today')).data;
  const sOf = (id) => agS?.visits?.find((x) => x.id === id)?.transfers?.find((t) => t.code === `HV-S${tag}`);
  ok(sOf(v.id)?.shared && sOf(v2.id)?.shared, '**ستِ عمومی روی کارتِ هر دو بیمارِ همان بیمارستان آمد، با برچسبِ «عمومی»**', JSON.stringify([sOf(v.id), sOf(v2.id)]).slice(0, 200));
  const movedDay = new Date(dayDate.getTime() + 2 * 864e5);
  await A(`/visits/${v.id}`, { opDate: movedDay.toISOString() }, 'PATCH');
  const hv = await db.stockTransfer.findFirst({ where: { code: `HV-U${tag}` } });
  const hs = await db.stockTransfer.findFirst({ where: { code: `HV-S${tag}` } });
  ok(hv?.plannedFor?.toISOString().slice(0, 10) === movedDay.toISOString().slice(0, 10) && hv?.stopId === null, '**موکول‌شدنِ عمل حملِ هنوز نرفته‌اش را هم به روزِ تازه برد**', hv?.plannedFor?.toISOString());
  ok(hs?.plannedFor?.toISOString().slice(0, 10) === day, 'ستِ عمومیِ بیمارستان با لنگرش جابه‌جا نشد — مالِ بقیه است');

  console.log('\n۸) مصرف از ستِ عمومی — فقط از کارتِ هر بیمار، هر کدام به نامِ خودش');
  const v3 = (await A('/visits', { kind: 'surgery', firstName: 'بیمارِ', lastName: `سوم${tag}`, opDate: dayDate.toISOString(), hospitalId: hospital.id, surgeonId: surgeon.id, opStartTime: '15:00' })).data;
  await A(`/dispatch/roster/visits/${v3.id}`, { techId: t1.id }, 'PATCH');
  const elItem = await db.item.create({ data: { name: `الکترودِ ${tag}`, assetKind: 'consumable', unit: 'عدد' } });
  const elLot = await db.stockLot.create({ data: { itemId: elItem.id, lotNo: `E-${tag}` } });
  await db.stockMovement.create({ data: { lotId: elLot.id, kind: 'in', quantity: 20, location: 'انبارِ مرکزی', reason: 'آزمون' } });
  const sent = await A('/stock/transfers', { toLocation: hospital.name, hospitalId: hospital.id, visitId: v2.id, plannedFor: dayDate.toISOString(), lines: [{ lotId: elLot.id, quantity: 20 }] });
  ok(sent.status === 201 && sent.data?.status === 'sent', `ستِ امروز فرستاده شد (${sent.status} ${sent.data?.status})`, JSON.stringify(sent.data).slice(0, 160));
  await db.stockTransfer.update({ where: { id: sent.data.id }, data: { shared: true } });
  const use = (visitId, quantity) => call(tok1, `/stock/visits/${visitId}/usage`, { lines: [{ source: 'transfer', itemId: elItem.id, lotId: elLot.id, quantity }] });
  const u2 = await use(v2.id, 4);
  ok(u2.status === 201 || u2.status === 200, `بیمارِ دوم ۴ عدد (${u2.status})`, JSON.stringify(u2.data).slice(0, 160));
  const u3 = await use(v3.id, 2);
  ok(u3.status === 201 || u3.status === 200, `بیمارِ سوم ۲ عدد (${u3.status})`, JSON.stringify(u3.data).slice(0, 160));
  const lineOf = (sheet) => sheet?.transfers?.flatMap((b) => b.lines)?.find((l) => l.lotId === elLot.id);
  const s2 = (await call(tok1, `/stock/visits/${v2.id}/usage`)).data;
  ok(lineOf(s2)?.quantity === 4 && lineOf(s2)?.limit === 18, `**ثبتِ بیمارِ سوم عددِ بیمارِ دوم را بازنویسی نکرد** (۴، سقف ۱۸ = ۲۰ − ۲)`, JSON.stringify(lineOf(s2)));
  ok((await use(v3.id, 17)).status === 400, 'بیشتر از «ارسالی − مصرفِ بقیه» رد می‌شود');
  const tv = (await A(`/stock/transfers/${sent.data.id}`)).data;
  const tl = tv?.lines?.find((l) => l.lotId === elLot.id);
  ok(tl?.used === 6 && tl.byVisit?.length === 2 && tl.byVisit.some((b) => b.visitId === v2.id && b.used === 4), '**برگهٔ حواله جمع (۶) و تفکیکِ هر بیمار را نشان می‌دهد**', JSON.stringify(tl));
  const legacy = await A(`/stock/transfers/${sent.data.id}/usage`, { lines: [{ lotId: elLot.id, used: 10 }] });
  ok(legacy.status === 400, `برگهٔ حواله دیگر مصرف نمی‌گیرد (${legacy.status})`);
  const vu = await db.visitUsage.findMany({ where: { visitId: { in: [v2.id, v3.id] } } });
  ok(vu.find((x) => x.visitId === v2.id)?.quantity === 4 && vu.find((x) => x.visitId === v3.id)?.quantity === 2, 'هر مصرف روی پروندهٔ همان بیمار نشست');

  console.log('\n۹) حملِ رفته + تغییرِ روزِ عمل ← هشدار و کار');
  const v4 = (await A('/visits', { kind: 'surgery', firstName: 'بیمارِ', lastName: `چهارم${tag}`, opDate: dayDate.toISOString(), hospitalId: hospital.id, surgeonId: surgeon.id, opStartTime: '16:00' })).data;
  await A(`/dispatch/roster/visits/${v4.id}`, { techId: t1.id }, 'PATCH');
  await db.stockMovement.create({ data: { lotId: elLot.id, kind: 'in', quantity: 5, location: 'انبارِ مرکزی', reason: 'آزمون' } });
  const own = await A('/stock/transfers', { toLocation: hospital.name, hospitalId: hospital.id, visitId: v4.id, plannedFor: dayDate.toISOString(), lines: [{ lotId: elLot.id, quantity: 5 }] });
  ok(own.data?.status === 'sent', 'حوالهٔ تک‌بیمارِ امروز رفت');
  const next = new Date(dayDate.getTime() + 864e5);
  const ed = await A(`/visits/${v4.id}`, { opDate: next.toISOString() }, 'PATCH');
  ok(ed.status === 200 && /هنوز در/.test(ed.data?.transportWarning ?? ''), '**ویرایشِ تاریخ ثبت شد و «ست هنوز در … است» هشدار داد**', `${ed.status} ${ed.data?.transportWarning}`);
  const stillThere = await db.stockTransfer.findUnique({ where: { id: own.data.id } });
  ok(stillThere.status === 'sent' && stillThere.plannedFor.toISOString().slice(0, 10) === day, 'حوالهٔ رفته دست نخورد');
  await A('/work/process', {});
  const works = await db.workItem.findMany({ where: { refType: 'stock_transfer', refId: own.data.id, type: { in: ['transport_stale', 'transport_stale_tech'] } } });
  ok(works.some((w) => w.type === 'transport_stale' && w.ownerRole === 'secretary' && w.state === 'open')
    && works.some((w) => w.type === 'transport_stale_tech' && w.ownerAccountId === t1.id), '**کارِ «حملِ جامانده» برای دفتر و برای کارشناسِ پرونده ساخته شد**', JSON.stringify(works.map((w) => [w.type, w.ownerRole, w.ownerAccountId, w.state])));
  ok((await A(`/stock/transfers/${own.data.id}/return`, {})).status < 300, 'ست برگشت');
  await A('/work/process', {});
  const after = await db.workItem.findMany({ where: { refType: 'stock_transfer', refId: own.data.id, type: { in: ['transport_stale', 'transport_stale_tech'] } } });
  ok(after.length === 2 && after.every((w) => w.state !== 'open'), '**با برگشتِ ست هر دو کار بسته شد**', JSON.stringify(after.map((w) => [w.type, w.state])));

  console.log('\n۱۰) گزارشِ حذف‌شده');
  const doc = await db.document.create({ data: { patientId: v.patientId, visitId: v.id, category: 'report', title: 'گزارش', fileName: 'r.pdf', mimeType: 'application/pdf', size: 1, sha256: 'x'.repeat(64), deletedAt: new Date() } }).catch((e) => ({ err: String(e).slice(0, 200) }));
  const ag = (await call(tok1, '/tech/agenda?scope=upcoming')).data;
  ok(!doc.err && ag?.visits?.find((x) => x.id === v.id)?.reportAt === null, '**گزارشِ حذف‌شده «ثبت شده» دیده نمی‌شود**', doc.err ?? '');

  console.log('\n۱۱) تیم از تختهٔ چینش — چیپ، افزودن/برداشتن، «همراه با»');
  for (const [t, at] of [[t2, '08:00'], [t3, '09:00']]) await A('/dispatch/roster', { date: day, hospitalId: hospital.id, techId: t.id, arriveTime: at });
  const v5 = (await A('/visits', { kind: 'surgery', firstName: 'بیمارِ', lastName: `پنجم${tag}`, opDate: dayDate.toISOString(), hospitalId: hospital.id, surgeonId: surgeon.id, opStartTime: '18:00' })).data;
  const addC = (vid, techId) => A(`/dispatch/roster/visits/${vid}/crew`, { techId });
  const delC = (vid, techId) => A(`/dispatch/roster/visits/${vid}/crew/${techId}`, undefined, 'DELETE');
  ok((await addC(v5.id, t2.id)).status < 300 && (await visitOf(v5.id)).techId === t2.id, 'اولین عضو از تخته = مسئول');
  ok((await addC(v5.id, t3.id)).status < 300, 'عضوِ دوم اضافه شد');
  let c5 = await crewOf(v5.id);
  ok(c5.map((r) => r.accountId).join() === `${t2.id},${t3.id}` && (await visitOf(v5.id)).techId === t2.id && c5.every((r) => r.source === 'dispatch'), '**تیم [۲، ۳]، مسئول همان اولی**', JSON.stringify(c5.map((r) => [r.accountId, r.source])));
  ok((await addC(v5.id, t3.id)).status === 409, 'عضوِ تکراری رد شد');
  const t4 = await mkTech(4);
  ok((await addC(v5.id, t4.id)).status === 400, 'کارشناسِ بی‌حضور در همان بیمارستان و روز رد شد');
  const board = (await A(`/dispatch/roster?date=${day}`)).data;
  const bv = board?.hospitals?.find((h) => h.hospitalId === hospital.id)?.visits?.find((x) => x.id === v5.id);
  ok(bv?.crew?.length === 2 && bv.techId === t2.id, 'تخته تیمِ کامل را برمی‌گرداند');
  const pv = (await A(`/dispatch/roster/preview?date=${day}`)).data;
  const p2 = pv?.programs?.find((p) => p.techId === t2.id)?.text ?? '', p3 = pv?.programs?.find((p) => p.techId === t3.id)?.text ?? '';
  ok(p2.includes(`پنجم${tag}`) && p2.includes(`همراه با: کارشناس3 ${tag}`) && p3.includes(`پنجم${tag}`) && p3.includes(`همراه با: کارشناس2 ${tag}`), '**پیامکِ هر دو عضو بیمار را دارد و «همراه با: …» نفرِ دیگر را**', `${p2}\n---\n${p3}`);
  await db.visitCrew.update({ where: { id: c5[0].id }, data: { fromTime: '18:05' } });
  ok((await delC(v5.id, t2.id)).status === 400, 'عضوِ شروع‌کرده از تخته برداشته نمی‌شود');
  ok((await delC(v5.id, t3.id)).status < 300, 'عضوِ شروع‌نکرده برداشته شد');
  c5 = await crewOf(v5.id);
  ok(c5.length === 1 && c5[0].accountId === t2.id && c5[0].fromTime === '18:05', 'تیم [۲] و ساعتش سالم ماند');
  /* مراجعهٔ قدیمی: فقط `techId`، بی‌تیم. */
  const v6 = (await A('/visits', { kind: 'surgery', firstName: 'بیمارِ', lastName: `ششم${tag}`, opDate: dayDate.toISOString(), hospitalId: hospital.id, surgeonId: surgeon.id })).data;
  await db.visit.update({ where: { id: v6.id }, data: { techId: t2.id } });
  ok((await addC(v6.id, t3.id)).status < 300 && (await crewOf(v6.id)).map((r) => r.accountId).join() === `${t2.id},${t3.id}`, '**افزودن به مراجعهٔ قدیمی کارشناسِ قبلی را نگه داشت**');
  const v7 = (await A('/visits', { kind: 'surgery', firstName: 'بیمارِ', lastName: `هفتم${tag}`, opDate: dayDate.toISOString(), hospitalId: hospital.id, surgeonId: surgeon.id })).data;
  await db.visit.update({ where: { id: v7.id }, data: { techId: t3.id } });
  ok((await delC(v7.id, t3.id)).status < 300 && (await visitOf(v7.id)).techId === null && !(await crewOf(v7.id)).length, '**برداشتنِ تنها کارشناس (قدیمی) پرونده را آزاد کرد**');
} finally {
  await db.$disconnect();
}

console.log(`\nسبز: ${pass}   قرمز: ${fail}`);
process.exit(fail ? 1 : 0);
