import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PatientsService } from './patients.service';
import { StorageService } from '../storage/storage.service';
import { toEnDigits } from '../common/identity';

/** سقفِ فیشِ واریزی — عکسِ گوشی، نه اسکنِ آرشیوی. */
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const RECEIPT_MIME = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

/** روزهای اعتبارِ یک ثبت‌نامِ نیمه‌کاره. */
const TTL_DAYS = 14;

export const INTAKE_STATUSES = [
  'pending_fill', 'pending_payment', 'pending_approval', 'approved', 'rejected', 'expired',
] as const;

export const INTAKE_LABELS: Record<string, string> = {
  pending_fill: 'در انتظارِ تکمیل',
  pending_payment: 'در انتظارِ فیش',
  pending_approval: 'در انتظارِ تأیید',
  approved: 'تأییدشده',
  rejected: 'رد‌شده',
  expired: 'رها‌شده',
};

const text = (v: unknown, max = 200) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/**
 * فرمِ ثبت‌نامِ بیمار.
 *
 * ⚠️ **آنچه بیمار پر می‌کند مراجعه نیست.** تا وقتی ادمین تأیید نکرده، هیچ
 * `Visit`ی ساخته نمی‌شود: اگر فرمِ خودپرشده مستقیم وارد دفترِ عملیاتی می‌شد،
 * تختهٔ چینشِ فردا پر می‌شد از ثبت‌نام‌هایی که هیچ‌وقت پول ندادند.
 *
 * ⚠️ **پروندهٔ بیمار ولی همان لحظهٔ ثبت‌نام ساخته می‌شود** — چون فیشِ واریزی
 * باید جایی بنشیند و `Document` بیمار می‌خواهد، و چون همین‌جاست که می‌فهمیم
 * این آدم بیمارِ قدیمی است یا تازه. پروندهٔ بی‌مراجعه بی‌ضرر است: آدمی که با
 * ما تماس گرفته، حتی اگر عملش نشد.
 */
@Injectable()
export class IntakeService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private patients: PatientsService,
    private storage: StorageService,
  ) {}

  private token() {
    return randomBytes(18).toString('base64url');
  }

  // ── لینکِ دائمی (ادمین) ────────────────────────────────────────────
  async listLinks() {
    const rows = await this.prisma.intakeLink.findMany({
      orderBy: { id: 'desc' },
      include: { _count: { select: { submissions: true } } },
    });
    return rows.map((r) => ({ ...r, submissionCount: r._count.submissions, _count: undefined }));
  }

  async createLink(dto: { title: string; amount?: number; notes?: string }, user: any) {
    const title = text(dto.title, 120);
    if (!title) throw new BadRequestException('عنوانِ لینک را وارد کنید');
    const row = await this.prisma.intakeLink.create({
      data: { token: this.token(), title, amount: Math.max(0, Number(dto.amount) || 0), notes: text(dto.notes, 300) },
    });
    await this.audit.record({ actorId: user?.id, action: 'intake.link.create', entityType: 'intake_link', entityId: row.id, after: row });
    return row;
  }

  async patchLink(id: number, dto: { title?: string; amount?: number; active?: boolean; notes?: string }, user: any) {
    const row = await this.prisma.intakeLink.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('لینک پیدا نشد');
    const data: any = {};
    if (dto.title !== undefined) data.title = text(dto.title, 120) ?? row.title;
    if (dto.amount !== undefined) data.amount = Math.max(0, Number(dto.amount) || 0);
    if (dto.active !== undefined) data.active = !!dto.active;
    if (dto.notes !== undefined) data.notes = text(dto.notes, 300);
    const next = await this.prisma.intakeLink.update({ where: { id }, data });
    await this.audit.record({ actorId: user?.id, action: 'intake.link.update', entityType: 'intake_link', entityId: id, before: row, after: next });
    return next;
  }

  // ── مسیرِ عمومیِ بیمار ─────────────────────────────────────────────
  /** اطلاعاتِ لینک برای صفحهٔ ثبت‌نام — بدونِ هیچ دادهٔ بیمار. */
  async publicLink(token: string) {
    const link = await this.prisma.intakeLink.findUnique({ where: { token } });
    if (!link) throw new NotFoundException('این لینک معتبر نیست');
    if (!link.active) throw new ForbiddenException('این لینک غیرفعال شده است');
    return { title: link.title, amount: link.amount };
  }

  /**
   * شروعِ ثبت‌نام.
   *
   * ⚠️ کپچا **روی سرور** سنجیده می‌شود؛ اعتبارسنجیِ سمتِ کلاینت هیچ چیزی را
   * جلوی یک اسکریپت نمی‌گیرد و این نشانی عمومی است.
   *
   * ⚠️ اگر همین بیمار ثبت‌نامِ ناتمامی دارد، **همان** برگردانده می‌شود نه یک
   * ردیفِ تازه — وگرنه هر بار که بیمار لینک را دوباره باز کند یک ثبت‌نامِ
   * نیمه‌کارهٔ دیگر می‌سازد و صفِ تأیید پر می‌شود از تکراری.
   */
  async register(
    linkToken: string,
    dto: { firstName: string; lastName: string; nationalId: string; phone: string; birthDate?: string; address?: string; captchaA: number; captchaB: number; captchaAnswer: number },
  ) {
    const link = await this.prisma.intakeLink.findUnique({ where: { token: linkToken } });
    if (!link) throw new NotFoundException('این لینک معتبر نیست');
    if (!link.active) throw new ForbiddenException('این لینک غیرفعال شده است');
    if (Number(dto.captchaAnswer) !== Number(dto.captchaA) + Number(dto.captchaB)) {
      throw new BadRequestException('پاسخِ پرسشِ امنیتی درست نیست');
    }

    const firstName = text(dto.firstName, 80);
    const lastName = text(dto.lastName, 80);
    const nationalId = toEnDigits(text(dto.nationalId, 15) ?? '');
    const phone = toEnDigits(text(dto.phone, 20) ?? '');
    if (!firstName || !lastName) throw new BadRequestException('نام و نامِ خانوادگی را وارد کنید');
    if (!/^\d{10}$/.test(nationalId)) throw new BadRequestException('کدِ ملی باید ۱۰ رقم باشد');
    if (!/^09\d{9}$/.test(phone)) throw new BadRequestException('شمارهٔ موبایل نامعتبر است');

    const { patientId } = await this.prisma.$transaction((tx) =>
      this.patients.resolveOrCreatePatient(tx, { firstName, lastName, phone, nationalId, birthDate: dto.birthDate }),
    );

    const open = await this.prisma.intakeSubmission.findFirst({
      where: { patientId, status: { in: ['pending_fill', 'pending_payment', 'pending_approval'] } },
      orderBy: { id: 'desc' },
    });
    if (open) return this.publicView(open.token);

    const row = await this.prisma.intakeSubmission.create({
      data: {
        token: this.token(),
        linkId: link.id,
        patientId,
        amount: link.amount,
        status: 'pending_fill',
        data: { firstName, lastName, nationalId, phone, address: text(dto.address, 300), birthDate: dto.birthDate ?? null },
        expiresAt: new Date(Date.now() + TTL_DAYS * 24 * 3600 * 1000),
      },
    });
    return this.publicView(row.token);
  }

  /**
   * نمای عمومیِ یک ثبت‌نام.
   *
   * ⚠️ فقط دادهٔ **خودِ همین فرم** برمی‌گردد. هرچه از پروندهٔ بیمار این‌جا
   * اضافه شود، با داشتنِ توکن قابلِ خواندن است — و توکن در پیامک می‌رود.
   */
  async publicView(token: string) {
    const row = await this.expireIfDue(token);
    return {
      token: row.token,
      status: row.status,
      statusLabel: INTAKE_LABELS[row.status] ?? row.status,
      amount: row.amount,
      data: row.data,
      reviewNote: row.reviewNote,
      expiresAt: row.expiresAt,
    };
  }

  /** پرکردنِ اطلاعاتِ عمل. */
  async fill(token: string, dto: { procedure?: string; surgeonName?: string; hospitalName?: string; opDate?: string; notes?: string }) {
    const row = await this.expireIfDue(token);
    if (!['pending_fill', 'pending_payment'].includes(row.status)) {
      throw new BadRequestException('این فرم دیگر قابلِ ویرایش نیست');
    }
    const data = {
      ...(row.data as any),
      procedure: text(dto.procedure, 200),
      surgeonName: text(dto.surgeonName, 100),
      hospitalName: text(dto.hospitalName, 150),
      opDate: text(dto.opDate, 12),
      patientNotes: text(dto.notes, 500),
    };
    await this.prisma.intakeSubmission.update({
      where: { id: row.id },
      data: { data, status: 'pending_payment' },
    });
    return this.publicView(token);
  }

  /**
   * فیشِ واریزی — با آپلودِ فایل که کنترلر انجام داده و این‌جا فقط ثبت می‌شود.
   *
   * ⚠️ همین‌جا «ثبت‌نامِ کامل» می‌شود: تعریفِ محصول این است که فرم وقتی کامل
   * است که فیش رسیده باشد، نه وقتی فیلدها پر شده‌اند.
   */
  async attachReceipt(token: string, file: { originalname: string; mimetype: string; buffer: Buffer; size: number }) {
    const row = await this.expireIfDue(token);
    if (row.status !== 'pending_payment') throw new BadRequestException('ابتدا اطلاعاتِ عمل را کامل کنید');
    if (!row.patientId) throw new BadRequestException('این فرم پرونده‌ای ندارد');
    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    if (file.size > MAX_RECEIPT_BYTES) throw new BadRequestException('حجمِ فایل بیش از ۸ مگابایت است');
    // ⚠️ نوعِ فایل روی سرور سنجیده می‌شود: این نشانی عمومی است و `accept`ِ
    //    ورودیِ HTML فقط پنجرهٔ انتخابِ فایل را محدود می‌کند، نه درخواست را.
    if (!RECEIPT_MIME.test(file.mimetype || '')) throw new BadRequestException('فقط عکس یا PDF بفرستید');

    const { sha256, size } = await this.storage.save(file.buffer);
    const doc = await this.prisma.document.create({
      data: {
        patientId: row.patientId,
        category: 'receipt',
        title: 'فیشِ واریزیِ ثبت‌نام',
        fileName: (file.originalname || 'receipt').slice(0, 200),
        mimeType: file.mimetype || 'application/octet-stream',
        size,
        sha256,
        // ⚠️ `uploadedById` خالی است و درست هم همین است: بیمار کاربرِ سامانه
        //    نیست. جعلِ یک شناسهٔ ادمین این‌جا یعنی دفترِ رسیدگی دروغ بگوید.
        uploadedById: null,
      },
    });
    const data = { ...(row.data as any), receiptDocumentId: doc.id };
    await this.prisma.intakeSubmission.update({
      where: { id: row.id },
      data: { data, status: 'pending_approval' },
    });
    return this.publicView(token);
  }

  // ── صفِ تأیید (ادمین) ─────────────────────────────────────────────
  async list(status?: string) {
    const where = status && status !== 'all' ? { status } : {};
    const rows = await this.prisma.intakeSubmission.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 200,
      include: {
        link: { select: { title: true } },
        patient: { select: { id: true, code: true, firstName: true, lastName: true, phone: true, nationalId: true } },
        visit: { select: { id: true, seq: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      token: r.token,
      status: r.status,
      statusLabel: INTAKE_LABELS[r.status] ?? r.status,
      amount: r.amount,
      data: r.data,
      linkTitle: r.link.title,
      patient: r.patient,
      visitId: r.visitId,
      visitCode: r.patient && r.visit ? `${r.patient.code}-V${r.visit.seq}` : null,
      reviewNote: r.reviewNote,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
    }));
  }

  /**
   * تأیید → مراجعه.
   *
   * ⚠️ مراجعه از **همان `createVisit`ِ موجود** ساخته می‌شود، نه با یک insertِ
   * جداگانه: تولیدِ `seq`، تطبیقِ پرونده و ثبتِ audit همه آن‌جا هستند و
   * مسیرِ دومِ ساختِ مراجعه یعنی روزی یکی‌شان یکی از این‌ها را جا می‌اندازد.
   *
   * ادمین می‌تواند فیلدها را هنگامِ تأیید اصلاح کند — چیزی که بیمار نوشته
   * **ادعا** است: «دکتر رضایی» باید به جراحِ تعریف‌شده گره بخورد.
   */
  async approve(
    id: number,
    dto: { surgeonId?: number; hospitalId?: number; techId?: number; procedureTypeId?: number; opDate?: string; opStartTime?: string; note?: string },
    user: any,
  ) {
    const row = await this.prisma.intakeSubmission.findUnique({ where: { id }, include: { patient: true } });
    if (!row) throw new NotFoundException('ثبت‌نام پیدا نشد');
    if (row.status !== 'pending_approval') throw new BadRequestException('این ثبت‌نام در وضعیتِ انتظارِ تأیید نیست');
    if (!row.patientId) throw new BadRequestException('این ثبت‌نام پرونده‌ای ندارد');

    const d = row.data as any;
    const visit = await this.patients.createVisit({
      patientId: row.patientId,
      surgeonId: dto.surgeonId,
      hospitalId: dto.hospitalId,
      techId: dto.techId,
      procedureTypeId: dto.procedureTypeId,
      opType: dto.procedureTypeId ? undefined : (d.procedure ?? undefined),
      opDate: dto.opDate ?? d.opDate ?? undefined,
      opStartTime: dto.opStartTime,
      notes: d.patientNotes ?? undefined,
    } as any, user);

    await this.prisma.intakeSubmission.update({
      where: { id },
      data: { status: 'approved', visitId: visit.id, reviewNote: text(dto.note, 300), reviewedById: user?.id ?? null, reviewedAt: new Date() },
    });
    // فیشِ واریزی حالا صاحبِ مراجعه دارد — تا امروز فقط به پرونده وصل بود.
    if (d.receiptDocumentId) {
      await this.prisma.document.updateMany({ where: { id: Number(d.receiptDocumentId) }, data: { visitId: visit.id } });
    }
    await this.audit.record({
      actorId: user?.id, action: 'intake.approve', entityType: 'intake_submission', entityId: id,
      after: { visitId: visit.id },
    });
    // ⚠️ کدِ مراجعه از خروجیِ `createVisit` می‌آید نه ساختِ دستیِ
    //    `code + '-V' + seq`: قالبِ کد یک جا تعریف شده و ساختنش این‌جا یعنی
    //    اولین تغییرِ قالب، دو شکلِ متفاوت در دو صفحه.
    return { ok: true, visitId: visit.id, visitCode: (visit as any).code };
  }

  /** رد — با دلیل، چون بیمار همان را می‌بیند. */
  async reject(id: number, dto: { note?: string }, user: any) {
    const row = await this.prisma.intakeSubmission.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('ثبت‌نام پیدا نشد');
    if (row.status === 'approved') throw new BadRequestException('ثبت‌نامِ تأییدشده رد نمی‌شود');
    const note = text(dto.note, 300);
    if (!note) throw new BadRequestException('دلیلِ رد را بنویسید — بیمار همین را می‌بیند');
    await this.prisma.intakeSubmission.update({
      where: { id },
      data: { status: 'rejected', reviewNote: note, reviewedById: user?.id ?? null, reviewedAt: new Date() },
    });
    await this.audit.record({ actorId: user?.id, action: 'intake.reject', entityType: 'intake_submission', entityId: id, after: { note } });
    return { ok: true };
  }

  /**
   * برگرداندن برای اصلاح.
   *
   * ⚠️ به `pending_payment` برمی‌گردد نه `pending_fill`: فیش قبلاً آمده و
   * پاک‌کردنش یعنی بیمار دوباره آپلود کند. یادداشتِ ادمین همان چیزی است که
   * بیمار روی فرمش می‌بیند.
   */
  async returnForFix(id: number, dto: { note?: string }, user: any) {
    const row = await this.prisma.intakeSubmission.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('ثبت‌نام پیدا نشد');
    if (row.status !== 'pending_approval') throw new BadRequestException('فقط ثبت‌نامِ در انتظارِ تأیید برمی‌گردد');
    const note = text(dto.note, 300);
    if (!note) throw new BadRequestException('بنویسید چه چیزی باید اصلاح شود');
    await this.prisma.intakeSubmission.update({
      where: { id },
      data: { status: 'pending_payment', reviewNote: note, reviewedById: user?.id ?? null, reviewedAt: new Date() },
    });
    await this.audit.record({ actorId: user?.id, action: 'intake.return', entityType: 'intake_submission', entityId: id, after: { note } });
    return { ok: true };
  }

  /**
   * انقضا در لحظهٔ خواندن.
   *
   * ⚠️ کارِ زمان‌بندی‌شده لازم نیست و **نداشتنش عمدی است**: تنها جایی که
   * «منقضی» اهمیت دارد همان لحظه‌ای است که کسی سراغش می‌آید. cronِ جدا یعنی
   * یک مسیرِ دومِ تغییرِ وضعیت که در محیطِ بدونِ cron بی‌صدا کار نمی‌کند.
   */
  private async expireIfDue(token: string) {
    const row = await this.prisma.intakeSubmission.findUnique({ where: { token } });
    if (!row) throw new NotFoundException('این فرم معتبر نیست');
    const open = ['pending_fill', 'pending_payment'].includes(row.status);
    if (open && row.expiresAt.getTime() < Date.now()) {
      return this.prisma.intakeSubmission.update({ where: { id: row.id }, data: { status: 'expired' } });
    }
    return row;
  }
}
