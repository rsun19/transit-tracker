/// <reference types="jest" />
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WORKER_STALL_EXIT_MS, WorkerLivenessService } from './worker-liveness.service';

describe('WorkerLivenessService', () => {
  let dir: string;
  let file: string;
  let service: WorkerLivenessService;
  let exit: jest.Mock;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liveness-'));
    file = path.join(dir, 'worker-alive');
    const config = { get: () => file } as unknown as ConfigService;
    service = new WorkerLivenessService(config);
    exit = jest.fn();
    service.exit = exit;
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    service.onModuleDestroy();
    fs.rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('writes the liveness file at startup and on every completed poll', () => {
    service.onModuleInit();
    expect(fs.existsSync(file)).toBe(true);

    const at = Date.parse('2026-10-17T12:00:00Z');
    service.markAlive(at);
    expect(fs.readFileSync(file, 'utf8')).toBe('2026-10-17T12:00:00.000Z');
  });

  it('does nothing while polls keep completing', () => {
    const t0 = Date.now();
    service.markAlive(t0);
    service.check(t0 + WORKER_STALL_EXIT_MS);
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits once the poll loop has been stuck for the stall limit', () => {
    const t0 = Date.now();
    service.markAlive(t0);
    service.check(t0 + WORKER_STALL_EXIT_MS + 1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('keeps going if the liveness file cannot be written', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const config = {
      get: () => path.join(dir, 'missing-dir', 'alive'),
    } as unknown as ConfigService;
    const unwritable = new WorkerLivenessService(config);
    unwritable.exit = exit;
    const t0 = Date.now();
    expect(() => unwritable.markAlive(t0)).not.toThrow();
    unwritable.check(t0 + 1000);
    expect(exit).not.toHaveBeenCalled();
  });
});
