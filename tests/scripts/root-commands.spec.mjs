import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const packageJsonPath = path.join(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const scripts = packageJson.scripts ?? {};

test('root package.json exposes all CI/root gate scripts', () => {
  for (const scriptName of [
    'lint',
    'format',
    'format:check',
    'test:unit',
    'test:integration',
    'test:contract',
    'test:a11y',
    'test:performance',
    'test:e2e',
    'test:e2e:open',
    'test:all',
    'test',
  ]) {
    assert.ok(scripts[scriptName], `Missing required root script: ${scriptName}`);
  }
});
