import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { PermissionGuard } from '../auth/permission.guard';

@Module({
  controllers: [ImportController],
  providers: [ImportService, PermissionGuard],
})
export class ImportModule {}
