import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import {
  Agency,
  Route,
  Stop,
  StopTime,
  Trip,
  Shape,
  ServiceCalendar,
  configSchema,
} from '@transit-tracker/shared';
import { CacheModule } from './cache/cache.module';
import { AgenciesModule } from './agencies/agencies.module';
import { GtfsStaticService } from './gtfs-static.service';
import { GtfsRealtimeService } from './gtfs-realtime.service';
import { IngestionScheduler } from './ingestion.scheduler';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config: Record<string, unknown>) => {
        const result = configSchema.safeParse(config);
        if (!result.success) {
          const messages = result.error.errors
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join('\n');
          throw new Error(`Configuration validation failed:\n${messages}`);
        }
        return result.data;
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('DATABASE_URL'),
        entities: [Agency, Route, Stop, StopTime, Trip, Shape, ServiceCalendar],
        synchronize: true,
        logging: false,
      }),
    }),
    TypeOrmModule.forFeature([Agency, Route, Stop, StopTime, Trip, Shape, ServiceCalendar]),
    ScheduleModule.forRoot(),
    CacheModule,
    AgenciesModule,
  ],
  providers: [GtfsStaticService, GtfsRealtimeService, IngestionScheduler],
})
export class WorkerModule {}
