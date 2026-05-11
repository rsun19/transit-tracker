import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgenciesController } from './agencies.controller';
import { AgenciesService } from './agencies.service';
import { HealthController } from './health.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AgenciesController, HealthController],
  providers: [AgenciesService],
  exports: [AgenciesService],
})
export class AgenciesModule {}
