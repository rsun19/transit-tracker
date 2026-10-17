import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createLogger } from '@transit-tracker/shared/nest';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: createLogger('Worker'),
  });

  process.on('SIGTERM', async () => {
    Logger.log('SIGTERM received — shutting down worker', 'Worker');
    await app.close();
    process.exit(0);
  });

  Logger.log('Worker started — GTFS ingestion scheduler active', 'Worker');
}

void bootstrap();
