import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('interactive Cypress launcher fails fast when frontend is not reachable', () => {
  const result = spawnSync('node', ['scripts/e2e/open-cypress-interactive.mjs'], {
    env: {
      ...process.env,
      CYPRESS_BASE_URL: 'http://127.0.0.1:65535',
    },
    encoding: 'utf8',
  });

  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /not reachable/i);
});
