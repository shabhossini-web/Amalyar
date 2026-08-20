import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../config/settings.service';
import { LEVEL } from '../common/levels';
import { NOTE_KINDS } from '../patients/record.service';
import { ServiceCodesService } from '../patients/service-codes.service';
import { textSearchOr } from '../common/search';

const KIND_FA: Record<string, string> = {
  history: 'شرحِ حال', visit: 'شرحِ ویزیت', op: 'شرحِ عمل',
  progress: 'سیرِ بیماری', discharge: 'خلاصهٔ ترخیص', consult: 'مشاوره',
};

type AiCfg = { baseUrl: string; apiKey: string; model: string; models: { chat: string; vision: string; stt: string; tts: string; image: string }; prompts: { note: string; template: string; assistant: string; voice: string } };
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
    private serviceCodes: ServiceCodesService,
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
    return {
      enabled: cfg.enabled,
      model: cfg.enabled ? cfg.models.chat : null,
      /* دستیارِ صوتی فقط وقتی مدلِ گفتار-به-متن هم معلوم است. */
      stt: cfg.enabled && !!cfg.models.stt,
      /* «tenant» = تنظیمِ خودِ شرکت؛ «central» = وراثت از مادر. */
      source: (cfg as any).source ?? (cfg.enabled ? 'tenant' : 'off'),
    };
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
      ])
      .concat(cfg.prompts?.note ? [`دستورِ اختصاصیِ این کلینیک:\n${cfg.prompts.note}`] : [])
      .concat(await this.feedbackBlock(dto.kind))
      .filter(Boolean).join('\n');

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
    const out = await this.chat({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.models.chat }, system, userMsg);
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
    return this.streamCompletion(cfg, [
      { role: 'system', content: system },
      { role: 'user', content: userMsg },
    ], res);
  }

  /**
   * هستهٔ مشترکِ استریم — پیش‌نویسِ شرح و دستیارِ مدیریت هر دو از همین
   * می‌گذرند: upstream با stream:true، پروکسیِ SSE، fallbackِ بدونِ استریم،
   * و خطای پیش از شروع به‌شکلِ HTTPِ عادی.
   */
  private async streamCompletion(
    cfg: AiCfg,
    messages: { role: string; content: string }[],
    res: Response,
  ) {
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
          model: cfg.models.chat,
          temperature: 0.3,
          max_tokens: 1500,
          stream: true,
          messages,
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
      cfg.prompts?.template ? `دستورِ اختصاصیِ این کلینیک:\n${cfg.prompts.template}` : '',
    ].filter(Boolean).join('\n');
    const userMsg = targets.length ? `قالب برای:\n${targets.join('\n')}` : `قالبِ عمومی برای «${kindFa}».`;

    const body = await this.chat({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.models.chat }, system, userMsg);
    const title = [`قالبِ ${kindFa}`, ...targets.map((t) => t.split(': ')[1])].filter(Boolean).join(' — ');
    return { title, body, grounded: examples.length };
  }

  /**
   * دستیارِ مدیریت (#52) — چتِ استریمی برای مدیر (سطحِ ۵+): مشاورِ
   * نرم‌افزار (نقشهٔ صفحه‌ها و مسیرها) + آگاه از وضعیتِ لحظه‌ایِ سامانه
   * (صفِ تاییدِ فرم‌ها، نوبت‌های امروز، عمل‌های بی‌وضعیت). مسیرها را به
   * شکلِ /app/... می‌گوید تا کلاینت لینکِ کلیک‌شدنی کند — **هیچ اقدامی را
   * خودش انجام نمی‌دهد**؛ راه را نشان می‌دهد و داده را جلوی چشم می‌آورد.
   */
  async assistantStream(user: any, rawMessages: unknown, res: Response) {
    if ((user?.level ?? 0) < LEVEL.ADMIN) {
      throw new ForbiddenException('دستیارِ مدیریت فقط برای ادمین به بالاست');
    }
    const cfg = await this.cfgOrThrow();

    const msgs = (Array.isArray(rawMessages) ? rawMessages : [])
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-20)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') {
      throw new BadRequestException('پیامی برای دستیار نیست');
    }

    const system = [
      'تو «دستیارِ هوشمندِ» سامانهٔ مدیریتِ کلینیک هستی و با مدیرِ آن حرف می‌زنی. فارسی، مختصر و کاربردی جواب بده.',
      'وقتی کاری عملی خواسته شد (تاییدِ فرم، جستجو، ثبتِ نوبت…)، دادهٔ مربوط را از «وضعیتِ لحظه‌ای» بگو و مسیرِ صفحهٔ انجامش را دقیقاً به شکلِ /app/... بنویس — کلاینت آن را لینکِ کلیک‌شدنی می‌کند. خودت هیچ تغییری در داده نمی‌دهی.',
      'اگر چیزی را نمی‌دانی یا در وضعیتِ لحظه‌ای نیست، صادقانه بگو و مسیرِ صفحهٔ مربوط را بده.',
      '',
      'نقشهٔ نرم‌افزار (مشاورِ نرم‌افزار از روی همین جواب بده):',
      '- /app/dashboard — داشبورد: ثبت و جستجوی مراجعه‌ها، وضعیتِ عمل، صورت‌حساب و چاپِ فاکتور (رسمی/غیررسمی)، خروجیِ CSV.',
      '- /app/intake — ثبت‌نامِ بیماران: لینک‌های ثبت‌نام، **صفِ تاییدِ فرم‌ها** (تایید/رد)، کدهای تخفیف.',
      '- /app/calendar — تقویمِ شمسی + میزِ پذیرش: نوبت‌های روز، چرخهٔ حضور، «شروعِ ویزیت».',
      '- /app/schedule — برنامهٔ کاری: روزها و ساعت‌های باز، اسلات/ظرفیت، تعطیلی.',
      '- /app/reminders — دفترِ یادآوری‌ها: پیامک‌های در صف/رفته و ارسالِ سررسیده‌ها.',
      '- /app/accounting — حسابداری: قرارداد، تسویه، هزینه، خزانه، گزارشِ مالی.',
      '- /app/crm — تحلیل و CRM: نظرسنجی‌ها، روندِ ماهانه، بیمارانِ پیگیری‌نشده، CSV.',
      '- /app/notes — جستجوی بالینی: جستجو در همهٔ شرح‌ها با نوع/عمل/تشخیص/متن.',
      '- /app/letters — نامهٔ اداری: صدور با شمارهٔ خودکار و چاپ روی سربرگ.',
      '- /app/definitions — تعریف‌های پایه: جراح/بیمارستان/نوعِ عمل/تشخیص/قالب‌های شرح/کدهای داخلی و… .',
      '- /app/users — کاربران و سطحِ دسترسی. /app/settings — تنظیماتِ شرکت (پیامک‌ها، سربرگ، دستیارِ AI).',
      '- /app/patients/شناسه — پروندهٔ بیمار: مراجعه‌ها، مدارک، شرح‌ها (با دستیارِ شرح‌نویسی).',
      '',
      `وضعیتِ لحظه‌ایِ سامانه:\n${await this.assistantContext()}`,
      cfg.prompts?.assistant ? `دستورِ اختصاصیِ این کلینیک:\n${cfg.prompts.assistant}` : '',
    ].filter(Boolean).join('\n');

    return this.streamCompletion(cfg, [{ role: 'system', content: system }, ...msgs], res);
  }

  /** وضعیتِ لحظه‌ای — فقط چیزی که مدیر خودش هم در صفحه‌ها می‌بیند؛ کمینه و بدونِ شمارهٔ تماس. */
  private async assistantContext(): Promise<string> {
    const lines: string[] = [];
    try {
      const pending = await this.prisma.intakeSubmission.findMany({
        where: { status: 'pending_approval' },
        orderBy: { id: 'desc' },
        take: 8,
        select: {
          id: true, amount: true, createdAt: true,
          patient: { select: { firstName: true, lastName: true, code: true } },
        },
      });
      lines.push(`فرم‌های منتظرِ تایید: ${pending.length}${pending.length ? ' — ' + pending.map((x) =>
        `${x.patient ? `${x.patient.firstName} ${x.patient.lastName}` : 'بی‌نام'}${x.patient?.code ? ` (${x.patient.code})` : ''}`).join('، ') : ''}`);

      const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
      const appts = await this.prisma.appointment.findMany({
        where: { date: today, status: { in: ['held', 'confirmed', 'arrived'] } },
        orderBy: [{ startMin: { sort: 'asc', nulls: 'last' } }, { seq: { sort: 'asc', nulls: 'last' } }],
        take: 12,
        select: { startMin: true, seq: true, status: true, patient: { select: { firstName: true, lastName: true } } },
      });
      lines.push(`نوبت‌های امروز: ${appts.length}${appts.length ? ' — ' + appts.map((a) =>
        `${a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : 'بی‌نام'}${a.startMin != null ? ` ساعتِ ${Math.floor(a.startMin / 60)}:${String(a.startMin % 60).padStart(2, '0')}` : a.seq ? ` صف ${a.seq}` : ''}`).join('، ') : ''}`);

      const overdue = await this.prisma.visit.count({
        where: { kind: 'surgery', opStatus: 'pending', opDate: { lt: new Date() } },
      });
      lines.push(`عمل‌های گذشته ولی بی‌وضعیت (انجام شد/لغو نخورده): ${overdue}`);
    } catch (e: any) {
      this.log.warn(`assistantContext ناقص ماند: ${e?.message ?? e}`);
    }
    return lines.join('\n') || '—';
  }

  /**
   * پیش‌نویسِ مراقبتِ پس از عمل (#55) — با اشراف به همین مراجعه: نوعِ عمل،
   * تشخیص، شرحِ عمل، و قالبِ عمومیِ همان نوعِ عمل به‌عنوانِ پایه. خروجی متنِ
   * پیامک‌پذیرِ خطاب به بیمار است؛ فقط پیش‌نویس — تا جراح ذخیره نکند چیزی
   * نمی‌رود.
   */
  async careDraft(user: any, visitId: number) {
    this.assertClinical(user);
    const cfg = await this.cfgOrThrow();
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId },
      select: {
        id: true, opType: true, postOpCare: true,
        procedureType: { select: { name: true, postOpCare: true } },
        diagnosis: { select: { title: true } },
        clinicalNotes: {
          where: { replacedAt: null, kind: 'op' },
          orderBy: { createdAt: 'desc' },
          take: 2,
          select: { body: true },
        },
      },
    });
    if (!visit) throw new BadRequestException('مراجعه پیدا نشد');

    const procName = visit.procedureType?.name ?? visit.opType ?? '';
    const base = visit.procedureType?.postOpCare?.trim();
    const opText = visit.clinicalNotes.map((n) => n.body).join('\n').slice(0, 4000);

    const system = [
      'تو دستیارِ بالینی هستی. متنِ «مراقبت‌های پس از عمل» را برای پیامک به **خودِ بیمار** بنویس — فارسیِ ساده، محترمانه، جمله‌های کوتاه و عملی.',
      'قاعده‌ها:',
      '- فقط توصیه‌های مرتبط با همین عمل و همین شرح؛ داروی مشخص یا دوز اختراع نکن — اگر در شرح نیامده، «طبقِ دستورِ پزشک» بنویس.',
      '- سقفِ حدودِ ۶۰۰ نویسه؛ فهرست‌وار با خطِ جدا.',
      '- خروجی فقط متنِ مراقبت باشد، بدونِ مقدمه.',
      base ? `قالبِ عمومیِ همین نوعِ عمل (پایه بگیر و با شرح شخصی‌سازی کن):\n${base}` : '',
      cfg.prompts?.note ? `دستورِ اختصاصیِ این کلینیک:\n${cfg.prompts.note}` : '',
      ...(await this.feedbackBlock('care')),
    ].filter(Boolean).join('\n');
    const userMsg = [
      procName ? `نوعِ عمل: ${procName}` : '',
      visit.diagnosis?.title ? `تشخیص: ${visit.diagnosis.title}` : '',
      opText ? `شرحِ عمل:\n${opText}` : 'شرحِ عمل هنوز ثبت نشده.',
    ].filter(Boolean).join('\n');

    const text = await this.chat({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.models.chat }, system, userMsg);
    return { text };
  }

  /**
   * خلاصهٔ پرونده برای ارجاع (#53) — از مراجعه‌ها و شرح‌های جاریِ همان
   * بیمار، یک خلاصهٔ حرفه‌ایِ ارجاع می‌سازد. کمینه‌سازیِ هویت: نام/شماره/کدِ
   * ملی نمی‌رود — فقط سن و جنسیت و دادهٔ بالینی؛ در متنِ خروجی هم «بیمار»
   * خطاب می‌شود. ذخیره نمی‌کند — متن برمی‌گردد و ثبتش (مثلاً به‌عنوانِ
   * «مشاوره») با خودِ پزشک است.
   */
  async recordSummary(user: any, patientId: number) {
    this.assertClinical(user);
    const cfg = await this.cfgOrThrow();
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, birthDate: true, gender: true },
    });
    if (!patient) throw new BadRequestException('پرونده پیدا نشد');

    const visits = await this.prisma.visit.findMany({
      where: { patientId },
      orderBy: [{ opDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: 10,
      select: {
        kind: true, opDate: true, opStatus: true, opType: true, nextVisitDate: true,
        procedureType: { select: { name: true } },
        diagnosis: { select: { title: true } },
        topic: { select: { name: true } },
      },
    });
    const notes = await this.prisma.clinicalNote.findMany({
      where: { patientId, replacedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { kind: true, body: true, createdAt: true },
    });
    if (!visits.length && !notes.length) throw new BadRequestException('پرونده هنوز چیزی برای خلاصه‌کردن ندارد');

    const age = patient.birthDate
      ? Math.floor((Date.now() - new Date(patient.birthDate).getTime()) / (365.25 * 864e5))
      : null;
    const gender = patient.gender === 'male' ? 'مرد' : patient.gender === 'female' ? 'زن' : null;

    const dataBlock = [
      [age ? `سن: ${age}` : '', gender ? `جنسیت: ${gender}` : ''].filter(Boolean).join('؛ '),
      'مراجعه‌ها (تازه‌ترین اول):',
      ...visits.map((v) => `- ${v.opDate ? v.opDate.toISOString().slice(0, 10) : 'بی‌تاریخ'} | ${v.procedureType?.name ?? v.opType ?? v.kind}${v.diagnosis?.title ? ` | تشخیص: ${v.diagnosis.title}` : ''}${v.topic?.name ? ` | ${v.topic.name}` : ''} | وضعیت: ${v.opStatus}`),
      'شرح‌های جاری:',
      ...notes.map((n) => `— [${KIND_FA[n.kind] ?? n.kind}] ${n.body.slice(0, 800)}`),
    ].filter(Boolean).join('\n');

    const system = [
      'تو دستیارِ مستندسازیِ بالینی هستی. از داده‌های زیر یک **خلاصهٔ ارجاعِ** حرفه‌ایِ فارسی بساز — برای همکارِ پزشکی که این بیمار را نمی‌شناسد.',
      'قاعده‌ها:',
      '- ساختار: معرفیِ کوتاه (سن/جنسیت)، سیرِ بیماری و اقداماتِ انجام‌شده به ترتیبِ زمان، وضعیتِ فعلی، و نکته‌های لازم برای ادامهٔ درمان.',
      '- بیمار را فقط «بیمار» خطاب کن — نام نبر.',
      '- فقط از همین داده‌ها؛ هیچ یافته‌ای اختراع نکن. تاریخ‌ها را همان‌طور که هست بیاور.',
      '- خروجی فقط متنِ خلاصه باشد.',
      cfg.prompts?.note ? `دستورِ اختصاصیِ این کلینیک:\n${cfg.prompts.note}` : '',
    ].filter(Boolean).join('\n');

    const text = await this.chat({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.models.chat }, system, dataBlock);
    return { text };
  }

  /**
   * پیشنهادِ کدِ خدمت از متنِ شرح (#53) — نامزدها فقط کدهای **واقعاً موجود**اند
   * (کدهای داخلیِ مطب + نتیجهٔ جستجوی کتاب با نامِ عمل)؛ هر کدی که مدل بگوید
   * ولی در نامزدها نباشد دور ریخته می‌شود — پیشنهادِ ساختگی به فاکتور راه ندارد.
   */
  async suggestCodes(user: any, visitId: number) {
    this.assertClinical(user);
    const cfg = await this.cfgOrThrow();
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId },
      select: {
        id: true, opType: true,
        procedureType: { select: { name: true } },
        clinicalNotes: {
          where: { replacedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 4,
          select: { kind: true, body: true },
        },
      },
    });
    if (!visit) throw new BadRequestException('مراجعه پیدا نشد');
    const noteText = visit.clinicalNotes.map((n) => n.body).join('\n').slice(0, 5000);
    if (!noteText.trim()) throw new BadRequestException('این مراجعه هنوز شرحی ندارد که از آن کد پیشنهاد شود');

    const internal = await this.prisma.internalCode.findMany({
      where: { active: true },
      take: 100,
      select: { code: true, name: true, price: true },
    });
    const procName = visit.procedureType?.name ?? visit.opType ?? '';
    const book = procName ? await this.serviceCodes.search(procName, 20).catch(() => []) : [];

    const candidates = [
      ...internal.map((c) => ({ code: c.code, title: c.name, codeSystem: 'internal' as const, price: c.price })),
      ...(book as any[]).map((c) => ({ code: String(c.code), title: c.title ?? '', codeSystem: 'book' as const, price: null })),
    ];
    if (!candidates.length) throw new BadRequestException('نه کدِ داخلی تعریف شده نه کدی از کتاب پیدا شد');

    const system = [
      'تو دستیارِ صورت‌حسابِ یک کلینیک هستی. از شرحِ انجام‌شده، کدهای خدمتِ مناسب را فقط از فهرستِ نامزدها انتخاب کن.',
      '- فقط کدهایی که واقعاً با کارِ انجام‌شده می‌خوانند؛ حدسِ اضافه نزن.',
      '- خروجی: هر کد در یک خط، فقط خودِ کد. اگر هیچ‌کدام نمی‌خواند بنویس: هیچ.',
      'نامزدها:',
      ...candidates.map((c) => `${c.code} — ${c.title}${c.codeSystem === 'internal' ? ' (داخلی)' : ''}`),
    ].join('\n');
    const userMsg = `${procName ? `نوعِ عمل: ${procName}\n` : ''}شرح:\n${noteText}`;

    const reply = await this.chat({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.models.chat }, system, userMsg);
    /* اعتبارسنجیِ سخت: فقط نامزدهایی که کدشان در جواب آمده — توهم حذف. */
    const suggestions = candidates.filter((c) => reply.includes(c.code)).slice(0, 8);
    return { suggestions, raw: undefined };
  }

  /**
   * «یادگیری از اصلاح‌های کاربر» — چند نمونهٔ اخیرِ (پیش‌نویسِ دستیار ←
   * متنِ نهاییِ ویرایش‌شده) از همین کلینیک، به‌عنوانِ راهنمای سلیقه در
   * prompt. retrieval است، نه آموزشِ مدل؛ هیچ داده‌ای برای «یادگیری» به
   * سرویسِ بیرونی سپرده نمی‌شود — فقط همراهِ همان درخواست می‌رود.
   */
  private async feedbackBlock(kind: string): Promise<string[]> {
    const rows = await this.prisma.aiFeedback.findMany({
      where: { kind },
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: { draft: true, final: true },
    }).catch(() => []);
    if (!rows.length) return [];
    const cut = (s: string) => s.trim().slice(0, 700);
    return [[
      'کاربر پیش‌نویس‌های قبلی را این‌طور اصلاح کرده — این سلیقه را رعایت کن:',
      ...rows.map((r, i) => `— اصلاحِ ${i + 1}:\nپیش‌نویسِ دستیار:\n${cut(r.draft)}\nنسخهٔ نهاییِ کاربر:\n${cut(r.final)}`),
    ].join('\n')];
  }

  /**
   * ثبتِ یک جفتِ (پیش‌نویس، نهایی) وقتی کاربر متنِ دستیار را دستی اصلاح
   * کرده و ذخیره زده. متنِ یکسان سیگنالی ندارد و نگه داشته نمی‌شود؛ دفتر
   * به ۱۰۰ ردیفِ اخیر هرس می‌شود تا بی‌انتها نروید.
   */
  async feedback(user: any, dto: { kind?: string; draft?: string; final?: string }) {
    this.assertClinical(user);
    const kind = (dto.kind ?? '').trim();
    const draft = (dto.draft ?? '').trim();
    const final = (dto.final ?? '').trim();
    if (!kind || kind.length > 30) throw new BadRequestException('نوعِ بازخورد نامعتبر است');
    if (!draft || !final) throw new BadRequestException('پیش‌نویس و متنِ نهایی هر دو لازم‌اند');
    if (draft === final) return { saved: false };
    await this.prisma.aiFeedback.create({
      data: { kind, draft: draft.slice(0, 8000), final: final.slice(0, 8000) },
    });
    const extra = await this.prisma.aiFeedback.findMany({
      orderBy: { createdAt: 'desc' }, skip: 100, select: { id: true },
    });
    if (extra.length) await this.prisma.aiFeedback.deleteMany({ where: { id: { in: extra.map((x) => x.id) } } });
    return { saved: true };
  }

  /**
   * گفتار → متن (ویسپر) — فایلِ ضبط‌شدهٔ مرورگر به `audio/transcriptions`ِ
   * همان گیت‌وی می‌رود. ضبط سمتِ کلاینت با MediaRecorder است تا اندروید و
   * آیفون رفتارِ یکسان داشته باشند (نه SpeechRecognition مرورگر).
   */
  async transcribe(user: any, file?: { buffer: Buffer; mimetype?: string; originalname?: string; size?: number }) {
    this.assertClinical(user);
    const cfg = await this.cfgOrThrow();
    if (!cfg.models.stt) {
      throw new BadRequestException('مدلِ گفتار به متن تنظیم نشده — تنظیماتِ شرکت، بخشِ «دستیارِ هوشِ مصنوعی»');
    }
    if (!file?.buffer?.length) throw new BadRequestException('فایلِ صدا نرسید');

    const name = file.originalname || (file.mimetype?.includes('mp4') ? 'voice.m4a' : 'voice.webm');
    /* پسوندِ ";codecs=opus" را بعضی گیت‌وی‌ها به‌عنوانِ content-typeِ پارت رد می‌کنند. */
    const partType = (file.mimetype || 'audio/webm').split(';')[0].trim();

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 120_000);
    /* گیت‌وی‌های سازگار با OpenAI همه یک‌جور سخت‌گیر نیستند: بعضی فیلدهای
       اختیاری (language/response_format) را نمی‌شناسند و 400 می‌دهند. اول
       درخواستِ کامل؛ اگر 400/415/422 گرفت، یک‌بار با فرمِ حداقلی
       (فقط file + model) دوباره. */
    const post = (minimal: boolean) => {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(file.buffer)], { type: partType }), name);
      form.append('model', cfg.models.stt);
      if (!minimal) {
        form.append('language', 'fa');
        form.append('response_format', 'json');
      }
      return fetch(`${cfg.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        signal: ctl.signal,
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        body: form,
      });
    };
    try {
      let res = await post(false);
      if (!res.ok && [400, 415, 422].includes(res.status)) {
        const body = await res.text().catch(() => '');
        this.log.warn(`STT ${res.status} (فرمِ کامل): ${body.slice(0, 300)} — تلاشِ دوباره با فرمِ حداقلی`);
        res = await post(true);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.log.warn(`STT ${res.status}: ${body.slice(0, 300)}`);
        /* پیامِ خودِ گیت‌وی به کاربر می‌رسد — بدونش «۴۰۰» قابلِ عیب‌یابی نیست
           (نامِ مدلِ اشتباه؟ کلید؟ فرمتِ صدا؟). */
        let detail = '';
        try { const j: any = JSON.parse(body); detail = j?.error?.message ?? j?.message ?? ''; } catch { detail = body; }
        detail = String(detail || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        throw new BadGatewayException(
          `سرویسِ گفتار به متن پاسخ نداد (${res.status})${detail ? ` — پیامِ سرویس: ${detail}` : ''} — مدلِ ویسپر و کلید را بررسی کنید`,
        );
      }
      const json: any = await res.json().catch(() => null);
      const text = typeof json?.text === 'string' ? json.text.trim() : '';
      if (!text) throw new BadGatewayException('متنی از سرویسِ گفتار به متن برنگشت');
      return { text };
    } catch (e: any) {
      if (e instanceof BadGatewayException) throw e;
      this.log.warn(`STT fetch شکست خورد: ${e?.message ?? e}`);
      throw new BadGatewayException('دسترسی به سرویسِ گفتار به متن برقرار نشد — نشانیِ پایه و شبکه را بررسی کنید');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * دستیارِ جستجوی بالینی — پرسشِ زبانِ طبیعی («بیمارانی که کمرا پورتِ ۵ یا
   * بیشتر…»، «چند درصد گرسپر داشتند؟») روی شرح‌های همهٔ پرونده‌ها.
   *
   * دو مرحله: (۱) مدل پرسش را به «طرحِ جستجو» ترجمه می‌کند — کلیدواژه‌ها با
   * مترادف/املاهای رایج، نوعِ شرح، حالتِ فهرست/آمار؛ (۲) سرور نامزدها را با
   * همان جستجوی متنیِ کانونی می‌کشد و مدل فقط **شماره‌ی** شرح‌های منطبق را
   * برمی‌گرداند. اعداد (صورت/مخرج/درصد) همه سمتِ سرورند — مدل عدد نمی‌سازد.
   * کمینه‌سازی: به مدل فقط متنِ شرح‌های شماره‌دار می‌رسد؛ نه نام، نه کد، نه
   * شماره‌ای از بیمار.
   */
  async notesQuery(user: any, dto: { question?: string }) {
    this.assertClinical(user);
    const question = (dto.question ?? '').trim();
    if (!question) throw new BadRequestException('پرسشی ننوشته‌اید');
    const cfg = await this.cfgOrThrow();
    const chatCfg = { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.models.chat };
    const fa = (n: number) => n.toLocaleString('fa-IR');
    const parseJson = (reply: string): any => {
      const m = reply.match(/\{[\s\S]*\}/);
      if (!m) throw new BadGatewayException('پاسخِ دستیار قابلِ خواندن نبود');
      try { return JSON.parse(m[0]); } catch { throw new BadGatewayException('پاسخِ دستیار قابلِ خواندن نبود'); }
    };

    /* مرحلهٔ ۱: پرسش → طرحِ جستجو. */
    const planSys = [
      'تو مترجمِ پرسشِ بالینی به «طرحِ جستجو» هستی. از پرسشِ کاربر فقط یک JSON با این شکل بساز:',
      '{"keywords":["..."],"kind":null,"mode":"list","criterion":"..."}',
      '- keywords: ۲ تا ۸ کلیدواژهٔ کوتاه برای پیداکردنِ شرح‌های نامزد در جستجوی متنی — حتماً مترادف‌ها و املاهای رایجِ فارسی و انگلیسیِ همان اصطلاح را هم بیاور (مثلاً «گرسپر، گراسپر, grasper»). شرطِ عددی را در کلیدواژه نیاور؛ فقط خودِ اصطلاح.',
      `- kind: اگر پرسش دربارهٔ نوعِ شرحِ مشخصی است یکی از (${NOTE_KINDS.join(' | ')})، وگرنه null.`,
      '- mode: اگر پرسش آماری است (چند درصد؟ چند نفر؟ چندتا؟) "stats"، وگرنه "list".',
      '- criterion: خودِ شرط، به فارسیِ دقیق و کامل، برای داوریِ تک‌تکِ شرح‌ها (مثلاً «کمرا پورتِ ۵ یا بزرگ‌تر استفاده شده باشد»).',
      'خروجی فقط JSON — بدونِ توضیح.',
    ].join('\n');
    const plan = parseJson(await this.chat(chatCfg, planSys, question));
    const keywords: string[] = (Array.isArray(plan.keywords) ? plan.keywords : [])
      .filter((k: unknown): k is string => typeof k === 'string' && k.trim().length > 0)
      .map((k: string) => k.trim().slice(0, 60))
      .slice(0, 8);
    if (!keywords.length) throw new BadGatewayException('دستیار کلیدواژه‌ای از پرسش درنیاورد — پرسش را دقیق‌تر بنویسید');
    const kind = NOTE_KINDS.includes(plan.kind) ? (plan.kind as string) : undefined;
    const mode: 'list' | 'stats' = plan.mode === 'stats' ? 'stats' : 'list';
    const criterion = typeof plan.criterion === 'string' && plan.criterion.trim() ? plan.criterion.trim() : question;

    /* نامزدها — سقف‌دار؛ سقف در پاسخ اعلام می‌شود تا «همه را دیدم» جا نزند. */
    const CAND = 60;
    const candidates = await this.prisma.clinicalNote.findMany({
      where: {
        replacedAt: null,
        ...(kind ? { kind } : {}),
        OR: keywords.flatMap((k) => textSearchOr(k, ['body'])),
      },
      orderBy: { createdAt: 'desc' },
      take: CAND,
      select: {
        id: true, kind: true, body: true, patientId: true, createdAt: true,
        patient: { select: { code: true, firstName: true, lastName: true } },
        visit: { select: { seq: true } },
      },
    });
    /* مخرجِ آمار: کلِ بیمارانی که اصلاً شرحی (از همان نوع، اگر معلوم است) دارند. */
    const total = mode === 'stats'
      ? (await this.prisma.clinicalNote.findMany({
        where: { replacedAt: null, ...(kind ? { kind } : {}) },
        distinct: ['patientId'], select: { patientId: true },
      })).length
      : 0;

    if (!candidates.length) {
      return {
        answer: 'با این کلیدواژه‌ها شرحی پیدا نشد — اصطلاحِ دیگری را امتحان کنید.',
        mode, keywords, criterion,
        stats: mode === 'stats' ? { matched: 0, total, percent: 0 } : null,
        matches: [], scanned: 0, capped: false,
      };
    }

    /* مرحلهٔ ۲: داوریِ شرط روی نامزدهای شماره‌دار — بدونِ هویتِ بیمار. */
    const judgeSys = [
      'شرح‌های بالینیِ شماره‌دار را بخوان و فقط شماره‌هایی که **قطعاً با شرط می‌خوانند** را برگردان.',
      'قاعده‌ها:',
      '- نفی یعنی نامنطبق: «بدونِ گرسپر» یا «استفاده نشد» انتخاب نمی‌شود.',
      '- شرطِ عددی را دقیق بسنج (۵ یا بیشتر یعنی ۵ هم قبول است).',
      '- اگر مطمئن نیستی، آن شماره را نیاور.',
      'خروجی فقط JSON: {"matches":[1,4],"summary":"یک جملهٔ کوتاه دربارهٔ یافته‌ها"}',
    ].join('\n');
    const judgeUser = [
      `شرط: ${criterion}`,
      ...candidates.map((c, i) => `— شرحِ ${i + 1} (${KIND_FA[c.kind] ?? c.kind}):\n${c.body.slice(0, 500)}`),
    ].join('\n\n');
    const judged = parseJson(await this.chat(chatCfg, judgeSys, judgeUser));
    const picked = (Array.isArray(judged.matches) ? judged.matches : [])
      .map((n: unknown) => Number(n))
      .filter((n: number) => Number.isInteger(n) && n >= 1 && n <= candidates.length);
    const chosen = [...new Set(picked)].map((n) => candidates[(n as number) - 1]);
    const patientIds = [...new Set(chosen.map((c) => c.patientId))];
    const summary = typeof judged.summary === 'string' ? judged.summary.trim().slice(0, 300) : '';

    const capped = candidates.length === CAND;
    const stats = mode === 'stats'
      ? { matched: patientIds.length, total, percent: total ? Math.round((patientIds.length / total) * 100) : 0 }
      : null;
    /* اعداد را سرور می‌گوید؛ جمله‌بندیِ مدل فقط چاشنی است. */
    const answer = [
      stats
        ? `${fa(stats.matched)} از ${fa(stats.total)} بیمار (${fa(stats.percent)}٪) با این شرط می‌خوانند.`
        : `${fa(patientIds.length)} بیمار (${fa(chosen.length)} شرح) با این شرط پیدا شد.`,
      summary,
      capped ? `(داوری از میانِ ${fa(CAND)} شرحِ نامزدِ اخیر — برای پوششِ کامل، پرسش را محدودتر کنید.)` : '',
    ].filter(Boolean).join(' ');

    return {
      answer, mode, keywords, criterion, stats,
      matches: chosen.slice(0, 30).map((c) => ({
        noteId: c.id,
        patientId: c.patientId,
        patientName: `${c.patient?.firstName ?? ''} ${c.patient?.lastName ?? ''}`.trim() || null,
        patientCode: c.patient?.code ?? null,
        visitCode: c.visit && c.patient?.code ? `${c.patient.code}-V${c.visit.seq}` : null,
        kind: c.kind,
        snippet: c.body.slice(0, 200),
      })),
      scanned: candidates.length, capped,
    };
  }

  /**
   * تحلیلِ دیکتهٔ «ثبتِ بیمارِ جدید» — متنِ ویسپر‌شده را دستیارِ متنی به
   * فیلدهای فرم تبدیل می‌کند (قابلِ پرامپت با `ai_prompt_voice`). فقط
   * پیشنهاد است؛ تا کاربر ذخیره نزند چیزی ثبت نمی‌شود.
   */
  async parsePatient(user: any, dto: { text?: string }) {
    this.assertClinical(user);
    const text = (dto.text ?? '').trim();
    if (!text) throw new BadRequestException('متنی برای تحلیل نیست');
    const cfg = await this.cfgOrThrow();

    const system = [
      'تو دستیارِ پذیرشِ یک کلینیک هستی. از متنِ دیکته‌شدهٔ فارسی، فیلدهای بیمارِ جدید را استخراج کن.',
      'خروجی فقط یک شیءِ JSON با همین کلیدها باشد (کلیدِ بی‌مقدار را نیاور):',
      '{"firstName":"","lastName":"","phone":"","nationalId":"","notes":""}',
      '- phone و nationalId را با ارقامِ لاتین (0-9) بنویس؛ شمارهٔ موبایل با 09 شروع می‌شود.',
      '- هرچه به فیلدها نخورد (شرحِ شکایت، توضیح) را در notes بگذار.',
      '- هیچ چیزی اختراع نکن؛ فقط از خودِ متن.',
      cfg.prompts?.voice ? `دستورِ اختصاصیِ این کلینیک:\n${cfg.prompts.voice}` : '',
    ].filter(Boolean).join('\n');

    const reply = await this.chat({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.models.chat }, system, text.slice(0, 4000));
    /* مدل گاهی JSON را داخلِ ``` می‌پیچد — اولین { تا آخرین } را برمی‌داریم. */
    const m = reply.match(/\{[\s\S]*\}/);
    if (!m) throw new BadGatewayException('پاسخِ دستیار قابلِ خواندن نبود');
    let parsed: any;
    try { parsed = JSON.parse(m[0]); } catch { throw new BadGatewayException('پاسخِ دستیار قابلِ خواندن نبود'); }
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    return {
      fields: {
        firstName: str(parsed.firstName, 80),
        lastName: str(parsed.lastName, 80),
        phone: str(parsed.phone, 20).replace(/[^0-9+]/g, ''),
        nationalId: str(parsed.nationalId, 12).replace(/[^0-9]/g, ''),
        notes: str(parsed.notes, 2000),
      },
    };
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
