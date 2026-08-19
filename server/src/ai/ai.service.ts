import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../config/settings.service';
import { LEVEL } from '../common/levels';
import { NOTE_KINDS } from '../patients/record.service';

const KIND_FA: Record<string, string> = {
  history: 'شرحِ حال', visit: 'شرحِ ویزیت', op: 'شرحِ عمل',
  progress: 'سیرِ بیماری', discharge: 'خلاصهٔ ترخیص', consult: 'مشاوره',
};

type AiCfg = { baseUrl: string; apiKey: string; model: string };
type DraftDto = { patientId: number; visitId?: number; kind: string; text: string; mode?: string };

/**
 * دستیارِ شرح‌نویسی (#49/#50) — پروکسیِ سازگار با OpenAI (chat/completions).
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

  private async cfgOrThrow(): Promise<AiCfg> {
    const cfg = await this.settings.ai();
    if (!cfg.enabled) {
      throw new BadRequestException('دستیارِ هوشِ مصنوعی پیکربندی نشده — تنظیماتِ شرکت، بخشِ «دستیارِ هوشِ مصنوعی»');
    }
    return cfg;
  }

  async status(user: any) {
    this.assertClinical(user);
    const cfg = await this.settings.ai();
    return { enabled: cfg.enabled, model: cfg.enabled ? cfg.model : null };
  }

  /**
   * ساختِ prompt پیش‌نویسِ شرح — مشترک بینِ مسیرِ عادی و استریم.
   *
   * دو حالت: `structure` (تایپِ خام → شرحِ ساخت‌یافته) و `continue`
   * («ادامه بنویس» — با همان سبک و بدونِ تکرارِ متنِ موجود). کمینه‌سازیِ
   * داده عمدی است: نام/شمارهٔ بیمار به سرویسِ بیرونی نمی‌رود.
   */
  private async draftPrompt(user: any, dto: DraftDto): Promise<{ cfg: AiCfg; system: string; userMsg: string }> {
    this.assertClinical(user);
    if (!NOTE_KINDS.includes(dto.kind as any)) throw new BadRequestException('نوعِ شرح نامعتبر است');
    const mode = dto.mode === 'continue' ? 'continue' : 'structure';
    const text = (dto.text ?? '').trim();
    if (!text) throw new BadRequestException('متنی برای دستیار نیست');
    const cfg = await this.cfgOrThrow();

    const patient = await this.prisma.patient.findUnique({
      where: { id: dto.patientId },
      select: { id: true },
    });
    if (!patient) throw new BadRequestException('پرونده پیدا نشد');

    let visitCtx = '';
    let procedureTypeId: number | null = null;
    if (dto.visitId != null) {
      const v = await this.prisma.visit.findFirst({
        where: { id: dto.visitId, patientId: dto.patientId },
        select: {
          procedureTypeId: true, opType: true,
          procedureType: { select: { name: true } },
          diagnosis: { select: { title: true } },
          topic: { select: { name: true } },
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
    const styleBlock = examples.length
      ? `سبک و ساختارِ نمونه‌های قبلیِ همین کلینیک را الگو بگیر:\n${examples.map((e, i) => `— نمونهٔ ${i + 1}:\n${e.body.slice(0, 1200)}`).join('\n')}`
      : '';

    const kindFa = KIND_FA[dto.kind] ?? dto.kind;
    const system = (mode === 'structure'
      ? [
        `تو دستیارِ مستندسازیِ بالینیِ یک کلینیک هستی. وظیفه: متنِ خامِ پزشک را به یک «${kindFa}»ِ ساخت‌یافته و تمیزِ فارسی تبدیل کن.`,
        'قاعده‌ها:',
        '- فقط از اطلاعاتِ همان متنِ خام استفاده کن؛ هیچ یافته یا عددی از خودت اضافه نکن.',
        '- ساختار با سرفصل‌های کوتاه (مثلاً: شکایتِ اصلی، شرح، یافته‌ها، اقدام، توصیه‌ها) — فقط سرفصل‌هایی که در متن مصداق دارند.',
        '- مختصر، رسمی و بالینی بنویس؛ چیزی که معلوم نیست را «ذکر نشده» ننویس، اصلاً نیاور.',
        '- خروجی فقط متنِ شرح باشد — بدونِ مقدمه و توضیحِ اضافه.',
        styleBlock,
      ]
      : [
        `تو دستیارِ مستندسازیِ بالینیِ یک کلینیک هستی. وظیفه: **ادامهٔ** یک «${kindFa}»ِ نیمه‌نوشته را بنویس.`,
        'قاعده‌ها:',
        '- متنِ موجود را تکرار نکن — فقط ادامه را بنویس، با همان سبک و سرفصل‌بندی.',
        '- هیچ یافته یا عددِ اختراعی نیاور؛ جای دادهٔ نامعلوم «……» بگذار تا پزشک پر کند.',
        '- اگر شرح کامل به‌نظر می‌رسد، فقط جمع‌بندی/توصیه‌های پایانی را تکمیل کن.',
        '- خروجی فقط متنِ ادامه باشد — بدونِ مقدمه.',
        styleBlock,
      ]).filter(Boolean).join('\n');

    const userMsg = [
      visitCtx ? `بافتار: ${visitCtx}` : '',
      mode === 'structure' ? `متنِ خام:\n${text.slice(0, 6000)}` : `متنِ فعلی:\n${text.slice(0, 6000)}`,
    ].filter(Boolean).join('\n\n');

    return { cfg, system, userMsg };
  }

  /**
   * تایپِ خام → شرحِ ساخت‌یافته (یا ادامهٔ متن با mode='continue').
   * متنِ برگشتی فقط پیش‌نویس است — تا پزشک «ثبت» نزند چیزی در پرونده نمی‌نشیند.
   */
  async noteDraft(user: any, dto: DraftDto) {
    const { cfg, system, userMsg } = await this.draftPrompt(user, dto);
    const out = await this.chat(cfg, system, userMsg);
    return { text: out };
  }

  /**
   * همان پیش‌نویس، ولی **زنده** (SSE) — پزشک متن را همان‌طور که نوشته می‌شود
   * می‌بیند، نه بعد از یک انتظارِ کور.
   *
   * ⚠️ همهٔ خطاهای پیش از تماس (اعتبارسنجی/پیکربندی/upstreamِ ناجواب) قبل از
   * نوشتنِ هدر پرتاب می‌شوند تا کلاینت JSONِ خطای عادی بگیرد؛ فقط وقتی
   * استریمِ سالم شروع شد هدرِ event-stream می‌رود. خطای وسطِ راه به‌شکلِ
   * رویدادِ `{error}` می‌آید چون دیگر status قابلِ‌تغییر نیست.
   */
  async noteDraftStream(user: any, dto: DraftDto, res: Response) {
    const { cfg, system, userMsg } = await this.draftPrompt(user, dto);

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 120_000);
    res.on('close', () => ctl.abort());
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.3,
          max_tokens: 1500,
          stream: true,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userMsg },
          ],
        }),
      });
    } catch (e: any) {
      clearTimeout(timer);
      this.log.warn(`AI stream fetch شکست خورد: ${e?.message ?? e}`);
      throw new BadGatewayException('دسترسی به سرویسِ هوشِ مصنوعی برقرار نشد — نشانیِ پایه و شبکه را بررسی کنید');
    }
    if (!upstream.ok || !upstream.body) {
      clearTimeout(timer);
      const body = await upstream.text().catch(() => '');
      this.log.warn(`AI stream ${upstream.status}: ${body.slice(0, 300)}`);
      throw new BadGatewayException(`سرویسِ هوشِ مصنوعی پاسخ نداد (${upstream.status}) — تنظیمات و کلید را بررسی کنید`);
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const emit = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    try {
      const ctype = upstream.headers.get('content-type') ?? '';
      if (!ctype.includes('text/event-stream')) {
        /* گیت‌ویِ بدونِ استریم — کلِ پاسخ یک‌جا می‌آید؛ همان را یک تکه می‌فرستیم. */
        const json: any = await upstream.json();
        const out = json?.choices?.[0]?.message?.content;
        if (typeof out === 'string' && out.trim()) emit({ d: out.trim() });
        else emit({ error: 'پاسخِ سرویسِ هوشِ مصنوعی خالی بود' });
      } else {
        const decoder = new TextDecoder('utf-8');
        let buf = '';
        for await (const chunk of upstream.body as any) {
          buf += decoder.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') { buf = ''; break; }
            try {
              const j = JSON.parse(data);
              const d = j?.choices?.[0]?.delta?.content;
              if (typeof d === 'string' && d) emit({ d });
            } catch { /* خطِ نیمه یا keep-alive — رد می‌شویم */ }
          }
        }
      }
      res.write('data: [DONE]\n\n');
    } catch (e: any) {
      this.log.warn(`AI stream وسطِ راه برید: ${e?.message ?? e}`);
      emit({ error: 'استریمِ سرویسِ هوشِ مصنوعی قطع شد — دوباره تلاش کنید' });
    } finally {
      clearTimeout(timer);
      res.end();
    }
  }

  /**
   * ساختِ خودکارِ **قالبِ** شرح برای یک عمل/تشخیص/موضوع — از روی شرح‌های
   * موجودِ خودِ مطب (تا ۵ نمونه). خروجی متنِ قالبِ بازمصرف‌شونده است با
   * جای‌خالیِ «……» به‌جای داده‌های بیمارِ خاص؛ ذخیره‌اش دستِ ادمین است
   * (همان فرمِ «قالب‌های شرح» در تعریف‌ها).
   */
  async templateDraft(user: any, dto: { kind: string; procedureTypeId?: number; diagnosisId?: number; topicId?: number }) {
    this.assertClinical(user);
    if (!NOTE_KINDS.includes(dto.kind as any)) throw new BadRequestException('نوعِ شرح نامعتبر است');
    const cfg = await this.cfgOrThrow();

    const targets: string[] = [];
    const visitFilter: any = {};
    if (dto.procedureTypeId) {
      const p = await this.prisma.procedureType.findUnique({ where: { id: dto.procedureTypeId }, select: { name: true } });
      if (!p) throw new BadRequestException('نوعِ عملِ انتخابی یافت نشد');
      targets.push(`نوعِ عمل: ${p.name}`);
      visitFilter.procedureTypeId = dto.procedureTypeId;
    }
    if (dto.diagnosisId) {
      const d = await this.prisma.diagnosis.findUnique({ where: { id: dto.diagnosisId }, select: { title: true } });
      if (!d) throw new BadRequestException('تشخیصِ انتخابی یافت نشد');
      targets.push(`تشخیص: ${d.title}`);
      visitFilter.diagnosisId = dto.diagnosisId;
    }
    if (dto.topicId) {
      const t = await this.prisma.visitTopic.findUnique({ where: { id: dto.topicId }, select: { name: true } });
      if (!t) throw new BadRequestException('موضوعِ انتخابی یافت نشد');
      targets.push(`موضوعِ ویزیت: ${t.name}`);
      visitFilter.topicId = dto.topicId;
    }

    const examples = await this.prisma.clinicalNote.findMany({
      where: {
        kind: dto.kind, replacedAt: null,
        ...(Object.keys(visitFilter).length ? { visit: visitFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { body: true },
    });

    const kindFa = KIND_FA[dto.kind] ?? dto.kind;
    const system = [
      `تو دستیارِ مستندسازیِ بالینی هستی. وظیفه: یک **قالبِ بازمصرف‌شونده** برای «${kindFa}» بساز که پزشک هر بار پُرش کند.`,
      'قاعده‌ها:',
      '- سرفصل‌های استانداردِ همین نوعِ سند را بیاور و جای هر دادهٔ متغیر «……» بگذار.',
      '- هیچ دادهٔ بیمارِ خاص (نام، تاریخ، عددِ واقعی) در قالب نماند — قالب است، نه سند.',
      '- مختصر و کاربردی؛ خروجی فقط متنِ قالب باشد، بدونِ مقدمه و توضیح.',
      examples.length
        ? `ساختار را از شرح‌های واقعیِ همین کلینیک دربیاور (سرفصل‌های مشترکشان را نگه دار):\n${examples.map((e, i) => `— نمونهٔ ${i + 1}:\n${e.body.slice(0, 1000)}`).join('\n')}`
        : 'شرحِ قبلی‌ای در کار نیست — قالبِ استانداردِ رایج برای این نوع سند را بساز.',
    ].filter(Boolean).join('\n');
    const userMsg = targets.length ? `قالب برای:\n${targets.join('\n')}` : `قالبِ عمومی برای «${kindFa}».`;

    const body = await this.chat(cfg, system, userMsg);
    const title = [`قالبِ ${kindFa}`, ...targets.map((t) => t.split(': ')[1])].filter(Boolean).join(' — ');
    return { title, body, grounded: examples.length };
  }

  /** یک تماسِ chat/completions — با مهلتِ صریح و خطای قابلِ‌فهم. */
  private async chat(cfg: AiCfg, system: string, user: string): Promise<string> {
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
