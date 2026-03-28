import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller.js';
import { CacheModule } from '../cache/cache.module.js';
import { AgenciesModule } from '../agencies/agencies.module.js';

@Module({
  imports: [CacheModule, AgenciesModule],
  controllers: [VehiclesController],
})
export class VehiclesModule {}
