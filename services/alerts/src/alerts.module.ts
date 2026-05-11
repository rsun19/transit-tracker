import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AlertsController } from './alerts.controller';
import { CacheModule } from './cache/cache.module';
import { AgenciesModule } from './agencies/agencies.module';
import { HealthController } from './health.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), CacheModule, AgenciesModule],
  controllers: [AlertsController, HealthController],
})
export class AlertsModule {}
