import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Route, Shape, Trip, StopTime, Stop, Agency, configSchema } from '@transit-tracker/shared';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { CacheModule } from './cache/cache.module';
import { HealthController } from './health.controller';

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
        return config;
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('DATABASE_URL'),
        entities: [Agency, Route, Stop, StopTime, Trip, Shape],
        synchronize: false,
        logging: configService.get<string>('NODE_ENV') === 'development',
      }),
    }),
    TypeOrmModule.forFeature([Route, Shape, Trip, StopTime, Stop]),
    CacheModule,
  ],
  controllers: [RoutesController, TripsController, HealthController],
  providers: [RoutesService, TripsService],
})
export class RoutesModule {}
