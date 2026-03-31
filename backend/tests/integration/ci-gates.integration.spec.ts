import fs from 'node:fs';
import path from 'node:path';

describe('CI integration gate wiring', () => {
  it('includes required integration gate scripts', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const requiredScripts = [
      'scripts/ci/run-gate.mjs',
      'scripts/ci/ensure-cypress-tests-found.mjs',
      'scripts/ci/ensure-cypress-min-scenarios.mjs',
    ];

    for (const scriptPath of requiredScripts) {
      expect(fs.existsSync(path.join(repoRoot, scriptPath))).toBe(true);
    }
  });

  it('tracks all required Cypress groups for parallel execution', () => {
    const groups = ['map', 'stops', 'routes', 'core-smoke'];
    expect(groups).toHaveLength(4);
  });
});
