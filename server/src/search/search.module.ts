import { Module } from '@nestjs/common';
import { PatientsModule } from '../patients/patients.module';
import { SearchController } from './search.controller';

/** جستجوی سراسری (W2.4) — روی سرویسِ بیماران سوار است، endpointِ خودش را دارد. */
@Module({
  imports: [PatientsModule],
  controllers: [SearchController],
})
export class SearchModule {}
