import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async record(event: {
    actorId?: number | null;
    action: string;
    entityType?: string;
    entityId?: string | number;
    before?: unknown;
    after?: unknown;
    ip?: string;
    userAgent?: string;
  }) {
    await this.prisma.auditEvent.create({
      data: {
        actorId: event.actorId ?? null,
        action: event.action,
        entityType: event.entityType ?? null,
        entityId: event.entityId == null ? null : String(event.entityId),
        beforeJson: event.before as any,
        afterJson: event.after as any,
        ip: event.ip ?? null,
        userAgent: event.userAgent?.slice(0, 255) ?? null,
      },
    });
  }
}
