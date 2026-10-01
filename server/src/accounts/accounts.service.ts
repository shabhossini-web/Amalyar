import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, USERNAME_NEEDS_LETTER, usernameHasLetter } from '../auth/auth.service';
import { LEVEL } from '../common/levels';
import { JOB_ROLE_KEYS } from '../common/job-roles';
import { buildPersonPatch, PersonInput } from '../common/person';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import { expireProvisional, verificationDeadline } from './provisional';
import { isTestAccount, requireTestAdministrator, testAccountsEnabled, TEST_ACCOUNTS_KEY } from './test-accounts';

@Injectable()
export class AccountsService {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
  ) {}

  async createTemporary(dto: PersonInput & { level: number; jobRole: string; username?: string; testAccount?: boolean }, actorId: number) {
    const person = buildPersonPatch(dto, true);
    if (!person.phone) throw new BadRequestException('شماره همراه برای تأیید نهایی لازم است');
    if (!Number.isInteger(dto.level) || dto.level < 1 || dto.level > 6 || !JOB_ROLE_KEYS.includes(dto.jobRole)) throw new BadRequestException('سطح یا نقش نامعتبر است');
    const temporaryPassword = randomBytes(12).toString('base64url');
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const account = await this.prisma.$transaction(async tx => {
      if (dto.testAccount) {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(73190522)');
        await requireTestAdministrator(tx, actorId);
        if (!await testAccountsEnabled(tx)) throw new BadRequestException('ابتدا حالت ساخت حساب آزمایشی را روشن کنید');
        if (!dto.username || !/^(?=.*[a-zA-Z])[a-zA-Z0-9_.-]{3,40}$/.test(dto.username)) throw new BadRequestException('نام کاربری آزمایشی باید ۳ تا ۴۰ کاراکتر و شامل حرف لاتین باشد');
      }
      const existing = dto.testAccount ? null : await tx.person.findUnique({ where: { phone_phoneScope: { phone: String(person.phone), phoneScope: 'primary' } }, include: { account: true } });
      if (existing?.account) throw new BadRequestException('این شماره حساب دارد؛ حساب موجود را ویرایش کنید');
      const username = dto.username?.trim() || `staff-${randomBytes(5).toString('hex')}`;
      /* تمام‌رقم با شمارهٔ موبایلِ کسِ دیگری اشتباه می‌شد (بستهٔ PS، PS9). */
      if (!usernameHasLetter(username)) throw new BadRequestException(USERNAME_NEEDS_LETTER);
      if (await tx.account.findUnique({ where: { username } })) throw new BadRequestException('این نام کاربری قبلاً گرفته شده است');
      if (dto.testAccount) (person as any).phoneScope = `test:${randomUUID()}`;
      const row = await tx.account.create({ data: { ...(existing ? { personId: existing.id } : { person: { create: person as any } }), username, passwordHash, level: dto.level, jobRole: dto.jobRole, status: 'active', verificationDueAt: verificationDeadline(), approvedById: actorId, approvedAt: new Date() }, include: { person: true } });
      /* حسابِ پزشک همیشه به یک تعریفِ جراح وصل می‌شود — در هر سه حوزه. تا بستهٔ ۵ مطب
         عمداً جا مانده بود چون پرتال مطب را رد می‌کرد؛ حالا «میزِ پزشک» دامنه‌اش را از
         همین پیوند می‌گیرد (`surgeonId` در `validateSession`). */
      if (dto.jobRole === 'doctor') await tx.surgeon.upsert({ where: { personId: row.personId }, update: {}, create: { personId: row.personId } });
      if (['driver', 'courier'].includes(dto.jobRole)) await tx.transportStaff.upsert({ where: { personId: row.personId }, update: {}, create: { personId: row.personId, role: dto.jobRole } });
      await tx.auditEvent.create({ data: { actorId, action: 'account.temporary.create', entityType: 'account', entityId: String(row.id), afterJson: { level: row.level, jobRole: row.jobRole, verificationDueAt: row.verificationDueAt, testAccount: !!dto.testAccount } } });
      return row;
    });
    return { account: this.auth.publicUser(account), temporaryPassword };
  }

  async testingMode() { return { enabled: await testAccountsEnabled(this.prisma) }; }

  async setTestingMode(enabled: boolean, actorId: number) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(73190522)');
      await requireTestAdministrator(tx, actorId);
      await tx.setting.upsert({ where: { key: TEST_ACCOUNTS_KEY }, create: { key: TEST_ACCOUNTS_KEY, value: String(enabled) }, update: { value: String(enabled) } });
      let disabled = 0;
      if (!enabled) {
        const where = { person: { phoneScope: { not: 'primary' } } };
        disabled = (await tx.account.updateMany({ where: { ...where, status: 'active' }, data: { status: 'disabled' } })).count;
        await tx.session.updateMany({ where: { account: where, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await tx.auditEvent.create({ data: { actorId, action: 'account.testing.mode', entityType: 'setting', entityId: TEST_ACCOUNTS_KEY, afterJson: { enabled, disabled } } });
      return { enabled, disabled };
    });
  }

  async createTechnician(dto: PersonInput, actorId: number) {
    const person = buildPersonPatch(dto, true);
    if (!person.phone) throw new BadRequestException('شماره همراه کارشناس برای ورود لازم است');
    const exists = await this.prisma.person.findFirst({ where: { OR: [
      { phone: String(person.phone), phoneScope: 'primary' }, ...(person.nationalId ? [{ nationalId: String(person.nationalId) }] : []),
    ] } });
    if (exists) throw new BadRequestException('این شخص قبلاً ثبت شده است؛ حساب موجود را از کاربران انتخاب یا تأیید کنید');
    /**
     * ⚠️ **رمزِ خالی، نه رمزِ تصادفی.**
     *
     * نسخهٔ اول یک هشِ تصادفیِ ۳۲بایتی می‌گذاشت. نتیجه‌اش حسابی بود که هیچ‌کس
     * — از جمله خودِ کارشناس — نمی‌توانست واردش شود: رمز را کسی نمی‌دانست،
     * مسیرِ بازیابیِ رمز وجود ندارد، و ثبت‌نامِ دوباره با «این شماره قبلاً ثبت
     * شده است» رد می‌شد. یعنی آن شمارهٔ موبایل تا **ویرایشِ دستیِ دیتابیس**
     * غیرقابلِ‌استفاده می‌ماند.
     *
     * رشتهٔ خالی یعنی «تصاحب‌نشده» (`isUnclaimedAccount`): ورود بسته است، ولی
     * صاحبِ شماره با همان ثبت‌نامِ عادی و کدِ پیامکی حساب را تحویل می‌گیرد و
     * سطح و وضعیتی که مدیر داده دست‌نخورده می‌ماند.
     */
    const passwordHash = '';
    const row = await this.prisma.$transaction(async (tx) => {
      const account = await tx.account.create({ data: {
        person: { create: person as any }, passwordHash, level: LEVEL.TECH,
        jobRole: 'technician', status: 'active', approvedAt: new Date(), approvedById: actorId, verificationDueAt: verificationDeadline(),
      }, include: { person: true } });
      await tx.auditEvent.create({ data: { actorId, action: 'account.technician.create', entityType: 'account', entityId: String(account.id), afterJson: { level: LEVEL.TECH, jobRole: 'technician' } } });
      return account;
    });
    return this.auth.publicUser(row);
  }

  async list(status?: string) {
    await expireProvisional(this.prisma);
    const rows = await this.prisma.account.findMany({
      where: { systemKey: null, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { person: true },
    });
    return rows.map((a) => ({ ...this.auth.publicUser(a), createdAt: a.createdAt }));
  }

  async approve(id: number, level: number, approverId: number) {
    if (level < LEVEL.VIEWER || level > LEVEL.SUPER_ADMIN) {
      throw new BadRequestException('سطح نامعتبر است');
    }
    const acc = await this.prisma.account.findUnique({ where: { id }, include: { person: true } });
    if (!acc || acc.systemKey) throw new NotFoundException('حساب یافت نشد');
    if (isTestAccount(acc)) { await requireTestAdministrator(this.prisma, approverId); if (!await testAccountsEnabled(this.prisma)) throw new BadRequestException('حالت آزمایشی خاموش است'); }
    if (!acc.phoneVerifiedAt && acc.verificationDueAt && acc.verificationDueAt <= new Date()) throw new BadRequestException('ابتدا صاحب حساب باید شماره را با ثبت‌نام و کد پیامکی تأیید کند');
    const updated = await this.prisma.account.update({
      where: { id },
      data: { status: 'active', level, approvedById: approverId, approvedAt: new Date() },
      include: { person: true },
    });
    return this.auth.publicUser(updated);
  }

  async reject(id: number) {
    const acc = await this.prisma.account.findUnique({ where: { id } });
    if (!acc || acc.systemKey) throw new NotFoundException('حساب یافت نشد');
    const updated = await this.prisma.account.update({
      where: { id },
      data: { status: 'rejected' },
      include: { person: true },
    });
    return this.auth.publicUser(updated);
  }

  /** نقشِ شغلی — پزشک/منشی/… . `null` یعنی برداشتنِ نقش. */
  async setJobRole(id: number, jobRole: string | null, actorId?: number) {
    if (jobRole != null && !JOB_ROLE_KEYS.includes(jobRole)) {
      throw new BadRequestException('نقشِ شغلی نامعتبر است');
    }
    void actorId;
    const target = await this.prisma.account.findUnique({ where: { id } });
    if (!target || target.systemKey) throw new NotFoundException('حساب یافت نشد');
    const acc = await this.prisma.$transaction(async (tx) => {
      const row = await tx.account.update({
        where: { id },
        data: { jobRole },
        include: { person: true },
      });
      /* ⚠️ **همان قرارِ `createTemporary`: حسابِ پزشک همیشه به یک تعریفِ جراح وصل است.**

         این مسیر آن را نداشت و همان تفاوت یک باگِ بی‌صدا می‌ساخت: نقشِ «پزشک»
         از صفحهٔ کاربران ست می‌شد ولی `Surgeon`ی ساخته نمی‌شد، پس
         `orders.service.ts` که `doctorId` را از `visit.surgeon.person.account`
         در می‌آورد همیشه `null` می‌گرفت و کارِ «بررسیِ نتیجه» بی‌مالک در صفِ
         نقش می‌مانْد. دو مسیر برای یک نقش یعنی روزی یکی‌شان از قلم می‌افتد —
         و این‌جا افتاده بود.

         ⚠️ برداشتنِ نقش تعریفِ جراح را **پاک نمی‌کند**: مراجعه‌های قبلی به آن
         ارجاع دارند و حذفش تاریخچهٔ پزشکی را می‌شکند. */
      if (jobRole === 'doctor') {
        await tx.surgeon.upsert({
          where: { personId: row.personId },
          update: {},
          create: { personId: row.personId },
        });
      }
      return row;
    });
    return this.auth.publicUser(acc);
  }

  async setLevel(id: number, level: number, actorId?: number) {
    if (level < LEVEL.VIEWER || level > LEVEL.SUPER_ADMIN) {
      throw new BadRequestException('سطح نامعتبر است');
    }
    if (actorId !== undefined && actorId === id) {
      throw new BadRequestException('نمی‌توانید سطحِ حسابِ خودتان را تغییر دهید');
    }
    const acc = await this.prisma.account.findUnique({ where: { id } });
    if (!acc || acc.systemKey) throw new NotFoundException('حساب یافت نشد');
    // سیستم هرگز نباید بدونِ سوپرادمینِ فعال بماند
    if (acc.level === LEVEL.SUPER_ADMIN && level < LEVEL.SUPER_ADMIN && acc.status === 'active') {
      const others = await this.prisma.account.count({
        where: { level: LEVEL.SUPER_ADMIN, status: 'active', id: { not: id }, person: { phoneScope: 'primary' } },
      });
      if (others === 0) {
        throw new BadRequestException('این آخرین سوپرادمینِ فعال است؛ ابتدا سوپرادمینِ دیگری تعیین کنید');
      }
    }
    const updated = await this.prisma.account.update({
      where: { id },
      data: { level },
      include: { person: true },
    });
    return this.auth.publicUser(updated);
  }

  /// پروفایلِ کاملِ یک حساب — برای صفحهٔ ویرایشِ سوپرادمین.
  async get(id: number) {
    const acc = await this.prisma.account.findUnique({ where: { id }, include: { person: true } });
    if (!acc || acc.systemKey) throw new NotFoundException('حساب یافت نشد');
    const p = acc.person;
    return {
      ...this.auth.publicUser(acc),
      fee: acc.fee,
      createdAt: acc.createdAt,
      nationalId: p.nationalId,
      email: p.email,
      birthDate: p.birthDate,
      city: p.city,
      address: p.address,
      iban: p.iban,
      notes: p.notes,
    };
  }

  /**
   * تکمیلِ پروفایل توسط سوپرادمین.
   *
   * ثبت‌نام فقط نام، موبایل و عکس را پر می‌کند؛ کدِ ملی، شبا و دستمزد این‌جا
   * تکمیل می‌شوند. عمداً از مسیرِ خودِ کاربر (`/auth/profile`) جدا است: شبا
   * مقصدِ پرداخت است و دستمزد رقمِ قرارداد — هیچ‌کدام نباید با حسابِ لو رفتهٔ
   * خودِ کاربر قابلِ تغییر باشند.
   */
  async updateProfile(id: number, dto: PersonInput & { fee?: number | null }, actor?: { id?: number; sid?: string }) {
    const acc = await this.prisma.account.findUnique({ where: { id }, include: { person: true } });
    if (!acc || acc.systemKey) throw new NotFoundException('حساب یافت نشد');

    const personPatch = buildPersonPatch(dto, false);
    const phoneChanged = personPatch.phone !== undefined && personPatch.phone !== acc.person.phone;
    if (phoneChanged && !personPatch.phone) throw new BadRequestException('حساب کاربری باید شماره همراه داشته باشد');
    await this.prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id },
        data: {
          ...(phoneChanged ? { phoneVerifiedAt: null, verificationDueAt: verificationDeadline() } : {}),
          ...(dto.fee !== undefined ? { fee: dto.fee === null ? null : Math.max(0, Math.trunc(dto.fee)) } : {}),
          ...(Object.keys(personPatch).length ? { person: { update: personPatch } } : {}),
        },
      });
      if (!phoneChanged) return;
      /* هشدار — **شماره عوض شد ← نشست‌های همان حساب بسته** (بستهٔ PS، PS3). شماره راهِ ورود و بازیابی است؛
         نشستی که با شمارهٔ قبلی باز شده بود نباید بماند. فقط نشستِ جاریِ خودِ کسی که شمارهٔ **خودش** را عوض
         می‌کند می‌ماند — وگرنه با ذخیرهٔ فرم بیرون می‌افتاد. */
      const keep = actor?.id === id && actor?.sid ? actor.sid : undefined;
      await tx.session.updateMany({ where: { accountId: id, revokedAt: null, ...(keep ? { id: { not: keep } } : {}) }, data: { revokedAt: new Date() } });
      await tx.auditEvent.create({ data: { actorId: actor?.id ?? null, action: 'account.phone.change', entityType: 'account', entityId: String(id),
        beforeJson: { phone: acc.person.phone }, afterJson: { phone: String(personPatch.phone) } } });
    });
    return this.get(id);
  }
}
