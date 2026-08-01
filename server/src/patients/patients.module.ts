import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { DefinitionsController } from './definitions.controller';
import { DefinitionsService } from './definitions.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { ServiceCodesController } from './service-codes.controller';
import { ServiceCodesService } from './service-codes.service';
import { RecordController } from './record.controller';
import { RecordService } from './record.service';
import { InventoryController, VisitStockController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './treasury.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { PermissionGuard } from '../auth/permission.guard';

@Module({
  // ⚠️ ترتیب مهم است: PatientsController مسیرِ `patients` (جستجو) را دارد و
  // RecordController مسیرهای `patients/:id/...` را؛ Nest به ترتیبِ ثبت تطبیق می‌دهد.
  controllers: [
    PatientsController, BillingController, VisitStockController, ServiceCodesController,
    RecordController, InventoryController, SettlementController, LedgerController, TreasuryController, ReportsController, CalendarController, DefinitionsController,
  ],
  providers: [
    PatientsService, DefinitionsService, RecordService, BillingService,
    ServiceCodesService, InventoryService, SettlementService, LedgerService, TreasuryService, ReportsService, CalendarService, PermissionGuard,
  ],
})
export class PatientsModule {}
