import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { isServiceKey } from '../config/tenant-profile';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVisitDto, UpdateVisitDto } from './dto/visit.dto';
import { randomUUID } from 'crypto';
import { jobRoleLabel, fieldRoles } from '../common/job-roles';
import { CANCEL_REASONS } from '../common/cancel-reasons';
import { syncCrew } from './crew-sync';
import { followVisitMove, staleText, StaleTransfer } from './shared-transfers';
import { serviceTitleOf, visitTitleOf } from './visit-title';
import { LEVEL } from '../common/levels';
import { ownVisitWhere, scopedPatientWhere, scopedVisitWhere as scopedVisitWhereOf } from '../common/own-scope';
import { toEnDigits } from '../common/identity';
import { foldText } from '../common/name-match';
import { digitVariants, textSearchOr } from '../common/search';
import { jalaliText, toDateValue } from '../common/jalali';
import { RemindersService } from './reminders.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../work/events.service';
import { FormsService } from './forms.service';
import { BUILTIN_VISIT_KEYS, UNDATED_KEY, VISIT_CATALOG_KEYS } from './form-presets';
import { visitMoneyMap } from './visit-money';
import { syncLinkDocuments } from './link-documents';
import {
  currentNotes, noteBody, sectionsOf, SECTION_KEYS, SECTION_NOTES, setVisitNote,
  VISIT_FULL_NOTE_KINDS, VISIT_NOTE_KINDS,
} from './clinical-note';
import { ANESTHESIA_LABELS, DECISION_LABELS, DISPOSITION_LABELS, EXCLUSIVE_DECISION, OP_LABELS } from './labels';
import { planKindPhases, planSubforms, subformDataHasValue, subformDerived, subformsOf, topicSubformItems, writeSubforms, SubformPlanItem } from './subforms';
import { vitalsRowsFor } from './vitals';
import { DOCUMENT_PHASE_FA } from './document-categories';
import { actorName } from '../common/person';
import { summarize, withPayState } from './billing.service';
import { todayRangeUtc } from '../common/clinic-day';
import {
  CODING_TWIN, CODING_TWIN_KEYS, EMPTY_CODING, OTHER_DX, OTHER_PX, assertCodingRefs, codingSearchOr, currentCoding,
  diagnosisLabel, othersCreateData, otherIds, pickCodingKeys, planCoding, principalDiagnosisTitle,
  principalProcedureName, procedureLabel, touchedAxes, twinOf, visitHasDiagnosis, visitHasProcedure,
  writeOthers,
} from './visit-coding';

/**
 * نگاشتِ نوعِ مراجعه به برچسب و رنگ — `visitKind → { title, color }`.
 *
 * ⚠️ **join سمتِ سرور، نه در render** (قانون ۱۵). وسوسه این بود که کلاینت
 * `/forms/visit-kinds` را بگیرد و خودش وصل کند، ولی آن‌وقت داشبورد و تقویم و
 * پرتالِ پزشک هرکدام نسخهٔ خودشان را می‌داشتند و یک نوع در سه صفحه سه‌جور دیده
 * می‌شد — دقیقاً همان چیزی که `KINDS`ِ هاردکد امروز می‌سازد.
 */
export type KindMap = Map<string, { title: string; color: string }>;

/**
 * غنی‌سازیِ مراجعه — قانونِ computeVisit: فیلدهای مشتق فقط این‌جا ساخته می‌شوند
 * و کلاینت هیچ فرمولی در render ندارد. همهٔ مبالغ «تومان»اند.
 */
function enrich(v: any, kinds?: KindMap, loaded: string[] = VISIT_NOTE_KINDS) {
  const k = v.kind ? kinds?.get(v.kind) : undefined;
  return {
    /* خدمتِ مراجعه در نصبِ شرکتی (`Visit.service`) — فرمِ مراجعه انتخابگرش را از همین پر می‌کند. */
    service: v.service ?? null,
    requiredItems: v.requiredItems ?? null,
    surgeonInstructions: v.surgeonInstructions ?? null,
    id: v.id,
    patientId: v.patientId,
    kind: v.kind,
    /* ⚠️ `null` وقتی این نوع فرمی ندارد (فرمش خاموش شده، یا دادهٔ واردشده از
       سامانهٔ قبلی). کلاینت آن‌وقت به برچسبِ پشتیبانِ خودش برمی‌گردد —
       «عمل» نامیدنِ یک نوعِ ناشناخته دروغ است. */
    /* نامِ فرمِ نوع؛ در شرکت اگر آن نام خودکار است، نامِ خدمتِ همین مراجعه («نورومانیتورینگ») — `visit-title.ts`. */
    kindTitle: visitTitleOf(v, k?.title),
    kindColor: k?.color ?? null,
    code: `${v.patient.code}-V${v.seq}`,
    patientCode: v.patient.code,
    firstName: v.patient.firstName,
    lastName: v.patient.lastName,
    fullName: `${v.patient.firstName} ${v.patient.lastName}`.trim(),
    phone: v.patient.phone,
    nationalId: v.patient.nationalId,
    birthDate: v.patient.birthDate,
    surgeonId: v.surgeonId,
    hospitalId: v.hospitalId,
    techId: v.techId,
    // نامِ رابطه اگر بود، وگرنه denormalized (رکوردهای قدیمی/موجودیتِ حذف‌شده)
    surgeonName: v.surgeon ? `${v.surgeon.person.firstName} ${v.surgeon.person.lastName}`.trim() : v.surgeonName,
    hospitalName: v.hospital?.name ?? v.hospitalName,
    techName: v.tech ? `${v.tech.person.firstName} ${v.tech.person.lastName}`.trim() : null,
    /* ⚠️ `procedureTypeName`/`diagnosisTitle` **همیشه اصلی**‌اند (بستهٔ ۷):
       فاکتورِ صادرشده، گزارش و بیست‌وچند خواننده روی همین معنا سوارند.
       همهٔ موارد در `procedureLabel`/`diagnosisLabel`، و شناسه‌های سایرین برای
       فرم — `undefined` وقتی رابطه خوانده نشده (نخوانده ≠ خالی؛ همان قاعدهٔ
       `sectionsOf`)، تا فرمِ بازشده از ردیفِ سبک با ذخیره پاکشان نکند. */
    procedureTypeId: v.procedureTypeId,
    procedureTypeName: principalProcedureName(v),
    otherProcedureTypeIds: otherIds(v, 'procedure'),
    procedureLabel: procedureLabel(v),
    diagnosisId: v.diagnosisId,
    otherDiagnosisIds: otherIds(v, 'diagnosis'),
    diagnosisLabel: diagnosisLabel(v),
    topicId: v.topicId,
    topicName: v.topic?.name ?? null,
    topicColor: v.topic?.color ?? null,
    diagnosisTitle: principalDiagnosisTitle(v),
    // شرحِ عمل حالا یک ClinicalNote است (نسخه‌دار و تغییرناپذیر)، ولی فرمِ مراجعه
    // همان یک فیلد را می‌بیند — تنها نسخهٔ جاری.
    /* ⚠️ `find` و نه `[0]`: از وقتی شرحِ ترخیص هم در همین آرایه می‌آید،
       اندیسِ صفر می‌تواند سندِ دیگری باشد — و آن‌وقت شرحِ ترخیص به‌جای شرحِ
       عمل در فرم می‌نشست، بی‌هیچ خطایی. */
    opReport: noteBody(v.clinicalNotes, 'op'),
    /* ── بخش‌های هستهٔ ثابت (بستهٔ ۶الف) + اسنادِ ترخیص (۶ب) ──
       فقط در نمای **کاملِ** مراجعه (`loaded`)؛ در فهرستِ سبک `undefined`
       می‌مانند و در JSON نمی‌آیند — تا فرمِ ویرایشی که از ردیفِ فهرست باز شده
       «خالی» را با «خوانده‌نشده» اشتباه نگیرد و با ذخیره پاکشان نکند. */
    ...sectionsOf(v.clinicalNotes, loaded),
    /* **ترخیص: زمان از ستون، متن از سندِ بالینی** — یک منبع برای هر دو، پس
       میزِ اتاقِ عمل و تبِ شرح‌های پرونده همان چیز را نشان می‌دهند. */
    dischargeAt: v.dischargeAt ?? null,
    dischargeNote: noteBody(v.clinicalNotes, 'discharge'),
    dischargeDisposition: v.dischargeDisposition ?? null,
    dischargeDispositionFa: v.dischargeDisposition ? DISPOSITION_LABELS[v.dischargeDisposition] ?? v.dischargeDisposition : null,
    anesthesia: v.anesthesia ?? null,
    anesthesiaFa: v.anesthesia ? ANESTHESIA_LABELS[v.anesthesia] ?? v.anesthesia : null,
    opType: v.opType,
    opDate: v.opDate,
    /* تاریخِ تقریبیِ عملِ «هنوز تاریخ ندارد» (بستهٔ ۹ب) — فقط برنامه‌ریزی، هیچ اتوماسیونی از آن نیست. */
    plannedDate: v.plannedDate ?? null,
    /* «هنوز تاریخ ندارد» مشتق است نه ستون: عملِ در انتظارِ بی‌تاریخ. فرم همین را نشان می‌دهد (قانونِ ۱۵). */
    undated: v.kind === 'surgery' && !v.opDate && v.opStatus === 'pending',
    nextVisitDate: v.nextVisitDate,
    postOpCare: v.postOpCare ?? null,
    followUpDays: v.followUpDays ?? null,
    postOpImmediate: v.postOpImmediate ?? false,
    preOpCare: v.preOpCare ?? null,
    preOpImmediate: v.preOpImmediate ?? false,
    decisions: v.decisions ?? [],
    /* برچسب همراهِ کلید — کلاینت نگاشتِ فارسیِ تصمیم ندارد (`labels.ts`). */
    decisionsFa: (v.decisions ?? []).map((d: string) => DECISION_LABELS[d] ?? d),
    /* **شکایتِ اولیه مشتق است، نه کپی** (قانونِ ۱۵). عملی که از ویزیت آمده
       شکایتِ خودش را ندارد؛ همان ویزیت را می‌خواند. پس اصلاحِ شکایت در
       ویزیت، همان لحظه در میزِ اتاقِ عمل هم دیده می‌شود — چیزی که کپیِ
       زمانِ ساخت هرگز نمی‌داد.
       `chiefComplaintOwn` برای فرم است (تا ذخیره، ارث را به کپی تبدیل نکند)
       و `chiefComplaintFrom` برای رابط، تا بتواند منبع را نشان بدهد. */
    chiefComplaint: v.chiefComplaint ?? inheritedComplaint(v)?.text ?? null,
    chiefComplaintOwn: v.chiefComplaint ?? null,
    chiefComplaintFrom: !v.chiefComplaint ? (inheritedComplaint(v)?.from ?? null) : null,
    decidedInVisitId: v.decidedInVisitId ?? null,
    followOfVisitId: v.followOfVisitId ?? null,
    opStatus: v.opStatus,
    /* برچسب همراهِ خودِ وضعیت می‌رود — قانونِ «یک وضعیت، یک برچسب»
       (`labels.ts`). داشبورد و پرونده تا دیروز نگاشتِ خودشان را داشتند و
       «تمام‌شده/کنسل» می‌نوشتند، در حالی که بقیهٔ سامانه «انجام شد/لغو». */
    opStatusFa: OP_LABELS[v.opStatus] ?? v.opStatus,
    opStartTime: v.opStartTime,
    opEndTime: v.opEndTime,
    techArriveTime: v.techArriveTime,
    cargoDueTime: v.cargoDueTime,
    opTimesUpdatedAt: v.opTimesUpdatedAt,
    // مدتِ عمل مشتق است و فقط این‌جا حساب می‌شود — هیچ render ای اجازهٔ تفریقِ
    // ساعت ندارد، وگرنه عملِ نیمه‌شب در یک جا درست و در جای دیگر منفی می‌شود.
    durationMin: durationOf(v.opStartTime, v.opEndTime),
    // جمع‌های مالی از ردیف‌ها مشتق می‌شوند (قانونِ computeVisit)؛ هیچ render ای
    // اجازهٔ جمع‌زدن ندارد و هیچ ستونِ سرجمعی در DB نیست که از واقعیت عقب بماند.
    // مدلِ «گلوبال» همین‌جا اعمال می‌شود تا کارت و فهرست همان عددِ فاکتور را ببینند.
    // «مانده / تسویه / اضافه‌پرداخت» هم از همین‌جا (`payState*`)، نه `due > 0 ? … : 'تسویه'`ِ کلاینت (DF2).
    ...withPayState(summarize(v.charges ?? [], v.payments ?? [], v)),
    pricingModel: v.pricingModel,
    globalAmount: v.globalAmount,
    notes: v.notes,
    /* ⚠️ پاسخِ فیلدهای دلخواه باید برگردد وگرنه چرخه نیمه‌کاره است: مقدار در
       دیتابیس می‌نشیند ولی هیچ صفحه‌ای نشانش نمی‌دهد و ویرایش هم خالی باز
       می‌شود. اولین نسخه دقیقاً همین را جا انداخته بود — نوشتن کار می‌کرد،
       خواندن نه، و آزمون آن را گرفت. */
    extra: v.extra ?? {},
    /* زیرفرم‌های الصاقی (۱۴۰۵/۰۷/۰۳) — فقط نمای **کامل**؛ در فهرستِ سبک `undefined`
       (نخوانده ≠ خالی — همان قاعدهٔ بخش‌های هسته)، تا فرمِ بازشده از ردیفِ فهرست با
       ذخیره چیزی را برندارد. */
    subforms: subformsOf(v),
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

/** «HH:MM» بیست‌وچهارساعته — تنها شکلِ پذیرفته‌شدهٔ ساعت. */
export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * نرمال‌سازیِ ساعتِ ورودی.
 *
 * ارقامِ فارسی/عربی و «۸:۵» را می‌پذیرد و به «08:05» تبدیل می‌کند؛ رشتهٔ خالی
 * یعنی «پاک کن». هرچیزِ دیگر خطاست — ساعتِ نامعتبر که سکوت‌وار nullشود، یعنی
 * کاربر فکر می‌کند ثبت شده و نشده.
 */
export function normalizeTime(v: unknown, label: string): string | null {
  if (v === undefined || v === null) return null;
  const raw = toEnDigits(String(v)).trim();
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(raw);
  if (!m) throw new BadRequestException(`${label} باید به شکلِ ۰۸:۳۰ باشد`);
  const out = `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}`;
  if (!TIME_RE.test(out)) throw new BadRequestException(`${label} معتبر نیست`);
  return out;
}

/**
 * مدتِ عمل به دقیقه.
 *
 * پایانِ کوچک‌تر از شروع یعنی عمل از نیمه‌شب گذشته — که در جراحیِ طولانی
 * عادی است — پس ۲۴ ساعت اضافه می‌شود، نه اینکه عددِ منفی برگردد.
 */
export function durationOf(start?: string | null, end?: string | null): number | null {
  if (!start || !end || !TIME_RE.test(start) || !TIME_RE.test(end)) return null;
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const diff = mins(end) - mins(start);
  return diff < 0 ? diff + 24 * 60 : diff;
}

/**
 * تکهٔ ساعت‌ها برای patch — فقط کلیدهایی که واقعاً آمده‌اند.
 *
 * `undefined` یعنی «دست نزن» و رشتهٔ خالی یعنی «پاک کن»؛ تفاوتشان مهم است،
 * وگرنه هر ذخیرهٔ فرم، ساعتی را که کارشناس ثبت کرده پاک می‌کند.
 */
function timePatch(dto: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  /* ⚠️ `techArriveTime` عمداً این‌جا **نیست** (W3.8/U7، تصمیمِ مالک ۱۴۰۵/۰۶/۲۶).
     ساعتِ حضور مالِ «کارشناس در آن بیمارستان در آن روز» است، نه مالِ یک بیمار،
     پس تنها نویسنده‌اش `syncVisitDuty()` است و از `hospital_duties` می‌آید.
     تا امروز از همین‌جا هم نوشته می‌شد (فرمِ مراجعه و شیتِ ساعتِ کارشناس) و
     با برنامهٔ چینش واگرا می‌شد. `whitelist`ِ ValidationPipe مقدارِ کلاینتِ
     قدیمی را بی‌صدا دور می‌ریزد، پس دیپلویِ غلتان چیزی نمی‌شکند. */
  const map = {
    opStartTime: 'ساعتِ شروع',
    opEndTime: 'ساعتِ پایان',
    cargoDueTime: 'ساعتِ تحویلِ بار',
  } as const;
  for (const [key, label] of Object.entries(map)) {
    if (dto[key] !== undefined) out[key] = normalizeTime(dto[key], label);
  }
  if (Object.keys(out).length) out.opTimesUpdatedAt = new Date();
  return out;
}

/** فهرستِ بستهٔ سورت — رشتهٔ دلخواهِ کاربر مستقیم به orderBy نمی‌رود. */
/**
 * کلیدهای سورت.
 *
 * ⚠️ `due` و `total` **مشتق‌اند و ستونِ دیتابیس ندارند**، پس ORDER BY نمی‌گیرند.
 * تا فازِ حسابداری نداشتیم عمداً حذف شده بودند (ساختنِ ستونِ ذخیره‌شده ناقضِ
 * قانونِ computeVisit بود). حالا با aggregate واقعی می‌آیند: شناسه‌ها اول
 * مرتب و صفحه‌بندی می‌شوند، بعد ردیف‌ها خوانده می‌شوند — نه اینکه کلِ جدول در
 * حافظه بیاید.
 */
export const SORTS = ['date', 'created', 'name', 'code', 'due', 'total'] as const;
/// سورت‌هایی که از جمعِ مالی می‌آیند نه از ستونِ Visit.
export const MONEY_SORTS = ['due', 'total'] as const;
export type SortKey = (typeof SORTS)[number];
export const DEFAULT_SORT: SortKey = 'date';
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
/// سقفِ خروجی — بالا ولی صریح؛ فراتر از این، گزارش کارِ ماژولِ حسابداری است.
export const EXPORT_LIMIT = 5000;

export type VisitFilter = {
  q?: string;
  status?: string;
  kind?: string;
  surgeonId?: number;
  hospitalId?: number;
  techId?: number;
  procedureTypeId?: number;
  diagnosisId?: number;
  topicId?: number;
  from?: Date;
  to?: Date;
  /// فقط مراجعاتی که هنوز بدهی دارند.
  owing?: boolean;
  /// مرحلهٔ جامانده (بازبینیِ UX، global-04/company-13): `tech` بی‌کارشناس، `report` انجام‌شدهٔ بی‌گزارش،
  /// `invoice` انجام‌شدهٔ بی‌فاکتور — همان پرسشِ صبحِ مدیرِ شرکت.
  missing?: 'tech' | 'report' | 'invoice';
  sort?: string;
  dir?: string;
  page?: number;
  pageSize?: number;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * ترتیب — همیشه با `id` به‌عنوانِ شکنندهٔ تساوی تمام می‌شود.
 *
 * بدونِ آن، دو مراجعه با تاریخِ یکسان ترتیبِ ناپایدار می‌گیرند و همان رکورد در
 * صفحهٔ ۱ و ۲ ظاهر (یا از هر دو غایب) می‌شود — باگی که فقط با صفحه‌بندی دیده می‌شود.
 */
function orderFor(sort?: string, dir?: string): any[] {
  const d: 'asc' | 'desc' = dir === 'asc' ? 'asc' : 'desc';
  const key = (SORTS as readonly string[]).includes(sort ?? '') ? (sort as SortKey) : DEFAULT_SORT;
  const tail = [{ id: d }];
  switch (key) {
    case 'created': return [{ createdAt: d }, ...tail];
    case 'name': return [{ patient: { lastName: d } }, { patient: { firstName: d } }, ...tail];
    case 'code': return [{ patient: { code: d } }, { seq: d }, ...tail];
    // مراجعهٔ بدونِ تاریخ همیشه ته فهرست، چه صعودی چه نزولی.
    default: return [{ opDate: { sort: d, nulls: 'last' } }, ...tail];
  }
}

/**
 * **شکایتِ اولیهٔ ارثی** — یک قاعده برای خواندن و نوشتن.
 *
 * عمل از ویزیتِ تصمیمش می‌خواند؛ ویزیتِ پست‌آپِ خودکار (`followOf`) از همان عمل، و
 * اگر عمل خودش شکایتی ندارد از ویزیتِ تصمیمِ آن. `inheritedComplaintText` همین ترتیب
 * را برای `ownComplaint` در ذخیره تکرار می‌کند؛ اگر این دو از هم جدا شوند، ذخیرهٔ
 * بی‌تغییرِ فرم متنِ ارثی را «شکایتِ خودش» می‌کند و ارث قطع می‌شود.
 */
function inheritedComplaint(v: any): { text: string; from: { visitId: number; seq: number; opDate: Date | null; kind: string | null } } | null {
  const src = [v?.decidedIn, v?.followOf, v?.followOf?.decidedIn]
    .find((x: any) => typeof x?.chiefComplaint === 'string' && x.chiefComplaint.trim());
  /* `kind` تا رابط بگوید «از عملِ …» یا «از ویزیتِ …» — پست‌آپ از **عمل** ارث می‌برد. */
  return src ? { text: src.chiefComplaint, from: { visitId: src.id, seq: src.seq, opDate: src.opDate, kind: src.kind ?? null } } : null;
}

// جراح و کارشناس هویتشان در Person است، پس همیشه با آن خوانده می‌شوند.
const INCLUDE_PATIENT = {
  patient: true,
  hospital: true,
  procedureType: true,
  diagnosis: true,
  topic: true,
  surgeon: { include: { person: true } },
  tech: { include: { person: true } },
  /* ویزیتی که تصمیمِ عمل در آن گرفته شد — فقط برای **مشتق‌کردنِ** شکایتِ
     اولیه. سه ستون، نه کلِ ردیف: این include روی فهرستِ ۵۰۰تایی هم می‌دود. */
  decidedIn: { select: { id: true, seq: true, opDate: true, kind: true, chiefComplaint: true } },
  /* ویزیتِ پست‌آپِ خودکار شکایتش را از **همان عمل** (یا ویزیتِ تصمیمِ آن) می‌گیرد —
     همان قاعدهٔ «مشتق نه کپی». تا ۱۴۰۵/۰۷/۰۳ این زنجیره خوانده نمی‌شد و ویزیتِ
     پست‌آپ با شکایتِ خالی باز می‌شد (بازخوردِ مالک: «پیوستگیِ اطلاعات زیرِ سؤال»). */
  followOf: {
    select: {
      id: true, seq: true, opDate: true, kind: true, chiefComplaint: true,
      decidedIn: { select: { id: true, seq: true, opDate: true, kind: true, chiefComplaint: true } },
    },
  },
  /* سایرِ تشخیص‌ها و عمل‌ها (بستهٔ ۷) — دو کوئریِ دسته‌ایِ `IN` روی فهرست و
     خروجی، هر دو ایندکس‌دار. همهٔ مسیرهای نوشتن/خواندنِ مراجعه از همین include
     می‌گذرند، پس فرم، ممیزی و فهرست همان فهرستِ کامل را می‌بینند. */
  otherDiagnoses: OTHER_DX,
  otherProcedures: OTHER_PX,
  /* فقط نسخهٔ جاریِ شرحِ عمل و شرحِ ترخیص؛ تاریخچه از مسیرِ پروندهٔ بیمار
     خوانده می‌شود. هر دو یک جنس‌اند (سندِ بالینیِ نسخه‌دار)، پس یک کوئری.
     ⚠️ `distinct` و نه `take` — توضیح در `currentNotes`. */
  clinicalNotes: currentNotes(VISIT_NOTE_KINDS),
  // فقط مبلغ لازم است؛ کلِ ردیف‌ها را برای فهرستِ ۵۰۰تایی نمی‌کشیم.
  charges: { select: { amount: true } },
  payments: { select: { amount: true } },
} as const;

/** «تصمیم»ِ تک‌انتخابیِ قالبِ قدیمیِ مطب → کلیدِ `decisions` (همان نگاشتِ مهاجرتِ `clinical_core`). */
const LEGACY_PLAN: Record<string, string> = {
  conservative: 'conservative', imaging: 'imaging', lab: 'lab', surgery: 'surgery', refer: 'referral',
};

/**
 * **نمای کاملِ یک مراجعه** — همان `INCLUDE_PATIENT` به‌اضافهٔ همهٔ بخش‌های
 * متنیِ هسته و اسنادِ ترخیص. برای `GET /visits/:id`، ذخیره و هر جایی که
 * یک مراجعه را باز می‌کند، نه فهرست.
 */
const INCLUDE_VISIT_FULL = {
  ...INCLUDE_PATIENT,
  clinicalNotes: currentNotes(VISIT_FULL_NOTE_KINDS),
  /* زیرفرم‌ها + شمارِ دادهٔ داخلی‌ها — «علائمِ حیاتی/درخواست» بی‌ردیفِ الصاق هم وقتی
     داده دارند الصاق‌شده‌اند (`subformsOf`). شمارش و نه ردیف: فرم خودش جزئیات را می‌گیرد. */
  subforms: { include: { form: { select: { title: true } } } },
  _count: { select: { vitals: true, labOrders: true, imagingOrders: true, consultOrders: true, referralOrders: true } },
  /* فقط مرحله — کارتِ علائمِ حیاتیِ هر تبِ فرمِ عمل با شمارِ همان مرحله الصاق‌شده دیده می‌شود. */
  vitals: { select: { phase: true } },
} as const;

/**
 * قاعدهٔ تأییدِ ثبت‌نامِ شرکت برای `prepareVisitCreation` — `intake.service.ts` از
 * خدمتِ همان ردیف می‌سازدش (`intake-service-of.ts`).
 */
export interface IntakeCompanyRule {
  /** ستاره‌های فرمِ عمل شل شوند (نورومانیتورینگ). */
  relaxRequired: boolean;
  /** بیمار «رزرو بدون تاریخ» زده — تاریخِ عمل اجباری نیست. */
  undated: boolean;
}

/** کلیدِ تطبیقِ نامِ خانوادگی: حروفِ یکسان‌شده، بی‌فاصله و بی‌نیم‌فاصله. */
const surnameKey = (s: string | null | undefined) => foldText(s).replace(/ /g, '');

@Injectable()
export class PatientsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private forms: FormsService,
      private reminders: RemindersService,
    private events: EventsService,
  ) {}

  /**
   * ویزیتِ پست‌آپِ خودکار — «اولین مراجعهٔ بعد از عمل» یک مراجعهٔ **مستقل**
   * است، نه فقط یک تاریخ روی کارتِ عمل: باید در داشبورد/تقویم دیده شود و
   * پرونده‌اش همان‌جا نوشته شود (خواستهٔ صریحِ محصول).
   *
   * قاعده‌ها:
   * - فقط برای عملِ لغونشدهٔ دارای nextVisitDate؛ به‌ازای هر عمل یک فرزند.
   * - تغییرِ تاریخِ ویزیتِ بعدی → تاریخِ فرزندِ pending هم جابه‌جا می‌شود؛
   *   فرزندی که done شده دست نمی‌خورد (سندِ اتفاق‌افتاده است).
   * - پاک‌شدنِ تاریخ یا لغوِ عمل → فرزندِ pending لغو می‌شود.
   * - پیامک‌ها همان مسیرِ همیشگی‌اند (یادآوریِ next_visit روی خودِ عمل)؛
   *   فرزند nextVisitDate ندارد پس یادآوریِ دوباره نمی‌کارد.
   */
  private async syncPostOpVisit(visitId: number, strict = false) {
    try {
      const v = await this.prisma.visit.findUnique({
        where: { id: visitId },
        select: {
          id: true, patientId: true, kind: true, nextVisitDate: true, opStatus: true, surgeonId: true, opDate: true,
          decidedIn: { select: { hospitalId: true } },
        },
      });
      if (!v || v.kind !== 'surgery') return;
      /* پیوستگی (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳): پزشکِ ویزیتِ پست‌آپ همان جراحِ عمل است و
         مرکزش همان‌جا که تصمیمِ عمل گرفته شد (مطب)، نه بیمارستانِ عمل. فقط جای **خالی**
         پر می‌شود — انتخابِ دستیِ منشی هرگز بازنویسی نمی‌شود. */
      const carry = { surgeonId: v.surgeonId ?? null, hospitalId: v.decidedIn?.hospitalId ?? null };
      const child = await this.prisma.visit.findFirst({
        where: { followOfVisitId: v.id }, orderBy: { id: 'asc' },
        select: { id: true, opDate: true, opStatus: true, surgeonId: true, hospitalId: true },
      });
      /* عملِ «هنوز تاریخ ندارد» (بستهٔ ۹ب) هنوز پیگیریِ پس از عمل ندارد — ویزیتِ پست‌آپش با تاریخِ قطعی می‌آید. */
      const wantDate = v.opStatus === 'cancelled' || (v.opStatus === 'pending' && !v.opDate) ? null : v.nextVisitDate;
      if (!wantDate) {
        if (child && child.opStatus === 'pending') {
          await this.prisma.visit.update({ where: { id: child.id }, data: { opStatus: 'cancelled' } });
        }
        return;
      }
      if (child) {
        if (child.opStatus === 'done') return;
        const patch: Record<string, unknown> = {};
        if (child.opDate?.getTime() !== wantDate.getTime()) patch.opDate = wantDate;
        /* زنده‌کردنِ فرزندِ لغوشده فقط وقتی «ویزیتِ بعدی»ِ عمل **دوباره** ست شده باشد — لغوِ
           دستیِ فرزند آن تاریخ را برمی‌دارد (`syncPostOpParent`)، پس بودنِ تاریخ یعنی تصمیمِ
           تازه. دلیلِ لغوِ کهنه هم پاک می‌شود، وگرنه مراجعهٔ زنده دلیلِ لغو حمل می‌کرد. */
        if (child.opStatus === 'cancelled') Object.assign(patch, { opStatus: 'pending', cancelReason: null, cancelNote: null });
        if (child.surgeonId == null && carry.surgeonId) patch.surgeonId = carry.surgeonId;
        if (child.hospitalId == null && carry.hospitalId) patch.hospitalId = carry.hospitalId;
        if (Object.keys(patch).length) {
          await this.prisma.visit.update({ where: { id: child.id }, data: patch });
        }
        return;
      }
      /* نوعِ فرمِ فرزند: ویزیتِ غیرجراحیِ همین نصب — ترجیح clinic. نصبی که
         فقط فرمِ عمل دارد فرزند نمی‌سازد (فرمی برای دیدنش نیست). */
      const defs = await this.prisma.formDef.findMany({
        where: { scope: 'visit', active: true, visitKind: { not: null } },
        select: { visitKind: true },
      });
      const nonSurgery = defs.map((d) => d.visitKind).filter((k): k is string => !!k && k !== 'surgery');
      const kind = nonSurgery.includes('clinic') ? 'clinic' : nonSurgery[0];
      if (!kind) return;
      const topic = await this.postOpTopic();
      const last = await this.prisma.visit.aggregate({ where: { patientId: v.patientId }, _max: { seq: true } });
      const made = await this.prisma.visit.create({
        data: {
          patientId: v.patientId, seq: (last._max.seq ?? 0) + 1, kind,
          opDate: wantDate, opStatus: 'pending',
          topicId: topic?.id ?? null, followOfVisitId: v.id,
          surgeonId: carry.surgeonId, hospitalId: carry.hospitalId,
        },
        select: { id: true },
      });
      /* بستهٔ ۹الف: ویزیتِ پست‌آپِ خودکار هم فرم‌های خودکارِ موضوعش را می‌گیرد (مثلِ «فرم پیگیریِ
         پس از عمل») — همان قاعدهٔ ثبتِ دستی، همان برنامه‌ریز و نویسنده. */
      const auto = await topicSubformItems(this.prisma, topic?.id, kind, await this.forms.workflow());
      if (auto.length) await writeSubforms(this.prisma, made, await this.planSubformsFor(auto, kind), null);
    } catch (e) {
      /* ثبتِ عمل نباید قربانیِ ویزیتِ خودکار شود — مثلِ قاعدهٔ یادآوری‌ها. */
      console.warn(`syncPostOpVisit(${visitId}) شکست خورد:`, e instanceof Error ? e.message : e);
      if (strict) throw e;
    }
  }

  /**
   * موضوعِ «پست‌آپ» — با کلیدِ پایدار (بستهٔ ۹الف). نصبی که پیش از مهاجرت نامش را عوض کرده و کلید
   * نگرفته، با همان قاعدهٔ نامِ دیروز — رفتارِ هیچ نصبی عوض نمی‌شود.
   */
  private async postOpTopic() {
    return (await this.prisma.visitTopic.findFirst({ where: { active: true, systemKey: 'postop' }, select: { id: true } }))
      ?? this.prisma.visitTopic.findFirst({
        where: { active: true, name: { contains: 'پست‌آپ' } }, orderBy: { id: 'asc' }, select: { id: true },
      });
  }

  private scopedVisitWhere(user: any, where: any = {}) {
    if ((user?.level ?? 0) >= LEVEL.SUPERVISOR) return { ...where };
    /* `AND` نه spread: جستجوی آزاد خودش `OR` دارد و شرطِ «خودش» هم ممکن است `OR` باشد. */
    return { AND: [where, ownVisitWhere(user)] };
  }

  async assertVisitAccess(id: number, user: any) {
    const v = await this.prisma.visit.findFirst({ where: this.scopedVisitWhere(user, { id }) });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    return v;
  }

  /**
   * لیستِ مراجعات — جستجوی آزاد + فیلترِ چندپارامتری + سورت + صفحه‌بندی.
   *
   * ⚠️ سورت و فیلتر فقط روی ستون‌های واقعیِ دیتابیس‌اند. «مانده» و «جمعِ کل»
   * مشتق‌اند (جمعِ ردیف‌های Charge/Payment) و ستونی ندارند که بشود روی آن
   * ORDER BY زد؛ ساختنِ چنین ستونی همان عددِ ذخیره‌شده‌ای است که از واقعیت عقب
   * می‌ماند و قانونِ computeVisit منعش می‌کند. سورت/فیلترِ مالی وقتی می‌آید که
   * ماژولِ حسابداری aggregate یا view واقعی بسازد.
   */
  /**
   * ساختِ شرطِ جستجو — **یک جا**، تا فهرست و خروجی هرگز از هم جدا نشوند.
   *
   * اگر خروجی شرطِ خودش را می‌ساخت، اولین فیلترِ تازه در یکی اضافه می‌شد و در
   * دیگری نه؛ کاربر «همین فهرست» را خروجی می‌گرفت و چیزِ دیگری تحویل می‌گرفت.
   */
  private visitWhere(f: VisitFilter, user?: any, clinic = false) {
    const { q, status, kind } = f;
    const where: any = {};
    if (status && status !== 'all') where.opStatus = status;
    if (kind && kind !== 'all') where.kind = kind;

    for (const key of ['surgeonId', 'hospitalId', 'techId', 'topicId'] as const) {
      if (f[key]) where[key] = f[key];
    }
    /* ⚠️ تشخیص و نوعِ عمل **در هر رتبه‌ای** (بستهٔ ۷): «بیمارانِ X» بیمارانی را
       هم می‌گیرد که X تشخیصِ دوم یا عملِ همزمانشان بوده. `AND` نه `OR`، چون
       جستجوی آزاد مالکِ `where.OR` است؛ فهرست، خروجی و آمار همه از همین تابع‌اند. */
    const and: any[] = [];
    if (f.procedureTypeId) and.push(visitHasProcedure(f.procedureTypeId));
    if (f.diagnosisId) and.push(visitHasDiagnosis(f.diagnosisId));
    /* مرحلهٔ جامانده — تعریفِ «گزارش» همان `work-detectors` است (سندِ گزارش، و **فقط در مطب** شرحِ عمل
       هم؛ DF7) و «فاکتور» سندِ فاکتورِ جاری (جایگزین‌نشده). گزارش و فاکتور فقط برای عملِ **انجام‌شده** معنا
       دارند؛ عملِ هفتهٔ بعد که هنوز گزارش ندارد «جامانده» نیست. */
    if (f.missing === 'tech') and.push({ techId: null, opStatus: { not: 'cancelled' } });
    if (f.missing === 'report') {
      and.push({
        opStatus: 'done',
        documents: { none: { category: 'report', deletedAt: null } },
        /* ⚠️ در شرکت «گزارشِ خدمت» سندی است که کارشناس بارگذاری می‌کند؛ شرحِ عملِ جراح گزارشِ شرکت نیست.
           تا دیروز این شرط برای همه بود و عملی با شرحِ عمل ولی بی‌سندِ گزارش از «بی‌گزارش» می‌افتاد و نشانش
           «رسیده» بود، در حالی که `work-detectors` همان عمل را «گزارش نرسیده» می‌دانست. */
        ...(clinic ? { clinicalNotes: { none: { kind: 'op', replacedAt: null } } } : {}),
      });
    }
    if (f.missing === 'invoice') and.push({ opStatus: 'done', invoices: { none: { supersededAt: null } } });
    if (and.length) where.AND = and;

    // بازهٔ تاریخِ عمل. «تا» شاملِ خودِ روز است — کاربری که یک تاریخ را به‌عنوان
    // پایان می‌زند انتظار دارد عمل‌های همان روز را هم ببیند.
    if (f.from || f.to) {
      where.opDate = {};
      if (f.from) where.opDate.gte = f.from;
      if (f.to) {
        const end = new Date(f.to);
        end.setHours(23, 59, 59, 999);
        where.opDate.lte = end;
      }
    }

    if (q?.trim()) {
      const t = q.trim();
      // ⚠️ کد و شماره را کاربر با ارقامِ فارسی هم تایپ می‌کند: «AM-۰۰۰۱» باید
      //    همان «AM-0001» را پیدا کند (`common/search.ts`).
      const vs = digitVariants(t);
      where.OR = [
        ...vs.flatMap((v) => [
          { patient: { firstName: { contains: v, mode: 'insensitive' } } },
          { patient: { lastName: { contains: v, mode: 'insensitive' } } },
          { patient: { code: { contains: v, mode: 'insensitive' } } },
          { patient: { phone: { contains: v } } },
          { patient: { nationalId: { contains: v } } },
          { surgeonName: { contains: v, mode: 'insensitive' } },
          { hospitalName: { contains: v, mode: 'insensitive' } },
          { surgeon: { person: { OR: [
            { firstName: { contains: v, mode: 'insensitive' } },
            { lastName: { contains: v, mode: 'insensitive' } },
          ] } } },
        ]),
        ...vs.flatMap((v) => [
          { procedureType: { name: { contains: v, mode: 'insensitive' } } },
          { diagnosis: { title: { contains: v, mode: 'insensitive' } } },
          { hospital: { name: { contains: v, mode: 'insensitive' } } },
          { opType: { contains: v, mode: 'insensitive' } },
          /* بدونِ این دو، تشخیص یا عملِ دوم هرگز با جستجو پیدا نمی‌شد. */
          ...codingSearchOr(v),
          { tech: { person: { OR: [
            { firstName: { contains: v, mode: 'insensitive' } },
            { lastName: { contains: v, mode: 'insensitive' } },
          ] } } },
        ]),
      ];
    }
    return this.scopedVisitWhere(user, { ...where, patient: { ...(where.patient ?? {}), deletedAt: null } });
  }

  async listVisits(f: VisitFilter = {}, user?: any) {
    const clinic = (await this.forms.workflow()) === 'clinic';
    const scoped = this.visitWhere(f, user, clinic);

    const pageSize = clamp(f.pageSize ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const page = Math.max(1, f.page ?? 1);
    const moneySort = (MONEY_SORTS as readonly string[]).includes(f.sort ?? '');

    // مسیرِ مالی: چون «مانده» ستون نیست، اول شناسه‌های مطابقِ فیلتر با جمعِ
    // مالی‌شان مرتب و بریده می‌شوند، بعد فقط همان صفحه از دیتابیس خوانده
    // می‌شود. مرتب‌کردنِ کلِ ردیف‌ها در حافظه با ۱۰هزار مراجعه می‌شکند.
    if (moneySort || f.owing) {
      const ids = await this.moneyOrderedIds(scoped, f);
      const total = ids.length;
      const pageIds = moneySort
        ? ids.slice((page - 1) * pageSize, page * pageSize)
        : ids.slice((page - 1) * pageSize, page * pageSize);
      const [found, stats] = await Promise.all([
        this.prisma.visit.findMany({ where: { id: { in: pageIds } }, include: INCLUDE_PATIENT }),
        this.visitStats({ ...scoped, AND: [...(scoped.AND ?? []), { id: { in: ids } }] }),
      ]);
      // ترتیبِ `IN` تضمین‌شده نیست، پس ردیف‌ها به ترتیبِ شناسه‌ها چیده می‌شوند.
      const byId = new Map(found.map((r) => [r.id, r]));
      const kinds = await this.forms.kindMap();
      return {
        /* ⚠️ `.map(enrich)`ِ خالی ننویس: `Array.map` ایندکس را به‌عنوانِ
           آرگومانِ دوم می‌فرستد و آن‌وقت یک **عدد** به‌جای نگاشتِ نوع‌ها
           می‌رسید. TypeScript گرفتش؛ در JS بی‌صدا `undefined` می‌داد. */
        rows: await this.withStages(pageIds.map((id) => byId.get(id)).filter(Boolean).map((v) => enrich(v, kinds)), clinic),
        total, page, pageSize,
        pages: Math.max(1, Math.ceil(total / pageSize)),
        sort: moneySort ? f.sort : DEFAULT_SORT,
        dir: f.dir === 'asc' ? 'asc' : 'desc',
        stats,
      };
    }

    // total جدا شمرده می‌شود چون طولِ صفحه جوابِ «چند تا هست» را نمی‌دهد.
    const [total, rows, stats] = await Promise.all([
      this.prisma.visit.count({ where: scoped }),
      this.prisma.visit.findMany({
        where: scoped,
        include: INCLUDE_PATIENT,
        orderBy: orderFor(f.sort, f.dir),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.visitStats(scoped),
    ]);

    /* یک بار برای کلِ صفحه، نه یک بار به‌ازای هر ردیف. */
    const kinds = await this.forms.kindMap();

    return {
      rows: await this.withStages(rows.map((v) => enrich(v, kinds)), clinic),
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      sort: (SORTS as readonly string[]).includes(f.sort ?? '') ? f.sort : DEFAULT_SORT,
      dir: f.dir === 'asc' ? 'asc' : 'desc',
      stats,
    };
  }

  /**
   * **نشان‌های مرحله** برای ردیف‌های یک صفحه (بازبینیِ UX، global-04/company-13): کارشناس، ساعت،
   * گزارش، فاکتور — تا مدیر بی‌بازکردنِ تک‌تکِ کارت‌ها ببیند کدام عمل چه کم دارد.
   * ⚠️ سه کوئری برای کلِ صفحه، نه N تا؛ تعریفِ «گزارش» همان `work-detectors` (سند، و فقط در مطب شرحِ عمل —
   * DF7).
   */
  private async withStages<T extends { id: number; techId?: number | null; opStartTime?: string | null; opStatus?: string | null }>(rows: T[], clinic: boolean) {
    const ids = rows.map((r) => r.id);
    if (!ids.length) return rows;
    const [docs, notes, invoices] = await Promise.all([
      this.prisma.document.findMany({ where: { visitId: { in: ids }, category: 'report', deletedAt: null }, select: { visitId: true }, distinct: ['visitId'] }),
      clinic
        ? this.prisma.clinicalNote.findMany({ where: { visitId: { in: ids }, kind: 'op', replacedAt: null }, select: { visitId: true }, distinct: ['visitId'] })
        : Promise.resolve([] as { visitId: number | null }[]),
      this.prisma.invoiceDocument.findMany({ where: { visitId: { in: ids }, supersededAt: null }, select: { visitId: true }, distinct: ['visitId'] }),
    ]);
    const reported = new Set([...docs, ...notes].map((d) => d.visitId));
    const invoiced = new Set(invoices.map((d) => d.visitId));
    /* مرحله‌ها با وضعیتِ عمل ساخته می‌شوند، نه در کلاینت (DF8، قانون ۱۵): لغوشده هیچ نشانی ندارد (کاری از آن
       نمانده)، و گزارش و فاکتور فقط پس از «انجام شد» معنا دارند — برای عملِ آینده `null` (خنثی، «پس از انجام»)
       نه `false` («ندارد») که هر عملِ هفتهٔ بعد را کهربایی و «جامانده» نشان می‌داد. همان قاعدهٔ فیلترِ «جامانده». */
    return rows.map((r) => ({
      ...r,
      stages: r.opStatus === 'cancelled' ? null : {
        tech: !!r.techId, time: !!r.opStartTime,
        report: r.opStatus === 'done' ? reported.has(r.id) : null,
        invoice: r.opStatus === 'done' ? invoiced.has(r.id) : null,
      },
    }));
  }

  /**
   * شناسه‌های مطابقِ فیلتر، مرتب‌شده بر مبنای مالی.
   *
   * جمع‌ها با دو groupBy می‌آیند (نه N کوئری) و مرتب‌سازی روی همان شناسه‌ها
   * انجام می‌شود. مراجعهٔ بدونِ قلمِ فاکتور جمعِ صفر دارد، پس از فهرست نمی‌افتد —
   * وگرنه «سورت بر مانده» بی‌سروصدا بخشی از نتیجه را حذف می‌کرد.
   */
  private async moneyOrderedIds(scoped: any, f: VisitFilter): Promise<number[]> {
    /* همان قاعدهٔ صورت‌حساب — سورت و فیلترِ «بدهکار» باید عیناً همان عددی را
       ببینند که روی کارت و فاکتور است (مدلِ گلوبال از جمله). */
    /* ⚠️ `allVisits` لازم است: سورت و صفحه‌بندی روی **همهٔ** مراجعه‌های دامنه
       انجام می‌شود و مراجعهٔ بی‌قلم هم باید در فهرست بماند — وگرنه «سورت بر
       مانده» بی‌سروصدا بخشی از نتیجه را حذف می‌کند. */
    const money = await visitMoneyMap(this.prisma, scoped, { allVisits: true });
    if (!money.size) return [];
    const ids = [...money.keys()];

    let rows = ids.map((id) => {
      const m = money.get(id)!;
      return { id, total: m.total, due: Math.max(0, m.due) };
    });
    if (f.owing) rows = rows.filter((r) => r.due > 0);

    const key = f.sort === 'total' ? 'total' : 'due';
    const asc = f.dir === 'asc';
    // شناسه tiebreaker است تا صفحه‌بندی پایدار بماند؛ بدونش ردیف‌های هم‌مبلغ
    // بین دو صفحه جابه‌جا می‌شوند و کاربر یکی را دوبار می‌بیند.
    if ((MONEY_SORTS as readonly string[]).includes(f.sort ?? '')) {
      rows.sort((a, b) => (asc ? a[key] - b[key] : b[key] - a[key]) || b.id - a.id);
    } else {
      rows.sort((a, b) => b.id - a.id);
    }
    return rows.map((r) => r.id);
  }

  /**
   * همهٔ ردیف‌های مطابقِ فیلتر — برای CSV و چاپ.
   *
   * صفحه‌بندی ندارد چون کاربر «همین فهرست» را می‌خواهد نه صفحهٔ جاری‌اش. ولی
   * بی‌سقف هم نیست: سقف صریح است و اگر خورد، `truncated` برمی‌گردد تا UI
   * بگوید — خروجیِ بی‌صدا بریده‌شده بدترین حالت است، چون کاربر آن را کامل
   * فرض می‌کند و رویش تصمیم می‌گیرد.
   */
  async exportVisits(f: VisitFilter = {}, user?: any) {
    const scoped = this.visitWhere(f, user, (await this.forms.workflow()) === 'clinic');

    // ⚠️ خروجی باید **همان** فیلتر و سورتِ فهرست را بفهمد، از جمله مالی‌ها.
    // اگر این‌جا مسیرِ مالی نمی‌آمد، CSVِ «فقط بدهکار» همهٔ مراجعات را
    // برمی‌گرداند و کاربر بدونِ هیچ هشداری فایلِ اشتباه می‌گرفت.
    if ((MONEY_SORTS as readonly string[]).includes(f.sort ?? '') || f.owing) {
      const ids = await this.moneyOrderedIds(scoped, f);
      const take = ids.slice(0, EXPORT_LIMIT);
      const found = await this.prisma.visit.findMany({ where: { id: { in: take } }, include: INCLUDE_PATIENT });
      const byId = new Map(found.map((r) => [r.id, r]));
      const kinds = await this.forms.kindMap();
      return {
        rows: take.map((id) => byId.get(id)).filter(Boolean).map((v) => enrich(v, kinds)),
        truncated: ids.length > EXPORT_LIMIT,
        limit: EXPORT_LIMIT,
        stats: await this.visitStats({ ...scoped, AND: [...(scoped.AND ?? []), { id: { in: ids } }] }),
      };
    }

    const rows = await this.prisma.visit.findMany({
      where: scoped,
      include: INCLUDE_PATIENT,
      orderBy: orderFor(f.sort, f.dir),
      take: EXPORT_LIMIT + 1,
    });
    const truncated = rows.length > EXPORT_LIMIT;
    const kinds = await this.forms.kindMap();
    return {
      rows: rows.slice(0, EXPORT_LIMIT).map((v) => enrich(v, kinds)),
      truncated,
      limit: EXPORT_LIMIT,
      stats: await this.visitStats(scoped),
    };
  }

  /**
   * آمارِ کلِ نتیجهٔ فیلترشده — نه فقط صفحهٔ جاری.
   *
   * با آمدنِ صفحه‌بندی، جمع‌زدنِ سمتِ کلاینت غلط شد: کاربر «ماندهٔ کل» را
   * می‌خواند ولی فقط ماندهٔ ۵۰ ردیفِ روی صفحه را می‌دید. پس آمار به سرور آمد.
   */
  private async visitStats(scoped: any) {
    /**
     * ⚠️ شرطِ اضافه با AND ترکیب می‌شود، نه با بازنویسیِ کلید.
     *
     * قبلاً `{ ...scoped, opStatus: 'pending' }` بود؛ وقتی کاربر روی «تمام‌شده»
     * فیلتر کرده بود، همین spread شرطِ خودش را پاک می‌کرد و آمار از کلِ
     * دیتابیس حساب می‌شد — یعنی «ماندهٔ کل» و «در انتظار»ِ روی صفحه به فیلترِ
     * وضعیت اعتنا نمی‌کردند.
     */
    const and = (extra: any) => ({ ...scoped, AND: [...(scoped.AND ?? []), extra] });
    const live = and({ opStatus: { not: 'cancelled' } });
    /* «امروز» به وقتِ مطب — یک تعریف برای کلِ سرور (`common/clinic-day.ts`). */
    const [dayStart, dayEnd] = todayRangeUtc();

    const [total, pending, today, kinds, money] = await Promise.all([
      this.prisma.visit.count({ where: scoped }),
      this.prisma.visit.count({ where: and({ opStatus: 'pending' }) }),
      this.prisma.visit.count({ where: { ...live, AND: [...live.AND, { opDate: { gte: dayStart, lte: dayEnd } }] } }),
      // نوع‌های موجود در کلِ نتیجه — نه فقط صفحهٔ جاری، وگرنه چیپِ «ویزیت» با
      // ورق‌زدن ظاهر و ناپدید می‌شود.
      this.prisma.visit.groupBy({ by: ['kind'], where: scoped, _count: { _all: true } }),
      /**
       * ⚠️ **همان قاعدهٔ صورت‌حساب، نه یک جمعِ دستی.** نسخهٔ قبلی این‌جا
       * `charge.groupBy` می‌زد و `pricingModel === 'global'` را نمی‌دید —
       * برخلافِ `moneyOrderedIds` و `summarize`. نتیجه: مراجعهٔ با **مبلغِ
       * توافقی** در کارتِ خودش ماندهٔ درست داشت ولی در «ماندهٔ کلِ» بالای
       * همان صفحه اصلاً شمرده نمی‌شد؛ و چون `groupBy` فقط مراجعه‌های دارای
       * قلم را می‌دهد، مراجعهٔ گلوبالِ بی‌قلم از تفکیکِ «طرفِ حساب» هم می‌افتاد.
       */
      visitMoneyMap(this.prisma, live),
    ]);

    /* ⚠️ کلمپ در سطحِ **مراجعه**: اضافه‌پرداختِ یک بیمار نباید بدهیِ بیمارِ
       دیگر را بپوشاند. `visitMoneyMap` عمداً خام (و منفی‌پذیر) برمی‌گرداند. */
    const dueOf = (visitId: number) => Math.max(0, money.get(visitId)?.due ?? 0);
    const due = [...money.keys()].reduce((sum, id) => sum + dueOf(id), 0);

    /**
     * ماندهٔ **به تفکیکِ طرفِ حساب**.
     *
     * «ماندهٔ کل» به‌تنهایی برای وصول بی‌فایده است: طلب از بیمار و طلب از
     * بیمارستانِ الف دو پرونده‌اند با دو تماس و دو زمان‌بندی. جمعِ سرجمعشان
     * فقط می‌گوید چقدر، نه از که.
     */
    const owing = [...money.keys()].filter((id) => dueOf(id) > 0);
    let byPayer: { key: string; label: string; due: number; count: number }[] = [];
    if (owing.length) {
      const rows = await this.prisma.visit.findMany({
        where: { id: { in: owing } },
        select: { id: true, payer: true, payerHospitalId: true, payerHospital: { select: { name: true } } },
      });
      const acc = new Map<string, { label: string; due: number; count: number }>();
      for (const v of rows) {
        const key = v.payer === 'hospital' ? `hospital:${v.payerHospitalId ?? 0}` : 'patient';
        const label = v.payer === 'hospital' ? v.payerHospital?.name ?? 'بیمارستانِ نامشخص' : 'بیمار';
        const cur = acc.get(key) ?? { label, due: 0, count: 0 };
        cur.due += dueOf(v.id);
        cur.count += 1;
        acc.set(key, cur);
      }
      byPayer = [...acc.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.due - a.due);
    }

    /* شمارِ هر نوع — کاشیِ شمارشِ «بیماران» عمل‌ها را «ویزیت» نمی‌نامد (بازبینیِ UX، clinic-daily-04). */
    const kindCounts = kinds.map((k) => ({ kind: k.kind, count: k._count._all }));
    return { total, pending, today, due, byPayer, kinds: kinds.map((k) => k.kind), kindCounts };
  }

  async getVisit(id: number, user?: any) {
    await this.assertVisitAccess(id, user);
    const v = await this.prisma.visit.findUnique({ where: { id }, include: INCLUDE_VISIT_FULL });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    const out = enrich(v, await this.forms.kindMap(), VISIT_FULL_NOTE_KINDS);
    await this.attachSubformHistory(out, user);
    return out;
  }

  /**
   * **سابقهٔ همان زیرفرم در مراجعه‌های قبلیِ همین بیمار** — «نمودارِ رشد» و «دفعهٔ قبل زخم
   * چطور بود» از همین می‌آیند. حداکثر ۱۰ نوبت، تازه‌ترین اول، فقط نوبت‌های پاسخ‌دار.
   *
   * ⚠️ با **همان دامنهٔ دیدِ کاربر** (`scopedVisitWhere`): پزشکِ زیرِ سوپروایزر فقط
   * مراجعه‌های خودش را می‌بیند، پس سابقه هم نباید از مراجعهٔ پزشکِ دیگری نشت کند.
   */
  private async attachSubformHistory(out: any, user?: any) {
    const custom = (out.subforms ?? []).filter((x: any) => !x.builtin);
    if (!custom.length) return;
    const rows = await this.prisma.visitSubform.findMany({
      where: {
        key: { in: custom.map((x: any) => x.key) }, visitId: { not: out.id },
        visit: this.scopedVisitWhere(user, { patientId: out.patientId }),
      },
      select: { key: true, data: true, visitId: true, visit: { select: { seq: true, opDate: true, createdAt: true } } },
      orderBy: { id: 'desc' },
      take: 200,
    });
    /* «سابقه» یعنی **پیش از** همین مراجعه — مراجعهٔ بعدی (مثلاً پست‌آپِ آینده) نقطهٔ
       نمودارِ رشدِ امروز نیست. مراجعهٔ بی‌تاریخ با زمانِ ساختش سنجیده می‌شود. */
    const at = (v: { opDate: Date | null; createdAt: Date }) => +(v.opDate ?? v.createdAt);
    const here = at({ opDate: out.opDate ?? null, createdAt: out.createdAt });
    for (const sf of custom) {
      sf.history = rows
        .filter((r) => r.key === sf.key && subformDataHasValue(r.data) && at(r.visit) < here)
        .map((r) => ({
          visitId: r.visitId, seq: r.visit.seq, date: r.visit.opDate ?? r.visit.createdAt,
          data: r.data, derived: subformDerived(r.data),
        }))
        .sort((a, b) => +new Date(b.date) - +new Date(a.date))
        .slice(0, 10);
    }
  }

  /**
   * «این کد ملی پرونده دارد؟» — پاسخِ **دقیق**، نه جستجوی متنی.
   *
   * ⚠️ چرا endpointِ جدا و نه `searchPatients`: آن `contains` می‌زند و تا ۲۰
   * پرونده برمی‌گرداند، و کلاینت خودش دنبالِ تطابقِ دقیق می‌گشت. یعنی برای
   * پاسخِ «بله/خیر» بیستْ پروندهٔ **دیگر** هم از سرور بیرون می‌رفت. جریانِ
   * «+ جدید» روی همین جواب شاخه می‌خورد، پس باید دقیق و کم‌هزینه باشد.
   *
   * ⚠️ `restricted`: کارشناس فقط پرونده‌هایی را می‌بیند که خودش مراجعه‌ای در
   * آن‌ها داشته. ولی قاعدهٔ «هر کد ملی یک پرونده» سراسری است — اگر به کارشناس
   * «پرونده‌ای نیست» می‌گفتیم، پروندهٔ دوم می‌ساخت و سرور با ۴۰۹ ردش می‌کرد،
   * بعد از پرکردنِ کلِ فرم. پس **وجودش** را می‌گوییم ولی **هویتش** را نه:
   * کارشناس می‌فهمد مراجعه به پروندهٔ موجود می‌چسبد، بی‌آنکه نامِ بیماری را
   * ببیند که اجازهٔ دیدنش را ندارد.
   */
  async patientByNationalId(nid?: string, user?: any) {
    const clean = toEnDigits(String(nid ?? '')).replace(/[^0-9]/g, '');
    if (clean.length !== 10) return { found: false };

    const p = await this.prisma.patient.findUnique({
      where: { nationalId: clean },
      include: { _count: { select: { visits: true } }, visits: this.lastVisitInclude(user) },
    });
    if (!p || p.deletedAt) return { found: false };

    if ((user?.level ?? 0) < LEVEL.SUPERVISOR) {
      const mine = await this.prisma.visit.count({ where: { patientId: p.id, ...ownVisitWhere(user) } });
      if (!mine) return { found: true, restricted: true };
    }
    return {
      found: true,
      restricted: false,
      patient: {
        id: p.id,
        code: p.code,
        fullName: `${p.firstName} ${p.lastName}`.trim(),
        firstName: p.firstName,
        lastName: p.lastName,
        phone: p.phone,
        nationalId: p.nationalId,
        birthDate: p.birthDate,
        visitCount: p._count.visits,
        last: PatientsService.lastOf(p.visits),
      },
    };
  }

  /**
   * **آخرین مراجعهٔ زنده** — پزشک و مرکزِ مراجعهٔ تازهٔ همین بیمار از آن پیش‌پر می‌شود
   * (بازبینیِ ۱۴۰۵/۰۷/۰۳: «پیوستگیِ اطلاعات»). با دامنهٔ دیدِ همان کاربر، تا پزشکِ زیرِ
   * سوپروایزر از مراجعهٔ همکارش چیزی نبیند. مرکز فقط از مراجعهٔ **غیرجراحی**: بیمارستانِ
   * عمل جای ویزیتِ مطب نیست.
   */
  private lastVisitInclude(user?: any) {
    return {
      where: { opStatus: { not: 'cancelled' }, ...scopedVisitWhereOf(user) },
      orderBy: { seq: 'desc' as const }, take: 1,
      select: { surgeonId: true, hospitalId: true, kind: true },
    };
  }

  private static lastOf(visits: { surgeonId: number | null; hospitalId: number | null; kind: string }[] | undefined) {
    const v = visits?.[0];
    return v ? { surgeonId: v.surgeonId ?? null, hospitalId: v.kind !== 'surgery' ? v.hospitalId ?? null : null } : null;
  }

  /// جستجوی بیمارِ موجود (برای فرمِ «مراجعهٔ مجدد»)
  async searchPatients(q?: string, user?: any) {
    const t = q?.trim();
    const where: any = t
      ? {
          OR: [
            ...textSearchOr(t, ['firstName', 'lastName', 'code']),
            { phone: { contains: toEnDigits(t) } },
            // کد ملی مطمئن‌ترین راهِ یافتنِ پروندهٔ قبلی است؛ نبودش یعنی کاربر
            // پروندهٔ موجود را پیدا نمی‌کرد و دوباره «بیمار جدید» می‌زد.
            { nationalId: { contains: toEnDigits(t) } },
          ],
        }
      : {};
    const rows = await this.prisma.patient.findMany({
      where: {
        ...where,
        deletedAt: null,
        ...scopedPatientWhere(user),
      },
      orderBy: { id: 'desc' },
      take: 20,
      include: { _count: { select: { visits: true } }, visits: this.lastVisitInclude(user) },
    });
    return rows.map((p) => ({
      id: p.id,
      code: p.code,
      fullName: `${p.firstName} ${p.lastName}`.trim(),
      phone: p.phone,
      nationalId: p.nationalId,
      visitCount: p._count.visits,
      last: PatientsService.lastOf(p.visits),
    }));
  }

  /// نامِ denormalizedِ جراح/بیمارستان + اعتبارسنجیِ وجودِ موجودیت‌ها
  private async resolveRefs(
    tx: any,
    dto: {
      surgeonId?: number | null;
      hospitalId?: number | null;
      techId?: number | null;
      procedureTypeId?: number | null;
      diagnosisId?: number | null;
      topicId?: number | null;
    },
  ) {
    const out: any = {};
    if (dto.surgeonId != null) {
      const s = await tx.surgeon.findUnique({ where: { id: dto.surgeonId }, include: { person: true } });
      if (!s) throw new NotFoundException('جراح یافت نشد');
      out.surgeonId = s.id;
      // عکسِ لحظهٔ ثبت — فقط اگر روزی جراح حذف شود خوانده می‌شود.
      out.surgeonName = `${s.person.firstName} ${s.person.lastName}`.trim();
    }
    if (dto.hospitalId != null) {
      const h = await tx.hospital.findUnique({ where: { id: dto.hospitalId } });
      if (!h) throw new NotFoundException('بیمارستان یافت نشد');
      out.hospitalId = h.id;
      out.hospitalName = h.name;
    }
    if (dto.techId != null) {
      const a = await tx.account.findUnique({ where: { id: dto.techId } });
      if (!a || a.status !== 'active') throw new NotFoundException('کارشناس یافت نشد');
      out.techId = a.id;
    }
    if (dto.procedureTypeId != null) {
      const pt = await tx.procedureType.findUnique({ where: { id: dto.procedureTypeId } });
      if (!pt) throw new NotFoundException('نوعِ عمل یافت نشد');
      out.procedureTypeId = pt.id;
      // opType آینهٔ متنیِ نوعِ عمل است تا گزارش‌های قدیمی نشکنند.
      out.opType = pt.name;
    }
    if (dto.topicId != null) {
      const tp = await tx.visitTopic.findUnique({ where: { id: dto.topicId } });
      if (!tp) throw new BadRequestException('موضوعِ ویزیت پیدا نشد');
      out.topicId = tp.id;
    }
    if (dto.diagnosisId != null) {
      const dg = await tx.diagnosis.findUnique({ where: { id: dto.diagnosisId } });
      if (!dg) throw new NotFoundException('تشخیص یافت نشد');
      out.diagnosisId = dg.id;
    }
    return out;
  }

  /**
   * نوشتنِ شرحِ عمل از فرمِ مراجعه.
   *
   * فرم یک textarea است ولی مقصد یک سندِ نسخه‌دار: متنِ تازه رکوردِ جدید می‌سازد و
   * قبلی `replacedAt` می‌گیرد، هرگز بازنویسی نمی‌شود. خالی‌کردنِ فیلد یعنی
   * «این شرح دیگر جاری نیست»، نه «هیچ‌وقت نوشته نشده بود».
   */
  /**
   * ویزیتی که تصمیمِ عمل در آن گرفته شد — با سنجشِ تعلق به **همین** بیمار.
   *
   * ⚠️ بدونِ این سنجش، هر کاربری می‌توانست عملِ بیمارِ خودش را به ویزیتِ
   * بیمارِ دیگری گره بزند و شکایتِ اولیهٔ او را در میزِ اتاقِ عمل بخواند —
   * نشتِ دادهٔ بالینی از راهی که هیچ گاردی نمی‌بیندش.
   */
  private async resolveDecidedIn(tx: any, patientId: number, visitId: number | null | undefined) {
    if (visitId == null) return null;
    const row = await tx.visit.findFirst({
      where: { id: visitId, patientId }, select: { id: true, chiefComplaint: true },
    });
    if (!row) throw new BadRequestException('ویزیتِ تصمیم برای این بیمار نیست');
    return row;
  }

  /** متنِ شکایتِ ارثیِ یک مراجعه — همان ترتیبِ `inheritedComplaint` (تصمیم، عمل، تصمیمِ عمل). */
  private static async inheritedComplaintText(tx: any, v: { id: number }) {
    const row = await tx.visit.findUnique({
      where: { id: v.id },
      select: {
        decidedIn: { select: { id: true, seq: true, opDate: true, kind: true, chiefComplaint: true } },
        followOf: {
          select: {
            id: true, seq: true, opDate: true, kind: true, chiefComplaint: true,
            decidedIn: { select: { id: true, seq: true, opDate: true, kind: true, chiefComplaint: true } },
          },
        },
      },
    });
    return inheritedComplaint(row)?.text ?? null;
  }

  /**
   * شکایتِ اولیه‌ای که باید **ذخیره** شود — نه آنچه نمایش داده می‌شود.
   *
   * ⚠️ متنی که عینِ شکایتِ ویزیتِ تصمیم است ذخیره نمی‌شود و `null` می‌ماند، تا
   * ارث‌بری زنده بماند. بدونِ این قاعده اولین «ذخیره»ی فرمِ عمل — که مقدارِ
   * مشتق را همان‌طور که گرفته پس می‌فرستد — ارث را به یک کپیِ مُرده تبدیل
   * می‌کرد و اصلاحِ بعدیِ ویزیت دیگر سرِ میز دیده نمی‌شد. قاعده عمداً سمتِ
   * سرور است نه کلاینت: سه کلاینتِ متفاوت (فرمِ داشبورد، فرمِ عمومی، تأییدِ
   * ثبت‌نام) این ستون را می‌نویسند و یکی‌شان قطعاً یادش می‌رفت.
   */
  private static ownComplaint(value: string | null | undefined, inherited: string | null | undefined) {
    const text = typeof value === 'string' ? value.trim() : null;
    if (!text) return null;
    return (inherited ?? '').trim() === text ? null : text;
  }

  /**
   * بخش‌های متنیِ هستهٔ ثابت → اسنادِ نسخه‌دار (شرحِ عمل هم یکی از همین‌هاست).
   *
   * ⚠️ فقط کلیدی که در `dto` **آمده** نوشته می‌شود: PATCHِ جزئی (مثلاً فقط
   * تاریخ) نباید معاینه را «خالی» حساب کند و نسخه‌اش را ببندد. رشتهٔ خالی
   * یعنی «این سند دیگر جاری نیست» — همان معنای `setVisitNote`.
   */
  private async setSections(tx: any, visit: { id: number; patientId: number }, dto: any, user: any, creating = false) {
    for (const key of SECTION_KEYS) {
      const v = dto?.[key];
      if (v === undefined || v === null) continue;
      if (creating && !String(v).trim()) continue;
      await setVisitNote(tx, visit, SECTION_NOTES[key], String(v), user);
    }
  }

  /**
   * **کلاینتِ قدیمی بخش‌های هسته را داخلِ `extra` می‌فرستد** — PWAِ کش‌شده تا
   * بارگذاریِ بعدی همان کدِ دیروز است. بی این تبدیل، معاینه‌ای که پس از
   * مهاجرت با کلاینتِ کهنه ذخیره شود دوباره در JSON می‌نشست و از سندِ
   * بالینی جا می‌ماند — همان دو-نسخه‌ای که مهاجرت برای حذفش آمد.
   *
   * همان قراردادِ `clinical_core`: فقط مقدارِ رشته‌ای، و `refer`ِ قالبِ قدیمی
   * همان `referral` است.
   */
  static liftLegacy(dto: any, currentDecisions: string[]) {
    const extra = dto?.extra;
    if (!extra || typeof extra !== 'object') return;
    /* کلیدهای «سایرِ تشخیص/عمل» فقط در ریشه معنا دارند و برای فیلدِ دلخواه رزروند
       (`forms.addField`)؛ نسخه‌ای که در `extra` بیاید فقط زباله‌ای است که در
       `Visit.extra` می‌نشست — و پیش‌تر سایهٔ دورزدنِ سدِ مالکیت بود. */
    for (const k of CODING_TWIN_KEYS) delete extra[k];
    for (const k of SECTION_KEYS) {
      if (typeof extra[k] !== 'string') continue;
      if (dto[k] === undefined) dto[k] = extra[k];
      delete extra[k];
    }
    if (typeof extra.anesthesia === 'string') {
      if (dto.anesthesia === undefined && ANESTHESIA_LABELS[extra.anesthesia]) dto.anesthesia = extra.anesthesia;
      delete extra.anesthesia;
    }
    const plan = typeof extra.plan === 'string' ? LEGACY_PLAN[extra.plan] : undefined;
    if (plan) {
      /* ادغام، نه جایگزینی: اگر همین درخواست `decisions` نداشت، پایه همان
         تصمیم‌های فعلیِ مراجعه است — وگرنه یک PATCHِ کهنه تصمیم‌های قبلی را
         با همین یکی بازنویسی می‌کرد. */
      dto.decisions = [...new Set([...(dto.decisions ?? currentDecisions ?? []), plan])];
      delete extra.plan;
    }
  }

  /**
   * پیداکردنِ پروندهٔ بیمار بر اساسِ کدِ ملی — قلبِ قاعدهٔ «هر کد ملی، یک پرونده».
   *
   * سه حالت:
   *  • نبود                → پروندهٔ تازه
   *  • بود و نام‌خانوادگی یکی → همان پرونده، مراجعهٔ بعدی
   *  • بود و نام‌خانوادگی فرق داشت → توقف با ۴۰۹
   *
   * حالتِ سوم عمداً خودکار حل نمی‌شود: یا کدِ ملی اشتباه تایپ شده یا واقعاً دو
   * نفرند؛ هر دو حالت تصمیمِ انسانی می‌خواهد. این همان مرحلهٔ stewardship در MPI
   * است — ادغامِ خودکارِ هویت، خطایی است که بعداً قابلِ برگرداندن نیست.
   */
  private async findByNationalId(tx: any, nationalId: string, lastName: string, isPublic = false) {
    const existing = await tx.patient.findUnique({ where: { nationalId } });
    if (!existing) return null;

    /* ⚠️ مقایسه روی **شکلِ کانونی**، نه حرف‌به‌حرف (بازبینیِ UX، بندِ ۹۸): «آزمونی فر» (فاصله)،
       «آزمونی‌فر» (نیم‌فاصله) و «آزمونيفر» (ی عربی) روی صفحه یکی دیده می‌شوند و بیمار نمی‌داند منشی
       کدام را تایپ کرده؛ تا دیروز بیمارِ قبلی با همین تفاوت رد می‌شد. همان نرمال‌سازِ `name-match`
       (ي/ی، ك/ک، نیم‌فاصله، اعراب) و بی‌فاصله — «نام کاملاً متفاوت» همچنان ۴۰۹ است. */
    const same = surnameKey(existing.lastName) === surnameKey(lastName);
    if (!same) {
      /* ⚠️ دو مخاطب، دو پیام. پیامِ ادمین نام و کدِ پرونده را می‌گوید چون
         فهرستِ بیماران جلوی چشمش است و انتخاب از آن معنی دارد. همان پیام روی
         **فرمِ عمومی** دو غلط داشت: به بیمار می‌گفت «از فهرست انتخاب کنید» —
         فهرستی که ندارد — و نامِ صاحبِ پرونده را به هر غریبه‌ای که آن کد ملی
         را تایپ کند **نشت می‌داد**. روی نصبِ واقعی دیده شد. */
      if (isPublic) {
        throw new ConflictException(
          'این کد ملی قبلاً با نامِ خانوادگیِ دیگری ثبت شده. اگر پروندهٔ قبلی دارید،' +
            ' نامِ خانوادگی را همان‌طور که پیش‌تر ثبت کرده‌اید بنویسید؛ وگرنه کد ملی را بررسی کنید.',
        );
      }
      throw new ConflictException(
        `این کد ملی به پروندهٔ «${existing.code} — ${existing.firstName} ${existing.lastName}» تعلق دارد.` +
          ' اگر همان بیمار است، از فهرست انتخابش کنید؛ وگرنه کد ملی را بررسی کنید.',
      );
    }

    // پرونده‌ای که soft-delete شده بود با مراجعهٔ جدید برمی‌گردد؛ ساختنِ پروندهٔ
    // دوم با همان کد ملی هم ممکن نیست (ایندکسِ یکتا) و هم غلط است.
    if (existing.deletedAt) {
      await tx.patient.update({
        where: { id: existing.id },
        data: { deletedAt: null, deletedById: null, deleteReason: null },
      });
      return { patient: existing, restored: true };
    }
    return { patient: existing, restored: false };
  }

  /**
   * «این آدم کدام پرونده است؟» — پیداکردن یا ساختن.
   *
   * ⚠️ **عمومی است تا ثبتِ مراجعه و فرمِ ثبت‌نامِ بیمار هر دو از همین بگذرند.**
   * کپی‌کردنش در فرمِ بیمار یعنی دو جا کدِ `AM-NNNN` تولید می‌کنند و دو تعریفِ
   * متفاوت از «همان بیمار» وجود دارد؛ اولین جایی که یکی‌شان عقب بماند، یک
   * نفر دو پرونده می‌گیرد.
   *
   * شماره و تاریخِ تولدِ تازه فقط جاهای **خالی** را پر می‌کنند: فرمی که بیمار
   * خودش پر کرده نباید دادهٔ تأییدشدهٔ پرونده را بازنویسی کند. شماره از فرمِ **عمومی**
   * اصلاً روی پروندهٔ موجود نمی‌نشیند (PS12) — فقط پروندهٔ تازه با آن ساخته می‌شود.
   */
  async resolveOrCreatePatient(
    tx: any,
    dto: { firstName?: string; lastName?: string; phone?: string; nationalId?: string; birthDate?: string },
    opts?: { public?: boolean },
  ): Promise<{ patientId: number; patientStatus: 'matched' | 'restored' | 'new' }> {
    const match = dto.nationalId
      ? await this.findByNationalId(tx, dto.nationalId, dto.lastName!, opts?.public === true)
      : null;

    if (match) {
      const fill: any = {};
      /* هشدار — **فرمِ عمومی شماره را روی پروندهٔ موجود نمی‌نشاند** (بستهٔ PS، PS12). تطبیق فقط کدِ ملی + نامِ
         خانوادگی است؛ روی پرونده‌ای که کارکنان بی‌موبایل ساخته بودند، هر کس این دو را داشت شمارهٔ خودش را
         می‌نشاند و از آن به بعد «ادامه با موبایل + کد»، یادآوری‌ها و لینک‌های همان بیمار به گوشیِ او می‌رفت.
         شمارهٔ ثبت‌نام در خودِ ثبت‌نام می‌ماند (کارهای همان ثبت‌نام با آن پیش می‌روند) و با **تأییدِ کارکنان**
         روی پرونده می‌نشیند (`IntakeService.approve`). */
      if (dto.phone && !match.patient.phone && !opts?.public) fill.phone = dto.phone;
      if (dto.birthDate && !match.patient.birthDate) fill.birthDate = toDateValue(dto.birthDate) ?? null;
      if (Object.keys(fill).length) await tx.patient.update({ where: { id: match.patient.id }, data: fill });
      return { patientId: match.patient.id, patientStatus: match.restored ? 'restored' : 'matched' };
    }

    const p = await tx.patient.create({
      data: {
        code: `AM-PENDING-${randomUUID()}`,
        firstName: dto.firstName!,
        lastName: dto.lastName!,
        phone: dto.phone || null,
        nationalId: dto.nationalId || null,
        birthDate: toDateValue(dto.birthDate) ?? null,
      },
    });
    await tx.patient.update({
      where: { id: p.id },
      data: { code: `AM-${String(p.id).padStart(4, '0')}` },
    });
    return { patientId: p.id, patientStatus: 'new' };
  }

  /**
   * قاعده‌ی اجباری‌بودنِ فرمِ همین نوعِ مراجعه را اعمال می‌کند.
   *
   * ⚠️ مقادیر از **دو جا** جمع می‌شوند: فیلدهای هسته‌ای از خودِ `dto` (چون
   * ستون‌اند) و فیلدهای دلخواه از `dto.extra`. اگر فقط یکی را می‌سنجیدیم،
   * ستاره‌ی نیمی از فرم بی‌اثر می‌شد و کاربر نمی‌فهمید چرا.
   *
   * ⚠️ اگر برای این نوع فرمی تعریف نشده باشد، `validate` بی‌صدا `ok` می‌دهد.
   * عمدی است: نصبی که فرمِ «پیگیری» ندارد نباید نتواند پیگیری ثبت کند.
   */
  /**
   * نوعِ مراجعه باید فرمی داشته باشد.
   *
   * ⚠️ پیام عمداً می‌گوید **چه باید کرد**، نه فقط «نامعتبر است»: کاربری که
   * نوعِ تازه‌ای می‌خواهد باید بداند جایش فرم‌ساز است.
   */
  private async assertKind(kind?: string) {
    const k = kind || 'surgery';
    if (await this.forms.isValidKind(k)) return;
    throw new BadRequestException(
      `نوعِ «${k}» فرمی ندارد — از فرم‌ساز برایش فرم بسازید یا نوعِ دیگری انتخاب کنید`,
    );
  }

  /**
   * @param undated «رزرو بدون تاریخ»ِ ثبت‌نام — همان یک استثنای `validateFields`
   *   روی تاریخِ عمل. نشان در `values` می‌نشیند، نه در `extra`: در `RESERVED`ِ
   *   تأیید است و دادهٔ بالینی نیست.
   */
  /**
   * @param inherited شکایتِ ارثیِ عملی که از یک ویزیت درآمده — کادرِ خالی یعنی «همان را
   *   بخوان»، پس ستارهٔ «شکایتِ اولیه» با همان متن پر است (باگِ ممیزی ۱۴۰۵/۰۷/۰۳: عملِ
   *   ارث‌گرفته با «شکایتِ اولیه را کامل کنید» ثبت نمی‌شد).
   */
  private async assertFormValid(dto: any, undated = false, inherited: string | null = null) {
    const kind = dto.kind || 'surgery';
    const values: Record<string, any> = { ...(dto.extra ?? {}), ...pickBuiltin(dto), ...(undated ? { [UNDATED_KEY]: true } : {}) };
    if (inherited && !String(values.chiefComplaint ?? '').trim()) values.chiefComplaint = inherited;
    const form = await this.forms.byKey(`visit.${kind}`).catch(() => null);
    if (!form) return;
    const waived = await this.undatedWaiver(undated);
    const r = this.forms.validateFields((await this.shownFields(form.fields)).filter((f) => !waived.has(f.key)), values);
    if (!r.ok) throw new BadRequestException(Object.values(r.errors).join('، '));
  }

  /**
   * **ستاره‌هایی که عملِ «هنوز تاریخ ندارد» برمی‌دارد** (بستهٔ ۹ب) — تاریخ همیشه؛ در مطب بیمارستان و
   * مبلغ هم: عملی که تازه تصمیمش گرفته شده هنوز جا و قیمت ندارد، و ستاره‌ای که ثبتش را ببندد بیمار را
   * از فهرستِ انتظار بیرون نگه می‌دارد. شرکت (رزرو بدون تاریخ) فقط تاریخ — قاعدهٔ دیروزش.
   */
  private async undatedWaiver(undated: boolean): Promise<Set<string>> {
    if (!undated) return new Set();
    return new Set(['opDate', ...((await this.forms.workflow()) === 'clinic' ? ['hospitalId', 'amount'] : [])]);
  }

  /**
   * فیلدهایی که فرمِ مراجعهٔ **مطب** اصلاً نشان نمی‌دهد — ستاره‌شان نباید ذخیره را ببندد.
   *
   * ⚠️ آینهٔ `isClinicCore`ِ کلاینت (اصلاحِ مالک ۱۴۰۵/۰۷/۰۲): «یافته‌ها» جایش را به باکسِ
   * مدارک داده و باکس‌های عکس/لینکِ فرم هم (همان مدارک). ستاره‌ای روی کادری که دیده
   * نمی‌شود یعنی ذخیره‌ای که با پیامی بی‌ربط رد می‌شود و کاربر راهی برای پرکردنش ندارد.
   */
  private async shownFields<T extends { key: string; builtin?: boolean; type?: string | null }>(fields: T[]): Promise<T[]> {
    if ((await this.forms.workflow()) !== 'clinic') return fields;
    /* «طرح»ِ تک‌انتخابیِ قالبِ قدیمی (`plan`) هم پنهان است — جایش کشوی تصمیم است و `liftLegacy`
       مقدارِ قدیمی‌اش را به `decisions` می‌برد؛ ستارهٔ رویش ذخیره را برای همیشه می‌بست. */
    return fields.filter((f) => !(f.builtin && f.key === 'findings')
      && !(!f.builtin && (f.type === 'image' || f.type === 'links' || f.key === 'plan')));
  }

  private async assertEditFormValid(v: any, dto: UpdateVisitDto) {
    const current = enrich(v, undefined, VISIT_FULL_NOTE_KINDS);
    const kind = dto.kind ?? v.kind;
    /* ── «هنوز تاریخ ندارد» (بستهٔ ۹ب) + رفعِ باگِ B1 ──
       عملی که از اول بی‌تاریخ ثبت شده (رزرو بدون تاریخ، موکول بی‌تاریخ، عملِ فهرستِ انتظار) بی‌تاریخ
       هم ویرایش می‌شود — تا دیروز هر ذخیره‌اش «تاریخِ عمل را کامل کنید» می‌گرفت و منشی برای
       عوض‌کردنِ یک شماره مجبور بود تاریخِ ساختگی بزند. **برداشتنِ** تاریخِ عملِ تاریخ‌دار ولی فقط با
       پرچمِ صریحِ `opDateOpen` است، نه با خالی‌شدنِ تصادفیِ کادر. */
    const ask = (dto as any).opDateOpen === true;
    const nextDate = dto.opDate !== undefined ? (toDateValue(dto.opDate) ?? null) : v.opDate;
    if (ask && kind !== 'surgery') throw new BadRequestException('فقط عمل می‌تواند «هنوز تاریخ ندارد» باشد');
    if (ask && nextDate) throw new BadRequestException('«هنوز تاریخ ندارد» با تاریخِ عمل جمع نمی‌شود — یکی را انتخاب کنید');
    /* عملِ بسته (لغو/انجام‌شده) برنامه‌ای ندارد که «هنوز تاریخ نداشته باشد». */
    if (ask && v.opStatus !== 'pending') throw new BadRequestException('عملِ لغوشده یا انجام‌شده «هنوز تاریخ ندارد» نمی‌شود');
    const undated = kind === 'surgery' && !nextDate && (ask || !v.opDate);
    let form;
    try { form = await this.forms.byKey(`visit.${kind}`); }
    catch (e) { if (e instanceof NotFoundException) return; throw e; }
    // PATCH فقط فیلدهای ارسال‌شده را می‌سنجد؛ بخشِ تکمیل‌نشدهٔ نقشِ دیگر
    // نباید تغییر تاریخ را قفل کند. مبلغ همیشه از summarize دفتر مالی می‌آید،
    // شامل تخفیف و مدل گلوبال؛ مقدار ادعایی کلاینت منبع مالی نیست.
    const keys = new Set([...Object.keys(dto), ...Object.keys(dto.extra ?? {}), 'amount']);
    const values: Record<string, any> = {
      ...current.extra, ...dto.extra, ...current, ...dto,
      amount: current.total,
    };
    /* شکایتِ خالی در ویرایش یعنی «به ارث برگرد» — مقدارِ مؤثر همان متنِ ارثی است، نه ''. */
    if (dto.chiefComplaint !== undefined && !String(dto.chiefComplaint ?? '').trim()) {
      values.chiefComplaint = inheritedComplaint(v)?.text ?? '';
    }
    if (undated) values[UNDATED_KEY] = true;
    const waived = await this.undatedWaiver(undated);
    const r = this.forms.validateFields((await this.shownFields(form.fields)).filter((f) => keys.has(f.key) && !waived.has(f.key)), values);
    if (!r.ok) throw new BadRequestException(Object.values(r.errors).join('، '));
  }

  /** «فعلاً نیاز به پیگیریِ بعدی نیست» انحصاری است — با «ویزیتِ بعدی» تناقض است. */
  private static assertDecisions(list: unknown) {
    if (!Array.isArray(list) || list.length < 2 || !list.includes(EXCLUSIVE_DECISION)) return;
    throw new BadRequestException(`«${DECISION_LABELS[EXCLUSIVE_DECISION]}» با تصمیمِ دیگری جمع نمی‌شود`);
  }

  /** ورودیِ `subforms` → برنامهٔ نوشتن؛ **بیرون از تراکنش** (تعریف‌ها کوئری‌اند). */
  private async planSubformsFor(raw: unknown, kind: string): Promise<SubformPlanItem[] | undefined> {
    if (raw === undefined || raw === null) return undefined;
    const vertical = await this.forms.workflow();
    return planSubforms(raw, {
      kind, vertical,
      defOf: (key) => this.forms.subformDef(key),
      validate: (fields, data) => this.forms.validateFields(fields, data),
      normalize: (fields, data) => (this.forms.normalizeExtra(fields as any, data as any) ?? {}) as Record<string, unknown>,
    });
  }

  /**
   * **تغییرِ نوعِ مراجعهٔ ثبت‌شده** (بازبینیِ ۱۴۰۵/۰۷/۰۳) — فقط ادمین، و نه روی زنجیره.
   *
   * ⚠️ نوع تعیین می‌کند فرم چه بخش‌هایی دارد. «ویزیت» که «عمل» شود سندهای ویزیت را بی‌کادر
   * می‌گذارد، و عملی که پست‌آپ یا ویزیتِ تصمیم دارد با تغییرِ نوع پیوندِ آن‌ها را بی‌معنی
   * می‌کند (پست‌آپ دنبالِ «عمل» است، ارثِ شکایت دنبالِ «ویزیت»). فرم انتخابگرِ نوع را در
   * ویرایش نشان نمی‌دهد؛ این سدِ دومِ همان قاعده است.
   */
  private async assertKindChange(v: any, user: any) {
    if ((user?.level ?? 0) < LEVEL.ADMIN) {
      throw new ForbiddenException('نوعِ مراجعهٔ ثبت‌شده را فقط ادمین عوض می‌کند');
    }
    const linked = v.followOfVisitId || v.decidedInVisitId
      || await this.prisma.visit.count({ where: { OR: [{ followOfVisitId: v.id }, { decidedInVisitId: v.id }] } });
    if (linked) {
      throw new BadRequestException('این مراجعه به مراجعهٔ دیگری پیوند دارد (عمل، پست‌آپ یا ویزیتِ تصمیم) و نوعش عوض نمی‌شود');
    }
  }

  /**
   * ثبتِ مراجعه.
   *
   * سه مسیر دارد و هر سه به یک پرونده ختم می‌شوند:
   *  • patientId داده شده        → مراجعهٔ جدید روی همان پرونده
   *  • کد ملی به پرونده‌ای خورد → همان پرونده (بدونِ ساختنِ پروندهٔ دوم)
   *  • هیچ‌کدام                  → پروندهٔ تازه با کدِ AM-NNNN
   *
   * خروجی `patientStatus` را حمل می‌کند تا کلاینت در toast بگوید «پروندهٔ
   * AM-0012 — مراجعهٔ ۳» و کاربر بفهمد ثبتِ دوباره پروندهٔ تکراری نساخته است.
   */
  /**
   * «هر کس قسمتِ خودش را پر کند» — اجرای واقعی (`docs/BOOKING.md` مرحلهٔ ۴).
   *
   * ⚠️ قاعده دنبالِ **نقش** است، با یک استثنای صریح: سوپرادمین همیشه بیرون
   * از قاعده است — باید یک نفر باشد که کلِ چرخه را ببیند و هر بخشی را
   * اصلاح کند. از ادمین به پایین، حسابِ نقش‌دار فقط بخشِ خودش و بخش‌های
   * عمومی را می‌نویسد؛ حسابِ بی‌نقش هیچ محدودیتی ندارد.
   *
   * ⚠️ فقط مقدارِ **تغییرکرده** رد می‌شود، نه هر کلیدِ حاضر در payload:
   * کلاینتِ قدیمی (یا فرمی که همهٔ مقادیر را echo می‌کند) نباید فقط به‌خاطرِ
   * بازفرستادنِ مقدارِ دست‌نخوردهٔ بخشِ دیگری رد شود.
   */
  private async assertRoleOwnership(
    kind: string | null | undefined,
    dto: any,
    user: any,
    current?: { extra?: any } & Record<string, any>,
  ) {
    if ((user?.level ?? 0) >= LEVEL.SUPER_ADMIN) return; // سوپرادمین: ناظرِ کلِ چرخه
    const myRole: string | null = user?.jobRole ?? null;
    if (!myRole) return; // بی‌نقش = بی‌محدودیت (رفتارِ همهٔ نصب‌های امروز)
    if (!kind) return;
    const form = await this.prisma.formDef.findFirst({
      where: { scope: 'visit', visitKind: kind },
      select: { fields: { select: { key: true, label: true, role: true, roles: true } } },
    });
    if (!form || form.fields.length === 0) return;

    /* ⚠️ آرایه با ترتیب مقایسه می‌شود: رتبهٔ تشخیص/عمل دادهٔ بالینی است، پس
       جابه‌جا کردنش هم «نوشتن» است. */
    const norm = (v: unknown) => {
      if (v === null || v === undefined) return '';
      if (v instanceof Date) return v.toISOString();
      if (Array.isArray(v)) return v.join(',');
      return String(v);
    };
    const curExtra = (current?.extra && typeof current.extra === 'object') ? current.extra as Record<string, any> : {};
    for (const f of form.fields) {
      const roles = fieldRoles(f);
      if (!roles.length || roles.includes(myRole)) continue;
      /* فهرستِ «سایرِ تشخیص‌ها/عمل‌ها» مالکِ خودش را ندارد؛ مالکش همان فیلدِ
         اصلی است (`CODING_TWIN`) — وگرنه منشی‌ای که تشخیصِ اصلی را نمی‌تواند
         عوض کند، تشخیصِ دوم را اضافه می‌کرد. */
      const twin = (CODING_TWIN as Record<string, string>)[f.key];
      for (const key of twin ? [f.key, twin] : [f.key]) {
        /* ⚠️ **هر دو جا سنجیده می‌شوند، نه یکی** (بازبینیِ بستهٔ ۷): نسخهٔ قبل
           اگر کلید در `extra` بود فقط `extra` را می‌سنجید و ریشه را نه. پس
           درخواستی با مقدارِ تازه در ریشه و یک «سایه»ی بی‌تغییر در `extra`
           (`{otherDiagnosisIds:[9], extra:{otherDiagnosisIds:null}}`) از سدِ
           مالکیت می‌گذشت، در حالی که نویسنده‌ها (`planCoding`، ستون‌ها) فقط
           ریشه را می‌خوانند — یعنی منشی کلِ کدگذاریِ پزشک را بازنویسی می‌کرد. */
        const places: [unknown, unknown][] = [];
        if (dto.extra && Object.prototype.hasOwnProperty.call(dto.extra, key)) places.push([dto.extra[key], curExtra[key]]);
        if (Object.prototype.hasOwnProperty.call(dto, key)) places.push([dto[key], current?.[key]]);
        /* در ساخت (current تهی) مقدارِ خالی مجاز است — فرم مقدارِ پیش‌فرضِ
           خالی می‌فرستد و آن «نوشتن» نیست. */
        if (places.every(([next, prev]) => norm(next) === norm(prev ?? ''))) continue;
        throw new BadRequestException(
          `«${f.label}» بخشِ ${roles.map(jobRoleLabel).join("، ")} است و با حسابِ ${jobRoleLabel(myRole)} ویرایش نمی‌شود`,
        );
      }
    }
  }

  /**
   * همان قفلِ نقشِ فیلدهای فرمِ مراجعه برای نویسنده‌ای **بیرون از فرم** (پاپ‌آپِ ترخیصِ میزِ اتاقِ
   * عمل، بستهٔ ۸) — قاعده یکی است، نه کپیِ دوم. `patch` فقط کلیدهایی که آن مسیر می‌نویسد.
   */
  async assertFieldOwnership(kind: string | null | undefined, patch: Record<string, unknown>, user: any, current: Record<string, unknown>) {
    await this.assertRoleOwnership(kind, patch, user, current);
  }

  /**
   * «این فیلد برای این حساب قفل است؟» — نامِ نقشِ صاحبش، یا null. همان پرسشِ `assertRoleOwnership`
   * (همان کوئری و همان استثناهای سوپرادمین و حسابِ بی‌نقش)، تا رابط چیزی را پیشنهاد نکند که سرور رد می‌کند.
   */
  async fieldLock(kind: string | null | undefined, key: string, user: any): Promise<string | null> {
    if ((user?.level ?? 0) >= LEVEL.SUPER_ADMIN) return null;
    const myRole: string | null = user?.jobRole ?? null;
    if (!myRole || !kind) return null;
    const form = await this.prisma.formDef.findFirst({
      where: { scope: 'visit', visitKind: kind },
      select: { fields: { where: { key }, select: { key: true, role: true, roles: true } } },
    });
    const f = form?.fields?.[0];
    const roles = f ? fieldRoles(f) : [];
    if (!roles.length || roles.includes(myRole)) return null;
    return roles.map(jobRoleLabel).join('، ');
  }

  /**
   * خدمتِ مراجعه (`Visit.service`) — فقط در نصبِ شرکتی و فقط از بستهٔ خدماتِ همان شرکت.
   *
   * `undefined` = «دست نزن»؛ در **ساخت** شرکتِ تک‌خدمته خودش پر می‌شود تا اگر فردا خدمتِ دوم
   * اضافه شد، مراجعه‌های امروز مبهم نشوند. `null`/'' = پاک کن. مطب خدمت ندارد: مقدارِ غیرِ خالی ۴۰۰.
   */
  private async visitServiceOf(input: unknown, creating: boolean): Promise<string | null | undefined> {
    const profile = await this.forms.profile();
    if (profile.kind !== 'company') {
      if (input) throw new BadRequestException('خدمتِ مراجعه فقط در نصبِ شرکتی معنا دارد');
      return input === undefined ? undefined : null;
    }
    if (input === undefined) return creating && profile.services.length === 1 ? profile.services[0] : undefined;
    if (input === null || input === '') return null;
    if (!isServiceKey(input) || !profile.services.includes(input)) throw new BadRequestException('این خدمت در بستهٔ خدماتِ شرکت نیست');
    return input;
  }

  async createVisit(dto: CreateVisitDto, user?: any, opts?: { skipFormValidation?: boolean; requirements?: any[]; intakeCompany?: IntakeCompanyRule }) {
    const create = await this.prepareVisitCreation(dto, user, opts);
    const result = await this.prisma.$transaction(create);
    await this.afterVisitCreation(result.id);
    return result;
  }

  /** اعتبارسنجی بیرون از تراکنش؛ تمامِ نوشتن‌ها با همان txِ فراخواننده. */
  async prepareVisitCreation(dto: CreateVisitDto, user?: any, opts?: { skipFormValidation?: boolean; requirements?: any[]; intakeCompany?: IntakeCompanyRule }) {
    const userId: number | undefined = user?.id;
    /* پیش از هر سنجه: کلاینتِ کهنه بخش‌های هسته را در `extra` می‌فرستد. */
    PatientsService.liftLegacy(dto, []);
    /* خدمتِ مراجعه — اولِ کار و بیرون از تراکنش: پاسخِ «این خدمت در بسته نیست» نباید پشتِ خطای فیلدها گم شود. */
    const service = await this.visitServiceOf((dto as any).service, true);
    /* تشخیص‌ها/عمل‌ها (بستهٔ ۷): برنامه **پیش از** ستاره و مالکیت، تا «اجباری»
       روی اصلیِ نهایی (پس از ارتقای اولینِ سایرین) سنجیده شود. `raw` برای
       مسیرِ «مراجعهٔ هدف» است که باید با وضعیتِ همان مراجعه دوباره برنامه‌ریزی شود. */
    const rawCoding = pickCodingKeys(dto);
    const codingPlan = planCoding(dto, EMPTY_CODING);
    const vitalsRows = vitalsRowsFor((dto as any).vitals, dto.kind || 'surgery');
    PatientsService.assertDecisions(dto.decisions);
    /* بستهٔ ۹الف — فرم‌های خودکارِ موضوع برای ثبتی که فهرستِ زیرفرم نفرستاده (میزِ پذیرش، نوبت،
       API). فرمِ مراجعه خودش فهرست را می‌فرستد — حتی خالی، وقتی کاربر آن‌ها را برداشته — و همان مقدم است. */
    let subformsIn = (dto as any).subforms;
    if (subformsIn === undefined && dto.topicId) {
      const auto = await topicSubformItems(this.prisma, dto.topicId, dto.kind || 'surgery', await this.forms.workflow());
      if (auto.length) subformsIn = auto;
    }
    const subformPlan = await this.planSubformsFor(subformsIn, dto.kind || 'surgery');
    /* «هنوز تاریخ ندارد» (بستهٔ ۹ب): فقط عمل، و با تاریخِ عمل جمع نمی‌شود. ثبت‌نامِ شرکت («رزرو
       بدون تاریخ») همان معنا را از مسیرِ خودش می‌آورد. */
    const undatedAsk = (dto as any).opDateOpen === true;
    if (undatedAsk && (dto.kind || 'surgery') !== 'surgery') throw new BadRequestException('فقط عمل می‌تواند «هنوز تاریخ ندارد» ثبت شود');
    if (undatedAsk && dto.opDate) throw new BadRequestException('«هنوز تاریخ ندارد» با تاریخِ عمل جمع نمی‌شود — یکی را انتخاب کنید');
    const undated = !!opts?.intakeCompany?.undated || undatedAsk;
    /* عملی که از ویزیت درآمده و کادرِ شکایتش خالی است: ستاره با متنِ **ارثی** سنجیده
       می‌شود. خواندنِ متن فقط برای همین سنجه است؛ تعلقِ ویزیت به بیمار داخلِ تراکنش
       (`resolveDecidedIn`) سنجیده می‌شود. */
    const inheritedCc = dto.decidedInVisitId && !String(dto.chiefComplaint ?? '').trim()
      ? (await this.prisma.visit.findUnique({ where: { id: Number(dto.decidedInVisitId) }, select: { chiefComplaint: true } }))?.chiefComplaint ?? null
      : null;
    /* ⚠️ **ستارهٔ فرم‌ساز این‌جا واقعی می‌شود.** بدونِ این خط، سوپرادمین
       فیلدی را اجباری می‌کرد، ستاره‌اش در مرورگر دیده می‌شد، و سرور مراجعه‌ی
       بی‌آن فیلد را با خوش‌رویی می‌پذیرفت — یعنی «اجباری» فقط یک نقاشی بود.
       اعتبارسنجیِ کلاینت دور زدنی است؛ این نیست. */
    await this.assertKind(dto.kind);
    /* ⚠️ «شروعِ ویزیت» از میزِ پذیرش پوسته‌ی مراجعه را می‌سازد که **بعداً**
       پر شود؛ اگر ستاره‌های فرم همین‌جا اجرا می‌شدند، پذیرش نمی‌توانست هیچ
       ویزیتی را شروع کند مگر همهٔ فیلدهای اجباریِ پزشک را هم خودش بداند —
       یعنی هرگز. ستاره‌ها در مسیرهای ثبتِ کامل (داشبورد/فرمِ عمومی) سرِ
       جایشان‌اند؛ این پرچم فقط از `startVisit` می‌آید. */
    /* ⚠️ تأییدِ ثبت‌نامِ **شرکت** (تصمیمِ مالک ۱۴۰۵/۰۷/۰۱): جراحِ تعریف‌شده برای
       هر دو خدمت الزامی است. ستاره‌های فرمِ عمل ولی **فقط در نورومانیتورینگ**
       شل می‌شوند — همان رفتارِ پیش از بستهٔ خدمات: بیمار فیلدهای کادرِ فنی را
       نمی‌داند و تأییدکننده بعداً از خودِ مراجعه کاملشان می‌کند. ایمپلنت با
       ستاره‌های کامل سنجیده می‌شود (تاریخِ عمل برای رزروِ اقلام لازم است)، و
       تنها راهِ بی‌تاریخ ماندنش همان «رزرو بدون تاریخ»ی است که بیمار صریحاً زده. */
    if (opts?.intakeCompany) {
      if (!dto.surgeonId || !await this.prisma.surgeon.findFirst({ where: { id: dto.surgeonId, active: true } })) throw new BadRequestException('جراح را از تعاریف پایه انتخاب کنید');
    }
    if (opts?.intakeCompany?.relaxRequired) {
      const form = await this.forms.forVisitKind(dto.kind || 'surgery');
      const check = this.forms.validateFields((form?.fields ?? []).map(f => ({ ...f, required: false })), { ...(dto as any).extra, ...pickBuiltin(dto) });
      if (!check.ok) throw new BadRequestException(Object.values(check.errors).join('، '));
    } else if (!opts?.skipFormValidation) await this.assertFormValid(dto, undated, inheritedCc);
    await this.assertRoleOwnership((dto as any).kind || 'surgery', dto, user);
    /* باکس‌های لینکِ فرم: نرمال‌شده می‌نشینند (URLِ معتبر، سقف، برش) و هر لینک
       مدرکِ لینکیِ همین مراجعه می‌شود — داخلِ همان تراکنش. تعریفِ فرم **پیش از**
       تراکنش خوانده می‌شود؛ داخلِ tx فقط نوشتن. */
    const formFields = (await this.forms.forVisitKind(dto.kind || 'surgery'))?.fields ?? [];
    const extraIn = await this.forms.normalizeExtra(formFields, (dto as any).extra);
    const kinds = await this.forms.kindMap();
    return async (tx: Prisma.TransactionClient, targetVisitId?: number) => {
      let patientId = dto.patientId;
      let patientStatus: 'existing' | 'matched' | 'restored' | 'new' = 'existing';
      if (patientId) {
        const p = await tx.patient.findUnique({ where: { id: patientId } });
        if (!p) throw new NotFoundException('بیمار پیدا نشد');
        // ویرایشِ ضمنیِ پرونده ممنوع است، ولی کدِ ملیِ خالی را کامل می‌کنیم.
        if (dto.nationalId && !p.nationalId) {
          await tx.patient.update({ where: { id: p.id }, data: { nationalId: dto.nationalId } });
        }
      } else {
        const r = await this.resolveOrCreatePatient(tx, dto);
        patientId = r.patientId;
        patientStatus = r.patientStatus;
      }
      // شمارهٔ مراجعه برای همین بیمار در مسیرهای هم‌زمان تکرار نشود.
      await tx.$queryRaw`SELECT id FROM patients WHERE id = ${patientId} FOR UPDATE`;
      let target: any = null;
      let targetCoding = EMPTY_CODING;
      if (targetVisitId) {
        await tx.$queryRaw`SELECT id FROM visits WHERE id = ${targetVisitId} FOR UPDATE`;
        target = await tx.visit.findFirst({
          where: { id: targetVisitId, patientId },
          /* ⚠️ به ترتیبِ **رتبه** (بازبینیِ بستهٔ ۷): رابطهٔ تو‌در‌تو بی‌`orderBy`
             ترتیبِ تصادفیِ پایگاه‌داده را می‌داد (روی جدولِ بزرگ ترتیبِ ایندکسِ
             `(visit_id, ref)`)، `writeOthers` آن را «تغییر» می‌دید و رتبه‌های
             پزشک را بی‌صدا جابه‌جا بازنویسی می‌کرد. */
          include: {
            otherDiagnoses: { orderBy: { rank: 'asc' }, select: { diagnosisId: true } },
            otherProcedures: { orderBy: { rank: 'asc' }, select: { procedureTypeId: true } },
          },
        });
        if (!target || target.opStatus === 'cancelled') throw new BadRequestException('مراجعهٔ هدف معتبر نیست یا لغو شده است');
        /* ⚠️ ادغام در مراجعهٔ **موجود**: عملِ تأییدشدهٔ پذیرش اصلیِ همان
           مراجعه می‌شود و سایرینِ ثبت‌شده‌اش می‌مانند — برنامه از `raw` و با
           وضعیتِ هدف دوباره ساخته می‌شود، نه از برنامهٔ «مراجعهٔ تازه». */
        targetCoding = currentCoding(target);
        const re = { ...rawCoding } as any;
        planCoding(re, targetCoding);
        /* ⚠️ **همهٔ** کلیدهای کدگذاری از برنامهٔ هدف — نه فقط آنچه برنامهٔ هدف
           گذاشته: برنامهٔ اول (مراجعهٔ تازه، بی‌اصلی) با «فقط سایرین» اولیِ
           سایرین را اصلی می‌کرد، و آن ماندهٔ `dto` اصلیِ هدف را عوض و همان id
           را هم اصلی و هم سایر می‌نشاند. کلیدی که برنامهٔ هدف نگذاشت یعنی «دست نزن». */
        for (const k of [...Object.keys(CODING_TWIN), ...CODING_TWIN_KEYS]) {
          if (Object.prototype.hasOwnProperty.call(re, k)) (dto as any)[k] = re[k];
          else delete (dto as any)[k];
        }
      }
      const refs = await this.resolveRefs(tx, dto);
      const decidedIn = await this.resolveDecidedIn(tx, patientId, dto.decidedInVisitId);
      const complaint = PatientsService.ownComplaint(dto.chiefComplaint, decidedIn?.chiefComplaint);
      const max = await tx.visit.aggregate({ where: { patientId }, _max: { seq: true } });
      const seq = (max._max.seq ?? 0) + 1;
      /* سایرین: وجود + فعال‌بودنِ افزوده‌های تازه؛ برای مراجعهٔ هدف نوشتن پیش از
         update تا پاسخ همان فهرستِ نهایی را داشته باشد. */
      for (const axis of touchedAxes(dto)) {
        const c = targetCoding[axis];
        await assertCodingRefs(tx, axis, twinOf(dto, axis), target ? [c.primary, ...c.others] : []);
        if (target) await writeOthers(tx, target.id, axis, twinOf(dto, axis));
      }
      const targetRequirements = target ? opts?.requirements : undefined;
      let visit = target ? await tx.visit.update({ where: { id: target.id }, data: {
        ...refs,
        ...(dto.decidedInVisitId !== undefined ? { decidedInVisitId: decidedIn?.id ?? null } : {}),
        ...(dto.chiefComplaint !== undefined ? { chiefComplaint: complaint } : {}),
        ...(targetRequirements ? { requiredItems: targetRequirements } : {}),
        ...(dto.opType !== undefined && refs.opType === undefined ? { opType: dto.opType?.trim() || null } : {}),
        ...(dto.opDate !== undefined ? { opDate: toDateValue(dto.opDate) ?? null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
        /* ادغام در مراجعهٔ موجود: فقط خدمتِ **صریح** (از تأییدِ ثبت‌نام) می‌نشیند، پیش‌فرضِ تک‌خدمتی نه. */
        ...((dto as any).service !== undefined && service !== undefined ? { service } : {}),
        ...timePatch(dto),
        extra: { ...(target.extra as any ?? {}), ...(extraIn as any ?? {}) },
      }, include: INCLUDE_PATIENT }) : await tx.visit.create({
        data: {
          ...(opts?.requirements ? { requiredItems: opts.requirements } : {}),
          patientId,
          seq,
          kind: dto.kind || 'surgery',
          ...refs,
          /* سایرِ تشخیص‌ها/عمل‌ها در همان عبارتِ ساخت (تنها نویسنده: visit-coding). */
          ...othersCreateData(codingPlan),
          // اگر نوعِ عمل انتخاب شده باشد، opType را resolveRefs گذاشته است.
          ...(refs.opType === undefined ? { opType: dto.opType?.trim() || null } : {}),
          opDate: toDateValue(dto.opDate) ?? null,
          /* تاریخِ تقریبی فقط برای عملِ بی‌تاریخ (بستهٔ ۹ب) — کنارِ تاریخِ قطعی معنایی ندارد. */
          plannedDate: dto.opDate ? null : toDateValue((dto as any).plannedDate) ?? null,
          nextVisitDate: toDateValue(dto.nextVisitDate) ?? null,
          postOpCare: dto.postOpCare?.trim() || null,
          followUpDays: dto.followUpDays?.trim() || null,
          postOpImmediate: dto.postOpImmediate ?? false,
          preOpCare: dto.preOpCare?.trim() || null,
          preOpImmediate: dto.preOpImmediate ?? false,
          decisions: dto.decisions ?? [],
          anesthesia: dto.anesthesia || null,
          ...(service !== undefined ? { service } : {}),
          chiefComplaint: complaint,
          decidedInVisitId: decidedIn?.id ?? null,
          ...timePatch(dto),
          notes: dto.notes || null,
          /* پاسخِ فیلدهای دلخواه. `{}` و نه null: ستون NOT NULL است و کدِ
             خواننده نباید مجبور باشد هر بار nullish-check بزند. */
          extra: extraIn ?? {},
          createdById: userId ?? null,
        },
        include: INCLUDE_PATIENT,
      });
      /* ساعتِ حضور از برنامهٔ چینش می‌آید، نه از فرم — و اگر کارشناسی انتخاب
         شده که آن روز در برنامهٔ آن بیمارستان نیست، همین‌جا در برنامه می‌نشیند
         (تصمیمِ مالک ۱۴۰۵/۰۶/۲۶). داخلِ همین تراکنش، تا انتساب و ردیفِ حضورش
         هرگز از هم جدا نیفتند. */
      /* کارشناسِ فرم روی تیمِ پرونده می‌نشیند و حضور/مسئولِ فعلی از تیم مشتق می‌شود (`crew-sync`). */
      /* مراجعهٔ تازهٔ بی‌کارشناس تیمی ندارد — هیچ کوئریِ اضافه در تراکنشِ ساخت (W1.4/W1.5: تک‌اتصالی، هم‌زمان). */
      if (visit.techId && await syncCrew(tx, visit.id, { tech: { source: 'form' }, times: 'op' })) {
        visit = await tx.visit.findUniqueOrThrow({ where: { id: visit.id }, include: INCLUDE_PATIENT });
      }
      await syncLinkDocuments(tx, { patientId, visitId: visit.id, fields: formFields as any, values: extraIn ?? {}, actorId: userId ?? null });
      /**
       * مبلغِ توافقی → **قلمِ خدمت**، نه ستونی روی مراجعه.
       *
       * ⚠️ همان مسیرِ تأییدِ فرمِ ثبت‌نام: جمعِ فاکتور از قلم‌ها مشتق می‌شود و
       * دو منبعِ حقیقت برای «مبلغِ این عمل» ساخته نمی‌شود. عنوانِ قلم از نوعِ
       * عمل می‌آید تا فاکتور خوانا باشد.
       *
       * ⚠️ داخلِ همین تراکنش نوشته می‌شود: مراجعه‌ای که ساخته شود ولی قلمش
       * نه، دقیقاً همان مراجعهٔ صفرتومانی است که این تغییر برای حذفش آمده.
       */
      const charge = Math.trunc(Number(dto.amount) || 0);
      const existingServices = target ? await tx.charge.aggregate({ where: { visitId: target.id, kind: 'service' }, _sum: { amount: true } }) : null;
      const existingAmount = existingServices?._sum.amount ?? 0;
      if (target && charge > 0 && existingAmount > 0 && existingAmount !== charge) throw new BadRequestException('مبلغ مراجعهٔ موجود با ثبت‌نام متفاوت است؛ ابتدا مبلغ را بررسی کنید');
      if (charge > 0 && !existingAmount) {
        /* نامِ خدمتِ شرکت جلوی نامِ عمل (بازبینیِ UX، company-14): «نورومانیتورینگ — فیوژن»، نه «فیوژن» که
           شبیهِ هزینهٔ خودِ عملِ جراح بود و کنارِ خدماتِ نوروی فاکتور معلوم نبود همان خدمت است. */
        const what = refs.opType || dto.opType?.trim() || '';
        const svc = serviceTitleOf({ kind: dto.kind || 'surgery', service });
        const title = ((svc ? [svc, what].filter(Boolean).join(' — ') : what) || 'خدمتِ ثبت‌شده').slice(0, 120);
        await tx.charge.create({
          data: {
            visitId: visit.id, kind: 'service', title,
            quantity: 1, unitPrice: charge, amount: charge, stockEffect: 'virtual',
          },
        });
      }
      /* بخش‌های متنیِ هسته (و شرحِ عمل) → اسنادِ نسخه‌دار، داخلِ همین تراکنش. */
      await this.setSections(tx, visit, dto, user, true);
      /* علائمِ حیاتیِ لحظهٔ ثبت — اختیاری؛ ردیفِ کاملاً خالی ساخته نمی‌شود. فرمِ عمل یکی به‌ازای
         هر مرحلهٔ الصاق‌شده می‌فرستد. */
      for (const row of vitalsRows) {
        await tx.vitalSign.create({
          data: {
            ...row, visitId: visit.id, patientId: visit.patientId,
            recordedById: userId ?? null, recordedByName: actorName(user),
          },
        });
      }
      /* زیرفرم‌های الصاق‌شده در همان ثبت — داخلِ همین تراکنش. */
      await writeSubforms(tx, visit, subformPlan, user);
      const full = await tx.visit.findUnique({
        where: { id: visit.id },
        select: { subforms: INCLUDE_VISIT_FULL.subforms, _count: INCLUDE_VISIT_FULL._count, vitals: INCLUDE_VISIT_FULL.vitals },
      });
      (visit as any).subforms = full?.subforms ?? [];
      (visit as any)._count = full?._count;
      (visit as any).vitals = full?.vitals ?? [];
      /* ⚠️ پاسخ همیشه نمای **کامل** است: فرم بعد از ذخیره همان شیء را نگه
         می‌دارد و ویرایشِ بعدی از رویش باز می‌شود — بخشِ خوانده‌نشده یعنی
         فرمی که معاینه را خالی نشان دهد. */
      visit.clinicalNotes = await tx.clinicalNote.findMany({
        where: { visitId: visit.id, ...currentNotes(VISIT_FULL_NOTE_KINDS).where },
        orderBy: currentNotes(VISIT_FULL_NOTE_KINDS).orderBy,
        distinct: currentNotes(VISIT_FULL_NOTE_KINDS).distinct,
      });
      const result = { ...enrich(visit, kinds, VISIT_FULL_NOTE_KINDS), patientStatus };
      await this.audit.record({ actorId: userId, action: target ? 'visit.intake_update' : 'visit.create', entityType: 'visit', entityId: visit.id, after: result }, tx);
      return result;
    };
  }

  /**
   * **زیرفرم‌های یک مراجعه، بیرون از فرمِ مراجعه** (بستهٔ ۸ — میزِ اتاقِ عمل).
   *
   * همان سه تکهٔ `update`: `planSubformsFor` (سنجش و نرمال‌سازی بیرونِ تراکنش)، `writeSubforms`
   * (یک نویسنده، «برداشتن فقط وقتی خالی است») و قفلِ نقشِ فیلدها (`assertSubformRoles` داخلِ
   * نویسنده). `phases` محدودهٔ مجازِ مسیرِ فراخواننده است — میز فقط «حینِ عمل».
   */
  async saveSubforms(visitId: number, raw: unknown, user: any, opts: { phases: string[]; via: string }) {
    const v = await this.prisma.visit.findUnique({ where: { id: visitId }, include: INCLUDE_VISIT_FULL });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    const plan = await this.planSubformsFor(raw, v.kind);
    if (!plan?.length) throw new BadRequestException('فرمی برای ثبت نیامده است');
    const bad = plan.find((it) => !opts.phases.includes(it.phase));
    if (bad) throw new BadRequestException(`از این‌جا فقط فرم‌های «${opts.phases.map((p) => DOCUMENT_PHASE_FA[p] ?? p).join('، ')}» ثبت می‌شوند`);
    const kinds = await this.forms.kindMap();
    const before = enrich(v, kinds, VISIT_FULL_NOTE_KINDS);
    const updated = await this.prisma.$transaction(async (tx) => {
      await writeSubforms(tx, { id: visitId }, plan, user);
      return tx.visit.findUniqueOrThrow({ where: { id: visitId }, include: INCLUDE_VISIT_FULL });
    });
    const after = enrich(updated, kinds, VISIT_FULL_NOTE_KINDS);
    const touched = new Set(plan.map((it) => `${it.key}@${it.phase}`));
    const pick = (x: any) => (x.subforms ?? []).filter((r: any) => touched.has(`${r.key}@${r.phase ?? ''}`));
    await this.audit.record({
      actorId: user?.id, action: 'visit.subforms', entityType: 'visit', entityId: visitId,
      before: { via: opts.via, subforms: pick(before) }, after: { via: opts.via, subforms: pick(after) },
    });
    return after;
  }

  /** فقط پس از commit؛ خطای تراکنش نباید یادآوری یا مراجعهٔ پست‌آپ بسازد. */
  async afterVisitCreation(visitId: number, strict = false) {
    await this.reminders.syncNextVisit(visitId, strict);
    await this.syncPostOpVisit(visitId, strict);
  }

  /** فقط ارجاعِ صریحِ فرزندِ یک والد با همین موعد؛ نام/موضوع ملاک نیست. */
  async appointmentTarget(tx: Prisma.TransactionClient, patientId: number | null, date: Date) {
    if (!patientId) return null;
    const children = await tx.visit.findMany({
      where: {
        patientId, opStatus: { not: 'cancelled' },
        followOf: { is: { patientId, nextVisitDate: date, opStatus: { not: 'cancelled' } } },
      },
      select: { id: true }, orderBy: { id: 'asc' }, take: 2,
    });
    if (children.length > 1) {
      throw new BadRequestException('برای این روز چند مراجعهٔ پیگیری وجود دارد؛ ابتدا موعد مراجعهٔ موردنظر را در پرونده مشخص کنید');
    }
    return children[0]?.id ?? null;
  }

  /**
   * ثبتِ ساعت‌ها بدونِ بازکردنِ کلِ فرمِ مراجعه.
   *
   * جدا از updateVisit است چون کسی که ساعت را ثبت می‌کند (کارشناسِ سرِ عمل،
   * یا پنلِ چینش) لازم نیست اجازهٔ ویرایشِ مبلغ و جراح و بیمار را داشته باشد.
   * دامنه‌اش همان scope مراجعه است: کارشناس فقط مراجعاتِ خودش.
   */
  async setTimes(id: number, dto: any, user?: any, actual = false) {
    await this.assertVisitAccess(id, user);
    const patch = timePatch(dto);
    if (!Object.keys(patch).length) throw new BadRequestException('ساعتی برای ثبت نیامده است');

    const before = await this.prisma.visit.findUnique({ where: { id }, include: INCLUDE_PATIENT });
    /* ساعتِ شروع/پایان = ورود/خروجِ تیم — هم‌زمان روی تیمِ پرونده (`crew-sync`). */
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.visit.update({ where: { id }, data: patch });
      /* `actual` = «شروع/پایان»ِ واقعیِ کارشناس (پنل)؛ وگرنه ساعتِ برنامه از داشبورد. */
      await syncCrew(tx, id, { times: actual ? 'actual' : 'op' });
      return tx.visit.findUniqueOrThrow({ where: { id }, include: INCLUDE_PATIENT });
    });
    const result = enrich(updated, await this.forms.kindMap());
    await this.audit.record({
      actorId: user?.id, action: 'visit.times', entityType: 'visit', entityId: id,
      before: { opStartTime: before?.opStartTime, opEndTime: before?.opEndTime, cargoDueTime: before?.cargoDueTime },
      after: patch,
    });
    return result;
  }

  async updateVisit(id: number, dto: UpdateVisitDto, user?: any) {
    await this.assertVisitAccess(id, user);
    const v = await this.prisma.visit.findUnique({ where: { id }, include: INCLUDE_VISIT_FULL });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    PatientsService.liftLegacy(dto, v.decisions ?? []);
    /* «هنوز تاریخ ندارد» (بستهٔ ۹ب) خودش یعنی «تاریخِ قبلی را بردار» — کلاینتی که فقط پرچم را
       می‌فرستد نباید با «پرچم و تاریخ با هم» رد شود (تاریخِ ذخیره‌شده را که خودش نفرستاده). */
    if ((dto as any).opDateOpen === true && dto.opDate === undefined) dto.opDate = null;
    /* تشخیص‌ها/عمل‌ها (بستهٔ ۷) — پیش از ستاره و مالکیت؛ کلیدِ نیامده = دست نزن. */
    const coding = currentCoding(v);
    planCoding(dto, coding);
    /* ⚠️ «مقدارِ فعلی»ِ بخش‌های هسته از اسنادِ بالینی می‌آید نه از ستون: بدونِ
       این، منشی‌ای که فرم را بی‌تغییر ذخیره می‌کند (فرم همهٔ مقادیر را پس
       می‌فرستد) با «معاینه بخشِ پزشک است» رد می‌شد — چون مقدارِ قبلی را
       `undefined` می‌دید. */
    await this.assertRoleOwnership(
      (dto as any).kind ?? v.kind, dto, user,
      {
        ...(v as any), ...sectionsOf(v.clinicalNotes, VISIT_FULL_NOTE_KINDS),
        otherDiagnosisIds: coding.diagnosis.others, otherProcedureTypeIds: coding.procedure.others,
      },
    );
    if (dto.kind !== undefined && dto.kind !== v.kind) {
      await this.assertKind(dto.kind);
      await this.assertKindChange(v, user);
      /* مالکیت روی **هر دو** فرم: بخشی که در فرمِ قبلی مالِ نقشِ دیگری بود با عوض‌کردنِ
         نوع از سدِ مالکیت نمی‌گریزد. */
      await this.assertRoleOwnership(v.kind, dto, user, {
        ...(v as any), ...sectionsOf(v.clinicalNotes, VISIT_FULL_NOTE_KINDS),
        otherDiagnosisIds: coding.diagnosis.others, otherProcedureTypeIds: coding.procedure.others,
      });
    }
    PatientsService.assertDecisions(dto.decisions);
    await this.assertEditFormValid(v, dto);
    /* باکس‌های لینک: تعریفِ فرم و نرمال‌سازی **پیش از** تراکنش — کوئریِ بیرونِ tx
       داخلِ تراکنشِ تعاملی روی PGliteِ CI (یک اتصال) قفل می‌کرد و تراکنشِ ۵ ثانیه‌ای
       منقضی می‌شد (intake-finance-roles). داخلِ tx فقط نوشتنِ مدرک‌ها می‌ماند. */
    const kindNow = dto.kind ?? v.kind ?? 'surgery';
    const servicePatch = await this.visitServiceOf((dto as any).service, false);
    const subformPlan = await this.planSubformsFor(dto.subforms, kindNow);
    /* اندازه‌گیریِ تایپ‌شده ولی «ثبت»‌نخورده — با همین ذخیره می‌نشیند (باگِ ممیزی: گم می‌شد). */
    const vitalsRows = vitalsRowsFor(dto.vitals, kindNow);
    /* تغییرِ نوع ↔ مرحلهٔ زیرفرم‌ها — پیش از تراکنش سنجیده می‌شود تا تعارض ۴۰۰ِ روشن باشد. */
    const kindPhases = dto.kind !== undefined && dto.kind !== v.kind && (dto.kind === 'surgery') !== (v.kind === 'surgery')
      ? planKindPhases(
        ((v as any).subforms ?? []).map((r: any) => ({ id: r.id, key: r.key, phase: r.phase ?? '', data: r.data, title: r.form?.title ?? null })),
        dto.kind === 'surgery',
      )
      : null;
    if (kindPhases?.conflict) {
      throw new BadRequestException(`«${kindPhases.conflict}» در بیش از یک مرحلهٔ عمل پاسخ دارد و نوعِ مراجعه عوض نمی‌شود — اول یکی را خالی کنید`);
    }
    const linkFields = dto.extra !== undefined ? ((await this.forms.forVisitKind(kindNow))?.fields ?? []) : [];
    const extraIn = dto.extra !== undefined ? await this.forms.normalizeExtra(linkFields, dto.extra) : undefined;

    const patientPatch: any = {};
    if (dto.firstName !== undefined) patientPatch.firstName = dto.firstName;
    if (dto.lastName !== undefined) patientPatch.lastName = dto.lastName;
    if (dto.phone !== undefined) patientPatch.phone = dto.phone || null;
    if (dto.nationalId !== undefined) patientPatch.nationalId = dto.nationalId || null;
    if (dto.birthDate !== undefined) patientPatch.birthDate = toDateValue(dto.birthDate) ?? null;

    let stale: StaleTransfer[] = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      const visitPatch: any = await this.resolveRefs(tx, dto);
      // null صریح یعنی «پاک کن» (SetNull + پاک‌شدنِ نامِ denormalized)
      if (dto.surgeonId === null) { visitPatch.surgeonId = null; visitPatch.surgeonName = null; }
      if (dto.hospitalId === null) { visitPatch.hospitalId = null; visitPatch.hospitalName = null; }
      if (dto.techId === null) visitPatch.techId = null;
      /* ⚠️ پاک‌کردنِ نوعِ عمل + متنِ آزاد در همان درخواست: متن می‌ماند. تا
         بستهٔ ۷ `opType` همین‌جا null می‌شد و شاخهٔ پایین (که فقط وقتی
         `visitPatch.opType` تعریف‌نشده است می‌خواند) آن را نمی‌دید. */
      if (dto.procedureTypeId === null) { visitPatch.procedureTypeId = null; visitPatch.opType = dto.opType?.trim() || null; }
      if (dto.diagnosisId === null) visitPatch.diagnosisId = null;
      if (dto.topicId === null) visitPatch.topicId = null;
      // متنِ آزاد فقط وقتی خوانده می‌شود که نوعِ عمل انتخاب نشده باشد.
      if (dto.opType !== undefined && visitPatch.opType === undefined) {
        visitPatch.opType = dto.opType?.trim() || null;
      }
      if (dto.opDate !== undefined) visitPatch.opDate = toDateValue(dto.opDate) ?? null;
      /* تاریخِ تقریبی فقط تا وقتی عمل تاریخِ قطعی ندارد معنا دارد؛ تاریخِ قطعی آن را پاک می‌کند (بستهٔ ۹ب). */
      const opDateAfter = dto.opDate !== undefined ? visitPatch.opDate : v.opDate;
      if (opDateAfter) { if (v.plannedDate) visitPatch.plannedDate = null; }
      else if ((dto as any).plannedDate !== undefined) visitPatch.plannedDate = toDateValue((dto as any).plannedDate) ?? null;
      if (dto.nextVisitDate !== undefined) visitPatch.nextVisitDate = toDateValue(dto.nextVisitDate) ?? null;
      if (dto.postOpCare !== undefined) visitPatch.postOpCare = dto.postOpCare?.trim() || null;
      if (dto.followUpDays !== undefined) visitPatch.followUpDays = dto.followUpDays?.trim() || null;
      if (dto.postOpImmediate !== undefined) visitPatch.postOpImmediate = !!dto.postOpImmediate;
      if (dto.preOpCare !== undefined) visitPatch.preOpCare = dto.preOpCare?.trim() || null;
      if (dto.preOpImmediate !== undefined) visitPatch.preOpImmediate = !!dto.preOpImmediate;
      if (dto.decisions !== undefined) visitPatch.decisions = dto.decisions ?? [];
      if (dto.anesthesia !== undefined) visitPatch.anesthesia = dto.anesthesia || null;
      if (servicePatch !== undefined) visitPatch.service = servicePatch;
      /* ⚠️ `ownComplaint` این‌جا هم لازم است و نه فقط در ساخت: فرمِ عملِ
         ارث‌گرفته مقدارِ مشتق را نشان می‌دهد، پس هر «ذخیره»ی بی‌تغییر همان
         متن را پس می‌فرستد. بدونِ این خط، دومین ذخیره ارث را کپی می‌کرد. */
      if (dto.chiefComplaint !== undefined) {
        visitPatch.chiefComplaint = PatientsService.ownComplaint(dto.chiefComplaint, await PatientsService.inheritedComplaintText(tx, v));
      }
      if (dto.kind !== undefined) visitPatch.kind = dto.kind;
      // طرفِ حساب و استثنای سهمِ جراح — فیلدهای مالیِ سبک که روی خودِ مراجعه‌اند.
      if (dto.payer !== undefined) visitPatch.payer = dto.payer;
      if (dto.payerHospitalId !== undefined) visitPatch.payerHospitalId = dto.payerHospitalId ?? null;
      if (dto.caseCost !== undefined) visitPatch.caseCost = dto.caseCost ?? null;
      if (dto.surgeonShareKind !== undefined) {
        // پاک‌کردنِ نوع، مقدار را هم پاک می‌کند؛ وگرنه عددِ یتیم می‌ماند که هیچ
        // جا خوانده نمی‌شود ولی در ویرایشِ بعدی ناگهان دوباره اعمال می‌شود.
        visitPatch.surgeonShareKind = dto.surgeonShareKind || null;
        visitPatch.surgeonShareValue = dto.surgeonShareKind ? dto.surgeonShareValue ?? null : null;
      } else if (dto.surgeonShareValue !== undefined) {
        visitPatch.surgeonShareValue = dto.surgeonShareValue ?? null;
      }
      Object.assign(visitPatch, timePatch(dto));
      if (dto.notes !== undefined) visitPatch.notes = dto.notes || null;

      /* ⚠️ **فیلدهای فرمِ سفارشی.** تا دیروز این خط نبود: `createVisit`
         مقدارِ `extra` را می‌نوشت ولی `updateVisit` بی‌سروصدا دورش می‌ریخت.
         یعنی هر ویرایشِ «شکایتِ اصلی»، «شرحِ معاینه»، «تصمیم» و هر فیلدی که
         ستون نیست، ذخیره **نمی‌شد** — همراه با پیامِ «ویزیت ویرایش شد ✓».

         و دقیقاً همان‌طور که کاربر حدس زد، به **نوعِ کسب‌وکارِ نصب** بستگی
         داشت: نصبِ نورومانیتورینگ فقط فیلدهای هسته‌ای دارد (جراح، بیمارستان،
         تاریخ، مبلغ) که ستون‌اند و ذخیره می‌شدند؛ نصبِ مطب کلِ فرمش سفارشی
         است، پس آن‌جا عملاً **هیچ‌چیز** ذخیره نمی‌شد. یک باگ، دو ظاهرِ کاملاً
         متفاوت — و همین بود که «به شرکت ربط دارد» را توضیح می‌دهد.

         ادغام می‌شود، نه جایگزین: یک PATCHِ جزئی — یا فرمی که فیلدی از آن
         حذف شده — نباید پاسخ‌های قبلی را از پرونده پاک کند. */
      if (dto.extra !== undefined) {
        visitPatch.extra = { ...((v.extra as Record<string, any>) ?? {}), ...extraIn };
        /* لینکِ تازه در فرم → مدرکِ لینکیِ پرونده؛ حذفِ لینک مدرک را پاک نمی‌کند. */
        await syncLinkDocuments(tx, { patientId: v.patientId, visitId: id, fields: linkFields as any, values: extraIn ?? {}, actorId: user?.id ?? null });
      }

      if (Object.keys(patientPatch).length) {
        await tx.patient.update({ where: { id: v.patientId }, data: patientPatch });
      }
      /* سایرِ تشخیص‌ها/عمل‌ها — فقط محوری که این PATCH به آن دست زده. */
      for (const axis of touchedAxes(dto)) {
        const c = coding[axis];
        await assertCodingRefs(tx, axis, twinOf(dto, axis), [c.primary, ...c.others]);
        await writeOthers(tx, id, axis, twinOf(dto, axis));
      }
      /* شرحِ عمل و بخش‌های هسته — هر کدام فقط اگر در این PATCH آمده باشد. */
      await this.setSections(tx, { id, patientId: v.patientId }, dto, user);
      if (kindPhases) {
        for (const d of kindPhases.drops) await tx.visitSubform.delete({ where: { id: d } });
        for (const m of kindPhases.moves) await tx.visitSubform.update({ where: { id: m.id }, data: { phase: m.phase } });
        /* ویزیت → عمل: اندازه‌های بی‌مرحله «قبل از عمل» می‌شوند تا در تبِ همان مرحله دیده شوند. */
        if (dto.kind === 'surgery') await tx.vitalSign.updateMany({ where: { visitId: id, phase: null }, data: { phase: 'pre' } });
      }
      for (const row of vitalsRows) {
        await tx.vitalSign.create({
          data: { ...row, visitId: id, patientId: v.patientId, recordedById: user?.id ?? null, recordedByName: actorName(user) },
        });
      }
      await writeSubforms(tx, { id }, subformPlan, user);
      /* ساعتِ حضور مشتقِ برنامهٔ چینش است (W3.8/U7): با مقادیرِ **نهایی** پس از
         این ویرایش سنجیده می‌شود، نه با مقادیرِ قبلی — وگرنه تغییرِ بیمارستان یا
         تاریخ در همین ویرایش، ردیفِ حضورِ روزِ قبل را نگاه می‌کرد.
         ⚠️ نتیجه **همیشه** نوشته می‌شود، حتی `null`: برداشتنِ کارشناس باید
         ساعتِ حضورش را هم ببرد، وگرنه ساعتِ یتیم روی کارت می‌ماند. همین کار
         رکوردهای واگرای قدیمی را هم با اولین ذخیره درست می‌کند. */
      /* حضور، مسئولِ فعلی و ساعت‌های تیم از تیمِ پرونده مشتق می‌شوند (`crew-sync`) — با مقادیرِ نهاییِ همین ویرایش. */
      const upd = await tx.visit.update({ where: { id }, data: visitPatch, include: INCLUDE_VISIT_FULL });
      const crewWrote = await syncCrew(tx, id, {
        ...(visitPatch.techId !== undefined ? { tech: { source: 'form' as const } } : {}),
        ...(visitPatch.opStartTime !== undefined || visitPatch.opEndTime !== undefined ? { times: 'op' as const } : {}),
      });
      /* تاریخ یا بیمارستان عوض شد → حملِ هنوز نرفتهٔ همین مراجعه هم جابه‌جا می‌شود. */
      if (visitPatch.opDate !== undefined || visitPatch.hospitalId !== undefined) stale = (await followVisitMove(tx, id)).gone;
      return crewWrote ? tx.visit.findUniqueOrThrow({ where: { id }, include: INCLUDE_VISIT_FULL }) : upd;
    });
    const kinds = await this.forms.kindMap();
    const result = enrich(updated, kinds, VISIT_FULL_NOTE_KINDS);
    await this.audit.record({ actorId: user?.id, action: 'visit.update', entityType: 'visit', entityId: id, before: enrich(v, kinds, VISIT_FULL_NOTE_KINDS), after: result });
    /* ویرایش ممکن است تاریخِ ویزیتِ بعدی یا شمارهٔ بیمار را عوض کرده باشد. */
    await this.reminders.syncNextVisit(id);
    await this.syncPostOpVisit(id);
    /* پست‌آپ دوطرفه است: تاریخِ ویزیتِ پست‌آپ که در خودش عوض شود، «ویزیتِ بعدی»ِ عمل (و
       پیامکش) هم عوض می‌شود — تا دیروز ذخیرهٔ بعدیِ عمل تاریخِ منشی را بازنویسی می‌کرد. */
    await this.syncPostOpParent(id);
    await this.carrySurgeonToFollowers(v, updated);
    return { ...result, ...(await this.reportStale(id, v.patientId, stale, user)) };
  }

  /**
   * «حملِ جامانده» (تصمیمِ مالک ۱۴۰۵/۰۸/۰۴): تغییرِ تاریخ/بیمارستان ثبت شد ولی ست/دستگاهِ **رفته** در بیمارستانِ
   * قبلی است. هشدار به همان نویسنده (پاسخ) + کار برای صفِ دفتر و مسئولِ فعلیِ پرونده (`work-rules: transport.stale`).
   */
  private async reportStale(visitId: number, patientId: number, gone: StaleTransfer[], user?: any) {
    if (!gone.length) return {};
    const why = staleText(gone)!;
    const techId = (await this.prisma.visit.findUnique({ where: { id: visitId }, select: { techId: true } }))?.techId ?? null;
    for (const g of gone) {
      await this.events.emit({ type: 'transport.stale', visitId, patientId, refType: 'stock_transfer', refId: g.id,
        actorId: user?.id ?? null, payload: { code: g.code, place: g.place, techId, why } });
    }
    return { transportWarning: why };
  }

  /**
   * **ویزیتِ پست‌آپ → عمل** — نیمهٔ دومِ همگامیِ دوطرفه (بازبینیِ ۱۴۰۵/۰۷/۰۳).
   *
   * `syncPostOpVisit` تاریخِ «ویزیتِ بعدی»ِ عمل را روی فرزند می‌نشاند؛ این یکی برعکس: وقتی
   * خودِ فرزند جابه‌جا، لغو یا از لغو برگردانده شد، «ویزیتِ بعدی»ِ عمل همان می‌شود و
   * یادآوری از نو کاشته می‌شود. بدونِ این، پیامک تاریخِ قدیمیِ عمل را می‌برد و ذخیرهٔ بعدیِ
   * عمل هم فرزندِ لغوشده را زنده می‌کرد.
   *
   * ⚠️ فرزندِ «انجام‌شده» برنامه را عوض نمی‌کند — ویزیت برگزار شده و «ویزیتِ بعدی»ِ عمل
   * دیگر یادآوری ندارد؛ پاک‌کردنش سابقه را پاک می‌کرد.
   */
  async syncPostOpParent(childId: number) {
    try {
      const c = await this.prisma.visit.findUnique({
        where: { id: childId },
        select: {
          opDate: true, opStatus: true,
          followOf: { select: { id: true, kind: true, nextVisitDate: true, opStatus: true } },
        },
      });
      const parent = c?.followOf;
      if (!c || !parent || parent.kind !== 'surgery' || parent.opStatus === 'cancelled' || c.opStatus === 'done') return;
      const want = c.opStatus === 'cancelled' ? null : c.opDate;
      if ((want?.getTime() ?? null) === (parent.nextVisitDate?.getTime() ?? null)) return;
      await this.prisma.visit.update({ where: { id: parent.id }, data: { nextVisitDate: want } });
      await this.reminders.syncNextVisit(parent.id);
    } catch (e) {
      console.warn(`syncPostOpParent(${childId}) شکست خورد:`, e instanceof Error ? e.message : e);
    }
  }

  /**
   * اصلاحِ جراحِ عمل به ویزیتِ پست‌آپِ **در انتظارِ** همان عمل هم می‌رسد — فقط اگر پزشکِ
   * آن هنوز همان جراحِ قبلی است. انتخابِ دستیِ منشی (پزشکِ دیگری) دست نمی‌خورد.
   */
  private async carrySurgeonToFollowers(before: any, after: any) {
    if (before?.kind !== 'surgery' || !before.surgeonId || !after?.surgeonId || before.surgeonId === after.surgeonId) return;
    await this.prisma.visit.updateMany({
      where: { followOfVisitId: before.id, opStatus: 'pending', surgeonId: before.surgeonId },
      data: { surgeonId: after.surgeonId, surgeonName: after.surgeonName ?? null },
    });
  }

  async setStatus(id: number, opStatus: string, user?: any, cancel?: { reason?: string; note?: string }) {
    await this.assertVisitAccess(id, user);
    const v = await this.prisma.visit.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    /* ⚠️ دلیلِ لغو **اجباری** است (تصمیمِ مالک ۱۴۰۵/۰۶/۲۶) و از مجموعهٔ بستهٔ
       `CANCEL_REASONS` می‌آید، نه متنِ آزاد: متنش به دستِ بیمار می‌رسد.
       یادداشتِ داخلی اختیاری است و هرگز فرستاده نمی‌شود. */
    const cancelling = opStatus === 'cancelled' && v.opStatus !== 'cancelled';
    if (cancelling && !CANCEL_REASONS[cancel?.reason ?? '']) {
      throw new BadRequestException('دلیلِ لغو را از فهرست انتخاب کنید');
    }
    const updated = await this.prisma.visit.update({
      where: { id },
      data: {
        opStatus,
        ...(cancelling ? { cancelReason: cancel!.reason, cancelNote: cancel?.note ?? null } : {}),
        /* برگشت از لغو، دلیل را هم پاک می‌کند — وگرنه مراجعهٔ زنده دلیلِ لغوِ
           کهنه را با خودش حمل می‌کند و گزارشِ بعدی دروغ می‌گوید. */
        ...(v.opStatus === 'cancelled' && opStatus !== 'cancelled' ? { cancelReason: null, cancelNote: null } : {}),
      },
      include: INCLUDE_PATIENT,
    });
    if (cancelling) {
      await this.reminders.notifyCancelled('visit', v.patientId, cancel!.reason!, {
        when: v.opDate ? jalaliText(v.opDate) : null, // «۸ مهر ۱۴۰۵» — نه ISOِ میلادی (clinic-daily-12)
      });
    }
    /* لغوِ عمل باید یادآوریِ «عملِ پیشِ‌رو» را هم باطل کند. */
    /* W2.2: done/cancelled کارهای بازِ همین عمل را می‌بندند (work-rules: visit.done / visit.cancelled). */
    if (v.opStatus !== opStatus) {
      await this.events.emit({
        type: `visit.${opStatus}`, visitId: id, patientId: v.patientId, actorId: user?.id ?? null,
        payload: { from: v.opStatus, techId: v.techId ?? null },
      });
    }
    await this.reminders.syncNextVisit(id);
    await this.syncPostOpVisit(id);
    /* لغوِ ویزیتِ پست‌آپ «ویزیتِ بعدی»ِ عمل را برمی‌دارد و برگرداندنش آن را برمی‌گرداند —
       وگرنه ذخیرهٔ بعدیِ عمل همین فرزندِ لغوشده را دوباره زنده می‌کرد. */
    await this.syncPostOpParent(id);
    return enrich(updated, await this.forms.kindMap());
  }

  /**
   * **«موکول شد»** — عمل انجام نشد ولی لغو هم نشد: تاریخِ تازه، یا «هنوز تاریخ ندارد».
   *
   * ⚠️ وضعیتِ جدا (`postponed`) عمداً ساخته نشد: عملِ موکول‌شده همان عملِ «در انتظار» است با
   * تاریخی دیگر — همهٔ فیلترها، تقویم، چینش و یادآوری‌ها از قبل همین را می‌فهمند، و وضعیتِ
   * چهارم یعنی ده جای دیگر که باید یادش بگیرند. ردِ «موکول شد» در ممیزی و رویدادِ
   * `visit.postponed` می‌ماند؛ همان رویداد کارِ «وضعیتِ عمل ثبت نشده» را می‌بندد.
   *
   * ⚠️ «بدونِ تاریخ» یعنی `opDate = null` — همان «رزرو بدون تاریخ»ِ ثبت‌نام: عمل از دفترِ
   * روزِ کارشناس بیرون می‌رود و یادآوری‌های تاریخ‌دارش (عملِ پیشِ‌رو، مراقبت) هرس می‌شوند تا
   * بیمار پیامکِ روزی را نگیرد که دیگر عملی در آن نیست.
   */
  async postpone(id: number, opDate: string | null | undefined, user?: any) {
    await this.assertVisitAccess(id, user);
    const v = await this.prisma.visit.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    if (v.opStatus !== 'pending') throw new BadRequestException('فقط عملِ در انتظار موکول می‌شود');
    const next = opDate ? toDateValue(opDate) ?? null : null;
    if (opDate && !next) throw new BadRequestException('تاریخِ تازه نامعتبر است');
    /* ⚠️ «امروز»ِ مطب، نه UTC — همان تعریفِ `clinic-day` که دفترِ کار با آن روز را می‌بُرد. */
    if (next && next.getTime() < todayRangeUtc()[0].getTime()) {
      throw new BadRequestException('تاریخِ تازه باید امروز یا بعد از آن باشد');
    }
    let stale: StaleTransfer[] = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      /* ساعتِ حضور مشتقِ برنامهٔ چینشِ **همان روز** است (`syncVisitDuty`)؛ روزِ تازه، حضورِ تازه —
         و بی‌تاریخ، بی‌حضور. همان قاعدهٔ `updateVisit`. */
      await tx.visit.update({ where: { id }, data: { opDate: next } });
      await syncCrew(tx, id);
      stale = (await followVisitMove(tx, id)).gone;
      return tx.visit.findUniqueOrThrow({ where: { id }, include: INCLUDE_PATIENT });
    });
    await this.audit.record({
      actorId: user?.id, action: 'visit.postpone', entityType: 'visit', entityId: id,
      before: { opDate: v.opDate }, after: { opDate: next },
    });
    await this.events.emit({
      type: 'visit.postponed', visitId: id, patientId: v.patientId, actorId: user?.id ?? null,
      payload: { from: v.opDate?.toISOString() ?? null, to: next?.toISOString() ?? null, techId: v.techId ?? null },
    });
    await this.reminders.syncNextVisit(id);
    await this.syncPostOpVisit(id);
    await this.syncPostOpParent(id);
    return { ...enrich(updated, await this.forms.kindMap()), ...(await this.reportStale(id, v.patientId, stale, user)) };
  }

  /// حذفِ مراجعه؛ اگر آخرین مراجعهٔ بیمار بود، خودِ بیمار هم پاک می‌شود
  async deleteVisit(id: number, user?: any) {
    await this.assertVisitAccess(id, user);
    /* سایرین هم در «قبل»ِ ممیزی — حذف آن‌ها را cascade می‌کند. */
    const v = await this.prisma.visit.findUnique({
      where: { id },
      include: {
        otherDiagnoses: { select: { diagnosisId: true, rank: true } },
        otherProcedures: { select: { procedureTypeId: true, rank: true } },
      },
    });
    if (!v) throw new NotFoundException('مراجعه پیدا نشد');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM visits WHERE id = ${id} FOR UPDATE`;
      if (await tx.invoiceDocument.count({ where: { visitId: id } })) {
        throw new BadRequestException('برای این مراجعه فاکتور صادر شده است؛ برای حفظ سوابق مالی، مراجعه را لغو کنید');
      }
      await tx.visit.delete({ where: { id } });
      const left = await tx.visit.count({ where: { patientId: v.patientId } });
      if (left === 0) {
        await tx.patient.update({
          where: { id: v.patientId },
          data: { deletedAt: new Date(), deletedById: user?.id ?? null, deleteReason: 'آخرین مراجعه حذف شد' },
        });
      }
    });
    await this.audit.record({ actorId: user?.id, action: 'visit.delete', entityType: 'visit', entityId: id, before: v });
    return { ok: true };
  }
}

/**
 * فیلدهای هسته‌ای را از `dto` بیرون می‌کشد تا اعتبارسنجیِ فرم بتواند بسنجدشان.
 *
 * ⚠️ مقدارِ `null` و `''` هر دو «خالی» می‌مانند و به همان شکل رد می‌شوند؛
 * تبدیلشان به `undefined` یعنی فیلدِ اجباریِ خالی از اعتبارسنجی می‌گریزد.
 * ⚠️ `opDate` رشته‌ی ورودی است نه `Date` — سنجشِ خالی‌بودن روی همان رشته
 * انجام می‌شود، پیش از تبدیل.
 */
function pickBuiltin(dto: any): Record<string, any> {
  const out: Record<string, any> = {};
  /* ⚠️ فهرست از `BUILTIN_VISIT_KEYS` خوانده می‌شود، نه دوباره این‌جا نوشته.
     تا دیروز نسخهٔ دستیِ همان فهرست این‌جا بود و مو به مو یکی بود — یعنی
     بار سوم که کسی کلیدی اضافه می‌کرد، این یکی از قلم می‌افتاد و ستارهٔ
     همان فیلد در **ثبتِ** مراجعه بی‌اثر می‌شد (در ویرایش نه، چون آن‌جا کلِ
     `dto` اسپرد می‌شود) — یک ناهم‌خوانیِ بی‌صدا بینِ دو مسیر.

     ⚠️ **و `VISIT_CATALOG_KEYS` هم، چون آن دو یکی نیستند.** `BUILTIN_VISIT_KEYS`
     یعنی «کدام کلید به ستون می‌نشیند» و کاتالوگ یعنی «کدام فیلد در فرم‌ساز
     ستاره می‌گیرد». تنها اختلافشان `opReport` است — که ستون نیست و به
     `ClinicalNote` می‌رود — ولی همان یکی یک باگِ سخت می‌ساخت: اگر مدیر
     «شرحِ عمل» را **اجباری** می‌کرد، مقدارش هیچ‌وقت وارد `values` نمی‌شد و
     ثبتِ مراجعه **برای همیشه** ۴۰۰ می‌گرفت («شرحِ عمل را کامل کنید») هر چقدر
     هم که کاربر می‌نوشت. ستاره‌ای که فیلد را برای ابد قفل کند از نبودنِ
     ستاره بدتر است. */
  for (const k of [...BUILTIN_VISIT_KEYS, ...VISIT_CATALOG_KEYS]) {
    if (k in dto) out[k] = dto[k];
  }
  return out;
}
