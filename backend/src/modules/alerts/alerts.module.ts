import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { CacheModule } from '../cache/cache.module';
import { AgenciesModule } from '../agencies/agencies.module';

@Module({
  imports: [CacheModule, AgenciesModule],
  controllers: [AlertsController],
})
export class AlertsModule {}
