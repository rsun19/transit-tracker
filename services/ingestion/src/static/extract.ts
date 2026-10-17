import * as fs from 'fs';
import * as path from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import * as unzipper from 'unzipper';

// MBTA's files expand to about 160 MB; this only stops a zip bomb.
export const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;

/** Passes bytes through, failing the stream once more than `maxBytes` have gone by. */
export function byteLimit(maxBytes: number, what = 'Download'): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, callback) {
      seen += chunk.length;
      if (seen > maxBytes) callback(new Error(`${what} exceeded ${maxBytes} bytes`));
      else callback(null, chunk);
    },
  });
}

/**
 * Extracts the named files from the zip's top level into destDir and returns
 * the names that were present. Only those exact names are written, so entry
 * paths can't escape destDir. The declared sizes are checked against
 * maxBytes before anything is written, and the actual bytes while
 * extracting, since a crafted zip can understate them.
 */
export async function extractGtfsFiles(
  zipPath: string,
  destDir: string,
  wanted: readonly string[],
  maxBytes = MAX_EXTRACTED_BYTES,
): Promise<Set<string>> {
  const directory = await unzipper.Open.file(zipPath);
  const entries = directory.files.filter((f) => f.type === 'File' && wanted.includes(f.path));

  const declared = entries.reduce((sum, f) => sum + f.uncompressedSize, 0);
  if (declared > maxBytes) {
    throw new Error(`GTFS files would extract to ${declared} bytes (limit ${maxBytes})`);
  }

  let remaining = maxBytes;
  for (const entry of entries) {
    const dest = path.join(destDir, entry.path);
    await pipeline(
      entry.stream(),
      byteLimit(remaining, 'Extracted GTFS'),
      fs.createWriteStream(dest),
    );
    remaining -= fs.statSync(dest).size;
  }
  return new Set(entries.map((f) => f.path));
}
