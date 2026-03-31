# Contract: CI Jobs and Root Test Commands

**Branch**: `002-test-automation-ci` | **Date**: 2026-03-30

## 1. CI Workflow Contract

### 1.1 Trigger Contract

The CI workflow MUST trigger on:

- Pull requests targeting `main`
- Pushes to `main`

### 1.2 Required Jobs Contract

The workflow MUST expose independently reported required jobs:

- `lint`
- `unit`
- `integration`
- `contract`
- `accessibility`
- `performance`
- `peer-review-validation`
- `cypress-map`
- `cypress-stops`
- `cypress-routes`
- `cypress-core-smoke`

All listed jobs MUST be required for merge on pull requests.

### 1.3 Job Behavior Contract

#### Lint Job

- Executes root lint command.
- Fails on any lint error or warning (`--max-warnings 0` semantics preserved).

#### Unit Job

- Executes root unit command with coverage collection.
- Enforces coverage floors:
  - backend line coverage >= 85%
  - frontend line coverage >= 80%
- Fails if coverage regresses against baseline policy.

#### Integration Job

- Executes dedicated integration validation from root orchestration.
- Includes backend integration suite and Cypress grouped execution orchestration hooks.
- Fails on any integration suite failure.

#### Contract Job

- Executes API/schema contract checks from root orchestration.
- Fails on schema drift or contract mismatch.

#### Accessibility Job

- Executes automated WCAG 2.1 AA scan checks.
- Fails when new accessibility violations are introduced.

#### Performance Job

- Executes performance budget checks aligned with constitution thresholds.
- Fails on any threshold breach or regression beyond allowed tolerance.

#### Cypress Area Jobs

Each area job MUST:

- Execute only the area's spec pattern.
- Run in headless mode in CI.
- Fail if no tests are discovered for the area.
- Enforce a global minimum Cypress scenario count of 12 before test execution.
- Publish clear logs identifying area and failing spec(s).

Area mapping:

- `cypress-map` -> `tests/e2e/specs/map/**`
- `cypress-stops` -> `tests/e2e/specs/stops/**`
- `cypress-routes` -> `tests/e2e/specs/routes/**`
- `cypress-core-smoke` -> `tests/e2e/specs/core-smoke/**`

### 1.4 Failure Semantics Contract

- Any required job failure MUST mark workflow as failed.
- Pull request merge MUST be blocked until all required jobs pass.
- Partial success is allowed for reporting, but not for merge readiness.

## 2. Root Command Contract (`package.json`)

### 2.1 Required Scripts

Root scripts MUST include commands equivalent to:

- `lint`: run lint across backend and frontend
- `test:unit`: run backend and frontend unit suites
- `test:integration`: run integration suites
- `test:contract`: run contract validation suites
- `test:a11y`: run accessibility validation suites
- `test:performance`: run performance budget checks
- `test:e2e`: run Cypress in headless mode
- `test:e2e:open`: run Cypress interactive mocked-browser mode
- `test`: run full suite entrypoint expected by contributors (unit + e2e policy defined by project)

### 2.5 Full Suite Composition Contract

`test` MUST execute all constitution-automatable gates in this order unless explicitly overridden:

1. lint/format
2. unit
3. integration
4. contract
5. accessibility
6. performance
7. e2e grouped validation

### 2.2 Headless e2e Contract

`test:e2e` MUST:

- Use Cypress non-interactive run mode.
- Exit non-zero on any failure.
- Support optional area/group targeting via flags or environment variables.

### 2.3 Interactive Mocked-Browser Contract

`test:e2e:open` MUST:

- Start required app and mocks (or require them already running with explicit docs).
- Open Cypress browser UI for interactive debugging.
- Preserve spec grouping so users can run per-area scenarios locally.

### 2.4 Exit Code Contract

All root scripts MUST return non-zero when any delegated command fails.

## 3. Observability Contract

- CI logs MUST identify failing gate and area group by name.
- Coverage output MUST expose backend and frontend results distinctly.
- Cypress runs MUST print discovered-spec counts per group before execution.
- Integration and contract logs MUST identify failing suite/spec artifact names.
- Accessibility logs MUST report violation counts and new-vs-baseline deltas.
- Performance logs MUST report measured values, thresholds, and pass/fail status per metric.

## 4. Peer Review Gate Contract

- Repository branch protection MUST require at least one non-author approval before merge.
- CI workflow configuration and branch protection naming MUST remain stable with required status checks.
- Pull request merge readiness is false until all required jobs pass and peer review requirement is satisfied.
