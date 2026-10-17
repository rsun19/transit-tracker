import { type INestApplication, Logger, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'http';
import { HttpExceptionFilter } from './http-exception.filter';
import { createLogger } from './logger';

/**
 * Starts an HTTP service the same way everywhere: JSON logger, error filter,
 * no x-powered-by or CORS, keep-alive longer than nginx's, and shutdown hooks
 * so SIGTERM closes Redis and DB connections cleanly.
 */
export async function bootstrapService(
  module: Type<unknown>,
  options: { name: string; defaultPort: number },
): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(module, {
    logger: createLogger(options.name),
  });

  app.useGlobalFilters(new HttpExceptionFilter());
  app.disable('x-powered-by');
  app.enableCors({ origin: false });
  app.enableShutdownHooks();

  const httpServer = app.getHttpServer() as Server;
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;

  const port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : options.defaultPort;
  await app.listen(port);
  Logger.log(`${options.name} service listening on port ${port}`, 'Bootstrap');
  return app;
}
