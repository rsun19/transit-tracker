/// <reference types="jest" />
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractGtfsFiles } from './extract';
import { makeZip } from './__fixtures__/zip';

describe('extractGtfsFiles()', () => {
  let dir: string;
  const zip = (entries: Parameters<typeof makeZip>[0]) => {
    const p = path.join(dir, 'feed.zip');
    fs.writeFileSync(p, makeZip(entries));
    return p;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('extracts only the wanted top-level files', async () => {
    const present = await extractGtfsFiles(
      zip([
        { name: 'stops.txt', data: 'stop_id\nS1\n' },
        { name: 'pathways.txt', data: 'ignored' },
        { name: 'nested/stops.txt', data: 'not top level' },
        { name: '../escape.txt', data: 'zip slip' },
      ]),
      dir,
      ['stops.txt', 'trips.txt', '../escape.txt'.replace('../', '')],
    );
    expect([...present]).toEqual(['stops.txt']);
    expect(fs.readFileSync(path.join(dir, 'stops.txt'), 'utf8')).toBe('stop_id\nS1\n');
    expect(fs.existsSync(path.join(dir, 'pathways.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '..', 'escape.txt'))).toBe(false);
  });

  it('refuses a zip whose declared size is over the limit before writing anything', async () => {
    const p = zip([{ name: 'stop_times.txt', data: 'small', declaredSize: 5_000_000 }]);
    await expect(extractGtfsFiles(p, dir, ['stop_times.txt'], 1_000_000)).rejects.toThrow(
      /would extract to 5000000 bytes/,
    );
    expect(fs.existsSync(path.join(dir, 'stop_times.txt'))).toBe(false);
  });

  it('stops extracting once the real bytes pass the limit, whatever the zip declares', async () => {
    const p = zip([{ name: 'stop_times.txt', data: Buffer.alloc(2000), declaredSize: 10 }]);
    await expect(extractGtfsFiles(p, dir, ['stop_times.txt'], 1000)).rejects.toThrow(
      /exceeded 1000 bytes/,
    );
  });
});
