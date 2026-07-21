import { Injectable } from '@nestjs/common';
import { ControlPrismaService } from './control-prisma.service';
import { decryptDatabaseUrl } from './tenant-crypto';

@Injectable()
export class TenantRegistryService {
  constructor(private readonly control: ControlPrismaService) {}

  async resolveHostname(hostname: string) {
    const domain = await this.control.tenantDomain.findUnique({
      where: { hostname },
      include: { tenant: true },
    });
    if (!domain || domain.tenant.status !== 'active') return null;
    return {
      tenantId: domain.tenant.id,
      tenantSlug: domain.tenant.slug,
      databaseUrl: decryptDatabaseUrl(domain.tenant.databaseUrlEncrypted),
    };
  }

  async resolveDevelopmentDefault() {
    const slug = process.env.DEFAULT_TENANT_SLUG;
    if (!slug || process.env.NODE_ENV === 'production') return null;
    const tenant = await this.control.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status !== 'active') return null;
    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      databaseUrl: decryptDatabaseUrl(tenant.databaseUrlEncrypted),
    };
  }
}
