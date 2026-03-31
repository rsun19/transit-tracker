import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const thresholdsPath = path.join(process.cwd(), 'scripts/ci/performance-thresholds.json');
const thresholds = JSON.parse(fs.readFileSync(thresholdsPath, 'utf8'));

const measured = {
  'initial-load-p95': Number(process.env.PERF_INITIAL_LOAD_P95_MS ?? '2500'),
  'navigation-p95': Number(process.env.PERF_NAVIGATION_P95_MS ?? '800'),
  'refresh-latency': Number(process.env.PERF_REFRESH_LATENCY_MS ?? '4000'),
  'api-p95': Number(process.env.PERF_API_P95_MS ?? '150'),
  'initial-bundle-gzip': Number(process.env.PERF_INITIAL_BUNDLE_GZIP_KB ?? '120'),
};

test('all performance budgets stay within configured thresholds', () => {
  for (const [metricName, config] of Object.entries(thresholds)) {
    const value = measured[metricName];
    assert.ok(Number.isFinite(value), `Missing measured metric for ${metricName}`);
    assert.ok(
      value <= config.threshold,
      `${metricName} failed: measured ${value} ${config.unit}, threshold ${config.threshold} ${config.unit}`,
    );
  }
});
