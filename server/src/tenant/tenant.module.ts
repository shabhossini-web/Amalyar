import { Global, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ControlPrismaService } from './control-prisma.service';
import { TenantContext } from './tenant-context';
import { TenantMiddleware } from './tenant.middleware';
import { TenantRegistryService } from './tenant-registry.service';

@Global()
@Module({
  providers: [ControlPrismaService, TenantContext, TenantRegistryService, TenantMiddleware],
  exports: [ControlPrismaService, TenantContext, TenantRegistryService],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
