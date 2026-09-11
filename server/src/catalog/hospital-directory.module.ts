import { Module } from '@nestjs/common';
import { HospitalDirectoryService } from './hospital-directory.service';
@Module({ providers: [HospitalDirectoryService], exports: [HospitalDirectoryService] })
export class HospitalDirectoryModule {}
