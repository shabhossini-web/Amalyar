import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LEVEL } from '../common/levels';
import { ownVisitWhere } from '../common/own-scope';
import { actorName } from '../common/person';

/**
 * **چک‌لیستِ ایمنیِ جراحی** — سه مرحله‌ی سازمانِ جهانیِ بهداشت، کوتاه‌شده به آنچه
 * یک تیمِ کوچک واقعاً بلند می‌خواند.
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
const roomState = (v: { opStatus: string | null; opStartTime: string | null; opEndTime: string | null; opDate: Date | null }) => {
  if (v.opStatus === 'cancelled') return { state: 'cancelled', stateFa: 'لغو' };
  if (v.opEndTime) return { state: 'finished', stateFa: 'تمام شد' };
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
  constructor(private prisma: PrismaService, private audit: AuditService) {}

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
        hospitalName: true, surgeonName: true,
        patient: { select: { id: true, code: true, firstName: true, lastName: true } },
        hospital: { select: { name: true } },
        procedureType: { select: { name: true } },
        surgeon: { select: { person: { select: { firstName: true, lastName: true } } } },
        safetyChecks: { select: { stage: true } },
      },
    });
    return {
      date,
      /* شمارشِ بندهای هر مرحله از خودِ کاتالوگ می‌آید، پس رابط عددِ ثابت ندارد. */
      stages: SAFETY_STAGES.map((s) => ({ key: s.key, title: s.title, total: s.items.length })),
      visits: rows.map((v) => ({
        id: v.id, code: `${v.patient.code}-V${v.seq}`,
        patientId: v.patient.id, patient: `${v.patient.firstName} ${v.patient.lastName}`.trim(),
        opStartTime: v.opStartTime, opEndTime: v.opEndTime, opStatus: v.opStatus,
        ...roomState(v),
        procedure: v.procedureType?.name ?? v.opType ?? null,
        hospital: v.hospital?.name ?? v.hospitalName ?? null,
        surgeon: TheatreService.personName(v.surgeon) ?? v.surgeonName ?? null,
        /* «کجای چک‌لیستیم» مشتقِ سرور است تا هر کارت یک عدد بگیرد نه یک آرایه. */
        checklist: SAFETY_STAGES.map((s) => ({
          key: s.key, done: v.safetyChecks.filter((c) => c.stage === s.key).length, total: s.items.length,
        })),
      })),
    };
  }

  /** کارتِ حینِ عمل — هر چیزی که سرِ میز لازم است، در یک درخواست. */
  async card(visitId: number, user: any) {
    const v = await this.prisma.visit.findFirst({
      where: { id: visitId, ...this.scope(user), patient: { deletedAt: null } },
      select: {
        id: true, seq: true, kind: true, opDate: true, opStatus: true, opType: true,
        opStartTime: true, opEndTime: true, techArriveTime: true,
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
        documents: { where: { deletedAt: null }, orderBy: { id: 'desc' }, take: 12, select: { id: true, title: true, fileName: true, category: true, phase: true } },
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
      documents: v.documents,
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
