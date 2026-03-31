import fs from 'node:fs';
import path from 'node:path';

describe('API contract gate', () => {
  const repoRoot = path.resolve(__dirname, '../../..');

  it('has CI contract definition covering all mandatory gates', () => {
    const contractPath = path.join(
      repoRoot,
      'specs/002-test-automation-ci/contracts/ci-test-contract.md',
    );
    const contract = fs.readFileSync(contractPath, 'utf8');

    for (const gate of [
      'lint',
      'unit',
      'integration',
      'contract',
      'accessibility',
      'performance',
      'cypress-map',
      'cypress-stops',
      'cypress-routes',
      'cypress-core-smoke',
    ]) {
      expect(contract).toContain(`- \`${gate}\``);
    }
  });

  it('documents root command contract requirements', () => {
    const contractPath = path.join(
      repoRoot,
      'specs/002-test-automation-ci/contracts/ci-test-contract.md',
    );
    const contract = fs.readFileSync(contractPath, 'utf8');

    expect(contract).toContain('Root scripts MUST include commands equivalent to:');
    expect(contract).toContain('test:e2e:open');
  });
});
