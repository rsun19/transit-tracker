import { Module } from '@nestjs/common';
import { AgenciesService } from './agencies.service.js';
import { AgenciesController } from './agencies.controller.js';

@Module({
  providers: [AgenciesService],
  controllers: [AgenciesController],
  exports: [AgenciesService],
})
export class AgenciesModule {}
