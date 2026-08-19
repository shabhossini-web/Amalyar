import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant-context';

/**
 * چتِ سازمانی (#54) — گفتگوی دونفره (dm) و گروهی بینِ حساب‌های همین شرکت.
 *
 * - dm با کلیدِ یکتای «dm:کوچک‌تر:بزرگ‌تر» — دو نفر همیشه یک گفتگو دارند و
 *   همزمانی را همان قیدِ دیتابیس می‌گیرد.
 * - «نخوانده» مشتقِ `lastReadId` است (قانونِ computeVisit: شمارنده‌ی
 *   ذخیره‌شده از واقعیت عقب می‌ماند).
 * - بلادرنگ: SSEِ در-پردازه — هر اتصالِ باز در نقشه‌ای به کلیدِ
 *   «tenant:account» می‌نشیند و پیامِ تازه به عضوهای وصل رویداد می‌دهد.
 *   fallbackِ همیشگی، خودِ HTTPِ عادی است؛ قطعیِ SSE فقط «دیرتر فهمیدن» است.
 */
@Injectable()
export class ChatService {
  private readonly log = new Logger('Chat');
  /** اتصال‌های بازِ SSE — کلید: `${tenantId}:${accountId}` */
  private streams = new Map<string, Set<Response>>();

  constructor(
    private prisma: PrismaService,
    private tenant: TenantContext,
  ) {}

  private async displayName(accountId: number): Promise<string> {
    const a = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { person: { select: { firstName: true, lastName: true } }, username: true },
    });
    return a ? (`${a.person?.firstName ?? ''} ${a.person?.lastName ?? ''}`.trim() || a.username || `#${accountId}`) : `#${accountId}`;
  }

  private async membership(channelId: number, accountId: number) {
    const m = await this.prisma.chatMember.findUnique({
      where: { channelId_accountId: { channelId, accountId } },
      include: { channel: { select: { id: true, kind: true, name: true } } },
    });
    if (!m) throw new NotFoundException('گفتگو پیدا نشد یا عضوش نیستید');
    return m;
  }

  /** دفترچهٔ همکاران — برای شروعِ گفتگو؛ فقط حساب‌های فعال، بدونِ خودِ کاربر. */
  async directory(user: any) {
    const rows = await this.prisma.account.findMany({
      where: { status: 'active', id: { not: user.id } },
      orderBy: { id: 'asc' },
      take: 200,
      select: {
        id: true, level: true, jobRole: true, username: true,
        person: { select: { firstName: true, lastName: true } },
      },
    });
    return rows.map((a) => ({
      id: a.id,
      name: `${a.person?.firstName ?? ''} ${a.person?.lastName ?? ''}`.trim() || a.username || `#${a.id}`,
      jobRole: a.jobRole,
      level: a.level,
    }));
  }

  /** گفتگوهای من — با شمارِ نخوانده و پیشنمای آخرین پیام؛ تازه‌ترین اول. */
  async channels(user: any) {
    const memberships = await this.prisma.chatMember.findMany({
      where: { accountId: user.id },
      include: {
        channel: {
          include: {
            members: {
              include: { account: { select: { id: true, username: true, person: { select: { firstName: true, lastName: true } } } } },
            },
            messages: { orderBy: { id: 'desc' }, take: 1 },
          },
        },
      },
    });
    const out: any[] = [];
    for (const m of memberships) {
      const ch = m.channel;
      const unread = await this.prisma.chatMessage.count({
        where: { channelId: ch.id, id: { gt: m.lastReadId }, authorId: { not: user.id } },
      });
      const others = ch.members
        .filter((x) => x.accountId !== user.id)
        .map((x) => `${x.account.person?.firstName ?? ''} ${x.account.person?.lastName ?? ''}`.trim() || x.account.username || `#${x.accountId}`);
      const last = ch.messages[0] ?? null;
      out.push({
        id: ch.id,
        kind: ch.kind,
        title: ch.kind === 'group' ? (ch.name ?? 'گروه') : (others[0] ?? 'گفتگو'),
        members: others,
        unread,
        lastBody: last ? last.body.slice(0, 80) : null,
        lastAt: last?.createdAt ?? ch.createdAt,
        lastId: last?.id ?? 0,
      });
    }
    return out.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  }

  /** گفتگوی دونفره — پیدا یا بساز؛ برخوردِ همزمان را قیدِ یکتای dmKey می‌گیرد. */
  async dm(user: any, otherId: number) {
    if (!Number.isInteger(otherId) || otherId <= 0) throw new BadRequestException('همکار را انتخاب کنید');
    if (otherId === user.id) throw new BadRequestException('گفتگو با خودتان معنا ندارد');
    const other = await this.prisma.account.findFirst({ where: { id: otherId, status: 'active' }, select: { id: true } });
    if (!other) throw new BadRequestException('حسابِ انتخابی فعال نیست');
    const key = `dm:${Math.min(user.id, otherId)}:${Math.max(user.id, otherId)}`;
    const existing = await this.prisma.chatChannel.findUnique({ where: { dmKey: key } });
    if (existing) return { id: existing.id, kind: 'dm' };
    try {
      const ch = await this.prisma.chatChannel.create({
        data: {
          kind: 'dm', dmKey: key, createdById: user.id,
          members: { create: [{ accountId: user.id }, { accountId: otherId }] },
        },
      });
      return { id: ch.id, kind: 'dm' };
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const again = await this.prisma.chatChannel.findUnique({ where: { dmKey: key } });
        if (again) return { id: again.id, kind: 'dm' };
      }
      throw e;
    }
  }

  /** گروهِ تازه — سازنده خودش عضو است. */
  async createGroup(user: any, dto: { name?: string; memberIds?: number[] }) {
    const name = (dto.name ?? '').trim();
    if (name.length < 2) throw new BadRequestException('نامِ گروه کوتاه است');
    const ids = [...new Set((dto.memberIds ?? []).map(Number).filter((x) => Number.isInteger(x) && x > 0 && x !== user.id))];
    if (!ids.length) throw new BadRequestException('دستِ‌کم یک عضو انتخاب کنید');
    const count = await this.prisma.account.count({ where: { id: { in: ids }, status: 'active' } });
    if (count !== ids.length) throw new BadRequestException('همهٔ عضوها باید حسابِ فعال باشند');
    const ch = await this.prisma.chatChannel.create({
      data: {
        kind: 'group', name, createdById: user.id,
        members: { create: [{ accountId: user.id }, ...ids.map((accountId) => ({ accountId }))] },
      },
    });
    return { id: ch.id, kind: 'group', name };
  }

  /** پیام‌های یک گفتگو — پیش‌فرض ۵۰ تای آخر؛ afterId برای زنده، beforeId برای تاریخچه. */
  async messages(user: any, channelId: number, afterId?: number, beforeId?: number) {
    await this.membership(channelId, user.id);
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        channelId,
        ...(afterId ? { id: { gt: afterId } } : {}),
        ...(beforeId ? { id: { lt: beforeId } } : {}),
      },
      orderBy: { id: afterId ? 'asc' : 'desc' },
      take: 50,
    });
    const list = afterId ? rows : rows.reverse();
    return list.map((m) => ({
      id: m.id, body: m.body, authorId: m.authorId, authorName: m.authorName,
      mine: m.authorId === user.id, createdAt: m.createdAt,
    }));
  }

  async send(user: any, channelId: number, body: string) {
    const text = (body ?? '').trim();
    if (!text) throw new BadRequestException('پیام خالی است');
    if (text.length > 4000) throw new BadRequestException('پیام طولانی است');
    const m = await this.membership(channelId, user.id);
    const msg = await this.prisma.chatMessage.create({
      data: { channelId, authorId: user.id, authorName: await this.displayName(user.id), body: text },
    });
    /* فرستنده تا همین پیام «خوانده» است. */
    await this.prisma.chatMember.update({
      where: { channelId_accountId: { channelId, accountId: user.id } },
      data: { lastReadId: msg.id },
    });
    void m;
    await this.broadcast(channelId, msg.id, user.id);
    return { id: msg.id, body: msg.body, authorId: msg.authorId, authorName: msg.authorName, mine: true, createdAt: msg.createdAt };
  }

  async markRead(user: any, channelId: number, lastId: number) {
    await this.membership(channelId, user.id);
    await this.prisma.chatMember.update({
      where: { channelId_accountId: { channelId, accountId: user.id } },
      data: { lastReadId: Math.max(0, Number(lastId) || 0) },
    });
    return { ok: true };
  }

  // ── SSE ─────────────────────────────────────────────────────────

  private streamKey(accountId: number) {
    return `${this.tenant.require().tenantId}:${accountId}`;
  }

  /** اتصالِ زنده — رویدادِ {channelId, id} با هر پیامِ تازه در گفتگوهای من. */
  async stream(user: any, res: Response) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write('data: {"hello":true}\n\n');

    const key = this.streamKey(user.id);
    let set = this.streams.get(key);
    if (!set) { set = new Set(); this.streams.set(key, set); }
    set.add(res);

    /* ضربان تا پروکسی اتصالِ ساکت را نبندد. */
    const beat = setInterval(() => { try { res.write(': beat\n\n'); } catch { /* بسته شده */ } }, 25_000);
    res.on('close', () => {
      clearInterval(beat);
      set!.delete(res);
      if (!set!.size) this.streams.delete(key);
    });
  }

  private async broadcast(channelId: number, messageId: number, authorId: number) {
    try {
      const tenantId = this.tenant.require().tenantId;
      const members = await this.prisma.chatMember.findMany({
        where: { channelId }, select: { accountId: true },
      });
      const payload = `data: ${JSON.stringify({ channelId, id: messageId, authorId })}\n\n`;
      for (const m of members) {
        const set = this.streams.get(`${tenantId}:${m.accountId}`);
        if (!set) continue;
        for (const res of set) {
          try { res.write(payload); } catch { /* اتصالِ مرده — close خودش پاک می‌کند */ }
        }
      }
    } catch (e: any) {
      this.log.warn(`broadcast نشد: ${e?.message ?? e}`);
    }
  }
}
