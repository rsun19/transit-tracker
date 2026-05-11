import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VehiclesController } from './vehicles.controller';
import { CacheModule } from './cache/cache.module';
import { AgenciesModule } from './agencies/agencies.module';
import { HealthController } from './health.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), CacheModule, AgenciesModule],
  controllers: [VehiclesController, HealthController],
})
export class VehiclesModule {}
