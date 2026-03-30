import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as fs from 'fs';
import { WorkerModule } from './worker.module.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: {
      log: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({ timestamp: new Date().toISOString(), level: 'log', service: context ?? 'Worker', message }) + '\n',
        ),
      error: (message: string, trace?: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', service: context ?? 'Worker', message, trace }) + '\n',
        ),
      warn: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({ timestamp: new Date().toISOString(), level: 'warn', service: context ?? 'Worker', message }) + '\n',
        ),
      debug: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({ timestamp: new Date().toISOString(), level: 'debug', service: context ?? 'Worker', message }) + '\n',
        ),
      verbose: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({ timestamp: new Date().toISOString(), level: 'verbose', service: context ?? 'Worker', message }) + '\n',
        ),
    },
  });

  // Write file-based liveness signal for Docker healthcheck
  const livenessPath = process.env['WORKER_FILE_LIVENESS_PATH'] ?? '/tmp/worker-alive';
  fs.writeFileSync(livenessPath, new Date().toISOString());
  Logger.log(`Liveness signal written to ${livenessPath}`, 'Worker');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    Logger.log('SIGTERM received — shutting down worker', 'Worker');
    await app.close();
    process.exit(0);
  });

  Logger.log('Worker started — GTFS ingestion scheduler active', 'Worker');
}

void bootstrap();
