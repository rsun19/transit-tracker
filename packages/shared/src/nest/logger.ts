import type { LoggerService } from '@nestjs/common';

type Level = 'log' | 'error' | 'warn' | 'debug' | 'verbose';

/**
 * One JSON object per line on stdout, so container logs can be parsed:
 * {"timestamp","level","service","message"[,"trace"]}. `service` is the Nest
 * context when there is one, else the given default.
 */
export function createLogger(defaultService: string): LoggerService {
  const write = (level: Level, message: unknown, context?: string, trace?: string) =>
    process.stdout.write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: context ?? defaultService,
        message,
        ...(trace !== undefined ? { trace } : {}),
      }) + '\n',
    );
  return {
    log: (message: unknown, context?: string) => write('log', message, context),
    error: (message: unknown, trace?: string, context?: string) =>
      write('error', message, context, trace),
    warn: (message: unknown, context?: string) => write('warn', message, context),
    debug: (message: unknown, context?: string) => write('debug', message, context),
    verbose: (message: unknown, context?: string) => write('verbose', message, context),
  };
}
