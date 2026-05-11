import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Stop, StopTime, Route, Trip, Agency, configSchema } from '@transit-tracker/shared';
import { StopsController } from './stops.controller';
import { StopsService } from './stops.service';
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
        return result.data;
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('DATABASE_URL'),
        entities: [Agency, Stop, StopTime, Route, Trip],
        synchronize: false,
        logging: configService.get<string>('NODE_ENV') === 'development',
      }),
    }),
    TypeOrmModule.forFeature([Stop, StopTime, Route, Trip]),
    CacheModule,
  ],
  controllers: [StopsController, HealthController],
  providers: [StopsService],
})
export class StopsModule {}
