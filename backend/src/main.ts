import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: {
      log: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'log',
            service: context ?? 'App',
            message,
          }) + '\n',
        ),
      error: (message: string, trace?: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: context ?? 'App',
            message,
            trace,
          }) + '\n',
        ),
      warn: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'warn',
            service: context ?? 'App',
            message,
          }) + '\n',
        ),
      debug: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'debug',
            service: context ?? 'App',
            message,
          }) + '\n',
        ),
      verbose: (message: string, context?: string) =>
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'verbose',
            service: context ?? 'App',
            message,
          }) + '\n',
        ),
    },
  });

  // Apply global exception filter — no stack traces in responses (OWASP A05)
  app.useGlobalFilters(new HttpExceptionFilter());

  // Restrict CORS to same-origin only
  app.enableCors({ origin: false });

  // Prevent ECONNRESET when a downstream proxy (Next.js, nginx) reuses a
  // keep-alive connection that the Node.js default 5 s timeout would close.
  // keepAliveTimeout must be longer than any upstream idle-connection timeout.
  const httpServer = app.getHttpServer() as import('http').Server;
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;

  await app.listen(3000);
  Logger.log('Backend API listening on port 3000', 'Bootstrap');
}

void bootstrap();
