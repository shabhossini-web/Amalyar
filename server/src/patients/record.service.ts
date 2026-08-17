import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { LEVEL } from '../common/levels';
import { toEnDigits } from '../common/identity';
import { actorName } from '../common/person';
import { colorForKey } from './forms.service';

/** دسته‌های مدرک — فهرستِ بسته، تا گزارش‌گیری روی متنِ آزاد نیفتد. */
export const DOCUMENT_CATEGORIES = [
  'lab', // آزمایش
  'imaging', // تصویربرداری (MRI/CT/رادیولوژی)
  'report', // گزارشِ عمل/مانیتورینگ
  'consent', // رضایت‌نامه
  'identity', // مدرکِ شناسایی
  'receipt', // فیشِ پرداخت
  'other',
] as const;

/** انواعِ شرحِ بالینی — منطبق بر چرخهٔ مطب → عمل → پس از عمل. */
export const NOTE_KINDS = ['visit', 'op', 'progress', 'discharge', 'consult'] as const;

/**
 * حداکثرِ حجمِ مدرک. تصویربرداری بزرگ است، ولی بی‌سقف یعنی یک آپلود می‌تواند
 * دیسکِ سرور را پر کند. قابلِ تنظیم با env برای نصب‌هایی که فضای بیشتری دارند.
 */
export const MAX_DOCUMENT_BYTES = Number(process.env.MAX_DOCUMENT_BYTES || 25 * 1024 * 1024);

/** فیلدهای هویتی — با `patients.read` دیده می‌شوند. */
const PUBLIC_FIELDS = {
  id: true, code: true, firstName: true, lastName: true, phone: true,
  nationalId: true, birthDate: true, gender: true, city: true,
  /* ⚠️ کانالِ آشنایی عمداً **عمومی** است نه بالینی: دادهٔ بازاریابی است نه
     پزشکی، و کسی که فهرستِ بیماران را می‌بیند باید بتواند بداند از کجا
     آمده‌اند. نامِ معرف هم همین‌طور — «دکتر رضایی معرفی کرده» رازِ پزشکی نیست.
     ⚠️ خودِ رابطه هم `include` می‌شود وگرنه فقط یک عددِ بی‌معنی برمی‌گشت. */
  referralSourceId: true, referralNote: true,
  referralSource: { select: { id: true, name: true } },
  createdAt: true, updatedAt: true, deletedAt: true,
} as const;

/** فیلدهای بالینی/حساس — فقط با `patients.clinical.read`. */
const CLINICAL_FIELDS = {
  address: true, bloodType: true, allergies: true, chronicConditions: true,
  medications: true, insurer: true, insuranceNo: true, supplementalInsurer: true,
  emergencyName: true, emergencyPhone: true, emergencyRelation: true, notes: true,
} as const;

@Injectable()
export class RecordService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private audit: AuditService,
  ) {}

  /**
   * دسترسیِ کاربر به پرونده.
   *
   * سوپروایزر و بالاتر همهٔ پرونده‌ها را می‌بینند؛ کارشناس فقط پرونده‌ای که خودش
   * در آن مراجعه‌ای دارد. همان قاعدهٔ `scopedVisitWhere` است — اگر اینجا اعمال
   * نمی‌شد، کارشناس با حدسِ id به مدارکِ هر بیماری می‌رسید.
   */
  private async assertAccess(patientId: number, user: any) {
    const scoped = (user?.level ?? 0) < LEVEL.SUPERVISOR;
    const patient = await this.prisma.patient.findFirst({
      where: {
        id: patientId,
        ...(scoped ? { visits: { some: { techId: user?.id ?? -1 } } } : {}),
      },
      select: { id: true, code: true },
    });
    if (!patient) throw new NotFoundException('پرونده پیدا نشد');
    return patient;
  }

  private canReadClinical(user: any) {
    return (user?.level ?? 0) >= LEVEL.TECH_ADMIN;
  }

  /**
   * پروندهٔ کاملِ بیمار — یک آبجکت، نه چند فراخوانی.
   *
   * کلاینت نباید برای ساختنِ «پرونده» چند endpoint را جمع بزند؛ هر جا این کار
   * لازم شود، یک نفر یکی از تکه‌ها را فراموش می‌کند و پرونده‌ها ناهمسان می‌شوند.
   */
  async get(patientId: number, user: any) {
    await this.assertAccess(patientId, user);
    const clinical = this.canReadClinical(user);

    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { ...PUBLIC_FIELDS, ...(clinical ? CLINICAL_FIELDS : {}) },
    });
    if (!patient) throw new NotFoundException('پرونده پیدا نشد');

    // ⚠️ نامِ آرایه عمداً `clinicalNotes` است، نه `notes`: خودِ بیمار یک فیلدِ متنیِ
    // `notes` دارد و اگر هم‌نام شوند، spread آن را با آرایه می‌پوشاند و ذخیرهٔ
    // پروفایل با «notes must be a string» می‌شکند. (همین باگ یک‌بار رخ داد.)
    const [visits, documents, clinicalNotes, kindDefs, attachedForms] = await Promise.all([
      this.prisma.visit.findMany({
        where: { patientId },
        include: {
          surgeon: { include: { person: true } },
          hospital: true,
          tech: { include: { person: true } },
          procedureType: true,
          diagnosis: true,
        },
        orderBy: [{ opDate: { sort: 'desc', nulls: 'last' } }, { seq: 'desc' }],
      }),
      this.listDocuments(patientId, user),
      clinical ? this.listNotes(patientId, user) : Promise.resolve([]),
      /* فیلدها هم خوانده می‌شوند تا پاسخ‌های فرم در پرونده **برچسب** داشته
         باشند. بدونِ برچسب، `extra` یک شیءِ کلید-مقدارِ خام است که به درد
         هیچ‌کس نمی‌خورد. */
      this.prisma.formDef.findMany({
        where: { scope: 'visit' },
        select: {
          visitKind: true, title: true, key: true, color: true,
          /* همان ترتیبِ `(page, sort, id)`ِ خودِ فرم — پرونده باید همان چیدمانی
             را نشان بدهد که کاربر موقعِ پرکردن دیده بود. */
          fields: {
            orderBy: [{ page: 'asc' }, { sort: 'asc' }, { id: 'asc' }],
            select: { key: true, label: true, builtin: true, active: true, type: true },
          },
        },
      }),
      this.listAttachedForms(patientId, clinical),
    ]);
    /* ⚠️ فرمِ **خاموش** هم خوانده می‌شود (بدونِ `active: true`): مراجعاتِ قدیمی
       با نوعی که دیگر استفاده نمی‌شود باید همچنان نامِ درست را نشان بدهند،
       نه کلیدِ خام. */
    const kindTitles: Record<string, string> = {};
    /* ⚠️ رنگ هم مثلِ عنوان **سمتِ سرور** وصل می‌شود (قانون ۱۵). تا دیروز
       پروندهٔ بیمار کلاسِ `k-${kind}`ِ هاردکد می‌گذاشت، پس نوعی که کاربر در
       فرم‌ساز ساخته بود در داشبورد رنگی و این‌جا **بی‌رنگ** دیده می‌شد — یک
       نوع، دو ظاهر، در دو صفحه. */
    const kindColors: Record<string, string> = {};
    /* برچسبِ فیلدهای **سفارشی** هر نوع. فیلدهای هسته‌ای کنار گذاشته می‌شوند
       چون همین‌جا ستونِ خودشان را دارند (جراح، بیمارستان، تاریخ، …) و دوباره
       نشان‌دادنشان فقط شلوغی است. */
    const kindFields: Record<string, { key: string; label: string; type?: string }[]> = {};
    for (const d of kindDefs) {
      if (!d.visitKind) continue;
      kindTitles[d.visitKind] = d.title;
      kindColors[d.visitKind] = d.color || colorForKey(d.key);
      kindFields[d.visitKind] = (d.fields ?? [])
        .filter((f) => !f.builtin && f.active !== false)
        .map((f) => ({ key: f.key, label: f.label, type: f.type }));
    }

    /**
     * پاسخ‌های فرمِ یک مراجعه، **برچسب‌خورده و مرتب** — مشتقِ سمتِ سرور (قانون ۱۵).
     *
     * ⚠️ چرا لازم شد: پزشک «شرحِ معاینه» را در فرمِ ویزیت می‌نوشت و بعد در
     * پرونده هیچ اثری از آن نبود. پاسخ‌ها در `Visit.extra` بودند و پرونده
     * همان شیءِ خام را پاس می‌داد و هیچ‌جا نشانش نمی‌داد. یعنی چیزی که نوشته
     * شده بود، در جایی که باید خوانده شود وجود نداشت.
     *
     * ترتیب از خودِ تعریفِ فرم می‌آید تا پرونده همان چیدمانی را نشان بدهد که
     * کاربر موقعِ پرکردن دیده بود؛ فیلدِ بی‌پاسخ حذف می‌شود چون ردیفِ خالی
     * چیزی نمی‌گوید. فیلدی که از فرم حذف شده ولی پاسخش مانده هم — با کلیدِ
     * خودش — می‌آید: دادهٔ ثبت‌شده نباید با ویرایشِ فرم از پرونده غیب شود.
     */
    const answersOf = (kind: string | null, extra: any) => {
      const vals = (extra && typeof extra === 'object') ? extra as Record<string, any> : {};
      const defined = kind ? kindFields[kind] ?? [] : [];
      const seen = new Set(defined.map((f) => f.key));
      const rows = defined
        .map((f) => ({ key: f.key, label: f.label, value: vals[f.key] }))
        .concat(Object.keys(vals).filter((k) => !seen.has(k)).map((k) => ({ key: k, label: k, value: vals[k] })));
      return rows
        .filter((r) => r.value !== null && r.value !== undefined && String(r.value).trim() !== '')
        .map((r) => ({ key: r.key, label: r.label, value: String(r.value) }));
    };

    /**
     * **همهٔ شرح‌های نوشته‌شده در فرم‌های مراجعه، یک‌جا** — بدهیِ قدیمی:
     * پزشک «شرحِ معاینه» یا «طرحِ درمان» را در فرمِ ویزیت می‌نوشت و تبِ
     * «شرح‌ها» فقط ClinicalNoteها را نشان می‌داد؛ متنِ فرم فقط لای جزئیاتِ
     * همان یک مراجعه بود. حالا هر پاسخِ متنیِ بلند (textarea) + یادداشتِ
     * builtin هر مراجعه، با برچسب و کدِ مراجعه، در همان تب می‌نشیند.
     *
     * ⚠️ پشتِ همان دروازهٔ بالینی (`clinical`) که خودِ شرح‌ها: متنِ معاینه
     * محتوای بالینی است، فرقی نمی‌کند در کدام جدول ذخیره شده باشد.
     * فقط **خواندنی** است — جای نوشتنش خودِ فرمِ مراجعه است.
     */
    const visitTexts = !clinical ? [] : visits
      .flatMap((v) => {
        const code = `${patient.code}-V${v.seq}`;
        const vals = (v.extra && typeof v.extra === 'object') ? v.extra as Record<string, any> : {};
        const rows = (v.kind ? kindFields[v.kind] ?? [] : [])
          .filter((f) => f.type === 'textarea')
          .map((f) => ({ label: f.label, body: vals[f.key] }))
          .filter((r) => typeof r.body === 'string' && r.body.trim() !== '')
          .map((r) => ({ visitId: v.id, code, kind: v.kind, opDate: v.opDate, label: r.label, body: String(r.body).trim() }));
        if (v.notes && v.notes.trim()) {
          rows.push({ visitId: v.id, code, kind: v.kind, opDate: v.opDate, label: 'یادداشتِ مراجعه', body: v.notes.trim() });
        }
        return rows;
      })
      .sort((a, b) => (b.opDate?.getTime() ?? 0) - (a.opDate?.getTime() ?? 0));

    return {
      ...patient,
      fullName: `${patient.firstName} ${patient.lastName}`.trim(),
      /// نامِ کانال صاف بالا می‌آید تا کلاینت مجبور به گشتن در شیءِ تودرتو نباشد.
      referralSourceName: (patient as any).referralSource?.name ?? null,
      age: patient.birthDate ? ageFrom(patient.birthDate) : null,
      /// کلاینت باید بداند بخشِ بالینی «خالی» است یا «اجازه ندارد» — این دو یکی نیستند.
      clinicalVisible: clinical,
      visits: visits.map((v) => ({
        id: v.id,
        seq: v.seq,
        kind: v.kind,
        code: `${patient.code}-V${v.seq}`,
        opDate: v.opDate,
        opStatus: v.opStatus,
        surgeonName: v.surgeon ? personName(v.surgeon.person) : v.surgeonName,
        hospitalName: v.hospital?.name ?? v.hospitalName,
        techName: v.tech ? personName(v.tech.person) : null,
        procedureTypeName: v.procedureType?.name ?? v.opType,
        diagnosisTitle: v.diagnosis?.title ?? null,
        notes: v.notes,
        extra: v.extra ?? {},
        /* پاسخ‌های فرم — همان چیزی که پزشک نوشته، با برچسبِ خودش. */
        answers: answersOf(v.kind, v.extra),
        /* ⚠️ `null` وقتی این نوع فرمی ندارد — کلاینت آن‌وقت به کلید برمی‌گردد.
           «عمل» نامیدنِ نوعِ ناشناخته دروغ است. */
        kindTitle: v.kind ? kindTitles[v.kind] ?? null : null,
        kindColor: v.kind ? kindColors[v.kind] ?? null : null,
      })),
      /**
       * **مسیرِ درمان** — مشتق از توالیِ مراجعات، نه ذخیره‌شده.
       *
       * ⚠️ وسوسه این بود که هر مراجعه به مراجعهٔ قبلی گره بخورد
       * (`parentVisitId`) و مسیر یک درخت شود. ولی مسیرِ واقعی جایگشتِ زیادی
       * دارد: «ویزیت → درمان → پیگیری»، «ویزیت → جراحی → ادامهٔ درمان →
       * پیگیری»، مطبِ داخلی بدونِ جراحی. هر ساختارِ ثابتی دستِ‌کم یکی را غلط
       * می‌کند، و گره‌زدنِ دستی یعنی کاربری که فراموش کند گره بزند، مسیرش
       * تکه‌تکه می‌شود.
       *
       * پس مسیر **خوانده** می‌شود نه ساخته: همان مراجعاتِ همین پرونده، به
       * ترتیبِ زمان. هیچ ستونی، هیچ گرهی، هیچ کارِ اضافه‌ای برای کاربر.
       *
       * ⚠️ ترتیب این‌جا **صعودی** است (قدیمی → تازه) برخلافِ `visits` که
       * نزولی است: فهرست را کاربر «تازه‌ترین اول» می‌خواهد، ولی مسیر را
       * «از کجا شروع شد» — و همان یک آرایه با دو ترتیب، یعنی یکی‌شان همیشه
       * برعکس دیده می‌شود.
       */
      journey: [...visits]
        .sort((a, b) => {
          const ta = a.opDate ? a.opDate.getTime() : Number.MAX_SAFE_INTEGER;
          const tb = b.opDate ? b.opDate.getTime() : Number.MAX_SAFE_INTEGER;
          return ta - tb || a.seq - b.seq;
        })
        .map((v, i) => ({
          step: i + 1,
          id: v.id,
          kind: v.kind,
          code: `${patient.code}-V${v.seq}`,
          opDate: v.opDate,
          opStatus: v.opStatus,
          title: v.procedureType?.name ?? v.opType ?? null,
          /// فاصله از مراجعهٔ قبلی — «۳۲ روز بعد» چیزی است که پزشک می‌خواهد بداند.
          daysFromPrev: null as number | null,
        }))
        .map((row, i, arr) => {
          if (i === 0) return row;
          const prev = arr[i - 1];
          if (!row.opDate || !prev.opDate) return row;
          const d = Math.round((row.opDate.getTime() - prev.opDate.getTime()) / 86400000);
          return { ...row, daysFromPrev: d };
        }),
      /**
       * برچسبِ هر نوعِ مراجعه، از خودِ تعریف.
       *
       * ⚠️ همراهِ پرونده می‌آید و نه از یک درخواستِ جدا: کلاینت این را در
       * همان لحظه‌ی رندر لازم دارد و یک رفت‌وبرگشتِ دوم یعنی نیم‌ثانیه‌ای که
       * نوعِ مراجعه به‌شکلِ کلیدِ خام دیده می‌شود و بعد می‌پرد.
       */
      kindTitles,
      documents,
      clinicalNotes,
      /* شرح‌های نوشته‌شده در خودِ فرم‌های مراجعه — خوراکِ چیپِ «شرحِ فرم‌ها». */
      visitTexts,
      attachedForms,
      counts: {
        visits: visits.length, documents: documents.length,
        notes: clinicalNotes.length, forms: attachedForms.length,
        visitTexts: visitTexts.length,
        /* ⚠️ شمارشِ **هر نوعِ شرح** حتی وقتی صفر است — و صفرها عمداً حذف
           نمی‌شوند (قانون ۱۵: مشتق سمتِ سرور).

           این کلید از یک شکایتِ واقعی آمد: «سیرِ بیماری از پرونده حذف شده».
           حذف نشده بود؛ یکی از پنج نوعِ شرح بود که فقط داخلِ یک `<select>`
           دیده می‌شد — یعنی برای فهمیدنِ وجودش باید dropdown را باز می‌کردی.
           حالا کلاینت از روی همین نگاشت ردیفِ چیپ می‌سازد و هر پنج نوع با
           نامشان روی صفحه‌اند. نوعِ بی‌شرح هم چیپِ «۰» می‌گیرد، وگرنه باز
           همان مسئله بود: چیزی که نیست، پیدا هم نمی‌شود. */
        notesByKind: Object.fromEntries(
          NOTE_KINDS.map((k) => [k, clinicalNotes.filter((n) => n.kind === k).length]),
        ) as Record<string, number>,
      },
    };
  }

  /** ویرایشِ پروفایل — فیلدهای بالینی فقط با مجوزِ بالینی. */
  async update(patientId: number, dto: Record<string, any>, user: any) {
    await this.assertAccess(patientId, user);
    const before = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!before) throw new NotFoundException('پرونده پیدا نشد');

    const patch: Record<string, unknown> = {};
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() || null : null);

    if (dto.firstName !== undefined) {
      const v = String(dto.firstName).trim();
      if (v.length < 2) throw new BadRequestException('نام را کامل وارد کنید');
      patch.firstName = v;
    }
    if (dto.lastName !== undefined) {
      const v = String(dto.lastName).trim();
      if (v.length < 2) throw new BadRequestException('نام خانوادگی را کامل وارد کنید');
      patch.lastName = v;
    }
    if (dto.phone !== undefined) patch.phone = text(toEnDigits(dto.phone));
    if (dto.birthDate !== undefined) {
      const raw = text(dto.birthDate);
      if (!raw) patch.birthDate = null;
      else {
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخِ تولد معتبر نیست');
        patch.birthDate = d;
      }
    }
    if (dto.gender !== undefined) {
      const v = text(dto.gender);
      if (v && v !== 'male' && v !== 'female') throw new BadRequestException('جنسیت نامعتبر است');
      patch.gender = v;
    }
    if (dto.city !== undefined) patch.city = text(dto.city);

    // کد ملی عمداً اینجا ویرایش نمی‌شود: کلیدِ هویتِ پرونده است و تغییرش یعنی
    // ادغام/جداسازیِ پرونده — مسیرِ جداگانه‌ای می‌خواهد، نه یک PATCH ساده.

    const clinicalKeys = [
      'address', 'bloodType', 'allergies', 'chronicConditions', 'medications',
      'insurer', 'insuranceNo', 'supplementalInsurer',
      'emergencyName', 'emergencyPhone', 'emergencyRelation', 'notes',
    ];
    const touchesClinical = clinicalKeys.some((k) => dto[k] !== undefined);
    if (touchesClinical) {
      if (!this.canReadClinical(user)) throw new ForbiddenException('اجازهٔ ویرایشِ اطلاعاتِ بالینی را ندارید');
      for (const k of clinicalKeys) {
        if (dto[k] === undefined) continue;
        patch[k] = k === 'emergencyPhone' ? text(toEnDigits(dto[k])) : text(dto[k]);
      }
    }

    if (!Object.keys(patch).length) return this.get(patientId, user);

    await this.prisma.patient.update({ where: { id: patientId }, data: patch });
    await this.audit.record({
      actorId: user?.id, action: 'patient.update', entityType: 'patient', entityId: patientId,
      before, after: patch,
    });
    return this.get(patientId, user);
  }

  /**
   * فرم‌هایی که به **پرونده** چسبیده‌اند — نظرسنجی، جوابِ آزمایش، شرحِ حال.
   *
   * ⚠️ **حلقه‌ای که تا امروز باز بود.** از مرحلهٔ ۴، فرمِ `scope: 'record'`
   * هنگامِ تأیید مراجعه نمی‌سازد و فقط `patientId` می‌گیرد
   * (`intake.service.ts` → `madeVisit: false`). یعنی بیمار فرم را پر می‌کرد،
   * ادمین تأییدش می‌کرد، و بعد **هیچ صفحه‌ای نشانش نمی‌داد**: داده در
   * `intake_submissions.data` می‌نشست و آن‌جا دفن می‌شد. نه خطایی، نه
   * لاگی — فقط کاری که نیمه‌کاره مانده بود.
   *
   * ⚠️ برچسبِ هر پاسخ **این‌جا** به مقدارش جوش می‌خورد، نه در مرورگر: کلاینت
   * وگرنه باید تعریفِ فرم را جدا می‌گرفت و خودش zip می‌کرد — دو منبع برای یک
   * چیز، و روزی که فیلدی حذف شود، پاسخِ یتیم زیرِ برچسبِ فیلدِ بعدی می‌نشست.
   *
   * ⚠️ `formId` عکسِ لحظه‌ایِ ثبت‌نام است (نه `link.formId`)، پس اگر ادمین فردا
   * فرمِ لینک را عوض کند، پاسخ‌های دیروز همچنان با برچسب‌های **همان** فرمی
   * خوانده می‌شوند که بیمار دیده بود.
   */
  private async listAttachedForms(patientId: number, clinical: boolean) {
    const rows = await this.prisma.intakeSubmission.findMany({
      where: { patientId, status: 'approved', form: { scope: 'record' } },
      orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
      include: {
        form: {
          select: {
            id: true, key: true, title: true, color: true,
            fields: { where: { builtin: false }, orderBy: [{ page: 'asc' }, { sort: 'asc' }, { id: 'asc' }] },
          },
        },
      },
    });

    /* بخش‌های اختصاصیِ فرمِ پیگیری (extra_form_ids): پاسخ‌ها در همین submission
       است ولی برچسب‌ها در فرمِ خودشان — یک‌جا خوانده می‌شوند تا هر پاسخ
       برچسبِ درستش را بگیرد، نه اینکه پاسخِ بخشِ اختصاصی نامرئی بماند. */
    const extraIds = [...new Set(rows.flatMap((r) => r.extraFormIds ?? []))];
    const extraFieldsOf = new Map(
      extraIds.length
        ? (await this.prisma.formDef.findMany({
          where: { id: { in: extraIds } },
          select: {
            id: true,
            fields: { where: { builtin: false }, orderBy: [{ page: 'asc' }, { sort: 'asc' }, { id: 'asc' }] },
          },
        })).map((f) => [f.id, f.fields] as const)
        : [],
    );

    return rows.map((r) => {
      const data = (r.data ?? {}) as Record<string, any>;
      const ownFields = r.form?.fields ?? [];
      const seen = new Set(ownFields.map((f) => f.key));
      const mergedFields = [
        ...ownFields,
        ...(r.extraFormIds ?? []).flatMap((id) => (extraFieldsOf.get(id) ?? []).filter((f) => !seen.has(f.key))),
      ];
      return {
        id: r.id,
        formTitle: r.form?.title ?? 'فرمِ حذف‌شده',
        formColor: r.form ? r.form.color || colorForKey(r.form.key) : null,
        submittedAt: r.reviewedAt ?? r.updatedAt,
        /* ⚠️ محتوا پشتِ همان درِ بالینی است که یادداشت‌ها. «شرحِ حال» و
           «جوابِ آزمایش» فرمِ زیرپرونده‌اند و کارشناسی که اجازهٔ خواندنِ
           یادداشتِ بالینی ندارد، نباید از این در واردشان شود. ولی **وجودِ**
           فرم پنهان نمی‌شود: کاربر باید بداند چیزی هست که نمی‌بیند. */
        locked: !clinical,
        answers: clinical
          ? mergedFields
            .map((f) => ({ key: f.key, label: f.label, type: f.type, value: data[f.key] }))
            /* فیلدِ بی‌پاسخ ردیفِ خالی نمی‌سازد — فرمِ ده‌فیلدی که بیمار سه‌تا
               پر کرده، نباید هفت خطِ «—» نشان دهد. */
            .filter((a) => a.value !== undefined && a.value !== null && a.value !== '')
          : [],
      };
    });
  }

  // ───────────────────────── مدارک ─────────────────────────

  async listDocuments(patientId: number, user: any) {
    await this.assertAccess(patientId, user);
    const rows = await this.prisma.document.findMany({
      where: { patientId, deletedAt: null },
      orderBy: [{ takenAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    });
    return rows.map((d) => ({
      id: d.id, patientId: d.patientId, visitId: d.visitId, category: d.category,
      title: d.title, fileName: d.fileName, mimeType: d.mimeType, size: d.size,
      takenAt: d.takenAt, createdAt: d.createdAt,
      /// نوعِ محتوا برای کلاینت: عکس را inline نشان می‌دهد، بقیه را دانلود.
      isImage: d.mimeType.startsWith('image/'),
      /// مدرکِ لینکی: کلاینت به‌جای دانلود، همین نشانی را باز می‌کند.
      externalUrl: d.externalUrl,
      isLink: !!d.externalUrl,
    }));
  }

  /**
   * مدرکِ **لینکی** — MRI/پاراکلینیکی که جای دیگری میزبانی می‌شود (پکس،
   * درایو، سایتِ آزمایشگاه). فایلی روی دیسک نمی‌نشیند؛ فقط نشانی.
   *
   * ⚠️ فقط `http(s)`. هر schemeِ دیگر (`javascript:`, `file:`, `data:`) یعنی
   * لینکی که در مرورگرِ همکارِ بعدی کد اجرا می‌کند یا به دیسکِ سرور اشاره
   * دارد — این ورودیِ کاربر است و روی صفحهٔ پرونده کلیک‌شدنی می‌شود.
   */
  async addDocumentLink(
    patientId: number,
    dto: { url?: string; category?: string; title?: string; visitId?: number; takenAt?: string },
    user: any,
  ) {
    await this.assertAccess(patientId, user);
    const raw = (dto.url ?? '').trim();
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new BadRequestException('نشانی معتبر نیست — کاملش را با https بگذارید');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new BadRequestException('فقط لینکِ http/https پذیرفته می‌شود');
    }
    const category = dto.category ?? 'other';
    if (!DOCUMENT_CATEGORIES.includes(category as any)) throw new BadRequestException('دستهٔ مدرک نامعتبر است');
    if (dto.visitId != null) {
      const visit = await this.prisma.visit.findFirst({ where: { id: dto.visitId, patientId } });
      if (!visit) throw new BadRequestException('مراجعهٔ انتخابی برای این بیمار نیست');
    }
    let takenAt: Date | null = null;
    if (dto.takenAt) {
      const d = new Date(dto.takenAt);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخِ مدرک معتبر نیست');
      takenAt = d;
    }
    const row = await this.prisma.document.create({
      data: {
        patientId,
        visitId: dto.visitId ?? null,
        category,
        title: dto.title?.trim() || null,
        // نامِ نمایشی: عنوان اگر هست، وگرنه دامنهٔ لینک — «لینکِ بی‌نام» در
        // فهرستِ مدارک هیچ‌چیز نمی‌گوید.
        fileName: (dto.title?.trim() || url.hostname).slice(0, 200),
        mimeType: 'text/uri-list',
        size: 0,
        sha256: '',
        externalUrl: url.toString().slice(0, 2000),
        takenAt,
        uploadedById: user?.id ?? null,
      },
    });
    await this.audit.record({
      actorId: user?.id, action: 'document.link', entityType: 'document', entityId: row.id,
      after: { patientId, category, url: row.externalUrl },
    });
    return { id: row.id, category: row.category, fileName: row.fileName, externalUrl: row.externalUrl };
  }

  async addDocument(
    patientId: number,
    file: { originalname: string; mimetype: string; buffer: Buffer; size: number },
    dto: { category?: string; title?: string; visitId?: number; takenAt?: string },
    user: any,
  ) {
    await this.assertAccess(patientId, user);
    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new BadRequestException(`حجمِ فایل بیش از حدِ مجاز است (${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} مگابایت)`);
    }
    const category = dto.category ?? 'other';
    if (!DOCUMENT_CATEGORIES.includes(category as any)) throw new BadRequestException('دستهٔ مدرک نامعتبر است');

    // مراجعه اگر داده شده، باید مالِ همین بیمار باشد — وگرنه مدرک زیر پروندهٔ
    // دیگری آویزان می‌شود و در نمای آن بیمار پیدا نمی‌گردد.
    if (dto.visitId != null) {
      const visit = await this.prisma.visit.findFirst({ where: { id: dto.visitId, patientId } });
      if (!visit) throw new BadRequestException('مراجعهٔ انتخابی برای این بیمار نیست');
    }

    let takenAt: Date | null = null;
    if (dto.takenAt) {
      const d = new Date(dto.takenAt);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخِ مدرک معتبر نیست');
      takenAt = d;
    }

    const { sha256, size } = await this.storage.save(file.buffer);
    const row = await this.prisma.document.create({
      data: {
        patientId,
        visitId: dto.visitId ?? null,
        category,
        title: dto.title?.trim() || null,
        // نامِ کاربر فقط برای نمایش است؛ مسیرِ دیسک از sha ساخته می‌شود، پس
        // «/» یا «..» در نام بی‌خطر است. با این حال کوتاهش می‌کنیم.
        fileName: (file.originalname || 'file').slice(0, 200),
        mimeType: file.mimetype || 'application/octet-stream',
        size,
        sha256,
        takenAt,
        uploadedById: user?.id ?? null,
      },
    });
    await this.audit.record({
      actorId: user?.id, action: 'document.create', entityType: 'document', entityId: row.id,
      after: { patientId, category, fileName: row.fileName, size },
    });
    return { id: row.id, category: row.category, fileName: row.fileName, size: row.size };
  }

  /** متادیتا + استریم برای دانلود. دسترسی همان‌جا سنجیده می‌شود. */
  async openDocument(documentId: number, user: any) {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, deletedAt: null } });
    if (!doc) throw new NotFoundException('مدرک پیدا نشد');
    await this.assertAccess(doc.patientId, user);
    // مدرکِ لینکی فایلی روی دیسک ندارد — کلاینت باید خودِ لینک را باز کند.
    if (doc.externalUrl) throw new BadRequestException('این مدرک لینکی است — خودِ لینک را باز کنید');
    if (!(await this.storage.exists(doc.sha256))) throw new NotFoundException('فایلِ این مدرک روی سرور نیست');
    return { doc, stream: this.storage.stream(doc.sha256) };
  }

  /**
   * حذفِ مدرک — نرم. فایلِ فیزیکی فقط وقتی پاک می‌شود که هیچ رکوردِ زنده‌ای
   * همان محتوا را نبرد (چون آپلادِ تکراری فایل را به اشتراک می‌گذارد).
   */
  async deleteDocument(documentId: number, user: any) {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, deletedAt: null } });
    if (!doc) throw new NotFoundException('مدرک پیدا نشد');
    await this.assertAccess(doc.patientId, user);

    await this.prisma.document.update({
      where: { id: documentId },
      data: { deletedAt: new Date(), deletedById: user?.id ?? null },
    });
    const stillUsed = await this.prisma.document.count({
      where: { sha256: doc.sha256, deletedAt: null },
    });
    if (stillUsed === 0) await this.storage.remove(doc.sha256);

    await this.audit.record({
      actorId: user?.id, action: 'document.delete', entityType: 'document', entityId: documentId, before: doc,
    });
    return { ok: true };
  }

  // ──────────────────── شرح‌های بالینی ────────────────────

  async listNotes(patientId: number, user: any) {
    await this.assertAccess(patientId, user);
    if (!this.canReadClinical(user)) throw new ForbiddenException('اجازهٔ خواندنِ شرح‌های بالینی را ندارید');
    const rows = await this.prisma.clinicalNote.findMany({
      where: { patientId, replacedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((n) => ({
      id: n.id, patientId: n.patientId, visitId: n.visitId, kind: n.kind, body: n.body,
      authorName: n.authorName, createdAt: n.createdAt,
      /// وجودِ replacesId یعنی این نسخهٔ ویرایش‌شده است — کاربر باید بداند.
      edited: n.replacesId != null,
    }));
  }

  async addNote(patientId: number, dto: { kind?: string; body?: string; visitId?: number }, user: any) {
    await this.assertAccess(patientId, user);
    if (!this.canReadClinical(user)) throw new ForbiddenException('اجازهٔ ثبتِ شرحِ بالینی را ندارید');
    const kind = dto.kind ?? 'visit';
    if (!NOTE_KINDS.includes(kind as any)) throw new BadRequestException('نوعِ شرح نامعتبر است');
    const body = dto.body?.trim();
    if (!body) throw new BadRequestException('متنِ شرح خالی است');

    if (dto.visitId != null) {
      const visit = await this.prisma.visit.findFirst({ where: { id: dto.visitId, patientId } });
      if (!visit) throw new BadRequestException('مراجعهٔ انتخابی برای این بیمار نیست');
    }

    const row = await this.prisma.clinicalNote.create({
      data: {
        patientId, visitId: dto.visitId ?? null, kind, body,
        authorId: user?.id ?? null,
        authorName: actorName(user),
      },
    });
    await this.audit.record({
      actorId: user?.id, action: 'note.create', entityType: 'clinical_note', entityId: row.id,
      after: { patientId, kind },
    });
    return row;
  }

  /**
   * «ویرایش» = نسخهٔ تازه. رکوردِ قبلی دست‌نخورده می‌ماند و فقط `replacedAt`
   * می‌گیرد، پس همیشه می‌شود ثابت کرد در هر لحظه چه چیزی در پرونده بوده است.
   */
  async amendNote(noteId: number, body: string, user: any) {
    const old = await this.prisma.clinicalNote.findFirst({ where: { id: noteId, replacedAt: null } });
    if (!old) throw new NotFoundException('شرح پیدا نشد');
    await this.assertAccess(old.patientId, user);
    if (!this.canReadClinical(user)) throw new ForbiddenException('اجازهٔ ویرایشِ شرحِ بالینی را ندارید');
    const text = body?.trim();
    if (!text) throw new BadRequestException('متنِ شرح خالی است');

    const fresh = await this.prisma.$transaction(async (tx) => {
      const created = await tx.clinicalNote.create({
        data: {
          patientId: old.patientId, visitId: old.visitId, kind: old.kind, body: text,
          authorId: user?.id ?? null,
          authorName: actorName(user),
          replacesId: old.id,
        },
      });
      await tx.clinicalNote.update({ where: { id: old.id }, data: { replacedAt: new Date() } });
      return created;
    });
    await this.audit.record({
      actorId: user?.id, action: 'note.amend', entityType: 'clinical_note', entityId: fresh.id,
      before: old, after: { body: text },
    });
    return fresh;
  }

  /** تاریخچهٔ یک شرح — از نسخهٔ جاری تا اولین نگارش. */
  async noteHistory(noteId: number, user: any) {
    const note = await this.prisma.clinicalNote.findUnique({ where: { id: noteId } });
    if (!note) throw new NotFoundException('شرح پیدا نشد');
    await this.assertAccess(note.patientId, user);
    if (!this.canReadClinical(user)) throw new ForbiddenException('اجازهٔ خواندنِ شرح‌های بالینی را ندارید');

    const chain = [note];
    let cursor = note;
    while (cursor.replacesId) {
      const prev = await this.prisma.clinicalNote.findUnique({ where: { id: cursor.replacesId } });
      if (!prev) break;
      chain.push(prev);
      cursor = prev;
    }
    return chain.map((n) => ({
      id: n.id, body: n.body, authorName: n.authorName,
      createdAt: n.createdAt, replacedAt: n.replacedAt,
    }));
  }
}

const personName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

/** سنِ کامل‌شده بر مبنای میلادی — نمایشِ شمسی کارِ کلاینت است. */
function ageFrom(birthDate: Date): number {
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const m = now.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birthDate.getDate())) age -= 1;
  return age;
}
