/** Real disposable DB: shared contact numbers must never merge authentication identities. */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'pglite-server';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client');
const { JwtService } = require('../../server/node_modules/@nestjs/jwt');
const { AuthService } = require('../../server/dist/auth/auth.service');
const { AccountsService } = require('../../server/dist/accounts/accounts.service');
const { otpHash: cls_otpHash } = require('../../server/dist/common/otp-hash');
const db = new PGlite(); await db.waitReady;
const server = createServer(db, { logLevel: 0 });
let prisma, count = 0, sent = [];
const pass = name => console.log(`PASS ${++count}: ${name}`);
try {
  for (const dir of (await readdir(new URL('../../server/prisma/migrations/', import.meta.url))).sort()) if (dir.startsWith('20')) await db.exec(await readFile(new URL(`../../server/prisma/migrations/${dir}/migration.sql`, import.meta.url), 'utf8'));
  // Exercise the database constraint before opening the TCP adapter, which drops connections on SQL errors.
  await db.exec(`INSERT INTO people (first_name, last_name, phone) VALUES ('fixture', 'primary', '09129990000')`);
  await assert.rejects(() => db.exec(`INSERT INTO people (first_name, last_name, phone) VALUES ('fixture', 'duplicate', '09129990000')`), /unique constraint/);
  await db.exec(`DELETE FROM people WHERE phone = '09129990000'`);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  prisma = new PrismaClient({ datasources: { db: { url: `postgresql://postgres@127.0.0.1:${server.address().port}/postgres?connection_limit=1` } } });
  const jwt = new JwtService({ secret: 'disposable-test-only-secret-never-used-in-production' });
  const sms = { sendOtp: async (phone, code) => { sent.push({ phone, code }); return { sent: true, stub: true }; } };
  const auth = new AuthService(prisma, jwt, sms, { hit() {} }, { current: () => ({ hostname: 'test.local' }), require: () => ({ tenantId: 'fixture' }) });
  const accounts = new AccountsService(prisma, auth);
  const admin = await prisma.account.create({ data: { username: 'admin-fixture', status: 'active', level: 6, passwordHash: 'no-login', person: { create: { firstName: 'مدیر', lastName: 'اصلی', phone: '09121110000' } } }, include: { person: true } });
  const normal = await accounts.createTemporary({ firstName: 'شخص', lastName: 'اصلی', phone: '09121110001', username: 'normal-fixture', level: 2, jobRole: 'technician' }, admin.id);
  await prisma.account.update({ where: { id: normal.account.id }, data: { phoneVerifiedAt: new Date() } });
  await prisma.setting.create({ data: { key: 'vertical', value: 'ionm' } });
  const dto = { firstName: 'شخص', lastName: 'آزمایشی', phone: '09121110001', username: 'test-doctor', level: 2, jobRole: 'doctor', testAccount: true };
  assert.equal((await accounts.testingMode()).enabled, false);
  await assert.rejects(() => accounts.createTemporary(dto, admin.id), /روشن/);
  await assert.rejects(() => accounts.setTestingMode(true, normal.account.id), /سوپرادمین/);
  await accounts.setTestingMode(true, admin.id);
  await assert.rejects(() => accounts.createTemporary({ ...dto, username: '09120000000' }, admin.id), /نام کاربری/);
  pass('testing defaults off; permanent superadmin enables it; numeric-only usernames forbidden');
  const a = await accounts.createTemporary(dto, admin.id);
  const b = await accounts.createTemporary({ ...dto, username: 'test-technician', jobRole: 'technician' }, admin.id);
  const [pa, pb] = await Promise.all([a, b].map(x => prisma.account.findUnique({ where: { id: x.account.id }, include: { person: true } })));
  assert.notEqual(pa.personId, pb.personId); assert.notEqual(pa.personId, normal.account.personId);
  assert.equal(pa.person.phone, pb.person.phone); assert.ok(a.account.isTestAccount); assert.equal(normal.account.isTestAccount, false);
  assert.ok(await prisma.surgeon.findUnique({ where: { personId: pa.personId } }));
  assert.equal(await prisma.surgeon.findUnique({ where: { personId: pb.personId } }), null);
  await auth.updateProfile(pa.id, { firstName: 'نام مستقل' });
  assert.equal((await prisma.person.findUnique({ where: { id: pb.personId } })).firstName, 'شخص');
  pass('same phone yields independent person, surgeon relation, profile, role and credentials');
  await assert.rejects(() => accounts.createTemporary({ ...dto, testAccount: false, username: 'normal-two' }, admin.id), /شماره/);
  await assert.rejects(() => accounts.createTemporary(dto, admin.id), /نام کاربری/);
  pass('normal phone uniqueness still enforced by database; all usernames remain unique');
  const mainLogin = await auth.login({ identifier: dto.phone, password: normal.temporaryPassword }, {});
  assert.equal(mainLogin.user.id, normal.account.id);
  await assert.rejects(() => auth.login({ identifier: dto.phone, password: a.temporaryPassword }, {}));
  const sa = await auth.login({ identifier: a.account.username, password: a.temporaryPassword }, {});
  const sb = await auth.login({ identifier: b.account.username, password: b.temporaryPassword }, {});
  assert.equal(sa.user.id, pa.id); assert.equal(sb.user.id, pb.id);
  pass('phone login remains canonical; each test username logs into exactly its own account');
  await auth.requestPhoneVerification(pa, 'fixture');
  const codeA = sent.at(-1).code;
  await assert.rejects(() => auth.verifyPhone(pb, { phone: dto.phone, code: codeA }, 'fixture'), /کدی صادر/);
  await assert.rejects(() => auth.verifySignupOtp({ phone: dto.phone, code: codeA }, 'fixture'), /کدی صادر/);
  const verified = await auth.verifyPhone(pa, { phone: dto.phone, code: codeA }, 'fixture');
  assert.ok(verified.phoneVerifiedAt); assert.equal(verified.level, pa.level);
  await assert.rejects(() => auth.verifyPhone(pa, { phone: dto.phone, code: codeA }, 'fixture'));
  assert.equal((await prisma.account.findUnique({ where: { id: pb.id } })).phoneVerifiedAt, null);
  await assert.rejects(() => auth.requestSignupOtp(dto.phone), /قبلاً ثبت/);
  pass('test OTP is single-use and account-bound; cannot verify sibling or public signup');
  const signupToken = await jwt.signAsync({ phone: dto.phone, purpose: 'signup' });
  await assert.rejects(() => auth.completeSignup({ signupToken, username: a.account.username, password: 'unique-fixture-password', firstName: 'نام', lastName: 'تست', selfie: 'fixture' }, {}), /نام کاربری/);
  pass('public signup cannot claim a test identity sharing the verified phone');
  await prisma.account.update({ where: { id: pb.id }, data: { verificationDueAt: new Date(Date.now() - 1000) } });
  assert.equal(await auth.validateSession(sb.sid, pb.id), null);
  assert.equal((await prisma.account.findUnique({ where: { id: pb.id } })).status, 'disabled');
  assert.ok((await prisma.session.findUnique({ where: { id: sb.sid } })).revokedAt);
  pass('unverified test account still expires after seven days and loses sessions');
  const testAdmin = await accounts.createTemporary({ ...dto, username: 'test-admin', level: 6 }, admin.id);
  await assert.rejects(() => accounts.setTestingMode(false, testAdmin.account.id), /حساب اصلی/);
  await assert.rejects(() => accounts.createTemporary({ ...dto, username: 'nested-test' }, testAdmin.account.id), /حساب اصلی/);
  const ended = await accounts.setTestingMode(false, admin.id);
  assert.ok(ended.disabled >= 2); assert.equal(await auth.validateSession(sa.sid, pa.id), null);
  assert.ok((await prisma.session.findUnique({ where: { id: sa.sid } })).revokedAt);
  assert.ok(await auth.validateSession(mainLogin.sid, normal.account.id));
  await assert.rejects(() => auth.login({ identifier: a.account.username, password: a.temporaryPassword }, {}));
  await assert.rejects(() => accounts.approve(pa.id, 2, admin.id), /خاموش/);
  assert.equal((await prisma.account.findUnique({ where: { id: admin.id } })).status, 'active');
  pass('ending tests revokes all test sessions; even verified test accounts close; real accounts survive');
  await accounts.setTestingMode(true, admin.id);
  await assert.rejects(() => auth.login({ identifier: a.account.username, password: a.temporaryPassword }, {}));
  assert.ok(await prisma.person.findUnique({ where: { id: pa.personId } }));
  const audits = await prisma.auditEvent.findMany();
  assert.ok(audits.some(a => a.action === 'account.testing.mode'));
  assert.equal(JSON.stringify(audits, (_, v) => typeof v === 'bigint' ? String(v) : v).includes(a.temporaryPassword), false);
  pass('reenabling never silently reactivates old accounts; data retained; audit contains no password');

  /* PS2 — «اولین حساب = سوپرادمین» یعنی «هیچ حسابی نیست»، نه «سوپرادمینِ فعالی نیست». تا دیروز: سوپرادمینِ تنها
     شماره‌اش را در پروفایل عوض می‌کرد، هفت روز تأیید نمی‌کرد، انقضای حسابِ موقت غیرفعالش می‌کرد و **اولین
     ثبت‌نامِ عمومی** سوپرادمینِ فعالِ سامانه می‌شد. */
  const { expireProvisional } = require('../../server/dist/accounts/provisional');
  const past = new Date(Date.now() - 60_000);
  const full = async (id) => prisma.account.findUnique({ where: { id }, include: { person: true } });
  const boss = await auth.issue(await full(admin.id), {});
  await prisma.account.update({ where: { id: admin.id }, data: { phoneVerifiedAt: null, verificationDueAt: past } });
  assert.ok(await auth.validateSession(boss.sid, admin.id), 'آخرین سوپرادمینِ فعال با گذشتنِ مهلت بیرون نمی‌افتد');
  await expireProvisional(prisma);
  assert.equal((await prisma.account.findUnique({ where: { id: admin.id } })).status, 'active', 'انقضای دوره‌ای هم تنها سوپرادمین را غیرفعال نمی‌کند');
  assert.equal((await prisma.session.findUnique({ where: { id: boss.sid } })).revokedAt, null);
  assert.equal((await auth.issue(await full(admin.id), {})).user.verificationOverdue, true, 'کلاینت می‌داند مهلت گذشته (هشدار)');
  const kept = await prisma.auditEvent.findMany({ where: { action: 'account.verification.overdue_kept', entityId: String(admin.id) } });
  assert.equal(kept.length, 1, 'یک ردِ ممیزی، نه یکی به‌ازای هر درخواست');
  await prisma.otpCode.create({ data: { phone: '09121110000', purpose: 'signup', codeHash: cls_otpHash('signup', '09121110000', '246810'), expiresAt: new Date(Date.now() + 60_000) } });
  const late = await auth.verifyPhone(await full(admin.id), { phone: '09121110000', code: '246810' }, 'fixture');
  assert.ok(late.phoneVerifiedAt, 'و پس از مهلت هم می‌تواند شماره را تأیید کند');
  pass('PS2: last active superadmin survives the seven-day expiry, is warned, audited once, and can still verify');

  /* دو سوپرادمینِ اصلیِ دیرکرده ← یکی می‌ماند (نه هر دو غیرفعال، نه هر دو معاف). */
  await prisma.account.update({ where: { id: admin.id }, data: { phoneVerifiedAt: null, verificationDueAt: past } });
  const boss2 = await accounts.createTemporary({ firstName: 'مدیر', lastName: 'دوم', phone: '09121110009', username: 'boss-two', level: 6, jobRole: 'secretary' }, admin.id);
  await prisma.account.update({ where: { id: boss2.account.id }, data: { verificationDueAt: past } });
  await expireProvisional(prisma);
  const bosses = await prisma.account.count({ where: { level: 6, status: 'active', person: { phoneScope: 'primary' } } });
  assert.equal(bosses, 1, `دقیقاً یک سوپرادمینِ فعال ماند (${bosses})`);
  pass('PS2: with two overdue superadmins exactly one stays active');

  /* سوپرادمینِ موقت با ثبت‌نامِ عمومی (فقط کدِ پیامکی به همان شماره) تصاحب نمی‌شود — همان قاعدهٔ بازیابیِ PF1. */
  const liveBoss = await prisma.account.findFirst({ where: { level: 6, status: 'active', person: { phoneScope: 'primary' } }, include: { person: true } });
  const claimToken = await jwt.signAsync({ phone: liveBoss.person.phone, purpose: 'signup' });
  await assert.rejects(() => auth.completeSignup({ signupToken: claimToken, username: 'claimer', password: 'claim-password-1', firstName: 'غریبه', lastName: 'تصاحب', selfie: 'fixture' }, {}), /قبلاً ثبت/);
  assert.equal((await prisma.account.findUnique({ where: { id: liveBoss.id } })).username, liveBoss.username);
  pass('PS2: a provisional superadmin cannot be claimed by public signup (SMS-only)');

  /* و اگر با همهٔ این‌ها سوپرادمینِ فعالی نماند (مثلاً دستی غیرفعال شد)، ثبت‌نامِ عمومی سطح نمی‌گیرد. */
  await prisma.account.updateMany({ where: { level: 6 }, data: { status: 'disabled' } });
  const strangerToken = await jwt.signAsync({ phone: '09121119999', purpose: 'signup' });
  const stranger = await auth.completeSignup({ signupToken: strangerToken, username: 'first-come', password: 'stranger-password-1', firstName: 'غریبه', lastName: 'اول', selfie: 'fixture' }, {});
  const row = await prisma.account.findUnique({ where: { id: stranger.user.id } });
  assert.equal(stranger.pending, true); assert.equal(row.level, 1); assert.equal(row.status, 'pending');
  assert.equal(stranger.bootstrap, undefined);
  assert.deepEqual(await auth.setupStatus(), { needsSetup: false });
  pass('PS2: no active superadmin is not "first account" — public signup stays level 1 and pending');
  console.log(`${count} shared-phone test account scenarios passed`);
} finally { if (prisma) await prisma.$disconnect(); await new Promise(r => server.close(r)); await db.close(); }
