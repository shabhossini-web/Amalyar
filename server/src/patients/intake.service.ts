import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PatientsService } from './patients.service';
import { StorageService } from '../storage/storage.service';
import { BillingService } from './billing.service';
import { SurveyService } from './survey.service';
import { FormsService, FORM_SCOPES } from './forms.service';
import { isValidNationalId, toEnDigits } from '../common/identity';
import { SmsService } from '../sms/sms.service';
import { TenantContext } from '../tenant/tenant-context';

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
 * برچسبِ خواندنیِ یک حسابِ بانکی — «شهاب حسینی — بانکِ ملت».
 *
 * ⚠️ سمتِ سرور و نه در render (قانون ۱۵): همین رشته امروز در سه فایلِ کلاینت
 * جدا ساخته می‌شود و روزی یکی‌شان جداکننده یا ترتیب را عوض می‌کند.
 */
const bankLabel = (b: { ownerName: string; bankName?: string | null }) =>
  [b.ownerName, b.bankName].filter(Boolean).join(' — ');

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
    private billing: BillingService,
    private survey: SurveyService,
    /* ⚠️ اعتبارسنجیِ فرم از **همان** سرویسی می‌آید که فرم‌ساز و ثبتِ مراجعه
       استفاده می‌کنند. کپیِ دومِ قاعدهٔ «اجباری» یعنی روزی ستاره‌ای که ادمین
       روشن کرده روی فرمِ عمومی اثر نداشته باشد، بی‌هیچ خطایی. */
    private forms: FormsService,
    private sms: SmsService,
    /* ⚠️ نشانیِ عمومیِ لینک از **میزبانِ همین درخواست** ساخته می‌شود، نه از یک
       متغیرِ محیطی: هر شرکت دامنهٔ خودش را دارد و یک `BASE_URL`ِ سراسری،
       لینکِ شرکتِ الف را با دامنهٔ شرکتِ ب می‌فرستاد. در production این میزبان
       **تأییدشده** است — تنانت فقط وقتی حل می‌شود که هاست در `tenant_domains`
       باشد — پس جای تزریقِ Host نیست. همان مبنایی که rpIDِ پس‌کی و هاستِ
       WebOTP از آن می‌آیند. */
    private tenant: TenantContext,
  ) {}

  private token() {
    return randomBytes(18).toString('base64url');
  }

  // ── لینکِ دائمی (ادمین) ────────────────────────────────────────────

  /**
   * فهرستِ لینک‌ها — با **برچسبِ** فرم و حساب، نه فقط شناسه‌شان.
   *
   * ⚠️ قانون ۱۵: هیچ فرمولی در render. اگر کلاینت `formId` می‌گرفت و خودش به
   * عنوان وصلش می‌کرد، همان join در فهرستِ ادمین و در رندرِ عمومی دو جا نوشته
   * می‌شد و روزی دو جواب می‌داد. برچسبِ حساب هم همان
   * `[ownerName, bankName]`ی است که سه فایلِ دیگر جدا می‌سازند.
   *
   * `formHasPayment` هم این‌جا حساب می‌شود: «آیا این فرم باکسِ پرداخت دارد؟»
   * پرسشی دربارهٔ تعریفِ فرم است، نه دربارهٔ صفحه.
   */
  async listLinks() {
    const rows = await this.prisma.intakeLink.findMany({
      orderBy: { id: 'desc' },
      include: {
        _count: { select: { submissions: true } },
        form: { select: { title: true, color: true, fields: { where: { type: 'payment' }, select: { id: true } } } },
        bankAccount: { select: { ownerName: true, bankName: true, showOnIntake: true, active: true } },
      },
    });
    return rows.map((r) => ({
      ...r,
      submissionCount: r._count.submissions,
      formTitle: r.form?.title ?? null,
      formColor: r.form?.color ?? null,
      formHasPayment: (r.form?.fields.length ?? 0) > 0,
      bankLabel: r.bankAccount ? bankLabel(r.bankAccount) : null,
      /* ⚠️ حسابی که بعد از ساختِ لینک از فرمِ عمومی برداشته شده هنوز به لینک
         وصل است ولی به بیمار نشان داده **نمی‌شود**. بدونِ این پرچم، ادمین یک
         نامِ حساب روی ردیف می‌دید و فکر می‌کرد کار می‌کند. */
      bankHidden: !!r.bankAccount && !(r.bankAccount.showOnIntake && r.bankAccount.active),
      _count: undefined,
      form: undefined,
      bankAccount: undefined,
    }));
  }

  /**
   * فرم‌هایی که می‌شود پشتِ یک لینک گذاشت — **هر سه محدوده**.
   *
   * ⚠️ تا مرحلهٔ ۳ فقط `intake` برمی‌گشت، چون هیچ‌چیز به `scope` احترام
   * نمی‌گذاشت و پیشنهادِ فرمِ مراجعه یعنی وعدهٔ رفتاری که وجود نداشت. حالا
   * `approve` هر سه را می‌شناسد، پس انتخابگر هم می‌تواند نشانشان بدهد.
   *
   * `scope` برمی‌گردد تا رابط بتواند بگوید پرشدنِ این فرم **چه می‌سازد** —
   * انتخابی که پیامدش پیدا نباشد، انتخابِ آگاهانه نیست.
   *
   * ⚠️ چرا endpointِ جدا و نه همان `GET /forms`: آن پشتِ مجوزِ `forms.read`
   * است و این صفحه مجوزِ `intake.*` دارد.
   */
  async formsForLinks() {
    const rows = await this.prisma.formDef.findMany({
      where: { active: true },
      orderBy: [{ scope: 'asc' }, { id: 'asc' }],
      select: {
        id: true, title: true, color: true, scope: true, visitKind: true,
        fields: { where: { type: 'payment' }, select: { id: true } },
      },
    });
    return rows.map((f) => ({
      id: f.id, title: f.title, color: f.color, scope: f.scope, visitKind: f.visitKind,
      hasPayment: f.fields.length > 0,
      /* پرشدنش مراجعه می‌سازد؟ `record` نمی‌سازد و همین تفاوتِ اصلی است. */
      makesVisit: f.scope !== 'record',
    }));
  }

  /**
   * حساب‌هایی که می‌شود به یک لینک بست — **فقط نام**، بدونِ هیچ شماره‌ای.
   *
   * ⚠️ چرا از `GET /bank-accounts` استفاده نمی‌کنیم: آن پشتِ
   * `@Feature('accounting')` است و نصبی که پلنِ حسابداری ندارد ۴۰۳ می‌گیرد —
   * انتخابگر برای همیشه خالی می‌ماند بی‌آنکه کسی بفهمد چرا. (`ApproveSheet`
   * همین حالا با `.catch(() => [])` همین خطا را می‌بلعد.)
   *
   * ⚠️ شماره‌ها عمداً برنمی‌گردند: برای انتخابِ حساب فقط نام لازم است، و
   * برگرداندنِ شماره یعنی گستردنِ سطحِ افشا به یک مجوزِ دیگر.
   */
  async banksForLinks() {
    const rows = await this.prisma.bankAccount.findMany({
      where: { active: true, showOnIntake: true },
      orderBy: { id: 'asc' },
      select: { id: true, ownerName: true, bankName: true },
    });
    return rows.map((b) => ({ id: b.id, label: bankLabel(b) }));
  }

  /**
   * فرم و حسابِ انتخاب‌شده را می‌سنجد و شناسه‌های تمیز برمی‌گرداند.
   *
   * ⚠️ **اعتبارسنجی روی سرور، نه فیلترِ کلاینت.** انتخابگر فقط حساب‌های
   * `showOnIntake` را نشان می‌دهد، ولی هر کسی با مجوزِ `intake.manage`
   * می‌تواند یک id دلخواه POST کند — و `intake.manage` به‌معنیِ
   * `accounting.manage` نیست. `showOnIntake` تنها دروازهٔ opt-inِ ممیزی‌شده‌ای
   * است که شمارهٔ حساب را از یک نشانیِ بی‌احراز دور نگه می‌دارد؛ دورزدنش با یک
   * POST یعنی دروازه‌ای که نیست.
   */
  private async resolveLinkRefs(dto: { formId?: number | null; bankAccountId?: number | null }) {
    const out: { formId?: number | null; bankAccountId?: number | null; formScope?: string } = {};

    if (dto.formId !== undefined) {
      if (dto.formId === null || Number(dto.formId) === 0) out.formId = null;
      else {
        const form = await this.prisma.formDef.findUnique({ where: { id: Number(dto.formId) } });
        if (!form) throw new BadRequestException('فرمِ انتخاب‌شده پیدا نشد');
        if (!form.active) throw new BadRequestException('این فرم خاموش است — اول در فرم‌ساز روشنش کنید');
        /* هر سه محدوده مجازند و هرکدام مسیرِ تأییدِ خودش را دارد
           (`approve`): `intake`/`visit` مراجعه می‌سازند، `record` به پرونده
           می‌چسبد. تا مرحلهٔ ۳ فقط `intake` پذیرفته می‌شد، چون هیچ‌چیز به
           `scope` احترام نمی‌گذاشت و پذیرشِ بقیه یعنی وعدهٔ رفتاری که نبود. */
        if (!(FORM_SCOPES as readonly string[]).includes(form.scope)) {
          throw new BadRequestException('محدودهٔ این فرم پشتیبانی نمی‌شود');
        }
        out.formId = form.id;
        out.formScope = form.scope;
      }
    }

    if (dto.bankAccountId !== undefined) {
      if (dto.bankAccountId === null || Number(dto.bankAccountId) === 0) out.bankAccountId = null;
      else {
        const acc = await this.prisma.bankAccount.findUnique({ where: { id: Number(dto.bankAccountId) } });
        if (!acc) throw new BadRequestException('حسابِ انتخاب‌شده پیدا نشد');
        if (!acc.active) throw new BadRequestException('این حساب غیرفعال است');
        if (!acc.showOnIntake) {
          throw new BadRequestException('این حساب برای نمایش در فرمِ بیمار علامت نخورده — اول در حسابداری علامتش بزنید');
        }
        out.bankAccountId = acc.id;
      }
    }

    return out;
  }

  /**
   * فرمِ **زیرپرونده** نمی‌تواند مبلغ داشته باشد.
   *
   * ⚠️ چرا این‌جا و نه هنگامِ تأیید: پرشدنِ فرمِ `record` مراجعه‌ای نمی‌سازد، و
   * دفترِ مالی همه‌چیزش به `visitId` گره خورده — نه Charge دارد نه Payment.
   * پس مبلغی که روی چنین لینکی گذاشته شود، **هیچ‌وقت وارد دفتر نمی‌شود**:
   * بیمار پول می‌فرستد، ادمین فیش را می‌بیند و تأیید می‌کند، و آن عدد در هیچ
   * گزارشی پیدا نمی‌شود. جلوگیری موقعِ ساختِ لینک بلند است؛ کشفش سرِ گزارشِ
   * آخرِ ماه بی‌صدا.
   */
  private async assertRecordFormHasNoAmount(scope: string | null | undefined, amount: number) {
    if (scope === 'record' && amount > 0) {
      throw new BadRequestException(
        'فرمِ «زیرپرونده» مراجعه‌ای نمی‌سازد، پس مبلغش جایی در دفترِ مالی ثبت نمی‌شود — مبلغ را صفر بگذارید یا فرمِ «مراجعه» انتخاب کنید',
      );
    }
  }

  async createLink(
    dto: { title: string; amount?: number; notes?: string; formId?: number | null; bankAccountId?: number | null },
    user: any,
  ) {
    const title = text(dto.title, 120);
    if (!title) throw new BadRequestException('عنوانِ لینک را وارد کنید');
    const refs = await this.resolveLinkRefs(dto);
    const amount = Math.max(0, Number(dto.amount) || 0);
    await this.assertRecordFormHasNoAmount(refs.formScope, amount);
    const row = await this.prisma.intakeLink.create({
      data: {
        token: this.token(),
        title,
        amount,
        notes: text(dto.notes, 300),
        formId: refs.formId ?? null,
        bankAccountId: refs.bankAccountId ?? null,
      },
    });
    await this.audit.record({ actorId: user?.id, action: 'intake.link.create', entityType: 'intake_link', entityId: row.id, after: row });
    return row;
  }

  /**
   * ویرایشِ لینک.
   *
   * ⚠️ عوض‌کردنِ `formId` روی ثبت‌نام‌های **در جریان** اثر ندارد و نباید داشته
   * باشد: هر ثبت‌نام فرمش را هنگامِ شروع عکس می‌گیرد
   * (`IntakeSubmission.formId`). بدونِ آن، پاسخ‌هایی که بیمار زیرِ فرمِ A داده
   * با کلیدهای فرمِ B خوانده می‌شدند — هر جواب زیرِ برچسبِ اشتباه، بی‌هیچ خطایی.
   */
  async patchLink(
    id: number,
    dto: { title?: string; amount?: number; active?: boolean; notes?: string; formId?: number | null; bankAccountId?: number | null },
    user: any,
  ) {
    const row = await this.prisma.intakeLink.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('لینک پیدا نشد');
    const refs = await this.resolveLinkRefs(dto);

    /* ⚠️ **حالتِ نهایی** سنجیده می‌شود، نه فقط چیزی که در این درخواست آمده:
       گذاشتنِ مبلغ روی لینکی که از قبل فرمِ زیرپرونده دارد، و گذاشتنِ فرمِ
       زیرپرونده روی لینکی که از قبل مبلغ دارد، هر دو یک وضعیتِ نامعتبرند. */
    const nextAmount = dto.amount !== undefined ? Math.max(0, Number(dto.amount) || 0) : row.amount;
    let nextScope = refs.formScope;
    if (refs.formId === undefined && row.formId) {
      nextScope = (await this.prisma.formDef.findUnique({ where: { id: row.formId }, select: { scope: true } }))?.scope;
    }
    await this.assertRecordFormHasNoAmount(nextScope, nextAmount);

    const data: any = {};
    if (dto.title !== undefined) data.title = text(dto.title, 120) ?? row.title;
    if (dto.amount !== undefined) data.amount = nextAmount;
    if (dto.active !== undefined) data.active = !!dto.active;
    if (dto.notes !== undefined) data.notes = text(dto.notes, 300);
    if (refs.formId !== undefined) data.formId = refs.formId;
    if (refs.bankAccountId !== undefined) data.bankAccountId = refs.bankAccountId;
    const next = await this.prisma.intakeLink.update({ where: { id }, data });
    await this.audit.record({ actorId: user?.id, action: 'intake.link.update', entityType: 'intake_link', entityId: id, before: row, after: next });
    return next;
  }

  /**
   * نشانیِ عمومیِ یک لینک — **تک‌منبع**.
   *
   * ⚠️ تا امروز فقط مرورگر این رشته را می‌ساخت (`${origin}/r/${token}` در
   * `Intake.jsx`). حالا سرور هم باید همان را در پیامک بگذارد، و دو جا که یک
   * نشانی می‌سازند یعنی روزی که مسیر عوض شود، یکی‌شان عقب می‌ماند و بیمار
   * لینکِ ۴۰۴ می‌گیرد.
   */
  private publicUrl(token: string) {
    const host = this.tenant.require().hostname;
    return `https://${host}/r/${token}`;
  }

  /**
   * فرستادنِ لینک با پیامک — همان کاری که ادمین امروز دستی می‌کند: کپی، رفتن
   * به پیام‌رسان، چسباندن.
   *
   * ⚠️ لینکِ **غیرفعال** فرستاده نمی‌شود. بدونِ این سد، ادمین لینکی می‌فرستاد
   * که بیمار با بازکردنش «این لینک غیرفعال شده است» می‌دید — و تماسِ
   * پشتیبانی می‌گرفت. خطا این‌جا ارزان است، آن‌جا گران.
   *
   * ⚠️ شماره **سمتِ سرور** هم سنجیده می‌شود: `SmsService` شمارهٔ نامعتبر را
   * بی‌صدا رد می‌کند (`sent:false`) و ادمین فکر می‌کرد فرستاده شده. پس
   * پیش از رسیدن به آن، ۴۰۰ می‌دهیم با دلیل.
   */
  async sendLinkSms(id: number, phone: string, user: any) {
    const link = await this.prisma.intakeLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('لینک پیدا نشد');
    if (!link.active) throw new BadRequestException('این لینک غیرفعال است — اول فعالش کنید');

    const to = toEnDigits(String(phone ?? '')).replace(/[^0-9]/g, '');
    if (!/^09\d{9}$/.test(to)) throw new BadRequestException('شمارهٔ موبایل نامعتبر است (مثال: ۰۹۱۲۱۲۳۴۵۶۷)');

    /* ⚠️ عنوانِ لینک داخلِ متن می‌آید تا بیمار بداند این پیامک برای چیست.
       «لغو۱۱» را خودِ `send` می‌چسباند — این‌جا تکرارش نکن، وگرنه دوبار
       می‌آید (خودِ `appendLagho` نسخهٔ قبلی را پاک می‌کند، ولی به آن تکیه
       نکن). */
    const text = `${link.title}\n${this.publicUrl(link.token)}`;
    const res = await this.sms.send(to, text);

    /* ⚠️ متنِ پیامک در audit **نوشته نمی‌شود** ولی مقصد بله: باید بتوان
       پاسخ داد «این لینک برای چه شماره‌ای رفت»، بی‌آنکه دفترِ ممیزی به
       آرشیوِ محتوای پیام‌ها تبدیل شود. */
    await this.audit.record({
      actorId: user?.id, action: 'intake.link.sms', entityType: 'intake_link', entityId: id,
      after: { to, sent: res.sent, stub: res.stub },
    });
    /* `stub` یعنی سرویسِ پیامک پیکربندی نشده (محیطِ توسعه). کلاینت باید
       تفاوتش را با «فرستاده شد» بداند، وگرنه در dev همه‌چیز موفق به‌نظر
       می‌رسد و کسی نمی‌فهمد هیچ پیامکی نرفته. */
    return { ...res, to, url: this.publicUrl(link.token) };
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
    dto: { firstName: string; lastName: string; nationalId: string; phone: string; birthDate?: string; address?: string; referralSourceId?: number; referralNote?: string; captchaA: number; captchaB: number; captchaAnswer: number },
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
    /* ⚠️ همان اعتبارسنجیِ مسیرِ ادمین، نه یک «۱۰ رقم» ساده‌تر. نسخهٔ اول فقط
       طول را می‌سنجید، پس کدِ ملیِ بی‌اعتبار از **درِ عمومی** وارد می‌شد و
       هنگامِ تأیید هم دوباره سنجیده نمی‌شد (چون آن‌جا با `patientId` می‌رویم).
       نتیجه: پرونده‌ای با کدِ ملیِ غلط که ادمین هرگز نمی‌توانست بسازد. */
    if (!isValidNationalId(nationalId)) throw new BadRequestException('کدِ ملی معتبر نیست');
    if (!/^09\d{9}$/.test(phone)) throw new BadRequestException('شمارهٔ موبایل نامعتبر است');

    const { patientId } = await this.prisma.$transaction((tx) =>
      this.patients.resolveOrCreatePatient(tx, { firstName, lastName, phone, nationalId, birthDate: dto.birthDate }),
    );

    /* **کانالِ آشنایی** روی خودِ پرونده می‌نشیند نه در JSONِ ثبت‌نام، چون
       رویش گزارش می‌گیریم. منطقش — از جمله «فقط اگر پرونده هنوز خالی است» —
       در `SurveyService.attachSource` است تا یک جا بماند. */
    await this.survey.attachSource(patientId, dto.referralSourceId, dto.referralNote);

    /* ⚠️ ثبت‌نامِ نیمه‌کاره فقط **روی همین لینک** ادامه پیدا می‌کند.
       نسخهٔ قبلی فقط `patientId` را می‌سنجید: بیماری که فرمِ لینکِ A را نیمه‌کاره
       رها کرده بود و بعد روی لینکِ B می‌زد، ثبت‌نامِ A را تحویل می‌گرفت — با
       مبلغِ A. تا دیروز فقط قیمت غلط می‌شد؛ حالا که لینک فرم دارد، **پرسش‌نامهٔ
       اشتباه** هم به بیمار داده می‌شود، باز هم بی‌هیچ خطایی. */
    const open = await this.prisma.intakeSubmission.findFirst({
      where: { patientId, linkId: link.id, status: { in: ['pending_fill', 'pending_payment', 'pending_approval'] } },
      orderBy: { id: 'desc' },
    });
    if (open) return this.publicView(open.token);

    const row = await this.prisma.intakeSubmission.create({
      data: {
        token: this.token(),
        linkId: link.id,
        patientId,
        amount: link.amount,
        /* عکسِ لحظه‌ای از فرمِ لینک — به همان دلیلی که `amount` کپی می‌شود. */
        formId: link.formId,
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
    /* ⚠️ حساب از **لینکِ همین ثبت‌نام** خوانده می‌شود، نه از خودِ ثبت‌نام.
       عمداً snapshot نشد (برخلافِ `amount` و `formId`): اگر حسابی بسته شود،
       فیشِ بیمار باید به حسابِ تازه برود — نه به حسابی که موقعِ شروعِ فرم
       انتخاب شده بود و حالا دیگر پول نمی‌گیرد. */
    const link = await this.prisma.intakeLink.findUnique({
      where: { id: row.linkId },
      select: { bankAccountId: true },
    });
    return {
      // ⚠️ بدونِ این، بیمار مبلغ را می‌بیند ولی نمی‌داند **به کجا** بریزد —
      //    و فیشی که آپلود می‌کرد به حسابِ ما نبود. فقط حساب‌هایی که ادمین
      //    صریحاً برای فرمِ عمومی علامت زده، و فقط فیلدهای لازمِ واریز.
      payTo: await this.payTo(link?.bankAccountId ?? null),
      /* ⚠️ تعریفِ فرم از **عکسِ لحظه‌ایِ خودِ ثبت‌نام** می‌آید نه از لینک: اگر
         ادمین وسطِ کار فرمِ لینک را عوض کند، بیمارِ در جریان باید همان فرمی را
         ببیند که شروع کرده. `null` یعنی «فرمی ندارد» و صفحه به فیلدهای
         هاردکدِ امروز برمی‌گردد. */
      form: await this.formView(row.formId),
      token: row.token,
      status: row.status,
      statusLabel: INTAKE_LABELS[row.status] ?? row.status,
      // ⚠️ هر سه عدد برمی‌گردند نه فقط «قابلِ پرداخت»: بیمار باید ببیند
      //    تخفیفش واقعاً خورده، وگرنه عددِ کمتر شبیهِ اشتباه به‌نظر می‌رسد.
      amount: row.amount,
      discountCode: row.discountCode,
      discountAmount: row.discountAmount,
      payable: Math.max(0, row.amount - row.discountAmount),
      data: row.data,
      reviewNote: row.reviewNote,
      expiresAt: row.expiresAt,
    };
  }

  /**
   * حساب‌هایی که بیمار باید به آن‌ها واریز کند.
   *
   * ⚠️ تنها نقطه‌ای است که شمارهٔ حساب از یک نشانیِ **بی‌احراز** خوانده
   * می‌شود، پس فهرست از `showOnIntake` می‌آید نه از «همهٔ حساب‌های فعال»:
   * حسابِ شخصیِ شریک نباید روی اینترنت برود. `partnerId` و یادداشت هم
   * برنمی‌گردند — بیمار فقط به نام و شماره احتیاج دارد.
   *
   * ⚠️ **`showOnIntake` دوباره این‌جا سنجیده می‌شود، حتی وقتی لینک حساب دارد.**
   * `resolveLinkRefs` هنگامِ ساختِ لینک سنجیده بود، ولی ادمین می‌تواند فردا
   * حساب را از فرمِ عمومی بردارد؛ اگر این‌جا دوباره نمی‌سنجیدیم، آن «برداشتن»
   * روی لینک‌های ساخته‌شده هیچ اثری نداشت — یک دروازهٔ امنیتی که فقط یک بار
   * قفل می‌شود، قفل نیست.
   *
   * ⚠️ **fallback به فهرستِ سراسری اجباری است.** همهٔ لینک‌های موجود
   * `bankAccountId = null` دارند؛ بدونِ این، همین یک تغییر شمارهٔ حساب را از
   * روی **تمام** فرم‌های امروز برمی‌داشت و بیمار به‌جای شماره، هشدارِ «شمارهٔ
   * حسابی تنظیم نشده» می‌دید — بدونِ خطا، بدونِ لاگ، فقط ثبت‌نامِ صفر.
   */
  private async payTo(bankAccountId: number | null) {
    const where = bankAccountId
      ? { id: bankAccountId, active: true, showOnIntake: true }
      : { active: true, showOnIntake: true };
    const select = {
      id: true, ownerName: true, bankName: true,
      accountNumber: true, cardNumber: true, iban: true,
    };
    const rows = await this.prisma.bankAccount.findMany({ where, orderBy: { id: 'asc' }, select });
    /* حسابِ انتخاب‌شده بسته یا از فرمِ عمومی برداشته شده → به فهرستِ سراسری
       برگرد، وگرنه بیمار با فرمی روبه‌رو می‌شود که هیچ راهِ پرداختی ندارد. */
    if (bankAccountId && rows.length === 0) {
      return this.prisma.bankAccount.findMany({
        where: { active: true, showOnIntake: true },
        orderBy: { id: 'asc' },
        select,
      });
    }
    return rows;
  }

  /**
   * تعریفِ فرمی که بیمار باید پر کند — فقط فیلدهای **دلخواه**.
   *
   * ⚠️ فیلدهای `builtin`ِ فرمِ ثبت‌نام (نام، کدِ ملی، موبایل، …) ستونِ `Patient`
   * هستند و در گامِ **اول** (`register`) گرفته می‌شوند، نه این‌جا. اگر این‌جا
   * هم می‌آمدند، بیمار همان چهار فیلد را دو بار پر می‌کرد و نسخهٔ دوم روی
   * پرونده نمی‌نشست.
   *
   * ⚠️ فرمِ **خاموش‌شده** مثلِ فرمِ نبوده رفتار می‌کند (`null`): ادمین فرم را
   * خاموش کرده و صفحه باید به مسیرِ هاردکدِ قدیمی برگردد، نه اینکه فرمِ خالی
   * نشان بدهد.
   */
  private async formView(formId: number | null) {
    if (!formId) return null;
    const f = await this.prisma.formDef.findUnique({
      where: { id: formId },
      include: { fields: { orderBy: [{ page: 'asc' }, { sort: 'asc' }, { id: 'asc' }] } },
    });
    if (!f || !f.active) return null;
    const fields = f.fields
      .filter((x) => !x.builtin && x.active)
      .map((x) => ({
        key: x.key, label: x.label, type: x.type, required: x.required,
        options: x.options ?? [], hint: x.hint, placeholder: x.placeholder, page: x.page,
      }));
    return {
      key: f.key,
      title: f.title,
      hint: f.hint,
      /* صفحه‌شمار سمتِ سرور (قانون ۱۵) — و از روی همین فیلدهای دیده‌شده، نه
         از کلِ فرم: اگر تنها فیلدِ صفحهٔ ۲ خاموش باشد، صفحهٔ ۲ وجود ندارد. */
      pages: fields.reduce((m, x) => Math.max(m, x.page), 1),
      fields,
    };
  }

  /**
   * پرکردنِ اطلاعاتِ عمل.
   *
   * ⚠️ **ادغام، نه بازنویسی.** نسخهٔ قبلی هر پنج کلید را بی‌قید از `text(...)`
   * رد می‌کرد و `text` برای مقدارِ نیامده `null` برمی‌گرداند — یعنی یک ذخیرهٔ
   * جزئی مقادیرِ قبلی را **پاک می‌کرد**. با آمدنِ فیلدهای دلخواه و فرمِ
   * چندصفحه‌ای این دیگر یک خطرِ نظری نیست: ذخیرهٔ صفحهٔ ۲ صفحهٔ ۱ را می‌ریخت.
   */
  async fill(
    token: string,
    dto: {
      procedure?: string; surgeonName?: string; hospitalName?: string; opDate?: string; notes?: string;
      values?: Record<string, any>;
    },
  ) {
    const row = await this.expireIfDue(token);
    if (!['pending_fill', 'pending_payment'].includes(row.status)) {
      throw new BadRequestException('این فرم دیگر قابلِ ویرایش نیست');
    }

    const data: Record<string, any> = { ...(row.data as any) };
    const fixed: [keyof typeof dto, string, number][] = [
      ['procedure', 'procedure', 200],
      ['surgeonName', 'surgeonName', 100],
      ['hospitalName', 'hospitalName', 150],
      ['opDate', 'opDate', 12],
      ['notes', 'patientNotes', 500],
    ];
    for (const [from, to, max] of fixed) {
      if (dto[from] !== undefined) data[to] = text(dto[from], max);
    }

    const form = await this.formView(row.formId);
    if (form && dto.values) {
      /* ⚠️ فقط کلیدهای **همین فرم** پذیرفته می‌شوند: بدونِ این، یک POSTِ
         دست‌ساز می‌توانست هر کلیدی را در `data` بنشاند — از جمله کلیدهایی که
         هنگامِ تأیید به ستونِ واقعیِ پرونده می‌روند.
         ⚠️ `payment` بیرون می‌ماند چون مقدار ندارد، و `image` هم بیرون می‌ماند
         چون ارجاعش را فقط مسیرِ آپلود می‌نویسد — وگرنه بیمار می‌توانست id یک
         مدرکِ دیگر را جا بزند. */
      const writable = new Set(
        form.fields.filter((x) => x.type !== 'payment' && x.type !== 'image').map((x) => x.key),
      );
      for (const [k, v] of Object.entries(dto.values)) {
        if (writable.has(k)) data[k] = typeof v === 'string' ? text(v, 2000) : v;
      }
      /* ⚠️ همان قاعدهٔ ستارهٔ فرم‌ساز، ولی فقط روی فیلدهایی که بیمار **می‌بیند**.
         نسخهٔ اول کلِ فرم را می‌سنجید و روی فرمِ مراجعه شکست: `createForm` یک
         `opDate`ِ اجباریِ builtin روی هر فرمِ مراجعه می‌سازد، و آن را ادمین
         هنگامِ تأیید پر می‌کند نه بیمار — پس ذخیرهٔ بیمار ۴۰۰ می‌گرفت برای
         کادری که اصلاً روی صفحه‌اش نبود. */
      const r = this.forms.validateFields(form.fields, data);
      if (!r.ok) throw new BadRequestException(Object.values(r.errors).join('، '));
    }

    await this.prisma.intakeSubmission.update({
      where: { id: row.id },
      data: { data, status: 'pending_payment' },
    });
    return this.publicView(token);
  }

  /**
   * عکسی که بیمار روی یک **باکسِ عکسِ** فرم پیوست می‌کند.
   *
   * ⚠️ جدا از `attachReceipt` است و عمداً وضعیت را جلو نمی‌برد: فیش یعنی
   * «پول فرستادم» و ثبت‌نام را کامل می‌کند؛ عکسِ رادیولوژی یک پاسخِ معمولیِ
   * فرم است.
   *
   * ⚠️ در `data` فقط **ارجاع** می‌نشیند و هیچ نشانیِ عمومی برنمی‌گردد: مدرکِ
   * پزشکی پشتِ همان guardهای پرونده می‌ماند. بیمار نامِ فایلِ خودش را می‌بیند،
   * نه راهی برای دوباره‌خواندنش.
   */
  async attachImage(
    token: string,
    fieldKey: string,
    file: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  ) {
    const row = await this.expireIfDue(token);
    if (!['pending_fill', 'pending_payment'].includes(row.status)) {
      throw new BadRequestException('این فرم دیگر قابلِ ویرایش نیست');
    }
    if (!row.patientId) throw new BadRequestException('این فرم پرونده‌ای ندارد');

    /* کلید باید واقعاً یک باکسِ عکسِ **همین** فرم باشد — وگرنه این نشانیِ
       عمومی یک آپلودرِ آزاد است. */
    const form = await this.formView(row.formId);
    const fld = form?.fields.find((x) => x.key === fieldKey && x.type === 'image');
    if (!fld) throw new BadRequestException('این کادر عکس نمی‌گیرد');

    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    if (file.size > MAX_RECEIPT_BYTES) throw new BadRequestException('حجمِ فایل بیش از ۸ مگابایت است');
    // نوعِ فایل روی سرور سنجیده می‌شود؛ `accept`ِ HTML فقط پنجره را محدود می‌کند.
    if (!RECEIPT_MIME.test(file.mimetype || '')) throw new BadRequestException('فقط عکس یا PDF بفرستید');

    const { sha256, size } = await this.storage.save(file.buffer);
    const doc = await this.prisma.document.create({
      data: {
        patientId: row.patientId,
        category: 'other',
        title: fld.label,
        fileName: file.originalname?.slice(0, 200) || 'image',
        mimeType: file.mimetype,
        sha256,
        size,
      },
    });

    const data = { ...(row.data as any), [fieldKey]: { id: doc.id, name: doc.fileName } };
    await this.prisma.intakeSubmission.update({ where: { id: row.id }, data: { data } });
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
        /* فرمِ **همین ثبت‌نام** (عکسِ لحظه‌ای)، نه فرمِ فعلیِ لینک: پنلِ تأیید
           باید بگوید این ثبت‌نام چه می‌سازد، و آن از روی همان فرمی معلوم
           می‌شود که بیمار پر کرده. */
        form: { select: { title: true, scope: true, color: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      token: r.token,
      status: r.status,
      statusLabel: INTAKE_LABELS[r.status] ?? r.status,
      // ⚠️ هر سه عدد، مثلِ نمای بیمار: بدونِ تخفیف، «قابلِ پرداخت»ِ صفحهٔ
      //    ادمین برابرِ مبلغِ کامل می‌شد و ادمین رقمی را تأیید می‌کرد که با
      //    فیشِ جلوی چشمش نمی‌خواند.
      amount: r.amount,
      discountCode: r.discountCode,
      discountAmount: r.discountAmount,
      payable: Math.max(0, r.amount - r.discountAmount),
      data: r.data,
      linkTitle: r.link.title,
      formTitle: r.form?.title ?? null,
      formColor: r.form?.color ?? null,
      /* ⚠️ **مشتق سمتِ سرور** (قانون ۱۵): «آیا تأییدِ این ثبت‌نام مراجعه
         می‌سازد؟» یک قاعدهٔ سرور است و اگر کلاینت خودش از `scope` استنتاجش
         می‌کرد، روزی رفتارِ واقعی و آنچه پنل وعده می‌دهد از هم جدا می‌شدند. */
      makesVisit: (r.form?.scope ?? 'intake') !== 'record',
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
    dto: {
      surgeonId?: number; hospitalId?: number; techId?: number; procedureTypeId?: number;
      opDate?: string; opStartTime?: string; note?: string;
      /// ثبتِ پرداختِ همان فیش — پیش‌فرض روشن، ولی حسابِ مقصد را ادمین می‌گوید.
      registerPayment?: boolean; bankAccountId?: number; paidAmount?: number;
    },
    user: any,
  ) {
    const row = await this.prisma.intakeSubmission.findUnique({ where: { id }, include: { patient: true } });
    if (!row) throw new NotFoundException('ثبت‌نام پیدا نشد');
    if (row.status !== 'pending_approval') throw new BadRequestException('این ثبت‌نام در وضعیتِ انتظارِ تأیید نیست');
    if (!row.patientId) throw new BadRequestException('این ثبت‌نام پرونده‌ای ندارد');

    const d = row.data as any;

    /* ⚠️ **این‌جاست که `scope`ِ فرم بالاخره معنی پیدا می‌کند.**
       تا دیروز `approve` اصلاً فرم را نمی‌خواند و `kind` را هم نمی‌فرستاد، پس
       `createVisit` روی پیش‌فرضِ `'surgery'` می‌افتاد: **هر** ثبت‌نامِ
       تأییدشده یک «جراحی» می‌شد و با `visit.surgery` اعتبارسنجی می‌گشت — حتی
       وقتی لینک فرمِ «ویزیت» یا «پیگیری» داشت. بی‌هیچ خطایی؛ فقط نوعِ غلط در
       تقویم و گزارش. */
    const form = row.formId
      ? await this.prisma.formDef.findUnique({ where: { id: row.formId }, select: { scope: true, visitKind: true, key: true } })
      : null;

    /* پاسخِ فیلدهای دلخواه باید به `Visit.extra` برسد، وگرنه چیزی که بیمار پر
       کرده در JSONِ ثبت‌نام دفن می‌شود و در پروندهٔ او پیدا نیست. کلیدهای
       ثابتِ خودِ ثبت‌نام کنار گذاشته می‌شوند: آن‌ها ستونِ واقعی دارند. */
    const RESERVED = new Set([
      'firstName', 'lastName', 'nationalId', 'phone', 'address', 'birthDate',
      'procedure', 'surgeonName', 'hospitalName', 'opDate', 'patientNotes', 'receiptDocumentId',
    ]);
    const extra: Record<string, any> = {};
    for (const [k, v] of Object.entries(d ?? {})) if (!RESERVED.has(k)) extra[k] = v;

    /* فرمِ **زیرپرونده** مراجعه نمی‌سازد — به پروندهٔ بیمار می‌چسبد و همان‌جا
       می‌ماند. `visitId` خالی می‌ماند و دفترِ مالی هم دست نمی‌خورد (لینکِ چنین
       فرمی اصلاً نمی‌تواند مبلغ داشته باشد؛ `assertRecordFormHasNoAmount`). */
    const makesVisit = form?.scope !== 'record';

    const visit = makesVisit
      ? await this.patients.createVisit({
        patientId: row.patientId,
        /* `visitKind` فقط روی فرمِ `visit` پر است؛ فرمِ `intake` نوعِ مراجعه
           ندارد و همان پیش‌فرضِ `createVisit` را می‌گیرد. */
        kind: form?.visitKind || undefined,
        surgeonId: dto.surgeonId,
        hospitalId: dto.hospitalId,
        techId: dto.techId,
        procedureTypeId: dto.procedureTypeId,
        opType: dto.procedureTypeId ? undefined : (d.procedure ?? undefined),
        opDate: dto.opDate ?? d.opDate ?? undefined,
        opStartTime: dto.opStartTime,
        notes: d.patientNotes ?? undefined,
        ...(Object.keys(extra).length ? { extra } : {}),
      } as any, user)
      : null;

    await this.prisma.intakeSubmission.update({
      where: { id },
      data: {
        status: 'approved',
        visitId: visit?.id ?? null,
        reviewNote: text(dto.note, 300),
        reviewedById: user?.id ?? null,
        reviewedAt: new Date(),
      },
    });

    /* از این‌جا به بعد فقط مسیرِ مراجعه معنی دارد. `return`ِ زودهنگام تا
       بندهای مالیِ پایین مجبور نباشند هر خط `visit!` بنویسند. */
    if (!visit) {
      await this.audit.record({
        actorId: user?.id, action: 'intake.approve.record', entityType: 'intake_submission', entityId: id,
        after: { patientId: row.patientId, formKey: form?.key },
      });
      return { ok: true, madeVisit: false, patientId: row.patientId, patientCode: row.patient?.code ?? null };
    }

    /**
     * ⚠️ مبلغ باید **وارد دفتر** شود، وگرنه مراجعهٔ تأییدشده صفر تومان است و
     * گزارشِ مالی بی‌سروصدا کم می‌شود. تا دیروز `amount`ِ ثبت‌نام هیچ‌جا
     * نمی‌رفت و همین یک شکافِ واقعی بود.
     *
     * تخفیف **قلمِ جدا** می‌شود نه کسر از مبلغِ خدمت: فاکتور باید نشان دهد
     * مبلغِ اصلی چه بود و چقدر تخفیف خورد؛ عددِ خالص‌شده همان اطلاعات را
     * برای همیشه گم می‌کند. علامتِ منفی را خودِ `addCharge` می‌گذارد.
     *
     * ⚠️ **پرداخت هم ثبت می‌شود، ولی حسابِ مقصد را ادمین می‌گوید.**
     *
     * نسخهٔ اول عمداً پرداخت ثبت نمی‌کرد تا خزانه با حسابِ نامعلوم آلوده
     * نشود — ولی نتیجه‌اش این بود که هر مراجعهٔ تأییدشده کلِ مبلغش «مانده»
     * می‌ماند و در فیلترِ «فقط بدهکار» و گزارشِ مالی بدهکار به‌نظر می‌رسید،
     * در حالی که بیمار پولش را داده و ادمین همین حالا فیشش را دیده.
     *
     * راهِ درست «ثبت نکردن» نبود، «پرسیدنِ حسابِ مقصد» بود: ادمین در همان
     * لحظه فیش را جلوی چشمش دارد، پس می‌تواند بگوید پول کجا نشسته.
     */
    if (row.amount > 0) {
      await this.billing.addCharge(visit.id, {
        kind: 'service',
        title: d.procedure || 'خدمتِ ثبت‌شده در فرمِ ثبت‌نام',
        unitPrice: row.amount,
      }, user);
    }
    if (row.discountAmount > 0) {
      await this.billing.addCharge(visit.id, {
        kind: 'discount',
        title: `کدِ تخفیف ${row.discountCode ?? ''}`.trim(),
        unitPrice: row.discountAmount,
      }, user);
    }
    // فیشِ واریزی حالا صاحبِ مراجعه دارد — تا امروز فقط به پرونده وصل بود.
    if (d.receiptDocumentId) {
      await this.prisma.document.updateMany({ where: { id: Number(d.receiptDocumentId) }, data: { visitId: visit.id } });
    }
    const payable = Math.max(0, row.amount - row.discountAmount);
    const pay = dto.registerPayment !== false && payable > 0;
    if (pay) {
      await this.billing.addPayment(visit.id, {
        amount: Math.max(1, Number(dto.paidAmount) || payable),
        // فیشِ واریزی یعنی انتقالِ بانکی؛ روشِ دیگر را ادمین بعداً در
        // صفحهٔ حسابداری اصلاح می‌کند.
        method: 'transfer',
        bankAccountId: dto.bankAccountId,
        reference: `ثبت‌نامِ ${row.token.slice(0, 8)}`,
      }, user);
    }

    await this.audit.record({
      actorId: user?.id, action: 'intake.approve', entityType: 'intake_submission', entityId: id,
      after: { visitId: visit.id, charged: row.amount, discount: row.discountAmount, paid: pay ? payable : 0 },
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

  // ── کدِ تخفیف ─────────────────────────────────────────────────────
  /**
   * اعمالِ کدِ تخفیف روی یک ثبت‌نام.
   *
   * ⚠️ **مبلغ روی سرور حساب می‌شود و مبلغِ کسرشده ذخیره می‌شود، نه دوباره
   * محاسبه.** اگر فردا درصدِ کد عوض شود، تخفیفِ این بیمار نباید عوض شود —
   * و اگر کلاینت مبلغ را می‌فرستاد، هر کسی می‌توانست صفر بپردازد.
   *
   * ⚠️ شمارندهٔ مصرف فقط وقتی بالا می‌رود که کد **تازه** روی این فرم بنشیند؛
   * زدنِ دوبارهٔ همان کد سهمِ استفاده را نمی‌سوزاند.
   */
  async applyDiscount(token: string, rawCode: string) {
    const row = await this.expireIfDue(token);
    if (!['pending_fill', 'pending_payment'].includes(row.status)) {
      throw new BadRequestException('این فرم دیگر قابلِ ویرایش نیست');
    }
    const code = (text(rawCode, 40) ?? '').toUpperCase();
    if (!code) throw new BadRequestException('کد را وارد کنید');
    if (row.discountCode === code) return this.publicView(token);

    const dc = await this.prisma.discountCode.findFirst({
      where: { code: { equals: code, mode: 'insensitive' } },
    });
    if (!dc || !dc.active) throw new BadRequestException('این کد معتبر نیست');
    if (dc.expiresAt && dc.expiresAt.getTime() < Date.now()) throw new BadRequestException('این کد منقضی شده است');
    if (dc.maxUses > 0 && dc.usedCount >= dc.maxUses) throw new BadRequestException('ظرفیتِ این کد تمام شده است');
    if (dc.minAmount > 0 && row.amount < dc.minAmount) {
      throw new BadRequestException(`این کد برای مبلغ‌های بالای ${dc.minAmount.toLocaleString('fa-IR')} تومان است`);
    }

    let off = dc.kind === 'percent'
      ? Math.round((row.amount * Math.max(1, Math.min(100, dc.value))) / 100)
      : dc.value;
    if (dc.kind === 'percent' && dc.maxAmount > 0) off = Math.min(off, dc.maxAmount);
    // تخفیف هرگز از خودِ مبلغ بیشتر نمی‌شود — مبلغِ منفی یعنی ما بدهکار شویم.
    off = Math.max(0, Math.min(off, row.amount));

    await this.prisma.$transaction([
      this.prisma.intakeSubmission.update({
        where: { id: row.id },
        data: { discountCode: dc.code, discountAmount: off },
      }),
      this.prisma.discountCode.update({ where: { id: dc.id }, data: { usedCount: { increment: 1 } } }),
    ]);
    return this.publicView(token);
  }

  async listCodes() {
    const rows = await this.prisma.discountCode.findMany({ orderBy: { id: 'desc' } });
    return rows.map((r) => ({
      ...r,
      kindLabel: r.kind === 'percent' ? 'درصدی' : 'مبلغِ ثابت',
      remaining: r.maxUses > 0 ? Math.max(0, r.maxUses - r.usedCount) : null,
    }));
  }

  async createCode(dto: { code: string; kind?: string; value: number; maxAmount?: number; minAmount?: number; maxUses?: number; expiresAt?: string; note?: string }, user: any) {
    const code = (text(dto.code, 40) ?? '').toUpperCase();
    if (code.length < 3) throw new BadRequestException('کد را کامل وارد کنید');
    const kind = dto.kind === 'fixed' ? 'fixed' : 'percent';
    const value = Number(dto.value) || 0;
    if (kind === 'percent' && (value < 1 || value > 100)) throw new BadRequestException('درصد باید بینِ ۱ تا ۱۰۰ باشد');
    if (kind === 'fixed' && value < 1) throw new BadRequestException('مبلغِ تخفیف را وارد کنید');
    const dup = await this.prisma.discountCode.findFirst({ where: { code: { equals: code, mode: 'insensitive' } } });
    if (dup) throw new BadRequestException('این کد قبلاً ساخته شده است');

    const row = await this.prisma.discountCode.create({
      data: {
        code, kind, value,
        maxAmount: Math.max(0, Number(dto.maxAmount) || 0),
        minAmount: Math.max(0, Number(dto.minAmount) || 0),
        maxUses: Math.max(0, Number(dto.maxUses) || 0),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        note: text(dto.note, 200),
      },
    });
    await this.audit.record({ actorId: user?.id, action: 'discount.create', entityType: 'discount_code', entityId: row.id, after: row });
    return row;
  }

  async patchCode(id: number, dto: { active?: boolean; note?: string }, user: any) {
    const row = await this.prisma.discountCode.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('کد پیدا نشد');
    const next = await this.prisma.discountCode.update({
      where: { id },
      data: {
        ...(dto.active !== undefined ? { active: !!dto.active } : {}),
        ...(dto.note !== undefined ? { note: text(dto.note, 200) } : {}),
      },
    });
    await this.audit.record({ actorId: user?.id, action: 'discount.update', entityType: 'discount_code', entityId: id, before: row, after: next });
    return next;
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
