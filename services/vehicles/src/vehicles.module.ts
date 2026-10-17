import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VehiclesController } from './vehicles.controller';
import { AgenciesModule, CacheModule, HealthController } from '@transit-tracker/shared/nest';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), CacheModule, AgenciesModule],
  controllers: [VehiclesController, HealthController],
})
export class VehiclesModule {}
