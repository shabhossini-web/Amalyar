import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { DefinitionsController } from './definitions.controller';
import { DefinitionsService } from './definitions.service';
import { PermissionGuard } from '../auth/permission.guard';

@Module({
  controllers: [PatientsController, DefinitionsController],
  providers: [PatientsService, DefinitionsService, PermissionGuard],
})
export class PatientsModule {}
