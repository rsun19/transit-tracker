import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller';
import { CacheModule } from '@/modules/cache/cache.module';
import { AgenciesModule } from '@/modules/agencies/agencies.module';

@Module({
  imports: [CacheModule, AgenciesModule],
  controllers: [VehiclesController],
})
export class VehiclesModule {}
