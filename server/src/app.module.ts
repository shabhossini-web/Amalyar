import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TenantModule } from './tenant/tenant.module';
import { PrismaModule } from './prisma/prisma.module';
import { SmsModule } from './sms/sms.module';
import { AuthModule } from './auth/auth.module';
import { AccountsModule } from './accounts/accounts.module';
import { FeaturesModule } from './features/features.module';
import { ImportModule } from './import/import.module';
import { PatientsModule } from './patients/patients.module';
import { AppController } from './app.controller';
import { AuditModule } from './audit/audit.module';
import { PlatformModule } from './platform/platform.module';
import { StorageModule } from './storage/storage.module';
import { TenantConfigModule } from './config/config.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TenantModule,
    PrismaModule,
    AuditModule,
    StorageModule,
    SmsModule,
    AuthModule,
    AccountsModule,
    FeaturesModule,
    TenantConfigModule,
    PatientsModule,
    ImportModule,
    PlatformModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
