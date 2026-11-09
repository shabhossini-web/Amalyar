import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../config/settings.service';
import { InventoryService } from './inventory.service';
import { SetStockService } from './set-stock.service';

/**
 * دستیارِ انباردار (الف-۴ِ پیشنهادِ بازطراحی، تأییدِ مالک ۱۴۰۵/۰۸/۱۷).
 *
 * دو کار می‌کند: به سؤال‌ها از **دادهٔ واقعیِ همین انبار** جواب می‌دهد («چند تا الکترود داریم؟»، «ستِ SE-07 کجاست؟»)،
 * و از روی یک جمله **پیش‌نویس** می‌سازد («یه ست بساز با ۲۰ سوزن و ۲ کابل»).
 *
 * ⚠️ قاعدهٔ اصلی: مدل هیچ چیزی نمی‌نویسد. ابزارهایش فقط می‌خوانند یا «پیشنهاد» می‌دهند؛ پیشنهاد به‌صورتِ کارت به رابط
 * برمی‌گردد و فقط با «ثبت کن»ِ کاربر از همان مسیرهای عادیِ انبار (با مجوزهای خودشان) ثبت می‌شود. پس دستیار نه دورِ
 * مجوز می‌زند، نه عددی را بی‌خبر عوض می‌کند — همان قاعدهٔ «حسابدارِ هوشمند»ِ ملک‌طب.
 */
type Msg = { role: 'user' | 'assistant'; content: string };
export type StockAction =
  | { type: 'item'; name: string; assetKind: 'consumable' | 'device'; usageMode: 'single' | 'multi'; unit?: string; brand?: string; size?: string; showInTechPanel?: boolean }
  | { type: 'stock'; itemId: number | null; itemName: string; quantity: number; lotNo?: string; serialNo?: string; expiresJ?: string }
  | { type: 'set'; name: string; lines: { itemId: number | null; itemName: string; quantity: number }[] };

const MAX_ROUNDS = 6;
const MAX_HISTORY = 16;

const SYSTEM = `تو «دستیارِ انباردار»ِ یک شرکتِ خدماتِ جراحی هستی (نورومانیتورینگ، ست و دستگاهِ اتاقِ عمل). فارسیِ ساده و کوتاه بنویس.

مفهوم‌ها:
- «کالا» تعریف است (کاتالوگ) و خودش موجودی ندارد. «لات» خودِ جنس است: یک بچ با تاریخِ انقضا یا یک قلم با سریال.
- «ست» جعبه‌ای از موجودیِ خودمان است: اقلامش از انبار به ست منتقل می‌شوند و همچنان جزوِ کل‌اند ولی «آماده در انبار» نیستند.
- «مصرفیِ یک‌بارمصرف» با مصرف و خرابی از کل کم می‌شود؛ «چندبارمصرف» (کابل، پروب) و «دستگاه» برمی‌گردند.

قواعد:
1. هر عدد را فقط از ابزارها بگیر؛ حدس نزن. اگر ابزار چیزی پیدا نکرد، همین را بگو.
2. تو هیچ چیزی ثبت نمی‌کنی. برای تعریفِ کالا، ورودِ موجودی یا ساختنِ ست فقط ابزارهای propose_* را صدا بزن؛ کاربر پیش‌نویس را می‌بیند و خودش «ثبت» می‌زند. هرگز ننویس «ثبت شد».
3. پیش از پیشنهادِ موجودی یا ست، با search_items کالا را پیدا کن و itemId را بده. اگر کالا در کاتالوگ نیست، اول propose_item بده و در propose_stock/propose_set همان نام را با itemId خالی بگذار.
4. ست فقط از موجودیِ آماده ساخته می‌شود؛ اگر کم است بگو چقدر کم است.
5. تاریخِ انقضا را شمسی و کامل بنویس (۱۴۰۶/۰۷/۳۰). اگر فقط ماه گفته شد، روزِ آخرِ همان ماه (ماه ۱ تا ۶: ۳۱، ۷ تا ۱۱: ۳۰، ۱۲: ۲۹).
6. جوابِ آخر یک یا دو جملهٔ کوتاه باشد؛ پیش‌نویس‌ها خودشان به‌صورتِ کارت دیده می‌شوند و لازم نیست تکرارشان کنی.`;

const TOOLS = [
  fn('search_items', 'جستجو در کاتالوگ با موجودیِ آماده و آنچه داخلِ ست‌هاست', { q: { type: 'string', description: 'نام، برند یا کد' } }, ['q']),
  fn('item_lots', 'لات‌های یک کالا: شمارهٔ لات، انقضا، آماده، بیرون', { itemId: { type: 'integer' } }, ['itemId']),
  fn('find_sets', 'ست‌ها با محل، کامل/کسری و محتویات', { q: { type: 'string', description: 'سریال یا نامِ ست؛ خالی = همه' } }, []),
  fn('expiring', 'لات‌های دارای موجودی که تا N روزِ دیگر منقضی می‌شوند', { days: { type: 'integer' } }, ['days']),
  fn('damaged', 'اقلامی که در «خرابی‌ها» منتظرِ اسقاط یا تعمیرند', {}, []),
  fn('propose_item', 'پیش‌نویسِ تعریفِ کالای تازه (ثبت نمی‌کند)', {
    name: { type: 'string' }, assetKind: { type: 'string', enum: ['consumable', 'device'] },
    usageMode: { type: 'string', enum: ['single', 'multi'] }, unit: { type: 'string' }, brand: { type: 'string' }, size: { type: 'string' },
    showInTechPanel: { type: 'boolean' },
  }, ['name']),
  fn('propose_stock', 'پیش‌نویسِ ورودِ موجودی (ثبت نمی‌کند)', {
    itemId: { type: 'integer', description: 'خالی اگر کالا همین الان پیشنهاد شده' }, itemName: { type: 'string' },
    quantity: { type: 'integer' }, lotNo: { type: 'string' }, serialNo: { type: 'string' }, expiresJ: { type: 'string', description: 'شمسی، مثل ۱۴۰۶/۰۷/۳۰' },
  }, ['itemName', 'quantity']),
  fn('propose_set', 'پیش‌نویسِ ساختنِ ست از موجودی (ثبت نمی‌کند)', {
    name: { type: 'string' },
    lines: { type: 'array', items: { type: 'object', properties: { itemId: { type: 'integer' }, itemName: { type: 'string' }, quantity: { type: 'integer' } }, required: ['itemName', 'quantity'] } },
  }, ['name', 'lines']),
];

function fn(name: string, description: string, properties: Record<string, any>, required: string[]) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

@Injectable()
export class StockAssistantService {
  private readonly log = new Logger('StockAssistant');

  constructor(private settings: SettingsService, private inv: InventoryService, private sets: SetStockService) {}

  async status() {
    const cfg = await this.settings.ai();
    return { enabled: cfg.enabled };
  }

  async ask(raw: unknown) {
    const cfg = await this.settings.ai();
    if (!cfg.enabled) throw new BadRequestException('دستیارِ هوشِ مصنوعی پیکربندی نشده — تنظیماتِ شرکت، بخشِ «دستیارِ هوشِ مصنوعی»');
    const history = clean(raw);
    if (!history.length || history[history.length - 1].role !== 'user') throw new BadRequestException('پیامی برای دستیار نیست');

    const messages: any[] = [{ role: 'system', content: SYSTEM }, ...history];
    const actions: StockAction[] = [];
    const used: string[] = [];
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const reply = await this.call(cfg, messages);
      const calls = Array.isArray(reply?.tool_calls) ? reply.tool_calls : [];
      if (!calls.length) {
        const text = typeof reply?.content === 'string' ? reply.content.trim() : '';
        return { reply: text || (actions.length ? 'پیش‌نویس آماده است؛ اگر درست است «ثبت کن» را بزنید.' : 'جوابی نداشتم؛ سؤال را دقیق‌تر بنویسید.'), actions, tools: used };
      }
      messages.push({ role: 'assistant', content: reply.content ?? '', tool_calls: calls });
      for (const c of calls) {
        const name = c?.function?.name ?? '';
        let args: any = {};
        try { args = JSON.parse(c?.function?.arguments || '{}'); } catch { args = {}; }
        used.push(name);
        let out: unknown;
        try { out = await this.run(name, args, actions); }
        catch (e: any) { out = { error: String(e?.message ?? e) }; }
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(out).slice(0, 6000) });
      }
    }
    return { reply: 'بررسی طولانی شد؛ سؤال را کوتاه‌تر یا جداجدا بپرسید.', actions, tools: used };
  }

  /** ابزارها — همه خواندنی؛ propose_* فقط به فهرستِ پیش‌نویس‌ها اضافه می‌کند. */
  private async run(name: string, a: any, actions: StockAction[]): Promise<unknown> {
    switch (name) {
      case 'search_items': {
        const rows = await this.inv.catalog(String(a.q ?? ''));
        return rows.filter((r) => r.active).slice(0, 10).map((r) => ({
          itemId: r.id, name: [r.name, r.size].filter(Boolean).join(' '), kind: r.assetLabel, usage: r.usageLabel, unit: r.unit,
          readyInWarehouse: r.available, inSets: r.inSets.map((x) => ({ set: x.serialNo, quantity: x.quantity })),
        }));
      }
      case 'item_lots': {
        const rows = await this.inv.listLots({ itemId: Number(a.itemId), inStock: true });
        return rows.slice(0, 20).map((l) => ({ lotNo: l.lotNo, serialNo: l.serialNo, expires: l.expiresAt, expired: l.expired, ready: l.available, total: l.quantity, elsewhere: l.outside }));
      }
      case 'find_sets': {
        const rows = await this.sets.sets({ q: String(a.q ?? '').trim() || undefined });
        return rows.slice(0, 15).map((s) => ({
          serial: s.serialNo, name: s.itemName, at: s.consignedTo ? `امانیِ ${s.consignedTo}` : s.at, complete: s.totals.complete, shortage: s.totals.shortage,
          contents: s.contents.map((c) => ({ item: c.label, standard: c.standard, inside: c.inside })),
        }));
      }
      case 'expiring': {
        const days = Math.max(1, Math.min(730, Math.trunc(Number(a.days) || 90)));
        const rows = await this.inv.listLots({ expiringDays: days, inStock: true });
        return rows.slice(0, 30).map((l) => ({ item: l.itemName, lotNo: l.lotNo, expires: l.expiresAt, expired: l.expired, quantity: l.quantity }));
      }
      case 'damaged':
        return (await this.sets.damaged()).map((d) => ({ item: d.itemName, quantity: d.quantity, reason: d.reason }));
      case 'propose_item': {
        const nm = str(a.name, 80);
        if (nm.length < 2) return { error: 'نام لازم است' };
        const assetKind = a.assetKind === 'device' ? 'device' : 'consumable';
        actions.push({
          type: 'item', name: nm, assetKind,
          usageMode: assetKind === 'device' || a.usageMode === 'multi' ? 'multi' : 'single',
          unit: str(a.unit, 20) || undefined, brand: str(a.brand, 60) || undefined, size: str(a.size, 60) || undefined,
          showInTechPanel: a.showInTechPanel === true,
        });
        return { ok: true, note: 'پیش‌نویس شد؛ هنوز ثبت نشده' };
      }
      case 'propose_stock': {
        const q = Math.trunc(Number(a.quantity));
        if (!Number.isInteger(q) || q <= 0) return { error: 'تعداد باید عددِ مثبت باشد' };
        const serialNo = str(a.serialNo, 60) || undefined;
        if (serialNo && q > 1) return { error: 'لاتِ سریالی فقط یک عدد دارد' };
        actions.push({ type: 'stock', itemId: posInt(a.itemId), itemName: str(a.itemName, 80), quantity: q, lotNo: str(a.lotNo, 60) || undefined, serialNo, expiresJ: str(a.expiresJ, 12) || undefined });
        return { ok: true, note: 'پیش‌نویس شد؛ هنوز ثبت نشده' };
      }
      case 'propose_set': {
        const nm = str(a.name, 80);
        const lines = (Array.isArray(a.lines) ? a.lines : [])
          .map((l: any) => ({ itemId: posInt(l?.itemId), itemName: str(l?.itemName, 80), quantity: Math.trunc(Number(l?.quantity)) }))
          .filter((l: any) => l.itemName && Number.isInteger(l.quantity) && l.quantity > 0)
          .slice(0, 40);
        if (nm.length < 2 || !lines.length) return { error: 'نام و دستِ‌کم یک قلم لازم است' };
        actions.push({ type: 'set', name: nm, lines });
        return { ok: true, note: 'پیش‌نویس شد؛ هنوز ثبت نشده' };
      }
      default:
        return { error: `ابزارِ ناشناخته: ${name}` };
    }
  }

  private async call(cfg: { baseUrl: string; apiKey: string; model: string }, messages: any[]) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60_000);
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, temperature: 0.2, max_tokens: 1200, messages, tools: TOOLS, tool_choice: 'auto' }),
      });
      if (!res.ok) {
        this.log.warn(`AI ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
        throw new BadGatewayException(`سرویسِ هوشِ مصنوعی پاسخ نداد (${res.status}) — مدل باید «فراخوانیِ ابزار» را پشتیبانی کند`);
      }
      const json: any = await res.json();
      return json?.choices?.[0]?.message ?? null;
    } catch (e: any) {
      if (e instanceof BadGatewayException) throw e;
      this.log.warn(`AI fetch شکست خورد: ${e?.message ?? e}`);
      throw new BadGatewayException('دسترسی به سرویسِ هوشِ مصنوعی برقرار نشد');
    } finally {
      clearTimeout(timer);
    }
  }
}

/** تاریخچه از کلاینت می‌آید: فقط user/assistantِ متنی، کوتاه‌شده — نقشِ system هرگز پذیرفته نمی‌شود. */
function clean(raw: unknown): Msg[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
}
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const posInt = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
