import { Injectable, NotFoundException } from '@nestjs/common';
import { NOTE_KIND_LABELS } from './labels';
import { PrismaService } from '../prisma/prisma.service';
import { LEVEL } from '../common/levels';
import { ownVisitWhere } from '../common/own-scope';
import { summarize } from './billing.service';

const ORDER_KINDS = [
  { key: 'lab', fa: 'آزمایش' },
  { key: 'imaging', fa: 'تصویربرداری' },
  { key: 'consult', fa: 'مشاوره' },
  { key: 'referral', fa: 'ارجاع' },
];

/**
 * کارتِ **آماده‌سازیِ ویزیت** (W3.2، §۴.۴ سند) — آنچه پزشک باید *پیش از* دیدنِ
 * بیمار بداند، در یک درخواست.
 *
 * تا امروز همین چند تکه در چند صفحه پخش بود: حساسیت و داروی بیمار در پرونده،
 * شرحِ ویزیتِ قبلی در تبِ دیگر، نتیجهٔ در انتظار در بخشِ سفارش‌ها، و ماندهٔ مالی
 * در صورت‌حساب. کسی که وقت ندارد، هیچ‌کدام را باز نمی‌کند — و همان «حساسیت به
 * پنی‌سیلین» چیزی است که نباید دیده نشود.
 *
 * ⚠️ **همه‌چیز خواندنی و مشتق است** (قانونِ ۱۵): مانده، سن، و کوتاه‌شدنِ متنِ
 * شرح همه این‌جا حساب می‌شوند تا کلاینت فقط چاپ کند.
 *
 * ⚠️ دامنهٔ دید همان فهرستِ مراجعات است: زیرِ سوپروایزر فقط مراجعهٔ خودش
 * (`techId`). این کارت اطلاعاتِ بالینیِ حساس دارد و نباید درِ پشتیِ پرونده باشد.
 */
@Injectable()
export class PrepService {
  constructor(private prisma: PrismaService) {}

  async forVisit(visitId: number, user: any) {
    const level = user?.level ?? 0;
    const visit = await this.prisma.visit.findFirst({
      where: {
        id: visitId,
        patient: { deletedAt: null },
        ...(level >= LEVEL.SUPERVISOR ? {} : ownVisitWhere(user)),
      },
      select: {
        id: true, seq: true, kind: true, opDate: true, opStatus: true, pricingModel: true, globalAmount: true,
        charges: { select: { amount: true } },
        payments: { select: { amount: true } },
        patient: {
          select: {
            id: true, code: true, firstName: true, lastName: true, birthDate: true, gender: true,
            bloodType: true, allergies: true, chronicConditions: true, medications: true,
            insurer: true, insuranceNo: true,
          },
        },
      },
    });
    if (!visit) throw new NotFoundException('مراجعه پیدا نشد');
    const p = visit.patient;

    const [notes, prevVisits, pending] = await Promise.all([
      /* شرحِ ویزیت‌های قبل — نسخهٔ جایگزین‌شده کنار گذاشته می‌شود تا متنِ کهنه
         به‌جای اصلاحیه‌اش دیده نشود. */
      this.prisma.clinicalNote.findMany({
        where: { patientId: p.id, replacedAt: null, NOT: { visitId } },
        orderBy: { createdAt: 'desc' }, take: 3,
        select: { id: true, kind: true, body: true, authorName: true, createdAt: true, visitId: true },
      }),
      this.prisma.visit.findMany({
        where: { patientId: p.id, id: { not: visitId } },
        orderBy: [{ opDate: 'desc' }, { id: 'desc' }], take: 3,
        select: { id: true, seq: true, kind: true, opDate: true, opStatus: true },
      }),
      this.pendingOrders(p.id),
    ]);

    return {
      visit: { id: visit.id, code: `${p.code}-V${visit.seq}`, kind: visit.kind, opDate: visit.opDate, opStatus: visit.opStatus },
      patient: {
        id: p.id, code: p.code, fullName: `${p.firstName} ${p.lastName}`.trim(),
        age: PrepService.age(p.birthDate), gender: p.gender,
        bloodType: p.bloodType || null,
        /* سه چیزی که نادیده‌گرفتنشان خطرِ بالینی دارد — جدا از بقیه برمی‌گردند
           تا رابط بتواند برجسته‌شان کند. */
        allergies: p.allergies || null,
        chronicConditions: p.chronicConditions || null,
        medications: p.medications || null,
        insurer: p.insurer || null, insuranceNo: p.insuranceNo || null,
      },
      /* متن **این‌جا** کوتاه می‌شود، نه با CSS: کارتِ آماده‌سازی خلاصه است و
         شرحِ کامل یک کلیک آن‌طرف‌تر در پرونده می‌ماند. */
      notes: notes.map((n) => ({
        id: n.id, kind: n.kind, kindFa: NOTE_KIND_LABELS[n.kind] ?? n.kind,
        visitId: n.visitId, authorName: n.authorName, createdAt: n.createdAt,
        excerpt: PrepService.excerpt(n.body),
        truncated: (n.body ?? '').trim().length > 180,
      })),
      prevVisits: prevVisits.map((v) => ({ ...v, code: `${p.code}-V${v.seq}` })),
      pendingResults: pending,
      billing: summarize(visit.charges, visit.payments, visit),
    };
  }

  /** نتیجه‌هایی که هنوز نیامده‌اند یا آمده و بررسی نشده‌اند — روی کلِ پرونده، نه فقط این مراجعه. */
  private async pendingOrders(patientId: number) {
    const out: any[] = [];
    for (const k of ORDER_KINDS) {
      const table = (this.prisma as any)[`${k.key}Order`];
      const rows = await table.findMany({
        where: { patientId, status: { in: ['sent', 'answered'] } },
        orderBy: { updatedAt: 'desc' }, take: 5,
        select: { id: true, status: true, updatedAt: true, visitId: true },
      });
      out.push(...rows.map((r: any) => ({ ...r, kind: k.key, kindFa: k.fa })));
    }
    /* «پاسخ آمده» قبل از «فرستاده شده»: آن یکی کاری است که همین حالا می‌شود کرد. */
    return out.sort((a, b) => (a.status === b.status ? 0 : a.status === 'answered' ? -1 : 1)).slice(0, 6);
  }

  private static age(birth: Date | null) {
    if (!birth) return null;
    const ms = Date.now() - new Date(birth).getTime();
    const years = Math.floor(ms / (365.2425 * 864e5));
    return years >= 0 && years < 130 ? years : null;
  }

  private static excerpt(body: string | null) {
    const t = (body ?? '').replace(/\s+/g, ' ').trim();
    return t.length > 180 ? `${t.slice(0, 180)}…` : t;
  }
}
