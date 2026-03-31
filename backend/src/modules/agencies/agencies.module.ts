import { Module } from '@nestjs/common';
import { AgenciesService } from './agencies.service';
import { AgenciesController } from './agencies.controller';

@Module({
  providers: [AgenciesService],
  controllers: [AgenciesController],
  exports: [AgenciesService],
})
export class AgenciesModule {}
