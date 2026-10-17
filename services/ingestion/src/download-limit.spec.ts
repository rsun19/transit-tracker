/// <reference types="jest" />
import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { byteLimit } from './gtfs-static.service';

const sink = () => {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  return { stream, size: () => Buffer.concat(chunks).length };
};

describe('byteLimit()', () => {
  it('passes a download within the limit through unchanged', async () => {
    const out = sink();
    await pipeline(Readable.from([Buffer.alloc(60), Buffer.alloc(40)]), byteLimit(100), out.stream);
    expect(out.size()).toBe(100);
  });

  it('fails the pipeline once the limit is exceeded', async () => {
    const out = sink();
    await expect(
      pipeline(Readable.from([Buffer.alloc(60), Buffer.alloc(41)]), byteLimit(100), out.stream),
    ).rejects.toThrow('Download exceeded 100 bytes');
    expect(out.size()).toBeLessThanOrEqual(100);
  });
});
