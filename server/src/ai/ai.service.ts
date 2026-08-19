import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../config/settings.service';
import { LEVEL } from '../common/levels';
import { NOTE_KINDS } from '../patients/record.service';

const KIND_FA: Record<string, string> = {
  history: 'شرحِ حال', visit: 'شرحِ ویزیت', op: 'شرحِ عمل',
  progress: 'سیرِ بیماری', discharge: 'خلاصهٔ ترخیص', consult: 'مشاوره',
};

/**
 * دستیارِ شرح‌نویسی (#49) — پروکسیِ سازگار با OpenAI (chat/completions).
 *
 * «یادگیریِ تدریجی» این‌جا retrieval است نه fine-tune: هر درخواست چند شرحِ
 * قبلیِ **همین مطب** از همان نوع (و اگر مراجعه معلوم است، همان نوعِ عمل) را
 * به‌عنوانِ نمونهٔ سبک می‌بیند — هر چه مطب بیشتر بنویسد، پیش‌نویس‌ها
 * شبیه‌ترِ خودش می‌شوند، بدونِ اینکه داده‌ای جایی «آموزش داده» شود.
 *
 * ⚠️ کلید و نشانی از تنظیماتِ هر شرکت می‌آید (نصبِ ایران به گیت‌وی نیاز
 * دارد)؛ پیکربندی‌نشده = 400ِ روشن، نه تماسِ شکست‌خورده.
 */
@Injectable()
export class AiService {
  private readonly log = new Logger('Ai');

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  private assertClinical(user: any) {
    if ((user?.level ?? 0) < LEVEL.TECH_ADMIN) {
      throw new ForbiddenException('اجازهٔ استفاده از دستیارِ بالینی را ندارید');
    }
  }

  async status(user: any) {
    this.assertClinical(user);
    const cfg = await this.settings.ai();
    return { enabled: cfg.enabled, model: cfg.enabled ? cfg.model : null };
  }

  /**
   * تایپِ خام → شرحِ ساخت‌یافته.
   * متنِ برگشتی فقط پیش‌نویس است — تا پزشک «ثبت» نزند چیزی در پرونده نمی‌نشیند.
   */
  async noteDraft(user: any, dto: { patientId: number; visitId?: number; kind: string; text: string }) {
    this.assertClinical(user);
    if (!NOTE_KINDS.includes(dto.kind as any)) throw new BadRequestException('نوعِ شرح نامعتبر است');
    const text = (dto.text ?? '').trim();
    if (!text) throw new BadRequestException('متنی برای ساخت‌یافته‌کردن نیست');
    const cfg = await this.settings.ai();
    if (!cfg.enabled) throw new BadRequestException('دستیارِ هوشِ مصنوعی پیکربندی نشده — تنظیماتِ شرکت، بخشِ «دستیارِ هوشِ مصنوعی»');

    const patient = await this.prisma.patient.findUnique({
      where: { id: dto.patientId },
      select: { id: true, birthDate: true, gender: true },
    });
    if (!patient) throw new BadRequestException('پرونده پیدا نشد');

    /* بافتارِ مراجعه — فقط نام‌ها؛ نه شمارهٔ تماس، نه هویت. کمینه‌سازیِ داده
       عمدی است: برای ساخت‌یافته‌کردنِ متن، نامِ بیمار لازم نیست. */
    let visitCtx = '';
    let procedureTypeId: number | null = null;
    if (dto.visitId != null) {
      const v = await this.prisma.visit.findFirst({
        where: { id: dto.visitId, patientId: dto.patientId },
        select: {
          opDate: true, procedureTypeId: true,
          procedureType: { select: { name: true } },
          diagnosis: { select: { title: true } },
          topic: { select: { name: true } },
          opType: true,
        },
      });
      if (!v) throw new BadRequestException('مراجعهٔ انتخابی برای این بیمار نیست');
      procedureTypeId = v.procedureTypeId;
      visitCtx = [
        v.procedureType?.name ?? v.opType ? `نوعِ عمل/خدمت: ${v.procedureType?.name ?? v.opType}` : '',
        v.diagnosis?.title ? `تشخیص: ${v.diagnosis.title}` : '',
        v.topic?.name ? `موضوعِ ویزیت: ${v.topic.name}` : '',
      ].filter(Boolean).join('؛ ');
    }

    /* نمونه‌های سبک — شرح‌های جاریِ همان نوع (و همان نوعِ عمل اگر معلوم است). */
    const examples = await this.prisma.clinicalNote.findMany({
      where: {
        kind: dto.kind, replacedAt: null,
        ...(procedureTypeId ? { visit: { procedureTypeId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { body: true },
    });

    const system = [
      `تو دستیارِ مستندسازیِ بالینیِ یک کلینیک هستی. وظیفه: متنِ خامِ پزشک را به یک «${KIND_FA[dto.kind] ?? dto.kind}»ِ ساخت‌یافته و تمیزِ فارسی تبدیل کن.`,
      'قاعده‌ها:',
      '- فقط از اطلاعاتِ همان متنِ خام استفاده کن؛ هیچ یافته یا عددی از خودت اضافه نکن.',
      '- ساختار با سرفصل‌های کوتاه (مثلاً: شکایتِ اصلی، شرح، یافته‌ها، اقدام، توصیه‌ها) — فقط سرفصل‌هایی که در متن مصداق دارند.',
      '- مختصر، رسمی و بالینی بنویس؛ چیزی که معلوم نیست را «ذکر نشده» ننویس، اصلاً نیاور.',
      '- خروجی فقط متنِ شرح باشد — بدونِ مقدمه و توضیحِ اضافه.',
      examples.length
        ? `سبک و ساختارِ نمونه‌های قبلیِ همین کلینیک را الگو بگیر:\n${examples.map((e, i) => `— نمونهٔ ${i + 1}:\n${e.body.slice(0, 1200)}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n');

    const userMsg = [
      visitCtx ? `بافتار: ${visitCtx}` : '',
      `متنِ خام:\n${text.slice(0, 6000)}`,
    ].filter(Boolean).join('\n\n');

    const out = await this.chat(cfg, system, userMsg);
    return { text: out };
  }

  /** یک تماسِ chat/completions — با مهلتِ صریح و خطای قابلِ‌فهم. */
  private async chat(cfg: { baseUrl: string; apiKey: string; model: string }, system: string, user: string): Promise<string> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60_000);
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.3,
          max_tokens: 1500,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.log.warn(`AI ${res.status}: ${body.slice(0, 300)}`);
        throw new BadGatewayException(`سرویسِ هوشِ مصنوعی پاسخ نداد (${res.status}) — تنظیمات و کلید را بررسی کنید`);
      }
      const json: any = await res.json();
      const out = json?.choices?.[0]?.message?.content;
      if (typeof out !== 'string' || !out.trim()) {
        throw new BadGatewayException('پاسخِ سرویسِ هوشِ مصنوعی خالی بود');
      }
      return out.trim();
    } catch (e: any) {
      if (e instanceof BadGatewayException) throw e;
      this.log.warn(`AI fetch شکست خورد: ${e?.message ?? e}`);
      throw new BadGatewayException('دسترسی به سرویسِ هوشِ مصنوعی برقرار نشد — نشانیِ پایه و شبکه را بررسی کنید');
    } finally {
      clearTimeout(timer);
    }
  }
}
