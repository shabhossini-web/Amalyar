import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { DomainEventLike } from './work-rules';

/**
 * outboxِ رویدادهای دامنه — `docs/plan/CONTRACTS.md` §۲.
 *
 * `emit` را **داخلِ همان تراکنشِ** نوشتنِ اصلی صدا بزن (`tx` را بده) تا رویداد
 * و داده یا با هم بنشینند یا هیچ‌کدام. پردازشگر (`work-processor.ts`) بعداً از
 * روی آن کار می‌سازد؛ رویداد پاک نمی‌شود (منبعِ analytics).
 *
 * ⚠️ `emit` هرگز throw نمی‌کند مگر داخلِ تراکنش — بیرونِ تراکنش خطای outbox
 * نباید نوشتنِ اصلی را که همین حالا commit شده «شکست‌خورده» نشان دهد.
 */
@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  async emit(event: DomainEventLike, tx?: any): Promise<number | null> {
    const client = tx ?? this.prisma;
    const data = {
      type: event.type,
      patientId: event.patientId ?? null,
      visitId: event.visitId ?? null,
      appointmentId: event.appointmentId ?? null,
      refType: event.refType ?? null,
      refId: event.refId ?? null,
      payload: event.payload ?? undefined,
      actorId: event.actorId ?? null,
    };
    if (tx) return (await client.domainEvent.create({ data })).id;
    try {
      return (await client.domainEvent.create({ data })).id;
    } catch {
      return null;
    }
  }
}
