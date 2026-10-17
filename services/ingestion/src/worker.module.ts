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
  ServiceCalendarDate,
  configSchema,
} from '@transit-tracker/shared';
import { AgenciesModule, CacheModule } from '@transit-tracker/shared/nest';
import { WorkerLivenessService } from './worker-liveness.service';
import { GtfsStaticService } from './gtfs-static.service';
import { GtfsRealtimeService } from './gtfs-realtime.service';
import { IngestionScheduler } from './ingestion.scheduler';
import { StaticLookupService } from './static-lookup.service';

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
        entities: [
          Agency,
          Route,
          Stop,
          StopTime,
          Trip,
          Shape,
          ServiceCalendar,
          ServiceCalendarDate,
        ],
        synchronize: true,
        logging: false,
      }),
    }),
    TypeOrmModule.forFeature([
      Agency,
      Route,
      Stop,
      StopTime,
      Trip,
      Shape,
      ServiceCalendar,
      ServiceCalendarDate,
    ]),
    ScheduleModule.forRoot(),
    CacheModule,
    AgenciesModule,
  ],
  providers: [
    GtfsStaticService,
    GtfsRealtimeService,
    StaticLookupService,
    IngestionScheduler,
    WorkerLivenessService,
  ],
})
export class WorkerModule {}
