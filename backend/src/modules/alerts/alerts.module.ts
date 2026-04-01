import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { CacheModule } from '@/modules/cache/cache.module';
import { AgenciesModule } from '@/modules/agencies/agencies.module';

@Module({
  imports: [CacheModule, AgenciesModule],
  controllers: [AlertsController],
})
export class AlertsModule {}
