import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../config/settings.service';
import { LEVEL } from '../common/levels';

/** صداهای سازگار با `/audio/speech`ِ OpenAI — گیت‌وی‌ها همین نام‌ها را برای Gemini هم می‌پذیرند. */
export const VOICE_LAB_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'] as const;

export type VoiceLabDto = {
  text: string;
  mode: 'read' | 'reply';
  ttsModel?: string;
  chatModel?: string;
  voice?: string;
  speed?: number;
  style?: string;
  persona?: string;
};

const RX_TTS = /tts|speech|eleven|playai/i;
const RX_NOT_CHAT = /tts|speech|eleven|playai|whisper|transcrib|scribe|embed|dall-?e|image|imagen|moderation|rerank|veo|sora|midjourney|flux/i;

/**
 * آزمایشگاهِ صدای منشی — ابزارِ آزمونِ ادمین برای انتخابِ مدلِ صدا، مدلِ استدلال و لحن.
 *
 * هیچ چیزی ذخیره نمی‌شود و هیچ دادهٔ بیماری به سرویس نمی‌رود؛ فقط متنی که خودِ ادمین
 * نوشته. کلید و نشانی همان پیکربندیِ «دستیارِ هوشِ مصنوعی» است (با وراثت از مادر).
 */
@Injectable()
export class VoiceLabService {
  private readonly log = new Logger('VoiceLab');

  constructor(private settings: SettingsService) {}

  private assertAdmin(user: any) {
    if ((user?.level ?? 0) < LEVEL.ADMIN) throw new ForbiddenException('آزمایشگاهِ صدا فقط برای ادمین است');
  }

  private async creds() {
    const cfg = await this.settings.ai();
    if (!cfg.baseUrl || !cfg.apiKey) {
      throw new BadRequestException('نشانی و کلیدِ سرویسِ هوشِ مصنوعی تنظیم نشده — همین صفحه، بخشِ «دستیارِ هوشِ مصنوعی»');
    }
    return cfg;
  }

  /** فهرستِ مدل‌های ارائه‌دهنده، جدا برای صدا و گفتگو، به‌علاوهٔ پیش‌فرض‌های همین شرکت. */
  async models(user: any) {
    this.assertAdmin(user);
    const cfg = await this.creds();
    let ids: string[] = [];
    let error: string | null = null;
    try {
      const res = await this.fetchT(`${cfg.baseUrl}/models`, { headers: { Authorization: `Bearer ${cfg.apiKey}` } }, 20_000);
      if (!res.ok) error = `فهرستِ مدل‌ها خوانده نشد (${res.status}) — نامِ مدل را دستی بنویسید`;
      else {
        const j: any = await res.json().catch(() => null);
        const rows: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
        ids = [...new Set(rows.map((r) => String(r?.id ?? r ?? '').trim()).filter(Boolean))].slice(0, 600).sort();
      }
    } catch {
      error = 'سرویس برای فهرستِ مدل‌ها پاسخ نداد — نامِ مدل را دستی بنویسید';
    }
    return {
      tts: ids.filter((m) => RX_TTS.test(m)),
      chat: ids.filter((m) => !RX_NOT_CHAT.test(m)),
      voices: VOICE_LAB_VOICES,
      defaults: { tts: cfg.models.tts || '', chat: cfg.models.chat || '' },
      error,
    };
  }

  async speak(user: any, dto: VoiceLabDto) {
    this.assertAdmin(user);
    const cfg = await this.creds();
    const text = String(dto.text ?? '').trim();
    if (!text) throw new BadRequestException('متنی برای ساختنِ صدا نیست');
    const ttsModel = String(dto.ttsModel ?? '').trim() || cfg.models.tts;
    if (!ttsModel) throw new BadRequestException('مدلِ صدا را انتخاب کنید');
    const voice = VOICE_LAB_VOICES.includes(dto.voice as any) ? String(dto.voice) : 'nova';
    const speed = Math.min(2, Math.max(0.5, Number(dto.speed) || 1));
    const style = String(dto.style ?? '').trim();
    const notes: string[] = [];
    const ms: Record<string, number> = {};

    let spoken = text;
    if (dto.mode === 'reply') {
      const chatModel = String(dto.chatModel ?? '').trim() || cfg.models.chat;
      if (!chatModel) throw new BadRequestException('مدلِ استدلال را انتخاب کنید');
      const system = [
        'تو منشیِ تلفنیِ یک مرکزِ درمانی هستی و جوابت مستقیم با صدا پخش می‌شود.',
        'فارسیِ محاوره‌ایِ مؤدب، کوتاه (حداکثر سه جمله)، بی‌فهرست و بی‌علامتِ مارک‌داون.',
        'اعداد را با حروف بنویس. چیزی را که نمی‌دانی قول نده؛ بگو همکاران پیگیری می‌کنند.',
        style ? `لحنِ گفتار: ${style}` : '',
        String(dto.persona ?? '').trim() ? `دستورِ اختصاصی:\n${String(dto.persona).trim()}` : '',
      ].filter(Boolean).join('\n');
      const t0 = Date.now();
      spoken = await this.chat(cfg.baseUrl, cfg.apiKey, chatModel, system, text);
      ms.chat = Date.now() - t0;
    }

    const req: Record<string, unknown> = { model: ttsModel, input: spoken.slice(0, 4000), voice, response_format: 'mp3', speed };
    if (style) req.instructions = style;
    const t1 = Date.now();
    let res = await this.tts(cfg.baseUrl, cfg.apiKey, req);
    /* ارائه‌دهنده‌ای که «دستورِ لحن» یا «سرعت» را نشناسد نباید کلِ صدا را از کار بیندازد —
       یک بار بدونِ آن، و همان را صادقانه در `notes` می‌گوییم. */
    if (!res.ok && 'instructions' in req) {
      delete req.instructions;
      const r2 = await this.tts(cfg.baseUrl, cfg.apiKey, req);
      if (r2.ok) notes.push('این مدل «دستورِ لحن» را نپذیرفت؛ صدا بدونِ آن ساخته شد');
      res = r2.ok ? r2 : res;
    }
    if (!res.ok && speed !== 1) {
      delete req.speed;
      const r3 = await this.tts(cfg.baseUrl, cfg.apiKey, req);
      if (r3.ok) notes.push('این مدل «سرعت» را نپذیرفت؛ صدا با سرعتِ عادی ساخته شد');
      res = r3.ok ? r3 : res;
    }
    ms.tts = Date.now() - t1;
    if (!res.ok) throw new BadGatewayException(res.error);
    return { text: spoken, audio: res.audio.toString('base64'), mime: res.mime, bytes: res.audio.length, ms, notes, ttsModel, voice };
  }

  private async tts(baseUrl: string, apiKey: string, req: Record<string, unknown>):
    Promise<{ ok: true; audio: Buffer; mime: string } | { ok: false; error: string }> {
    try {
      const res = await this.fetchT(`${baseUrl}/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(req),
      }, 90_000);
      const ctype = res.headers.get('content-type') ?? '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok || ctype.includes('json') || buf.length < 200) {
        let msg = '';
        try { const j: any = JSON.parse(buf.toString('utf8')); msg = j?.error?.message ?? j?.detail ?? j?.message ?? ''; } catch { /* بدنهٔ غیرِ JSON */ }
        this.log.warn(`TTS ${res.status}: ${buf.toString('utf8').slice(0, 300)}`);
        return { ok: false, error: `مدلِ صدا پاسخ نداد (${res.status})${msg ? ': ' + String(msg).slice(0, 200) : ''}` };
      }
      return { ok: true, audio: buf, mime: ctype.split(';')[0] || 'audio/mpeg' };
    } catch (e: any) {
      this.log.warn(`TTS fetch شکست خورد: ${e?.message ?? e}`);
      return { ok: false, error: 'دسترسی به سرویسِ صدا برقرار نشد — نشانیِ پایه و شبکه را بررسی کنید' };
    }
  }

  private async chat(baseUrl: string, apiKey: string, model: string, system: string, user: string) {
    let res: Response;
    try {
      res = await this.fetchT(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model, temperature: 0.5, max_tokens: 600,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      }, 60_000);
    } catch {
      throw new BadGatewayException('دسترسی به مدلِ استدلال برقرار نشد — نشانیِ پایه و شبکه را بررسی کنید');
    }
    const j: any = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = j?.error?.message ?? '';
      throw new BadGatewayException(`مدلِ استدلال پاسخ نداد (${res.status})${msg ? ': ' + String(msg).slice(0, 200) : ''}`);
    }
    const out = String(j?.choices?.[0]?.message?.content ?? '').replace(/[*#`_>]+/g, '').trim();
    if (!out) throw new BadGatewayException('جوابِ مدلِ استدلال خالی بود');
    return out;
  }

  private async fetchT(url: string, init: RequestInit, timeout: number) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(timer); }
  }
}
