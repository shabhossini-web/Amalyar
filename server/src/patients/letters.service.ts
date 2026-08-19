import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { textSearchOr } from '../common/search';
import { toJalali } from '../common/jalali';

/**
 * نامهٔ اداری — `docs/BOOKING.md` (#47).
 *
 * شماره‌گذاری: «سالِ شمسی/شماره»، شمارنده در هر سال از یک. شماره از
 * **بیشینهٔ موجودِ همان سال + ۱** می‌آید نه از شمارشِ ردیف‌ها — با شمارش،
 * حذفِ یک نامهٔ وسطِ سال شماره‌اش را به نامهٔ بعدی می‌داد و یک شماره دوبار
 * صادر می‌شد؛ سوراخِ شماره بی‌ضرر است، شمارهٔ تکراری سندِ اداری را می‌سوزاند.
 */
@Injectable()
export class LettersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async list(t?: string) {
    const term = (t ?? '').trim();
    return this.prisma.letter.findMany({
      where: term ? { OR: textSearchOr(term, ['no', 'recipient', 'subject']) } : {},
      orderBy: { id: 'desc' },
      take: 200,
    });
  }

  async get(id: number) {
    const row = await this.prisma.letter.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('نامه پیدا نشد');
    return row;
  }

  async create(dto: { recipient: string; subject: string; body: string; attachment?: string }, user: any) {
    const [jy] = toJalali(new Date());
    /* برخوردِ همزمانی با قیدِ یکتای `no` گرفته می‌شود — چند تلاش، بعد خطای صریح. */
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rows = await this.prisma.letter.findMany({
        where: { no: { startsWith: `${jy}/` } },
        select: { no: true },
      });
      const max = rows.reduce((m, r) => Math.max(m, Number(r.no.split('/')[1]) || 0), 0);
      const no = `${jy}/${max + 1 + attempt}`;
      try {
        const row = await this.prisma.letter.create({
          data: {
            no,
            recipient: dto.recipient.trim(),
            subject: dto.subject.trim(),
            body: dto.body,
            attachment: dto.attachment?.trim() || null,
            createdById: user?.id ?? null,
          },
        });
        await this.audit.record({
          actorId: user?.id, action: 'letter.create', entityType: 'letter', entityId: row.id,
          after: { no: row.no, recipient: row.recipient, subject: row.subject },
        });
        return row;
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
      }
    }
    throw new BadRequestException('تخصیصِ شمارهٔ نامه نشد — دوباره تلاش کنید');
  }

  /** ویرایشِ متن و گیرنده — شماره **هرگز** عوض نمی‌شود. */
  async patch(id: number, dto: { recipient?: string; subject?: string; body?: string; attachment?: string | null }, user: any) {
    const row = await this.get(id);
    const data: any = {};
    if (dto.recipient !== undefined) data.recipient = dto.recipient.trim();
    if (dto.subject !== undefined) data.subject = dto.subject.trim();
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.attachment !== undefined) data.attachment = dto.attachment?.trim() || null;
    if (data.recipient === '' || data.subject === '') throw new BadRequestException('گیرنده و موضوع خالی نمی‌شوند');
    const updated = await this.prisma.letter.update({ where: { id }, data });
    await this.audit.record({
      actorId: user?.id, action: 'letter.update', entityType: 'letter', entityId: id,
      before: { recipient: row.recipient, subject: row.subject },
      after: { recipient: updated.recipient, subject: updated.subject },
    });
    return updated;
  }

  async remove(id: number, user: any) {
    const row = await this.get(id);
    await this.prisma.letter.delete({ where: { id } });
    await this.audit.record({
      actorId: user?.id, action: 'letter.delete', entityType: 'letter', entityId: id,
      before: { no: row.no, recipient: row.recipient, subject: row.subject },
    });
    return { ok: true };
  }
}
