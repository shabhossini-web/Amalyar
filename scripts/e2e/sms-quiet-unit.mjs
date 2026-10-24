/**
 * «ساعتِ سکوتِ پیامک» (`server/src/sms/quiet-hours.ts`) — خالص، بدونِ دیتابیس.
 *
 *  باید بیفتد: ۲۱ تا ۸ تهران = شب (۲۱، ۲۲، ۲۳، ۰، ۷)، و ۸ تا ۲۰ نه؛ ساعت به وقتِ تهران (سرور UTC است)
 *  نباید بیفتد: بازهٔ روزانه‌ای که از نیمه‌شب رد نمی‌شود، `from === to` (بدونِ بازه)، خاموش، مقدارِ خراب = پیش‌فرضِ همان فیلد
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { inQuiet, parseQuiet, clinicHour, QUIET_DEFAULT } = require('./dist/sms/quiet-hours');
let count = 0;
const ok = (v, l) => { assert.ok(v, l); console.log('PASS ' + ++count + ' ' + l); };

/* تهران = UTC+3:30 (بدونِ ساعتِ تابستانی از ۱۴۰۱). */
const at = (tehran) => { const [h, m = 0] = tehran.split(':').map(Number); return new Date(Date.UTC(2026, 9, 24, h - 3, m - 30)); };
ok(clinicHour(new Date('2026-10-24T22:30:00Z')) === 2 && clinicHour(new Date('2026-10-24T08:30:00Z')) === 12, 'clinicHour: ۲۲:۳۰Z = ۰۲ و ۰۸:۳۰Z = ۱۲ تهران');
ok(clinicHour(new Date('2026-10-24T20:29:00Z')) === 23 && clinicHour(new Date('2026-10-24T20:30:00Z')) === 0, 'مرزِ نیمه‌شبِ تهران (۲۰:۳۰Z)');

const D = { on: QUIET_DEFAULT.on, from: QUIET_DEFAULT.from, to: QUIET_DEFAULT.to };
ok(D.on === true && D.from === 21 && D.to === 8, 'پیش‌فرض: روشن، ۲۱ تا ۸ (تصمیمِ مالک)');
for (const h of ['21:00', '22:30', '23:59', '00:00', '02:00', '07:59']) ok(inQuiet(D, at(h)), `${h} تهران: ساعتِ سکوت`);
for (const h of ['08:00', '12:00', '17:30', '20:59']) ok(!inQuiet(D, at(h)), `${h} تهران: سکوت نیست`);
ok(inQuiet({ on: true, from: 13, to: 15 }, at('14:00')) && !inQuiet({ on: true, from: 13, to: 15 }, at('15:00')) && !inQuiet({ on: true, from: 13, to: 15 }, at('12:59')), 'بازهٔ روزانه (۱۳ تا ۱۵)');
ok(!inQuiet({ on: true, from: 9, to: 9 }, at('09:00')) && !inQuiet({ on: true, from: 9, to: 9 }, at('02:00')), 'شروع = پایان یعنی بازه‌ای نیست');
ok(!inQuiet({ ...D, on: false }, at('02:00')), 'خاموش: هیچ‌وقت سکوت نیست');

const rows = (o) => Object.entries(o).map(([key, value]) => ({ key, value }));
ok(JSON.stringify(parseQuiet([])) === JSON.stringify(D), 'ردیفِ نبوده = پیش‌فرض');
ok(parseQuiet(rows({ sms_quiet_on: 'false' })).on === false, 'sms_quiet_on=false');
const c = parseQuiet(rows({ sms_quiet_from: '22', sms_quiet_to: '7' }));
ok(c.from === 22 && c.to === 7 && c.on === true, 'ساعت‌های سفارشی');
const bad = parseQuiet(rows({ sms_quiet_from: 'x', sms_quiet_to: '99' }));
ok(bad.from === 21 && bad.to === 8, 'مقدارِ خراب/بیرون از ۰..۲۳ = پیش‌فرضِ همان فیلد (بازهٔ نصفه نمی‌شود)');
console.log(`\nسبز: ${count}`);
