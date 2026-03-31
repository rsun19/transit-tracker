import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

const requiredThresholds = {
  backend: 85,
  frontend: 80,
};

function readCoverage(filePath, label) {
  const absolutePath = path.join(rootDir, filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`${label} coverage summary not found at ${filePath}`);
  }

  const summary = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  return Number(summary.total.lines.pct);
}

function readBaseline(name) {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric value for ${name}: ${raw}`);
  }

  return parsed;
}

const backendLines = readCoverage('backend/coverage/coverage-summary.json', 'Backend');
const frontendLines = readCoverage('frontend/coverage/coverage-summary.json', 'Frontend');

const checks = [
  ['backend', backendLines],
  ['frontend', frontendLines],
];

for (const [label, value] of checks) {
  const threshold = requiredThresholds[label];
  if (value < threshold) {
    throw new Error(`${label} coverage ${value}% is below required ${threshold}%`);
  }
}

const backendBaseline = readBaseline('BASELINE_BACKEND_LINES');
const frontendBaseline = readBaseline('BASELINE_FRONTEND_LINES');

if (backendBaseline != null && backendLines < backendBaseline) {
  throw new Error(`backend coverage regressed: ${backendLines}% < baseline ${backendBaseline}%`);
}

if (frontendBaseline != null && frontendLines < frontendBaseline) {
  throw new Error(`frontend coverage regressed: ${frontendLines}% < baseline ${frontendBaseline}%`);
}

console.log(`backend lines: ${backendLines}% (required >= ${requiredThresholds.backend}%)`);
console.log(`frontend lines: ${frontendLines}% (required >= ${requiredThresholds.frontend}%)`);
console.log('Unit coverage gate passed.');
