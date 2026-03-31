import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller';
import { CacheModule } from '../cache/cache.module';
import { AgenciesModule } from '../agencies/agencies.module';

@Module({
  imports: [CacheModule, AgenciesModule],
  controllers: [VehiclesController],
})
export class VehiclesModule {}
