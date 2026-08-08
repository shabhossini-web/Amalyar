import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { LEVEL } from '../common/levels';
import { toEnDigits } from '../common/identity';
import { actorName } from '../common/person';

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
    const [visits, documents, clinicalNotes, kindDefs] = await Promise.all([
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
      this.prisma.formDef.findMany({ where: { scope: 'visit' }, select: { visitKind: true, title: true } }),
    ]);
    /* ⚠️ فرمِ **خاموش** هم خوانده می‌شود (بدونِ `active: true`): مراجعاتِ قدیمی
       با نوعی که دیگر استفاده نمی‌شود باید همچنان نامِ درست را نشان بدهند،
       نه کلیدِ خام. */
    const kindTitles: Record<string, string> = {};
    for (const d of kindDefs) if (d.visitKind) kindTitles[d.visitKind] = d.title;

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
      counts: { visits: visits.length, documents: documents.length, notes: clinicalNotes.length },
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
    }));
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
