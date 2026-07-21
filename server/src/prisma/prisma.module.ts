import { Global, Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  imports: [TenantModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
