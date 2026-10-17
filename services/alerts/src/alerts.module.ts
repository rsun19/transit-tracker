import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AlertsController } from './alerts.controller';
import { AgenciesModule, CacheModule, HealthController } from '@transit-tracker/shared/nest';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), CacheModule, AgenciesModule],
  controllers: [AlertsController, HealthController],
})
export class AlertsModule {}
