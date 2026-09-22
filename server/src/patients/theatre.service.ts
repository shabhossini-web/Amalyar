import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LEVEL } from '../common/levels';
import { ownVisitWhere } from '../common/own-scope';
import { actorName } from '../common/person';
import { setVisitNote } from './clinical-note';
import { DOCUMENT_PHASES, DOCUMENT_PHASE_FA } from './document-categories';
import { RecordService } from './record.service';

/**
 * **چک‌لیستِ ایمنیِ جراحی** — سه مرحله‌ی سازمانِ جهانیِ بهداشت، کوتاه‌شده به آنچه
 * یک تیمِ کوچک واقعاً بلند می‌خواند.
 *
 * 🔴 **از میزِ اتاقِ عمل برداشته شد** (بازخوردِ مالک ۱۴۰۵/۰۶/۳۱: «فرمِ جراحیِ
 * ایمن رو لازم نداریم فعلاً»). ولی نه داده‌اش پاک شد نه مسیرش: جدولِ
 * `safety_checks`، این کاتالوگ، `setCheck` و endpointش سرِ جایشان‌اند و
 * `card()` هنوز وضعیتِ تیک‌ها را برمی‌گرداند. دلیلش «فعلاً» در همان جمله
 * است — برگرداندنش باید یک تغییرِ **رابط** باشد، نه دوباره‌نوشتنِ متنِ WHO و
 * یک مهاجرتِ تازه. چیزی که برداشته شد فقط رندرِ رابط و شمارشِ فهرستِ روز است.
 *
 * ⚠️ متن **در کد** است نه در دیتابیس (همان استدلالِ `site.registry.ts`): این یک
 * برگهٔ ایمنیِ استاندارد است، نه تنظیماتِ شرکت. اگر روزی قابلِ ویرایش شد، سطرهای
 * ثبت‌شده کلیدشان را نگه می‌دارند و متنِ تازه فقط روی تیک‌های بعدی می‌نشیند.
 *
 * ⚠️ ترتیب معنا دارد و همان ترتیبِ اتاقِ عمل است: پیش از بیهوشی ← پیش از برش ←
 * پیش از خروجِ بیمار. رابط هم به همین ترتیب می‌بندد/باز می‌کند.
 */
export const SAFETY_STAGES = [
  {
    key: 'signIn', title: 'پیش از بیهوشی', hint: 'با بیمارِ هوشیار، پیش از القای بیهوشی.',
    items: [
      { key: 'identity', label: 'هویتِ بیمار، محلِ عمل و رضایت‌نامه تأیید شد' },
      { key: 'site', label: 'محلِ عمل علامت‌گذاری شده (یا لازم نیست)' },
      { key: 'anesthesia', label: 'بررسیِ دستگاه و داروی بیهوشی انجام شد' },
      { key: 'pulseOx', label: 'پالس‌اکسیمتر روی بیمار و کار می‌کند' },
      { key: 'allergy', label: 'حساسیتِ شناخته‌شده پرسیده شد' },
      { key: 'airway', label: 'خطرِ راهِ هوایی دشوار / آسپیراسیون سنجیده شد' },
      { key: 'blood', label: 'خطرِ خون‌ریزی بیش از ۵۰۰ سی‌سی سنجیده شد' },
    ],
  },
  {
    key: 'timeOut', title: 'پیش از برش — تایم‌اوت', hint: 'با همهٔ اعضای تیم، بلند و هم‌زمان.',
    items: [
      { key: 'introduce', label: 'همهٔ اعضای تیم خود را با نام و نقش معرفی کردند' },
      { key: 'confirm', label: 'نام بیمار، نوعِ عمل و محلِ آن بلند تأیید شد' },
      { key: 'antibiotic', label: 'آنتی‌بیوتیکِ پیشگیری در ۶۰ دقیقهٔ گذشته داده شد (یا لازم نیست)' },
      { key: 'critical', label: 'مرحله‌های بحرانیِ عمل و مدتِ پیش‌بینی‌شده مرور شد' },
      { key: 'imaging', label: 'تصویربرداریِ لازم در دسترس و روی نگاتوسکوپ است' },
      { key: 'sterile', label: 'استریلیتیِ ست تأیید شد و مشکلِ تجهیزاتی گزارش نشد' },
    ],
  },
  {
    key: 'signOut', title: 'پیش از خروجِ بیمار', hint: 'پیش از بیرون‌بردنِ بیمار از اتاق.',
    items: [
      { key: 'procedure', label: 'نامِ عملِ انجام‌شده بلند گفته و ثبت شد' },
      { key: 'count', label: 'شمارشِ گاز، سوزن و ابزار درست است' },
      { key: 'specimen', label: 'نمونهٔ پاتولوژی برچسب‌دار شد (یا نمونه‌ای نبود)' },
      { key: 'equipment', label: 'مشکلِ تجهیزاتی برای پیگیری ثبت شد (یا نبود)' },
      { key: 'recovery', label: 'نکاتِ کلیدیِ ریکاوری با تیم مرور شد' },
    ],
  },
] as const;

/**
 * **وضعیتِ اتاق مشتقِ ساعت است، نه `opStatus`.**
 *
 * 🔴 در اسکرین‌شاتِ اول، عملی که ساعتِ ۷:۴۲ شروع شده بود روی تخته «در انتظار»
 * می‌نوشت — چون `opStatus` تا تسویهٔ اداریِ بعد از عمل `pending` می‌ماند. کسی
 * که داخلِ اتاق است این را غلط می‌خواند: برای او «شروع شده یا نه» همان ساعتِ
 * شروع است. `opStatus` سرِ جایش می‌ماند (لغو و بستنِ پرونده کارِ اوست)، ولی
 * برچسبی که روی تخته دیده می‌شود از ساعت می‌آید.
 */
const roomState = (v: { opStatus: string | null; opStartTime: string | null; opEndTime: string | null; opDate: Date | null; dischargeAt?: Date | null }) => {
  if (v.opStatus === 'cancelled') return { state: 'cancelled', stateFa: 'لغو' };
  /* ⚠️ ترخیص **قبل از** «تمام شد» سنجیده می‌شود و نه بعدش: بیمارِ ترخیص‌شده
     هم `opEndTime` دارد، پس ترتیبِ برعکس یعنی حالتِ ترخیص هیچ‌وقت دیده نشود.
     همان تلهٔ `finished` که یک‌بار روی `cancelled` خورده بود. */
  if (v.dischargeAt) return { state: 'discharged', stateFa: 'ترخیص شد' };
  if (v.opEndTime) return { state: 'finished', stateFa: 'در ریکاوری' };
  if (!v.opStartTime) return { state: 'waiting', stateFa: 'در انتظار' };
  /* ⚠️ **ساعتِ شروعِ آینده یعنی برنامه، نه جریان.** `opStartTime` فیلدِ حینِ عمل
     است (`INTRA_KEYS` در فرم) ولی هیچ‌چیز جلوی مطبی را نمی‌گیرد که ساعتِ
     برنامه‌ریزی‌شده را همان‌جا بنویسد — و آن‌وقت ساعتِ ۹ صبح، عملِ ۱۳:۰۰ هم
     «در جریان» می‌شد. در اولین اسکرین‌شات هر سه ردیفِ روز همین را نشان دادند. */
  const day = v.opDate ? v.opDate.toISOString().slice(0, 10) : null;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (day && day > todayIso) return { state: 'waiting', stateFa: 'در انتظار' };
  /* روزِ گذشته با شروعِ بی‌پایان «در جریان» نیست — **ناتمام** است، و همین
     برچسب کارِ کسی است که باید ببنددش. */
  if (day && day < todayIso) return { state: 'open', stateFa: 'ناتمام' };
  const nowHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (v.opStartTime > nowHHMM) return { state: 'waiting', stateFa: 'در انتظار' };
  return { state: 'running', stateFa: 'در جریان' };
};

const STAGE_KEYS = new Set(SAFETY_STAGES.map((s) => s.key as string));
const ITEM_KEYS = new Map(SAFETY_STAGES.map((s) => [s.key as string, new Set(s.items.map((i) => i.key as string))]));

/** «HH:MM» از ساعتِ همین لحظه — همان قراردادِ `Visit.opStartTime` (رشته، نه DateTime). */
const wallClock = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * **نمای اتاقِ عمل** (بستهٔ ۳ب، بازخوردِ مالک ۱۴۰۵/۰۶/۳۰: «وقتی تو اتاق عمل است
 * راحت به اطلاعاتِ لازم دسترسی داشته باشد و بتواند مدیریت کند»).
 *
 * ⚠️ **هیچ عددِ مالی این‌جا نیست و نباید بیاید** — همان قاعدهٔ `tech.service.ts`.
 * کسی که دستکش دستش است مبلغِ بیمار را نه لازم دارد نه باید ببیند؛ و اگر روزی
 * دیده شد، اشکال از این فایل است نه از رابط. سنجه‌اش در `theatre.mjs`.
 *
 * ⚠️ ماژولِ جدا (`theatre`) و نه گیتِ `dashboard`: پرستار و کارشناسِ داخلِ اتاق
 * سطحِ ۲ هستند. همان استدلالی که `frontdesk` را از `calendar` جدا کرد.
 */
@Injectable()
export class TheatreService {
  constructor(private prisma: PrismaService, private audit: AuditService, private record: RecordService) {}

  private scope(user: any) {
    return (user?.level ?? 0) >= LEVEL.SUPERVISOR ? {} : ownVisitWhere(user);
  }

  /** عمل‌های یک روز که این کاربر می‌بیند — ترتیبِ ساعتِ اتاق. */
  async day(date: string, user: any) {
    const d = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخ نامعتبر است');
    const start = new Date(d); const end = new Date(d); end.setUTCHours(23, 59, 59, 999);
    const rows = await this.prisma.visit.findMany({
      where: {
        ...this.scope(user), kind: 'surgery', opDate: { gte: start, lte: end },
        patient: { deletedAt: null },
      },
      orderBy: [{ opStartTime: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }], take: 60,
      select: {
        id: true, seq: true, opDate: true, opStartTime: true, opEndTime: true, opStatus: true, opType: true,
        dischargeAt: true, chiefComplaint: true,
        decidedIn: { select: { chiefComplaint: true } },
        hospitalName: true, surgeonName: true,
        patient: { select: { id: true, code: true, firstName: true, lastName: true } },
        hospital: { select: { name: true } },
        procedureType: { select: { name: true } },
        surgeon: { select: { person: { select: { firstName: true, lastName: true } } } },
      },
    });
    return {
      date,
      visits: rows.map((v) => ({
        id: v.id, code: `${v.patient.code}-V${v.seq}`,
        patientId: v.patient.id, patient: `${v.patient.firstName} ${v.patient.lastName}`.trim(),
        opStartTime: v.opStartTime, opEndTime: v.opEndTime, opStatus: v.opStatus,
        dischargeAt: v.dischargeAt,
        ...roomState(v),
        /* مشتق، نه کپی — همان قاعدهٔ `enrich` در `patients.service`. */
        chiefComplaint: v.chiefComplaint ?? v.decidedIn?.chiefComplaint ?? null,
        procedure: v.procedureType?.name ?? v.opType ?? null,
        hospital: v.hospital?.name ?? v.hospitalName ?? null,
        surgeon: TheatreService.personName(v.surgeon) ?? v.surgeonName ?? null,
      })),
    };
  }

  /** کارتِ حینِ عمل — هر چیزی که سرِ میز لازم است، در یک درخواست. */
  async card(visitId: number, user: any) {
    const v = await this.prisma.visit.findFirst({
      where: { id: visitId, ...this.scope(user), patient: { deletedAt: null } },
      select: {
        id: true, seq: true, kind: true, opDate: true, opStatus: true, opType: true,
        opStartTime: true, opEndTime: true, techArriveTime: true, dischargeAt: true,
        /* شکایتِ اولیه — مشتق از ویزیتِ تصمیم اگر خودِ عمل ننوشته باشدش
           (بستهٔ ۴الف). سرِ میز باید معلوم باشد بیمار **چرا** آمده. */
        chiefComplaint: true,
        decidedIn: { select: { chiefComplaint: true } },
        /* شرحِ عمل و شرحِ ترخیصِ جاری — همان سندهای پرونده، نه کپی. */
        clinicalNotes: {
          where: { kind: { in: ['op', 'discharge'] }, replacedAt: null },
          orderBy: { createdAt: 'desc' }, take: 2,
          select: { kind: true, body: true, authorName: true, createdAt: true },
        },
        hospitalName: true, surgeonName: true, surgeonInstructions: true, requiredItems: true, notes: true,
        patient: {
          select: {
            id: true, code: true, firstName: true, lastName: true, birthDate: true, gender: true,
            bloodType: true, allergies: true, chronicConditions: true, medications: true,
          },
        },
        hospital: { select: { name: true } },
        procedureType: { select: { name: true, needs: { where: { item: { active: true } }, select: { quantity: true, item: { select: { name: true, size: true } } } } } },
        surgeon: { select: { person: { select: { firstName: true, lastName: true } } } },
        tech: { select: { person: { select: { firstName: true, lastName: true } } } },
        /* ⚠️ مدارک **بیشتر** و با هر چیزی که برای بازکردنشان لازم است: تا
           دیروز فقط نامشان می‌آمد و زیرش نوشته بود «از پروندهٔ بیمار بازش
           کنید» — یعنی جراحِ وسطِ عمل باید از این صفحه بیرون می‌رفت و
           دسترسیِ بالاتری هم می‌خواست. بازخوردِ مالک صریح بود: «دسترسی به
           مدارکِ قبل و حین و بعد». */
        documents: {
          where: { deletedAt: null }, orderBy: { id: 'desc' }, take: 40,
          select: {
            id: true, title: true, fileName: true, category: true, phase: true,
            mimeType: true, externalUrl: true, createdAt: true,
          },
        },
        safetyChecks: { select: { stage: true, key: true, checkedByName: true, checkedAt: true } },
      },
    });
    if (!v) throw new NotFoundException('عمل پیدا نشد');
    const p = v.patient;
    const done = new Map(v.safetyChecks.map((c) => [`${c.stage}/${c.key}`, c]));
    return {
      visit: {
        id: v.id, code: `${p.code}-V${v.seq}`, kind: v.kind, opDate: v.opDate, opStatus: v.opStatus,
        ...roomState(v),
        procedure: v.procedureType?.name ?? v.opType ?? null,
        hospital: v.hospital?.name ?? v.hospitalName ?? null,
        surgeon: TheatreService.personName(v.surgeon) ?? v.surgeonName ?? null,
        tech: TheatreService.personName(v.tech),
        opStartTime: v.opStartTime, opEndTime: v.opEndTime, techArriveTime: v.techArriveTime,
        dischargeAt: v.dischargeAt,
        chiefComplaint: v.chiefComplaint ?? v.decidedIn?.chiefComplaint ?? null,
        opReport: v.clinicalNotes.find((n) => n.kind === 'op')?.body ?? null,
        dischargeNote: v.clinicalNotes.find((n) => n.kind === 'discharge')?.body ?? null,
        instructions: v.surgeonInstructions || null,
        notes: v.notes || null,
      },
      patient: {
        id: p.id, code: p.code, fullName: `${p.firstName} ${p.lastName}`.trim(),
        age: TheatreService.age(p.birthDate), gender: p.gender, bloodType: p.bloodType || null,
      },
      /* سه چیزی که نادیده‌گرفتنشان سرِ میز خطرِ جانی دارد — جدا برمی‌گردند تا
         رابط بتواند برجسته‌شان کند، و **همیشه** برمی‌گردند (حتی خالی) تا
         «نپرسیده‌ایم» با «نداشت» یکی نشود. */
      alerts: {
        allergies: p.allergies || null,
        chronicConditions: p.chronicConditions || null,
        medications: p.medications || null,
      },
      items: TheatreService.items(v),
      /* مرحله‌بندی‌شده و با برچسبِ فارسیِ **سرور** (قانونِ ۱۵) — رابط نباید
         نگاشتِ دومی از `pre/intra/post` داشته باشد. مدرکِ بی‌مرحله در گروهِ
         «پرونده» می‌نشیند، نه اینکه با فرضِ اشتباه «قبل از عمل» شود. */
      documents: TheatreService.docGroups(v.documents),
      /* ⚠️ همچنان برمی‌گردد با اینکه رابط دیگر نشانش نمی‌دهد: `setCheck`
         پاسخش همین کارت است و کارتِ بدونِ چک‌لیست یعنی endpointی که نتیجهٔ
         کارِ خودش را برنمی‌گرداند. بالا ↑ دلیلِ کاملِ ماندنش. */
      checklist: SAFETY_STAGES.map((s) => ({
        key: s.key, title: s.title, hint: s.hint,
        items: s.items.map((i) => {
          const hit = done.get(`${s.key}/${i.key}`);
          return { key: i.key, label: i.label, checked: !!hit, by: hit?.checkedByName ?? null, at: hit?.checkedAt ?? null };
        }),
      })),
    };
  }

  /**
   * تیک/برداشتنِ تیکِ یک بند.
   *
   * ⚠️ برداشتنِ تیک سطر را **حذف** می‌کند، نه اینکه `false` بنویسد: «تیک‌نخورده»
   * نبودِ سند است، نه سندی که می‌گوید انجام نشد. و چون کلیدِ یکتا روی
   * `(visit, stage, key)` است، دو نفر که هم‌زمان بزنند یک سطر می‌سازند نه دو تا.
   */
  async setCheck(visitId: number, stage: string, key: string, checked: boolean, user: any) {
    if (!STAGE_KEYS.has(stage)) throw new BadRequestException('مرحلهٔ چک‌لیست نامعتبر است');
    if (!ITEM_KEYS.get(stage)?.has(key)) throw new BadRequestException('بندِ چک‌لیست نامعتبر است');
    const visit = await this.prisma.visit.findFirst({ where: { id: visitId, ...this.scope(user), patient: { deletedAt: null } }, select: { id: true } });
    if (!visit) throw new NotFoundException('عمل پیدا نشد');
    if (checked) {
      await this.prisma.safetyCheck.upsert({
        where: { visitId_stage_key: { visitId, stage, key } },
        update: {},
        create: { visitId, stage, key, checkedById: user?.id ?? null, checkedByName: actorName(user) },
      });
    } else {
      await this.prisma.safetyCheck.deleteMany({ where: { visitId, stage, key } });
    }
    await this.audit.record({
      actorId: user?.id, action: checked ? 'safety.check' : 'safety.uncheck',
      entityType: 'visit', entityId: visitId, after: { stage, key },
    });
    return this.card(visitId, user);
  }

  /**
   * «شروع شد» / «پایان» — ساعتِ دیوارِ همین لحظه.
   *
   * ⚠️ ساعتِ موجود را بازنویسی نمی‌کند. سرِ عمل، دستِ دستکش‌دار دکمه را دوباره
   * می‌زند؛ اگر هر لمس ساعت را عوض می‌کرد، مدتِ عمل بی‌صدا غلط می‌شد. اصلاحِ
   * عمدیِ ساعت مسیرِ خودش را دارد (`tech/visits/:id/times`).
   */
  async stamp(visitId: number, which: 'start' | 'finish', user: any) {
    const v = await this.prisma.visit.findFirst({
      where: { id: visitId, ...this.scope(user), patient: { deletedAt: null } },
      select: { id: true, opStartTime: true, opEndTime: true, opStatus: true },
    });
    if (!v) throw new NotFoundException('عمل پیدا نشد');
    if (v.opStatus === 'cancelled') throw new BadRequestException('عملِ لغوشده ساعت نمی‌گیرد');
    if (which === 'finish' && !v.opStartTime) throw new BadRequestException('اول «شروع شد» را بزنید');
    const already = which === 'start' ? v.opStartTime : v.opEndTime;
    if (already) return this.card(visitId, user);
    await this.prisma.visit.update({
      where: { id: visitId },
      data: which === 'start'
        ? { opStartTime: wallClock(), opTimesUpdatedAt: new Date() }
        : { opEndTime: wallClock(), opTimesUpdatedAt: new Date() },
    });
    await this.audit.record({
      actorId: user?.id, action: `visit.${which}`, entityType: 'visit', entityId: visitId,
      after: { [which === 'start' ? 'opStartTime' : 'opEndTime']: wallClock() },
    });
    return this.card(visitId, user);
  }

  /**
   * **ترخیص** — مرحلهٔ سوم، بعد از «پایانِ عمل».
   *
   * بازخوردِ مالک: «با زدنِ ترخیص، توضیحِ وضعیت حینِ ترخیص باید پاپ‌آپ شه، پر
   * شه، سیو شه». پس متن **اجباری** است: ترخیصِ بی‌شرح یعنی سطری که می‌گوید
   * بیمار رفت و نمی‌گوید در چه حالی — و همان سطر بعداً سندِ پرونده می‌شود.
   *
   * ⚠️ متن `ClinicalNote(kind='discharge')` می‌شود، نه ستونی روی مراجعه:
   * همان سندی که در تبِ شرح‌های پرونده دیده و ویرایش می‌شود. یک داده، چند
   * میز — دقیقاً همان چیزی که برای شکایتِ اولیه هم خواسته شد.
   *
   * ⚠️ زدنِ دوباره **ساعت را عوض نمی‌کند** و فقط نسخهٔ تازه‌ای از شرح ثبت
   * می‌کند. همان استدلالِ `stamp`: دستِ دستکش‌دار دکمه را دوباره می‌زند.
   */
  async discharge(visitId: number, condition: string, user: any) {
    const v = await this.prisma.visit.findFirst({
      where: { id: visitId, ...this.scope(user), patient: { deletedAt: null } },
      select: { id: true, patientId: true, opStatus: true, opEndTime: true, dischargeAt: true },
    });
    if (!v) throw new NotFoundException('عمل پیدا نشد');
    if (v.opStatus === 'cancelled') throw new BadRequestException('عملِ لغوشده ترخیص نمی‌شود');
    /* ترتیب معنا دارد: ترخیصِ بیماری که عملش هنوز تمام نشده یعنی یکی از این دو
       ساعت غلط است. همان قاعدهٔ «اول شروع، بعد پایان». */
    if (!v.opEndTime) throw new BadRequestException('اول «پایانِ عمل» را ثبت کنید');
    const text = (condition ?? '').trim();
    if (!text) throw new BadRequestException('وضعیتِ بیمار هنگامِ ترخیص را بنویسید');

    await this.prisma.$transaction(async (tx) => {
      await setVisitNote(tx, v, 'discharge', text, user);
      if (!v.dischargeAt) await tx.visit.update({ where: { id: visitId }, data: { dischargeAt: new Date() } });
    });
    await this.audit.record({
      actorId: user?.id, action: v.dischargeAt ? 'visit.discharge_edit' : 'visit.discharge',
      entityType: 'visit', entityId: visitId, after: { condition: text },
    });
    return this.card(visitId, user);
  }

  /**
   * **نوشتنِ شرحِ عمل سرِ میز.**
   *
   * بازخوردِ مالک: «زدنِ شرحِ عمل» جزوِ کارهایی است که جراح داخلِ اتاق می‌کند.
   * مقصدش همان `ClinicalNote(kind='op')`ِ فرمِ مراجعه است — یک سند، دو میز.
   * اگر ستونِ جدایی می‌ساختیم، شرحی که جراح این‌جا می‌نویسد در پرونده نبود.
   */
  async setReport(visitId: number, body: string, user: any) {
    const v = await this.prisma.visit.findFirst({
      where: { id: visitId, ...this.scope(user), patient: { deletedAt: null } },
      select: { id: true, patientId: true, opStatus: true },
    });
    if (!v) throw new NotFoundException('عمل پیدا نشد');
    if (v.opStatus === 'cancelled') throw new BadRequestException('عملِ لغوشده شرح نمی‌گیرد');
    await this.prisma.$transaction((tx) => setVisitNote(tx, v, 'op', body, user));
    await this.audit.record({
      actorId: user?.id, action: 'visit.op_report', entityType: 'visit', entityId: visitId,
      after: { length: (body ?? '').trim().length },
    });
    return this.card(visitId, user);
  }

  /**
   * بازکردنِ مدرکِ **همین عمل** از میزِ اتاق.
   *
   * ⚠️ چرا مسیرِ جدا و نه همان `patients/documents/:id/file`: آن یکی پشتِ
   * `documents.read` است که سطحش از اتاقِ عمل بالاتر است. پس کارتِ عمل
   * نامِ مدرک را نشان می‌داد ولی هیچ‌کس داخلِ اتاق نمی‌توانست بازش کند —
   * دقیقاً شکایتِ مالک.
   *
   * ⚠️ دامنه دوبار بسته می‌شود: مدرک باید **به همین مراجعه** وصل باشد (نه
   * فقط به همین بیمار)، و خودِ مراجعه باید در دامنهٔ کاربر باشد. وگرنه این
   * مسیر یک دورزدنِ `documents.read` برای کلِ پرونده می‌شد.
   */
  async openDocument(visitId: number, documentId: number, user: any) {
    const v = await this.prisma.visit.findFirst({
      where: { id: visitId, ...this.scope(user), patient: { deletedAt: null } },
      select: { id: true },
    });
    if (!v) throw new NotFoundException('عمل پیدا نشد');
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, visitId, deletedAt: null }, select: { id: true },
    });
    if (!doc) throw new NotFoundException('مدرکِ این عمل پیدا نشد');
    return this.record.openDocument(documentId, user);
  }

  /** مدارک به ترتیبِ مسیرِ بیمار: قبل ← حین ← بعد، و بی‌مرحله‌ها آخر. */
  private static docGroups(docs: any[]) {
    const order = [...DOCUMENT_PHASES, null] as (string | null)[];
    return order
      .map((phase) => ({
        phase,
        label: phase ? DOCUMENT_PHASE_FA[phase] : 'بدونِ مرحله',
        items: docs.filter((d) => (d.phase ?? null) === phase).map((d) => ({
          id: d.id, title: d.title || d.fileName, category: d.category,
          /* مدرکِ لینکی فایل ندارد؛ رابط باید لینک را باز کند نه استریم را. */
          url: d.externalUrl || null,
          image: !d.externalUrl && !!d.mimeType?.startsWith('image/'),
        })),
      }))
      .filter((g) => g.items.length > 0);
  }

  private static personName(row: { person?: { firstName: string | null; lastName: string | null } | null } | null) {
    const p = row?.person;
    const name = `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim();
    return name || null;
  }

  /** ستِ لازم — اختصاصیِ بیمار اگر ثبت شده، وگرنه قالبِ نوعِ عمل. */
  private static items(v: any) {
    const custom = Array.isArray(v.requiredItems) ? v.requiredItems : null;
    if (custom?.length) return custom.map((r: any) => ({ name: r.name ?? r.itemName ?? '—', quantity: r.quantity ?? 1, notes: r.notes || null }));
    return (v.procedureType?.needs ?? []).map((n: any) => ({
      name: [n.item?.name, n.item?.size].filter(Boolean).join(' · ') || '—', quantity: n.quantity ?? 1, notes: null,
    }));
  }

  private static age(birth: Date | null) {
    if (!birth) return null;
    const years = Math.floor((Date.now() - new Date(birth).getTime()) / (365.2425 * 864e5));
    return years >= 0 && years < 130 ? years : null;
  }
}
