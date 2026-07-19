import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { SmsModule } from './sms/sms.module';
import { AuthModule } from './auth/auth.module';
import { AccountsModule } from './accounts/accounts.module';
import { FeaturesModule } from './features/features.module';
import { PatientsModule } from './patients/patients.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SmsModule,
    AuthModule,
    AccountsModule,
    FeaturesModule,
    PatientsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
