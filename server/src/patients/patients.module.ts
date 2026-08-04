import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { DefinitionsController } from './definitions.controller';
import { DefinitionsService } from './definitions.service';
import { PlacesService } from './places.service';
import { PlacesController } from './places.controller';
import { IntakeService } from './intake.service';
import { IntakeController, PublicIntakeController } from './intake.controller';
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
import { AssetsController } from './assets.controller';
import { NameMergeController } from './name-merge.controller';
import { NameMergeService } from './name-merge.service';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { AssetsService } from './assets.service';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { DispatchController } from './dispatch.controller';
import { TechController } from './tech.controller';
import { TransportController } from './transport.controller';
import { DispatchService } from './dispatch.service';
import { TechService } from './tech.service';
import { TransportService } from './transport.service';
import { PermissionGuard } from '../auth/permission.guard';

@Module({
  // ⚠️ ترتیب مهم است: PatientsController مسیرِ `patients` (جستجو) را دارد و
  // RecordController مسیرهای `patients/:id/...` را؛ Nest به ترتیبِ ثبت تطبیق می‌دهد.
  controllers: [
    PatientsController, BillingController, VisitStockController, ServiceCodesController,
    RecordController, InventoryController, SettlementController, LedgerController, TreasuryController, ReportsController, AssetsController, RoutesController, NameMergeController,
    CalendarController, DispatchController, DefinitionsController, TechController, TransportController, PlacesController, IntakeController, PublicIntakeController,
  ],
  providers: [
    PatientsService, DefinitionsService, RecordService, BillingService,
    ServiceCodesService, InventoryService, SettlementService, LedgerService, TreasuryService, ReportsService, AssetsService, RoutesService, NameMergeService,
    CalendarService, DispatchService, TechService, TransportService, PlacesService, IntakeService, PermissionGuard,
  ],
})
export class PatientsModule {}
