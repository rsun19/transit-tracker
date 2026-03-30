import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller.js';
import { CacheModule } from '../cache/cache.module.js';
import { AgenciesModule } from '../agencies/agencies.module.js';

@Module({
  imports: [CacheModule, AgenciesModule],
  controllers: [AlertsController],
})
export class AlertsModule {}
